'use strict';

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');

const PAGE_SIZE = 2048;
const PAGE_HEADER = 6;

function findNameTable(header) {
  let best = [];
  let i = 0;
  while (i < header.length) {
    const c = header[i];
    const isStart = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
    if (isStart) {
      const names = [];
      let j = i;
      while (j < header.length) {
        let k = j;
        let s = '';
        while (k < header.length && header[k] >= 32 && header[k] < 127) {
          s += String.fromCharCode(header[k]);
          k++;
        }
        if (k < header.length && header[k] === 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
          names.push({ name: s, offset: j });
          j = k + 1;
        } else {
          break;
        }
      }
      if (names.length > best.length) best = names;
      i = j > i ? j : i + 1;
    } else {
      i++;
    }
  }
  return best;
}

function parseSchema(buf) {
  if (buf.length < 64) throw new Error('文件太小，不是有效的数据库文件');
  const recSize = buf.readUInt16LE(0);
  const headerSize = buf.readUInt16LE(2);
  const recordCount = buf.readUInt32LE(6);
  if (recSize < 8 || recSize > 512 || headerSize < 64 || headerSize > buf.length) {
    throw new Error('文件头格式不正确');
  }
  const names = findNameTable(buf.subarray(0, headerSize));
  if (names.length < 2) throw new Error('未能从文件头解析出字段名表');
  const n = names.length;

  let widths = null;
  let typeCodes = null;
  for (let p = 0; p + 2 * n <= headerSize; p++) {
    let sum = 0;
    let ok = true;
    const t = [];
    const w = [];
    for (let k = 0; k < n; k++) {
      const tt = buf[p + 2 * k];
      const ww = buf[p + 2 * k + 1];
      t.push(tt);
      w.push(ww);
      sum += ww;
      if (tt === 0 || ww < 2 || ww > 128) {
        ok = false;
        break;
      }
    }
    if (ok && sum === recSize) {
      widths = w;
      typeCodes = t;
      break;
    }
  }
  if (!widths) throw new Error('未能解析字段宽度表（文件可能已损坏或不是支持的版本）');

  const fields = [];
  let offset = 0;
  for (let k = 0; k < n; k++) {
    const width = widths[k];
    const kind = width <= 2 ? 'int16' : width === 4 ? 'int32' : 'string';
    fields.push({
      name: names[k].name,
      width,
      offset,
      kind,
      typeCode: typeCodes[k]
    });
    offset += width;
  }
  const stringField = fields.find((f) => f.kind === 'string');
  const nameField = (stringField || fields[0]).name;
  const perPage = Math.floor((PAGE_SIZE - PAGE_HEADER) / recSize);
  const pages = Math.floor((buf.length - headerSize) / PAGE_SIZE);
  return {
    recSize,
    headerSize,
    recordCount,
    fields,
    nameField,
    nameFieldIsString: Boolean(stringField),
    perPage,
    pages,
    capacity: pages * perPage
  };
}

function offsetForIndex(schema, index) {
  if (index < 0) throw new Error('记录序号无效');
  const page = Math.floor(index / schema.perPage);
  if (page >= schema.pages) throw new Error('超出文件容量');
  return (
    schema.headerSize +
    page * PAGE_SIZE +
    PAGE_HEADER +
    (index % schema.perPage) * schema.recSize
  );
}

function recordOffsets(schema) {
  const out = [];
  for (let i = 0; i < schema.recordCount && i < schema.capacity; i++) {
    out.push(offsetForIndex(schema, i));
  }
  return out;
}

function readInt(buf, off, width) {
  return width === 2
    ? buf.readUInt16BE(off) & 0x7fff
    : buf.readUInt32BE(off) & 0x7fffffff;
}

function writeInt(buf, off, width, value, fieldName) {
  let v = value;
  if (v === '' || v === null || v === undefined) v = 0;
  v = Number(v);
  if (!Number.isFinite(v) || Math.floor(v) !== v || v < 0) {
    throw new Error(`字段 ${fieldName} 需要非负整数`);
  }
  if (width === 2) {
    if (v > 0x7fff) throw new Error(`字段 ${fieldName} 超出范围 0-32767`);
    buf.writeUInt16BE(0x8000 | v, off);
  } else {
    if (v > 0x7fffffff) throw new Error(`字段 ${fieldName} 数值过大`);
    buf.writeUInt32BE((0x80000000 | v) >>> 0, off);
  }
}

function readRecord(buf, schema, off) {
  const row = {};
  for (const f of schema.fields) {
    row[f.name] =
      f.kind === 'string'
        ? gbk.decode(buf.subarray(off + f.offset, off + f.offset + f.width))
        : readInt(buf, off + f.offset, f.width);
  }
  return row;
}

function applyValues(buf, schema, off, values) {
  const byName = new Map(schema.fields.map((f) => [f.name, f]));
  for (const [name, value] of Object.entries(values)) {
    const f = byName.get(name);
    if (!f) throw new Error(`未知字段：${name}`);
    if (f.kind === 'string') {
      const encoded = gbk.encode(value == null ? '' : String(value));
      if (encoded.length > f.width) {
        throw new Error(`字段 ${f.name} 超出长度限制（最大 ${f.width} 字节，约 ${Math.floor(f.width / 2)} 个汉字）`);
      }
      buf.fill(0, off + f.offset, off + f.offset + f.width);
      encoded.copy(buf, off + f.offset);
    } else {
      writeInt(buf, off + f.offset, f.width, value, f.name);
    }
  }
}

function blankRecord(schema) {
  const rec = Buffer.alloc(schema.recSize);
  for (const f of schema.fields) {
    if (f.kind === 'int16') rec.writeUInt16BE(0x8000, f.offset);
    else if (f.kind === 'int32') rec.writeUInt32BE(0x80000000, f.offset);
  }
  return rec;
}

function loadDb(filePath) {
  const buf = fs.readFileSync(filePath);
  const schema = parseSchema(buf);
  const offsets = recordOffsets(schema);
  const rows = offsets.map((off) => readRecord(buf, schema, off));
  return { filePath, schema, rows };
}

function timestamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    '-' +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function backupFile(filePath) {
  const dir = path.join(path.dirname(filePath), '备份');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${path.basename(filePath)}.${timestamp()}.bak`);
  let target = base;
  let n = 1;
  while (fs.existsSync(target)) {
    target = base.replace(/\.bak$/, `-${n++}.bak`);
  }
  fs.copyFileSync(filePath, target);
  return target;
}

function saveDb(filePath, changes, added) {
  changes = Array.isArray(changes) ? changes : [];
  added = Array.isArray(added) ? added : [];
  const buf = fs.readFileSync(filePath);
  const schema = parseSchema(buf);
  const offsets = recordOffsets(schema);
  const byName = new Map(schema.fields.map((f) => [f.name, f]));

  let changedRows = 0;
  for (const change of changes) {
    const index = Number(change.index);
    if (!Number.isInteger(index) || index < 0 || index >= offsets.length) {
      throw new Error(`记录序号无效：${change.index}`);
    }
    applyValues(buf, schema, offsets[index], change.values || {});
    changedRows++;
  }

  let addedRows = 0;
  if (added.length > 0) {
    if (schema.recordCount + added.length > schema.capacity) {
      throw new Error(
        `空间不足：该文件最多还能新增 ${schema.capacity - schema.recordCount} 条记录`
      );
    }
    const idField = schema.fields.find((f) => f.name === 'Idx');
    let maxId = 0;
    if (idField) {
      for (const off of offsets) {
        maxId = Math.max(maxId, readInt(buf, off + idField.offset, idField.width));
      }
    }
    const usedIds = new Set();
    if (idField) {
      for (const off of offsets) usedIds.add(readInt(buf, off + idField.offset, idField.width));
    }

    for (const record of added) {
      const values = { ...record };
      if (idField) {
        const provided = values.Idx;
        if (provided === '' || provided === null || provided === undefined) {
          maxId += 1;
          values.Idx = maxId;
        } else {
          const v = Number(provided);
          if (!Number.isInteger(v) || v <= 0) throw new Error('Idx 必须是正整数');
          if (usedIds.has(v)) throw new Error(`Idx ${v} 已存在，请换一个编号`);
          maxId = Math.max(maxId, v);
        }
        usedIds.add(Number(values.Idx));
      }
      if (schema.nameFieldIsString) {
        const name = values[schema.nameField];
        if (!name || String(name).trim() === '') {
          throw new Error(`新增记录必须填写 ${schema.nameField}`);
        }
      }
      const slot = schema.recordCount + addedRows;
      const off = offsetForIndex(schema, slot);
      const rec = blankRecord(schema);
      applyValues(rec, schema, 0, values);
      rec.copy(buf, off);
      addedRows++;
    }
    buf.writeUInt32LE(schema.recordCount + addedRows, 6);
  }

  if (changedRows === 0 && addedRows === 0) {
    return {
      ok: true,
      changedRows: 0,
      addedRows: 0,
      count: schema.recordCount,
      capacity: schema.capacity,
      backup: null
    };
  }

  const backup = backupFile(filePath);
  fs.writeFileSync(filePath, buf);
  return {
    ok: true,
    changedRows,
    addedRows,
    count: schema.recordCount + addedRows,
    capacity: schema.capacity,
    backup
  };
}

module.exports = {
  PAGE_SIZE,
  PAGE_HEADER,
  parseSchema,
  loadDb,
  saveDb,
  backupFile,
  offsetForIndex
};

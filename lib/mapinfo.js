'use strict';

const gbk = require('./gbk');
const { readFileLines, writeFileLines, checkIndex, isInt, checkToken } = require('./configs');

const SECTIONS = [
  { key: 'jump', name: 'JUMPPOINT', label: '地图跳转点', kind: 'jump' },
  { key: 'nofight', name: 'NOFIGHT', label: '安全区/出生点', kind: 'nofight' },
  { key: 'sabukarea', name: 'SABUKWARAREA', label: '沙巴克战区', kind: 'area' },
  { key: 'sabukjump', name: 'SABUKJUMPPOINT', label: '沙巴克跳转点', kind: 'jump' },
  { key: 'redvillage', name: 'REDVILLAGE', label: '红名村区域', kind: 'area' },
  { key: 'property', name: 'MAPPROPERTY', label: '地图综合属性', kind: 'property' },
  { key: 'plantrange', name: 'PLANTRANGE', label: '植物范围', kind: 'area' }
];

const SECTION_BY_NAME = new Map(SECTIONS.map((s) => [s.name.toUpperCase(), s]));
const SECTION_BY_KEY = new Map(SECTIONS.map((s) => [s.key, s]));

function sectionHeader(line) {
  const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  return m ? m[1].trim().toUpperCase() : '';
}

function parseJump(line) {
  const m = /^(\S+)\s+(\d+)\s*,\s*(\d+)\s*->\s*(\S+)\s+(\d+)\s*,\s*(\d+)\s*$/.exec(line.trim());
  if (!m) return null;
  return {
    map: m[1], x: Number(m[2]), y: Number(m[3]),
    dest: m[4], dx: Number(m[5]), dy: Number(m[6])
  };
}

function parseArea(line) {
  const m = /^(\S+)\s+(\d+)\s*,\s*(\d+)\s+(\d+)\s*$/.exec(line.trim());
  if (!m) return null;
  return { map: m[1], x: Number(m[2]), y: Number(m[3]), radius: Number(m[4]) };
}

function parseNoFight(line) {
  const m = /^(\S+)\s+(\d+)\s*,\s*(\d+)\s+(\d+)\s+(\d+)\s+([01])\s*$/.exec(line.trim());
  if (!m) return null;
  return {
    map: m[1], x: Number(m[2]), y: Number(m[3]),
    safeRadius: Number(m[4]), townRadius: Number(m[5]), spawn: Number(m[6])
  };
}

function parseProperty(line) {
  const m = /^(\S+)\s+(.+?)\s*$/.exec(line.trim());
  if (!m) return null;
  return { map: m[1], flags: m[2].trim() };
}

function parseMapInfo(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const sections = {};
  for (const def of SECTIONS) {
    sections[def.key] = {
      key: def.key, name: def.name, label: def.label, kind: def.kind,
      headerLine: -1, rows: [], special: []
    };
  }

  let current = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const header = sectionHeader(line);
    if (header) {
      current = SECTION_BY_NAME.get(header) ? sections[SECTION_BY_NAME.get(header).key] : null;
      if (current) current.headerLine = li;
      continue;
    }
    if (!current) continue;
    const s = line.trim();
    if (!s || s.startsWith(';') || s.startsWith('#')) continue;
    let values = null;
    if (current.kind === 'jump') values = parseJump(line);
    else if (current.kind === 'area') values = parseArea(line);
    else if (current.kind === 'nofight') values = parseNoFight(line);
    else if (current.kind === 'property') values = parseProperty(line);
    if (!values) {
      current.special.push({ line: li, text: line });
      continue;
    }
    current.rows.push({
      index: current.rows.length,
      line: li,
      values
    });
  }
  return { file, lines, eol, trailing, sections };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseMapLoad(file) {
  const { buf, lines, eol, trailing } = readFileLines(file);
  const entries = [];
  let headerLine = -1;
  let sectionCount = 0;
  let lastEntryLine = -1;
  let inSection = false;
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const s = raw.trim();
    if (!s || s.startsWith(';') || s.startsWith('#')) continue;
    const head = /^\s*\[([^\]]+)\]/.exec(raw);
    if (head) {
      inSection = head[1].trim().toUpperCase() === 'MAPLOAD';
      if (inSection) {
        sectionCount++;
        if (headerLine < 0) headerLine = li;
      }
      continue;
    }
    if (!inSection) continue;
    const parts = s.split(',');
    if (parts.length < 2) continue;
    const code = parts[0].trim();
    const name = parts[1].trim();
    if (!code || !name || name.startsWith(';')) continue;
    entries.push({
      code,
      name,
      flag: (parts[2] || '0').trim() || '0',
      line: li
    });
    if (sectionCount === 1) lastEntryLine = li;
  }
  return { buf, lines, eol, trailing, headerLine, sectionCount, entries, lastEntryLine };
}

function registerMapLoad(file, input) {
  const values = input || {};
  const code = String(values.code == null ? '' : values.code).trim();
  const name = String(values.name == null ? '' : values.name).trim();

  if (!code) throw httpError(400, '地图编号不能为空');
  if (Array.from(code).length > 64) throw httpError(400, '地图编号太长（最多 64 字符）');
  if (/[\s,;#\[\]\u0000-\u001f\u007f]/.test(code)) {
    throw httpError(400, '地图编号不能包含空格、逗号、; # [ ] 等字符');
  }
  if (!name) throw httpError(400, '地图名称不能为空');
  if (Array.from(name).length > 64) throw httpError(400, '地图名称太长（最多 64 字符）');
  if (/[,\t\r\n\u0000-\u001f\u007f]/.test(name)) {
    throw httpError(400, '地图名称不能包含英文逗号、制表符或换行');
  }
  if (/^[;#]/.test(name)) throw httpError(400, '地图名称不能以 ; 或 # 开头');

  const line = `${code}\t,\t${name}\t,0`;
  try {
    gbk.encode(line);
  } catch (e) {
    throw httpError(400, '地图名称包含 GBK 无法编码的字符（如 emoji），无法写入 MapInfo');
  }

  let parsed;
  try {
    parsed = parseMapLoad(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') throw httpError(404, 'MapInfo 文件不存在，无法登记地图');
    throw e;
  }

  const dup = parsed.entries.find((item) => item.code.toLowerCase() === code.toLowerCase());
  if (dup) {
    throw httpError(409,
      `地图编号 ${code} 已在 [MAPLOAD] 登记为「${dup.name}」（第 ${dup.line + 1} 行）`);
  }

  let original;
  try {
    original = gbk.encode(parsed.lines.join(parsed.eol) + (parsed.trailing ? parsed.eol : ''));
  } catch (e) {
    throw httpError(409, 'MapInfo 含有无法无损重写的字节，请手动登记');
  }
  if (!original.equals(parsed.buf)) {
    throw httpError(409, 'MapInfo 含有无法无损重写的字节（可能是混合换行或非 GBK 内容），请手动登记');
  }

  let output;
  let insertIndex;
  let createdSection = false;
  if (parsed.headerLine < 0) {
    output = parsed.lines.slice();
    if (output.length && output[output.length - 1].trim() !== '') output.push('');
    output.push('[MAPLOAD]', line);
    insertIndex = output.length - 1;
    createdSection = true;
  } else {
    insertIndex = (parsed.lastEntryLine >= 0 ? parsed.lastEntryLine : parsed.headerLine) + 1;
    output = parsed.lines.slice(0, insertIndex).concat([line], parsed.lines.slice(insertIndex));
  }

  const backup = writeFileLines(file, output, parsed.eol, createdSection ? true : parsed.trailing);
  return {
    ok: true,
    file: 'MapInfo',
    entry: { code, name, flag: '0', line: insertIndex },
    line: insertIndex + 1,
    text: line,
    createdSection,
    total: parsed.entries.length + 1,
    backup
  };
}

function normalizeValue(values, base, kind, field) {
  const out = { ...base };
  const token = (key, label) => {
    if (values[key] !== undefined) out[key] = checkToken(values[key], label, 64);
  };
  const int = (key, label, min, max) => {
    if (values[key] === undefined) return;
    out[key] = Number(values[key]);
    if (!isInt(out[key], min, max)) throw new Error(`${label}需要 ${min}-${max} 的整数`);
  };
  if (kind === 'jump') {
    token('map', '地图编号');
    token('dest', '目标地图');
    int('x', 'X 坐标', 0, 100000);
    int('y', 'Y 坐标', 0, 100000);
    int('dx', '目标 X 坐标', 0, 100000);
    int('dy', '目标 Y 坐标', 0, 100000);
  } else if (kind === 'nofight') {
    token('map', '地图编号');
    int('x', 'X 坐标', 0, 100000);
    int('y', 'Y 坐标', 0, 100000);
    int('safeRadius', '安全区半径', 0, 100000);
    int('townRadius', '城镇范围', 0, 100000);
    int('spawn', '出生点标记', 0, 1);
  } else if (kind === 'area') {
    token('map', '地图编号');
    int('x', 'X 坐标', 0, 100000);
    int('y', 'Y 坐标', 0, 100000);
    int('radius', '半径', 0, 100000);
  } else if (kind === 'property') {
    token('map', '地图编号');
    if (values.flags !== undefined) {
      out.flags = String(values.flags).replace(/\s+/g, ' ').trim();
      if (!out.flags) throw new Error(field + '不能为空');
      if (out.flags.length > 1000) throw new Error(field + '太长');
    }
  }
  return out;
}

function rowLine(kind, row) {
  if (kind === 'jump') {
    return `${row.map}\t${row.x},${row.y}\t->\t${row.dest}\t${row.dx},${row.dy}`;
  }
  if (kind === 'nofight') {
    return `${row.map}\t${row.x},${row.y}\t${row.safeRadius}\t${row.townRadius}\t${row.spawn}`;
  }
  if (kind === 'area') {
    return `${row.map}\t${row.x},${row.y}\t${row.radius}`;
  }
  return `${row.map}\t${row.flags}`;
}

function saveMapInfo(file, payload) {
  const parsed = parseMapInfo(file);
  const changes = new Map();
  const deleted = new Map();
  const added = new Map();
  const changedCounts = {};

  for (const def of SECTIONS) {
    const sec = parsed.sections[def.key];
    const input = (payload.sections && payload.sections[def.key]) || {};
    const del = new Set();
    for (const raw of input.deleted || []) del.add(checkIndex(raw, sec.rows.length, def.label));
    deleted.set(def.key, del);
    const edit = new Map();
    for (const change of input.changes || []) {
      const index = checkIndex(change.index, sec.rows.length, def.label);
      if (del.has(index)) continue;
      const base = sec.rows[index].values;
      const merged = normalizeValue(change.values || {}, base, def.kind, def.label);
      const keys = Object.keys(base);
      if (keys.some((k) => merged[k] !== base[k])) edit.set(index, merged);
    }
    changes.set(def.key, edit);
    changedCounts[def.key] = edit.size;
    const rows = (input.added || []).map((row) =>
      normalizeValue(row, {}, def.kind, def.label)
    );
    added.set(def.key, rows);
  }

  const lineInfo = new Map();
  for (const def of SECTIONS) {
    const sec = parsed.sections[def.key];
    for (const row of sec.rows) lineInfo.set(row.line, { key: def.key, row });
  }

  const output = [];
  const headerOut = new Map();
  const lastRowOut = new Map();
  for (let li = 0; li < parsed.lines.length; li++) {
    const line = parsed.lines[li];
    const info = lineInfo.get(li);
    if (!info) {
      output.push(line);
      for (const def of SECTIONS) {
        if (parsed.sections[def.key].headerLine === li) headerOut.set(def.key, output.length - 1);
      }
      continue;
    }
    const def = SECTION_BY_KEY.get(info.key);
    if (deleted.get(info.key).has(info.row.index)) continue;
    const merged = changes.get(info.key).get(info.row.index);
    output.push(merged ? rowLine(def.kind, merged) : line);
    lastRowOut.set(info.key, output.length - 1);
  }

  const insertAfter = new Map();
  for (const def of SECTIONS) {
    const rows = added.get(def.key);
    if (!rows.length) continue;
    let anchor = lastRowOut.get(def.key);
    if (anchor === undefined) anchor = headerOut.get(def.key);
    if (anchor === undefined) {
      // 分区不存在时在文件末尾补一个完整分区
      output.push(`[${def.name}]`);
      anchor = output.length - 1;
      headerOut.set(def.key, anchor);
    }
    if (!insertAfter.has(anchor)) insertAfter.set(anchor, []);
    for (const row of rows) insertAfter.get(anchor).push(rowLine(def.kind, row));
  }

  const final = [];
  for (let i = 0; i < output.length; i++) {
    final.push(output[i]);
    if (insertAfter.has(i)) final.push(...insertAfter.get(i));
  }

  let changedRows = 0;
  let addedRows = 0;
  let deletedRows = 0;
  for (const def of SECTIONS) {
    changedRows += changes.get(def.key).size;
    addedRows += added.get(def.key).length;
    deletedRows += deleted.get(def.key).size;
  }
  if (changedRows + addedRows + deletedRows === 0) {
    const counts = {};
    for (const def of SECTIONS) counts[def.key] = parsed.sections[def.key].rows.length;
    return { ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, counts, backup: null };
  }
  const backup = writeFileLines(file, final, parsed.eol, parsed.trailing || addedRows > 0);
  const counts = {};
  for (const def of SECTIONS) {
    counts[def.key] = parsed.sections[def.key].rows.length -
      deleted.get(def.key).size + added.get(def.key).length;
  }
  return { ok: true, changedRows, addedRows, deletedRows, counts, backup };
}

module.exports = {
  SECTIONS,
  parseMapInfo,
  parseMapLoad,
  registerMapLoad,
  saveMapInfo
};

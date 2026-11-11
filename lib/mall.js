'use strict';

const path = require('path');
const { readFileLines, writeFileLines, checkIndex, isInt } = require('./configs');

const ITEM_FIELDS = ['id', 'looks', 'biglooks', 'type', 'dispname', 'name', 'price', 'unitnum', 'desc'];
const HOT_FIELDS = ['id', 'looks', 'biglooks', 'dispname', 'price'];

function findTag(line, name, from) {
  const startAt = from || 0;
  const re = new RegExp('<' + name + '(?=[\\s/>])', 'i');
  const m = re.exec(line.slice(startAt));
  if (!m) return null;
  const start = startAt + m.index;
  let quote = null;
  let end = -1;
  for (let i = start + name.length + 1; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '>') {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const text = line.slice(start, end + 1);
  const selfClosing = /\/\s*>$/.test(text);
  const attrs = [];
  let i = start + name.length + 1;
  while (i < end) {
    while (i < end && /\s/.test(line[i])) i++;
    if (i >= end || line[i] === '/' || line[i] === '>') break;
    const nameStart = i;
    while (i < end && !/[\s=/>]/.test(line[i])) i++;
    const attrName = line.slice(nameStart, i);
    if (!attrName) {
      i++;
      continue;
    }
    while (i < end && /\s/.test(line[i])) i++;
    if (line[i] !== '=') {
      attrs.push({
        name: attrName, value: '', quote: null,
        start: nameStart, end: i, valueStart: i, valueEnd: i
      });
      continue;
    }
    i++;
    while (i < end && /\s/.test(line[i])) i++;
    let quote = null;
    let valueStart;
    let valueEnd;
    if (line[i] === '"' || line[i] === "'") {
      quote = line[i];
      valueStart = i + 1;
      i++;
      while (i < end && line[i] !== quote) i++;
      valueEnd = i;
      if (i < end) i++;
    } else {
      valueStart = i;
      while (i < end && !/[\s>]/.test(line[i])) i++;
      valueEnd = i;
    }
    attrs.push({
      name: attrName,
      value: line.slice(valueStart, valueEnd),
      quote,
      start: nameStart,
      end: i,
      valueStart,
      valueEnd
    });
  }
  const map = new Map();
  for (const attr of attrs) if (!map.has(attr.name)) map.set(attr.name, attr);
  return { start, end, selfClosing, attrs, map };
}

function attr(tag, name) {
  const a = tag && tag.map.get(name);
  return a ? a.value : '';
}

function attrInt(tag, name, fallback) {
  const text = attr(tag, name);
  if (!/^\d+$/.test(text)) return fallback;
  return Number(text);
}

function escapeAttr(value, quote) {
  const q = quote || '"';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(new RegExp(q === '"' ? '"' : "'", 'g'), q === '"' ? '&quot;' : '&apos;');
}

function setAttr(line, tag, name, value) {
  const current = tag && tag.map.get(name);
  if (current) {
    if (current.value === value) return line;
    const quote = current.quote || '"';
    return line.slice(0, current.valueStart) +
      escapeAttr(value, quote) + line.slice(current.valueEnd);
  }
  if (value === '' || value === undefined || value === null) return line;
  const quote = '"';
  const pos = tag.end - (tag.selfClosing ? 1 : 0);
  const insert = ` ${name}=${quote}${escapeAttr(value, quote)}${quote}`;
  return line.slice(0, pos) + insert + line.slice(pos);
}

function emptyItem() {
  return {
    id: '', looks: 0, biglooks: '', type: 0,
    dispname: '', name: '', price: 0, unitnum: 1, desc: ''
  };
}

function parseMall(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const classes = [];
  const subclasses = [];
  const items = [];
  const hotItems = [];
  const special = [];
  let currentClass = null;
  let currentSub = null;
  let inHot = false;
  let scroll = null;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s) continue;

    if (/^<\/hotitems\s*>/i.test(s)) {
      inHot = false;
      continue;
    }
    if (/^<\/items\s*>/i.test(s)) {
      currentClass = null;
      currentSub = null;
      continue;
    }
    if (/^<\/subitems\s*>/i.test(s)) {
      currentSub = null;
      continue;
    }

    const hotTag = findTag(line, 'hotitems');
    if (hotTag) {
      inHot = true;
      continue;
    }

    const scrollTag = findTag(line, 'scrollmsg');
    if (scrollTag) {
      scroll = {
        line: li,
        value: attr(scrollTag, 'content'),
        tag: scrollTag,
        span: scrollTag.map.get('content') || null
      };
      continue;
    }

    const itemsTag = findTag(line, 'items');
    if (itemsTag) {
      const classId = attr(itemsTag, 'classid');
      if (!/^\d+$/.test(classId)) {
        special.push({ line: li, text: line, reason: '商品大类缺少 classid' });
        continue;
      }
      currentClass = {
        index: classes.length,
        line: li,
        id: classId,
        type: attr(itemsTag, 'classtype'),
        tag: itemsTag
      };
      classes.push(currentClass);
      currentSub = null;
      continue;
    }

    const subTag = findTag(line, 'subitems');
    if (subTag) {
      if (!currentClass) {
        special.push({ line: li, text: line, reason: '子类不在商品大类内' });
        continue;
      }
      const subId = attr(subTag, 'subclassid');
      if (!/^\d+$/.test(subId)) {
        special.push({ line: li, text: line, reason: '商品子类缺少 subclassid' });
        continue;
      }
      currentSub = {
        index: subclasses.length,
        line: li,
        classIndex: currentClass.index,
        classId: currentClass.id,
        id: subId,
        type: attr(subTag, 'subclasstype'),
        tag: subTag
      };
      subclasses.push(currentSub);
      continue;
    }

    const itemTag = findTag(line, 'item');
    if (itemTag) {
      const values = emptyItem();
      values.id = attr(itemTag, 'id');
      values.looks = attrInt(itemTag, 'looks', 0);
      values.biglooks = attr(itemTag, 'biglooks');
      values.type = attrInt(itemTag, 'type', 0);
      values.dispname = attr(itemTag, 'dispname');
      values.name = attr(itemTag, 'name');
      values.price = attrInt(itemTag, 'price', 0);
      values.unitnum = attrInt(itemTag, 'unitnum', 1);
      values.desc = attr(itemTag, 'desc');
      if (inHot) {
        hotItems.push({
          index: hotItems.length, line: li, tag: itemTag,
          values: { ...values, type: 0, name: '', desc: '', unitnum: 1 }
        });
      } else if (currentClass && currentSub) {
        items.push({
          index: items.length,
          line: li,
          tag: itemTag,
          classIndex: currentClass.index,
          classId: currentClass.id,
          classType: currentClass.type,
          subIndex: currentSub.index,
          subId: currentSub.id,
          subType: currentSub.type,
          values
        });
      } else {
        special.push({ line: li, text: line, reason: '商品不在分类内' });
      }
      continue;
    }

    if (s.includes('<item')) {
      special.push({ line: li, text: line, reason: '无法解析商品标签' });
    }
  }

  return {
    file,
    name: path.basename(file),
    lines,
    eol,
    trailing,
    classes,
    subclasses,
    items,
    hotItems,
    scroll,
    special
  };
}

function normalizeText(value, field, maxLen, allowEmpty) {
  const s = String(value == null ? '' : value);
  if (!allowEmpty && !s.trim()) throw new Error(field + '不能为空');
  if (/[\r\n]/.test(s)) throw new Error(field + '不能包含换行');
  if (s.length > maxLen) throw new Error(field + '太长');
  return s;
}

function normalizeMallItem(values, base, hot) {
  const out = { ...base };
  if (values.id !== undefined) {
    out.id = String(values.id).trim();
    if (!/^\d+$/.test(out.id)) throw new Error('商品 ID 需要数字');
    if (out.id.length > 32) throw new Error('商品 ID 太长');
  }
  if (values.looks !== undefined) {
    out.looks = Number(values.looks);
    if (!isInt(out.looks, 0, 100000000)) throw new Error('外观值需要非负整数');
  }
  if (values.biglooks !== undefined) {
    out.biglooks = String(values.biglooks).trim();
    if (out.biglooks && !/^\d+$/.test(out.biglooks)) throw new Error('大图外观需要数字');
    if (out.biglooks.length > 32) throw new Error('大图外观太长');
  }
  if (!hot && values.type !== undefined) {
    out.type = Number(values.type);
    if (!isInt(out.type, 0, 100000)) throw new Error('类型需要非负整数');
  }
  if (values.dispname !== undefined) out.dispname = normalizeText(values.dispname, '显示名称', 80, false);
  if (!hot && values.name !== undefined) out.name = normalizeText(values.name, '商品名称', 80, true);
  if (values.price !== undefined) {
    out.price = Number(values.price);
    if (!isInt(out.price, 0, 1000000000)) throw new Error('价格需要非负整数');
  }
  if (!hot && values.unitnum !== undefined) {
    out.unitnum = Number(values.unitnum);
    if (!isInt(out.unitnum, 1, 1000000)) throw new Error('单位数量需要 1-1000000 的整数');
  }
  if (!hot && values.desc !== undefined) out.desc = normalizeText(values.desc, '商品描述', 4000, true);
  return out;
}

function normalizeGroupType(value, field) {
  const s = String(value == null ? '' : value);
  if (/[\r\n]/.test(s)) throw new Error(field + '不能包含换行');
  if (s.length > 80) throw new Error(field + '太长');
  return s;
}

function itemLine(item, hot, indent) {
  const attrs = [
    `id="${escapeAttr(item.id)}"`,
    `looks="${escapeAttr(item.looks)}"`,
    `biglooks="${escapeAttr(item.biglooks)}"`
  ];
  if (!hot) attrs.push(`type="${escapeAttr(item.type)}"`);
  attrs.push(`dispname="${escapeAttr(item.dispname)}"`);
  if (!hot) attrs.push(`name="${escapeAttr(item.name)}"`);
  attrs.push(`price="${escapeAttr(item.price)}"`);
  if (!hot) attrs.push(`unitnum="${escapeAttr(item.unitnum)}"`);
  if (!hot) attrs.push(`desc="${escapeAttr(item.desc)}"`);
  return `${indent}<item ${attrs.join(' ')}/>`;
}

function uniqueId(base, used) {
  let id = String(base || '').replace(/\D/g, '') || '10000001';
  if (!used.has(id)) return id;
  let n = 2;
  while (used.has(id + n)) n++;
  return id + n;
}

function saveMall(file, payload) {
  const parsed = parseMall(file);
  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, parsed.items.length, '商品'));
  const hotDeleted = new Set();
  for (const raw of payload.hotDeleted || []) hotDeleted.add(checkIndex(raw, parsed.hotItems.length, '热卖商品'));

  const changes = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, parsed.items.length, '商品');
    if (deleted.has(index)) continue;
    const base = parsed.items[index].values;
    const merged = normalizeMallItem(change.values || {}, base, false);
    if (ITEM_FIELDS.some((k) => merged[k] !== base[k])) changes.set(index, merged);
  }
  const hotChanges = new Map();
  for (const change of payload.hotChanges || []) {
    const index = checkIndex(change.index, parsed.hotItems.length, '热卖商品');
    if (hotDeleted.has(index)) continue;
    const base = parsed.hotItems[index].values;
    const merged = normalizeMallItem(change.values || {}, base, true);
    if (HOT_FIELDS.some((k) => merged[k] !== base[k])) hotChanges.set(index, merged);
  }

  const groupChanges = new Map();
  for (const change of payload.classChanges || []) {
    const index = checkIndex(change.index, parsed.classes.length, '商品大类');
    const type = normalizeGroupType(change.type, '大类名称');
    if (type !== parsed.classes[index].type) groupChanges.set(index, type);
  }
  const subChanges = new Map();
  for (const change of payload.subChanges || []) {
    const index = checkIndex(change.index, parsed.subclasses.length, '商品子类');
    const type = normalizeGroupType(change.type, '子类名称');
    if (type !== parsed.subclasses[index].type) subChanges.set(index, type);
  }

  let scroll = parsed.scroll ? parsed.scroll.value : '';
  if (payload.scroll !== undefined) {
    scroll = normalizeText(payload.scroll, '滚动公告', 2000, true);
  }

  const used = new Set([
    ...parsed.items.map((it) => it.values.id),
    ...parsed.hotItems.map((it) => it.values.id)
  ]);
  const addedIds = new Set();
  for (const row of payload.added || []) {
    const id = String((row && row.id) || '').trim();
    if (used.has(id) || addedIds.has(id)) throw new Error('新增商品 ID 已存在：' + id);
    addedIds.add(id);
  }
  const added = (payload.added || []).map((row) => {
    const item = normalizeMallItem(row, emptyItem(), false);
    const sub = parsed.subclasses.find((s) => s.classId === String(row.classId) && s.id === String(row.subId));
    if (!sub) throw new Error('新增商品所属分类不存在');
    used.add(item.id);
    return { classId: sub.classId, subId: sub.id, values: item, sub };
  });
  const hotAdded = (payload.hotAdded || []).map((row) => {
    const item = normalizeMallItem(row, emptyItem(), true);
    if (used.has(item.id)) throw new Error('新增热卖商品 ID 已存在：' + item.id);
    used.add(item.id);
    return { values: item };
  });

  const lineInfo = new Map();
  for (const it of parsed.items) lineInfo.set(it.line, { kind: 'item', index: it.index });
  for (const it of parsed.hotItems) lineInfo.set(it.line, { kind: 'hot', index: it.index });
  for (const c of parsed.classes) lineInfo.set(c.line, { kind: 'class', index: c.index });
  for (const s of parsed.subclasses) lineInfo.set(s.line, { kind: 'sub', index: s.index });
  if (parsed.scroll) lineInfo.set(parsed.scroll.line, { kind: 'scroll' });

  const output = [];
  const lastItemOut = new Map();
  const lastHotOut = { value: -1 };
  const subHeaderOut = new Map();
  const classHeaderOut = new Map();
  let hotHeaderOut = -1;

  for (let li = 0; li < parsed.lines.length; li++) {
    const info = lineInfo.get(li);
    if (!info) {
      if (parsed.lines[li].includes('<hotitems')) hotHeaderOut = output.length;
      output.push(parsed.lines[li]);
      continue;
    }
    let line = parsed.lines[li];
    if (info.kind === 'item') {
      if (deleted.has(info.index)) continue;
      const item = parsed.items[info.index];
      const merged = changes.get(info.index);
      if (merged) {
        for (const key of ITEM_FIELDS) {
          if (merged[key] !== item.values[key]) line = setAttr(line, item.tag, key, merged[key]);
        }
      }
      output.push(line);
      lastItemOut.set(`${item.classId}:${item.subId}`, output.length - 1);
    } else if (info.kind === 'hot') {
      if (hotDeleted.has(info.index)) continue;
      const item = parsed.hotItems[info.index];
      const merged = hotChanges.get(info.index);
      if (merged) {
        for (const key of HOT_FIELDS) {
          if (merged[key] !== item.values[key]) line = setAttr(line, item.tag, key, merged[key]);
        }
      }
      output.push(line);
      lastHotOut.value = output.length - 1;
    } else if (info.kind === 'class') {
      const cls = parsed.classes[info.index];
      if (groupChanges.has(info.index)) {
        line = setAttr(line, cls.tag, 'classtype', groupChanges.get(info.index));
      }
      output.push(line);
      classHeaderOut.set(cls.id, output.length - 1);
    } else if (info.kind === 'sub') {
      const sub = parsed.subclasses[info.index];
      if (subChanges.has(info.index)) {
        line = setAttr(line, sub.tag, 'subclasstype', subChanges.get(info.index));
      }
      output.push(line);
      subHeaderOut.set(`${sub.classId}:${sub.id}`, output.length - 1);
    } else if (info.kind === 'scroll') {
      if (scroll !== parsed.scroll.value) {
        line = setAttr(line, parsed.scroll.tag, 'content', scroll);
      }
      output.push(line);
    }
  }

  const insertAfter = new Map();
  const append = [];
  for (const row of added) {
    const key = `${row.classId}:${row.subId}`;
    const indent = ' '.repeat(8);
    const line = itemLine(row.values, false, indent);
    const pos = lastItemOut.get(key);
    if (pos !== undefined) {
      if (!insertAfter.has(pos)) insertAfter.set(pos, []);
      insertAfter.get(pos).push(line);
      continue;
    }
    const subPos = subHeaderOut.get(key);
    if (subPos !== undefined) {
      if (!insertAfter.has(subPos)) insertAfter.set(subPos, []);
      insertAfter.get(subPos).push(line);
      continue;
    }
    const classPos = classHeaderOut.get(row.classId);
    if (classPos !== undefined) {
      if (!insertAfter.has(classPos)) insertAfter.set(classPos, []);
      insertAfter.get(classPos).push(line);
      continue;
    }
    append.push(line);
  }
  for (const row of hotAdded) {
    const line = itemLine(row.values, true, '\t\t');
    const pos = lastHotOut.value >= 0 ? lastHotOut.value : hotHeaderOut;
    if (pos >= 0) {
      if (!insertAfter.has(pos)) insertAfter.set(pos, []);
      insertAfter.get(pos).push(line);
    } else {
      append.push(line);
    }
  }

  const final = [];
  for (let i = 0; i < output.length; i++) {
    final.push(output[i]);
    if (insertAfter.has(i)) final.push(...insertAfter.get(i));
  }
  final.push(...append);

  const changedRows = changes.size;
  const addedRows = added.length;
  const deletedRows = deleted.size;
  const hotChanged = hotChanges.size;
  const hotAddedRows = hotAdded.length;
  const hotDeletedRows = hotDeleted.size;
  const groupChanged = groupChanges.size + subChanges.size;
  const scrollChanged = parsed.scroll ? scroll !== parsed.scroll.value : Boolean(scroll);
  if (
    changedRows === 0 && addedRows === 0 && deletedRows === 0 &&
    hotChanged === 0 && hotAddedRows === 0 && hotDeletedRows === 0 &&
    groupChanged === 0 && !scrollChanged
  ) {
    return {
      ok: true, changedRows: 0, addedRows: 0, deletedRows: 0,
      hotChanged: 0, hotAdded: 0, hotDeleted: 0, groupChanged: 0,
      scrollChanged: false, count: parsed.items.length, hotCount: parsed.hotItems.length,
      backup: null
    };
  }
  const backup = writeFileLines(file, final, parsed.eol, parsed.trailing || addedRows + hotAddedRows > 0);
  return {
    ok: true,
    changedRows,
    addedRows,
    deletedRows,
    hotChanged,
    hotAdded: hotAddedRows,
    hotDeleted: hotDeletedRows,
    groupChanged,
    scrollChanged,
    count: parsed.items.length - deletedRows + addedRows,
    hotCount: parsed.hotItems.length - hotDeletedRows + hotAddedRows,
    backup
  };
}

function nextMallId(base, used) {
  return uniqueId(base, used);
}

module.exports = {
  parseMall,
  saveMall,
  nextMallId
};

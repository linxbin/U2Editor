'use strict';

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const { backupFile } = require('./dbe');

/* 共享文件读缓存:按 size+mtimeMs 校验;写文件的代码写后必须调 invalidateFileCache。
   buf/text 是共享只读对象,调用方不得修改;lines 每次返回浅拷贝。 */
const lineCache = new Map();

function readFileLines(file) {
  const key = path.resolve(file);
  let st = null;
  try {
    st = fs.statSync(key);
    const hit = lineCache.get(key);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
      return {
        buf: hit.entry.buf,
        text: hit.entry.text,
        lines: hit.entry.lines.slice(),
        eol: hit.entry.eol,
        trailing: hit.entry.trailing
      };
    }
  } catch (e) {
    // stat 失败继续走读取,保留原有的打开错误
  }
  const buf = fs.readFileSync(key);
  const text = gbk.decodeText(buf);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let trailing = false;
  if (lines.length && lines[lines.length - 1] === '') {
    trailing = true;
    lines.pop();
  }
  if (st) {
    lineCache.set(key, {
      size: st.size,
      mtimeMs: st.mtimeMs,
      entry: { buf, text, lines, eol, trailing }
    });
  }
  return { buf, text, lines: lines.slice(), eol, trailing };
}

function invalidateFileCache(file) {
  lineCache.delete(path.resolve(file));
}

function clearFileCache() {
  lineCache.clear();
}

function writeFileLines(file, lines, eol, trailing) {
  const backup = backupFile(file);
  const text = lines.join(eol) + (trailing ? eol : '');
  fs.writeFileSync(file, gbk.encode(text));
  invalidateFileCache(file);
  return backup;
}

function tokenize(line) {
  return [...line.matchAll(/\S+/g)];
}

function patchTokens(line, changes) {
  const matches = tokenize(line);
  let out = '';
  let last = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    out += line.slice(last, m.index);
    out += changes.has(i) ? String(changes.get(i)) : m[0];
    last = m.index + m[0].length;
  }
  return out + line.slice(last);
}

function isInt(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}

function checkToken(value, field, maxLen) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw new Error(`${field} 不能为空`);
  if (/\s/.test(s)) throw new Error(`${field} 不能包含空格或制表符`);
  if (s.length > maxLen) throw new Error(`${field} 太长`);
  return s;
}

function checkIndex(index, length, label) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= length) {
    throw new Error(`${label}序号无效：${index}`);
  }
  return i;
}

function normalizeMongen(values, base) {
  const out = { ...base };
  if (values.map !== undefined) out.map = checkToken(values.map, '地图', 32);
  if (values.monster !== undefined) out.monster = checkToken(values.monster, '怪物名称', 32);
  if (values.x !== undefined) {
    out.x = Number(values.x);
    if (!isInt(out.x, 0, 100000)) throw new Error('X 坐标需要 0-100000 的整数');
  }
  if (values.y !== undefined) {
    out.y = Number(values.y);
    if (!isInt(out.y, 0, 100000)) throw new Error('Y 坐标需要 0-100000 的整数');
  }
  if (values.range !== undefined) {
    out.range = Number(values.range);
    if (!isInt(out.range, 0, 100000)) throw new Error('范围需要 0-100000 的整数');
  }
  if (values.count !== undefined) {
    out.count = Number(values.count);
    if (!isInt(out.count, 0, 1000000)) throw new Error('数量需要 0-1000000 的整数');
  }
  if (values.interval !== undefined) {
    out.interval = Number(values.interval);
    if (!isInt(out.interval, 0, 1000000000)) throw new Error('间隔需要非负整数');
  }
  return out;
}

function parseMongen(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const entries = [];
  const special = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s || s.startsWith(';')) continue;
    const matches = tokenize(line);
    const tok = matches.map((m) => m[0]);
    if (
      tok.length >= 7 &&
      tok[0] &&
      tok[3] &&
      /^\d+$/.test(tok[1]) &&
      /^\d+$/.test(tok[2]) &&
      /^\d+$/.test(tok[4]) &&
      /^\d+$/.test(tok[5]) &&
      /^\d+$/.test(tok[6])
    ) {
      entries.push({
        map: tok[0],
        x: Number(tok[1]),
        y: Number(tok[2]),
        monster: tok[3],
        range: Number(tok[4]),
        count: Number(tok[5]),
        interval: Number(tok[6]),
        extra: tok.slice(7),
        line: li
      });
    } else {
      special.push({ line: li, text: line });
    }
  }
  const mapCount = new Map();
  for (const e of entries) mapCount.set(e.map, (mapCount.get(e.map) || 0) + 1);
  const maps = [...mapCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { lines, eol, trailing, entries, special, maps };
}

function saveMongen(file, payload) {
  const parsed = parseMongen(file);
  const { lines, eol, trailing, entries } = parsed;
  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, entries.length, '刷怪'));

  const changes = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, entries.length, '刷怪');
    const merged = normalizeMongen(change.values || {}, entries[index]);
    const patch = new Map();
    if (merged.map !== entries[index].map) patch.set(0, merged.map);
    if (merged.x !== entries[index].x) patch.set(1, merged.x);
    if (merged.y !== entries[index].y) patch.set(2, merged.y);
    if (merged.monster !== entries[index].monster) patch.set(3, merged.monster);
    if (merged.range !== entries[index].range) patch.set(4, merged.range);
    if (merged.count !== entries[index].count) patch.set(5, merged.count);
    if (merged.interval !== entries[index].interval) patch.set(6, merged.interval);
    if (patch.size) changes.set(index, patch);
  }

  const added = (payload.added || []).map((item) => normalizeMongen(item, {
    map: '', x: 0, y: 0, monster: '', range: 0, count: 1, interval: 1
  }));

  const entryByLine = new Map(entries.map((e, i) => [e.line, { entry: e, index: i }]));
  const output = [];
  const lastOutByMap = new Map();
  for (let li = 0; li < lines.length; li++) {
    const info = entryByLine.get(li);
    if (!info) {
      output.push(lines[li]);
      continue;
    }
    if (deleted.has(info.index)) continue;
    const patch = changes.get(info.index);
    output.push(patch ? patchTokens(lines[li], patch) : lines[li]);
    lastOutByMap.set(info.entry.map, output.length - 1);
  }

  const insertAfter = new Map();
  const append = [];
  for (const item of added) {
    const line = [item.map, item.x, item.y, item.monster, item.range, item.count, item.interval].join('\t');
    const pos = lastOutByMap.get(item.map);
    if (pos === undefined) append.push(line);
    else {
      if (!insertAfter.has(pos)) insertAfter.set(pos, []);
      insertAfter.get(pos).push(line);
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
  if (changedRows === 0 && addedRows === 0 && deletedRows === 0) {
    return { ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, count: entries.length, backup: null };
  }
  const backup = writeFileLines(file, final, eol, trailing || addedRows > 0);
  return {
    ok: true,
    changedRows,
    addedRows,
    deletedRows,
    count: entries.length - deletedRows + addedRows,
    backup
  };
}

function parseMakeItem(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const recipes = [];
  let current = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s || s.startsWith(';')) continue;
    const head = s.match(/^\[(.+)\]$/);
    if (head) {
      current = { name: head[1].trim(), headerLine: li, items: [], itemLines: [] };
      recipes.push(current);
      continue;
    }
    if (!current) continue;
    const tok = s.split(/\s+/);
    if (tok.length === 2 && /^\d+$/.test(tok[1]) && tok[0]) {
      current.items.push({ name: tok[0], count: Number(tok[1]), line: li });
      current.itemLines.push(li);
    }
  }
  return { lines, eol, trailing, recipes };
}

function normalizeRecipe(recipe) {
  const name = checkToken(recipe.name, '配方产物', 32);
  const items = (recipe.items || []).map((it) => ({
    name: checkToken(it.name, '材料名称', 32),
    count: (() => {
      const v = Number(it.count);
      if (!isInt(v, 1, 1000000000)) throw new Error('材料数量需要正整数');
      return v;
    })()
  }));
  if (items.length === 0) throw new Error(`配方 ${name} 至少需要一种材料`);
  return { name, items };
}

function saveMakeItem(file, payload) {
  const parsed = parseMakeItem(file);
  const { lines, eol, trailing, recipes } = parsed;
  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, recipes.length, '配方'));

  const updates = new Map();
  for (const update of payload.updates || []) {
    const index = checkIndex(update.index, recipes.length, '配方');
    updates.set(index, normalizeRecipe(update));
  }
  const added = (payload.added || []).map(normalizeRecipe);

  const names = new Set();
  for (let i = 0; i < recipes.length; i++) {
    if (!deleted.has(i) && !updates.has(i)) names.add(recipes[i].name);
  }
  for (const up of updates.values()) {
    if (names.has(up.name)) throw new Error(`配方名称重复：${up.name}`);
    names.add(up.name);
  }
  for (const r of added) {
    if (names.has(r.name)) throw new Error(`配方名称重复：${r.name}`);
    names.add(r.name);
  }

  const skip = new Set();
  const replace = new Map();
  for (const [index, recipe] of updates) {
    replace.set(recipes[index].headerLine, recipe);
    for (const li of recipes[index].itemLines) skip.add(li);
  }
  for (const index of deleted) {
    skip.add(recipes[index].headerLine);
    for (const li of recipes[index].itemLines) skip.add(li);
  }

  const byHeader = new Map(recipes.map((r, i) => [r.headerLine, { recipe: r, index: i }]));
  const output = [];
  for (let li = 0; li < lines.length; li++) {
    const info = byHeader.get(li);
    if (info) {
      if (deleted.has(info.index) || skip.has(li)) continue;
      const recipe = replace.get(li);
      if (recipe) {
        output.push(`[${recipe.name}]`);
        for (const it of recipe.items) output.push(`${it.name}\t${it.count}`);
      } else {
        output.push(lines[li]);
      }
      continue;
    }
    if (skip.has(li)) continue;
    output.push(lines[li]);
  }

  for (const recipe of added) {
    if (output.length && output[output.length - 1].trim() !== '') output.push('');
    output.push(`[${recipe.name}]`);
    for (const it of recipe.items) output.push(`${it.name}\t${it.count}`);
  }

  const changedRows = updates.size;
  const addedRows = added.length;
  const deletedRows = deleted.size;
  if (changedRows === 0 && addedRows === 0 && deletedRows === 0) {
    return { ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, count: recipes.length, backup: null };
  }
  const backup = writeFileLines(file, output, eol, trailing || addedRows > 0);
  return {
    ok: true,
    changedRows,
    addedRows,
    deletedRows,
    count: recipes.length - deletedRows + addedRows,
    backup
  };
}

function parseAppellation(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const sections = [];
  const rows = [];
  let current = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s || s.startsWith(';')) continue;
    const head = s.match(/^\[(.+)\]$/);
    if (head) {
      current = { name: head[1].trim(), headerLine: li, rowCount: 0 };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const tok = s.split(/\t+/).filter(Boolean);
    if (tok.length >= 4 && tok.length <= 5 && /^\d+$/.test(tok[0]) && /^\d+$/.test(tok[1]) && /^\d+$/.test(tok[2]) && /^\d+$/.test(tok[3])) {
      rows.push({
        cls: current.name,
        level: Number(tok[0]),
        stage: Number(tok[1]),
        start: Number(tok[2]),
        end: Number(tok[3]),
        title: tok[4] || '',
        line: li
      });
      current.rowCount++;
    }
  }
  return { lines, eol, trailing, sections, rows };
}

function normalizeAppellation(values, base) {
  const out = { ...base };
  const num = (v, label, max) => {
    const n = Number(v);
    if (!isInt(n, 0, max)) throw new Error(`${label}需要非负整数`);
    return n;
  };
  if (values.level !== undefined) out.level = num(values.level, '级别', 10000);
  if (values.stage !== undefined) out.stage = num(values.stage, '阶段', 100000);
  if (values.start !== undefined) out.start = num(values.start, '开始经验', 1000000000000);
  if (values.end !== undefined) out.end = num(values.end, '终止经验', 1000000000000);
  if (values.title !== undefined) {
    const t = String(values.title == null ? '' : values.title).trim();
    if (/[\t\r\n]/.test(t)) throw new Error('称号不能包含制表符或换行');
    if (t.length > 40) throw new Error('称号太长');
    out.title = t;
  }
  return out;
}

function appellationLine(row) {
  return `${row.level}\t${row.stage}\t${row.start}\t${row.end}` + (row.title ? `\t${row.title}` : '');
}

function saveAppellation(file, payload) {
  const parsed = parseAppellation(file);
  const { lines, eol, trailing, sections, rows } = parsed;
  const sectionNames = new Set(sections.map((s) => s.name));
  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, rows.length, '称号'));

  const changes = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, rows.length, '称号');
    changes.set(index, normalizeAppellation(change.values || {}, rows[index]));
  }

  const added = (payload.added || []).map((item) => {
    const cls = String(item.cls || '').trim();
    if (!sectionNames.has(cls)) throw new Error(`职业段不存在：${cls}`);
    return { cls, ...normalizeAppellation(item.values || {}, { level: 0, stage: 0, start: 0, end: 0, title: '' }) };
  });

  const rowByLine = new Map(rows.map((r, i) => [r.line, { row: r, index: i }]));
  const headerByLine = new Map(sections.map((s) => [s.headerLine, s]));
  const output = [];
  const lastOutBySection = new Map();
  for (let li = 0; li < lines.length; li++) {
    const info = rowByLine.get(li);
    if (info) {
      if (deleted.has(info.index)) continue;
      const row = changes.get(info.index);
      output.push(row ? appellationLine(row) : lines[li]);
      lastOutBySection.set(row ? row.cls : info.row.cls, output.length - 1);
      continue;
    }
    output.push(lines[li]);
    const sec = headerByLine.get(li);
    if (sec && !lastOutBySection.has(sec.name)) lastOutBySection.set(sec.name, output.length - 1);
  }

  const insertAfter = new Map();
  const append = [];
  for (const row of added) {
    const pos = lastOutBySection.get(row.cls);
    const line = appellationLine(row);
    if (pos === undefined) append.push(line);
    else {
      if (!insertAfter.has(pos)) insertAfter.set(pos, []);
      insertAfter.get(pos).push(line);
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
  if (changedRows === 0 && addedRows === 0 && deletedRows === 0) {
    return { ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, count: rows.length, backup: null };
  }
  const backup = writeFileLines(file, final, eol, trailing || addedRows > 0);
  return {
    ok: true,
    changedRows,
    addedRows,
    deletedRows,
    count: rows.length - deletedRows + addedRows,
    backup
  };
}

module.exports = {
  parseMongen,
  saveMongen,
  parseMakeItem,
  saveMakeItem,
  parseAppellation,
  saveAppellation,
  readFileLines,
  writeFileLines,
  invalidateFileCache,
  clearFileCache,
  tokenize,
  patchTokens,
  checkToken,
  checkIndex,
  isInt
};

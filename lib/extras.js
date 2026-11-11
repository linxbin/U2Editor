'use strict';

const {
  readFileLines,
  writeFileLines,
  tokenize,
  patchTokens,
  checkToken,
  checkIndex,
  isInt
} = require('./configs');

function checkText(value, label, maxLen, allowEmpty) {
  const s = String(value == null ? '' : value).trim();
  if (!s && allowEmpty) return '';
  if (!s) throw new Error(`${label}不能为空`);
  if (/[\t\r\n=]/.test(s)) throw new Error(`${label}不能包含制表符、换行或等号`);
  if (s.length > maxLen) throw new Error(`${label}太长`);
  return s;
}

function checkInt(value, label, min, max) {
  const n = Number(value);
  if (!isInt(n, min, max)) throw new Error(`${label}需要 ${min} 到 ${max} 的整数`);
  return n;
}

function lineIndent(line) {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

function patchFirstToken(line, value) {
  const m = /^[ \t]*\S+/.exec(line);
  return m ? m[0].slice(0, m[0].length - m[0].trimStart().length) + value + line.slice(m[0].length) : value;
}

/* ---------------- goodsconfig ---------------- */

function parseGoodsConfig(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const entries = [];
  const special = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s || s.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) {
      special.push({ line: li, text: line });
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (!key) {
      special.push({ line: li, text: line });
      continue;
    }
    const dash = key.lastIndexOf('-');
    const id = (dash > 0 ? key.slice(0, dash) : key).trim();
    const version = dash > 0 ? key.slice(dash + 1).trim() : '';
    if (!id) {
      special.push({ line: li, text: line });
      continue;
    }
    entries.push({
      id,
      version,
      name: line.slice(eq + 1).trim(),
      line: li
    });
  }
  return { lines, eol, trailing, entries, special };
}

function goodsKey(entry) {
  return entry.version ? `${entry.id}-${entry.version}` : entry.id;
}

function normalizeGoods(values, base) {
  const out = { ...base };
  if (values.id !== undefined) out.id = checkText(values.id, '商品ID', 64);
  if (values.version !== undefined) out.version = checkText(values.version, '版本', 32, true);
  if (values.name !== undefined) out.name = checkText(values.name, '显示名称', 80);
  return out;
}

function sameGoods(a, b) {
  return a.id === b.id && a.version === b.version && a.name === b.name;
}

function patchGoodsLine(line, entry) {
  const eq = line.indexOf('=');
  const before = line.slice(0, eq);
  const after = line.slice(eq + 1);
  const indent = lineIndent(before);
  const trail = /\s*$/.exec(after)[0];
  return `${indent}${goodsKey(entry)}=${entry.name}${trail}`;
}

function goodsLine(entry) {
  return `${goodsKey(entry)}=${entry.name}`;
}

function saveGoodsConfig(file, payload) {
  const parsed = parseGoodsConfig(file);
  const { lines, eol, trailing, entries } = parsed;

  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, entries.length, '商品'));

  const changeValues = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, entries.length, '商品');
    changeValues.set(index, change.values || {});
  }

  const changes = new Map();
  const finalEntries = [];
  for (let i = 0; i < entries.length; i++) {
    if (deleted.has(i)) continue;
    let entry = entries[i];
    if (changeValues.has(i)) {
      const merged = normalizeGoods(changeValues.get(i), entries[i]);
      if (!sameGoods(merged, entries[i])) changes.set(i, merged);
      entry = merged;
    }
    finalEntries.push(entry);
  }

  const added = (payload.added || []).map((item) => normalizeGoods(item, { id: '', version: '', name: '' }));
  finalEntries.push(...added);

  const seen = new Set();
  for (const entry of finalEntries) {
    const key = goodsKey(entry);
    if (seen.has(key)) throw new Error(`商品键重复：${key}`);
    seen.add(key);
  }

  const changesByLine = new Map([...changes].map(([i, e]) => [entries[i].line, e]));
  const entryLines = new Set(entries.map((e) => e.line));
  const entryByLine = new Map(entries.map((e, i) => [e.line, i]));
  const output = [];
  let lastOutEntry = -1;
  for (let li = 0; li < lines.length; li++) {
    if (entryLines.has(li)) {
      const index = entryByLine.get(li);
      if (deleted.has(index)) continue;
      const entry = changesByLine.get(li);
      output.push(entry ? patchGoodsLine(lines[li], entry) : lines[li]);
      lastOutEntry = output.length - 1;
      continue;
    }
    output.push(lines[li]);
  }

  if (added.length) {
    const inserted = added.map(goodsLine);
    if (lastOutEntry < 0) output.push(...inserted);
    else output.splice(lastOutEntry + 1, 0, ...inserted);
  }

  const changedRows = changes.size;
  const addedRows = added.length;
  const deletedRows = deleted.size;
  if (changedRows === 0 && addedRows === 0 && deletedRows === 0) {
    return { ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, count: entries.length, backup: null };
  }
  const backup = writeFileLines(file, output, eol, trailing || addedRows > 0);
  return {
    ok: true,
    changedRows,
    addedRows,
    deletedRows,
    count: entries.length - deletedRows + addedRows,
    backup
  };
}

/* ---------------- MonsterChain.ini ---------------- */

const CHAIN_RE = /^-?\d+$/;

function parseMonsterChain(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const groups = [];
  const entries = [];
  const special = [];
  let current = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s || s.startsWith(';')) continue;
    const head = s.match(/^\[(.+)\]$/);
    if (head) {
      current = { name: head[1].trim(), headerLine: li };
      groups.push(current);
      continue;
    }
    if (!current) {
      special.push({ line: li, text: line });
      continue;
    }
    const tok = tokenize(line).map((m) => m[0]);
    if (
      tok.length >= 5 &&
      tok[0] &&
      CHAIN_RE.test(tok[1]) &&
      CHAIN_RE.test(tok[2]) &&
      /^\d+$/.test(tok[3]) &&
      /^\d+$/.test(tok[4])
    ) {
      entries.push({
        group: current.name,
        monster: tok[0],
        x: Number(tok[1]),
        y: Number(tok[2]),
        range: Number(tok[3]),
        count: Number(tok[4]),
        extra: tok.slice(5),
        line: li
      });
    } else {
      special.push({ line: li, text: line });
    }
  }
  const counts = new Map();
  for (const e of entries) counts.set(e.group, (counts.get(e.group) || 0) + 1);
  return {
    lines,
    eol,
    trailing,
    groups: groups.map((g) => ({ name: g.name, count: counts.get(g.name) || 0 })),
    entries,
    special
  };
}

function normalizeChain(values, base) {
  const out = { ...base };
  if (values.group !== undefined) out.group = checkToken(values.group, '分组', 32);
  if (values.monster !== undefined) out.monster = checkToken(values.monster, '怪物名称', 32);
  if (values.x !== undefined) out.x = checkInt(values.x, 'X 偏移', -100000, 100000);
  if (values.y !== undefined) out.y = checkInt(values.y, 'Y 偏移', -100000, 100000);
  if (values.range !== undefined) out.range = checkInt(values.range, '范围', 0, 100000);
  if (values.count !== undefined) out.count = checkInt(values.count, '数量', 0, 1000000);
  return out;
}

function sameChain(a, b) {
  return a.group === b.group && a.monster === b.monster &&
    a.x === b.x && a.y === b.y && a.range === b.range && a.count === b.count;
}

function chainLine(entry) {
  return `${entry.monster}\t${entry.x}\t${entry.y}\t${entry.range}\t${entry.count}`;
}

function prepareMonsterChain(file, payload) {
  const parsed = parseMonsterChain(file);
  const { lines, eol, trailing, entries } = parsed;
  const groupNames = new Set(parsed.groups.map((g) => g.name));

  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, entries.length, '召唤'));

  const changes = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, entries.length, '召唤');
    const merged = normalizeChain(change.values || {}, entries[index]);
    if (merged.group !== entries[index].group) {
      throw new Error('已有召唤记录不能移动到其他分组');
    }
    if (!sameChain(merged, entries[index])) changes.set(index, merged);
  }

  const added = (payload.added || []).map((item) => normalizeChain(item, {
    group: '', monster: '', x: 0, y: 0, range: 0, count: 1
  }));

  const entryByLine = new Map(entries.map((e, i) => [e.line, i]));
  const output = [];
  const lastOutByGroup = new Map();
  for (let li = 0; li < lines.length; li++) {
    const head = lines[li].trim().match(/^\[(.+)\]$/);
    if (head) {
      output.push(lines[li]);
      const name = head[1].trim();
      if (!lastOutByGroup.has(name)) lastOutByGroup.set(name, output.length - 1);
      continue;
    }
    const index = entryByLine.get(li);
    if (index === undefined) {
      output.push(lines[li]);
      continue;
    }
    if (deleted.has(index)) continue;
    const entry = changes.get(index);
    if (entry) {
      const patch = new Map();
      if (entry.monster !== entries[index].monster) patch.set(0, entry.monster);
      if (entry.x !== entries[index].x) patch.set(1, entry.x);
      if (entry.y !== entries[index].y) patch.set(2, entry.y);
      if (entry.range !== entries[index].range) patch.set(3, entry.range);
      if (entry.count !== entries[index].count) patch.set(4, entry.count);
      output.push(patch.size ? patchTokens(lines[li], patch) : lines[li]);
    } else {
      output.push(lines[li]);
    }
    lastOutByGroup.set(entries[index].group, output.length - 1);
  }

  const insertAfter = new Map();
  const newGroups = new Map();
  for (const entry of added) {
    if (!groupNames.has(entry.group)) {
      if (!newGroups.has(entry.group)) newGroups.set(entry.group, []);
      newGroups.get(entry.group).push(entry);
      continue;
    }
    const pos = lastOutByGroup.get(entry.group);
    if (pos === undefined) throw new Error(`分组不存在：${entry.group}`);
    if (!insertAfter.has(pos)) insertAfter.set(pos, []);
    insertAfter.get(pos).push(entry);
  }

  const final = [];
  for (let i = 0; i < output.length; i++) {
    final.push(output[i]);
    if (insertAfter.has(i)) {
      for (const entry of insertAfter.get(i)) final.push(chainLine(entry));
    }
  }
  for (const [name, items] of newGroups) {
    if (final.length && final[final.length - 1].trim() !== '') final.push('');
    final.push(`[${name}]`);
    for (const entry of items) final.push(chainLine(entry));
  }

  const changedRows = changes.size;
  const addedRows = added.length;
  const deletedRows = deleted.size;
  if (changedRows === 0 && addedRows === 0 && deletedRows === 0) {
    return {
      noop: true,
      result: { ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, count: entries.length, backup: null }
    };
  }
  return {
    noop: false,
    lines: final,
    eol,
    trailing: trailing || addedRows > 0,
    result: {
      ok: true,
      changedRows,
      addedRows,
      deletedRows,
      count: entries.length - deletedRows + addedRows
    }
  };
}

/* ---------------- MonsterChild.ini ---------------- */

function parseMonsterChild(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const groups = [];
  const rows = [];
  const special = [];
  let current = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s || s.startsWith(';')) continue;
    const head = s.match(/^\[(.+)\]$/);
    if (head) {
      current = { name: head[1].trim(), headerLine: li };
      groups.push(current);
      continue;
    }
    if (!current) {
      special.push({ line: li, text: line });
      continue;
    }
    const tok = tokenize(line).map((m) => m[0]);
    if (!tok.length) {
      special.push({ line: li, text: line });
      continue;
    }
    rows.push({
      parent: current.name,
      child: tok[0],
      extra: tok.slice(1),
      line: li
    });
  }
  const counts = new Map();
  for (const r of rows) counts.set(r.parent, (counts.get(r.parent) || 0) + 1);
  return {
    lines,
    eol,
    trailing,
    groups: groups.map((g) => ({ name: g.name, count: counts.get(g.name) || 0 })),
    rows,
    special
  };
}

function normalizeChild(values, base) {
  const out = { ...base };
  if (values.parent !== undefined) out.parent = checkToken(values.parent, '父怪', 32);
  if (values.child !== undefined) out.child = checkToken(values.child, '子怪', 32);
  return out;
}

function prepareMonsterChild(file, payload) {
  const parsed = parseMonsterChild(file);
  const { lines, eol, trailing, rows } = parsed;
  const groupNames = new Set(parsed.groups.map((g) => g.name));

  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, rows.length, '子怪'));

  const changeValues = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, rows.length, '子怪');
    changeValues.set(index, change.values || {});
  }

  const changes = new Map();
  const finalRows = [];
  for (let i = 0; i < rows.length; i++) {
    if (deleted.has(i)) continue;
    let row = rows[i];
    if (changeValues.has(i)) {
      const merged = normalizeChild(changeValues.get(i), rows[i]);
      if (merged.parent !== rows[i].parent) throw new Error('已有子怪记录不能移动到其他父怪');
      if (merged.child !== rows[i].child) changes.set(i, merged);
      row = merged;
    }
    finalRows.push(row);
  }

  const added = (payload.added || []).map((item) => normalizeChild(item, { parent: '', child: '' }));
  finalRows.push(...added);

  const seen = new Set();
  for (const row of finalRows) {
    const key = `${row.parent}\u0000${row.child}`;
    if (seen.has(key)) throw new Error(`子怪重复：${row.parent} → ${row.child}`);
    seen.add(key);
  }

  const rowByLine = new Map(rows.map((r, i) => [r.line, i]));
  const output = [];
  const lastOutByGroup = new Map();
  for (let li = 0; li < lines.length; li++) {
    const head = lines[li].trim().match(/^\[(.+)\]$/);
    if (head) {
      output.push(lines[li]);
      const name = head[1].trim();
      if (!lastOutByGroup.has(name)) lastOutByGroup.set(name, output.length - 1);
      continue;
    }
    const index = rowByLine.get(li);
    if (index === undefined) {
      output.push(lines[li]);
      continue;
    }
    if (deleted.has(index)) continue;
    const row = changes.get(index);
    output.push(row ? patchFirstToken(lines[li], row.child) : lines[li]);
    lastOutByGroup.set(rows[index].parent, output.length - 1);
  }

  const insertAfter = new Map();
  const newGroups = new Map();
  for (const row of added) {
    if (!groupNames.has(row.parent)) {
      if (!newGroups.has(row.parent)) newGroups.set(row.parent, []);
      newGroups.get(row.parent).push(row.child);
      continue;
    }
    const pos = lastOutByGroup.get(row.parent);
    if (pos === undefined) throw new Error(`父怪分组不存在：${row.parent}`);
    if (!insertAfter.has(pos)) insertAfter.set(pos, []);
    insertAfter.get(pos).push(row.child);
  }

  const final = [];
  for (let i = 0; i < output.length; i++) {
    final.push(output[i]);
    if (insertAfter.has(i)) final.push(...insertAfter.get(i));
  }
  for (const [name, children] of newGroups) {
    if (final.length && final[final.length - 1].trim() !== '') final.push('');
    final.push(`[${name}]`);
    final.push(...children);
  }

  const changedRows = changes.size;
  const addedRows = added.length;
  const deletedRows = deleted.size;
  if (changedRows === 0 && addedRows === 0 && deletedRows === 0) {
    return {
      noop: true,
      result: { ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, count: rows.length, backup: null }
    };
  }
  return {
    noop: false,
    lines: final,
    eol,
    trailing: trailing || addedRows > 0,
    result: {
      ok: true,
      changedRows,
      addedRows,
      deletedRows,
      count: rows.length - deletedRows + addedRows
    }
  };
}

function commitPrepared(file, prepared) {
  if (prepared.noop) return prepared.result;
  const backup = writeFileLines(file, prepared.lines, prepared.eol, prepared.trailing);
  return { ...prepared.result, backup };
}

function saveMonsterChain(file, payload) {
  return commitPrepared(file, prepareMonsterChain(file, payload));
}

function saveMonsterChild(file, payload) {
  return commitPrepared(file, prepareMonsterChild(file, payload));
}

function saveSummons(chainFile, childFile, payload) {
  const chain = prepareMonsterChain(chainFile, payload.chain || {});
  const child = prepareMonsterChild(childFile, payload.child || {});
  const chainResult = commitPrepared(chainFile, chain);
  const childResult = commitPrepared(childFile, child);
  return { ok: true, chain: chainResult, child: childResult };
}

module.exports = {
  parseGoodsConfig,
  saveGoodsConfig,
  parseMonsterChain,
  saveMonsterChain,
  parseMonsterChild,
  saveMonsterChild,
  saveSummons
};

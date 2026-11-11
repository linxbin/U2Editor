'use strict';

const path = require('path');
const { readFileLines, writeFileLines, checkIndex } = require('./configs');

const NOTICE_FILES = {
  line: 'LineNotice.txt',
  float: 'FloatAD.txt',
  bulletin: 'Bullitin.ini',
  bless: 'bless.txt'
};
const QUIZ_FILE = 'qlib.TXT';
const BOX_FILE = '宝盒设置.ini';
const STARTER_FILE = 'newPlayerItem.ini';

function readText(file) {
  const { lines, eol, trailing } = readFileLines(file);
  return { lines, eol, trailing, text: lines.join('\n') };
}

function parseNotices(dir) {
  const files = {};
  for (const [key, name] of Object.entries(NOTICE_FILES)) {
    try {
      const t = readText(path.join(dir, name));
      files[key] = { name, text: t.text, lines: t.lines.length, bytes: Buffer.byteLength(t.text, 'utf8') };
    } catch (e) {
      files[key] = { name, error: e.message };
    }
  }
  return { dir, files };
}

function normalizeNoticeText(text, name) {
  if (typeof text !== 'string') throw new Error(name + ' 内容格式错误');
  if (text.length > 200000) throw new Error(name + ' 内容过长');
  return text.replace(/\r\n?/g, '\n');
}

function saveNotices(dir, payload) {
  const prepared = [];
  for (const [key, name] of Object.entries(NOTICE_FILES)) {
    const item = payload && payload.files && payload.files[key];
    if (!item || typeof item.text !== 'string') continue;
    const file = path.join(dir, name);
    const current = readText(file);
    const text = normalizeNoticeText(item.text, name);
    if (text === current.text) continue;
    const lines = text.split('\n');
    let trailing = false;
    if (lines.length && lines[lines.length - 1] === '') {
      trailing = true;
      lines.pop();
    }
    prepared.push({ file, name, lines, eol: current.eol, trailing });
  }
  if (!prepared.length) return { ok: true, changedFiles: 0, backups: [] };
  const backups = [];
  for (const item of prepared) {
    const backup = writeFileLines(item.file, item.lines, item.eol, item.trailing);
    backups.push({ file: item.name, backup });
  }
  return { ok: true, changedFiles: prepared.length, backups };
}

function parseQuiz(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const rows = [];
  const special = [];
  for (let li = 0; li < lines.length; li++) {
    const s = lines[li].trim();
    if (!s) continue;
    const parts = lines[li].split('/').map((x) => x.trim());
    if (parts.length < 3 || parts.some((x) => !x)) {
      special.push({ line: li, text: lines[li] });
      continue;
    }
    rows.push({
      index: rows.length,
      line: li,
      question: parts[0],
      options: parts.slice(1),
      raw: lines[li]
    });
  }
  return { file, lines, eol, trailing, rows, special };
}

function normalizeQuiz(values, base) {
  const question = String(values.question !== undefined ? values.question : base.question).trim();
  const options = (values.options !== undefined ? values.options : base.options)
    .map((x) => String(x).trim());
  if (!question) throw new Error('题目不能为空');
  if (options.length < 2) throw new Error('至少需要两个选项');
  const all = [question, ...options];
  for (const part of all) {
    if (!part) throw new Error('题目和选项都不能为空');
    if (part.includes('/')) throw new Error('题目和选项不能包含斜杠 /');
    if (/[\r\n]/.test(part)) throw new Error('题目和选项不能包含换行');
    if (part.length > 200) throw new Error('题目或选项太长');
  }
  return { question, options };
}

function saveQuiz(file, payload) {
  const parsed = parseQuiz(file);
  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, parsed.rows.length, '答题'));
  const changes = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, parsed.rows.length, '答题');
    if (deleted.has(index)) continue;
    const base = parsed.rows[index];
    const merged = normalizeQuiz(change.values || {}, base);
    if (merged.question !== base.question || merged.options.join('/') !== base.options.join('/')) {
      changes.set(index, merged);
    }
  }
  const added = (payload.added || []).map((row) =>
    normalizeQuiz(row, { question: '', options: ['', '', ''] })
  );

  const lineInfo = new Map(parsed.rows.map((r, i) => [r.line, { row: r, index: i }]));
  const output = [];
  let lastOut = -1;
  for (let li = 0; li < parsed.lines.length; li++) {
    const info = lineInfo.get(li);
    if (!info) {
      output.push(parsed.lines[li]);
      continue;
    }
    if (deleted.has(info.index)) continue;
    const merged = changes.get(info.index);
    output.push(merged ? [merged.question, ...merged.options].join('/') : parsed.lines[li]);
    lastOut = output.length - 1;
  }
  if (added.length) {
    const lines = added.map((q) => [q.question, ...q.options].join('/'));
    const pos = lastOut >= 0 ? lastOut + 1 : output.length;
    output.splice(pos, 0, '\t'.repeat(0) + lines[0]);
    for (let i = 1; i < lines.length; i++) output.splice(pos + i, 0, lines[i]);
  }

  const changedRows = changes.size;
  const addedRows = added.length;
  const deletedRows = deleted.size;
  if (!changedRows && !addedRows && !deletedRows) {
    return {
      ok: true, changedRows: 0, addedRows: 0, deletedRows: 0,
      count: parsed.rows.length, backup: null
    };
  }
  const backup = writeFileLines(file, output, parsed.eol, parsed.trailing || addedRows > 0);
  return {
    ok: true, changedRows, addedRows, deletedRows,
    count: parsed.rows.length - deletedRows + addedRows, backup
  };
}

function parseSectionList(file, label) {
  const { lines, eol, trailing } = readFileLines(file);
  const groups = [];
  const rows = [];
  const special = [];
  let current = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith(';') || s.startsWith('#')) continue;
    const h = /^\[([^\]]+)\]$/.exec(s);
    if (h) {
      current = {
        index: groups.length,
        line: li,
        name: h[1].trim(),
        items: 0
      };
      groups.push(current);
      continue;
    }
    if (!current) {
      special.push({ line: li, text: line });
      continue;
    }
    if (s.includes('[') || s.includes(']')) {
      special.push({ line: li, text: line });
      continue;
    }
    rows.push({
      index: rows.length,
      line: li,
      groupIndex: current.index,
      group: current.name,
      item: s
    });
    current.items++;
  }
  return { file, eol, trailing, lines, groups, rows, special, label };
}

function normalizeListItem(value, field, maxLen) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw new Error(field + '不能为空');
  if (/[\r\n]/.test(s)) throw new Error(field + '不能包含换行');
  if (/[\[\]]/.test(s)) throw new Error(field + '不能包含方括号');
  if (s.length > maxLen) throw new Error(field + '太长');
  return s;
}

function normalizeGroupName(value) {
  return normalizeListItem(value, '分组名称', 64);
}

function saveSectionList(file, payload, label, allowNewGroup) {
  const parsed = parseSectionList(file, label);
  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, parsed.rows.length, label));
  const changes = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, parsed.rows.length, label);
    if (deleted.has(index)) continue;
    const base = parsed.rows[index];
    const item = normalizeListItem(change.values && change.values.item !== undefined
      ? change.values.item : change.item, label + '物品', 128);
    if (item !== base.item) changes.set(index, { item });
  }

  const groupChanges = new Map();
  for (const change of payload.groupChanges || []) {
    const index = checkIndex(change.index, parsed.groups.length, '分组');
    const name = normalizeGroupName(change.name);
    if (name !== parsed.groups[index].name) groupChanges.set(index, name);
  }
  if (groupChanges.size) {
    const names = new Set();
    for (let i = 0; i < parsed.groups.length; i++) {
      const name = groupChanges.get(i) || parsed.groups[i].name;
      if (names.has(name)) throw new Error('分组名称重复：' + name);
      names.add(name);
    }
  }

  const effectiveGroups = parsed.groups.map((g, i) => ({
    index: i,
    name: groupChanges.get(i) || g.name
  }));
  const added = [];
  for (const row of payload.added || []) {
    const group = normalizeGroupName(row.group);
    const item = normalizeListItem(row.item, label + '物品', 128);
    const found = effectiveGroups.find((g) => g.name === group);
    if (!found && !allowNewGroup) throw new Error('分组不存在：' + group);
    added.push({ group, item, groupIndex: found ? found.index : -1 });
  }

  const lineInfo = new Map();
  for (const row of parsed.rows) lineInfo.set(row.line, { kind: 'row', row });
  for (const group of parsed.groups) lineInfo.set(group.line, { kind: 'group', group });

  const output = [];
  const lastRowOut = new Map();
  const groupHeaderOut = new Map();
  for (let li = 0; li < parsed.lines.length; li++) {
    const info = lineInfo.get(li);
    if (!info) {
      output.push(parsed.lines[li]);
      continue;
    }
    if (info.kind === 'group') {
      let line = parsed.lines[li];
      if (groupChanges.has(info.group.index)) {
        line = line.replace(/\[[^\]]+\]/, '[' + groupChanges.get(info.group.index) + ']');
      }
      output.push(line);
      groupHeaderOut.set(info.group.index, output.length - 1);
      continue;
    }
    const row = info.row;
    if (deleted.has(row.index)) continue;
    const merged = changes.get(row.index);
    output.push(merged ? merged.item : parsed.lines[li]);
    lastRowOut.set(row.groupIndex, output.length - 1);
  }

  const insertAfter = new Map();
  const newGroups = new Map();
  for (const row of added) {
    let groupIndex = row.groupIndex;
    if (groupIndex < 0) {
      if (!newGroups.has(row.group)) newGroups.set(row.group, []);
      newGroups.get(row.group).push(row.item);
      continue;
    }
    const pos = lastRowOut.get(groupIndex);
    if (pos !== undefined) {
      if (!insertAfter.has(pos)) insertAfter.set(pos, []);
      insertAfter.get(pos).push(row.item);
    } else {
      const hp = groupHeaderOut.get(groupIndex);
      if (hp === undefined) throw new Error('分组不存在：' + row.group);
      if (!insertAfter.has(hp)) insertAfter.set(hp, []);
      insertAfter.get(hp).push(row.item);
    }
  }

  const final = [];
  for (let i = 0; i < output.length; i++) {
    final.push(output[i]);
    if (insertAfter.has(i)) final.push(...insertAfter.get(i));
  }
  for (const [name, items] of newGroups) {
    final.push('[' + name + ']');
    final.push(...items);
  }

  const changedRows = changes.size;
  const addedRows = added.length;
  const deletedRows = deleted.size;
  const groupChanged = groupChanges.size;
  if (!changedRows && !addedRows && !deletedRows && !groupChanged) {
    return {
      ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, groupChanged: 0,
      count: parsed.rows.length, groupCount: parsed.groups.length, backup: null
    };
  }
  const backup = writeFileLines(file, final, parsed.eol, parsed.trailing || addedRows > 0);
  return {
    ok: true, changedRows, addedRows, deletedRows, groupChanged,
    count: parsed.rows.length - deletedRows + addedRows,
    groupCount: parsed.groups.length + newGroups.size,
    backup
  };
}

function parseOps(dir) {
  const quiz = parseQuiz(path.join(dir, QUIZ_FILE));
  const boxes = parseSectionList(path.join(dir, BOX_FILE), '宝盒物品');
  const starter = parseSectionList(path.join(dir, STARTER_FILE), '新手礼包');
  return {
    notices: parseNotices(dir),
    quiz: {
      file: QUIZ_FILE,
      rows: quiz.rows.map((r) => ({ index: r.index, question: r.question, options: r.options })),
      special: quiz.special.map((s) => s.text)
    },
    boxes: {
      file: BOX_FILE,
      groups: boxes.groups.map((g) => ({ index: g.index, name: g.name, items: g.items })),
      rows: boxes.rows.map((r) => ({ index: r.index, groupIndex: r.groupIndex, group: r.group, item: r.item })),
      special: boxes.special.map((s) => s.text)
    },
    starter: {
      file: STARTER_FILE,
      groups: starter.groups.map((g) => ({ index: g.index, name: g.name, items: g.items })),
      rows: starter.rows.map((r) => ({ index: r.index, groupIndex: r.groupIndex, group: r.group, item: r.item })),
      special: starter.special.map((s) => s.text)
    }
  };
}

function saveBoxes(dir, payload) {
  return saveSectionList(path.join(dir, BOX_FILE), payload, '宝盒物品', true);
}

function saveStarter(dir, payload) {
  return saveSectionList(path.join(dir, STARTER_FILE), payload, '新手礼包', true);
}

module.exports = {
  NOTICE_FILES,
  QUIZ_FILE,
  BOX_FILE,
  STARTER_FILE,
  parseNotices,
  saveNotices,
  parseQuiz,
  saveQuiz,
  parseSectionList,
  saveSectionList,
  parseOps,
  saveBoxes,
  saveStarter
};

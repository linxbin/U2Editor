'use strict';

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const dbe = require('./dbe');

const LEVEL_CLASS = { '-1': '不限', '0': '战士', '1': '法师', '2': '道士' };
const LEVEL_GENDER = { '-1': '不限', '0': '男', '1': '女' };
const STARTER_SLOTS = [
  { name: '男战士', className: '战士', gender: '男' },
  { name: '女战士', className: '战士', gender: '女' },
  { name: '男法师', className: '法师', gender: '男' },
  { name: '女法师', className: '法师', gender: '女' },
  { name: '男道士', className: '道士', gender: '男' },
  { name: '女道士', className: '道士', gender: '女' }
];

const SOURCES = [
  {
    key: 'starter', file: 'newPlayerItem.ini', label: '新手礼包', kind: 'starter', group: '新手与礼包',
    desc: '按性别 / 职业分组的出生礼包，每段列出一件或多件出生物品。',
    editor: { view: 'ops', tab: 'starter' }
  },
  {
    key: 'diamond', file: 'DiamondAccount.txt', label: '钻石礼包', kind: 'gifts', group: '账号礼包',
    desc: '钻石账号按等级档位发放的奖励，列：物品 数量 几率 职业 性别。',
    editor: { view: 'extra', key: 'diamond' }
  },
  {
    key: 'golden1', file: 'goldenaccount1.txt', label: '黄金礼包 1', kind: 'gifts', group: '账号礼包',
    desc: '黄金账号礼包第一套等级奖励，格式与钻石礼包一致。',
    editor: { view: 'extra', key: 'golden1' }
  },
  {
    key: 'golden2', file: 'goldenaccount2.txt', label: '黄金礼包 2', kind: 'gifts', group: '账号礼包',
    desc: '黄金账号礼包第二套等级奖励，数量更高，部分等级档位暂未配置。',
    editor: { view: 'extra', key: 'golden2' }
  },
  {
    key: 'yb', dir: '元宝充值', label: '元宝充值队列', kind: 'queue', group: '充值队列',
    desc: 'yb*.txt 是充值回调队列文件，存在即代表待处理订单；全部为空说明尚未产生充值订单。',
    editor: { view: 'activity', id: 'recharge' }
  }
];

const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function dirSig(dir) {
  try {
    const names = fs.readdirSync(dir).filter((n) => /\.txt$/i.test(n)).sort();
    return names.map((n) => n + ':' + statSig(path.join(dir, n))).join(',');
  } catch (e) {
    return 'missing';
  }
}

function normName(value) {
  return String(value == null ? '' : value)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, '');
}

function isInt(value) {
  return /^-?\d+$/.test(String(value == null ? '' : value).trim());
}

function reader(envirDir) {
  return function readText(file) {
    const full = path.join(envirDir, file);
    const out = { exists: false, size: 0, mtime: 0, text: '', lines: [], encodingOk: true, error: '' };
    let buf = null;
    try {
      const st = fs.statSync(full);
      out.exists = true;
      out.size = st.size;
      out.mtime = st.mtimeMs;
      buf = fs.readFileSync(full);
    } catch (e) {
      out.error = e.message;
      return out;
    }
    try {
      out.text = gbk.decodeText(buf);
      out.encodingOk = gbk.encode(out.text).equals(buf);
    } catch (e) {
      out.error = e.message;
      return out;
    }
    out.lines = out.text.split(/\r?\n/);
    if (out.lines.length && out.lines[out.lines.length - 1] === '') out.lines.pop();
    return out;
  };
}

function splitSections(lines) {
  const head = [];
  const sections = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*\[([^\]]*)\]\s*$/.exec(line);
    if (m) {
      if (cur) {
        cur.endLine = i;
        sections.push(cur);
      }
      cur = { name: m[1].trim(), headerLine: i + 1, endLine: i + 1, body: [] };
      continue;
    }
    if (cur) cur.body.push({ line: i + 1, text: line });
    else head.push({ line: i + 1, text: line });
  }
  if (cur) {
    cur.endLine = lines.length;
    sections.push(cur);
  }
  return { head, sections };
}

function create(options) {
  const envirDir = path.resolve(options.envirDir);
  const itemFile = path.resolve(options.itemFile);
  const readText = reader(envirDir);
  let cache = null;

  function signature() {
    const parts = [];
    for (const s of SOURCES) {
      if (s.dir) parts.push(s.key + '|' + dirSig(path.join(envirDir, s.dir)));
      else parts.push(s.key + '|' + statSig(path.join(envirDir, s.file)));
    }
    parts.push('items|' + statSig(itemFile));
    return parts.join(';');
  }

  function build() {
    const generatedAt = new Date().toISOString();
    const issues = [];
    const entries = [];
    const sources = [];
    let items = null;
    let byName = new Map();
    let byNorm = new Map();
    let itemError = '';

    try {
      const db = dbe.loadDb(itemFile);
      items = new Set();
      db.rows.forEach((row, index) => {
        const name = String(row.Name == null ? '' : row.Name).trim();
        if (!name) return;
        items.add(name);
        if (!byName.has(name)) byName.set(name, index);
        if (!byNorm.has(normName(name))) byNorm.set(normName(name), { index, name });
      });
    } catch (e) {
      itemError = e.message;
      issues.push({
        code: 'starter_items_unreadable', severity: 'error',
        message: `stditems.db 读取失败：${e.message}`,
        source: '', file: 'stditems.db', index: null, line: null,
        action: { view: 'source', source: 'starter' }
      });
    }

    const lookupItem = (name) => {
      const exact = String(name == null ? '' : name).trim();
      if (byName.has(exact)) return { exists: true, index: byName.get(exact), name: exact };
      const norm = byNorm.get(normName(exact));
      if (norm) return { exists: true, index: norm.index, name: norm.name, normalized: true };
      return { exists: false, index: null, name: exact };
    };

    const addIssue = (code, severity, message, extra) => {
      const e = extra || {};
      issues.push({
        code, severity, message,
        source: e.source || '', file: e.file || '', index: e.index == null ? null : e.index,
        line: e.line == null ? null : e.line,
        action: e.action || (e.source ? { view: 'source', source: e.source } : null)
      });
    };

    const addEntry = (entry) => {
      entry.index = entries.length;
      entries.push(entry);
      return entry;
    };

    const sourceIssues = (key) => issues.filter((i) => i.source === key).length;

    const srcInfo = (def) => ({
      key: def.key, file: def.file || '', dir: def.dir || '',
      label: def.label, kind: def.kind, group: def.group, desc: def.desc, editor: def.editor,
      exists: false, size: 0, mtime: 0, encodingOk: true,
      entries: 0, rewards: 0, issues: 0
    });

    // 新手礼包
    const starterDef = SOURCE_BY_KEY.get('starter');
    {
      const info = srcInfo(starterDef);
      const src = readText(starterDef.file);
      info.exists = src.exists;
      info.size = src.size;
      info.mtime = src.mtime;
      if (!src.exists || src.error) {
        addIssue('starter_file_missing', 'error', `${starterDef.file} 不存在或无法读取${src.error ? '：' + src.error : ''}`, { source: 'starter', file: starterDef.file });
      } else if (!src.encodingOk) {
        info.encodingOk = false;
        addIssue('starter_file_encoding', 'warn', `${starterDef.file} 含无法按 GBK 还原的字节`, { source: 'starter', file: starterDef.file });
      }
      if (src.exists && !src.error) {
        const parsed = splitSections(src.lines);
        const seen = new Set();
        for (const section of parsed.sections) {
          const slot = STARTER_SLOTS.find((s) => s.name === section.name);
          const itemLines = section.body
            .filter((b) => b.text.trim() && !/^\s*[;#]/.test(b.text))
            .map((b) => ({ line: b.line, name: b.text.trim() }));
          const itemsOut = itemLines.map((row) => {
            const hit = lookupItem(row.name);
            return { name: row.name, line: row.line, exists: hit.exists, itemIndex: hit.index };
          });
          const flags = [];
          if (!itemsOut.length) flags.push('empty');
          if (itemsOut.some((it) => !it.exists)) flags.push('missing-item');
          const entry = addEntry({
            source: 'starter', kind: 'starter',
            key: 'starter:' + section.name, label: section.name,
            line: section.headerLine, endLine: section.endLine,
            slot: slot ? { className: slot.className, gender: slot.gender } : null,
            fields: slot ? [slot.gender, slot.className] : [section.name, ''],
            items: itemsOut, preview: itemsOut.map((it) => it.name).join('、'),
            flags
          });
          info.entries++;
          info.rewards += itemsOut.length;
          if (seen.has(section.name)) {
            entry.flags.push('duplicate');
            addIssue('starter_section_duplicate', 'warn', `新手礼包分组「${section.name}」重复定义`, { source: 'starter', file: starterDef.file, index: entry.index, line: section.headerLine, action: { view: 'entry', source: 'starter', index: entry.index } });
          }
          seen.add(section.name);
          if (!slot) {
            entry.flags.push('invalid');
            addIssue('starter_section_unknown', 'info', `新手礼包出现未知分组「${section.name}」，引擎可能不会读取`, { source: 'starter', file: starterDef.file, index: entry.index, line: section.headerLine, action: { view: 'entry', source: 'starter', index: entry.index } });
          }
          if (!itemsOut.length) {
            addIssue('starter_section_empty', 'warn', `新手礼包「${section.name}」没有任何出生物品`, { source: 'starter', file: starterDef.file, index: entry.index, line: section.headerLine, action: { view: 'entry', source: 'starter', index: entry.index } });
          }
          for (const it of itemsOut) {
            if (!it.exists) {
              addIssue('starter_item_missing', 'warn', `新手礼包「${section.name}」的物品「${it.name}」不在 stditems.db`, { source: 'starter', file: starterDef.file, index: entry.index, line: it.line, action: { view: 'entry', source: 'starter', index: entry.index } });
            }
          }
        }
        for (const slot of STARTER_SLOTS) {
          if (!seen.has(slot.name)) {
            addIssue('starter_slot_missing', 'warn', `缺少「${slot.name}」的新手礼包分组`, { source: 'starter', file: starterDef.file, action: { view: 'source', source: 'starter' } });
          }
        }
      }
      info.issues = sourceIssues('starter');
      sources.push(info);
    }

    const giftDefs = ['diamond', 'golden1', 'golden2'].map((key) => SOURCE_BY_KEY.get(key));
    const giftTexts = new Map();
    for (const def of giftDefs) {
      const info = srcInfo(def);
      const src = readText(def.file);
      info.exists = src.exists;
      info.size = src.size;
      info.mtime = src.mtime;
      giftTexts.set(def.key, src);
      if (!src.exists || src.error) {
        addIssue('gift_file_missing', 'error', `${def.file} 不存在或无法读取${src.error ? '：' + src.error : ''}`, { source: def.key, file: def.file });
        info.issues = sourceIssues(def.key);
        sources.push(info);
        continue;
      }
      if (!src.encodingOk) {
        info.encodingOk = false;
        addIssue('gift_file_encoding', 'warn', `${def.file} 含无法按 GBK 还原的字节`, { source: def.key, file: def.file });
      }
      const parsed = splitSections(src.lines);
      let prevLevel = null;
      const seenLevels = new Set();
      for (const section of parsed.sections) {
        const level = Number(section.name);
        const validLevel = isInt(section.name) && level >= 0;
        const rows = [];
        const entry = addEntry({
          source: def.key, kind: 'gifts',
          key: def.key + ':' + section.name, label: section.name + ' 级',
          line: section.headerLine, endLine: section.endLine,
          level: validLevel ? level : null, levelText: section.name,
          rows, rewardCount: 0, flags: []
        });
        info.entries++;
        if (!validLevel) entry.flags.push('invalid');
        if (seenLevels.has(section.name)) entry.flags.push('duplicate');
        if (validLevel && prevLevel != null && level < prevLevel) entry.flags.push('invalid');
        for (const body of section.body) {
          const text = body.text.trim();
          if (!text || /^[;#]/.test(text)) continue;
          const parts = text.split(/\s+/);
          const row = {
            line: body.line,
            item: parts[0] || '', count: parts[1] || '', chance: parts[2] == null ? '' : parts[2],
            class: parts[3] == null ? '-1' : parts[3],
            gender: parts[4] == null ? '-1' : parts[4],
            classLabel: LEVEL_CLASS[parts[3] == null ? '-1' : parts[3]] || ('未知(' + parts[3] + ')'),
            genderLabel: LEVEL_GENDER[parts[4] == null ? '-1' : parts[4]] || ('未知(' + parts[4] + ')'),
            flags: []
          };
          const hit = lookupItem(row.item);
          row.exists = hit.exists;
          row.itemIndex = hit.index;
          if (parts.length < 3) row.flags.push('invalid');
          if (parts.length > 5) row.flags.push('invalid');
          if (!hit.exists) row.flags.push('missing-item');
          if (!isInt(row.count) || Number(row.count) <= 0) row.flags.push('invalid');
          if (!isInt(row.chance) || Math.abs(Number(row.chance)) > 1000) row.flags.push('invalid');
          if (!Object.prototype.hasOwnProperty.call(LEVEL_CLASS, row.class)) row.flags.push('invalid');
          if (!Object.prototype.hasOwnProperty.call(LEVEL_GENDER, row.gender)) row.flags.push('invalid');
          if (rows.some((r) => r.item === row.item)) row.flags.push('duplicate');
          rows.push(row);
          if (row.flags.includes('missing-item')) entry.flags.push('missing-item');
          if (row.flags.includes('invalid') || row.flags.includes('duplicate')) entry.flags.push('invalid');
          if (row.flags.includes('missing-item')) {
            addIssue('gift_item_missing', 'warn', `${def.file} 第 ${body.line} 行物品「${row.item}」不在 stditems.db`, { source: def.key, file: def.file, index: entry.index, line: body.line, action: { view: 'entry', source: def.key, index: entry.index } });
          }
          if (!isInt(row.count) || Number(row.count) <= 0) {
            addIssue('gift_count_invalid', 'warn', `${def.file} 第 ${body.line} 行数量「${row.count}」不是正整数`, { source: def.key, file: def.file, index: entry.index, line: body.line, action: { view: 'entry', source: def.key, index: entry.index } });
          }
          if (!isInt(row.chance) || Math.abs(Number(row.chance)) > 1000) {
            addIssue('gift_chance_invalid', 'warn', `${def.file} 第 ${body.line} 行几率「${row.chance}」不是整数或超出 ±1000`, { source: def.key, file: def.file, index: entry.index, line: body.line, action: { view: 'entry', source: def.key, index: entry.index } });
          }
          if (!Object.prototype.hasOwnProperty.call(LEVEL_CLASS, row.class) || !Object.prototype.hasOwnProperty.call(LEVEL_GENDER, row.gender)) {
            addIssue('gift_class_invalid', 'warn', `${def.file} 第 ${body.line} 行职业/性别「${row.class} / ${row.gender}」超出 -1..2 / -1..1`, { source: def.key, file: def.file, index: entry.index, line: body.line, action: { view: 'entry', source: def.key, index: entry.index } });
          }
          if (parts.length < 3 || parts.length > 5) {
            addIssue('gift_row_invalid', 'warn', `${def.file} 第 ${body.line} 行应为 3-5 列，实际 ${parts.length} 列`, { source: def.key, file: def.file, index: entry.index, line: body.line, action: { view: 'entry', source: def.key, index: entry.index } });
          }
          if (row.flags.includes('duplicate')) {
            addIssue('gift_item_duplicate', 'info', `${def.file} 第 ${level} 级重复出现物品「${row.item}」`, { source: def.key, file: def.file, index: entry.index, line: body.line, action: { view: 'entry', source: def.key, index: entry.index } });
          }
        }
        entry.rewardCount = rows.length;
        entry.preview = rows.length
          ? rows.slice(0, 4).map((r) => r.item).join('、') + (rows.length > 4 ? ' 等 ' + rows.length + ' 件' : '')
          : '空档位';
        if (!rows.length) entry.flags.push('empty');
        if (!validLevel) {
          addIssue('gift_level_invalid', 'warn', `${def.file} 第 ${section.headerLine} 行等级「${section.name}」不是非负整数`, { source: def.key, file: def.file, index: entry.index, line: section.headerLine, action: { view: 'entry', source: def.key, index: entry.index } });
        }
        if (seenLevels.has(section.name)) {
          addIssue('gift_level_duplicate', 'warn', `${def.file} 等级「${section.name}」重复定义`, { source: def.key, file: def.file, index: entry.index, line: section.headerLine, action: { view: 'entry', source: def.key, index: entry.index } });
        }
        if (validLevel && prevLevel != null && level < prevLevel) {
          addIssue('gift_level_order', 'warn', `${def.file} 等级 ${level} 排在 ${prevLevel} 之后，档位未按升序排列`, { source: def.key, file: def.file, index: entry.index, line: section.headerLine, action: { view: 'entry', source: def.key, index: entry.index } });
        }
        if (!rows.length) {
          addIssue('gift_level_empty', 'info', `${def.file} 等级 ${section.name} 档位为空`, { source: def.key, file: def.file, index: entry.index, line: section.headerLine, action: { view: 'entry', source: def.key, index: entry.index } });
        }
        if (validLevel) prevLevel = level;
        seenLevels.add(section.name);
        info.rewards += rows.length;
      }
      info.issues = sourceIssues(def.key);
      sources.push(info);
    }

    // 钻石与黄金 1 的内容一致性
    {
      const normalize = (src) => (src && src.exists ? src.lines.map((l) => l.trim()).filter((l) => l && !/^[;#]/.test(l)).map((l) => l.replace(/\s+/g, ' ')).join('\n') : '');
      const d = giftTexts.get('diamond');
      const g1 = giftTexts.get('golden1');
      if (d && g1 && d.exists && g1.exists && normalize(d) === normalize(g1)) {
        addIssue('gift_content_duplicate', 'info', 'DiamondAccount.txt 与 goldenaccount1.txt 内容一致（仅空白差异），修改时需同步两份', { source: 'diamond', file: 'DiamondAccount.txt', action: { view: 'source', source: 'diamond' } });
      }
    }

    // 元宝充值队列
    {
      const def = SOURCE_BY_KEY.get('yb');
      const info = srcInfo(def);
      const dir = path.join(envirDir, def.dir);
      let names = null;
      try {
        names = fs.readdirSync(dir).filter((n) => /\.txt$/i.test(n)).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
        info.exists = true;
      } catch (e) {
        addIssue('queue_dir_missing', 'error', `${def.dir} 目录不存在或无法读取${e.message ? '：' + e.message : ''}`, { source: 'yb', file: def.dir });
      }
      if (names) {
        const byKey = new Map();
        let zero = 0;
        for (const name of names) {
          const full = path.join(dir, name);
          let size = 0;
          let mtime = 0;
          try {
            const st = fs.statSync(full);
            size = st.size;
            mtime = st.mtimeMs;
          } catch (e) {
          }
          if (size === 0) zero++;
          const m = /^yb0*(\d+)\.txt$/i.exec(name);
          const normKey = m ? 'yb' + Number(m[1]) : '';
          const entry = addEntry({
            source: 'yb', kind: 'queue', key: 'yb:' + name, label: name,
            line: 0, endLine: 0, size, mtime, normKey,
            preview: size === 0 ? '空队列文件' : size + ' 字节',
            flags: []
          });
          if (normKey) {
            if (!byKey.has(normKey)) byKey.set(normKey, []);
            byKey.get(normKey).push(entry);
          }
          info.entries++;
          if (size) info.size += size;
        }
        info.size = names.reduce((n, name) => {
          try { return n + fs.statSync(path.join(dir, name)).size; } catch (e) { return n; }
        }, 0);
        statsQueue.zero = zero;
        statsQueue.files = names.length;
        if (zero) {
          addIssue('queue_zero_byte', 'info', `元宝充值目录有 ${zero} 个 0 字节队列文件${names.length === zero ? '（全部为空，说明尚未产生充值订单）' : ''}`, { source: 'yb', file: def.dir });
        }
        let dupGroups = 0;
        for (const [key, list] of byKey) {
          if (list.length < 2) continue;
          dupGroups++;
          const namesOut = list.map((e) => e.label);
          list.forEach((e) => { e.duplicates = namesOut; e.flags.push('duplicate'); });
          addIssue('queue_name_duplicate', 'warn', `队列文件名重复：${namesOut.join(' / ')} 都对应 ${key}，脚本按固定名称读取时可能取错`, { source: 'yb', file: def.dir, index: list[0].index, action: { view: 'entry', source: 'yb', index: list[0].index } });
        }
        statsQueue.duplicates = dupGroups;
      }
      info.issues = sourceIssues('yb');
      sources.push(info);
    }

    const issueCounts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) issueCounts[issue.severity]++;
    const stats = {
      sources: sources.length,
      entries: entries.length,
      rewards: sources.reduce((n, s) => n + s.rewards, 0),
      files: sources.reduce((n, s) => n + (s.exists ? (s.kind === 'queue' ? s.entries : 1) : 0), 0),
      issues: issueCounts,
      queue: statsQueue
    };

    for (const source of sources) source.issues = issueCountsFor(source.key);
    function issueCountsFor(key) {
      const counts = { error: 0, warn: 0, info: 0 };
      for (const issue of issues) {
        if (issue.source === key) counts[issue.severity]++;
      }
      return counts;
    }

    return {
      generatedAt,
      stats,
      sources,
      entries: entries.map((e) => ({
        source: e.source, index: e.index, kind: e.kind, key: e.key, label: e.label,
        line: e.line, endLine: e.endLine, preview: e.preview, flags: e.flags,
        level: e.level, rewardCount: e.rewardCount, items: e.items,
        fields: e.fields, size: e.size, normKey: e.normKey, duplicates: e.duplicates
      })),
      issues: issues.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || String(a.code).localeCompare(String(b.code))),
      _entries: entries,
      _sources: sources
    };
  }

  const statsQueue = { zero: 0, files: 0, duplicates: 0 };

  function ensure() {
    const sig = signature();
    if (!cache || cache.sig !== sig) {
      statsQueue.zero = 0;
      statsQueue.files = 0;
      statsQueue.duplicates = 0;
      const data = build();
      data.sig = sig;
      cache = data;
    }
    return cache;
  }

  function list() {
    const d = ensure();
    return {
      generatedAt: d.generatedAt,
      stats: d.stats,
      sources: d.sources,
      entries: d.entries,
      issues: d.issues
    };
  }

  function detail(rawSource, rawIndex) {
    const d = ensure();
    const def = SOURCE_BY_KEY.get(String(rawSource || ''));
    if (!def) return null;
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    const entry = d._entries.find((e) => e.source === def.key && e.index === index);
    if (!entry) return null;
    const srcInfo = d._sources.find((s) => s.key === def.key) || null;
    return {
      generatedAt: d.generatedAt,
      source: srcInfo,
      entry,
      issues: d.issues.filter((i) => i.source === def.key && i.index === index)
    };
  }

  function search(rawQuery, rawLimit) {
    const d = ensure();
    const query = String(rawQuery == null ? '' : rawQuery).trim();
    const limit = Math.min(1000, Math.max(1, Number(rawLimit) || 300));
    if (!query) {
      return { generatedAt: d.generatedAt, query: '', total: 0, results: [], truncated: false, limit };
    }
    const needle = query.toLowerCase();
    const results = [];
    let total = 0;
    for (const entry of d._entries) {
      const chunks = [entry.label, entry.key, entry.normKey || ''];
      if (entry.items) for (const it of entry.items) chunks.push(it.name);
      if (entry.rows) for (const row of entry.rows) chunks.push(row.item);
      const hitText = chunks.find((c) => String(c || '').toLowerCase().indexOf(needle) >= 0);
      if (!hitText) continue;
      total++;
      if (results.length < limit) {
        results.push({
          source: entry.source,
          sourceLabel: (SOURCE_BY_KEY.get(entry.source) || {}).label || entry.source,
          index: entry.index, key: entry.key, label: entry.label,
          line: entry.line, text: String(hitText),
          count: entry.rewardCount != null ? entry.rewardCount : (entry.items ? entry.items.length : 0),
          flags: entry.flags
        });
      }
    }
    return {
      generatedAt: d.generatedAt,
      query, total, results, truncated: total > results.length, limit
    };
  }

  function summary() {
    const d = ensure();
    return { generatedAt: d.generatedAt, stats: d.stats };
  }

  function health() {
    try {
      const d = ensure();
      return { generatedAt: d.generatedAt, issues: d.issues || [] };
    } catch (e) {
      return { generatedAt: null, issues: [], error: e.message };
    }
  }

  function invalidate() {
    cache = null;
  }

  return { list, detail, search, summary, invalidate, health };
}

module.exports = { create, SOURCES };

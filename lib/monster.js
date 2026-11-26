'use strict';

const fs = require('fs');
const path = require('path');
const dbe = require('./dbe');
const gbk = require('./gbk');
const configs = require('./configs');
const extras = require('./extras');
const npcData = require('./npc');

const DROP_NAME_RE = /^[^\\/:*?"<>|]+\.txt$/i;
const CONTROL_RE = /[\x00-\x1f]/;
const TRAILING_DIGITS_RE = /[0-9]+$/;

function stripDigits(name) {
  return String(name == null ? '' : name).replace(TRAILING_DIGITS_RE, '');
}

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function normalizeName(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw new Error('缺少怪物名称');
  if (s.length > 64 || CONTROL_RE.test(s)) throw new Error('怪物名称不合法');
  return s;
}

function conflictResult() {
  return { ok: false, conflict: true, error: '文件已被修改，请重新加载' };
}

function parseDropLines(lines) {
  const rows = [];
  const invalid = [];
  let blanks = 0;
  let comments = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s) {
      blanks++;
      continue;
    }
    if (s[0] === '#' || s[0] === ';') {
      comments++;
      continue;
    }

    const tok = configs.tokenize(line);
    const t0 = tok[0];
    const t1 = tok[1];
    const ratio = t0 ? /^(-?\d+)\/(\d+)$/.exec(t0[0]) : null;
    if (!ratio || !t1) {
      invalid.push({ line: li + 1, text: line, reason: '不是“概率 物品 [数量]”格式' });
      continue;
    }

    let qty = null;
    let hasQty = false;
    let extra = [];
    if (tok[2]) {
      if (!/^\d+$/.test(tok[2][0])) {
        invalid.push({ line: li + 1, text: line, reason: '数量不是整数' });
        continue;
      }
      qty = Number(tok[2][0]);
      hasQty = true;
      extra = tok.slice(3).map((m) => m[0]);
    }

    rows.push({
      index: rows.length,
      line: li + 1,
      lineIndex: li,
      n: Number(ratio[1]),
      d: Number(ratio[2]),
      item: t1[0],
      qty,
      hasQty,
      extra,
      lead: line.slice(0, t0.index),
      sep: line.slice(t0.index + t0[0].length, t1.index) || '\t'
    });
  }

  return { rows, invalid, blanks, comments };
}

function sameDropValues(a, b) {
  return a.n === b.n && a.d === b.d && a.item === b.item && a.qty === b.qty;
}

function normalizeDropValues(base, values) {
  const v = values || {};
  const b = base || { n: 1, d: 1, item: '', qty: null };

  const n = v.n !== undefined ? Number(v.n) : b.n;
  if (!Number.isInteger(n) || n < -1000000000 || n > 1000000000) {
    throw new Error('概率分子需要 -1000000000 到 1000000000 的整数');
  }

  const d = v.d !== undefined ? Number(v.d) : b.d;
  if (!Number.isInteger(d) || d < 1 || d > 1000000000) {
    throw new Error('概率分母需要 1 到 1000000000 的整数');
  }

  const item = (v.item !== undefined ? String(v.item) : String(b.item || '')).trim();
  if (!item) throw new Error('物品名称不能为空');
  if (/\s/.test(item)) throw new Error('物品名称不能包含空格或制表符');
  try {
    gbk.encode(item);
  } catch (e) {
    throw new Error('物品名称包含无法用 GBK 保存的字符');
  }

  let qty;
  if (v.qty === undefined) qty = b.qty;
  else if (v.qty === null || v.qty === '') qty = null;
  else qty = Number(v.qty);
  if (qty !== null && (!Number.isInteger(qty) || qty < 1 || qty > 1000000000)) {
    throw new Error('数量需要 1 到 1000000000 的整数');
  }

  return { n, d, item, qty };
}

function renderNewDrop(row, sep) {
  return `${row.n}/${row.d}${sep}${row.item}${row.qty === null ? '' : sep + row.qty}`;
}

function renderDropLine(line, row, values) {
  const ratio = `${values.n}/${values.d}`;
  if (values.qty !== null && row.hasQty) {
    return configs.patchTokens(line, new Map([[0, ratio], [1, values.item], [2, values.qty]]));
  }
  if (values.qty === null && !row.hasQty) {
    return configs.patchTokens(line, new Map([[0, ratio], [1, values.item]]));
  }

  const sep = row.sep || '\t';
  let out = row.lead + ratio + sep + values.item;
  if (values.qty !== null) out += sep + values.qty;
  if (row.extra && row.extra.length) out += sep + row.extra.join(sep);
  return out;
}

function create(opts) {
  const dbFile = path.resolve(opts.dbFile);
  const itemFile = path.resolve(opts.itemFile);
  const mongenFile = path.resolve(opts.mongenFile);
  const childFile = path.resolve(opts.childFile);
  const mapInfoFile = path.resolve(opts.mapInfoFile);
  const dropDir = path.resolve(opts.dropDir);

  let cachedSig = null;
  let cachedIndex = null;
  const dropCache = new Map();

  function invalidate() {
    cachedSig = null;
    cachedIndex = null;
  }

  function dropFileInfos() {
    const out = [];
    let names = [];
    try {
      names = fs.readdirSync(dropDir);
    } catch (e) {
      return out;
    }
    for (const name of names) {
      if (!/\.txt$/i.test(name)) continue;
      const full = path.join(dropDir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch (e) {
        continue;
      }
      if (!st.isFile()) continue;
      const stem = name.replace(/\.txt$/i, '');
      out.push({
        file: name,
        full,
        stem,
        lowerStem: stem.toLowerCase(),
        strip: stripDigits(stem),
        size: st.size,
        mtime: st.mtimeMs
      });
    }
    out.sort((a, b) => a.file.localeCompare(b.file, 'zh-CN'));
    return out;
  }

  function signature(files) {
    return [
      statSig(dbFile),
      statSig(itemFile),
      statSig(mongenFile),
      statSig(childFile),
      statSig(mapInfoFile),
      files.length,
      files.map((f) => `${f.file}:${f.size}:${f.mtime}`).join('|')
    ].join('#');
  }

  function readDropParsed(full, info) {
    const st = info || fs.statSync(full);
    const size = st.size;
    const mtimeMs = st.mtimeMs !== undefined ? st.mtimeMs : st.mtime;
    const key = full.toLowerCase();
    const cached = dropCache.get(key);
    if (cached && cached.size === size && cached.mtime === mtimeMs) {
      return cached.parsed;
    }

    const data = configs.readFileLines(full);
    const parsedLines = parseDropLines(data.lines);
    const eol = data.text === '' ? '\r\n' : data.eol;
    const parsed = {
      size,
      mtimeMs,
      eol,
      trailing: data.trailing,
      ...parsedLines
    };
    dropCache.set(key, { size, mtime: mtimeMs, parsed });
    return parsed;
  }

  function resolveDropFile(name, allowCreate) {
    if (typeof name !== 'string') throw new Error('文件名不合法');
    const clean = name.trim();
    if (!clean || clean !== name || CONTROL_RE.test(clean) || !DROP_NAME_RE.test(clean)) {
      throw new Error('文件名不合法');
    }
    const full = path.resolve(dropDir, clean);
    if (path.dirname(full).toLowerCase() !== dropDir.toLowerCase()) {
      throw new Error('路径不合法');
    }

    const lower = clean.toLowerCase();
    let actual = null;
    try {
      actual = fs.readdirSync(dropDir).find((n) => n.toLowerCase() === lower) || null;
    } catch (e) {
      actual = null;
    }
    if (actual) {
      return { file: actual, full: path.join(dropDir, actual), exists: true };
    }
    if (allowCreate) {
      return { file: clean, full, exists: false };
    }
    throw new Error('爆率文件不存在：' + clean);
  }

  function resolveDrops(name, byLowerStem, byStrip) {
    const out = [];
    const seen = new Set();
    const add = (info, tier) => {
      if (!info || seen.has(info.file)) return;
      seen.add(info.file);
      out.push({ info, tier });
    };

    for (const info of byLowerStem.get(name.toLowerCase()) || []) add(info, 'exact');
    const root = stripDigits(name);
    if (root !== name) {
      for (const info of byLowerStem.get(root.toLowerCase()) || []) add(info, 'root');
    }
    for (const info of byStrip.get(stripDigits(name)) || []) add(info, 'family');

    return { candidates: out, primary: out[0] || null };
  }

  function candidateSummary(entry) {
    const p = entry.info.parsed;
    return {
      file: entry.info.file,
      tier: entry.tier,
      size: entry.info.size,
      mtime: entry.info.mtime,
      rules: p.rows.length,
      invalid: p.invalid.length,
      unknownItems: entry.info.unknownItems.length,
      currency: entry.info.currencyCount,
      negatives: entry.info.negativeCount,
      zeroDen: entry.info.zeroDenCount,
      zeroByte: entry.info.size === 0
    };
  }

  function buildIssues(data, ctx) {
    const issues = [];
    const add = (code, severity, message, jump) => {
      issues.push({ code, severity, message, jump: jump || { tab: 'health' } });
    };

    const dbRows = data.dbRows;
    const spawns = data.spawns;
    const candidates = data.drops.candidates;
    const primary = data.drops.primary;

    if (!dbRows.length && (data.isReferenced || (!data.isDropVariant && candidates.length))) {
      add('db_missing', 'error', `Monster.DB 中没有“${data.name}”`, { tab: 'attr' });
    }
    if (dbRows.length > 1) {
      add('dup_db_name', 'warn', `Monster.DB 中有 ${dbRows.length} 条同名记录`, { tab: 'attr' });
    }

    for (const s of spawns) {
      if (!ctx.mapNameByCode.has(s.map)) {
        add('spawn_map_unknown', 'warn', `刷怪地图 ${s.map} 不在 MapInfo`, {
          tab: 'spawn',
          index: s.entryIndex,
          line: s.line
        });
      }
      if (s.extra && s.extra.length) {
        add('spawn_extra', 'info', `刷怪行有多余参数：${s.extra.join(' ')}`, {
          tab: 'spawn',
          index: s.entryIndex,
          line: s.line
        });
      }
    }

    const spawnGroups = new Map();
    for (const s of spawns) {
      const key = `${s.map}\u0000${s.x}\u0000${s.y}\u0000${s.monster}`;
      if (!spawnGroups.has(key)) spawnGroups.set(key, []);
      spawnGroups.get(key).push(s);
    }
    for (const list of spawnGroups.values()) {
      if (list.length > 1) {
        add('spawn_dup', 'info', `刷怪点重复 ${list.length} 次：${list[0].map} ${list[0].x},${list[0].y}`, {
          tab: 'spawn',
          index: list[1].entryIndex,
          line: list[1].line
        });
      }
    }
    if (dbRows.length && !spawns.length) {
      add('spawn_none', 'info', 'Monster.DB 有记录，但 Mongen.txt 中没有刷怪点', { tab: 'spawn' });
    }

    if (!candidates.length) {
      add('drop_none', spawns.length ? 'warn' : 'info', '没有找到对应的爆率文件', { tab: 'drop' });
    }

    if (primary) {
      const p = primary.info.parsed;
      const file = primary.info.file;
      const negative = p.rows.filter((r) => r.n < 0);
      if (negative.length) {
        add('drop_prob_negative', 'warn', `${file} 有 ${negative.length} 行概率分子为负（首个第 ${negative[0].line} 行）`, {
          tab: 'drop',
          file,
          line: negative[0].line
        });
      }
      const zeroDen = p.rows.filter((r) => r.d === 0);
      if (zeroDen.length) {
        add('drop_prob_zero_den', 'error', `${file} 有 ${zeroDen.length} 行概率分母为 0`, {
          tab: 'drop',
          file,
          line: zeroDen[0].line
        });
      }
      for (const inv of p.invalid.slice(0, 20)) {
        add('drop_line_invalid', 'warn', `${file} 第 ${inv.line} 行：${inv.reason}`, {
          tab: 'drop',
          file,
          line: inv.line
        });
      }
      if (p.invalid.length > 20) {
        add('drop_line_invalid', 'warn', `${file} 还有 ${p.invalid.length - 20} 行异常未逐条列出`, {
          tab: 'drop',
          file
        });
      }
      for (const [item, count] of primary.info.unknownItems.slice(0, 20)) {
        add('drop_item_unknown', 'warn', `${file} 掉落物品“${item}”不在 stditems.db（${count} 行）`, {
          tab: 'drop',
          file
        });
      }
      if (primary.info.unknownItems.length > 20) {
        add('drop_item_unknown', 'warn', `${file} 还有 ${primary.info.unknownItems.length - 20} 个未知物品未逐条列出`, {
          tab: 'drop',
          file
        });
      }
      if (!data.isReferenced && !dbRows.length && !data.isDropVariant) {
        add('drop_orphan_file', 'info', `爆率文件“${file}”没有对应的 DB / 刷怪 / 召唤条目`, {
          tab: 'drop',
          file
        });
      }
    }

    if (candidates.filter((c) => c.tier === 'exact').length > 1) {
      add('variant_ambiguous', 'warn', '存在仅大小写或扩展名不同的同名爆率文件', { tab: 'drop' });
    }

    for (const row of data.asChild) {
      if (!ctx.dbByName.has(row.parent)) {
        add('child_parent_missing', 'warn', `作为子怪出现在“${row.parent}”下，但父怪不在 Monster.DB`, {
          tab: 'child',
          index: row.index,
          line: row.line
        });
      }
    }
    for (const row of data.asParent) {
      if (!ctx.dbByName.has(row.child)) {
        add('child_child_missing', 'warn', `子怪“${row.child}”不在 Monster.DB`, {
          tab: 'child',
          index: row.index,
          line: row.line
        });
      }
    }
    const seenChildren = new Set();
    for (const row of data.asParent) {
      if (seenChildren.has(row.child)) {
        add('child_dup_same_parent', 'warn', `同一父怪下重复子怪“${row.child}”`, {
          tab: 'child',
          index: row.index,
          line: row.line
        });
      }
      seenChildren.add(row.child);
    }

    return issues;
  }

  function buildIndex(fileInfos) {
    const db = dbe.loadDb(dbFile);
    const itemDb = dbe.loadDb(itemFile);
    const mongen = configs.parseMongen(mongenFile);
    const child = extras.parseMonsterChild(childFile);
    const mapList = npcData.parseMapNames(mapInfoFile);
    const mapNameByCode = new Map(mapList.map((m) => [m.code, m.name]));

    const itemSet = new Set();
    for (const row of itemDb.rows) {
      const name = row && row.Name != null ? String(row.Name).trim() : '';
      if (name) itemSet.add(name);
    }

    const dbByName = new Map();
    for (let i = 0; i < db.rows.length; i++) {
      const values = db.rows[i];
      const name = values && values.Name != null ? String(values.Name).trim() : '';
      if (!name) continue;
      if (!dbByName.has(name)) dbByName.set(name, []);
      dbByName.get(name).push({ index: i, values });
    }

    const spawnsByName = new Map();
    mongen.entries.forEach((entry, entryIndex) => {
      const row = {
        entryIndex,
        line: entry.line,
        map: entry.map,
        x: entry.x,
        y: entry.y,
        monster: entry.monster,
        range: entry.range,
        count: entry.count,
        interval: entry.interval,
        extra: entry.extra || []
      };
      if (!spawnsByName.has(entry.monster)) spawnsByName.set(entry.monster, []);
      spawnsByName.get(entry.monster).push(row);
    });

    const childByParent = new Map();
    const childByChild = new Map();
    child.rows.forEach((row, index) => {
      const item = { index, line: row.line, parent: row.parent, child: row.child };
      if (!childByParent.has(row.parent)) childByParent.set(row.parent, []);
      childByParent.get(row.parent).push(item);
      if (!childByChild.has(row.child)) childByChild.set(row.child, []);
      childByChild.get(row.child).push(item);
    });

    const byLowerStem = new Map();
    const byStrip = new Map();
    for (const info of fileInfos) {
      if (!byLowerStem.has(info.lowerStem)) byLowerStem.set(info.lowerStem, []);
      byLowerStem.get(info.lowerStem).push(info);
      if (!byStrip.has(info.strip)) byStrip.set(info.strip, []);
      byStrip.get(info.strip).push(info);
    }

    for (const info of fileInfos) {
      let parsed;
      try {
        parsed = readDropParsed(info.full, info);
      } catch (e) {
        parsed = {
          rows: [],
          invalid: [{ line: 0, text: '', reason: e.message }],
          blanks: 0,
          comments: 0,
          eol: '\r\n',
          trailing: false
        };
      }
      const unknown = new Map();
      let currencyCount = 0;
      let negativeCount = 0;
      let zeroDenCount = 0;
      for (const row of parsed.rows) {
        if (row.item === '金币') {
          currencyCount++;
        } else if (!itemSet.has(row.item)) {
          unknown.set(row.item, (unknown.get(row.item) || 0) + 1);
        }
        if (row.n < 0) negativeCount++;
        if (row.d === 0) zeroDenCount++;
      }
      info.parsed = parsed;
      info.unknownItems = [...unknown.entries()].sort((a, b) => b[1] - a[1]);
      info.currencyCount = currencyCount;
      info.negativeCount = negativeCount;
      info.zeroDenCount = zeroDenCount;
      info.ruleCount = parsed.rows.length;
      info.invalidCount = parsed.invalid.length;
    }

    const referenceNames = new Set([
      ...dbByName.keys(),
      ...spawnsByName.keys(),
      ...childByParent.keys(),
      ...childByChild.keys()
    ]);
    const referenceLower = new Set([...referenceNames].map((n) => n.toLowerCase()));
    const allNames = new Set(referenceNames);
    for (const info of fileInfos) allNames.add(info.stem);

    const duplicateDbNames = [...dbByName.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([name, rows]) => ({ name, indexes: rows.map((r) => r.index) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const spawnMissingDb = [...spawnsByName.keys()]
      .filter((name) => !dbByName.has(name))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const orphanDropFiles = fileInfos
      .filter((info) => {
        return !referenceLower.has(info.stem.toLowerCase()) && !referenceLower.has(info.strip.toLowerCase());
      })
      .map((info) => ({ file: info.file, size: info.size, mtime: info.mtime }))
      .sort((a, b) => a.file.localeCompare(b.file, 'zh-CN'));

    const unknownChild = [];
    for (const row of child.rows) {
      if (!dbByName.has(row.parent) || !dbByName.has(row.child)) {
        unknownChild.push({ parent: row.parent, child: row.child, line: row.line });
      }
    }
    const dropInvalid = [];
    for (const info of fileInfos) {
      for (const inv of info.parsed.invalid) {
        dropInvalid.push({ file: info.file, line: inv.line, text: inv.text, reason: inv.reason });
        if (dropInvalid.length >= 500) break;
      }
      if (dropInvalid.length >= 500) break;
    }

    const uppercaseFiles = fileInfos.filter((info) => /\.TXT$/.test(info.file)).map((info) => info.file);
    const zeroByteFiles = fileInfos.filter((info) => info.size === 0).map((info) => info.file);

    const issueCodes = {};
    const issueTotals = { error: 0, warn: 0, info: 0 };
    const monsters = [];
    const monsterMap = new Map();
    const sortedNames = [...allNames].sort((a, b) => a.localeCompare(b, 'zh-CN'));

    for (const name of sortedNames) {
      const dbRows = dbByName.get(name) || [];
      const spawns = spawnsByName.get(name) || [];
      const asParent = childByParent.get(name) || [];
      const asChild = childByChild.get(name) || [];
      const drops = resolveDrops(name, byLowerStem, byStrip);
      const isReferenced = referenceNames.has(name);
      const root = stripDigits(name);
      const isDropVariant = !isReferenced && !dbRows.length && root !== name && dbByName.has(root);
      const data = { name, dbRows, spawns, asParent, asChild, drops, isReferenced, isDropVariant };
      data.issues = buildIssues(data, { dbByName, itemSet, mapNameByCode });

      const issueCounts = { error: 0, warn: 0, info: 0 };
      for (const issue of data.issues) {
        issueCounts[issue.severity]++;
        issueTotals[issue.severity]++;
        issueCodes[issue.code] = (issueCodes[issue.code] || 0) + 1;
      }

      const spawnMaps = [];
      for (const s of spawns) {
        if (!spawnMaps.includes(s.map)) spawnMaps.push(s.map);
      }

      const summary = {
        name,
        dbIndex: dbRows.length ? dbRows[0].index : -1,
        dbCount: dbRows.length,
        spawnCount: spawns.length,
        spawnMaps,
        dropFiles: drops.candidates.length,
        dropPrimary: drops.primary ? drops.primary.info.file : null,
        childCount: asParent.length,
        parentCount: asChild.length,
        flags: {
          attr: dbRows.length > 0,
          spawn: spawns.length > 0,
          drop: drops.candidates.length > 0,
          child: asParent.length > 0 || asChild.length > 0
        },
        issues: issueCounts
      };
      monsters.push(summary);
      monsterMap.set(name, data);
    }

    const stats = {
      dbRows: db.rows.length,
      dbNames: dbByName.size,
      names: allNames.size,
      duplicates: duplicateDbNames.length,
      spawnEntries: mongen.entries.length,
      spawnNames: spawnsByName.size,
      spawnMissingDb: spawnMissingDb.length,
      dropFiles: fileInfos.length,
      dropLinkedNames: monsters.filter((m) => m.flags.drop).length,
      dropOrphans: orphanDropFiles.length,
      dropZeroByte: zeroByteFiles.length,
      childGroups: child.groups.length,
      childRows: child.rows.length,
      items: itemSet.size,
      maps: mapList.length,
      issues: issueTotals,
      issueCodes
    };

    return {
      builtAt: Date.now(),
      fields: db.schema.fields.map((f) => ({ name: f.name, kind: f.kind, width: f.width })),
      itemSet,
      itemNames: [...itemSet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      mapList: mapList.slice().sort((a, b) => a.code.localeCompare(b.code, 'zh-CN')),
      mapNameByCode,
      dbByName,
      spawnsByName,
      childByParent,
      childByChild,
      monsters,
      monsterMap,
      stats,
      globals: {
        duplicateDbNames,
        spawnMissingDb,
        orphanDropFiles,
        unknownChild,
        dropInvalid,
        uppercaseFiles,
        zeroByteFiles
      }
    };
  }

  function getIndex() {
    const files = dropFileInfos();
    const sig = signature(files);
    if (cachedIndex && sig === cachedSig) return cachedIndex;
    const index = buildIndex(files);
    cachedSig = sig;
    cachedIndex = index;
    return index;
  }

  function list() {
    const index = getIndex();
    return {
      generatedAt: Date.now(),
      stats: index.stats,
      monsters: index.monsters,
      maps: index.mapList,
      items: index.itemNames,
      globals: index.globals
    };
  }

  function detail(name) {
    const key = normalizeName(name);
    const index = getIndex();
    const data = index.monsterMap.get(key);
    if (!data) throw new Error('未找到怪物：' + key);

    const candidates = data.drops.candidates.map((entry) => ({
      ...candidateSummary(entry),
      primary: entry === data.drops.primary
    }));

    return {
      name: key,
      generatedAt: Date.now(),
      attr: {
        exists: data.dbRows.length > 0,
        dbCount: data.dbRows.length,
        selectedIndex: data.dbRows.length ? data.dbRows[0].index : -1,
        fields: index.fields,
        rows: data.dbRows.map((row) => ({ index: row.index, values: row.values }))
      },
      spawns: data.spawns.map((s) => ({
        ...s,
        mapName: index.mapNameByCode.get(s.map) || '',
        mapKnown: index.mapNameByCode.has(s.map)
      })),
      drops: {
        strip: stripDigits(key),
        primary: data.drops.primary ? data.drops.primary.info.file : null,
        candidates
      },
      child: {
        asChild: data.asChild.map((row) => ({ index: row.index, parent: row.parent, line: row.line })),
        asParent: data.asParent.map((row) => ({
          index: row.index,
          child: row.child,
          line: row.line,
          childKnown: index.dbByName.has(row.child)
        }))
      },
      issues: data.issues
    };
  }

  function drop(file) {
    const target = resolveDropFile(file, false);
    const st = fs.statSync(target.full);
    const parsed = readDropParsed(target.full, { size: st.size, mtimeMs: st.mtimeMs });
    const index = getIndex();

    const unknown = new Map();
    let currencyCount = 0;
    for (const row of parsed.rows) {
      if (row.item === '金币') {
        currencyCount++;
      } else if (!index.itemSet.has(row.item)) {
        unknown.set(row.item, (unknown.get(row.item) || 0) + 1);
      }
    }

    return {
      file: target.file,
      size: st.size,
      mtimeMs: st.mtimeMs,
      eol: parsed.eol,
      trailing: parsed.trailing,
      rows: parsed.rows.map((row) => ({
        index: row.index,
        line: row.line,
        n: row.n,
        d: row.d,
        item: row.item,
        qty: row.qty,
        hasQty: row.hasQty,
        extra: row.extra
      })),
      invalid: parsed.invalid,
      blanks: parsed.blanks,
      comments: parsed.comments,
      currencyCount,
      unknownItems: [...unknown.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([item, count]) => ({ item, count }))
    };
  }

  function saveDrop(file, payload) {
    const body = payload || {};
    const createNew = Boolean(body.create);
    const target = resolveDropFile(file, createNew);
    if (target.exists && createNew) throw new Error('文件已存在：' + target.file);

    let st = null;
    if (target.exists) {
      st = fs.statSync(target.full);
      if (body.baseSize != null && Number(body.baseSize) !== st.size) return conflictResult();
      if (body.baseMtime != null && Number(body.baseMtime) !== st.mtimeMs) return conflictResult();
    } else if (!createNew) {
      throw new Error('爆率文件不存在：' + target.file);
    }

    const changes = Array.isArray(body.changes) ? body.changes : [];
    const added = Array.isArray(body.added) ? body.added : [];
    const deleted = Array.isArray(body.deleted) ? body.deleted : [];

    if (createNew) {
      if (changes.length || deleted.length) throw new Error('新建文件只能添加规则');
      const addedRows = added.map((values) => normalizeDropValues(null, values));
      let text = '';
      if (addedRows.length) {
        text = addedRows.map((row) => renderNewDrop(row, '\t')).join('\r\n') + '\r\n';
      }
      fs.writeFileSync(target.full, gbk.encode(text));
      configs.invalidateFileCache(target.full);
      dropCache.delete(target.file.toLowerCase());
      invalidate();
      const st2 = fs.statSync(target.full);
      return {
        ok: true,
        file: target.file,
        created: true,
        changedRows: 0,
        addedRows: addedRows.length,
        deletedRows: 0,
        count: addedRows.length,
        size: st2.size,
        backup: null,
        mtime: st2.mtimeMs
      };
    }

    const data = configs.readFileLines(target.full);
    const lines = data.lines;
    const parsed = parseDropLines(lines);
    const byIndex = new Map(parsed.rows.map((row) => [row.index, row]));

    const deletedSet = new Set();
    for (const raw of deleted) {
      const index = Number(raw);
      if (!Number.isInteger(index) || !byIndex.has(index)) {
        throw new Error('爆率序号无效：' + raw);
      }
      deletedSet.add(index);
    }

    const changed = new Map();
    for (const change of changes) {
      const index = Number(change.index);
      const base = byIndex.get(index);
      if (!base) throw new Error('爆率序号无效：' + change.index);
      if (deletedSet.has(index)) throw new Error('同一行不能既修改又删除');
      const merged = normalizeDropValues(base, change.values || {});
      if (!sameDropValues(base, merged)) changed.set(index, merged);
    }

    const addedRows = added.map((values) => normalizeDropValues(null, values));

    if (!changed.size && !deletedSet.size && !addedRows.length) {
      return {
        ok: true,
        file: target.file,
        created: false,
        changedRows: 0,
        addedRows: 0,
        deletedRows: 0,
        count: parsed.rows.length,
        size: st.size,
        backup: null,
        mtime: st.mtimeMs
      };
    }

    const rowByLine = new Map(parsed.rows.map((row) => [row.lineIndex, row]));
    const out = [];
    for (let li = 0; li < lines.length; li++) {
      const row = rowByLine.get(li);
      if (!row) {
        out.push(lines[li]);
        continue;
      }
      if (deletedSet.has(row.index)) continue;
      const merged = changed.get(row.index);
      out.push(merged ? renderDropLine(lines[li], row, merged) : lines[li]);
    }

    const sep = parsed.rows.length ? parsed.rows[parsed.rows.length - 1].sep : '\t';
    for (const row of addedRows) out.push(renderNewDrop(row, sep));

    const eol = data.text === '' ? '\r\n' : data.eol;
    const backup = configs.writeFileLines(target.full, out, eol, data.trailing || addedRows.length > 0);
    dropCache.delete(target.file.toLowerCase());
    invalidate();
    const st2 = fs.statSync(target.full);
    return {
      ok: true,
      file: target.file,
      created: false,
      changedRows: changed.size,
      addedRows: addedRows.length,
      deletedRows: deletedSet.size,
      count: parsed.rows.length - deletedSet.size + addedRows.length,
      size: st2.size,
      backup,
      mtime: st2.mtimeMs
    };
  }

  return { list, detail, drop, saveDrop, invalidate };
}

module.exports = { create, parseDropLines };

'use strict';

const fs = require('fs');
const path = require('path');
const dbe = require('./dbe');
const configs = require('./configs');
const { parseDropLines } = require('./monster');

const PSEUDO_ITEMS = new Set([
  '金币', '经验', '声望', '元宝', '银币', '绑定金币', '绑定元宝',
  '活力', '荣誉', '积分', '游戏币', '强制任务', '后置任务'
]);

function normalizeName(value) {
  return String(value == null ? '' : value)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .trim();
}

function stripDigits(name) {
  return String(name == null ? '' : name).replace(/\d+$/, '');
}

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function readNames(file) {
  const { rows } = dbe.loadDb(file);
  const names = [];
  const seen = new Set();
  for (const row of rows) {
    const name = String(row.Name == null ? '' : row.Name).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function create(options) {
  const dropDir = path.resolve(options.dropDir);
  const monsterFile = path.resolve(options.monsterFile);
  const itemFile = path.resolve(options.itemFile);
  const mongenFile = path.resolve(options.mongenFile);
  let cache = null;

  function fileInfos() {
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
      out.push({
        file: name,
        full,
        stem: name.replace(/\.txt$/i, ''),
        size: st.size,
        mtime: st.mtimeMs
      });
    }
    out.sort((a, b) => a.file.localeCompare(b.file, 'zh-CN'));
    return out;
  }

  function signature(files) {
    return [
      statSig(monsterFile),
      statSig(itemFile),
      statSig(mongenFile),
      files.length,
      files.map((f) => `${f.file}:${f.size}:${f.mtime}`).join('|')
    ].join('#');
  }

  function build(files) {
    const issues = [];
    const counts = { error: 0, warn: 0, info: 0 };
    function addIssue(code, severity, message, extra) {
      const e = extra || {};
      issues.push({
        code,
        severity,
        message,
        scope: e.scope || '',
        file: e.file || '',
        line: e.line == null ? null : e.line,
        action: e.action || null
      });
      counts[severity]++;
    }

    const itemByNorm = new Map();
    try {
      const items = dbe.loadDb(itemFile);
      for (let i = 0; i < items.rows.length; i++) {
        const name = String(items.rows[i].Name == null ? '' : items.rows[i].Name).trim();
        const key = normalizeName(name);
        if (!key || itemByNorm.has(key)) continue;
        itemByNorm.set(key, { name, index: i });
      }
    } catch (e) {
      addIssue('drop_items_unreadable', 'error', `stditems.db 读取失败：${e.message}`, {
        file: path.basename(itemFile)
      });
    }

    const nameSet = new Set();
    const monsterIndex = new Map();
    try {
      const db = dbe.loadDb(monsterFile);
      for (let i = 0; i < db.rows.length; i++) {
        const name = String(db.rows[i].Name == null ? '' : db.rows[i].Name).trim();
        if (!name) continue;
        nameSet.add(name);
        if (!monsterIndex.has(name)) monsterIndex.set(name, i);
      }
    } catch (e) {
      addIssue('drop_monsters_unreadable', 'error', `Monster.DB 读取失败：${e.message}`, {
        file: path.basename(monsterFile)
      });
    }

    const spawnNames = new Set();
    try {
      const mongen = configs.parseMongen(mongenFile);
      for (const entry of mongen.entries) {
        if (entry.monster) spawnNames.add(entry.monster);
      }
    } catch (e) {
      addIssue('drop_mongen_unreadable', 'error', `Mongen.txt 读取失败：${e.message}`, {
        file: path.basename(mongenFile)
      });
    }
    for (const name of spawnNames) nameSet.add(name);

    const byStrip = new Map();
    for (const name of nameSet) {
      const root = stripDigits(name);
      if (!byStrip.has(root)) byStrip.set(root, []);
      byStrip.get(root).push(name);
    }
    for (const list of byStrip.values()) list.sort((a, b) => a.localeCompare(b, 'zh-CN'));

    function mapStem(stem) {
      if (nameSet.has(stem)) return stem;
      const root = stripDigits(stem);
      if (root && nameSet.has(root)) return root;
      const family = byStrip.get(root);
      return family && family.length ? family[0] : null;
    }

    const items = new Map();
    const fileRows = [];
    const fileStrips = new Set();
    const mappedMonsters = new Set();
    let totalLines = 0;
    let emptyFiles = 0;

    for (const info of files) {
      fileStrips.add(stripDigits(info.stem));
      const monster = mapStem(info.stem);
      if (monster) mappedMonsters.add(monster);
      const entry = {
        file: info.file,
        stem: info.stem,
        monster,
        size: info.size,
        rules: 0,
        invalid: 0,
        negative: 0,
        zeroDen: 0,
        over: 0,
        unknownItems: 0,
        unknownRows: 0,
        empty: info.size === 0,
        orphan: !monster,
        firstInvalid: null,
        firstNegative: null,
        firstZero: null,
        firstOver: null
      };
      fileRows.push(entry);
      if (entry.empty) emptyFiles++;

      let parsed;
      try {
        parsed = parseDropLines(configs.readFileLines(info.full).lines);
      } catch (e) {
        addIssue('drop_file_unreadable', 'error', `爆率文件「${info.file}」读取失败：${e.message}`, {
          file: info.file,
          action: { view: 'file', file: info.file }
        });
        continue;
      }

      entry.rules = parsed.rows.length;
      entry.invalid = parsed.invalid.length;
      if (parsed.invalid.length) {
        entry.firstInvalid = parsed.invalid[0];
        addIssue('drop_line_invalid', 'warn',
          `爆率文件「${info.file}」有 ${parsed.invalid.length} 行无法解析（首个第 ${parsed.invalid[0].line} 行：${parsed.invalid[0].reason}）`,
          { file: info.file, line: parsed.invalid[0].line, action: { view: 'file', file: info.file } });
      }

      const unknownSeen = new Set();
      for (const row of parsed.rows) {
        totalLines++;
        const key = normalizeName(row.item);
        const known = itemByNorm.get(key);
        const pseudo = PSEUDO_ITEMS.has(key);
        let item = items.get(key);
        if (!item) {
          item = {
            key,
            name: known ? known.name : row.item.trim(),
            exists: !!known || pseudo,
            pseudo,
            itemIndex: known ? known.index : -1,
            entries: [],
            negative: 0,
            zeroDen: 0,
            over: 0,
            files: new Set(),
            monsters: new Set()
          };
          items.set(key, item);
        }
        item.entries.push({
          file: info.file,
          monster,
          line: row.line,
          n: row.n,
          d: row.d,
          qty: row.hasQty ? row.qty : null
        });
        item.files.add(info.file);
        if (monster) item.monsters.add(monster);
        if (row.n < 0) {
          item.negative++;
          entry.negative++;
          if (!entry.firstNegative) entry.firstNegative = row;
        }
        if (row.d === 0) {
          item.zeroDen++;
          entry.zeroDen++;
          if (!entry.firstZero) entry.firstZero = row;
        }
        if (row.d > 0 && row.n > row.d) {
          item.over++;
          entry.over++;
          if (!entry.firstOver) entry.firstOver = row;
        }
        if (!known && !pseudo) {
          entry.unknownRows++;
          if (!unknownSeen.has(key)) {
            unknownSeen.add(key);
            entry.unknownItems++;
          }
        }
      }

      if (entry.negative) {
        addIssue('drop_prob_negative', 'warn',
          `爆率文件「${info.file}」有 ${entry.negative} 行概率分子为负（首个第 ${entry.firstNegative.line} 行：${entry.firstNegative.n}/${entry.firstNegative.d} ${entry.firstNegative.item}）`,
          { file: info.file, line: entry.firstNegative.line, action: { view: 'file', file: info.file } });
      }
      if (entry.zeroDen) {
        addIssue('drop_prob_zero_den', 'error',
          `爆率文件「${info.file}」有 ${entry.zeroDen} 行概率分母为 0（首个第 ${entry.firstZero.line} 行）`,
          { file: info.file, line: entry.firstZero.line, action: { view: 'file', file: info.file } });
      }
      if (entry.over) {
        addIssue('drop_prob_over', 'warn',
          `爆率文件「${info.file}」有 ${entry.over} 行概率大于 100%（首个第 ${entry.firstOver.line} 行：${entry.firstOver.n}/${entry.firstOver.d}）`,
          { file: info.file, line: entry.firstOver.line, action: { view: 'file', file: info.file } });
      }
      if (entry.orphan) {
        addIssue('drop_file_orphan', 'info',
          `爆率文件「${info.file}」找不到对应怪物（Monster.DB / Mongen.txt）`,
          { file: info.file, action: { view: 'file', file: info.file } });
      }
    }

    // 物品缺失（聚合到物品）
    const itemList = [];
    let missingItems = 0;
    for (const item of items.values()) {
      const missing = !item.exists && !item.pseudo;
      if (missing) missingItems++;
      if (missing) {
        const first = item.entries[0];
        addIssue('drop_item_missing', 'warn',
          `掉落物品「${item.name}」不在 stditems.db（${item.entries.length} 行，首处 ${first.file}:${first.line}）`,
          {
            scope: item.name,
            file: first.file,
            line: first.line,
            action: { view: 'item', key: item.key }
          });
      }
      itemList.push({
        key: item.key,
        name: item.name,
        exists: item.exists,
        pseudo: item.pseudo,
        itemIndex: item.itemIndex,
        drops: item.entries.length,
        files: item.files.size,
        monsters: item.monsters.size,
        negative: item.negative,
        zeroDen: item.zeroDen,
        over: item.over
      });
    }
    itemList.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    // 有刷怪但没有任何爆率文件的怪物
    const spawnedMissing = [];
    for (const name of spawnNames) {
      if (fileStrips.has(stripDigits(name))) continue;
      spawnedMissing.push(name);
      addIssue('drop_monster_no_file', 'info',
        `刷怪怪物「${name}」没有对应的爆率文件`,
        { scope: name, action: { view: 'monster', name } });
    }
    spawnedMissing.sort((a, b) => a.localeCompare(b, 'zh-CN'));

    if (emptyFiles) {
      const samples = fileRows.filter((f) => f.empty).slice(0, 8).map((f) => f.file);
      addIssue('drop_file_empty', 'info',
        `${emptyFiles} 个爆率文件为空文件（${samples.join('、')}${emptyFiles > samples.length ? ' 等' : ''}）`,
        { action: { view: 'tab', tab: 'files' } });
    }

    const order = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) =>
      (order[a.severity] - order[b.severity]) ||
      String(a.code).localeCompare(String(b.code)) ||
      String(a.scope).localeCompare(String(b.scope), 'zh-CN'));

    const orphanFiles = fileRows.filter((f) => f.orphan).length;
    return {
      data: {
      generatedAt: new Date().toISOString(),
      stats: {
        files: fileRows.length,
        lines: totalLines,
        items: itemList.length,
        knownItems: itemList.filter((i) => i.exists && !i.pseudo).length,
        pseudoItems: itemList.filter((i) => i.pseudo).length,
        missingItems,
        monsters: mappedMonsters.size,
        spawned: spawnNames.size,
        spawnedMissing: spawnedMissing.length,
        emptyFiles,
        orphanFiles,
        issues: counts
      },
      items: itemList,
      files: fileRows,
      missingMonsters: spawnedMissing,
      issues
      },
      raw: { items, monsterIndex }
    };
  }

  function ensure() {
    const files = fileInfos();
    const sig = signature(files);
    if (cache && cache.sig === sig) return cache.data;
    const built = build(files);
    cache = { sig, data: built.data, raw: built.raw };
    return cache.data;
  }

  function itemDetail(key) {
    const data = ensure();
    const summary = data.items.find((i) => i.key === key);
    if (!summary) return null;
    const raw = cache.raw.items.get(key);
    if (!raw) return null;
    const groups = new Map();
    for (const entry of raw.entries) {
      const label = entry.monster || entry.file.replace(/\.txt$/i, '');
      if (!groups.has(label)) {
        groups.set(label, {
          monster: entry.monster,
          monsterIndex: entry.monster ? monsterIndexOf(entry.monster) : -1,
          files: new Set(),
          rows: []
        });
      }
      const group = groups.get(label);
      group.files.add(entry.file);
      group.rows.push({
        file: entry.file,
        line: entry.line,
        n: entry.n,
        d: entry.d,
        qty: entry.qty
      });
    }
    const out = [];
    for (const [label, group] of groups) {
      out.push({
        label,
        monster: group.monster,
        monsterIndex: group.monsterIndex,
        files: [...group.files].sort((a, b) => a.localeCompare(b, 'zh-CN')),
        rows: group.rows.slice().sort((a, b) =>
          a.file.localeCompare(b.file, 'zh-CN') || a.line - b.line)
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
    return { item: summary, groups: out };
  }

  function monsterIndexOf(name) {
    if (!cache || !cache.raw || !cache.raw.monsterIndex) return -1;
    const idx = cache.raw.monsterIndex.get(name);
    return idx == null ? -1 : idx;
  }

  function referenceInfo(fileName) {
    const clean = String(fileName == null ? '' : fileName).trim();
    if (!clean) throw new Error('缺少爆率文件名');
    const stem = clean.replace(/\.txt$/i, '');
    const base = stem.toLowerCase();
    const files = fileInfos();
    const target = files.find((f) => f.stem.toLowerCase() === base) || null;
    if (!target) {
      return {
        file: clean, stem, exists: false, monsters: [], spawns: [],
        monsterCount: 0, spawnCount: 0, spawnMaps: [], referenced: false
      };
    }

    const byLowerStem = new Map();
    const byStrip = new Map();
    for (const info of files) {
      const lower = info.stem.toLowerCase();
      if (!byLowerStem.has(lower)) byLowerStem.set(lower, []);
      byLowerStem.get(lower).push(info);
      const root = stripDigits(info.stem);
      if (!byStrip.has(root)) byStrip.set(root, []);
      byStrip.get(root).push(info);
    }

    function primaryFor(name) {
      const exact = byLowerStem.get(String(name).toLowerCase());
      if (exact && exact.length) return { file: exact[0].file, tier: 'exact' };
      const root = stripDigits(name);
      if (root !== name) {
        const rootList = byLowerStem.get(root.toLowerCase());
        if (rootList && rootList.length) return { file: rootList[0].file, tier: 'root' };
      }
      const family = byStrip.get(stripDigits(name));
      if (family && family.length) return { file: family[0].file, tier: 'family' };
      return null;
    }

    const monsters = [];
    try {
      const db = dbe.loadDb(monsterFile);
      for (let i = 0; i < db.rows.length; i++) {
        const name = String(db.rows[i].Name == null ? '' : db.rows[i].Name).trim();
        if (!name) continue;
        const primary = primaryFor(name);
        if (!primary || primary.file !== target.file) continue;
        monsters.push({ index: i, name, tier: primary.tier });
      }
    } catch (e) {
      throw new Error('Monster.DB 读取失败：' + e.message);
    }

    const spawns = [];
    try {
      const mongen = configs.parseMongen(mongenFile);
      for (const entry of mongen.entries) {
        if (!entry.monster) continue;
        const primary = primaryFor(entry.monster);
        if (!primary || primary.file !== target.file) continue;
        spawns.push({
          monster: entry.monster,
          map: entry.map,
          x: entry.x,
          y: entry.y,
          line: entry.line,
          tier: primary.tier
        });
      }
    } catch (e) {
      throw new Error('Mongen.txt 读取失败：' + e.message);
    }
    spawns.sort((a, b) =>
      String(a.map).localeCompare(String(b.map), 'zh-CN') || a.line - b.line);

    const monsterNames = [...new Set(monsters.map((m) => m.name))];
    const spawnMaps = [...new Set(spawns.map((s) => s.map).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return {
      file: target.file,
      stem: target.stem,
      exists: true,
      monsters,
      monsterNames,
      spawns,
      monsterCount: monsterNames.length,
      spawnCount: spawns.length,
      spawnMaps,
      referenced: monsterNames.length > 0 || spawns.length > 0
    };
  }

  return {
    list() {
      return ensure();
    },
    detail(key) {
      return itemDetail(key);
    },
    references(file) {
      return referenceInfo(file);
    },
    summary() {
      try {
        const d = ensure();
        return { files: d.stats.files, items: d.stats.items, issues: d.stats.issues };
      } catch (e) {
        return { error: e.message };
      }
    },
    health() {
      try {
        const raw = ensure();
        const d = raw && raw.data ? raw.data : raw;
        return { generatedAt: d.generatedAt, issues: d.issues || [] };
      } catch (e) {
        return { generatedAt: null, issues: [], error: e.message };
      }
    },
    invalidate() {
      cache = null;
    }
  };
}

module.exports = { create };

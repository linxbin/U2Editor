'use strict';

const fs = require('fs');
const path = require('path');
const dbe = require('./dbe');
const configs = require('./configs');
const npc = require('./npc');

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
  const mongenFile = path.resolve(options.mongenFile);
  const monsterFile = path.resolve(options.monsterFile);
  const mapinfoFile = path.resolve(options.mapinfoFile);
  const dropDir = path.resolve(options.dropDir);
  const mapDir = path.resolve(options.mapDir);
  let cache = null;

  function dropStems() {
    const stems = new Set();
    try {
      for (const name of fs.readdirSync(dropDir)) {
        if (/\.txt$/i.test(name)) stems.add(name.replace(/\.txt$/i, ''));
      }
    } catch (e) {
    }
    return stems;
  }

  function mapFiles() {
    const out = new Map();
    try {
      for (const name of fs.readdirSync(mapDir)) {
        if (!/\.map$/i.test(name)) continue;
        const code = name.replace(/\.map$/i, '');
        out.set(code.toLowerCase(), { file: name, full: path.join(mapDir, name), code });
      }
    } catch (e) {
    }
    return out;
  }

  function readDims(full) {
    try {
      const fd = fs.openSync(full, 'r');
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      const width = buf.readUInt16LE(0);
      const height = buf.readUInt16LE(2);
      if (!width || !height) return null;
      return { width, height };
    } catch (e) {
      return null;
    }
  }

  function signature() {
    return [
      statSig(mongenFile),
      statSig(monsterFile),
      statSig(mapinfoFile),
      statSig(dropDir),
      statSig(mapDir)
    ].join('#');
  }

  function build() {
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

    let parsed = { entries: [], special: [] };
    try {
      parsed = configs.parseMongen(mongenFile);
    } catch (e) {
      addIssue('spawn_mongen_unreadable', 'error', `Mongen.txt 读取失败：${e.message}`);
    }

    let dbNames = new Set();
    try {
      dbNames = new Set(readNames(monsterFile));
    } catch (e) {
      addIssue('spawn_monster_unreadable', 'error', `Monster.DB 读取失败：${e.message}`);
    }
    const dbLower = new Set([...dbNames].map((n) => n.toLowerCase()));

    let mapInfo = [];
    try {
      mapInfo = npc.parseMapNames(mapinfoFile);
    } catch (e) {
      addIssue('spawn_mapinfo_unreadable', 'error', `MapInfo 读取失败：${e.message}`);
    }
    const infoByLower = new Map();
    for (const item of mapInfo) infoByLower.set(item.code.toLowerCase(), item);

    const stems = dropStems();
    const strips = new Set([...stems].map(stripDigits));
    const mapFileIndex = mapFiles();
    const dimsCache = new Map();
    function dimsFor(key) {
      if (dimsCache.has(key)) return dimsCache.get(key);
      const info = mapFileIndex.get(key);
      const dims = info ? readDims(info.full) : null;
      dimsCache.set(key, dims);
      return dims;
    }

    const entries = [];
    const mapIndex = new Map();
    const monsterIndex = new Map();

    for (let i = 0; i < parsed.entries.length; i++) {
      const raw = parsed.entries[i];
      const key = raw.map.toLowerCase();
      const info = infoByLower.get(key);
      const file = mapFileIndex.get(key);
      const dims = dimsFor(key);
      const monsterExists = dbNames.has(raw.monster) || dbLower.has(raw.monster.toLowerCase());
      const hasDrop = strips.has(stripDigits(raw.monster));
      const outOfBounds = !!(dims && (raw.x >= dims.width || raw.y >= dims.height));
      const row = {
        index: i,
        line: raw.line,
        map: raw.map,
        x: raw.x,
        y: raw.y,
        monster: raw.monster,
        range: raw.range,
        count: raw.count,
        interval: raw.interval,
        extra: raw.extra,
        monsterExists,
        hasDrop,
        outOfBounds
      };
      entries.push(row);

      if (!mapIndex.has(key)) {
        mapIndex.set(key, {
          key,
          map: info ? info.code : raw.map,
          name: info ? info.name : '',
          known: !!info,
          file: !!file,
          width: dims ? dims.width : null,
          height: dims ? dims.height : null,
          entries: 0,
          monsters: new Set(),
          points: new Set(),
          total: 0,
          outOfBounds: 0,
          missingMonsters: 0,
          noDrops: 0,
          firstIndex: i
        });
      }
      const mapRow = mapIndex.get(key);
      mapRow.entries++;
      mapRow.monsters.add(raw.monster);
      mapRow.points.add(`${raw.x},${raw.y}`);
      mapRow.total += raw.count;
      if (outOfBounds) mapRow.outOfBounds++;
      if (!monsterExists) mapRow.missingMonsters++;
      if (!hasDrop) mapRow.noDrops++;

      if (!monsterIndex.has(raw.monster)) {
        monsterIndex.set(raw.monster, {
          name: raw.monster,
          exists: monsterExists,
          drop: hasDrop,
          exactDrop: stems.has(raw.monster),
          spawns: 0,
          maps: new Set(),
          points: new Set(),
          total: 0,
          firstIndex: i
        });
      }
      const monRow = monsterIndex.get(raw.monster);
      monRow.spawns++;
      monRow.maps.add(mapRow.map);
      monRow.points.add(`${key}|${raw.x},${raw.y}`);
      monRow.total += raw.count;
    }

    const maps = [...mapIndex.values()]
      .map((m) => ({
        key: m.key,
        map: m.map,
        name: m.name,
        known: m.known,
        file: m.file,
        width: m.width,
        height: m.height,
        entries: m.entries,
        monsters: m.monsters.size,
        points: m.points.size,
        total: m.total,
        outOfBounds: m.outOfBounds,
        missingMonsters: m.missingMonsters,
        noDrops: m.noDrops,
        firstIndex: m.firstIndex
      }))
      .sort((a, b) => a.map.localeCompare(b.map, 'zh-CN'));

    const monsters = [...monsterIndex.values()]
      .map((m) => ({
        name: m.name,
        exists: m.exists,
        drop: m.drop,
        exactDrop: m.exactDrop,
        spawns: m.spawns,
        maps: m.maps.size,
        mapNames: [...m.maps],
        points: m.points.size,
        total: m.total,
        firstIndex: m.firstIndex
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    let oobEntries = 0;
    let duplicateGroups = 0;
    let duplicateRows = 0;
    let extraRows = 0;
    const dupIndex = new Map();
    for (const row of entries) {
      if (row.outOfBounds) {
        oobEntries++;
        const mapRow = mapIndex.get(row.map.toLowerCase());
        addIssue('spawn_coord_over', 'warn',
          `刷怪坐标越界：${row.map} ${row.x},${row.y}「${row.monster}」（地图 ${mapRow.width}x${mapRow.height}）`,
          {
            scope: row.map, file: 'Mongen.txt', line: row.line + 1,
            action: { view: 'entry', index: row.index, map: row.map.toLowerCase() }
          });
      }
      if (row.extra.length) extraRows++;
      const dkey = `${row.map.toLowerCase()}|${row.x}|${row.y}|${row.monster}`;
      if (!dupIndex.has(dkey)) dupIndex.set(dkey, []);
      dupIndex.get(dkey).push(row);
    }

    for (const list of dupIndex.values()) {
      if (list.length < 2) continue;
      duplicateGroups++;
      duplicateRows += list.length;
      if (duplicateGroups === 1) {
        const first = list[0];
        addIssue('spawn_duplicate', 'info',
          `${duplicateGroups} 组完全重复的刷怪点（含 ${duplicateRows} 行），首处 ${first.map} ${first.x},${first.y}「${first.monster}」`,
          {
            file: 'Mongen.txt', line: first.line + 1,
            action: { view: 'entry', index: first.index, map: first.map.toLowerCase() }
          });
      }
    }
    if (duplicateGroups > 1) {
      const issue = issues.find((it) => it.code === 'spawn_duplicate');
      if (issue) {
        issue.message = `${duplicateGroups} 组完全重复的刷怪点（含 ${duplicateRows} 行）`;
      }
    }

    if (extraRows) {
      const first = entries.find((row) => row.extra.length);
      addIssue('spawn_extra', 'info', `${extraRows} 条刷怪行带额外参数（如「${first.monster}」的多余字段）`, {
        file: 'Mongen.txt', line: first.line + 1,
        action: { view: 'entry', index: first.index, map: first.map.toLowerCase() }
      });
    }

    if (parsed.special.length) {
      const first = parsed.special[0];
      addIssue('spawn_line_invalid', 'info',
        `${parsed.special.length} 行非刷怪内容（如第 ${first.line + 1} 行「${first.text.trim()}」）`,
        { file: 'Mongen.txt', line: first.line + 1, action: { view: 'tab', tab: 'maps' } });
    }

    for (const row of maps) {
      if (!row.known) {
        addIssue('spawn_map_unknown', 'warn',
          `刷怪地图「${row.map}」不在 MapInfo 中（${row.entries} 条规则）`,
          {
            scope: row.map, file: 'Mongen.txt', line: null,
            action: { view: 'map', key: row.key }
          });
      }
      if (!row.file) {
        addIssue('spawn_map_file_missing', 'warn',
          `地图「${row.map}」缺少地图文件 ${row.map}.map（${row.entries} 条规则）`,
          {
            scope: row.map, file: 'Mongen.txt', line: null,
            action: { view: 'map', key: row.key }
          });
      }
    }

    for (const row of monsters) {
      if (!row.exists) {
        const first = entries[row.firstIndex];
        addIssue('spawn_monster_missing', 'warn',
          `刷怪怪物「${row.name}」不在 Monster.DB（${row.spawns} 条规则）`,
          {
            scope: row.name, file: 'Mongen.txt', line: first.line + 1,
            action: { view: 'monster', name: row.name }
          });
      }
      if (!row.drop) {
        const first = entries[row.firstIndex];
        addIssue('spawn_monster_no_drop', 'info',
          `刷怪怪物「${row.name}」没有对应的爆率文件`,
          {
            scope: row.name, file: 'Mongen.txt', line: first.line + 1,
            action: { view: 'monster', name: row.name }
          });
      }
    }

    const stats = {
      entries: entries.length,
      maps: maps.length,
      monsters: monsters.length,
      knownMaps: maps.filter((m) => m.known).length,
      mapsUnknown: maps.filter((m) => !m.known).length,
      mapFilesMissing: maps.filter((m) => !m.file).length,
      oobEntries,
      missingMonsters: monsters.filter((m) => !m.exists).length,
      noDropMonsters: monsters.filter((m) => !m.drop).length,
      duplicateGroups,
      duplicateRows,
      extraRows,
      invalidLines: parsed.special.length,
      issues: counts
    };

    return {
      data: { generatedAt: new Date().toISOString(), stats, maps, monsters, issues },
      raw: { entries, mapIndex, monsterIndex }
    };
  }

  function ensure() {
    const sig = signature();
    if (cache && cache.sig === sig) return cache;
    const built = build();
    cache = { sig, data: built.data, raw: built.raw };
    return cache;
  }

  function list() {
    return ensure().data;
  }

  function summary() {
    const d = ensure().data;
    return {
      entries: d.stats.entries,
      maps: d.stats.maps,
      monsters: d.stats.monsters,
      issues: d.stats.issues
    };
  }

  function detail(key) {
    const cacheData = ensure();
    const mapKey = String(key || '').toLowerCase();
    const mapRow = cacheData.raw.mapIndex.get(mapKey);
    if (!mapRow) return null;
    const rows = cacheData.raw.entries.filter((row) => row.map.toLowerCase() === mapKey);
    return {
      generatedAt: cacheData.data.generatedAt,
      map: cacheData.data.maps.find((m) => m.key === mapKey),
      entries: rows
    };
  }

  function health() {
    try {
      const d = ensure().data;
      return { generatedAt: d.generatedAt, issues: d.issues || [] };
    } catch (e) {
      return { generatedAt: null, issues: [], error: e.message };
    }
  }

  function invalidate() {
    cache = null;
  }

  return { list, summary, detail, invalidate, health };
}

module.exports = { create };

'use strict';

const fs = require('fs');
const path = require('path');
const configs = require('./configs');
const npc = require('./npc');
const mapinfo = require('./mapinfo');
const maprefs = require('./maprefs');

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function lower(value) {
  return String(value == null ? '' : value).toLowerCase();
}

function create(options) {
  const mapinfoFile = path.resolve(options.mapinfoFile);
  const mapDir = path.resolve(options.mapDir);
  const npcFile = path.resolve(options.npcFile);
  const mongenFile = path.resolve(options.mongenFile);
  const miniMapFile = path.resolve(options.miniMapFile);
  const miniListFile = path.resolve(options.miniListFile);
  const scriptDir = path.resolve(options.scriptDir || path.join(path.dirname(npcFile), 'NPCScript'));
  let cache = null;

  function signature() {
    return [
      statSig(mapinfoFile),
      statSig(mapDir),
      statSig(npcFile),
      statSig(mongenFile),
      statSig(miniMapFile),
      statSig(miniListFile),
      maprefs.signature(scriptDir)
    ].join('#');
  }

  function mapFiles() {
    const out = new Map();
    try {
      for (const name of fs.readdirSync(mapDir)) {
        if (!/\.map$/i.test(name)) continue;
        const code = name.replace(/\.map$/i, '');
        out.set(lower(code), { file: name, full: path.join(mapDir, name), code });
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

  function parseMiniMap(file) {
    const { lines } = configs.readFileLines(file);
    const rows = [];
    for (let li = 0; li < lines.length; li++) {
      const s = lines[li].trim();
      if (!s || s.startsWith(';') || s.startsWith('#')) continue;
      const tok = s.split(/\s+/);
      if (tok.length < 2) continue;
      rows.push({ map: tok[0], mini: tok[1], line: li });
    }
    return rows;
  }

  function parseMiniList(file) {
    const { lines } = configs.readFileLines(file);
    const rows = [];
    let section = '';
    for (let li = 0; li < lines.length; li++) {
      const s = lines[li].trim();
      if (!s || s.startsWith(';') || s.startsWith('#')) continue;
      const head = /^\[([^\]]+)\]/.exec(s);
      if (head) {
        section = head[1].trim().toUpperCase();
        continue;
      }
      if (section !== 'WORLD MAP' && section !== 'AREA MAP') continue;
      const tok = s.split(',').map((v) => v.trim());
      if (tok.length < 3 || !tok[0]) continue;
      rows.push({ map: tok[0], mini: tok[1] || '', name: tok[2], section, line: li });
    }
    return rows;
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
        key: e.key || lower(e.scope),
        file: e.file || '',
        line: e.line == null ? null : e.line,
        action: e.action || null
      });
      counts[severity]++;
    }

    let infoRows = [];
    try {
      infoRows = npc.parseMapNames(mapinfoFile);
    } catch (e) {
      addIssue('map_mapinfo_unreadable', 'error', `MapInfo 读取失败：${e.message}`);
    }

    let parsedRules = null;
    try {
      parsedRules = mapinfo.parseMapInfo(mapinfoFile);
    } catch (e) {
      addIssue('map_rules_unreadable', 'error', `MapInfo 规则读取失败：${e.message}`);
    }

    let npcParsed = { rows: [] };
    try {
      npcParsed = npc.parseNpc(npcFile);
    } catch (e) {
      addIssue('map_npc_unreadable', 'error', `NPCList.txt 读取失败：${e.message}`);
    }

    let mongenParsed = { entries: [], special: [] };
    try {
      mongenParsed = configs.parseMongen(mongenFile);
    } catch (e) {
      addIssue('map_mongen_unreadable', 'error', `Mongen.txt 读取失败：${e.message}`);
    }

    let miniRows = [];
    try {
      miniRows = parseMiniMap(miniMapFile);
    } catch (e) {
      addIssue('map_minimap_unreadable', 'error', `MiniMap.txt 读取失败：${e.message}`);
    }

    let miniListRows = [];
    try {
      miniListRows = parseMiniList(miniListFile);
    } catch (e) {
      addIssue('map_minilist_unreadable', 'error', `minmaplist.txt 读取失败：${e.message}`);
    }

    const infoByKey = new Map();
    for (const item of infoRows) infoByKey.set(lower(item.code), item);
    const fileIndex = mapFiles();
    const dimsCache = new Map();

    let scriptRefs = [];
    let scriptByCode = new Map();
    try {
      const known = new Set();
      for (const item of infoRows) known.add(String(item.code || '').trim().toUpperCase());
      for (const item of fileIndex.values()) known.add(String(item.code || '').trim().toUpperCase());
      const scanned = maprefs.scan(scriptDir, known);
      scriptRefs = scanned.refs;
      scriptByCode = scanned.byCode;
    } catch (e) {
      addIssue('map_scripts_unreadable', 'error', `NPC 脚本地图引用扫描失败：${e.message}`);
    }

    const maps = new Map();
    const PRIORITY = { mapinfo: 0, file: 1, minilist: 2, minimap: 3, npc: 4, spawn: 5, script: 6 };
    function ensureMap(code, source, canonical) {
      const key = lower(code);
      if (!key) return null;
      let row = maps.get(key);
      if (!row) {
        row = {
          key,
          map: String(code || '').trim(),
          name: '',
          known: false,
          file: false,
          width: null,
          height: null,
          mini: '',
          miniName: '',
          world: '',
          npcs: 0,
          spawns: 0,
          scripts: 0,
          scriptFiles: new Set(),
          scriptRows: [],
          spawnTotal: 0,
          spawnMonsters: new Set(),
          spawnPoints: new Set(),
          jumpOut: 0,
          jumpIn: 0,
          safeAreas: 0,
          areas: 0,
          properties: 0,
          priority: 99,
          used: new Set(),
          npcRows: [],
          spawnRows: [],
          ruleRows: {},
          order: maps.size
        };
        maps.set(key, row);
      }
      const realCode = canonical === false ? row.map : String(code || '').trim();
      if (canonical !== false && PRIORITY[source] < row.priority && realCode) {
        row.map = realCode;
        row.priority = PRIORITY[source];
      }
      row.used.add(source);
      return row;
    }

    for (const item of infoRows) {
      const row = ensureMap(item.code, 'mapinfo');
      if (!row) continue;
      row.known = true;
      row.name = item.name || row.name;
    }

    for (const item of fileIndex.values()) {
      const row = ensureMap(item.code, 'file');
      if (!row) continue;
      row.file = true;
    }

    const miniByKey = new Map();
    for (const item of miniRows) {
      const row = ensureMap(item.map, 'minimap');
      if (!row) continue;
      if (!row.mini) row.mini = item.mini;
      if (!miniByKey.has(row.key)) miniByKey.set(row.key, { row, line: item.line });
      row.used.add('minimap');
    }

    const miniNameByCode = new Map();
    for (const item of miniListRows) {
      const row = ensureMap(item.map, 'minilist');
      if (!row) continue;
      if (!row.mini) row.mini = item.mini;
      if (!row.miniName && item.name) row.miniName = item.name;
      if (!row.name && item.name) row.name = item.name;
      if (!row.world) row.world = item.section;
      if (!miniNameByCode.has(item.mini)) miniNameByCode.set(item.mini, item.name);
      row.used.add('minilist');
    }

    function dimsFor(key) {
      if (dimsCache.has(key)) return dimsCache.get(key);
      const info = fileIndex.get(key);
      const dims = info ? readDims(info.full) : null;
      dimsCache.set(key, dims);
      return dims;
    }

    for (const row of maps.values()) {
      const dims = dimsFor(row.key);
      row.width = dims ? dims.width : null;
      row.height = dims ? dims.height : null;
      if (!row.miniName && row.mini) row.miniName = miniNameByCode.get(row.mini) || '';
    }

    function oob(row, x, y) {
      return !!(row && row.width && row.height && (x >= row.width || y >= row.height));
    }

    const npcRows = [];
    for (let i = 0; i < npcParsed.rows.length; i++) {
      const raw = npcParsed.rows[i];
      const mapRow = ensureMap(raw.map, 'npc');
      if (!mapRow) continue;
      const item = {
        index: i,
        id: raw.id,
        name: raw.name,
        script: raw.script,
        map: raw.map,
        x: raw.x,
        y: raw.y,
        line: raw.line,
        outOfBounds: oob(mapRow, raw.x, raw.y)
      };
      mapRow.npcs++;
      mapRow.npcRows.push(item);
      npcRows.push(item);
      if (item.outOfBounds) {
        addIssue('map_npc_coord_over', 'warn',
          `NPC「${item.name}」坐标越界：${raw.map} ${raw.x},${raw.y}（地图 ${mapRow.map} ${mapRow.width}x${mapRow.height}）`,
          {
            scope: mapRow.map, key: mapRow.key, file: 'NPCList.txt', line: raw.line + 1,
            action: { view: 'npc', index: i, key: mapRow.key }
          });
      }
    }

    const spawnRows = [];
    for (let i = 0; i < mongenParsed.entries.length; i++) {
      const raw = mongenParsed.entries[i];
      const mapRow = ensureMap(raw.map, 'spawn');
      if (!mapRow) continue;
      const item = {
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
        outOfBounds: oob(mapRow, raw.x, raw.y)
      };
      mapRow.spawns++;
      mapRow.spawnTotal += raw.count;
      mapRow.spawnMonsters.add(raw.monster);
      mapRow.spawnPoints.add(`${raw.x},${raw.y}`);
      mapRow.spawnRows.push(item);
      spawnRows.push(item);
      if (item.outOfBounds) {
        addIssue('map_spawn_coord_over', 'warn',
          `刷怪坐标越界：${raw.map} ${raw.x},${raw.y}「${raw.monster}」（地图 ${mapRow.map} ${mapRow.width}x${mapRow.height}）`,
          {
            scope: mapRow.map, key: mapRow.key, file: 'Mongen.txt', line: raw.line + 1,
            action: { view: 'spawn', index: i, map: mapRow.key }
          });
      }
    }

    for (const ref of scriptRefs) {
      const mapRow = ensureMap(ref.code, 'script');
      if (!mapRow) continue;
      mapRow.scripts++;
      mapRow.scriptFiles.add(ref.file);
      mapRow.scriptRows.push({
        file: ref.file,
        line: ref.line,
        text: ref.text,
        kind: ref.kind
      });
    }

    const ruleTotals = { jump: 0, nofight: 0, sabukarea: 0, sabukjump: 0, redvillage: 0, property: 0, plantrange: 0 };
    function addRule(sectionKey, values, line, index) {
      let mapRow = maps.get(lower(values.map));
      if (!mapRow && sectionKey !== 'property') mapRow = ensureMap(values.map, 'rule');
      if (!mapRow) return null;
      if (!mapRow.ruleRows[sectionKey]) mapRow.ruleRows[sectionKey] = [];
      const item = { index, line, values, section: sectionKey };
      mapRow.ruleRows[sectionKey].push(item);
      ruleTotals[sectionKey]++;
      return { mapRow, item };
    }

    if (parsedRules) {
      for (const def of mapinfo.SECTIONS) {
        const sec = parsedRules.sections[def.key];
        if (!sec) continue;
        for (const raw of sec.rows) {
          const added = addRule(def.key, raw.values, raw.line, raw.index);
          if (!added) continue;
          const { mapRow, item } = added;
          if (def.kind === 'jump') {
            if (oob(mapRow, raw.values.x, raw.values.y)) {
              addIssue('map_rule_coord_over', 'warn',
                `${def.label}坐标越界：${raw.values.map} ${raw.values.x},${raw.values.y}（地图 ${mapRow.map} ${mapRow.width}x${mapRow.height}）`,
                {
                  scope: mapRow.map, key: mapRow.key, file: 'MapInfo', line: raw.line + 1,
                  action: { view: 'rule', key: mapRow.key, section: def.key }
                });
            }
            const destRow = maps.get(lower(raw.values.dest)) || ensureMap(raw.values.dest, 'reference');
            const destKnown = infoByKey.has(lower(raw.values.dest));
            if (destRow) {
              destRow.jumpIn++;
              item.destKey = destRow.key;
              item.destKnown = destKnown;
              item.destFile = destRow.file;
              item.destOutOfBounds = oob(destRow, raw.values.dx, raw.values.dy);
              if (!destKnown) {
                addIssue('map_jump_target_missing', 'warn',
                  `跳转目标地图「${raw.values.dest}」不在 MapInfo（源 ${raw.values.map} ${raw.values.x},${raw.values.y}）`,
                  {
                    scope: mapRow.map, key: mapRow.key, file: 'MapInfo', line: raw.line + 1,
                    action: { view: 'rule', key: mapRow.key, section: def.key }
                  });
              } else if (item.destOutOfBounds) {
                addIssue('map_jump_target_over', 'warn',
                  `跳转目标坐标越界：${raw.values.map} -> ${raw.values.dest} ${raw.values.dx},${raw.values.dy}` +
                  `（目标地图 ${destRow.map} ${destRow.width}x${destRow.height}）`,
                  {
                    scope: mapRow.map, key: mapRow.key, file: 'MapInfo', line: raw.line + 1,
                    action: { view: 'rule', key: mapRow.key, section: def.key }
                  });
              }
            }
            mapRow.jumpOut++;
          } else if (def.kind === 'area' || def.kind === 'nofight') {
            if (def.key === 'nofight') mapRow.safeAreas++;
            else mapRow.areas++;
            if (oob(mapRow, raw.values.x, raw.values.y)) {
              addIssue('map_rule_coord_over', 'warn',
                `${def.label}坐标越界：${raw.values.map} ${raw.values.x},${raw.values.y}（地图 ${mapRow.map} ${mapRow.width}x${mapRow.height}）`,
                {
                  scope: mapRow.map, key: mapRow.key, file: 'MapInfo', line: raw.line + 1,
                  action: { view: 'rule', key: mapRow.key, section: def.key }
                });
            }
          } else if (def.kind === 'property') {
            mapRow.properties++;
          }
        }
        for (const special of sec.special) {
          addIssue('map_rule_unparsed', 'info',
            `MapInfo ${def.label}第 ${special.line + 1} 行无法解析：${special.text.trim()}`,
            {
              file: 'MapInfo', line: special.line + 1,
              action: { view: 'rule', key: '', section: def.key }
            });
        }
      }
    }

    function refParts(row) {
      const parts = [];
      if (row.npcs) parts.push(`NPC ${row.npcs} 个`);
      if (row.spawns) parts.push(`刷怪 ${row.spawns} 条`);
      if (row.scripts) parts.push(`脚本 ${row.scripts} 处`);
      return parts;
    }

    for (const row of maps.values()) {
      const refs = row.npcs + row.spawns + row.scripts;
      if (row.known && row.file) row.status = 'registered';
      else if (row.known) row.status = 'missing_file';
      else if (row.file && refs > 0) row.status = 'register_needed';
      else if (!row.file && refs > 0) row.status = 'invalid_ref';
      else if (row.file) row.status = 'orphan_file';
      else row.status = 'unknown';

      if (row.status === 'register_needed') {
        addIssue('map_register_needed', 'warn',
          `地图「${row.map}」有地图文件，被 ${refParts(row).join('、')} 引用，但未在 MapInfo 登记`,
          {
            scope: row.map, key: row.key, file: 'MapInfo',
            action: { view: 'map', key: row.key }
          });
      } else if (row.status === 'invalid_ref') {
        const firstScript = row.scriptRows[0];
        const onlyScript = row.npcs === 0 && row.spawns === 0 && row.scripts > 0;
        const action = onlyScript && firstScript
          ? { view: 'script', name: firstScript.file, line: firstScript.line }
          : { view: 'map', key: row.key };
        addIssue('map_ref_invalid', 'warn',
          `地图「${row.map}」未在 MapInfo 登记且缺少地图文件，被 ${refParts(row).join('、')} 引用；` +
          '引用不会生效，请核对清理或补充地图文件',
          {
            scope: row.map, key: row.key,
            file: onlyScript && firstScript ? firstScript.file : 'MapInfo',
            line: onlyScript && firstScript ? firstScript.line : null,
            action
          });
      } else if (row.status === 'orphan_file') {
        addIssue('map_file_orphan', 'info',
          `地图文件「${row.map}.map」存在，但未在 MapInfo 登记，也没有 NPC、刷怪或脚本引用`,
          {
            scope: row.map, key: row.key, file: row.map + '.map',
            action: { view: 'map', key: row.key }
          });
      } else if (row.status === 'missing_file') {
        addIssue('map_file_missing', 'warn',
          `地图「${row.map}」已在 MapInfo 登记，但缺少地图文件 ${row.map}.map`,
          {
            scope: row.map, key: row.key, file: 'MapInfo',
            action: { view: 'map', key: row.key }
          });
      }
    }

    const mapList = [...maps.values()]
      .map((row) => ({
        key: row.key,
        map: row.map,
        name: row.name,
        known: row.known,
        file: row.file,
        width: row.width,
        height: row.height,
        mini: row.mini,
        miniName: row.miniName,
        world: row.world,
        npcs: row.npcs,
        spawns: row.spawns,
        scripts: row.scripts,
        scriptFiles: row.scriptFiles.size,
        refs: row.npcs + row.spawns + row.scripts,
        status: row.status,
        spawnTotal: row.spawnTotal,
        spawnMonsters: row.spawnMonsters.size,
        spawnPoints: row.spawnPoints.size,
        jumpOut: row.jumpOut,
        jumpIn: row.jumpIn,
        safeAreas: row.safeAreas,
        areas: row.areas,
        properties: row.properties,
        rules: Object.values(row.ruleRows).reduce((n, rows) => n + rows.length, 0),
        used: [...row.used]
      }))
      .sort((a, b) => a.map.localeCompare(b.map, 'zh-CN', { numeric: true, sensitivity: 'base' }));

    const attention = new Set();
    for (const issue of issues) {
      if (issue.severity !== 'info' && issue.key) attention.add(issue.key);
    }
    for (const row of mapList) row.attention = attention.has(row.key);

    const stats = {
      maps: mapList.length,
      registered: mapList.filter((m) => m.known).length,
      mapFiles: mapList.filter((m) => m.file).length,
      filesOrphan: mapList.filter((m) => m.status === 'orphan_file').length,
      usageUnknown: mapList.filter((m) => !m.known && m.refs > 0).length,
      registerSuggested: mapList.filter((m) => m.status === 'register_needed').length,
      restoreSuggested: mapList.filter((m) => m.status === 'invalid_ref').length,
      filesMissing: mapList.filter((m) => m.status === 'missing_file').length,
      scriptRefs: scriptRefs.length,
      scriptUnknown: [...scriptByCode.keys()].filter((key) => !infoByKey.has(key)).length,
      npcs: npcRows.length,
      spawns: spawnRows.length,
      rules: Object.values(ruleTotals).reduce((n, v) => n + v, 0),
      rulesBySection: ruleTotals,
      oob: issues.filter((i) => i.code.endsWith('_coord_over') || i.code === 'map_jump_target_over').length,
      issues: counts
    };

    return { data: { generatedAt: new Date().toISOString(), stats, maps: mapList, issues }, raw: maps };
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
      maps: d.stats.maps,
      registered: d.stats.registered,
      npcs: d.stats.npcs,
      spawns: d.stats.spawns,
      issues: d.stats.issues
    };
  }

  function detail(key) {
    const cacheData = ensure();
    const mapKey = lower(key);
    const row = cacheData.raw.get(mapKey);
    if (!row) return null;
    const map = cacheData.data.maps.find((m) => m.key === mapKey);
    const rules = {};
    for (const def of mapinfo.SECTIONS) {
      rules[def.key] = (row.ruleRows[def.key] || []).map((item) => ({
        index: item.index,
        line: item.line,
        values: item.values,
        destKey: item.destKey,
        destKnown: item.destKnown,
        destFile: item.destFile,
        destOutOfBounds: item.destOutOfBounds
      }));
    }
    const npcs = row.npcRows.slice().sort((a, b) => a.y - b.y || a.x - b.x || a.name.localeCompare(b.name, 'zh-CN'));
    const spawns = row.spawnRows.slice().sort((a, b) => a.x - b.x || a.y - b.y || a.monster.localeCompare(b.monster, 'zh-CN'));
    const scripts = row.scriptRows.slice()
      .sort((a, b) => a.file.localeCompare(b.file, 'zh-CN') || a.line - b.line)
      .slice(0, 500);
    const incoming = [];
    if (map && map.jumpIn) {
      for (const other of cacheData.data.maps) {
        if (!other || other.key === mapKey) continue;
        const otherRow = cacheData.raw.get(other.key);
        const jumps = (otherRow.ruleRows.jump || []).concat(otherRow.ruleRows.sabukjump || []);
        for (const item of jumps) {
          if (item.destKey === mapKey) {
            incoming.push({
              index: item.index,
              line: item.line,
              section: item.section,
              values: item.values,
              sourceKey: other.key,
              sourceMap: other.map
            });
          }
        }
      }
    }
    incoming.sort((a, b) => a.values.map.localeCompare(b.values.map, 'zh-CN', { numeric: true }) ||
      a.values.x - b.values.x || a.values.y - b.values.y);
    return {
      generatedAt: cacheData.data.generatedAt,
      map,
      npcs,
      spawns,
      scripts,
      scriptTotal: row.scriptRows.length,
      scriptFileCount: row.scriptFiles.size,
      rules,
      incoming,
      issues: cacheData.data.issues.filter((it) => it.key === mapKey)
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

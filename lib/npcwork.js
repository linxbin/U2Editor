'use strict';

const fs = require('fs');
const path = require('path');
const npcData = require('./npc');
const gbk = require('./gbk');
const dbe = require('./dbe');
const activityData = require('./activity');

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function scriptNameOk(name) {
  return typeof name === 'string' && /^[^\\/:*?"<>|]+\.py$/i.test(name);
}

function scriptBase(name) {
  return String(name || '').replace(/\.py$/i, '');
}

function create(options) {
  const scriptDir = options.scriptDir;
  const npcFile = options.npcFile;
  const mapInfoFile = options.mapInfoFile;
  const itemNames = options.itemNames || (() => {
    const { rows } = dbe.loadDb(options.itemFile);
    return new Set(rows.map((r) => String(r.Name == null ? '' : r.Name).trim()).filter(Boolean));
  });
  const taskWorkbench = options.taskWorkbench || null;
  let cache = null;

  function scriptListing() {
    const list = [];
    let names = [];
    try {
      names = fs.readdirSync(scriptDir).filter((n) => /\.py$/i.test(n)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    } catch (e) {
      return { list, sig: 'missing' };
    }
    for (const name of names) {
      try {
        const st = fs.statSync(path.join(scriptDir, name));
        list.push({ name, size: st.size, mtime: st.mtimeMs });
      } catch (e) {
        list.push({ name, size: 0, mtime: 0 });
      }
    }
    return { list, sig: list.map((s) => `${s.name}:${s.size}:${s.mtime}`).join(',') };
  }

  function signature(scripts) {
    return [
      'npc|' + statSig(npcFile),
      'map|' + statSig(mapInfoFile),
      'items|' + statSig(options.itemFile || ''),
      'task|' + (taskWorkbench ? taskWorkbench.list().generatedAt : 'none'),
      'py|' + scripts.sig
    ].join(';');
  }

  function taskIndex() {
    const out = { npcTasks: new Map(), taskById: new Map(), issue: null };
    if (!taskWorkbench) return out;
    try {
      const data = taskWorkbench.list();
      const byId = new Map((data.tasks || []).map((t) => [String(t.id), t]));
      out.taskById = byId;
      for (const [name, ids] of Object.entries(data.npcTasks || {})) {
        const list = Array.isArray(ids) ? ids : [ids];
        out.npcTasks.set(String(name), list.map(Number).filter((n) => Number.isFinite(n)));
      }
    } catch (e) {
      out.issue = e.message;
    }
    return out;
  }

  function build() {
    const issues = [];
    const scripts = scriptListing();
    let npc = null;
    let npcError = null;
    try {
      npc = npcData.parseNpc(npcFile);
    } catch (e) {
      npcError = e.message;
      issues.push({ code: 'npc_list_unreadable', severity: 'error', message: `NPCList.txt 读取失败：${e.message}`, scope: '', index: null });
    }
    const rows = npc ? npc.rows : [];
    let mapNames = {};
    try {
      for (const m of npcData.parseMapNames(mapInfoFile)) mapNames[m.code] = m.name;
    } catch (e) {
      issues.push({ code: 'npc_mapinfo_unreadable', severity: 'error', message: `MapInfo 读取失败：${e.message}`, scope: '', index: null });
    }

    const scriptSet = new Map(scripts.list.map((s) => [scriptBase(s.name), s]));
    let shops = null;
    let shopError = null;
    try {
      shops = npcData.parseShops(scriptDir, rows);
    } catch (e) {
      shopError = e.message;
      issues.push({ code: 'npc_shops_unreadable', severity: 'error', message: `商店脚本读取失败：${e.message}`, scope: '', index: null });
    }
    const shopFiles = new Map((shops ? shops.files : []).map((f) => [f.base, f]));
    const shopByScript = new Map();
    for (const shop of (shops ? shops.shops : [])) {
      for (const src of shop.sources || []) {
        if (!shopByScript.has(src.base)) shopByScript.set(src.base, []);
        shopByScript.get(src.base).push(shop);
      }
    }

    const task = taskIndex();
    const items = (() => {
      try { return new Set(itemNames()); } catch (e) { return null; }
    })();
    const itemMissing = new Map();
    if (shops && items) {
      for (const file of shops.files) {
        for (const good of file.goods) {
          if (!items.has(good.item)) {
            const key = good.item;
            if (!itemMissing.has(key)) itemMissing.set(key, []);
            itemMissing.get(key).push({ file: file.name, base: file.base, line: good.line });
          }
        }
      }
    }

    const refByScript = new Map();
    const npcByName = new Map();
    const coordMap = new Map();
    const idMap = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!refByScript.has(row.script)) refByScript.set(row.script, []);
      refByScript.get(row.script).push(i);
      if (!npcByName.has(row.name)) npcByName.set(row.name, []);
      npcByName.get(row.name).push(i);
      const ckey = `${row.map}|${row.x}|${row.y}`;
      if (!coordMap.has(ckey)) coordMap.set(ckey, []);
      coordMap.get(ckey).push(i);
      if (!idMap.has(row.id)) idMap.set(row.id, []);
      idMap.get(row.id).push(i);
    }
    // NpcTaskList 的键在实测数据中对应 NPCList 的编号（个别也等于显示名）
    const taskIdsFor = (row) => task.npcTasks.get(row.id) || task.npcTasks.get(row.name) || [];

    const rowIssues = rows.map(() => ({ error: 0, warn: 0, info: 0 }));
    const add = (code, severity, message, rowIndex, extra) => {
      const issue = {
        code,
        severity,
        message,
        index: rowIndex == null ? null : rowIndex,
        script: (extra && extra.script) || '',
        line: (extra && extra.line) || 0,
        action: (extra && extra.action) || null
      };
      issues.push(issue);
      if (rowIndex != null && rowIssues[rowIndex]) rowIssues[rowIndex][severity]++;
    };

    const list = rows.map((row, i) => {
      const scriptsForRow = shopByScript.get(scriptBase(row.script)) || [];
      const sourceFiles = [];
      for (const s of scriptsForRow) {
        for (const src of s.sources || []) {
          if (!sourceFiles.includes(src.file)) sourceFiles.push(src.file);
        }
      }
      const taskIds = taskIdsFor(row);
      const exists = scriptSet.has(scriptBase(row.script));
      if (!exists) {
        add('npc_script_missing', 'warn',
          `NPC「${row.name}」引用的脚本 ${row.script}.py 不存在`, i,
          { script: scriptBase(row.script), action: { view: 'npc', search: row.name } });
      }
      if (row.map && !mapNames[row.map]) {
        add('npc_map_unknown', 'info',
          `NPC「${row.name}」的地图 ${row.map} 不在 MapInfo 中`, i,
          { script: scriptBase(row.script), action: { view: 'npc', search: row.name } });
      }
      const shopGoods = scriptsForRow.reduce((n, s) => n + (s.sources || []).reduce((m, src) => m + (shopFiles.get(src.base) ? shopFiles.get(src.base).goods.length : 0), 0), 0);
      return {
        index: i,
        id: row.id,
        name: row.name,
        script: row.script,
        scriptFile: scriptBase(row.script) + '.py',
        scriptExists: exists,
        scriptSize: exists ? (scriptSet.get(scriptBase(row.script)).size || 0) : 0,
        map: row.map,
        mapName: mapNames[row.map] || '',
        x: row.x,
        y: row.y,
        shopGoods,
        shopFiles: [...new Set(sourceFiles)],
        taskIds,
        taskCount: taskIds.length,
        issues: rowIssues[i]
      };
    });

    for (const [id, indexes] of idMap) {
      if (indexes.length < 2) continue;
      add('npc_duplicate_id', 'warn', `NPC 编号 ${id} 出现 ${indexes.length} 次`, indexes[0]);
    }
    for (const [key, indexes] of coordMap) {
      if (indexes.length < 2) continue;
      const first = rows[indexes[0]];
      add('npc_coord_duplicate', 'warn',
        `地图 ${first.map} 坐标 (${first.x}, ${first.y}) 有 ${indexes.length} 个 NPC`, indexes[0]);
    }
    for (const [name, indexes] of npcByName) {
      if (indexes.length < 2) continue;
      add('npc_name_duplicate', 'info', `NPC 名称「${name}」出现 ${indexes.length} 次`, indexes[0]);
    }

    for (const [item, hits] of itemMissing) {
      const first = hits[0];
      add('npc_shop_item_missing', 'warn',
        `${hits.length === 1 ? first.file : `${first.file} 等 ${hits.length} 处`} 的货品「${item}」不在 stditems.db`,
        null, { script: first.base, line: first.line, action: { view: 'shops', search: item } });
    }

    const referenced = new Set([...refByScript.keys()].map(scriptBase));
    const shopBases = new Set((shops ? shops.files : []).map((f) => f.base));
    const orphanScripts = [];
    for (const s of scripts.list) {
      const base = scriptBase(s.name);
      if (referenced.has(base)) continue;
      if (shopBases.has(base)) continue;
      if (base.startsWith('TaskConfig_')) continue;
      orphanScripts.push(s.name);
    }
    if (orphanScripts.length) {
      add('npc_script_orphan', 'info',
        `${orphanScripts.length} 个脚本未被 NPCList 引用（如 ${orphanScripts.slice(0, 3).join('、')}${orphanScripts.length > 3 ? ' …' : ''}）`,
        null, { action: { view: 'orphans' } });
    }

    for (const [key, ids] of task.npcTasks) {
      if (!idMap.has(key) && !npcByName.has(key) && ids.length) {
        add('npc_task_npc_missing', 'warn',
          `任务配置中的 NPC「${key}」未出现在 NPCList.txt`, null,
          { action: { view: 'tasks', search: key } });
      }
    }

    if (task.issue) {
      add('npc_task_unreadable', 'warn', `任务配置读取失败：${task.issue}`, null);
    }

    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) counts[issue.severity]++;
    issues.sort((a, b) => {
      const order = { error: 0, warn: 1, info: 2 };
      return (order[a.severity] - order[b.severity]) || String(a.code).localeCompare(String(b.code)) ||
        ((a.index == null ? -1 : a.index) - (b.index == null ? -1 : b.index));
    });

    const mapStats = new Map();
    for (const row of rows) {
      if (!mapStats.has(row.map)) mapStats.set(row.map, { name: row.map, label: mapNames[row.map] || '', count: 0 });
      mapStats.get(row.map).count++;
    }

    const rankings = [];
    for (const rank of activityData.RANKINGS) {
      if (npcByName.has(rank.npc)) rankings.push({ id: rank.id, name: rank.name, npc: rank.npc });
    }

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        npcs: rows.length,
        maps: mapStats.size,
        scripts: scripts.list.length,
        shops: shops ? shops.shops.length : 0,
        shopGoods: shops ? shops.goods : 0,
        orphanScripts: orphanScripts.length,
        issues: counts
      },
      maps: [...mapStats.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      scripts: scripts.list.map((s) => ({ name: s.name, base: scriptBase(s.name), size: s.size, referenced: referenced.has(scriptBase(s.name)), shop: shopBases.has(scriptBase(s.name)) })),
      orphans: orphanScripts,
      rankings,
      npcs: list,
      issues,
      errors: { npc: npcError, shops: shopError, tasks: task.issue },
      _raw: { rows, npc, mapNames, shops, task }
    };
  }

  function ensure() {
    const scripts = scriptListing();
    const sig = signature(scripts);
    if (cache && cache.sig === sig) return cache.data;
    const data = build();
    cache = { sig, data };
    return data;
  }

  function publicList() {
    const data = ensure();
    const { _raw, ...rest } = data;
    return rest;
  }

  function findDetail(index) {
    const data = ensure();
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n >= data.npcs.length) return null;
    const npc = data.npcs[n];
    const raw = data._raw;
    const row = raw.rows[n];
    let scriptInfo = null;
    let scriptError = null;
    if (npc.scriptExists) {
      try {
        scriptInfo = readScript(npc.scriptFile);
      } catch (e) {
        scriptError = e.message;
      }
    }
    const shop = (raw.shops ? raw.shops.shops : []).filter((s) => (s.sources || []).some((src) => src.base === npc.script));
    const tasks = npc.taskIds.map((id) => {
      const t = raw.task.taskById.get(String(id)) || null;
      return { id, name: t ? t.name : '', enabled: t ? t.enabled : false, module: t ? t.module : '' };
    });
    const rankings = data.rankings.filter((r) => r.npc === npc.name);
    const issues = data.issues.filter((issue) => issue.index === n || (issue.script && issue.script === npc.script));
    return {
      npc,
      row: { id: row.id, script: row.script, map: row.map, mapName: npc.mapName, x: row.x, y: row.y, name: row.name, extra: row.extra },
      script: scriptInfo,
      scriptError,
      shop: {
        shops: shop.map((s) => ({ id: s.id, name: s.name, map: s.map, x: s.x, y: s.y, sources: s.sources })),
        goods: shop.reduce((n2, s) => n2 + (s.sources || []).reduce((m, src) => {
          const f = (raw.shops ? raw.shops.files : []).find((x) => x.base === src.base);
          return m + (f ? f.goods.length : 0);
        }, 0), 0)
      },
      tasks,
      rankings,
      issues
    };
  }

  function readScript(name) {
    if (!scriptNameOk(name)) throw new Error('脚本名不合法');
    const file = path.resolve(scriptDir, name);
    if (path.dirname(file) !== path.resolve(scriptDir)) throw new Error('路径不合法');
    const buf = fs.readFileSync(file);
    const text = gbk.decodeText(buf);
    const st = fs.statSync(file);
    return {
      name,
      size: st.size,
      mtime: st.mtimeMs,
      encoding: gbk.encode(text).equals(buf) ? 'gbk' : 'gbk-lossy',
      lines: text.split(/\r?\n/),
      text
    };
  }

  return {
    list() {
      return publicList();
    },
    detail(index) {
      return findDetail(index);
    },
    script(name) {
      const info = readScript(name);
      const data = ensure();
      const base = scriptBase(name);
      const usedBy = data.npcs.filter((n) => n.script === base);
      const file = (data._raw.shops ? data._raw.shops.files : []).find((f) => f.base === base) || null;
      return {
        ...info,
        usedBy: usedBy.map((n) => ({ index: n.index, name: n.name, map: n.map, mapName: n.mapName })),
        shop: file ? { hasInit: file.hasInit, goods: file.goods, special: file.special, sharedNpcs: file.sharedNpcs } : null
      };
    },
    summary() {
      try {
        const d = ensure();
        return { npcs: d.stats.npcs, scripts: d.stats.scripts, issues: d.stats.issues };
      } catch (e) {
        return { error: e.message };
      }
    },
    invalidate() {
      cache = null;
    }
  };
}

module.exports = { create };

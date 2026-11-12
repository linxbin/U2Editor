'use strict';

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const npcData = require('./npc');

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function scriptBase(name) {
  return String(name || '').replace(/\.py$/i, '');
}

function scriptFile(name) {
  const base = scriptBase(name);
  return base ? base + '.py' : '';
}

function scriptNameOk(name) {
  return typeof name === 'string' && /^[^\\/:*?"<>|]+\.py$/i.test(name);
}

function lowerKey(name) {
  return String(name == null ? '' : name).toLowerCase();
}

function create(options) {
  const scriptDir = path.resolve(options.scriptDir);
  const npcFile = path.resolve(options.npcFile);
  const mapInfoFile = path.resolve(options.mapInfoFile);
  const taskWorkbench = options.taskWorkbench || null;
  let cache = null;

  function scriptListing() {
    let names = [];
    try {
      names = fs.readdirSync(scriptDir)
        .filter((n) => /\.py$/i.test(n))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    } catch (e) {
      return { list: [], sig: 'missing' };
    }
    const list = [];
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
    let taskSig = 'none';
    if (taskWorkbench) {
      try {
        taskSig = String(taskWorkbench.list().generatedAt);
      } catch (e) {
        taskSig = 'error';
      }
    }
    return [
      'npc|' + statSig(npcFile),
      'map|' + statSig(mapInfoFile),
      'task|' + taskSig,
      'py|' + scripts.sig
    ].join(';');
  }

  function parseImports(text, selfBase, known) {
    const out = new Set();
    const re = /^\s*(?:import\s+([A-Za-z_]\w*)|from\s+([A-Za-z_]\w*)\s+import|([A-Za-z_]\w*)\.initialize\s*\()/gm;
    let m;
    while ((m = re.exec(text))) {
      const dep = m[1] || m[2] || m[3];
      if (!dep || dep === selfBase) continue;
      const actual = known.get(lowerKey(dep));
      if (actual && actual.base !== selfBase) out.add(actual.base);
    }
    return [...out];
  }

  function build() {
    const generatedAt = Date.now();
    const issues = [];
    const addIssue = (code, severity, message, extra) => {
      const e = extra || {};
      issues.push({
        code,
        severity,
        message,
        file: e.file || '',
        name: e.name || '',
        line: e.line == null ? null : e.line,
        action: e.action || null
      });
    };
    const listing = scriptListing();
    const scripts = [];
    const byLowerBase = new Map();
    let lineTotal = 0;
    let byteTotal = 0;
    for (const meta of listing.list) {
      let text = '';
      let encodingOk = true;
      let readError = '';
      let buf = null;
      try {
        buf = fs.readFileSync(path.join(scriptDir, meta.name));
        text = gbk.decodeText(buf);
      } catch (e) {
        readError = e.message;
      }
      if (buf && !readError) {
        try {
          encodingOk = gbk.encode(text).equals(buf);
        } catch (e) {
          encodingOk = false;
        }
      }
      const lines = text ? text.split(/\r?\n/) : [];
      const base = scriptBase(meta.name);
      const row = {
        name: meta.name,
        base,
        size: meta.size,
        mtime: meta.mtime,
        lineCount: lines.length,
        encodingOk,
        readError,
        lines,
        text,
        issueCount: 0
      };
      scripts.push(row);
      byLowerBase.set(lowerKey(base), row);
      lineTotal += lines.length;
      byteTotal += meta.size;
      if (readError) {
        addIssue('script_unreadable', 'error', `脚本 ${meta.name} 读取失败：${readError}`, {
          file: meta.name, name: base, action: { view: 'script', name: meta.name }
        });
      } else if (!text.trim()) {
        addIssue('script_empty', 'warn', `脚本 ${meta.name} 是空文件`, {
          file: meta.name, name: base, action: { view: 'script', name: meta.name }
        });
      }
      if (text && !encodingOk) {
        addIssue('script_encoding', 'warn', `脚本 ${meta.name} 含有无法无损转回 GBK 的字符`, {
          file: meta.name, name: base, action: { view: 'script', name: meta.name }
        });
      }
    }

    let npcRows = [];
    let npcError = '';
    try {
      npcRows = npcData.parseNpc(npcFile).rows;
    } catch (e) {
      npcError = e.message;
      addIssue('script_npc_unreadable', 'error', `NPCList.txt 读取失败：${e.message}`, null);
    }
    const mapNames = new Map();
    try {
      for (const m of npcData.parseMapNames(mapInfoFile)) mapNames.set(m.code, m.name);
    } catch (e) {
      addIssue('script_mapinfo_unreadable', 'warn', `MapInfo 读取失败：${e.message}`, null);
    }

    let shops = { files: [], shops: [] };
    try {
      shops = npcData.parseShops(scriptDir, npcRows);
    } catch (e) {
      addIssue('script_shops_unreadable', 'warn', `商店脚本读取失败：${e.message}`, null);
    }
    const shopByLowerBase = new Map();
    for (const f of shops.files || []) {
      if (!shopByLowerBase.has(lowerKey(f.base))) shopByLowerBase.set(lowerKey(f.base), f);
    }

    let taskIndex = new Map();
    let npcTasks = new Map();
    if (taskWorkbench) {
      try {
        const data = taskWorkbench.list();
        for (const task of data.tasks || []) taskIndex.set(String(task.id), task);
        const raw = data.npcTasks || {};
        for (const [key, ids] of Object.entries(raw)) {
          const list = Array.isArray(ids) ? ids : [ids];
          npcTasks.set(String(key), list.map(Number).filter((n) => Number.isFinite(n)));
        }
      } catch (e) {
        addIssue('script_tasks_unreadable', 'warn', `任务配置读取失败：${e.message}`, null);
      }
    }

    const npcsByBase = new Map();
    const tasksByBase = new Map();
    const mapsByBase = new Map();
    for (let i = 0; i < npcRows.length; i++) {
      const row = npcRows[i];
      const base = scriptBase(row.script);
      const key = lowerKey(base);
      if (!npcsByBase.has(key)) npcsByBase.set(key, []);
      npcsByBase.get(key).push({ index: i, row });
      if (!mapsByBase.has(key)) mapsByBase.set(key, new Set());
      if (row.map) mapsByBase.get(key).add(row.map);
      const ids = npcTasks.get(String(row.id)) || npcTasks.get(String(row.name)) || [];
      if (!tasksByBase.has(key)) tasksByBase.set(key, new Set());
      for (const id of ids) tasksByBase.get(key).add(id);
    }
    for (const f of shops.files || []) {
      const key = lowerKey(f.base);
      if (!mapsByBase.has(key)) mapsByBase.set(key, new Set());
      for (const map of f.maps || []) mapsByBase.get(key).add(map);
    }

    const importsByBase = new Map();
    const importedByBase = new Map();
    for (const row of scripts) {
      const deps = parseImports(row.text, row.base, byLowerBase);
      importsByBase.set(lowerKey(row.base), deps);
      for (const dep of deps) {
        const depKey = lowerKey(dep);
        if (!importedByBase.has(depKey)) importedByBase.set(depKey, []);
        const list = importedByBase.get(depKey);
        if (!list.some((x) => lowerKey(x.base) === lowerKey(row.base))) {
          list.push({ name: row.name, base: row.base });
        }
      }
    }

    const npcScripts = new Set();
    for (const row of npcRows) npcScripts.add(lowerKey(scriptBase(row.script)));

    for (const row of scripts) {
      const key = lowerKey(row.base);
      const npcs = npcsByBase.get(key) || [];
      const shop = shopByLowerBase.get(key) || null;
      const importedBy = importedByBase.get(key) || [];
      if (!npcs.length && !shop && !importedBy.length) {
        addIssue('script_orphan', 'info', `脚本 ${row.name} 未被 NPC、商店或其他脚本引用`, {
          file: row.name,
          name: row.base,
          action: { view: 'script', name: row.name }
        });
      }
    }

    const missing = new Map();
    for (let i = 0; i < npcRows.length; i++) {
      const row = npcRows[i];
      const base = scriptBase(row.script);
      const key = lowerKey(base);
      if (byLowerBase.has(key)) continue;
      if (!missing.has(key)) missing.set(key, { base: base || '（空脚本名）', count: 0, firstIndex: null, names: [] });
      const m = missing.get(key);
      m.count++;
      if (m.firstIndex == null) m.firstIndex = i;
      if (m.names.length < 6) m.names.push(row.name);
    }
    for (const m of missing.values()) {
      const file = scriptFile(m.base);
      addIssue('script_missing', 'warn',
        `NPC 引用的脚本 ${file} 不存在，共 ${m.count} 处（${m.names.join('、')}${m.count > m.names.length ? ' 等' : ''}）`,
        {
          file,
          name: scriptBase(m.base),
          action: m.firstIndex == null ? null : { view: 'npc', index: m.firstIndex }
        });
    }

    for (const issue of issues) {
      if (issue.file) {
        const row = byLowerBase.get(lowerKey(scriptBase(issue.file)));
        if (row) row.issueCount++;
      }
    }

    const issueCounts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) if (issueCounts[issue.severity] != null) issueCounts[issue.severity]++;

    const list = scripts.map((row) => {
      const key = lowerKey(row.base);
      const npcs = npcsByBase.get(key) || [];
      const shop = shopByLowerBase.get(key) || null;
      const tasks = tasksByBase.get(key) || new Set();
      const maps = mapsByBase.get(key) || new Set();
      return {
        name: row.name,
        base: row.base,
        size: row.size,
        mtime: row.mtime,
        lineCount: row.lineCount,
        encodingOk: row.encodingOk,
        npcCount: npcs.length,
        shopGoods: shop ? shop.goods.length : 0,
        taskCount: tasks.size,
        importCount: (importsByBase.get(key) || []).length,
        importedByCount: (importedByBase.get(key) || []).length,
        mapCount: maps.size,
        orphan: !npcs.length && !shop && !(importedByBase.get(key) || []).length,
        issueCount: row.issueCount
      };
    });

    const stats = {
      scripts: scripts.length,
      lines: lineTotal,
      bytes: byteTotal,
      npcRefs: npcRows.length,
      npcScripts: npcScripts.size,
      shopScripts: (shops.files || []).length,
      importedScripts: [...importedByBase.keys()].filter((key) => byLowerBase.has(key)).length,
      orphans: list.filter((r) => r.orphan).length,
      missingScripts: missing.size,
      issues: issueCounts
    };

    return {
      generatedAt,
      stats,
      scripts: list,
      issues,
      _scripts: scripts,
      _byLowerBase: byLowerBase,
      _npcsByBase: npcsByBase,
      _shopByLowerBase: shopByLowerBase,
      _tasksByBase: tasksByBase,
      _mapsByBase: mapsByBase,
      _importsByBase: importsByBase,
      _importedByBase: importedByBase,
      _taskIndex: taskIndex,
      _mapNames: mapNames
    };
  }

  function ensure() {
    const listing = scriptListing();
    const sig = signature(listing);
    if (!cache || cache.sig !== sig) {
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
      scripts: d.scripts,
      issues: d.issues
    };
  }

  function findScript(name) {
    const d = ensure();
    const wanted = scriptNameOk(name) ? scriptFile(name) : String(name || '') + '.py';
    return d._byLowerBase.get(lowerKey(scriptBase(wanted))) || null;
  }

  function detail(rawName) {
    const d = ensure();
    const row = findScript(rawName);
    if (!row) return null;
    const key = lowerKey(row.base);
    const npcs = (d._npcsByBase.get(key) || []).map(({ index, row: npc }) => ({
      index,
      id: npc.id,
      name: npc.name,
      map: npc.map,
      mapName: d._mapNames.get(npc.map) || '',
      x: npc.x,
      y: npc.y
    }));
    const shopFile = d._shopByLowerBase.get(key) || null;
    const taskIds = [...(d._tasksByBase.get(key) || new Set())];
    const tasks = taskIds.map((id) => {
      const t = d._taskIndex.get(String(id));
      return {
        id,
        name: t ? t.name : '',
        module: t ? t.module : '',
        enabled: t ? !!t.enabled : false
      };
    }).sort((a, b) => a.id - b.id);
    const maps = [...(d._mapsByBase.get(key) || new Set())]
      .map((code) => ({ code, name: d._mapNames && d._mapNames.get(code) ? d._mapNames.get(code) : '' }))
      .sort((a, b) => a.code.localeCompare(b.code, 'zh-CN'));
    return {
      generatedAt: d.generatedAt,
      name: row.name,
      base: row.base,
      size: row.size,
      mtime: row.mtime,
      lineCount: row.lineCount,
      encodingOk: row.encodingOk,
      orphan: !npcs.length && !shopFile && !(d._importedByBase.get(key) || []).length,
      lines: row.lines,
      references: {
        npcs,
        shops: shopFile ? {
          name: shopFile.name,
          base: shopFile.base,
          goodsCount: shopFile.goods.length,
          sharedNpcs: shopFile.sharedNpcs,
          maps: shopFile.maps || []
        } : null,
        tasks,
        imports: (d._importsByBase.get(key) || []).map((base) => ({ base, name: base + '.py' })),
        importedBy: d._importedByBase.get(key) || [],
        maps
      },
      issues: d.issues.filter((issue) => issue.file === row.name)
    };
  }

  function search(rawQuery, rawLimit) {
    const d = ensure();
    const query = String(rawQuery == null ? '' : rawQuery).trim();
    const limit = Math.min(1000, Math.max(1, Number(rawLimit) || 300));
    if (!query) {
      return { generatedAt: d.generatedAt, query: '', total: 0, files: 0, results: [], truncated: false, limit };
    }
    const needle = query.toLowerCase();
    const results = [];
    let total = 0;
    const files = new Set();
    for (const row of d._scripts) {
      let hit = false;
      for (let i = 0; i < row.lines.length; i++) {
        const text = row.lines[i];
        if (text.toLowerCase().indexOf(needle) < 0) continue;
        total++;
        hit = true;
        if (results.length < limit) {
          results.push({ name: row.name, line: i + 1, text: text.length > 240 ? text.slice(0, 240) : text });
        }
      }
      if (hit) files.add(row.name);
    }
    return {
      generatedAt: d.generatedAt,
      query,
      total,
      files: files.size,
      results,
      truncated: total > results.length,
      limit
    };
  }

  function summary() {
    const d = ensure();
    return { generatedAt: d.generatedAt, stats: d.stats };
  }

  function invalidate() {
    cache = null;
  }

  return { list, detail, search, summary, invalidate };
}

module.exports = { create };

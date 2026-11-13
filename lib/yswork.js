'use strict';

/* 元神工作台：只读汇总元神参数、创建入口、物品与引用，定位到现有工作台修改 */

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const configs = require('./configs');
const npcData = require('./npc');

const ENTRY_SCRIPTS = new Set(['spemagig_0', 'shadowtest']);
const SOUL_ITEMS = new Set(['昆仑玄铁', '中枢灵石', '山海精华', '草木之灵']);
const PARAM_RE = /^(?:\s*)([^\s;]+)\s+([^;]*?)(?:\s*;\s*(.*))?$/;
const SHADOW_API_RE = /user\s*\.\s*(?:getShadow|shadowIsOnline|createShadow|deleteShadow|getShadowAttribute|getShadowPhase|setShadowPhase|getShadowName|getShadowAppellation)\b/;
const CREATE_RE = /user\s*\.\s*createShadow\s*\(/;

function fileSig(file) {
  try {
    const st = fs.statSync(file);
    return st.size + ':' + st.mtimeMs;
  } catch (e) {
    return 'missing';
  }
}

function dirSig(dir, re) {
  try {
    return fs.readdirSync(dir)
      .filter((n) => re.test(n))
      .sort()
      .map((n) => n + ':' + fileSig(path.join(dir, n)))
      .join('|');
  } catch (e) {
    return 'missing';
  }
}

function baseName(name) {
  return String(name || '').replace(/\.py$/i, '');
}

function create(options) {
  const envirDir = options.envirDir;
  const npcFile = options.npcFile;
  const scriptDir = options.scriptDir;
  const gameServerIni = options.gameServerIni;
  const itemWorkbench = options.itemWorkbench;
  const globeparamsFile = path.join(envirDir, 'globeparams.txt');
  const mapInfoFile = path.join(envirDir, 'MapInfo');

  let cache = null;

  function signature() {
    return [
      fileSig(globeparamsFile),
      fileSig(gameServerIni),
      fileSig(npcFile),
      fileSig(mapInfoFile),
      fileSig(path.join(envirDir, 'DB', 'stditems.db')),
      dirSig(scriptDir, /\.py$/i),
      dirSig(path.join(envirDir, 'MonItems'), /\.txt$/i)
    ].join('#');
  }

  function readServerInfo() {
    try {
      const { lines } = configs.readFileLines(gameServerIni);
      let name = '';
      let index = '';
      for (const line of lines) {
        const m = /^\s*(ServerName|ServerIndex|ServerID|ServerPort)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) continue;
        if (m[1] === 'ServerName') name = m[2];
        else if (m[1] === 'ServerIndex') index = m[2];
      }
      return { name, index, file: path.basename(gameServerIni) };
    } catch (e) {
      return { name: '', index: '', file: path.basename(gameServerIni), error: e.message };
    }
  }

  function readParams() {
    try {
      const { lines } = configs.readFileLines(globeparamsFile);
      const rows = [];
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
        const m = PARAM_RE.exec(raw);
        if (!m) continue;
        const key = m[1];
        if (!/shadow/i.test(key) && key.toLowerCase() !== 'shadownum') continue;
        rows.push({
          key,
          value: (m[2] || '').trim(),
          comment: (m[3] || '').trim(),
          line: i + 1
        });
      }
      return { rows, file: path.basename(globeparamsFile) };
    } catch (e) {
      return { rows: [], file: path.basename(globeparamsFile), error: e.message };
    }
  }

  function scanScripts() {
    const scripts = [];
    const createSites = [];
    let files = [];
    try {
      files = fs.readdirSync(scriptDir).filter((n) => /\.py$/i.test(n));
    } catch (e) {
      return { scripts, createSites, error: e.message };
    }
    for (const file of files) {
      let raw = null;
      try {
        raw = fs.readFileSync(path.join(scriptDir, file));
      } catch (e) {
        continue;
      }
      if (!raw.toString('latin1').toLowerCase().includes('shadow')) continue;
      let text = '';
      try {
        text = gbk.decodeText(raw);
      } catch (e) {
        continue;
      }
      const lines = text.split(/\r?\n/);
      let refs = 0;
      let creates = 0;
      let func = '';
      let firstLine = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const def = /^\s*def\s+([A-Za-z_]\w*)/.exec(line);
        if (def) func = def[1];
        if (!SHADOW_API_RE.test(line)) continue;
        refs++;
        if (!firstLine) firstLine = i + 1;
        if (CREATE_RE.test(line)) {
          creates++;
          createSites.push({
            name: file,
            base: baseName(file),
            line: i + 1,
            func,
            code: line.trim().slice(0, 200)
          });
        }
      }
      if (refs) {
        scripts.push({ name: file, base: baseName(file), refs, creates, firstLine });
      }
    }
    scripts.sort((a, b) => b.refs - a.refs || a.name.localeCompare(b.name, 'zh-CN'));
    createSites.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.line - b.line);
    return { scripts, createSites };
  }

  function readNpcs(createBases) {
    const npcs = [];
    const commented = [];
    let mapNames = new Map();
    try {
      const names = npcData.parseMapNames(mapInfoFile);
      mapNames = new Map(names.map((m) => [m.code, m.name]));
    } catch (e) {
    }
    try {
      const { rows } = npcData.parseNpc(npcFile);
      rows.forEach((row, index) => {
        const base = baseName(row.script).toLowerCase();
        if (!ENTRY_SCRIPTS.has(base) && !createBases.has(base)) return;
        npcs.push({
          index,
          id: row.id,
          name: row.name,
          script: row.script,
          map: row.map,
          mapName: mapNames.get(row.map) || '',
          x: row.x,
          y: row.y,
          line: row.line + 1,
          enabled: true
        });
      });
    } catch (e) {
    }
    try {
      const { lines } = configs.readFileLines(npcFile);
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed.startsWith(';')) continue;
        const body = trimmed.replace(/^;+/, '').trim();
        const tok = body.split(/\s+/);
        if (tok.length < 2) continue;
        const base = baseName(tok[1]).toLowerCase();
        if (!ENTRY_SCRIPTS.has(base) && !createBases.has(base)) continue;
        commented.push({ line: i + 1, text: trimmed, script: tok[1], name: tok[5] || tok[0] });
      }
    } catch (e) {
    }
    return { npcs, commented };
  }

  function shadowItems() {
    let list = [];
    try {
      list = itemWorkbench.list().items || [];
    } catch (e) {
      return { items: [], dropRows: [], error: e.message };
    }
    const picked = list.filter((it) => {
      const name = String(it.name || '');
      return name.includes('元神') ||
        SOUL_ITEMS.has(name) ||
        it.stdmode === 70 || it.stdmode === 71;
    });
    const dropRows = [];
    const seen = new Set();
    let details = [];
    try {
      details = itemWorkbench.details(picked.map((it) => it.index));
    } catch (e) {
    }
    const items = picked.map((it, i) => {
      const detail = details[i] || null;
      const drops = ((detail && detail.drops) || []).map((d) => {
        const key = it.name + '|' + d.file + '|' + d.line;
        if (!seen.has(key)) {
          seen.add(key);
          dropRows.push({
            item: it.name,
            itemIndex: it.index,
            monster: d.monster,
            monsterKnown: !!d.monsterKnown,
            file: d.file,
            line: d.line
          });
        }
        return { monster: d.monster, file: d.file, line: d.line };
      });
      return {
        index: it.index,
        name: it.name,
        type: it.type,
        stdmode: it.stdmode,
        drops: drops.length,
        shops: ((detail && detail.shops) || []).length,
        tasks: ((detail && detail.tasks) || []).length,
        recipes: ((detail && detail.recipesUse) || []).length +
          ((detail && detail.recipesMake) || []).length,
        goods: ((detail && detail.goods) || []).length,
        mall: ((detail && detail.mall) || []).length,
        dropList: drops
      };
    });
    items.sort((a, b) => a.index - b.index);
    dropRows.sort((a, b) =>
      a.monster.localeCompare(b.monster, 'zh-CN') ||
      a.item.localeCompare(b.item, 'zh-CN') ||
      a.line - b.line);
    return { items, dropRows };
  }

  function build() {
    const server = readServerInfo();
    const params = readParams();
    const scanned = scanScripts();
    const createBases = new Set(scanned.createSites.map((s) => s.base.toLowerCase()));
    const npcs = readNpcs(createBases);
    const shadow = shadowItems();
    const levelRow = params.rows.find((r) => r.key.toLowerCase() === 'shadowlevel');
    const bornRow = params.rows.find((r) => r.key.toLowerCase() === 'shadowbornlevel');
    const level = levelRow && /^\d+$/.test(levelRow.value) ? Number(levelRow.value) : null;
    const bornLevel = bornRow && /^\d+$/.test(bornRow.value) ? Number(bornRow.value) : null;
    const entryOpen = npcs.npcs.length > 0 && scanned.createSites.length > 0;

    const notes = [];
    if (!scanned.createSites.length) {
      notes.push({
        tag: '开启',
        text: '脚本中未找到 user.createShadow 调用。要开启元神玩法，需要恢复或新增创建脚本；要关闭玩法，保持现状即可。'
      });
    } else if (!npcs.npcs.length) {
      notes.push({
        tag: '开启',
        text: `已找到 ${scanned.createSites.length} 处 user.createShadow 调用，但没有挂到启用的 NPC 上。开启玩法需要启用入口 NPC；关闭玩法保持现状即可。`
      });
    } else {
      notes.push({
        tag: '双向',
        text: `创建入口已启用：${npcs.npcs.length} 个入口 NPC、${scanned.createSites.length} 处 createShadow 调用。关闭玩法可注释入口 NPC 或移除创建调用；开启玩法保持入口启用即可。`
      });
    }
    if (level == null) {
      notes.push({ tag: '开启', text: '未读取到 ShadowLevel 参数，开启玩法前请确认该参数存在且数值合理。' });
    } else if (level > 200) {
      notes.push({
        tag: '关闭',
        text: `ShadowLevel=${level}，普通玩家无法达到，创建入口实际不可触发。这是关闭玩法最轻量的做法；若要开启玩法，把门槛调整到目标等级即可。`
      });
    } else {
      notes.push({
        tag: '双向',
        text: `ShadowLevel=${level}：玩家达到 ${level} 级后可通过入口 NPC 创建元神。开启玩法可直接使用；关闭玩法可调高该值，无需修改客户端。`
      });
    }
    if (bornLevel != null) {
      notes.push({
        tag: '双向',
        text: `ShadowBornLevel=${bornLevel} 控制元神出生等级，开启或调整玩法时可按区服设定修改。`
      });
    }
    notes.push({
      tag: '说明',
      text: '客户端“元神”按钮和三魂七魄界面是内置 UI：服务端配置无法隐藏或新增。关闭玩法后客户端仍可能显示入口；开启玩法则直接复用现有界面。'
    });
    notes.push({
      tag: '说明',
      text: 'GM 命令 @createshadow 不受入口开关限制：关闭玩法后若要彻底禁止创建，需要额外限制 GM 权限或脚本。'
    });
    notes.push({
      tag: '双向',
      text: '多个区若共用同一数据库，已创建的元神数据会在各区互通。无论开启还是关闭玩法，如需严格隔离请使用独立数据库。'
    });
    if (shadow.items.length) {
      notes.push({
        tag: '双向',
        text: `stditems.db 中有 ${shadow.items.length} 件元神/灵石相关物品。开启玩法时保留即可；关闭玩法时建议只清理掉落和商店来源，直接删除物品条目会造成索引偏移。`
      });
    }
    if (shadow.dropRows.length) {
      notes.push({
        tag: '双向',
        text: `${shadow.dropRows.length} 处掉落引用这些物品，可在爆率工作台逐项调整：开启玩法时保留或补充来源，关闭玩法时移除来源。`
      });
    }
    if (scanned.scripts.length) {
      notes.push({
        tag: '说明',
        text: `${scanned.scripts.length} 个脚本引用了 shadow 接口；修改入口或参数前，可在脚本工作台查看引用行，避免遗漏。`
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      root: envirDir,
      server,
      params,
      status: {
        level,
        bornLevel,
        entryOpen,
        levelReachable: level == null ? null : level <= 200,
        createSites: scanned.createSites.length,
        entryNpcs: npcs.npcs.length,
        scripts: scanned.scripts.length,
        items: shadow.items.length,
        drops: shadow.dropRows.length
      },
      npcs: npcs.npcs,
      commentedNpcs: npcs.commented,
      createSites: scanned.createSites,
      items: shadow.items,
      dropRows: shadow.dropRows,
      scripts: scanned.scripts,
      notes
    };
  }

  function ensure() {
    const sig = signature();
    if (cache && cache.sig === sig) return cache.data;
    const data = build();
    cache = { sig, data };
    return data;
  }

  return {
    list() {
      return ensure();
    },
    summary() {
      const d = ensure();
      return {
        level: d.status.level,
        bornLevel: d.status.bornLevel,
        entryOpen: d.status.entryOpen,
        npcs: d.status.entryNpcs,
        createSites: d.status.createSites,
        items: d.status.items,
        drops: d.status.drops,
        scripts: d.status.scripts
      };
    },
    invalidate() {
      cache = null;
    }
  };
}

module.exports = { create };

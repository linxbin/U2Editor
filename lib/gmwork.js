'use strict';

/* GM 工作台：GM 名单、命令白名单、GM后台入口与测试 NPC 检查。
   唯一写操作是增删 GMCmd.txt 中的整行命令，其他内容逐字节保留。 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configs = require('./configs');
const extraData = require('./extra');
const dbe = require('./dbe');

const ITEM_NAME = 'GM后台';
const CMD_FILE = 'GMCmd.txt';
const NAMES_FILE = 'GMNames.txt';
const MAPPING_FILE = 'ItemCtrl.py';
const TEST_NPC = 'ShadowTest';
const CMD_RE = /^@[A-Za-z0-9_]+$/;

function lower(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function fileSig(file) {
  try {
    const st = fs.statSync(file);
    return st.mtimeMs + ':' + st.size;
  } catch (e) {
    return 'missing';
  }
}

function dirSig(dir, re) {
  try {
    return fs.readdirSync(dir).filter((name) => re.test(name)).sort().join(',');
  } catch (e) {
    return '';
  }
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function create(options) {
  const envirDir = options.envirDir;
  const itemFile = options.itemFile;
  const itemIndex = options.itemIndex;
  const itemModes = options.itemModes;
  const npcFile = options.npcFile;
  const scriptDir = options.scriptDir;
  const mapWorkbench = options.mapWorkbench;
  const catalog = options.catalog;

  const cmdPath = path.join(envirDir, CMD_FILE);
  const namesPath = path.join(envirDir, NAMES_FILE);
  const mappingPath = path.join(scriptDir, MAPPING_FILE);
  const mapInfoPath = path.join(envirDir, 'MapInfo');
  const mapDir = path.join(envirDir, 'map');
  const shadowPy = path.join(scriptDir, TEST_NPC + '.py');
  const shadowPyc = path.join(scriptDir, TEST_NPC + '.pyc');

  let cache = null;

  function signature() {
    return [
      fileSig(namesPath),
      fileSig(cmdPath),
      fileSig(itemFile),
      fileSig(mappingPath),
      fileSig(npcFile),
      fileSig(shadowPy),
      fileSig(shadowPyc),
      fileSig(mapInfoPath),
      dirSig(mapDir, /\.map$/i)
    ].join('#');
  }

  function commandOf(line) {
    const text = String(line == null ? '' : line).trim();
    if (!text || text.startsWith(';') || text.startsWith('#')) return null;
    if (!CMD_RE.test(text)) return { invalid: true, text };
    return { name: text.slice(1).toLowerCase(), text };
  }

  function readWhitelist() {
    const out = {
      file: CMD_FILE, exists: false, sha1: '', eol: '\r\n', trailing: false,
      enabledNames: [], unknown: [], malformed: [], duplicates: []
    };
    if (!fs.existsSync(cmdPath)) return out;
    const raw = configs.readFileLines(cmdPath);
    out.exists = true;
    out.eol = raw.eol;
    out.trailing = raw.trailing;
    out.sha1 = sha1(raw.buf);
    const firstLine = new Map();
    const dupLines = new Map();
    for (let i = 0; i < raw.lines.length; i++) {
      const parsed = commandOf(raw.lines[i]);
      if (!parsed) continue;
      if (parsed.invalid) {
        out.malformed.push({ line: i + 1, text: raw.lines[i] });
        continue;
      }
      if (!catalog.byName.has(parsed.name)) {
        out.unknown.push({ line: i + 1, text: raw.lines[i], name: parsed.name });
      }
      if (firstLine.has(parsed.name)) {
        if (!dupLines.has(parsed.name)) dupLines.set(parsed.name, [firstLine.get(parsed.name)]);
        dupLines.get(parsed.name).push(i + 1);
      } else {
        firstLine.set(parsed.name, i + 1);
        out.enabledNames.push(parsed.name);
      }
    }
    out.duplicates = [...dupLines.entries()].map(([name, lines]) => ({ name, lines }));
    return out;
  }

  function readGmNames() {
    const out = { file: NAMES_FILE, exists: false, entries: [], invalid: [], duplicates: [], error: '' };
    if (!fs.existsSync(namesPath)) return out;
    out.exists = true;
    let data;
    try {
      data = extraData.parseExtra(envirDir, 'gmnames');
    } catch (e) {
      out.error = e.message;
      return out;
    }
    const counts = new Map();
    for (const row of data.rows || []) {
      const values = row.values || [];
      const name = String((Array.isArray(values) ? values[0] : values.name) || '').trim();
      const level = String((Array.isArray(values) ? values[1] : values.level) || '').trim();
      const line = Number(row.index) + 1;
      out.entries.push({ line, name, level, levelOk: /^\d+$/.test(level) });
      const key = name.toLowerCase();
      const dup = counts.get(key) || { name, lines: [] };
      dup.lines.push(line);
      counts.set(key, dup);
    }
    out.duplicates = [...counts.values()].filter((item) => item.lines.length > 1);
    out.invalid = (data.invalid || []).map((row) => ({ line: Number(row.line) + 1, text: row.text }));
    return out;
  }

  function readItem() {
    try {
      const { rows } = dbe.loadDb(itemFile);
      for (const row of rows) {
        if (String(row.Name == null ? '' : row.Name).trim() !== ITEM_NAME) continue;
        return {
          idx: Number(row.Idx),
          stdmode: Number(row.Stdmode),
          shape: Number(row.Shape),
          stock: Number(row.Stock)
        };
      }
    } catch (e) {
    }
    if (itemIndex && itemIndex.has(ITEM_NAME)) {
      return {
        idx: itemIndex.get(ITEM_NAME),
        stdmode: itemModes && itemModes.has(ITEM_NAME) ? itemModes.get(ITEM_NAME) : null,
        shape: null,
        stock: null
      };
    }
    return null;
  }

  function readMapping() {
    const out = { file: 'NPCScript/' + MAPPING_FILE, exists: false, line: null, key: '', func: '', mapCode: '', keyHasSpace: false };
    if (!fs.existsSync(mappingPath)) return out;
    out.exists = true;
    const raw = configs.readFileLines(mappingPath);
    let found = null;
    for (let i = 0; i < raw.lines.length; i++) {
      const m = /^\s*'([^']*)'\s*:\s*\{/.exec(raw.lines[i]);
      if (!m || m[1].trim() !== ITEM_NAME) continue;
      found = { line: i + 1, key: m[1], func: '', mapCode: '' };
      for (let j = i; j < Math.min(i + 10, raw.lines.length); j++) {
        const fm = /'FuncName'\s*:\s*'([^']*)'/.exec(raw.lines[j]);
        if (fm) found.func = fm[1];
        const mm = /'MapCode'\s*:\s*'([^']*)'/.exec(raw.lines[j]);
        if (mm) found.mapCode = mm[1];
        if (j > i && /\}\s*,?\s*$/.test(raw.lines[j])) break;
      }
      break;
    }
    if (found) {
      out.line = found.line;
      out.key = found.key;
      out.func = found.func;
      out.mapCode = found.mapCode;
      out.keyHasSpace = found.key !== found.key.trim();
    }
    return out;
  }

  function resolveMap(code) {
    const out = { code: String(code == null ? '' : code).trim(), exists: false, registered: false, file: false, matched: '' };
    if (!out.code) return out;
    let rows = [];
    try {
      rows = (mapWorkbench && mapWorkbench.list().maps) || [];
    } catch (e) {
      rows = [];
    }
    const key = out.code.toLowerCase();
    const exact = rows.find((row) => String(row.map || '').toLowerCase() === key) || null;
    const pref = key.charAt(0) === 'c'
      ? null
      : rows.find((row) => String(row.map || '').toLowerCase() === 'c' + key) || null;
    const real = (row) => row && (row.file || row.known);
    const row = real(exact) ? exact : (real(pref) ? pref : (exact || pref));
    if (!row) return out;
    out.exists = Boolean(row.file || row.known);
    out.registered = Boolean(row.known);
    out.file = Boolean(row.file);
    out.matched = String(row.map || '');
    return out;
  }

  function readTestNpc() {
    const out = { file: TEST_NPC + '.py', exists: false, npcLine: null };
    out.exists = fs.existsSync(shadowPy) || fs.existsSync(shadowPyc);
    if (!out.exists) return out;
    try {
      const raw = configs.readFileLines(npcFile);
      for (let i = 0; i < raw.lines.length; i++) {
        if (/(^|[\s\t])ShadowTest(\.py)?([\s\t]|$)/i.test(raw.lines[i])) {
          out.npcLine = i + 1;
          break;
        }
      }
    } catch (e) {
    }
    return out;
  }

  function buildCatalog(whitelist) {
    const enabled = new Set(whitelist.enabledNames);
    const categories = catalog.categories().map((label) => ({ key: label, label, commands: [] }));
    const byLabel = new Map(categories.map((item) => [item.label, item]));
    const commands = catalog.list();
    for (const cmd of commands) {
      const group = byLabel.get(cmd.category);
      if (!group) continue;
      group.commands.push({ name: cmd.name, desc: cmd.desc || '', enabled: enabled.has(cmd.name) });
    }
    return { categories: categories.filter((item) => item.commands.length), total: commands.length };
  }

  function build() {
    const whitelist = readWhitelist();
    const catalogData = buildCatalog(whitelist);
    const gmNames = readGmNames();
    const mapping = readMapping();
    const item = readItem();
    const map = mapping.mapCode ? resolveMap(mapping.mapCode) : null;
    const testNpc = readTestNpc();
    const issues = [];
    const counts = { error: 0, warn: 0, info: 0 };

    function addIssue(code, severity, message, extra) {
      counts[severity]++;
      issues.push(Object.assign({ code, severity, message }, extra || {}));
    }

    for (const err of catalog.selfCheck()) {
      addIssue('gm_catalog_invalid', 'error', err.message, {
        scope: 'catalog', file: 'lib/gmcmdcatalog.js', action: { section: 'commands' }
      });
    }

    if (!whitelist.exists) {
      addIssue('gm_gmcmd_missing', 'warn', '未找到 GMCmd.txt，GM 命令白名单为空；游戏内所有 GM 命令都会被拒绝。', {
        scope: CMD_FILE, file: CMD_FILE, action: { view: 'extra', key: 'gmcmd' }
      });
    } else if (!whitelist.enabledNames.length && !whitelist.malformed.length) {
      addIssue('gm_whitelist_empty', 'warn', 'GMCmd.txt 中没有有效命令，GM 将无法使用任何指令。', {
        scope: CMD_FILE, file: CMD_FILE, action: { view: 'extra', key: 'gmcmd' }
      });
    }
    for (const itemRow of whitelist.malformed) {
      addIssue('gm_whitelist_malformed', 'warn',
        `GMCmd.txt 第 ${itemRow.line} 行不是合法命令（应形如 @move）：${itemRow.text.trim()}`, {
          scope: CMD_FILE, file: CMD_FILE, line: itemRow.line, action: { view: 'extra', key: 'gmcmd' }
        });
    }
    for (const dup of whitelist.duplicates) {
      addIssue('gm_whitelist_duplicate', 'info',
        `命令 @${dup.name} 在 GMCmd.txt 中重复出现（第 ${dup.lines.join('、')} 行），建议只保留一行。`, {
          scope: '@' + dup.name, file: CMD_FILE, line: dup.lines[0], action: { view: 'extra', key: 'gmcmd' }
        });
    }
    for (const unk of whitelist.unknown) {
      addIssue('gm_whitelist_unknown', 'info',
        `白名单中的 @${unk.name}（第 ${unk.line} 行）不在内置命令目录中，请确认当前引擎支持该命令。`, {
          scope: '@' + unk.name, file: CMD_FILE, line: unk.line, action: { view: 'extra', key: 'gmcmd' }
        });
    }

    if (!gmNames.exists) {
      addIssue('gm_gmnames_missing', 'warn', '未找到 GMNames.txt，没有任何角色拥有 GM 权限。', {
        scope: NAMES_FILE, file: NAMES_FILE, action: { view: 'extra', key: 'gmnames' }
      });
    } else if (!gmNames.entries.length && !gmNames.invalid.length && !gmNames.error) {
      addIssue('gm_names_empty', 'warn', 'GMNames.txt 中没有有效名单，所有玩家都无法使用 GM 命令。', {
        scope: NAMES_FILE, file: NAMES_FILE, action: { view: 'extra', key: 'gmnames' }
      });
    }
    if (gmNames.error) {
      addIssue('gm_names_malformed', 'warn', `GMNames.txt 无法解析：${gmNames.error}`, {
        scope: NAMES_FILE, file: NAMES_FILE, action: { view: 'extra', key: 'gmnames' }
      });
    }
    for (const bad of gmNames.invalid) {
      addIssue('gm_names_malformed', 'warn',
        `GMNames.txt 第 ${bad.line} 行格式错误（应为「角色名 权限等级」）：${bad.text.trim()}`, {
          scope: NAMES_FILE, file: NAMES_FILE, line: bad.line, action: { view: 'extra', key: 'gmnames', line: bad.line }
        });
    }
    for (const dup of gmNames.duplicates) {
      addIssue('gm_names_duplicate', 'warn',
        `GM 名单中的角色「${dup.name}」重复出现（第 ${dup.lines.join('、')} 行）。`, {
          scope: dup.name, file: NAMES_FILE, line: dup.lines[0], action: { view: 'extra', key: 'gmnames', line: dup.lines[0] }
        });
    }
    for (const row of gmNames.entries) {
      if (row.levelOk) continue;
      addIssue('gm_names_level', 'warn',
        `GM 名单第 ${row.line} 行的权限「${row.level}」不是非负整数。`, {
          scope: row.name, file: NAMES_FILE, line: row.line, action: { view: 'extra', key: 'gmnames', line: row.line }
        });
    }

    if (!item) {
      addIssue('gm_backstage_item_missing', 'error', `stditems.db 中找不到「${ITEM_NAME}」物品，GM 入口已失效。`, {
        scope: ITEM_NAME, file: 'DB/stditems.db', action: { section: 'entries' }
      });
    } else if (item.stdmode !== 37) {
      addIssue('gm_backstage_item_mode', 'info',
        `「${ITEM_NAME}」的 Stdmode 为 ${item.stdmode}，常见的 GM 功能道具为 37，请确认物品类型没有被误改。`, {
          scope: ITEM_NAME, file: 'DB/stditems.db', index: item.idx, action: { view: 'item', index: item.idx }
        });
    }

    if (!mapping.line || !mapping.mapCode) {
      addIssue('gm_backstage_mapping_missing', 'error',
        `ItemCtrl.py 中没有「${ITEM_NAME}」的 moveToMap 映射，点击物品无法进入 GM 地图。`, {
          scope: ITEM_NAME, file: mapping.file, line: mapping.line, action: { view: 'script', name: MAPPING_FILE, line: mapping.line }
        });
    } else {
      if (mapping.keyHasSpace) {
        addIssue('gm_backstage_key_space', 'warn',
          `ItemCtrl.py 第 ${mapping.line} 行的映射 key「${mapping.key}」带尾随空格，与物品名不完全一致。`, {
            scope: ITEM_NAME, file: mapping.file, line: mapping.line, action: { view: 'script', name: MAPPING_FILE, line: mapping.line }
          });
      }
      if (!map || !map.exists) {
        addIssue('gm_backstage_map_unresolved', 'error',
          `「${ITEM_NAME}」映射的地图 ${mapping.mapCode} 在 MapInfo 与 map/ 目录中都不存在。`, {
            scope: mapping.mapCode, file: mapping.file, line: mapping.line, action: { section: 'entries' }
          });
      } else if (!map.registered) {
        addIssue('gm_backstage_map_not_registered', 'warn',
          `地图 ${mapping.mapCode} 只找到地图文件 ${map.matched}.map，未在 MapInfo 登记；传送到该地图可能无法加载。`, {
            scope: mapping.mapCode, file: 'MapInfo', action: { view: 'map', key: map.matched }
          });
      }
    }

    if (testNpc.exists && testNpc.npcLine) {
      addIssue('gm_test_npc_exposed', 'warn',
        `测试 NPC ShadowTest 仍被 NPCList.txt 第 ${testNpc.npcLine} 行引用，建议从生产环境移除。`, {
          scope: TEST_NPC, file: 'NPCList.txt', line: testNpc.npcLine, action: { view: 'script', name: TEST_NPC + '.py' }
        });
    }

    let enabledCatalog = 0;
    for (const group of catalogData.categories) {
      for (const cmd of group.commands) if (cmd.enabled) enabledCatalog++;
    }

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        catalog: catalogData.total,
        enabled: enabledCatalog,
        unknown: whitelist.unknown.length,
        gmCount: gmNames.entries.length,
        issues: issues.length,
        error: counts.error,
        warn: counts.warn,
        info: counts.info
      },
      whitelist,
      catalog: catalogData,
      gmNames,
      entry: { itemName: ITEM_NAME, item, mapping, map, testNpc },
      issues
    };
  }

  function ensure() {
    const sig = signature();
    if (cache && cache.sig === sig) return cache.data;
    const data = build();
    cache = { sig, data };
    return data;
  }

  function toggleWhitelist(body) {
    const changes = body && Array.isArray(body.changes) ? body.changes : null;
    if (!changes || !changes.length) throw httpError(400, 'changes 不能为空');
    if (changes.length > 500) throw httpError(400, '一次最多修改 500 条命令');
    const plan = new Map();
    for (const change of changes) {
      const name = lower(change && change.name).replace(/^@/, '');
      if (!name) throw httpError(400, '命令名不能为空');
      if (!catalog.byName.has(name)) throw httpError(400, `未收录的命令：${name}`);
      if (plan.has(name)) throw httpError(400, `命令重复：${name}`);
      if (typeof change.enabled !== 'boolean') throw httpError(400, `命令 ${name} 的 enabled 必须是布尔值`);
      plan.set(name, change.enabled);
    }

    let raw;
    if (fs.existsSync(cmdPath)) {
      raw = configs.readFileLines(cmdPath);
    } else {
      raw = { buf: Buffer.alloc(0), lines: [], eol: '\r\n', trailing: false };
    }
    const expected = String(body && body.expected != null ? body.expected : '');
    if (expected !== sha1(raw.buf)) {
      throw httpError(409, 'GMCmd.txt 已被其他操作修改，请重新加载后再保存。');
    }

    const removeLines = new Set();
    const present = new Map();
    for (let i = 0; i < raw.lines.length; i++) {
      const parsed = commandOf(raw.lines[i]);
      if (!parsed || parsed.invalid) continue;
      if (!present.has(parsed.name)) present.set(parsed.name, []);
      present.get(parsed.name).push(i);
    }

    let added = 0;
    let removed = 0;
    const appends = [];
    for (const [name, enabled] of plan) {
      if (enabled) {
        if (present.has(name)) continue;
        appends.push('@' + name);
        added++;
      } else if (present.has(name)) {
        for (const index of present.get(name)) removeLines.add(index);
        removed++;
      }
    }

    if (!added && !removed) {
      return { file: CMD_FILE, changed: false, backup: null, added: 0, removed: 0, sha1: sha1(raw.buf) };
    }

    const lines = [];
    for (let i = 0; i < raw.lines.length; i++) {
      if (!removeLines.has(i)) lines.push(raw.lines[i]);
    }
    for (const line of appends) lines.push(line);

    const backup = configs.writeFileLines(cmdPath, lines, raw.eol, lines.length ? raw.trailing : false);
    cache = null;
    const nextBuf = fs.readFileSync(cmdPath);
    return { file: CMD_FILE, changed: true, backup, added, removed, sha1: sha1(nextBuf) };
  }

  return {
    list() {
      return ensure();
    },
    summary() {
      const data = ensure();
      return {
        catalog: data.stats.catalog,
        enabled: data.stats.enabled,
        unknown: data.stats.unknown,
        gmCount: data.stats.gmCount,
        issues: data.stats.issues
      };
    },
    health() {
      const data = ensure();
      return { generatedAt: data.generatedAt, issues: data.issues };
    },
    toggleWhitelist,
    invalidate() {
      cache = null;
    }
  };
}

module.exports = { create };

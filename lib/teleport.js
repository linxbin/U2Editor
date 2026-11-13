'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gbk = require('./gbk');
const { readFileLines, writeFileLines } = require('./configs');
const { parseNpc } = require('./npc');

const FILE = 'ComTrans1.py';
const KEY_RE = /^    '([^']+)': \{$/;
const MAP_RE = /^        'map': '([^']*)',$/;
const X_RE = /^        'x': (\d+),$/;
const Y_RE = /^        'y': (\d+) \}(,| \})$/;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function toSet(value) {
  const v = typeof value === 'function' ? value() : value;
  if (v instanceof Set) return v;
  return new Set(v || []);
}

function addPatch(patches, line, start, end, text) {
  if (!patches.has(line)) patches.set(line, []);
  patches.get(line).push({ start, end, text });
}

function applyPatches(line, patches) {
  if (!patches || !patches.length) return line;
  let out = '';
  let last = 0;
  for (const patch of patches.slice().sort((a, b) => a.start - b.start)) {
    out += line.slice(last, patch.start);
    out += patch.text;
    last = patch.end;
  }
  return out + line.slice(last);
}

function buildOutput(parsed, work) {
  const out = [];
  for (let i = 0; i < parsed.lines.length; i++) {
    if (work.before.has(i)) out.push(...work.before.get(i));
    if (work.skip.has(i)) continue;
    out.push(applyPatches(parsed.lines[i], work.patches.get(i)));
  }
  out.push(...work.append);
  return out;
}

function checkKey(value) {
  const s = String(value == null ? '' : value);
  if (!/^[A-Za-z0-9_]{1,64}$/.test(s)) {
    throw httpError('NPC ID 只能包含字母、数字、下划线，长度 1-64');
  }
  return s;
}

function checkMap(value) {
  const s = String(value == null ? '' : value);
  if (!/^[A-Za-z0-9_]{1,64}$/.test(s)) {
    throw httpError('目的地地图只能包含字母、数字、下划线，长度 1-64');
  }
  return s;
}

function checkName(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw httpError('NPC 名称不能为空');
  if (/\s/.test(s)) throw httpError('NPC 名称不能包含空格或制表符');
  if (s.length > 64) throw httpError('NPC 名称太长');
  return s;
}

function checkPos(value, label) {
  if (value === '' || value === null || value === undefined) {
    throw httpError(label + ' 不能为空');
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    throw httpError(label + ' 需要 0-100000 的整数');
  }
  return n;
}

function renderEntry(entry) {
  return [
    `    '${entry.key}': {`,
    `        'map': '${entry.map}',`,
    `        'x': ${entry.x},`,
    `        'y': ${entry.y} } }`
  ];
}

function create(opts) {
  const options = opts || {};
  const scriptDir = path.resolve(options.scriptDir || '.');
  const full = path.join(scriptDir, FILE);
  const npcFile = path.resolve(options.npcFile || path.join(path.dirname(scriptDir), 'NPCList.txt'));
  const mapCodesFn = options.mapCodes || (() => []);
  const mapNamesFn = options.mapNames || (() => ({}));
  const npcAdd = options.npcAdd || null;

  function parseFile() {
    const parsed = readFileLines(full);
    const lines = parsed.lines;
    const lfCount = (parsed.text.match(/\n/g) || []).length;
    const crlfCount = (parsed.text.match(/\r\n/g) || []).length;
    const eolRaw = parsed.eol;
    const roundTrip = (() => {
      try {
        return gbk.encode(parsed.text).equals(parsed.buf);
      } catch (e) {
        return false;
      }
    })();

    const starts = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === 'NPCMAP = {') starts.push(i);
    }
    const errors = [];
    const entries = [];
    let blockStart = -1;
    let blockEnd = -1;

    if (starts.length !== 1) {
      errors.push(starts.length ? 'NPCMAP 定义出现多次' : '未找到 NPCMAP = {');
    } else {
      blockStart = starts[0];
      let i = blockStart + 1;
      while (i < lines.length) {
        if (lines[i] === '') break;
        const km = KEY_RE.exec(lines[i]);
        if (!km) {
          errors.push(`第 ${i + 1} 行不是合法的 NPCMAP 条目`);
          break;
        }
        if (i + 3 >= lines.length) {
          errors.push(`第 ${i + 1} 行条目缺少 map/x/y`);
          break;
        }
        const mm = MAP_RE.exec(lines[i + 1]);
        const xm = X_RE.exec(lines[i + 2]);
        const ym = Y_RE.exec(lines[i + 3]);
        if (!mm || !xm || !ym) {
          errors.push(`第 ${i + 1} 行起的条目格式异常`);
          break;
        }
        const yLine = lines[i + 3];
        const ySpan = {
          start: yLine.indexOf("'y': ") + 5,
          end: yLine.indexOf("'y': ") + 5 + ym[1].length
        };
        const keyStart = lines[i].indexOf("'") + 1;
        entries.push({
          key: km[1],
          keyLine: i + 1,
          startLine: i,
          endLine: i + 3,
          keySpan: {
            start: keyStart,
            end: keyStart + km[1].length
          },
          map: mm[1],
          x: Number(xm[1]),
          y: Number(ym[1]),
          mapLine: i + 1,
          mapSpan: {
            start: lines[i + 1].indexOf("'map': '") + 8,
            end: lines[i + 1].indexOf("'map': '") + 8 + mm[1].length
          },
          xSpan: {
            start: lines[i + 2].indexOf("'x': ") + 5,
            end: lines[i + 2].indexOf("'x': ") + 5 + xm[1].length
          },
          ySpan,
          suffixStart: ySpan.end,
          lineLength: yLine.length,
          closesDict: ym[2] === ' }'
        });
        i += 4;
      }
      blockEnd = i;
      if (!errors.length && i >= lines.length) errors.push('NPCMAP 后缺少空行');
      if (!errors.length && (lines[i] || '') !== '') errors.push('NPCMAP 条目后缺少空行');
      for (let j = i + 1; j < lines.length; j++) {
        if (KEY_RE.test(lines[j])) {
          errors.push('NPCMAP 块内空行后仍有条目');
          break;
        }
      }
    }

    const keys = new Set();
    for (const entry of entries) {
      if (keys.has(entry.key)) errors.push(`NPC ID 重复：${entry.key}`);
      keys.add(entry.key);
      if (entry.closesDict && entry !== entries[entries.length - 1]) {
        errors.push(`第 ${entry.keyLine} 行的字典收尾不在最后一条`);
      }
    }
    if (!entries.length) errors.push('NPCMAP 没有任何条目');
    if (entries.length && !entries[entries.length - 1].closesDict) {
      errors.push('最后一条 NPCMAP 缺少字典收尾');
    }
    if (!parsed.trailing) errors.push('文件缺少末尾换行');
    if (lfCount !== crlfCount) errors.push('文件混用了 LF/CRLF 换行');
    if (!roundTrip) errors.push('GBK 往返校验失败');

    return {
      parsed,
      lines,
      eolRaw,
      roundTrip,
      trailing: parsed.trailing,
      blockStart,
      blockEnd,
      entries,
      errors,
      hash: sha256(parsed.buf)
    };
  }

  function readNpcRows() {
    try {
      const buf = fs.readFileSync(npcFile);
      return { rows: parseNpc(npcFile).rows, error: '', hash: sha256(buf) };
    } catch (e) {
      return { rows: [], error: e.message, hash: '' };
    }
  }

  function analyze() {
    if (!fs.existsSync(full)) throw httpError(FILE + ' 不存在', 404);
    const data = parseFile();
    const npcInfo = readNpcRows();
    const npcs = npcInfo.rows;
    const npcById = new Map();
    for (const row of npcs) {
      if (!npcById.has(row.id)) npcById.set(row.id, []);
      npcById.get(row.id).push(row);
    }
    const scriptRefs = npcs.filter((row) => row.script === 'ComTrans1');
    const entryByKey = new Map(data.entries.map((entry) => [entry.key, entry]));
    const mapNames = mapNamesFn() || {};
    const unconfigured = scriptRefs
      .filter((row) => !entryByKey.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        map: row.map,
        mapName: mapNames[row.map] || '',
        x: row.x,
        y: row.y,
        line: row.line + 1
      }));
    const npcOptions = [];
    const seenNpc = new Set();
    for (const row of scriptRefs) {
      if (seenNpc.has(row.id)) continue;
      seenNpc.add(row.id);
      npcOptions.push({
        id: row.id,
        name: row.name,
        map: row.map,
        mapName: mapNames[row.map] || '',
        x: row.x,
        y: row.y,
        line: row.line + 1,
        configured: entryByKey.has(row.id)
      });
    }
    const npcCandidates = [];
    const seenCandidate = new Set();
    for (const row of npcs) {
      if (entryByKey.has(row.id) || seenCandidate.has(row.id)) continue;
      seenCandidate.add(row.id);
      npcCandidates.push({
        id: row.id,
        name: row.name,
        map: row.map,
        mapName: mapNames[row.map] || '',
        x: row.x,
        y: row.y,
        line: row.line + 1,
        script: row.script,
        compatible: row.script === 'ComTrans1'
      });
    }
    npcCandidates.sort((a, b) =>
      (b.compatible ? 1 : 0) - (a.compatible ? 1 : 0) ||
      a.name.localeCompare(b.name, 'zh-CN') ||
      a.id.localeCompare(b.id, 'zh-CN')
    );
    const mapCodes = toSet(mapCodesFn);
    const dest = new Map();
    for (const entry of data.entries) {
      const k = entry.map + '\u0000' + entry.x + '\u0000' + entry.y;
      if (!dest.has(k)) dest.set(k, []);
      dest.get(k).push(entry.key);
    }

    const fileWarnings = [];
    if (data.errors.length) fileWarnings.push(...data.errors);
    if (npcInfo.error) fileWarnings.push('NPCList.txt 读取失败：' + npcInfo.error);
    if (fs.existsSync(full.replace(/\.py$/i, '.pyc'))) {
      fileWarnings.push('存在 ComTrans1.pyc；本工作台只写 .py，保存后请用 @reloadscript 热重载或重启 GameServer');
    }
    if (unconfigured.length) {
      fileWarnings.push(`NPCList 中有 ${unconfigured.length} 个 ComTrans1 NPC 尚未配置传送目的地`);
    }

    for (const entry of data.entries) {
      const rows = npcById.get(entry.key) || [];
      entry.mapName = mapNames[entry.map] || '';
      entry.npcs = rows.map((row) => ({
        id: row.id,
        name: row.name,
        map: row.map,
        mapName: mapNames[row.map] || '',
        x: row.x,
        y: row.y,
        line: row.line + 1,
        script: row.script
      }));
      entry.peers = dest.get(entry.map + '\u0000' + entry.x + '\u0000' + entry.y) || [];
      entry.peerCount = entry.peers.length;
      entry.warnings = [];
      if (!rows.length) {
        entry.warnings.push('NPCList 中未找到该 NPC，传送不会生效');
      } else {
        const foreign = rows.filter((row) => row.script !== 'ComTrans1');
        if (foreign.length) {
          entry.warnings.push('NPCList 中该 ID 的脚本不是 ComTrans1：' + [...new Set(foreign.map((row) => row.script))].join('、'));
        }
        if (rows.length > 1) entry.warnings.push(`NPCList 中有 ${rows.length} 行使用该 ID`);
      }
      if (!mapCodes.has(entry.map)) entry.warnings.push(`目的地地图 ${entry.map} 不在地图配置中`);
    }

    const stats = {
      entries: data.entries.length,
      npcRefs: scriptRefs.length,
      destinations: dest.size,
      duplicateGroups: [...dest.values()].filter((keys) => keys.length > 1).length,
      unconfigured: unconfigured.length,
      npcMissing: data.entries.filter((entry) => !entry.npcs.length).length,
      mapMissing: data.entries.filter((entry) => !mapCodes.has(entry.map)).length,
      warnings: fileWarnings.length + data.entries.reduce((n, entry) => n + entry.warnings.length, 0)
    };

    return {
      full,
      parsed: data.parsed,
      lines: data.lines,
      eolRaw: data.eolRaw,
      hash: data.hash,
      writable: data.errors.length === 0,
      fileWarnings,
      entries: data.entries,
      stats,
      unconfigured,
      npcOptions,
      npcCandidates,
      mapNames,
      entryByKey,
      npcById,
      mapCodes,
      npcHash: npcInfo.hash || ''
    };
  }

  function list() {
    const data = analyze();
    return {
      file: FILE,
      hash: data.hash,
      npcHash: data.npcHash,
      writable: data.writable,
      fileWarnings: data.fileWarnings,
      stats: data.stats,
      unconfigured: data.unconfigured,
      npcOptions: data.npcOptions,
      npcCandidates: data.npcCandidates,
      mapCodes: [...data.mapCodes].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      mapOptions: [...data.mapCodes]
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        .map((code) => ({ code, name: data.mapNames[code] || '' })),
      entries: data.entries.map((entry) => ({
        key: entry.key,
        keyLine: entry.keyLine,
        map: entry.map,
        mapName: entry.mapName,
        x: entry.x,
        y: entry.y,
        closesDict: entry.closesDict,
        npcs: entry.npcs,
        peers: entry.peers,
        peerCount: entry.peerCount,
        warnings: entry.warnings
      }))
    };
  }

  function detail(key) {
    const data = analyze();
    const entry = data.entryByKey.get(String(key || ''));
    if (!entry) throw httpError('找不到该传送条目', 404);
    const peers = entry.peers
      .filter((one) => one !== entry.key)
      .map((one) => {
        const peer = data.entryByKey.get(one);
        return {
          key: one,
          map: peer.map,
          mapName: peer.mapName,
          x: peer.x,
          y: peer.y,
          npcs: peer.npcs
        };
      });
    return {
      file: FILE,
      hash: data.hash,
      npcHash: data.npcHash,
      writable: data.writable,
      fileWarnings: data.fileWarnings,
      unconfigured: data.unconfigured,
      entry: {
        key: entry.key,
        keyLine: entry.keyLine,
        map: entry.map,
        mapName: entry.mapName,
        x: entry.x,
        y: entry.y,
        closesDict: entry.closesDict,
        npcs: entry.npcs,
        peers,
        peerCount: entry.peerCount,
        warnings: entry.warnings,
        raw: {
          key: data.lines[entry.startLine],
          map: data.lines[entry.startLine + 1],
          x: data.lines[entry.startLine + 2],
          y: data.lines[entry.startLine + 3]
        }
      }
    };
  }

  function locate(data, op) {
    const keyLine = Number(op.keyLine);
    if (!Number.isInteger(keyLine)) throw httpError('条目行号无效');
    const entry = data.entries.find((one) => one.keyLine === keyLine);
    if (!entry) throw httpError('条目行号已变化，请刷新', 409);
    if (entry.key !== String(op.expectKey == null ? '' : op.expectKey)) {
      throw httpError('条目内容已变化，请刷新', 409);
    }
    return entry;
  }

  function save(payload) {
    if (!payload || typeof payload !== 'object') throw httpError('缺少请求内容');
    if (payload.file && payload.file !== FILE) throw httpError('只支持编辑 ' + FILE);
    if (!Array.isArray(payload.ops) || payload.ops.length !== 1) {
      throw httpError('一次只能提交一个操作');
    }
    const data = analyze();
    if (!data.writable) {
      throw httpError('文件无法安全写入：' + (data.fileWarnings.join('；') || '结构异常'));
    }
    if (!payload.hash || payload.hash !== data.hash) {
      throw httpError('脚本已被外部修改，请刷新', 409);
    }
    const op = payload.ops[0];
    if (!op || typeof op !== 'object') throw httpError('操作内容无效');
    const work = { before: new Map(), skip: new Set(), patches: new Map(), append: [] };
    let summary = { added: 0, updated: 0, deleted: 0 };
    let changed = true;

    if (op.op === 'add') {
      const key = checkKey(op.key);
      const map = checkMap(op.map);
      const x = checkPos(op.x, 'X 坐标');
      const y = checkPos(op.y, 'Y 坐标');
      if (data.entryByKey.has(key)) throw httpError('该 NPC ID 已有传送条目');
      const last = data.entries[data.entries.length - 1];
      if (!last || !last.closesDict) throw httpError('NPCMAP 结构异常，无法追加');
      addPatch(work.patches, last.endLine, last.suffixStart, last.lineLength, ' },');
      work.before.set(last.endLine + 1, renderEntry({ key, map, x, y }));
      summary = { added: 1, updated: 0, deleted: 0 };
    } else if (op.op === 'update') {
      const entry = locate(data, op);
      const key = op.key === undefined || op.key === null || op.key === ''
        ? entry.key
        : checkKey(op.key);
      if (key !== entry.key && data.entryByKey.has(key)) {
        throw httpError('该 NPC ID 已有传送条目');
      }
      const map = checkMap(op.map);
      const x = checkPos(op.x, 'X 坐标');
      const y = checkPos(op.y, 'Y 坐标');
      if (entry.key === key && entry.map === map && entry.x === x && entry.y === y) {
        changed = false;
        summary = { added: 0, updated: 0, deleted: 0 };
      } else {
        if (entry.key !== key) {
          addPatch(work.patches, entry.startLine, entry.keySpan.start, entry.keySpan.end, key);
        }
        if (entry.map !== map) {
          addPatch(work.patches, entry.mapLine, entry.mapSpan.start, entry.mapSpan.end, map);
        }
        if (entry.x !== x) {
          addPatch(work.patches, entry.startLine + 2, entry.xSpan.start, entry.xSpan.end, String(x));
        }
        if (entry.y !== y) {
          addPatch(work.patches, entry.endLine, entry.ySpan.start, entry.ySpan.end, String(y));
        }
        summary = { added: 0, updated: 1, deleted: 0 };
      }
    } else if (op.op === 'delete') {
      const entry = locate(data, op);
      if (data.entries.length <= 1) throw httpError('不能删除最后一条传送条目');
      for (let line = entry.startLine; line <= entry.endLine; line++) work.skip.add(line);
      if (entry.closesDict) {
        const index = data.entries.indexOf(entry);
        const prev = data.entries[index - 1];
        if (prev) addPatch(work.patches, prev.endLine, prev.suffixStart, prev.lineLength, ' } }');
      }
      summary = { added: 0, updated: 0, deleted: 1 };
    } else {
      throw httpError('未知操作');
    }

    if (!changed) {
      return {
        ok: true,
        file: FILE,
        hash: data.hash,
        backup: null,
        changed: false,
        summary,
        warnings: data.fileWarnings
      };
    }

    const current = fs.readFileSync(full);
    if (sha256(current) !== data.hash) throw httpError('脚本已被外部修改，请刷新', 409);
    const out = buildOutput(data.parsed, work);
    const backup = writeFileLines(full, out, data.eolRaw, data.parsed.trailing);
    const next = analyze();
    return {
      ok: true,
      file: FILE,
      hash: next.hash,
      backup,
      changed: true,
      summary,
      warnings: next.fileWarnings
    };
  }

  function createNpc(payload) {
    if (!payload || typeof payload !== 'object') throw httpError('缺少请求内容');
    if (payload.file && payload.file !== FILE) throw httpError('只支持编辑 ' + FILE);
    if (!npcAdd) throw httpError('当前服务未配置 NPCList 写入器', 500);
    const data = analyze();
    if (!data.writable) {
      throw httpError('文件无法安全写入：' + (data.fileWarnings.join('；') || '结构异常'));
    }
    if (!payload.hash || payload.hash !== data.hash) {
      throw httpError('脚本已被外部修改，请刷新', 409);
    }
    if (data.npcHash && payload.npcHash !== data.npcHash) {
      throw httpError('NPCList.txt 已被外部修改，请刷新', 409);
    }
    const key = checkKey(payload.key);
    if (data.entryByKey.has(key)) throw httpError('该 NPC ID 已有传送条目');
    if (data.npcById.has(key)) throw httpError('NPCList 中已存在该 NPC ID');
    const name = checkName(payload.name);
    const map = checkMap(payload.map);
    const x = checkPos(payload.x, 'NPC X 坐标');
    const y = checkPos(payload.y, 'NPC Y 坐标');
    const destMap = checkMap(payload.destMap);
    const destX = checkPos(payload.destX, '目的地 X 坐标');
    const destY = checkPos(payload.destY, '目的地 Y 坐标');

    const last = data.entries[data.entries.length - 1];
    if (!last || !last.closesDict) throw httpError('NPCMAP 结构异常，无法追加');
    const work = { before: new Map(), skip: new Set(), patches: new Map(), append: [] };
    addPatch(work.patches, last.endLine, last.suffixStart, last.lineLength, ' },');
    work.before.set(last.endLine + 1, renderEntry({ key, map: destMap, x: destX, y: destY }));
    const out = buildOutput(data.parsed, work);

    const npcSnapshot = fs.readFileSync(npcFile);
    if (data.npcHash && sha256(npcSnapshot) !== data.npcHash) {
      throw httpError('NPCList.txt 已被外部修改，请刷新', 409);
    }
    let npcBackup = null;
    try {
      const added = npcAdd({
        id: key,
        script: 'ComTrans1',
        map,
        x,
        y,
        name,
        extra: ['0', '15', '0', '0']
      });
      npcBackup = (added && added.backup) || null;
    } catch (e) {
      throw httpError('写入 NPCList.txt 失败：' + e.message, 500);
    }

    let pyBackup;
    try {
      const current = fs.readFileSync(full);
      if (sha256(current) !== data.hash) throw httpError('脚本已被外部修改，请刷新', 409);
      pyBackup = writeFileLines(full, out, data.eolRaw, data.parsed.trailing);
    } catch (e) {
      try {
        fs.writeFileSync(npcFile, npcSnapshot);
      } catch (restoreErr) {
        throw httpError(
          (e.message || '写入失败') + '；NPCList.txt 回滚失败，请从备份恢复：' + (npcBackup || '无备份'),
          500
        );
      }
      throw e.status ? e : httpError('写入 ComTrans1.py 失败：' + (e.message || e), 500);
    }

    const next = analyze();
    const warnings = next.fileWarnings.slice();
    if (!data.mapCodes.has(map)) warnings.push(`所在地图 ${map} 不在地图配置中，NPC 可能不会出现`);
    if (!data.mapCodes.has(destMap)) warnings.push(`目的地地图 ${destMap} 不在地图配置中`);
    return {
      ok: true,
      file: FILE,
      key,
      changed: true,
      hash: next.hash,
      npcHash: next.npcHash,
      backups: { teleport: pyBackup, npcList: npcBackup },
      npc: { id: key, name, script: 'ComTrans1', map, x, y },
      dest: { map: destMap, x: destX, y: destY },
      warnings
    };
  }

  return { list, detail, save, createNpc };
}

module.exports = { create };

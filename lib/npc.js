'use strict';

const fs = require('fs');
const path = require('path');
const {
  readFileLines,
  writeFileLines,
  tokenize,
  patchTokens,
  checkToken,
  checkIndex,
  isInt
} = require('./configs');

const NPC_FILE_RE = /^[^\\/:*?"<>|]+\.py$/i;

function lineIndent(line) {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

function unquote(text) {
  const m = /^(['"])([\s\S]*)\1$/.exec(text);
  return m ? { value: m[2], quote: m[1] } : { value: text, quote: null };
}

function splitCallArgs(line, start, end) {
  const args = [];
  let curStart = start;
  let q = null;
  let depth = 0;
  for (let i = start; i <= end; i++) {
    const c = line[i];
    if (i === end) {
      if (q) throw new Error('脚本参数引号未闭合');
      pushArg(args, line, curStart, i);
      break;
    }
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; continue; }
    if (c === ',' && depth === 0) {
      pushArg(args, line, curStart, i);
      curStart = i + 1;
    }
  }
  return args;
}

function pushArg(args, line, start, end) {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(line[s])) s++;
  while (e > s && /\s/.test(line[e - 1])) e--;
  const text = line.slice(s, e);
  const parsed = unquote(text);
  args.push({
    start: s,
    end: e,
    text,
    value: parsed.value,
    quote: parsed.quote
  });
}

function scanGoodsCalls(line) {
  const marker = 'user.addGoods(';
  const calls = [];
  let from = 0;
  while (true) {
    const idx = line.indexOf(marker, from);
    if (idx < 0) break;
    const start = idx + marker.length;
    let q = null;
    let depth = 1;
    let end = -1;
    for (let i = start; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '\\') { i++; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) break;
    calls.push({ callStart: idx, args: splitCallArgs(line, start, end), end });
    from = end + 1;
  }
  return calls;
}

function parseNpc(file) {
  const { lines, eol, trailing } = readFileLines(file);
  const rows = [];
  const special = [];
  let comments = 0;
  let blanks = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.trim();
    if (!s) { blanks++; continue; }
    if (s.startsWith(';')) { comments++; continue; }
    const tok = tokenize(line).map((m) => m[0]);
    if (
      tok.length >= 6 &&
      tok[0] && tok[1] && tok[2] && tok[5] &&
      /^\d+$/.test(tok[3]) && /^\d+$/.test(tok[4])
    ) {
      rows.push({
        id: tok[0],
        script: tok[1],
        map: tok[2],
        x: Number(tok[3]),
        y: Number(tok[4]),
        name: tok[5],
        extra: tok.slice(6),
        line: li
      });
    } else {
      special.push({ line: li, text: line });
    }
  }
  const mapCount = new Map();
  const scriptCount = new Map();
  const idCount = new Map();
  for (const row of rows) {
    mapCount.set(row.map, (mapCount.get(row.map) || 0) + 1);
    scriptCount.set(row.script, (scriptCount.get(row.script) || 0) + 1);
    idCount.set(row.id, (idCount.get(row.id) || 0) + 1);
  }
  const maps = [...mapCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const scripts = [...scriptCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const duplicateIds = [...idCount.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
  return {
    lines, eol, trailing, rows, special, comments, blanks, maps, scripts, duplicateIds
  };
}

function parseMapNames(file) {
  const { lines } = readFileLines(file);
  const names = new Map();
  let inMap = false;
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith(';')) continue;
    if (/^\[/.test(s)) {
      inMap = /^\[MAPLOAD\]/i.test(s);
      continue;
    }
    if (!inMap) continue;
    const parts = s.split(',');
    if (parts.length < 2) continue;
    const code = parts[0].trim();
    const name = parts[1].trim();
    if (code && name && !name.startsWith(';')) names.set(code, name);
  }
  return [...names.entries()].map(([code, name]) => ({ code, name }));
}

function normalizeExtra(values) {
  if (values === undefined) return ['0', '165', '0', '0'];
  if (!Array.isArray(values)) throw new Error('附加字段格式错误');
  return values.map((v, i) => {
    const n = Number(v);
    if (!isInt(n, 0, 1000000000)) throw new Error(`附加字段 ${i + 1} 需要非负整数`);
    return String(n);
  });
}

function normalizeNpc(values, base) {
  const out = { ...base };
  if (values.id !== undefined) out.id = checkToken(values.id, 'NPC 唯一标示', 64);
  if (values.script !== undefined) out.script = checkToken(values.script, '脚本名称', 64);
  if (values.map !== undefined) out.map = checkToken(values.map, '地图编号', 64);
  if (values.x !== undefined) {
    out.x = Number(values.x);
    if (!isInt(out.x, 0, 100000)) throw new Error('X 坐标需要 0-100000 的整数');
  }
  if (values.y !== undefined) {
    out.y = Number(values.y);
    if (!isInt(out.y, 0, 100000)) throw new Error('Y 坐标需要 0-100000 的整数');
  }
  if (values.name !== undefined) out.name = checkToken(values.name, 'NPC 名称', 64);
  if (values.extra !== undefined) out.extra = normalizeExtra(values.extra);
  return out;
}

function saveNpc(file, payload) {
  const parsed = parseNpc(file);
  const { lines, eol, trailing, rows } = parsed;
  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, rows.length, 'NPC'));

  const changes = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, rows.length, 'NPC');
    if (deleted.has(index)) continue;
    const base = rows[index];
    const merged = normalizeNpc(change.values || {}, base);
    const patch = new Map();
    if (merged.id !== base.id) patch.set(0, merged.id);
    if (merged.script !== base.script) patch.set(1, merged.script);
    if (merged.map !== base.map) patch.set(2, merged.map);
    if (merged.x !== base.x) patch.set(3, merged.x);
    if (merged.y !== base.y) patch.set(4, merged.y);
    if (merged.name !== base.name) patch.set(5, merged.name);
    if (patch.size) changes.set(index, patch);
  }

  const added = (payload.added || []).map((item) => normalizeNpc(item, {
    id: '', script: '', map: '', x: 0, y: 0, name: '', extra: ['0', '165', '0', '0']
  }));

  const rowByLine = new Map(rows.map((r, i) => [r.line, { row: r, index: i }]));
  const output = [];
  const lastOutByMap = new Map();
  for (let li = 0; li < lines.length; li++) {
    const info = rowByLine.get(li);
    if (!info) {
      output.push(lines[li]);
      continue;
    }
    if (deleted.has(info.index)) continue;
    const patch = changes.get(info.index);
    output.push(patch ? patchTokens(lines[li], patch) : lines[li]);
    lastOutByMap.set(info.row.map, output.length - 1);
  }

  const insertAfter = new Map();
  const append = [];
  for (const item of added) {
    const line = [
      item.id, item.script, item.map, item.x, item.y, item.name, ...item.extra
    ].join('\t');
    const pos = lastOutByMap.get(item.map);
    if (pos === undefined) append.push(line);
    else {
      if (!insertAfter.has(pos)) insertAfter.set(pos, []);
      insertAfter.get(pos).push(line);
    }
  }

  const final = [];
  for (let i = 0; i < output.length; i++) {
    final.push(output[i]);
    if (insertAfter.has(i)) final.push(...insertAfter.get(i));
  }
  final.push(...append);

  const changedRows = changes.size;
  const addedRows = added.length;
  const deletedRows = deleted.size;
  if (changedRows === 0 && addedRows === 0 && deletedRows === 0) {
    return { ok: true, changedRows: 0, addedRows: 0, deletedRows: 0, count: rows.length, backup: null };
  }
  const backup = writeFileLines(file, final, eol, trailing);
  return {
    ok: true,
    changedRows,
    addedRows,
    deletedRows,
    count: rows.length - deletedRows + addedRows,
    backup
  };
}

/* ---------------- 商店脚本（NPCScript/*.py） ---------------- */

function parseShopFile(file) {
  const { lines, eol, trailing } = readFileLines(file);
  let initLine = -1;
  let initIndent = '';
  let npcParam = 'npc';
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)def\s+initialize\s*\(\s*([A-Za-z_]\w*)\s*\)\s*:/.exec(lines[i]);
    if (m) {
      initLine = i;
      initIndent = m[1];
      npcParam = m[2];
    }
  }
  let initEnd = lines.length;
  if (initLine >= 0) {
    for (let i = initLine + 1; i < lines.length; i++) {
      const s = lines[i].trim();
      if (!s || s.startsWith('#')) continue;
      const ind = lineIndent(lines[i]);
      if (ind.length <= initIndent.length) { initEnd = i; break; }
    }
  }

  const goods = [];
  const special = [];
  for (let li = initLine >= 0 ? initLine + 1 : 0; li < initEnd; li++) {
    const line = lines[li];
    if (!line.includes('addGoods(')) continue;
    let calls;
    try {
      calls = scanGoodsCalls(line);
    } catch (e) {
      special.push({ line: li, text: line, reason: e.message });
      continue;
    }
    if (!calls.length) {
      special.push({ line: li, text: line, reason: '无法解析 addGoods 调用' });
      continue;
    }
    for (const call of calls) {
      const args = call.args;
      if (
        args.length === 4 &&
        args[0].value === npcParam &&
        args[1].quote &&
        /^\d+$/.test(args[2].value) &&
        /^\d+$/.test(args[3].value)
      ) {
        goods.push({
          index: goods.length,
          line: li,
          item: args[1].value,
          count: Number(args[2].value),
          time: Number(args[3].value),
          itemSpan: args[1],
          countSpan: args[2],
          timeSpan: args[3]
        });
      } else {
        special.push({
          line: li,
          text: line,
          reason: '非标准货品行（可能是模板或动态调用）'
        });
      }
    }
  }

  let indent = initIndent + '    ';
  if (goods.length) indent = lineIndent(lines[goods[0].line]);
  else if (initLine >= 0) {
    for (let i = initLine + 1; i < initEnd; i++) {
      if (lines[i].trim()) { indent = lineIndent(lines[i]); break; }
    }
  }
  return {
    file,
    name: path.basename(file),
    base: path.basename(file, '.py'),
    lines,
    eol,
    trailing,
    hasInit: initLine >= 0,
    initLine,
    initIndent,
    initEnd,
    npcParam,
    indent,
    goods,
    special
  };
}

function parseShops(dir, npcRows) {
  const files = fs.readdirSync(dir).filter((f) => /\.py$/i.test(f));
  const modules = new Map();
  for (const name of files) {
    const full = path.join(dir, name);
    let parsed;
    try {
      parsed = parseShopFile(full);
    } catch (e) {
      continue;
    }
    modules.set(parsed.base, parsed);
  }

  const sourceCache = new Map();
  function sourcesFor(base, seen) {
    if (sourceCache.has(base)) return sourceCache.get(base);
    if (!seen) seen = new Set();
    if (seen.has(base)) return [];
    seen.add(base);
    const mod = modules.get(base);
    if (!mod) return [];
    const out = [base];
    if (mod.hasInit) {
      for (let li = mod.initLine + 1; li < mod.initEnd; li++) {
        const m = /\b([A-Za-z_]\w*)\.initialize\s*\(/.exec(mod.lines[li]);
        if (!m || m[1] === 'user' || m[1] === 'self') continue;
        const dep = m[1];
        if (!modules.has(dep)) continue;
        for (const s of sourcesFor(dep, seen)) if (!out.includes(s)) out.push(s);
      }
    }
    sourceCache.set(base, out);
    return out;
  }

  const shopSources = new Map();
  const shops = [];
  for (const row of npcRows || []) {
    const sources = sourcesFor(row.script).filter((base) => {
      const mod = modules.get(base);
      return mod && (mod.goods.length > 0 || mod.special.length > 0);
    });
    if (!sources.length) continue;
    for (const source of sources) {
      if (!shopSources.has(source)) shopSources.set(source, { npcs: 0, maps: new Set() });
      const stat = shopSources.get(source);
      stat.npcs++;
      stat.maps.add(row.map);
    }
    shops.push({
      id: row.id,
      script: row.script,
      map: row.map,
      x: row.x,
      y: row.y,
      name: row.name,
      sources: sources.map((base) => {
        const mod = modules.get(base);
        return { base, file: mod.name, goods: mod.goods.length, shared: 0 };
      })
    });
  }

  const outFiles = [];
  for (const base of [...shopSources.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    const mod = modules.get(base);
    const stat = shopSources.get(base);
    outFiles.push({
      name: mod.name,
      base,
      hasInit: mod.hasInit,
      npcParam: mod.npcParam,
      goods: mod.goods.map((g) => ({
        index: g.index,
        item: g.item,
        count: g.count,
        time: g.time,
        line: g.line + 1
      })),
      special: mod.special.map((s) => ({ line: s.line + 1, text: s.text, reason: s.reason })),
      sharedNpcs: stat ? stat.npcs : 0,
      maps: stat ? [...stat.maps].sort((a, b) => a.localeCompare(b, 'zh-CN')) : []
    });
  }
  for (const shop of shops) {
    for (const source of shop.sources) {
      const f = outFiles.find((x) => x.base === source.base);
      source.shared = f ? f.sharedNpcs : 0;
    }
  }
  return {
    dir,
    files: outFiles,
    shops,
    goods: outFiles.reduce((n, f) => n + f.goods.length, 0),
    special: outFiles.reduce((n, f) => n + f.special.length, 0)
  };
}

function normalizeGood(values, base, allowedItems) {
  const out = { ...base };
  if (values.item !== undefined) {
    out.item = checkToken(values.item, '物品名称', 64);
    if (/['"\\]/.test(out.item)) throw new Error('物品名称不能包含引号或反斜杠');
    if (allowedItems && !allowedItems.has(out.item)) {
      throw new Error(`物品不存在于 stditems.db：${out.item}`);
    }
  }
  if (values.count !== undefined) {
    out.count = Number(values.count);
    if (!isInt(out.count, 0, 1000000000)) throw new Error('数量需要非负整数');
  }
  if (values.time !== undefined) {
    out.time = Number(values.time);
    if (!isInt(out.time, 0, 1000000000)) throw new Error('刷新时间需要非负整数');
  }
  return out;
}

function quoteArg(value, quote) {
  const s = String(value);
  if (!quote) return s;
  return quote + s.replace(/\\/g, '\\\\').split(quote).join('\\' + quote) + quote;
}

function patchGoodLine(line, good, merged) {
  const patches = [];
  if (merged.item !== good.item) {
    patches.push({ span: good.itemSpan, text: quoteArg(merged.item, good.itemSpan.quote) });
  }
  if (merged.count !== good.count) {
    patches.push({ span: good.countSpan, text: quoteArg(merged.count, good.countSpan.quote) });
  }
  if (merged.time !== good.time) {
    patches.push({ span: good.timeSpan, text: quoteArg(merged.time, good.timeSpan.quote) });
  }
  if (!patches.length) return line;
  patches.sort((a, b) => b.span.start - a.span.start);
  let out = line;
  for (const p of patches) {
    out = out.slice(0, p.span.start) + p.text + out.slice(p.span.end);
  }
  return out;
}

function saveShops(dir, payload, allowedItems) {
  const name = String(payload.file || '');
  if (!NPC_FILE_RE.test(name) || path.basename(name) !== name) {
    throw new Error('脚本文件名不合法');
  }
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) throw new Error('脚本文件不存在：' + name);
  const parsed = parseShopFile(file);
  if (!parsed.hasInit) throw new Error('脚本没有 initialize 函数，无法编辑商店货品');

  const deleted = new Set();
  for (const raw of payload.deleted || []) deleted.add(checkIndex(raw, parsed.goods.length, '货品'));

  const changes = new Map();
  for (const change of payload.changes || []) {
    const index = checkIndex(change.index, parsed.goods.length, '货品');
    if (deleted.has(index)) continue;
    const base = parsed.goods[index];
    const merged = normalizeGood(change.values || change, base, allowedItems);
    if (merged.item !== base.item || merged.count !== base.count || merged.time !== base.time) {
      changes.set(index, merged);
    }
  }

  const added = (payload.added || []).map((item) => normalizeGood(item, {
    item: '', count: 1, time: 1
  }, allowedItems));

  const goodByLine = new Map(parsed.goods.map((g, i) => [g.line, { good: g, index: i }]));
  const output = [];
  let lastGoodOut = -1;
  for (let li = 0; li < parsed.lines.length; li++) {
    const info = goodByLine.get(li);
    if (!info) {
      output.push(parsed.lines[li]);
      continue;
    }
    if (deleted.has(info.index)) continue;
    const merged = changes.get(info.index);
    output.push(merged ? patchGoodLine(parsed.lines[li], info.good, merged) : parsed.lines[li]);
    if (lineIndent(parsed.lines[li]) === parsed.indent) lastGoodOut = output.length - 1;
  }

  if (added.length) {
    const lines = added.map((g) =>
      `${parsed.indent}user.addGoods(${parsed.npcParam}, ${quoteArg(g.item, "'")}, ${quoteArg(g.count, "'")}, ${quoteArg(g.time, "'")})`
    );
    if (lastGoodOut >= 0) {
      output.splice(lastGoodOut + 1, 0, ...lines);
    } else if (parsed.initLine >= 0) {
      output.splice(parsed.initLine + 1, 0, ...lines);
    } else {
      output.push(...lines);
    }
  }

  const changedGoods = changes.size;
  const addedGoods = added.length;
  const deletedGoods = deleted.size;
  if (changedGoods === 0 && addedGoods === 0 && deletedGoods === 0) {
    return {
      ok: true, file: parsed.name, changedGoods: 0, addedGoods: 0,
      deletedGoods: 0, count: parsed.goods.length, backup: null
    };
  }
  const backup = writeFileLines(file, output, parsed.eol, parsed.trailing || addedGoods > 0);
  return {
    ok: true,
    file: parsed.name,
    changedGoods,
    addedGoods,
    deletedGoods,
    count: parsed.goods.length - deletedGoods + addedGoods,
    backup
  };
}

module.exports = {
  parseNpc,
  saveNpc,
  parseMapNames,
  parseShops,
  saveShops,
  splitCallArgs,
  unquote
};

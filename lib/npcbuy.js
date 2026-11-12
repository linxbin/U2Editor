'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gbk = require('./gbk');
const { readFileLines, writeFileLines } = require('./configs');
const npcData = require('./npc');

const LINK_RE = /<([^<>\n]*?)\/@([A-Za-z_]\w*)((?:&[^<>&\n]*)*)>/g;
const DEF_RE = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/;
const GENERATED_RE = /^buyitem\d+(_\d+)?$/;
const GENERIC_MENU_LABELS = new Set([
  '确定购买', '返回', '返回首页', '返回上一页', '关闭', '离开', '退出', '我在想想'
]);

function httpError(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function functionSpans(lines) {
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DEF_RE.exec(lines[i]);
    if (m) {
      defs.push({
        name: m[1],
        args: m[2].split(',').map((s) => s.trim()).filter(Boolean),
        start: i,
        end: lines.length,
        indent: ''
      });
    }
  }
  for (let i = 0; i < defs.length; i++) {
    defs[i].end = i + 1 < defs.length ? defs[i + 1].start : lines.length;
    for (let li = defs[i].start + 1; li < defs[i].end; li++) {
      if (lines[li].trim()) {
        defs[i].indent = (lines[li].match(/^[ \t]*/) || [''])[0];
        break;
      }
    }
    if (!defs[i].indent) defs[i].indent = '    ';
  }
  return defs;
}

function parsePrizeMap(lines) {
  const start = lines.findIndex((l) => /^\s*PRIZEMAP\s*=\s*\{\s*$/.test(l));
  if (start < 0) return null;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].includes('}')) { end = i; break; }
  }
  if (end < 0) return null;
  const entries = [];
  let lastEntryLine = -1;
  for (let i = start + 1; i <= end; i++) {
    const line = lines[i];
    const m = /^([ \t]*)(['"])(.*?)\2(\s*:\s*)([^,}\s]+)(.*)$/.exec(line);
    if (!m) continue;
    const valueStart = line.length - m[6].length - m[5].length;
    entries.push({
      key: m[3],
      line: i,
      raw: line,
      indent: m[1],
      value: m[5],
      valueStart,
      valueEnd: valueStart + m[5].length,
      closing: m[6].includes('}')
    });
    lastEntryLine = i;
  }
  return { start, end, entries, lastEntryLine };
}

function scanLinks(lines) {
  const out = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(line))) {
      const tokenStart = m.index;
      const tokenEnd = tokenStart + m[0].length;
      const label = m[1];
      const target = m[2];
      const paramsRaw = m[3] || '';
      const labelStart = tokenStart + 1;
      const labelEnd = labelStart + label.length;
      const targetStart = labelEnd + 2;
      const paramsStart = targetStart + target.length;
      const params = [];
      if (paramsRaw.startsWith('&')) {
        let i = 1;
        while (i <= paramsRaw.length) {
          const next = paramsRaw.indexOf('&', i);
          const end = next < 0 ? paramsRaw.length : next;
          params.push({ value: paramsRaw.slice(i, end), start: paramsStart + i, end: paramsStart + end });
          if (next < 0) break;
          i = next + 1;
        }
      }
      out.push({
        line: li,
        tokenStart,
        tokenEnd,
        raw: line,
        label,
        labelStart,
        labelEnd,
        target,
        targetStart,
        paramsRaw,
        params
      });
    }
  }
  return out;
}

function resolveTarget(target, base) {
  const m = /^_([A-Za-z_]\w*)_([A-Za-z_]\w*)$/.exec(target);
  if (m) return { module: m[1], func: m[2] };
  return { module: base, func: target };
}

function ensureGbk(value, field) {
  try {
    gbk.encode(value);
  } catch (e) {
    throw httpError(field + '包含 GBK 不支持的字符');
  }
}

function checkLabel(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw httpError('菜单文字不能为空');
  if (s.length > 40) throw httpError('菜单文字不能超过 40 个字符');
  if (/['"\\<>&@\r\n\t]/.test(s)) throw httpError('菜单文字不能包含引号、反斜杠、<>、&、@ 或换行');
  ensureGbk(s, '菜单文字');
  return s;
}

function checkItem(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw httpError('物品不能为空');
  if (/['"\\<>&@\r\n\t]/.test(s)) throw httpError('物品名称包含不支持的字符');
  ensureGbk(s, '物品名称');
  return s;
}

function checkCount(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw httpError('数量需要 1-9999 的整数');
  return n;
}

function checkPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.01 || n > 1000000) throw httpError('单价需要 0.01-1000000');
  if (Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6) throw httpError('单价最多 4 位小数');
  return n;
}

function formatPrice(n) {
  return String(Number(n.toFixed(4)));
}

function addPatch(map, line, start, end, text) {
  if (!map.has(line)) map.set(line, []);
  map.get(line).push({ start, end, text });
}

function create(opts) {
  const scriptDir = path.resolve(opts.scriptDir);
  const npcFile = opts.npcFile;
  const mapInfoFile = opts.mapInfoFile;
  const itemNames = opts.itemNames || (() => []);
  const itemIndex = opts.itemIndex || (() => new Map());

  let listCache = null;
  let npcCache = null;

  function invalidate() {
    listCache = null;
  }

  function relOf(full) {
    return path.relative(scriptDir, full).split(path.sep).join('/');
  }

  function safeFull(rel) {
    if (typeof rel !== 'string' || !rel.trim()) throw httpError('文件名不合法');
    const norm = rel.replace(/\\/g, '/').trim();
    if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) throw httpError('路径不合法');
    if (norm.split('/').some((part) => part === '..' || part === '' || part === '.')) {
      throw httpError('路径不合法');
    }
    const full = path.resolve(scriptDir, norm);
    if (!full.startsWith(scriptDir + path.sep)) throw httpError('路径不合法');
    if (!/\.py$/i.test(full)) throw httpError('只支持 .py 脚本');
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw httpError('脚本不存在', 404);
    return full;
  }

  function walkPy() {
    const out = [];
    (function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '备份' || entry.name === '__pycache__') continue;
          walk(full);
        } else if (/\.py$/i.test(entry.name)) {
          out.push(relOf(full));
        }
      }
    })(scriptDir);
    return out.sort();
  }

  function analyze(rel) {
    const full = safeFull(rel);
    const { buf, text, lines, eol, trailing } = readFileLines(full);
    const base = path.basename(rel, '.py');
    const defs = functionSpans(lines);
    const defMap = new Map(defs.map((d) => [d.name, d]));
    const nlLine = lines.findIndex((l) => /^\s*NL\s*=\s*['"]/.test(l));
    const helperDef = defs.find((d) => /^popnewchange1?$/.test(d.name) &&
      lines.slice(d.start + 1, d.end).join('\n').includes('getLocalVariable'));
    const priceDef = defMap.get('_price');
    const prizeMap = parsePrizeMap(lines);
    const links = scanLinks(lines);
    const roundTrip = gbk.encode(text).equals(buf);

    const defAt = (line) => {
      for (const d of defs) if (line >= d.start && line < d.end) return d;
      return null;
    };
    const hasTell = new Map();
    for (const d of defs) {
      hasTell.set(d.name, lines.slice(d.start + 1, d.end).some((l) => /^\s*user\.tell\s*\(/.test(l)));
    }

    const helper = helperDef ? helperDef.name : '';
    const prizes = new Map();
    if (prizeMap) {
      for (const p of prizeMap.entries) if (!prizes.has(p.key)) prizes.set(p.key, p);
    }
    const allowed = new Set(itemNames());
    const entries = [];
    if (helper) {
      for (const link of links) {
        const t = resolveTarget(link.target, base);
        if (t.func !== helper) continue;
        const item = link.params[0] ? link.params[0].value : '';
        const countRaw = link.params[1] ? link.params[1].value : '';
        const pageDef = defAt(link.line);
        const page = pageDef ? pageDef.name : '';
        const prize = prizes.get(item) || null;
        const count = Number(countRaw);
        const warnings = [];
        const countParam = link.params[1] || null;
        if (!item) warnings.push('链接缺少物品参数');
        else {
          if (!allowed.has(item)) warnings.push('物品不在 stditems');
          if (!prize) warnings.push('价目表缺少该物品');
        }
        if (!/^\d+$/.test(countRaw) || !Number.isInteger(count) || count < 1) warnings.push('数量无效');
        if (t.module !== base) warnings.push('跨模块购买函数：' + t.module);
        const generated = GENERATED_RE.test(page);
        const menuLinks = generated ? links.filter((l) => resolveTarget(l.target, base).func === page) : [];
        entries.push({
          id: link.line + ':' + link.tokenStart,
          line: link.line,
          tokenStart: link.tokenStart,
          tokenEnd: link.tokenEnd,
          raw: link.raw,
          label: link.label,
          labelStart: link.labelStart,
          labelEnd: link.labelEnd,
          target: link.target,
          targetModule: t.module,
          item,
          count: countRaw,
          countStart: countParam ? countParam.start : -1,
          countEnd: countParam ? countParam.end : -1,
          page,
          generated,
          menuLabel: menuLinks.length ? menuLinks[0].label : '',
          menuLinks: menuLinks.map((l) => ({ line: l.line, tokenStart: l.tokenStart, label: l.label })),
          price: prize ? prize.value : null,
          priceLine: prize ? prize.line : -1,
          total: prize && Number.isFinite(count) ? Number((Number(prize.value) * count).toFixed(4)) : null,
          warnings
        });
      }
    }

    const defNames = new Set(defs.map((d) => d.name));
    const pageDesc = (pageLinks, pageEntries, bodyLines) => {
      const labels = [];
      for (const link of pageLinks) {
        const t = resolveTarget(link.target, base);
        if (t.module !== base || t.func === helper) continue;
        if (!defNames.has(t.func)) continue;
        const label = link.label.replace(/\s+/g, ' ').trim();
        if (!label || GENERIC_MENU_LABELS.has(label)) continue;
        if (!labels.includes(label)) labels.push(label);
      }
      let text = '';
      if (labels.length) {
        text = labels.slice(0, 4).join('、') + (labels.length > 4 ? ' 等' : '');
      } else if (pageEntries.length) {
        const items = [];
        for (const e of pageEntries) if (e.item && !items.includes(e.item)) items.push(e.item);
        text = items.length ? '购买：' + items.join('、') : '';
      } else {
        for (const line of bodyLines) {
          if (!/^\s*msg\s*\+?=/.test(line)) continue;
          const m = /'((?:[^'\\\n]|\\.)*)'/.exec(line);
          if (!m) continue;
          const prose = m[1]
            .replace(/\\[nrt]/g, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/%[ds]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (prose.length < 6 || /[?？]$/.test(prose) || !/[\u4e00-\u9fff]/.test(prose)) continue;
          text = prose;
          break;
        }
      }
      return text.length > 34 ? text.slice(0, 33) + '…' : text;
    };

    const pages = defs
      .filter((d) => hasTell.get(d.name))
      .filter((d) => !/^popnewchange/i.test(d.name) && d.name !== '_price' && d.name !== 'initialize')
      .filter((d) => !GENERATED_RE.test(d.name))
      .filter((d) => links.some((l) => l.line > d.start && l.line < d.end))
      .map((d) => {
        const pageLinks = links.filter((l) => l.line > d.start && l.line < d.end);
        const pageEntries = entries.filter((e) => e.line > d.start && e.line < d.end);
        return {
          name: d.name,
          line: d.start + 1,
          purchases: pageEntries.length,
          desc: pageDesc(pageLinks, pageEntries, lines.slice(d.start + 1, d.end))
        };
      });

    const duplicateKeys = [];
    if (prizeMap) {
      const seen = new Set();
      for (const p of prizeMap.entries) {
        if (seen.has(p.key)) duplicateKeys.push(p.key);
        seen.add(p.key);
      }
    }

    const fileWarnings = [];
    if (!nlLine && nlLine !== 0) fileWarnings.push('未找到 NL 换行常量');
    if (!priceDef) fileWarnings.push('未找到 _price 价格显示函数');
    if (!helperDef) fileWarnings.push('未找到 popnewchange 购买函数');
    if (!prizeMap) fileWarnings.push('未找到 PRIZEMAP 价目表');
    if (!roundTrip) fileWarnings.push('GBK 编解码无法无损还原，禁止写入');
    if (duplicateKeys.length) fileWarnings.push('价目表存在重复物品：' + [...new Set(duplicateKeys)].join('、'));

    return {
      rel,
      full,
      base,
      buf,
      eol,
      trailing,
      lines,
      defs,
      defMap,
      links,
      linksOfTarget: (name) => links.filter((l) => resolveTarget(l.target, base).func === name),
      helper,
      hasPrice: Boolean(priceDef),
      prizeMap,
      prizes,
      entries,
      pages,
      hasNl: nlLine >= 0,
      roundTrip,
      supported: Boolean(helperDef && priceDef && nlLine >= 0 && prizeMap && roundTrip),
      hash: sha256(buf),
      fileWarnings,
      linkForm: (function () {
        if (rel.includes('/')) return helper;
        const qualified = new RegExp('@_' + escapeRe(base) + '_' + escapeRe(helper) + '&');
        return lines.some((l) => qualified.test(l)) ? '_' + base + '_' + helper : helper;
      })()
    };
  }

  function parseNpcRows() {
    if (!npcCache) npcCache = npcData.parseNpc(npcFile).rows;
    return npcCache;
  }

  function mapNameMap() {
    if (!mapInfoFile) return new Map();
    try {
      return new Map(npcData.parseMapNames(mapInfoFile).map((m) => [m.code, m.name]));
    } catch (e) {
      return new Map();
    }
  }

  function sharing(base, rel) {
    const rows = parseNpcRows().filter((r) => r.script === base);
    const names = mapNameMap();
    const maps = [];
    for (const row of rows) {
      if (!maps.includes(row.map)) maps.push(row.map);
    }
    return {
      npcs: rows.length,
      maps: maps.map((code) => names.get(code) || ('地图 ' + code)),
      list: rows.slice(0, 12).map((r) => ({
        id: r.id,
        name: r.name,
        map: r.map,
        mapName: names.get(r.map) || '',
        x: r.x,
        y: r.y
      })),
      importedBy: []
    };
  }

  function scanImports(baseSet, skip) {
    const out = new Map();
    for (const base of baseSet) out.set(base, new Set());
    if (!baseSet.size) return out;
    const patterns = [];
    for (const base of baseSet) {
      patterns.push({
        base,
        importRe: new RegExp('^\\s*import\\s+' + escapeRe(base) + '\\s*$', 'm'),
        callRe: new RegExp('(^|[^A-Za-z0-9_])' + escapeRe(base) + '\\s*\\.'),
        linkRe: new RegExp('@_' + escapeRe(base) + '_')
      });
    }
    for (const rel of walkPy()) {
      if (skip.has(rel)) continue;
      let text;
      try {
        text = gbk.decodeText(fs.readFileSync(safeFull(rel)));
      } catch (e) {
        continue;
      }
      for (const p of patterns) {
        if (p.importRe.test(text) || p.callRe.test(text) || p.linkRe.test(text)) out.get(p.base).add(rel);
      }
    }
    return out;
  }

  function canonicalRel(base, all) {
    const same = all.filter((rel) => path.basename(rel, '.py') === base);
    if (!same.length) return null;
    return same.find((rel) => !rel.includes('/')) || same[0];
  }

  function list() {
    if (listCache) return listCache;
    const allPy = walkPy();
    const supported = [];
    for (const rel of allPy) {
      let parsed;
      try { parsed = analyze(rel); } catch (e) { continue; }
      if (parsed.supported) supported.push(parsed);
    }
    const importMap = scanImports(new Set(supported.map((p) => p.base)), new Set(supported.map((p) => p.rel)));
    const rels = allPy;
    const rows = parseNpcRows();
    const names = mapNameMap();
    const files = supported.map((parsed) => {
      const npcRows = rows.filter((r) => r.script === parsed.base);
      const maps = [];
      for (const row of npcRows) {
        const name = names.get(row.map) || ('地图 ' + row.map);
        if (!maps.includes(name)) maps.push(name);
      }
      const duplicate = canonicalRel(parsed.base, rels) !== parsed.rel;
      const importedBy = duplicate ? [] : [...(importMap.get(parsed.base) || [])];
      return {
        file: parsed.rel,
        base: parsed.base,
        helper: parsed.helper,
        pages: parsed.pages.length,
        purchases: parsed.entries.length,
        npcs: npcRows.length,
        maps,
        importedBy,
        duplicate,
        warnings: parsed.fileWarnings.length + parsed.entries.reduce((n, e) => n + e.warnings.length, 0)
      };
    });
    files.sort((a, b) => a.base.localeCompare(b.base, 'zh-CN'));
    listCache = { files, items: itemNames() };
    return listCache;
  }

  function detail(rel) {
    const parsed = analyze(rel);
    const sh = sharing(parsed.base, parsed.rel);
    const duplicate = canonicalRel(parsed.base, walkPy()) !== parsed.rel;
    sh.importedBy = duplicate ? [] : [...(scanImports(new Set([parsed.base]), new Set([parsed.rel])).get(parsed.base) || [])];
    const used = new Map();
    for (const e of parsed.entries) used.set(e.item, (used.get(e.item) || 0) + 1);
    return {
      file: parsed.rel,
      base: parsed.base,
      hash: parsed.hash,
      supported: parsed.supported,
      helper: parsed.helper,
      linkForm: parsed.linkForm,
      eol: parsed.eol === '\r\n' ? 'CRLF' : 'LF',
      trailing: parsed.trailing,
      pages: parsed.pages,
      entries: parsed.entries,
      prizes: parsed.prizeMap
        ? parsed.prizeMap.entries.map((p) => ({
          key: p.key,
          value: p.value,
          line: p.line,
          used: used.get(p.key) || 0,
          closing: p.closing
        }))
        : [],
      sharing: sh,
      duplicate,
      warnings: parsed.fileWarnings,
      items: itemNames()
    };
  }

  function applyPatches(line, patchList) {
    if (!patchList || !patchList.length) return line;
    const sorted = patchList.slice().sort((a, b) => b.start - a.start);
    let lastStart = Infinity;
    for (const p of sorted) {
      if (p.end > lastStart) throw httpError('修改区域重叠，请刷新后重试');
      line = line.slice(0, p.start) + p.text + line.slice(p.end);
      lastStart = p.start;
    }
    return line;
  }

  function buildOutput(parsed, work) {
    const { lines } = parsed;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (work.before.has(i)) out.push(...work.before.get(i));
      if (work.skip.has(i)) continue;
      out.push(applyPatches(lines[i], work.patches.get(i)));
    }
    out.push(...work.append);
    return out;
  }

  function save(rel, payload) {
    const parsed = analyze(rel);
    if (!parsed.supported) throw httpError('该脚本不支持购买菜单编辑：' + (parsed.fileWarnings.join('；') || '缺少购买机制'));
    if (!payload || !Array.isArray(payload.ops) || !payload.ops.length) throw httpError('缺少操作');
    if (payload.ops.length !== 1) throw httpError('一次只能提交一个操作');
    if (payload.hash && payload.hash !== parsed.hash) throw httpError('脚本已被外部修改，请刷新', 409);
    const op = payload.ops[0];
    const lines = parsed.lines;
    const work = { before: new Map(), skip: new Set(), patches: new Map(), append: [] };
    let added = 0;
    let updated = 0;
    let deleted = 0;
    let extraWarning = '';

    if (op.op === 'add') {
      const page = String(op.page || '');
      const pageDef = parsed.defMap.get(page);
      if (!pageDef || GENERATED_RE.test(page)) throw httpError('菜单页不存在');
      const item = checkItem(op.item);
      const label = checkLabel(op.label);
      const count = checkCount(op.count);
      const price = checkPrice(op.price);
      const allowed = new Set(itemNames());
      if (!allowed.has(item)) throw httpError('物品不在 stditems 中');
      const tellLine = lines.findIndex((l, i) => i > pageDef.start && i < pageDef.end && /^\s*user\.tell\s*\(/.test(l));
      if (tellLine < 0) throw httpError('菜单页没有 user.tell，无法插入');
      let msgIndent = '';
      for (let i = tellLine - 1; i > pageDef.start; i--) {
        const m = /^([ \t]*)msg\s*\+=/.exec(lines[i]);
        if (m) { msgIndent = m[1]; break; }
      }
      if (!msgIndent) msgIndent = pageDef.indent;

      const idxMap = itemIndex();
      const itemIdx = idxMap.get ? idxMap.get(item) : undefined;
      let pageName = 'buyitem' + (itemIdx == null ? '1' : itemIdx);
      let suffix = 1;
      while (parsed.defs.some((d) => d.name === pageName)) {
        suffix += 1;
        pageName = 'buyitem' + (itemIdx == null ? '1' : itemIdx) + '_' + suffix;
      }

      if (parsed.prizes.has(item)) {
        const prize = parsed.prizes.get(item);
        if (Number(prize.value) !== price) {
          addPatch(work.patches, prize.line, prize.valueStart, prize.valueEnd, formatPrice(price));
        }
      } else {
        if (!parsed.prizeMap || parsed.prizeMap.lastEntryLine < 0) {
          throw httpError('价目表格式无法识别，请手动维护');
        }
        const last = parsed.prizeMap.entries.find((p) => p.line === parsed.prizeMap.lastEntryLine);
        const indent = last ? last.indent : '    ';
        work.before.set(parsed.prizeMap.lastEntryLine, [indent + "'" + item + "': " + formatPrice(price) + ',']);
      }

      work.before.set(tellLine, [msgIndent + "msg += '<" + label + '/@' + pageName + ">' + NL"]);

      const fnLines = [
        '',
        'def ' + pageName + '(player, npc):',
        '    msg = ' + "'你要购买" + item + "吗？' + NL",
        '    msg += ' + "'价格：' + _price(player, '" + item + "', " + count + ') + NL',
        '    msg += ' + "'<确定购买/@" + parsed.linkForm + '&' + item + '&' + count + ">' + NL",
        '    msg += ' + "'<返回/@" + page + ">' + NL",
        '    user.tell(player, npc, msg)'
      ];
      work.append.push(...fnLines);
      added = 1;

      const out = buildOutput(parsed, work);
      const text = out.join(parsed.eol) + parsed.eol;
      const backup = writeFileLines(parsed.full, out, parsed.eol, true);
      invalidate();
      return {
        ok: true,
        file: parsed.rel,
        hash: sha256(gbk.encode(text)),
        backup,
        summary: { added, updated: 0, deleted: 0 },
        created: { page: pageName, item, label, count }
      };
    }

    if (op.op === 'update' || op.op === 'delete') {
      const line = Number(op.line);
      if (!Number.isInteger(line) || line < 0 || line >= lines.length) throw httpError('行号无效');
      if (lines[line] !== op.expect) throw httpError('脚本已被外部修改，请刷新', 409);
      const entry = parsed.entries.find((e) => e.line === line && e.tokenStart === Number(op.tokenStart));
      if (!entry) throw httpError('未找到该购买项，请刷新');

      if (op.op === 'update') {
        if (op.label !== undefined && op.label !== null && op.label !== '') {
          const label = checkLabel(op.label);
          if (entry.generated && entry.menuLinks.length) {
            for (const ml of entry.menuLinks) {
              const menu = parsed.links.find((l) => l.line === ml.line && l.tokenStart === ml.tokenStart);
              if (menu) addPatch(work.patches, menu.line, menu.labelStart, menu.labelEnd, label);
            }
          } else {
            addPatch(work.patches, entry.line, entry.labelStart, entry.labelEnd, label);
          }
        }
        if (op.count !== undefined && op.count !== null && op.count !== '') {
          const count = checkCount(op.count);
          if (entry.countStart < 0) throw httpError('该链接缺少数量参数，无法修改');
          addPatch(work.patches, entry.line, entry.countStart, entry.countEnd, String(count));
          if (entry.generated) {
            const pageDef = parsed.defMap.get(entry.page);
            if (pageDef) {
              const re = /(_price\s*\(\s*player\s*,\s*'([^']*)'\s*,\s*)(\d+)(\s*\))/;
              for (let i = pageDef.start + 1; i < pageDef.end; i++) {
                const m = re.exec(lines[i]);
                if (m && m[2] === entry.item) {
                  const start = m.index + m[1].length;
                  addPatch(work.patches, i, start, start + m[3].length, String(count));
                  break;
                }
              }
            }
          }
        }
        if (op.price !== undefined && op.price !== null && op.price !== '') {
          const price = checkPrice(op.price);
          if (entry.priceLine >= 0) {
            const prize = parsed.prizeMap && parsed.prizeMap.entries.find((p) => p.line === entry.priceLine);
            if (prize && Number(prize.value) !== price) {
              addPatch(work.patches, prize.line, prize.valueStart, prize.valueEnd, formatPrice(price));
            }
          } else {
            if (!parsed.prizeMap || parsed.prizeMap.lastEntryLine < 0) throw httpError('价目表格式无法识别，请手动维护');
            const last = parsed.prizeMap.entries.find((p) => p.line === parsed.prizeMap.lastEntryLine);
            const indent = last ? last.indent : '    ';
            work.before.set(parsed.prizeMap.lastEntryLine, [indent + "'" + entry.item + "': " + formatPrice(price) + ',']);
          }
        }
        updated = 1;
      } else {
        const rest = lines[line].slice(0, entry.tokenStart) + lines[line].slice(entry.tokenEnd);
        if (/^\s*msg\s*\+=\s*(['"])\1\s*\+\s*NL(\s*\*\s*\d+)?\s*$/.test(rest)) {
          work.skip.add(line);
        } else {
          addPatch(work.patches, line, entry.tokenStart, entry.tokenEnd, '');
        }

        if (entry.generated) {
          const pageDef = parsed.defMap.get(entry.page);
          for (const menu of entry.menuLinks) {
            const ml = parsed.links.find((l) => l.line === menu.line && l.tokenStart === menu.tokenStart);
            if (!ml) continue;
            const mRest = lines[ml.line].slice(0, ml.tokenStart) + lines[ml.line].slice(ml.tokenEnd);
            if (/^\s*msg\s*\+=\s*(['"])\1\s*\+\s*NL(\s*\*\s*\d+)?\s*$/.test(mRest)) {
              work.skip.add(ml.line);
            } else {
              addPatch(work.patches, ml.line, ml.tokenStart, ml.tokenEnd, '');
            }
          }
          if (pageDef) {
            const remaining = parsed.entries.filter((e) =>
              e.line > pageDef.start && e.line < pageDef.end && e.id !== entry.id);
            if (!remaining.length) {
              for (let i = pageDef.start; i < pageDef.end; i++) work.skip.add(i);
              if (pageDef.start > 0 && !lines[pageDef.start - 1].trim()) work.skip.add(pageDef.start - 1);
            }
          }
        }

        if (op.removePrice && entry.priceLine >= 0) {
          const prize = parsed.prizeMap && parsed.prizeMap.entries.find((p) => p.line === entry.priceLine);
          if (prize && prize.closing) {
            extraWarning = '价目行与右花括号同行，已保留该价目';
          } else {
            const refRe = new RegExp(
              '&' + escapeRe(entry.item) + '&|(?:popnewchange\\w*|_price)\\s*\\([^\\r\\n)]*' +
              escapeRe("'" + entry.item + "'")
            );
            let referenced = false;
            for (let i = 0; i < lines.length; i++) {
              if (i === entry.priceLine || work.skip.has(i)) continue;
              const l = applyPatches(lines[i], work.patches.get(i));
              if (refRe.test(l)) {
                referenced = true;
                break;
              }
            }
            if (!referenced) work.skip.add(entry.priceLine);
            else extraWarning = '该物品仍有其他购买入口，已保留价目';
          }
        }
        deleted = 1;
      }
    } else {
      throw httpError('未知操作');
    }

    const out = buildOutput(parsed, work);
    const text = out.join(parsed.eol) + (parsed.trailing ? parsed.eol : '');
    const backup = writeFileLines(parsed.full, out, parsed.eol, parsed.trailing);
    invalidate();
    const result = {
      ok: true,
      file: parsed.rel,
      hash: sha256(gbk.encode(text)),
      backup,
      summary: { added, updated, deleted }
    };
    if (extraWarning) result.warning = extraWarning;
    return result;
  }

  function summary() {
    const data = list();
    return {
      files: data.files.length,
      purchases: data.files.reduce((n, f) => n + f.purchases, 0),
      warnings: data.files.reduce((n, f) => n + f.warnings, 0)
    };
  }

  return { list, detail, save, invalidate, summary };
}

module.exports = { create };

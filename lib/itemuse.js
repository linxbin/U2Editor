'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gbk = require('./gbk');
const { readFileLines, writeFileLines } = require('./configs');

const FILE = 'ItemCtrl.py';
const STALE_FILE = '物品触发/ItemCtrl.py';
const MAGIC_PEERS = ['SpeXianRen.py', 'SpeXianRen_QueYsh19.py', STALE_FILE];
const DEF_RE = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/;
const SPECIAL_ITEMS = new Set(['经验']);

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

function str(key, required) {
  return { key, kind: 'str', required: !!required };
}
function int(key, min, max, required) {
  return { key, kind: 'int', min, max, required: !!required };
}
function strList(key, required) {
  return { key, kind: 'list', required: !!required };
}
function flex(key, required) {
  return { key, kind: 'flex', required: !!required };
}
function itemList(key) {
  return { key, kind: 'itemlist', required: true };
}

const PARAM_SCHEMA = {
  mobMonster: [
    str('MonsterName', true), flex('UseMapCode'), str('MapCode'),
    int('PosX', 0, 100000), int('PosY', 0, 100000), int('Num', 1, 1000),
    int('Range', 0, 1000000)
  ],
  mobMultiMonsters: [strList('MonsterList', true), strList('UseMapCode', true)],
  moveToMap: [str('MapCode', true)],
  teamFlyToMap: [str('MapCode', true)],
  giveMultiItems: [itemList('ItemList')],
  giveMultiItems1: [itemList('ItemList')],
  useHPMPTonic: [int('HPValue', 0, 100000000), int('MPValue', 0, 100000000)],
  useInvTonic: [int('Type', 0, 100), int('LastTime', 0, 10000000)],
  useHurtTonic: [
    int('DelayMTime', 0, 10000000), int('Range', 0, 100000),
    int('LastTimeLow', 0, 10000000), int('LastTimeUp', 0, 10000000)
  ]
};

const SUPER_LEVEL = [int('UpLevel', 1, 1000, true)];
for (const name of [
  'superPet', 'superPetWithEffect', 'superJinGangHuTi', 'superJinGangHuTiWithEffect',
  'superHuShenZhenQi', 'superHuShenZhenQiWithEffect'
]) {
  PARAM_SCHEMA[name] = SUPER_LEVEL;
}

const CATEGORIES = [
  { name: '召唤', test: (f) => f === 'mobMonster' || f === 'mobMultiMonsters' },
  { name: '传送', test: (f) => f === 'moveToMap' || f === 'teamFlyToMap' },
  { name: '技能书', test: (f) => f === 'jineng' },
  { name: '礼包', test: (f) => /^(giveMultiItems|dabaoguo|chuanshibaoka|shiyongjin|shujuancanye)/.test(f) },
  { name: '宠物护体', test: (f) => /^super/.test(f) },
  { name: '药水卷轴', test: (f) => /Tonic$/.test(f) || f === 'useFortuneStone' || f === 'useYuanShenHair' },
  { name: '货币', test: (f) => /^(yuanbao|jin$|bai$|tanmoqiu|hongbaoshi|lanbaoshi|lvbaoshi)/.test(f) },
  { name: '修炼', test: (f) => /^xiulianzhi/.test(f) },
  { name: '令牌杂项', test: (f) => /^(lingpai|tuiguang|SetBomb)/.test(f) }
];

function categoryOf(func) {
  for (const def of CATEGORIES) if (def.test(func)) return def.name;
  return '其他';
}

const FUNC_DESCRIPTIONS = {
  SetBombOnMap: '在活动地图放置天雷',
  SetBombOnMapA: '在指定地图放置灭魔弹',
  mobMonster: '在指定地图/坐标召唤怪物',
  moveToMap: '单人传送到指定地图',
  teamFlyToMap: '队长带整队传送到指定地图',
  superPet: '提升宠物等级',
  superPetWithEffect: '提升宠物等级并播放特效',
  superJinGangHuTi: '提升金刚护体技能等级',
  superJinGangHuTiWithEffect: '提升金刚护体等级并播放特效',
  superHuShenZhenQi: '提升护身真气技能等级',
  superHuShenZhenQiWithEffect: '提升护身真气等级并播放特效',
  mobMultiMonsters: '在玩家身边批量召唤怪物',
  giveMultiItems: '按权重随机发放一件礼包奖励',
  giveMultiItems1: '礼包奖励，并额外随机元宝',
  giveMultiItems2: '旧版礼包奖励（当前未使用）',
  jin: '消耗神佑经验金丹，随机获得经验',
  bai: '消耗神佑经验丹，随机获得经验',
  dabaoguo: '将人物包裹扩展到 66 格',
  dabaoguo1: '将元神包裹扩展到 60 格',
  useHPMPTonic: '恢复指定 HP/MP',
  useFixTonic: '修理装备',
  useInvTonic: '使用带类型和持续时间的增益药水',
  useHurtTonic: '使用带延迟/范围/时间的伤害药水',
  UseResurgeTonic: '使用复活药水',
  UseMonsterTonic: '对当前怪物使用怪物药水',
  UseMonsterTonicAll: '对随机怪物使用怪物药水',
  shiyongjintiao: '获得 998000 金币',
  shiyongjinzhuan: '获得 5 根金条',
  shiyongjinzhuankun: '获得 5 块金砖',
  chuanshibaoka: '消耗传世宝卡，随机获得元宝/金币/经验',
  xiulianzhi500: '增加 500 极品修炼值',
  xiulianzhi1000: '增加 2000 极品修炼值',
  xiulianzhi1: '增加 10000 极品修炼值',
  xiulianzhi10: '增加 100000 极品修炼值',
  xiulianzhi100: '增加 1000000 极品修炼值',
  tuiguang35: '1 级传世礼包',
  tuiguang38: '10 级传世礼包',
  tuiguang40: '15 级传世礼包',
  tuiguang42: '20 级传世礼包',
  tuiguang44: '25 级传世礼包',
  tuiguang46: '30 级传世礼包',
  tuiguang47: '35 级传世礼包',
  tuiguang48: '40 级传世礼包',
  tuiguang49: '42 级传世礼包',
  tuiguang50: '46 级传世礼包',
  duobaoqibingchongzhi: '按当日充值返 5% 元宝（未使用）',
  duobaoqibing: '按当日充值返 5% 元宝（未使用）',
  hongbaoshi: '将红宝石存入宝石仓库',
  lanbaoshi: '将蓝宝石存入宝石仓库',
  lvbaoshi: '将绿宝石存入宝石仓库',
  tanmoqiu: '检测附近怪物（当前实现不完整）',
  shujuancanye: '书卷残页，仅提示可叠加',
  lingpaif: '增加 40 点声望',
  lingpait: '增加 10 点声望',
  lingpaifive: '增加 5 点声望',
  lingpaisan: '增加 3 点声望',
  lingpaiyi: '增加 1 点声望',
  superIron: '随机强化装备属性（极品神铁）',
  jineng: '让元神学习技能书对应技能',
  useYuanShenHair: '随机改变元神发型和颜色',
  useFortuneStone: '改造勋章属性（当前参数不匹配）'
};

function funcDescription(name) {
  if (FUNC_DESCRIPTIONS[name]) return FUNC_DESCRIPTIONS[name];
  const yuanbao = /^yuanbao(\d+)$/.exec(name);
  if (yuanbao) return '兑换 ' + yuanbao[1] + ' 元宝';
  return '';
}

function lineStarts(lines, eol) {
  const starts = new Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos;
    pos += lines[i].length + eol.length;
  }
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function unescapeChar(ch) {
  if (ch === 'n') return '\n';
  if (ch === 'r') return '\r';
  if (ch === 't') return '\t';
  return ch;
}

function createLexer(text, from, starts) {
  let i = from;
  const buf = [];
  const n = text.length;

  function scan() {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '#') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      const line = lineAt(starts, i);
      if (c === "'" || c === '"') {
        const quote = c;
        const start = i;
        let value = '';
        i++;
        let closed = false;
        while (i < n) {
          const ch = text[i];
          if (ch === '\\') {
            value += unescapeChar(text[i + 1]);
            i += 2;
            continue;
          }
          if (ch === quote) { i++; closed = true; break; }
          if (ch === '\n' || ch === '\r') break;
          value += ch;
          i++;
        }
        if (!closed) throw httpError(`itemMap 第 ${line + 1} 行存在未闭合字符串`);
        return { t: 'str', value, start, end: i, line };
      }
      if (c >= '0' && c <= '9') {
        let j = i;
        while (j < n && text[j] >= '0' && text[j] <= '9') j++;
        const tok = { t: 'int', value: Number(text.slice(i, j)), start: i, end: j, line };
        i = j;
        return tok;
      }
      if ('{}[]:,='.includes(c)) {
        const tok = { t: 'op', v: c, start: i, end: i + 1, line };
        i++;
        return tok;
      }
      throw httpError(`itemMap 第 ${line + 1} 行存在不支持的字符 ${JSON.stringify(c)}`);
    }
    return null;
  }

  return {
    peek(k = 0) {
      while (buf.length <= k) {
        const tok = scan();
        if (!tok) return null;
        buf.push(tok);
      }
      return buf[k] || null;
    },
    next() {
      const tok = this.peek(0);
      if (tok) buf.shift();
      return tok;
    }
  };
}

function expectOp(L, v) {
  const tok = L.peek();
  if (!tok) throw httpError('itemMap 结构不完整，缺少 ' + v);
  if (tok.t !== 'op' || tok.v !== v) {
    throw httpError(`itemMap 第 ${tok.line + 1} 行缺少 ${v}`);
  }
  return L.next();
}

function expectKey(L) {
  const tok = L.next();
  if (!tok || tok.t !== 'str') throw httpError('itemMap 中存在非字符串键');
  return tok;
}

function parseValue(L) {
  const tok = L.peek();
  if (!tok) throw httpError('itemMap 值不完整');
  if (tok.t === 'str') {
    L.next();
    return { kind: 'str', value: tok.value, firstStart: tok.start, lastEnd: tok.end, firstLine: tok.line, lastLine: tok.line };
  }
  if (tok.t === 'int') {
    L.next();
    return { kind: 'int', value: tok.value, firstStart: tok.start, lastEnd: tok.end, firstLine: tok.line, lastLine: tok.line };
  }
  if (tok.t === 'op' && tok.v === '[') {
    L.next();
    const items = [];
    while (true) {
      const next = L.peek();
      if (!next) throw httpError('itemMap 列表未闭合');
      if (next.t === 'op' && next.v === ']') {
        const close = L.next();
        return {
          kind: items.length && items[0].kind === 'dict' ? 'itemlist' : 'list',
          items,
          firstStart: tok.start,
          lastEnd: close.end,
          firstLine: tok.line,
          lastLine: close.line
        };
      }
      items.push(parseValue(L));
      const sep = L.peek();
      if (sep && sep.t === 'op' && sep.v === ',') L.next();
    }
  }
  if (tok.t === 'op' && tok.v === '{') {
    L.next();
    const fields = [];
    while (true) {
      const next = L.peek();
      if (!next) throw httpError('itemMap 字典未闭合');
      if (next.t === 'op' && next.v === '}') {
        const close = L.next();
        return { kind: 'dict', fields, firstStart: tok.start, lastEnd: close.end, firstLine: tok.line, lastLine: close.line };
      }
      const keyTok = expectKey(L);
      expectOp(L, ':');
      const value = parseValue(L);
      fields.push({ key: keyTok.value, keyLine: keyTok.line, value });
      const sep = L.peek();
      if (sep && sep.t === 'op' && sep.v === ',') L.next();
    }
  }
  throw httpError(`itemMap 第 ${tok.line + 1} 行的值无法识别`);
}

function extractValue(v) {
  if (v.kind === 'str' || v.kind === 'int') return v.value;
  if (v.kind === 'list') return v.items.map((x) => extractValue(x));
  if (v.kind === 'dict') {
    const out = {};
    for (const f of v.fields) out[f.key] = extractValue(f.value);
    return out;
  }
  if (v.kind === 'itemlist') {
    return v.items.map((row) => {
      const out = {};
      for (const f of row.fields) out[f.key] = extractValue(f.value);
      return out;
    });
  }
  return null;
}

function itemRows(v, starts, lines) {
  return v.items.map((row) => {
    const out = {
      name: '', prop: 0, count: 0,
      line: row.fields.length ? row.fields[0].keyLine : row.lastLine,
      startLine: row.firstLine,
      endLine: row.lastLine,
      lineLength: lines[row.lastLine].length,
      singleLine: row.firstLine === row.lastLine,
      fields: {}
    };
    for (const f of row.fields) {
      const value = extractValue(f.value);
      if (f.key === 'name') out.name = String(value);
      else if (f.key === 'prop') out.prop = Number(value);
      else if (f.key === 'count') out.count = Number(value);
      out.fields[f.key] = {
        line: f.value.firstLine,
        valueStartCol: f.value.firstStart - starts[f.value.firstLine],
        valueEndCol: f.value.lastEnd - starts[f.value.lastLine],
        singleLine: f.value.firstLine === f.value.lastLine
      };
    }
    out.suffixStart = row.lastEnd - starts[row.lastLine];
    return out;
  });
}

function makeField(text, starts, lines, keyTok, value) {
  const line = keyTok.line;
  const indentMatch = /^[ \t]*/.exec(lines[line]);
  const prefix = lines[line].slice(0, keyTok.start - starts[line]);
  return {
    key: keyTok.value,
    line,
    endLine: value.lastLine,
    keyStartCol: keyTok.start - starts[line],
    keyEndCol: keyTok.end - starts[line],
    indent: indentMatch ? indentMatch[0] : '',
    valueStartCol: value.firstStart - starts[value.firstLine],
    valueStartLine: value.firstLine,
    valueEndCol: value.lastEnd - starts[value.lastLine],
    valueEndLine: value.lastLine,
    lineLength: lines[value.lastLine].length,
    suffix: text.slice(value.lastEnd, starts[value.lastLine] + lines[value.lastLine].length),
    kind: value.kind,
    value: extractValue(value),
    rows: value.kind === 'itemlist' ? itemRows(value, starts, lines) : null,
    firstValueLine: value.firstLine,
    spacesBeforeKey: prefix
  };
}

function parseFields(L, text, starts, lines) {
  const fields = [];
  while (true) {
    const tok = L.peek();
    if (!tok) throw httpError('itemMap 条目未闭合');
    if (tok.t === 'op' && tok.v === '}') {
      const close = L.next();
      return { fields, closeLine: close.line };
    }
    if (tok.t !== 'str') throw httpError(`itemMap 第 ${tok.line + 1} 行缺少字段名`);
    const keyTok = L.next();
    expectOp(L, ':');
    const value = parseValue(L);
    fields.push(makeField(text, starts, lines, keyTok, value));
    const sep = L.peek();
    if (sep && sep.t === 'op' && sep.v === ',') L.next();
    else if (!sep || sep.t !== 'op' || sep.v !== '}') {
      throw httpError(`itemMap 第 ${tok.line + 1} 行字段之间缺少逗号`);
    }
  }
}

function parseNamedMap(parsed, starts, name) {
  const re = new RegExp('^\\s*' + name + '\\s*=\\s*\\{\\s*$');
  const startLine = parsed.lines.findIndex((line) => re.test(line));
  if (startLine < 0) return null;
  const eqCol = parsed.lines[startLine].indexOf('=');
  if (eqCol < 0) throw httpError(`未找到 ${name} = {`);
  const L = createLexer(parsed.text, starts[startLine] + eqCol, starts);
  return parseDictBody(L, parsed, starts, name, startLine);
}

// 词法器只认识字面量，因此从 '=' 开始扫描，跳过变量名。
function parseDictBody(L, parsed, starts, name, startLine) {
  const text = parsed.text;
  const lines = parsed.lines;
  const eq = L.next();
  if (!eq || eq.t !== 'op' || eq.v !== '=') throw httpError(`未找到 ${name} = {`);
  expectOp(L, '{');
  const entries = [];
  while (true) {
    const tok = L.peek();
    if (!tok) throw httpError(`${name} 未闭合`);
    if (tok.t === 'op' && tok.v === '}') {
      L.next();
      break;
    }
    const keyTok = expectKey(L);
    expectOp(L, ':');
    expectOp(L, '{');
    const body = parseFields(L, text, starts, lines);
    const entry = {
      item: keyTok.value,
      keyLine: keyTok.line,
      keyIndent: (lines[keyTok.line].match(/^[ \t]*/) || [''])[0],
      startLine: keyTok.line,
      endLine: body.closeLine,
      closesDict: false,
      fields: body.fields
    };
    entry.fields.forEach((f, i) => { f.isLastField = i === entry.fields.length - 1; });
    finishEntry(entry);
    entries.push(entry);

    const sep = L.peek();
    if (sep && sep.t === 'op' && sep.v === ',') {
      L.next();
      const after = L.peek();
      if (!after || (after.t === 'op' && after.v === '}')) {
        entry.closesDict = true;
        if (after) L.next();
        break;
      }
      continue;
    }
    entry.closesDict = true;
    if (sep && sep.t === 'op' && sep.v === '}') L.next();
    break;
  }
  return { startLine, entries };
}

function finishEntry(entry) {
  const funcField = entry.fields.find((f) => f.key === 'FuncName');
  entry.func = funcField ? String(funcField.value) : '';
  entry.funcField = funcField || null;
  entry.params = {};
  entry.paramKinds = {};
  entry.paramList = [];
  for (const f of entry.fields) {
    if (f.key === 'FuncName' || f.key === 'ItemList') continue;
    entry.params[f.key] = f.value;
    entry.paramKinds[f.key] = f.kind;
    entry.paramList.push({ key: f.key, kind: f.kind, value: f.value, line: f.line + 1, indent: f.indent });
  }
  entry.itemListField = entry.fields.find((f) => f.key === 'ItemList') || null;
  entry.itemList = entry.itemListField ? entry.itemListField.rows : [];
  entry.lastField = entry.fields[entry.fields.length - 1] || null;
  entry.fieldIndent = entry.lastField ? entry.lastField.indent : entry.keyIndent + '    ';
  entry.category = categoryOf(entry.func);
}

function functionDefs(lines) {
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DEF_RE.exec(lines[i]);
    if (!m) continue;
    defs.push({
      name: m[1],
      args: m[2].split(',').map((s) => s.trim()).filter(Boolean),
      line: i + 1
    });
  }
  return defs;
}

function signature(files) {
  return files.map((file) => {
    try {
      const st = fs.statSync(file);
      return `${file}:${st.size}:${st.mtimeMs}`;
    } catch (e) {
      return `${file}:missing`;
    }
  }).join('|');
}

function pyQuote(value) {
  return "'" + String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t') + "'";
}

function checkText(value, label, maxLen = 80) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw httpError(label + '不能为空');
  if (/['"\\\r\n\t]/.test(s)) throw httpError(label + '不能包含引号、反斜杠或换行');
  if (s.length > maxLen) throw httpError(label + '不能超过 ' + maxLen + ' 个字符');
  try { gbk.encode(s); } catch (e) { throw httpError(label + '包含 GBK 不支持的字符'); }
  return s;
}

function checkItemName(value) {
  const s = String(value == null ? '' : value);
  if (!s) throw httpError('物品名称不能为空');
  if (s !== s.trim()) throw httpError('物品名称首尾不能有空格');
  return checkText(s, '物品名称');
}

function checkInt(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw httpError(`${label}需要 ${min}-${max} 的整数`);
  }
  return n;
}

function checkStrList(value, label) {
  if (!Array.isArray(value) || !value.length) throw httpError(label + '至少需要一项');
  return value.map((v) => checkText(v, label));
}

function checkFlex(value, label) {
  if (Array.isArray(value)) return checkStrList(value, label);
  return checkText(value, label);
}

function checkRows(value) {
  if (!Array.isArray(value) || !value.length) throw httpError('礼包至少需要一行');
  return value.map((row) => {
    if (!row || typeof row !== 'object') throw httpError('礼包行格式错误');
    return {
      name: checkText(row.name, '礼包物品名称'),
      prop: checkInt(row.prop, '礼包权重', 1, 1000000000),
      count: checkInt(row.count, '礼包数量', 1, 1000000000)
    };
  });
}

function schemaFor(func) {
  return PARAM_SCHEMA[func] || [];
}

function kindFor(func, key, existingKind) {
  const spec = schemaFor(func).find((s) => s.key === key);
  if (spec) return spec.kind;
  if (existingKind) return existingKind;
  if (key === 'ItemList') return 'itemlist';
  return 'str';
}

function fmtScalar(kind, value) {
  return kind === 'int' ? String(value) : pyQuote(value);
}

function renderEntry(opts) {
  const keyIndent = opts.keyIndent;
  const fieldIndent = opts.fieldIndent;
  const out = [keyIndent + pyQuote(opts.item) + ': {'];
  const fields = [{ key: 'FuncName', kind: 'str', value: opts.func }];
  for (const p of opts.scalars) fields.push({ key: p.key, kind: p.kind, value: p.value });
  if (opts.itemList && opts.itemList.length) {
    fields.push({ key: 'ItemList', kind: 'itemlist', value: opts.itemList });
  }
  fields.forEach((field, index) => {
    const isLastField = index === fields.length - 1;
    const suffix = isLastField ? (opts.isLastEntry ? ' } }' : ' },') : ',';
    const renderKind = field.kind === 'flex' && Array.isArray(field.value) ? 'list' : field.kind;
    if (renderKind === 'itemlist') {
      out.push(fieldIndent + pyQuote(field.key) + ': [');
      field.value.forEach((row, rowIndex) => {
        const isLastRow = rowIndex === field.value.length - 1;
        out.push(fieldIndent + '    {');
        out.push(fieldIndent + '        ' + pyQuote('name') + ': ' + pyQuote(row.name) + ',');
        out.push(fieldIndent + '        ' + pyQuote('prop') + ': ' + row.prop + ',');
        out.push(fieldIndent + '        ' + pyQuote('count') + ': ' + row.count + ' }' +
          (isLastRow ? ']' + suffix : ','));
      });
      return;
    }
    if (renderKind === 'list') {
      out.push(fieldIndent + pyQuote(field.key) + ': [');
      field.value.forEach((value, valueIndex) => {
        const isLastValue = valueIndex === field.value.length - 1;
        out.push(fieldIndent + '    ' + pyQuote(value) + (isLastValue ? ']' + suffix : ','));
      });
      return;
    }
    out.push(fieldIndent + pyQuote(field.key) + ': ' + fmtScalar(renderKind, field.value) + suffix);
  });
  return out;
}

function addPatch(map, line, start, end, text) {
  if (!map.has(line)) map.set(line, []);
  map.get(line).push({ start, end, text });
}

function applyPatches(line, list) {
  if (!list || !list.length) return line;
  const sorted = list.slice().sort((a, b) => b.start - a.start);
  let lastStart = Infinity;
  for (const p of sorted) {
    if (p.end > lastStart) throw httpError('修改区域重叠，请刷新后重试');
    line = line.slice(0, p.start) + p.text + line.slice(p.end);
    lastStart = p.start;
  }
  return line;
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

function setSuffix(work, field, text) {
  addPatch(work.patches, field.endLine, field.valueEndCol, field.lineLength, text);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function rowSignature(row) {
  return JSON.stringify([row.name, row.prop, row.count]);
}

function renderRows(rows, indent, lastEnding) {
  const out = [];
  rows.forEach((row, index) => {
    const isLast = index === rows.length - 1;
    out.push(indent + '    {');
    out.push(indent + '        ' + pyQuote('name') + ': ' + pyQuote(row.name) + ',');
    out.push(indent + '        ' + pyQuote('prop') + ': ' + row.prop + ',');
    out.push(indent + '        ' + pyQuote('count') + ': ' + row.count + ' }' +
      (isLast ? lastEnding : ','));
  });
  return out;
}

function patchItemList(work, field, oldRows, newRows) {
  if (!field || !oldRows.length || !newRows.length) return null;
  for (const row of oldRows) {
    if (row.startLine <= field.line || row.endLine > field.endLine) return null;
    for (const key of ['name', 'prop', 'count']) {
      if (!row.fields[key] || !row.fields[key].singleLine) return null;
    }
  }
  const indent = field.indent;
  const listSuffix = field.suffix;
  let prefix = 0;
  while (prefix < oldRows.length && prefix < newRows.length &&
    rowSignature(oldRows[prefix]) === rowSignature(newRows[prefix])) prefix++;
  let suffix = 0;
  while (suffix < oldRows.length - prefix && suffix < newRows.length - prefix &&
    rowSignature(oldRows[oldRows.length - 1 - suffix]) === rowSignature(newRows[newRows.length - 1 - suffix])) suffix++;
  const oldStart = prefix;
  const oldEnd = oldRows.length - suffix;
  const newStart = prefix;
  const newEnd = newRows.length - suffix;
  const skipRows = (from, to) => {
    for (let i = from; i < to; i++) {
      for (let line = oldRows[i].startLine; line <= oldRows[i].endLine; line++) work.skip.add(line);
    }
  };
  const setRowSuffix = (row, text) => {
    addPatch(work.patches, row.endLine, row.suffixStart, row.lineLength, text);
  };

  if (oldStart === oldEnd) {
    const atEnd = oldEnd === oldRows.length;
    if (atEnd) {
      setRowSuffix(oldRows[oldStart - 1], ',');
      work.before.set(oldRows[oldStart - 1].endLine + 1,
        renderRows(newRows.slice(newStart, newEnd), indent, ']' + listSuffix));
    } else {
      work.before.set(oldRows[oldStart].startLine,
        renderRows(newRows.slice(newStart, newEnd), indent, ','));
    }
    return true;
  }
  skipRows(oldStart, oldEnd);
  if (newStart === newEnd) {
    if (oldEnd === oldRows.length) setRowSuffix(oldRows[oldStart - 1], ']' + listSuffix);
    return true;
  }
  work.before.set(oldRows[oldStart].startLine,
    renderRows(newRows.slice(newStart, newEnd), indent,
      oldEnd === oldRows.length ? ']' + listSuffix : ','));
  return true;
}

function create(opts) {
  const scriptDir = path.resolve(opts.scriptDir || '.');
  const full = path.join(scriptDir, FILE);
  const staleFull = path.join(scriptDir, STALE_FILE);
  const peerFulls = MAGIC_PEERS.map((rel) => path.join(scriptDir, rel));
  const itemNamesFn = opts.itemNames || (() => []);
  const monsterNamesFn = opts.monsterNames || (() => []);
  const mapCodesFn = opts.mapCodes || (() => []);

  let cache = null;
  let cacheSig = '';

  function invalidate() {
    cache = null;
    cacheSig = '';
  }

  function parseFile(file) {
    const parsed = readFileLines(file);
    const starts = lineStarts(parsed.lines, parsed.eol);
    const roundTrip = gbk.encode(parsed.text).equals(parsed.buf);
    return {
      full: file,
      buf: parsed.buf,
      text: parsed.text,
      lines: parsed.lines,
      eol: parsed.eol,
      trailing: parsed.trailing,
      starts,
      roundTrip,
      hash: sha256(parsed.buf)
    };
  }

  function parseMagic(parsed) {
    try {
      const map = parseNamedMap(parsed, parsed.starts, 'MAGICMAP');
      if (!map) return null;
      return {
        line: map.startLine + 1,
        entries: map.entries.map((e) => ({
          key: e.item,
          line: e.keyLine + 1,
          SkillName: String(e.params.SkillName == null ? '' : e.params.SkillName),
          needJob: Number(e.params.needJob || 0),
          needLevel: Number(e.params.needLevel || 0),
          preSkill: e.params.preSkill,
          nopreSkill: e.params.nopreSkill
        }))
      };
    } catch (e) {
      return { error: e.message, entries: [] };
    }
  }

  function magicComparison(own) {
    const ownMap = new Map((own.entries || []).map((e) => [e.key, e]));
    return MAGIC_PEERS.map((rel, index) => {
      const file = peerFulls[index];
      if (!fs.existsSync(file)) return { file: rel, exists: false };
      try {
        const parsed = parseFile(file);
        const peer = parseMagic(parsed);
        if (!peer || peer.error) return { file: rel, exists: true, error: peer ? peer.error : '未找到 MAGICMAP' };
        const peerMap = new Map(peer.entries.map((e) => [e.key, e]));
        const missingHere = [...peerMap.keys()].filter((key) => !ownMap.has(key));
        const missingThere = [...ownMap.keys()].filter((key) => !peerMap.has(key));
        const diffs = [];
        for (const [key, mine] of ownMap) {
          const other = peerMap.get(key);
          if (!other) continue;
          const a = JSON.stringify([mine.SkillName, mine.needJob, mine.needLevel, mine.preSkill, mine.nopreSkill]);
          const b = JSON.stringify([other.SkillName, other.needJob, other.needLevel, other.preSkill, other.nopreSkill]);
          if (a !== b) diffs.push(key);
        }
        return {
          file: rel, exists: true, count: peer.entries.length,
          missingHere, missingThere, diffs
        };
      } catch (e) {
        return { file: rel, exists: true, error: e.message };
      }
    });
  }

  function staleInfo(entries) {
    if (!fs.existsSync(staleFull)) return { file: STALE_FILE, exists: false };
    try {
      const parsed = parseFile(staleFull);
      const map = parseNamedMap(parsed, parsed.starts, 'itemMap');
      const stamp = JSON.stringify((map ? map.entries : []).map((e) => ({
        item: e.item, func: e.func, params: e.params, itemList: e.itemList
      })));
      const own = JSON.stringify(entries.map((e) => ({
        item: e.item, func: e.func, params: e.params, itemList: e.itemList
      })));
      const st = fs.statSync(staleFull);
      return {
        file: STALE_FILE, exists: true, itemMapIdentical: stamp === own,
        bytes: st.size, mtime: st.mtime.toISOString()
      };
    } catch (e) {
      return { file: STALE_FILE, exists: true, error: e.message };
    }
  }

  function entryWarnings(entry, data) {
    const out = [];
    if (!data.items.has(entry.item)) out.push('物品不在 stditems.db 中');
    if (/^\s|\s$/.test(entry.item)) out.push('物品名首尾含空格');
    const def = data.defMap.get(entry.func);
    if (!def) out.push('效果函数不存在');
    else if (def.args.length !== 3) out.push(`函数参数 ${def.args.length} 个，派发只传 3 个`);
    const schema = schemaFor(entry.func);
    if (!schema.length && Object.keys(entry.params).length) out.push('该函数不读取参数');
    for (const [key, value] of Object.entries(entry.params)) {
      if (key === 'MapCode' && typeof value === 'string' && !data.mapCodes.has(value)) {
        out.push(`地图代码 ${value} 未找到`);
      }
      if (key === 'UseMapCode') {
        const list = Array.isArray(value) ? value : [value];
        for (const one of list) if (!data.mapCodes.has(String(one))) out.push(`地图代码 ${one} 未找到`);
      }
      if (key === 'MonsterName' && !data.monsters.has(String(value))) {
        out.push(`怪物 ${value} 未找到`);
      }
      if (key === 'MonsterList') {
        for (const one of value) if (!data.monsters.has(String(one))) out.push(`怪物 ${one} 未找到`);
      }
    }
    if (entry.func === 'mobMultiMonsters') {
      const monsters = Array.isArray(entry.params.MonsterList) ? entry.params.MonsterList.length : 0;
      const maps = Array.isArray(entry.params.UseMapCode) ? entry.params.UseMapCode.length : 0;
      if (monsters !== maps) out.push(`怪物 ${monsters} 个、地图 ${maps} 个，数量不一致`);
    }
    const seen = new Set();
    for (const row of entry.itemList) {
      if (seen.has(row.name)) out.push(`礼包物品 ${row.name} 重复`);
      seen.add(row.name);
      if (!SPECIAL_ITEMS.has(row.name) && !data.items.has(row.name)) {
        out.push(`礼包物品 ${row.name} 不在 stditems.db 中`);
      }
    }
    return out;
  }

  function summarize(entry) {
    const parts = [];
    for (const key of Object.keys(entry.params)) {
      const value = entry.params[key];
      if (Array.isArray(value)) parts.push(`${key} ${value.length} 项`);
      else parts.push(`${key}=${value}`);
    }
    if (entry.itemList.length) parts.push(`礼包 ${entry.itemList.length} 项`);
    const text = parts.join('，');
    return text.length > 42 ? text.slice(0, 41) + '…' : text;
  }

  function analyze() {
    if (!fs.existsSync(full)) throw httpError(FILE + ' 不存在', 404);
    const sig = signature([full, staleFull, ...peerFulls]);
    if (cache && cacheSig === sig) return cache;
    const parsed = parseFile(full);
    const fileWarnings = [];
    let itemMap = null;
    let parseError = '';
    try {
      itemMap = parseNamedMap(parsed, parsed.starts, 'itemMap');
    } catch (e) {
      parseError = e.message;
    }
    if (!itemMap) parseError = parseError || '未找到 itemMap';
    if (!parsed.roundTrip) fileWarnings.push('GBK 往返校验失败，禁止写入');
    if (parseError) fileWarnings.push(parseError);
    const defs = functionDefs(parsed.lines);
    const defMap = new Map(defs.map((d) => [d.name, d]));
    if (!defMap.has('useItem')) fileWarnings.push('未找到 useItem 派发函数');
    const entries = itemMap ? itemMap.entries : [];
    const data = {
      items: toSet(itemNamesFn),
      monsters: toSet(monsterNamesFn),
      mapCodes: toSet(mapCodesFn),
      defMap
    };
    if (!parsed.roundTrip && !fileWarnings.length) fileWarnings.push('文件无法安全写入');
    for (const entry of entries) {
      entry.warnings = entryWarnings(entry, data);
      entry.summary = summarize(entry);
      entry.search = [entry.item, entry.func, entry.category, entry.summary].join(' ');
    }
    const magic = parseMagic(parsed);
    const staleCopy = staleInfo(entries);
    if (staleCopy.exists && staleCopy.itemMapIdentical === false) {
      fileWarnings.push('物品触发/ItemCtrl.py 是旧副本，内容与根文件不一致；本工作台只写根目录');
    }
    const magicPeers = magic ? magicComparison(magic) : [];
    const quirks = [];
    const fortune = defMap.get('useFortuneStone');
    if (fortune && fortune.args.length !== 3) {
      quirks.push({ line: fortune.line, text: `useFortuneStone 定义了 ${fortune.args.length} 个参数，派发只传 3 个（既有问题，不自动修复）` });
    }
    if (entries.some((e) => e.func === 'jineng')) {
      quirks.push({ text: 'jineng 按物品 RealName 查找 MAGICMAP，而不是 itemMap 的键名' });
    }
    const chained = parsed.lines.findIndex((line) => line.includes("'>打开'<+itemName"));
    if (chained >= 0) {
      quirks.push({ line: chained + 1, text: "该行包含 '>打开'<+itemName，是合法的链式比较（既有问题，不自动修复）" });
    }
    const writable = parsed.roundTrip && !!itemMap && !parseError;
    const result = {
      full,
      file: FILE,
      hash: parsed.hash,
      eol: parsed.eol === '\r\n' ? 'CRLF' : 'LF',
      eolRaw: parsed.eol,
      trailing: parsed.trailing,
      lineCount: parsed.lines.length,
      lines: parsed.lines,
      writable,
      supported: writable,
      itemMap,
      entries,
      defs,
      defMap,
      data,
      magic,
      magicPeers,
      staleCopy,
      quirks,
      fileWarnings
    };
    cache = result;
    cacheSig = sig;
    return result;
  }

  function list() {
    let parsed;
    try {
      parsed = analyze();
    } catch (e) {
      if (e.status === 404) throw e;
      return {
        file: FILE, supported: false, writable: false, hash: null,
        entries: [], categories: [], funcs: [], schema: PARAM_SCHEMA,
        warnings: ['脚本读取失败：' + e.message], quirks: []
      };
    }
    const categoryCounts = new Map();
    for (const entry of parsed.entries) {
      categoryCounts.set(entry.category, (categoryCounts.get(entry.category) || 0) + 1);
    }
    const order = CATEGORIES.map((c) => c.name).concat(['其他']);
    return {
      file: FILE,
      hash: parsed.hash,
      supported: parsed.supported,
      writable: parsed.writable,
      eol: parsed.eol,
      trailing: parsed.trailing,
      lineCount: parsed.lineCount,
      entries: parsed.entries.map((e) => ({
        item: e.item,
        keyLine: e.keyLine,
        line: e.keyLine + 1,
        func: e.func,
        category: e.category,
        params: e.params,
        itemListCount: e.itemList.length,
        summary: e.summary,
        warningCount: e.warnings.length,
        search: e.search
      })),
      categories: order.filter((name) => categoryCounts.has(name))
        .map((name) => ({ name, count: categoryCounts.get(name) })),
      funcs: parsed.defs.map((d) => ({
        name: d.name,
        args: d.args,
        arityOk: d.args.length === 3,
        category: categoryOf(d.name),
        desc: funcDescription(d.name),
        paramKeys: schemaFor(d.name).map((s) => s.key)
      })),
      schema: PARAM_SCHEMA,
      items: toArray(toSet(itemNamesFn)),
      monsters: toArray(toSet(monsterNamesFn)),
      mapCodes: toArray(toSet(mapCodesFn)),
      magic: parsed.magic ? {
        line: parsed.magic.line,
        count: parsed.magic.entries.length,
        readOnly: true,
        peers: parsed.magicPeers
      } : null,
      staleCopy: parsed.staleCopy,
      warnings: parsed.fileWarnings,
      quirks: parsed.quirks
    };
  }

  function toArray(set) {
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  function detail(item) {
    const name = String(item == null ? '' : item);
    if (!name) throw httpError('缺少物品名称');
    const parsed = analyze();
    const entry = parsed.entries.find((e) => e.item === name);
    if (!entry) throw httpError('未找到物品使用项', 404);
    return {
      file: FILE,
      hash: parsed.hash,
      supported: parsed.writable,
      writable: parsed.writable,
      item: entry.item,
      keyLine: entry.keyLine,
      line: entry.keyLine + 1,
      rawKeyLine: parsed.lines[entry.keyLine],
      keyIndent: entry.keyIndent,
      startLine: entry.startLine + 1,
      endLine: entry.endLine + 1,
      closesDict: entry.closesDict,
      func: entry.func,
      category: entry.category,
      summary: entry.summary,
      fields: entry.fields.map((f) => ({
        key: f.key,
        kind: f.kind,
        value: f.value,
        line: f.line + 1,
        endLine: f.endLine + 1,
        indent: f.indent,
        suffix: f.suffix
      })),
      params: entry.paramList,
      itemList: entry.itemList.map((row) => ({ name: row.name, prop: row.prop, count: row.count })),
      itemListField: entry.itemListField ? {
        line: entry.itemListField.line + 1,
        endLine: entry.itemListField.endLine + 1
      } : null,
      schema: schemaFor(entry.func),
      warnings: entry.warnings,
      magic: parsed.magic,
      magicPeers: parsed.magicPeers,
      staleCopy: parsed.staleCopy,
      fileWarnings: parsed.fileWarnings,
      quirks: parsed.quirks,
      eol: parsed.eol,
      trailing: parsed.trailing
    };
  }

  function locate(parsed, op) {
    if (!op || typeof op !== 'object') throw httpError('操作格式错误');
    const keyLine = Number(op.keyLine);
    if (!Number.isInteger(keyLine)) throw httpError('缺少条目行号');
    const entry = parsed.entries.find((e) => e.item === op.item && e.keyLine === keyLine);
    if (!entry) throw httpError('条目不存在或位置已变化，请刷新', 409);
    if (typeof op.expectKey !== 'string' || parsed.lines[keyLine] !== op.expectKey) {
      throw httpError('脚本已被外部修改，请刷新', 409);
    }
    return entry;
  }

  function normalizeParams(func, params, existingValues, existingKinds) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw httpError('参数格式错误');
    }
    const schema = schemaFor(func).filter((s) => s.kind !== 'itemlist');
    const allowed = new Set(schema.map((s) => s.key));
    if (existingValues) for (const key of Object.keys(existingValues)) allowed.add(key);
    const out = [];
    for (const [key, raw] of Object.entries(params)) {
      if (key === 'FuncName' || key === 'ItemList') throw httpError('参数名不合法');
      if (!allowed.has(key)) throw httpError(`函数 ${func} 不支持参数 ${key}`);
      const spec = schema.find((s) => s.key === key);
      const existingKind = existingKinds ? existingKinds[key] : null;
      const kind = spec ? spec.kind : kindFor(func, key, existingKind);
      let value;
      if (kind === 'int') {
        const min = spec ? spec.min : 0;
        const max = spec ? spec.max : 1000000000;
        value = checkInt(raw, key, min, max);
      } else if (kind === 'list') {
        value = checkStrList(raw, key);
      } else if (kind === 'flex') {
        value = checkFlex(raw, key);
      } else {
        value = checkText(raw, key, 200);
      }
      out.push({ key, kind, value });
    }
    for (const spec of schema) {
      if (spec.required && !out.some((p) => p.key === spec.key)) {
        throw httpError(`缺少必填参数 ${spec.key}`);
      }
    }
    const rank = new Map(schema.map((s, index) => [s.key, index]));
    out.sort((a, b) => {
      const ai = rank.has(a.key) ? rank.get(a.key) : 999;
      const bi = rank.has(b.key) ? rank.get(b.key) : 999;
      return ai - bi;
    });
    return out;
  }

  function normalizeItemList(func, value) {
    const needs = schemaFor(func).some((s) => s.kind === 'itemlist');
    if (value === undefined || value === null) {
      if (needs) throw httpError('该效果函数需要礼包内容');
      return [];
    }
    if (!Array.isArray(value)) throw httpError('礼包内容格式错误');
    if (!needs && value.length) throw httpError('该效果函数不支持礼包内容');
    if (!value.length) {
      if (needs) throw httpError('礼包至少需要一行');
      return [];
    }
    return checkRows(value);
  }

  function save(payload) {
    if (!payload || typeof payload !== 'object') throw httpError('缺少请求内容');
    if (payload.file && payload.file !== FILE) throw httpError('只支持编辑 ' + FILE);
    if (!Array.isArray(payload.ops) || payload.ops.length !== 1) {
      throw httpError('一次只能提交一个操作');
    }
    const parsed = analyze();
    if (!parsed.writable) {
      throw httpError('文件无法安全写入：' + (parsed.fileWarnings.join('；') || '结构异常'));
    }
    if (!payload.hash || payload.hash !== parsed.hash) {
      throw httpError('脚本已被外部修改，请刷新', 409);
    }
    const op = payload.ops[0];
    const work = { before: new Map(), skip: new Set(), patches: new Map(), append: [] };
    let summary = { added: 0, updated: 0, deleted: 0 };
    let changed = true;

    if (op.op === 'add') {
      const item = checkItemName(op.item);
      if (parsed.entries.some((e) => e.item === item)) throw httpError('该物品已存在使用触发');
      const func = String(op.func || '');
      if (!parsed.defMap.has(func) || func === 'useItem') throw httpError('效果函数不存在或不可用');
      const scalars = normalizeParams(func, op.params || {}, null, null);
      const itemListValue = normalizeItemList(func, op.itemList);
      const last = parsed.entries[parsed.entries.length - 1];
      if (!last || !last.closesDict) throw httpError('itemMap 结构异常，无法追加');
      setSuffix(work, last.lastField, ' },');
      const rendered = renderEntry({
        item,
        func,
        scalars,
        itemList: itemListValue,
        keyIndent: '    ',
        fieldIndent: '        ',
        isLastEntry: true
      });
      work.before.set(last.endLine + 1, rendered);
      summary = { added: 1, updated: 0, deleted: 0 };
    } else if (op.op === 'update') {
      const entry = locate(parsed, op);
      const changes = op.changes;
      if (!changes || typeof changes !== 'object') throw httpError('缺少修改内容');
      const func = changes.func === undefined ? entry.func : String(changes.func);
      if (!parsed.defMap.has(func) || func === 'useItem') throw httpError('效果函数不存在或不可用');
      const funcChanged = func !== entry.func;
      if (funcChanged && (changes.params === undefined || changes.itemList === undefined)) {
        throw httpError('切换效果函数时必须同时提交完整参数和礼包内容');
      }
      const paramsInput = changes.params === undefined ? entry.params : changes.params;
      const scalars = normalizeParams(
        func,
        paramsInput,
        funcChanged ? null : entry.params,
        funcChanged ? null : entry.paramKinds
      );
      const itemListValue = normalizeItemList(
        func,
        changes.itemList === undefined ? entry.itemList : changes.itemList
      );

      const currentKeys = entry.paramList.map((p) => p.key);
      const targetKeys = scalars.map((p) => p.key);
      const sameKeys = currentKeys.length === targetKeys.length &&
        currentKeys.every((key, index) => key === targetKeys[index]);
      const sameList = deepEqual(itemListValue, entry.itemList.map((r) => ({
        name: r.name, prop: r.prop, count: r.count
      })));
      const listTypeChanged = scalars.some((p) => p.kind === 'list' || p.kind === 'flex' ||
        (entry.paramKinds[p.key] === 'list' || entry.paramKinds[p.key] === 'flex'));

      let dirty = false;
      let inPlace = false;
      if (!funcChanged && sameKeys && !listTypeChanged) {
        let listApplied = sameList;
        if (!sameList) {
          listApplied = patchItemList(work, entry.itemListField, entry.itemList, itemListValue) === true;
          if (listApplied) dirty = true;
        }
        if (listApplied) {
          for (const param of scalars) {
            const oldValue = entry.params[param.key];
            if (!deepEqual(oldValue, param.value)) {
              const field = entry.fields.find((f) => f.key === param.key);
              if (!field) throw httpError('字段丢失，请刷新', 409);
              addPatch(work.patches, field.endLine, field.valueStartCol, field.valueEndCol,
                fmtScalar(param.kind, param.value));
              dirty = true;
            }
          }
          inPlace = true;
        }
      }
      if (!inPlace) {
        for (let line = entry.startLine; line <= entry.endLine; line++) work.skip.add(line);
        const rendered = renderEntry({
          item: entry.item,
          func,
          scalars,
          itemList: itemListValue,
          keyIndent: entry.keyIndent,
          fieldIndent: entry.fieldIndent,
          isLastEntry: entry.closesDict
        });
        work.before.set(entry.startLine, rendered);
        dirty = true;
      }
      if (!dirty) {
        changed = false;
        summary = { added: 0, updated: 0, deleted: 0 };
      } else {
        summary = { added: 0, updated: 1, deleted: 0 };
      }
    } else if (op.op === 'delete') {
      const entry = locate(parsed, op);
      if (parsed.entries.length <= 1) throw httpError('不能删除最后一条使用触发');
      for (let line = entry.startLine; line <= entry.endLine; line++) work.skip.add(line);
      if (entry.closesDict) {
        const index = parsed.entries.indexOf(entry);
        const prev = parsed.entries[index - 1];
        if (prev) setSuffix(work, prev.lastField, ' } }');
      }
      summary = { added: 0, updated: 0, deleted: 1 };
    } else {
      throw httpError('未知操作');
    }

    if (!changed) {
      return { ok: true, file: FILE, hash: parsed.hash, backup: null, changed: false, summary };
    }
    const out = buildOutput(parsed, work);
    const backup = writeFileLines(full, out, parsed.eolRaw, parsed.trailing);
    invalidate();
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

  function summary() {
    try {
      const parsed = analyze();
      return {
        file: FILE,
        entries: parsed.entries.length,
        funcs: new Set(parsed.entries.map((e) => e.func)).size,
        warnings: parsed.fileWarnings.length +
          parsed.entries.reduce((sum, e) => sum + e.warnings.length, 0),
        writable: parsed.writable
      };
    } catch (e) {
      return { file: FILE, error: e.message };
    }
  }

  return { list, detail, save, invalidate, summary, parse: analyze };
}

module.exports = { create, PARAM_SCHEMA, categoryOf };

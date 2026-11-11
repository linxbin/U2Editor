'use strict';

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const dbe = require('./dbe');
const npcData = require('./npc');

const MODULES = [
  { id: 'FX', file: 'TaskConfig_FX.py' },
  { id: 'ZW', file: 'TaskConfig_ZW.py' },
  { id: 'WHQ', file: 'TaskConfig_WHQ.py' },
  { id: 'YZK', file: 'TaskConfig_YZK.py' },
  { id: 'MRRW', file: 'TaskConfig_MRRW.py' },
  { id: 'BANK1', file: 'TaskConfig_BANK1.py' },
  { id: 'BANK2', file: 'TaskConfig_BANK2.py' }
];

const CURRENCY = new Set(['金币', '经验', '声望', '元宝']);
const TASK_KEY = { 强制任务: 'next', 后置任务: 'post' };

const CONDITION_LABELS = {
  KillMonster: '杀怪',
  ClickNPC: '点击 NPC',
  RequestShadow: '请求分身',
  ChangeMap: '切换地图',
  Dig: '挖宝',
  UseItem: '使用物品',
  JumpGS: '跳转分线'
};

function isInt(v) {
  return typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v;
}

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function npcLabel(state) {
  return state === -1 ? '接取 NPC' : '状态 ' + state;
}

function prizeLabel(state) {
  return state === -1 ? '完成奖励' : '状态 ' + state + ' 奖励';
}

function sortedKeys(obj) {
  return Object.keys(obj || {}).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

function dialogText(v) {
  if (v == null) return '';
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.replace(/\\/g, '\n');
}

// ---------------- Python literal subset ----------------

function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '\n') {
      toks.push({ t: 'nl', line, col: 0 });
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    const col = i - lineStart;
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: 'name', v: src.slice(i, j), line, col });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9]/.test(src[j])) j++;
      toks.push({ t: 'int', v: Number(src.slice(i, j)), line, col });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = '';
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          const e = src[j + 1];
          if (e === 'n') out += '\n';
          else if (e === 't') out += '\t';
          else if (e === 'r') out += '\r';
          else if (e === '\\') out += '\\';
          else if (e === quote) out += quote;
          else out += e;
          j += 2;
          continue;
        }
        if (c === quote) {
          j++;
          break;
        }
        if (c === '\n') line++;
        out += c;
        j++;
      }
      toks.push({ t: 'str', v: out, line, col });
      i = j;
      continue;
    }
    if ('{}[]():,=+-*'.includes(ch)) {
      toks.push({ t: 'op', v: ch, line, col });
      i++;
      continue;
    }
    throw new Error('无法识别的字符 ' + JSON.stringify(ch) + '（第 ' + line + ' 行）');
  }
  return toks;
}

function skipNl(toks, pos) {
  while (toks[pos] && toks[pos].t === 'nl') pos++;
  return pos;
}

function expect(toks, pos, v) {
  pos = skipNl(toks, pos);
  const tok = toks[pos];
  if (!tok || tok.v !== v) {
    throw new Error(
      '期望「' + v + '」，实际为「' + (tok ? tok.v : '文件结尾') + '」（第 ' + (tok ? tok.line : '?') + ' 行）'
    );
  }
  return pos + 1;
}

function evalExpr(toks, pos, env) {
  const parseMul = (start) => {
    let r = parseValue(toks, start, env);
    pos = r.next;
    for (;;) {
      const p = skipNl(toks, r.next);
      const tok = toks[p];
      if (!tok || tok.v !== '*') return r;
      const right = parseValue(toks, p + 1, env);
      r = { val: r.val * right.val, next: right.next };
    }
  };
  const parseAdd = () => {
    let r = parseMul(pos);
    for (;;) {
      const p = skipNl(toks, r.next);
      const tok = toks[p];
      if (!tok || (tok.v !== '+' && tok.v !== '-')) return r;
      const right = parseMul(p + 1);
      r = { val: tok.v === '+' ? r.val + right.val : r.val - right.val, next: right.next };
    }
  };
  return parseAdd();
}

function parseValue(toks, pos, env) {
  pos = skipNl(toks, pos);
  const tok = toks[pos];
  if (!tok) throw new Error('表达式意外结束');
  if (tok.t === 'int' || tok.t === 'str') return { val: tok.v, next: pos + 1 };
  if (tok.t === 'name') {
    if (tok.v === 'deepcopy') {
      const r = evalExpr(toks, expect(toks, pos + 1, '('), env);
      const end = expect(toks, r.next, ')');
      return { val: JSON.parse(JSON.stringify(r.val)), next: end };
    }
    if (tok.v === 'range') {
      const r = evalExpr(toks, expect(toks, pos + 1, '('), env);
      let b = null;
      let next = r.next;
      if (toks[skipNl(toks, next)] && toks[skipNl(toks, next)].v === ',') {
        const bb = evalExpr(toks, skipNl(toks, next) + 1, env);
        b = bb.val;
        next = bb.next;
      }
      const end = expect(toks, next, ')');
      const from = b == null ? 0 : r.val;
      const to = b == null ? r.val : b;
      const arr = [];
      for (let k = from; k < to; k++) arr.push(k);
      return { val: arr, next: end };
    }
    if (tok.v === 'True') return { val: true, next: pos + 1 };
    if (tok.v === 'False') return { val: false, next: pos + 1 };
    if (tok.v === 'None') return { val: null, next: pos + 1 };
    if (!Object.prototype.hasOwnProperty.call(env, tok.v)) {
      throw new Error('未知常量「' + tok.v + '」（第 ' + tok.line + ' 行）');
    }
    let val = env[tok.v];
    let next = pos + 1;
    while (toks[skipNl(toks, next)] && toks[skipNl(toks, next)].v === '[') {
      const idx = evalExpr(toks, skipNl(toks, next) + 1, env);
      next = expect(toks, idx.next, ']');
      val = val == null ? undefined : val[String(idx.val)];
    }
    return { val, next };
  }
  if (tok.v === '-') {
    const r = parseValue(toks, pos + 1, env);
    return { val: -r.val, next: r.next };
  }
  if (tok.v === '(') {
    const items = [];
    let p = pos + 1;
    for (;;) {
      p = skipNl(toks, p);
      if (toks[p] && toks[p].v === ')') {
        return { val: items.length === 1 ? items[0] : items, next: p + 1 };
      }
      const r = evalExpr(toks, p, env);
      items.push(r.val);
      p = skipNl(toks, r.next);
      if (toks[p] && toks[p].v === ',') {
        p++;
        continue;
      }
      if (toks[p] && toks[p].v === ')') {
        return { val: items.length === 1 ? items[0] : items, next: p + 1 };
      }
      throw new Error('元组语法异常（第 ' + (toks[p] ? toks[p].line : '?') + ' 行）');
    }
  }
  if (tok.v === '[') {
    const arr = [];
    let p = pos + 1;
    for (;;) {
      p = skipNl(toks, p);
      if (toks[p] && toks[p].v === ']') return { val: arr, next: p + 1 };
      const r = evalExpr(toks, p, env);
      arr.push(r.val);
      p = skipNl(toks, r.next);
      if (toks[p] && toks[p].v === ',') {
        p++;
        continue;
      }
      if (toks[p] && toks[p].v === ']') return { val: arr, next: p + 1 };
    }
  }
  if (tok.v === '{') {
    const obj = {};
    let p = pos + 1;
    for (;;) {
      p = skipNl(toks, p);
      if (toks[p] && toks[p].v === '}') return { val: obj, next: p + 1 };
      const k = evalExpr(toks, p, env);
      p = expect(toks, k.next, ':');
      const v = evalExpr(toks, p, env);
      obj[String(k.val)] = v.val;
      p = skipNl(toks, v.next);
      if (toks[p] && toks[p].v === ',') {
        p++;
        continue;
      }
      if (toks[p] && toks[p].v === '}') return { val: obj, next: p + 1 };
    }
  }
  throw new Error('无法解析的表达式「' + tok.v + '」（第 ' + tok.line + ' 行）');
}

function peekDeepcopyBase(toks, pos) {
  pos = skipNl(toks, pos);
  if (
    toks[pos] && toks[pos].v === 'deepcopy' &&
    toks[pos + 1] && toks[pos + 1].v === '(' &&
    toks[pos + 2] && toks[pos + 2].v === 'taskInfo' &&
    toks[pos + 3] && toks[pos + 3].v === '[' &&
    toks[pos + 4] && toks[pos + 4].t === 'int' &&
    toks[pos + 5] && toks[pos + 5].v === ']' &&
    toks[pos + 6] && toks[pos + 6].v === ')'
  ) {
    return toks[pos + 4].v;
  }
  return null;
}

function createModuleState() {
  return {
    env: {},
    tasks: {},
    npcTaskList: {},
    switchList: [],
    lines: {},
    generated: {},
    baseIds: {}
  };
}

function applySet(state, target, subs, value, line, inLoop, baseId) {
  const env = state.env;
  if (!subs.length) {
    env[target] = value;
    if (target === 'taskInfo') state.tasks = value;
    else if (target === 'NpcTaskList') state.npcTaskList = value;
    else if (target === 'TaskSwitchOnList') state.switchList = value;
    return;
  }
  let obj = env[target];
  for (let k = 0; k < subs.length - 1; k++) obj = obj[String(subs[k])];
  const key = String(subs[subs.length - 1]);
  obj[key] = value;
  if (target === 'taskInfo' && subs.length === 1) {
    state.lines[key] = line;
    if (inLoop) {
      state.generated[key] = true;
      if (baseId != null) state.baseIds[key] = baseId;
    }
  }
}

function execBlock(toks, start, end, state, depth, loopVars) {
  const env = state.env;
  let pos = start;
  while (pos < end) {
    pos = skipNl(toks, pos);
    if (pos >= end) break;
    const tok = toks[pos];
    if (tok.t === 'name' && (tok.v === 'import' || tok.v === 'from')) {
      while (pos < end && toks[pos].t !== 'nl') pos++;
      continue;
    }
    if (tok.t === 'name' && tok.v === 'for') {
      const varName = toks[pos + 1].v;
      let p = pos + 2;
      p = skipNl(toks, p);
      if (!toks[p] || toks[p].v !== 'in') throw new Error('for 语法异常（第 ' + tok.line + ' 行）');
      const rangeExpr = evalExpr(toks, p + 1, env);
      p = expect(toks, rangeExpr.next, ':');
      p = skipNl(toks, p);
      if (p >= end) throw new Error('for 缺少循环体（第 ' + tok.line + ' 行）');
      const bodyIndent = toks[p].col;
      let bodyEnd = p;
      while (bodyEnd < end) {
        if (toks[bodyEnd].t === 'nl') {
          bodyEnd++;
          continue;
        }
        if (toks[bodyEnd].col < bodyIndent) break;
        while (bodyEnd < end && toks[bodyEnd].t !== 'nl') bodyEnd++;
      }
      for (const v of rangeExpr.val) {
        env[varName] = v;
        const scope = loopVars.concat([{}]);
        scope[scope.length - 1][varName] = v;
        execBlock(toks, p, bodyEnd, state, depth + 1, scope);
      }
      pos = bodyEnd;
      continue;
    }
    if (tok.t === 'name') {
      const target = tok.v;
      let p = pos + 1;
      const subs = [];
      while (toks[skipNl(toks, p)] && toks[skipNl(toks, p)].v === '[') {
        const r = evalExpr(toks, skipNl(toks, p) + 1, env);
        subs.push(r.val);
        p = expect(toks, r.next, ']');
      }
      p = expect(toks, p, '=');
      const rhsStart = p;
      const baseId = depth > 0 ? peekDeepcopyBase(toks, rhsStart) : null;
      const r = evalExpr(toks, rhsStart, env);
      applySet(state, target, subs, r.val, tok.line, depth > 0, baseId);
      pos = r.next;
      continue;
    }
    throw new Error('无法处理的语句「' + tok.v + '」（第 ' + tok.line + ' 行）');
  }
}

function parseModule(src) {
  const toks = tokenize(src);
  const state = createModuleState();
  state.env.NL = '\\';
  state.env.FULFILPRIZE = -1;
  state.env.UNDERTAKENPC = -1;
  execBlock(toks, 0, toks.length, state, 0, []);
  return state;
}

// ---------------- TaskSwitchOnList editing ----------------

function findSwitchRange(text) {
  const m = /^[ \t]*TaskSwitchOnList[ \t]*=[ \t]*\[/m.exec(text);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) return { open, close: i };
    }
  }
  return null;
}

function switchHasId(interior, id) {
  return new RegExp('(^|[^0-9])' + id + '([^0-9]|$)').test(interior);
}

function insertSwitchId(text, id) {
  const range = findSwitchRange(text);
  if (!range) throw new Error('未找到 TaskSwitchOnList');
  const interior = text.slice(range.open + 1, range.close);
  if (switchHasId(interior, id)) return { text, changed: false };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (!interior.trim()) {
    const next = text.slice(0, range.open + 1) + eol + '    ' + id + text.slice(range.close);
    return { text: next, changed: true };
  }
  const indentMatch = interior.match(/(?:^|\r?\n)([ \t]+)\d/);
  const indent = indentMatch ? indentMatch[1] : '    ';
  let i = range.close - 1;
  while (i > range.open && /\s/.test(text[i])) i--;
  const comma = text[i] === ',' ? '' : ',';
  const insertion = comma + eol + indent + id;
  return { text: text.slice(0, i + 1) + insertion + text.slice(i + 1), changed: true };
}

function removeSwitchId(text, id) {
  const range = findSwitchRange(text);
  if (!range) throw new Error('未找到 TaskSwitchOnList');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const interior = text.slice(range.open + 1, range.close);
  if (!switchHasId(interior, id)) return { text, changed: false };
  const itemRe = new RegExp('^\\s*' + id + '\\s*,?\\s*(#.*)?$');
  const lines = interior.split(/\r?\n/);
  const content = lines.filter((line) => line.trim());
  const removedLast = content.length > 0 && itemRe.test(content[content.length - 1]);
  const kept = lines.filter((line) => !itemRe.test(line));
  let nextInterior = kept.join(eol);
  if (removedLast) nextInterior = nextInterior.replace(/,\s*$/, '');
  if (nextInterior === interior) {
    nextInterior = interior
      .replace(new RegExp('(^|,|\\[)\\s*' + id + '\\s*,?', 'g'), '$1')
      .replace(/,\s*,/g, ',');
  }
  if (!nextInterior.trim() || nextInterior.trim() === ',') nextInterior = '';
  const next =
    text.slice(0, range.open + 1) +
    (nextInterior.trim() ? nextInterior : '') +
    text.slice(range.close);
  return { text: next, changed: next !== text };
}

function writeSwitchFile(filePath, id, add) {
  const buf = fs.readFileSync(filePath);
  const src = gbk.decodeText(buf);
  if (!gbk.encode(src).equals(buf)) {
    throw new Error('编码校验失败，已取消写入：' + path.basename(filePath));
  }
  const edited = add ? insertSwitchId(src, id) : removeSwitchId(src, id);
  if (!edited.changed) return { changed: false };
  const backup = dbe.backupFile(filePath);
  fs.writeFileSync(filePath, gbk.encode(edited.text));
  return { changed: true, backup };
}

// ---------------- model ----------------

function create(opts) {
  const scriptDir = path.resolve(opts.scriptDir);
  const npcFile = path.resolve(opts.npcFile);
  const dbDir = path.resolve(opts.dbDir);
  const monsterFile = path.join(dbDir, 'Monster.DB');
  const itemFile = path.join(dbDir, 'stditems.db');

  let cachedSig = '';
  let cached = null;

  function moduleFiles() {
    return MODULES.map((m) => path.join(scriptDir, m.file));
  }

  function signature() {
    const parts = [];
    const add = (file) => {
      try {
        const s = fs.statSync(file);
        parts.push(file + ':' + s.size + ':' + s.mtimeMs);
      } catch (e) {
        parts.push(file + ':missing');
      }
    };
    moduleFiles().forEach(add);
    add(npcFile);
    add(monsterFile);
    add(itemFile);
    try {
      parts.push('scripts:' + fs.readdirSync(scriptDir).filter((f) => /\.py$/i.test(f)).sort().join(','));
    } catch (e) {
      parts.push('scripts:missing');
    }
    return parts.join('|');
  }

  function buildModel() {
    const issues = [];
    const addIssue = (code, severity, message, scope, extra) => {
      const item = { code, severity, message, scope: scope || 'global', file: '', line: 0, jump: null };
      if (extra) Object.assign(item, extra);
      issues.push(item);
    };

    const modules = MODULES.map((def) => ({
      id: def.id,
      name: def.id,
      file: def.file,
      tasks: 0,
      enabled: 0,
      disabled: 0,
      npcs: 0,
      switches: 0,
      issues: { error: 0, warn: 0, info: 0 },
      error: ''
    }));
    const moduleMap = new Map(modules.map((m) => [m.id, m]));

    const tasks = {};
    const lines = {};
    const generated = {};
    const baseIds = {};
    const definingModules = {};
    const npcTaskList = {};
    const switches = new Set();
    const moduleSwitches = {};

    for (const def of MODULES) {
      const filePath = path.join(scriptDir, def.file);
      const entry = moduleMap.get(def.id);
      let src;
      try {
        src = gbk.decode(fs.readFileSync(filePath));
      } catch (e) {
        entry.error = e.message;
        addIssue('task_module_unreadable', 'error', '模块读取失败：' + e.message, def.id, { file: def.file });
        entry.issues.error++;
        continue;
      }
      let state;
      try {
        state = parseModule(src);
      } catch (e) {
        const m = /第 (\d+) 行/.exec(e.message);
        const line = m ? Number(m[1]) : 0;
        entry.error = e.message;
        addIssue('task_parse_error', 'error', '解析失败：' + e.message, def.id, {
          file: def.file,
          line
        });
        entry.issues.error++;
        continue;
      }
      entry.switches = state.switchList.length;
      moduleSwitches[def.id] = new Set(state.switchList.map(Number));
      state.switchList.forEach((id) => switches.add(Number(id)));
      for (const [npc, list] of Object.entries(state.npcTaskList)) {
        npcTaskList[npc] = (npcTaskList[npc] || []).concat(asList(list));
      }
      const ids = Object.keys(state.tasks);
      entry.tasks = ids.length;
      for (const id of ids) {
        tasks[id] = state.tasks[id];
        lines[id] = state.lines[id] || 0;
        if (state.generated[id]) generated[id] = true;
        if (state.baseIds[id] != null) baseIds[id] = state.baseIds[id];
        if (!definingModules[id]) definingModules[id] = [];
        if (!definingModules[id].includes(def.id)) definingModules[id].push(def.id);
      }
      entry.npcs = Object.keys(state.npcTaskList).length;
    }

    const allIds = new Set(Object.keys(tasks).map(Number));
    for (const id of Object.keys(tasks)) {
      const mid = (definingModules[id] || [])[0];
      const m = moduleMap.get(mid);
      if (m && switches.has(Number(id))) m.enabled++;
    }
    modules.forEach((m) => {
      m.disabled = m.tasks - m.enabled;
    });

    // NPC list / script inventory
    let npcScripts = new Set();
    let npcError = '';
    try {
      const parsed = npcData.parseNpc(npcFile);
      npcScripts = new Set();
      for (const r of parsed.rows) {
        const id = String(r.id || '').trim();
        const script = String(r.script || '').replace(/\.py$/i, '').trim();
        if (id) npcScripts.add(id);
        if (script) npcScripts.add(script);
      }
    } catch (e) {
      npcError = e.message;
      addIssue('npc_list_unreadable', 'error', 'NPCList.txt 读取失败：' + e.message, 'global', {
        file: 'NPCList.txt'
      });
    }
    let scriptFiles = new Set();
    try {
      scriptFiles = new Set(
        fs
          .readdirSync(scriptDir)
          .filter((f) => /\.py$/i.test(f))
          .map((f) => f.replace(/\.py$/i, ''))
      );
    } catch (e) {
      scriptFiles = new Set();
    }

    // DB name sets
    let monsterNames = null;
    let itemNames = null;
    try {
      monsterNames = new Set(dbe.loadDb(monsterFile).rows.map((r) => String(r.Name || '').trim()));
      itemNames = new Set(dbe.loadDb(itemFile).rows.map((r) => String(r.Name || '').trim()));
    } catch (e) {
      monsterNames = null;
      itemNames = null;
    }

    const taskIssueCount = {};
    const bump = (id, sev) => {
      if (!taskIssueCount[id]) taskIssueCount[id] = { error: 0, warn: 0, info: 0 };
      taskIssueCount[id][sev]++;
    };

    const missingScripts = new Map();
    const missingMonsters = new Map();
    const missingItems = new Map();
    const missingPre = new Map();
    const missingPrizeTask = new Map();
    const unplacedNpc = new Map();
    const undefinedNpcTask = new Map();
    const duplicateIds = [];
    const invalidPrizes = [];
    const emptyNames = [];

    for (const id of Object.keys(tasks)) {
      const task = tasks[id];
      const file = task.FileName ? String(task.FileName) : '';
      if (!task.TaskName) {
        emptyNames.push(id);
        bump(id, 'info');
      }
      if (file && !scriptFiles.has(file)) {
        if (!missingScripts.has(file)) missingScripts.set(file, []);
        missingScripts.get(file).push(id);
        bump(id, 'warn');
      }
      const monsters = new Set(asList(task.MonsterList).map((n) => String(n)));
      if (task.MonsterMap && typeof task.MonsterMap === 'object') {
        Object.keys(task.MonsterMap).forEach((n) => monsters.add(n));
      }
      if (monsterNames) {
        for (const n of monsters) {
          if (!monsterNames.has(n.trim())) {
            missingMonsters.set(n, (missingMonsters.get(n) || 0) + 1);
            bump(id, 'warn');
          }
        }
      }
      const items = new Set(asList(task.ItemList).map((n) => String(n)));
      if (task.ItemMap && typeof task.ItemMap === 'object') {
        Object.keys(task.ItemMap).forEach((n) => items.add(n));
      }
      const collectPrizeItems = (map) => {
        if (!map || typeof map !== 'object') return;
        for (const stateKey of Object.keys(map)) {
          const stateNum = Number(stateKey);
          const label = Number.isFinite(stateNum) ? prizeLabel(stateNum) : '状态 ' + stateKey;
          for (const e of asList(map[stateKey])) {
            const pair = Array.isArray(e) ? e : [];
            if (pair.length !== 2 || !isInt(pair[0]) || pair[0] < 0 || pair[0] > 1000) {
              invalidPrizes.push({ id, label });
              bump(id, 'warn');
              continue;
            }
            const goods = pair[1] && typeof pair[1] === 'object' ? pair[1] : {};
            for (const key of Object.keys(goods)) {
              if (TASK_KEY[key]) {
                const target = Number(goods[key]);
                if (!allIds.has(target)) {
                  missingPrizeTask.set(key + '→' + target, (missingPrizeTask.get(key + '→' + target) || 0) + 1);
                  bump(id, 'warn');
                }
              } else {
                items.add(key);
              }
            }
          }
        }
      };
      collectPrizeItems(task.StatePrizeMap);
      if (itemNames) {
        for (const n of items) {
          if (CURRENCY.has(n.trim()) || TASK_KEY[n.trim()]) continue;
          if (!itemNames.has(n.trim())) {
            missingItems.set(n, (missingItems.get(n) || 0) + 1);
            bump(id, 'warn');
          }
        }
      }
      for (const group of asList(task.PreTaskList)) {
        for (const ref of asList(group)) {
          const v = Number(ref);
          if (!Number.isFinite(v)) continue;
          const abs = Math.abs(v);
          if (!allIds.has(abs)) {
            missingPre.set(v, (missingPre.get(v) || 0) + 1);
            bump(id, 'warn');
          }
        }
      }
      for (const npcs of Object.values(task.StateNpcMap || {})) {
        for (const n of asList(npcs)) {
          const name = String(n).replace(/\.py$/i, '').trim();
          if (!name) continue;
          if (!npcScripts.has(name) && !scriptFiles.has(name)) {
            unplacedNpc.set(name, (unplacedNpc.get(name) || 0) + 1);
          }
        }
      }
      if ((definingModules[id] || []).length > 1) {
        duplicateIds.push(id + '(' + definingModules[id].join('/') + ')');
      }
    }

    for (const [npc, list] of Object.entries(npcTaskList)) {
      const name = String(npc).replace(/\.py$/i, '').trim();
      if (name && !npcScripts.has(name) && !scriptFiles.has(name)) {
        unplacedNpc.set(name, (unplacedNpc.get(name) || 0) + 1);
      }
      for (const ref of asList(list)) {
        const v = Number(ref);
        if (Number.isFinite(v) && !allIds.has(v)) {
          undefinedNpcTask.set(String(v), (undefinedNpcTask.get(String(v)) || 0) + 1);
        }
      }
    }

    const switchOrphans = [...switches].filter((id) => !allIds.has(id));
    const disabledIds = Object.keys(tasks).filter((id) => !switches.has(Number(id)));

    if (missingScripts.size) {
      for (const [file, ids] of missingScripts) {
        addIssue(
          'task_script_missing',
          'warn',
          '任务脚本 ' + file + '.py 不存在（' + ids.length + ' 个任务引用，如 ' + ids.slice(0, 6).join(', ') + '）',
          (definingModules[ids[0]] || ['global'])[0],
          { file: file + '.py', jump: { task: Number(ids[0]) } }
        );
      }
    }
    if (switchOrphans.length) {
      addIssue(
        'task_switch_orphan',
        'warn',
        switchOrphans.length + ' 个任务开关没有对应任务定义（' + switchOrphans.slice(0, 12).join(', ') + '）',
        'global'
      );
    }
    if (disabledIds.length) {
      const byModule = modules
        .filter((m) => m.tasks > 0)
        .map((m) => m.id + ' ' + m.disabled)
        .join('、');
      addIssue(
        'task_disabled',
        'info',
        disabledIds.length + ' 个任务定义了但未启用（不在 TaskSwitchOnList）：' + byModule,
        'global'
      );
    }
    if (duplicateIds.length) {
      addIssue('task_duplicate_id', 'warn', '跨模块重复定义任务 ID：' + duplicateIds.slice(0, 10).join('；'), 'global');
    }
    if (missingPre.size) {
      const sample = [...missingPre.entries()].slice(0, 10).map(([id, n]) => id + '(' + n + ')');
      addIssue('task_pretask_missing', 'warn', missingPre.size + ' 个前置任务 ID 不存在：' + sample.join('、'), 'global');
    }
    if (missingPrizeTask.size) {
      const sample = [...missingPrizeTask.keys()].slice(0, 10);
      addIssue('task_prize_target_missing', 'warn', '奖励跳转任务不存在：' + sample.join('、'), 'global');
    }
    if (invalidPrizes.length) {
      const sample = invalidPrizes.slice(0, 10).map((p) => p.id);
      addIssue('task_prize_invalid', 'warn', invalidPrizes.length + ' 条奖励格式异常（任务 ' + sample.join(', ') + '）', 'global');
    }
    if (missingMonsters.size) {
      const sample = [...missingMonsters.entries()].slice(0, 10).map(([n, c]) => n + '(' + c + ')');
      addIssue('task_monster_missing', 'warn', missingMonsters.size + ' 个怪物名不在 Monster.DB：' + sample.join('、'), 'global');
    }
    if (missingItems.size) {
      const sample = [...missingItems.entries()].slice(0, 10).map(([n, c]) => n + '(' + c + ')');
      addIssue('task_item_missing', 'warn', missingItems.size + ' 个物品名不在 stditems.db：' + sample.join('、'), 'global');
    }
    if (unplacedNpc.size) {
      const sample = [...unplacedNpc.keys()].slice(0, 10);
      addIssue(
        'task_npc_unplaced',
        'info',
        unplacedNpc.size + ' 个任务 NPC 脚本既不在 NPCList.txt 也不在 NPCScript 目录：' + sample.join('、'),
        'global'
      );
    }
    if (undefinedNpcTask.size) {
      const sample = [...undefinedNpcTask.keys()].slice(0, 10);
      addIssue('task_npc_task_undefined', 'warn', undefinedNpcTask.size + ' 个 NPC 任务 ID 未定义：' + sample.join('、'), 'global');
    }
    if (emptyNames.length) {
      addIssue('task_name_empty', 'info', emptyNames.length + ' 个任务没有 TaskName：' + emptyNames.slice(0, 10).join(', '), 'global');
    }

    const list = Object.keys(tasks)
      .map((id) => {
        const t = tasks[id];
        const moduleId = (definingModules[id] || [])[0] || '';
        const levels = asList(t.LevelList).filter((v) => Number.isFinite(Number(v))).map(Number);
        const conditions = asList(t.ConditionList).map((c) => String(c));
        const monsters = new Set(asList(t.MonsterList).map(String));
        if (t.MonsterMap && typeof t.MonsterMap === 'object') Object.keys(t.MonsterMap).forEach((n) => monsters.add(n));
        const items = new Set(asList(t.ItemList).map(String));
        if (t.ItemMap && typeof t.ItemMap === 'object') Object.keys(t.ItemMap).forEach((n) => items.add(n));
        const npcs = new Set();
        Object.values(t.StateNpcMap || {}).forEach((v) => asList(v).forEach((n) => npcs.add(String(n).replace(/\.py$/i, ''))));
        return {
          id: Number(id),
          name: String(t.TaskName || ''),
          module: moduleId,
          file: t.FileName ? String(t.FileName) : '',
          line: lines[id] || 0,
          enabled: switches.has(Number(id)),
          generated: !!generated[id],
          levels: levels.length ? { min: Math.min(...levels), max: Math.max(...levels) } : null,
          state: isInt(t.TaskState) ? t.TaskState : null,
          timeLimit: isInt(t.TimeLimit) ? t.TimeLimit : null,
          conditions,
          monsters: [...monsters],
          items: [...items],
          npcs: [...npcs].filter(Boolean),
          issues: taskIssueCount[id] || { error: 0, warn: 0, info: 0 }
        };
      })
      .sort((a, b) => a.id - b.id);

    for (const m of modules) {
      m.issues = { error: 0, warn: 0, info: 0 };
    }
    for (const issue of issues) {
      if (issue.severity !== 'error') continue;
      const m = moduleMap.get(issue.scope);
      if (m) m.issues.error++;
    }
    for (const t of list) {
      const m = moduleMap.get(t.module);
      if (!m) continue;
      m.issues.error += t.issues.error;
      m.issues.warn += t.issues.warn;
      m.issues.info += t.issues.info;
    }

    const counts = { error: 0, warn: 0, info: 0 };
    issues.forEach((i) => counts[i.severity]++);
    const issueCodes = [...new Set(issues.map((i) => i.code))].sort();

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        modules: modules.length,
        tasks: list.length,
        enabled: list.filter((t) => t.enabled).length,
        npcs: Object.keys(npcTaskList).length,
        issues: counts,
        issueCodes
      },
      modules,
      tasks: list,
      issues,
      _raw: { tasks, lines, generated, baseIds, switches, allIds, npcTaskList, moduleIds: definingModules, moduleSwitches }
    };
  }

  function ensure() {
    const sig = signature();
    if (cached && sig === cachedSig) return cached;
    const model = buildModel();
    cachedSig = sig;
    cached = model;
    return model;
  }

  function list() {
    const model = ensure();
    return {
      generatedAt: model.generatedAt,
      stats: model.stats,
      modules: model.modules,
      tasks: model.tasks,
      issues: model.issues
    };
  }

  function detail(rawId) {
    const model = ensure();
    const id = Number(rawId);
    if (!Number.isFinite(id) || Math.floor(id) !== id) return null;
    const task = model._raw.tasks[String(id)];
    if (!task) return null;
    const allIds = model._raw.allIds;
    const exists = (v) => allIds.has(Math.abs(Number(v)));

    const preTasks = asList(task.PreTaskList).map((group) =>
      asList(group).map((ref) => ({
        id: Number(ref),
        negative: Number(ref) < 0,
        exists: exists(ref)
      }))
    );

    const stateNpcMap = sortedKeys(task.StateNpcMap).map((key) => ({
      state: Number(key),
      label: npcLabel(Number(key)),
      npcs: asList(task.StateNpcMap[key]).map((n) => String(n).replace(/\.py$/i, ''))
    }));

    const stateDespMap = sortedKeys(task.StateDespMap).map((key) => ({
      state: Number(key),
      label: npcLabel(Number(key)),
      text: dialogText(task.StateDespMap[key])
    }));

    const statePrizeMap = sortedKeys(task.StatePrizeMap).map((key) => {
      const entries = asList(task.StatePrizeMap[key]).map((e) => {
        const pair = Array.isArray(e) ? e : [];
        const chance = pair[0];
        const goods = pair[1] && typeof pair[1] === 'object' ? pair[1] : {};
        return {
          chance: isInt(chance) ? chance : null,
          items: Object.keys(goods).map((name) => {
            const isTask = !!TASK_KEY[name];
            const count = Number(goods[name]);
            return {
              name,
              count: Number.isFinite(count) ? count : String(goods[name]),
              taskId: isTask ? count : null,
              taskExists: isTask ? allIds.has(count) : null,
              pseudo: isTask ? TASK_KEY[name] : ''
            };
          })
        };
      });
      return { state: Number(key), label: prizeLabel(Number(key)), entries };
    });

    const monsterMap = task.MonsterMap && typeof task.MonsterMap === 'object'
      ? Object.keys(task.MonsterMap).map((name) => {
          const v = task.MonsterMap[name] || {};
          return {
            name,
            num: isInt(v.Num) ? v.Num : null,
            item: v.Item ? String(v.Item) : '',
            mobCordList: asList(v.MobCordList),
            destCordList: asList(v.DestCordList)
          };
        })
      : [];

    const itemMap = task.ItemMap && typeof task.ItemMap === 'object'
      ? Object.keys(task.ItemMap).map((name) => ({ name, value: task.ItemMap[name] }))
      : [];

    const callbackMap = task.CallbackMap && typeof task.CallbackMap === 'object'
      ? Object.keys(task.CallbackMap).map((name) => ({ name, value: task.CallbackMap[name] }))
      : [];

    const known = new Set([
      'TaskState', 'TaskName', 'FileName', 'CanUTFuncName', 'UTFuncName', 'TrigFuncName',
      'FulfilFuncName', 'TimeLimit', 'UniqueFlag', 'SaveFlag', 'PreTaskList', 'ConditionList',
      'LevelList', 'MonsterList', 'ItemList', 'CallbackList', 'StateNpcMap', 'StateDespMap',
      'StatePrizeMap', 'FulfilDespList', 'TaskDespList', 'StoryDespList', 'ExtraWorkFuncName',
      'MonsterMap', 'ItemMap', 'CallbackMap'
    ]);
    const extra = {};
    for (const key of Object.keys(task)) {
      if (!known.has(key)) extra[key] = task[key];
    }

    const moduleId = (model._raw.moduleIds[String(id)] || [])[0] || '';
    const moduleDef = MODULES.find((m) => m.id === moduleId);
    const sourceFile = task.FileName ? String(task.FileName) + '.py' : '';

    return {
      id,
      name: String(task.TaskName || ''),
      module: moduleId,
      moduleFile: moduleDef ? moduleDef.file : '',
      sourceFile,
      scriptExists: !!(sourceFile && (() => {
        try {
          return fs.statSync(path.join(scriptDir, sourceFile)).isFile();
        } catch (e) {
          return false;
        }
      })()),
      line: model._raw.lines[String(id)] || 0,
      generated: !!model._raw.generated[String(id)],
      baseId: model._raw.baseIds[String(id)] == null ? null : model._raw.baseIds[String(id)],
      enabled: model._raw.switches.has(id),
      fields: {
        TaskState: isInt(task.TaskState) ? task.TaskState : null,
        TimeLimit: isInt(task.TimeLimit) ? task.TimeLimit : null,
        UniqueFlag: isInt(task.UniqueFlag) ? task.UniqueFlag : null,
        SaveFlag: isInt(task.SaveFlag) ? task.SaveFlag : null,
        LevelList: asList(task.LevelList).map(Number).filter((v) => Number.isFinite(v)),
        ConditionList: asList(task.ConditionList).map(String),
        CanUTFuncName: task.CanUTFuncName || '',
        UTFuncName: task.UTFuncName || '',
        TrigFuncName: task.TrigFuncName || '',
        FulfilFuncName: task.FulfilFuncName || ''
      },
      conditions: asList(task.ConditionList).map((c) => ({
        code: String(c),
        label: CONDITION_LABELS[c] || String(c)
      })),
      preTasks,
      stateNpcMap,
      stateDespMap,
      statePrizeMap,
      monsterMap,
      itemMap,
      callbackMap,
      monsters: asList(task.MonsterList).map(String),
      items: asList(task.ItemList).map(String),
      callbackList: asList(task.CallbackList).map(String),
      despList: asList(task.TaskDespList).map(dialogText),
      storyDespList: asList(task.StoryDespList).map(dialogText),
      fulfilDespList: asList(task.FulfilDespList).map(dialogText),
      extra
    };
  }

  function summary() {
    const model = ensure();
    return { modules: model.stats.modules, tasks: model.stats.enabled };
  }

  function taskDependents(model, id) {
    const preTaskOf = [];
    const prizeOf = [];
    const npcTasks = [];
    const target = Math.abs(Number(id));
    for (const [tid, task] of Object.entries(model._raw.tasks)) {
      const numericId = Number(tid);
      if (numericId === target) continue;
      let ref = false;
      for (const group of asList(task.PreTaskList)) {
        for (const v of asList(group)) {
          if (Math.abs(Number(v)) === target) {
            ref = true;
            break;
          }
        }
        if (ref) break;
      }
      if (ref) preTaskOf.push(numericId);
      let jump = false;
      const prizes = task.StatePrizeMap && typeof task.StatePrizeMap === 'object' ? task.StatePrizeMap : {};
      for (const key of Object.keys(prizes)) {
        for (const entry of asList(prizes[key])) {
          const goods = Array.isArray(entry) && entry[1] && typeof entry[1] === 'object' ? entry[1] : {};
          for (const name of Object.keys(goods)) {
            if (TASK_KEY[name] && Number(goods[name]) === target) {
              jump = true;
              break;
            }
          }
          if (jump) break;
        }
        if (jump) break;
      }
      if (jump) prizeOf.push(numericId);
    }
    for (const [npc, list] of Object.entries(model._raw.npcTaskList)) {
      if (asList(list).some((v) => Number(v) === target)) npcTasks.push(npc);
    }
    const byNumber = (a, b) => a - b;
    preTaskOf.sort(byNumber);
    prizeOf.sort(byNumber);
    npcTasks.sort();
    return {
      preTaskOf,
      prizeOf,
      npcTasks,
      total: preTaskOf.length + prizeOf.length + npcTasks.length
    };
  }

  function setEnabled(rawId, enabled, opts) {
    const model = ensure();
    const id = Number(rawId);
    if (!Number.isFinite(id) || Math.floor(id) !== id) return { notFound: true };
    if (!model._raw.tasks[String(id)]) return { notFound: true };
    const force = !!(opts && opts.force);
    const current = model._raw.switches.has(id);
    if (enabled === current) {
      return { ok: true, changed: false, enabled: current, dependents: taskDependents(model, id) };
    }
    if (enabled) {
      const moduleId = (model._raw.moduleIds[String(id)] || [])[0];
      const def = MODULES.find((m) => m.id === moduleId);
      if (!def) throw new Error('无法确定任务所属模块');
      const res = writeSwitchFile(path.join(scriptDir, def.file), id, true);
      invalidate();
      return {
        ok: true,
        changed: res.changed,
        enabled: true,
        module: def.id,
        file: def.file,
        backup: res.backup || null,
        dependents: taskDependents(model, id)
      };
    }
    const dependents = taskDependents(model, id);
    if (dependents.total && !force) return { blocked: true, dependents };
    const files = [];
    for (const def of MODULES) {
      const set = model._raw.moduleSwitches[def.id];
      if (!set || !set.has(id)) continue;
      const res = writeSwitchFile(path.join(scriptDir, def.file), id, false);
      if (res.changed) files.push({ module: def.id, file: def.file, backup: res.backup });
    }
    invalidate();
    return { ok: true, changed: files.length > 0, enabled: false, files, dependents };
  }

  function invalidate() {
    cachedSig = '';
    cached = null;
  }

  return { list, detail, summary, setEnabled, invalidate };
}

module.exports = { create, MODULES };

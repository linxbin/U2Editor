'use strict';

const fs = require('fs');
const path = require('path');
const npc = require('./npc');
const pySyntax = require('./pysyntax');
const configs = require('./configs');

const CALL_SECOND = new Set([
  'playerMapMove',
  'moveToMap',
  'teamFlyToMap',
  'getHumNum',
  'getMonsterNum',
  'getMapMembers'
]);
const CALL_LAST = new Set(['processTimeRecall']);
const CALL_FIRST = new Set(['clearMonster', 'mobMonster']);
const LIST_CODE_RE = /^[A-Za-z]{1,5}\d{2,5}$/;

let cache = null;

function lower(value) {
  return String(value == null ? '' : value).toLowerCase();
}

function listing(scriptDir) {
  let names;
  try {
    names = fs.readdirSync(scriptDir)
      .filter((name) => /\.py$/i.test(name))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (e) {
    return { names: [], sig: 'missing' };
  }
  const parts = [];
  for (const name of names) {
    try {
      const st = fs.statSync(path.join(scriptDir, name));
      parts.push(`${name}:${st.size}:${st.mtimeMs}`);
    } catch (e) {
      parts.push(`${name}:0:0`);
    }
  }
  return { names, sig: parts.join(',') };
}

function signature(scriptDir) {
  return listing(path.resolve(scriptDir)).sig;
}

function knownSig(knownCodes) {
  if (!knownCodes || !knownCodes.size) return 'none';
  return [...knownCodes].map((code) => String(code).toUpperCase()).sort().join(',');
}

function maskStrings(line) {
  const out = line.split('');
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out[i] = ' ';
      if (ch === '\\') {
        if (i + 1 < line.length) out[i + 1] = ' ';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out[i] = ' ';
    }
  }
  return out.join('');
}

function findClose(line, open) {
  let quote = null;
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function assignmentValue(line, masked, name, out) {
  const re = new RegExp(`(^|[^\\w.])${name}\\s*=(?!=)`, 'g');
  let m;
  while ((m = re.exec(masked))) {
    let p = m.index + m[0].length;
    while (p < line.length && /\s/.test(line[p])) p++;
    const quote = line[p];
    if (quote !== "'" && quote !== '"') continue;
    const end = line.indexOf(quote, p + 1);
    if (end < 0) continue;
    out(quote, line.slice(p + 1, end));
  }
}

function findListClose(text, open) {
  let quote = null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineOf(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function scanLists(file, lines, masked, knownCodes, add) {
  const text = lines.join('\n');
  const maskedText = masked.join('\n');
  const starts = [];
  const keyRe = /(['"])MapList\1\s*:\s*\[/g;
  let m;
  while ((m = keyRe.exec(text))) {
    const colon = m.index + m[0].indexOf(':');
    if (maskedText[colon] !== ':') continue;
    starts.push({ open: m.index + m[0].length - 1, name: 'MapList' });
  }
  const varRe = /(^|[^\w.])([A-Za-z_]\w*)\s*=\s*\[/gm;
  while ((m = varRe.exec(maskedText))) {
    const name = m[2];
    if (!/map/i.test(name) || !/(list|lists|table)$/i.test(name)) continue;
    starts.push({ open: m.index + m[0].length - 1, name });
  }
  starts.sort((a, b) => a.open - b.open);

  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }

  const ranges = [];
  for (const start of starts) {
    if (ranges.some((r) => start.open >= r.open && start.open <= r.close)) continue;
    const close = findListClose(text, start.open);
    if (close < 0) continue;
    ranges.push({ open: start.open, close });
    let i = start.open + 1;
    while (i < close) {
      const quote = text[i];
      if (quote !== "'" && quote !== '"') { i++; continue; }
      let end = i + 1;
      let value = '';
      while (end < close) {
        const ch = text[end];
        if (ch === '\\') {
          value += text.slice(end, end + 2);
          end += 2;
          continue;
        }
        if (ch === quote) break;
        value += ch;
        end++;
      }
      if (end >= close) break;
      const trimmed = value.trim();
      const after = text.slice(end + 1, close);
      const isKey = /^\s*:/.test(after);
      if (trimmed && !isKey && (knownCodes.has(trimmed.toUpperCase()) || LIST_CODE_RE.test(trimmed))) {
        const line = lineOf(lineStarts, i);
        add(trimmed, line, lines[line - 1] || '', `地图列表 ${start.name}`);
      }
      i = end + 1;
    }
  }
}

function scan(scriptDir, knownCodes) {
  const dir = path.resolve(scriptDir);
  const files = listing(dir);
  const known = knownCodes instanceof Set ? knownCodes : new Set();
  const key = files.sig + '#' + knownSig(known);
  if (cache && cache.key === key) return cache.value;

  const refs = [];
  const seen = new Set();
  function add(code, file, line, text, kind) {
    const value = String(code == null ? '' : code).trim();
    if (!value) return;
    const dedupe = `${lower(value)}\u0000${file}\u0000${line}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    refs.push({ code: value, file, line, text: String(text || '').trim(), kind });
  }

  for (const file of files.names) {
    let text;
    try {
      text = configs.readFileLines(path.join(dir, file)).text.replace(/\u0000/g, '');
    } catch (e) {
      continue;
    }
    const lines = text.split('\n').map((line) => pySyntax.stripComment(line.replace(/\r$/, '')));
    const masked = lines.map(maskStrings);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (!line.trim()) continue;
      const mline = masked[li];
      const callRe = /(^|[^\w])([A-Za-z_]\w*)\s*\(/g;
      let m;
      while ((m = callRe.exec(mline))) {
        const name = m[2];
        const index = CALL_SECOND.has(name) ? 1 : (CALL_LAST.has(name) ? -1 : (CALL_FIRST.has(name) ? 0 : null));
        if (index === null) continue;
        const open = m.index + m[0].length - 1;
        const close = findClose(line, open);
        if (close < 0) continue;
        let args;
        try {
          args = npc.splitCallArgs(line, open + 1, close);
        } catch (e) {
          continue;
        }
        const arg = args[index < 0 ? args.length - 1 : index];
        if (!arg || !arg.quote) continue;
        add(arg.value, file, li + 1, line, `调用 ${name}`);
      }

      const keyRe = /(['"])(MapCode|UseMapCode|map)\1\s*:\s*(['"])([^'"]*)\3/g;
      while ((m = keyRe.exec(line))) {
        const colon = m.index + m[0].indexOf(':');
        if (mline[colon] !== ':') continue;
        add(m[4], file, li + 1, line, `字典键 ${m[2]}`);
      }

      assignmentValue(line, mline, 'MapCode', (quote, value) => {
        add(value, file, li + 1, line, '赋值 MapCode');
      });
      assignmentValue(line, mline, 'UseMapCode', (quote, value) => {
        add(value, file, li + 1, line, '赋值 UseMapCode');
      });
    }
    scanLists(file, lines, masked, known, (code, line, text, kind) => {
      add(code, file, line, text, kind);
    });
  }

  refs.sort((a, b) => a.file.localeCompare(b.file, 'zh-CN') || a.line - b.line);
  const byCode = new Map();
  for (const ref of refs) {
    const codeKey = lower(ref.code);
    if (!byCode.has(codeKey)) byCode.set(codeKey, []);
    byCode.get(codeKey).push(ref);
  }
  const value = { sig: files.sig, refs, byCode };
  cache = { key, value };
  return value;
}

module.exports = { signature, scan };

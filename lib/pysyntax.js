'use strict';

const { spawnSync } = require('child_process');

const PY_CODE = [
  'import sys, json, ast',
  "src = sys.stdin.buffer.read().decode('utf-8', 'replace')",
  'try:',
  '    ast.parse(src)',
  '    out = {"ok": True, "errors": []}',
  'except SyntaxError as e:',
  '    out = {"ok": False, "errors": [{"line": e.lineno or 0, "col": e.offset or 0, "message": e.msg or "invalid syntax"}]}',
  'except Exception as e:',
  '    out = {"ok": False, "errors": [{"line": 0, "col": 0, "message": str(e)}]}',
  "sys.stdout.buffer.write(json.dumps(out).encode('utf-8'))"
].join('\n');

const PY_MSG = [
  [/^invalid syntax$/i, '语法无效'],
  [/^unexpected indent$/i, '意外的缩进'],
  [/^unexpected unindent$/i, '意外的反缩进'],
  [/unindent does not match any outer indentation level/i, '缩进层级不匹配'],
  [/inconsistent use of tabs and spaces/i, '制表符与空格混用'],
  [/was never closed/i, '括号或引号未闭合'],
  [/was never opened/i, '出现多余的右括号'],
  [/Missing parentheses in call to 'print'/i, '疑似 Python 2 的 print 语句（语法检测按 Python 3 解析）'],
  [/invalid character/i, '存在非法字符'],
  [/source code string cannot contain null bytes/i, '内容包含空字符'],
  [/EOF while scanning/i, '文件在字符串或括号结束前中断']
];

function pythonMessage(raw) {
  const text = String(raw || '').trim();
  for (const [re, zh] of PY_MSG) {
    if (re.test(text)) return zh;
  }
  return text || '语法错误';
}

function replaceBackticks(line) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < line.length) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += line[i + 1] || '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i++;
      continue;
    }
    if (ch === '#') {
      out += line.slice(i);
      break;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '`') {
      const end = line.indexOf('`', i + 1);
      if (end > i) {
        out += 'repr(' + line.slice(i + 1, end) + ')';
        i = end + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function transformPy2(text) {
  return text.split('\n').map((line) => {
    let out = replaceBackticks(line);
    out = out.replace(/\b[uU][rR](['"])/g, 'r$1');
    out = out.replace(/<>/g, '!=');
    out = out.replace(/^(\s*)print\s*>>\s*([^,]+?)\s*,\s*(.+)$/, '$1print($3, file=$2)');
    out = out.replace(/^(\s*except\s+)(.*?)(\s*,\s*)([A-Za-z_]\w*)(\s*:.*)$/, '$1$2 as $4$5');
    out = out.replace(/(^|[^\w.])0([0-7]+)(?![\w.])/g, '$10o$2');
    return out;
  }).join('\n');
}

function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function compatibilityWarnings(text) {
  const out = [];
  const lines = text.split('\n');
  const push = (line, message) => {
    if (out.length < 50) out.push({ line, message });
  };
  for (let i = 0; i < lines.length; i++) {
    const code = stripComment(lines[i]);
    if (/(^|[^\w])[fF][rR]?["']/.test(code)) {
      push(i + 1, 'f-string 需要 Python 3.6+，游戏脚本运行时通常不支持');
    }
    if (/^\s*(async\s+def|await)\b/.test(code)) {
      push(i + 1, 'async / await 需要 Python 3.5+，游戏脚本运行时通常不支持');
    }
    if (/^\s*with\s+/.test(code)) {
      push(i + 1, 'with 语句需要 Python 2.5+，请确认游戏运行环境');
    }
    if (/^\s*except\s+.+\s+as\s+\w+\s*:/.test(code)) {
      push(i + 1, 'except ... as 需要 Python 2.6+，Python 2.4 请使用 except 类型, 变量:');
    }
    if (/^\s*yield\s+from\b/.test(code)) {
      push(i + 1, 'yield from 需要 Python 3.3+');
    }
    if (/^\s*nonlocal\b/.test(code)) {
      push(i + 1, 'nonlocal 需要 Python 3+');
    }
    if (/\w\s*:=\s*\S/.test(code)) {
      push(i + 1, '海象运算符 := 需要 Python 3.8+');
    }
  }
  return out;
}

const PAIRS = { '(': ')', '[': ']', '{': '}' };

function basicCheck(text) {
  const errors = [];
  const lines = text.split('\n');
  const stack = [];
  let string = '';
  let triple = false;
  let prevContinued = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = /^[ \t]*/.exec(line)[0];
    if (indent.includes(' ') && indent.includes('\t')) {
      errors.push({ line: i + 1, col: 1, message: '缩进同时包含制表符和空格' });
    }
    if (!string && !prevContinued) {
      const block = /^[ \t]*(if|elif|else|for|while|def|class|try|except|finally)\b/.exec(line);
      if (block) {
        const code = line.replace(/[ \t]+$/, '');
        if (!/:$/.test(stripComment(code))) {
          errors.push({ line: i + 1, col: 1, message: '语句块缺少冒号' });
        }
      }
    }
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      if (string) {
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (triple) {
          if (line.slice(j, j + 3) === string.repeat(3)) {
            string = '';
            triple = false;
            j += 3;
            continue;
          }
          j++;
          continue;
        }
        if (ch === string) {
          string = '';
          j++;
          continue;
        }
        j++;
        continue;
      }
      if (ch === '#') break;
      if (ch === '"' || ch === "'") {
        if (line.slice(j, j + 3) === ch.repeat(3)) {
          string = ch;
          triple = true;
          j += 3;
          continue;
        }
        string = ch;
        j++;
        continue;
      }
      if (PAIRS[ch]) {
        stack.push({ ch, line: i + 1 });
      } else if (ch === ')' || ch === ']' || ch === '}') {
        const open = stack.pop();
        if (!open || PAIRS[open.ch] !== ch) {
          errors.push({ line: i + 1, col: j + 1, message: '括号配对错误（出现多余的 ' + ch + '）' });
        }
      }
      j++;
    }
    if (string && !triple) {
      errors.push({ line: i + 1, col: line.length, message: '字符串引号未闭合' });
      string = '';
    }
    prevContinued = /\\$/.test(line) && !string;
    if (errors.length >= 20) break;
  }
  if (stack.length) {
    const open = stack[stack.length - 1];
    errors.push({ line: open.line, col: 1, message: '括号 ' + open.ch + ' 未闭合' });
  }
  return errors.slice(0, 20);
}

let pythonOk = null;

function runPython(text) {
  if (pythonOk === false) return null;
  const res = spawnSync('python', ['-c', PY_CODE], {
    input: transformPy2(text),
    timeout: 8000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
  if (res.error) {
    if (res.error.code === 'ENOENT') {
      pythonOk = false;
      return null;
    }
    return {
      ok: false,
      errors: [{
        line: 0,
        col: 0,
        message: res.error.code === 'ETIMEDOUT' ? '语法检测超时（8 秒）' : 'Python 检测失败：' + res.error.message
      }]
    };
  }
  if (!res.stdout || !res.stdout.length) {
    return { ok: false, errors: [{ line: 0, col: 0, message: 'Python 检测无输出' }] };
  }
  pythonOk = true;
  try {
    const parsed = JSON.parse(res.stdout.toString('utf8'));
    return {
      ok: !!parsed.ok,
      errors: (parsed.errors || []).map((e) => ({
        line: e.line || 0,
        col: e.col || 0,
        message: pythonMessage(e.message)
      }))
    };
  } catch (e) {
    return { ok: false, errors: [{ line: 0, col: 0, message: '无法解析 Python 检测结果' }] };
  }
}

function check(rawText) {
  const text = String(rawText == null ? '' : rawText).replace(/\r\n/g, '\n');
  const warnings = compatibilityWarnings(text);
  const py = runPython(text);
  if (py) {
    return { engine: 'python', ok: py.ok && !py.errors.length, errors: py.errors.slice(0, 20), warnings };
  }
  const errors = basicCheck(text);
  return {
    engine: 'js',
    ok: !errors.length,
    errors,
    warnings,
    note: '未检测到可用的 Python 3，已使用内置基础检查（缩进 / 括号 / 冒号）'
  };
}

module.exports = { check, stripComment };

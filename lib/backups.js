'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gbk = require('./gbk');
const dbe = require('./dbe');

const BACKUP_DIR = '备份';
const BACKUP_NAME_RE = /^(.+)\.(\d{8}-\d{6})(?:-\d+)?\.bak$/;
const TIME_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;
const MAX_SCAN_VERSIONS = 5000;
const MAX_VERSIONS_PER_FILE = 100;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LINES = 10000;
const MAX_DIFF_EDITS = 2000;
const MAX_DIFF_CELLS = 6000000;
const MAX_DIFF_DEPTH = 14;
const MAX_LINE_CHARS = 500;
const MAX_RESPONSE_BYTES = 500 * 1024;
const CONTEXT_LINES = 3;

function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
}

function badInput(message) {
  return httpError(400, message || '备份标识不合法');
}

function realpathSafe(p) {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    return null;
  }
}

function isInside(child, root) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function idOf(file) {
  return Buffer.from(file, 'utf8').toString('base64url');
}

function decodeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw badInput();
  const buf = Buffer.from(id, 'base64url');
  const text = buf.toString('utf8');
  if (!text || idOf(text) !== id) throw badInput();
  return text;
}

function parseBackupTime(raw) {
  const m = TIME_RE.exec(raw);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  if (
    Number.isNaN(d.getTime()) ||
    d.getFullYear() !== parts[0] || d.getMonth() !== parts[1] - 1 ||
    d.getDate() !== parts[2] || d.getHours() !== parts[3] ||
    d.getMinutes() !== parts[4] || d.getSeconds() !== parts[5]
  ) {
    return null;
  }
  return d;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTime(d) {
  return (
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
  );
}

function tokenOf(buf, stat) {
  if (!buf) return 'missing';
  const h = crypto.createHash('sha1');
  h.update(String(stat ? stat.size : buf.length) + ':' + String(stat ? stat.mtimeMs : 0) + '\n');
  h.update(buf);
  return h.digest('hex');
}

function statSafe(file) {
  try {
    return fs.statSync(file);
  } catch (e) {
    return null;
  }
}

function splitText(text) {
  const crlf = text.includes('\r\n');
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const finalNewline = normalized.endsWith('\n');
  if (finalNewline) normalized = normalized.slice(0, -1);
  return {
    lines: normalized === '' ? [] : normalized.split('\n'),
    eol: crlf ? 'CRLF' : 'LF',
    finalNewline
  };
}

function decodeText(buf) {
  let text;
  try {
    text = gbk.decodeText(buf);
  } catch (e) {
    return null;
  }
  if (text.includes('\uFFFD')) return null;
  try {
    gbk.encode(text);
  } catch (e) {
    return null;
  }
  return text;
}

function countLines(lines, from, to) {
  const map = new Map();
  for (let i = from; i < to; i++) {
    const line = lines[i];
    const cur = map.get(line);
    if (cur) cur.count++;
    else map.set(line, { count: 1, index: i });
  }
  return map;
}

function uniqueAnchors(a, a0, a1, b, b0, b1) {
  const fa = countLines(a, a0, a1);
  const fb = countLines(b, b0, b1);
  const pairs = [];
  for (const [line, info] of fa) {
    if (info.count !== 1) continue;
    const other = fb.get(line);
    if (!other || other.count !== 1) continue;
    pairs.push([info.index, other.index]);
  }
  if (!pairs.length) return pairs;
  pairs.sort((x, y) => x[0] - y[0]);
  const tails = [];
  const tailIdx = [];
  const prev = new Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < pairs[i][1]) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = pairs[i][1];
    tailIdx[lo] = i;
    if (lo > 0) prev[i] = tailIdx[lo - 1];
  }
  const out = [];
  let cur = tailIdx[tails.length - 1];
  while (cur >= 0) {
    out.push(pairs[cur]);
    cur = prev[cur];
  }
  out.reverse();
  return out;
}

function diffByLcs(a, a0, a1, b, b0, b1, ops) {
  const n = a1 - a0;
  const m = b1 - b0;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * width;
    const next = (i + 1) * width;
    for (let j = m - 1; j >= 0; j--) {
      if (a[a0 + i] === b[b0 + j]) dp[row + j] = dp[next + j + 1] + 1;
      else dp[row + j] = Math.max(dp[next + j], dp[row + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[a0 + i] === b[b0 + j]) {
      ops.push({ t: ' ', text: a[a0 + i], oldNo: a0 + i + 1, newNo: b0 + j + 1 });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ t: '-', text: a[a0 + i], oldNo: a0 + i + 1, newNo: null });
      i++;
    } else {
      ops.push({ t: '+', text: b[b0 + j], oldNo: null, newNo: b0 + j + 1 });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ t: '-', text: a[a0 + i], oldNo: a0 + i + 1, newNo: null });
  for (; j < m; j++) ops.push({ t: '+', text: b[b0 + j], oldNo: null, newNo: b0 + j + 1 });
}

function diffRange(a, a0, a1, b, b0, b1, ops, depth) {
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) {
    ops.push({ t: ' ', text: a[a0], oldNo: a0 + 1, newNo: b0 + 1 });
    a0++;
    b0++;
  }
  const suffix = [];
  while (a1 > a0 && b1 > b0 && a[a1 - 1] === b[b1 - 1]) {
    a1--;
    b1--;
    suffix.push({ t: ' ', text: a[a1], oldNo: a1 + 1, newNo: b1 + 1 });
  }
  if (a0 === a1) {
    for (let j = b0; j < b1; j++) ops.push({ t: '+', text: b[j], oldNo: null, newNo: j + 1 });
  } else if (b0 === b1) {
    for (let i = a0; i < a1; i++) ops.push({ t: '-', text: a[i], oldNo: i + 1, newNo: null });
  } else {
    const anchors = depth < MAX_DIFF_DEPTH ? uniqueAnchors(a, a0, a1, b, b0, b1) : [];
    if (anchors.length) {
      let ai = a0;
      let bi = b0;
      for (const [ax, bx] of anchors) {
        if (!diffRange(a, ai, ax, b, bi, bx, ops, depth + 1)) return false;
        ops.push({ t: ' ', text: a[ax], oldNo: ax + 1, newNo: bx + 1 });
        ai = ax + 1;
        bi = bx + 1;
      }
      if (!diffRange(a, ai, a1, b, bi, b1, ops, depth + 1)) return false;
    } else if ((a1 - a0) * (b1 - b0) <= MAX_DIFF_CELLS) {
      diffByLcs(a, a0, a1, b, b0, b1, ops);
    } else {
      return false;
    }
  }
  for (let i = suffix.length - 1; i >= 0; i--) ops.push(suffix[i]);
  return true;
}

function approxStats(oldLines, newLines) {
  const fo = countLines(oldLines, 0, oldLines.length);
  const fn = countLines(newLines, 0, newLines.length);
  let added = 0;
  let removed = 0;
  for (const [line, info] of fn) {
    const before = fo.get(line);
    if (!before) added += info.count;
    else if (info.count > before.count) added += info.count - before.count;
  }
  for (const [line, info] of fo) {
    const after = fn.get(line);
    if (!after) removed += info.count;
    else if (info.count > after.count) removed += info.count - after.count;
  }
  return { added, removed };
}

function clipLine(text) {
  return text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) + '…' : text;
}

function buildHunks(ops) {
  const changed = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].t !== ' ') changed.push(i);
  }
  if (!changed.length) return { hunks: [], truncated: false };
  const ranges = [];
  let start = Math.max(0, changed[0] - CONTEXT_LINES);
  let end = Math.min(ops.length - 1, changed[0] + CONTEXT_LINES);
  for (let k = 1; k < changed.length; k++) {
    const s = Math.max(0, changed[k] - CONTEXT_LINES);
    if (s <= end + 1) {
      end = Math.min(ops.length - 1, changed[k] + CONTEXT_LINES);
    } else {
      ranges.push([start, end]);
      start = s;
      end = Math.min(ops.length - 1, changed[k] + CONTEXT_LINES);
    }
  }
  ranges.push([start, end]);

  const hunks = [];
  let bytes = 0;
  let truncated = false;
  for (const [s, e] of ranges) {
    const slice = ops.slice(s, e + 1);
    const oldLines = slice.filter((l) => l.t !== '+');
    const newLines = slice.filter((l) => l.t !== '-');
    const lines = [];
    for (const op of slice) {
      const text = clipLine(op.text);
      bytes += Buffer.byteLength(text, 'utf8') + 96;
      if (bytes > MAX_RESPONSE_BYTES) {
        truncated = true;
        break;
      }
      lines.push({ t: op.t, oldNo: op.oldNo, newNo: op.newNo, text });
    }
    if (lines.length) {
      hunks.push({
        oldStart: oldLines.length ? oldLines[0].oldNo : 0,
        oldLen: oldLines.length,
        newStart: newLines.length ? newLines[0].newNo : 0,
        newLen: newLines.length,
        lines
      });
    }
    if (truncated) break;
  }
  return { hunks, truncated };
}

function countEdits(ops) {
  let n = 0;
  for (const op of ops) if (op.t !== ' ') n++;
  return n;
}

function create(options) {
  const envirDir = path.resolve(options.envirDir);
  const gameDir = path.dirname(envirDir);
  const envirReal = realpathSafe(envirDir);
  const gameReal = realpathSafe(gameDir);
  if (!envirReal) throw new Error('Envir 目录不存在：' + envirDir);

  function targetAllowed(target) {
    const parentReal = realpathSafe(path.dirname(target));
    if (!parentReal) return false;
    const targetReal = path.join(parentReal, path.basename(target));
    const insideEnvir = isInside(targetReal, envirReal);
    if (!insideEnvir && parentReal !== gameReal) return false;
    if (insideEnvir) {
      const rel = path.relative(envirReal, parentReal);
      if (rel && rel.split(path.sep).some((seg) => seg.toLowerCase() === 'map')) return false;
    }
    if (fs.existsSync(targetReal)) {
      const real = realpathSafe(targetReal);
      if (!real) return false;
      if (!isInside(real, envirReal) && path.dirname(real) !== gameReal) return false;
    }
    return true;
  }

  function displayPath(target) {
    let rel = path.relative(envirReal, target);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      rel = path.join(path.basename(gameReal), path.relative(gameReal, target));
    }
    return rel.split(path.sep).join('/');
  }

  function collectDirs() {
    const dirs = [];
    const seen = new Set();
    function addDir(dir) {
      const real = realpathSafe(dir);
      if (!real || seen.has(real)) return;
      seen.add(real);
      dirs.push(real);
    }
    function walk(dir, depth) {
      if (depth > 4) return;
      const real = realpathSafe(dir);
      if (!real) return;
      let entries;
      try {
        entries = fs.readdirSync(real, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        const lower = name.toLowerCase();
        if (lower === 'map' || lower === 'node_modules' || name.startsWith('.')) continue;
        const full = path.join(real, name);
        if (name === BACKUP_DIR) addDir(full);
        else walk(full, depth + 1);
      }
    }
    walk(envirReal, 0);
    addDir(path.join(gameReal, BACKUP_DIR));
    return dirs;
  }

  function resolveBackup(id) {
    const raw = decodeId(id);
    if (!path.isAbsolute(raw)) throw badInput();
    const candidate = path.resolve(raw);
    const backupReal = realpathSafe(candidate);
    if (!backupReal) throw httpError(404, '备份文件不存在');
    const dirReal = path.dirname(backupReal);
    if (path.basename(dirReal) !== BACKUP_DIR) throw badInput();
    if (path.dirname(backupReal) !== dirReal) throw badInput();
    const m = BACKUP_NAME_RE.exec(path.basename(backupReal));
    if (!m) throw badInput();
    const parentReal = path.dirname(dirReal);
    const target = path.join(parentReal, m[1]);
    if (!targetAllowed(target)) throw badInput('备份目标不在允许的配置目录内');
    return { backup: backupReal, target, original: m[1], timeKey: m[2] };
  }

  function scan() {
    const groups = new Map();
    let total = 0;
    let truncated = false;
    for (const dir of collectDirs()) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const m = BACKUP_NAME_RE.exec(entry.name);
        if (!m) continue;
        if (total >= MAX_SCAN_VERSIONS) {
          truncated = true;
          break;
        }
        const backup = path.join(dir, entry.name);
        const stat = statSafe(backup);
        if (!stat) continue;
        const target = path.join(path.dirname(dir), m[1]);
        if (!targetAllowed(target)) continue;
        let group = groups.get(target);
        if (!group) {
          group = {
            target,
            file: displayPath(target),
            versions: []
          };
          groups.set(target, group);
        }
        const when = parseBackupTime(m[2]) || new Date(stat.mtimeMs);
        group.versions.push({
          id: idOf(backup),
          name: entry.name,
          time: formatTime(when),
          ts: when.getTime(),
          size: stat.size
        });
        total++;
      }
      if (truncated) break;
    }

    const out = [];
    for (const group of groups.values()) {
      group.versions.sort((a, b) => b.ts - a.ts || (a.name < b.name ? 1 : -1));
      if (group.versions.length > MAX_VERSIONS_PER_FILE) {
        group.versions = group.versions.slice(0, MAX_VERSIONS_PER_FILE);
        truncated = true;
      }
      const stat = statSafe(group.target);
      out.push({
        id: group.file,
        file: group.file,
        dir: group.file.includes('/') ? group.file.slice(0, group.file.lastIndexOf('/')) : '根目录',
        type: group.target.toLowerCase().endsWith('.db') ? 'db' : 'text',
        exists: Boolean(stat),
        current: stat ? { size: stat.size, mtimeMs: stat.mtimeMs } : null,
        count: group.versions.length,
        versions: group.versions
      });
    }
    out.sort((a, b) => a.file.localeCompare(b.file, 'zh-CN'));
    return {
      scannedAt: new Date().toISOString(),
      truncated,
      totals: { files: out.length, versions: total },
      groups: out
    };
  }

  function diffText(file, backupBuf, currentBuf, currentStat) {
    const baseText = decodeText(backupBuf);
    const curText = currentBuf ? decodeText(currentBuf) : '';
    if (baseText == null || curText == null) {
      return {
        mode: 'binary',
        file,
        targetExists: Boolean(currentBuf),
        base: { size: backupBuf.length },
        current: currentBuf ? { size: currentBuf.length, mtimeMs: currentStat.mtimeMs } : null,
        currentToken: tokenOf(currentBuf, currentStat)
      };
    }
    const base = splitText(baseText);
    const cur = splitText(curText);
    const result = {
      mode: 'text',
      file,
      targetExists: Boolean(currentBuf),
      base: { size: backupBuf.length, lines: base.lines.length },
      current: currentBuf
        ? { size: currentBuf.length, lines: cur.lines.length, mtimeMs: currentStat.mtimeMs }
        : { size: 0, lines: 0, mtimeMs: null },
      eolChanged: base.eol !== cur.eol,
      finalNewlineChanged: base.finalNewline !== cur.finalNewline,
      stats: { added: 0, removed: 0, approx: false },
      hunks: [],
      truncated: false,
      currentToken: tokenOf(currentBuf, currentStat)
    };
    const tooBig =
      backupBuf.length > MAX_TEXT_BYTES || (currentBuf && currentBuf.length > MAX_TEXT_BYTES) ||
      base.lines.length > MAX_TEXT_LINES || cur.lines.length > MAX_TEXT_LINES;
    if (tooBig) {
      const approx = approxStats(base.lines, cur.lines);
      result.stats = { added: approx.added, removed: approx.removed, approx: true };
      result.truncated = true;
      return result;
    }
    const ops = [];
    const ok = diffRange(base.lines, 0, base.lines.length, cur.lines, 0, cur.lines.length, ops, 0);
    const edits = ok ? countEdits(ops) : -1;
    if (!ok || edits > MAX_DIFF_EDITS) {
      const approx = approxStats(base.lines, cur.lines);
      result.stats = { added: approx.added, removed: approx.removed, approx: true };
      result.truncated = true;
      return result;
    }
    let added = 0;
    let removed = 0;
    for (const op of ops) {
      if (op.t === '+') added++;
      else if (op.t === '-') removed++;
    }
    const built = buildHunks(ops);
    result.stats = { added, removed, approx: false };
    result.hunks = built.hunks;
    result.truncated = built.truncated;
    return result;
  }

  function dbMeta(buf) {
    const schema = dbe.parseSchema(buf);
    return {
      size: buf.length,
      recordCount: schema.recordCount,
      capacity: schema.capacity,
      recSize: schema.recSize
    };
  }

  function diff(id) {
    const info = resolveBackup(id);
    const backupStat = statSafe(info.backup);
    if (!backupStat) throw httpError(404, '备份文件不存在');
    let backupBuf;
    try {
      backupBuf = fs.readFileSync(info.backup);
    } catch (e) {
      throw httpError(404, '备份文件无法读取');
    }
    const currentStat = statSafe(info.target);
    const currentBuf = currentStat ? fs.readFileSync(info.target) : null;
    const file = displayPath(info.target);
    const currentToken = tokenOf(currentBuf, currentStat);

    if (info.target.toLowerCase().endsWith('.db')) {
      let baseMeta = null;
      let curMeta = null;
      try {
        baseMeta = dbMeta(backupBuf);
        if (currentBuf) curMeta = dbMeta(currentBuf);
      } catch (e) {
        return {
          mode: 'binary',
          file,
          targetExists: Boolean(currentBuf),
          base: { size: backupBuf.length },
          current: currentBuf ? { size: currentBuf.length, mtimeMs: currentStat.mtimeMs } : null,
          currentToken
        };
      }
      return {
        mode: 'db',
        file,
        targetExists: Boolean(currentBuf),
        base: { size: backupBuf.length, recordCount: baseMeta.recordCount, capacity: baseMeta.capacity, recSize: baseMeta.recSize },
        current: curMeta
          ? { size: currentBuf.length, recordCount: curMeta.recordCount, capacity: curMeta.capacity, recSize: curMeta.recSize, mtimeMs: currentStat.mtimeMs }
          : null,
        delta: curMeta
          ? { records: curMeta.recordCount - baseMeta.recordCount, capacity: curMeta.capacity - baseMeta.capacity }
          : { records: -baseMeta.recordCount, capacity: -baseMeta.capacity },
        currentToken
      };
    }

    return diffText(file, backupBuf, currentBuf, currentStat);
  }

  function restore(id, body) {
    const payload = body || {};
    const info = resolveBackup(id);
    let backupBuf;
    try {
      backupBuf = fs.readFileSync(info.backup);
    } catch (e) {
      throw httpError(404, '备份文件无法读取');
    }
    const expectedToken = typeof payload.expectedToken === 'string' ? payload.expectedToken : null;
    if (!expectedToken) throw badInput('缺少文件校验令牌，请重新加载差异');

    const before = statSafe(info.target);
    const beforeBuf = before ? fs.readFileSync(info.target) : null;
    const beforeToken = tokenOf(beforeBuf, before);
    if (!before) {
      if (!payload.allowMissing) {
        throw httpError(409, '目标文件不存在，恢复会重新创建该文件', { code: 'missing' });
      }
    } else if (beforeToken !== expectedToken) {
      throw httpError(409, '当前文件已被修改，请重新加载差异后再恢复', {
        code: 'stale',
        currentToken: beforeToken
      });
    }

    let preBackup = null;
    if (before) preBackup = dbe.backupFile(info.target);

    const dir = path.dirname(info.target);
    const tmp = path.join(
      dir,
      '.restore-' + process.pid + '-' + crypto.randomBytes(4).toString('hex') + '.tmp'
    );
    fs.writeFileSync(tmp, backupBuf, { flag: 'wx' });

    let nowBuf = null;
    let nowStat = null;
    try {
      nowStat = statSafe(info.target);
      nowBuf = nowStat ? fs.readFileSync(info.target) : null;
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (err) { /* ignore */ }
      throw httpError(409, '当前文件读取失败，请重试', { code: 'stale' });
    }
    const nowToken = tokenOf(nowBuf, nowStat);
    const nowExists = Boolean(nowStat);
    if (nowExists !== Boolean(before) || nowToken !== beforeToken) {
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
      throw httpError(409, '当前文件已被修改，请重新加载差异后再恢复', {
        code: 'stale',
        currentToken: nowToken
      });
    }

    try {
      fs.renameSync(tmp, info.target);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (err) { /* ignore */ }
      throw httpError(500, '恢复失败，目标文件可能被占用：' + e.message);
    }

    const afterStat = statSafe(info.target);
    return {
      ok: true,
      file: displayPath(info.target),
      backup: preBackup || null,
      restored: afterStat ? { size: afterStat.size, mtimeMs: afterStat.mtimeMs } : null,
      currentToken: tokenOf(backupBuf, afterStat)
    };
  }

  return { scan, diff, restore };
}

module.exports = { create };

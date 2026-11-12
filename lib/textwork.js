'use strict';

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const dbe = require('./dbe');
const npcData = require('./npc');

const PLACEHOLDER_RE = /^(这是类型\s*\d+|类型\s*\d+|no|无|暂无|todo|test)[。.!！]?$/i;
const MAX_ENTRY_CHARS = 1200;
const MAX_LINE_CHARS = 240;

const SOURCES = [
  {
    key: 'itemdesc', file: 'itemdesc.txt', label: '道具说明', kind: 'sections', group: '物品与对话',
    desc: '每段 [物品名] 下方是该物品在客户端道具说明中显示的文本。',
    editor: { view: 'extra', key: 'itemdesc' }
  },
  {
    key: 'monsterdialog', file: 'MonsterDialog.txt', label: '活动对话', kind: 'sections', group: '物品与对话',
    desc: '按 [类型N] 分段的活动对白，由引擎按类型编号取用。',
    editor: { view: 'extra', key: 'monsterdialog' }
  },
  {
    key: 'emotionchat', file: 'EmotionChat.txt', label: '表情聊天', kind: 'emotion', group: '物品与对话',
    desc: '每个 [动作] 段包含 1-4 号聊天文本，文件头部是全局称谓变量。',
    editor: { view: 'extra', key: 'emotionchat' }
  },
  {
    key: 'line', file: 'LineNotice.txt', label: '系统公告', kind: 'lines', group: '公告与提示',
    desc: '登录后显示的系统公告，一行一条。',
    editor: { view: 'ops', tab: 'notices' }
  },
  {
    key: 'float', file: 'FloatAD.txt', label: '滚动公告', kind: 'lines', group: '公告与提示',
    desc: '游戏内滚动播出的公告，一行一条。',
    editor: { view: 'ops', tab: 'notices' }
  },
  {
    key: 'bulletin', file: 'Bullitin.ini', label: '健康公告', kind: 'lines', group: '公告与提示',
    desc: '登录界面健康游戏公告，一行一条。',
    editor: { view: 'ops', tab: 'notices' }
  },
  {
    key: 'checknum', file: 'CheckNumInfo.txt', label: '地图验证信息', kind: 'checknum', group: '地图与提示',
    desc: '地图验证码提示点：地图 坐标X 坐标Y 范围宽 范围高，上一行 ; 注释为提示文本。',
    editor: { view: 'extra', key: 'checknum' }
  }
];

const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function toHalfWidth(value) {
  return String(value == null ? '' : value);
}

function create(options) {
  const envirDir = path.resolve(options.envirDir);
  const itemFile = path.resolve(options.itemFile);
  const mapInfoFile = path.resolve(options.mapInfoFile);
  let cache = null;

  function signature() {
    const parts = [];
    for (const s of SOURCES) parts.push(s.file + '|' + statSig(path.join(envirDir, s.file)));
    parts.push('items|' + statSig(itemFile));
    parts.push('map|' + statSig(mapInfoFile));
    return parts.join(';');
  }

  function readSource(def) {
    const file = path.join(envirDir, def.file);
    const out = {
      key: def.key, file: def.file, label: def.label, kind: def.kind, group: def.group,
      desc: def.desc, editor: def.editor,
      exists: false, size: 0, mtime: 0, text: '', lines: [], eol: '\r\n', trailing: true,
      encodingOk: true, readError: ''
    };
    let buf = null;
    try {
      const st = fs.statSync(file);
      out.exists = true;
      out.size = st.size;
      out.mtime = st.mtimeMs;
      buf = fs.readFileSync(file);
    } catch (e) {
      out.readError = e.message;
      return out;
    }
    try {
      out.text = gbk.decodeText(buf);
    } catch (e) {
      out.readError = e.message;
      return out;
    }
    try {
      out.encodingOk = gbk.encode(out.text).equals(buf);
    } catch (e) {
      out.encodingOk = false;
    }
    out.lines = out.text.split(/\r?\n/);
    out.trailing = out.lines.length > 0 && out.lines[out.lines.length - 1] === '';
    if (out.trailing) out.lines.pop();
    return out;
  }

  function splitSections(lines) {
    const head = [];
    const sections = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (m) {
        if (cur) sections.push(cur);
        cur = { name: m[1].trim(), headerLine: i + 1, body: [], startIndex: i + 1 };
        continue;
      }
      if (cur) cur.body.push({ line: i + 1, text: line });
      else head.push({ line: i + 1, text: line });
    }
    if (cur) sections.push(cur);
    for (const sec of sections) {
      sec.endLine = sec.body.length ? sec.body[sec.body.length - 1].line : sec.headerLine;
      sec.text = sec.body.map((b) => b.text).join('\n');
      sec.trimmed = sec.text.trim();
      sec.preview = '';
      for (const b of sec.body) {
        if (b.text.trim()) { sec.preview = b.text.trim(); break; }
      }
    }
    return { head, sections };
  }

  function itemIndex() {
    const byName = new Map();
    const duplicates = new Map();
    let error = '';
    try {
      const db = dbe.loadDb(itemFile);
      for (let i = 0; i < db.rows.length; i++) {
        const raw = db.rows[i];
        const name = toHalfWidth(raw && raw.Name).trim();
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, { index: i, row: raw });
        duplicates.set(name, (duplicates.get(name) || 0) + 1);
      }
    } catch (e) {
      error = e.message;
    }
    return { byName, duplicates, error };
  }

  function mapCodes() {
    const map = new Map();
    let error = '';
    try {
      for (const m of npcData.parseMapNames(mapInfoFile)) map.set(m.code, m.name);
    } catch (e) {
      error = e.message;
    }
    return { map, error };
  }

  function build() {
    const generatedAt = Date.now();
    const issues = [];
    const entries = [];
    const sources = [];
    const addIssue = (code, severity, message, extra) => {
      const e = extra || {};
      issues.push({
        code,
        severity,
        message,
        source: e.source || '',
        file: e.file || '',
        index: e.index == null ? null : e.index,
        line: e.line == null ? null : e.line,
        key: e.key || '',
        action: e.action || null
      });
    };

    const items = itemIndex();
    if (items.error) {
      addIssue('text_items_unreadable', 'warn',
        `stditems.db 读取失败，无法校验道具说明目标：${items.error}`, { file: 'stditems.db' });
    }
    const maps = mapCodes();
    if (maps.error) {
      addIssue('text_mapinfo_unreadable', 'warn',
        `MapInfo 读取失败，无法校验验证点地图：${maps.error}`, { file: 'MapInfo' });
    }

    for (const def of SOURCES) {
      const src = readSource(def);
      const srcEntryStart = entries.length;
      const srcIssuesStart = issues.length;
      const srcInfo = {
        key: src.key,
        file: src.file,
        label: src.label,
        kind: src.kind,
        group: src.group,
        desc: src.desc,
        editor: src.editor,
        exists: src.exists,
        size: src.size,
        mtime: src.mtime,
        encodingOk: src.encodingOk,
        entries: 0,
        chars: 0,
        issues: { error: 0, warn: 0, info: 0 }
      };
      sources.push(srcInfo);

      if (!src.exists) {
        addIssue('text_file_missing', 'error', `缺少文件 ${src.file}`, {
          source: src.key, file: src.file
        });
        srcInfo.issues.error++;
        continue;
      }
      if (src.readError) {
        addIssue('text_file_unreadable', 'error', `${src.file} 读取失败：${src.readError}`, {
          source: src.key, file: src.file
        });
        srcInfo.issues.error++;
        continue;
      }
      if (!src.encodingOk) {
        addIssue('text_file_encoding', 'warn', `${src.file} 含有无法无损转回 GBK 的字符`, {
          source: src.key, file: src.file
        });
        srcInfo.issues.warn++;
      }
      if (!src.text.trim()) {
        addIssue('text_file_empty', 'warn', `${src.file} 是空文件`, {
          source: src.key, file: src.file
        });
        srcInfo.issues.warn++;
        continue;
      }

      const sourceIssues = [];
      const pushIssue = (code, severity, message, extra) => {
        sourceIssues.push({ code, severity, message, extra: extra || {} });
      };

      function prepEntry(entry) {
        entry.index = entries.length - srcEntryStart;
        entry.source = src.key;
        entry.sourceLabel = src.label;
        entry.file = src.file;
        entry.chars = entry.text.replace(/\s+/g, '').length;
        const flags = entry.flags || [];
        let maxLine = 0;
        for (const line of entry.lines || []) maxLine = Math.max(maxLine, line.text.length);
        entry.maxLineChars = maxLine;
        if (!entry.text.trim()) flags.push('empty');
        else if (PLACEHOLDER_RE.test(entry.preview || '')) flags.push('placeholder');
        if (/\uFFFD/.test(entry.text)) flags.push('encoding');
        if (maxLine > MAX_LINE_CHARS) flags.push('long');
        else if (entry.chars > MAX_ENTRY_CHARS) flags.push('long');
        entry.flags = [...new Set(flags)];
        return entry;
      }

      function finishEntry(entry) {
        entries.push(entry);
      }

      function flagIssue(entry, flag, code, severity, message, extra) {
        pushIssue(code, severity, message, {
          source: src.key, file: src.file,
          index: entry.index,
          line: entry.line,
          key: entry.key, action: { view: 'entry', source: src.key, index: entry.index },
          ...(extra || {})
        });
      }

      if (src.kind === 'sections') {
        const parsed = splitSections(src.lines);
        const seen = new Map();
        for (const sec of parsed.sections) {
          const entry = {
            kind: 'section',
            key: sec.name,
            label: sec.name,
            line: sec.headerLine,
            endLine: sec.endLine,
            preview: sec.preview,
            text: sec.text,
            lines: [{ line: sec.headerLine, text: '[' + sec.name + ']', header: true }]
              .concat(sec.body),
            target: null,
            flags: []
          };
          prepEntry(entry);
          if (seen.has(sec.name)) {
            entry.flags.push('duplicate');
            flagIssue(entry, 'duplicate', 'text_duplicate', 'warn',
              `${src.file} 中「${sec.name}」重复出现（另有第 ${seen.get(sec.name)} 行的同名段）`, {
                line: sec.headerLine
              });
          } else {
            seen.set(sec.name, sec.headerLine);
          }

          if (src.key === 'itemdesc') {
            const item = items.byName.get(sec.name) || null;
            if (item) {
              entry.target = { type: 'item', name: sec.name, itemIndex: item.index };
            } else if (!items.error) {
              entry.flags.push('missing-item');
              flagIssue(entry, 'missing-item', 'text_item_missing', 'warn',
                `道具说明「${sec.name}」在 stditems.db 中找不到同名物品`, { line: sec.headerLine });
            }
          }

          if (!entry.text.trim()) {
            flagIssue(entry, 'empty', 'text_empty',
              src.key === 'monsterdialog' ? 'info' : 'warn',
              `${src.file} 中「${sec.name}」没有正文`, { line: sec.headerLine });
          } else if (entry.flags.includes('placeholder')) {
            flagIssue(entry, 'placeholder', 'text_placeholder', 'info',
              `${src.file} 中「${sec.name}」仍是占位文本：${sec.preview}`, { line: sec.headerLine });
          }

          if (entry.flags.includes('encoding')) {
            flagIssue(entry, 'encoding', 'text_entry_encoding', 'warn',
              `${src.file} 中「${sec.name}」含有无法还原的字符`, { line: sec.headerLine });
          }
          if (entry.maxLineChars > MAX_LINE_CHARS) {
            flagIssue(entry, 'long', 'text_line_long', 'warn',
              `${src.file} 中「${sec.name}」有单行 ${entry.maxLineChars} 字，超过 ${MAX_LINE_CHARS} 字`, {
                line: sec.headerLine
              });
          } else if (entry.chars > MAX_ENTRY_CHARS) {
            flagIssue(entry, 'long', 'text_too_long', 'warn',
              `${src.file} 中「${sec.name}」正文 ${entry.chars} 字，超过 ${MAX_ENTRY_CHARS} 字`, {
                line: sec.headerLine
              });
          }

          if (src.key === 'monsterdialog' && !/^类型\s*\d+$/i.test(sec.name)) {
            pushIssue('text_section_name', 'info',
              `${src.file} 中段名「${sec.name}」不是「类型N」格式，引擎可能无法取用`, {
                source: src.key, file: src.file,
                index: entries.length - srcEntryStart,
                line: sec.headerLine, key: sec.name,
                action: { view: 'entry', source: src.key, index: entries.length - srcEntryStart }
              });
          }
          finishEntry(entry);
        }
      } else if (src.kind === 'emotion') {
        const parsed = splitSections(src.lines);
        const vars = [];
        for (const h of parsed.head) {
          const t = h.text.trim();
          if (!t || t.startsWith(';') || t.startsWith('#')) continue;
          const m = /^\$([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(t);
          if (!m) {
            pushIssue('emotion_var_invalid', 'warn',
              `${src.file} 第 ${h.line} 行不是合法的变量赋值：${t}`, {
                source: src.key, file: src.file, line: h.line, key: t,
                action: { view: 'editor', source: src.key }
              });
            continue;
          }
          const value = m[2].trim();
          if (!/^"[^"]*"$/.test(value)) {
            pushIssue('emotion_var_unquoted', 'warn',
              `${src.file} 第 ${h.line} 行变量 $${m[1]} 的值没有用双引号包裹`, {
                source: src.key, file: src.file, line: h.line, key: m[1],
                action: { view: 'editor', source: src.key }
              });
          }
          if (vars.some((v) => v.name === m[1])) {
            pushIssue('emotion_var_duplicate', 'warn',
              `${src.file} 中变量 $${m[1]} 被重复赋值（第 ${h.line} 行）`, {
                source: src.key, file: src.file, line: h.line, key: m[1],
                action: { view: 'editor', source: src.key }
              });
          }
          vars.push({ name: m[1], value, line: h.line });
        }

        const seen = new Map();
        for (const sec of parsed.sections) {
          const variants = new Map();
          const badLines = [];
          for (const b of sec.body) {
            const t = b.text.trim();
            if (!t) continue;
            const m = /^([1-4])[.．]\s*(.*)$/.exec(t);
            if (!m) { badLines.push(b); continue; }
            const no = Number(m[1]);
            variants.set(no, { line: b.line, text: m[2] });
          }
          const entry = {
            kind: 'emotion',
            key: sec.name,
            label: sec.name,
            line: sec.headerLine,
            endLine: sec.endLine,
            preview: sec.preview,
            text: sec.text,
            lines: [{ line: sec.headerLine, text: '[' + sec.name + ']', header: true }]
              .concat(sec.body),
            target: null,
            flags: [],
            variants: [...variants.entries()].sort((a, b) => a[0] - b[0]).map(([no, v]) => ({
              no, line: v.line, text: v.text
            }))
          };
          prepEntry(entry);
          if (seen.has(sec.name)) {
            entry.flags.push('duplicate');
            flagIssue(entry, 'duplicate', 'text_duplicate', 'warn',
              `${src.file} 中动作「${sec.name}」重复出现（另有第 ${seen.get(sec.name)} 行）`, {
                line: sec.headerLine
              });
          } else {
            seen.set(sec.name, sec.headerLine);
          }
          const missing = [1, 2, 3, 4].filter((no) => !variants.has(no));
          if (missing.length) {
            entry.flags.push('variant-missing');
            flagIssue(entry, 'variant-missing', 'emotion_variant_missing', 'warn',
              `${src.file} 中动作「${sec.name}」缺少 ${missing.map((n) => n + '.').join(' ')} 文本`, {
                line: sec.headerLine
              });
          }
          for (const [no, v] of variants) {
            if (!v.text.trim()) {
              entry.flags.push('empty');
              flagIssue(entry, 'empty', 'emotion_variant_empty', 'info',
                `${src.file} 中动作「${sec.name}」的 ${no}. 文本为空`, { line: v.line });
            }
          }
          for (const b of badLines) {
            entry.flags.push('line-invalid');
            flagIssue(entry, 'line-invalid', 'emotion_line_invalid', 'warn',
              `${src.file} 中动作「${sec.name}」第 ${b.line} 行没有 1-4 编号：${b.text.trim().slice(0, 40)}`, {
                line: b.line
              });
          }
          if (!sec.text.trim()) {
            entry.flags.push('empty');
            flagIssue(entry, 'empty', 'text_empty', 'warn',
              `${src.file} 中动作「${sec.name}」没有正文`, { line: sec.headerLine });
          }
          finishEntry(entry);
        }
      } else if (src.kind === 'lines') {
        const seen = new Map();
        for (let i = 0; i < src.lines.length; i++) {
          const raw = src.lines[i];
          const text = raw.trim();
          if (!text) continue;
          if (text.startsWith(';')) continue;
          const entry = {
            kind: 'line',
            key: '第 ' + (i + 1) + ' 行',
            label: '第 ' + (i + 1) + ' 行',
            line: i + 1,
            endLine: i + 1,
            preview: text,
            text: raw.replace(/\s+$/, ''),
            lines: [{ line: i + 1, text: raw }],
            target: null,
            flags: []
          };
          prepEntry(entry);
          if (seen.has(text)) {
            entry.flags.push('duplicate');
            flagIssue(entry, 'duplicate', 'text_duplicate', 'info',
              `${src.file} 第 ${i + 1} 行与第 ${seen.get(text)} 行内容重复`, { line: i + 1 });
          } else {
            seen.set(text, i + 1);
          }
          if (/\uFFFD/.test(raw)) {
            entry.flags.push('encoding');
            flagIssue(entry, 'encoding', 'text_entry_encoding', 'warn',
              `${src.file} 第 ${i + 1} 行含有无法还原的字符`, { line: i + 1 });
          }
          if (raw.length > MAX_LINE_CHARS) {
            entry.flags.push('long');
            flagIssue(entry, 'long', 'text_line_long', 'warn',
              `${src.file} 第 ${i + 1} 行 ${raw.length} 字，超过 ${MAX_LINE_CHARS} 字`, { line: i + 1 });
          }
          finishEntry(entry);
        }
      } else if (src.kind === 'checknum') {
        let comment = '';
        let commentLine = 0;
        for (let i = 0; i < src.lines.length; i++) {
          const raw = src.lines[i];
          const text = raw.trim();
          if (!text) { comment = ''; continue; }
          if (text.startsWith(';')) {
            comment = text.replace(/^;+\s*/, '');
            commentLine = i + 1;
            continue;
          }
          const parts = text.split(/\s+/);
          const entry = {
            kind: 'checknum',
            key: comment || '第 ' + (i + 1) + ' 行',
            label: comment || ('行 ' + (i + 1)),
            line: i + 1,
            endLine: i + 1,
            comment,
            commentLine,
            fields: parts,
            preview: comment ? comment + ' · ' + parts.join(' ') : parts.join(' '),
            text: raw.replace(/\s+$/, ''),
            lines: [{ line: i + 1, text: raw }],
            target: null,
            flags: []
          };
          if (commentLine) entry.lines.unshift({ line: commentLine, text: src.lines[commentLine - 1], comment: true });
          prepEntry(entry);
          if (parts.length !== 5) {
            entry.flags.push('invalid');
            flagIssue(entry, 'invalid', 'checknum_row_invalid', 'warn',
              `${src.file} 第 ${i + 1} 行应有 5 列（地图 X Y 宽 高），实际 ${parts.length} 列`, {
                line: i + 1
              });
          } else {
            const [code, x, y, w, h] = parts;
            if (!maps.map.has(code) && !maps.error) {
              entry.flags.push('map-missing');
              flagIssue(entry, 'map-missing', 'checknum_map_missing', 'warn',
                `${src.file} 第 ${i + 1} 行地图「${code}」不在 MapInfo 中`, { line: i + 1 });
            }
            const nums = [x, y, w, h].map(Number);
            if (nums.some((n) => !Number.isFinite(n) || n < 0) || nums[2] <= 0 || nums[3] <= 0) {
              entry.flags.push('invalid');
              flagIssue(entry, 'invalid', 'checknum_number_invalid', 'warn',
                `${src.file} 第 ${i + 1} 行坐标或范围不是合法非负整数：${parts.slice(1).join(' ')}`, {
                  line: i + 1
                });
            }
            if (maps.map.has(code)) {
              entry.target = { type: 'map', name: maps.map.get(code), code };
            }
          }
          if (!comment) {
            entry.flags.push('comment-missing');
            flagIssue(entry, 'comment-missing', 'checknum_comment_missing', 'info',
              `${src.file} 第 ${i + 1} 行上方没有 ; 提示文本`, { line: i + 1 });
          }
          if (/\uFFFD/.test(raw)) {
            entry.flags.push('encoding');
            flagIssue(entry, 'encoding', 'text_entry_encoding', 'warn',
              `${src.file} 第 ${i + 1} 行含有无法还原的字符`, { line: i + 1 });
          }
          finishEntry(entry);
          comment = '';
        }
      }

      for (const item of sourceIssues) {
        addIssue(item.code, item.severity, item.message, item.extra);
      }
      srcInfo.entries = entries.length - srcEntryStart;
      srcInfo.chars = entries.slice(srcEntryStart).reduce((n, e) => n + e.chars, 0);
      for (const issue of issues.slice(srcIssuesStart)) {
        if (srcInfo.issues[issue.severity] != null) srcInfo.issues[issue.severity]++;
      }
    }

    const issueCounts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) if (issueCounts[issue.severity] != null) issueCounts[issue.severity]++;

    const stats = {
      sources: sources.length,
      entries: entries.length,
      chars: entries.reduce((n, e) => n + e.chars, 0),
      files: sources.filter((s) => s.exists).length,
      issues: issueCounts
    };

    return {
      generatedAt,
      stats,
      sources,
      entries: entries.map((e) => ({
        source: e.source, index: e.index, kind: e.kind, key: e.key, label: e.label,
        line: e.line, endLine: e.endLine, preview: e.preview, chars: e.chars,
        maxLineChars: e.maxLineChars, flags: e.flags, target: e.target,
        variants: e.variants || undefined
      })),
      issues,
      _entries: entries,
      _sources: sources
    };
  }

  function ensure() {
    const sig = signature();
    if (!cache || cache.sig !== sig) {
      const data = build();
      data.sig = sig;
      cache = data;
    }
    return cache;
  }

  function list() {
    const d = ensure();
    return {
      generatedAt: d.generatedAt,
      stats: d.stats,
      sources: d.sources,
      entries: d.entries,
      issues: d.issues
    };
  }

  function detail(rawSource, rawIndex) {
    const d = ensure();
    const source = SOURCE_BY_KEY.get(String(rawSource || ''));
    if (!source) return null;
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    const entry = d._entries.find((e) => e.source === source.key && e.index === index);
    if (!entry) return null;
    const srcInfo = d._sources.find((s) => s.key === source.key) || null;
    return {
      generatedAt: d.generatedAt,
      source: srcInfo,
      entry,
      issues: d.issues.filter((issue) => issue.source === source.key && issue.index === index)
    };
  }

  function search(rawQuery, rawLimit) {
    const d = ensure();
    const query = String(rawQuery == null ? '' : rawQuery).trim();
    const limit = Math.min(1000, Math.max(1, Number(rawLimit) || 300));
    if (!query) {
      return { generatedAt: d.generatedAt, query: '', total: 0, results: [], truncated: false, limit };
    }
    const needle = query.toLowerCase();
    const results = [];
    let total = 0;
    for (const entry of d._entries) {
      let hit = null;
      let count = 0;
      for (const line of entry.lines || []) {
        if (toHalfWidth(line.text).toLowerCase().indexOf(needle) < 0) continue;
        count++;
        if (!hit) hit = { line: line.line, text: line.text.length > 200 ? line.text.slice(0, 200) : line.text };
      }
      if (!hit) continue;
      total++;
      if (results.length < limit) {
        results.push({
          source: entry.source, sourceLabel: entry.sourceLabel, index: entry.index,
          key: entry.key, label: entry.label, line: hit.line, text: hit.text,
          count, flags: entry.flags
        });
      }
    }
    return {
      generatedAt: d.generatedAt,
      query,
      total,
      results,
      truncated: total > results.length,
      limit
    };
  }

  function summary() {
    const d = ensure();
    return { generatedAt: d.generatedAt, stats: d.stats };
  }

  function invalidate() {
    cache = null;
  }

  return { list, detail, search, summary, invalidate };
}

module.exports = { create, SOURCES };

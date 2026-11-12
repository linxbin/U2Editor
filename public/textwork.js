'use strict';

/* 文案 / 对话工作台：统一索引、GBK 预览、目标跳转与编辑入口 */

const TXW_FLAGS = [
  { key: 'all', label: '全部' },
  { key: 'issues', label: '有异常' },
  { key: 'empty', label: '空文本' },
  { key: 'placeholder', label: '占位' },
  { key: 'missing-item', label: '目标缺失' },
  { key: 'long', label: '超长' },
  { key: 'duplicate', label: '重复' },
  { key: 'encoding', label: '编码' }
];

const TXW_KIND_LABEL = {
  sections: '分段文本',
  emotion: '表情变体',
  lines: '逐行文本',
  checknum: '地图验证'
};

const TXW_FLAG_LABEL = {
  empty: '空文本',
  placeholder: '占位',
  'missing-item': '目标缺失',
  long: '超长',
  duplicate: '重复',
  encoding: '编码',
  'variant-missing': '缺少变体',
  'line-invalid': '格式错误',
  'map-missing': '地图缺失',
  'comment-missing': '无提示',
  invalid: '格式错误'
};

const TXW_ISSUE_LABEL = {
  text_file_missing: '文件缺失',
  text_file_unreadable: '文件读取',
  text_file_encoding: '文件编码',
  text_file_empty: '空文件',
  text_empty: '空文本',
  text_placeholder: '占位文本',
  text_duplicate: '重复内容',
  text_item_missing: '目标缺失',
  text_too_long: '正文超长',
  text_line_long: '单行超长',
  text_entry_encoding: '条目编码',
  text_section_name: '段名格式',
  emotion_var_invalid: '变量格式',
  emotion_var_unquoted: '变量引号',
  emotion_var_duplicate: '变量重复',
  emotion_variant_missing: '缺少变体',
  emotion_variant_empty: '空变体',
  emotion_line_invalid: '编号格式',
  checknum_row_invalid: '列数错误',
  checknum_map_missing: '地图缺失',
  checknum_number_invalid: '数值异常',
  checknum_comment_missing: '缺少提示',
  text_items_unreadable: '物品库读取',
  text_mapinfo_unreadable: '地图库读取'
};

const TXW_TAB_KEYS = ['detail', 'health'];
const TXW_SEV = { error: '错误', warn: '警告', info: '提示' };

const TXW = {
  data: null,
  stale: true,
  loading: false,
  source: 'all',
  tab: 'detail',
  flag: 'all',
  query: '',
  search: null,
  searchToken: 0,
  selected: null,
  detail: null,
  detailLoading: false,
  detailToken: 0,
  notFound: ''
};

function txwEl(id) {
  return document.getElementById(id);
}

function txwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function txwText(id, text) {
  const el = txwEl(id);
  if (el) el.textContent = text;
}

function txwFmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function txwSource(key) {
  if (!TXW.data) return null;
  return (TXW.data.sources || []).find((s) => s.key === key) || null;
}

function txwHashState() {
  const m = /^#text(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  let raw = m[1] || '';
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
  }
  if (!raw || raw === 'all') return { tab: 'detail', source: 'all' };
  if (raw === 'health') return { tab: 'health', source: TXW.source };
  if (raw === 'search') return { tab: 'detail', source: TXW.source, search: true };
  const em = /^([a-z]+)-(\d+)$/.exec(raw);
  if (em && TXW.data && TXW.data.sources.some((s) => s.key === em[1])) {
    return { tab: 'detail', source: em[1], index: Number(em[2]) };
  }
  if (TXW.data && TXW.data.sources.some((s) => s.key === raw)) return { tab: 'detail', source: raw };
  return { tab: 'detail', source: null, name: raw };
}

function txwSetHash(state) {
  let raw = '';
  if (state && state.tab === 'health') raw = 'health';
  else if (state && state.search) raw = 'search';
  else if (state && state.index != null) raw = state.source + '-' + state.index;
  else if (state && state.source && state.source !== 'all') raw = state.source;
  const next = raw ? '#text=' + raw : '#text';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function txwLoad(refresh) {
  if (TXW.loading) return;
  TXW.loading = true;
  txwRenderMeta();
  try {
    const data = await api('/api/config/textwork' + (refresh ? '?refresh=1' : ''));
    TXW.data = data;
    TXW.stale = false;
    txwText('textWorkCount', String(data.stats.entries));
  } finally {
    TXW.loading = false;
  }
}

function txwRenderMeta() {
  const meta = txwEl('txwMeta');
  if (!meta) return;
  if (!TXW.data) {
    meta.textContent = TXW.loading ? '正在读取文案索引…' : '';
    return;
  }
  const d = TXW.data;
  const s = d.stats;
  meta.textContent = [
    `文案 ${txwFmtNum(s.entries)} 条`,
    `${txwFmtNum(s.chars)} 字`,
    `${s.files} 个文件`,
    `问题 ${s.issues.error} 错误 / ${s.issues.warn} 警告 / ${s.issues.info} 提示`
  ].join(' · ');
}

function txwSourceIssues(key) {
  if (!TXW.data || key === 'all') return [];
  return TXW.data.issues.filter((issue) => issue.source === key);
}

function txwFlagMatch(entry) {
  if (TXW.flag === 'all') return true;
  if (TXW.flag === 'issues') return entry.flags && entry.flags.length > 0;
  return entry.flags && entry.flags.indexOf(TXW.flag) >= 0;
}

function txwEntriesFor(source, query) {
  if (!TXW.data) return [];
  const needle = String(query || '').trim().toLowerCase();
  return TXW.data.entries.filter((entry) => {
    if (source !== 'all' && entry.source !== source) return false;
    if (!txwFlagMatch(entry)) return false;
    if (needle && (entry.label + '\n' + entry.preview).toLowerCase().indexOf(needle) < 0) return false;
    return true;
  });
}

function txwFlagChips(entry) {
  return (entry.flags || []).map((f) =>
    '<span class="txw-flag txw-flag-' + txwEsc(f) + '">' + txwEsc(TXW_FLAG_LABEL[f] || f) + '</span>').join('');
}

function txwRenderList() {
  const list = txwEl('txwList');
  if (!list) return;
  if (!TXW.data) {
    list.innerHTML = '<li class="side-note">' + (TXW.loading ? '正在读取…' : '暂无数据') + '</li>';
    return;
  }
  const items = [];
  const allIssues = txwAllIssues();
  items.push(
    '<li class="file-item' + (TXW.source === 'all' ? ' active' : '') + '" data-txw-source="all">' +
      '<div class="fname">全部文案' + (allIssues ? ' <span class="npw-tag">' + allIssues + '</span>' : '') + '</div>' +
      '<div class="fmeta">' + TXW.data.sources.length + ' 个来源 · ' + txwFmtNum(TXW.data.stats.entries) + ' 条</div>' +
    '</li>'
  );
  for (const src of TXW.data.sources) {
    const issueTotal = src.issues.error + src.issues.warn + src.issues.info;
    items.push(
      '<li class="file-item' + (TXW.source === src.key ? ' active' : '') + '" data-txw-source="' + txwEsc(src.key) + '">' +
        '<div class="fname">' + txwEsc(src.label) +
          (issueTotal ? ' <span class="npw-tag' + (src.issues.error || src.issues.warn ? ' bad' : '') + '">' + issueTotal + '</span>' : '') +
        '</div>' +
        '<div class="fmeta">' + txwEsc(src.file) + ' · ' + src.entries + ' 条</div>' +
      '</li>'
    );
  }
  list.innerHTML = items.join('');
  const hint = txwEl('txwListHint');
  if (hint) {
    hint.textContent = '共 ' + TXW.data.sources.length + ' 个来源、' + TXW.data.stats.entries + ' 条文案；点击来源筛选，搜索会跨全部来源匹配。';
  }
}

function txwAllIssues() {
  if (!TXW.data) return 0;
  const s = TXW.data.stats.issues;
  return s.error + s.warn + s.info;
}

function txwSelectSource(key) {
  if (key !== 'all' && !txwSource(key)) {
    TXW.notFound = String(key || '');
    TXW.selected = null;
    TXW.detail = null;
    TXW.search = null;
    TXW.source = 'all';
    txwRenderAll();
    txwSetHash({ tab: 'detail' });
    return;
  }
  TXW.source = key;
  TXW.selected = null;
  TXW.detail = null;
  TXW.search = null;
  TXW.notFound = '';
  TXW.tab = 'detail';
  txwRenderAll();
  txwSetHash({ tab: 'detail', source: key });
}

async function txwOpenEntry(source, index, opts) {
  const src = txwSource(source);
  if (!src) return;
  TXW.source = source;
  TXW.selected = { source, index };
  TXW.notFound = '';
  TXW.tab = 'detail';
  TXW.detailLoading = true;
  const token = ++TXW.detailToken;
  txwRenderAll();
  if (!opts || opts.hash !== false) txwSetHash({ tab: 'detail', source, index });
  try {
    const detail = await api('/api/config/textwork/detail?source=' + encodeURIComponent(source) +
      '&index=' + encodeURIComponent(index));
    if (token !== TXW.detailToken) return;
    TXW.detail = detail;
  } catch (e) {
    if (token !== TXW.detailToken) return;
    TXW.detail = null;
    toast('加载文案详情失败：' + e.message, 'err');
  } finally {
    if (token === TXW.detailToken) {
      TXW.detailLoading = false;
      txwRenderAll();
    }
  }
}

function txwBack() {
  TXW.selected = null;
  TXW.detail = null;
  TXW.notFound = '';
  txwRenderAll();
  if (TXW.search && TXW.search.query) txwSetHash({ tab: 'detail', source: TXW.source, search: true });
  else txwSetHash({ tab: 'detail', source: TXW.source });
}

let txwSearchTimer = null;
async function txwRunSearch(query) {
  const q = String(query == null ? '' : query).trim();
  TXW.query = q;
  if (!q) {
    TXW.search = null;
    TXW.selected = null;
    TXW.detail = null;
    txwRenderAll();
    if (TXW.source && TXW.source !== 'all') txwSetHash({ tab: 'detail', source: TXW.source });
    else txwSetHash({ tab: 'detail' });
    return;
  }
  const token = ++TXW.searchToken;
  const data = await api('/api/config/textwork/search?q=' + encodeURIComponent(q) + '&limit=500');
  if (token !== TXW.searchToken) return;
  TXW.search = data;
  TXW.selected = null;
  TXW.detail = null;
  txwRenderAll();
  txwSetHash({ tab: 'detail', source: TXW.source, search: true });
}

function txwIssueChip(issue) {
  return '<span class="mon-sev ' + txwEsc(issue.severity) + '">' + txwEsc(TXW_SEV[issue.severity] || issue.severity) + '</span>';
}

function txwRenderIssues(issues, emptyText) {
  if (!issues || !issues.length) {
    return '<div class="tsk-empty">' + txwEsc(emptyText || '没有发现问题。') + '</div>';
  }
  return '<div class="mon-issues">' + issues.map((issue) =>
    '<div class="mon-issue">' +
      txwIssueChip(issue) +
      '<span class="mon-msg">' + txwEsc(issue.message) + '</span>' +
      (issue.line ? '<span class="muted">第 ' + issue.line + ' 行</span>' : '') +
      '<span class="spacer"></span>' +
      (issue.action && issue.action.view === 'entry'
        ? '<button class="btn btn-xs" data-txw-act="entry" data-source="' + txwEsc(issue.source) + '" data-index="' + issue.index + '">查看</button>'
        : (issue.source ? '<button class="btn btn-xs" data-txw-act="editor" data-source="' + txwEsc(issue.source) + '">打开编辑器</button>' : '')) +
    '</div>').join('') + '</div>';
}

function txwRenderOverview() {
  const d = TXW.data;
  const cards = d.sources.map((src) => {
    const issueTotal = src.issues.error + src.issues.warn + src.issues.info;
    return '<div class="txw-card" data-txw-source-card="' + txwEsc(src.key) + '">' +
      '<div class="txw-card-head">' +
        '<strong>' + txwEsc(src.label) + '</strong>' +
        '<span class="npw-chip">' + txwEsc(src.file) + '</span>' +
        (issueTotal ? '<span class="npw-chip bad">问题 ' + issueTotal + '</span>' : '') +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm" data-txw-act="source" data-source="' + txwEsc(src.key) + '">查看 ' + src.entries + ' 条</button>' +
      '</div>' +
      '<div class="txw-card-meta">' + src.entries + ' 条 · ' + txwFmtNum(src.chars) + ' 字 · 0 错误 / ' + src.issues.warn + ' 警告 / ' + src.issues.info + ' 提示</div>' +
      '<div class="txw-card-desc">' + txwEsc(src.desc) + '</div>' +
    '</div>';
  });
  return '<div class="txw-overview-head">' +
      '<div class="mpw-map-head"><strong>文案索引总览</strong>' +
      '<span class="muted">' + d.sources.length + ' 个来源 · ' + txwFmtNum(d.stats.entries) + ' 条 · ' + txwFmtNum(d.stats.chars) + ' 字</span></div>' +
    '</div>' +
    '<div class="txw-cards">' + cards.join('') + '</div>';
}

function txwRenderEntryTable(entries) {
  if (!entries.length) return '<div class="tsk-empty">没有符合当前筛选的文案。</div>';
  const rows = entries.slice(0, 600).map((entry) =>
    '<tr data-txw-act="entry" data-source="' + txwEsc(entry.source) + '" data-index="' + entry.index + '">' +
      '<td>' + txwEsc(entry.label) + '</td>' +
      '<td class="txw-preview">' + txwEsc(entry.preview || '（空）') + '</td>' +
      '<td>' + (entry.lines === undefined ? (entry.endLine && entry.endLine !== entry.line ? entry.line + '-' + entry.endLine : entry.line) : entry.line) + '</td>' +
      '<td>' + entry.chars + '</td>' +
      '<td>' + (txwFlagChips(entry) || '<span class="muted">正常</span>') + '</td>' +
    '</tr>').join('');
  return '<div class="cbw-table-wrap"><table class="cbw-table txw-table">' +
    '<thead><tr><th>名称 / 键</th><th>预览</th><th>行</th><th>字数</th><th>标记</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    (entries.length > 600 ? '<div class="tsk-empty">共 ' + entries.length + ' 条，仅显示前 600 条。</div>' : '');
}

function txwRenderSource() {
  const src = txwSource(TXW.source);
  if (!src) {
    return '<div class="tsk-empty">未找到文案来源。请从左侧重新选择。</div>';
  }
  const entries = txwEntriesFor(src.key, TXW.query);
  const issueTotal = src.issues.error + src.issues.warn + src.issues.info;
  const head = '<div class="mpw-map-head"><strong>' + txwEsc(src.label) + '</strong>' +
    '<span class="npw-chip">' + txwEsc(src.file) + '</span>' +
    (issueTotal ? '<span class="npw-chip bad">问题 ' + issueTotal + '</span>' : '') +
    '<span class="muted">' + src.entries + ' 条 · ' + txwFmtNum(src.chars) + ' 字</span>' +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" data-txw-act="editor" data-source="' + txwEsc(src.key) + '">打开编辑器</button>' +
  '</div>';
  return head +
    '<div class="muted txw-desc">' + txwEsc(src.desc) + '</div>' +
    txwRenderEntryTable(entries);
}

function txwRenderSearch() {
  const data = TXW.search;
  if (!data) return '<div class="tsk-empty">输入关键词搜索全部文案。</div>';
  const results = (data.results || []).filter(txwFlagMatch);
  return '<div class="mpw-map-head"><strong>「' + txwEsc(data.query) + '」搜索结果</strong>' +
    '<span class="muted">' + results.length + ' 条' + (data.truncated ? '（仅显示前 ' + data.total + ' 条）' : '') + '</span>' +
  '</div>' + txwRenderEntryTable(results);
}

function txwRenderEntryDetail() {
  if (TXW.detailLoading || !TXW.detail) {
    return '<div class="tsk-empty">正在读取文案详情…</div>';
  }
  const d = TXW.detail;
  const src = d.source || {};
  const entry = d.entry;
  const parts = [];
  parts.push('<div class="tsk-head">' +
    '<button class="btn btn-sm" data-txw-act="back">返回</button>' +
    '<span class="tsk-title">' + txwEsc(entry.label) + '</span>' +
    '<span class="npw-chip">' + txwEsc(src.label || entry.source) + '</span>' +
    '<span class="npw-chip">' + txwEsc(entry.file) + ' 第 ' + entry.line + (entry.endLine !== entry.line ? '-' + entry.endLine : '') + ' 行</span>' +
    (txwFlagChips(entry) || '') +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" data-txw-act="editor" data-source="' + txwEsc(entry.source) + '">打开编辑器</button>' +
  '</div>');

  const targetHtml = [];
  if (entry.target && entry.target.type === 'item') {
    targetHtml.push('<button class="tsk-link" data-txw-act="item" data-index="' + entry.target.itemIndex + '">' + txwEsc(entry.target.name) + '</button>');
  } else if (entry.target && entry.target.type === 'map') {
    targetHtml.push('<button class="tsk-link" data-txw-act="map" data-code="' + txwEsc(entry.target.code) + '">' + txwEsc(entry.target.name) + '（' + txwEsc(entry.target.code) + '）</button>');
  } else if (entry.source === 'itemdesc') {
    targetHtml.push('<span class="tsk-link bad">' + txwEsc(entry.key) + '</span><span class="tsk-empty">stditems.db 中没有同名物品</span>');
  } else {
    targetHtml.push('<span class="muted">无直接数据目标</span>');
  }

  parts.push('<div class="tsk-grid">' +
    '<div class="tsk-kv"><span>来源</span><b>' + txwEsc(src.label || entry.source) + '</b></div>' +
    '<div class="tsk-kv"><span>文件</span><b>' + txwEsc(entry.file) + '</b></div>' +
    '<div class="tsk-kv"><span>类型</span><b>' + txwEsc(TXW_KIND_LABEL[entry.kind] || entry.kind) + '</b></div>' +
    '<div class="tsk-kv"><span>字数</span><b>' + entry.chars + ' 字</b></div>' +
    '<div class="tsk-kv"><span>最长行</span><b>' + entry.maxLineChars + ' 字</b></div>' +
    '<div class="tsk-kv"><span>目标</span><b>' + targetHtml.join('') + '</b></div>' +
  '</div>');

  if (entry.kind === 'checknum' && entry.fields) {
    parts.push('<div class="txw-fields">' +
      ['地图', 'X', 'Y', '范围宽', '范围高'].map((label, i) =>
        '<span><em>' + label + '</em><b>' + txwEsc(entry.fields[i] == null ? '—' : entry.fields[i]) + '</b></span>').join('') +
    '</div>');
  }

  if (entry.variants && entry.variants.length) {
    parts.push('<div class="txw-variants">' + entry.variants.map((v) =>
      '<div class="txw-variant"><span class="txw-variant-no">' + v.no + '.</span><span>' + txwEsc(v.text) + '</span></div>').join('') + '</div>');
  }

  const code = (entry.lines || []).map((line) =>
    '<div class="txw-line' + (line.header ? ' header' : '') + (line.comment ? ' comment' : '') + '">' +
      '<span class="txw-ln">' + line.line + '</span>' +
      '<span class="txw-lt">' + txwEsc(line.text) + '</span>' +
    '</div>').join('');
  parts.push('<div class="txw-code">' + code + '</div>');
  parts.push('<div class="txw-section-title">本条体检</div>');
  parts.push(txwRenderIssues(d.issues, '该条目没有发现问题。'));
  return parts.join('');
}

function txwRenderMain() {
  const box = txwEl('txwDetail');
  if (!box) return;
  if (!TXW.data) {
    box.innerHTML = '<div class="tsk-empty">' + (TXW.loading ? '正在读取文案索引…' : '暂无数据') + '</div>';
    return;
  }
  if (TXW.notFound) {
    box.innerHTML = '<div class="tsk-empty">未找到文案来源或条目（' + txwEsc(TXW.notFound) + '）。</div>';
    return;
  }
  if (TXW.tab === 'health') {
    txwRenderHealth();
    return;
  }
  if (TXW.selected) {
    box.innerHTML = txwRenderEntryDetail();
    return;
  }
  if (TXW.search && TXW.search.query) {
    box.innerHTML = txwRenderSearch();
    return;
  }
  if (TXW.source === 'all') {
    box.innerHTML = txwRenderOverview();
    return;
  }
  box.innerHTML = txwRenderSource();
}

function txwRenderHealth() {
  const box = txwEl('txwHealthList');
  if (!box) return;
  if (!TXW.data) {
    box.innerHTML = '<div class="tsk-empty">暂无数据</div>';
    return;
  }
  let issues = TXW.data.issues.slice();
  if (!issues.length) {
    box.innerHTML = '<div class="tsk-empty">全部文案没有发现问题。</div>';
    return;
  }
  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.source === b.source ? 0 : a.source.localeCompare(b.source)) || (a.line || 0) - (b.line || 0));
  const groups = new Map();
  for (const issue of issues) {
    const label = TXW_ISSUE_LABEL[issue.code] || issue.code;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(issue);
  }
  const html = [];
  for (const [label, list] of groups) {
    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of list) counts[issue.severity]++;
    html.push('<div class="mon-issue-group">' +
      '<div class="mon-issue-head"><strong>' + txwEsc(label) + '</strong>' +
        '<span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' + counts.warn + ' 警告 / ' + counts.info + ' 提示</span>' +
      '</div>' +
      list.map((issue) =>
        '<div class="mon-issue">' +
          '<span class="mon-sev ' + txwEsc(issue.severity) + '">' + txwEsc(TXW_SEV[issue.severity] || issue.severity) + '</span>' +
          '<span class="mon-msg">' + txwEsc(issue.message) + '</span>' +
          '<span class="spacer"></span>' +
          (issue.action && issue.action.view === 'entry'
            ? '<button class="btn btn-xs" data-txw-act="entry" data-source="' + txwEsc(issue.source) + '" data-index="' + issue.index + '">查看</button>'
            : '<button class="btn btn-xs" data-txw-act="editor" data-source="' + txwEsc(issue.source) + '">打开编辑器</button>') +
        '</div>').join('') +
    '</div>');
  }
  box.innerHTML = html.join('');
}

function txwRenderAll() {
  txwRenderList();
  txwRenderMeta();
  const tabs = txwEl('txwTabs');
  if (tabs) {
    tabs.querySelectorAll('[data-txw-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.txwTab === TXW.tab);
    });
  }
  const detailPane = txwEl('txwDetailPane');
  const healthPane = txwEl('txwHealthPane');
  if (detailPane) detailPane.classList.toggle('hidden', TXW.tab === 'health');
  if (healthPane) healthPane.classList.toggle('hidden', TXW.tab !== 'health');
  txwRenderMain();
  if (TXW.data) txwRenderHealth();
}

function txwOpenEditor(sourceKey, entry) {
  const src = txwSource(sourceKey);
  if (!src || !src.editor) return;
  const ed = src.editor;
  if (ed.view === 'extra' && window.openExtraKeyAt) {
    const target = {};
    if (entry && (entry.kind === 'section' || entry.kind === 'emotion')) target.section = entry.key;
    if (entry && entry.line) target.line = entry.line;
    window.openExtraKeyAt(ed.key, target);
    return;
  }
  if (ed.view === 'ops' && window.openOpsConfig) {
    window.openOpsConfig(false, ed.tab || 'notices');
  }
}

async function txwOpenItem(index) {
  if (typeof window.openItemWorkView === 'function') await window.openItemWorkView(Number(index));
}

async function txwOpenMap(code) {
  if (typeof window.openMapView === 'function') await window.openMapView({ tab: 'detail', key: code });
}

async function txwReload() {
  try {
    await txwLoad(true);
    txwRenderAll();
    toast('已重新读取文案索引', 'ok');
  } catch (e) {
    toast('重新检查失败：' + e.message, 'err');
  }
}

async function openTextWorkView(sel) {
  if (S.mode !== 'textwork' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'textwork';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  if (window.hideItemWorkView) window.hideItemWorkView();
  if (window.hideGrowthView) window.hideGrowthView();
  if (window.hideDropWorkView) window.hideDropWorkView();
  if (window.hideSpawnWorkView) window.hideSpawnWorkView();
  if (window.hideMapWorkView) window.hideMapWorkView();
  if (window.hideShopWorkView) window.hideShopWorkView();
  if (window.hideScriptWorkView) window.hideScriptWorkView();
  if (window.hideCastleWorkView) window.hideCastleWorkView();
  if (window.hideTextWorkView) window.hideTextWorkView();
  if (window.hideStarterWorkView) window.hideStarterWorkView();
  const dbView = txwEl('dbView');
  const dropView = txwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = txwEl('textWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('txw');
  if (!TXW.data || TXW.stale) {
    try {
      await txwLoad();
    } catch (e) {
      toast('加载文案索引失败：' + e.message, 'err');
      txwRenderAll();
      return;
    }
  }
  const target = sel || txwHashState() || { tab: 'detail', source: TXW.source };
  if (target.tab && TXW_TAB_KEYS.indexOf(target.tab) >= 0) TXW.tab = target.tab;
  if (target.source === null && target.name) {
    txwSelectSource(target.name);
    return;
  }
  if (target.index != null) {
    await txwOpenEntry(target.source, target.index);
    return;
  }
  if (target.search) {
    TXW.selected = null;
    TXW.tab = 'detail';
    txwRenderAll();
    txwSetHash({ tab: 'detail', source: TXW.source, search: true });
    return;
  }
  if (target.source && target.source !== TXW.source) TXW.source = target.source;
  if (TXW.tab === 'health') {
    txwRenderAll();
    txwSetHash({ tab: 'health' });
    return;
  }
  if (!TXW.selected) TXW.tab = 'detail';
  txwRenderAll();
  txwSetHash({ tab: 'detail', source: TXW.source });
}

function txwAnyEntry(source, index) {
  if (!TXW.data) return null;
  return TXW.data.entries.find((e) => e.source === source && e.index === Number(index)) || null;
}

window.openTextWorkView = openTextWorkView;
window.hideTextWorkView = () => {
  const view = txwEl('textWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && txwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshTextWorkState = (st) => {
  const info = st && st.configs ? st.configs.textwork : null;
  if (!info || info.error || !info.stats) return;
  txwText('textWorkCount', String(info.stats.entries));
  if (S.mode === 'textwork') txwRenderMeta();
};
window.updateTextWorkMeta = txwRenderMeta;

window.openTextEntryForItem = async (name) => {
  const label = String(name == null ? '' : name).trim();
  if (!label) return false;
  if (!TXW.data || TXW.stale) {
    try {
      await txwLoad();
    } catch (e) {
      if (window.openExtraKeyAt) return window.openExtraKeyAt('itemdesc', { section: label });
      return false;
    }
  }
  const entry = (TXW.data.entries || []).find((e) => e.source === 'itemdesc' && e.key === label);
  if (entry) {
    await openTextWorkView({ tab: 'detail', source: 'itemdesc', index: entry.index });
    return true;
  }
  if (window.openExtraKeyAt) {
    await openTextWorkView({ tab: 'detail', source: 'itemdesc' });
    window.openExtraKeyAt('itemdesc', { section: label });
  }
  return false;
};

window.openTextWorkSource = async (key) => {
  if (!key) return false;
  await openTextWorkView({ tab: 'detail', source: key });
  return true;
};

function txwBindEvents() {
  const list = txwEl('txwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-txw-source]');
      if (li) txwSelectSource(li.dataset.txwSource);
    });
  }
  const flags = txwEl('txwFlagFilter');
  if (flags) {
    flags.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-txw-flag]');
      if (!btn) return;
      TXW.flag = btn.dataset.txwFlag;
      flags.querySelectorAll('[data-txw-flag]').forEach((b) => b.classList.toggle('active', b === btn));
      if (TXW.selected) txwOpenEntry(TXW.selected.source, TXW.selected.index);
      else txwRenderAll();
    });
  }
  const query = txwEl('txwQuery');
  if (query) {
    query.addEventListener('input', () => {
      clearTimeout(txwSearchTimer);
      txwSearchTimer = setTimeout(() => {
        txwRunSearch(query.value).catch((e) => toast('搜索失败：' + e.message, 'err'));
      }, 280);
    });
    query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(txwSearchTimer);
        txwRunSearch(query.value).catch((err) => toast('搜索失败：' + err.message, 'err'));
      }
    });
  }
  const searchBtn = txwEl('btnTxwSearch');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const q = txwEl('txwQuery');
      txwRunSearch(q ? q.value : '').catch((e) => toast('搜索失败：' + e.message, 'err'));
    });
  }
  const clearBtn = txwEl('btnTxwClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const q = txwEl('txwQuery');
      if (q) q.value = '';
      txwRunSearch('').catch((e) => toast('清空失败：' + e.message, 'err'));
    });
  }
  const tabs = txwEl('txwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-txw-tab]');
      if (!btn) return;
      TXW.tab = btn.dataset.txwTab;
      tabs.querySelectorAll('[data-txw-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      txwRenderAll();
      if (TXW.tab === 'health') txwSetHash({ tab: 'health' });
      else if (TXW.selected) txwSetHash({ tab: 'detail', source: TXW.selected.source, index: TXW.selected.index });
      else txwSetHash({ tab: 'detail', source: TXW.source });
    });
  }
  const detail = txwEl('txwDetail');
  if (detail) {
    detail.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-txw-act]');
      if (!el) return;
      const act = el.dataset.txwAct;
      if (act === 'back') txwBack();
      else if (act === 'source') txwSelectSource(el.dataset.source);
      else if (act === 'entry') await txwOpenEntry(el.dataset.source, Number(el.dataset.index));
      else if (act === 'editor') {
        const entry = TXW.detail && TXW.detail.entry && TXW.detail.entry.source === el.dataset.source ? TXW.detail.entry : null;
        txwOpenEditor(el.dataset.source, entry);
      } else if (act === 'item') await txwOpenItem(el.dataset.index);
      else if (act === 'map') await txwOpenMap(el.dataset.code);
    });
  }
  const health = txwEl('txwHealthList');
  if (health) {
    health.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-txw-act]');
      if (!el) return;
      if (el.dataset.txwAct === 'entry') await txwOpenEntry(el.dataset.source, Number(el.dataset.index));
      else if (el.dataset.txwAct === 'editor') txwOpenEditor(el.dataset.source, null);
    });
  }
  const reload = txwEl('btnTxwReload');
  if (reload) reload.addEventListener('click', txwReload);
  window.addEventListener('hashchange', () => {
    const state = txwHashState();
    if (state) openTextWorkView(state);
  });
}

txwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = txwHashState();
    if (state) openTextWorkView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = txwHashState();
    if (state) openTextWorkView(state);
  });
}

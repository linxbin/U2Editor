'use strict';

/* 新手 / 充值 / 账号工作台：出生礼包、账号等级奖励与元宝充值队列 */

const STW_FLAGS = [
  { key: 'all', label: '全部' },
  { key: 'issues', label: '异常' },
  { key: 'missing-item', label: '缺物品' },
  { key: 'empty', label: '空档位' },
  { key: 'invalid', label: '格式' },
  { key: 'duplicate', label: '重复' },
  { key: 'encoding', label: '编码' }
];

const STW_FLAG_LABEL = {
  'missing-item': '缺物品',
  empty: '空档位',
  invalid: '格式异常',
  duplicate: '重复',
  encoding: '编码异常'
};

const STW_ISSUE_LABEL = {
  starter_file_missing: '文件缺失',
  starter_file_encoding: '文件编码',
  starter_section_duplicate: '新手分组重复',
  starter_section_unknown: '未知分组',
  starter_section_empty: '空礼包',
  starter_item_missing: '物品缺失',
  starter_slot_missing: '缺少新手分组',
  starter_items_unreadable: '物品库读取',
  gift_file_missing: '文件缺失',
  gift_file_encoding: '文件编码',
  gift_item_missing: '物品缺失',
  gift_count_invalid: '数量异常',
  gift_chance_invalid: '几率异常',
  gift_class_invalid: '职业/性别异常',
  gift_row_invalid: '列数错误',
  gift_item_duplicate: '同档重复物品',
  gift_level_invalid: '等级异常',
  gift_level_duplicate: '等级重复',
  gift_level_order: '档位乱序',
  gift_level_empty: '空档位',
  gift_content_duplicate: '礼包内容重复',
  queue_dir_missing: '目录缺失',
  queue_zero_byte: '空队列文件',
  queue_name_duplicate: '队列文件名重复'
};

const STW_KIND_LABEL = {
  starter: '新手礼包',
  gifts: '等级礼包',
  queue: '充值队列'
};

const STW_SEV = { error: '错误', warn: '警告', info: '提示' };
const STW_TAB_KEYS = ['detail', 'health'];

const STW = {
  data: null,
  stale: false,
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

function stwEl(id) {
  return document.getElementById(id);
}

function stwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stwText(id, text) {
  const el = stwEl(id);
  if (el) el.textContent = text;
}

function stwFmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function stwSize(n) {
  const v = Number(n || 0);
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  return (v / 1024 / 1024).toFixed(1) + ' MB';
}

function stwSource(key) {
  if (!STW.data) return null;
  return (STW.data.sources || []).find((s) => s.key === key) || null;
}

function stwHashState() {
  const m = /^#starter(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  let raw = m[1] || '';
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
  }
  if (!raw || raw === 'all') return { tab: 'detail', source: 'all' };
  if (raw === 'health') return { tab: 'health', source: STW.source };
  if (raw === 'search') return { tab: 'detail', source: STW.source, search: true };
  const em = /^([a-z]+)-(\d+)$/.exec(raw);
  if (em && STW.data && STW.data.sources.some((s) => s.key === em[1])) {
    return { tab: 'detail', source: em[1], index: Number(em[2]) };
  }
  if (STW.data && STW.data.sources.some((s) => s.key === raw)) return { tab: 'detail', source: raw };
  return { tab: 'detail', source: null, name: raw };
}

function stwSetHash(state) {
  let raw = '';
  if (state && state.tab === 'health') raw = 'health';
  else if (state && state.search) raw = 'search';
  else if (state && state.index != null) raw = state.source + '-' + state.index;
  else if (state && state.source && state.source !== 'all') raw = state.source;
  const next = raw ? '#starter=' + raw : '#starter';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function stwLoad(refresh) {
  if (STW.loading) return;
  STW.loading = true;
  stwRenderMeta();
  try {
    const data = await api('/api/config/starterwork' + (refresh ? '?refresh=1' : ''));
    STW.data = data;
    STW.stale = false;
    stwText('starterWorkCount', String(data.stats.entries));
  } finally {
    STW.loading = false;
  }
}

function stwRenderMeta() {
  const meta = stwEl('stwMeta');
  if (!meta) return;
  if (!STW.data) {
    meta.textContent = STW.loading ? '正在读取新手与充值配置…' : '';
    return;
  }
  const s = STW.data.stats;
  meta.textContent = [
    `条目 ${stwFmtNum(s.entries)} 个`,
    `奖励 ${stwFmtNum(s.rewards)} 条`,
    `${s.files} 个文件`,
    `问题 ${s.issues.error} 错误 / ${s.issues.warn} 警告 / ${s.issues.info} 提示`
  ].join(' · ');
}

function stwAllIssues() {
  if (!STW.data) return 0;
  const s = STW.data.stats.issues;
  return s.error + s.warn + s.info;
}

function stwFlagMatch(entry) {
  if (STW.flag === 'all') return true;
  if (STW.flag === 'issues') return entry.flags && entry.flags.length > 0;
  return entry.flags && entry.flags.indexOf(STW.flag) >= 0;
}

function stwEntriesFor(source, query) {
  if (!STW.data) return [];
  const needle = String(query || '').trim().toLowerCase();
  return STW.data.entries.filter((entry) => {
    if (source !== 'all' && entry.source !== source) return false;
    if (!stwFlagMatch(entry)) return false;
    if (needle && (entry.label + '\n' + (entry.preview || '')).toLowerCase().indexOf(needle) < 0) return false;
    return true;
  });
}

function stwFlagChips(entry) {
  return (entry.flags || []).map((f) =>
    '<span class="txw-flag txw-flag-' + stwEsc(f) + '">' + stwEsc(STW_FLAG_LABEL[f] || f) + '</span>').join('');
}

function stwRenderList() {
  const list = stwEl('stwList');
  if (!list) return;
  if (!STW.data) {
    list.innerHTML = '<li class="side-note">' + (STW.loading ? '正在读取…' : '暂无数据') + '</li>';
    return;
  }
  const items = [];
  const allIssues = stwAllIssues();
  items.push(
    '<li class="file-item' + (STW.source === 'all' ? ' active' : '') + '" data-stw-source="all">' +
      '<div class="fname">全部配置' + (allIssues ? ' <span class="npw-tag">' + allIssues + '</span>' : '') + '</div>' +
      '<div class="fmeta">' + STW.data.sources.length + ' 个来源 · ' + stwFmtNum(STW.data.stats.entries) + ' 个条目</div>' +
    '</li>'
  );
  for (const src of STW.data.sources) {
    const issueTotal = src.issues.error + src.issues.warn + src.issues.info;
    let meta = '';
    if (src.kind === 'queue') meta = src.entries + ' 个队列文件';
    else if (src.kind === 'gifts') meta = src.entries + ' 个等级档 · ' + src.rewards + ' 条奖励';
    else meta = src.entries + ' 个分组 · ' + src.rewards + ' 件物品';
    items.push(
      '<li class="file-item' + (STW.source === src.key ? ' active' : '') + '" data-stw-source="' + stwEsc(src.key) + '">' +
        '<div class="fname">' + stwEsc(src.label) +
          (issueTotal ? ' <span class="npw-tag' + (src.issues.error || src.issues.warn ? ' bad' : '') + '">' + issueTotal + '</span>' : '') +
        '</div>' +
        '<div class="fmeta">' + stwEsc(src.file || src.dir) + ' · ' + meta + '</div>' +
      '</li>'
    );
  }
  list.innerHTML = items.join('');
  const hint = stwEl('stwListHint');
  if (hint) {
    hint.textContent = '共 ' + STW.data.sources.length + ' 个来源、' + STW.data.stats.entries +
      ' 个条目；新手礼包 6 组、账号礼包按等级分档、充值队列逐文件展示。';
  }
}

function stwSelectSource(key) {
  if (key !== 'all' && !stwSource(key)) {
    STW.notFound = String(key || '');
    STW.selected = null;
    STW.detail = null;
    STW.search = null;
    STW.source = 'all';
    stwRenderAll();
    stwSetHash({ tab: 'detail' });
    return;
  }
  STW.source = key;
  STW.selected = null;
  STW.detail = null;
  STW.search = null;
  STW.notFound = '';
  STW.tab = 'detail';
  stwRenderAll();
  stwSetHash({ tab: 'detail', source: key });
}

async function stwOpenEntry(source, index, opts) {
  const src = stwSource(source);
  if (!src) return;
  STW.source = source;
  STW.selected = { source, index };
  STW.notFound = '';
  STW.tab = 'detail';
  STW.detailLoading = true;
  const token = ++STW.detailToken;
  stwRenderAll();
  if (!opts || opts.hash !== false) stwSetHash({ tab: 'detail', source, index });
  try {
    const detail = await api('/api/config/starterwork/detail?source=' + encodeURIComponent(source) +
      '&index=' + encodeURIComponent(index));
    if (token !== STW.detailToken) return;
    STW.detail = detail;
  } catch (e) {
    if (token !== STW.detailToken) return;
    STW.detail = null;
    toast('加载条目详情失败：' + e.message, 'err');
  } finally {
    if (token === STW.detailToken) {
      STW.detailLoading = false;
      stwRenderAll();
    }
  }
}

function stwBack() {
  STW.selected = null;
  STW.detail = null;
  STW.notFound = '';
  stwRenderAll();
  if (STW.search && STW.search.query) stwSetHash({ tab: 'detail', source: STW.source, search: true });
  else stwSetHash({ tab: 'detail', source: STW.source });
}

let stwSearchTimer = null;
async function stwRunSearch(query) {
  const q = String(query == null ? '' : query).trim();
  STW.query = q;
  if (!q) {
    STW.search = null;
    STW.selected = null;
    STW.detail = null;
    stwRenderAll();
    if (STW.source && STW.source !== 'all') stwSetHash({ tab: 'detail', source: STW.source });
    else stwSetHash({ tab: 'detail' });
    return;
  }
  const token = ++STW.searchToken;
  const data = await api('/api/config/starterwork/search?q=' + encodeURIComponent(q) + '&limit=500');
  if (token !== STW.searchToken) return;
  STW.search = data;
  STW.selected = null;
  STW.detail = null;
  stwRenderAll();
  stwSetHash({ tab: 'detail', source: STW.source, search: true });
}

function stwIssueChip(issue) {
  return '<span class="mon-sev ' + stwEsc(issue.severity) + '">' + stwEsc(STW_SEV[issue.severity] || issue.severity) + '</span>';
}

function stwRenderIssues(issues, emptyText) {
  if (!issues || !issues.length) {
    return '<div class="tsk-empty">' + stwEsc(emptyText || '没有发现问题。') + '</div>';
  }
  return '<div class="mon-issues">' + issues.map((issue) =>
    '<div class="mon-issue">' +
      stwIssueChip(issue) +
      '<span class="mon-msg">' + stwEsc(issue.message) + '</span>' +
      (issue.line ? '<span class="muted">第 ' + issue.line + ' 行</span>' : '') +
      '<span class="spacer"></span>' +
      (issue.action && issue.action.view === 'entry'
        ? '<button class="btn btn-xs" data-stw-act="entry" data-source="' + stwEsc(issue.source) + '" data-index="' + issue.index + '">查看</button>'
        : (issue.source ? '<button class="btn btn-xs" data-stw-act="editor" data-source="' + stwEsc(issue.source) + '">打开编辑器</button>' : '')) +
    '</div>').join('') + '</div>';
}

function stwSourceMeta(src) {
  if (src.kind === 'queue') {
    return src.entries + ' 个文件 · ' + (src.size ? stwSize(src.size) : '全部为空');
  }
  if (src.kind === 'gifts') return src.entries + ' 个等级档 · ' + stwFmtNum(src.rewards) + ' 条奖励';
  return src.entries + ' 个分组 · ' + stwFmtNum(src.rewards) + ' 件物品';
}

function stwRenderOverview() {
  const d = STW.data;
  const cards = d.sources.map((src) => {
    const issueTotal = src.issues.error + src.issues.warn + src.issues.info;
    return '<div class="txw-card" data-stw-source-card="' + stwEsc(src.key) + '">' +
      '<div class="txw-card-head">' +
        '<strong>' + stwEsc(src.label) + '</strong>' +
        '<span class="npw-chip">' + stwEsc(src.file || src.dir) + '</span>' +
        (issueTotal ? '<span class="npw-chip bad">问题 ' + issueTotal + '</span>' : '') +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm" data-stw-act="source" data-source="' + stwEsc(src.key) + '">查看 ' + src.entries + ' 项</button>' +
      '</div>' +
      '<div class="txw-card-meta">' + stwSourceMeta(src) + ' · 0 错误 / ' + src.issues.warn + ' 警告 / ' + src.issues.info + ' 提示</div>' +
      '<div class="txw-card-desc">' + stwEsc(src.desc) + '</div>' +
    '</div>';
  });
  return '<div class="txw-overview-head">' +
      '<div class="mpw-map-head"><strong>新手与充值总览</strong>' +
      '<span class="muted">' + d.sources.length + ' 个来源 · ' + stwFmtNum(d.stats.entries) + ' 个条目 · ' +
        stwFmtNum(d.stats.rewards) + ' 条奖励 · ' + d.stats.files + ' 个文件</span></div>' +
    '</div>' +
    '<div class="txw-cards">' + cards.join('') + '</div>';
}

function stwRenderEntryTable(entries) {
  if (!entries.length) return '<div class="tsk-empty">没有符合当前筛选的条目。</div>';
  const rows = entries.slice(0, 800).map((entry) =>
    '<tr data-stw-act="entry" data-source="' + stwEsc(entry.source) + '" data-index="' + entry.index + '">' +
      '<td>' + stwEsc(entry.label) + '</td>' +
      '<td class="txw-preview">' + stwEsc(entry.preview || '（空）') + '</td>' +
      '<td>' + (entry.line ? entry.line + (entry.endLine && entry.endLine !== entry.line ? '-' + entry.endLine : '') : '—') + '</td>' +
      '<td>' + (entry.kind === 'queue' ? stwSize(entry.size) : stwFmtNum(entry.rewardCount != null ? entry.rewardCount : (entry.items ? entry.items.length : 0))) + '</td>' +
      '<td>' + (stwFlagChips(entry) || '<span class="muted">正常</span>') + '</td>' +
    '</tr>').join('');
  return '<div class="cbw-table-wrap"><table class="cbw-table txw-table">' +
    '<thead><tr><th>名称 / 档位</th><th>预览</th><th>行</th><th>奖励 / 大小</th><th>标记</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    (entries.length > 800 ? '<div class="tsk-empty">共 ' + entries.length + ' 条，仅显示前 800 条。</div>' : '');
}

function stwRenderQueueTable(entries) {
  if (!entries.length) return '<div class="tsk-empty">没有符合当前筛选的队列文件。</div>';
  const rows = entries.map((entry) =>
    '<tr data-stw-act="entry" data-source="yb" data-index="' + entry.index + '">' +
      '<td>' + stwEsc(entry.label) + '</td>' +
      '<td>' + stwSize(entry.size) + '</td>' +
      '<td>' + stwEsc(entry.normKey || '—') + '</td>' +
      '<td>' + (entry.duplicates && entry.duplicates.length > 1 ? '<span class="npw-chip bad">同名</span>' : '<span class="muted">—</span>') + '</td>' +
    '</tr>').join('');
  return '<div class="cbw-table-wrap"><table class="cbw-table txw-table">' +
    '<thead><tr><th>队列文件</th><th>大小</th><th>对应档位</th><th>标记</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

function stwRenderSource() {
  const src = stwSource(STW.source);
  if (!src) {
    return '<div class="tsk-empty">未找到配置来源。请从左侧重新选择。</div>';
  }
  const entries = stwEntriesFor(src.key, STW.query);
  const issueTotal = src.issues.error + src.issues.warn + src.issues.info;
  const head = '<div class="mpw-map-head"><strong>' + stwEsc(src.label) + '</strong>' +
    '<span class="npw-chip">' + stwEsc(src.file || src.dir) + '</span>' +
    (issueTotal ? '<span class="npw-chip bad">问题 ' + issueTotal + '</span>' : '') +
    '<span class="muted">' + stwSourceMeta(src) + '</span>' +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" data-stw-act="editor" data-source="' + stwEsc(src.key) + '">打开编辑器</button>' +
  '</div>';
  return head +
    '<div class="muted txw-desc">' + stwEsc(src.desc) + '</div>' +
    (src.kind === 'queue' ? stwRenderQueueTable(entries) : stwRenderEntryTable(entries));
}

function stwRenderSearch() {
  const data = STW.search;
  if (!data) return '<div class="tsk-empty">输入关键词开始搜索。</div>';
  const results = (data.results || []).filter(stwFlagMatch);
  if (!results.length) {
    return '<div class="tsk-empty">「' + stwEsc(data.query) + '」没有匹配的条目。</div>';
  }
  const rows = results.map((entry) =>
    '<tr data-stw-act="entry" data-source="' + stwEsc(entry.source) + '" data-index="' + entry.index + '">' +
      '<td>' + stwEsc(entry.label) + '</td>' +
      '<td class="txw-preview">' + stwEsc(entry.key) + '</td>' +
      '<td>' + stwEsc(entry.sourceLabel) + '</td>' +
      '<td>' + (entry.line || '—') + '</td>' +
      '<td>' + (stwFlagChips(entry) || '<span class="muted">正常</span>') + '</td>' +
    '</tr>').join('');
  return '<div class="mpw-map-head"><strong>「' + stwEsc(data.query) + '」搜索结果</strong>' +
    '<span class="muted">' + results.length + ' 条' + (data.truncated ? '（仅显示前 ' + data.total + ' 条）' : '') + '</span>' +
  '</div><div class="cbw-table-wrap"><table class="cbw-table txw-table">' +
    '<thead><tr><th>名称 / 档位</th><th>匹配项</th><th>来源</th><th>行</th><th>标记</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

function stwItemLink(row) {
  const name = row.item != null ? row.item : row.name;
  if (row.exists && row.itemIndex != null) {
    return '<button class="tsk-link" data-stw-act="item" data-index="' + row.itemIndex + '">' + stwEsc(name) + '</button>';
  }
  return '<span class="tsk-link bad">' + stwEsc(name) + '</span>';
}

function stwRenderEntryDetail() {
  if (STW.detailLoading || !STW.detail) {
    return '<div class="tsk-empty">正在读取条目详情…</div>';
  }
  const d = STW.detail;
  const src = d.source || {};
  const entry = d.entry;
  const parts = [];
  parts.push('<div class="tsk-head">' +
    '<button class="btn btn-sm" data-stw-act="back">返回</button>' +
    '<span class="tsk-title">' + stwEsc(src.label || entry.source) + ' · ' + stwEsc(entry.label) + '</span>' +
    '<span class="npw-chip">' + stwEsc(entry.file || src.file || src.dir || '') + '</span>' +
    (entry.line ? '<span class="npw-chip">第 ' + entry.line + (entry.endLine !== entry.line ? '-' + entry.endLine : '') + ' 行</span>' : '') +
    (stwFlagChips(entry) || '') +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" data-stw-act="editor" data-source="' + stwEsc(entry.source) + '">打开编辑器</button>' +
  '</div>');

  const kv = [];
  kv.push('<div class="tsk-kv"><span>来源</span><b>' + stwEsc(src.label || entry.source) + '</b></div>');
  kv.push('<div class="tsk-kv"><span>文件</span><b>' + stwEsc(entry.file || src.file || src.dir || '') + '</b></div>');
  kv.push('<div class="tsk-kv"><span>类型</span><b>' + stwEsc(STW_KIND_LABEL[entry.kind] || entry.kind) + '</b></div>');

  if (entry.kind === 'starter') {
    kv.push('<div class="tsk-kv"><span>性别</span><b>' + stwEsc((entry.fields && entry.fields[0]) || '—') + '</b></div>');
    kv.push('<div class="tsk-kv"><span>职业</span><b>' + stwEsc((entry.fields && entry.fields[1]) || '—') + '</b></div>');
    kv.push('<div class="tsk-kv"><span>物品数</span><b>' + entry.items.length + ' 件</b></div>');
    parts.push('<div class="tsk-grid">' + kv.join('') + '</div>');
    parts.push('<div class="txw-section-title">出生礼包物品</div>');
    if (!entry.items.length) {
      parts.push('<div class="tsk-empty">该分组没有任何物品。</div>');
    } else {
      parts.push('<div class="txw-variants">' + entry.items.map((it, i) =>
        '<div class="txw-variant"><span class="txw-variant-no">' + (i + 1) + '.</span>' +
          stwItemLink(it) +
          '<span class="muted">第 ' + it.line + ' 行</span>' +
        '</div>').join('') + '</div>');
    }
  } else if (entry.kind === 'gifts') {
    kv.push('<div class="tsk-kv"><span>等级档位</span><b>' + stwEsc(entry.level != null ? entry.level + ' 级' : entry.levelText) + '</b></div>');
    kv.push('<div class="tsk-kv"><span>奖励条数</span><b>' + entry.rows.length + ' 条</b></div>');
    kv.push('<div class="tsk-kv"><span>状态</span><b>' + (entry.rows.length ? '已配置' : '空档位') + '</b></div>');
    parts.push('<div class="tsk-grid">' + kv.join('') + '</div>');
    parts.push('<div class="txw-section-title">档位奖励</div>');
    if (!entry.rows.length) {
      parts.push('<div class="tsk-empty">该等级档位没有任何奖励物品。</div>');
    } else {
      const rows = entry.rows.map((row) =>
        '<tr>' +
          '<td>' + stwItemLink(row) + '</td>' +
          '<td>' + stwEsc(row.count) + '</td>' +
          '<td>' + stwEsc(row.chance) + '</td>' +
          '<td>' + stwEsc(row.classLabel) + '</td>' +
          '<td>' + stwEsc(row.genderLabel) + '</td>' +
          '<td>' + row.line + '</td>' +
          '<td>' + (stwFlagChips(row) || '<span class="muted">正常</span>') + '</td>' +
        '</tr>').join('');
      parts.push('<div class="cbw-table-wrap"><table class="cbw-table txw-table">' +
        '<thead><tr><th>物品</th><th>数量</th><th>几率</th><th>职业</th><th>性别</th><th>行</th><th>标记</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>');
    }
  } else if (entry.kind === 'queue') {
    kv.push('<div class="tsk-kv"><span>队列文件</span><b>' + stwEsc(entry.label) + '</b></div>');
    kv.push('<div class="tsk-kv"><span>文件大小</span><b>' + stwSize(entry.size) + '</b></div>');
    kv.push('<div class="tsk-kv"><span>对应档位</span><b>' + stwEsc(entry.normKey || '—') + '</b></div>');
    kv.push('<div class="tsk-kv"><span>同名文件</span><b>' + stwEsc(entry.duplicates && entry.duplicates.length ? entry.duplicates.join(' / ') : '无') + '</b></div>');
    parts.push('<div class="tsk-grid">' + kv.join('') + '</div>');
    parts.push('<div class="tsk-empty">' + (entry.size === 0
      ? '该队列文件为空，表示当前没有待处理的充值订单。'
      : '该队列文件包含 ' + stwSize(entry.size) + ' 数据，请由充值脚本处理，编辑器不直接改写队列。') + '</div>');
  }

  parts.push('<div class="txw-section-title">本条体检</div>');
  parts.push(stwRenderIssues(d.issues, '该条目没有发现问题。'));
  return parts.join('');
}

function stwRenderMain() {
  const box = stwEl('stwDetail');
  if (!box) return;
  if (!STW.data) {
    box.innerHTML = '<div class="tsk-empty">' + (STW.loading ? '正在读取新手与充值配置…' : '暂无数据') + '</div>';
    return;
  }
  if (STW.notFound) {
    box.innerHTML = '<div class="tsk-empty">未找到配置来源或条目（' + stwEsc(STW.notFound) + '）。</div>';
    return;
  }
  if (STW.tab === 'health') {
    stwRenderHealth();
    return;
  }
  if (STW.selected) {
    box.innerHTML = stwRenderEntryDetail();
    return;
  }
  if (STW.search && STW.search.query) {
    box.innerHTML = stwRenderSearch();
    return;
  }
  if (STW.source === 'all') {
    box.innerHTML = stwRenderOverview();
    return;
  }
  box.innerHTML = stwRenderSource();
}

function stwRenderHealth() {
  const box = stwEl('stwHealthList');
  if (!box) return;
  if (!STW.data) {
    box.innerHTML = '<div class="tsk-empty">暂无数据</div>';
    return;
  }
  const issues = STW.data.issues.slice();
  if (!issues.length) {
    box.innerHTML = '<div class="tsk-empty">全部新手与充值配置没有发现问题。</div>';
    return;
  }
  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.source === b.source ? 0 : a.source.localeCompare(b.source)) || (a.line || 0) - (b.line || 0));
  const groups = new Map();
  for (const issue of issues) {
    const label = STW_ISSUE_LABEL[issue.code] || issue.code;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(issue);
  }
  const html = [];
  for (const [label, list] of groups) {
    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of list) counts[issue.severity]++;
    html.push('<div class="mon-issue-group">' +
      '<div class="mon-issue-head"><strong>' + stwEsc(label) + '</strong>' +
        '<span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' + counts.warn + ' 警告 / ' + counts.info + ' 提示</span>' +
      '</div>' +
      list.map((issue) =>
        '<div class="mon-issue">' +
          '<span class="mon-sev ' + stwEsc(issue.severity) + '">' + stwEsc(STW_SEV[issue.severity] || issue.severity) + '</span>' +
          '<span class="mon-msg">' + stwEsc(issue.message) + '</span>' +
          '<span class="spacer"></span>' +
          (issue.action && issue.action.view === 'entry'
            ? '<button class="btn btn-xs" data-stw-act="entry" data-source="' + stwEsc(issue.source) + '" data-index="' + issue.index + '">查看</button>'
            : '<button class="btn btn-xs" data-stw-act="editor" data-source="' + stwEsc(issue.source) + '">打开编辑器</button>') +
        '</div>').join('') +
    '</div>');
  }
  box.innerHTML = html.join('');
}

function stwRenderAll() {
  stwRenderList();
  stwRenderMeta();
  const tabs = stwEl('stwTabs');
  if (tabs) {
    tabs.querySelectorAll('[data-stw-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.stwTab === STW.tab);
    });
  }
  const detailPane = stwEl('stwDetailPane');
  const healthPane = stwEl('stwHealthPane');
  if (detailPane) detailPane.classList.toggle('hidden', STW.tab === 'health');
  if (healthPane) healthPane.classList.toggle('hidden', STW.tab !== 'health');
  stwRenderMain();
  if (STW.data) stwRenderHealth();
}

function stwOpenEditor(sourceKey) {
  const src = stwSource(sourceKey);
  if (!src || !src.editor) return;
  const ed = src.editor;
  if (ed.view === 'extra' && window.openExtraKeyAt) {
    window.openExtraKeyAt(ed.key, {});
    return;
  }
  if (ed.view === 'ops' && window.openOpsConfig) {
    window.openOpsConfig(false, ed.tab || 'starter');
    return;
  }
  if (ed.view === 'activity' && window.openActivityView) {
    window.openActivityView(undefined, ed.id || 'recharge');
  }
}

async function stwOpenItem(index) {
  if (typeof window.openItemWorkView === 'function') await window.openItemWorkView(Number(index));
}

async function stwReload() {
  try {
    await stwLoad(true);
    stwRenderAll();
    toast('已重新读取新手与充值配置', 'ok');
  } catch (e) {
    toast('重新检查失败：' + e.message, 'err');
  }
}

async function openStarterWorkView(sel) {
  if (S.mode !== 'starterwork' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'starterwork';
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
  if (window.hideHealthWorkView) window.hideHealthWorkView();
  const dbView = stwEl('dbView');
  const dropView = stwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = stwEl('starterWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('stw');
  if (!STW.data || STW.stale) {
    try {
      await stwLoad();
    } catch (e) {
      toast('加载新手与充值配置失败：' + e.message, 'err');
      stwRenderAll();
      return;
    }
  }
  const target = sel || stwHashState() || { tab: 'detail', source: STW.source };
  if (target.tab && STW_TAB_KEYS.indexOf(target.tab) >= 0) STW.tab = target.tab;
  if (target.source === null && target.name) {
    stwSelectSource(target.name);
    return;
  }
  if (target.index != null) {
    await stwOpenEntry(target.source, target.index);
    return;
  }
  if (target.search) {
    STW.selected = null;
    STW.tab = 'detail';
    stwRenderAll();
    stwSetHash({ tab: 'detail', source: STW.source, search: true });
    return;
  }
  if (target.source && target.source !== STW.source) STW.source = target.source;
  if (STW.tab === 'health') {
    stwRenderAll();
    stwSetHash({ tab: 'health' });
    return;
  }
  if (!STW.selected) STW.tab = 'detail';
  stwRenderAll();
  stwSetHash({ tab: 'detail', source: STW.source });
}

window.openStarterWorkView = openStarterWorkView;
window.hideStarterWorkView = () => {
  const view = stwEl('starterWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && stwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshStarterWorkState = (st) => {
  const info = st && st.configs ? st.configs.starterwork : null;
  if (!info || info.error || !info.stats) return;
  stwText('starterWorkCount', String(info.stats.entries));
  if (S.mode === 'starterwork') stwRenderMeta();
};
window.updateStarterWorkMeta = stwRenderMeta;

function stwBindEvents() {
  const list = stwEl('stwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-stw-source]');
      if (li) stwSelectSource(li.dataset.stwSource);
    });
  }
  const flags = stwEl('stwFlagFilter');
  if (flags) {
    flags.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-stw-flag]');
      if (!btn) return;
      STW.flag = btn.dataset.stwFlag;
      flags.querySelectorAll('[data-stw-flag]').forEach((b) => b.classList.toggle('active', b === btn));
      if (STW.selected) stwOpenEntry(STW.selected.source, STW.selected.index);
      else stwRenderAll();
    });
  }
  const query = stwEl('stwQuery');
  if (query) {
    query.addEventListener('input', () => {
      clearTimeout(stwSearchTimer);
      stwSearchTimer = setTimeout(() => {
        stwRunSearch(query.value).catch((e) => toast('搜索失败：' + e.message, 'err'));
      }, 280);
    });
    query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(stwSearchTimer);
        stwRunSearch(query.value).catch((err) => toast('搜索失败：' + err.message, 'err'));
      }
    });
  }
  const tabs = stwEl('stwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-stw-tab]');
      if (!btn) return;
      STW.tab = btn.dataset.stwTab;
      if (STW.tab === 'health') stwSetHash({ tab: 'health' });
      else stwSetHash({ tab: 'detail', source: STW.source, index: STW.selected ? STW.selected.index : null });
      stwRenderAll();
    });
  }
  const detail = stwEl('stwDetail');
  if (detail) {
    detail.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-stw-act]');
      if (!el) return;
      const act = el.dataset.stwAct;
      if (act === 'back') stwBack();
      else if (act === 'source') stwSelectSource(el.dataset.source);
      else if (act === 'entry') await stwOpenEntry(el.dataset.source, Number(el.dataset.index));
      else if (act === 'editor') stwOpenEditor(el.dataset.source);
      else if (act === 'item') await stwOpenItem(el.dataset.index);
    });
  }
  const health = stwEl('stwHealthList');
  if (health) {
    health.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-stw-act]');
      if (!el) return;
      if (el.dataset.stwAct === 'entry') await stwOpenEntry(el.dataset.source, Number(el.dataset.index));
      else if (el.dataset.stwAct === 'editor') stwOpenEditor(el.dataset.source);
    });
  }
  const reload = stwEl('btnStwReload');
  if (reload) reload.addEventListener('click', stwReload);
  window.addEventListener('hashchange', () => {
    const state = stwHashState();
    if (state) openStarterWorkView(state);
  });
}

stwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = stwHashState();
    if (state) openStarterWorkView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = stwHashState();
    if (state) openStarterWorkView(state);
  });
}

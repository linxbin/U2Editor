'use strict';

/* 脚本检索工作台：NPCScript 全文搜索 + NPC/商店/任务/脚本引用（只读） */

const SCW = {
  data: null,
  detail: null,
  selected: null,
  notFound: '',
  loading: false,
  detailLoading: false,
  detailToken: 0,
  stale: true,
  tab: 'detail',
  filter: '',
  flag: 'all',
  query: '',
  search: null,
  searchLoading: false,
  searchToken: 0,
  lineFilter: '',
  targetLine: null,
  searchTimer: null,
  lineTimer: null
};

const SCW_TAB_KEYS = ['detail', 'search', 'health'];
const SCW_LIST_LIMIT = 400;
const SCW_SEV = { error: '错误', warn: '警告', info: '提示' };
const SCW_ISSUE_GROUP = {
  script_unreadable: '读取失败',
  script_npc_unreadable: '读取失败',
  script_missing: '脚本缺失',
  script_orphan: '未被引用',
  script_empty: '空脚本',
  script_encoding: '编码',
  script_shops_unreadable: '商店解析',
  script_mapinfo_unreadable: '地图读取',
  script_tasks_unreadable: '任务读取'
};
const SCW_GROUP_ORDER = ['读取失败', '脚本缺失', '未被引用', '空脚本', '编码', '商店解析', '地图读取', '任务读取', '其他'];

function scwEl(id) {
  return document.getElementById(id);
}

function scwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function scwText(id, text) {
  const el = scwEl(id);
  if (el) el.textContent = text;
}

function scwFmtSize(size) {
  const n = Number(size) || 0;
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function scwFmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function scwTag(text, cls) {
  const span = document.createElement('span');
  span.className = 'npw-tag' + (cls ? ' ' + cls : '');
  span.textContent = text;
  return span;
}

function scwHighlight(text, term) {
  if (!term) return scwEsc(text);
  const lower = String(text).toLowerCase();
  const needle = term.toLowerCase();
  let out = '';
  let pos = 0;
  let i;
  while ((i = lower.indexOf(needle, pos)) >= 0) {
    out += scwEsc(text.slice(pos, i)) + '<mark>' + scwEsc(text.slice(i, i + term.length)) + '</mark>';
    pos = i + needle.length;
  }
  return out + scwEsc(text.slice(pos));
}

function scwHashState() {
  const m = /^#scripts(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  let raw = m[1] || '';
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
  }
  if (!raw) return { tab: 'detail' };
  if (raw === 'health') return { tab: 'health' };
  if (raw === 'search') return { tab: 'search' };
  const lm = /^(.+?):(\d+)$/.exec(raw);
  return lm
    ? { tab: 'detail', name: lm[1], line: Number(lm[2]) }
    : { tab: 'detail', name: raw };
}

function scwSetHash(sel) {
  let raw = '';
  if (sel && sel.tab === 'health') raw = 'health';
  else if (sel && sel.tab === 'search') raw = 'search';
  else if (sel && sel.name) raw = encodeURIComponent(sel.name) + (sel.line ? ':' + sel.line : '');
  const next = raw ? '#scripts=' + raw : '#scripts';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

function scwScriptRow(name) {
  if (!SCW.data) return null;
  const raw = String(name || '');
  const base = raw.replace(/\.py$/i, '');
  return SCW.data.scripts.find((r) => r.name.toLowerCase() === raw.toLowerCase() ||
    r.base.toLowerCase() === base.toLowerCase()) || null;
}

async function scwLoad(refresh) {
  if (SCW.loading) return;
  SCW.loading = true;
  scwRenderMeta();
  try {
    const data = await api('/api/config/scriptwork' + (refresh ? '?refresh=1' : ''));
    SCW.data = data;
    SCW.stale = false;
    scwText('scriptWorkCount', String(data.stats.scripts));
    scwRenderMeta();
  } finally {
    SCW.loading = false;
  }
}

async function scwLoadDetail(name) {
  const token = ++SCW.detailToken;
  SCW.detailLoading = true;
  scwRenderDetail();
  try {
    const detail = await api('/api/config/scriptwork/detail?name=' + encodeURIComponent(name));
    if (token !== SCW.detailToken) return;
    SCW.detail = detail;
    SCW.notFound = '';
  } catch (e) {
    if (token !== SCW.detailToken) return;
    SCW.detail = null;
    SCW.notFound = name;
    swToastSafe('加载脚本失败：' + e.message);
  } finally {
    if (token === SCW.detailToken) {
      SCW.detailLoading = false;
      scwRenderDetail();
    }
  }
}

function swToastSafe(message, type) {
  if (typeof toast === 'function') toast(message, type || 'err');
}

function scwRenderMeta() {
  const meta = scwEl('scwMeta');
  if (!meta) return;
  if (!SCW.data) {
    meta.textContent = SCW.loading ? '正在加载脚本索引…' : '';
    return;
  }
  const s = SCW.data.stats;
  meta.textContent = [
    s.scripts + ' 个脚本',
    scwFmtNum(s.lines) + ' 行',
    scwFmtSize(s.bytes),
    'NPC 引用 ' + scwFmtNum(s.npcRefs),
    '商店脚本 ' + s.shopScripts,
    '未引用 ' + s.orphans,
    '问题 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info + ' 提示'
  ].join(' · ');
  scwText('scriptWorkCount', String(s.scripts));
}

function scwRenderTabs() {
  document.querySelectorAll('#scwTabs [data-scw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scwTab === SCW.tab);
  });
  const detail = scwEl('scwDetailPane');
  const search = scwEl('scwSearchPane');
  const health = scwEl('scwHealthPane');
  if (detail) detail.classList.toggle('hidden', SCW.tab !== 'detail');
  if (search) search.classList.toggle('hidden', SCW.tab !== 'search');
  if (health) health.classList.toggle('hidden', SCW.tab !== 'health');
}

function scwRenderList() {
  const list = scwEl('scwList');
  const hint = scwEl('scwListHint');
  if (!list) return;
  scwClear(list);
  if (!SCW.data) {
    if (hint) hint.textContent = '正在加载…';
    return;
  }
  const q = SCW.filter.trim().toLowerCase();
  const rows = SCW.data.scripts.filter((row) => {
    if (SCW.flag === 'issues' && !row.issueCount) return false;
    if (SCW.flag === 'orphan' && !row.orphan) return false;
    return !q || row.name.toLowerCase().includes(q) || row.base.toLowerCase().includes(q);
  });
  const shown = rows.slice(0, SCW_LIST_LIMIT);
  for (const row of shown) {
    const li = document.createElement('li');
    li.className = 'file-item' + (SCW.selected === row.name ? ' active' : '');
    li.dataset.scwName = row.name;
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = row.name;
    if (row.orphan) name.appendChild(scwTag('未引用', 'warn'));
    if (!row.encodingOk) name.appendChild(scwTag('编码异常', 'bad'));
    if (row.issueCount && !row.orphan) name.appendChild(scwTag('异常 ' + row.issueCount, 'warn'));
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    const parts = [row.lineCount + ' 行', 'NPC ' + row.npcCount, '任务 ' + row.taskCount];
    if (row.shopGoods) parts.push('货品 ' + row.shopGoods);
    if (row.importedByCount) parts.push('被 ' + row.importedByCount + ' 脚本引用');
    meta.textContent = parts.join(' · ');
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'side-note';
    empty.textContent = '没有符合条件的脚本。';
    list.appendChild(empty);
  }
  if (hint) {
    hint.textContent = rows.length > SCW_LIST_LIMIT
      ? '显示前 ' + SCW_LIST_LIMIT + ' 个，共 ' + rows.length + ' 个脚本。'
      : '共 ' + rows.length + ' 个脚本。';
  }
}

function scwKv(label, value) {
  return '<div class="mpw-kv-item"><span class="k">' + scwEsc(label) + '</span><span class="v">' + value + '</span></div>';
}

function scwSection(title, note, body) {
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>' + scwEsc(title) + '</strong>' +
    (note ? '<span class="muted">' + scwEsc(note) + '</span>' : '') + '</div>' + body + '</div>';
}

function scwLink(text, act, attrs) {
  return '<button class="sw-link" data-scw-act="' + scwEsc(act) + '"' + (attrs || '') + '>' + scwEsc(text) + '</button>';
}

function scwIssueRow(issue) {
  let action = '';
  if (issue.action && issue.action.view === 'script') {
    action = '<button class="btn btn-sm" data-scw-act="issue-script" data-name="' + scwEsc(issue.action.name) + '">查看脚本</button>';
  } else if (issue.action && issue.action.view === 'npc') {
    action = '<button class="btn btn-sm" data-scw-act="issue-npc" data-index="' + scwEsc(issue.action.index) + '">查看 NPC</button>';
  }
  return '<div class="mon-issue mpw-issue">' +
    '<span class="mon-sev ' + scwEsc(issue.severity) + '">' + scwEsc(SCW_SEV[issue.severity] || issue.severity) + '</span>' +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + scwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + scwEsc(SCW_ISSUE_GROUP[issue.code] || '其他') +
    (issue.line ? ' · 第 ' + issue.line + ' 行' : '') + '</div></div>' + action + '</div>';
}

function scwRenderIssues(issues, title) {
  const list = issues || [];
  if (!list.length) {
    return '<div class="mpw-section"><div class="mpw-section-head"><strong>' + scwEsc(title) +
      '</strong><span class="muted">0 项</span></div><div class="mpw-empty">没有发现异常。</div></div>';
  }
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>' + scwEsc(title) +
    '</strong><span class="muted">' + list.length + ' 项</span></div><div class="mpw-rows">' +
    list.map(scwIssueRow).join('') + '</div></div>';
}

function scwRenderNpcs(refs) {
  const npcs = refs.npcs || [];
  if (!npcs.length) return '';
  const rows = npcs.map((npc) =>
    '<div class="mpw-row"><div class="mpw-row-main">' +
    '<button class="sw-link" data-scw-act="npc" data-index="' + npc.index + '">' + scwEsc(npc.name) + '</button>' +
    '<span class="muted">' + scwEsc(npc.id) + ' · ' + scwEsc(npc.mapName || npc.map || '?') +
    ' ' + npc.x + ',' + npc.y + '</span></div></div>'
  ).join('');
  return scwSection('引用 NPC', npcs.length + ' 个', '<div class="mpw-rows">' + rows + '</div>');
}

function scwRenderShop(refs) {
  const shop = refs.shops;
  if (!shop) {
    return scwSection('商店配置', '0 条', '<div class="mpw-empty">该脚本没有商店货品。</div>');
  }
  const body = '<div class="mpw-kv">' +
    scwKv('脚本', scwLink(shop.name, 'script', ' data-name="' + scwEsc(shop.name) + '"')) +
    scwKv('货品数量', shop.goodsCount + ' 条') +
    scwKv('关联 NPC', shop.sharedNpcs + ' 个') +
    scwKv('地图', (shop.maps || []).join('、') || '—') +
    '</div><div class="mpw-actions"><button class="btn btn-sm" data-scw-act="shop" data-name="' +
    scwEsc(shop.base) + '">打开商店货品配置</button></div>';
  return scwSection('商店配置', shop.goodsCount + ' 条货品', body);
}

function scwRenderTasks(refs) {
  const tasks = refs.tasks || [];
  if (!tasks.length) return scwSection('关联任务', '0 个', '<div class="mpw-empty">该脚本引用的 NPC 没有配置任务。</div>');
  const rows = tasks.map((task) =>
    '<div class="mpw-row"><div class="mpw-row-main">' +
    '<button class="sw-link" data-scw-act="task" data-id="' + task.id + '">#' + task.id + ' ' + scwEsc(task.name || '（未命名任务）') + '</button>' +
    '<span class="muted">' + scwEsc(task.module) + '</span></div>' +
    '<div class="mpw-row-side">' + (task.enabled ? '<span class="npw-tag">启用</span>' : '<span class="npw-tag warn">未启用</span>') +
    '</div></div>'
  ).join('');
  return scwSection('关联任务', tasks.length + ' 个', '<div class="mpw-rows">' + rows + '</div>');
}

function scwRenderScriptRefs(refs) {
  const imports = refs.imports || [];
  const importedBy = refs.importedBy || [];
  const importRows = imports.length
    ? imports.map((dep) => '<div class="mpw-row"><div class="mpw-row-main">' +
      '<button class="sw-link" data-scw-act="script" data-name="' + scwEsc(dep.name) + '">' + scwEsc(dep.name) + '</button>' +
      '<span class="muted">本脚本导入</span></div></div>').join('')
    : '<div class="mpw-empty">没有导入其他脚本。</div>';
  const usedRows = importedBy.length
    ? importedBy.map((dep) => '<div class="mpw-row"><div class="mpw-row-main">' +
      '<button class="sw-link" data-scw-act="script" data-name="' + scwEsc(dep.name) + '">' + scwEsc(dep.name) + '</button>' +
      '<span class="muted">引用本脚本</span></div></div>').join('')
    : '<div class="mpw-empty">没有其他脚本引用。</div>';
  return scwSection('脚本依赖', imports.length + ' 导入 / ' + importedBy.length + ' 被引用',
    '<div class="mpw-rows">' + importRows + usedRows + '</div>');
}

function scwRenderMaps(refs) {
  const maps = refs.maps || [];
  if (!maps.length) return '';
  const tags = maps.map((m) => '<span class="npw-tag">' + scwEsc(m.code) +
    (m.name ? ' ' + scwEsc(m.name) : '') + '</span>').join('');
  return scwSection('涉及地图', maps.length + ' 张', '<div class="npw-orphans">' + tags + '</div>');
}

function scwRenderDetail() {
  const box = scwEl('scwDetail');
  const tools = scwEl('scwDetailTools');
  if (!box) return;
  if (!SCW.data) {
    box.innerHTML = '<div class="mpw-empty">正在加载脚本索引…</div>';
    if (tools) tools.classList.add('hidden');
    return;
  }
  if (SCW.tab !== 'detail') return;
  if (SCW.selected == null) {
    if (tools) tools.classList.add('hidden');
    box.innerHTML = SCW.notFound
      ? '<div class="mpw-empty">未找到该脚本（' + scwEsc(SCW.notFound) + '）。</div>'
      : scwIntro();
    return;
  }
  if (tools) tools.classList.remove('hidden');
  if (SCW.detailLoading && !SCW.detail) {
    box.innerHTML = '<div class="mpw-empty">正在读取「' + scwEsc(SCW.selected) + '」…</div>';
    scwUpdateLineInfo();
    return;
  }
  const d = SCW.detail;
  if (!d) {
    box.innerHTML = '<div class="mpw-empty">未找到该脚本。</div>';
    scwUpdateLineInfo();
    return;
  }
  const refs = d.references || {};
  const tags = [];
  if (d.orphan) tags.push('<span class="mpw-badge">未引用</span>');
  if (!d.encodingOk) tags.push('<span class="mpw-badge bad">编码异常</span>');
  if (refs.npcs && refs.npcs.length) tags.push('<span class="mpw-badge ok">NPC ' + refs.npcs.length + '</span>');
  if (refs.shops) tags.push('<span class="mpw-badge">商店 ' + refs.shops.goodsCount + '</span>');
  if (refs.tasks && refs.tasks.length) tags.push('<span class="mpw-badge">任务 ' + refs.tasks.length + '</span>');
  if (refs.importedBy && refs.importedBy.length) tags.push('<span class="mpw-badge">被 ' + refs.importedBy.length + ' 引用</span>');

  const head = '<div class="mpw-map-head"><div><strong>' + scwEsc(d.name) + '</strong>' +
    '<div class="muted">' + scwEsc(d.base) + ' · ' + d.lineCount + ' 行 · ' + scwFmtSize(d.size) +
    ' · GBK' + (d.encodingOk ? '' : '（不可逆）') + '</div></div>' +
    '<div class="mpw-head-tags">' + tags.join('') + '</div></div>';
  const overview = '<div class="mpw-kv">' +
    scwKv('文件', scwEsc(d.name)) +
    scwKv('行数', d.lineCount + ' 行') +
    scwKv('引用 NPC', (refs.npcs || []).length + ' 个') +
    scwKv('关联任务', (refs.tasks || []).length + ' 个') +
    scwKv('商店货品', refs.shops ? refs.shops.goodsCount + ' 条' : '0 条') +
    scwKv('脚本引用', (refs.importedBy || []).length + ' 被引用') +
    '</div>';
  const code = '<div class="mpw-section"><div class="mpw-section-head"><strong>脚本内容</strong>' +
    '<span class="muted" id="scwCodeNote">' + d.lineCount + ' 行</span></div>' +
    '<div class="npw-script scw-code scw-code-wrap" id="scwCode"></div></div>';
  box.innerHTML = head + overview + code + scwRenderNpcs(refs) + scwRenderShop(refs) +
    scwRenderTasks(refs) + scwRenderScriptRefs(refs) + scwRenderMaps(refs) +
    swRenderIssuesSafe(d.issues, '脚本体检');
  scwDrawLines();
}

function swRenderIssuesSafe(issues, title) {
  return scwRenderIssues(issues, title);
}

function scwIntro() {
  if (!SCW.data) return '<div class="mpw-empty">正在加载脚本索引…</div>';
  const s = SCW.data.stats;
  return '<div class="sw-intro"><h3>脚本检索工作台</h3>' +
    '<p>左侧按文件名浏览 ' + s.scripts + ' 个 NPC 脚本；顶部输入关键词可跨全部 ' +
    scwFmtNum(s.lines) + ' 行脚本正文检索，点击结果直接定位到脚本行。</p>' +
    '<p>详情页展示脚本引用的 NPC、商店货品、关联任务、脚本导入关系与涉及地图，并可跳转到对应工作台处理。</p>' +
    '<p>当前体检发现 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info +
    ' 提示，其中 ' + s.orphans + ' 个脚本未被 NPC、商店或其他脚本引用，' + s.missingScripts +
    ' 个被 NPC 引用的脚本文件不存在。</p></div>';
}

function scwDrawLines() {
  const box = scwEl('scwCode');
  if (!box) return;
  const d = SCW.detail;
  if (!d) {
    box.innerHTML = '<div class="npw-empty">请选择脚本。</div>';
    scwUpdateLineInfo();
    return;
  }
  const term = SCW.lineFilter.trim().toLowerCase();
  let html = '';
  let matches = 0;
  for (let i = 0; i < d.lines.length; i++) {
    const text = d.lines[i];
    if (term && text.toLowerCase().indexOf(term) < 0) continue;
    if (term) matches++;
    const target = SCW.targetLine === i + 1;
    html += '<div class="npw-line scw-line' + (target ? ' target' : '') + '">' +
      '<span class="npw-line-no">' + (i + 1) + '</span>' +
      '<span class="npw-line-text">' + (term ? scwHighlight(text, term) : scwEsc(text)) + '</span></div>';
  }
  if (!html) html = '<div class="npw-empty">没有匹配的行。</div>';
  box.innerHTML = html;
  scwUpdateLineInfo();
  if (SCW.targetLine) {
    const target = box.querySelector('.scw-line.target');
    if (target) {
      try {
        target.scrollIntoView({ block: 'nearest' });
      } catch (e) {
      }
    }
  }
}

function scwUpdateLineInfo() {
  const info = scwEl('scwLineInfo');
  const note = scwEl('scwCodeNote');
  if (!SCW.detail) {
    if (info) info.textContent = '';
    return;
  }
  const d = SCW.detail;
  const term = SCW.lineFilter.trim();
  let matches = 0;
  if (term) {
    for (const line of d.lines) if (line.toLowerCase().includes(term.toLowerCase())) matches++;
  }
  if (info) {
    info.textContent = term
      ? '匹配 ' + matches + ' / ' + d.lines.length + ' 行'
      : d.lines.length + ' 行' + (SCW.targetLine ? ' · 已定位第 ' + SCW.targetLine + ' 行' : '');
  }
  if (note) {
    note.textContent = term
      ? '匹配 ' + matches + ' 行'
      : d.lines.length + ' 行' + (SCW.targetLine ? ' · 定位第 ' + SCW.targetLine + ' 行' : '');
  }
}

function scwRenderSearch() {
  const box = scwEl('scwSearchResults');
  if (!box) return;
  if (SCW.searchLoading) {
    box.innerHTML = '<div class="mpw-empty">正在搜索…</div>';
    return;
  }
  const s = SCW.search;
  if (!SCW.query) {
    box.innerHTML = '<div class="mpw-empty">输入关键词后按回车，跨全部脚本正文搜索。</div>';
    return;
  }
  if (!s) {
    box.innerHTML = '<div class="mpw-empty">正在等待搜索结果…</div>';
    return;
  }
  const summary = '<div class="scw-search-summary">关键词「' + scwEsc(s.query) + '」命中 ' +
    scwFmtNum(s.total) + ' 行 / ' + s.files + ' 个脚本' +
    (s.truncated ? '，显示前 ' + s.results.length + ' 条' : '') + '。</div>';
  if (!s.results.length) {
    box.innerHTML = summary + '<div class="mpw-empty">没有匹配内容。</div>';
    return;
  }
  const rows = s.results.map((r) =>
    '<div class="scw-result-row" data-scw-act="line" data-name="' + scwEsc(r.name) + '" data-line="' + r.line + '">' +
    '<span class="scw-result-file">' + scwEsc(r.name) + '</span>' +
    '<span class="scw-result-line">' + r.line + '</span>' +
    '<span class="scw-result-text">' + scwHighlight(r.text, s.query) + '</span></div>'
  ).join('');
  box.innerHTML = summary + rows;
}

function scwRenderHealth() {
  const box = scwEl('scwHealthList');
  if (!box) return;
  if (!SCW.data) {
    box.innerHTML = '<div class="mpw-empty">正在加载…</div>';
    return;
  }
  const issues = SCW.data.issues || [];
  if (!issues.length) {
    box.innerHTML = '<div class="mpw-empty">脚本配置没有发现异常。</div>';
    return;
  }
  const groups = {};
  for (const issue of issues) {
    const name = SCW_ISSUE_GROUP[issue.code] || '其他';
    if (!groups[name]) groups[name] = [];
    groups[name].push(issue);
  }
  let html = '';
  for (const name of SCW_GROUP_ORDER) {
    const list = groups[name];
    if (!list) continue;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of list) counts[issue.severity]++;
    html += '<div class="mon-issue-group"><div class="mon-issue-head"><strong>' + scwEsc(name) +
      '</strong><span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' +
      counts.warn + ' 警告 / ' + counts.info + ' 提示</span></div>' +
      list.map(scwIssueRow).join('') + '</div>';
  }
  box.innerHTML = html;
}

function scwRenderAll() {
  scwRenderMeta();
  scwRenderTabs();
  scwRenderList();
  scwRenderDetail();
  scwRenderSearch();
  scwRenderHealth();
}

async function scwOpen(name, line) {
  const row = scwScriptRow(name);
  if (!row) {
    SCW.selected = null;
    SCW.detail = null;
    SCW.notFound = String(name || '');
    SCW.tab = 'detail';
    SCW.targetLine = null;
    scwRenderAll();
    scwSetHash({ tab: 'detail' });
    return;
  }
  const same = SCW.selected === row.name && SCW.detail;
  SCW.selected = row.name;
  SCW.notFound = '';
  SCW.tab = 'detail';
  SCW.targetLine = line && Number(line) > 0 ? Number(line) : null;
  SCW.lineFilter = '';
  const input = scwEl('scwInScript');
  if (input) input.value = '';
  scwRenderTabs();
  scwRenderList();
  if (!same) {
    SCW.detail = null;
    scwRenderDetail();
    await scwLoadDetail(row.name);
  } else {
    scwRenderDetail();
  }
  scwSetHash({ tab: 'detail', name: row.name, line: SCW.targetLine });
  const li = document.querySelector('#scwList [data-scw-name="' + row.name.replace(/"/g, '\\"') + '"]');
  if (li) {
    try {
      li.scrollIntoView({ block: 'nearest' });
    } catch (e) {
    }
  }
}

async function scwRunSearch(q) {
  const query = String(q == null ? '' : q).trim();
  if (!query) {
    SCW.query = '';
    SCW.search = null;
    SCW.searchLoading = false;
    scwRenderSearch();
    return;
  }
  SCW.query = query;
  SCW.tab = 'search';
  SCW.searchLoading = true;
  const token = ++SCW.searchToken;
  scwRenderTabs();
  scwRenderSearch();
  try {
    const res = await api('/api/config/scriptwork/search?q=' + encodeURIComponent(query) + '&limit=500');
    if (token !== SCW.searchToken) return;
    SCW.search = res;
  } catch (e) {
    if (token !== SCW.searchToken) return;
    SCW.search = { query, total: 0, files: 0, results: [], truncated: false };
    swToastSafe('搜索脚本失败：' + e.message);
  } finally {
    if (token === SCW.searchToken) {
      SCW.searchLoading = false;
      scwRenderSearch();
    }
  }
}

async function scwGotoNpc(index) {
  if (typeof window.openNpcWorkView !== 'function') {
    swToastSafe('NPC 工作台不可用');
    return;
  }
  await window.openNpcWorkView(Number(index));
}

async function scwGotoShop(base) {
  if (typeof window.openShopsByScript === 'function') {
    await window.openShopsByScript(base);
    return;
  }
  if (typeof window.openShopsConfig === 'function') await window.openShopsConfig();
}

async function scwGotoTask(id) {
  if (typeof window.openTaskView !== 'function') {
    swToastSafe('任务工作台不可用');
    return;
  }
  await window.openTaskView(null, Number(id));
}

async function openScriptView(sel) {
  if (S.mode !== 'scriptwork' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'scriptwork';
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
  if (window.hideCastleWorkView) window.hideCastleWorkView();
  if (window.hideTextWorkView) window.hideTextWorkView();
  if (window.hideStarterWorkView) window.hideStarterWorkView();
  if (window.hideHealthWorkView) window.hideHealthWorkView();
  const dbView = scwEl('dbView');
  const dropView = scwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = scwEl('scriptWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('scw');
  if (!SCW.data || SCW.stale) {
    try {
      await scwLoad();
    } catch (e) {
      swToastSafe('加载脚本数据失败：' + e.message);
      scwRenderAll();
      return;
    }
  }
  const target = sel || scwHashState() || { tab: SCW.tab };
  if (target.tab && SCW_TAB_KEYS.indexOf(target.tab) >= 0) SCW.tab = target.tab;
  if (target.name) {
    await scwOpen(target.name, target.line);
    return;
  }
  if (SCW.tab === 'health') {
    scwRenderAll();
    scwSetHash({ tab: 'health' });
    return;
  }
  if (SCW.tab === 'search') {
    scwRenderAll();
    scwSetHash({ tab: 'search' });
    return;
  }
  SCW.selected = null;
  SCW.detail = null;
  SCW.targetLine = null;
  scwRenderAll();
  scwSetHash({ tab: 'detail' });
}

window.openScriptView = openScriptView;
window.hideScriptWorkView = () => {
  const view = scwEl('scriptWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && scwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshScriptWorkState = (st) => {
  const info = st && st.configs ? st.configs.scriptwork : null;
  if (info && info.stats && info.stats.scripts != null) scwText('scriptWorkCount', String(info.stats.scripts));
  SCW.stale = true;
  if (S.mode === 'scriptwork') scwRenderMeta();
};
window.updateScriptWorkMeta = scwRenderMeta;

function scwBindEvents() {
  const filter = scwEl('scwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(SCW.searchTimer);
      SCW.searchTimer = setTimeout(() => {
        SCW.filter = filter.value;
        scwRenderList();
      }, 120);
    });
  }
  document.querySelectorAll('#scwFlagFilter [data-scw-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      SCW.flag = btn.dataset.scwFlag;
      document.querySelectorAll('#scwFlagFilter [data-scw-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      scwRenderList();
    });
  });
  const list = scwEl('scwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-scw-name]');
      if (li) scwOpen(li.dataset.scwName, null);
    });
  }
  const tabs = scwEl('scwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-scw-tab]');
      if (!btn) return;
      SCW.tab = btn.dataset.scwTab;
      scwRenderTabs();
      scwRenderDetail();
      scwRenderSearch();
      scwRenderHealth();
      if (SCW.tab === 'health') scwSetHash({ tab: 'health' });
      else if (SCW.tab === 'search') scwSetHash({ tab: 'search' });
      else if (SCW.selected != null) scwSetHash({ tab: 'detail', name: SCW.selected, line: SCW.targetLine });
      else scwSetHash({ tab: 'detail' });
    });
  }
  const global = scwEl('scwGlobalSearch');
  if (global) {
    let timer = null;
    global.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => scwRunSearch(global.value), 280);
    });
    global.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer);
        scwRunSearch(global.value);
      }
    });
  }
  const searchBtn = scwEl('btnScwSearch');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const input = scwEl('scwGlobalSearch');
      scwRunSearch(input ? input.value : '');
    });
  }
  const clearBtn = scwEl('btnScwClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      SCW.query = '';
      SCW.search = null;
      SCW.searchLoading = false;
      SCW.searchToken++;
      const input = scwEl('scwGlobalSearch');
      if (input) input.value = '';
      if (SCW.tab === 'search') SCW.tab = 'detail';
      scwRenderTabs();
      scwRenderSearch();
      scwRenderDetail();
      if (SCW.selected != null) scwSetHash({ tab: 'detail', name: SCW.selected, line: SCW.targetLine });
      else scwSetHash({ tab: 'detail' });
    });
  }
  const reload = scwEl('btnScwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        await scwLoad(true);
        if (SCW.selected != null) await scwLoadDetail(SCW.selected);
        scwRenderAll();
        swToastSafe('已重新检查脚本索引', 'ok');
      } catch (e) {
        scwRenderAll();
        swToastSafe('重新检查失败：' + e.message);
      } finally {
        reload.disabled = false;
      }
    });
  }
  const inScript = scwEl('scwInScript');
  if (inScript) {
    inScript.addEventListener('input', () => {
      clearTimeout(SCW.lineTimer);
      SCW.lineTimer = setTimeout(() => {
        SCW.lineFilter = inScript.value;
        scwDrawLines();
      }, 120);
    });
  }
  const syncIssueAction = async (btn) => {
    if (!btn) return;
    const act = btn.dataset.scwAct;
    if (act === 'issue-script') await scwOpen(btn.dataset.name, null);
    else if (act === 'issue-npc') await scwGotoNpc(Number(btn.dataset.index));
  };
  const detail = scwEl('scwDetail');
  if (detail) {
    detail.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-scw-act]');
      if (!btn) return;
      const act = btn.dataset.scwAct;
      if (act === 'npc') await scwGotoNpc(Number(btn.dataset.index));
      else if (act === 'shop') await scwGotoShop(btn.dataset.name);
      else if (act === 'task') await scwGotoTask(Number(btn.dataset.id));
      else if (act === 'script') await scwOpen(btn.dataset.name, null);
      else if (act === 'issue-script' || act === 'issue-npc') await syncIssueAction(btn);
    });
  }
  const health = scwEl('scwHealthList');
  if (health) {
    health.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-scw-act="issue-script"], [data-scw-act="issue-npc"]');
      if (btn) await syncIssueAction(btn);
    });
  }
  const results = scwEl('scwSearchResults');
  if (results) {
    results.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-scw-act="line"]');
      if (row) await scwOpen(row.dataset.name, Number(row.dataset.line));
    });
  }
  window.addEventListener('hashchange', () => {
    const state = scwHashState();
    if (state) openScriptView(state);
  });
}

scwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = scwHashState();
    if (state) openScriptView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = scwHashState();
    if (state) openScriptView(state);
  });
}

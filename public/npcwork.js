'use strict';

/* NPC 工作台：NPCList + 脚本 + 商店 + 任务/榜单关联 + 配置体检（只读） */

const NPW = {
  data: null,
  detail: null,
  selected: null,
  loading: false,
  stale: true,
  tab: 'detail',
  filter: '',
  flag: 'all',
  mapFilter: '',
  script: null,
  scriptName: '',
  scriptSearch: '',
  searchTimer: null
};

const NPW_LIST_LIMIT = 400;

const NPW_SEV = { error: '错误', warn: '警告', info: '提示' };

const NPW_FLAG_LABEL = {
  all: '全部',
  issues: '有异常',
  nofile: '无脚本',
  shop: '有商店',
  task: '有任务'
};

const NPW_ISSUE_LABEL = {
  npc_list_unreadable: 'NPCList 读取失败',
  npc_mapinfo_unreadable: 'MapInfo 读取失败',
  npc_shops_unreadable: '商店脚本读取失败',
  npc_task_unreadable: '任务配置读取失败',
  npc_script_missing: '脚本缺失',
  npc_map_unknown: '地图未知',
  npc_duplicate_id: '编号重复',
  npc_coord_duplicate: '坐标重叠',
  npc_name_duplicate: '名称重复',
  npc_shop_item_missing: '商店货品缺失',
  npc_script_orphan: '脚本未引用',
  npc_task_npc_missing: '任务 NPC 未落位'
};

function npwEl(id) {
  return document.getElementById(id);
}

function npwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function npwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function npwBtn(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls || 'btn btn-sm';
  b.textContent = text;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function npwFmtSize(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function npwHashIndex() {
  const m = /^#npcw=(\d+)$/.exec(location.hash || '');
  return m ? Number(m[1]) : null;
}

function npwSetHash(index) {
  const next = index == null ? '' : '#npcw=' + index;
  const cur = location.hash || '';
  if (next === cur) return;
  try {
    if (next) history.replaceState(null, '', location.pathname + location.search + next);
    else history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
  }
}

async function npwLoad(force) {
  if (NPW.loading) return;
  NPW.loading = true;
  try {
    const data = await api('/api/config/npcwork');
    NPW.data = data;
    NPW.stale = false;
    npwText('npcWorkCount', String(data.stats.npcs));
  } finally {
    NPW.loading = false;
  }
}

async function npwLoadDetail(index) {
  NPW.detail = await api('/api/config/npcwork/detail?index=' + index);
  return NPW.detail;
}

async function npwFetchScript(name) {
  const info = await api('/api/config/npcwork/script?name=' + encodeURIComponent(name));
  NPW.script = info;
  NPW.scriptName = info.name;
  return info;
}

function npwText(id, text) {
  const el = npwEl(id);
  if (el) el.textContent = text;
}

function npwIssueCount(n) {
  return (n && (n.error + n.warn)) || 0;
}

function npwRenderMeta() {
  const meta = npwEl('npwMeta');
  if (!meta) return;
  if (!NPW.data) {
    meta.textContent = NPW.loading ? '正在加载…' : '';
    return;
  }
  const s = NPW.data.stats;
  meta.textContent = [
    s.npcs + ' 个 NPC',
    s.scripts + ' 个脚本',
    s.shops + ' 个商店（' + s.shopGoods + ' 条货品）',
    '问题 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info + ' 提示'
  ].join(' · ');
  npwText('npcWorkCount', String(s.npcs));
  const count = npwEl('npcWorkCount');
  if (count) count.title = 'NPC 总数 ' + s.npcs + ' · 脚本 ' + s.scripts + ' · 未引用脚本 ' + s.orphanScripts;
}

function npwRenderTabs() {
  document.querySelectorAll('#npwTabs [data-npw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.npwTab === NPW.tab);
  });
  const panes = {
    detail: npwEl('npwDetailPane'),
    script: npwEl('npwScriptPane'),
    health: npwEl('npwHealthPane')
  };
  Object.keys(panes).forEach((k) => {
    if (panes[k]) panes[k].classList.toggle('hidden', k !== NPW.tab);
  });
}

function npwFlagMatch(n) {
  if (NPW.flag === 'issues') return npwIssueCount(n.issues) > 0;
  if (NPW.flag === 'nofile') return !n.scriptExists;
  if (NPW.flag === 'shop') return n.shopGoods > 0;
  if (NPW.flag === 'task') return n.taskCount > 0;
  return true;
}

function npwMatches(n, q) {
  if (!q) return true;
  return (
    n.name.toLowerCase().includes(q) ||
    n.id.toLowerCase().includes(q) ||
    n.script.toLowerCase().includes(q) ||
    n.map.toLowerCase().includes(q) ||
    (n.mapName || '').toLowerCase().includes(q) ||
    String(n.x) === q || String(n.y) === q
  );
}

function npwTag(text, cls) {
  const span = document.createElement('span');
  span.className = 'npw-tag' + (cls ? ' ' + cls : '');
  span.textContent = text;
  return span;
}

function npwRenderList() {
  const list = npwEl('npwList');
  const hint = npwEl('npwListHint');
  if (!list) return;
  npwClear(list);
  if (!NPW.data) {
    if (hint) hint.textContent = '正在加载 NPC 数据…';
    return;
  }
  const q = NPW.filter.trim().toLowerCase();
  const all = NPW.data.npcs.filter((n) =>
    npwFlagMatch(n) &&
    (!NPW.mapFilter || String(n.map).toLowerCase() === NPW.mapFilter) &&
    npwMatches(n, q)
  );
  const shown = all.slice(0, NPW_LIST_LIMIT);
  for (const n of shown) {
    const li = document.createElement('li');
    li.className = 'file-item' + (NPW.selected === n.index ? ' active' : '');
    li.dataset.npwIndex = String(n.index);
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = n.name || '（未命名）';
    if (!n.scriptExists) name.appendChild(npwTag('无脚本', 'bad'));
    if (n.taskCount) name.appendChild(npwTag('任务 ' + n.taskCount, 'task'));
    if (n.shopGoods) name.appendChild(npwTag('商店 ' + n.shopGoods, 'shop'));
    const issues = npwIssueCount(n.issues);
    if (issues) name.appendChild(npwTag('问题 ' + issues, 'warn'));
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = [
      n.id,
      (n.mapName || n.map) + ' (' + n.x + ',' + n.y + ')',
      n.scriptFile
    ].join(' · ');
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (!all.length) {
    const empty = document.createElement('li');
    empty.className = 'side-note';
    empty.textContent = '没有符合条件的 NPC。';
    list.appendChild(empty);
  }
  if (hint) {
    hint.textContent = (NPW.mapFilter ? '地图 ' + NPW.mapFilter + ' · ' : '') + (all.length > NPW_LIST_LIMIT
      ? '显示前 ' + NPW_LIST_LIMIT + ' 条，共 ' + all.length + ' 条；输入关键词或切换筛选缩小范围。'
      : '共 ' + all.length + ' 个 NPC。');
  }
}

function npwKv(label, value) {
  return '<div class="tsk-kv"><div class="tsk-kv-label">' + npwEsc(label) +
    '</div><div class="tsk-kv-value">' + npwEsc(value == null || value === '' ? '—' : value) + '</div></div>';
}

function npwSection(title, note, bodyHtml) {
  return '<div class="tsk-section"><div class="tsk-section-head"><h4>' + npwEsc(title) + '</h4>' +
    (note ? '<span class="tsk-empty">' + npwEsc(note) + '</span>' : '') + '</div>' + bodyHtml + '</div>';
}

function npwRenderDetail() {
  const box = npwEl('npwDetail');
  if (!box) return;
  if (!NPW.detail) {
    box.innerHTML = '<div class="npw-intro">' +
      '<div class="npw-intro-title">NPC 工作台</div>' +
      '<p>从左侧选择一个 NPC，查看它的位置、脚本、商店货品与关联任务；「配置体检」会汇总全库问题并支持跳转处理。</p>' +
      (NPW.data ? '<p class="muted">当前共 ' + NPW.data.stats.npcs + ' 个 NPC、' + NPW.data.stats.scripts +
        ' 个脚本、' + NPW.data.stats.orphanScripts + ' 个未被引用的脚本。</p>' : '') +
      '</div>';
    return;
  }
  const d = NPW.detail;
  const n = d.npc;
  const issues = d.issues || [];
  const tasks = d.tasks || [];
  const ranks = d.rankings || [];
  const parts = [];

  parts.push('<div class="npw-head">' +
    '<span class="npw-title">' + npwEsc(n.name || '（未命名）') + '</span>' +
    '<span class="npw-chip">' + npwEsc(n.id) + '</span>' +
    (n.scriptExists ? '' : '<span class="npw-chip bad">脚本缺失</span>') +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" data-npw-act="npc" data-search="' + npwEsc(n.name) + '">在 NPC 分布中查看</button>' +
    '</div>');

  parts.push('<div class="tsk-grid">' +
    npwKv('编号', n.id) +
    npwKv('名称', n.name) +
    npwKv('脚本文件', n.scriptFile) +
    npwKv('地图', (n.mapName || '') + (n.map ? ' · ' + n.map : '')) +
    npwKv('坐标', '(' + n.x + ', ' + n.y + ')') +
    npwKv('商店货品', n.shopGoods ? n.shopGoods + ' 条' : '无') +
    npwKv('关联任务', n.taskCount ? n.taskCount + ' 个' : '无') +
    npwKv('配置问题', issues.length ? issues.length + ' 条' : '无') +
    '</div>');

  let scriptBody;
  if (n.scriptExists) {
    const info = d.script;
    scriptBody = '<div class="npw-script-meta">' +
      '<span>' + npwEsc(n.scriptFile) + '</span>' +
      (info ? '<span>' + info.lines.length + ' 行</span><span>' + npwFmtSize(info.size) + '</span>' +
        '<span>GBK' + (info.encoding === 'gbk-lossy' ? '（含不可逆字符）' : '') + '</span>' : '') +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-npw-act="script">打开脚本标签</button>' +
      '</div>';
    if (info) {
      const preview = info.lines.slice(0, 14).join('\n');
      scriptBody += '<pre class="npw-pre">' + npwEsc(preview) + '</pre>';
    }
    if (d.scriptError) scriptBody += '<div class="npw-warn-text">读取脚本失败：' + npwEsc(d.scriptError) + '</div>';
  } else {
    scriptBody = '<div class="npw-warn-text">NPCList 引用的 ' + npwEsc(n.scriptFile) +
      ' 不存在。可点击右侧按钮到「NPC 分布」里修改脚本名。</div>' +
      '<div><button class="btn btn-sm" data-npw-act="npc" data-search="' + npwEsc(n.name) + '">去修改脚本</button></div>';
  }
  parts.push(npwSection('脚本', n.scriptExists ? '' : '缺失', scriptBody));

  let shopBody;
  if (!n.shopGoods) {
    shopBody = '<div class="tsk-empty">该 NPC 没有关联商店货品。</div>';
  } else {
    shopBody = '<div class="npw-script-meta"><span>共 ' + n.shopGoods + ' 条货品</span>' +
      '<span>来源 ' + npwEsc((n.shopFiles || []).join('、') || '—') + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-npw-act="shops" data-search="' + npwEsc(n.script) + '">打开商店货品</button>' +
      '</div>';
    if (d.shop && d.shop.shops && d.shop.shops.length) {
      shopBody += '<div class="npw-shops">';
      for (const s of d.shop.shops) {
        shopBody += '<div class="npw-shop"><strong>' + npwEsc(s.id) + '</strong>' +
          '<span>' + npwEsc(s.name || '') + '</span>' +
          '<span class="muted">' + npwEsc((s.map || '') + ' (' + s.x + ',' + s.y + ')') + '</span>' +
          '<span class="muted">' + npwEsc((s.sources || []).map((x) => x.file || x.base).join('、')) + '</span></div>';
      }
      shopBody += '</div>';
    }
  }
  parts.push(npwSection('商店', '', shopBody));

  let taskBody;
  if (!tasks.length) {
    taskBody = '<div class="tsk-empty">任务配置（TaskConfig NpcTaskList）中没有关联该 NPC 名的任务。</div>';
  } else {
    taskBody = '<div class="tsk-chips">';
    for (const t of tasks) {
      const cls = 'tsk-chip task' + (t.name ? '' : ' bad') + (t.enabled ? '' : ' warn');
      taskBody += '<button class="' + cls + '" data-npw-act="task" data-id="' + npwEsc(t.id) + '">' +
        npwEsc(String(t.id) + ' ' + (t.name || '未定义任务') + (t.enabled ? '' : '（未启用）')) + '</button>';
    }
    taskBody += '</div>';
  }
  parts.push(npwSection('关联任务', tasks.length ? '点击进入任务工作台' : '', taskBody));

  if (ranks.length) {
    parts.push(npwSection('活动榜单', '点击进入活动榜单工作台',
      '<div class="tsk-chips">' + ranks.map((r) =>
        '<button class="tsk-chip" data-npw-act="ranking" data-id="' + npwEsc(r.id) + '">' +
        npwEsc(r.name || r.id) + '</button>').join('') + '</div>'));
  }

  let issueBody;
  if (!issues.length) {
    issueBody = '<div class="tsk-empty">未发现该 NPC 的配置问题。</div>';
  } else {
    issueBody = '<div class="npw-issue-list">';
    for (const issue of issues) {
      issueBody += '<div class="npw-issue ' + npwEsc(issue.severity) + '">' +
        '<span class="mon-sev ' + npwEsc(issue.severity) + '">' + npwEsc(NPW_SEV[issue.severity] || issue.severity) + '</span>' +
        '<span class="npw-issue-msg">' + npwEsc(issue.message) + '</span></div>';
    }
    issueBody += '</div>';
  }
  parts.push(npwSection('配置问题', '', issueBody));

  box.innerHTML = parts.join('');
}

function npwRenderScript() {
  const view = npwEl('npwScriptView');
  const info = npwEl('npwScriptInfo');
  if (!view) return;
  if (!NPW.script) {
    npwClear(view);
    const none = document.createElement('div');
    none.className = 'npw-empty';
    if (NPW.selected == null) none.textContent = '请先在左侧选择一个 NPC。';
    else if (NPW.detail && NPW.detail.npc.scriptExists) none.textContent = '正在读取脚本…';
    else none.textContent = '该 NPC 没有可读取的脚本。';
    view.appendChild(none);
    if (info) info.textContent = '';
    return;
  }
  const s = NPW.script;
  if (info) {
    info.textContent = [
      s.name,
      s.lines.length + ' 行',
      npwFmtSize(s.size),
      'GBK' + (s.encoding === 'gbk-lossy' ? '（含不可逆字符）' : ''),
      (s.usedBy || []).length + ' 个 NPC 引用'
    ].join(' · ');
  }
  const term = NPW.scriptSearch.trim().toLowerCase();
  let html = '';
  let matches = 0;
  for (let i = 0; i < s.lines.length; i++) {
    const text = s.lines[i];
    if (term && text.toLowerCase().indexOf(term) < 0) continue;
    if (term) matches++;
    html += '<div class="npw-line"><span class="npw-line-no">' + (i + 1) + '</span>' +
      '<span class="npw-line-text">' + (term ? npwHighlight(text, term) : npwEsc(text)) + '</span></div>';
  }
  if (!html) html = '<div class="npw-empty">没有匹配的行。</div>';
  if (term && info) info.textContent += ' · 匹配 ' + matches + ' 行';
  view.innerHTML = html;
}

function npwHighlight(text, term) {
  const lower = text.toLowerCase();
  let out = '';
  let pos = 0;
  let i;
  while ((i = lower.indexOf(term, pos)) >= 0) {
    out += npwEsc(text.slice(pos, i)) + '<mark>' + npwEsc(text.slice(i, i + term.length)) + '</mark>';
    pos = i + term.length;
  }
  return out + npwEsc(text.slice(pos));
}

function npwRenderHealth() {
  const box = npwEl('npwHealthList');
  if (!box) return;
  npwClear(box);
  if (!NPW.data) {
    const line = document.createElement('div');
    line.className = 'tsk-empty';
    line.textContent = '正在加载 NPC 数据…';
    box.appendChild(line);
    return;
  }
  const issues = NPW.data.issues || [];
  const counts = NPW.data.stats.issues;
  const summary = document.createElement('div');
  summary.className = 'npw-health-summary';
  summary.textContent = '共 ' + issues.length + ' 条问题：错误 ' + counts.error +
    ' · 警告 ' + counts.warn + ' · 提示 ' + counts.info;
  box.appendChild(summary);

  const order = { error: 0, warn: 1, info: 2 };
  const sorted = issues.slice().sort((a, b) =>
    (order[a.severity] - order[b.severity]) ||
    String(a.code).localeCompare(String(b.code)) ||
    ((a.index == null ? -1 : a.index) - (b.index == null ? -1 : b.index)));

  const groups = [];
  const groupMap = new Map();
  for (const issue of sorted) {
    if (!groupMap.has(issue.code)) {
      const g = { code: issue.code, severity: issue.severity, issues: [] };
      groupMap.set(issue.code, g);
      groups.push(g);
    }
    groupMap.get(issue.code).issues.push(issue);
  }

  for (const g of groups) {
    const group = document.createElement('div');
    group.className = 'mon-issue-group';
    const head = document.createElement('div');
    head.className = 'mon-issue-head';
    const title = document.createElement('span');
    title.textContent = (NPW_ISSUE_LABEL[g.code] || g.code) + ' · ' + g.code;
    head.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'act-cat';
    meta.textContent = g.issues.length + ' 条';
    head.appendChild(meta);
    group.appendChild(head);
    for (const issue of g.issues) group.appendChild(npwIssueRow(issue));
    box.appendChild(group);
  }

  const fullBox = document.createElement('div');
  fullBox.className = 'npw-section';
  const fullHead = document.createElement('div');
  fullHead.className = 'mon-issue-head';
  const fullTitle = document.createElement('span');
  fullTitle.textContent = '未被引用的脚本 · ' + (NPW.data.orphans || []).length;
  fullHead.appendChild(fullTitle);
  fullBox.appendChild(fullHead);
  if (!(NPW.data.orphans || []).length) {
    const empty = document.createElement('div');
    empty.className = 'mon-empty';
    empty.textContent = '所有脚本都被 NPCList 或商店配置引用。';
    fullBox.appendChild(empty);
  } else {
    const chips = document.createElement('div');
    chips.className = 'npw-orphans';
    for (const name of NPW.data.orphans) {
      chips.appendChild(npwBtn(name, 'npw-orphan', () => npwOpenScript(name)));
    }
    fullBox.appendChild(chips);
  }
  box.appendChild(fullBox);

  if (!box.childNodes.length) {
    const empty = document.createElement('div');
    empty.className = 'mon-empty';
    empty.textContent = '未发现问题。';
    box.appendChild(empty);
  }
}

function npwIssueRow(issue) {
  const row = document.createElement('div');
  row.className = 'mon-issue';
  const sev = document.createElement('span');
  sev.className = 'mon-sev ' + issue.severity;
  sev.textContent = NPW_SEV[issue.severity] || issue.severity;
  row.appendChild(sev);
  const body = document.createElement('div');
  body.className = 'mon-issue-body';
  const msg = document.createElement('div');
  msg.textContent = issue.message;
  body.appendChild(msg);
  const metaText = [issue.script ? issue.script + '.py' : '', issue.line ? '第 ' + issue.line + ' 行' : '']
    .filter(Boolean).join(' · ');
  if (metaText) {
    const meta = document.createElement('div');
    meta.className = 'act-issue-meta';
    meta.textContent = metaText;
    body.appendChild(meta);
  }
  row.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'tsk-issue-actions';
  if (issue.index != null) {
    actions.appendChild(npwBtn('定位 NPC', 'btn btn-sm', () => npwSelect(issue.index)));
  }
  const action = issue.action || null;
  if (action && action.view === 'npc' && action.search) {
    actions.appendChild(npwBtn('NPC 分布', 'btn btn-sm', () => npwGotoNpc(action.search)));
  }
  if (action && action.view === 'shops' && action.search) {
    actions.appendChild(npwBtn('商店货品', 'btn btn-sm', () => npwGotoShop(action.search)));
  }
  if (action && action.view === 'tasks' && action.search) {
    actions.appendChild(npwBtn('任务工作台', 'btn btn-sm', () => npwGotoTasks(action.search)));
  }
  if (issue.code === 'npc_shop_item_missing' && issue.script) {
    actions.appendChild(npwBtn('查看脚本', 'btn btn-sm', () => npwOpenScript(issue.script + '.py')));
  }
  if (actions.childNodes.length) row.appendChild(actions);
  return row;
}

function npwRenderAll() {
  npwRenderTabs();
  npwRenderMeta();
  npwRenderList();
  npwRenderDetail();
  npwRenderScript();
  npwRenderHealth();
}

async function npwSelect(index) {
  if (NPW.data && (index == null || index < 0 || index >= NPW.data.npcs.length)) return;
  NPW.selected = index;
  NPW.tab = 'detail';
  NPW.detail = null;
  NPW.script = null;
  NPW.scriptName = '';
  NPW.scriptSearch = '';
  const input = npwEl('npwScriptSearch');
  if (input) input.value = '';
  npwRenderTabs();
  npwRenderList();
  npwRenderScript();
  try {
    await npwLoadDetail(index);
  } catch (e) {
    toast('加载 NPC 详情失败：' + e.message, 'err');
    return;
  }
  npwRenderDetail();
  npwRenderHealth();
  npwSetHash(index);
  const row = document.querySelector('#npwList [data-npw-index="' + index + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

async function npwOpenScript(name) {
  try {
    await npwFetchScript(name);
  } catch (e) {
    toast('读取脚本失败：' + e.message, 'err');
    return;
  }
  npwSelectTab('script');
  npwRenderScript();
}

async function npwSelectTab(tab) {
  NPW.tab = tab;
  npwRenderTabs();
  if (tab !== 'script' || NPW.script || !NPW.detail || !NPW.detail.npc.scriptExists) return;
  try {
    await npwFetchScript(NPW.detail.npc.scriptFile);
    npwRenderScript();
  } catch (e) {
    npwRenderScript();
    toast('读取脚本失败：' + e.message, 'err');
  }
}

async function npwGotoNpc(search) {
  if (!window.openNpcConfig) return;
  await window.openNpcConfig();
  const input = npwEl('npcSearch');
  if (input) {
    input.value = search || '';
    input.dispatchEvent(new Event('input'));
  }
}

async function npwGotoShop(search) {
  if (!window.openShopsConfig) return;
  await window.openShopsConfig();
  const input = npwEl('shopSearch');
  if (input) {
    input.value = search || '';
    input.dispatchEvent(new Event('input'));
  }
}

async function npwGotoTasks(search) {
  if (!window.openTaskView) return;
  await window.openTaskView();
  const input = npwEl('taskFilter');
  if (input) {
    input.value = search || '';
    input.dispatchEvent(new Event('input'));
  }
}

async function openNpcWorkView(index) {
  if (S.mode !== 'npcwork' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'npcwork';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
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
  if (window.hideNpcBuyView) window.hideNpcBuyView();
  const dbView = npwEl('dbView');
  const dropView = npwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = npwEl('npcWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('npcw');
  npwRenderAll();
  if (!NPW.data || NPW.stale) {
    try {
      await npwLoad(true);
      npwRenderAll();
    } catch (e) {
      npwRenderAll();
      toast('加载 NPC 数据失败：' + e.message, 'err');
      return;
    }
  }
  let target = index;
  if (target == null) {
    const fromHash = npwHashIndex();
    if (fromHash != null) target = fromHash;
  }
  if (target == null && NPW.selected != null) target = NPW.selected;
  if (target != null && NPW.data && target >= 0 && target < NPW.data.npcs.length) {
    await npwSelect(target);
  } else {
    npwSetHash('');
    npwRenderDetail();
  }
}

window.openNpcWorkView = openNpcWorkView;
window.hideNpcWorkView = () => {
  const view = npwEl('npcWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && npwHashIndex() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshNpcWorkState = (st) => {
  const info = st && st.configs ? st.configs.npcwork : null;
  if (info && info.npcs != null) npwText('npcWorkCount', String(info.npcs));
  NPW.stale = true;
  if (S.mode === 'npcwork') npwRenderMeta();
};
window.updateNpcWorkMeta = npwRenderMeta;

function npwSyncMapFilter() {
  const btn = npwEl('npwMapFilterClear');
  if (!btn) return;
  btn.classList.toggle('hidden', !NPW.mapFilter);
  btn.textContent = NPW.mapFilter ? '地图 ' + NPW.mapFilter + ' ×' : '';
}

function npwSetMapFilter(map) {
  NPW.mapFilter = String(map == null ? '' : map).toLowerCase();
  npwSyncMapFilter();
  npwRenderList();
}

window.filterNpcWorkByMap = npwSetMapFilter;
window.openShopsByScript = npwGotoShop;

function npwBindEvents() {
  const filter = npwEl('npwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(NPW.searchTimer);
      NPW.searchTimer = setTimeout(() => {
        NPW.filter = filter.value;
        npwRenderList();
      }, 150);
    });
  }
  document.querySelectorAll('#npwFlagFilter [data-npw-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      NPW.flag = btn.dataset.npwFlag;
      document.querySelectorAll('#npwFlagFilter [data-npw-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      npwRenderList();
    });
  });
  const mapClear = npwEl('npwMapFilterClear');
  if (mapClear) mapClear.addEventListener('click', () => npwSetMapFilter(''));
  npwSyncMapFilter();
  const list = npwEl('npwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-npw-index]');
      if (!li) return;
      npwSelect(Number(li.dataset.npwIndex));
    });
  }
  const tabs = npwEl('npwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-npw-tab]');
      if (!btn) return;
      npwSelectTab(btn.dataset.npwTab);
    });
  }
  const detail = npwEl('npwDetail');
  if (detail) {
    detail.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-npw-act]');
      if (!btn) return;
      const act = btn.dataset.npwAct;
      if (act === 'npc') npwGotoNpc(btn.dataset.search);
      else if (act === 'shops') npwGotoShop(btn.dataset.search);
      else if (act === 'task') {
        if (window.openTaskView) window.openTaskView(undefined, Number(btn.dataset.id));
      } else if (act === 'script') {
        (async () => {
          if (NPW.script) {
            npwSelectTab('script');
            npwRenderScript();
            return;
          }
          const n = NPW.detail && NPW.detail.npc;
          if (n) await npwOpenScript(n.scriptFile);
        })();
      } else if (act === 'ranking') {
        if (window.openActivityView) window.openActivityView('rankings');
      }
    });
  }
  const scriptSearch = npwEl('npwScriptSearch');
  if (scriptSearch) {
    scriptSearch.addEventListener('input', () => {
      NPW.scriptSearch = scriptSearch.value;
      npwRenderScript();
    });
  }
  const reload = npwEl('btnNpwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        await npwLoad(true);
        if (NPW.selected != null) {
          await npwLoadDetail(NPW.selected);
          NPW.script = null;
        }
        npwRenderAll();
        toast('NPC 数据已重新检查', 'ok');
      } catch (e) {
        npwRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const index = npwHashIndex();
    if (index != null) openNpcWorkView(index);
  });
}

npwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const index = npwHashIndex();
    if (index != null) openNpcWorkView(index);
  });
} else {
  window.addEventListener('app-ready', () => {
    const index = npwHashIndex();
    if (index != null) openNpcWorkView(index);
  });
}

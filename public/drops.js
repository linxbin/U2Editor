'use strict';

/* 爆率工作台（物品视角）：MonItems 全量反查 + 文件总览 + 配置体检（只读） */

const DPW = {
  data: null,
  detail: null,
  key: null,
  loading: false,
  detailLoading: false,
  stale: true,
  tab: 'items',
  filter: '',
  flag: 'all',
  fileFilter: '',
  searchTimer: null,
  fileTimer: null
};

const DPW_TAB_KEYS = ['items', 'files', 'health'];
const DPW_ROW_LIMIT = 800;

const DPW_SEV = { error: '错误', warn: '警告', info: '提示' };

const DPW_ISSUE_LABEL = {
  drop_items_unreadable: '物品表读取失败',
  drop_monsters_unreadable: '怪物表读取失败',
  drop_mongen_unreadable: '刷怪表读取失败',
  drop_file_unreadable: '爆率文件读取失败',
  drop_line_invalid: '爆率行无法解析',
  drop_prob_negative: '负概率',
  drop_prob_zero_den: '概率分母为 0',
  drop_prob_over: '概率超过 100%',
  drop_item_missing: '掉落物品缺失',
  drop_file_orphan: '爆率文件无对应怪物',
  drop_monster_no_file: '怪物缺少爆率文件',
  drop_file_empty: '空爆率文件'
};

function dpwEl(id) {
  return document.getElementById(id);
}

function dpwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dpwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function dpwText(id, text) {
  const el = dpwEl(id);
  if (el) el.textContent = text;
}

function dpwIssueCount(n) {
  return (n && (n.error + n.warn)) || 0;
}

function dpwPct(n, d) {
  if (!d) return '—';
  return (n / d * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
}

function dpwBadge(text, cls) {
  return '<span class="dpw-badge' + (cls ? ' ' + cls : '') + '">' + dpwEsc(text) + '</span>';
}

function dpwKv(label, value, cls) {
  return '<div class="tsk-kv"><div class="tsk-kv-label">' + dpwEsc(label) +
    '</div><div class="tsk-kv-value' + (cls ? ' ' + cls : '') + '">' + dpwEsc(value) + '</div></div>';
}

function dpwSection(title, note, body) {
  return '<div class="tsk-section"><div class="tsk-section-head"><h4>' + dpwEsc(title) + '</h4>' +
    (note ? '<span class="tsk-empty">' + dpwEsc(note) + '</span>' : '') + '</div>' + body + '</div>';
}

function dpwHashState() {
  const m = /^#drops(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  const raw = m[1] || '';
  if (!raw) return { tab: 'items' };
  if (raw === 'files') return { tab: 'files' };
  if (raw === 'health') return { tab: 'health' };
  if (raw === 'items') return { tab: 'items' };
  if (raw.startsWith('item-')) {
    let key = raw.slice(5);
    try {
      key = decodeURIComponent(key);
    } catch (e) {
    }
    return { tab: 'items', key };
  }
  return { tab: 'items' };
}

function dpwSetHash(sel) {
  let raw = '';
  if (sel && sel.tab === 'items' && sel.key) raw = 'item-' + encodeURIComponent(sel.key);
  else if (sel && sel.tab === 'files') raw = 'files';
  else if (sel && sel.tab === 'health') raw = 'health';
  const next = raw ? '#drops=' + raw : '#drops';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function dpwLoad() {
  if (DPW.loading) return;
  DPW.loading = true;
  dpwRenderMeta();
  try {
    const data = await api('/api/config/drops');
    DPW.data = data;
    DPW.stale = false;
    dpwText('dropWorkCount', String(data.stats.items));
    if (DPW.key && !data.items.some((i) => i.key === DPW.key)) {
      DPW.key = null;
      DPW.detail = null;
    }
  } finally {
    DPW.loading = false;
  }
}

async function dpwLoadDetail(key) {
  if (!key) {
    DPW.detail = null;
    return;
  }
  DPW.detailLoading = true;
  dpwRenderDetail();
  try {
    DPW.detail = await api('/api/config/drops/item?key=' + encodeURIComponent(key));
    if (DPW.detail && DPW.detail.item) DPW.key = DPW.detail.item.key;
  } finally {
    DPW.detailLoading = false;
  }
}

function dpwRenderMeta() {
  const meta = dpwEl('dpwMeta');
  if (!meta) return;
  if (!DPW.data) {
    meta.textContent = DPW.loading ? '正在加载爆率数据…' : '';
    return;
  }
  const s = DPW.data.stats;
  meta.textContent = [
    s.files + ' 个爆率文件',
    s.lines + ' 条掉落规则',
    s.items + ' 种掉落物品',
    s.monsters + ' 个怪物有爆率',
    '问题 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info + ' 提示'
  ].join(' · ');
  dpwText('dropWorkCount', String(s.items));
}

function dpwRenderTabs() {
  document.querySelectorAll('#dpwTabs [data-dpw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.dpwTab === DPW.tab);
  });
  const panes = {
    items: 'dpwItemPane',
    files: 'dpwFilePane',
    health: 'dpwHealthPane'
  };
  Object.keys(panes).forEach((key) => {
    const el = dpwEl(panes[key]);
    if (el) el.classList.toggle('hidden', key !== DPW.tab);
  });
}

function dpwSelectTab(tab) {
  if (DPW_TAB_KEYS.indexOf(tab) < 0) return;
  DPW.tab = tab;
  dpwRenderTabs();
  if (tab === 'items') {
    dpwRenderDetail();
    dpwSetHash({ tab: 'items', key: DPW.key });
  } else if (tab === 'files') {
    dpwRenderFiles();
    dpwSetHash({ tab: 'files' });
  } else {
    dpwRenderHealth();
    dpwSetHash({ tab: 'health' });
  }
}

function dpwItemFlagMatch(item) {
  if (DPW.flag === 'issues') {
    return item.negative > 0 || item.zeroDen > 0 || item.over > 0 || (!item.exists && !item.pseudo);
  }
  return true;
}

function dpwRenderList() {
  const list = dpwEl('dpwList');
  const hint = dpwEl('dpwListHint');
  if (!list) return;
  dpwClear(list);
  if (!DPW.data) {
    if (hint) hint.textContent = DPW.loading ? '正在加载掉落物品…' : '';
    return;
  }
  const q = DPW.filter.trim().toLowerCase();
  const all = DPW.data.items.filter((item) => {
    if (!dpwItemFlagMatch(item)) return false;
    return !q || item.name.toLowerCase().includes(q);
  });
  for (const item of all) {
    const li = document.createElement('li');
    li.className = 'file-item' + (DPW.key === item.key ? ' active' : '');
    li.dataset.dpwKey = item.key;
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = item.name;
    if (!item.exists && !item.pseudo) name.insertAdjacentHTML('beforeend', dpwBadge('缺失', 'bad'));
    if (item.pseudo) name.insertAdjacentHTML('beforeend', dpwBadge('伪物品', 'special'));
    if (item.negative) name.insertAdjacentHTML('beforeend', dpwBadge('负概率', 'bad'));
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = [
      item.drops + ' 行',
      item.monsters + ' 怪物',
      item.files + ' 文件'
    ].join(' · ');
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (!all.length) {
    const empty = document.createElement('li');
    empty.className = 'side-note';
    empty.textContent = '没有符合条件的掉落物品。';
    list.appendChild(empty);
  }
  if (hint) hint.textContent = '共 ' + all.length + ' 种掉落物品。';
}

function dpwRenderDetail() {
  const box = dpwEl('dpwItemDetail');
  if (!box) return;
  if (!DPW.data) {
    box.innerHTML = '<div class="dpw-empty">正在加载掉落数据…</div>';
    return;
  }
  if (!DPW.key) {
    const s = DPW.data.stats;
    box.innerHTML = '<div class="dpw-intro">' +
      '<div class="dpw-intro-title">爆率工作台（物品视角）</div>' +
      '<p>左侧搜索物品，查看它由哪些怪物掉落、概率分母、出处文件和行号。' +
      '「爆率文件」标签按文件汇总规则数与异常，「配置体检」汇总缺失物品、负概率、空文件与无怪物文件。</p>' +
      '<p>当前 ' + s.files + ' 个文件、' + s.lines + ' 条规则、' + s.items + ' 种物品；' +
      '缺失物品 ' + s.missingItems + ' 种，无对应怪物文件 ' + s.orphanFiles + ' 个，空文件 ' + s.emptyFiles + ' 个。</p>' +
      '</div>';
    return;
  }
  if (DPW.detailLoading && !DPW.detail) {
    box.innerHTML = '<div class="dpw-empty">正在加载「' + dpwEsc(DPW.key) + '」的掉落来源…</div>';
    return;
  }
  const d = DPW.detail;
  if (!d || !d.item) {
    box.innerHTML = '<div class="dpw-empty">未找到该物品的掉落数据。</div>';
    return;
  }
  const item = d.item;
  const tags = [];
  if (item.pseudo) tags.push(dpwBadge('伪物品 / 特殊键', 'special'));
  if (!item.exists && !item.pseudo) tags.push(dpwBadge('不在 stditems.db', 'bad'));
  if (item.negative) tags.push(dpwBadge('负概率 ' + item.negative, 'bad'));
  if (item.zeroDen) tags.push(dpwBadge('分母为 0 ' + item.zeroDen, 'bad'));
  if (item.over) tags.push(dpwBadge('概率越界 ' + item.over, 'bad'));
  const head = '<div class="dpw-item-head">' +
    '<div><strong>' + dpwEsc(item.name) + '</strong>' +
    '<div class="muted">' + item.drops + ' 条掉落规则 · ' + item.monsters + ' 个怪物 · ' +
    item.files + ' 个爆率文件' + (item.itemIndex >= 0 ? ' · stditems 第 ' + (item.itemIndex + 1) + ' 条' : '') +
    '</div></div><div class="dpw-head-tags">' + tags.join('') + '</div></div>';

  const actions = [];
  if (item.itemIndex >= 0 && !item.pseudo) {
    actions.push('<button class="btn btn-sm" data-dpw-act="openitem" data-key="' + dpwEsc(item.key) + '">打开物品工作台</button>');
  }
  if (!item.pseudo) {
    actions.push('<button class="btn btn-sm" data-dpw-act="db" data-name="' + dpwEsc(item.name) + '">在 stditems.db 中查找</button>');
  }
  const actionHtml = actions.length ? '<div class="dpw-actions">' + actions.join('') + '</div>' : '';

  let rendered = 0;
  let total = 0;
  const groupsHtml = [];
  for (const group of d.groups) {
    total += group.rows.length;
    if (rendered >= DPW_ROW_LIMIT) continue;
    const rows = [];
    for (const r of group.rows) {
      if (rendered >= DPW_ROW_LIMIT) break;
      rendered++;
      rows.push('<div class="dpw-line">' +
        '<span class="dpw-line-no">第 ' + r.line + ' 行</span>' +
        '<span class="dpw-ratio' + (r.n < 0 ? ' bad' : '') + '">' + r.n + '/' + r.d + '</span>' +
        '<span class="dpw-pct">' + dpwEsc(dpwPct(r.n, r.d)) + '</span>' +
        (r.qty != null ? '<span class="dpw-qty">数量 ' + r.qty + '</span>' : '') +
        '<button class="btn btn-sm ghost dpw-file-btn" data-dpw-act="file" data-file="' + dpwEsc(r.file) +
        '" data-line="' + r.line + '">' + dpwEsc(r.file) + '</button>' +
        '</div>');
    }
    const headParts = [];
    if (group.monster) {
      headParts.push('<button class="btn btn-sm ghost" data-dpw-act="monster" data-name="' + dpwEsc(group.monster) +
        '">' + dpwEsc(group.monster) + '</button>');
    } else {
      headParts.push('<strong>' + dpwEsc(group.label) + '</strong>' + dpwBadge('无对应怪物', 'bad'));
    }
    headParts.push('<span class="muted">' + group.rows.length + ' 行 · ' +
      group.files.length + ' 个文件</span>');
    groupsHtml.push('<div class="dpw-group"><div class="dpw-group-head">' + headParts.join('') +
      '</div><div class="dpw-lines">' + rows.join('') + '</div></div>');
  }
  const note = total > rendered
    ? '共 ' + total + ' 条，当前显示前 ' + rendered + ' 条；可在「爆率文件」中查看完整文件。'
    : total + ' 条掉落规则';
  box.innerHTML = head + actionHtml +
    '<div class="dpw-groups-hint">' + dpwEsc(note) + '</div>' +
    (groupsHtml.length ? groupsHtml.join('') : '<div class="dpw-empty">没有掉落来源。</div>');
}

function dpwFileFilterMatch(file, q) {
  if (!q) return true;
  return file.file.toLowerCase().includes(q) ||
    String(file.monster || '').toLowerCase().includes(q) ||
    file.stem.toLowerCase().includes(q);
}

function dpwFileIssues(file) {
  return file.invalid + file.negative + file.zeroDen + file.over + file.unknownRows;
}

function dpwRenderFiles() {
  const box = dpwEl('dpwFileList');
  if (!box) return;
  if (!DPW.data) {
    box.innerHTML = '<div class="dpw-empty">正在加载爆率文件…</div>';
    return;
  }
  const q = DPW.fileFilter.trim().toLowerCase();
  const files = DPW.data.files.filter((f) => dpwFileFilterMatch(f, q));
  const rows = files.map((f) => {
    const flags = [];
    if (f.empty) flags.push(dpwBadge('空文件', 'warn'));
    if (f.orphan) flags.push(dpwBadge('无对应怪物', 'bad'));
    if (f.negative) flags.push(dpwBadge('负概率 ' + f.negative, 'bad'));
    if (f.zeroDen) flags.push(dpwBadge('分母 0 ' + f.zeroDen, 'bad'));
    if (f.over) flags.push(dpwBadge('越界 ' + f.over, 'bad'));
    if (f.invalid) flags.push(dpwBadge('无法解析 ' + f.invalid, 'warn'));
    if (f.unknownItems) flags.push(dpwBadge('未知物品 ' + f.unknownItems, 'warn'));
    return '<tr class="' + (dpwFileIssues(f) || f.empty || f.orphan ? 'dpw-row-bad' : '') + '">' +
      '<td><button class="btn btn-sm ghost" data-dpw-act="file" data-file="' + dpwEsc(f.file) + '">' +
      dpwEsc(f.file) + '</button></td>' +
      '<td>' + (f.monster
        ? '<button class="btn btn-sm ghost" data-dpw-act="monster" data-name="' + dpwEsc(f.monster) + '">' +
          dpwEsc(f.monster) + '</button>'
        : '<span class="muted">—</span>') + '</td>' +
      '<td>' + f.rules + '</td>' +
      '<td>' + (flags.length ? flags.join(' ') : '<span class="muted">正常</span>') + '</td>' +
      '</tr>';
  });
  const table = '<div class="dpw-table-wrap"><table class="dpw-table"><thead><tr>' +
    '<th>爆率文件</th><th>对应怪物</th><th>规则数</th><th>状态</th></tr></thead><tbody>' +
    rows.join('') + '</tbody></table></div>';
  const hint = '<div class="dpw-groups-hint">共 ' + files.length + ' 个文件' +
    (q ? '（已按关键词筛选）' : '') + '；点击文件名打开现有爆率编辑器。</div>';
  box.innerHTML = hint + table;
}

function dpwIssueGroup(issue) {
  const view = issue.action && issue.action.view;
  if (view === 'item') return '掉落物品';
  if (view === 'file') return '爆率文件';
  if (view === 'monster') return '怪物爆率';
  return '总览';
}

function dpwIssueRow(issue) {
  const sev = issue.severity || 'info';
  const label = DPW_ISSUE_LABEL[issue.code] || issue.code;
  const where = issue.file ? issue.file + (issue.line != null ? ':' + issue.line : '') : '';
  const idx = DPW.data ? DPW.data.issues.indexOf(issue) : -1;
  const jump = issue.action && idx >= 0
    ? '<button class="btn btn-sm ghost" data-dpw-act="issue" data-dpw-issue="' + idx + '">查看</button>'
    : '';
  return '<div class="mon-issue dpw-issue">' +
    '<span class="mon-sev ' + sev + '">' + dpwEsc(DPW_SEV[sev] || sev) + '</span>' +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + dpwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + dpwEsc(label) + (where ? ' · ' + dpwEsc(where) : '') + '</div></div>' +
    jump + '</div>';
}

function dpwRenderHealth() {
  const box = dpwEl('dpwHealthList');
  if (!box) return;
  if (!DPW.data) {
    box.innerHTML = '<div class="dpw-empty">正在加载体检数据…</div>';
    return;
  }
  const issues = DPW.data.issues;
  if (!issues.length) {
    box.innerHTML = '<div class="dpw-empty">没有发现爆率配置问题。</div>';
    return;
  }
  const groups = {};
  for (const issue of issues) {
    const g = dpwIssueGroup(issue);
    if (!groups[g]) groups[g] = [];
    groups[g].push(issue);
  }
  const order = ['掉落物品', '爆率文件', '怪物爆率', '总览'];
  let html = '';
  for (const g of order) {
    const list = groups[g];
    if (!list || !list.length) continue;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const i of list) counts[i.severity] = (counts[i.severity] || 0) + 1;
    html += '<div class="mon-issue-group"><div class="mon-issue-head"><strong>' + dpwEsc(g) + '</strong>' +
      '<span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' + counts.warn +
      ' 警告 / ' + counts.info + ' 提示</span></div>' +
      list.map((i) => dpwIssueRow(i)).join('') + '</div>';
  }
  box.innerHTML = html;
}

function dpwRenderAll() {
  dpwRenderMeta();
  dpwRenderTabs();
  dpwRenderList();
  dpwRenderDetail();
  dpwRenderFiles();
  dpwRenderHealth();
}

async function dpwSelectItem(key) {
  if (!key) return;
  DPW.key = key;
  DPW.detail = null;
  DPW.tab = 'items';
  dpwRenderTabs();
  dpwRenderList();
  dpwRenderDetail();
  try {
    await dpwLoadDetail(key);
  } catch (e) {
    DPW.detail = null;
    dpwRenderDetail();
    toast('加载掉落详情失败：' + e.message, 'err');
    return;
  }
  dpwRenderDetail();
  dpwSetHash({ tab: 'items', key });
  const row = document.querySelector('#dpwList [data-dpw-key="' + dpwCssEsc(key) + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function dpwCssEsc(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

async function dpwGotoMonster(name) {
  if (!window.openMonsterWorkbench || !name) return;
  await window.openMonsterWorkbench(name);
  const tab = document.querySelector('#monTabs [data-mon-tab="drop"]');
  if (tab) tab.click();
}

async function dpwGotoFile(file, line) {
  if (!window.openDrop || !file) return;
  await window.openDrop(file);
  const area = dpwEl('dropText');
  if (!area) return;
  const lines = area.value.split('\n');
  const target = Math.max(1, Math.min(Number(line) || 1, lines.length));
  let offset = 0;
  for (let i = 0; i < target - 1; i++) offset += lines[i].length + 1;
  area.focus();
  area.setSelectionRange(offset, offset + (lines[target - 1] || '').length);
  const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 17;
  area.scrollTop = Math.max(0, (target - 4) * lineHeight);
}

async function dpwGotoItem(key) {
  if (!key) return;
  if (S.mode !== 'drops' && window.openDropsView) await window.openDropsView({ tab: 'items', key });
  else await dpwSelectItem(key);
}

async function dpwGotoDb(name) {
  if (!window.openDb) return;
  await window.openDb('stditems.db');
  const input = dpwEl('rowSearch');
  if (input && name) {
    input.value = name;
    input.dispatchEvent(new Event('input'));
  }
}

async function dpwOpenItemWork(key) {
  if (!window.openItemWorkView || !DPW.data) return;
  const item = DPW.data.items.find((i) => i.key === key);
  if (!item || item.itemIndex < 0) return;
  await window.openItemWorkView(item.itemIndex);
}

async function dpwJumpIssue(issue) {
  if (!issue || !issue.action) return;
  const a = issue.action;
  if (a.view === 'item') {
    await dpwGotoItem(a.key);
  } else if (a.view === 'file') {
    await dpwGotoFile(a.file, issue.line || 1);
  } else if (a.view === 'monster') {
    await dpwGotoMonster(a.name);
  } else if (a.view === 'tab') {
    DPW.tab = 'files';
    dpwRenderTabs();
    dpwRenderFiles();
    dpwSetHash({ tab: 'files' });
  }
}

async function openDropsView(sel) {
  if (S.mode !== 'drops' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'drops';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  if (window.hideItemWorkView) window.hideItemWorkView();
  if (window.hideGrowthView) window.hideGrowthView();
  if (window.hideSpawnWorkView) window.hideSpawnWorkView();
  if (window.hideMapWorkView) window.hideMapWorkView();
  if (window.hideShopWorkView) window.hideShopWorkView();
  if (window.hideScriptWorkView) window.hideScriptWorkView();
  if (window.hideCastleWorkView) window.hideCastleWorkView();
  const dbView = dpwEl('dbView');
  const dropView = dpwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = dpwEl('dropWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('dpw');
  const target = sel || dpwHashState() || { tab: DPW.tab };
  if (target.tab && DPW_TAB_KEYS.indexOf(target.tab) >= 0) DPW.tab = target.tab;
  if (target.key) DPW.key = target.key;
  dpwRenderAll();
  if (!DPW.data || DPW.stale) {
    try {
      await dpwLoad();
      dpwRenderAll();
    } catch (e) {
      dpwRenderAll();
      toast('加载爆率数据失败：' + e.message, 'err');
      return;
    }
  }
  dpwRenderAll();
  if (DPW.tab === 'items' && DPW.key) {
    await dpwSelectItem(DPW.key);
  } else if (DPW.tab === 'files') {
    dpwSetHash({ tab: 'files' });
  } else if (DPW.tab === 'health') {
    dpwSetHash({ tab: 'health' });
  } else {
    dpwSetHash({ tab: 'items' });
  }
}

window.openDropsView = openDropsView;
window.hideDropWorkView = () => {
  const view = dpwEl('dropWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && dpwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshDropWorkState = (st) => {
  const info = st && st.configs ? st.configs.dropwork : null;
  if (info && info.items != null) dpwText('dropWorkCount', String(info.items));
  DPW.stale = true;
  if (S.mode === 'drops') dpwRenderMeta();
};
window.updateDropWorkMeta = dpwRenderMeta;

function dpwBindEvents() {
  const filter = dpwEl('dpwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(DPW.searchTimer);
      DPW.searchTimer = setTimeout(() => {
        DPW.filter = filter.value;
        dpwRenderList();
      }, 150);
    });
  }
  document.querySelectorAll('#dpwFlagFilter [data-dpw-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      DPW.flag = btn.dataset.dpwFlag;
      document.querySelectorAll('#dpwFlagFilter [data-dpw-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      dpwRenderList();
    });
  });
  const list = dpwEl('dpwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-dpw-key]');
      if (!li) return;
      dpwSelectItem(li.dataset.dpwKey);
    });
  }
  const tabs = dpwEl('dpwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dpw-tab]');
      if (!btn) return;
      dpwSelectTab(btn.dataset.dpwTab);
    });
  }
  const fileFilter = dpwEl('dpwFileFilter');
  if (fileFilter) {
    fileFilter.addEventListener('input', () => {
      clearTimeout(DPW.fileTimer);
      DPW.fileTimer = setTimeout(() => {
        DPW.fileFilter = fileFilter.value;
        dpwRenderFiles();
      }, 150);
    });
  }
  const main = dpwEl('dropWorkView');
  if (main) {
    main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dpw-act]');
      if (!btn) return;
      const act = btn.dataset.dpwAct;
      if (act === 'file') dpwGotoFile(btn.dataset.file, Number(btn.dataset.line) || 1);
      else if (act === 'monster') dpwGotoMonster(btn.dataset.name);
      else if (act === 'db') dpwGotoDb(btn.dataset.name);
      else if (act === 'openitem') dpwOpenItemWork(btn.dataset.key);
      else if (act === 'issue' && DPW.data && DPW.data.issues[Number(btn.dataset.dpwIssue)]) {
        dpwJumpIssue(DPW.data.issues[Number(btn.dataset.dpwIssue)]);
      }
    });
  }
  const reload = dpwEl('btnDpwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        DPW.stale = true;
        DPW.detail = null;
        await dpwLoad();
        dpwRenderAll();
        if (DPW.key) await dpwSelectItem(DPW.key);
        toast('爆率数据已重新检查', 'ok');
      } catch (e) {
        dpwRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const state = dpwHashState();
    if (state) openDropsView(state);
  });
}

dpwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = dpwHashState();
    if (state) openDropsView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = dpwHashState();
    if (state) openDropsView(state);
  });
}

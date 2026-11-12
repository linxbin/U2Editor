'use strict';

/* 刷怪工作台：Mongen 全量地图/怪物聚合 + 坐标体检（只读，跳转现有编辑） */

const SPW = {
  data: null,
  detail: null,
  key: null,
  loading: false,
  detailLoading: false,
  stale: true,
  tab: 'maps',
  filter: '',
  flag: 'all',
  monsterFilter: '',
  searchTimer: null,
  monsterTimer: null
};

const SPW_TAB_KEYS = ['maps', 'monsters', 'health'];
const SPW_ROW_LIMIT = 800;

const SPW_SEV = { error: '错误', warn: '警告', info: '提示' };

const SPW_ISSUE_LABEL = {
  spawn_mongen_unreadable: '刷怪表读取失败',
  spawn_monster_unreadable: '怪物表读取失败',
  spawn_mapinfo_unreadable: 'MapInfo 读取失败',
  spawn_coord_over: '刷怪坐标越界',
  spawn_duplicate: '重复刷怪点',
  spawn_extra: '多余参数',
  spawn_line_invalid: '非刷怪行',
  spawn_map_unknown: '地图不在 MapInfo',
  spawn_map_file_missing: '地图文件缺失',
  spawn_monster_missing: '怪物不在 Monster.DB',
  spawn_monster_no_drop: '怪物无爆率文件'
};

function spwEl(id) {
  return document.getElementById(id);
}

function spwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function spwText(id, text) {
  const el = spwEl(id);
  if (el) el.textContent = text;
}

function spwBadge(text, cls) {
  return '<span class="spw-badge' + (cls ? ' ' + cls : '') + '">' + spwEsc(text) + '</span>';
}

function spwHashState() {
  const m = /^#spawns(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  const raw = m[1] || '';
  if (!raw) return { tab: 'maps' };
  if (raw === 'maps') return { tab: 'maps' };
  if (raw === 'monsters') return { tab: 'monsters' };
  if (raw === 'health') return { tab: 'health' };
  if (raw.startsWith('map-')) {
    let key = raw.slice(4);
    try {
      key = decodeURIComponent(key);
    } catch (e) {
    }
    return { tab: 'maps', key };
  }
  return { tab: 'maps' };
}

function spwSetHash(sel) {
  let raw = '';
  if (sel && sel.tab === 'maps' && sel.key) raw = 'map-' + encodeURIComponent(sel.key);
  else if (sel && sel.tab === 'monsters') raw = 'monsters';
  else if (sel && sel.tab === 'health') raw = 'health';
  const next = raw ? '#spawns=' + raw : '#spawns';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function spwLoad(refresh) {
  if (SPW.loading) return;
  SPW.loading = true;
  spwRenderMeta();
  try {
    const data = await api('/api/config/spawns' + (refresh ? '?refresh=1' : ''));
    SPW.data = data;
    SPW.stale = false;
    spwText('spawnWorkCount', String(data.stats.maps));
    if (SPW.key && !data.maps.some((m) => m.key === SPW.key)) {
      SPW.key = null;
      SPW.detail = null;
    }
  } finally {
    SPW.loading = false;
  }
}

async function spwLoadDetail(key) {
  if (!key) {
    SPW.detail = null;
    return;
  }
  SPW.detailLoading = true;
  spwRenderDetail();
  try {
    SPW.detail = await api('/api/config/spawns/map?key=' + encodeURIComponent(key));
    if (SPW.detail && SPW.detail.map) SPW.key = SPW.detail.map.key;
  } catch (e) {
    SPW.detail = null;
    spwRenderDetail();
    toast('加载刷怪地图失败：' + e.message, 'err');
    return;
  } finally {
    SPW.detailLoading = false;
  }
  spwRenderDetail();
}

function spwRenderMeta() {
  const meta = spwEl('spwMeta');
  if (!meta) return;
  if (!SPW.data) {
    meta.textContent = SPW.loading ? '正在加载刷怪数据…' : '';
    return;
  }
  const s = SPW.data.stats;
  meta.textContent = [
    s.entries + ' 条刷怪',
    s.maps + ' 张地图',
    s.monsters + ' 种怪物',
    '问题 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info + ' 提示'
  ].join(' · ');
  spwText('spawnWorkCount', String(s.maps));
}

function spwRenderTabs() {
  document.querySelectorAll('#spwTabs [data-spw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.spwTab === SPW.tab);
  });
  const panes = { maps: 'spwMapPane', monsters: 'spwMonsterPane', health: 'spwHealthPane' };
  Object.keys(panes).forEach((key) => {
    const el = spwEl(panes[key]);
    if (el) el.classList.toggle('hidden', key !== SPW.tab);
  });
}

function spwSelectTab(tab) {
  if (SPW_TAB_KEYS.indexOf(tab) < 0) return;
  SPW.tab = tab;
  spwRenderTabs();
  if (tab === 'maps') {
    spwRenderDetail();
    spwSetHash({ tab: 'maps', key: SPW.key });
  } else if (tab === 'monsters') {
    spwRenderMonsters();
    spwSetHash({ tab: 'monsters' });
  } else {
    spwRenderHealth();
    spwSetHash({ tab: 'health' });
  }
}

function spwMapIssueCount(map) {
  return (map.known ? 0 : 1) + (map.file ? 0 : 1) + (map.outOfBounds ? 1 : 0);
}

function spwMapFlagMatch(map) {
  if (SPW.flag === 'issues') return spwMapIssueCount(map) > 0;
  return true;
}

function spwRenderList() {
  const list = spwEl('spwList');
  const hint = spwEl('spwListHint');
  if (!list) return;
  spwClear(list);
  if (!SPW.data) {
    if (hint) hint.textContent = SPW.loading ? '正在加载地图…' : '';
    return;
  }
  const q = SPW.filter.trim().toLowerCase();
  const all = SPW.data.maps.filter((map) => {
    if (!spwMapFlagMatch(map)) return false;
    if (!q) return true;
    return map.map.toLowerCase().includes(q) || String(map.name || '').toLowerCase().includes(q);
  });
  for (const map of all) {
    const li = document.createElement('li');
    li.className = 'file-item' + (SPW.key === map.key ? ' active' : '');
    li.dataset.spwKey = map.key;
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = map.map + (map.name ? ' · ' + map.name : '');
    if (!map.known) name.insertAdjacentHTML('beforeend', spwBadge('未登记', 'bad'));
    if (!map.file) name.insertAdjacentHTML('beforeend', spwBadge('缺文件', 'warn'));
    if (map.outOfBounds) name.insertAdjacentHTML('beforeend', spwBadge('越界 ' + map.outOfBounds, 'bad'));
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = [
      map.entries + ' 条',
      map.monsters + ' 种怪物',
      map.points + ' 个坐标',
      '累计 ' + map.total + ' 只'
    ].join(' · ');
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (!all.length) {
    const empty = document.createElement('li');
    empty.className = 'side-note';
    empty.textContent = '没有符合条件的刷怪地图。';
    list.appendChild(empty);
  }
  if (hint) hint.textContent = '共 ' + all.length + ' 张刷怪地图。';
}

function spwEntryRow(row) {
  const tags = [];
  if (!row.monsterExists) tags.push(spwBadge('怪物缺失', 'bad'));
  if (!row.hasDrop) tags.push(spwBadge('无爆率', 'warn'));
  if (row.outOfBounds) tags.push(spwBadge('越界', 'bad'));
  if (row.extra.length) tags.push(spwBadge('多参', 'warn'));
  return '<div class="spw-row' + (row.outOfBounds ? ' bad' : '') + '">' +
    '<button class="btn btn-sm ghost spw-monster-btn" data-spw-act="monster" data-name="' + spwEsc(row.monster) + '">' +
    spwEsc(row.monster) + '</button>' +
    '<span class="spw-meta">范围 ' + row.range + '</span>' +
    '<span class="spw-meta">数量 ' + row.count + '</span>' +
    '<span class="spw-meta">间隔 ' + row.interval + '</span>' +
    '<span class="spw-line-no">第 ' + (row.line + 1) + ' 行</span>' +
    (tags.length ? '<span class="spw-tags">' + tags.join('') + '</span>' : '') +
    '<button class="btn btn-sm ghost spw-row-btn" data-spw-act="entry" data-index="' + row.index +
    '" data-map="' + spwEsc(row.map.toLowerCase()) + '">配置</button>' +
    '</div>';
}

function spwRenderDetail() {
  const box = spwEl('spwMapDetail');
  if (!box) return;
  if (!SPW.data) {
    box.innerHTML = '<div class="spw-empty">正在加载刷怪数据…</div>';
    return;
  }
  if (!SPW.key) {
    const s = SPW.data.stats;
    box.innerHTML = '<div class="spw-intro">' +
      '<div class="spw-intro-title">刷怪分布工作台</div>' +
      '<p>左侧选择地图，查看这张地图的刷怪点、怪物、数量与坐标。勾选异常地图可快速找出未登记、缺地图文件或坐标越界的地图。</p>' +
      '<p>当前 ' + s.entries + ' 条刷怪、' + s.maps + ' 张地图、' + s.monsters + ' 种怪物；' +
      '不在 MapInfo 的地图 ' + s.mapsUnknown + ' 张，缺地图文件 ' + s.mapFilesMissing + ' 张，' +
      '坐标越界 ' + s.oobEntries + ' 条，Monster.DB 缺失怪物 ' + s.missingMonsters + ' 种。</p>' +
      '</div>';
    return;
  }
  if (SPW.detailLoading && !SPW.detail) {
    box.innerHTML = '<div class="spw-empty">正在加载地图「' + spwEsc(SPW.key) + '」的刷怪点…</div>';
    return;
  }
  const d = SPW.detail;
  if (!d || !d.map) {
    box.innerHTML = '<div class="spw-empty">未找到该地图的刷怪数据。</div>';
    return;
  }
  const map = d.map;
  const tags = [];
  if (!map.known) tags.push(spwBadge('不在 MapInfo', 'bad'));
  if (!map.file) tags.push(spwBadge('地图文件缺失', 'bad'));
  if (map.outOfBounds) tags.push(spwBadge('越界 ' + map.outOfBounds + ' 行', 'bad'));
  const dims = map.width && map.height ? '地图 ' + map.width + 'x' + map.height : '地图尺寸未知';
  const head = '<div class="spw-map-head">' +
    '<div><strong>' + spwEsc(map.map) + (map.name ? ' · ' + spwEsc(map.name) : '') + '</strong>' +
    '<div class="muted">' + map.entries + ' 条规则 · ' + map.monsters + ' 种怪物 · ' +
    map.points + ' 个坐标 · 累计 ' + map.total + ' 只 · ' + dims + '</div></div>' +
    '<div class="spw-head-tags">' + tags.join('') + '</div></div>';
  const actions = '<div class="spw-actions">' +
    '<button class="btn btn-sm" data-spw-act="entry" data-index="' + map.firstIndex +
    '" data-map="' + spwEsc(map.key) + '">在刷怪配置中编辑</button></div>';

  const groups = new Map();
  for (const row of d.entries) {
    const key = row.x + ',' + row.y;
    if (!groups.has(key)) groups.set(key, { x: row.x, y: row.y, rows: [] });
    groups.get(key).rows.push(row);
  }
  const sorted = [...groups.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  for (const g of sorted) g.rows.sort((a, b) => a.monster.localeCompare(b.monster, 'zh-CN'));

  let rendered = 0;
  const groupsHtml = [];
  for (const group of sorted) {
    if (rendered >= SPW_ROW_LIMIT) break;
    const rows = [];
    let sum = 0;
    for (const row of group.rows) {
      if (rendered >= SPW_ROW_LIMIT) break;
      rendered++;
      sum += row.count;
      rows.push(spwEntryRow(row));
    }
    groupsHtml.push('<div class="spw-group"><div class="spw-group-head">' +
      '<strong class="spw-coord">' + group.x + ', ' + group.y + '</strong>' +
      '<span class="muted">' + group.rows.length + ' 种怪物 · 累计 ' + sum + ' 只</span></div>' +
      '<div class="spw-rows">' + rows.join('') + '</div></div>');
  }
  const total = d.entries.length;
  const note = total > rendered
    ? '共 ' + total + ' 条，当前显示前 ' + rendered + ' 条；可在刷怪配置中查看完整地图。'
    : total + ' 条刷怪规则';
  box.innerHTML = head + actions +
    '<div class="spw-groups-hint">' + spwEsc(note) + '</div>' +
    (groupsHtml.length ? groupsHtml.join('') : '<div class="spw-empty">该地图没有刷怪规则。</div>');
}

function spwRenderMonsters() {
  const box = spwEl('spwMonsterList');
  if (!box) return;
  if (!SPW.data) {
    box.innerHTML = '<div class="spw-empty">正在加载怪物刷怪数据…</div>';
    return;
  }
  const q = SPW.monsterFilter.trim().toLowerCase();
  const list = SPW.data.monsters.filter((m) => !q || m.name.toLowerCase().includes(q));
  const rows = list.slice(0, SPW_ROW_LIMIT).map((m) => {
    const flags = [];
    if (!m.exists) flags.push(spwBadge('不在 Monster.DB', 'bad'));
    if (!m.drop) flags.push(spwBadge('无爆率', 'warn'));
    if (!flags.length) flags.push('<span class="muted">正常</span>');
    return '<tr class="' + (!m.exists || !m.drop ? 'spw-row-bad' : '') + '">' +
      '<td><button class="btn btn-sm ghost" data-spw-act="monster" data-name="' + spwEsc(m.name) + '">' +
      spwEsc(m.name) + '</button></td>' +
      '<td>' + flags.join(' ') + '</td>' +
      '<td>' + (m.exactDrop ? '有' : (m.drop ? '按变体' : '无')) + '</td>' +
      '<td>' + m.spawns + '</td>' +
      '<td>' + m.maps + '</td>' +
      '<td>' + m.total + '</td>' +
      '</tr>';
  });
  const table = '<div class="spw-table-wrap"><table class="spw-table"><thead><tr>' +
    '<th>怪物</th><th>状态</th><th>爆率</th><th>刷怪行</th><th>地图数</th><th>总数量</th>' +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  const note = list.length > SPW_ROW_LIMIT
    ? '共 ' + list.length + ' 种怪物，当前显示前 ' + SPW_ROW_LIMIT + ' 种；可输入关键词缩小范围。'
    : '共 ' + list.length + ' 种刷怪怪物；点击怪物名打开怪物工作台「刷怪点」。';
  box.innerHTML = '<div class="spw-groups-hint">' + spwEsc(note) + '</div>' + table;
}

function spwIssueGroup(issue) {
  const view = issue.action && issue.action.view;
  if (view === 'map') return '地图刷怪';
  if (view === 'monster') return '怪物配置';
  if (view === 'entry') return '刷怪行';
  return '总览';
}

function spwIssueRow(issue) {
  const sev = issue.severity || 'info';
  const label = SPW_ISSUE_LABEL[issue.code] || issue.code;
  const where = issue.file ? issue.file + (issue.line != null ? ':' + issue.line : '') : '';
  const idx = SPW.data ? SPW.data.issues.indexOf(issue) : -1;
  const jump = issue.action && idx >= 0
    ? '<button class="btn btn-sm ghost" data-spw-act="issue" data-spw-issue="' + idx + '">查看</button>'
    : '';
  return '<div class="mon-issue spw-issue">' +
    '<span class="mon-sev ' + sev + '">' + spwEsc(SPW_SEV[sev] || sev) + '</span>' +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + spwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + spwEsc(label) + (where ? ' · ' + spwEsc(where) : '') + '</div></div>' +
    jump + '</div>';
}

function spwRenderHealth() {
  const box = spwEl('spwHealthList');
  if (!box) return;
  if (!SPW.data) {
    box.innerHTML = '<div class="spw-empty">正在加载体检数据…</div>';
    return;
  }
  const issues = SPW.data.issues;
  if (!issues.length) {
    box.innerHTML = '<div class="spw-empty">没有发现刷怪配置问题。</div>';
    return;
  }
  const groups = {};
  for (const issue of issues) {
    const g = spwIssueGroup(issue);
    if (!groups[g]) groups[g] = [];
    groups[g].push(issue);
  }
  const order = ['地图刷怪', '怪物配置', '刷怪行', '总览'];
  let html = '';
  for (const g of order) {
    const list = groups[g];
    if (!list || !list.length) continue;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const i of list) counts[i.severity] = (counts[i.severity] || 0) + 1;
    html += '<div class="mon-issue-group"><div class="mon-issue-head"><strong>' + spwEsc(g) + '</strong>' +
      '<span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' + counts.warn +
      ' 警告 / ' + counts.info + ' 提示</span></div>' +
      list.map((i) => spwIssueRow(i)).join('') + '</div>';
  }
  box.innerHTML = html;
}

function spwRenderAll() {
  spwRenderMeta();
  spwRenderTabs();
  spwRenderList();
  spwRenderDetail();
  spwRenderMonsters();
  spwRenderHealth();
}

async function spwSelectMap(key) {
  if (!key) return;
  SPW.key = key;
  SPW.detail = null;
  SPW.tab = 'maps';
  spwRenderTabs();
  spwRenderList();
  spwRenderDetail();
  try {
    await spwLoadDetail(key);
  } catch (e) {
    return;
  }
  spwSetHash({ tab: 'maps', key });
  const row = document.querySelector('#spwList [data-spw-key="' + spwCssEsc(key) + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function spwCssEsc(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

async function spwGotoMonster(name) {
  if (!window.openMonsterWorkbench || !name) return;
  await window.openMonsterWorkbench(name);
  const tab = document.querySelector('#monTabs [data-mon-tab="spawn"]');
  if (tab) tab.click();
}

async function spwGotoEntry(index, map) {
  if (typeof window.openMongenAt !== 'function') {
    toast('刷怪配置编辑器不可用', 'err');
    return;
  }
  await window.openMongenAt(Number(index), map);
}

async function spwGotoMap(key) {
  if (!key) return;
  if (S.mode !== 'spawns' && window.openSpawnView) await window.openSpawnView({ tab: 'maps', key });
  else await spwSelectMap(key);
}

async function spwJumpIssue(issue) {
  if (!issue || !issue.action) return;
  const a = issue.action;
  if (a.view === 'map') {
    await spwGotoMap(a.key);
  } else if (a.view === 'monster') {
    await spwGotoMonster(a.name);
  } else if (a.view === 'entry') {
    await spwGotoEntry(a.index, a.map);
  } else if (a.view === 'tab') {
    SPW.tab = 'maps';
    spwRenderTabs();
    spwRenderDetail();
    spwSetHash({ tab: 'maps' });
  }
}

async function openSpawnView(sel) {
  if (S.mode !== 'spawns' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'spawns';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  if (window.hideItemWorkView) window.hideItemWorkView();
  if (window.hideGrowthView) window.hideGrowthView();
  if (window.hideDropWorkView) window.hideDropWorkView();
  if (window.hideMapWorkView) window.hideMapWorkView();
  if (window.hideShopWorkView) window.hideShopWorkView();
  if (window.hideScriptWorkView) window.hideScriptWorkView();
  if (window.hideCastleWorkView) window.hideCastleWorkView();
    if (window.hideTextWorkView) window.hideTextWorkView();
  const dbView = spwEl('dbView');
  const dropView = spwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = spwEl('spawnWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('spw');
  const target = sel || spwHashState() || { tab: SPW.tab };
  if (target.tab && SPW_TAB_KEYS.indexOf(target.tab) >= 0) SPW.tab = target.tab;
  if (target.key) SPW.key = target.key;
  spwRenderAll();
  if (!SPW.data || SPW.stale) {
    try {
      await spwLoad();
      spwRenderAll();
    } catch (e) {
      spwRenderAll();
      toast('加载刷怪数据失败：' + e.message, 'err');
      return;
    }
  }
  spwRenderAll();
  if (SPW.tab === 'maps' && SPW.key) {
    await spwSelectMap(SPW.key);
  } else if (SPW.tab === 'monsters') {
    spwSetHash({ tab: 'monsters' });
  } else if (SPW.tab === 'health') {
    spwSetHash({ tab: 'health' });
  } else {
    spwSetHash({ tab: 'maps' });
  }
}

window.openSpawnView = openSpawnView;
window.hideSpawnWorkView = () => {
  const view = spwEl('spawnWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && spwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshSpawnWorkState = (st) => {
  const info = st && st.configs ? st.configs.spawnwork : null;
  if (info && info.maps != null) spwText('spawnWorkCount', String(info.maps));
  SPW.stale = true;
  if (S.mode === 'spawns') spwRenderMeta();
};
window.updateSpawnWorkMeta = spwRenderMeta;

function spwBindEvents() {
  const filter = spwEl('spwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(SPW.searchTimer);
      SPW.searchTimer = setTimeout(() => {
        SPW.filter = filter.value;
        spwRenderList();
      }, 150);
    });
  }
  document.querySelectorAll('#spwFlagFilter [data-spw-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      SPW.flag = btn.dataset.spwFlag;
      document.querySelectorAll('#spwFlagFilter [data-spw-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      spwRenderList();
    });
  });
  const list = spwEl('spwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-spw-key]');
      if (!li) return;
      spwSelectMap(li.dataset.spwKey);
    });
  }
  const tabs = spwEl('spwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-spw-tab]');
      if (!btn) return;
      spwSelectTab(btn.dataset.spwTab);
    });
  }
  const monsterFilter = spwEl('spwMonsterFilter');
  if (monsterFilter) {
    monsterFilter.addEventListener('input', () => {
      clearTimeout(SPW.monsterTimer);
      SPW.monsterTimer = setTimeout(() => {
        SPW.monsterFilter = monsterFilter.value;
        spwRenderMonsters();
      }, 150);
    });
  }
  const main = spwEl('spawnWorkView');
  if (main) {
    main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-spw-act]');
      if (!btn) return;
      const act = btn.dataset.spwAct;
      if (act === 'monster') spwGotoMonster(btn.dataset.name);
      else if (act === 'entry') spwGotoEntry(Number(btn.dataset.index), btn.dataset.map);
      else if (act === 'issue' && SPW.data && SPW.data.issues[Number(btn.dataset.spwIssue)]) {
        spwJumpIssue(SPW.data.issues[Number(btn.dataset.spwIssue)]);
      }
    });
  }
  const reload = spwEl('btnSpwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        SPW.stale = true;
        SPW.detail = null;
        await spwLoad(true);
        spwRenderAll();
        if (SPW.key) await spwSelectMap(SPW.key);
        toast('刷怪数据已重新检查', 'ok');
      } catch (e) {
        spwRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const state = spwHashState();
    if (state) openSpawnView(state);
  });
}

spwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = spwHashState();
    if (state) openSpawnView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = spwHashState();
    if (state) openSpawnView(state);
  });
}

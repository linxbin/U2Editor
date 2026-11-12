'use strict';

/* 配置健康总览：汇总十个工作台体检结果，筛选、搜索并跳转定位（只读） */

const HW = {
  data: null,
  loading: false,
  stale: true,
  source: 'all',
  severity: 'all',
  q: '',
  view: []
};

const HW_SEV = { error: '错误', warn: '警告', info: '提示' };

const HW_ISSUE_LABEL = {
  item_drop_unknown_monster: '爆率怪物缺失',
  item_name_duplicate: '物品重名',
  item_ref_missing: '引用缺失物品',
  item_desc_missing: '物品缺描述',
  item_no_source: '物品无产出',
  drop_item_missing: '掉落物品缺失',
  drop_prob_negative: '掉落概率为负',
  drop_file_empty: '爆率文件为空',
  drop_file_orphan: '爆率文件孤立',
  drop_monster_no_file: '怪物无爆率文件',
  spawn_coord_over: '刷怪坐标越界',
  spawn_map_file_missing: '刷怪地图缺文件',
  spawn_map_unknown: '刷怪地图未登记',
  spawn_monster_missing: '刷怪怪物缺失',
  spawn_duplicate: '重复刷怪点',
  spawn_extra: '刷怪多余参数',
  spawn_line_invalid: '刷怪行无法解析',
  spawn_monster_no_drop: '怪物无爆率',
  map_rule_coord_over: 'MapInfo 坐标越界',
  map_spawn_coord_over: '刷怪坐标越界',
  map_unknown: '地图未登记',
  map_file_orphan: '地图文件孤立',
  map_rule_unparsed: 'MapInfo 行无法解析',
  shop_mall_id_duplicate: '商城 ID 重复',
  shop_mall_empty_sub: '商城空子类',
  script_missing: '脚本文件缺失',
  script_orphan: '脚本未被引用',
  guild_empty: '行会数据为空',
  war_empty: '攻城数据为空',
  checknum_map_missing: '地图验证缺失',
  text_placeholder: '文案占位符',
  gift_level_empty: '礼包档位为空',
  queue_name_duplicate: '充值队列同名',
  queue_zero_byte: '充值队列空文件',
  growth_class_exp_plateau: '经验封顶',
  growth_class_length: '职业表长度不一致',
  growth_magic_id_gap: '技能 ID 不连续',
  growth_pet_exp_plateau: '宠物经验封顶',
  growth_upgrade_level_gap: '升级档位缺失'
};

function hwEl(id) {
  return document.getElementById(id);
}

function hwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function hwText(id, text) {
  const el = hwEl(id);
  if (el) el.textContent = text;
}

function hwBadge(text, cls) {
  return '<span class="mon-sev ' + hwEsc(cls) + '">' + hwEsc(text) + '</span>';
}

function hwHashState() {
  const m = /^#healthwork(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  let raw = m[1] || '';
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
  }
  const state = { source: 'all', severity: 'all' };
  for (const part of raw.split('|')) {
    if (part.startsWith('source-')) state.source = part.slice(7) || 'all';
    else if (/^(error|warn|info)$/.test(part)) state.severity = part;
  }
  return state;
}

function hwSetHash(state, force) {
  const parts = [];
  if (state && state.source && state.source !== 'all') parts.push('source-' + state.source);
  if (state && state.severity && state.severity !== 'all') parts.push(state.severity);
  const raw = parts.join('|');
  const next = raw ? '#healthwork=' + raw : '#healthwork';
  if (!force && next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function hwLoad(refresh) {
  if (HW.loading) return;
  HW.loading = true;
  hwRenderMeta();
  try {
    const data = await api('/api/config/healthwork' + (refresh ? '?refresh=1' : ''));
    HW.data = data;
    HW.stale = false;
    hwText('healthWorkCount', String(data.stats.total));
    hwRenderAll();
  } finally {
    HW.loading = false;
  }
}

function hwRenderMeta() {
  const meta = hwEl('hwMeta');
  if (!meta) return;
  if (!HW.data) {
    meta.textContent = HW.loading ? '正在汇总各工作台体检…' : '';
    return;
  }
  const s = HW.data.stats;
  const parts = [
    '汇总 ' + s.workbenches + ' 个工作台',
    s.error + ' 错误 / ' + s.warn + ' 警告 / ' + s.info + ' 提示',
    '共 ' + s.total + ' 条'
  ];
  const active = HW.source !== 'all' ? HW.data.sources.find((src) => src.key === HW.source) : null;
  if (active) parts.push('工作台：' + active.label);
  if (HW.severity !== 'all') parts.push('只看' + (HW_SEV[HW.severity] || HW.severity));
  meta.textContent = parts.join(' · ');
}

function hwFiltered() {
  if (!HW.data) return [];
  const q = HW.q.trim().toLowerCase();
  return HW.data.issues.filter((issue) => {
    if (HW.source !== 'all' && issue.source !== HW.source) return false;
    if (HW.severity !== 'all' && issue.severity !== HW.severity) return false;
    if (!q) return true;
    const hay = [
      issue.message,
      issue.code,
      issue.sourceLabel,
      issue.file,
      issue.scope,
      HW_ISSUE_LABEL[issue.code] || ''
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function hwRenderSummary() {
  const el = hwEl('hwSummary');
  if (!el) return;
  if (!HW.data) {
    el.innerHTML = '';
    return;
  }
  const s = HW.data.stats;
  const cards = [
    { label: '错误', cls: 'error', value: s.error },
    { label: '警告', cls: 'warn', value: s.warn },
    { label: '提示', cls: 'info', value: s.info },
    { label: '问题总数', cls: '', value: s.total }
  ];
  el.innerHTML = '<div class="act-cards hw-cards">' + cards.map((c) =>
    '<div class="act-card"><div class="act-card-head"><strong>' + hwEsc(c.label) + '</strong>' +
    (c.cls ? hwBadge(HW_SEV[c.cls], c.cls) : '') + '</div>' +
    '<div class="hw-num">' + c.value + '</div></div>').join('') + '</div>';
}

function hwRenderSources() {
  const table = hwEl('hwSourceTable');
  if (table && HW.data) {
    const s = HW.data.stats;
    const rows = HW.data.sources.map((src) =>
      '<tr><td><button class="tsk-link" data-hw-issue-source="' + hwEsc(src.key) + '">' +
      hwEsc(src.label) + '</button>' + (src.errorMessage ? ' <span class="fmeta err">读取失败</span>' : '') + '</td>' +
      '<td>' + src.error + '</td><td>' + src.warn + '</td><td>' + src.info + '</td><td>' + src.total + '</td></tr>').join('');
    table.innerHTML = '<div class="tsk-section-head"><h4>按工作台汇总</h4><span class="tsk-empty">' +
      s.workbenches + ' 个工作台</span></div>' +
      '<table class="tsk-table"><thead><tr><th>工作台</th><th>错误</th><th>警告</th><th>提示</th><th>合计</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  } else if (table) {
    table.innerHTML = '';
  }

  const list = hwEl('hwSourceList');
  if (list) {
    hwClear(list);
    if (!HW.data) return;
    const addItem = (key, label, count, sub) => {
      const li = document.createElement('li');
      li.className = 'file-item' + (HW.source === key ? ' active' : '');
      li.dataset.hwSource = key;
      const name = document.createElement('div');
      name.className = 'fname';
      name.textContent = label;
      const meta = document.createElement('div');
      meta.className = 'fmeta' + (count && key !== 'all' ? ' err' : '');
      meta.textContent = sub;
      li.appendChild(name);
      li.appendChild(meta);
      list.appendChild(li);
    };
    addItem('all', '全部工作台', 0, HW.data.stats.total + ' 条问题');
    for (const src of HW.data.sources) {
      addItem(src.key, src.label, src.total,
        src.error + ' 错误 / ' + src.warn + ' 警告 / ' + src.info + ' 提示');
    }
  }
}

function hwIssueRow(issue, index) {
  const loc = [];
  if (issue.file) loc.push(issue.file + (issue.line ? ' 第 ' + issue.line + ' 行' : ''));
  if (issue.scope) loc.push(issue.scope);
  const label = HW_ISSUE_LABEL[issue.code] || issue.code || '配置问题';
  return '<div class="mon-issue mpw-issue">' +
    hwBadge(HW_SEV[issue.severity] || issue.severity, issue.severity) +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + hwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + hwEsc(issue.sourceLabel) + ' · ' + hwEsc(label) +
    (loc.length ? ' · ' + hwEsc(loc.join(' · ')) : '') + '</div></div>' +
    '<button class="btn btn-sm" data-hw-jump="' + index + '">定位</button></div>';
}

function hwRenderIssues() {
  const el = hwEl('hwIssueList');
  if (!el) return;
  if (!HW.data) {
    el.innerHTML = '<div class="mpw-empty">正在读取配置体检结果…</div>';
    return;
  }
  HW.view = hwFiltered();
  if (!HW.view.length) {
    el.innerHTML = '<div class="mpw-empty">没有符合当前筛选条件的问题。</div>';
    return;
  }
  el.innerHTML = HW.view.map((issue, i) => hwIssueRow(issue, i)).join('');
  hwText('hwListHint', HW.view.length + ' / ' + HW.data.issues.length + ' 条');
  hwText('hwViewHint', HW.view.length + ' / ' + HW.data.issues.length + ' 条');
}

function hwRenderTabs() {
  const filter = hwEl('hwSeverityFilter');
  if (filter) {
    for (const btn of filter.querySelectorAll('[data-hw-severity]')) {
      btn.classList.toggle('active', btn.dataset.hwSeverity === HW.severity);
    }
  }
}

function hwRenderAll() {
  hwRenderMeta();
  hwRenderSummary();
  hwRenderSources();
  hwRenderTabs();
  hwRenderIssues();
  hwText('hwAllCount', HW.data ? String(HW.data.stats.total) : '0');
  if (HW.data) {
    hwText('hwErrorCount', String(HW.data.stats.error));
    hwText('hwWarnCount', String(HW.data.stats.warn));
    hwText('hwInfoCount', String(HW.data.stats.info));
  }
}

function hwSelectSource(source) {
  HW.source = source || 'all';
  hwRenderSources();
  hwRenderIssues();
  hwSetHash({ source: HW.source, severity: HW.severity });
}

function hwSelectSeverity(severity) {
  HW.severity = severity || 'all';
  hwRenderTabs();
  hwRenderIssues();
  hwSetHash({ source: HW.source, severity: HW.severity });
}

async function hwOpenMonster(name, tab) {
  if (!name || typeof window.openMonsterWorkbench !== 'function') return;
  await window.openMonsterWorkbench(name);
  const btn = document.querySelector('#monTabs [data-mon-tab="' + (tab || 'drop') + '"]');
  if (btn) btn.click();
}

async function hwJump(issue) {
  if (!issue) return;
  const a = issue.action || {};
  const source = issue.source;
  if (source === 'itemwork') {
    if (a.view === 'monster' && a.name) return hwOpenMonster(a.name, 'drop');
    if (a.view === 'shop' && a.search && window.openShopsConfig) {
      await window.openShopsConfig();
      const input = hwEl('shopSearch');
      if (input) {
        input.value = a.search;
        input.dispatchEvent(new Event('input'));
      }
      return;
    }
    if (a.view === 'task' && a.id != null && window.openTaskView) return window.openTaskView(undefined, Number(a.id));
    if (a.view === 'make' && window.openMakeitem) return window.openMakeitem();
    if (a.view === 'goods' && window.openGoodsConfig) return window.openGoodsConfig();
    if (a.view === 'mall' && window.openMallConfig) return window.openMallConfig();
    if (window.openItemWorkView) return window.openItemWorkView(issue.index == null ? undefined : Number(issue.index));
    return;
  }
  if (source === 'growth') {
    let sel = { tab: 'health' };
    if (a.view === 'magic') sel = { tab: 'skills', skillId: a.id };
    else if (a.view === 'class') sel = { tab: 'classes', classKey: a.key };
    else if (a.view === 'upgrade') sel = { tab: 'upgrades', upgradeLevel: a.level };
    else if (a.view === 'pet') sel = { tab: 'pets', petKey: a.key };
    if (window.openGrowthView) return window.openGrowthView(sel);
    return;
  }
  if (source === 'dropwork') {
    if (a.view === 'monster' && a.name) return hwOpenMonster(a.name, 'drop');
    if (a.view === 'item' && a.key && window.openDropsView) return window.openDropsView({ tab: 'items', key: a.key });
    if (window.openDropsView) {
      await window.openDropsView();
      if (typeof window.dpwJumpIssue === 'function') return window.dpwJumpIssue(issue);
    }
    return;
  }
  if (source === 'spawnwork') {
    if (a.view === 'monster' && a.name) return hwOpenMonster(a.name, 'spawn');
    if (a.view === 'map' && a.key && window.openSpawnView) return window.openSpawnView({ tab: 'maps', key: a.key });
    if (a.view === 'entry' && typeof window.openMongenAt === 'function') {
      return window.openMongenAt(Number(a.index), a.map);
    }
    if (window.openSpawnView) return window.openSpawnView({ tab: 'health' });
    return;
  }
  if (source === 'mapwork') {
    if (a.view === 'map' && a.key && window.openMapView) return window.openMapView({ tab: 'detail', key: a.key });
    if (a.view === 'npc' && window.openNpcWorkView) return window.openNpcWorkView(Number(a.index));
    if (a.view === 'spawn' && typeof window.openMongenAt === 'function') {
      return window.openMongenAt(Number(a.index), a.map || a.key);
    }
    if (a.view === 'rule' && typeof window.openMapinfoAt === 'function') {
      return window.openMapinfoAt(a.key, a.section);
    }
    if (window.openMapView) return window.openMapView({ tab: 'health', key: a.key });
    return;
  }
  if (source === 'shopwork') {
    if (a.view && a.index != null && window.openShopView) {
      return window.openShopView({ tab: 'detail', source: a.view, index: Number(a.index) });
    }
    if (window.openShopView) return window.openShopView({ tab: 'health' });
    return;
  }
  if (source === 'scriptwork') {
    if (a.view === 'script' && a.name && window.openScriptView) {
      return window.openScriptView({ tab: 'detail', name: a.name, line: issue.line });
    }
    if (a.view === 'npc' && window.openNpcWorkView) return window.openNpcWorkView(Number(a.index));
    if (window.openScriptView) return window.openScriptView({ tab: 'health' });
    return;
  }
  if (source === 'castlework') {
    if (a.view === 'section' && a.section && window.openCastleView) {
      return window.openCastleView({ tab: 'detail', section: a.section });
    }
    if (window.openCastleView) return window.openCastleView({ tab: 'health' });
    return;
  }
  if (source === 'textwork') {
    if (a.view === 'entry' && window.openTextWorkView) {
      return window.openTextWorkView({ tab: 'detail', source: a.source, index: Number(a.index) });
    }
    if (window.openTextWorkView) return window.openTextWorkView({ tab: a.view === 'editor' ? 'detail' : 'health', source: a.source });
    return;
  }
  if (source === 'starterwork') {
    if (a.view === 'entry' && window.openStarterWorkView) {
      return window.openStarterWorkView({ tab: 'detail', source: a.source, index: Number(a.index) });
    }
    if (window.openStarterWorkView) return window.openStarterWorkView({ tab: 'detail', source: a.source });
  }
}

async function openHealthWorkView(sel) {
  if (S.mode !== 'healthwork' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'healthwork';
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
  const dbView = hwEl('dbView');
  const dropView = hwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = hwEl('healthWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('hw');
  const target = sel || hwHashState() || { source: HW.source, severity: HW.severity };
  if (sel) {
    HW.q = '';
    const query = hwEl('hwQuery');
    if (query) query.value = '';
  }
  HW.source = target.source || 'all';
  HW.severity = target.severity || 'all';
  hwRenderAll();
  if (!HW.data || HW.stale) {
    try {
      await hwLoad(false);
    } catch (e) {
      hwRenderAll();
      toast('加载配置健康总览失败：' + e.message, 'err');
      return;
    }
  }
  hwRenderAll();
  hwSetHash({ source: HW.source, severity: HW.severity });
}

function updateHealthWorkMeta() {
  hwRenderMeta();
}

function refreshHealthWorkState(st) {
  const summary = st && st.configs && st.configs.healthwork;
  if (summary && summary.stats) {
    hwText('healthWorkCount', String(summary.stats.total || 0));
  }
  HW.stale = true;
}

function hideHealthWorkView() {
  const view = hwEl('healthWorkView');
  if (view) view.classList.add('hidden');
}

window.openHealthWorkView = openHealthWorkView;
window.hideHealthWorkView = hideHealthWorkView;
window.updateHealthWorkMeta = updateHealthWorkMeta;
window.refreshHealthWorkState = refreshHealthWorkState;

document.addEventListener('DOMContentLoaded', () => {
  const side = hwEl('hwSourceList');
  if (side) {
    side.addEventListener('click', (e) => {
      const item = e.target.closest('[data-hw-source]');
      if (!item) return;
      hwSelectSource(item.dataset.hwSource);
    });
  }
  const sev = hwEl('hwSeverityFilter');
  if (sev) {
    sev.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hw-severity]');
      if (!btn) return;
      hwSelectSeverity(btn.dataset.hwSeverity);
    });
  }
  const search = hwEl('btnHwSearch');
  if (search) {
    search.addEventListener('click', () => {
      HW.q = hwEl('hwQuery') ? hwEl('hwQuery').value : '';
      hwRenderIssues();
    });
  }
  const clear = hwEl('btnHwClear');
  if (clear) {
    clear.addEventListener('click', () => {
      HW.q = '';
      if (hwEl('hwQuery')) hwEl('hwQuery').value = '';
      hwRenderIssues();
    });
  }
  const query = hwEl('hwQuery');
  if (query) {
    query.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      HW.q = query.value;
      hwRenderIssues();
    });
  }
  const reload = hwEl('btnHwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      try {
        await hwLoad(true);
        toast('已重新检查全部工作台', 'ok');
      } catch (e) {
        toast('重新检查失败：' + e.message, 'err');
      }
    });
  }
  const table = hwEl('hwSourceTable');
  if (table) {
    table.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hw-issue-source]');
      if (!btn) return;
      hwSelectSource(btn.dataset.hwIssueSource);
    });
  }
  const issues = hwEl('hwIssueList');
  if (issues) {
    issues.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hw-jump]');
      if (!btn) return;
      const issue = HW.view[Number(btn.dataset.hwJump)];
      if (issue) hwJump(issue);
    });
  }
  window.addEventListener('hashchange', () => {
    const state = hwHashState();
    if (state) openHealthWorkView(state);
  });
  const initial = hwHashState();
  if (initial) openHealthWorkView(initial);
});

'use strict';

/* 元神工作台：只读汇总，定位到参数、NPC、物品、掉落与脚本 */

const YSW = {
  data: null,
  loading: false,
  stale: true,
  q: '',
  section: 'all'
};

const YSW_SECTIONS = [
  { key: 'all', label: '总览' },
  { key: 'params', label: '元神参数' },
  { key: 'entry', label: '创建入口' },
  { key: 'items', label: '元神物品' },
  { key: 'drops', label: '掉落引用' },
  { key: 'scripts', label: '脚本引用' },
  { key: 'notes', label: '注意事项' }
];

function yswEl(id) {
  return document.getElementById(id);
}

function yswEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function yswBadge(text, cls) {
  return '<span class="mon-sev ' + yswEsc(cls) + '">' + yswEsc(text) + '</span>';
}

function yswBtn(label, kind, val, line) {
  return '<button class="btn small" data-ysw-kind="' + yswEsc(kind) +
    '" data-ysw-val="' + yswEsc(val == null ? '' : val) +
    '" data-ysw-line="' + (line == null ? '' : Number(line)) + '">' + yswEsc(label) + '</button>';
}

function yswSection(title, id, hint, body) {
  return '<div class="tsk-section" id="yswSec-' + id + '">' +
    '<div class="tsk-section-head"><h4>' + yswEsc(title) + '</h4>' +
    (hint ? '<span class="tsk-empty">' + yswEsc(hint) + '</span>' : '') + '</div>' +
    (body || '<div class="mpw-empty">没有相关数据。</div>') + '</div>';
}

function yswMatches(text) {
  const q = YSW.q.trim().toLowerCase();
  if (!q) return true;
  return String(text == null ? '' : text).toLowerCase().includes(q);
}

function yswRenderSummary(d) {
  const box = yswEl('yswSummary');
  if (!box) return;
  const st = d.status;
  const entry = st.entryOpen
    ? (st.level != null && st.level > 200 ? '入口在但不可达' : '开启')
    : '关闭';
  const cards = [
    { label: '创建等级门槛', value: st.level == null ? '—' : st.level },
    { label: '入口状态', value: entry },
    { label: '元神相关物品', value: st.items },
    { label: '掉落引用', value: st.drops },
    { label: '引用脚本', value: st.scripts }
  ];
  let hint = '';
  if (d.server.name) hint = '当前区：' + d.server.name + (d.server.index !== '' ? '（索引 ' + d.server.index + '）' : '');
  if (st.level == null) {
    hint += (hint ? ' · ' : '') + '未读取到 ShadowLevel 参数';
  } else if (st.entryOpen && st.level <= 200) {
    hint += (hint ? ' · ' : '') + '玩家达到 ' + st.level + ' 级后可通过入口 NPC 创建元神';
  } else if (st.entryOpen) {
    hint += (hint ? ' · ' : '') + 'ShadowLevel=' + st.level + '，正常玩家无法达到';
  } else {
    hint += (hint ? ' · ' : '') + '当前没有可触发的创建入口';
  }
  box.innerHTML = '<div class="act-cards hw-cards">' + cards.map((c) =>
    '<div class="act-card"><div class="act-card-head"><strong>' + yswEsc(c.label) + '</strong></div>' +
    '<div class="hw-num">' + yswEsc(c.value) + '</div></div>').join('') + '</div>' +
    '<div class="side-note" style="margin:8px 2px 0;">' + yswEsc(hint) + '</div>';
}

function yswTable(headers, rows) {
  if (!rows.length) return '<div class="mpw-empty">没有相关数据。</div>';
  return '<table class="tsk-table"><thead><tr>' +
    headers.map((h) => '<th>' + yswEsc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
}

function yswRenderParams(d) {
  const p = d.params;
  let body;
  if (p.error) body = '<div class="mpw-empty">读取 globeparams.txt 失败：' + yswEsc(p.error) + '</div>';
  else {
    const rows = p.rows.filter((r) => yswMatches(r.key) || yswMatches(r.comment)).map((r) =>
      '<tr><td>' + yswEsc(r.key) + '</td><td>' + yswEsc(r.value) + '</td>' +
      '<td>' + yswEsc(p.file) + ' 第 ' + r.line + ' 行</td>' +
      '<td>' + yswEsc(r.comment || '—') + '</td>' +
      '<td>' + yswBtn('定位', 'param', r.key, r.line) + '</td></tr>');
    body = yswTable(['参数', '当前值', '位置', '说明', '操作'], rows);
  }
  return yswSection('元神参数', 'params', p.rows.length + ' 个参数', body);
}

function yswRenderEntry(d) {
  const rows = [];
  for (const npc of d.npcs) {
    const where = npc.mapName ? npc.mapName + '(' + npc.map + ')' : npc.map;
    rows.push('<tr><td>入口 NPC</td><td>' + yswEsc(npc.name) + ' <span class="fmeta">' + yswEsc(npc.id) + '</span></td>' +
      '<td>' + yswEsc(npc.script) + '</td>' +
      '<td>' + yswEsc(where) + ' ' + npc.x + ',' + npc.y + ' · 第 ' + npc.line + ' 行</td>' +
      '<td>' + yswBadge('启用', 'info') + '</td>' +
      '<td>' + yswBtn('定位 NPC', 'npc', npc.index) + '</td></tr>');
  }
  for (const c of d.commentedNpcs) {
    rows.push('<tr><td>入口 NPC</td><td>' + yswEsc(c.text) + '</td>' +
      '<td>' + yswEsc(c.script) + '</td><td>NPCList.txt 第 ' + c.line + ' 行</td>' +
      '<td>' + yswBadge('已注释', 'warn') + '</td><td>—</td></tr>');
  }
  for (const s of d.createSites) {
    rows.push('<tr><td>创建调用</td><td>' + yswEsc(s.func || 'user.createShadow') + '</td>' +
      '<td>' + yswEsc(s.name) + '</td><td>第 ' + s.line + ' 行</td>' +
      '<td><span class="fmeta">' + yswEsc(s.code) + '</span></td>' +
      '<td>' + yswBtn('定位脚本', 'script', s.name, s.line) + '</td></tr>');
  }
  const filtered = rows.length ? rows : [];
  return yswSection('创建入口', 'entry',
    d.npcs.length + ' 个启用 NPC · ' + d.commentedNpcs.length + ' 条注释 · ' + d.createSites.length + ' 处创建调用',
    yswTable(['类型', '对象', '脚本', '位置', '状态', '操作'], filtered));
}

function yswItemSource(it) {
  const parts = [];
  if (it.drops) parts.push('掉落 ' + it.drops);
  if (it.shops) parts.push('商店 ' + it.shops);
  if (it.tasks) parts.push('任务 ' + it.tasks);
  if (it.recipes) parts.push('配方 ' + it.recipes);
  if (it.goods) parts.push('商城 ' + it.goods);
  if (it.mall) parts.push('元宝商城 ' + it.mall);
  return parts.length ? parts.join(' · ') : '无来源引用';
}

function yswRenderItems(d) {
  const rows = d.items.filter((it) => yswMatches(it.name) || yswMatches(it.type)).map((it) =>
    '<tr><td>' + yswEsc(it.name) + ' <span class="fmeta">#' + it.index + '</span></td>' +
    '<td>' + yswEsc(it.type) + ' <span class="fmeta">' + it.stdmode + '</span></td>' +
    '<td>' + yswEsc(yswItemSource(it)) + '</td>' +
    '<td>' + yswBtn('物品', 'item', it.index) +
    (it.drops ? ' ' + yswBtn('掉落', 'drop', it.name) : '') + '</td></tr>');
  return yswSection('元神物品', 'items', d.items.length + ' 件', yswTable(['物品', '类型', '来源', '操作'], rows));
}

function yswRenderDrops(d) {
  const rows = d.dropRows
    .filter((r) => yswMatches(r.item) || yswMatches(r.monster) || yswMatches(r.file))
    .map((r) =>
      '<tr><td>' + yswEsc(r.monster) + (r.monsterKnown ? '' : ' <span class="fmeta">未登记</span>') + '</td>' +
      '<td>' + yswEsc(r.file) + '</td><td>' + r.line + '</td><td>' + yswEsc(r.item) + '</td>' +
      '<td>' + (r.monsterKnown ? yswBtn('爆率', 'monster', r.monster) : yswBtn('掉落', 'drop', r.item)) + '</td></tr>');
  return yswSection('掉落引用', 'drops', d.dropRows.length + ' 处', yswTable(['怪物', '文件', '行', '物品', '操作'], rows));
}

function yswRenderScripts(d) {
  const rows = d.scripts.filter((s) => yswMatches(s.name)).map((s) =>
    '<tr><td>' + yswEsc(s.name) + '</td><td>' + s.refs + '</td><td>' + s.creates + '</td>' +
    '<td>' + yswBtn('定位脚本', 'script', s.name, s.firstLine) + '</td></tr>');
  return yswSection('脚本引用', 'scripts', d.scripts.length + ' 个脚本', yswTable(['脚本', '引用行', '创建点', '操作'], rows));
}

function yswRenderNotes(d) {
  if (!d.notes.length) return yswSection('注意事项', 'notes', '0 条', '<div class="mpw-empty">没有需要说明的事项。</div>');
  const body = d.notes.map((n) =>
    '<div class="mon-issue mpw-issue">' + yswBadge(n.tag || '说明', 'info') +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + yswEsc(n.text) + '</div></div></div>').join('');
  return yswSection('注意事项', 'notes', d.notes.length + ' 条', '<div class="mon-issues">' + body + '</div>');
}

function yswRenderNav(d) {
  const list = yswEl('yswNavList');
  if (!list) return;
  const counts = {
    all: null,
    params: d.params.rows.length,
    entry: d.npcs.length + d.commentedNpcs.length + d.createSites.length,
    items: d.items.length,
    drops: d.dropRows.length,
    scripts: d.scripts.length,
    notes: d.notes.length
  };
  list.innerHTML = YSW_SECTIONS.map((s) =>
    '<li class="file-item' + (YSW.section === s.key ? ' active' : '') + '" data-ysw-section="' + s.key + '">' +
    '<div class="fname">' + yswEsc(s.label) + '</div>' +
    '<div class="fmeta">' + (counts[s.key] == null ? '' : counts[s.key] + ' 项') + '</div></li>').join('');
}

function yswRender() {
  const d = YSW.data;
  if (!d) return;
  yswRenderSummary(d);
  const box = yswEl('yswContent');
  if (!box) return;
  const parts = {
    params: () => yswRenderParams(d),
    entry: () => yswRenderEntry(d),
    items: () => yswRenderItems(d),
    drops: () => yswRenderDrops(d),
    scripts: () => yswRenderScripts(d),
    notes: () => yswRenderNotes(d)
  };
  const showAll = !!YSW.q.trim() || YSW.section === 'all' || !parts[YSW.section];
  box.innerHTML = showAll
    ? Object.keys(parts).map((k) => parts[k]()).join('')
    : parts[YSW.section]();
  yswRenderNav(d);
  const meta = yswEl('yswMeta');
  if (meta) {
    meta.textContent = (d.server.name || '未读取区名') +
      ' · ShadowLevel ' + (d.status.level == null ? '—' : d.status.level) +
      ' · ' + d.items.length + ' 件物品 · ' + d.dropRows.length + ' 处掉落 · ' + d.scripts.length + ' 个脚本';
  }
}

async function yswLoad(refresh) {
  if (YSW.loading) return;
  YSW.loading = true;
  const meta = yswEl('yswMeta');
  if (meta) meta.textContent = '正在检查元神配置…';
  try {
    YSW.data = await api('/api/config/yswork' + (refresh ? '?refresh=1' : ''));
    YSW.stale = false;
    yswRender();
  } finally {
    YSW.loading = false;
  }
}

async function yswJump(btn) {
  const kind = btn.dataset.yswKind;
  const val = btn.dataset.yswVal || '';
  const line = btn.dataset.yswLine ? Number(btn.dataset.yswLine) : 0;
  if (!kind) return;
  if (window.hideYswView) window.hideYswView();
  if (kind === 'param') {
    if (window.openExtraKeyAt) return window.openExtraKeyAt('globeparams', { line });
    return;
  }
  if (kind === 'npc') {
    if (window.openNpcWorkView) return window.openNpcWorkView(Number(val));
    return;
  }
  if (kind === 'item') {
    if (window.openItemWorkView) return window.openItemWorkView(Number(val));
    return;
  }
  if (kind === 'drop') {
    if (window.openDropsView) return window.openDropsView({ tab: 'items', key: val });
    return;
  }
  if (kind === 'monster') {
    if (!window.openMonsterWorkbench) return;
    await window.openMonsterWorkbench(val);
    const tab = document.querySelector('#monTabs [data-mon-tab="drop"]');
    if (tab) tab.click();
    return;
  }
  if (kind === 'script') {
    if (window.openScriptView) return window.openScriptView({ tab: 'detail', name: val, line: line || undefined });
  }
}

function yswBind() {
  const filter = yswEl('yswFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      YSW.q = filter.value;
      if (YSW.data) yswRender();
    });
  }
  const nav = yswEl('yswNavList');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const item = e.target.closest('[data-ysw-section]');
      if (!item) return;
      YSW.section = item.dataset.yswSection;
      yswRender();
      const content = yswEl('yswContent');
      if (content) content.scrollIntoView({ block: 'start' });
    });
  }
  const content = yswEl('yswContent');
  if (content) {
    content.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ysw-kind]');
      if (btn) yswJump(btn).catch((err) => {
        if (typeof toast === 'function') toast('定位失败：' + err.message, 'err');
      });
    });
  }
  const reload = yswEl('btnYswReload');
  if (reload) {
    reload.addEventListener('click', () => {
      yswLoad(true).catch((e) => {
        if (typeof toast === 'function') toast('重新检查失败：' + e.message, 'err');
      });
    });
  }
}

async function openYswView() {
  if (S.mode !== 'yswork' && typeof confirmDiscard === 'function' && !(await confirmDiscard())) return;
  S.mode = 'yswork';
  if (typeof hideAllViews === 'function') hideAllViews();
  const view = yswEl('ysworkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('ysw');
  try {
    if (!YSW.data || YSW.stale) await yswLoad();
    else yswRender();
  } catch (e) {
    if (typeof toast === 'function') toast('加载元神工作台失败：' + e.message, 'err');
  }
}

window.openYswView = openYswView;
window.hideYswView = () => {
  const view = yswEl('ysworkView');
  if (view) view.classList.add('hidden');
};
window.refreshYswState = () => {
  YSW.stale = true;
};

yswBind();

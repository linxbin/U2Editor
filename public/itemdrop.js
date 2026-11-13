'use strict';

/* 物品与掉落工作台：stditems.db 物品来源（含爆率定位）+ 爆率文件与配置体检（只读） */

const ITW = {
  data: null,
  detail: null,
  selected: null,
  loading: false,
  stale: true,
  filter: '',
  type: 'all',
  flag: 'all',
  typesBuilt: false,
  searchTimer: null,
  req: 0
};

const DPW = {
  data: null,
  stale: true
};

const IDW = {
  tab: 'detail',
  loading: false,
  stale: true
};

const IDW_TABS = ['detail', 'access', 'health'];

const ITW_LIST_LIMIT = 500;
const ITW_REF_LIMIT = 300;

const ITW_SEV = { error: '错误', warn: '警告', info: '提示' };
const DPW_SEV = { error: '错误', warn: '警告', info: '提示' };

const ITW_FLAG_LABEL = {
  all: '全部',
  issues: '有异常',
  nosource: '无产出',
  nodesc: '缺描述',
  drop: '有掉落',
  shop: '有商店',
  task: '有任务'
};

const ITW_ISSUE_LABEL = {
  item_name_duplicate: '名称重复',
  item_name_empty: '名称为空',
  item_price_negative: '负价格',
  item_weight_negative: '负重量',
  item_ref_missing: '引用物品缺失',
  item_no_source: '无产出物品',
  item_desc_missing: '缺少描述',
  item_drop_invalid_line: '爆率行无法解析',
  item_drop_unknown_monster: '爆率怪物缺失',
  item_drops_unreadable: '爆率目录读取失败',
  item_shops_unreadable: '商店配置读取失败',
  item_tasks_unreadable: '任务配置读取失败',
  item_make_unreadable: '合成配置读取失败',
  item_goods_unreadable: '商城商品读取失败',
  item_mall_unreadable: '商城配置读取失败'
};

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

function idwEl(id) {
  return document.getElementById(id);
}

function idwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function idwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function idwBtn(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls || 'btn btn-sm';
  b.textContent = text;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function itwEl(id) { return idwEl(id); }
function itwEsc(value) { return idwEsc(value); }
function itwClear(el) { idwClear(el); }
function itwBtn(text, cls, onClick) { return idwBtn(text, cls, onClick); }
function itwText(id, text) { const el = idwEl(id); if (el) el.textContent = text; }

function dpwEl(id) { return idwEl(id); }
function dpwEsc(value) { return idwEsc(value); }
function dpwClear(el) { idwClear(el); }
function dpwText(id, text) { const el = idwEl(id); if (el) el.textContent = text; }

/* ---------- 哈希 ---------- */

function idwDecode(raw) {
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

function idwHashState() {
  const hash = location.hash || '';
  let m = /^#idw(?:=(.+))?$/.exec(hash);
  if (m) {
    const raw = m[1] || '';
    if (!raw) return { tab: 'detail' };
    const at = raw.indexOf('@');
    const tab = at >= 0 ? raw.slice(0, at) : raw;
    const payload = at >= 0 ? raw.slice(at + 1) : '';
    if (tab === 'drops') return payload ? { dropKey: idwDecode(payload) } : { tab: 'health' };
    if (tab === 'files') return { tab: 'health' };
    if (IDW_TABS.indexOf(tab) < 0) return { tab: 'detail' };
    if (tab === 'detail' || tab === 'access') {
      return { tab, itemIndex: /^\d+$/.test(payload) ? Number(payload) : undefined };
    }
    return { tab };
  }
  m = /^#item=(\d+)$/.exec(hash);
  if (m) return { tab: 'detail', itemIndex: Number(m[1]) };
  m = /^#drops(?:=(.+))?$/.exec(hash);
  if (m) {
    const raw = m[1] || '';
    if (!raw || raw === 'items' || raw === 'files' || raw === 'health') return { tab: 'health' };
    if (raw.startsWith('item-')) return { dropKey: idwDecode(raw.slice(5)) };
    return { tab: 'health' };
  }
  return null;
}

function idwSetHash(state) {
  if (S.mode !== 'itemdrop') return;
  const view = idwEl('itemDropView');
  if (!view || view.classList.contains('hidden')) return;
  const st = state || { tab: IDW.tab, itemIndex: ITW.selected };
  let next = '#idw';
  if (st.tab === 'detail' && st.itemIndex != null) next = '#idw=detail@' + st.itemIndex;
  else if (st.tab === 'access') next = '#idw=access' + (st.itemIndex != null ? '@' + st.itemIndex : '');
  else if (st.tab === 'health') next = '#idw=health';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

/* ---------- 数据加载 ---------- */

function idwIssueTotals() {
  const total = { error: 0, warn: 0, info: 0 };
  const parts = [
    ITW.data && ITW.data.stats ? ITW.data.stats.issues : null,
    DPW.data && DPW.data.stats ? DPW.data.stats.issues : null
  ];
  for (const s of parts) {
    if (!s) continue;
    total.error += s.error || 0;
    total.warn += s.warn || 0;
    total.info += s.info || 0;
  }
  return total;
}

async function idwLoad(force) {
  if (IDW.loading) return;
  IDW.loading = true;
  idwRenderMeta();
  try {
    const res = await api('/api/config/itemdrop' + (force ? '?refresh=1' : ''));
    if (res && res.item && !res.item.error) {
      ITW.data = res.item;
      ITW.stale = false;
      if (force) {
        ITW.typesBuilt = false;
        const select = idwEl('itwType');
        if (select) while (select.options.length > 1) select.remove(1);
      }
      itwBuildTypes();
    } else if (res && res.item && res.item.error) {
      toast('物品数据加载失败：' + res.item.error, 'err');
    }
    if (res && res.drop && !res.drop.error) {
      DPW.data = res.drop;
      DPW.stale = false;
    } else if (res && res.drop && res.drop.error) {
      toast('爆率数据加载失败：' + res.drop.error, 'err');
    }
    if (ITW.data && DPW.data) IDW.stale = false;
  } finally {
    IDW.loading = false;
  }
}

function itwBuildTypes() {
  const select = idwEl('itwType');
  if (!select || !ITW.data) return;
  if (ITW.typesBuilt) return;
  ITW.typesBuilt = true;
  for (const t of ITW.data.types || []) {
    const opt = document.createElement('option');
    opt.value = t.label;
    opt.textContent = t.label + '（' + t.count + '）';
    select.appendChild(opt);
  }
  select.value = ITW.type;
}

/* ---------- 页签 / 元信息 / 侧栏 ---------- */

function idwRenderMeta() {
  const meta = idwEl('idwMeta');
  if (!meta) return;
  if (!ITW.data && !DPW.data) {
    meta.textContent = IDW.loading ? '正在加载…' : '';
    return;
  }
  const parts = [];
  if (ITW.data) parts.push(ITW.data.stats.items + ' 件物品', ITW.data.stats.types + ' 个类型');
  if (DPW.data) parts.push(DPW.data.stats.files + ' 个爆率文件', DPW.data.stats.items + ' 种掉落物品');
  const issues = idwIssueTotals();
  parts.push('问题 ' + issues.error + ' 错误 / ' + issues.warn + ' 警告 / ' + issues.info + ' 提示');
  meta.textContent = parts.join(' · ');
}

function idwRenderTabs() {
  document.querySelectorAll('#idwTabs [data-idw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.idwTab === IDW.tab);
  });
  const panes = {
    detail: 'idwDetailPane',
    access: 'idwAccessPane',
    health: 'idwHealthPane'
  };
  Object.keys(panes).forEach((key) => {
    const el = idwEl(panes[key]);
    if (el) el.classList.toggle('hidden', key !== IDW.tab);
  });
}

function idwRenderSidebar() {
  itwRenderList();
  const filter = idwEl('idwFilter');
  if (filter) {
    if (filter.value !== ITW.filter) filter.value = ITW.filter;
    filter.placeholder = '搜索物品 / Idx / 类型...';
  }
}

function idwRenderHealth() {
  itwRenderHealth();
  dpwRenderHealth();
}

function idwRenderAll() {
  idwRenderTabs();
  idwRenderMeta();
  idwRenderSidebar();
  itwRenderDetail();
  itwRenderAccess();
  idwRenderHealth();
}

/* ---------- 物品侧渲染 ---------- */

function itwIssueCount(n) {
  return (n && (n.error + n.warn)) || 0;
}

function itwFlagMatch(n) {
  if (ITW.flag === 'issues') return itwIssueCount(n.issues) > 0;
  if (ITW.flag === 'nosource') return n.sources === 0;
  if (ITW.flag === 'nodesc') return !n.hasDesc;
  if (ITW.flag === 'drop') return n.drops > 0;
  if (ITW.flag === 'shop') return n.shops > 0;
  if (ITW.flag === 'task') return n.tasks > 0;
  return true;
}

function itwMatches(n, q) {
  if (!q) return true;
  const name = String(n.name || '').toLowerCase();
  return (
    name.includes(q) ||
    String(n.idx) === q ||
    String(n.type || '').toLowerCase().includes(q) ||
    String(n.needLevel) === q
  );
}

function itwTag(text, cls) {
  const span = document.createElement('span');
  span.className = 'npw-tag' + (cls ? ' ' + cls : '');
  span.textContent = text;
  return span;
}

function itwRenderList() {
  const list = idwEl('itwList');
  const hint = idwEl('itwListHint');
  if (!list) return;
  idwClear(list);
  if (!ITW.data) {
    if (hint) hint.textContent = '正在加载物品数据…';
    return;
  }
  const q = ITW.filter.trim().toLowerCase();
  const all = ITW.data.items.filter((n) =>
    (ITW.type === 'all' || n.type === ITW.type) &&
    itwFlagMatch(n) &&
    itwMatches(n, q));
  const shown = all.slice(0, ITW_LIST_LIMIT);
  for (const n of shown) {
    const li = document.createElement('li');
    li.className = 'file-item' + (ITW.selected === n.index ? ' active' : '');
    li.dataset.itwIndex = String(n.index);
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = n.name || '（未命名）';
    if (n.drops) name.appendChild(itwTag('掉落 ' + n.drops, 'warn'));
    if (n.shops) name.appendChild(itwTag('商店 ' + n.shops, 'shop'));
    if (n.tasks) name.appendChild(itwTag('任务 ' + n.tasks, 'task'));
    const issues = itwIssueCount(n.issues);
    if (issues) name.appendChild(itwTag('问题 ' + issues, 'bad'));
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = [
      'Idx ' + n.idx,
      n.type,
      '重 ' + n.weight,
      '价 ' + n.price,
      n.needLevel ? '等级 ' + n.needLevel : ''
    ].filter(Boolean).join(' · ');
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (!all.length) {
    const empty = document.createElement('li');
    empty.className = 'side-note';
    empty.textContent = '没有符合条件的物品。';
    list.appendChild(empty);
  }
  if (hint) {
    hint.textContent = all.length > ITW_LIST_LIMIT
      ? '显示前 ' + ITW_LIST_LIMIT + ' 条，共 ' + all.length + ' 条；输入关键词或切换筛选缩小范围。'
      : '共 ' + all.length + ' 件物品。';
  }
}

function itwKv(label, value) {
  return '<div class="tsk-kv"><div class="tsk-kv-label">' + idwEsc(label) +
    '</div><div class="tsk-kv-value">' + idwEsc(value == null || value === '' ? '—' : value) + '</div></div>';
}

function itwSection(title, note, bodyHtml) {
  return '<div class="tsk-section"><div class="tsk-section-head"><h4>' + idwEsc(title) + '</h4>' +
    (note ? '<span class="tsk-empty">' + idwEsc(note) + '</span>' : '') + '</div>' + bodyHtml + '</div>';
}

function itwField(row, key) {
  const v = row[key];
  return v == null || v === '' ? '' : v;
}

function itwRenderIssues(issues) {
  if (!issues.length) return '<div class="tsk-empty">未发现该物品的配置问题。</div>';
  let html = '<div class="npw-issue-list">';
  for (const issue of issues) {
    html += '<div class="npw-issue ' + idwEsc(issue.severity) + '">' +
      '<span class="mon-sev ' + idwEsc(issue.severity) + '">' + idwEsc(ITW_SEV[issue.severity] || issue.severity) + '</span>' +
      '<span class="npw-issue-msg">' + idwEsc(issue.message) + '</span></div>';
  }
  return html + '</div>';
}

function itwRenderDetail() {
  const box = idwEl('itwDetail');
  if (!box) return;
  if (!ITW.detail) {
    box.innerHTML = '<div class="itw-intro">' +
      '<div class="itw-intro-title">物品与掉落</div>' +
      '<p>从左侧选择一件物品，查看它的属性、描述、掉落、商店、任务、合成与商城引用；「来源」汇总所有产出与消耗，并可直接定位到爆率文件的具体行，「问题」汇总全库问题并支持跳转处理。</p>' +
      (ITW.data ? '<p class="muted">当前共 ' + ITW.data.stats.items + ' 件物品、' + ITW.data.stats.drops +
        ' 条掉落引用、' + ITW.data.stats.shops + ' 条商店货品。</p>' : '') +
      '</div>';
    return;
  }
  const d = ITW.detail;
  const item = d.item;
  const row = item.fields || {};
  const name = String(item.name || '').trim();
  const issues = d.issues || [];
  const parts = [];

  parts.push('<div class="tsk-head itw-head">' +
    '<span class="tsk-title">' + idwEsc(name || '（未命名）') + '</span>' +
    '<span class="npw-chip">Idx ' + idwEsc(item.idx) + '</span>' +
    '<span class="npw-chip">' + idwEsc(item.type) + '</span>' +
    (item.hasDesc ? '' : '<span class="npw-chip">无描述</span>') +
    (itwIssueCount(issues) ? '<span class="npw-chip bad">问题 ' + itwIssueCount(issues) + '</span>' : '') +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" data-itw-act="editdesc" data-name="' + idwEsc(name) + '">编辑描述</button>' +
    '<button class="btn btn-sm" data-itw-act="db" data-name="' + idwEsc(name) + '">在数据库中查看</button>' +
    '</div>');

  parts.push('<div class="tsk-grid">' +
    itwKv('Idx', item.idx) +
    itwKv('名称', name) +
    itwKv('类型 / Stdmode', item.type + ' · ' + item.stdmode) +
    itwKv('重量', row.Weight) +
    itwKv('价格', row.Price) +
    itwKv('需求等级', row.NeedLevel) +
    itwKv('持久', row.DuraMax) +
    itwKv('攻击 AC / MAC', [itwField(row, 'Ac'), itwField(row, 'Ac2'), itwField(row, 'Mac'), itwField(row, 'Mac2')].join(' / ')) +
    itwKv('道术 DC / MC / SC', [itwField(row, 'Dc'), itwField(row, 'Dc2'), itwField(row, 'Mc'), itwField(row, 'Mc2'), itwField(row, 'Sc'), itwField(row, 'Sc2')].join(' / ')) +
    itwKv('需求', [itwField(row, 'Need'), row.NeedLevel ? '等级 ' + row.NeedLevel : ''].filter(Boolean).join(' · ')) +
    itwKv('外观 / 武器外观', [itwField(row, 'Looks'), itwField(row, 'WeaponLooks')].filter((v) => v !== '').join(' / ')) +
    itwKv('库存 / Source', [itwField(row, 'Stock'), itwField(row, 'Source')].filter((v) => v !== '').join(' / ')) +
    itwKv('Reserved', [itwField(row, 'Reserved'), itwField(row, 'Reserved2'), itwField(row, 'NOATMAN')].filter((v) => v !== '').join(' / ')) +
    itwKv('产出 / 消耗', [d.drops.length + ' 掉落', d.shops.length + ' 商店', d.tasks.length + ' 任务',
      d.recipesUse.length + ' 材料', d.recipesMake.length + ' 产出', d.mall.length + ' 商城'].join(' · ')) +
    '</div>');

  parts.push(itwSection('物品描述', item.hasDesc ? '' : 'itemdesc.txt 中没有该物品',
    item.hasDesc ? '<pre class="tsk-desc">' + idwEsc(item.desc) + '</pre>' : '<div class="tsk-empty">未配置描述。</div>'));

  parts.push(itwSection('配置问题', '', itwRenderIssues(issues)));

  box.innerHTML = parts.join('');
}

function itwRenderDropList(drops) {
  if (!drops.length) return '<div class="tsk-empty">没有任何怪物爆率引用该物品。</div>';
  const shown = drops.slice(0, ITW_REF_LIMIT);
  const groups = new Map();
  for (const d of shown) {
    if (!groups.has(d.monster)) groups.set(d.monster, { monster: d.monster, known: d.monsterKnown, rows: [] });
    groups.get(d.monster).rows.push(d);
  }
  let html = '<div class="itw-ref-list">';
  for (const g of groups.values()) {
    html += '<div class="itw-drop-group">' +
      '<div class="itw-ref-main">' +
      (g.known
        ? '<button class="tsk-link" data-itw-act="monster" data-name="' + idwEsc(g.monster) + '">' + idwEsc(g.monster) + '</button>'
        : '<span class="tsk-link bad">' + idwEsc(g.monster) + '</span><span class="tsk-empty">Monster.DB 中未找到该怪物</span>') +
      '<span class="muted">' + g.rows.length + ' 条</span>' +
      '</div>' +
      '<div class="itw-drop-lines">';
    for (const d of g.rows) {
      html += '<div class="itw-ref-meta">' +
        idwEsc(d.file) + (d.line ? ' 第 ' + d.line + ' 行' : '') +
        ' · 几率 ' + idwEsc(d.n + '/' + d.d) +
        (d.qty != null ? ' · 数量 ' + idwEsc(d.qty) : '') +
        '<button class="btn btn-sm ghost" data-itw-act="file" data-file="' + idwEsc(d.file) +
        '" data-line="' + idwEsc(d.line || 1) + '">定位</button></div>';
    }
    html += '</div></div>';
  }
  html += '</div>';
  if (drops.length > shown.length) {
    html += '<div class="tsk-empty">共 ' + drops.length + ' 条，仅显示前 ' + shown.length + ' 条。</div>';
  }
  return html;
}

function itwRenderShopList(shops) {
  if (!shops.length) return '<div class="tsk-empty">没有商店出售该物品。</div>';
  const shown = shops.slice(0, ITW_REF_LIMIT);
  let html = '<div class="itw-ref-list">';
  for (const s of shown) {
    html += '<div class="itw-ref-row">' +
      '<div class="itw-ref-main">' +
      (s.npc ? '<button class="tsk-link" data-itw-act="shop" data-search="' + idwEsc(s.npc) + '">' + idwEsc(s.npc) + '</button>' : '<span>未知 NPC</span>') +
      '<span class="tsk-empty">' + idwEsc(s.file) + (s.line ? ' 第 ' + s.line + ' 行' : '') + '</span>' +
      (s.count != null ? '<span class="muted">数量 ' + idwEsc(s.count) + '</span>' : '') +
      (s.time != null && s.time !== '' ? '<span class="muted">刷新 ' + idwEsc(s.time) + '</span>' : '') +
      '</div></div>';
  }
  html += '</div>';
  if (shops.length > shown.length) {
    html += '<div class="tsk-empty">共 ' + shops.length + ' 条，仅显示前 ' + shown.length + ' 条。</div>';
  }
  return html;
}

function itwRenderTaskList(tasks) {
  if (!tasks.length) return '<div class="tsk-empty">没有任务要求或奖励该物品。</div>';
  let html = '<div class="tsk-chips">';
  for (const t of tasks) {
    html += '<button class="tsk-chip task' + (t.enabled ? '' : ' warn') + '" data-itw-act="task" data-id="' + idwEsc(t.id) + '">' +
      idwEsc(String(t.id) + ' ' + (t.name || '未命名任务') + (t.enabled ? '' : '（未启用）')) + '</button>';
  }
  return html + '</div>';
}

function itwRenderRecipes() {
  const d = ITW.detail;
  const parts = [];
  if (d.recipesUse.length) {
    parts.push('<div class="tsk-sub-title">作为材料（' + d.recipesUse.length + '）</div><div class="tsk-chips">');
    for (const r of d.recipesUse) {
      parts.push('<button class="tsk-chip" data-itw-act="make">' + idwEsc(r.recipe + ' ×' + r.count) + '</button>');
    }
    parts.push('</div>');
  }
  if (d.recipesMake.length) {
    parts.push('<div class="tsk-sub-title">作为产出（' + d.recipesMake.length + '）</div><div class="tsk-chips">');
    for (const r of d.recipesMake) {
      parts.push('<button class="tsk-chip" data-itw-act="make">' + idwEsc(r.name) + '</button>');
    }
    parts.push('</div>');
  }
  return parts.length ? '<div class="tsk-sub">' + parts.join('') + '</div>'
    : '<div class="tsk-empty">没有合成配方引用该物品。</div>';
}

function itwRenderMall() {
  const d = ITW.detail;
  const parts = [];
  if (d.goods.length) {
    parts.push('<div class="tsk-sub-title">goodsconfig（' + d.goods.length + '）</div><div class="itw-ref-list">');
    for (const g of d.goods) {
      parts.push('<div class="itw-ref-row"><div class="itw-ref-main">' +
        '<button class="tsk-link" data-itw-act="goods">商品 ' + idwEsc(g.id) + '</button>' +
        (g.version ? '<span class="muted">版本 ' + idwEsc(g.version) + '</span>' : '') +
        (g.line ? '<span class="tsk-empty">第 ' + idwEsc(g.line) + ' 行</span>' : '') +
        '</div></div>');
    }
    parts.push('</div>');
  }
  if (d.mall.length) {
    parts.push('<div class="tsk-sub-title">PTItems.xml（' + d.mall.length + '）</div><div class="itw-ref-list">');
    for (const m of d.mall) {
      parts.push('<div class="itw-ref-row"><div class="itw-ref-main">' +
        '<button class="tsk-link" data-itw-act="mall">商城商品 ' + idwEsc(m.id) + '</button>' +
        (m.price != null ? '<span class="muted">价格 ' + idwEsc(m.price) + '</span>' : '') +
        (m.unitnum != null ? '<span class="muted">数量 ' + idwEsc(m.unitnum) + '</span>' : '') +
        '<span class="tsk-empty">第 ' + idwEsc(m.line) + ' 行</span>' +
        '</div></div>');
    }
    parts.push('</div>');
  }
  return parts.length ? '<div class="tsk-sub">' + parts.join('') + '</div>'
    : '<div class="tsk-empty">商城配置中没有引用该物品。</div>';
}

function itwRenderAccess() {
  const box = idwEl('itwAccess');
  if (!box) return;
  if (!ITW.detail) {
    box.innerHTML = '<div class="tsk-empty">请先在左侧选择一件物品。</div>';
    return;
  }
  const d = ITW.detail;
  const name = String(d.item.name || '').trim();
  const parts = [];

  parts.push('<div class="tsk-head itw-head"><span class="tsk-title">' + idwEsc(name) + '</span>' +
    '<span class="npw-chip">Idx ' + idwEsc(d.item.idx) + '</span><span class="spacer"></span>' +
    '<span class="tsk-empty">掉落 ' + d.drops.length + ' · 商店 ' + d.shops.length + ' · 任务 ' + d.tasks.length +
    ' · 合成 ' + (d.recipesUse.length + d.recipesMake.length) + ' · 商城 ' + (d.goods.length + d.mall.length) + '</span></div>');

  parts.push(itwSection('怪物掉落', d.drops.length ? '点击怪物进入怪物工作台；点击「定位」打开爆率编辑器并选中对应行' : '', itwRenderDropList(d.drops)));
  parts.push(itwSection('商店出售', d.shops.length ? '点击 NPC 打开商店货品' : '', itwRenderShopList(d.shops)));
  parts.push(itwSection('任务关联', d.tasks.length ? '点击任务进入任务工作台' : '', itwRenderTaskList(d.tasks)));
  parts.push(itwSection('合成配方', '', itwRenderRecipes()));
  parts.push(itwSection('商城引用', '', itwRenderMall()));

  if (!d.drops.length && !d.shops.length && !d.tasks.length && !d.recipesUse.length &&
      !d.recipesMake.length && !d.goods.length && !d.mall.length) {
    parts.push('<div class="itw-intro"><div class="itw-intro-title">没有发现获取途径</div>' +
      '<p>该物品没有被爆率、商店、任务、合成或商城配置引用。可到「配置体检 → 无产出物品」查看同类物品。</p></div>');
  }
  box.innerHTML = parts.join('');
}

function itwRenderHealth() {
  const box = idwEl('itwHealthList');
  if (!box) return;
  idwClear(box);
  if (!ITW.data) {
    const line = document.createElement('div');
    line.className = 'tsk-empty';
    line.textContent = '正在加载物品数据…';
    box.appendChild(line);
    return;
  }
  const issues = ITW.data.issues || [];
  const counts = ITW.data.stats.issues;
  const summary = document.createElement('div');
  summary.className = 'npw-health-summary';
  summary.textContent = '共 ' + issues.length + ' 条问题：错误 ' + counts.error +
    ' · 警告 ' + counts.warn + ' · 提示 ' + counts.info;
  box.appendChild(summary);

  const groupMap = new Map();
  const groups = [];
  for (const issue of issues) {
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
    title.textContent = (ITW_ISSUE_LABEL[g.code] || g.code) + ' · ' + g.code;
    head.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'act-cat';
    meta.textContent = g.issues.length + ' 条';
    head.appendChild(meta);
    group.appendChild(head);
    for (const issue of g.issues) group.appendChild(itwIssueRow(issue));
    box.appendChild(group);
  }
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'mon-empty';
    empty.textContent = '未发现问题。';
    box.appendChild(empty);
  }
}

function itwIssueRow(issue) {
  const row = document.createElement('div');
  row.className = 'mon-issue';
  const sev = document.createElement('span');
  sev.className = 'mon-sev ' + issue.severity;
  sev.textContent = ITW_SEV[issue.severity] || issue.severity;
  row.appendChild(sev);
  const body = document.createElement('div');
  body.className = 'mon-issue-body';
  const msg = document.createElement('div');
  msg.textContent = issue.message;
  body.appendChild(msg);
  if (issue.item) {
    const meta = document.createElement('div');
    meta.className = 'act-issue-meta';
    meta.textContent = issue.item;
    body.appendChild(meta);
  }
  row.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'tsk-issue-actions';
  if (issue.index != null && ITW.data && issue.index < ITW.data.items.length) {
    actions.appendChild(idwBtn('查看物品', 'btn btn-sm', () => idwSelectItem(issue.index)));
  }
  const action = issue.action || null;
  if (action) {
    if (action.view === 'filter') {
      const label = action.flag === 'nosource' ? '筛选无产出' : '筛选无描述';
      actions.appendChild(idwBtn(label, 'btn btn-sm', () => idwApplyItemFilter(action.flag)));
    } else if (action.view === 'monster' && action.name) {
      actions.appendChild(idwBtn('怪物爆率', 'btn btn-sm', () => idwGotoMonster(action.name)));
    } else if (action.view === 'shop' && action.search) {
      actions.appendChild(idwBtn('商店货品', 'btn btn-sm', () => idwGotoShop(action.search)));
    } else if (action.view === 'task' && action.id != null) {
      actions.appendChild(idwBtn('任务工作台', 'btn btn-sm', () => idwGotoTask(action.id)));
    } else if (action.view === 'make') {
      actions.appendChild(idwBtn('合成配方', 'btn btn-sm', () => idwGotoMake()));
    } else if (action.view === 'goods') {
      actions.appendChild(idwBtn('商城商品', 'btn btn-sm', () => idwGotoGoods()));
    } else if (action.view === 'mall') {
      actions.appendChild(idwBtn('商城配置', 'btn btn-sm', () => idwGotoMall()));
    }
  }
  if (actions.childNodes.length) row.appendChild(actions);
  return row;
}

/* ---------- 掉落侧渲染 ---------- */

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
    '<span class="mon-sev ' + sev + '">' + idwEsc(DPW_SEV[sev] || sev) + '</span>' +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + idwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + idwEsc(label) + (where ? ' · ' + idwEsc(where) : '') + '</div></div>' +
    jump + '</div>';
}

function dpwRenderHealth() {
  const box = idwEl('dpwHealthList');
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
    html += '<div class="mon-issue-group"><div class="mon-issue-head"><strong>' + idwEsc(g) + '</strong>' +
      '<span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' + counts.warn +
      ' 警告 / ' + counts.info + ' 提示</span></div>' +
      list.map((i) => dpwIssueRow(i)).join('') + '</div>';
  }
  box.innerHTML = html;
}

/* ---------- 选择 / 跨页签 ---------- */

function idwNormName(name) {
  return String(name || '').trim().replace(/（/g, '(').replace(/）/g, ')');
}

async function idwSelectItem(index, tab) {
  if (!ITW.data) return;
  index = Number(index);
  if (!Number.isInteger(index) || index < 0 || index >= ITW.data.items.length) return;
  ITW.selected = index;
  ITW.detail = null;
  IDW.tab = tab === 'access' ? 'access' : 'detail';
  const req = ++ITW.req;
  idwRenderTabs();
  idwRenderSidebar();
  itwRenderDetail();
  itwRenderAccess();
  try {
    const detail = await api('/api/config/itemdrop/item?index=' + index);
    if (req !== ITW.req) return;
    ITW.detail = detail;
  } catch (e) {
    if (req === ITW.req) toast('加载物品详情失败：' + e.message, 'err');
    return;
  }
  itwRenderDetail();
  itwRenderAccess();
  idwSetHash({ tab: IDW.tab, itemIndex: index });
  const row = document.querySelector('#itwList [data-itw-index="' + index + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

async function idwLocateDropItem(key) {
  if (!key) return;
  const target = idwNormName(key);
  let item = DPW.data ? DPW.data.items.find((i) => i.key === key) : null;
  if (!item && DPW.data) item = DPW.data.items.find((i) => idwNormName(i.name) === target);
  if (item && item.itemIndex >= 0 && !item.pseudo && ITW.data && ITW.data.items[item.itemIndex]) {
    await idwSelectItem(item.itemIndex, 'access');
    return;
  }
  try {
    const detail = await api('/api/config/itemdrop/drop?key=' + encodeURIComponent(item ? item.key : key));
    const row = detail && detail.groups && detail.groups[0] &&
      detail.groups[0].rows && detail.groups[0].rows[0];
    if (row) return idwGotoFile(row.file, row.line);
    toast('未找到「' + (item ? item.name : key) + '」的爆率文件位置', 'err');
  } catch (e) {
    toast('定位掉落物品失败：' + e.message, 'err');
  }
}

function idwSelectTab(tab) {
  if (IDW_TABS.indexOf(tab) < 0) return;
  IDW.tab = tab;
  idwRenderTabs();
  idwRenderSidebar();
  if (tab === 'detail') itwRenderDetail();
  else if (tab === 'access') itwRenderAccess();
  else idwRenderHealth();
  idwSetHash({ tab, itemIndex: ITW.selected });
}

function idwApplyItemFilter(flag) {
  ITW.flag = flag;
  document.querySelectorAll('#itwFlagFilter [data-itw-flag]').forEach((b) => {
    b.classList.toggle('active', b.dataset.itwFlag === flag);
  });
  IDW.tab = 'detail';
  idwRenderTabs();
  idwRenderSidebar();
  itwRenderList();
  idwSetHash({ tab: 'detail', itemIndex: ITW.selected });
}

/* ---------- 跨工作台跳转 ---------- */

async function idwGotoMonster(name) {
  if (!window.openMonsterWorkbench || !name) return;
  await window.openMonsterWorkbench(name);
  const tab = document.querySelector('#monTabs [data-mon-tab="drop"]');
  if (tab) tab.click();
}

async function idwGotoTask(id) {
  if (!window.openTaskView) return;
  await window.openTaskView(undefined, Number(id));
}

async function idwGotoShop(search) {
  if (!window.openShopsConfig) return;
  await window.openShopsConfig();
  const input = idwEl('shopSearch');
  if (input) {
    input.value = search || '';
    input.dispatchEvent(new Event('input'));
  }
}

async function idwGotoDb(name) {
  if (!window.openDb) return;
  await window.openDb('stditems.db');
  const input = idwEl('rowSearch');
  if (input) {
    input.value = name || '';
    input.dispatchEvent(new Event('input'));
  }
}

async function idwGotoMake() {
  if (window.openMakeitem) await window.openMakeitem();
}

async function idwGotoGoods() {
  if (window.openGoodsConfig) await window.openGoodsConfig();
}

async function idwGotoMall() {
  if (window.openMallConfig) await window.openMallConfig();
}

async function idwGotoFile(file, line) {
  if (!window.openDrop || !file) return;
  await window.openDrop(file);
  const area = idwEl('dropText');
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

async function idwJumpIssue(issue) {
  if (!issue) return;
  const a = issue.action || {};
  if (a.view === 'filter') {
    if (S.mode !== 'itemdrop') await window.openItemDropView({ tab: 'detail' });
    idwApplyItemFilter(a.flag);
    return;
  }
  if (a.view === 'monster' && a.name) return idwGotoMonster(a.name);
  if (a.view === 'shop' && a.search) return idwGotoShop(a.search);
  if (a.view === 'task' && a.id != null) return idwGotoTask(a.id);
  if (a.view === 'make') return idwGotoMake();
  if (a.view === 'goods') return idwGotoGoods();
  if (a.view === 'mall') return idwGotoMall();
  if (a.view === 'item' && a.key) {
    if (issue.file) return idwGotoFile(issue.file, issue.line || 1);
    return window.openItemDropView({ dropKey: a.key });
  }
  if (a.view === 'file' && a.file) return idwGotoFile(a.file, issue.line || 1);
  if (a.view === 'tab') {
    if (S.mode !== 'itemdrop') return window.openItemDropView({ tab: 'health' });
    return idwSelectTab('health');
  }
  if (issue.index != null) return idwSelectItem(Number(issue.index));
  if (S.mode !== 'itemdrop') return window.openItemDropView({ tab: 'health' });
  return idwSelectTab('health');
}

/* ---------- 打开 / 关闭 ---------- */

function idwFromLegacySel(sel) {
  if (sel == null) return { tab: 'health' };
  if (typeof sel === 'number') return { tab: 'detail', itemIndex: sel };
  if (sel.key != null) return { dropKey: sel.key };
  if (sel.dropKey != null) return { dropKey: sel.dropKey };
  if (sel.tab === 'health' || sel.tab === 'access' || sel.tab === 'detail') {
    return { tab: sel.tab };
  }
  return { tab: 'health' };
}

async function idwApplyTarget(target) {
  const t = target || {};
  const tab = IDW_TABS.indexOf(t.tab) >= 0 ? t.tab : 'detail';
  let index = t.itemIndex != null && Number.isInteger(Number(t.itemIndex)) ? Number(t.itemIndex) : null;
  const dropKey = t.dropKey != null && t.dropKey !== '' ? String(t.dropKey) : null;

  if (dropKey) {
    await idwLocateDropItem(dropKey);
    return;
  }
  if (index != null && (!ITW.data || index < 0 || index >= ITW.data.items.length)) index = null;
  if (index != null) {
    await idwSelectItem(index, tab);
    return;
  }

  IDW.tab = tab;
  idwRenderTabs();
  idwRenderSidebar();
  if (tab === 'detail') itwRenderDetail();
  else if (tab === 'access') itwRenderAccess();
  else idwRenderHealth();
  idwSetHash({ tab, itemIndex: index });
}

async function openItemDropView(sel) {
  if (S.mode !== 'itemdrop' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'itemdrop';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  if (window.hideGrowthView) window.hideGrowthView();
  if (window.hideSpawnWorkView) window.hideSpawnWorkView();
  if (window.hideMapWorkView) window.hideMapWorkView();
  if (window.hideShopWorkView) window.hideShopWorkView();
  if (window.hideScriptWorkView) window.hideScriptWorkView();
  if (window.hideCastleWorkView) window.hideCastleWorkView();
  if (window.hideTextWorkView) window.hideTextWorkView();
  if (window.hideStarterWorkView) window.hideStarterWorkView();
  if (window.hideHealthWorkView) window.hideHealthWorkView();
  if (window.hideYswView) window.hideYswView();
  const dbView = idwEl('dbView');
  const dropView = idwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = idwEl('itemDropView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('idw');
  idwRenderAll();

  if (!ITW.data || !DPW.data || ITW.stale || DPW.stale || IDW.stale) {
    try {
      await idwLoad();
      idwRenderAll();
    } catch (e) {
      idwRenderAll();
      toast('加载物品与掉落数据失败：' + e.message, 'err');
      return;
    }
  }

  let target = sel;
  if (typeof target === 'number') target = { tab: 'detail', itemIndex: target };
  if (!target) target = idwHashState();
  if (!target) target = { tab: IDW.tab, itemIndex: ITW.selected };
  await idwApplyTarget(target);
}

function hideItemDropView() {
  const view = idwEl('itemDropView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && idwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
}

function refreshItemDropState(st) {
  IDW.stale = true;
  if (S.mode === 'itemdrop') idwRenderMeta();
}

/* ---------- 导出 / 兼容 ---------- */

window.openItemDropView = openItemDropView;
window.hideItemDropView = hideItemDropView;
window.refreshItemDropState = refreshItemDropState;
window.updateItemDropMeta = idwRenderMeta;
window.idwJumpIssue = idwJumpIssue;

window.openItemWorkView = (index) =>
  window.openItemDropView({ tab: 'detail', itemIndex: index == null ? undefined : Number(index) });
window.openDropsView = (sel) => window.openItemDropView(idwFromLegacySel(sel));
window.hideItemWorkView = hideItemDropView;
window.hideDropWorkView = hideItemDropView;
window.refreshItemWorkState = refreshItemDropState;
window.refreshDropWorkState = refreshItemDropState;
window.updateItemWorkMeta = idwRenderMeta;
window.updateDropWorkMeta = idwRenderMeta;
window.dpwJumpIssue = idwJumpIssue;

/* ---------- 事件 ---------- */

function idwBindEvents() {
  const filter = idwEl('idwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(ITW.searchTimer);
      ITW.searchTimer = setTimeout(() => {
        ITW.filter = filter.value;
        itwRenderList();
      }, 150);
    });
  }
  const type = idwEl('itwType');
  if (type) {
    type.addEventListener('change', () => {
      ITW.type = type.value;
      itwRenderList();
    });
  }
  document.querySelectorAll('#itwFlagFilter [data-itw-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ITW.flag = btn.dataset.itwFlag;
      document.querySelectorAll('#itwFlagFilter [data-itw-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      itwRenderList();
    });
  });
  const itemList = idwEl('itwList');
  if (itemList) {
    itemList.addEventListener('click', (e) => {
      const li = e.target.closest('[data-itw-index]');
      if (!li) return;
      idwSelectItem(Number(li.dataset.itwIndex));
    });
  }
  const tabs = idwEl('idwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-idw-tab]');
      if (!btn) return;
      idwSelectTab(btn.dataset.idwTab);
    });
  }
  const main = idwEl('itemDropView');
  if (main) {
    main.addEventListener('click', (e) => {
      const iwBtnEl = e.target.closest('[data-itw-act]');
      if (iwBtnEl) {
        const act = iwBtnEl.dataset.itwAct;
        if (act === 'db') idwGotoDb(iwBtnEl.dataset.name);
        else if (act === 'editdesc') {
          if (window.openTextEntryForItem) window.openTextEntryForItem(iwBtnEl.dataset.name);
        }
        else if (act === 'file') idwGotoFile(iwBtnEl.dataset.file, Number(iwBtnEl.dataset.line) || 1);
        else if (act === 'monster') idwGotoMonster(iwBtnEl.dataset.name);
        else if (act === 'task') idwGotoTask(iwBtnEl.dataset.id);
        else if (act === 'shop') idwGotoShop(iwBtnEl.dataset.search);
        else if (act === 'make') idwGotoMake();
        else if (act === 'goods') idwGotoGoods();
        else if (act === 'mall') idwGotoMall();
        return;
      }
      const dpBtnEl = e.target.closest('[data-dpw-act]');
      if (!dpBtnEl) return;
      const act = dpBtnEl.dataset.dpwAct;
      if (act === 'file') idwGotoFile(dpBtnEl.dataset.file, Number(dpBtnEl.dataset.line) || 1);
      else if (act === 'monster') idwGotoMonster(dpBtnEl.dataset.name);
      else if (act === 'db') idwGotoDb(dpBtnEl.dataset.name);
      else if (act === 'issue' && DPW.data && DPW.data.issues[Number(dpBtnEl.dataset.dpwIssue)]) {
        idwJumpIssue(DPW.data.issues[Number(dpBtnEl.dataset.dpwIssue)]);
      }
    });
  }
  const reload = idwEl('btnIdwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        IDW.stale = true;
        ITW.detail = null;
        await idwLoad(true);
        idwRenderAll();
        if (ITW.selected != null && (IDW.tab === 'detail' || IDW.tab === 'access')) {
          await idwSelectItem(ITW.selected, IDW.tab);
        }
        toast('物品与掉落数据已重新检查', 'ok');
      } catch (e) {
        idwRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const state = idwHashState();
    if (state) window.openItemDropView(state);
  });
}

idwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = idwHashState();
    if (state) window.openItemDropView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = idwHashState();
    if (state) window.openItemDropView(state);
  });
}

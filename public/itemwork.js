'use strict';

/* 物品工作台：stditems.db + 爆率/商店/任务/合成/商城反向索引 + 配置体检（只读） */

const ITW = {
  data: null,
  detail: null,
  selected: null,
  loading: false,
  stale: true,
  tab: 'detail',
  filter: '',
  type: 'all',
  flag: 'all',
  typesBuilt: false,
  searchTimer: null
};

const ITW_LIST_LIMIT = 500;
const ITW_REF_LIMIT = 300;

const ITW_SEV = { error: '错误', warn: '警告', info: '提示' };

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

function itwEl(id) {
  return document.getElementById(id);
}

function itwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function itwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function itwBtn(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls || 'btn btn-sm';
  b.textContent = text;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function itwText(id, text) {
  const el = itwEl(id);
  if (el) el.textContent = text;
}

function itwHashIndex() {
  const m = /^#item=(\d+)$/.exec(location.hash || '');
  return m ? Number(m[1]) : null;
}

function itwSetHash(index) {
  const next = index == null ? '' : '#item=' + index;
  const cur = location.hash || '';
  if (next === cur) return;
  try {
    if (next) history.replaceState(null, '', location.pathname + location.search + next);
    else history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
  }
}

function itwIssueCount(n) {
  return (n && (n.error + n.warn)) || 0;
}

async function itwLoad() {
  if (ITW.loading) return;
  ITW.loading = true;
  try {
    const data = await api('/api/config/itemwork');
    ITW.data = data;
    ITW.stale = false;
    itwText('itemWorkCount', String(data.stats.items));
    itwBuildTypes();
  } finally {
    ITW.loading = false;
  }
}

async function itwLoadDetail(index) {
  ITW.detail = await api('/api/config/itemwork/detail?index=' + index);
  return ITW.detail;
}

function itwBuildTypes() {
  const select = itwEl('itwType');
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

function itwRenderMeta() {
  const meta = itwEl('itwMeta');
  if (!meta) return;
  if (!ITW.data) {
    meta.textContent = ITW.loading ? '正在加载…' : '';
    return;
  }
  const s = ITW.data.stats;
  meta.textContent = [
    s.items + ' 件物品',
    s.types + ' 个类型',
    s.drops + ' 条掉落引用',
    s.shops + ' 条商店货品',
    '问题 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info + ' 提示'
  ].join(' · ');
  itwText('itemWorkCount', String(s.items));
}

function itwRenderTabs() {
  document.querySelectorAll('#itwTabs [data-itw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.itwTab === ITW.tab);
  });
  const panes = {
    detail: itwEl('itwDetailPane'),
    access: itwEl('itwAccessPane'),
    health: itwEl('itwHealthPane')
  };
  Object.keys(panes).forEach((k) => {
    if (panes[k]) panes[k].classList.toggle('hidden', k !== ITW.tab);
  });
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
  const list = itwEl('itwList');
  const hint = itwEl('itwListHint');
  if (!list) return;
  itwClear(list);
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
  return '<div class="tsk-kv"><div class="tsk-kv-label">' + itwEsc(label) +
    '</div><div class="tsk-kv-value">' + itwEsc(value == null || value === '' ? '—' : value) + '</div></div>';
}

function itwSection(title, note, bodyHtml) {
  return '<div class="tsk-section"><div class="tsk-section-head"><h4>' + itwEsc(title) + '</h4>' +
    (note ? '<span class="tsk-empty">' + itwEsc(note) + '</span>' : '') + '</div>' + bodyHtml + '</div>';
}

function itwField(row, key) {
  const v = row[key];
  return v == null || v === '' ? '' : v;
}

function itwRenderIssues(issues) {
  if (!issues.length) return '<div class="tsk-empty">未发现该物品的配置问题。</div>';
  let html = '<div class="npw-issue-list">';
  for (const issue of issues) {
    html += '<div class="npw-issue ' + itwEsc(issue.severity) + '">' +
      '<span class="mon-sev ' + itwEsc(issue.severity) + '">' + itwEsc(ITW_SEV[issue.severity] || issue.severity) + '</span>' +
      '<span class="npw-issue-msg">' + itwEsc(issue.message) + '</span></div>';
  }
  return html + '</div>';
}

function itwRenderDetail() {
  const box = itwEl('itwDetail');
  if (!box) return;
  if (!ITW.detail) {
    box.innerHTML = '<div class="itw-intro">' +
      '<div class="itw-intro-title">物品工作台</div>' +
      '<p>从左侧选择一件物品，查看它的属性、描述、掉落、商店、任务、合成与商城引用；「获取途径」汇总所有产出与消耗，「配置体检」汇总全库问题并支持跳转处理。</p>' +
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
    '<span class="tsk-title">' + itwEsc(name || '（未命名）') + '</span>' +
    '<span class="npw-chip">Idx ' + itwEsc(item.idx) + '</span>' +
    '<span class="npw-chip">' + itwEsc(item.type) + '</span>' +
    (item.hasDesc ? '' : '<span class="npw-chip">无描述</span>') +
    (itwIssueCount(issues) ? '<span class="npw-chip bad">问题 ' + itwIssueCount(issues) + '</span>' : '') +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" data-itw-act="db" data-name="' + itwEsc(name) + '">在数据库中查看</button>' +
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
    item.hasDesc ? '<pre class="tsk-desc">' + itwEsc(item.desc) + '</pre>' : '<div class="tsk-empty">未配置描述。</div>'));

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
        ? '<button class="tsk-link" data-itw-act="monster" data-name="' + itwEsc(g.monster) + '">' + itwEsc(g.monster) + '</button>'
        : '<span class="tsk-link bad">' + itwEsc(g.monster) + '</span><span class="tsk-empty">Monster.DB 中未找到该怪物</span>') +
      '<span class="muted">' + g.rows.length + ' 条</span>' +
      '</div>' +
      '<div class="itw-drop-lines">';
    for (const d of g.rows) {
      html += '<div class="itw-ref-meta">' + itwEsc(d.file) + (d.line ? ' 第 ' + d.line + ' 行' : '') +
        ' · 几率 ' + itwEsc(d.n + '/' + d.d) +
        (d.qty != null ? ' · 数量 ' + itwEsc(d.qty) : '') + '</div>';
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
      (s.npc ? '<button class="tsk-link" data-itw-act="shop" data-search="' + itwEsc(s.npc) + '">' + itwEsc(s.npc) + '</button>' : '<span>未知 NPC</span>') +
      '<span class="tsk-empty">' + itwEsc(s.file) + (s.line ? ' 第 ' + s.line + ' 行' : '') + '</span>' +
      (s.count != null ? '<span class="muted">数量 ' + itwEsc(s.count) + '</span>' : '') +
      (s.time != null && s.time !== '' ? '<span class="muted">刷新 ' + itwEsc(s.time) + '</span>' : '') +
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
    html += '<button class="tsk-chip task' + (t.enabled ? '' : ' warn') + '" data-itw-act="task" data-id="' + itwEsc(t.id) + '">' +
      itwEsc(String(t.id) + ' ' + (t.name || '未命名任务') + (t.enabled ? '' : '（未启用）')) + '</button>';
  }
  return html + '</div>';
}

function itwRenderRecipes() {
  const d = ITW.detail;
  const parts = [];
  if (d.recipesUse.length) {
    parts.push('<div class="tsk-sub-title">作为材料（' + d.recipesUse.length + '）</div><div class="tsk-chips">');
    for (const r of d.recipesUse) {
      parts.push('<button class="tsk-chip" data-itw-act="make">' + itwEsc(r.recipe + ' ×' + r.count) + '</button>');
    }
    parts.push('</div>');
  }
  if (d.recipesMake.length) {
    parts.push('<div class="tsk-sub-title">作为产出（' + d.recipesMake.length + '）</div><div class="tsk-chips">');
    for (const r of d.recipesMake) {
      parts.push('<button class="tsk-chip" data-itw-act="make">' + itwEsc(r.name) + '</button>');
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
        '<button class="tsk-link" data-itw-act="goods">商品 ' + itwEsc(g.id) + '</button>' +
        (g.version ? '<span class="muted">版本 ' + itwEsc(g.version) + '</span>' : '') +
        (g.line ? '<span class="tsk-empty">第 ' + itwEsc(g.line) + ' 行</span>' : '') +
        '</div></div>');
    }
    parts.push('</div>');
  }
  if (d.mall.length) {
    parts.push('<div class="tsk-sub-title">PTItems.xml（' + d.mall.length + '）</div><div class="itw-ref-list">');
    for (const m of d.mall) {
      parts.push('<div class="itw-ref-row"><div class="itw-ref-main">' +
        '<button class="tsk-link" data-itw-act="mall">商城商品 ' + itwEsc(m.id) + '</button>' +
        (m.price != null ? '<span class="muted">价格 ' + itwEsc(m.price) + '</span>' : '') +
        (m.unitnum != null ? '<span class="muted">数量 ' + itwEsc(m.unitnum) + '</span>' : '') +
        '<span class="tsk-empty">第 ' + itwEsc(m.line) + ' 行</span>' +
        '</div></div>');
    }
    parts.push('</div>');
  }
  return parts.length ? '<div class="tsk-sub">' + parts.join('') + '</div>'
    : '<div class="tsk-empty">商城配置中没有引用该物品。</div>';
}

function itwRenderAccess() {
  const box = itwEl('itwAccess');
  if (!box) return;
  if (!ITW.detail) {
    box.innerHTML = '<div class="tsk-empty">请先在左侧选择一件物品。</div>';
    return;
  }
  const d = ITW.detail;
  const name = String(d.item.name || '').trim();
  const parts = [];

  parts.push('<div class="tsk-head itw-head"><span class="tsk-title">' + itwEsc(name) + '</span>' +
    '<span class="npw-chip">Idx ' + itwEsc(d.item.idx) + '</span><span class="spacer"></span>' +
    '<span class="tsk-empty">掉落 ' + d.drops.length + ' · 商店 ' + d.shops.length + ' · 任务 ' + d.tasks.length +
    ' · 合成 ' + (d.recipesUse.length + d.recipesMake.length) + ' · 商城 ' + (d.goods.length + d.mall.length) + '</span></div>');

  parts.push(itwSection('怪物掉落', d.drops.length ? '点击怪物进入怪物工作台的爆率标签' : '', itwRenderDropList(d.drops)));
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
  const box = itwEl('itwHealthList');
  if (!box) return;
  itwClear(box);
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
    actions.appendChild(itwBtn('查看物品', 'btn btn-sm', () => itwSelect(issue.index)));
  }
  const action = issue.action || null;
  if (action) {
    if (action.view === 'filter') {
      const label = action.flag === 'nosource' ? '筛选无产出' : '筛选无描述';
      actions.appendChild(itwBtn(label, 'btn btn-sm', () => itwApplyFilter(action.flag)));
    } else if (action.view === 'monster' && action.name) {
      actions.appendChild(itwBtn('怪物爆率', 'btn btn-sm', () => itwGotoMonster(action.name)));
    } else if (action.view === 'shop' && action.search) {
      actions.appendChild(itwBtn('商店货品', 'btn btn-sm', () => itwGotoShop(action.search)));
    } else if (action.view === 'task' && action.id != null) {
      actions.appendChild(itwBtn('任务工作台', 'btn btn-sm', () => itwGotoTask(action.id)));
    } else if (action.view === 'make') {
      actions.appendChild(itwBtn('合成配方', 'btn btn-sm', () => itwGotoMake()));
    } else if (action.view === 'goods') {
      actions.appendChild(itwBtn('商城商品', 'btn btn-sm', () => itwGotoGoods()));
    } else if (action.view === 'mall') {
      actions.appendChild(itwBtn('商城配置', 'btn btn-sm', () => itwGotoMall()));
    }
  }
  if (actions.childNodes.length) row.appendChild(actions);
  return row;
}

function itwRenderAll() {
  itwRenderTabs();
  itwRenderMeta();
  itwRenderList();
  itwRenderDetail();
  itwRenderAccess();
  itwRenderHealth();
}

async function itwSelect(index) {
  if (!ITW.data || index == null || index < 0 || index >= ITW.data.items.length) return;
  ITW.selected = index;
  ITW.tab = 'detail';
  ITW.detail = null;
  itwRenderTabs();
  itwRenderList();
  itwRenderDetail();
  itwRenderAccess();
  try {
    await itwLoadDetail(index);
  } catch (e) {
    toast('加载物品详情失败：' + e.message, 'err');
    return;
  }
  itwRenderDetail();
  itwRenderAccess();
  itwSetHash(index);
  const row = document.querySelector('#itwList [data-itw-index="' + index + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function itwSelectTab(tab) {
  ITW.tab = tab;
  itwRenderTabs();
  if (tab === 'access') itwRenderAccess();
  if (tab === 'health') itwRenderHealth();
}

function itwApplyFilter(flag) {
  ITW.flag = flag;
  document.querySelectorAll('#itwFlagFilter [data-itw-flag]').forEach((b) => {
    b.classList.toggle('active', b.dataset.itwFlag === flag);
  });
  itwRenderList();
}

async function itwGotoMonster(name) {
  if (!window.openMonsterWorkbench) return;
  await window.openMonsterWorkbench(name);
  const tab = document.querySelector('#monTabs [data-mon-tab="drop"]');
  if (tab) tab.click();
}

async function itwGotoTask(id) {
  if (!window.openTaskView) return;
  await window.openTaskView(undefined, Number(id));
}

async function itwGotoShop(search) {
  if (!window.openShopsConfig) return;
  await window.openShopsConfig();
  const input = itwEl('shopSearch');
  if (input) {
    input.value = search || '';
    input.dispatchEvent(new Event('input'));
  }
}

async function itwGotoDb(name) {
  if (!window.openDb) return;
  await window.openDb('stditems.db');
  const input = itwEl('rowSearch');
  if (input) {
    input.value = name || '';
    input.dispatchEvent(new Event('input'));
  }
}

async function itwGotoMake() {
  if (window.openMakeitem) await window.openMakeitem();
}

async function itwGotoGoods() {
  if (window.openGoodsConfig) await window.openGoodsConfig();
}

async function itwGotoMall() {
  if (window.openMallConfig) await window.openMallConfig();
}

async function openItemWorkView(index) {
  if (S.mode !== 'item' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'item';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  const dbView = itwEl('dbView');
  const dropView = itwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = itwEl('itemWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('itemw');
  itwRenderAll();
  if (!ITW.data || ITW.stale) {
    try {
      await itwLoad();
      itwRenderAll();
    } catch (e) {
      itwRenderAll();
      toast('加载物品数据失败：' + e.message, 'err');
      return;
    }
  }
  let target = index;
  if (target == null) {
    const fromHash = itwHashIndex();
    if (fromHash != null) target = fromHash;
  }
  if (target == null && ITW.selected != null) target = ITW.selected;
  if (target != null && ITW.data && target >= 0 && target < ITW.data.items.length) {
    await itwSelect(target);
  } else {
    itwSetHash('');
    itwRenderDetail();
    itwRenderAccess();
  }
}

window.openItemWorkView = openItemWorkView;
window.hideItemWorkView = () => {
  const view = itwEl('itemWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && itwHashIndex() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshItemWorkState = (st) => {
  const info = st && st.configs ? st.configs.itemwork : null;
  if (info && info.items != null) itwText('itemWorkCount', String(info.items));
  ITW.stale = true;
  if (S.mode === 'item') itwRenderMeta();
};
window.updateItemWorkMeta = itwRenderMeta;

function itwBindEvents() {
  const filter = itwEl('itwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(ITW.searchTimer);
      ITW.searchTimer = setTimeout(() => {
        ITW.filter = filter.value;
        itwRenderList();
      }, 150);
    });
  }
  const type = itwEl('itwType');
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
  const list = itwEl('itwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-itw-index]');
      if (!li) return;
      itwSelect(Number(li.dataset.itwIndex));
    });
  }
  const tabs = itwEl('itwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-itw-tab]');
      if (!btn) return;
      itwSelectTab(btn.dataset.itwTab);
    });
  }
  const main = itwEl('itemWorkView');
  if (main) {
    main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-itw-act]');
      if (!btn) return;
      const act = btn.dataset.itwAct;
      if (act === 'db') itwGotoDb(btn.dataset.name);
      else if (act === 'monster') itwGotoMonster(btn.dataset.name);
      else if (act === 'task') itwGotoTask(btn.dataset.id);
      else if (act === 'shop') itwGotoShop(btn.dataset.search);
      else if (act === 'make') itwGotoMake();
      else if (act === 'goods') itwGotoGoods();
      else if (act === 'mall') itwGotoMall();
    });
  }
  const reload = itwEl('btnItwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        await itwLoad();
        if (ITW.selected != null) await itwLoadDetail(ITW.selected);
        itwRenderAll();
        toast('物品数据已重新检查', 'ok');
      } catch (e) {
        itwRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const index = itwHashIndex();
    if (index != null) openItemWorkView(index);
  });
}

itwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const index = itwHashIndex();
    if (index != null) openItemWorkView(index);
  });
} else {
  window.addEventListener('app-ready', () => {
    const index = itwHashIndex();
    if (index != null) openItemWorkView(index);
  });
}

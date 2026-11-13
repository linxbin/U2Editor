'use strict';

/* 合成 / 商城工作台：MakeItem + goodsconfig + PTItems 聚合（只读，跳转现有编辑器） */

const SW = {
  data: null,
  detail: null,
  source: 'recipe',
  selected: null,
  notFound: '',
  loading: false,
  detailLoading: false,
  stale: true,
  tab: 'detail',
  filter: '',
  flag: 'all',
  searchTimer: null
};

const SW_TAB_KEYS = ['detail', 'health'];
const SW_SOURCES = ['recipe', 'goods', 'mall'];
const SW_LIST_LIMIT = 400;

const SW_SOURCE_LABEL = { recipe: '配方', goods: 'UU商城', mall: '元宝商城' };
const SW_SOURCE_UNIT = { recipe: '个配方', goods: '条商品', mall: '件商品' };
const SW_SEV = { error: '错误', warn: '警告', info: '提示' };
const SW_ISSUE_GROUP = {
  shop_items_unreadable: '物品库',
  shop_recipe_unreadable: '配方',
  shop_recipe_duplicate: '配方',
  shop_recipe_product_missing: '配方',
  shop_recipe_material_missing: '配方',
  shop_recipe_material_duplicate: '配方',
  shop_recipe_count_invalid: '配方',
  shop_recipe_cycle: '配方',
  shop_recipe_unparsed: '配方',
  shop_goods_unreadable: 'UU商城',
  shop_goods_item_missing: 'UU商城',
  shop_goods_version_invalid: 'UU商城',
  shop_goods_duplicate_key: 'UU商城',
  shop_goods_unparsed: 'UU商城',
  shop_mall_unreadable: '元宝商城',
  shop_mall_item_missing: '元宝商城',
  shop_mall_id_duplicate: '元宝商城',
  shop_mall_price_invalid: '元宝商城',
  shop_mall_unit_invalid: '元宝商城',
  shop_mall_empty_sub: '元宝商城',
  shop_mall_hot_missing: '元宝商城',
  shop_mall_hot_mismatch: '元宝商城',
  shop_mall_unparsed: '元宝商城'
};

function swEl(id) {
  return document.getElementById(id);
}

function swEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function swMultiline(value) {
  return swEsc(String(value == null ? '' : value).split('\\\\').join('\n'));
}

function swClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function swText(id, text) {
  const el = swEl(id);
  if (el) el.textContent = text;
}

function swBadge(text, cls) {
  return '<span class="mpw-badge' + (cls ? ' ' + cls : '') + '">' + swEsc(text) + '</span>';
}

function swSourceList(source) {
  const d = SW.data;
  if (!d) return [];
  if (source === 'recipe') return d.recipes || [];
  if (source === 'goods') return d.goods || [];
  return d.mall || [];
}

function swSelectedRow() {
  if (SW.selected == null) return null;
  return swSourceList(SW.source).find((row) => row.index === SW.selected) || null;
}

function swHashState() {
  const m = /^#shop(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  const raw = m[1] || '';
  if (!raw) return { tab: 'detail' };
  if (raw === 'health') return { tab: 'health' };
  const hm = /^(recipe|goods|mall)-(\d+)$/.exec(raw);
  if (hm) return { tab: 'detail', source: hm[1], index: Number(hm[2]) };
  return { tab: 'detail' };
}

function swSetHash(sel) {
  let raw = '';
  if (sel && sel.tab === 'health') raw = 'health';
  else if (sel && sel.index != null) raw = sel.source + '-' + sel.index;
  const next = raw ? '#shop=' + raw : '#shop';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function swLoad(refresh) {
  if (SW.loading) return;
  SW.loading = true;
  swRenderMeta();
  try {
    const data = await api('/api/config/shopwork' + (refresh ? '?refresh=1' : ''));
    SW.data = data;
    SW.stale = false;
    swText('shopWorkCount', String(data.stats.recipes + data.stats.goods + data.stats.mall));
    swText('swRecipeCount', String(data.stats.recipes));
    swText('swGoodsCount', String(data.stats.goods));
    swText('swMallCount', String(data.stats.mall));
    if (SW.selected != null && !swSourceList(SW.source).some((row) => row.index === SW.selected)) {
      SW.selected = null;
      SW.detail = null;
    }
  } finally {
    SW.loading = false;
  }
}

async function swLoadDetail(type, index) {
  if (type == null || index == null) {
    SW.detail = null;
    return;
  }
  SW.detailLoading = true;
  swRenderDetail();
  try {
    SW.detail = await api('/api/config/shopwork/detail?type=' + encodeURIComponent(type) + '&index=' + encodeURIComponent(index));
    SW.notFound = '';
  } catch (e) {
    SW.detail = null;
    swRenderDetail();
    toast('加载商品失败：' + e.message, 'err');
    return;
  } finally {
    SW.detailLoading = false;
  }
  swRenderDetail();
}

function swRenderMeta() {
  const meta = swEl('swMeta');
  if (!meta) return;
  if (!SW.data) {
    meta.textContent = SW.loading ? '正在加载合成与商城数据…' : '';
    return;
  }
  const s = SW.data.stats;
  meta.textContent = [
    s.recipes + ' 个配方',
    s.recipeMaterialTotal + ' 条材料',
    s.goods + ' 条 UU 商品',
    s.mall + ' 件元宝商品',
    s.classes + ' 个大类',
    '问题 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info + ' 提示'
  ].join(' · ');
  swText('shopWorkCount', String(s.recipes + s.goods + s.mall));
  swText('swRecipeCount', String(s.recipes));
  swText('swGoodsCount', String(s.goods));
  swText('swMallCount', String(s.mall));
}

function swItemButton(item, label) {
  if (!item || item.index == null) return swEsc(label || (item && item.name) || '');
  const text = label || item.name;
  return '<button class="sw-link" data-shop-act="item" data-index="' + item.index + '">' + swEsc(text) + '</button>';
}

function swRenderTabs() {
  document.querySelectorAll('#swTabs [data-shop-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.shopTab === SW.tab);
  });
  const detailPane = swEl('swDetailPane');
  const healthPane = swEl('swHealthPane');
  if (detailPane) detailPane.classList.toggle('hidden', SW.tab !== 'detail');
  if (healthPane) healthPane.classList.toggle('hidden', SW.tab !== 'health');
}

function swSourceName(source) {
  return SW_SOURCE_LABEL[source] || source;
}

function swRenderSourceTabs() {
  document.querySelectorAll('#swSourceTabs [data-shop-source]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.shopSource === SW.source);
  });
  const input = swEl('swFilter');
  if (input) {
    input.placeholder = SW.source === 'recipe' ? '搜索配方 / 材料...' : '搜索商品 / 物品 / ID...';
  }
}

function swListMatch(row, q) {
  if (!q) return true;
  const parts = [row.name, row.dispname, row.id, row.version, row.classType, row.subType];
  if (row.materials) for (const mat of row.materials) parts.push(mat.name);
  return parts.some((v) => String(v == null ? '' : v).toLowerCase().includes(q));
}

function swRenderList() {
  const list = swEl('swList');
  const hint = swEl('swListHint');
  if (!list) return;
  swClear(list);
  if (!SW.data) {
    if (hint) hint.textContent = '正在加载…';
    return;
  }
  const rows = swSourceList(SW.source);
  const q = SW.filter.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (SW.flag === 'issues' && !row.issueCount) return false;
    return swListMatch(row, q);
  });
  const shown = filtered.slice(0, SW_LIST_LIMIT);
  for (const row of shown) {
    const li = document.createElement('li');
    li.className = 'file-item' + (SW.selected === row.index ? ' active' : '');
    li.dataset.shopIndex = String(row.index);
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = row.dispname || row.name || '（未命名）';
    if (row.issueCount) name.appendChild(swTag('异常 ' + row.issueCount, 'warn'));
    if (SW.source === 'mall' && row.hot) name.appendChild(swTag('热卖', 'hot'));
    if (row.duplicateId) name.appendChild(swTag('ID 重复', 'bad'));
    if (SW.source === 'goods' && row.mallCount) name.appendChild(swTag('商城同名', 'shop'));
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    if (SW.source === 'recipe') {
      meta.textContent = '材料 ' + row.materialCount + ' 种 · ' + row.line + ' 行';
    } else if (SW.source === 'goods') {
      meta.textContent = row.id + '-' + row.version + ' · 物品 #' + (row.item.index == null ? '?' : row.item.index);
    } else {
      meta.textContent = (row.classType || row.classId) + '/' + (row.subType || row.subId) +
        ' · ID ' + row.id + ' · ' + row.price + ' 元宝';
    }
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (!filtered.length) {
    const empty = document.createElement('li');
    empty.className = 'side-note';
    empty.textContent = '没有符合条件的' + swSourceName(SW.source) + '。';
    list.appendChild(empty);
  }
  if (hint) {
    hint.textContent = filtered.length > SW_LIST_LIMIT
      ? '显示前 ' + SW_LIST_LIMIT + ' 条，共 ' + filtered.length + ' 条；输入关键词或切换筛选缩小范围。'
      : '共 ' + filtered.length + ' ' + (SW_SOURCE_UNIT[SW.source] || '条') + '。';
  }
}

function swTag(text, cls) {
  const span = document.createElement('span');
  span.className = 'npw-tag' + (cls ? ' ' + cls : '');
  span.textContent = text;
  return span;
}

function swKv(label, value) {
  return '<div class="mpw-kv-item"><span class="k">' + swEsc(label) + '</span><span class="v">' +
    value + '</span></div>';
}

function swSection(title, note, body) {
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>' + swEsc(title) + '</strong>' +
    (note ? '<span class="muted">' + swEsc(note) + '</span>' : '') + '</div>' + body + '</div>';
}

function swIssueRow(issue) {
  const action = issue.action
    ? '<button class="btn btn-sm" data-shop-act="issue" data-source="' + swEsc(issue.action.view) +
      '" data-index="' + swEsc(issue.action.index) + '">查看</button>'
    : '';
  return '<div class="mon-issue mpw-issue">' +
    '<span class="mon-sev ' + swEsc(issue.severity) + '">' + swEsc(SW_SEV[issue.severity] || issue.severity) + '</span>' +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + swEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + swEsc(SW_ISSUE_GROUP[issue.code] || '') +
    (issue.line ? ' · 第 ' + issue.line + ' 行' : '') + '</div></div>' + action + '</div>';
}

function swRenderIssues(issues, title) {
  const list = issues || [];
  if (!list.length) return '<div class="mpw-section"><div class="mpw-section-head"><strong>' +
    swEsc(title) + '</strong><span class="muted">0 项</span></div>' +
    '<div class="mpw-empty">没有发现异常。</div></div>';
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>' + swEsc(title) +
    '</strong><span class="muted">' + list.length + ' 项</span></div>' +
    '<div class="mpw-rows">' + list.map(swIssueRow).join('') + '</div></div>';
}

function swRenderRecipe(d) {
  const r = d.recipe;
  const tags = [
    r.product.exists ? swBadge('产物 #' + r.product.index, 'ok') : swBadge('产物缺失', 'bad'),
    swBadge('材料 ' + r.materialCount + ' 种')
  ];
  if (r.issueCount) tags.push(swBadge('异常 ' + r.issueCount, 'bad'));
  const head = '<div class="mpw-map-head"><div><strong>' + swEsc(r.name) + '</strong>' +
    '<div class="muted">配方第 ' + r.line + ' 行 · 材料合计 ' + r.materialTotal + ' 个</div></div>' +
    '<div class="mpw-head-tags">' + tags.join('') + '</div></div>';
  const actions = '<div class="mpw-actions">' +
    '<button class="btn btn-sm" data-shop-act="recipe-edit" data-index="' + r.index + '">在合成配置中打开</button>' +
    (r.product.exists ? '<button class="btn btn-sm" data-shop-act="item" data-index="' + r.product.index + '">查看产物物品</button>' : '') +
    '</div>';
  const overview = '<div class="mpw-kv">' +
    swKv('产物', swItemButton(r.product)) +
    swKv('材料种类', r.materialCount + ' 种') +
    swKv('材料总量', r.materialTotal + ' 个') +
    swKv('配置行', '第 ' + r.line + ' 行') +
    '</div>';

  const productRow = '<div class="sw-product-row">' +
    '<div class="sw-product-name">' + swEsc(r.name) + '</div>' +
    '<div class="muted">' + (r.product.exists ? '物品 #' + r.product.index : '物品库中不存在') + '</div>' +
    '</div>';
  const matRows = r.materials.map((it) =>
    '<div class="mpw-row"><div class="mpw-row-main">' +
    '<span class="mpw-name">' + swItemButton(it.item, it.name) + '</span>' +
    '<span class="muted">×' + it.count + ' · 第 ' + it.line + ' 行</span>' +
    (it.producedBy.length ? '<span class="sw-note">由配方 ' + it.producedBy.map((p) => swEsc(p.name)).join('、') + ' 产出</span>' : '') +
    '</div><div class="mpw-row-side">' + (it.item.exists ? '物品 #' + it.item.index : swBadge('缺失', 'bad')) + '</div></div>'
  ).join('');
  const relation = '<div class="mpw-section"><div class="mpw-section-head"><strong>材料 → 产物</strong>' +
    '<span class="muted">' + r.materialCount + ' 种材料</span></div>' +
    '<div class="sw-recipe-line">' + matRows + productRow + '</div></div>';

  const used = d.usedAsMaterial && d.usedAsMaterial.length
    ? '<div class="mpw-section"><div class="mpw-section-head"><strong>该产物也被用作材料</strong>' +
      '<span class="muted">' + d.usedAsMaterial.length + ' 个配方</span></div><div class="mpw-rows">' +
      d.usedAsMaterial.map((p) => '<div class="mpw-row"><div class="mpw-row-main">' +
        '<button class="sw-link" data-shop-act="view" data-source="recipe" data-index="' + p.index + '">' +
        swEsc(p.name) + '</button></div></div>').join('') + '</div></div>'
    : '';

  return head + actions + overview + relation + used + swRenderIssues(d.issues, '配方体检');
}

function swRenderGoods(d) {
  const g = d.goods;
  const tags = [
    g.item.exists ? swBadge('物品 #' + g.item.index, 'ok') : swBadge('物品缺失', 'bad'),
    swBadge(g.versionOk ? '版本有效' : '版本异常', g.versionOk ? '' : 'bad')
  ];
  if (g.issueCount) tags.push(swBadge('异常 ' + g.issueCount, 'bad'));
  const head = '<div class="mpw-map-head"><div><strong>' + swEsc(g.name) + '</strong>' +
    '<div class="muted">' + swEsc(g.id + '-' + g.version) + ' · 第 ' + g.line + ' 行</div></div>' +
    '<div class="mpw-head-tags">' + tags.join('') + '</div></div>';
  const actions = '<div class="mpw-actions">' +
    '<button class="btn btn-sm" data-shop-act="goods-edit" data-index="' + g.index + '">在 UU 商城配置中打开</button>' +
    (g.item.exists ? '<button class="btn btn-sm" data-shop-act="item" data-index="' + g.item.index + '">查看关联物品</button>' : '') +
    '</div>';
  const overview = '<div class="mpw-kv">' +
    swKv('商品 ID', swEsc(g.id)) +
    swKv('版本', swEsc(g.version)) +
    swKv('关联物品', swItemButton(g.item)) +
    swKv('元宝商城同款', d.mallMatches.length + ' 件') +
    swKv('配置行', '第 ' + g.line + ' 行') +
    '</div>';
  const matches = d.mallMatches.length
    ? '<div class="mpw-section"><div class="mpw-section-head"><strong>元宝商城同款</strong>' +
      '<span class="muted">' + d.mallMatches.length + ' 件</span></div><div class="mpw-rows">' +
      d.mallMatches.map((it) => '<div class="mpw-row"><div class="mpw-row-main">' +
        '<button class="sw-link" data-shop-act="view" data-source="mall" data-index="' + it.index + '">' +
        swEsc(it.dispname || it.name) + '</button>' +
        '<span class="muted">' + swEsc((it.classType || it.classId) + ' / ' + (it.subType || it.subId)) + '</span></div>' +
        '<div class="mpw-row-side">' + it.price + ' 元宝</div></div>').join('') + '</div></div>'
    : '<div class="mpw-section"><div class="mpw-section-head"><strong>元宝商城同款</strong>' +
      '<span class="muted">0 件</span></div><div class="mpw-empty">元宝商城中没有同名商品。</div></div>';
  return head + actions + overview + matches + swRenderIssues(d.issues, 'UU 商品体检');
}

function swRelatedMall(list, title, empty) {
  if (!list.length) return swSection(title, '0 件', '<div class="mpw-empty">' + swEsc(empty) + '</div>');
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>' + swEsc(title) +
    '</strong><span class="muted">' + list.length + ' 件</span></div><div class="mpw-rows">' +
    list.map((it) => '<div class="mpw-row"><div class="mpw-row-main">' +
      '<button class="sw-link" data-shop-act="view" data-source="mall" data-index="' + it.index + '">' +
      swEsc(it.dispname || it.name) + '</button>' +
      '<span class="muted">' + swEsc((it.classType || it.classId) + ' / ' + (it.subType || it.subId)) +
      ' · ID ' + swEsc(it.id) + '</span></div><div class="mpw-row-side">' + it.price + ' 元宝</div></div>').join('') +
    '</div></div>';
}

function swRenderMall(d) {
  const it = d.item;
  const tags = [
    it.item.exists ? swBadge('物品 #' + it.item.index, 'ok') : swBadge('物品缺失', 'bad')
  ];
  if (it.hot) tags.push(swBadge('热卖', 'hot'));
  if (it.duplicateId) tags.push(swBadge('ID 重复', 'bad'));
  if (it.goodsCount) tags.push(swBadge('UU 同名', ''));
  if (it.issueCount) tags.push(swBadge('异常 ' + it.issueCount, 'bad'));
  const head = '<div class="mpw-map-head"><div><strong>' + swEsc(it.dispname || it.name) + '</strong>' +
    '<div class="muted">' + swEsc((it.classType || it.classId) + ' / ' + (it.subType || it.subId)) +
    ' · ID ' + swEsc(it.id) + ' · ' + it.price + ' 元宝</div></div>' +
    '<div class="mpw-head-tags">' + tags.join('') + '</div></div>';
  const actions = '<div class="mpw-actions">' +
    '<button class="btn btn-sm" data-shop-act="mall-edit" data-index="' + it.index + '">在商城配置中打开</button>' +
    (it.item.exists ? '<button class="btn btn-sm" data-shop-act="item" data-index="' + it.item.index + '">查看关联物品</button>' : '') +
    '</div>';
  const overview = '<div class="mpw-kv">' +
    swKv('商品名称', swEsc(it.name)) +
    swKv('商品 ID', swEsc(it.id)) +
    swKv('价格', it.price + ' 元宝') +
    swKv('单位数量', String(it.unitnum)) +
    swKv('外观 looks', String(it.looks)) +
    swKv('大图 biglooks', swEsc(it.biglooks || '—')) +
    swKv('配置行', '第 ' + it.line + ' 行') +
    swKv('关联物品', swItemButton(it.item)) +
    '</div>';
  const desc = it.desc
    ? swSection('商品描述', '', '<div class="sw-desc">' + swMultiline(it.desc) + '</div>')
    : '';
  const hot = d.hot
    ? swSection('热卖状态', '', '<div class="sw-hot-line">' + swBadge('商城热卖', 'hot') +
      ' 热卖价 ' + d.hot.price + ' 元宝 · 第 ' + d.hot.line + ' 行</div>')
    : swSection('热卖状态', '', '<div class="mpw-empty">该商品未配置在热卖区。</div>');
  const sameId = swRelatedMall(d.sameId, '同 ID 的其他商品', '没有其他同 ID 商品。');
  const sameName = swRelatedMall(d.sameName, '同名的其他商品', '没有其他同名商品。');
  const goodsMatches = d.goodsMatches.length
    ? '<div class="mpw-section"><div class="mpw-section-head"><strong>UU 商城同名商品</strong>' +
      '<span class="muted">' + d.goodsMatches.length + ' 条</span></div><div class="mpw-rows">' +
      d.goodsMatches.map((g) => '<div class="mpw-row"><div class="mpw-row-main">' +
        '<button class="sw-link" data-shop-act="view" data-source="goods" data-index="' + g.index + '">' +
        swEsc(g.name) + '</button><span class="muted">' + swEsc(g.id + '-' + g.version) + '</span></div></div>').join('') +
      '</div></div>'
    : swSection('UU 商城同名商品', '0 条', '<div class="mpw-empty">UU 商城没有同名商品。</div>');
  return head + actions + overview + desc + hot + sameId + sameName + goodsMatches +
    swRenderIssues(d.issues, '元宝商品体检');
}

function swIntro() {
  if (!SW.data) return '<div class="mpw-empty">正在加载合成与商城数据…</div>';
  const s = SW.data.stats;
  return '<div class="sw-intro">' +
    '<h3>合成 / 商城工作台</h3>' +
    '<p>左侧可在「配方」「UU 商城」「元宝商城」之间切换，查看材料与产物关系、商品分类、价格和跨商城同款，并跳转到现有编辑器修改。</p>' +
    '<p>当前 ' + s.recipes + ' 个配方（' + s.recipeMaterialTotal + ' 条材料引用）、' + s.goods +
    ' 条 UU 商品、' + s.mall + ' 件元宝商品（' + s.classes + ' 个大类 / ' + s.subclasses +
    ' 个子类、' + s.hot + ' 件热卖）。两个商城有 ' + s.goodsMallOverlap + ' 个同名商品。</p>' +
    '<p>体检发现 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info +
    ' 提示，点击顶部「配置体检」集中查看。</p></div>';
}

function swRenderDetail() {
  const box = swEl('swDetail');
  if (!box) return;
  if (!SW.data) {
    box.innerHTML = '<div class="mpw-empty">正在加载合成与商城数据…</div>';
    return;
  }
  if (SW.tab !== 'detail') return;
  if (SW.selected == null) {
    box.innerHTML = SW.notFound
      ? '<div class="mpw-empty">未找到该商品（' + swEsc(SW.notFound) + '）。</div>'
      : swIntro();
    return;
  }
  if (SW.detailLoading && !SW.detail) {
    box.innerHTML = '<div class="mpw-empty">正在加载「' + swEsc(SW_SOURCE_LABEL[SW.source] + ' #' + (SW.selected + 1)) + '」…</div>';
    return;
  }
  const d = SW.detail;
  if (!d) {
    box.innerHTML = '<div class="mpw-empty">未找到该商品。</div>';
    return;
  }
  if (d.type === 'recipe') box.innerHTML = swRenderRecipe(d);
  else if (d.type === 'goods') box.innerHTML = swRenderGoods(d);
  else box.innerHTML = swRenderMall(d);
}

function swIssueGroupName(issue) {
  if (String(issue.code || '').indexOf('unreadable') >= 0) return '读取失败';
  return SW_ISSUE_GROUP[issue.code] || '其他';
}

function swRenderHealth() {
  const box = swEl('swHealthList');
  if (!box) return;
  if (!SW.data) {
    box.innerHTML = '<div class="mpw-empty">正在加载…</div>';
    return;
  }
  const issues = SW.data.issues || [];
  if (!issues.length) {
    box.innerHTML = '<div class="mpw-empty">合成与商城配置没有发现异常。</div>';
    return;
  }
  const groups = {};
  for (const issue of issues) {
    const name = swIssueGroupName(issue);
    if (!groups[name]) groups[name] = [];
    groups[name].push(issue);
  }
  const order = ['读取失败', '物品库', '配方', 'UU商城', '元宝商城', '其他'];
  let html = '';
  for (const name of order) {
    const list = groups[name];
    if (!list) continue;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of list) counts[issue.severity]++;
    html += '<div class="mon-issue-group"><div class="mon-issue-head"><strong>' + swEsc(name) +
      '</strong><span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' +
      counts.warn + ' 警告 / ' + counts.info + ' 提示</span></div>' +
      list.map(swIssueRow).join('') + '</div>';
  }
  box.innerHTML = html;
}

function swRenderAll() {
  swRenderMeta();
  swRenderTabs();
  swRenderSourceTabs();
  swRenderList();
  swRenderDetail();
  swRenderHealth();
}

async function swSelect(source, index) {
  if (SW_SOURCES.indexOf(source) < 0) return;
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return;
  SW.source = source;
  SW.selected = null;
  SW.detail = null;
  SW.notFound = '';
  SW.tab = 'detail';
  const row = swSourceList(source).find((it) => it.index === i);
  if (!row) {
    SW.notFound = source + '-' + i;
    swRenderAll();
    swSetHash({ tab: 'detail' });
    return;
  }
  SW.selected = i;
  swRenderAll();
  await swLoadDetail(source, i);
  swSetHash({ tab: 'detail', source, index: i });
  const li = document.querySelector('#swList [data-shop-index="' + i + '"]');
  if (li) li.scrollIntoView({ block: 'nearest' });
}

async function swSwitchSource(source) {
  if (SW_SOURCES.indexOf(source) < 0 || source === SW.source) return;
  SW.source = source;
  SW.selected = null;
  SW.detail = null;
  SW.notFound = '';
  SW.tab = 'detail';
  SW.filter = '';
  SW.flag = 'all';
  const input = swEl('swFilter');
  if (input) input.value = '';
  document.querySelectorAll('#swFlagFilter [data-shop-flag]').forEach((b) => {
    b.classList.toggle('active', b.dataset.shopFlag === 'all');
  });
  swRenderAll();
  swSetHash({ tab: 'detail' });
}

async function swGotoItem(index) {
  if (index == null || typeof window.openItemWorkView !== 'function') {
    toast('物品工作台不可用', 'err');
    return;
  }
  await window.openItemWorkView(Number(index));
}

async function swEditRecipe(index) {
  if (typeof window.openMakeitemAt === 'function') {
    await window.openMakeitemAt(Number(index));
    return;
  }
  if (typeof window.openMakeitem === 'function') await window.openMakeitem(true);
}

async function swEditGoods(index) {
  if (typeof window.openGoodsAt === 'function') {
    await window.openGoodsAt(Number(index));
    return;
  }
  if (typeof window.openGoodsConfig === 'function') await window.openGoodsConfig(true);
}

async function swEditMall(index) {
  if (typeof window.openMallAt === 'function') {
    await window.openMallAt(Number(index));
    return;
  }
  if (typeof window.openMallConfig === 'function') await window.openMallConfig(true);
}

async function openShopView(sel) {
  if (S.mode !== 'shopwork' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'shopwork';
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
  if (window.hideScriptWorkView) window.hideScriptWorkView();
  if (window.hideCastleWorkView) window.hideCastleWorkView();
  if (window.hideTextWorkView) window.hideTextWorkView();
  if (window.hideStarterWorkView) window.hideStarterWorkView();
  if (window.hideHealthWorkView) window.hideHealthWorkView();
  if (window.hideYswView) window.hideYswView();
  const dbView = swEl('dbView');
  const dropView = swEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = swEl('shopWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('shw');
  const target = sel || swHashState() || { tab: SW.tab };
  if (target.tab && SW_TAB_KEYS.indexOf(target.tab) >= 0) SW.tab = target.tab;
  if (target.source && SW_SOURCES.indexOf(target.source) >= 0) SW.source = target.source;
  if (!SW.data || SW.stale) {
    try {
      await swLoad();
    } catch (e) {
      swRenderAll();
      toast('加载合成商城数据失败：' + e.message, 'err');
      return;
    }
  }
  if (SW.tab === 'detail') {
    if (target.index != null) {
      swRenderAll();
      await swSelect(SW.source, target.index);
      return;
    }
    SW.selected = null;
    SW.detail = null;
    if (sel && sel.index == null && target.tab !== 'health') SW.notFound = '';
  }
  swRenderAll();
  if (SW.tab === 'health') swSetHash({ tab: 'health' });
  else swSetHash({ tab: 'detail' });
}

window.openShopView = openShopView;
window.hideShopWorkView = () => {
  const view = swEl('shopWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && swHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshShopWorkState = (st) => {
  const info = st && st.configs ? st.configs.shopwork : null;
  if (info && info.stats) swText('shopWorkCount', String(info.stats.recipes + info.stats.goods + info.stats.mall));
  SW.stale = true;
  if (S.mode === 'shopwork') swRenderMeta();
};
window.updateShopWorkMeta = swRenderMeta;

function swBindEvents() {
  const filter = swEl('swFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(SW.searchTimer);
      SW.searchTimer = setTimeout(() => {
        SW.filter = filter.value;
        swRenderList();
      }, 150);
    });
  }
  document.querySelectorAll('#swSourceTabs [data-shop-source]').forEach((btn) => {
    btn.addEventListener('click', () => swSwitchSource(btn.dataset.shopSource));
  });
  document.querySelectorAll('#swFlagFilter [data-shop-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      SW.flag = btn.dataset.shopFlag;
      document.querySelectorAll('#swFlagFilter [data-shop-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      swRenderList();
    });
  });
  const list = swEl('swList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-shop-index]');
      if (!li) return;
      swSelect(SW.source, Number(li.dataset.shopIndex));
    });
  }
  const tabs = swEl('swTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shop-tab]');
      if (!btn) return;
      SW.tab = btn.dataset.shopTab;
      swRenderTabs();
      swRenderDetail();
      swRenderHealth();
      if (SW.tab === 'health') swSetHash({ tab: 'health' });
      else if (SW.selected != null) swSetHash({ tab: 'detail', source: SW.source, index: SW.selected });
      else swSetHash({ tab: 'detail' });
    });
  }
  const detail = swEl('swDetail');
  if (detail) {
    detail.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-shop-act]');
      if (!btn) return;
      const act = btn.dataset.shopAct;
      const index = btn.dataset.index == null ? null : Number(btn.dataset.index);
      if (act === 'item') await swGotoItem(index);
      else if (act === 'recipe-edit') await swEditRecipe(index);
      else if (act === 'goods-edit') await swEditGoods(index);
      else if (act === 'mall-edit') await swEditMall(index);
      else if (act === 'view') await swSelect(btn.dataset.source, index);
      else if (act === 'issue') {
        const source = btn.dataset.source;
        await swSelect(source, index);
        SW.tab = 'detail';
        swRenderTabs();
      }
    });
  }
  const health = swEl('swHealthList');
  if (health) {
    health.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-shop-act="issue"]');
      if (!btn) return;
      await swSelect(btn.dataset.source, Number(btn.dataset.index));
      SW.tab = 'detail';
      swRenderTabs();
      swRenderDetail();
    });
  }
  const reload = swEl('btnSwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        await swLoad(true);
        if (SW.selected != null) await swLoadDetail(SW.source, SW.selected);
        swRenderAll();
        toast('已重新检查合成与商城配置', 'ok');
      } catch (e) {
        swRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const state = swHashState();
    if (state) openShopView(state);
  });
}

swBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = swHashState();
    if (state) openShopView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = swHashState();
    if (state) openShopView(state);
  });
}

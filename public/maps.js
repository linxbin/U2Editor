'use strict';

/* 地图工作台：MapInfo 规则 + 地图文件 + NPC + 刷怪 + 小地图聚合（只读，跳转现有编辑） */

const MPW = {
  data: null,
  detail: null,
  key: null,
  notFound: '',
  loading: false,
  detailLoading: false,
  stale: true,
  tab: 'detail',
  filter: '',
  flag: 'all',
  searchTimer: null
};

const MPW_TAB_KEYS = ['detail', 'health'];
const MPW_SIDE_LIMIT = 1000;
const MPW_ROW_LIMIT = 500;

const MPW_SEV = { error: '错误', warn: '警告', info: '提示' };

const MPW_WORLD_LABEL = {
  'WORLD MAP': '世界地图',
  'AREA MAP': '区域地图'
};

const MPW_SOURCE_LABEL = {
  mapinfo: 'MapInfo',
  file: '地图文件',
  minilist: '小地图列表',
  minimap: '小地图编号',
  npc: 'NPC',
  spawn: '刷怪',
  rule: 'MapInfo 规则',
  reference: '跳转目标'
};

const MPW_RULE_ORDER = ['jump', 'nofight', 'sabukarea', 'sabukjump', 'redvillage', 'property', 'plantrange'];

const MPW_RULE_LABEL = {
  jump: '地图跳转点',
  nofight: '安全区 / 出生点',
  sabukarea: '沙巴克战区',
  sabukjump: '沙巴克跳转点',
  redvillage: '红名村区域',
  property: '地图综合属性',
  plantrange: '植物范围'
};

const MPW_ISSUE_LABEL = {
  map_mapinfo_unreadable: 'MapInfo 读取失败',
  map_rules_unreadable: 'MapInfo 规则读取失败',
  map_npc_unreadable: 'NPCList 读取失败',
  map_mongen_unreadable: 'Mongen 读取失败',
  map_minimap_unreadable: 'MiniMap 读取失败',
  map_minilist_unreadable: 'minmaplist 读取失败',
  map_npc_coord_over: 'NPC 坐标越界',
  map_spawn_coord_over: '刷怪坐标越界',
  map_rule_coord_over: '规则坐标越界',
  map_jump_target_missing: '跳转目标未登记',
  map_jump_target_over: '跳转目标坐标越界',
  map_rule_unparsed: 'MapInfo 行无法解析',
  map_unknown: '地图未登记',
  map_file_orphan: '地图文件未登记',
  map_file_missing: '地图文件缺失'
};

function mpwEl(id) {
  return document.getElementById(id);
}

function mpwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mpwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function mpwText(id, text) {
  const el = mpwEl(id);
  if (el) el.textContent = text;
}

function mpwBadge(text, cls) {
  return '<span class="mpw-badge' + (cls ? ' ' + cls : '') + '">' + mpwEsc(text) + '</span>';
}

function mpwHashState() {
  const m = /^#maps(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  const raw = m[1] || '';
  if (!raw) return { tab: 'detail' };
  if (raw === 'health') return { tab: 'health' };
  if (raw.startsWith('map-')) {
    let key = raw.slice(4);
    try {
      key = decodeURIComponent(key);
    } catch (e) {
    }
    return { tab: 'detail', key: key || null };
  }
  return { tab: 'detail' };
}

function mpwSetHash(sel) {
  let raw = '';
  if (sel && sel.tab === 'health') raw = 'health';
  else if (sel && sel.key) raw = 'map-' + encodeURIComponent(sel.key);
  const next = raw ? '#maps=' + raw : '#maps';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function mpwLoad(refresh) {
  if (MPW.loading) return;
  MPW.loading = true;
  mpwRenderMeta();
  try {
    const data = await api('/api/config/maps' + (refresh ? '?refresh=1' : ''));
    MPW.data = data;
    MPW.stale = false;
    mpwText('mapWorkCount', String(data.stats.maps));
    if (MPW.key && !data.maps.some((m) => m.key === MPW.key)) {
      MPW.key = null;
      MPW.detail = null;
    }
  } finally {
    MPW.loading = false;
  }
}

async function mpwLoadDetail(key) {
  if (!key) {
    MPW.detail = null;
    return;
  }
  MPW.detailLoading = true;
  mpwRenderDetail();
  try {
    MPW.detail = await api('/api/config/maps/detail?key=' + encodeURIComponent(key));
    if (MPW.detail && MPW.detail.map) MPW.key = MPW.detail.map.key;
  } catch (e) {
    MPW.detail = null;
    mpwRenderDetail();
    toast('加载地图失败：' + e.message, 'err');
    return;
  } finally {
    MPW.detailLoading = false;
  }
  mpwRenderDetail();
}

function mpwRenderMeta() {
  const meta = mpwEl('mpwMeta');
  if (!meta) return;
  if (!MPW.data) {
    meta.textContent = MPW.loading ? '正在加载地图数据…' : '';
    return;
  }
  const s = MPW.data.stats;
  meta.textContent = [
    s.maps + ' 张地图',
    s.registered + ' 已登记',
    s.npcs + ' 个 NPC',
    s.spawns + ' 条刷怪',
    '问题 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info + ' 提示'
  ].join(' · ');
  mpwText('mapWorkCount', String(s.maps));
}

function mpwRenderTabs() {
  document.querySelectorAll('#mpwTabs [data-mpw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mpwTab === MPW.tab);
  });
  const panes = { detail: 'mpwDetailPane', health: 'mpwHealthPane' };
  Object.keys(panes).forEach((key) => {
    const el = mpwEl(panes[key]);
    if (el) el.classList.toggle('hidden', key !== MPW.tab);
  });
}

function mpwSelectTab(tab) {
  if (MPW_TAB_KEYS.indexOf(tab) < 0) return;
  MPW.tab = tab;
  mpwRenderTabs();
  if (tab === 'health') {
    mpwRenderHealth();
    mpwSetHash({ tab: 'health' });
  } else {
    mpwRenderDetail();
    mpwSetHash({ tab: 'detail', key: MPW.key });
  }
}

function mpwMapFlagMatch(map) {
  if (MPW.flag === 'attention') return map.attention;
  if (MPW.flag === 'unknown') return !map.known;
  if (MPW.flag === 'orphan') return map.file && !map.known;
  return true;
}

function mpwMapBadges(map) {
  const out = [];
  if (!map.known) out.push(mpwBadge('未登记', 'bad'));
  if (map.known && !map.file) out.push(mpwBadge('缺文件', 'warn'));
  if (map.attention) out.push(mpwBadge('有异常', 'warn'));
  return out.join('');
}

function mpwRenderList() {
  const list = mpwEl('mpwList');
  const hint = mpwEl('mpwListHint');
  if (!list) return;
  mpwClear(list);
  if (!MPW.data) {
    if (hint) hint.textContent = MPW.loading ? '正在加载地图…' : '';
    return;
  }
  const q = MPW.filter.trim().toLowerCase();
  const all = MPW.data.maps.filter((map) => {
    if (!mpwMapFlagMatch(map)) return false;
    if (!q) return true;
    return map.map.toLowerCase().includes(q) ||
      String(map.name || '').toLowerCase().includes(q) ||
      String(map.miniName || '').toLowerCase().includes(q);
  });
  for (const map of all.slice(0, MPW_SIDE_LIMIT)) {
    const li = document.createElement('li');
    li.className = 'file-item' + (MPW.key === map.key ? ' active' : '');
    li.dataset.mpwKey = map.key;
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = map.map + (map.name ? ' · ' + map.name : '');
    name.insertAdjacentHTML('beforeend', mpwMapBadges(map));
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    const dims = map.width && map.height ? map.width + 'x' + map.height : '尺寸未知';
    meta.textContent = [
      dims,
      'NPC ' + map.npcs,
      '刷怪 ' + map.spawns + ' 条',
      '规则 ' + map.rules
    ].join(' · ');
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (!all.length) {
    const empty = document.createElement('li');
    empty.className = 'side-note';
    empty.textContent = '没有符合条件的地图。';
    list.appendChild(empty);
  }
  if (hint) {
    hint.textContent = all.length > MPW_SIDE_LIMIT
      ? '共 ' + all.length + ' 张地图，当前显示前 ' + MPW_SIDE_LIMIT + ' 张；可输入关键词缩小范围。'
      : '共 ' + all.length + ' 张地图。';
  }
}

function mpwRuleMain(section, item) {
  const v = item.values;
  if (section === 'jump' || section === 'sabukjump') {
    return '<span class="mpw-row-main"><code>' + mpwEsc(v.map + '  ' + v.x + ',' + v.y + ' → ' + v.dest + '  ' + v.dx + ',' + v.dy) + '</code></span>';
  }
  if (section === 'nofight') {
    return '<span class="mpw-row-main"><code>' + mpwEsc(v.x + ',' + v.y) + '</code></span>' +
      '<span class="mpw-row-meta">安全半径 ' + v.safeRadius + ' · 城镇范围 ' + v.townRadius + ' · 出生点 ' + v.spawn + '</span>';
  }
  if (section === 'property') {
    return '<span class="mpw-rule-flags">' + mpwEsc(v.flags) + '</span>';
  }
  return '<span class="mpw-row-main"><code>' + mpwEsc(v.x + ',' + v.y) + '</code></span>' +
    '<span class="mpw-row-meta">半径 ' + v.radius + '</span>';
}

function mpwRuleRow(section, item, key) {
  const tags = [];
  if (section === 'jump' || section === 'sabukjump') {
    if (item.destKnown === false) tags.push(mpwBadge('目标未登记', 'bad'));
    if (item.destOutOfBounds) tags.push(mpwBadge('目标越界', 'bad'));
    if (item.destKnown && item.destFile === false) tags.push(mpwBadge('目标缺文件', 'warn'));
  }
  const bad = tags.some((t) => t.indexOf('bad') >= 0);
  return '<div class="mpw-row' + (bad ? ' bad' : '') + '">' +
    mpwRuleMain(section, item) +
    '<span class="mpw-line-no">第 ' + (item.line + 1) + ' 行</span>' +
    (tags.length ? '<span class="mpw-tags">' + tags.join('') + '</span>' : '') +
    '<button class="btn btn-sm ghost mpw-row-btn" data-mpw-act="rule" data-key="' + mpwEsc(key) +
    '" data-section="' + mpwEsc(section) + '">编辑</button>' +
    '</div>';
}

function mpwDetailIntro() {
  const s = MPW.data.stats;
  return '<div class="mpw-intro">' +
    '<div class="mpw-intro-title">地图工作台</div>' +
    '<p>左侧选择地图，查看地图文件、尺寸、小地图编号、MapInfo 规则、NPC 与刷怪分布，并可跳转到现有编辑器修改。</p>' +
    '<p>当前共 ' + s.maps + ' 张地图（MapInfo 登记 ' + s.registered + ' 张），地图文件 ' + s.mapFiles +
    ' 个；未登记但被 NPC/刷怪使用 ' + s.usageUnknown + ' 张，未登记地图文件 ' + s.filesOrphan +
    ' 个，坐标越界 ' + s.oob + ' 处。</p>' +
    '<p>NPC ' + s.npcs + ' 个，刷怪 ' + s.spawns + ' 条，MapInfo 规则 ' + s.rules +
    ' 条；点击「配置体检」可集中查看未登记、缺文件、跳转目标异常和坐标越界。</p>' +
    '</div>';
}

function mpwRenderOverview(map, d) {
  const mini = map.mini && map.mini !== '00000'
    ? map.mini + (map.miniName ? ' · ' + map.miniName : '')
    : '未配置';
  const kv = [
    ['MapInfo', map.known ? '已登记' + (map.name ? ' · ' + map.name : '') : '未登记'],
    ['地图文件', map.file ? 'map/' + map.map + '.map' : '缺失'],
    ['地图尺寸', map.width && map.height ? map.width + 'x' + map.height : '未知'],
    ['小地图', mini],
    ['区域', MPW_WORLD_LABEL[map.world] || map.world || '—'],
    ['NPC', map.npcs + ' 个'],
    ['刷怪', map.spawns + ' 条 · ' + map.spawnTotal + ' 只 · ' + map.spawnMonsters + ' 种怪物'],
    ['跳转', '出 ' + map.jumpOut + ' · 入 ' + map.jumpIn],
    ['安全区', map.safeAreas + ' 个 · 其他区域 ' + map.areas + ' 个'],
    ['使用来源', (map.used || []).map((s) => MPW_SOURCE_LABEL[s] || s).join('、') || '—']
  ];
  return '<div class="mpw-kv">' + kv.map(([k, v]) =>
    '<div class="mpw-kv-item"><span class="k">' + mpwEsc(k) + '</span><span class="v">' + mpwEsc(v) + '</span></div>'
  ).join('') + '</div>';
}

function mpwRenderRules(map, d) {
  const sections = MPW_RULE_ORDER.filter((key) => d.rules[key] && d.rules[key].length);
  if (!sections.length) return '<div class="mpw-empty">这张地图没有可解析的 MapInfo 规则。</div>';
  let remaining = MPW_ROW_LIMIT;
  const blocks = [];
  for (const key of sections) {
    if (remaining <= 0) break;
    const rows = d.rules[key].slice(0, remaining);
    remaining -= rows.length;
    blocks.push('<div class="mpw-section"><div class="mpw-section-head"><strong>' +
      mpwEsc(MPW_RULE_LABEL[key] || key) + '</strong><span class="muted">' + d.rules[key].length + ' 条</span>' +
      '<button class="btn btn-sm ghost" data-mpw-act="rule" data-key="' + mpwEsc(map.key) +
      '" data-section="' + mpwEsc(key) + '">在 MapInfo 中打开</button></div>' +
      '<div class="mpw-rows">' + rows.map((item) => mpwRuleRow(key, item, map.key)).join('') + '</div></div>');
  }
  if (remaining <= 0) blocks.push('<div class="mpw-groups-hint">规则较多，仅显示前 ' + MPW_ROW_LIMIT + ' 条；完整内容请到 MapInfo 编辑器查看。</div>');
  return blocks.join('');
}

function mpwRenderIncoming(map, d) {
  if (!d.incoming || !d.incoming.length) return '';
  const rows = d.incoming.slice(0, MPW_ROW_LIMIT).map((item) => {
    const v = item.values;
    return '<div class="mpw-row">' +
      '<span class="mpw-row-main"><code>' + mpwEsc(v.map + '  ' + v.x + ',' + v.y + ' → ' + v.dest + '  ' + v.dx + ',' + v.dy) + '</code></span>' +
      '<span class="mpw-line-no">第 ' + (item.line + 1) + ' 行</span>' +
      '<button class="btn btn-sm ghost mpw-row-btn" data-mpw-act="map" data-key="' + mpwEsc(item.sourceKey) + '">查看源地图</button>' +
      '<button class="btn btn-sm ghost mpw-row-btn" data-mpw-act="rule" data-key="' + mpwEsc(item.sourceKey) +
      '" data-section="' + mpwEsc(item.section) + '">编辑</button>' +
      '</div>';
  });
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>跳入本图的跳转点</strong>' +
    '<span class="muted">' + d.incoming.length + ' 条</span></div>' +
    '<div class="mpw-rows">' + rows.join('') + '</div></div>';
}

function mpwRenderNpcs(map, d) {
  if (!d.npcs.length) return '';
  const rows = d.npcs.slice(0, MPW_ROW_LIMIT).map((npc) =>
    '<div class="mpw-row' + (npc.outOfBounds ? ' bad' : '') + '">' +
    '<span class="mpw-npc-name">' + mpwEsc(npc.name) + '</span>' +
    '<span class="mpw-row-meta">' + mpwEsc(npc.script) + ' · ' + mpwEsc(npc.x + ',' + npc.y) +
    ' · ID ' + mpwEsc(npc.id) + '</span>' +
    (npc.outOfBounds ? '<span class="mpw-tags">' + mpwBadge('越界', 'bad') + '</span>' : '') +
    '<span class="mpw-line-no">第 ' + (npc.line + 1) + ' 行</span>' +
    '<button class="btn btn-sm ghost mpw-row-btn" data-mpw-act="npc" data-index="' + npc.index + '">NPC 详情</button>' +
    '</div>'
  );
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>地图 NPC</strong>' +
    '<span class="muted">' + d.npcs.length + ' 个</span>' +
    '<button class="btn btn-sm ghost" data-mpw-act="npc-map" data-key="' + mpwEsc(map.key) + '">在 NPC 工作台筛选本图</button></div>' +
    '<div class="mpw-rows">' + rows.join('') + '</div>' +
    (d.npcs.length > MPW_ROW_LIMIT ? '<div class="mpw-groups-hint">仅显示前 ' + MPW_ROW_LIMIT + ' 个 NPC。</div>' : '') +
    '</div>';
}

function mpwRenderSpawns(map, d) {
  if (!d.spawns.length) return '';
  const rows = d.spawns.slice(0, MPW_ROW_LIMIT).map((row) =>
    '<div class="mpw-row' + (row.outOfBounds ? ' bad' : '') + '">' +
    '<span class="mpw-row-main">' + mpwEsc(row.monster) + '</span>' +
    '<span class="mpw-row-meta">' + mpwEsc(row.x + ',' + row.y) + ' · 范围 ' + row.range +
    ' · 数量 ' + row.count + ' · 间隔 ' + row.interval + '</span>' +
    (row.outOfBounds ? '<span class="mpw-tags">' + mpwBadge('越界', 'bad') + '</span>' : '') +
    '<span class="mpw-line-no">第 ' + (row.line + 1) + ' 行</span>' +
    '<button class="btn btn-sm ghost mpw-row-btn" data-mpw-act="spawn" data-index="' + row.index +
    '" data-key="' + mpwEsc(map.key) + '">配置</button>' +
    '</div>'
  );
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>刷怪分布</strong>' +
    '<span class="muted">' + d.spawns.length + ' 条 · 累计 ' + map.spawnTotal + ' 只</span>' +
    '<button class="btn btn-sm ghost" data-mpw-act="spawn-map" data-key="' + mpwEsc(map.key) + '">在刷怪工作台查看</button></div>' +
    '<div class="mpw-rows">' + rows.join('') + '</div>' +
    (d.spawns.length > MPW_ROW_LIMIT ? '<div class="mpw-groups-hint">仅显示前 ' + MPW_ROW_LIMIT + ' 条刷怪。</div>' : '') +
    '</div>';
}

function mpwActionAttrs(action) {
  const a = action || {};
  const parts = ['data-mpw-act="issue"'];
  if (a.view) parts.push('data-view="' + mpwEsc(a.view) + '"');
  if (a.key) parts.push('data-key="' + mpwEsc(a.key) + '"');
  if (a.section) parts.push('data-section="' + mpwEsc(a.section) + '"');
  if (a.index != null) parts.push('data-index="' + mpwEsc(a.index) + '"');
  if (a.map) parts.push('data-map="' + mpwEsc(a.map) + '"');
  if (a.name) parts.push('data-name="' + mpwEsc(a.name) + '"');
  return parts.join(' ');
}

function mpwIssueRow(issue) {
  const sev = issue.severity || 'info';
  const label = MPW_ISSUE_LABEL[issue.code] || issue.code;
  const where = issue.file ? issue.file + (issue.line != null ? ':' + issue.line : '') : '';
  const jump = issue.action
    ? '<button class="btn btn-sm ghost" ' + mpwActionAttrs(issue.action) + '>查看</button>'
    : '';
  return '<div class="mon-issue mpw-issue">' +
    '<span class="mon-sev ' + sev + '">' + mpwEsc(MPW_SEV[sev] || sev) + '</span>' +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + mpwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + mpwEsc(label) + (where ? ' · ' + mpwEsc(where) : '') + '</div></div>' +
    jump + '</div>';
}

function mpwRenderMapIssues(d) {
  if (!d.issues.length) return '<div class="mpw-section"><div class="mpw-section-head"><strong>本地图体检</strong>' +
    '<span class="muted">0 项</span></div><div class="mpw-empty">这张地图没有发现异常。</div></div>';
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>本地图体检</strong>' +
    '<span class="muted">' + d.issues.length + ' 项</span></div>' +
    '<div class="mpw-rows">' + d.issues.map((issue) => mpwIssueRow(issue)).join('') + '</div></div>';
}

function mpwRenderDetail() {
  const box = mpwEl('mpwDetail');
  if (!box) return;
  if (!MPW.data) {
    box.innerHTML = '<div class="mpw-empty">正在加载地图数据…</div>';
    return;
  }
  if (!MPW.key) {
    box.innerHTML = MPW.notFound
      ? '<div class="mpw-empty">未找到该地图（' + mpwEsc(MPW.notFound) + '）。</div>'
      : mpwDetailIntro();
    return;
  }
  if (MPW.detailLoading && !MPW.detail) {
    box.innerHTML = '<div class="mpw-empty">正在加载地图「' + mpwEsc(MPW.key) + '」…</div>';
    return;
  }
  const d = MPW.detail;
  if (!d || !d.map) {
    box.innerHTML = '<div class="mpw-empty">未找到该地图。</div>';
    return;
  }
  const map = d.map;
  const tags = mpwMapBadges(map);
  const head = '<div class="mpw-map-head">' +
    '<div><strong>' + mpwEsc(map.map) + (map.name ? ' · ' + mpwEsc(map.name) : '') + '</strong>' +
    '<div class="muted">' + (map.width && map.height ? map.width + 'x' + map.height : '尺寸未知') +
    ' · NPC ' + map.npcs + ' · 刷怪 ' + map.spawns + ' 条 · 规则 ' + map.rules + ' 条</div></div>' +
    '<div class="mpw-head-tags">' + tags + '</div></div>';
  const rules = d.rules;
  const firstRule = MPW_RULE_ORDER.find((key) => rules[key] && rules[key].length);
  const actions = '<div class="mpw-actions">' +
    '<button class="btn btn-sm" data-mpw-act="rule" data-key="' + mpwEsc(map.key) +
    '" data-section="' + mpwEsc(firstRule || 'property') + '">编辑地图规则</button>' +
    (map.spawns ? '<button class="btn btn-sm" data-mpw-act="spawn-map" data-key="' + mpwEsc(map.key) + '">在刷怪工作台查看</button>' : '') +
    (d.npcs.length ? '<button class="btn btn-sm" data-mpw-act="npc-map" data-key="' + mpwEsc(map.key) + '">在 NPC 工作台筛选本图</button>' : '') +
    '</div>';
  box.innerHTML = head + actions + mpwRenderOverview(map, d) +
    mpwRenderRules(map, d) + mpwRenderIncoming(map, d) +
    mpwRenderNpcs(map, d) + mpwRenderSpawns(map, d) + mpwRenderMapIssues(d);
}

function mpwIssueGroup(issue) {
  if (String(issue.code || '').indexOf('unreadable') >= 0) return '读取失败';
  if (issue.code === 'map_unknown') return '未登记地图';
  if (issue.code === 'map_file_orphan' || issue.code === 'map_file_missing') return '地图文件';
  if (String(issue.code || '').indexOf('coord_over') >= 0) return '坐标越界';
  return 'MapInfo 规则';
}

function mpwRenderHealth() {
  const box = mpwEl('mpwHealthList');
  if (!box) return;
  if (!MPW.data) {
    box.innerHTML = '<div class="mpw-empty">正在加载体检数据…</div>';
    return;
  }
  const issues = MPW.data.issues;
  if (!issues.length) {
    box.innerHTML = '<div class="mpw-empty">没有发现地图配置问题。</div>';
    return;
  }
  const groups = {};
  for (const issue of issues) {
    const g = mpwIssueGroup(issue);
    if (!groups[g]) groups[g] = [];
    groups[g].push(issue);
  }
  const order = ['读取失败', '未登记地图', '地图文件', '坐标越界', 'MapInfo 规则'];
  let html = '';
  for (const g of order) {
    const list = groups[g];
    if (!list || !list.length) continue;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of list) counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    html += '<div class="mon-issue-group"><div class="mon-issue-head"><strong>' + mpwEsc(g) + '</strong>' +
      '<span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' + counts.warn +
      ' 警告 / ' + counts.info + ' 提示</span></div>' +
      list.map((issue) => mpwIssueRow(issue)).join('') + '</div>';
  }
  box.innerHTML = html;
}

function mpwRenderAll() {
  mpwRenderMeta();
  mpwRenderTabs();
  mpwRenderList();
  mpwRenderDetail();
  mpwRenderHealth();
}

async function mpwSelectMap(key) {
  if (!key) return;
  MPW.key = String(key).toLowerCase();
  MPW.notFound = '';
  MPW.detail = null;
  MPW.tab = 'detail';
  if (MPW.data && !MPW.data.maps.some((m) => m.key === MPW.key)) {
    MPW.notFound = MPW.key;
    MPW.key = null;
    mpwRenderAll();
    mpwSetHash({ tab: 'detail' });
    return;
  }
  mpwRenderTabs();
  mpwRenderList();
  mpwRenderDetail();
  await mpwLoadDetail(MPW.key);
  mpwSetHash({ tab: 'detail', key: MPW.key });
  const row = document.querySelector('#mpwList [data-mpw-key="' + mpwCssEsc(MPW.key) + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function mpwCssEsc(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

async function mpwGotoMap(key) {
  if (!key) return;
  if (S.mode !== 'maps' && window.openMapView) await window.openMapView({ tab: 'detail', key });
  else await mpwSelectMap(key);
}

async function mpwGotoNpc(index) {
  if (!window.openNpcWorkView || !Number.isFinite(Number(index))) {
    toast('NPC 工作台不可用', 'err');
    return;
  }
  await window.openNpcWorkView(Number(index));
}

async function mpwGotoNpcMap(key) {
  if (!window.openNpcWorkView) {
    toast('NPC 工作台不可用', 'err');
    return;
  }
  await window.openNpcWorkView();
  if (typeof window.filterNpcWorkByMap === 'function') {
    window.filterNpcWorkByMap(key || '');
    return;
  }
  const input = mpwEl('npwFilter');
  if (!input) return;
  input.value = key || '';
  input.dispatchEvent(new Event('input'));
}

async function mpwGotoSpawn(index, key) {
  if (typeof window.openMongenAt !== 'function') {
    toast('刷怪配置编辑器不可用', 'err');
    return;
  }
  await window.openMongenAt(Number.isFinite(Number(index)) ? Number(index) : null, key);
}

async function mpwGotoSpawnMap(key) {
  if (!window.openSpawnView) {
    toast('刷怪工作台不可用', 'err');
    return;
  }
  const map = MPW.data ? MPW.data.maps.find((m) => m.key === String(key).toLowerCase()) : null;
  if (map && !map.spawns) {
    toast('该地图没有刷怪规则', 'err');
    return;
  }
  await window.openSpawnView({ tab: 'maps', key });
}

async function mpwGotoRule(key, section) {
  if (typeof window.openMapinfoAt === 'function') {
    await window.openMapinfoAt(key, section);
    return;
  }
  if (typeof window.openMapinfoConfig === 'function') {
    await window.openMapinfoConfig(true);
    return;
  }
  toast('MapInfo 编辑器不可用', 'err');
}

async function mpwJumpAction(action) {
  const a = action || {};
  if (a.view === 'map') await mpwGotoMap(a.key);
  else if (a.view === 'npc') await mpwGotoNpc(a.index);
  else if (a.view === 'spawn') await mpwGotoSpawn(a.index, a.map || a.key);
  else if (a.view === 'rule') await mpwGotoRule(a.key, a.section);
}

async function openMapView(sel) {
  if (S.mode !== 'maps' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'maps';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  if (window.hideNpcBuyView) window.hideNpcBuyView();
  if (window.hideItemUseView) window.hideItemUseView();
  if (window.hideItemWorkView) window.hideItemWorkView();
  if (window.hideGrowthView) window.hideGrowthView();
  if (window.hideDropWorkView) window.hideDropWorkView();
  if (window.hideSpawnWorkView) window.hideSpawnWorkView();
  if (window.hideShopWorkView) window.hideShopWorkView();
  if (window.hideScriptWorkView) window.hideScriptWorkView();
  if (window.hideCastleWorkView) window.hideCastleWorkView();
  if (window.hideTextWorkView) window.hideTextWorkView();
  if (window.hideStarterWorkView) window.hideStarterWorkView();
  if (window.hideHealthWorkView) window.hideHealthWorkView();
  const dbView = mpwEl('dbView');
  const dropView = mpwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = mpwEl('mapWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('mpw');
  const target = sel || mpwHashState() || { tab: MPW.tab };
  if (target.tab && MPW_TAB_KEYS.indexOf(target.tab) >= 0) MPW.tab = target.tab;
  if (target.key) MPW.key = String(target.key).toLowerCase();
  mpwRenderAll();
  if (!MPW.data || MPW.stale) {
    try {
      await mpwLoad();
      mpwRenderAll();
    } catch (e) {
      mpwRenderAll();
      toast('加载地图数据失败：' + e.message, 'err');
      return;
    }
  }
  mpwRenderAll();
  if (MPW.tab === 'detail' && MPW.key) {
    await mpwSelectMap(MPW.key);
  } else if (MPW.tab === 'health') {
    mpwSetHash({ tab: 'health' });
  } else {
    mpwSetHash({ tab: 'detail' });
  }
}

window.openMapView = openMapView;
window.hideMapWorkView = () => {
  const view = mpwEl('mapWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && mpwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshMapWorkState = (st) => {
  const info = st && st.configs ? st.configs.mapwork : null;
  if (info && info.maps != null) mpwText('mapWorkCount', String(info.maps));
  MPW.stale = true;
  if (S.mode === 'maps') mpwRenderMeta();
};
window.updateMapWorkMeta = mpwRenderMeta;

function mpwBindEvents() {
  const filter = mpwEl('mpwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(MPW.searchTimer);
      MPW.searchTimer = setTimeout(() => {
        MPW.filter = filter.value;
        mpwRenderList();
      }, 150);
    });
  }
  document.querySelectorAll('#mpwFlagFilter [data-mpw-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      MPW.flag = btn.dataset.mpwFlag;
      document.querySelectorAll('#mpwFlagFilter [data-mpw-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      mpwRenderList();
    });
  });
  const list = mpwEl('mpwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-mpw-key]');
      if (!li) return;
      mpwSelectMap(li.dataset.mpwKey);
    });
  }
  const tabs = mpwEl('mpwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mpw-tab]');
      if (!btn) return;
      mpwSelectTab(btn.dataset.mpwTab);
    });
  }
  const main = mpwEl('mapWorkView');
  if (main) {
    main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mpw-act]');
      if (!btn) return;
      const act = btn.dataset.mpwAct;
      if (act === 'rule') mpwGotoRule(btn.dataset.key, btn.dataset.section);
      else if (act === 'spawn') mpwGotoSpawn(Number(btn.dataset.index), btn.dataset.key);
      else if (act === 'spawn-map') mpwGotoSpawnMap(btn.dataset.key);
      else if (act === 'npc') mpwGotoNpc(Number(btn.dataset.index));
      else if (act === 'npc-map') mpwGotoNpcMap(btn.dataset.key);
      else if (act === 'map') mpwGotoMap(btn.dataset.key);
      else if (act === 'issue') {
        mpwJumpAction({
          view: btn.dataset.view,
          key: btn.dataset.key,
          section: btn.dataset.section,
          index: btn.dataset.index == null ? null : Number(btn.dataset.index),
          map: btn.dataset.map,
          name: btn.dataset.name
        });
      }
    });
  }
  const reload = mpwEl('btnMpwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        MPW.stale = true;
        MPW.detail = null;
        await mpwLoad(true);
        mpwRenderAll();
        if (MPW.key) await mpwSelectMap(MPW.key);
        toast('地图数据已重新检查', 'ok');
      } catch (e) {
        mpwRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const state = mpwHashState();
    if (state) openMapView(state);
  });
}

mpwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = mpwHashState();
    if (state) openMapView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = mpwHashState();
    if (state) openMapView(state);
  });
}

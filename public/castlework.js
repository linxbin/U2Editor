'use strict';

/* 沙城 / 攻城 / 行会工作台：只读总览 + Sabuk 基础字段安全写入 */

const CBW_SECTIONS = [
  { key: 'overview', name: '沙城总览', desc: '归属、地图、资金与防御设施' },
  { key: 'prizes', name: '攻城奖励', desc: 'SabukPrizes.txt 奖励序列' },
  { key: 'war', name: '攻城记录', desc: 'WarDate.txt 攻城行会与时间' },
  { key: 'guilds', name: '行会名单', desc: 'Guildlist.txt 行会列表' },
  { key: 'hero', name: '英雄战场', desc: 'Herofightmappointlist 坐标组' },
  { key: 'guards', name: '守卫分布', desc: 'GuardList.txt 卫士坐标与朝向' }
];

const CBW_EDIT = [
  { key: 'CastleName', label: '沙城名称', type: 'text' },
  { key: 'OwnGuild', label: '归属行会', type: 'text' },
  { key: 'CastleMap', label: '沙城地图', type: 'text' },
  { key: 'RoyalMap', label: '王城地图', type: 'text' },
  { key: 'MainDoorOpen', label: '城门状态', type: 'select', options: [[0, '关闭'], [1, '开启']] },
  { key: 'ArcherMode', label: '弓箭手模式', type: 'number' },
  { key: 'WarDate', label: '攻城日期模式', type: 'number' },
  { key: 'TotalGold', label: '沙城资金', type: 'number' },
  { key: 'IncomeToday', label: '今日收入', type: 'number' }
];

const CBW_TAB_KEYS = ['detail', 'health'];
const CBW_SEV = { error: '错误', warn: '警告', info: '提示' };

const CBW = {
  data: null,
  stale: true,
  loading: false,
  saving: false,
  selected: 'overview',
  tab: 'detail',
  notFound: '',
  dirty: false
};

function cbwEl(id) {
  return document.getElementById(id);
}

function cbwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cbwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function cbwText(id, text) {
  const el = cbwEl(id);
  if (el) el.textContent = text;
}

function cbwFmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function cbwSection(key) {
  return CBW_SECTIONS.find((s) => s.key === key) || null;
}

function cbwHashState() {
  const m = /^#castle(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  let raw = m[1] || '';
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
  }
  if (!raw) return { tab: 'detail', section: 'overview' };
  if (raw === 'health') return { tab: 'health', section: CBW.selected };
  if (CBW_SECTIONS.some((s) => s.key === raw)) return { tab: 'detail', section: raw };
  return { tab: 'detail', section: null, name: raw };
}

function cbwSetHash(sel) {
  let raw = '';
  if (sel && sel.tab === 'health') raw = 'health';
  else if (sel && sel.section) raw = sel.section;
  const next = raw ? '#castle=' + raw : '#castle';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function cbwLoad(refresh) {
  if (CBW.loading) return;
  CBW.loading = true;
  cbwRenderMeta();
  try {
    const data = await api('/api/config/castlework' + (refresh ? '?refresh=1' : ''));
    CBW.data = data;
    CBW.stale = false;
    cbwText('castleWorkCount', String(data.stats.prizes + data.stats.guilds + data.stats.heroGroups + data.stats.guards));
  } finally {
    CBW.loading = false;
  }
}

function cbwIssueTotal() {
  const d = CBW.data;
  if (!d) return 0;
  return d.stats.issues.error + d.stats.issues.warn + d.stats.issues.info;
}

function cbwRenderMeta() {
  const meta = cbwEl('cbwMeta');
  if (!meta) return;
  if (!CBW.data) {
    meta.textContent = CBW.loading ? '正在读取沙城配置…' : '';
    return;
  }
  const d = CBW.data;
  const setup = d.castle.setup || {};
  meta.textContent = [
    `沙城 ${setup.CastleName || '未命名'}`,
    `归属 ${setup.OwnGuild || '无'}`,
    `奖励 ${d.stats.prizes} 条`,
    `守卫 ${d.stats.guards} 个`,
    `英雄战场 ${d.stats.heroGroups} 组`,
    `问题 ${d.stats.issues.error} 错误 / ${d.stats.issues.warn} 警告 / ${d.stats.issues.info} 提示`
  ].join(' · ');
}

function cbwSectionIssues(key) {
  if (!CBW.data) return [];
  return (CBW.data.issues || []).filter((issue) => issue.section === key);
}

function cbwRenderList() {
  const list = cbwEl('cbwList');
  const hint = cbwEl('cbwListHint');
  if (!list) return;
  cbwClear(list);
  if (!CBW.data) {
    if (hint) hint.textContent = '正在加载…';
    return;
  }
  const d = CBW.data;
  const setup = d.castle.setup || {};
  const metas = {
    overview: `${setup.CastleName || '未命名'} · ${d.stats.defenses} 个防御设施`,
    prizes: `${d.stats.prizes} 条奖励`,
    war: `${d.war.entries.length} 条攻城记录`,
    guilds: `${d.stats.guilds} 个行会`,
    hero: `${d.stats.heroGroups} 组 / ${d.stats.heroPoints} 点`,
    guards: `${d.stats.guards} 个 / ${d.guards.maps.length} 张地图`
  };
  for (const section of CBW_SECTIONS) {
    const li = document.createElement('li');
    li.className = 'file-item' + (CBW.selected === section.key ? ' active' : '');
    li.dataset.cbwSection = section.key;
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = section.name;
    const issues = cbwSectionIssues(section.key);
    if (issues.length) {
      const badge = document.createElement('span');
      badge.className = 'npw-tag warn';
      badge.textContent = '异常 ' + issues.length;
      name.appendChild(badge);
    }
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = metas[section.key] || section.desc;
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (hint) hint.textContent = `共 ${CBW_SECTIONS.length} 个配置分区 · ${cbwIssueTotal()} 项体检问题。`;
}

function cbwRenderTabs() {
  document.querySelectorAll('#cbwTabs [data-cbw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.cbwTab === CBW.tab);
  });
  const detail = cbwEl('cbwDetailPane');
  const health = cbwEl('cbwHealthPane');
  if (detail) detail.classList.toggle('hidden', CBW.tab !== 'detail');
  if (health) health.classList.toggle('hidden', CBW.tab !== 'health');
}

function cbwKv(label, value) {
  return '<div class="mpw-kv-item"><span class="k">' + cbwEsc(label) + '</span><span class="v">' + value + '</span></div>';
}

function cbwSectionBox(title, note, body) {
  return '<div class="mpw-section"><div class="mpw-section-head"><strong>' + cbwEsc(title) + '</strong>' +
    (note ? '<span class="muted">' + cbwEsc(note) + '</span>' : '') + '</div>' + body + '</div>';
}

function cbwTable(headers, rows, wrapClass) {
  return '<div class="cbw-table-wrap ' + (wrapClass || '') + '"><table class="cbw-table"><thead><tr>' +
    headers.map((h) => '<th>' + cbwEsc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function cbwIssueRow(issue) {
  return '<div class="mon-issue mpw-issue">' +
    '<span class="mon-sev ' + cbwEsc(issue.severity) + '">' + cbwEsc(CBW_SEV[issue.severity] || issue.severity) + '</span>' +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + cbwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + cbwEsc((cbwSection(issue.section) || {}).name || '其他') +
    (issue.line ? ' · 第 ' + issue.line + ' 行' : '') + '</div></div>' +
    (issue.section && issue.section !== CBW.selected
      ? '<button class="btn btn-sm" data-cbw-act="section" data-section="' + cbwEsc(issue.section) + '">查看</button>'
      : '') + '</div>';
}

function cbwRenderSectionIssues(key) {
  const issues = cbwSectionIssues(key);
  if (!issues.length) {
    return cbwSectionBox('本节体检', '0 项', '<div class="mpw-empty">没有发现异常。</div>');
  }
  return cbwSectionBox('本节体检', issues.length + ' 项',
    '<div class="mpw-rows">' + issues.map(cbwIssueRow).join('') + '</div>');
}

function cbwFieldValue(key) {
  const setup = (CBW.data && CBW.data.castle.setup) || {};
  return setup[key] == null ? '' : setup[key];
}

function cbwEditForm() {
  const fields = CBW_EDIT.map((field) => {
    const value = cbwFieldValue(field.key);
    let input;
    if (field.type === 'select') {
      input = '<select class="filter cbw-input" data-cbw-field="' + field.key + '">' +
        field.options.map(([v, label]) =>
          '<option value="' + v + '"' + (String(value) === String(v) ? ' selected' : '') + '>' +
          cbwEsc(label) + '（' + v + '）</option>').join('') + '</select>';
    } else {
      input = '<input class="filter cbw-input" type="' + (field.type === 'number' ? 'number' : 'text') +
        '" data-cbw-field="' + field.key + '" value="' + cbwEsc(value) + '" autocomplete="off">';
    }
    return '<div class="cbw-field"><label>' + cbwEsc(field.label) + '</label>' + input + '</div>';
  }).join('');
  return '<div class="cbw-edit">' + fields + '</div>' +
    '<div class="cbw-edit-actions"><button class="btn btn-sm" data-cbw-act="save">保存到 Sabuk.txt</button>' +
    '<button class="btn btn-sm" data-cbw-act="reset">还原</button>' +
    '<span class="muted">仅修改上方字段，其余行保持原样；写入前自动备份。</span></div>';
}

function cbwMapLink(code, name) {
  if (!code) return '—';
  return '<button class="sw-link" data-cbw-act="map" data-code="' + cbwEsc(code) + '">' +
    cbwEsc(code) + (name ? ' ' + cbwEsc(name) : '') + '</button>';
}

function cbwRenderOverview() {
  const d = CBW.data;
  const castle = d.castle;
  const setup = castle.setup || {};
  const doorOpen = String(setup.MainDoorOpen) === '1';
  const head = '<div class="mpw-map-head"><div><strong>' + cbwEsc(setup.CastleName || '未命名沙城') + '</strong>' +
    '<div class="muted">Sabuk.txt · ' + castle.fields.length + ' 个基础字段 · ' +
    castle.defenses.length + ' 个防御设施 · 归属 ' + cbwEsc(setup.OwnGuild || '无') + '</div></div>' +
    '<div class="mpw-head-tags">' + (doorOpen ? '<span class="mpw-badge ok">城门开启</span>' : '<span class="mpw-badge">城门关闭</span>') +
    '</div></div>';
  const kv = '<div class="mpw-kv">' +
    cbwKv('沙城地图', cbwMapLink(setup.CastleMap, castle.mapName)) +
    cbwKv('王城地图', cbwMapLink(setup.RoyalMap, castle.royalName)) +
    cbwKv('归属行会', cbwEsc(setup.OwnGuild || '无')) +
    cbwKv('城门状态', doorOpen ? '开启' : '关闭') +
    cbwKv('弓箭手模式', cbwEsc(setup.ArcherMode || '0')) +
    cbwKv('攻城日期模式', cbwEsc(setup.WarDate || '0')) +
    cbwKv('沙城资金', cbwFmtNum(setup.TotalGold) + ' 金币') +
    cbwKv('今日收入', cbwFmtNum(setup.IncomeToday) + ' 金币') +
    '</div>';

  const defenseRows = castle.defenses.map((obj) => {
    const coords = obj.x == null || obj.y == null ? '<span class="cbw-bad">缺失</span>' : obj.x + ', ' + obj.y;
    return '<tr><td>' + cbwEsc(obj.kind === 'door' ? '城门' : obj.kind === 'wall' ? '城墙' : '弓箭手') +
      '</td><td>' + cbwEsc(obj.label) + (obj.name ? ' <span class="muted">' + cbwEsc(obj.name) + '</span>' : '') +
      '</td><td>' + coords + '</td><td>' + (obj.hp == null ? '—' : cbwFmtNum(obj.hp)) +
      '</td><td>' + (obj.money == null ? '—' : cbwFmtNum(obj.money)) +
      '</td><td>' + (obj.line || '—') + '</td></tr>';
  }).join('');
  const defenses = cbwSectionBox('防御设施', castle.defenses.length + ' 个',
    cbwTable(['类型', '名称', '坐标', 'HP', '修理费', '行'], defenseRows));

  const fieldRows = castle.fields.map((field) =>
    '<tr><td><code>' + cbwEsc(field.key) + '</code></td><td>' + cbwEsc(field.value || '（空）') +
    '</td><td>' + (field.type === 'raw' ? '<span class="muted">只读</span>' : '可编辑') +
    '</td><td>' + field.line + '</td></tr>').join('');
  const fields = cbwSectionBox('Sabuk.txt [setup]', castle.fields.length + ' 个字段',
    cbwTable(['字段', '当前值', '状态', '行'], fieldRows));

  return head + kv + cbwSectionBox('基础字段编辑', '写入前自动备份', cbwEditForm()) +
    defenses + fields + cbwRenderSectionIssues('overview');
}

function cbwRenderPrizes() {
  const rows = CBW.data.prizes.rows;
  if (!rows.length) {
    return cbwSectionBox('攻城奖励', '0 条', '<div class="mpw-empty">SabukPrizes.txt 没有奖励配置。</div>') +
      cbwRenderSectionIssues('prizes');
  }
  const body = rows.map((row) =>
    '<tr><td>' + row.index + '</td><td>' + cbwFmtNum(row.count) + '</td>' +
    '<td>' + cbwEsc(row.item) + (row.itemOk ? '' : ' <span class="npw-tag warn">物品缺失</span>') + '</td>' +
    '<td>' + cbwFmtNum(row.gold) + '</td><td>' + row.line + '</td></tr>').join('');
  return cbwSectionBox('攻城奖励序列', rows.length + ' 条',
    cbwTable(['序号', '数量', '奖励', '金币', '行'], body)) +
    '<div class="sw-note">按文件顺序展示；「数量 / 奖励 / 金币」逐行对应。金币与经验为内置奖励类型，不要求在 stditems.db 中。</div>' +
    cbwRenderSectionIssues('prizes');
}

function cbwRenderWar() {
  const war = CBW.data.war;
  const rows = war.entries.map((entry) =>
    '<tr><td>' + cbwEsc(entry.guild) + '</td><td>' + cbwEsc(entry.time) +
    '</td><td>' + (entry.recorded ? '<span class="mpw-badge ok">已记录</span>' : '<span class="mpw-badge">未记录</span>') +
    '</td><td>' + entry.line + '</td></tr>').join('');
  const body = war.entries.length
    ? cbwTable(['攻城行会', '攻城时间', '状态', '行'], rows)
    : '<div class="mpw-empty">WarDate.txt 没有手动攻城记录，当前仅保留字段说明注释。</div>';
  return cbwSectionBox('攻城记录', war.entries.length + ' 条', body) +
    cbwRenderSectionIssues('war');
}

function cbwRenderGuilds() {
  const guilds = CBW.data.guilds.names;
  const body = guilds.length
    ? '<div class="npw-orphans">' + guilds.map((g) =>
      '<span class="npw-tag">' + cbwEsc(g.name) + ' <span class="muted">第 ' + g.line + ' 行</span></span>').join('') + '</div>'
    : '<div class="mpw-empty">Guildlist.txt 为空。行会成员与归属通常由数据库维护，此文件只保存需要额外登记的行会名。</div>';
  return cbwSectionBox('行会名单', guilds.length + ' 个', body) +
    cbwRenderSectionIssues('guilds');
}

function cbwRenderHero() {
  const hero = CBW.data.hero;
  if (!hero.groups.length) {
    return cbwSectionBox('英雄战场坐标', '0 组', '<div class="mpw-empty">没有坐标组。</div>') +
      cbwRenderSectionIssues('hero');
  }
  const cards = hero.groups.map((group) => {
    const points = group.points.map((p) =>
      '<span class="cbw-point" title="第 ' + p.line + ' 行">' + p.x + ',' + p.y + '</span>').join('');
    return '<div class="cbw-hero-group"><div class="cbw-hero-head"><strong>第 ' + group.index + ' 组</strong>' +
      '<span class="muted">' + group.points.length + ' 个坐标 · 起始第 ' + group.line + ' 行</span></div>' +
      '<div class="cbw-points">' + points + '</div></div>';
  }).join('');
  return cbwSectionBox('英雄战场坐标', hero.groups.length + ' 组 / ' + hero.totalPoints + ' 点',
    '<div class="cbw-hero-groups">' + cards + '</div>') +
    cbwRenderSectionIssues('hero');
}

function cbwRenderGuards() {
  const guards = CBW.data.guards;
  if (!guards.rows.length) {
    return cbwSectionBox('守卫分布', '0 个', '<div class="mpw-empty">GuardList.txt 没有守卫配置。</div>') +
      cbwRenderSectionIssues('guards');
  }
  const summary = '<div class="npw-orphans">' + guards.maps.map((m) =>
    '<span class="npw-tag">' + cbwEsc(m.map) + (m.mapName ? ' ' + cbwEsc(m.mapName) : '') +
    ' · ' + m.count + ' 个</span>').join('') + '</div>';
  const groups = guards.maps.map((m) => {
    const rows = guards.rows.filter((row) => row.map === m.map).map((row) =>
      '<tr><td>' + cbwEsc(row.name) + '</td>' +
      '<td><button class="sw-link" data-cbw-act="map" data-code="' + cbwEsc(row.map) + '">' +
      cbwEsc(row.map) + '</button>' + (row.mapName ? ' ' + cbwEsc(row.mapName) : '') + '</td>' +
      '<td>' + row.x + ', ' + row.y + '</td><td>' + row.dir + '</td><td>' + row.line + '</td></tr>').join('');
    return '<div class="cbw-guard-group"><div class="cbw-guard-head"><strong>' +
      cbwEsc(m.map) + (m.mapName ? ' ' + cbwEsc(m.mapName) : '') + '</strong>' +
      '<span class="muted">' + m.count + ' 个守卫</span></div>' +
      cbwTable(['名称', '地图', '坐标', '方向', '行'], rows) + '</div>';
  }).join('');
  return cbwSectionBox('守卫分布', guards.rows.length + ' 个 / ' + guards.maps.length + ' 张地图',
    summary + groups) + cbwRenderSectionIssues('guards');
}

function cbwRenderDetail() {
  const box = cbwEl('cbwDetail');
  if (!box) return;
  if (!CBW.data) {
    box.innerHTML = '<div class="mpw-empty">正在读取沙城配置…</div>';
    return;
  }
  if (CBW.tab !== 'detail') return;
  if (!CBW.selected) {
    box.innerHTML = CBW.notFound
      ? '<div class="mpw-empty">未找到配置分区（' + cbwEsc(CBW.notFound) + '）。</div>'
      : cbwIntro();
    return;
  }
  if (CBW.selected === 'overview') box.innerHTML = cbwRenderOverview();
  else if (CBW.selected === 'prizes') box.innerHTML = cbwRenderPrizes();
  else if (CBW.selected === 'war') box.innerHTML = cbwRenderWar();
  else if (CBW.selected === 'guilds') box.innerHTML = cbwRenderGuilds();
  else if (CBW.selected === 'hero') box.innerHTML = cbwRenderHero();
  else if (CBW.selected === 'guards') box.innerHTML = cbwRenderGuards();
  else box.innerHTML = cbwIntro();
  cbwBindForm();
}

function cbwIntro() {
  if (!CBW.data) return '<div class="mpw-empty">正在读取沙城配置…</div>';
  const d = CBW.data;
  const setup = d.castle.setup || {};
  return '<div class="sw-intro"><h3>沙城 / 攻城工作台</h3>' +
    '<p>当前沙城「' + cbwEsc(setup.CastleName || '未命名') + '」归属 ' + cbwEsc(setup.OwnGuild || '无') +
    '，位于 ' + cbwEsc(setup.CastleMap || '?') + (d.castle.mapName ? ' ' + cbwEsc(d.castle.mapName) : '') +
    '，王城地图 ' + cbwEsc(setup.RoyalMap || '?') + (d.castle.royalName ? ' ' + cbwEsc(d.castle.royalName) : '') + '。</p>' +
    '<p>左侧可查看攻城奖励、攻城记录、行会名单、英雄战场坐标与守卫分布；沙城基础字段可直接编辑并写入 Sabuk.txt，写入前自动备份，其余行保持原样。</p>' +
    '<p>当前配置体检 ' + d.stats.issues.error + ' 错误 / ' + d.stats.issues.warn + ' 警告 / ' +
    d.stats.issues.info + ' 提示。</p></div>';
}

function cbwRenderHealth() {
  const box = cbwEl('cbwHealthList');
  if (!box) return;
  if (!CBW.data) {
    box.innerHTML = '<div class="mpw-empty">正在加载…</div>';
    return;
  }
  const issues = CBW.data.issues || [];
  if (!issues.length) {
    box.innerHTML = '<div class="mpw-empty">沙城与攻城配置没有发现异常。</div>';
    return;
  }
  const groups = new Map();
  for (const issue of issues) {
    const key = issue.section || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  let html = '';
  for (const section of CBW_SECTIONS) {
    const list = groups.get(section.key);
    if (!list) continue;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of list) counts[issue.severity]++;
    html += '<div class="mon-issue-group"><div class="mon-issue-head"><strong>' + cbwEsc(section.name) +
      '</strong><span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' +
      counts.warn + ' 警告 / ' + counts.info + ' 提示</span></div>' +
      list.map((issue) => cbwIssueRow(issue).replace(/<button[^>]*data-cbw-act="section"[^>]*>查看<\/button>/, '')).join('') +
      '</div>';
  }
  box.innerHTML = html;
}

function cbwRenderAll() {
  cbwRenderMeta();
  cbwRenderTabs();
  cbwRenderList();
  cbwRenderDetail();
  cbwRenderHealth();
}

function cbwSelect(section, opts) {
  const target = cbwSection(section);
  if (!target) {
    CBW.selected = null;
    CBW.notFound = String(section || '');
    CBW.tab = 'detail';
    cbwRenderAll();
    cbwSetHash({ tab: 'detail' });
    return;
  }
  if (CBW.dirty && CBW.selected === 'overview' && target.key !== 'overview') {
    if (!confirm('沙城基础字段有未保存的修改，确定放弃并切换？')) return;
    CBW.dirty = false;
  }
  CBW.selected = target.key;
  CBW.notFound = '';
  CBW.tab = 'detail';
  if (opts && opts.hash === false) cbwRenderAll();
  else {
    cbwRenderAll();
    cbwSetHash({ tab: 'detail', section: target.key });
  }
  const li = document.querySelector('#cbwList [data-cbw-section="' + target.key + '"]');
  if (li) {
    try {
      li.scrollIntoView({ block: 'nearest' });
    } catch (e) {
    }
  }
}

function cbwBindForm() {
  const box = cbwEl('cbwDetail');
  if (!box) return;
  box.querySelectorAll('[data-cbw-field]').forEach((input) => {
    input.addEventListener('input', () => {
      CBW.dirty = true;
    });
    input.addEventListener('change', () => {
      CBW.dirty = true;
    });
  });
}

async function cbwSave() {
  if (CBW.saving || !CBW.data) return;
  const box = cbwEl('cbwDetail');
  if (!box) return;
  const fields = {};
  box.querySelectorAll('[data-cbw-field]').forEach((input) => {
    fields[input.dataset.cbwField] = input.value;
  });
  if (CBW_EDIT.some((f) => f.key === 'CastleName' && !String(fields.CastleName || '').trim())) {
    toast('沙城名称不能为空', 'err');
    return;
  }
  CBW.saving = true;
  try {
    const res = await api('/api/config/castlework/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (!res.changed) {
      CBW.dirty = false;
      toast('字段没有变化，未写入文件', 'ok');
      return;
    }
    CBW.dirty = false;
    await cbwLoad(true);
    cbwRenderAll();
    if (S.mode === 'castlework' && window.refreshState) window.refreshState().catch(() => {});
    const backup = res.backup ? '，备份 ' + res.backup.split(/[\\/]/).pop() : '';
    toast('已保存 ' + res.changed + ' 个字段' + backup, 'ok');
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
  } finally {
    CBW.saving = false;
  }
}

async function cbwReload() {
  const btn = cbwEl('btnCbwReload');
  if (btn) btn.disabled = true;
  try {
    await cbwLoad(true);
    cbwRenderAll();
    toast('已重新检查沙城配置', 'ok');
  } catch (e) {
    cbwRenderAll();
    toast('重新检查失败：' + e.message, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openCastleView(sel) {
  if (S.mode !== 'castlework' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'castlework';
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
  const dbView = cbwEl('dbView');
  const dropView = cbwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = cbwEl('castleWorkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('cbw');
  if (!CBW.data || CBW.stale) {
    try {
      await cbwLoad();
    } catch (e) {
      toast('加载沙城配置失败：' + e.message, 'err');
      cbwRenderAll();
      return;
    }
  }
  const target = sel || cbwHashState() || { tab: 'detail', section: CBW.selected };
  if (target.tab && CBW_TAB_KEYS.indexOf(target.tab) >= 0) CBW.tab = target.tab;
  if (target.section === null && target.name) {
    cbwSelect(target.name);
    return;
  }
  if (target.section) {
    if (target.tab === 'health') {
      CBW.selected = target.section;
      cbwRenderAll();
      cbwRenderHealth();
      cbwSetHash({ tab: 'health' });
      return;
    }
    cbwSelect(target.section, { hash: true });
    return;
  }
  if (CBW.tab === 'health') {
    cbwRenderAll();
    cbwSetHash({ tab: 'health' });
    return;
  }
  cbwSelect(CBW.selected || 'overview', { hash: true });
}

window.openCastleView = openCastleView;
window.hideCastleWorkView = () => {
  const view = cbwEl('castleWorkView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && cbwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.castleConfirmDiscard = () => !CBW.dirty || confirm('沙城基础字段有未保存的修改，确定放弃？');
window.refreshCastleWorkState = (st) => {
  const info = st && st.configs ? st.configs.castlework : null;
  if (!info || info.error) return;
  const s = info.stats;
  if (!s) return;
  cbwText('castleWorkCount', String(s.prizes + s.guilds + s.heroGroups + s.guards));
  if (S.mode === 'castlework') cbwRenderMeta();
};
window.updateCastleWorkMeta = cbwRenderMeta;

function cbwBindEvents() {
  const list = cbwEl('cbwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-cbw-section]');
      if (li) cbwSelect(li.dataset.cbwSection);
    });
  }
  const tabs = cbwEl('cbwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cbw-tab]');
      if (!btn) return;
      CBW.tab = btn.dataset.cbwTab;
      cbwRenderAll();
      if (CBW.tab === 'health') cbwSetHash({ tab: 'health' });
      else if (CBW.selected) cbwSetHash({ tab: 'detail', section: CBW.selected });
      else cbwSetHash({ tab: 'detail' });
    });
  }
  const detail = cbwEl('cbwDetail');
  if (detail) {
    detail.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-cbw-act]');
      if (!btn) return;
      const act = btn.dataset.cbwAct;
      if (act === 'section') cbwSelect(btn.dataset.section);
      else if (act === 'map') {
        if (typeof window.openMapView === 'function') {
          await window.openMapView({ tab: 'detail', key: btn.dataset.code });
        }
      } else if (act === 'save') await cbwSave();
      else if (act === 'reset') {
        CBW.dirty = false;
        cbwRenderDetail();
        toast('已还原为文件中的当前值', 'ok');
      }
    });
  }
  const health = cbwEl('cbwHealthList');
  if (health) {
    health.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cbw-act="section"]');
      if (btn) cbwSelect(btn.dataset.section);
    });
  }
  const reload = cbwEl('btnCbwReload');
  if (reload) reload.addEventListener('click', cbwReload);
  window.addEventListener('hashchange', () => {
    const state = cbwHashState();
    if (state) openCastleView(state);
  });
}

cbwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = cbwHashState();
    if (state) openCastleView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = cbwHashState();
    if (state) openCastleView(state);
  });
}

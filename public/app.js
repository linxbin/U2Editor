'use strict';

const $ = (sel) => document.querySelector(sel);

const fieldLabel = (name) =>
  typeof FIELD_LABELS !== 'undefined' && FIELD_LABELS[name] ? FIELD_LABELS[name] : '';

const api = async (url, opts) => {
  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = { error: '服务器返回了无效数据' };
  }
  if (!res.ok) {
    const err = new Error(data.error || 'HTTP ' + res.status);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
};

const S = {
  dbs: [],
  drops: [],
  configs: null,
  mode: 'db',
  dbFile: null,
  schema: null,
  rows: [],
  original: [],
  edits: new Map(),
  added: [],
  page: 0,
  pageSize: 100,
  filter: '',
  selected: -1,
  dropFile: null,
  dropText: '',
  dropOriginal: '',
  dropCRLF: false
};

let toastTimer = null;
let filterTimer = null;
let dropTimer = null;

function toast(message, type) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast' + (type ? ' ' + type : '');
  }, type === 'err' ? 7000 : 5000);
}

const BASIC_TABS = [
  { target: 'db', name: '数据库', desc: '浏览并编辑物品、怪物等数据表' },
  { target: 'mon', name: '怪物', desc: '查看怪物属性、刷怪点与爆率' },
  { target: 'drop', name: '爆率', desc: '按文件编辑 MonItems 掉落规则' },
  { target: 'cfg', name: '玩法', desc: '刷怪、合成、称号、商城等基础配置' }
];

const WORK_GROUPS = [
  {
    name: '总览与检查',
    items: [
      { target: 'hw', name: '配置体检', desc: '汇总所有工作台的错误、警告和提示' }
    ]
  },
  {
    name: '世界与剧情',
    items: [
      { target: 'mpw', name: '地图', desc: '查看地图、NPC、刷怪与跳转规则' },
      { target: 'spw', name: '刷怪', desc: '按地图检查刷怪范围、数量与间隔' },
      { target: 'npcw', name: 'NPC', desc: '查看 NPC 分布、脚本与商店货品' },
      { target: 'scw', name: '脚本', desc: '全文搜索脚本并定位引用行' }
    ]
  },
  {
    name: '养成与经济',
    items: [
      { target: 'itemw', name: '物品', desc: '按物品查看来源、用途与配置问题' },
      { target: 'grw', name: '成长', desc: '技能、职业、升级与宠物成长曲线' },
      { target: 'dpw', name: '掉落', desc: '按物品反查爆率来源与异常' },
      { target: 'shw', name: '合成商城', desc: '检查配方、商品与跨商城重复' }
    ]
  },
  {
    name: '任务与运营',
    items: [
      { target: 'tsk', name: '任务', desc: '查看、启用和修复任务配置' },
      { target: 'act', name: '活动', desc: '活动、榜单与开关配置' },
      { target: 'cbw', name: '沙城攻城', desc: '沙城归属、攻城奖励与守卫' },
      { target: 'txw', name: '文案对话', desc: '对话、描述、公告与验证文案' },
      { target: 'stw', name: '新手充值', desc: '礼包、充值档位与账号名单' }
    ]
  }
];

const NAV_HEALTH_SOURCE = {
  itemw: 'itemwork',
  grw: 'growth',
  dpw: 'dropwork',
  spw: 'spawnwork',
  mpw: 'mapwork',
  shw: 'shopwork',
  scw: 'scriptwork',
  cbw: 'castlework',
  txw: 'textwork',
  stw: 'starterwork'
};
function navIssueCounts(target) {
  const summary = S.configs && S.configs.healthwork;
  if (!summary) return null;
  if (target === 'hw') {
    return summary.stats ? { error: summary.stats.error || 0, warn: summary.stats.warn || 0 } : null;
  }
  const sourceKey = NAV_HEALTH_SOURCE[target];
  if (!sourceKey || !Array.isArray(summary.sources)) return null;
  const source = summary.sources.find((item) => item.key === sourceKey);
  return source ? { error: source.error || 0, warn: source.warn || 0 } : null;
}

function navIssueHtmlCompact(target) {
  const counts = navIssueCounts(target);
  if (!counts) return '';
  let html = '';
  if (counts.error > 0) {
    html += '<span class="work-issue err" title="' + counts.error + ' 个错误">' + counts.error + '</span>';
  }
  if (counts.warn > 0) {
    html += '<span class="work-issue" title="' + counts.warn + ' 个警告">' + counts.warn + '</span>';
  }
  return html;
}

function renderWorkNav() {
  const box = $('#workNavGroups');
  if (!box) return;
  let html = '';
  let total = 0;
  for (const group of WORK_GROUPS) {
    html += '<div class="work-group"><div class="work-group-title">' + group.name + '</div>';
    for (const item of group.items) {
      total++;
      html += '<button type="button" class="work-item" data-work-target="' + item.target +
        '" aria-selected="false" title="' + item.desc + '">' +
        '<span class="work-item-name">' + item.name + '</span>' +
        '<span class="work-issues" data-work-issues="' + item.target + '"></span></button>';
    }
    html += '</div>';
  }
  box.innerHTML = html;
  const count = $('#workNavCount');
  if (count) count.textContent = total + ' 个入口';
  updateWorkNavBadges();
}

function updateWorkNavBadges() {
  document.querySelectorAll('[data-work-issues]').forEach((el) => {
    el.innerHTML = navIssueHtmlCompact(el.dataset.workIssues);
  });
}

function setNavActive(name) {
  document.querySelectorAll('.data-tab[data-basic-tab]').forEach((tab) => {
    const active = tab.dataset.basicTab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.work-item[data-work-target]').forEach((item) => {
    const active = item.dataset.workTarget === name;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function showSideTab(name) {
  document.querySelectorAll('.side-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.dataset.sidePane === name);
  });
  setNavActive(name);
}
window.showSideTab = showSideTab;

function dirtyCount() {
  return S.edits.size + S.added.length;
}

function isDirtyField(index, field) {
  return index < S.rows.length && S.edits.has(index + ':' + field);
}

function analyzeDrops(text) {
  const lines = text.split(/\r?\n/);
  const invalid = [];
  const samples = [];
  let rules = 0;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) return;
    const m = t.match(/^(\d+)\s*\/\s*(\d+)\s+(.+?)\s+(\d+)$/);
    if (!m || Number(m[2]) === 0) {
      if (invalid.length < 20) invalid.push(i + 1);
      return;
    }
    rules++;
    if (samples.length < 12) {
      samples.push({ n: Number(m[1]), d: Number(m[2]), item: m[3], qty: m[4] });
    }
  });
  return { lines: lines.length, rules, invalid, samples };
}

function statRow(label, value, cls) {
  const row = document.createElement('div');
  row.className = 'stat-row';
  const a = document.createElement('span');
  a.textContent = label;
  const b = document.createElement('b');
  b.textContent = value;
  if (cls) b.className = cls;
  row.appendChild(a);
  row.appendChild(b);
  return row;
}

function renderDropStats() {
  const box = $('#dropStats');
  box.innerHTML = '';
  if (!S.dropFile) {
    box.appendChild(statRow('状态', '未选择文件', 'warn'));
    return;
  }
  const r = analyzeDrops(S.dropText);
  box.appendChild(statRow('总行数', r.lines));
  box.appendChild(statRow('有效规则', r.rules, r.rules ? 'ok' : 'bad'));
  box.appendChild(statRow('异常行', r.invalid.length ? r.invalid.length + ' 行' + (r.invalid.length >= 20 ? '（前 20 行）' : '') : '无', r.invalid.length ? 'bad' : 'ok'));
  if (r.invalid.length) {
    const info = document.createElement('div');
    info.className = 'stat-row';
    const a = document.createElement('span');
    a.textContent = '异常行号';
    const b = document.createElement('span');
    b.className = 'bad';
    b.style.fontSize = '11px';
    b.textContent = r.invalid.join(', ');
    info.appendChild(a);
    info.appendChild(b);
    box.appendChild(info);
  }
  if (r.samples.length) {
    const table = document.createElement('table');
    table.className = 'sample-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const label of ['物品', '概率', '数量']) {
      const th = document.createElement('th');
      th.textContent = label;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const s of r.samples) {
      const tr = document.createElement('tr');
      const c1 = document.createElement('td');
      c1.textContent = s.item;
      const c2 = document.createElement('td');
      c2.textContent = ((s.n / s.d) * 100).toFixed(2) + '%';
      const c3 = document.createElement('td');
      c3.textContent = s.qty;
      tr.appendChild(c1);
      tr.appendChild(c2);
      tr.appendChild(c3);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    box.appendChild(table);
    const note = document.createElement('div');
    note.className = 'stat-row';
    const a = document.createElement('span');
    a.textContent = '提示';
    const b = document.createElement('span');
    b.className = 'muted';
    b.textContent = '仅显示前 12 条规则';
    note.appendChild(a);
    note.appendChild(b);
    box.appendChild(note);
  }
}

function renderDbList() {
  const q = $('#dbFilter').value.trim().toLowerCase();
  const ul = $('#dbList');
  ul.innerHTML = '';
  for (const f of S.dbs) {
    if (q && !f.name.toLowerCase().includes(q)) continue;
    const li = document.createElement('li');
    li.className = 'file-item' + (S.mode === 'db' && S.dbFile === f.name ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = f.name;
    const cn = dbTableLabel(f.name);
    if (cn) {
      const tag = document.createElement('span');
      tag.className = 'th-cn';
      tag.textContent = cn;
      name.appendChild(tag);
    }
    const meta = document.createElement('div');
    if (f.error) {
      meta.className = 'fmeta err';
      meta.textContent = '无法解析：' + f.error;
    } else {
      meta.className = 'fmeta';
      meta.textContent = `${f.count}/${f.capacity} 条 · ${f.recSize} 字节/条`;
    }
    li.appendChild(name);
    li.appendChild(meta);
    li.title = f.name + (cn ? ' · ' + cn : '');
    li.addEventListener('click', () => openDb(f.name));
    ul.appendChild(li);
  }
}

function renderDropList() {
  const q = $('#dropFilter').value.trim().toLowerCase();
  const ul = $('#dropList');
  ul.innerHTML = '';
  for (const f of S.drops) {
    if (q && !f.name.toLowerCase().includes(q)) continue;
    const li = document.createElement('li');
    li.className = 'file-item' + (S.mode === 'drop' && S.dropFile === f.name ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = f.name;
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = `${f.size} 字节 · ${new Date(f.mtime).toLocaleString('zh-CN')}`;
    li.appendChild(name);
    li.appendChild(meta);
    li.title = f.name;
    li.addEventListener('click', () => openDrop(f.name));
    ul.appendChild(li);
  }
}

function visibleRows() {
  const q = S.filter.trim().toLowerCase();
  const nf = S.schema ? S.schema.nameField : null;
  const base = [];
  for (let i = 0; i < S.rows.length; i++) {
    if (q) {
      const val = nf === null ? '' : String(S.rows[i][nf] == null ? '' : S.rows[i][nf]).toLowerCase();
      if (!val.includes(q)) continue;
    }
    base.push({ index: i, row: S.rows[i], added: false });
  }
  for (let k = 0; k < S.added.length; k++) {
    base.push({ index: S.rows.length + k, row: S.added[k], added: true });
  }
  return base;
}

function updateCell(index, field, value) {
  const tr = document.querySelector(`#grid tbody tr[data-index="${index}"]`);
  if (!tr) return;
  const td = tr.querySelector(`td[data-field="${field}"]`);
  if (!td) return;
  td.textContent = value;
  td.classList.toggle('dirty', isDirtyField(index, field));
}

function renderGrid() {
  if (!S.schema) return;
  const thead = $('#grid thead');
  const tbody = $('#grid tbody');
  thead.innerHTML = '';
  const htr = document.createElement('tr');
  const ih = document.createElement('th');
  ih.className = 'col-idx';
  ih.textContent = '#';
  htr.appendChild(ih);
  for (const f of S.schema.fields) {
    const th = document.createElement('th');
    th.textContent = f.name;
    const cn = fieldLabel(f.name);
    if (cn) {
      const span = document.createElement('span');
      span.className = 'th-cn';
      span.textContent = cn;
      th.appendChild(span);
    }
    th.title = `${f.name}${cn ? ' · ' + cn : ''} · ${f.kind === 'string' ? '文本' : f.kind} · ${f.width} 字节`;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  tbody.innerHTML = '';

  const list = visibleRows();
  const totalPages = Math.max(1, Math.ceil(list.length / S.pageSize));
  if (S.page >= totalPages) S.page = totalPages - 1;
  if (S.page < 0) S.page = 0;
  const start = S.page * S.pageSize;
  const slice = list.slice(start, start + S.pageSize);

  for (const item of slice) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === S.selected) tr.className = 'selected';
    if (item.added) tr.className += ' added';

    const idxTd = document.createElement('td');
    idxTd.className = 'col-idx';
    idxTd.textContent = item.index + 1;
    if (item.added) {
      const tag = document.createElement('span');
      tag.className = 'new-tag';
      tag.textContent = '新';
      idxTd.appendChild(tag);
    }
    tr.appendChild(idxTd);

    for (const f of S.schema.fields) {
      const td = document.createElement('td');
      const val = item.row[f.name] == null ? '' : item.row[f.name];
      td.textContent = val;
      td.dataset.field = f.name;
      td.className = f.kind === 'string' ? 'str' : 'num';
      if (f.name === S.schema.nameField && S.schema.nameFieldIsString) td.classList.add('namecell');
      if (isDirtyField(item.index, f.name)) td.classList.add('dirty');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  $('#pageInfo').textContent =
    `第 ${S.page + 1}/${totalPages} 页 · 共 ${list.length} 条` +
    (S.added.length ? `（含新增 ${S.added.length}）` : '');
  $('#prevPage').disabled = S.page <= 0;
  $('#nextPage').disabled = S.page >= totalPages - 1;
  $('#gridHint').textContent = S.filter ? `筛选：${S.filter}` : '点击行后在右侧编辑字段';
}

function buildDetail(index) {
  const form = $('#detailForm');
  form.innerHTML = '';
  const added = index >= S.rows.length;
  const row = added ? S.added[index - S.rows.length] : S.rows[index];
  if (!row) return;

  const title = row[S.schema.nameField];
  $('#detailTitle').textContent = title ? String(title) : (added ? '新记录' : `记录 #${index + 1}`);
  $('#detailSub').textContent = added
    ? '新增记录（保存后写入文件）'
    : `第 ${index + 1} 条 · Idx ${row.Idx == null ? '-' : row.Idx}`;

  for (const f of S.schema.fields) {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('label');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = f.name;
    const cn = fieldLabel(f.name);
    if (cn) {
      const cnSpan = document.createElement('span');
      cnSpan.className = 'field-cn';
      cnSpan.textContent = cn;
      nameSpan.appendChild(cnSpan);
    }
    const kindSpan = document.createElement('span');
    kindSpan.className = 'kind';
    kindSpan.textContent = f.kind === 'string' ? `文本 ${f.width}B` : `${f.kind} 0-${f.kind === 'int16' ? 32767 : 2147483647}`;
    label.appendChild(nameSpan);
    label.appendChild(kindSpan);

    const input = document.createElement('input');
    input.dataset.field = f.name;
    input.value = row[f.name] == null ? '' : row[f.name];
    if (f.kind === 'string') {
      input.type = 'text';
      input.maxLength = f.width;
    } else {
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.max = f.kind === 'int16' ? '32767' : '2147483647';
    }
    if (isDirtyField(index, f.name)) input.classList.add('changed');
    input.addEventListener('input', () => onFieldInput(index, f, input));

    wrap.appendChild(label);
    wrap.appendChild(input);
    form.appendChild(wrap);
  }
}

function onFieldInput(index, field, input) {
  const added = index >= S.rows.length;
  const row = added ? S.added[index - S.rows.length] : S.rows[index];
  if (!row) return;
  const value = input.value;
  row[field.name] = value;
  if (!added) {
    S.edits.set(index + ':' + field.name, value);
    input.classList.add('changed');
  }
  updateCell(index, field.name, value);
  if (field.name === S.schema.nameField) {
    $('#detailTitle').textContent = value || (added ? '新记录' : `记录 #${index + 1}`);
  }
  updateMeta();
}

function selectRow(index) {
  S.selected = index;
  document.querySelectorAll('#grid tbody tr.selected').forEach((tr) => tr.classList.remove('selected'));
  const tr = document.querySelector(`#grid tbody tr[data-index="${index}"]`);
  if (tr) tr.classList.add('selected');
  $('#detail').classList.remove('hidden');
  buildDetail(index);
}

function closeDetail() {
  S.selected = -1;
  $('#detail').classList.add('hidden');
  document.querySelectorAll('#grid tbody tr.selected').forEach((tr) => tr.classList.remove('selected'));
}

function updateDbHeader() {
  if (!S.schema) return;
  const title = $('#dbTitle');
  title.textContent = S.dbFile || '未选择数据库';
  const titleCn = dbTableLabel(S.dbFile);
  if (titleCn) {
    const tag = document.createElement('span');
    tag.className = 'th-cn';
    tag.textContent = titleCn;
    title.appendChild(tag);
  }
  const total = S.rows.length + S.added.length;
  $('#dbMeta').textContent =
    `${total}${S.added.length ? `（含新增 ${S.added.length}）` : ''} 条 · 容量 ${S.schema.capacity} · ` +
    `${S.schema.recSize} 字节/条 · ${S.schema.fields.length} 个字段`;
}

function updateMeta() {
  const dot = $('#dirtyDot');
  if (S.mode === 'monster') {
    if (window.updateMonsterMeta) window.updateMonsterMeta();
    return;
  }
  if (S.mode === 'activity') {
    if (window.updateActivityMeta) window.updateActivityMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'task') {
    if (window.updateTaskMeta) window.updateTaskMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'npcwork') {
    if (window.updateNpcWorkMeta) window.updateNpcWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'item') {
    if (window.updateItemWorkMeta) window.updateItemWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'growth') {
    if (window.updateGrowthMeta) window.updateGrowthMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'drops') {
    if (window.updateDropWorkMeta) window.updateDropWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'spawns') {
    if (window.updateSpawnWorkMeta) window.updateSpawnWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'maps') {
    if (window.updateMapWorkMeta) window.updateMapWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'shopwork') {
    if (window.updateShopWorkMeta) window.updateShopWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'scriptwork') {
    if (window.updateScriptWorkMeta) window.updateScriptWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'castlework') {
    if (window.updateCastleWorkMeta) window.updateCastleWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'textwork') {
    if (window.updateTextWorkMeta) window.updateTextWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'starterwork') {
    if (window.updateStarterWorkMeta) window.updateStarterWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode === 'healthwork') {
    if (window.updateHealthWorkMeta) window.updateHealthWorkMeta();
    dot.classList.toggle('on', false);
    return;
  }
  if (S.mode.startsWith('cfg')) {
    if (window.updateConfigMeta) window.updateConfigMeta();
    return;
  }
  if (S.mode === 'db') {
    const n = dirtyCount();
    dot.classList.toggle('on', n > 0);
    $('#btnSave').disabled = n === 0 || !S.dbFile;
    $('#btnSave').textContent = n > 0 ? `保存 (${n})` : '保存';
    $('#statusText').textContent = S.dbFile
      ? `已打开 ${S.dbFile}${n ? ` · ${n} 处未保存` : ''}`
      : '未选择数据库';
    updateDbHeader();
  } else if (S.mode === 'drop') {
    const d = Boolean(S.dropFile) && S.dropText !== S.dropOriginal;
    dot.classList.toggle('on', d);
    $('#btnDropSave').disabled = !d;
    $('#btnDropSave').textContent = d ? '保存' : '保存';
    $('#statusText').textContent = S.dropFile
      ? `已打开 ${S.dropFile}${d ? ' · 有未保存修改' : ''}`
      : '未选择爆率文件';
  }
}

function confirmDiscard() {
  if (S.mode === 'monster') {
    return window.monsterConfirmDiscard ? window.monsterConfirmDiscard() : true;
  }
  if (S.mode.startsWith('cfg')) {
    return window.configConfirmDiscard ? window.configConfirmDiscard() : true;
  }
  if (S.mode === 'castlework') {
    return window.castleConfirmDiscard ? window.castleConfirmDiscard() : true;
  }
  if (S.mode === 'db' && dirtyCount() > 0) {
    return confirm('当前数据库有未保存的修改，确定放弃并继续？');
  }
  if (S.mode === 'drop' && S.dropFile && S.dropText !== S.dropOriginal) {
    return confirm('当前爆率文件有未保存的修改，确定放弃并继续？');
  }
  return true;
}

async function openDb(name, force) {
  if (!force && !confirmDiscard()) return;
  try {
    const data = await api('/api/db?file=' + encodeURIComponent(name));
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
    if (window.hideHealthWorkView) window.hideHealthWorkView();
    S.mode = 'db';
    S.dbFile = name;
    S.schema = data.schema;
    S.rows = data.rows;
    S.original = data.rows.map((r) => ({ ...r }));
    S.edits.clear();
    S.added = [];
    S.selected = -1;
    S.page = 0;
    S.filter = '';
    $('#rowSearch').value = '';
    showSideTab('db');
    $('#dbView').classList.remove('hidden');
    $('#dropView').classList.add('hidden');
    $('#detail').classList.add('hidden');
    renderGrid();
    renderDbList();
    renderDropList();
    updateMeta();
  } catch (e) {
    toast('打开失败：' + e.message, 'err');
  }
}

async function openDrop(name, force) {
  if (!force && !confirmDiscard()) return;
  try {
    const data = await api('/api/drop?file=' + encodeURIComponent(name));
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
    if (window.hideHealthWorkView) window.hideHealthWorkView();
    const normalized = data.text.replace(/\r\n/g, '\n');
    S.mode = 'drop';
    S.dropFile = name;
    S.dropText = normalized;
    S.dropOriginal = normalized;
    S.dropCRLF = data.text.includes('\r\n');
    showSideTab('drop');
    $('#dropView').classList.remove('hidden');
    $('#dbView').classList.add('hidden');
    $('#detail').classList.add('hidden');
    $('#dropText').value = normalized;
    $('#dropTitle').textContent = name;
    $('#dropMeta').textContent = `${data.size} 字节 · ${normalized.split('\n').length} 行`;
    renderDropList();
    renderDbList();
    renderDropStats();
    updateMeta();
  } catch (e) {
    toast('打开失败：' + e.message, 'err');
  }
}

function addRecord(source) {
  if (!S.dbFile || !S.schema) return toast('请先选择数据库', 'err');
  if (S.rows.length + S.added.length >= S.schema.capacity) {
    return toast(`空间不足：该文件最多容纳 ${S.schema.capacity} 条记录`, 'err');
  }
  const base = {};
  for (const f of S.schema.fields) {
    base[f.name] = f.kind === 'string' ? '' : 0;
    if (source) base[f.name] = source[f.name];
  }
  if ('Idx' in base) base.Idx = '';
  if (S.schema.nameFieldIsString) {
    const nf = S.schema.nameField;
    base[nf] = source ? String(base[nf] || '') + '副本' : '新记录';
  }
  S.added.push(base);
  S.filter = '';
  $('#rowSearch').value = '';
  S.selected = S.rows.length + S.added.length - 1;
  S.page = Math.ceil((S.rows.length + S.added.length) / S.pageSize) - 1;
  renderGrid();
  selectRow(S.selected);
  updateMeta();
  const firstInput = $('#detailForm input');
  if (firstInput) firstInput.focus();
}

function collectChanges() {
  const map = new Map();
  for (const [key, value] of S.edits) {
    const sep = key.indexOf(':');
    const index = Number(key.slice(0, sep));
    const field = key.slice(sep + 1);
    if (!Number.isInteger(index) || index >= S.rows.length) continue;
    if (!map.has(index)) map.set(index, { index, values: {} });
    map.get(index).values[field] = value;
  }
  return [...map.values()];
}

async function saveDb() {
  if (!S.dbFile || dirtyCount() === 0) return;
  const changes = collectChanges();
  const added = S.added;
  $('#btnSave').disabled = true;
  try {
    const res = await api('/api/db/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: S.dbFile, changes, added })
    });
    let msg = `保存成功：修改 ${res.changedRows} 条，新增 ${res.addedRows} 条。当前 ${res.count}/${res.capacity} 条。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await openDb(S.dbFile, true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

async function saveDrop() {
  if (!S.dropFile || S.dropText === S.dropOriginal) return;
  const text = S.dropCRLF ? S.dropText.replace(/\n/g, '\r\n') : S.dropText;
  $('#btnDropSave').disabled = true;
  try {
    const res = await api('/api/drop/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: S.dropFile, text })
    });
    S.dropOriginal = S.dropText;
    toast(`保存成功：${res.file}（${res.size} 字节）\n备份：${res.backup}`, 'ok');
    await refreshState();
    $('#dropMeta').textContent = `${res.size} 字节 · ${S.dropText.split(/\r?\n/).length} 行`;
    updateMeta();
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

async function refreshState() {
  const st = await api('/api/state');
  S.dbs = st.dbs;
  S.drops = st.drops;
  S.configs = st.configs || null;
  updateWorkNavBadges();
  renderDbList();
  renderDropList();
  if (window.refreshConfigState) window.refreshConfigState(st);
  if (window.refreshActivityState) window.refreshActivityState(st);
  if (window.refreshTaskState) window.refreshTaskState(st);
  if (window.refreshNpcWorkState) window.refreshNpcWorkState(st);
  if (window.refreshItemWorkState) window.refreshItemWorkState(st);
  if (window.refreshGrowthState) window.refreshGrowthState(st);
  if (window.refreshDropWorkState) window.refreshDropWorkState(st);
  if (window.refreshSpawnWorkState) window.refreshSpawnWorkState(st);
  if (window.refreshMapWorkState) window.refreshMapWorkState(st);
  if (window.refreshShopWorkState) window.refreshShopWorkState(st);
  if (window.refreshScriptWorkState) window.refreshScriptWorkState(st);
  if (window.refreshCastleWorkState) window.refreshCastleWorkState(st);
  if (window.refreshTextWorkState) window.refreshTextWorkState(st);
  if (window.refreshStarterWorkState) window.refreshStarterWorkState(st);
  if (window.refreshHealthWorkState) window.refreshHealthWorkState(st);
  document.dispatchEvent(new CustomEvent('state:refreshed', { detail: st }));
}

async function init() {
  try {
    await refreshState();
  } catch (e) {
    $('#statusText').textContent = '无法连接本地服务';
    toast('无法连接本地服务：' + e.message + '\n请通过启动编辑器.bat 启动', 'err');
    return;
  }
  const preferred =
    S.dbs.find((d) => d.name.toLowerCase() === 'stditems.db' && !d.error) ||
    S.dbs.find((d) => !d.error);
  if (preferred) {
    await openDb(preferred.name, true);
  } else {
    toast('数据库目录中没有可解析的 .db 文件', 'err');
  }
}

$('#grid tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  selectRow(Number(tr.dataset.index));
});

$('#rowSearch').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    S.filter = $('#rowSearch').value;
    S.page = 0;
    renderGrid();
  }, 150);
});

$('#dbFilter').addEventListener('input', renderDbList);
$('#dropFilter').addEventListener('input', renderDropList);

function hideAllViews() {
  document.querySelectorAll('.main > .view').forEach((view) => view.classList.add('hidden'));
  const detail = $('#detail');
  if (detail) detail.classList.add('hidden');
}

function openBasicTab(target) {
  if (target === 'db') {
    if (S.mode === 'db' && S.dbFile) {
      hideAllViews();
      showSideTab('db');
      $('#dbView').classList.remove('hidden');
      return;
    }
    if (S.dbFile) {
      openDb(S.dbFile);
      return;
    }
    hideAllViews();
    showSideTab('db');
    $('#dbView').classList.remove('hidden');
    return;
  }
  if (target === 'drop') {
    if (S.mode === 'drop' && S.dropFile) {
      hideAllViews();
      showSideTab('drop');
      $('#dropView').classList.remove('hidden');
      return;
    }
    if (S.dropFile) {
      openDrop(S.dropFile);
      return;
    }
    hideAllViews();
    showSideTab('drop');
    $('#dropView').classList.remove('hidden');
    return;
  }
  if (target === 'mon') {
    if (window.openMonsterWorkbench) window.openMonsterWorkbench();
    else showSideTab('mon');
    return;
  }
  if (target === 'cfg') {
    if (S.mode.startsWith('cfg')) {
      showSideTab('cfg');
      return;
    }
    if (!confirmDiscard()) return;
    hideAllViews();
    const item = document.querySelector('#cfgList .file-item.active') ||
      document.querySelector('#cfgList .file-item');
    if (item) item.click();
    else showSideTab('cfg');
  }
}

function openSideTarget(name) {
  if (BASIC_TABS.some((tab) => tab.target === name)) {
    openBasicTab(name);
    return;
  }
  if (name === 'act' && window.openActivityView) {
    window.openActivityView();
    return;
  }
  if (name === 'tsk' && window.openTaskView) {
    window.openTaskView();
    return;
  }
  if (name === 'npcw' && window.openNpcWorkView) {
    window.openNpcWorkView();
    return;
  }
  if (name === 'itemw' && window.openItemWorkView) {
    window.openItemWorkView();
    return;
  }
  if (name === 'dpw' && window.openDropsView) {
    window.openDropsView();
    return;
  }
  if (name === 'spw' && window.openSpawnView) {
    window.openSpawnView();
    return;
  }
  if (name === 'mpw' && window.openMapView) {
    window.openMapView();
    return;
  }
  if (name === 'shw' && window.openShopView) {
    window.openShopView();
    return;
  }
  if (name === 'scw' && window.openScriptView) {
    window.openScriptView();
    return;
  }
  if (name === 'cbw' && window.openCastleView) {
    window.openCastleView();
    return;
  }
  if (name === 'txw' && window.openTextWorkView) {
    window.openTextWorkView();
    return;
  }
  if (name === 'stw' && window.openStarterWorkView) {
    window.openStarterWorkView();
    return;
  }
  if (name === 'grw' && window.openGrowthView) {
    window.openGrowthView();
    return;
  }
  if (name === 'hw' && window.openHealthWorkView) {
    window.openHealthWorkView();
    return;
  }
  showSideTab(name);
}

const dataBar = document.querySelector('.data-bar');
if (dataBar) {
  dataBar.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-basic-tab]');
    if (!tab || !dataBar.contains(tab)) return;
    openBasicTab(tab.dataset.basicTab);
  });
}

const worknav = document.querySelector('.worknav');
if (worknav) {
  worknav.addEventListener('click', (e) => {
    const item = e.target.closest('[data-work-target]');
    if (!item || !worknav.contains(item)) return;
    openSideTarget(item.dataset.workTarget);
  });
}

$('#prevPage').addEventListener('click', () => {
  if (S.page > 0) {
    S.page--;
    renderGrid();
  }
});
$('#nextPage').addEventListener('click', () => {
  S.page++;
  renderGrid();
});

$('#btnAdd').addEventListener('click', () => addRecord(null));
$('#btnDup').addEventListener('click', () => {
  if (S.selected < 0) return toast('请先选择一行记录', 'err');
  const row = S.selected < S.rows.length ? S.rows[S.selected] : S.added[S.selected - S.rows.length];
  addRecord(row);
});
$('#btnReload').addEventListener('click', () => {
  if (S.dbFile) openDb(S.dbFile);
});
$('#btnSave').addEventListener('click', saveDb);
$('#btnCloseDetail').addEventListener('click', closeDetail);

$('#btnDropReload').addEventListener('click', () => {
  if (S.dropFile && confirmDiscard()) openDrop(S.dropFile, true);
});
$('#btnDropSave').addEventListener('click', saveDrop);
$('#dropText').addEventListener('input', () => {
  S.dropText = $('#dropText').value;
  updateMeta();
  clearTimeout(dropTimer);
  dropTimer = setTimeout(renderDropStats, 200);
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (S.mode === 'db') saveDb();
    else if (S.mode === 'drop') saveDrop();
  }
  if (e.key === 'Escape' && S.mode === 'db') closeDetail();
});

window.addEventListener('beforeunload', (e) => {
  const dirty =
    (S.mode === 'db' && dirtyCount() > 0) ||
    (S.mode === 'drop' && S.dropFile && S.dropText !== S.dropOriginal) ||
    (S.mode === 'monster' && window.monsterAnyDirty && window.monsterAnyDirty()) ||
    (window.configAnyDirty && window.configAnyDirty());
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

renderWorkNav();

window.appReady = init();
window.appReady.then(() => window.dispatchEvent(new Event('app-ready')));

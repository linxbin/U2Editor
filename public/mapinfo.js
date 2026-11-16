'use strict';

const MAPINFO_KEYS = ['jump', 'nofight', 'sabukarea', 'sabukjump', 'redvillage', 'property', 'plantrange'];

function mapinfoTextArea(value, rows) {
  const t = document.createElement('textarea');
  t.className = 'field-textarea';
  t.rows = rows || 3;
  t.value = value == null ? '' : String(value);
  return t;
}

function mapinfoSection() {
  const m = CFG.mapinfo;
  return m.data && m.data.sections.find((s) => s.key === m.section);
}

function mapinfoMap(key) {
  if (!CFG.mapinfo.edits[key]) CFG.mapinfo.edits[key] = new Map();
  return CFG.mapinfo.edits[key];
}

function mapinfoAdded(key) {
  if (!CFG.mapinfo.added[key]) CFG.mapinfo.added[key] = [];
  return CFG.mapinfo.added[key];
}

function mapinfoDeleted(key) {
  if (!CFG.mapinfo.deleted[key]) CFG.mapinfo.deleted[key] = new Set();
  return CFG.mapinfo.deleted[key];
}

function mapinfoRows() {
  const m = CFG.mapinfo;
  const sec = mapinfoSection();
  if (!sec) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < sec.rows.length; i++) {
    if (mapinfoDeleted(m.section).has(i)) continue;
    const row = mapinfoMap(m.section).get(i) || sec.rows[i];
    if (q && !Object.values(row).some((v) => String(v).toLowerCase().includes(q))) continue;
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < mapinfoAdded(m.section).length; k++) {
    const row = mapinfoAdded(m.section)[k];
    if (q && !Object.values(row).some((v) => String(v).toLowerCase().includes(q))) continue;
    out.push({ index: sec.rows.length + k, row, added: true });
  }
  return out;
}

function getMapinfoRow(index) {
  const m = CFG.mapinfo;
  const sec = mapinfoSection();
  if (!sec) return null;
  if (index < sec.rows.length) return mapinfoMap(m.section).get(index) || sec.rows[index];
  return mapinfoAdded(m.section)[index - sec.rows.length];
}

function setMapinfoRow(index, row) {
  const m = CFG.mapinfo;
  const sec = mapinfoSection();
  if (!sec) return;
  if (index >= sec.rows.length) {
    mapinfoAdded(m.section)[index - sec.rows.length] = row;
    return;
  }
  const base = sec.rows[index];
  const keys = Object.keys(base);
  if (keys.every((k) => row[k] === base[k])) mapinfoMap(m.section).delete(index);
  else mapinfoMap(m.section).set(index, row);
}

function buildMapinfoSectionSelect() {
  const m = CFG.mapinfo;
  const sel = cfgEl('mapinfoSection');
  cfgClear(sel);
  for (const sec of m.data.sections) {
    const o = document.createElement('option');
    o.value = sec.key;
    o.textContent = `${sec.label} · ${sec.rows.length}`;
    sel.appendChild(o);
  }
  sel.value = m.section;
}

function mapinfoColumns(sec) {
  if (sec.kind === 'jump') return ['#', '地图', 'X', 'Y', '目标地图', '目标 X', '目标 Y'];
  if (sec.kind === 'area') return ['#', '地图', 'X', 'Y', '半径'];
  if (sec.kind === 'nofight') return ['#', '地图', 'X', 'Y', '安全区半径', '城镇范围', '出生点'];
  return ['#', '地图', '属性'];
}

function mapinfoCells(sec, row) {
  if (sec.kind === 'jump') return [row.map, row.x, row.y, row.dest, row.dx, row.dy];
  if (sec.kind === 'area') return [row.map, row.x, row.y, row.radius];
  if (sec.kind === 'nofight') return [row.map, row.x, row.y, row.safeRadius, row.townRadius, row.spawn];
  return [row.map, row.flags];
}

function renderMapinfo() {
  const m = CFG.mapinfo;
  const sec = mapinfoSection();
  if (!sec) return;
  const thead = cfgEl('mapinfoGrid').querySelector('thead');
  const tbody = cfgEl('mapinfoGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of mapinfoColumns(sec)) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = mapinfoRows();
  const totalPages = Math.max(1, Math.ceil(list.length / m.pageSize));
  if (m.page >= totalPages) m.page = totalPages - 1;
  if (m.page < 0) m.page = 0;
  const start = m.page * m.pageSize;
  for (const item of list.slice(start, start + m.pageSize)) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.selected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [item.index + 1, ...mapinfoCells(sec, item.row)];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (sec.kind === 'property' && i === 2) td.className = 'str';
      else if (sec.kind !== 'property' && i >= 2) td.className = 'num';
      else td.className = 'str';
      if (i === 0 && item.added) {
        const tag = document.createElement('span');
        tag.className = 'new-tag';
        tag.textContent = '新';
        td.appendChild(tag);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  cfgEl('mapinfoPageInfo').textContent =
    `第 ${m.page + 1}/${totalPages} 页 · 共 ${list.length} 条`;
  cfgEl('mapinfoPrev').disabled = m.page <= 0;
  cfgEl('mapinfoNext').disabled = m.page >= totalPages - 1;
  cfgEl('mapinfoMeta').textContent =
    `${sec.label} · ${sec.rows.length} 条` +
    (sec.invalid.length ? ` · ${sec.invalid.length} 行特殊内容` : '') +
    ` · 全文件 ${m.data.sections.reduce((n, s) => n + s.rows.length, 0)} 条规则`;
  cfgEl('mapinfoHint').textContent = sec.kind === 'property'
    ? '地图属性用空格分隔，例如 SAFE NORECALL NORECONNECT(SH045)；保存时只改写修改行'
    : '坐标格式为 X,Y；跳转点使用 “源地图 X,Y -> 目标地图 X,Y”';
}

function buildMapinfoForm(index) {
  const m = CFG.mapinfo;
  const sec = mapinfoSection();
  const row = getMapinfoRow(index);
  if (!row || !sec) return;
  const added = index >= sec.rows.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = added ? '新增' + sec.label : `${sec.label} #${index + 1}`;
  cfgEl('cfgDetailSub').textContent = added ? '新增规则（保存后写入文件）' : `第 ${index + 1} 条`;
  cfgEl('cfgNote').textContent = 'MapInfo 分区编辑：只改写修改过的行，注释、空行和其他分区保持不变。';

  const controls = {};
  const append = (key, label, control, hint) => {
    controls[key] = control;
    form.appendChild(cfgField(label, control, hint));
  };
  const map = cfgText(row.map, 'mapList', 64);
  append('map', '地图编号', map, '例如 0 / SH021');
  if (sec.kind === 'jump') {
    const x = cfgNumber(row.x, 0, 100000);
    const y = cfgNumber(row.y, 0, 100000);
    const dest = cfgText(row.dest, 'mapList', 64);
    const dx = cfgNumber(row.dx, 0, 100000);
    const dy = cfgNumber(row.dy, 0, 100000);
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(cfgField('源 X', x));
    grid.appendChild(cfgField('源 Y', y));
    grid.appendChild(cfgField('目标 X', dx));
    grid.appendChild(cfgField('目标 Y', dy));
    form.appendChild(grid);
    append('dest', '目标地图', dest);
    Object.assign(controls, { x, y, dx, dy });
  } else if (sec.kind === 'nofight') {
    const x = cfgNumber(row.x, 0, 100000);
    const y = cfgNumber(row.y, 0, 100000);
    const safeRadius = cfgNumber(row.safeRadius, 0, 100000);
    const townRadius = cfgNumber(row.townRadius, 0, 100000);
    const spawn = cfgNumber(row.spawn, 0, 1);
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(cfgField('X', x));
    grid.appendChild(cfgField('Y', y));
    grid.appendChild(cfgField('安全区半径', safeRadius));
    grid.appendChild(cfgField('城镇范围', townRadius));
    grid.appendChild(cfgField('出生点 0/1', spawn));
    form.appendChild(grid);
    Object.assign(controls, { x, y, safeRadius, townRadius, spawn });
  } else if (sec.kind === 'area') {
    const x = cfgNumber(row.x, 0, 100000);
    const y = cfgNumber(row.y, 0, 100000);
    const radius = cfgNumber(row.radius, 0, 100000);
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(cfgField('X', x));
    grid.appendChild(cfgField('Y', y));
    grid.appendChild(cfgField('半径', radius));
    form.appendChild(grid);
    Object.assign(controls, { x, y, radius });
  } else {
    const flags = mapinfoTextArea(row.flags, 5);
    append('flags', '地图属性', flags, '空格分隔，支持 NORECALL 等标记');
  }

  const apply = (key, value, numeric) => {
    const cur = { ...getMapinfoRow(index) };
    cur[key] = numeric ? cfgNum(value) : value;
    setMapinfoRow(index, cur);
    renderMapinfo();
    updateMeta();
  };
  for (const [key, control] of Object.entries(controls)) {
    const numeric = control.type === 'number';
    control.addEventListener('input', () => apply(key, control.value, numeric));
  }
  cfgMarkSelected(cfgEl('mapinfoGrid').querySelector('tbody'), index);
}

function defaultMapinfoRow(sec) {
  if (sec.kind === 'jump') return { map: '0', x: 0, y: 0, dest: '0', dx: 0, dy: 0 };
  if (sec.kind === 'nofight') return { map: '0', x: 0, y: 0, safeRadius: 0, townRadius: 0, spawn: 0 };
  if (sec.kind === 'area') return { map: '0', x: 0, y: 0, radius: 0 };
  return { map: '0', flags: 'SAFE' };
}

function mapinfoAdd(source) {
  const m = CFG.mapinfo;
  const sec = mapinfoSection();
  if (!sec) return;
  const row = source ? { ...source } : defaultMapinfoRow(sec);
  mapinfoAdded(m.section).push(row);
  m.search = '';
  cfgEl('mapinfoSearch').value = '';
  m.selected = sec.rows.length + mapinfoAdded(m.section).length - 1;
  m.page = Math.max(0, Math.ceil(mapinfoRows().length / m.pageSize) - 1);
  renderMapinfo();
  buildMapinfoForm(m.selected);
  updateMeta();
}

async function mapinfoDelete() {
  const m = CFG.mapinfo;
  const sec = mapinfoSection();
  if (!sec || m.selected < 0) return toast('请先选择一条规则', 'err');
  const index = m.selected;
  const row = getMapinfoRow(index);
  if (!row) return;
  if (!(await uiConfirm({
    title: '删除' + sec.label,
    message: `删除 ${sec.label}：${row.map}？`,
    okText: '删除',
    danger: true
  }))) return;
  if (index >= sec.rows.length) {
    mapinfoAdded(m.section).splice(index - sec.rows.length, 1);
  } else {
    mapinfoDeleted(m.section).add(index);
    mapinfoMap(m.section).delete(index);
  }
  cfgCloseDetail();
  renderMapinfo();
  updateMeta();
}

async function openMapinfoConfig(force) {
  if (!force && !(await confirmDiscard())) return;
  try {
    const data = await api('/api/config/mapinfo');
    const m = CFG.mapinfo;
    m.data = data;
    m.section = data.sections[0] ? data.sections[0].key : 'jump';
    m.search = '';
    m.page = 0;
    m.selected = -1;
    m.edits = {};
    m.added = {};
    m.deleted = {};
    for (const sec of data.sections) {
      m.edits[sec.key] = new Map();
      m.added[sec.key] = [];
      m.deleted[sec.key] = new Set();
    }
    cfgSetMode('cfgMapinfo');
    cfgEl('mapinfoSearch').value = '';
    buildMapinfoSectionSelect();
    if (data.mapNames) fillDatalist('mapList', Object.keys(data.mapNames).sort((a, b) => a.localeCompare(b, 'zh-CN')));
    renderMapinfo();
    updateMeta();
  } catch (e) {
    toast('打开地图规则失败：' + e.message, 'err');
  }
}

async function saveMapinfoConfig() {
  const m = CFG.mapinfo;
  if (!m.data || cfgDirty('cfgMapinfo') === 0) return;
  const sections = {};
  for (const sec of m.data.sections) {
    sections[sec.key] = {
      changes: [...mapinfoMap(sec.key).entries()].map(([index, values]) => ({ index, values })),
      added: mapinfoAdded(sec.key),
      deleted: [...mapinfoDeleted(sec.key)]
    };
  }
  const btn = cfgEl('btnMapinfoSave');
  btn.disabled = true;
  try {
    const res = await api('/api/config/mapinfo/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections })
    });
    let msg = `保存成功：修改 ${res.changedRows} 条，新增 ${res.addedRows} 条，删除 ${res.deletedRows} 条。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await openMapinfoConfig(true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

/* 事件绑定 */
cfgEl('mapinfoGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  CFG.mapinfo.selected = Number(tr.dataset.index);
  buildMapinfoForm(CFG.mapinfo.selected);
});
cfgEl('mapinfoSection').addEventListener('change', () => {
  CFG.mapinfo.section = cfgEl('mapinfoSection').value;
  CFG.mapinfo.page = 0;
  CFG.mapinfo.selected = -1;
  cfgCloseDetail();
  renderMapinfo();
});
let mapinfoSearchTimer = null;
cfgEl('mapinfoSearch').addEventListener('input', () => {
  clearTimeout(mapinfoSearchTimer);
  mapinfoSearchTimer = setTimeout(() => {
    CFG.mapinfo.search = cfgEl('mapinfoSearch').value;
    CFG.mapinfo.page = 0;
    renderMapinfo();
  }, 150);
});
cfgEl('mapinfoPrev').addEventListener('click', () => {
  if (CFG.mapinfo.page > 0) {
    CFG.mapinfo.page--;
    renderMapinfo();
  }
});
cfgEl('mapinfoNext').addEventListener('click', () => {
  CFG.mapinfo.page++;
  renderMapinfo();
});
cfgEl('btnMapinfoAdd').addEventListener('click', () => mapinfoAdd(null));
cfgEl('btnMapinfoDup').addEventListener('click', () => {
  if (CFG.mapinfo.selected < 0) return toast('请先选择一条规则', 'err');
  mapinfoAdd(getMapinfoRow(CFG.mapinfo.selected));
});
cfgEl('btnMapinfoDel').addEventListener('click', mapinfoDelete);
cfgEl('btnMapinfoReload').addEventListener('click', () => openMapinfoConfig());
cfgEl('btnMapinfoSave').addEventListener('click', saveMapinfoConfig);

window.openMapinfoConfig = openMapinfoConfig;

async function openMapinfoAt(map, section) {
  const code = String(map == null ? '' : map);
  if (S.mode !== 'cfgMapinfo' && typeof confirmDiscard === 'function' && !(await confirmDiscard())) return;
  await openMapinfoConfig(true);
  const m = CFG.mapinfo;
  if (!m.data) return;
  const key = code.toLowerCase();
  const known = new Set(m.data.sections.map((s) => s.key));
  let target = section && known.has(section) ? section : '';
  if (!target) {
    const owner = m.data.sections.find((sec) =>
      sec.rows.some((row) => String(row.map).toLowerCase() === key)
    );
    target = owner ? owner.key : 'jump';
  }
  m.section = target;
  cfgEl('mapinfoSection').value = target;
  m.search = code;
  cfgEl('mapinfoSearch').value = code;
  m.page = 0;
  m.selected = -1;
  renderMapinfo();
  const list = mapinfoRows();
  const pos = list.findIndex((item) => String(item.row.map).toLowerCase() === key);
  if (pos < 0) {
    cfgCloseDetail();
    updateMeta();
    return;
  }
  const item = list[pos];
  m.selected = item.index;
  m.page = Math.floor(pos / m.pageSize);
  renderMapinfo();
  buildMapinfoForm(item.index);
  updateMeta();
  const tr = cfgEl('mapinfoGrid').querySelector(`tbody tr[data-index="${item.index}"]`);
  if (tr) tr.scrollIntoView({ block: 'center' });
}
window.openMapinfoAt = openMapinfoAt;
window.saveMapinfoConfig = saveMapinfoConfig;

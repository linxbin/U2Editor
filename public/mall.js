'use strict';

const MALL_ITEM_KEYS = ['id', 'looks', 'biglooks', 'type', 'dispname', 'name', 'price', 'unitnum', 'desc'];
const MALL_HOT_KEYS = ['id', 'looks', 'biglooks', 'dispname', 'price'];

function mallTextArea(value, rows) {
  const t = document.createElement('textarea');
  t.className = 'field-textarea';
  t.rows = rows || 5;
  t.value = value == null ? '' : String(value);
  return t;
}

function mallEffectiveClasses() {
  const m = CFG.mall;
  if (!m.data) return [];
  return m.data.classes.map((c) => ({ ...c, type: m.classEdits.get(c.index) || c.type }));
}

function mallEffectiveSubs() {
  const m = CFG.mall;
  if (!m.data) return [];
  return m.data.subclasses.map((s) => ({ ...s, type: m.subEdits.get(s.index) || s.type }));
}

function mallClassOf(row) {
  const classes = mallEffectiveClasses();
  return classes.find((c) => c.index === row.classIndex) ||
    classes.find((c) => String(c.id) === String(row.classId)) ||
    { id: row.classId, type: row.classType, index: row.classIndex };
}

function mallSubOf(row) {
  const subs = mallEffectiveSubs();
  return subs.find((s) => s.index === row.subIndex) ||
    subs.find((s) => String(s.classId) === String(row.classId) && String(s.id) === String(row.subId)) ||
    { id: row.subId, type: row.subType, index: row.subIndex };
}

function mallDecorated(row) {
  const cls = mallClassOf(row);
  const sub = mallSubOf(row);
  return { ...row, classType: cls.type, subType: sub.type };
}

function mallItemList() {
  const m = CFG.mall;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < m.data.items.length; i++) {
    if (m.deleted.has(i)) continue;
    const row = mallDecorated(m.edits.get(i) || m.data.items[i]);
    if (m.classFilter && String(row.classId) !== m.classFilter) continue;
    if (m.subFilter && String(row.subId) !== m.subFilter) continue;
    if (q) {
      const hay = `${row.id} ${row.dispname} ${row.name} ${row.classType} ${row.subType}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.added.length; k++) {
    const row = mallDecorated(m.added[k]);
    if (m.classFilter && String(row.classId) !== m.classFilter) continue;
    if (m.subFilter && String(row.subId) !== m.subFilter) continue;
    if (q) {
      const hay = `${row.id} ${row.dispname} ${row.name} ${row.classType} ${row.subType}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({ index: m.data.items.length + k, row, added: true });
  }
  return out;
}

function mallHotList() {
  const m = CFG.mall;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < m.data.hotItems.length; i++) {
    if (m.hotDeleted.has(i)) continue;
    const row = m.hotEdits.get(i) || m.data.hotItems[i];
    if (q && !`${row.id} ${row.dispname}`.toLowerCase().includes(q)) continue;
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.hotAdded.length; k++) {
    const row = m.hotAdded[k];
    if (q && !`${row.id} ${row.dispname}`.toLowerCase().includes(q)) continue;
    out.push({ index: m.data.hotItems.length + k, row, added: true });
  }
  return out;
}

function getMallItem(index) {
  const m = CFG.mall;
  if (index < m.data.items.length) return m.edits.get(index) || m.data.items[index];
  return m.added[index - m.data.items.length];
}

function setMallItem(index, row) {
  const m = CFG.mall;
  if (index >= m.data.items.length) {
    m.added[index - m.data.items.length] = row;
    return;
  }
  const base = m.data.items[index];
  const same = MALL_ITEM_KEYS.every((k) => row[k] === base[k]);
  if (same) m.edits.delete(index);
  else m.edits.set(index, row);
}

function getMallHot(index) {
  const m = CFG.mall;
  if (index < m.data.hotItems.length) return m.hotEdits.get(index) || m.data.hotItems[index];
  return m.hotAdded[index - m.data.hotItems.length];
}

function setMallHot(index, row) {
  const m = CFG.mall;
  if (index >= m.data.hotItems.length) {
    m.hotAdded[index - m.data.hotItems.length] = row;
    return;
  }
  const base = m.data.hotItems[index];
  const same = MALL_HOT_KEYS.every((k) => row[k] === base[k]);
  if (same) m.hotEdits.delete(index);
  else m.hotEdits.set(index, row);
}

function mallUsedIds() {
  const used = new Set();
  for (let i = 0; i < CFG.mall.data.items.length; i++) {
    if (!CFG.mall.deleted.has(i)) used.add((CFG.mall.edits.get(i) || CFG.mall.data.items[i]).id);
  }
  for (let i = 0; i < CFG.mall.data.hotItems.length; i++) {
    if (!CFG.mall.hotDeleted.has(i)) used.add((CFG.mall.hotEdits.get(i) || CFG.mall.data.hotItems[i]).id);
  }
  for (const row of CFG.mall.added) used.add(row.id);
  for (const row of CFG.mall.hotAdded) used.add(row.id);
  return used;
}

function mallNewId(base, used) {
  let id = String(base || '10000001');
  if (!used.has(id)) return id;
  let n = 2;
  while (used.has(id + n)) n++;
  return id + n;
}

function buildMallClassSelects() {
  const m = CFG.mall;
  const classSel = cfgEl('mallClass');
  const subSel = cfgEl('mallSub');
  cfgClear(classSel);
  cfgClear(subSel);
  const add = (sel, value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  };
  add(classSel, '', '全部大类');
  for (const c of mallEffectiveClasses()) add(classSel, String(c.id), `${c.id} · ${c.type || '(未命名)'}`);
  classSel.value = m.classFilter;
  add(subSel, '', '全部子类');
  for (const s of mallEffectiveSubs()) {
    if (m.classFilter && String(s.classId) !== m.classFilter) continue;
    add(subSel, String(s.id), `${s.id} · ${s.type || '(未命名)'}`);
  }
  subSel.value = m.subFilter;
}

function mallRenderItems() {
  const m = CFG.mall;
  const thead = cfgEl('mallGrid').querySelector('thead');
  const tbody = cfgEl('mallGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '大类', '子类', '商品 ID', '显示名称', '商品名称', '价格', '单位']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = mallItemList();
  const totalPages = Math.max(1, Math.ceil(list.length / m.pageSize));
  if (m.page >= totalPages) m.page = totalPages - 1;
  if (m.page < 0) m.page = 0;
  const start = m.page * m.pageSize;
  for (const item of list.slice(start, start + m.pageSize)) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.selected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [
      item.index + 1, item.row.classType || item.row.classId, item.row.subType || item.row.subId,
      item.row.id, item.row.dispname, item.row.name, item.row.price, item.row.unitnum
    ];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 6 || i === 7) td.className = 'num';
      else if (i === 4) td.className = 'str namecell';
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
  cfgEl('mallPageInfo').textContent =
    `第 ${m.page + 1}/${totalPages} 页 · 共 ${list.length} 件` +
    (m.added.length ? `（含新增 ${m.added.length}）` : '');
  cfgEl('mallPrev').disabled = m.page <= 0;
  cfgEl('mallNext').disabled = m.page >= totalPages - 1;
  cfgEl('mallMeta').textContent =
    `${m.data.items.length} 件商品 · ${m.data.hotItems.length} 件热卖 · ${m.data.classes.length} 个大类`;
}

function mallRenderHot() {
  const m = CFG.mall;
  const thead = cfgEl('mallHotGrid').querySelector('thead');
  const tbody = cfgEl('mallHotGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '商品 ID', '外观', '大图', '显示名称', '价格']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  for (const item of mallHotList()) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.hotSelected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [
      item.index + 1, item.row.id, item.row.looks, item.row.biglooks, item.row.dispname, item.row.price
    ];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 2 || i === 5) td.className = 'num';
      else if (i === 4) td.className = 'str namecell';
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
  if (cfgEl('mallScroll').value !== m.scroll) cfgEl('mallScroll').value = m.scroll;
  cfgEl('mallHotMeta').textContent = `${m.data.hotItems.length - m.hotDeleted.size + m.hotAdded.length} 件热卖商品`;
}

function renderMall() {
  const m = CFG.mall;
  if (!m.data) return;
  cfgEl('mallTabItems').classList.toggle('active', m.tab === 'items');
  cfgEl('mallTabHot').classList.toggle('active', m.tab === 'hot');
  cfgEl('mallItemsWrap').classList.toggle('hidden', m.tab !== 'items');
  cfgEl('mallHotWrap').classList.toggle('hidden', m.tab !== 'hot');
  cfgEl('mallClass').classList.toggle('hidden', m.tab !== 'items');
  cfgEl('mallSub').classList.toggle('hidden', m.tab !== 'items');
  cfgEl('btnMallAdd').textContent = m.tab === 'hot' ? '新增热卖' : '新增商品';
  cfgEl('btnMallDup').classList.toggle('hidden', m.tab === 'hot');
  cfgEl('btnMallDel').textContent = m.tab === 'hot' ? '删除热卖' : '删除商品';
  if (m.tab === 'items') mallRenderItems();
  else mallRenderHot();
  cfgEl('mallHint').textContent = m.tab === 'items'
    ? '商品按大类/子类分组；修改分类名称会影响该分类下全部商品'
    : '热卖商品显示在商城主推区；滚动公告使用 \\\\ 分隔不同行';
  buildMallClassSelects();
}

function buildMallItemForm(index) {
  const m = CFG.mall;
  const row = getMallItem(index);
  if (!row) return;
  const added = index >= m.data.items.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = row.dispname || (added ? '新商品' : `商品 #${index + 1}`);
  cfgEl('cfgDetailSub').textContent = added ? '新增商品（保存后写入文件）' : `第 ${index + 1} 件商品`;
  cfgEl('cfgNote').textContent = '商城配置来自 PTItems.xml；价格按元宝计。修改大类/子类名称会同步影响该分类下所有商品。';

  const cls = mallClassOf(row);
  const sub = mallSubOf(row);
  const classType = cfgText(cls.type || '', null, 80);
  const subType = cfgText(sub.type || '', null, 80);
  classType.addEventListener('input', () => {
    const index = cls.index;
    if (index === undefined) return;
    if (classType.value === m.data.classes[index].type) m.classEdits.delete(index);
    else m.classEdits.set(index, classType.value);
    renderMall();
    updateMeta();
  });
  subType.addEventListener('input', () => {
    const index = sub.index;
    if (index === undefined) return;
    if (subType.value === m.data.subclasses[index].type) m.subEdits.delete(index);
    else m.subEdits.set(index, subType.value);
    renderMall();
    updateMeta();
  });

  const id = cfgText(row.id, null, 32);
  const looks = cfgNumber(row.looks, 0, 100000000);
  const biglooks = cfgText(row.biglooks, null, 32);
  const type = cfgNumber(row.type, 0, 100000);
  const dispname = cfgText(row.dispname, null, 80);
  const name = cfgText(row.name, null, 80);
  const price = cfgNumber(row.price, 0, 1000000000);
  const unitnum = cfgNumber(row.unitnum, 1, 1000000);
  const desc = mallTextArea(row.desc, 6);

  const apply = (key, value, numeric) => {
    const cur = { ...getMallItem(index) };
    cur[key] = numeric ? cfgNum(value) : value;
    setMallItem(index, cur);
    if (key === 'dispname') cfgEl('cfgDetailTitle').textContent = cur.dispname || (added ? '新商品' : `商品 #${index + 1}`);
    if (key === 'id') {
      for (const input of [id]) input.classList.toggle('changed', cur.id !== m.data.items[index]?.id);
    }
    renderMall();
    updateMeta();
  };
  id.addEventListener('input', () => apply('id', id.value));
  looks.addEventListener('input', () => apply('looks', looks.value, true));
  biglooks.addEventListener('input', () => apply('biglooks', biglooks.value));
  type.addEventListener('input', () => apply('type', type.value, true));
  dispname.addEventListener('input', () => apply('dispname', dispname.value));
  name.addEventListener('input', () => apply('name', name.value));
  price.addEventListener('input', () => apply('price', price.value, true));
  unitnum.addEventListener('input', () => apply('unitnum', unitnum.value, true));
  desc.addEventListener('input', () => apply('desc', desc.value));

  const group = document.createElement('div');
  group.className = 'form-grid';
  group.appendChild(cfgField('大类名称', classType, '影响整个大类'));
  group.appendChild(cfgField('子类名称', subType, '影响整个子类'));
  form.appendChild(group);
  form.appendChild(cfgField('商品 ID', id, '对应物品编号'));
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.appendChild(cfgField('外观 looks', looks));
  grid.appendChild(cfgField('大图 biglooks', biglooks, '保留前导零'));
  grid.appendChild(cfgField('类型 type', type));
  grid.appendChild(cfgField('价格（元宝）', price));
  grid.appendChild(cfgField('单位数量', unitnum));
  form.appendChild(grid);
  form.appendChild(cfgField('显示名称', dispname, '商城列表显示'));
  form.appendChild(cfgField('商品名称', name, '游戏内名称'));
  form.appendChild(cfgField('商品描述', desc, '支持 \\\\ 换行'));
  cfgMarkSelected(cfgEl('mallGrid').querySelector('tbody'), index);
}

function buildMallHotForm(index) {
  const m = CFG.mall;
  const row = getMallHot(index);
  if (!row) return;
  const added = index >= m.data.hotItems.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = row.dispname || (added ? '新热卖商品' : `热卖 #${index + 1}`);
  cfgEl('cfgDetailSub').textContent = added ? '新增热卖（保存后写入文件）' : `第 ${index + 1} 件热卖`;
  cfgEl('cfgNote').textContent = '热卖商品只要求 ID、外观、大图、显示名称和价格；会出现在商城热卖区。';

  const id = cfgText(row.id, null, 32);
  const looks = cfgNumber(row.looks, 0, 100000000);
  const biglooks = cfgText(row.biglooks, null, 32);
  const dispname = cfgText(row.dispname, null, 80);
  const price = cfgNumber(row.price, 0, 1000000000);

  const apply = (key, value, numeric) => {
    const cur = { ...getMallHot(index) };
    cur[key] = numeric ? cfgNum(value) : value;
    setMallHot(index, cur);
    if (key === 'dispname') cfgEl('cfgDetailTitle').textContent = cur.dispname || (added ? '新热卖商品' : `热卖 #${index + 1}`);
    renderMall();
    updateMeta();
  };
  id.addEventListener('input', () => apply('id', id.value));
  looks.addEventListener('input', () => apply('looks', looks.value, true));
  biglooks.addEventListener('input', () => apply('biglooks', biglooks.value));
  dispname.addEventListener('input', () => apply('dispname', dispname.value));
  price.addEventListener('input', () => apply('price', price.value, true));

  form.appendChild(cfgField('商品 ID', id));
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.appendChild(cfgField('外观 looks', looks));
  grid.appendChild(cfgField('大图 biglooks', biglooks));
  grid.appendChild(cfgField('价格（元宝）', price));
  form.appendChild(grid);
  form.appendChild(cfgField('显示名称', dispname));
  cfgMarkSelected(cfgEl('mallHotGrid').querySelector('tbody'), index);
}

function selectMallItem(index) {
  CFG.mall.selected = index;
  buildMallItemForm(index);
}

function selectMallHot(index) {
  CFG.mall.hotSelected = index;
  buildMallHotForm(index);
}

function mallAdd(source) {
  const m = CFG.mall;
  if (!m.data) return;
  const used = mallUsedIds();
  if (m.tab === 'hot') {
    const row = source ? { ...source } : {
      id: mallNewId('10000001', used), looks: 0, biglooks: '', dispname: '新热卖商品', price: 1
    };
    row.id = mallNewId(row.id, used);
    if (source) row.dispname = `${row.dispname || '热卖商品'}副本`;
    m.hotAdded.push(row);
    m.search = '';
    cfgEl('mallSearch').value = '';
    m.hotSelected = m.data.hotItems.length + m.hotAdded.length - 1;
    renderMall();
    selectMallHot(m.hotSelected);
    updateMeta();
    return;
  }
  let classId;
  let subId;
  if (source) {
    classId = source.classId;
    subId = source.subId;
  } else {
    const subs = mallEffectiveSubs();
    const preferred = (m.classFilter || subs[0]?.classId) || '';
    const sub = subs.find((s) => s.classId === String(preferred)) || subs[0];
    if (!sub) return toast('没有可用的商品子类', 'err');
    classId = sub.classId;
    subId = sub.id;
  }
  const row = source ? {
    ...source,
    id: mallNewId(source.id, used),
    dispname: `${source.dispname}副本`,
    name: source.name ? `${source.name}副本` : source.name
  } : {
    id: mallNewId('10000001', used), looks: 0, biglooks: '', type: 0,
    dispname: '新商品', name: '新商品', price: 1, unitnum: 1, desc: ''
  };
  row.classId = classId;
  row.subId = subId;
  m.added.push(row);
  m.classFilter = '';
  m.subFilter = '';
  m.search = '';
  cfgEl('mallSearch').value = '';
  m.selected = m.data.items.length + m.added.length - 1;
  m.page = Math.max(0, Math.ceil(mallItemList().length / m.pageSize) - 1);
  renderMall();
  selectMallItem(m.selected);
  updateMeta();
}

function mallDelete() {
  const m = CFG.mall;
  if (!m.data) return;
  if (m.tab === 'hot') {
    if (m.hotSelected < 0) return toast('请先选择一件热卖商品', 'err');
    const index = m.hotSelected;
    const row = getMallHot(index);
    if (!row) return;
    if (!confirm(`删除热卖商品：${row.dispname}？`)) return;
    if (index >= m.data.hotItems.length) m.hotAdded.splice(index - m.data.hotItems.length, 1);
    else {
      m.hotDeleted.add(index);
      m.hotEdits.delete(index);
    }
    cfgCloseDetail();
    renderMall();
    updateMeta();
    return;
  }
  if (m.selected < 0) return toast('请先选择一件商品', 'err');
  const index = m.selected;
  const row = getMallItem(index);
  if (!row) return;
  if (!confirm(`删除商品：${row.dispname}？`)) return;
  if (index >= m.data.items.length) m.added.splice(index - m.data.items.length, 1);
  else {
    m.deleted.add(index);
    m.edits.delete(index);
  }
  cfgCloseDetail();
  renderMall();
  updateMeta();
}

function setMallTab(tab) {
  CFG.mall.tab = tab;
  cfgCloseDetail();
  renderMall();
  updateMeta();
}

async function openMallConfig(force) {
  if (!force && !confirmDiscard()) return;
  try {
    const data = await api('/api/config/mall');
    const m = CFG.mall;
    m.data = data;
    m.tab = 'items';
    m.search = '';
    m.classFilter = '';
    m.subFilter = '';
    m.page = 0;
    m.selected = -1;
    m.hotSelected = -1;
    m.edits.clear();
    m.added = [];
    m.deleted.clear();
    m.hotEdits.clear();
    m.hotAdded = [];
    m.hotDeleted.clear();
    m.classEdits.clear();
    m.subEdits.clear();
    m.scroll = data.scroll || '';
    m.scrollOriginal = data.scroll || '';
    cfgSetMode('cfgMall');
    cfgEl('mallSearch').value = '';
    cfgEl('mallScroll').value = m.scroll;
    renderMall();
    updateMeta();
  } catch (e) {
    toast('打开商城配置失败：' + e.message, 'err');
  }
}

async function saveMallConfig() {
  const m = CFG.mall;
  if (!m.data || cfgDirty('cfgMall') === 0) return;
  const payload = {
    changes: [...m.edits.entries()].map(([index, values]) => ({ index, values })),
    added: m.added.map((row) => ({
      classId: row.classId, subId: row.subId, id: row.id, looks: row.looks,
      biglooks: row.biglooks, type: row.type, dispname: row.dispname,
      name: row.name, price: row.price, unitnum: row.unitnum, desc: row.desc
    })),
    deleted: [...m.deleted],
    hotChanges: [...m.hotEdits.entries()].map(([index, values]) => ({ index, values })),
    hotAdded: m.hotAdded,
    hotDeleted: [...m.hotDeleted],
    classChanges: [...m.classEdits.entries()].map(([index, type]) => ({ index, type })),
    subChanges: [...m.subEdits.entries()].map(([index, type]) => ({ index, type })),
    scroll: m.scroll
  };
  const btn = cfgEl('btnMallSave');
  btn.disabled = true;
  try {
    const res = await api('/api/config/mall/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let msg = `保存成功：商品 修改 ${res.changedRows} / 新增 ${res.addedRows} / 删除 ${res.deletedRows}；` +
      `热卖 修改 ${res.hotChanged} / 新增 ${res.hotAdded} / 删除 ${res.hotDeleted}；分类名称 ${res.groupChanged} 处。`;
    if (res.scrollChanged) msg += '\n滚动公告已更新。';
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await openMallConfig(true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

/* 事件绑定 */
cfgEl('mallGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  selectMallItem(Number(tr.dataset.index));
});
cfgEl('mallHotGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  selectMallHot(Number(tr.dataset.index));
});
cfgEl('mallClass').addEventListener('change', () => {
  CFG.mall.classFilter = cfgEl('mallClass').value;
  CFG.mall.subFilter = '';
  CFG.mall.page = 0;
  renderMall();
});
cfgEl('mallSub').addEventListener('change', () => {
  CFG.mall.subFilter = cfgEl('mallSub').value;
  CFG.mall.page = 0;
  renderMall();
});
let mallSearchTimer = null;
cfgEl('mallSearch').addEventListener('input', () => {
  clearTimeout(mallSearchTimer);
  mallSearchTimer = setTimeout(() => {
    CFG.mall.search = cfgEl('mallSearch').value;
    CFG.mall.page = 0;
    renderMall();
  }, 150);
});
cfgEl('mallPrev').addEventListener('click', () => {
  if (CFG.mall.page > 0) {
    CFG.mall.page--;
    renderMall();
  }
});
cfgEl('mallNext').addEventListener('click', () => {
  CFG.mall.page++;
  renderMall();
});
cfgEl('mallScroll').addEventListener('input', () => {
  CFG.mall.scroll = cfgEl('mallScroll').value;
  updateMeta();
});
cfgEl('mallTabItems').addEventListener('click', () => setMallTab('items'));
cfgEl('mallTabHot').addEventListener('click', () => setMallTab('hot'));
cfgEl('btnMallAdd').addEventListener('click', () => mallAdd(null));
cfgEl('btnMallDup').addEventListener('click', () => {
  if (CFG.mall.tab !== 'items' || CFG.mall.selected < 0) return toast('请先选择一件商品', 'err');
  mallAdd(getMallItem(CFG.mall.selected));
});
cfgEl('btnMallDel').addEventListener('click', mallDelete);
cfgEl('btnMallReload').addEventListener('click', () => openMallConfig());
cfgEl('btnMallSave').addEventListener('click', saveMallConfig);

window.openMallConfig = openMallConfig;
window.saveMallConfig = saveMallConfig;

'use strict';

/* ---------------- 商城商品 goodsconfig ---------------- */

function goodsKeyOf(row) {
  return row.version ? `${row.id}-${row.version}` : row.id;
}

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function goodsCfgList() {
  const m = CFG.goods;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < m.data.entries.length; i++) {
    if (m.deleted.has(i)) continue;
    const row = m.edits.get(i) || m.data.entries[i];
    if (q && !`${row.id} ${row.version} ${row.name}`.toLowerCase().includes(q)) continue;
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.added.length; k++) {
    const row = m.added[k];
    if (q && !`${row.id} ${row.version} ${row.name}`.toLowerCase().includes(q)) continue;
    out.push({ index: m.data.entries.length + k, row, added: true });
  }
  return out;
}

function getGoodsCfgRow(index) {
  const m = CFG.goods;
  if (index < m.data.entries.length) return m.edits.get(index) || m.data.entries[index];
  return m.added[index - m.data.entries.length];
}

function setGoodsCfgRow(index, row) {
  const m = CFG.goods;
  if (index >= m.data.entries.length) {
    m.added[index - m.data.entries.length] = row;
    return;
  }
  const base = m.data.entries[index];
  const same = row.id === base.id && row.version === base.version && row.name === base.name;
  if (same) m.edits.delete(index);
  else m.edits.set(index, row);
}

function goodsCfgKeys() {
  const m = CFG.goods;
  const keys = new Set();
  if (!m.data) return keys;
  for (let i = 0; i < m.data.entries.length; i++) {
    if (!m.deleted.has(i)) keys.add(goodsKeyOf(m.edits.get(i) || m.data.entries[i]));
  }
  for (const row of m.added) keys.add(goodsKeyOf(row));
  return keys;
}

function uniqueGoodsCfgId(base, version, keys) {
  let id = base;
  let n = 1;
  while (keys.has(version ? `${id}-${version}` : id)) {
    n++;
    id = `${base}${n}`;
  }
  return id;
}

function renderGoodsCfg() {
  const m = CFG.goods;
  if (!m.data) return;
  const thead = cfgEl('goodsNameGrid').querySelector('thead');
  const tbody = cfgEl('goodsNameGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '商品 ID', '版本', '游戏内名称']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = goodsCfgList();
  const totalPages = Math.max(1, Math.ceil(list.length / m.pageSize));
  if (m.page >= totalPages) m.page = totalPages - 1;
  if (m.page < 0) m.page = 0;
  const start = m.page * m.pageSize;
  for (const item of list.slice(start, start + m.pageSize)) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.selected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [item.index + 1, item.row.id, item.row.version, item.row.name];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 2) td.className = 'str';
      else if (i === 3) td.className = 'str namecell';
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

  cfgEl('goodsPageInfo').textContent =
    `第 ${m.page + 1}/${totalPages} 页 · 共 ${list.length} 条` +
    (m.added.length ? `（含新增 ${m.added.length}）` : '');
  cfgEl('goodsPrev').disabled = m.page <= 0;
  cfgEl('goodsNext').disabled = m.page >= totalPages - 1;
  cfgEl('goodsCfgMeta').textContent =
    `${m.data.entries.length} 条商城商品 · ${m.data.invalid.length} 行特殊内容`;
}

function buildGoodsCfgForm(index) {
  const m = CFG.goods;
  const row = getGoodsCfgRow(index);
  if (!row) return;
  const added = index >= m.data.entries.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  const title = () => goodsKeyOf(row) || '新映射';
  cfgEl('cfgDetailTitle').textContent = title();
  cfgEl('cfgDetailSub').textContent = added ? '新增映射（保存后写入文件）' : `第 ${index + 1} 条`;
  cfgEl('cfgNote').textContent = 'UU 商城/订单商品编码映射：格式为“商品ID-版本=游戏内名称”。它不是 NPC 商店货架，也不含价格和库存。';

  const id = cfgText(row.id, null, 64);
  const version = cfgText(row.version, null, 32);
  const name = cfgText(row.name, null, 80);

  const apply = (key, value) => {
    const cur = { ...getGoodsCfgRow(index) };
    cur[key] = value;
    setGoodsCfgRow(index, cur);
    cfgEl('cfgDetailTitle').textContent = goodsKeyOf(cur) || '新映射';
    renderGoodsCfg();
    updateMeta();
  };
  id.addEventListener('input', () => apply('id', id.value));
  version.addEventListener('input', () => apply('version', version.value));
  name.addEventListener('input', () => apply('name', name.value));

  form.appendChild(cfgField('商品 ID', id, '不含空格或等号'));
  form.appendChild(cfgField('版本', version, '可为空；与 ID 组成唯一键'));
  form.appendChild(cfgField('游戏内名称', name, '订单/界面显示名'));
  cfgMarkSelected(cfgEl('goodsNameGrid').querySelector('tbody'), index);
}

function goodsCfgAdd(source) {
  const m = CFG.goods;
  if (!m.data) return;
  const keys = goodsCfgKeys();
  const version = todayStamp();
  let row;
  if (source) {
    const id = uniqueGoodsCfgId(source.id, version, keys);
    row = { id, version, name: `${source.name}副本` };
  } else {
    const id = uniqueGoodsCfgId('new001', version, keys);
    row = { id, version, name: '新商品' };
  }
  m.added.push(row);
  m.search = '';
  cfgEl('goodsSearch').value = '';
  m.selected = m.data.entries.length + m.added.length - 1;
  m.page = Math.max(0, Math.ceil(goodsCfgList().length / m.pageSize) - 1);
  renderGoodsCfg();
  buildGoodsCfgForm(m.selected);
  updateMeta();
}

function goodsCfgDelete() {
  const m = CFG.goods;
  if (m.selected < 0) return toast('请先选择一条商城商品', 'err');
  const index = m.selected;
  const row = getGoodsCfgRow(index);
  if (!row) return;
  if (!confirm(`删除商城商品：${goodsKeyOf(row)}？`)) return;
  if (index >= m.data.entries.length) {
    m.added.splice(index - m.data.entries.length, 1);
  } else {
    m.deleted.add(index);
    m.edits.delete(index);
  }
  cfgCloseDetail();
  renderGoodsCfg();
  updateMeta();
}

async function openGoodsConfig(force) {
  if (!force && !confirmDiscard()) return;
  try {
    const data = await api('/api/config/goods');
    const m = CFG.goods;
    m.data = data;
    m.edits.clear();
    m.added = [];
    m.deleted.clear();
    m.page = 0;
    m.search = '';
    m.selected = -1;
    cfgSetMode('cfgGoods');
    cfgEl('goodsSearch').value = '';
    renderGoodsCfg();
    updateMeta();
  } catch (e) {
    toast('打开商城商品失败：' + e.message, 'err');
  }
}

async function saveGoodsConfig() {
  const m = CFG.goods;
  if (!m.data || cfgDirty('cfgGoods') === 0) return;
  const changes = [...m.edits.entries()].map(([index, values]) => ({ index, values }));
  const payload = { changes, added: m.added, deleted: [...m.deleted] };
  const btn = cfgEl('btnGoodsSave');
  btn.disabled = true;
  try {
    const res = await api('/api/config/goods/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let msg = `保存成功：修改 ${res.changedRows} 条，新增 ${res.addedRows} 条，删除 ${res.deletedRows} 条。当前 ${res.count} 条。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await openGoodsConfig(true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

/* ---------------- 召唤链 / 子怪 ---------------- */

function summonSearchMatch(text, q) {
  return !q || String(text).toLowerCase().includes(q);
}

function summonChainList() {
  const m = CFG.summons;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  const entries = m.data.chain.entries;
  for (let i = 0; i < entries.length; i++) {
    if (m.chainDeleted.has(i)) continue;
    const row = m.chainEdits.get(i) || entries[i];
    if (!summonSearchMatch(`${row.group} ${row.monster}`, q)) continue;
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.chainAdded.length; k++) {
    const row = m.chainAdded[k];
    if (!summonSearchMatch(`${row.group} ${row.monster}`, q)) continue;
    out.push({ index: entries.length + k, row, added: true });
  }
  return out;
}

function getSummonChainRow(index) {
  const m = CFG.summons;
  if (index < m.data.chain.entries.length) return m.chainEdits.get(index) || m.data.chain.entries[index];
  return m.chainAdded[index - m.data.chain.entries.length];
}

function setSummonChainRow(index, row) {
  const m = CFG.summons;
  if (index >= m.data.chain.entries.length) {
    m.chainAdded[index - m.data.chain.entries.length] = row;
    return;
  }
  const base = m.data.chain.entries[index];
  const same = ['group', 'monster', 'x', 'y', 'range', 'count'].every((k) => row[k] === base[k]);
  if (same) m.chainEdits.delete(index);
  else m.chainEdits.set(index, row);
}

function summonChildList() {
  const m = CFG.summons;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  const rows = m.data.child.rows;
  for (let i = 0; i < rows.length; i++) {
    if (m.childDeleted.has(i)) continue;
    const row = m.childEdits.get(i) || rows[i];
    if (!summonSearchMatch(`${row.parent} ${row.child}`, q)) continue;
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.childAdded.length; k++) {
    const row = m.childAdded[k];
    if (!summonSearchMatch(`${row.parent} ${row.child}`, q)) continue;
    out.push({ index: rows.length + k, row, added: true });
  }
  return out;
}

function getSummonChildRow(index) {
  const m = CFG.summons;
  if (index < m.data.child.rows.length) return m.childEdits.get(index) || m.data.child.rows[index];
  return m.childAdded[index - m.data.child.rows.length];
}

function setSummonChildRow(index, row) {
  const m = CFG.summons;
  if (index >= m.data.child.rows.length) {
    m.childAdded[index - m.data.child.rows.length] = row;
    return;
  }
  const base = m.data.child.rows[index];
  const same = row.parent === base.parent && row.child === base.child;
  if (same) m.childEdits.delete(index);
  else m.childEdits.set(index, row);
}

function renderSummonChain() {
  const m = CFG.summons;
  if (!m.data) return;
  const thead = cfgEl('chainGrid').querySelector('thead');
  const tbody = cfgEl('chainGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '分组', '怪物', 'X 偏移', 'Y 偏移', '范围', '数量']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  for (const item of summonChainList()) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.chainSelected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [item.index + 1, item.row.group, item.row.monster, item.row.x, item.row.y, item.row.range, item.row.count];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i >= 3) td.className = 'num';
      else if (i === 2) td.className = 'str namecell';
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
}

function renderSummonChild() {
  const m = CFG.summons;
  if (!m.data) return;
  const thead = cfgEl('childGrid').querySelector('thead');
  const tbody = cfgEl('childGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '父怪', '子怪']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  for (const item of summonChildList()) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.childSelected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [item.index + 1, item.row.parent, item.row.child];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 2) td.className = 'str namecell';
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
}

function renderSummons() {
  const m = CFG.summons;
  if (!m.data) return;
  cfgEl('summonTabChain').classList.toggle('active', m.tab === 'chain');
  cfgEl('summonTabChild').classList.toggle('active', m.tab === 'child');
  cfgEl('chainWrap').classList.toggle('hidden', m.tab !== 'chain');
  cfgEl('childWrap').classList.toggle('hidden', m.tab !== 'child');
  const chainCount = m.data.chain.entries.length - m.chainDeleted.size + m.chainAdded.length;
  const childCount = m.data.child.rows.length - m.childDeleted.size + m.childAdded.length;
  cfgEl('summonTabChain').textContent = `召唤链 (${chainCount})`;
  cfgEl('summonTabChild').textContent = `子怪 (${childCount})`;
  cfgEl('summonsMeta').textContent =
    `${m.data.chain.groups.length} 组召唤 · ${m.data.chain.entries.length} 条召唤 · ` +
    `${m.data.child.groups.length} 组子怪 · ${m.data.child.rows.length} 条子怪`;
  cfgEl('summonHint').textContent = m.tab === 'chain'
    ? '召唤链：怪物出现时按偏移、范围和数量生成；分组不能直接移动'
    : '子怪：按父怪分组，每个子怪一行；可以输入新父怪创建分组';
  renderSummonChain();
  renderSummonChild();
}

function buildSummonChainForm(index) {
  const m = CFG.summons;
  const row = getSummonChainRow(index);
  if (!row) return;
  const added = index >= m.data.chain.entries.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = `${row.group} · ${row.monster}`;
  cfgEl('cfgDetailSub').textContent = added ? '新增召唤（保存后写入文件）' : `第 ${index + 1} 条召唤`;
  cfgEl('cfgNote').textContent = '偏移可以是负数；范围 0 表示原地，数量为每次召唤个数。';

  const group = cfgText(row.group, added ? 'summonGroupList' : null, 32);
  if (!added) group.disabled = true;
  const monster = cfgText(row.monster, 'monsterList', 32);
  const x = cfgNumber(row.x, -100000, 100000);
  const y = cfgNumber(row.y, -100000, 100000);
  const range = cfgNumber(row.range, 0, 100000);
  const count = cfgNumber(row.count, 0, 1000000);

  const apply = (key, value) => {
    const cur = { ...getSummonChainRow(index) };
    cur[key] = key === 'group' || key === 'monster' ? value : cfgNum(value);
    setSummonChainRow(index, cur);
    cfgEl('cfgDetailTitle').textContent = `${cur.group} · ${cur.monster}`;
    renderSummons();
    updateMeta();
  };
  group.addEventListener('input', () => apply('group', group.value));
  monster.addEventListener('input', () => apply('monster', monster.value));
  x.addEventListener('input', () => apply('x', x.value));
  y.addEventListener('input', () => apply('y', y.value));
  range.addEventListener('input', () => apply('range', range.value));
  count.addEventListener('input', () => apply('count', count.value));

  form.appendChild(cfgField('分组', group, added ? '可输入新分组' : '已有分组'));
  form.appendChild(cfgField('怪物名称', monster, '支持输入搜索'));
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.appendChild(cfgField('X 偏移', x));
  grid.appendChild(cfgField('Y 偏移', y));
  grid.appendChild(cfgField('范围', range));
  grid.appendChild(cfgField('数量', count));
  form.appendChild(grid);
  cfgMarkSelected(cfgEl('chainGrid').querySelector('tbody'), index);
}

function buildSummonChildForm(index) {
  const m = CFG.summons;
  const row = getSummonChildRow(index);
  if (!row) return;
  const added = index >= m.data.child.rows.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = `${row.parent} · ${row.child}`;
  cfgEl('cfgDetailSub').textContent = added ? '新增子怪（保存后写入文件）' : `第 ${index + 1} 条子怪`;
  cfgEl('cfgNote').textContent = '子怪按父怪分组；新增时可以输入不存在的父怪，保存时会自动创建分组。';

  const parent = cfgText(row.parent, added ? 'summonGroupList' : null, 32);
  if (!added) parent.disabled = true;
  const child = cfgText(row.child, 'monsterList', 32);

  const apply = (key, value) => {
    const cur = { ...getSummonChildRow(index) };
    cur[key] = value;
    setSummonChildRow(index, cur);
    cfgEl('cfgDetailTitle').textContent = `${cur.parent} · ${cur.child}`;
    renderSummons();
    updateMeta();
  };
  parent.addEventListener('input', () => apply('parent', parent.value));
  child.addEventListener('input', () => apply('child', child.value));

  form.appendChild(cfgField('父怪', parent, added ? '可输入新父怪' : '已有父怪'));
  form.appendChild(cfgField('子怪', child, '支持输入搜索'));
  cfgMarkSelected(cfgEl('childGrid').querySelector('tbody'), index);
}

function setSummonTab(tab) {
  if (tab !== 'chain' && tab !== 'child') return;
  CFG.summons.tab = tab;
  cfgCloseDetail();
  renderSummons();
  updateMeta();
}

function summonAdd() {
  const m = CFG.summons;
  if (!m.data) return;
  m.search = '';
  cfgEl('summonSearch').value = '';
  if (m.tab === 'chain') {
    const groups = m.data.chain.groups.map((g) => g.name);
    const fallback = m.data.child.groups[0] ? m.data.child.groups[0].name : '新分组';
    const row = {
      group: groups[0] || fallback,
      monster: (m.data.monsters && m.data.monsters[0]) || '',
      x: 0, y: 0, range: 0, count: 1
    };
    m.chainAdded.push(row);
    m.chainSelected = m.data.chain.entries.length + m.chainAdded.length - 1;
    renderSummons();
    buildSummonChainForm(m.chainSelected);
  } else {
    const groups = m.data.child.groups.map((g) => g.name);
    const row = {
      parent: groups[0] || '新父怪',
      child: (m.data.monsters && m.data.monsters[0]) || ''
    };
    m.childAdded.push(row);
    m.childSelected = m.data.child.rows.length + m.childAdded.length - 1;
    renderSummons();
    buildSummonChildForm(m.childSelected);
  }
  updateMeta();
}

function summonDelete() {
  const m = CFG.summons;
  if (!m.data) return;
  if (m.tab === 'chain') {
    if (m.chainSelected < 0) return toast('请先选择一条召唤记录', 'err');
    const index = m.chainSelected;
    const row = getSummonChainRow(index);
    if (!row) return;
    if (!confirm(`删除召唤：${row.group} · ${row.monster}？`)) return;
    if (index >= m.data.chain.entries.length) {
      m.chainAdded.splice(index - m.data.chain.entries.length, 1);
    } else {
      m.chainDeleted.add(index);
      m.chainEdits.delete(index);
    }
  } else {
    if (m.childSelected < 0) return toast('请先选择一条子怪记录', 'err');
    const index = m.childSelected;
    const row = getSummonChildRow(index);
    if (!row) return;
    if (!confirm(`删除子怪：${row.parent} · ${row.child}？`)) return;
    if (index >= m.data.child.rows.length) {
      m.childAdded.splice(index - m.data.child.rows.length, 1);
    } else {
      m.childDeleted.add(index);
      m.childEdits.delete(index);
    }
  }
  cfgCloseDetail();
  renderSummons();
  updateMeta();
}

async function openSummonsConfig(force) {
  if (!force && !confirmDiscard()) return;
  try {
    const data = await api('/api/config/summons');
    const m = CFG.summons;
    m.data = data;
    m.tab = 'chain';
    m.search = '';
    m.chainEdits.clear();
    m.chainAdded = [];
    m.chainDeleted.clear();
    m.chainSelected = -1;
    m.childEdits.clear();
    m.childAdded = [];
    m.childDeleted.clear();
    m.childSelected = -1;
    cfgSetMode('cfgSummons');
    cfgEl('summonSearch').value = '';
    const groups = [...data.chain.groups.map((g) => g.name), ...data.child.groups.map((g) => g.name)];
    fillDatalist('summonGroupList', [...new Set(groups)].sort((a, b) => a.localeCompare(b, 'zh-CN')));
    fillDatalist('monsterList', data.monsters || []);
    renderSummons();
    updateMeta();
  } catch (e) {
    toast('打开召唤关系失败：' + e.message, 'err');
  }
}

async function saveSummonsConfig() {
  const m = CFG.summons;
  if (!m.data || cfgDirty('cfgSummons') === 0) return;
  const payload = {
    chain: {
      changes: [...m.chainEdits.entries()].map(([index, values]) => ({ index, values })),
      added: m.chainAdded,
      deleted: [...m.chainDeleted]
    },
    child: {
      changes: [...m.childEdits.entries()].map(([index, values]) => ({ index, values })),
      added: m.childAdded,
      deleted: [...m.childDeleted]
    }
  };
  const btn = cfgEl('btnSummonSave');
  btn.disabled = true;
  try {
    const res = await api('/api/config/summons/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let msg = `保存成功：召唤链 修改 ${res.chain.changedRows} / 新增 ${res.chain.addedRows} / 删除 ${res.chain.deletedRows}；` +
      `子怪 修改 ${res.child.changedRows} / 新增 ${res.child.addedRows} / 删除 ${res.child.deletedRows}。`;
    const backups = [res.chain.backup, res.child.backup].filter(Boolean);
    if (backups.length) msg += '\n备份：\n' + backups.join('\n');
    toast(msg, 'ok');
    await refreshState();
    await openSummonsConfig(true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

/* ---------------- 事件绑定 ---------------- */

let extrasSearchTimer = null;

cfgEl('goodsNameGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  CFG.goods.selected = Number(tr.dataset.index);
  buildGoodsCfgForm(CFG.goods.selected);
});
cfgEl('chainGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  CFG.summons.chainSelected = Number(tr.dataset.index);
  buildSummonChainForm(CFG.summons.chainSelected);
});
cfgEl('childGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  CFG.summons.childSelected = Number(tr.dataset.index);
  buildSummonChildForm(CFG.summons.childSelected);
});

cfgEl('goodsSearch').addEventListener('input', () => {
  clearTimeout(extrasSearchTimer);
  extrasSearchTimer = setTimeout(() => {
    CFG.goods.search = cfgEl('goodsSearch').value;
    CFG.goods.page = 0;
    renderGoodsCfg();
  }, 150);
});
cfgEl('summonSearch').addEventListener('input', () => {
  clearTimeout(extrasSearchTimer);
  extrasSearchTimer = setTimeout(() => {
    CFG.summons.search = cfgEl('summonSearch').value;
    renderSummons();
  }, 150);
});

cfgEl('goodsPrev').addEventListener('click', () => {
  if (CFG.goods.page > 0) {
    CFG.goods.page--;
    renderGoodsCfg();
  }
});
cfgEl('goodsNext').addEventListener('click', () => {
  CFG.goods.page++;
  renderGoodsCfg();
});

cfgEl('btnGoodsAdd').addEventListener('click', () => goodsCfgAdd(null));
cfgEl('btnGoodsDup').addEventListener('click', () => {
  if (CFG.goods.selected < 0) return toast('请先选择一条商城商品', 'err');
  goodsCfgAdd(getGoodsCfgRow(CFG.goods.selected));
});
cfgEl('btnGoodsDel').addEventListener('click', goodsCfgDelete);
cfgEl('btnGoodsReload').addEventListener('click', () => openGoodsConfig());
cfgEl('btnGoodsSave').addEventListener('click', saveGoodsConfig);

cfgEl('summonTabChain').addEventListener('click', () => setSummonTab('chain'));
cfgEl('summonTabChild').addEventListener('click', () => setSummonTab('child'));
cfgEl('btnSummonAdd').addEventListener('click', summonAdd);
cfgEl('btnSummonDel').addEventListener('click', summonDelete);
cfgEl('btnSummonReload').addEventListener('click', () => openSummonsConfig());
cfgEl('btnSummonSave').addEventListener('click', saveSummonsConfig);

window.openGoodsConfig = openGoodsConfig;
window.saveGoodsConfig = saveGoodsConfig;
window.openSummonsConfig = openSummonsConfig;
window.saveSummonsConfig = saveSummonsConfig;

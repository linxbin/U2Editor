'use strict';

/* ---------------- NPC 分布 ---------------- */

function npcMapText(data, code) {
  const name = data && data.mapNames ? data.mapNames[code] : '';
  return name ? `${code} · ${name}` : code;
}

function npcList() {
  const s = CFG.npc;
  if (!s.data) return [];
  const q = s.search.trim().toLowerCase();
  const out = [];
  const match = (row) => {
    if (s.mapFilter && row.map !== s.mapFilter) return false;
    if (!q) return true;
    const name = s.data.mapNames[row.map] || '';
    return [row.id, row.script, row.name, row.map, name].join(' ').toLowerCase().includes(q);
  };
  for (let i = 0; i < s.data.rows.length; i++) {
    if (s.deleted.has(i)) continue;
    const row = s.edits.get(i) || s.data.rows[i];
    if (match(row)) out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < s.added.length; k++) {
    if (match(s.added[k])) out.push({ index: s.data.rows.length + k, row: s.added[k], added: true });
  }
  return out;
}

function getNpcRow(index) {
  const s = CFG.npc;
  if (index < s.data.rows.length) return s.edits.get(index) || s.data.rows[index];
  return s.added[index - s.data.rows.length];
}

function setNpcRow(index, row) {
  const s = CFG.npc;
  if (index >= s.data.rows.length) {
    s.added[index - s.data.rows.length] = row;
    return;
  }
  const base = s.data.rows[index];
  const keys = ['id', 'script', 'map', 'x', 'y', 'name'];
  const same = keys.every((k) => row[k] === base[k]) && (row.extra || []).join('\t') === (base.extra || []).join('\t');
  if (same) s.edits.delete(index);
  else s.edits.set(index, row);
}

function buildNpcMapSelect() {
  const s = CFG.npc;
  const sel = cfgEl('npcMap');
  cfgClear(sel);
  const add = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  };
  add('', `全部地图 (${s.data.maps.length})`);
  for (const map of s.data.maps) {
    const label = map.label ? `${map.name} · ${map.label}` : map.name;
    add(map.name, `${label} (${map.count})`);
  }
  sel.value = s.mapFilter;
}

function renderNpc() {
  const s = CFG.npc;
  if (!s.data) return;
  const thead = cfgEl('npcGrid').querySelector('thead');
  const tbody = cfgEl('npcGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', 'NPC 名称', '地图', '地名', 'X', 'Y', 'NPC 编号', '脚本']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = npcList();
  const totalPages = Math.max(1, Math.ceil(list.length / s.pageSize));
  if (s.page >= totalPages) s.page = totalPages - 1;
  if (s.page < 0) s.page = 0;
  const start = s.page * s.pageSize;
  for (const item of list.slice(start, start + s.pageSize)) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === s.selected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const values = [
      item.index + 1,
      item.row.name,
      item.row.map,
      s.data.mapNames[item.row.map] || '',
      item.row.x,
      item.row.y,
      item.row.id,
      item.row.script
    ];
    values.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 4 || i === 5) td.className = 'num';
      else if (i === 1) td.className = 'str namecell';
      else if (i === 6 || i === 7) td.className = 'str';
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

  cfgEl('npcPageInfo').textContent =
    `第 ${s.page + 1}/${totalPages} 页 · 共 ${list.length} 个` +
    (s.added.length ? `（含新增 ${s.added.length}）` : '');
  cfgEl('npcPrev').disabled = s.page <= 0;
  cfgEl('npcNext').disabled = s.page >= totalPages - 1;
  cfgEl('npcMeta').textContent =
    `${s.data.rows.length} 个 NPC · ${s.data.maps.length} 张地图 · ${s.data.scripts.length} 个脚本` +
    (s.data.duplicateIds.length ? ` · ${s.data.duplicateIds.length} 个重复编号` : '');
}

function buildNpcForm(index) {
  const s = CFG.npc;
  const row = getNpcRow(index);
  if (!row) return;
  const added = index >= s.data.rows.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = added ? '新增 NPC' : `${row.name} · ${row.map}`;
  cfgEl('cfgDetailSub').textContent = added
    ? '新增记录（保存后写入 NPCList.txt）'
    : `第 ${index + 1} 个 · ${npcMapText(s.data, row.map)}`;
  cfgEl('cfgNote').textContent =
    '保存时只改写修改过的行，其余 NPC、注释和空行保持不变。ID、脚本、地图、名称不能包含空格。';

  const name = cfgText(row.name, null, 64);
  const id = cfgText(row.id, null, 64);
  const script = cfgText(row.script, 'npcScriptList', 64);
  const map = cfgText(row.map, 'mapList', 64);
  const x = cfgNumber(row.x, 0, 100000);
  const y = cfgNumber(row.y, 0, 100000);

  const apply = (key, value) => {
    const cur = { ...getNpcRow(index) };
    cur[key] = key === 'x' || key === 'y' ? cfgNum(value) : value;
    setNpcRow(index, cur);
    cfgEl('cfgDetailTitle').textContent =
      index >= s.data.rows.length ? '新增 NPC' : `${cur.name} · ${cur.map}`;
    renderNpc();
    updateMeta();
  };
  name.addEventListener('input', () => apply('name', name.value));
  id.addEventListener('input', () => apply('id', id.value));
  script.addEventListener('input', () => apply('script', script.value));
  map.addEventListener('input', () => apply('map', map.value));
  x.addEventListener('input', () => apply('x', x.value));
  y.addEventListener('input', () => apply('y', y.value));

  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.appendChild(cfgField('X 坐标', x));
  grid.appendChild(cfgField('Y 坐标', y));
  form.appendChild(cfgField('NPC 名称', name, '显示名称'));
  form.appendChild(cfgField('NPC 编号', id, '唯一标示'));
  form.appendChild(cfgField('脚本名称', script, 'NPCScript 下的 .py'));
  form.appendChild(cfgField('地图编号', map, '对应 MapInfo'));
  form.appendChild(grid);

  const extra = document.createElement('pre');
  extra.className = 'hint-pre';
  extra.textContent = `附加字段：${(row.extra || []).join(' ') || '（无）'}\n这些字段保留原值，本页不修改。`;
  form.appendChild(extra);

  const info = s.data.scripts.find((it) => it.name === row.script);
  if (info && !info.hasFile) {
    const warn = document.createElement('pre');
    warn.className = 'hint-pre';
    warn.textContent = `警告：NPCScript 中找不到 ${row.script}.py，保存后 NPC 仍可能无法正常对话。`;
    form.appendChild(warn);
  }
  cfgMarkSelected(cfgEl('npcGrid').querySelector('tbody'), index);
}

function selectNpc(index) {
  if (index === undefined || index === null) return;
  CFG.npc.selected = index;
  buildNpcForm(index);
}

function npcAdd(source) {
  const s = CFG.npc;
  if (!s.data) return;
  let row;
  if (source) {
    row = { ...source, extra: [...(source.extra || [])] };
    row.id = (row.id + '_copy').slice(0, 64);
  } else {
    row = {
      id: 'NewNpc_' + String(Date.now()).slice(-6),
      script: 'empty',
      map: s.mapFilter || '0',
      x: 0,
      y: 0,
      name: '新NPC',
      extra: ['0', '165', '0', '0']
    };
  }
  s.added.push(row);
  s.mapFilter = '';
  s.search = '';
  cfgEl('npcSearch').value = '';
  cfgEl('npcMap').value = '';
  s.selected = s.data.rows.length + s.added.length - 1;
  s.page = Math.max(0, Math.ceil(npcList().length / s.pageSize) - 1);
  renderNpc();
  selectNpc(s.selected);
  updateMeta();
}

async function npcDelete() {
  const s = CFG.npc;
  if (s.selected < 0) return toast('请先选择一个 NPC', 'err');
  const index = s.selected;
  const row = getNpcRow(index);
  if (!row) return;
  if (!(await uiConfirm({
    title: '删除 NPC',
    message: `删除 NPC：${row.name}（${row.map} ${row.x},${row.y}）？`,
    okText: '删除',
    danger: true
  }))) return;
  if (index >= s.data.rows.length) {
    s.added.splice(index - s.data.rows.length, 1);
  } else {
    s.deleted.add(index);
    s.edits.delete(index);
  }
  cfgCloseDetail();
  renderNpc();
  updateMeta();
}

async function openNpcConfig(force) {
  if (!force && !(await confirmDiscard())) return;
  try {
    const data = await api('/api/npc');
    const s = CFG.npc;
    s.data = data;
    s.edits.clear();
    s.added = [];
    s.deleted.clear();
    s.page = 0;
    s.mapFilter = '';
    s.search = '';
    s.selected = -1;
    cfgSetMode('cfgNpc');
    cfgEl('npcSearch').value = '';
    buildNpcMapSelect();
    fillDatalist('mapList', data.maps.map((m) => m.name));
    fillDatalist('npcScriptList', data.scripts.map((it) => it.name));
    renderNpc();
    updateMeta();
  } catch (e) {
    toast('打开 NPC 配置失败：' + e.message, 'err');
  }
}

async function saveNpcConfig() {
  const s = CFG.npc;
  if (!s.data || cfgDirty('cfgNpc') === 0) return;
  const payload = {
    changes: [...s.edits.entries()].map(([index, values]) => ({
      index,
      values: {
        id: values.id, script: values.script, map: values.map,
        x: values.x, y: values.y, name: values.name
      }
    })),
    added: s.added.map((r) => ({
      id: r.id, script: r.script, map: r.map, x: r.x, y: r.y, name: r.name, extra: r.extra
    })),
    deleted: [...s.deleted]
  };
  const btn = cfgEl('btnNpcSave');
  btn.disabled = true;
  try {
    const res = await api('/api/npc/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let msg = `保存成功：修改 ${res.changedRows} 个，新增 ${res.addedRows} 个，删除 ${res.deletedRows} 个。当前 ${res.count} 个 NPC。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await openNpcConfig(true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

/* ---------------- 商店货品 ---------------- */

function shopFileByName(name) {
  const s = CFG.shops;
  if (!s.data) return null;
  return s.data.files.find((f) => f.name === name) || null;
}

function shopGoodKey(file, index) {
  return file + '#' + index;
}

function shopSelected() {
  const s = CFG.shops;
  if (!s.data || s.shopIndex < 0) return null;
  return s.data.shops[s.shopIndex] || null;
}

function shopGoodCount(shop) {
  let n = 0;
  for (const source of shop.sources) {
    const f = shopFileByName(source.file);
    if (f) n += f.goods.length;
  }
  return n;
}

function shopList() {
  const s = CFG.shops;
  if (!s.data) return [];
  const q = s.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < s.data.shops.length; i++) {
    const shop = s.data.shops[i];
    if (s.mapFilter && shop.map !== s.mapFilter) continue;
    if (q) {
      const hay = [shop.id, shop.script, shop.name, shop.map, shop.mapName].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({ index: i, shop });
  }
  return out;
}

function buildShopMapSelect() {
  const s = CFG.shops;
  const sel = cfgEl('shopMap');
  cfgClear(sel);
  const add = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  };
  const counts = new Map();
  for (const shop of s.data.shops) counts.set(shop.map, (counts.get(shop.map) || 0) + 1);
  const maps = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
  add('', `全部地图 (${maps.length})`);
  for (const [map, count] of maps) {
    const name = s.data.mapNames[map] || '';
    add(map, `${map}${name ? ' · ' + name : ''} (${count})`);
  }
  sel.value = s.mapFilter;
}

function renderShopList() {
  const s = CFG.shops;
  if (!s.data) return;
  const thead = cfgEl('shopGrid').querySelector('thead');
  const tbody = cfgEl('shopGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', 'NPC', '地图', '地名', '坐标', '脚本', '货品']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = shopList();
  const totalPages = Math.max(1, Math.ceil(list.length / s.pageSize));
  if (s.page >= totalPages) s.page = totalPages - 1;
  if (s.page < 0) s.page = 0;
  const start = s.page * s.pageSize;
  for (const item of list.slice(start, start + s.pageSize)) {
    const shop = item.shop;
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === s.shopIndex) tr.classList.add('selected');
    const values = [
      item.index + 1,
      shop.name,
      shop.map,
      shop.mapName || '',
      `${shop.x},${shop.y}`,
      shop.script,
      shopGoodCount(shop)
    ];
    values.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 1) td.className = 'str namecell';
      else if (i === 4 || i === 6) td.className = 'num';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  cfgEl('shopPageInfo').textContent = `第 ${s.page + 1}/${totalPages} 页 · 共 ${list.length} 个`;
  cfgEl('shopPrev').disabled = s.page <= 0;
  cfgEl('shopNext').disabled = s.page >= totalPages - 1;
  cfgEl('shopMeta').textContent =
    `${s.data.shops.length} 个商店 NPC · ${s.data.files.length} 个脚本 · ${s.data.goods} 条货品`;
}

function currentGoodRows(shop) {
  const s = CFG.shops;
  const rows = [];
  for (const source of shop.sources) {
    const f = shopFileByName(source.file);
    if (!f) continue;
    for (const g of f.goods) {
      const key = shopGoodKey(f.name, g.index);
      if (s.deleted.has(key)) continue;
      const edit = s.edits.get(key);
      rows.push({
        key,
        file: f.name,
        sourceBase: f.base,
        shared: f.sharedNpcs,
        index: g.index,
        item: edit ? edit.item : g.item,
        count: edit ? edit.count : g.count,
        time: edit ? edit.time : g.time,
        baseItem: g.item,
        baseCount: g.count,
        baseTime: g.time,
        added: false
      });
    }
    for (const a of s.added) {
      if (a.file !== f.name) continue;
      rows.push({
        key: shopGoodKey(f.name, 'A' + a.addId),
        file: f.name,
        sourceBase: f.base,
        shared: f.sharedNpcs,
        item: a.item,
        count: a.count,
        time: a.time,
        baseItem: a.item,
        baseCount: a.count,
        baseTime: a.time,
        added: true
      });
    }
  }
  return rows;
}

function getGoodRow(key) {
  const shop = shopSelected();
  if (!shop) return null;
  return currentGoodRows(shop).find((r) => r.key === key) || null;
}

function setGoodValue(key, prop, value) {
  const s = CFG.shops;
  const pos = key.lastIndexOf('#');
  const file = key.slice(0, pos);
  const token = key.slice(pos + 1);
  if (token.startsWith('A')) {
    const addId = Number(token.slice(1));
    const item = s.added.find((a) => a.file === file && a.addId === addId);
    if (item) item[prop] = value;
    return;
  }
  const f = shopFileByName(file);
  const index = Number(token);
  const base = f ? f.goods.find((g) => g.index === index) : null;
  if (!base) return;
  const cur = { ...(s.edits.get(key) || { item: base.item, count: base.count, time: base.time }) };
  cur[prop] = value;
  if (cur.item === base.item && cur.count === base.count && cur.time === base.time) s.edits.delete(key);
  else s.edits.set(key, cur);
}

function renderGoods() {
  const s = CFG.shops;
  const shop = shopSelected();
  const thead = cfgEl('goodsGrid').querySelector('thead');
  const tbody = cfgEl('goodsGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  if (!shop) {
    cfgEl('goodsMeta').textContent = '请选择左侧商店 NPC';
    return;
  }
  const htr = document.createElement('tr');
  for (const label of ['#', '物品', '数量', '刷新', '来源脚本', '共享 NPC']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const rows = currentGoodRows(shop);
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.dataset.key = row.key;
    if (row.key === s.goodKey) tr.classList.add('selected');
    if (row.added) tr.classList.add('added');
    const cells = [
      i + 1,
      row.item,
      row.count,
      row.time,
      row.file,
      row.shared
    ];
    cells.forEach((v, ci) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (ci === 0) td.className = 'col-idx';
      else if (ci === 1) td.className = 'str namecell';
      else if (ci === 2 || ci === 3 || ci === 5) td.className = 'num';
      if (ci === 1 && row.added) {
        const tag = document.createElement('span');
        tag.className = 'new-tag';
        tag.textContent = '新';
        td.appendChild(tag);
      }
      if ((ci === 1 && row.item !== row.baseItem) ||
          (ci === 2 && row.count !== row.baseCount) ||
          (ci === 3 && row.time !== row.baseTime)) {
        td.classList.add('dirty');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  const total = rows.length;
  cfgEl('goodsMeta').textContent =
    `${shop.name} · ${npcMapText(s.data, shop.map)} · ${total} 条货品` +
    (s.data.special ? ` · 全部脚本另有 ${s.data.special} 行特殊内容` : '');
}

function selectShop(index) {
  const s = CFG.shops;
  if (index === undefined || index === null) return;
  s.shopIndex = index;
  s.goodKey = null;
  cfgCloseDetail();
  renderShopList();
  renderGoods();
  updateMeta();
}

function selectGood(key) {
  const s = CFG.shops;
  if (!key) return;
  s.goodKey = key;
  buildGoodForm(key);
  renderGoods();
}

function buildGoodForm(key) {
  const s = CFG.shops;
  const row = getGoodRow(key);
  if (!row) return;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = row.added ? '新增货品' : row.item;
  cfgEl('cfgDetailSub').textContent =
    `来源：${row.file} · 影响 ${row.shared} 个 NPC` +
    (row.added ? ' · 保存后写入脚本' : '');
  cfgEl('cfgNote').textContent =
    '数量/刷新时间对应脚本 addGoods 的第 3、4 个参数（脚本里写作 数量、时间）。共享脚本的修改会影响所有引用它的 NPC；保存后需重启 GameServer 才会重新加载脚本。';

  const item = cfgText(row.item, 'itemList', 64);
  const count = cfgNumber(row.count, 0, 1000000000);
  const time = cfgNumber(row.time, 0, 1000000000);
  const apply = (prop, value) => {
    setGoodValue(key, prop, prop === 'item' ? value : cfgNum(value));
    const cur = getGoodRow(key);
    if (cur) cfgEl('cfgDetailTitle').textContent = cur.added ? '新增货品' : cur.item;
    renderGoods();
    updateMeta();
  };
  item.addEventListener('input', () => apply('item', item.value));
  count.addEventListener('input', () => apply('count', count.value));
  time.addEventListener('input', () => apply('time', time.value));

  form.appendChild(cfgField('物品名称', item, '必须存在于 stditems.db'));
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.appendChild(cfgField('数量', count, '参数 3'));
  grid.appendChild(cfgField('刷新时间', time, '参数 4'));
  form.appendChild(grid);

  const source = document.createElement('pre');
  source.className = 'hint-pre';
  source.textContent = `写入脚本：NPCScript/${row.file}\n共享范围：${row.shared} 个 NPC`;
  form.appendChild(source);
  cfgMarkSelected(cfgEl('goodsGrid').querySelector('tbody'), null);
  const tr = cfgEl('goodsGrid').querySelector(`tbody tr[data-key="${key}"]`);
  if (tr) tr.classList.add('selected');
}

function shopAddGood() {
  const s = CFG.shops;
  const shop = shopSelected();
  if (!shop) return toast('请先在左侧选择一个商店 NPC', 'err');
  const source = shop.sources[0];
  if (!source) return toast('这个 NPC 没有可写入的商店脚本', 'err');
  const file = shopFileByName(source.file);
  if (!file) return toast('找不到脚本文件：' + source.file, 'err');
  const fallback = s.data.items.includes('金创药(小量)') ? '金创药(小量)' : (s.data.items[0] || '');
  const item = {
    file: file.name,
    addId: s.nextAddId++,
    item: fallback,
    count: 10,
    time: 10
  };
  s.added.push(item);
  s.goodKey = shopGoodKey(file.name, 'A' + item.addId);
  renderGoods();
  buildGoodForm(s.goodKey);
  updateMeta();
}

async function shopDeleteGood() {
  const s = CFG.shops;
  if (!s.goodKey) return toast('请先选择一条货品', 'err');
  const row = getGoodRow(s.goodKey);
  if (!row) return;
  if (!(await uiConfirm({
    title: '删除货品',
    message: `删除货品：${row.item}（${row.file}）？`,
    sections: row.shared ? [{ title: '脚本共用情况', lines: [`该脚本被 ${row.shared} 个 NPC 使用。`] }] : [],
    okText: '删除',
    danger: true
  }))) return;
  const pos = s.goodKey.lastIndexOf('#');
  const file = s.goodKey.slice(0, pos);
  const token = s.goodKey.slice(pos + 1);
  if (token.startsWith('A')) {
    const addId = Number(token.slice(1));
    const at = s.added.findIndex((a) => a.file === file && a.addId === addId);
    if (at >= 0) s.added.splice(at, 1);
  } else {
    s.deleted.add(s.goodKey);
    s.edits.delete(s.goodKey);
  }
  s.goodKey = null;
  cfgCloseDetail();
  renderGoods();
  updateMeta();
}

async function openShopsConfig(force) {
  if (!force && !(await confirmDiscard())) return;
  try {
    const data = await api('/api/shops');
    const s = CFG.shops;
    s.data = data;
    s.edits.clear();
    s.added = [];
    s.deleted.clear();
    s.page = 0;
    s.mapFilter = '';
    s.search = '';
    s.shopIndex = -1;
    s.goodKey = null;
    s.nextAddId = 1;
    cfgSetMode('cfgShops');
    cfgEl('shopSearch').value = '';
    fillDatalist('itemList', data.items || []);
    buildShopMapSelect();
    renderShopList();
    renderGoods();
    updateMeta();
  } catch (e) {
    toast('打开商店配置失败：' + e.message, 'err');
  }
}

async function saveShopsConfig() {
  const s = CFG.shops;
  if (!s.data || cfgDirty('cfgShops') === 0) return;
  const items = new Set(s.data.items || []);
  const groups = new Map();
  const ensure = (file) => {
    if (!groups.has(file)) groups.set(file, { file, changes: [], added: [], deleted: [] });
    return groups.get(file);
  };
  for (const [key, value] of s.edits) {
    const pos = key.lastIndexOf('#');
    const g = ensure(key.slice(0, pos));
    g.changes.push({ index: Number(key.slice(pos + 1)), values: value });
  }
  for (const key of s.deleted) {
    const pos = key.lastIndexOf('#');
    const g = ensure(key.slice(0, pos));
    g.deleted.push(Number(key.slice(pos + 1)));
  }
  for (const a of s.added) {
    const g = ensure(a.file);
    g.added.push({ item: a.item, count: a.count, time: a.time });
  }
  for (const g of groups.values()) {
    for (const c of g.changes) {
      const v = c.values;
      if (!v.item || !items.has(v.item)) return toast(`物品不存在于 stditems.db：${v.item || '（空）'}（${g.file}）`, 'err');
      if (!Number.isInteger(v.count) || v.count < 0) return toast(`数量无效：${v.item}（${g.file}）`, 'err');
      if (!Number.isInteger(v.time) || v.time < 0) return toast(`刷新时间无效：${v.item}（${g.file}）`, 'err');
    }
    for (const a of g.added) {
      if (!a.item || !items.has(a.item)) return toast(`物品不存在于 stditems.db：${a.item || '（空）'}（${g.file}）`, 'err');
      if (!Number.isInteger(a.count) || a.count < 0) return toast(`数量无效：${a.item}（${g.file}）`, 'err');
      if (!Number.isInteger(a.time) || a.time < 0) return toast(`刷新时间无效：${a.item}（${g.file}）`, 'err');
    }
  }

  const btn = cfgEl('btnShopSave');
  btn.disabled = true;
  const backups = [];
  let changed = 0;
  let added = 0;
  let deleted = 0;
  let savedFiles = 0;
  try {
    for (const g of groups.values()) {
      const res = await api('/api/shops/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: g.file, changes: g.changes, added: g.added, deleted: g.deleted })
      });
      savedFiles++;
      changed += res.changedGoods;
      added += res.addedGoods;
      deleted += res.deletedGoods;
      if (res.backup && !backups.includes(res.backup)) backups.push(res.backup);
    }
    let msg = `保存成功：${savedFiles} 个脚本，修改 ${changed} 条，新增 ${added} 条，删除 ${deleted} 条。`;
    if (backups.length) msg += '\n备份：\n' + backups.join('\n');
    msg += '\n脚本修改后需重启 GameServer 才会生效。';
    toast(msg, 'ok');
    await refreshState();
    await openShopsConfig(true);
  } catch (e) {
    toast('保存失败：' + e.message + '\n已保存的文件无法回滚，请重新加载后检查。', 'err');
    await refreshState();
    await openShopsConfig(true);
  }
}

window.openNpcConfig = openNpcConfig;
window.openShopsConfig = openShopsConfig;

/* ---------------- 事件绑定 ---------------- */

cfgEl('npcGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-index]');
  if (tr) selectNpc(Number(tr.dataset.index));
});
cfgEl('shopGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-index]');
  if (tr) selectShop(Number(tr.dataset.index));
});
cfgEl('goodsGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-key]');
  if (tr) selectGood(tr.dataset.key);
});

cfgEl('npcMap').addEventListener('change', () => {
  CFG.npc.mapFilter = cfgEl('npcMap').value;
  CFG.npc.page = 0;
  renderNpc();
});
cfgEl('npcSearch').addEventListener('input', () => {
  CFG.npc.search = cfgEl('npcSearch').value;
  CFG.npc.page = 0;
  renderNpc();
});
cfgEl('shopMap').addEventListener('change', () => {
  CFG.shops.mapFilter = cfgEl('shopMap').value;
  CFG.shops.page = 0;
  renderShopList();
});
cfgEl('shopSearch').addEventListener('input', () => {
  CFG.shops.search = cfgEl('shopSearch').value;
  CFG.shops.page = 0;
  renderShopList();
});

cfgEl('npcPrev').addEventListener('click', () => {
  if (CFG.npc.page > 0) { CFG.npc.page--; renderNpc(); }
});
cfgEl('npcNext').addEventListener('click', () => {
  CFG.npc.page++;
  renderNpc();
});
cfgEl('shopPrev').addEventListener('click', () => {
  if (CFG.shops.page > 0) { CFG.shops.page--; renderShopList(); }
});
cfgEl('shopNext').addEventListener('click', () => {
  CFG.shops.page++;
  renderShopList();
});

cfgEl('btnNpcAdd').addEventListener('click', () => npcAdd(null));
cfgEl('btnNpcDup').addEventListener('click', () => {
  const row = CFG.npc.selected >= 0 ? getNpcRow(CFG.npc.selected) : null;
  if (!row) return toast('请先选择一个 NPC', 'err');
  npcAdd(row);
});
cfgEl('btnNpcDel').addEventListener('click', npcDelete);
cfgEl('btnNpcReload').addEventListener('click', () => openNpcConfig());
cfgEl('btnNpcSave').addEventListener('click', saveNpcConfig);

cfgEl('btnShopAdd').addEventListener('click', shopAddGood);
cfgEl('btnShopDel').addEventListener('click', shopDeleteGood);
cfgEl('btnShopReload').addEventListener('click', () => openShopsConfig());
cfgEl('btnShopSave').addEventListener('click', saveShopsConfig);

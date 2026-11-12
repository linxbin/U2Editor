'use strict';

const CFG_VIEWS = {
  cfgMongen: 'mongenView',
  cfgMakeItem: 'makeitemView',
  cfgAppellation: 'appellationView',
  cfgNpc: 'npcView',
  cfgShops: 'shopView',
  cfgGoods: 'goodsView',
  cfgSummons: 'summonsView',
  cfgMall: 'mallView',
  cfgMapinfo: 'mapinfoView',
  cfgOps: 'opsView',
  cfgExtra: 'extraView',
  cfgServercfg: 'extraView'
};
const CFG_SAVE_BTN = {
  cfgMongen: 'btnMongenSave',
  cfgMakeItem: 'btnMakeSave',
  cfgAppellation: 'btnAppSave',
  cfgNpc: 'btnNpcSave',
  cfgShops: 'btnShopSave',
  cfgGoods: 'btnGoodsSave',
  cfgSummons: 'btnSummonSave',
  cfgMall: 'btnMallSave',
  cfgMapinfo: 'btnMapinfoSave',
  cfgOps: 'btnOpsSave',
  cfgExtra: 'btnExtraSave',
  cfgServercfg: 'btnExtraSave'
};
const CFG_KEYS = {
  cfgMongen: 'mongen',
  cfgMakeItem: 'makeitem',
  cfgAppellation: 'appellation',
  cfgNpc: 'npc',
  cfgShops: 'shops',
  cfgGoods: 'goods',
  cfgSummons: 'summons',
  cfgMall: 'mall',
  cfgMapinfo: 'mapinfo',
  cfgOps: 'ops',
  cfgExtra: 'extra',
  cfgServercfg: 'extra'
};
const CFG_MODES = {
  mongen: 'cfgMongen',
  makeitem: 'cfgMakeItem',
  appellation: 'cfgAppellation',
  npc: 'cfgNpc',
  shops: 'cfgShops',
  goods: 'cfgGoods',
  summons: 'cfgSummons',
  mall: 'cfgMall',
  mapinfo: 'cfgMapinfo',
  ops: 'cfgOps',
  extra: 'cfgExtra',
  servercfg: 'cfgServercfg'
};

const CFG = {
  mongen: { data: null, edits: new Map(), added: [], deleted: new Set(), page: 0, pageSize: 100, mapFilter: '', search: '', selected: -1 },
  makeitem: { data: null, edits: new Map(), added: [], deleted: new Set(), search: '', selected: -1 },
  appellation: { data: null, edits: new Map(), added: [], deleted: new Set(), page: 0, pageSize: 100, classFilter: '', search: '', selected: -1 },
  npc: { data: null, edits: new Map(), added: [], deleted: new Set(), page: 0, pageSize: 100, mapFilter: '', search: '', selected: -1 },
  shops: {
    data: null, edits: new Map(), added: [], deleted: new Set(),
    page: 0, pageSize: 100, mapFilter: '', search: '',
    shopIndex: -1, goodKey: null, nextAddId: 1
  },
  goods: { data: null, edits: new Map(), added: [], deleted: new Set(), page: 0, pageSize: 100, search: '', selected: -1 },
  summons: {
    data: null, tab: 'chain', search: '',
    chainEdits: new Map(), chainAdded: [], chainDeleted: new Set(), chainSelected: -1,
    childEdits: new Map(), childAdded: [], childDeleted: new Set(), childSelected: -1,
    dirtyCount() {
      return this.chainEdits.size + this.chainAdded.length + this.chainDeleted.size +
        this.childEdits.size + this.childAdded.length + this.childDeleted.size;
    }
  },
  mall: {
    data: null, tab: 'items', search: '', classFilter: '', subFilter: '',
    page: 0, pageSize: 100, selected: -1, hotSelected: -1,
    edits: new Map(), added: [], deleted: new Set(),
    hotEdits: new Map(), hotAdded: [], hotDeleted: new Set(),
    classEdits: new Map(), subEdits: new Map(),
    scroll: '', scrollOriginal: '',
    dirtyCount() {
      return this.edits.size + this.added.length + this.deleted.size +
        this.hotEdits.size + this.hotAdded.length + this.hotDeleted.size +
        this.classEdits.size + this.subEdits.size +
        (this.scroll !== this.scrollOriginal ? 1 : 0);
    }
  },
  mapinfo: {
    data: null, section: 'jump', search: '', page: 0, pageSize: 200, selected: -1,
    edits: {}, added: {}, deleted: {},
    dirtyCount() {
      let n = 0;
      for (const key of Object.keys(this.edits)) {
        n += this.edits[key].size;
        n += (this.added[key] || []).length;
        n += (this.deleted[key] || new Set()).size;
      }
      return n;
    }
  },
  ops: {
    data: null, tab: 'notices', search: '', selected: -1,
    noticeTexts: {}, noticeOriginal: {},
    quizEdits: new Map(), quizAdded: [], quizDeleted: new Set(), quizSelected: -1,
    boxEdits: new Map(), boxAdded: [], boxDeleted: new Set(),
    boxGroupEdits: new Map(), boxSelected: -1,
    starterEdits: new Map(), starterAdded: [], starterDeleted: new Set(),
    starterGroupEdits: new Map(), starterSelected: -1,
    dirtyCount() {
      let n = 0;
      for (const key of ['line', 'float', 'bulletin', 'bless']) {
        if ((this.noticeTexts[key] || '') !== (this.noticeOriginal[key] || '')) n++;
      }
      return n +
        this.quizEdits.size + this.quizAdded.length + this.quizDeleted.size +
        this.boxEdits.size + this.boxAdded.length + this.boxDeleted.size + this.boxGroupEdits.size +
        this.starterEdits.size + this.starterAdded.length + this.starterDeleted.size + this.starterGroupEdits.size;
    }
  },
  extra: {
    registry: null, key: '', data: null, rowMap: new Map(), sectionMap: new Map(),
    search: '', page: 0, pageSize: 100, selected: -1, section: -1,
    edits: new Map(), added: [], deleted: new Set(),
    sectionEdits: new Map(), sectionAdded: [],
    text: '', textOriginal: '',
    head: '', headOriginal: '', headDirty: false,
    dirtyCount() {
      let n = 0;
      if (this.text !== this.textOriginal) n++;
      if (this.headDirty && this.head !== this.headOriginal) n++;
      return n + this.edits.size + this.added.length + this.deleted.size +
        this.sectionEdits.size + this.sectionAdded.length;
    }
  }
};

const cfgEl = (id) => document.getElementById(id);
const cfgNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

function cfgClear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function cfgField(labelText, control, hint) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = labelText;
  label.appendChild(span);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'kind';
    h.textContent = hint;
    label.appendChild(h);
  }
  wrap.appendChild(label);
  wrap.appendChild(control);
  return wrap;
}

function cfgNumber(value, min, max) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '1';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  return input;
}

function cfgText(value, listId, maxLength) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value == null ? '' : String(value);
  if (listId) input.setAttribute('list', listId);
  if (maxLength) input.maxLength = maxLength;
  return input;
}

function cfgSelect(options, value) {
  const sel = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
  if (options.includes(value)) sel.value = value;
  return sel;
}

function fillDatalist(id, values) {
  const dl = cfgEl(id);
  cfgClear(dl);
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    dl.appendChild(o);
  }
}

function cfgStateDirty(s) {
  if (typeof s.dirtyCount === 'function') return s.dirtyCount();
  return s.edits.size + s.added.length + s.deleted.size;
}

function cfgDirty(mode) {
  const key = CFG_KEYS[mode];
  if (!key) return 0;
  return cfgStateDirty(CFG[key]);
}

window.configAnyDirty = () => {
  for (const key of Object.keys(CFG)) {
    if (cfgStateDirty(CFG[key]) > 0) return true;
  }
  return false;
};

window.configConfirmDiscard = () => {
  const n = cfgDirty(S.mode);
  if (n > 0) return confirm(`当前玩法配置有 ${n} 处未保存修改，确定放弃并继续？`);
  return true;
};

window.refreshConfigState = (st) => {
  S.configs = st.configs || null;
  renderCfgList();
};

window.hideConfigViews = () => {
  for (const id of Object.values(CFG_VIEWS)) cfgEl(id).classList.add('hidden');
  cfgEl('cfgDetail').classList.add('hidden');
  document.querySelectorAll('#cfgList .file-item.active').forEach((li) => li.classList.remove('active'));
};

function cfgSetMode(mode) {
  S.mode = mode;
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
  if (window.showSideTab) window.showSideTab('cfg');
  cfgEl('dbView').classList.add('hidden');
  cfgEl('dropView').classList.add('hidden');
  const visibleIds = new Set(Object.entries(CFG_VIEWS).filter(([m]) => m === mode).map(([, id]) => id));
  for (const id of new Set(Object.values(CFG_VIEWS))) {
    cfgEl(id).classList.toggle('hidden', !visibleIds.has(id));
  }
  cfgEl('detail').classList.add('hidden');
  cfgEl('cfgDetail').classList.add('hidden');
  renderDbList();
  renderDropList();
  renderCfgList();
}

function renderCfgList() {
  const c = S.configs || {};
  const texts = {};
  if (c.mongen && c.mongen.error) texts.mongen = '无法读取：' + c.mongen.error;
  else if (c.mongen) texts.mongen = `${c.mongen.entries} 条 · ${c.mongen.maps} 张地图`;
  else texts.mongen = 'Mongen.txt';
  if (c.makeitem && c.makeitem.error) texts.makeitem = '无法读取：' + c.makeitem.error;
  else if (c.makeitem) texts.makeitem = `${c.makeitem.recipes} 个配方 · ${c.makeitem.items} 种材料`;
  else texts.makeitem = 'MakeItem.txt';
  if (c.appellation && c.appellation.error) texts.appellation = '无法读取：' + c.appellation.error;
  else if (c.appellation) texts.appellation = `${c.appellation.rows} 条 · ${c.appellation.sections.join(' / ')}`;
  else texts.appellation = 'appellation.txt';
  if (c.npc && c.npc.error) texts.npc = '无法读取：' + c.npc.error;
  else if (c.npc) texts.npc = `${c.npc.rows} 个 NPC · ${c.npc.maps} 张地图`;
  else texts.npc = 'NPCList.txt';
  if (c.shops && c.shops.error) texts.shops = '无法读取：' + c.shops.error;
  else if (c.shops) texts.shops = `${c.shops.npcs} 个商店 · ${c.shops.goods} 条货品`;
  else texts.shops = 'NPCScript/*.py';
  if (c.goods && c.goods.error) texts.goods = '无法读取：' + c.goods.error;
  else if (c.goods) texts.goods = `${c.goods.entries} 条商城商品`;
  else texts.goods = 'goodsconfig';
  if (c.summons && c.summons.error) texts.summons = '无法读取：' + c.summons.error;
  else if (c.summons) texts.summons = `${c.summons.chainEntries} 条召唤 · ${c.summons.childEntries} 条子怪`;
  else texts.summons = 'MonsterChain.ini · MonsterChild.ini';
  if (c.mall && c.mall.error) texts.mall = '无法读取：' + c.mall.error;
  else if (c.mall) texts.mall = `${c.mall.items} 件商品 · ${c.mall.hot} 件热卖`;
  else texts.mall = 'PTItems.xml';
  if (c.mapinfo && c.mapinfo.error) texts.mapinfo = '无法读取：' + c.mapinfo.error;
  else if (c.mapinfo) texts.mapinfo = `${c.mapinfo.total} 条规则 · 7 个分区`;
  else texts.mapinfo = 'MapInfo';
  if (c.ops && c.ops.error) texts.ops = '无法读取：' + c.ops.error;
  else if (c.ops) texts.ops = `${c.ops.notices} 条公告 · ${c.ops.quiz} 道题 · ${c.ops.boxes} 宝盒 · ${c.ops.starter} 礼包`;
  else texts.ops = '公告 · 答题 · 宝盒 · 礼包';
  if (c.extra && c.extra.error) texts.extra = '无法读取：' + c.extra.error;
  else if (c.extra) texts.extra = `${c.extra.files} 个配置文件`;
  else texts.extra = '服务器 · 地图 · 活动 · 充值 · 事件';
  texts.servercfg = 'GameServer.ini · 经验/出生/账号';
  for (const key of ['mongen', 'makeitem', 'appellation', 'npc', 'shops', 'goods', 'summons', 'mall', 'mapinfo', 'ops', 'extra', 'servercfg']) {
    const meta = cfgEl('cfgMeta-' + key);
    if (meta) meta.textContent = texts[key];
  }
  document.querySelectorAll('#cfgList .file-item').forEach((li) => {
    li.classList.toggle('active', S.mode === CFG_MODES[li.dataset.cfg]);
  });
}

window.updateConfigMeta = () => {
  const mode = S.mode;
  const n = cfgDirty(mode);
  cfgEl('dirtyDot').classList.toggle('on', n > 0);
  const btn = cfgEl(CFG_SAVE_BTN[mode]);
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `保存 (${n})` : '保存';
  }
  let status = '';
  if (mode === 'cfgMongen' && CFG.mongen.data) {
    status = `刷怪配置 · ${CFG.mongen.data.entries.length} 条`;
  } else if (mode === 'cfgMakeItem' && CFG.makeitem.data) {
    status = `合成配方 · ${CFG.makeitem.data.recipes.length} 个`;
  } else if (mode === 'cfgAppellation' && CFG.appellation.data) {
    status = `称号配置 · ${CFG.appellation.data.rows.length} 条`;
  } else if (mode === 'cfgNpc' && CFG.npc.data) {
    status = `NPC 分布 · ${CFG.npc.data.rows.length} 个`;
  } else if (mode === 'cfgShops' && CFG.shops.data) {
    status = `商店货品 · ${CFG.shops.data.shops.length} 个商店 · ${CFG.shops.data.goods} 条货品`;
  } else if (mode === 'cfgGoods' && CFG.goods.data) {
    status = `商城商品 · ${CFG.goods.data.entries.length} 条`;
  } else if (mode === 'cfgSummons' && CFG.summons.data) {
    status = `召唤关系 · ${CFG.summons.data.chain.entries.length} 条召唤 · ${CFG.summons.data.child.rows.length} 条子怪`;
  } else if (mode === 'cfgMall' && CFG.mall.data) {
    status = `商城配置 · ${CFG.mall.data.items.length} 件商品 · ${CFG.mall.data.hotItems.length} 件热卖`;
  } else if (mode === 'cfgMapinfo' && CFG.mapinfo.data) {
    const total = CFG.mapinfo.data.sections.reduce((n, s) => n + s.rows.length, 0);
    status = `地图规则 · ${total} 条`;
  } else if (mode === 'cfgOps' && CFG.ops.data) {
    status = `运营配置 · ${CFG.ops.data.quiz.rows.length} 道题 · ${CFG.ops.data.boxes.rows.length} 条宝盒`;
  } else if (mode === 'cfgExtra' && CFG.extra.data) {
    status = `扩展配置 · ${CFG.extra.registry ? CFG.extra.registry.length : 0} 个文件 · 当前 ${CFG.extra.data.label || CFG.extra.key}`;
  } else if (mode === 'cfgServercfg' && CFG.extra.data) {
    status = `服务器启动配置 · ${CFG.extra.data.rows.length} 个参数 · ${CFG.extra.data.sections.length} 个分组`;
  }
  if (n) status += ` · ${n} 处未保存`;
  cfgEl('statusText').textContent = status;
};

function cfgCloseDetail() {
  cfgEl('cfgDetail').classList.add('hidden');
  for (const key of Object.keys(CFG)) CFG[key].selected = -1;
  if (CFG.shops) CFG.shops.goodKey = null;
  if (CFG.summons) {
    CFG.summons.chainSelected = -1;
    CFG.summons.childSelected = -1;
  }
  if (CFG.mall) {
    CFG.mall.hotSelected = -1;
  }
  if (CFG.ops) {
    CFG.ops.quizSelected = -1;
    CFG.ops.boxSelected = -1;
    CFG.ops.starterSelected = -1;
  }
  document.querySelectorAll('#mongenGrid tbody tr.selected, #makeitemGrid tbody tr.selected, #appellationGrid tbody tr.selected, #npcGrid tbody tr.selected, #goodsGrid tbody tr.selected, #goodsNameGrid tbody tr.selected, #chainGrid tbody tr.selected, #childGrid tbody tr.selected, #mallGrid tbody tr.selected, #mallHotGrid tbody tr.selected, #mapinfoGrid tbody tr.selected, #opsQuizGrid tbody tr.selected, #opsBoxesGrid tbody tr.selected, #opsStarterGrid tbody tr.selected, #extraGrid tbody tr.selected')
    .forEach((tr) => tr.classList.remove('selected'));
}

function cfgMarkSelected(tbody, index) {
  tbody.querySelectorAll('tr.selected').forEach((tr) => tr.classList.remove('selected'));
  const tr = tbody.querySelector(`tr[data-index="${index}"]`);
  if (tr) tr.classList.add('selected');
}

/* ---------------- 刷怪配置 ---------------- */

function mongenList() {
  const m = CFG.mongen;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < m.data.entries.length; i++) {
    if (m.deleted.has(i)) continue;
    const row = m.edits.get(i) || m.data.entries[i];
    if (m.mapFilter && row.map !== m.mapFilter) continue;
    if (q && !String(row.monster).toLowerCase().includes(q)) continue;
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.added.length; k++) {
    const row = m.added[k];
    if (m.mapFilter && row.map !== m.mapFilter) continue;
    if (q && !String(row.monster).toLowerCase().includes(q)) continue;
    out.push({ index: m.data.entries.length + k, row, added: true });
  }
  return out;
}

function getMongenRow(index) {
  const m = CFG.mongen;
  if (index < m.data.entries.length) return m.edits.get(index) || m.data.entries[index];
  return m.added[index - m.data.entries.length];
}

function setMongenRow(index, row) {
  const m = CFG.mongen;
  if (index >= m.data.entries.length) {
    m.added[index - m.data.entries.length] = row;
    return;
  }
  const base = m.data.entries[index];
  const same = ['map', 'x', 'y', 'monster', 'range', 'count', 'interval'].every((k) => row[k] === base[k]);
  if (same) m.edits.delete(index);
  else m.edits.set(index, row);
}

function buildMongenMapSelect() {
  const m = CFG.mongen;
  const sel = cfgEl('mongenMap');
  cfgClear(sel);
  const add = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  };
  add('', `全部地图 (${m.data.maps.length})`);
  for (const map of m.data.maps) add(map.name, `${map.name} (${map.count})`);
  sel.value = m.mapFilter;
}

function renderMongen() {
  const m = CFG.mongen;
  if (!m.data) return;
  const thead = cfgEl('mongenGrid').querySelector('thead');
  const tbody = cfgEl('mongenGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '地图', 'X', 'Y', '怪物', '范围', '数量', '间隔']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = mongenList();
  const totalPages = Math.max(1, Math.ceil(list.length / m.pageSize));
  if (m.page >= totalPages) m.page = totalPages - 1;
  if (m.page < 0) m.page = 0;
  const start = m.page * m.pageSize;
  for (const item of list.slice(start, start + m.pageSize)) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.selected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const values = [
      item.index + 1,
      item.row.map,
      item.row.x,
      item.row.y,
      item.row.monster,
      item.row.range,
      item.row.count,
      item.row.interval
    ];
    values.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i >= 2 && i !== 4) td.className = 'num';
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

  cfgEl('mongenPageInfo').textContent =
    `第 ${m.page + 1}/${totalPages} 页 · 共 ${list.length} 条` +
    (m.added.length ? `（含新增 ${m.added.length}）` : '');
  cfgEl('mongenPrev').disabled = m.page <= 0;
  cfgEl('mongenNext').disabled = m.page >= totalPages - 1;
  cfgEl('mongenMeta').textContent =
    `${m.data.entries.length} 条刷怪 · ${m.data.maps.length} 张地图 · ${m.data.invalid.length} 行特殊内容`;
}

function buildMongenForm(index) {
  const m = CFG.mongen;
  const row = getMongenRow(index);
  if (!row) return;
  const added = index >= m.data.entries.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = added ? '新增刷怪' : `${row.map} · ${row.monster}`;
  cfgEl('cfgDetailSub').textContent = added
    ? '新增记录（保存后写入文件）'
    : `第 ${index + 1} 条`;
  cfgEl('cfgNote').textContent = '刷怪格式：地图 X Y 怪物 范围 数量 间隔。保存时只改写修改过的行，其余内容保持不变。';

  const mapNames = m.data.maps.map((x) => x.name);
  if (!mapNames.includes(row.map)) mapNames.push(row.map);
  const mapSel = cfgSelect(mapNames, row.map);
  const monster = cfgText(row.monster, 'monsterList', 32);
  const x = cfgNumber(row.x, 0, 100000);
  const y = cfgNumber(row.y, 0, 100000);
  const range = cfgNumber(row.range, 0, 100000);
  const count = cfgNumber(row.count, 0, 1000000);
  const interval = cfgNumber(row.interval, 0, 1000000000);

  const apply = (key, value) => {
    const cur = { ...getMongenRow(index) };
    cur[key] = key === 'map' || key === 'monster' ? value : cfgNum(value);
    setMongenRow(index, cur);
    cfgEl('cfgDetailTitle').textContent =
      index >= m.data.entries.length ? '新增刷怪' : `${cur.map} · ${cur.monster}`;
    renderMongen();
    updateMeta();
  };
  mapSel.addEventListener('change', () => apply('map', mapSel.value));
  monster.addEventListener('input', () => apply('monster', monster.value));
  x.addEventListener('input', () => apply('x', x.value));
  y.addEventListener('input', () => apply('y', y.value));
  range.addEventListener('input', () => apply('range', range.value));
  count.addEventListener('input', () => apply('count', count.value));
  interval.addEventListener('input', () => apply('interval', interval.value));

  form.appendChild(cfgField('地图', mapSel, 'Mongen 地图名'));
  form.appendChild(cfgField('怪物名称', monster, '支持输入搜索'));
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.appendChild(cfgField('X 坐标', x));
  grid.appendChild(cfgField('Y 坐标', y));
  grid.appendChild(cfgField('范围', range));
  grid.appendChild(cfgField('数量', count, '刷怪数量'));
  grid.appendChild(cfgField('间隔', interval, '刷新间隔'));
  form.appendChild(grid);
  cfgMarkSelected(cfgEl('mongenGrid').querySelector('tbody'), index);
}

function selectMongen(index) {
  const m = CFG.mongen;
  if (index === undefined || index === null) return;
  m.selected = index;
  buildMongenForm(index);
}

function mongenAdd(source) {
  const m = CFG.mongen;
  if (!m.data) return;
  let row;
  if (source) {
    row = { ...source };
  } else {
    row = {
      map: m.mapFilter || (m.data.maps[0] ? m.data.maps[0].name : ''),
      x: 0,
      y: 0,
      monster: (m.data.monsters && m.data.monsters[0]) || '',
      range: 0,
      count: 1,
      interval: 1
    };
  }
  m.added.push(row);
  m.mapFilter = '';
  m.search = '';
  cfgEl('mongenSearch').value = '';
  cfgEl('mongenMap').value = '';
  m.selected = m.data.entries.length + m.added.length - 1;
  m.page = Math.max(0, Math.ceil(mongenList().length / m.pageSize) - 1);
  renderMongen();
  selectMongen(m.selected);
  updateMeta();
}

function mongenDelete() {
  const m = CFG.mongen;
  if (m.selected < 0) return toast('请先选择一条刷怪记录', 'err');
  const index = m.selected;
  const row = getMongenRow(index);
  if (!row) return;
  if (!confirm(`删除刷怪：${row.map} · ${row.monster}？`)) return;
  if (index >= m.data.entries.length) {
    m.added.splice(index - m.data.entries.length, 1);
  } else {
    m.deleted.add(index);
    m.edits.delete(index);
  }
  cfgCloseDetail();
  renderMongen();
  updateMeta();
}

function mongenBatch() {
  const m = CFG.mongen;
  if (!m.data) return;
  if (!m.mapFilter) return toast('请先在上方选择一张地图，再批量调整', 'err');
  const factor = Number(cfgEl('mongenFactor').value);
  if (!(factor > 0 && factor <= 100)) return toast('倍数需要在 0.1 到 100 之间', 'err');
  const targets = [];
  for (let i = 0; i < m.data.entries.length; i++) {
    if (!m.deleted.has(i) && getMongenRow(i).map === m.mapFilter) targets.push(i);
  }
  for (let k = 0; k < m.added.length; k++) {
    if (m.added[k].map === m.mapFilter) targets.push(m.data.entries.length + k);
  }
  if (!targets.length) return toast('这张地图没有可调整的刷怪记录', 'err');
  if (!confirm(`将地图 ${m.mapFilter} 的 ${targets.length} 条刷怪数量乘以 ${factor}（最小为 1）？`)) return;
  for (const index of targets) {
    const row = { ...getMongenRow(index) };
    row.count = Math.max(1, Math.round(row.count * factor));
    setMongenRow(index, row);
  }
  renderMongen();
  updateMeta();
  toast(`已调整 ${targets.length} 条刷怪数量，尚未保存`, 'ok');
}

async function openMongen(force) {
  if (!force && !confirmDiscard()) return;
  try {
    const data = await api('/api/config/mongen');
    const m = CFG.mongen;
    m.data = data;
    m.edits.clear();
    m.added = [];
    m.deleted.clear();
    m.page = 0;
    m.mapFilter = '';
    m.search = '';
    m.selected = -1;
    cfgSetMode('cfgMongen');
    cfgEl('mongenSearch').value = '';
    buildMongenMapSelect();
    fillDatalist('monsterList', data.monsters || []);
    renderMongen();
    updateMeta();
  } catch (e) {
    toast('打开刷怪配置失败：' + e.message, 'err');
  }
}

async function openMongenAt(index, map) {
  if (typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  await openMongen(true);
  const m = CFG.mongen;
  if (!m.data) return;
  let target = Number(index);
  if (!Number.isInteger(target) || target < 0 || target >= m.data.entries.length) {
    if (!map) return;
    target = m.data.entries.findIndex((row) => String(row.map).toLowerCase() === String(map).toLowerCase());
    if (target < 0) return;
  }
  const row = m.data.entries[target];
  m.mapFilter = row.map;
  m.search = '';
  cfgEl('mongenSearch').value = '';
  buildMongenMapSelect();
  const list = mongenList();
  const pos = list.findIndex((item) => item.index === target);
  if (pos >= 0) m.page = Math.floor(pos / m.pageSize);
  renderMongen();
  selectMongen(target);
  const tr = cfgEl('mongenGrid').querySelector(`tbody tr[data-index="${target}"]`);
  if (tr) tr.scrollIntoView({ block: 'center' });
}
window.openMongenAt = openMongenAt;

async function saveMongen() {
  const m = CFG.mongen;
  if (!m.data || cfgDirty('cfgMongen') === 0) return;
  const changes = [...m.edits.entries()].map(([index, values]) => ({ index, values }));
  const payload = {
    changes,
    added: m.added.map((r) => ({
      map: r.map, x: r.x, y: r.y, monster: r.monster,
      range: r.range, count: r.count, interval: r.interval
    })),
    deleted: [...m.deleted]
  };
  const btn = cfgEl('btnMongenSave');
  btn.disabled = true;
  try {
    const res = await api('/api/config/mongen/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let msg = `保存成功：修改 ${res.changedRows} 条，新增 ${res.addedRows} 条，删除 ${res.deletedRows} 条。当前 ${res.count} 条。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await openMongen(true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

/* ---------------- 合成配方 ---------------- */

function cloneRecipe(recipe) {
  return { name: recipe.name, items: recipe.items.map((it) => ({ name: it.name, count: it.count })) };
}

function makeitemList() {
  const m = CFG.makeitem;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < m.data.recipes.length; i++) {
    if (m.deleted.has(i)) continue;
    const row = m.edits.get(i) || m.data.recipes[i];
    if (q && !String(row.name).toLowerCase().includes(q) &&
        !row.items.some((it) => String(it.name).toLowerCase().includes(q))) continue;
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.added.length; k++) {
    const row = m.added[k];
    if (q && !String(row.name).toLowerCase().includes(q) &&
        !row.items.some((it) => String(it.name).toLowerCase().includes(q))) continue;
    out.push({ index: m.data.recipes.length + k, row, added: true });
  }
  return out;
}

function getMakeRow(index) {
  const m = CFG.makeitem;
  if (index < m.data.recipes.length) return m.edits.get(index) || m.data.recipes[index];
  return m.added[index - m.data.recipes.length];
}

function setMakeRow(index, row) {
  const m = CFG.makeitem;
  if (index >= m.data.recipes.length) {
    m.added[index - m.data.recipes.length] = row;
    return;
  }
  const base = m.data.recipes[index];
  if (JSON.stringify(base) === JSON.stringify(row)) m.edits.delete(index);
  else m.edits.set(index, row);
}

function renderMakeitem() {
  const m = CFG.makeitem;
  if (!m.data) return;
  const thead = cfgEl('makeitemGrid').querySelector('thead');
  const tbody = cfgEl('makeitemGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '产物', '材料数', '材料明细']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = makeitemList();
  for (const item of list) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.selected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [
      item.index + 1,
      item.row.name,
      item.row.items.length,
      item.row.items.map((it) => `${it.name}×${it.count}`).join('、')
    ];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 2) td.className = 'num';
      else if (i === 1) td.className = 'str namecell';
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

  cfgEl('makeitemMeta').textContent =
    `${m.data.recipes.length} 个配方 · ${m.data.recipes.reduce((n, r) => n + r.items.length, 0)} 种材料`;
}

function buildMakeForm(index) {
  const m = CFG.makeitem;
  const row = getMakeRow(index);
  if (!row) return;
  const added = index >= m.data.recipes.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = row.name || (added ? '新配方' : `配方 #${index + 1}`);
  cfgEl('cfgDetailSub').textContent = added ? '新增配方（保存后写入文件）' : `第 ${index + 1} 个配方`;
  cfgEl('cfgNote').textContent = '每个配方由产物和至少一种材料组成；材料格式为“名称 + 数量”。';

  const name = cfgText(row.name, null, 32);
  name.addEventListener('input', () => {
    const next = cloneRecipe(getMakeRow(index));
    next.name = name.value;
    setMakeRow(index, next);
    cfgEl('cfgDetailTitle').textContent = name.value || (added ? '新配方' : `配方 #${index + 1}`);
    renderMakeitem();
    updateMeta();
  });
  form.appendChild(cfgField('产物名称', name, '写入 [产物] 段'));

  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = '材料列表';
  form.appendChild(title);

  const list = document.createElement('div');
  list.className = 'mat-list';
  row.items.forEach((it, pos) => {
    const mat = document.createElement('div');
    mat.className = 'mat-row';
    const itemName = cfgText(it.name, 'itemList', 32);
    const itemCount = cfgNumber(it.count, 1, 1000000000);
    const del = document.createElement('button');
    del.className = 'btn small ghost';
    del.textContent = '移除';
    itemName.addEventListener('input', () => {
      const next = cloneRecipe(getMakeRow(index));
      next.items[pos].name = itemName.value;
      setMakeRow(index, next);
      renderMakeitem();
      updateMeta();
    });
    itemCount.addEventListener('input', () => {
      const next = cloneRecipe(getMakeRow(index));
      next.items[pos].count = cfgNum(itemCount.value);
      setMakeRow(index, next);
      renderMakeitem();
      updateMeta();
    });
    del.addEventListener('click', () => {
      if (getMakeRow(index).items.length <= 1) return toast('配方至少需要一种材料', 'err');
      const next = cloneRecipe(getMakeRow(index));
      next.items.splice(pos, 1);
      setMakeRow(index, next);
      renderMakeitem();
      buildMakeForm(index);
      updateMeta();
    });
    mat.appendChild(itemName);
    mat.appendChild(itemCount);
    mat.appendChild(del);
    list.appendChild(mat);
  });
  form.appendChild(list);

  const addMat = document.createElement('button');
  addMat.className = 'btn small';
  addMat.textContent = '+ 添加材料';
  addMat.addEventListener('click', () => {
    const next = cloneRecipe(getMakeRow(index));
    next.items.push({ name: (m.data.items && m.data.items[0]) || '', count: 1 });
    setMakeRow(index, next);
    renderMakeitem();
    buildMakeForm(index);
    updateMeta();
  });
  form.appendChild(addMat);
  cfgMarkSelected(cfgEl('makeitemGrid').querySelector('tbody'), index);
}

function uniqueRecipeName(base) {
  const m = CFG.makeitem;
  const names = new Set();
  for (let i = 0; i < m.data.recipes.length; i++) {
    if (!m.deleted.has(i)) names.add((m.edits.get(i) || m.data.recipes[i]).name);
  }
  for (const r of m.added) names.add(r.name);
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(base + n)) n++;
  return base + n;
}

function makeitemAdd(source) {
  const m = CFG.makeitem;
  if (!m.data) return;
  let row;
  if (source) {
    row = cloneRecipe(source);
    row.name = uniqueRecipeName(row.name + '副本');
  } else {
    row = {
      name: uniqueRecipeName('新配方'),
      items: [{ name: (m.data.items && m.data.items[0]) || '', count: 1 }]
    };
  }
  m.added.push(row);
  m.search = '';
  cfgEl('makeitemSearch').value = '';
  m.selected = m.data.recipes.length + m.added.length - 1;
  renderMakeitem();
  buildMakeForm(m.selected);
  updateMeta();
}

function makeitemDelete() {
  const m = CFG.makeitem;
  if (m.selected < 0) return toast('请先选择一个配方', 'err');
  const index = m.selected;
  const row = getMakeRow(index);
  if (!row) return;
  if (!confirm(`删除配方：${row.name}？`)) return;
  if (index >= m.data.recipes.length) {
    m.added.splice(index - m.data.recipes.length, 1);
  } else {
    m.deleted.add(index);
    m.edits.delete(index);
  }
  cfgCloseDetail();
  renderMakeitem();
  updateMeta();
}

async function openMakeitem(force) {
  if (!force && !confirmDiscard()) return;
  try {
    const data = await api('/api/config/makeitem');
    const m = CFG.makeitem;
    m.data = data;
    m.edits.clear();
    m.added = [];
    m.deleted.clear();
    m.search = '';
    m.selected = -1;
    cfgSetMode('cfgMakeItem');
    cfgEl('makeitemSearch').value = '';
    fillDatalist('itemList', data.items || []);
    renderMakeitem();
    updateMeta();
  } catch (e) {
    toast('打开合成配方失败：' + e.message, 'err');
  }
}

window.openMakeitem = openMakeitem;

async function openMakeitemAt(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return;
  if (S.mode !== 'cfgMakeItem' && !confirmDiscard()) return;
  await openMakeitem(true);
  const m = CFG.makeitem;
  if (!m.data || !m.data.recipes || i >= m.data.recipes.length) return;
  m.search = '';
  cfgEl('makeitemSearch').value = '';
  m.selected = i;
  renderMakeitem();
  buildMakeForm(i);
  updateMeta();
  const tr = cfgEl('makeitemGrid').querySelector(`tbody tr[data-index="${i}"]`);
  if (tr) tr.scrollIntoView({ block: 'center' });
}
window.openMakeitemAt = openMakeitemAt;

async function saveMakeitem() {
  const m = CFG.makeitem;
  if (!m.data || cfgDirty('cfgMakeItem') === 0) return;
  const updates = [...m.edits.entries()].map(([index, recipe]) => ({
    index, name: recipe.name, items: recipe.items
  }));
  const payload = { updates, added: m.added, deleted: [...m.deleted] };
  const btn = cfgEl('btnMakeSave');
  btn.disabled = true;
  try {
    const res = await api('/api/config/makeitem/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let msg = `保存成功：修改 ${res.changedRows} 个，新增 ${res.addedRows} 个，删除 ${res.deletedRows} 个。当前 ${res.count} 个配方。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await openMakeitem(true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

/* ---------------- 称号配置 ---------------- */

function appellationList() {
  const m = CFG.appellation;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < m.data.rows.length; i++) {
    if (m.deleted.has(i)) continue;
    const row = m.edits.get(i) || m.data.rows[i];
    if (m.classFilter && row.cls !== m.classFilter) continue;
    if (q) {
      const hay = `${row.title} ${row.level} ${row.stage}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.added.length; k++) {
    const row = m.added[k];
    if (m.classFilter && row.cls !== m.classFilter) continue;
    if (q) {
      const hay = `${row.title} ${row.level} ${row.stage}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({ index: m.data.rows.length + k, row, added: true });
  }
  return out;
}

function getAppRow(index) {
  const m = CFG.appellation;
  if (index < m.data.rows.length) return m.edits.get(index) || m.data.rows[index];
  return m.added[index - m.data.rows.length];
}

function setAppRow(index, row) {
  const m = CFG.appellation;
  if (index >= m.data.rows.length) {
    m.added[index - m.data.rows.length] = row;
    return;
  }
  const base = m.data.rows[index];
  const same = ['cls', 'level', 'stage', 'start', 'end', 'title'].every((k) => row[k] === base[k]);
  if (same) m.edits.delete(index);
  else m.edits.set(index, row);
}

function buildAppClassSelect() {
  const m = CFG.appellation;
  const sel = cfgEl('appellationClass');
  cfgClear(sel);
  const add = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  };
  add('', '全部职业');
  for (const cls of m.data.sections) add(cls, cls);
  sel.value = m.classFilter;
}

function renderAppellation() {
  const m = CFG.appellation;
  if (!m.data) return;
  const thead = cfgEl('appellationGrid').querySelector('thead');
  const tbody = cfgEl('appellationGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '职业', '级别', '阶段', '开始经验', '终止经验', '称号']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = appellationList();
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
      item.index + 1,
      item.row.cls,
      item.row.level,
      item.row.stage,
      item.row.start,
      item.row.end,
      item.row.title
    ];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i >= 2 && i <= 5) td.className = 'num';
      else if (i === 6) td.className = 'str';
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

  cfgEl('appellationPageInfo').textContent =
    `第 ${m.page + 1}/${totalPages} 页 · 共 ${list.length} 条` +
    (m.added.length ? `（含新增 ${m.added.length}）` : '');
  cfgEl('appellationPrev').disabled = m.page <= 0;
  cfgEl('appellationNext').disabled = m.page >= totalPages - 1;
  cfgEl('appellationMeta').textContent =
    `${m.data.rows.length} 条称号 · ${m.data.sections.join(' / ')}`;
}

function buildAppForm(index) {
  const m = CFG.appellation;
  const row = getAppRow(index);
  if (!row) return;
  const added = index >= m.data.rows.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = row.title || (added ? '新增称号阶段' : `称号 #${index + 1}`);
  cfgEl('cfgDetailSub').textContent = added
    ? `新增记录 · ${row.cls}`
    : `${row.cls} · 第 ${index + 1} 条`;
  cfgEl('cfgNote').textContent = '称号按职业分段保存；级别、阶段、开始/终止经验均为整数，称号可以为空。';

  const cls = cfgText(row.cls, null, 16);
  cls.disabled = true;
  const level = cfgNumber(row.level, 0, 10000);
  const stage = cfgNumber(row.stage, 0, 100000);
  const start = cfgNumber(row.start, 0, 1000000000000);
  const end = cfgNumber(row.end, 0, 1000000000000);
  const title = cfgText(row.title, null, 40);

  const apply = (key, value) => {
    const cur = { ...getAppRow(index) };
    cur[key] = key === 'title' ? value : cfgNum(value);
    setAppRow(index, cur);
    if (key === 'title') {
      cfgEl('cfgDetailTitle').textContent = cur.title || (added ? '新增称号阶段' : `称号 #${index + 1}`);
    }
    renderAppellation();
    updateMeta();
  };
  level.addEventListener('input', () => apply('level', level.value));
  stage.addEventListener('input', () => apply('stage', stage.value));
  start.addEventListener('input', () => apply('start', start.value));
  end.addEventListener('input', () => apply('end', end.value));
  title.addEventListener('input', () => apply('title', title.value));

  form.appendChild(cfgField('职业', cls, '段名来源'));
  form.appendChild(cfgField('级别', level, '对应 level'));
  form.appendChild(cfgField('阶段', stage, '同职业内序号'));
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.appendChild(cfgField('开始经验', start));
  grid.appendChild(cfgField('终止经验', end));
  form.appendChild(grid);
  form.appendChild(cfgField('称号', title, '可留空'));
  cfgMarkSelected(cfgEl('appellationGrid').querySelector('tbody'), index);
}

function appellationAdd(source) {
  const m = CFG.appellation;
  if (!m.data) return;
  let row;
  if (source) {
    row = { ...source };
  } else {
    row = {
      cls: m.classFilter || m.data.sections[0],
      level: 0,
      stage: 0,
      start: 0,
      end: 0,
      title: '新称号'
    };
  }
  m.added.push(row);
  m.classFilter = '';
  m.search = '';
  cfgEl('appellationSearch').value = '';
  cfgEl('appellationClass').value = '';
  m.selected = m.data.rows.length + m.added.length - 1;
  m.page = Math.max(0, Math.ceil(appellationList().length / m.pageSize) - 1);
  renderAppellation();
  buildAppForm(m.selected);
  updateMeta();
}

function appellationDelete() {
  const m = CFG.appellation;
  if (m.selected < 0) return toast('请先选择一条称号记录', 'err');
  const index = m.selected;
  const row = getAppRow(index);
  if (!row) return;
  if (!confirm(`删除称号：${row.cls} · ${row.title || row.stage}？`)) return;
  if (index >= m.data.rows.length) {
    m.added.splice(index - m.data.rows.length, 1);
  } else {
    m.deleted.add(index);
    m.edits.delete(index);
  }
  cfgCloseDetail();
  renderAppellation();
  updateMeta();
}

async function openAppellation(force) {
  if (!force && !confirmDiscard()) return;
  try {
    const data = await api('/api/config/appellation');
    const m = CFG.appellation;
    m.data = data;
    m.edits.clear();
    m.added = [];
    m.deleted.clear();
    m.page = 0;
    m.classFilter = '';
    m.search = '';
    m.selected = -1;
    cfgSetMode('cfgAppellation');
    cfgEl('appellationSearch').value = '';
    buildAppClassSelect();
    renderAppellation();
    updateMeta();
  } catch (e) {
    toast('打开称号配置失败：' + e.message, 'err');
  }
}

async function saveAppellation() {
  const m = CFG.appellation;
  if (!m.data || cfgDirty('cfgAppellation') === 0) return;
  const changes = [...m.edits.entries()].map(([index, values]) => ({ index, values }));
  const payload = {
    changes,
    added: m.added.map((row) => ({ cls: row.cls, values: row })),
    deleted: [...m.deleted]
  };
  const btn = cfgEl('btnAppSave');
  btn.disabled = true;
  try {
    const res = await api('/api/config/appellation/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let msg = `保存成功：修改 ${res.changedRows} 条，新增 ${res.addedRows} 条，删除 ${res.deletedRows} 条。当前 ${res.count} 条。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await openAppellation(true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

/* ---------------- 事件绑定 ---------------- */

document.querySelectorAll('#cfgList .file-item').forEach((li) => {
  li.addEventListener('click', () => {
    const key = li.dataset.cfg;
    if (key === 'mongen') openMongen();
    else if (key === 'makeitem') openMakeitem();
    else if (key === 'appellation') openAppellation();
    else if (key === 'npc' && window.openNpcConfig) window.openNpcConfig();
    else if (key === 'shops' && window.openShopsConfig) window.openShopsConfig();
    else if (key === 'goods' && window.openGoodsConfig) window.openGoodsConfig();
    else if (key === 'summons' && window.openSummonsConfig) window.openSummonsConfig();
    else if (key === 'mall' && window.openMallConfig) window.openMallConfig();
    else if (key === 'mapinfo' && window.openMapinfoConfig) window.openMapinfoConfig();
    else if (key === 'ops' && window.openOpsConfig) window.openOpsConfig();
    else if (key === 'extra' && window.openExtraConfig) window.openExtraConfig();
    else if (key === 'servercfg' && window.openServerConfig) window.openServerConfig();
  });
});

let cfgSearchTimer = null;

cfgEl('mongenGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  selectMongen(Number(tr.dataset.index));
});
cfgEl('makeitemGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  CFG.makeitem.selected = Number(tr.dataset.index);
  buildMakeForm(CFG.makeitem.selected);
});
cfgEl('appellationGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  CFG.appellation.selected = Number(tr.dataset.index);
  buildAppForm(CFG.appellation.selected);
});

cfgEl('mongenMap').addEventListener('change', () => {
  CFG.mongen.mapFilter = cfgEl('mongenMap').value;
  CFG.mongen.page = 0;
  renderMongen();
});
cfgEl('mongenSearch').addEventListener('input', () => {
  clearTimeout(cfgSearchTimer);
  cfgSearchTimer = setTimeout(() => {
    CFG.mongen.search = cfgEl('mongenSearch').value;
    CFG.mongen.page = 0;
    renderMongen();
  }, 150);
});
cfgEl('makeitemSearch').addEventListener('input', () => {
  clearTimeout(cfgSearchTimer);
  cfgSearchTimer = setTimeout(() => {
    CFG.makeitem.search = cfgEl('makeitemSearch').value;
    renderMakeitem();
  }, 150);
});
cfgEl('appellationClass').addEventListener('change', () => {
  CFG.appellation.classFilter = cfgEl('appellationClass').value;
  CFG.appellation.page = 0;
  renderAppellation();
});
cfgEl('appellationSearch').addEventListener('input', () => {
  clearTimeout(cfgSearchTimer);
  cfgSearchTimer = setTimeout(() => {
    CFG.appellation.search = cfgEl('appellationSearch').value;
    CFG.appellation.page = 0;
    renderAppellation();
  }, 150);
});

cfgEl('mongenPrev').addEventListener('click', () => {
  if (CFG.mongen.page > 0) {
    CFG.mongen.page--;
    renderMongen();
  }
});
cfgEl('mongenNext').addEventListener('click', () => {
  CFG.mongen.page++;
  renderMongen();
});
cfgEl('appellationPrev').addEventListener('click', () => {
  if (CFG.appellation.page > 0) {
    CFG.appellation.page--;
    renderAppellation();
  }
});
cfgEl('appellationNext').addEventListener('click', () => {
  CFG.appellation.page++;
  renderAppellation();
});

cfgEl('btnMongenAdd').addEventListener('click', () => mongenAdd(null));
cfgEl('btnMongenDel').addEventListener('click', mongenDelete);
cfgEl('btnMongenBatch').addEventListener('click', mongenBatch);
cfgEl('btnMongenReload').addEventListener('click', () => openMongen());
cfgEl('btnMongenSave').addEventListener('click', saveMongen);

cfgEl('btnMakeAdd').addEventListener('click', () => makeitemAdd(null));
cfgEl('btnMakeDup').addEventListener('click', () => {
  if (CFG.makeitem.selected < 0) return toast('请先选择一个配方', 'err');
  makeitemAdd(getMakeRow(CFG.makeitem.selected));
});
cfgEl('btnMakeDel').addEventListener('click', makeitemDelete);
cfgEl('btnMakeReload').addEventListener('click', () => openMakeitem());
cfgEl('btnMakeSave').addEventListener('click', saveMakeitem);

cfgEl('btnAppAdd').addEventListener('click', () => appellationAdd(null));
cfgEl('btnAppDup').addEventListener('click', () => {
  if (CFG.appellation.selected < 0) return toast('请先选择一条称号记录', 'err');
  appellationAdd(getAppRow(CFG.appellation.selected));
});
cfgEl('btnAppDel').addEventListener('click', appellationDelete);
cfgEl('btnAppReload').addEventListener('click', () => openAppellation());
cfgEl('btnAppSave').addEventListener('click', saveAppellation);

cfgEl('btnCfgClose').addEventListener('click', cfgCloseDetail);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.mode.startsWith('cfg')) {
    e.preventDefault();
    if (S.mode === 'cfgMongen') saveMongen();
    else if (S.mode === 'cfgMakeItem') saveMakeitem();
    else if (S.mode === 'cfgAppellation') saveAppellation();
    else if (S.mode === 'cfgGoods' && window.saveGoodsConfig) window.saveGoodsConfig();
    else if (S.mode === 'cfgSummons' && window.saveSummonsConfig) window.saveSummonsConfig();
    else if (S.mode === 'cfgMall' && window.saveMallConfig) window.saveMallConfig();
    else if (S.mode === 'cfgMapinfo' && window.saveMapinfoConfig) window.saveMapinfoConfig();
    else if (S.mode === 'cfgOps' && window.saveOpsConfig) window.saveOpsConfig();
    else if (S.mode === 'cfgExtra' && window.saveExtraConfig) window.saveExtraConfig();
    else if (S.mode === 'cfgServercfg' && window.saveExtraConfig) window.saveExtraConfig();
  }
  if (e.key === 'Escape' && S.mode.startsWith('cfg')) cfgCloseDetail();
});

document.addEventListener('state:refreshed', (e) => {
  S.configs = e.detail.configs || null;
  renderCfgList();
});

api('/api/state').then((st) => {
  S.configs = st.configs || null;
  renderCfgList();
}).catch(() => {});

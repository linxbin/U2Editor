'use strict';

const MON = {
  list: null,
  listError: '',
  loadPromise: null,
  filter: '',
  flag: 'all',
  name: null,
  detail: null,
  tab: 'attr',
  saving: false,
  attr: { rowIndex: -1, edits: new Map() },
  spawn: { edits: new Map(), added: [], deleted: new Set() },
  drop: {
    file: null, data: null, create: false, baseSize: 0, baseMtime: 0,
    edits: new Map(), added: [], deleted: new Set()
  },
  child: { edits: new Map(), added: [], deleted: new Set() }
};

const MON_TAB_PANES = {
  attr: 'monTabAttr',
  spawn: 'monTabSpawn',
  drop: 'monTabDrop',
  child: 'monTabChild',
  health: 'monTabHealth'
};
const MON_DIRTY_IDS = {
  attr: 'monDirty-attr',
  spawn: 'monDirty-spawn',
  drop: 'monDirty-drop',
  child: 'monDirty-child'
};
const MON_ISSUE_LABELS = {
  db_missing: '缺少 DB 记录',
  dup_db_name: 'DB 同名记录',
  spawn_map_unknown: '刷怪地图未知',
  spawn_dup: '刷怪点重复',
  spawn_extra: '刷怪多余参数',
  spawn_none: '没有刷怪点',
  drop_none: '没有爆率文件',
  drop_item_unknown: '掉落物品未知',
  drop_line_invalid: '爆率行格式异常',
  drop_prob_negative: '概率为负数',
  drop_prob_zero_den: '概率分母为 0',
  drop_orphan_file: '无主爆率文件',
  child_parent_missing: '召唤父怪缺失',
  child_child_missing: '召唤子怪缺失',
  child_dup_same_parent: '子怪重复',
  variant_ambiguous: '爆率文件歧义'
};
const MON_SEV_LABELS = { error: '错误', warn: '警告', info: '提示' };
const MON_TIER_LABELS = { exact: '精确', root: '去数字', family: '同族' };

let monFilterTimer = null;

function monEl(id) {
  return document.getElementById(id);
}

function monText(id, text) {
  const el = monEl(id);
  if (el) el.textContent = text;
}

function monButton(text, action, cls) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  if (cls) btn.className = cls;
  if (action) btn.dataset.monAction = action;
  return btn;
}

function monAttrKey(index, field) {
  return index + '\u0000' + field;
}

function monTabDirty(tab) {
  if (tab === 'attr') return MON.attr.edits.size;
  if (tab === 'spawn') return MON.spawn.edits.size + MON.spawn.added.length + MON.spawn.deleted.size;
  if (tab === 'drop') return MON.drop.edits.size + MON.drop.added.length + MON.drop.deleted.size;
  if (tab === 'child') return MON.child.edits.size + MON.child.added.length + MON.child.deleted.size;
  return 0;
}

function monTotalDirty() {
  return monTabDirty('attr') + monTabDirty('spawn') + monTabDirty('drop') + monTabDirty('child');
}

function monIssueBadCount(summary) {
  return summary.issues.error + summary.issues.warn;
}

function monSafeDropName(name) {
  const clean = String(name == null ? '' : name).replace(/[\\/:*?"<>|]/g, '_').trim();
  return (clean || 'monster') + '.txt';
}

function monHashName() {
  if (!location.hash.startsWith('#monster=')) return '';
  try {
    return decodeURIComponent(location.hash.slice(9));
  } catch (e) {
    return '';
  }
}

function monSetHash(name) {
  if (!name) return;
  const hash = '#monster=' + encodeURIComponent(name);
  if (location.hash === hash) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + hash);
  } catch (e) {
    location.hash = hash;
  }
}

async function monLoadList(force) {
  if (MON.list && !force && !MON.listError) return MON.list;
  if (MON.loadPromise) return MON.loadPromise;
  MON.loadPromise = api('/api/monster/list')
    .then((data) => {
      MON.list = data;
      MON.listError = '';
      monText('monCount', String(data.monsters.length));
      const items = (data.items || []).slice();
      if (!items.includes('金币')) items.push('金币');
      fillDatalist('itemList', items);
      fillDatalist('monsterList', data.monsters.map((m) => m.name));
      monEnsureMapDatalist(data.maps || []);
      monRenderList();
      return data;
    })
    .catch((e) => {
      MON.listError = e.message || String(e);
      MON.list = null;
      monRenderList();
      throw e;
    })
    .finally(() => {
      MON.loadPromise = null;
    });
  return MON.loadPromise;
}

function monEnsureMapDatalist(maps) {
  let dl = monEl('monMapCodeList');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'monMapCodeList';
    document.body.appendChild(dl);
  }
  cfgClear(dl);
  for (const map of maps) {
    const opt = document.createElement('option');
    opt.value = map.code;
    opt.label = map.name;
    opt.textContent = map.name;
    dl.appendChild(opt);
  }
}

function monFilteredMonsters() {
  if (!MON.list) return [];
  const q = MON.filter.trim().toLowerCase();
  return MON.list.monsters.filter((m) => {
    if (MON.flag !== 'all') {
      if (MON.flag === 'issues') {
        if (monIssueBadCount(m) === 0) return false;
      } else if (!m.flags[MON.flag]) {
        return false;
      }
    }
    if (!q) return true;
    if (m.name.toLowerCase().includes(q)) return true;
    if ((m.dropPrimary || '').toLowerCase().includes(q)) return true;
    return m.spawnMaps.some((map) => String(map).toLowerCase().includes(q));
  });
}

function monBadge(text, cls, on, title) {
  const span = document.createElement('span');
  span.className = 'mon-badge ' + cls + (on ? '' : ' off');
  span.textContent = text;
  if (title) span.title = title;
  return span;
}

function monRenderList() {
  const list = monEl('monList');
  const hint = monEl('monListHint');
  cfgClear(list);
  if (!MON.list) {
    if (hint) hint.textContent = MON.listError ? '加载失败：' + MON.listError : '正在加载怪物索引...';
    return;
  }
  const all = MON.list.monsters;
  const filtered = monFilteredMonsters();
  const shown = filtered.slice(0, 500);
  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'mon-empty';
    li.textContent = all.length ? '没有匹配的怪物' : '没有可显示的怪物';
    list.appendChild(li);
  }
  for (const m of shown) {
    const li = document.createElement('li');
    li.className = 'file-item mon-item' + (m.name === MON.name ? ' active' : '');
    li.dataset.name = m.name;

    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = m.name;
    if (m.dbCount > 1) {
      const tag = document.createElement('span');
      tag.className = 'new-tag';
      tag.textContent = '同名 ' + m.dbCount;
      name.appendChild(tag);
    }
    li.appendChild(name);

    const badges = document.createElement('div');
    badges.className = 'mon-badges';
    badges.appendChild(monBadge('属性', 'attr', m.flags.attr, m.flags.attr ? 'Monster.DB 中有记录' : 'Monster.DB 中没有记录'));
    badges.appendChild(monBadge('刷 ' + m.spawnCount, 'spawn', m.flags.spawn, 'Mongen.txt 刷怪点'));
    badges.appendChild(monBadge('爆 ' + m.dropFiles, 'drop', m.flags.drop, '爆率文件数'));
    badges.appendChild(monBadge('召 ' + (m.childCount + m.parentCount), 'child', m.flags.child, `子怪 ${m.childCount} · 作为子怪 ${m.parentCount}`));
    li.appendChild(badges);

    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = `刷怪 ${m.spawnCount} · 爆率 ${m.dropFiles} · 子怪 ${m.childCount}`;
    const bad = monIssueBadCount(m);
    if (bad > 0) {
      const issue = document.createElement('span');
      issue.className = 'mon-issue-count';
      issue.textContent = '异常 ' + bad;
      issue.title = `错误 ${m.issues.error} · 警告 ${m.issues.warn} · 提示 ${m.issues.info}`;
      meta.appendChild(issue);
    }
    li.appendChild(meta);
    list.appendChild(li);
  }

  const st = MON.list.stats;
  const bad = st.issues.error + st.issues.warn;
  let text = `${filtered.length}/${all.length} 个名字 · 错误 ${st.issues.error} · 警告 ${st.issues.warn}`;
  if (bad > 0) text += '（异常筛选用）';
  if (filtered.length > shown.length) text += ` · 仅显示前 ${shown.length} 条，请继续搜索`;
  if (hint) hint.textContent = text;

  document.querySelectorAll('#monFlagFilter [data-mon-flag]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.monFlag === MON.flag);
  });
}

function monShowShell() {
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  if (window.hideItemWorkView) window.hideItemWorkView();
  if (window.hideGrowthView) window.hideGrowthView();
  if (window.hideDropWorkView) window.hideDropWorkView();
  if (window.hideSpawnWorkView) window.hideSpawnWorkView();
  if (window.hideMapWorkView) window.hideMapWorkView();
  if (window.showSideTab) window.showSideTab('mon');
  S.mode = 'monster';
  monEl('dbView').classList.add('hidden');
  monEl('dropView').classList.add('hidden');
  monEl('detail').classList.add('hidden');
  monEl('monsterView').classList.remove('hidden');
}

function monConfirmLeave() {
  if (typeof confirmDiscard === 'function') return confirmDiscard();
  return window.monsterConfirmDiscard ? window.monsterConfirmDiscard() : true;
}

async function openMonsterWorkbench(name, force) {
  if (name && MON.name === name && MON.detail && !force && S.mode === 'monster') {
    monShowShell();
    monSetHash(MON.name);
    monRenderAll();
    return;
  }
  if (!force && !monConfirmLeave()) return;
  try {
    await monLoadList();
  } catch (e) {
    toast('加载怪物索引失败：' + e.message, 'err');
    return;
  }
  monShowShell();
  let target = name;
  if (!target) {
    if (MON.name && MON.detail) target = MON.name;
    else {
      const visible = monFilteredMonsters();
      target = visible.length ? visible[0].name : (MON.list.monsters[0] || {}).name;
    }
  }
  if (!target) {
    monRenderEmpty('列表中没有可打开的怪物');
    return;
  }
  await monSelect(target);
}

function monResetEditState() {
  MON.attr.rowIndex = -1;
  MON.attr.edits.clear();
  MON.spawn.edits.clear();
  MON.spawn.added.length = 0;
  MON.spawn.deleted.clear();
  MON.drop.file = null;
  MON.drop.data = null;
  MON.drop.create = false;
  MON.drop.baseSize = 0;
  MON.drop.baseMtime = 0;
  MON.drop.edits.clear();
  MON.drop.added.length = 0;
  MON.drop.deleted.clear();
  MON.child.edits.clear();
  MON.child.added.length = 0;
  MON.child.deleted.clear();
}

async function monSelect(name) {
  MON.name = name;
  MON.detail = null;
  monResetEditState();
  monText('monTitle', name);
  monText('monMeta', '正在加载...');
  monRenderAll();

  let detail;
  try {
    detail = await api('/api/monster/detail?name=' + encodeURIComponent(name));
  } catch (e) {
    toast('加载怪物失败：' + e.message, 'err');
    monText('monMeta', '加载失败：' + e.message);
    return;
  }
  MON.detail = detail;
  MON.attr.rowIndex = detail.attr.exists ? detail.attr.selectedIndex : -1;

  const primary = detail.drops.primary;
  if (primary) {
    MON.drop.file = primary;
    MON.drop.create = false;
    try {
      await monLoadDropFile(primary);
    } catch (e) {
      toast('加载爆率文件失败：' + e.message, 'err');
    }
  } else {
    MON.drop.file = monSafeDropName(name);
    MON.drop.create = true;
  }

  monSetHash(name);
  monRenderAll();
}

function monRenderEmpty(message) {
  MON.name = null;
  MON.detail = null;
  monResetEditState();
  monText('monTitle', '怪物工作台');
  monText('monMeta', message || '请选择左侧怪物');
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
    location.hash = '';
  }
  monRenderAll();
}

function monRenderAll() {
  monRenderTabs();
  monRenderAttr();
  monRenderSpawn();
  monRenderDrop();
  monRenderChild();
  monRenderHealth();
  monRenderList();
  monUpdateMeta();
}

function monRenderTabs() {
  document.querySelectorAll('#monTabs [data-mon-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.monTab === MON.tab);
  });
  for (const [tab, id] of Object.entries(MON_TAB_PANES)) {
    const pane = monEl(id);
    if (pane) pane.classList.toggle('hidden', tab !== MON.tab);
  }
}

function switchMonTab(tab) {
  if (!MON_TAB_PANES[tab]) return;
  MON.tab = tab;
  monRenderTabs();
  monRenderHealth();
  monUpdateMeta();
}

function monUpdateMeta() {
  const total = monTotalDirty();
  const dot = monEl('dirtyDot');
  if (dot) dot.classList.toggle('on', total > 0);
  const status = monEl('statusText');
  if (status) {
    status.textContent = MON.name
      ? `怪物 ${MON.name}${total ? ` · ${total} 处未保存` : ' · 已保存'}`
      : '怪物工作台';
  }

  if (MON.detail) {
    const d = MON.detail;
    const parts = [
      `DB ${d.attr.dbCount} 条`,
      `刷怪 ${d.spawns.length}`,
      `爆率 ${d.drops.candidates.length}`,
      `子怪 ${d.child.asParent.length}`
    ];
    if (total) parts.push(`${total} 处未保存`);
    monText('monMeta', parts.join(' · '));
  } else if (MON.name) {
    monText('monMeta', '正在加载...');
  } else if (!MON.list) {
    monText('monMeta', MON.listError ? '索引加载失败' : '请选择左侧怪物');
  }

  for (const [tab, id] of Object.entries(MON_DIRTY_IDS)) {
    const n = monTabDirty(tab);
    monText(id, n ? ` (${n})` : '');
  }

  const save = monEl('btnMonSave');
  const tabDirty = monTabDirty(MON.tab);
  const saveable = MON.tab !== 'health' && Boolean(MON.detail);
  if (save) {
    save.disabled = MON.saving || !saveable || tabDirty === 0;
    save.textContent = tabDirty ? `保存当前页 (${tabDirty})` : '保存当前页';
  }

  const spawnSave = monEl('btnMonSpawnSave');
  const spawnDirty = monTabDirty('spawn');
  if (spawnSave) {
    spawnSave.disabled = MON.saving || !MON.detail || spawnDirty === 0;
    spawnSave.textContent = spawnDirty ? `保存刷怪点 (${spawnDirty})` : '保存刷怪点';
  }
  const spawnAdd = monEl('btnMonSpawnAdd');
  if (spawnAdd) spawnAdd.disabled = MON.saving || !MON.detail;

  const childSave = monEl('btnMonChildSave');
  const childDirty = monTabDirty('child');
  if (childSave) {
    childSave.disabled = MON.saving || !MON.detail || childDirty === 0;
    childSave.textContent = childDirty ? `保存子怪 (${childDirty})` : '保存子怪';
  }
  const childAdd = monEl('btnMonChildAdd');
  if (childAdd) childAdd.disabled = MON.saving || !MON.detail;

  const dropSave = monEl('monDropBar').querySelector('[data-mon-action="save-drop"]');
  if (dropSave) {
    dropSave.disabled = MON.saving || monTabDirty('drop') === 0;
    dropSave.textContent = monTabDirty('drop') ? `保存爆率 (${monTabDirty('drop')})` : '保存爆率';
  }
  const dropAdd = monEl('monDropBar').querySelector('[data-mon-action="add-drop"]');
  if (dropAdd) {
    dropAdd.disabled = MON.saving || !MON.drop.file || (!MON.drop.data && !MON.drop.create);
  }
}

function monAttrBaseRow(index) {
  if (!MON.detail) return null;
  return MON.detail.attr.rows.find((r) => r.index === index) || null;
}

function monRenderAttr() {
  const bar = monEl('monAttrBar');
  const grid = monEl('monAttrGrid');
  cfgClear(bar);
  cfgClear(grid);
  if (!MON.detail) return;
  if (!MON.detail.attr.exists) {
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = 'Monster.DB 中没有该怪物，属性页为空。';
    bar.appendChild(note);
    const empty = document.createElement('div');
    empty.className = 'mon-empty';
    empty.textContent = '该名字只出现在刷怪、爆率或召唤配置中，没有对应的 Monster.DB 记录。';
    grid.appendChild(empty);
    return;
  }

  const rows = MON.detail.attr.rows;
  let row = rows.find((r) => r.index === MON.attr.rowIndex);
  if (!row) {
    row = rows[0];
    MON.attr.rowIndex = row.index;
  }

  if (rows.length > 1) {
    const label = document.createElement('span');
    label.className = 'inline-field';
    label.appendChild(document.createTextNode('同名记录'));
    const sel = document.createElement('select');
    sel.className = 'filter select';
    for (const item of rows) {
      const opt = document.createElement('option');
      opt.value = String(item.index);
      opt.textContent = `#${item.index + 1} · ${item.values.Name || '(无名)'}`;
      sel.appendChild(opt);
    }
    sel.value = String(MON.attr.rowIndex);
    sel.addEventListener('change', () => {
      MON.attr.rowIndex = Number(sel.value);
      monRenderAttr();
      monUpdateMeta();
    });
    label.appendChild(sel);
    bar.appendChild(label);
  }

  const info = document.createElement('span');
  info.className = 'muted';
  info.textContent = 'Name 重命名不会同步刷怪/爆率/召唤（v1）· 保存会写回 Monster.DB 并自动备份';
  bar.appendChild(info);

  const nameField = MON.detail.attr.fields.find((f) => f.name === 'Name');
  const nameWidth = nameField ? nameField.width : 14;

  for (const f of MON.detail.attr.fields) {
    const value = row.values[f.name];
    let control;
    if (f.kind === 'string') {
      control = cfgText(value, f.name === 'Name' ? 'monsterList' : null, f.width);
    } else {
      control = cfgNumber(value, 0, f.kind === 'int16' ? 32767 : 2147483647);
    }
    control.dataset.field = f.name;
    const key = monAttrKey(row.index, f.name);
    const dirty = MON.attr.edits.has(key);
    if (dirty) control.classList.add('changed');

    const cn = fieldLabel(f.name);
    const labelText = cn ? `${f.name} · ${cn}` : f.name;
    let hint;
    if (f.kind === 'string') {
      hint = `${f.width} 字节`;
      if (f.name === 'Name') hint += ` · 约 ${Math.floor(nameWidth / 2)} 个汉字`;
    } else {
      hint = f.kind === 'int16' ? '0-32767' : '0-2147483647';
    }

    control.addEventListener('input', () => {
      const base = monAttrBaseRow(row.index);
      if (!base) return;
      if (String(control.value) === String(base.values[f.name] == null ? '' : base.values[f.name])) {
        MON.attr.edits.delete(key);
      } else {
        MON.attr.edits.set(key, control.value);
      }
      control.classList.toggle('changed', MON.attr.edits.has(key));
      monUpdateMeta();
    });

    grid.appendChild(cfgField(labelText, control, hint));
  }
}

function monSpawnBase(index) {
  if (!MON.detail) return null;
  return MON.detail.spawns.find((s) => s.entryIndex === index) || null;
}

function monSpawnDefaults() {
  const first = MON.detail && MON.detail.spawns.find((s) => !MON.spawn.deleted.has(s.entryIndex));
  return {
    map: first ? first.map : '',
    x: first ? first.x : 0,
    y: first ? first.y : 0,
    range: first ? first.range : 1,
    count: 1,
    interval: first ? first.interval : 1,
    monster: MON.name
  };
}

function monSpawnRows() {
  const out = [];
  if (MON.detail) {
    for (const s of MON.detail.spawns) {
      if (MON.spawn.deleted.has(s.entryIndex)) continue;
      out.push({
        added: false,
        entryIndex: s.entryIndex,
        base: s,
        row: MON.spawn.edits.get(s.entryIndex) || s
      });
    }
  }
  MON.spawn.added.forEach((row, k) => {
    out.push({ added: true, addIndex: k, row });
  });
  return out;
}

function monSpawnSame(a, b) {
  const keys = ['map', 'x', 'y', 'range', 'count', 'interval'];
  return keys.every((k) => String(a[k] == null ? '' : a[k]) === String(b[k] == null ? '' : b[k]));
}

function monSpawnValues(tr) {
  const read = (role) => {
    const input = tr.querySelector(`input[data-role="${role}"]`);
    return input ? input.value : '';
  };
  return {
    map: read('map').trim(),
    x: read('x'),
    y: read('y'),
    range: read('range'),
    count: read('count'),
    interval: read('interval'),
    monster: MON.name
  };
}

function monSpawnMark(tr, base) {
  tr.querySelectorAll('input[data-role]').forEach((input) => {
    if (!base) {
      input.classList.add('dirty');
      return;
    }
    const role = input.dataset.role;
    const a = role === 'map' ? input.value.trim() : input.value;
    const b = base[role] == null ? '' : String(base[role]);
    input.classList.toggle('dirty', String(a) !== b);
  });
}

function monRenderSpawn() {
  const table = monEl('monSpawnGrid');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);

  const htr = document.createElement('tr');
  for (const label of ['行', '地图', 'X', 'Y', '范围', '数量', '间隔', '操作']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '行') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  if (!MON.detail) {
    tbody.appendChild(monEmptyRow(8, '请选择怪物'));
    monText('monSpawnMeta', '请选择怪物');
    return;
  }

  const rows = monSpawnRows();
  if (!rows.length) {
    tbody.appendChild(monEmptyRow(8, '该怪物没有刷怪点，可点击“新增刷怪点”。'));
  }

  for (const item of rows) {
    const tr = document.createElement('tr');
    if (item.added) {
      tr.classList.add('added');
      tr.dataset.add = String(item.addIndex);
    } else {
      tr.dataset.index = String(item.entryIndex);
      if (MON.spawn.edits.has(item.entryIndex)) tr.classList.add('selected');
    }
    const row = item.row;

    const lineTd = document.createElement('td');
    lineTd.className = 'col-idx';
    if (item.added) {
      const tag = document.createElement('span');
      tag.className = 'new-tag';
      tag.textContent = '新';
      lineTd.appendChild(tag);
    } else {
      lineTd.textContent = String(item.base.line + 1);
    }
    tr.appendChild(lineTd);

    const mapTd = document.createElement('td');
    const mapInput = document.createElement('input');
    mapInput.value = row.map == null ? '' : row.map;
    mapInput.dataset.role = 'map';
    mapInput.setAttribute('list', 'monMapCodeList');
    const mapName = monMapName(row.map);
    mapInput.title = mapName ? `${row.map} · ${mapName}` : 'MapInfo 中不存在该地图';
    if (!mapName) mapInput.classList.add('map-unknown');
    if (!item.added && String(row.map) !== String(item.base.map)) mapInput.classList.add('dirty');
    mapTd.appendChild(mapInput);
    tr.appendChild(mapTd);

    for (const role of ['x', 'y', 'range', 'count', 'interval']) {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.min = '0';
      input.value = row[role] == null ? '' : String(row[role]);
      input.dataset.role = role;
      if (!item.added && String(row[role] ?? '') !== String(item.base[role] ?? '')) input.classList.add('dirty');
      td.appendChild(input);
      tr.appendChild(td);
    }

    const opTd = document.createElement('td');
    opTd.className = 'mon-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mon-del';
    del.textContent = '删除';
    del.dataset.monSpawnDelete = item.added ? 'add' : String(item.entryIndex);
    if (item.added) del.dataset.addIndex = String(item.addIndex);
    opTd.appendChild(del);
    tr.appendChild(opTd);

    tbody.appendChild(tr);
  }

  const visible = rows.length;
  const maps = new Set(rows.map((r) => r.row.map).filter(Boolean));
  monText(
    'monSpawnMeta',
    `刷怪点 ${visible}${MON.spawn.added.length ? `（新增 ${MON.spawn.added.length}）` : ''}` +
    ` · ${maps.size} 张地图 · 修改 ${MON.spawn.edits.size} / 删除 ${MON.spawn.deleted.size}`
  );
}

function monEmptyRow(cols, text) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = cols;
  td.className = 'mon-empty';
  td.textContent = text;
  tr.appendChild(td);
  return tr;
}

function monMapName(code) {
  if (!MON.list) return '';
  const map = MON.list.maps.find((m) => m.code === code);
  return map ? map.name : '';
}

function monOnSpawnInput(e) {
  const input = e.target.closest('input[data-role]');
  if (!input) return;
  const tr = input.closest('tr');
  if (!tr) return;
  const values = monSpawnValues(tr);
  const addIndex = tr.dataset.add;
  if (addIndex !== undefined) {
    MON.spawn.added[Number(addIndex)] = values;
    monSpawnMark(tr, null);
  } else {
    const index = Number(tr.dataset.index);
    const base = monSpawnBase(index);
    if (!base) return;
    if (monSpawnSame(values, base)) MON.spawn.edits.delete(index);
    else MON.spawn.edits.set(index, values);
    monSpawnMark(tr, base);
    tr.classList.toggle('selected', MON.spawn.edits.has(index));
  }
  monUpdateMeta();
}

function monOnSpawnDelete(e) {
  const btn = e.target.closest('button[data-mon-spawn-delete]');
  if (!btn) return;
  if (btn.dataset.monSpawnDelete === 'add') {
    MON.spawn.added.splice(Number(btn.dataset.addIndex), 1);
  } else {
    const index = Number(btn.dataset.monSpawnDelete);
    MON.spawn.deleted.add(index);
    MON.spawn.edits.delete(index);
  }
  monRenderSpawn();
  monUpdateMeta();
}

function monSpawnAdd() {
  if (!MON.detail) return;
  MON.spawn.added.push(monSpawnDefaults());
  monRenderSpawn();
  monUpdateMeta();
  const body = monEl('monSpawnGrid').querySelector('tbody');
  const last = body.lastElementChild;
  if (last) last.scrollIntoView({ block: 'nearest' });
}

function monChildKnown(name) {
  if (!MON.list || !name) return false;
  return MON.list.monsters.some((m) => m.name === name && m.flags.attr);
}

function monChildRows() {
  const out = [];
  if (MON.detail) {
    for (const row of MON.detail.child.asParent) {
      if (MON.child.deleted.has(row.index)) continue;
      out.push({
        added: false,
        index: row.index,
        base: row,
        row: MON.child.edits.get(row.index) || row
      });
    }
  }
  MON.child.added.forEach((row, k) => {
    out.push({ added: true, addIndex: k, row });
  });
  return out;
}

function monRenderChild() {
  const table = monEl('monChildGrid');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const parents = monEl('monChildParents');
  cfgClear(thead);
  cfgClear(tbody);
  cfgClear(parents);

  const htr = document.createElement('tr');
  for (const label of ['#', '子怪', '状态', '操作']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  if (!MON.detail) {
    tbody.appendChild(monEmptyRow(4, '请选择怪物'));
    monText('monChildMeta', '请选择怪物');
    return;
  }

  if (MON.detail.child.asChild.length) {
    const label = document.createElement('span');
    label.textContent = '作为子怪出现在：';
    parents.appendChild(label);
    for (const row of MON.detail.child.asChild) {
      const item = document.createElement('span');
      item.className = 'mon-parent-row';
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'mon-link';
      link.textContent = row.parent;
      link.dataset.monOpen = row.parent;
      item.appendChild(link);
      const line = document.createElement('span');
      line.className = 'muted';
      line.textContent = `第 ${row.line + 1} 行`;
      item.appendChild(line);
      parents.appendChild(item);
    }
  } else {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = '没有作为子怪出现在其它怪物下。';
    parents.appendChild(empty);
  }

  const rows = monChildRows();
  if (!rows.length) {
    tbody.appendChild(monEmptyRow(4, '该怪物没有配置子怪，可点击“新增子怪”。'));
  }

  for (const item of rows) {
    const tr = document.createElement('tr');
    if (item.added) {
      tr.classList.add('added');
      tr.dataset.add = String(item.addIndex);
    } else {
      tr.dataset.index = String(item.index);
      if (MON.child.edits.has(item.index)) tr.classList.add('selected');
    }
    const row = item.row;

    const idxTd = document.createElement('td');
    idxTd.className = 'col-idx';
    if (item.added) {
      const tag = document.createElement('span');
      tag.className = 'new-tag';
      tag.textContent = '新';
      idxTd.appendChild(tag);
    } else {
      idxTd.textContent = String(item.index + 1);
    }
    tr.appendChild(idxTd);

    const childTd = document.createElement('td');
    const input = cfgText(row.child, 'monsterList', 32);
    input.dataset.role = 'child';
    if (!item.added && row.child !== item.base.child) input.classList.add('dirty');
    childTd.appendChild(input);
    tr.appendChild(childTd);

    const statusTd = document.createElement('td');
    statusTd.dataset.role = 'status';
    monSetChildStatus(statusTd, row.child);
    tr.appendChild(statusTd);

    const opTd = document.createElement('td');
    opTd.className = 'mon-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mon-del';
    del.textContent = '删除';
    del.dataset.monChildDelete = item.added ? 'add' : String(item.index);
    if (item.added) del.dataset.addIndex = String(item.addIndex);
    opTd.appendChild(del);
    tr.appendChild(opTd);

    tbody.appendChild(tr);
  }

  monText(
    'monChildMeta',
    `子怪 ${MON.detail.child.asParent.length - MON.child.deleted.size + MON.child.added.length}` +
    ` · 作为子怪 ${MON.detail.child.asChild.length} 次`
  );
}

function monSetChildStatus(td, child) {
  const known = monChildKnown(child);
  td.textContent = known ? '正常' : 'DB 中不存在';
  td.className = known ? '' : 'mon-warn-text';
}

function monOnChildInput(e) {
  const input = e.target.closest('input[data-role="child"]');
  if (!input) return;
  const tr = input.closest('tr');
  if (!tr) return;
  const value = input.value.trim();
  const statusTd = tr.querySelector('td[data-role="status"]');
  if (statusTd) monSetChildStatus(statusTd, value);

  const addIndex = tr.dataset.add;
  if (addIndex !== undefined) {
    const row = MON.child.added[Number(addIndex)];
    if (row) row.child = value;
    input.classList.add('dirty');
  } else {
    const index = Number(tr.dataset.index);
    const base = MON.detail.child.asParent.find((r) => r.index === index);
    if (!base) return;
    if (base.child === value) MON.child.edits.delete(index);
    else MON.child.edits.set(index, { parent: base.parent || MON.name, child: value });
    input.classList.toggle('dirty', MON.child.edits.has(index));
    tr.classList.toggle('selected', MON.child.edits.has(index));
  }
  monUpdateMeta();
}

function monOnChildDelete(e) {
  const btn = e.target.closest('button[data-mon-child-delete]');
  if (!btn) return;
  if (btn.dataset.monChildDelete === 'add') {
    MON.child.added.splice(Number(btn.dataset.addIndex), 1);
  } else {
    const index = Number(btn.dataset.monChildDelete);
    MON.child.deleted.add(index);
    MON.child.edits.delete(index);
  }
  monRenderChild();
  monUpdateMeta();
}

function monChildAdd() {
  if (!MON.detail) return;
  MON.child.added.push({ parent: MON.name, child: '' });
  monRenderChild();
  monUpdateMeta();
  const body = monEl('monChildGrid').querySelector('tbody');
  const last = body.lastElementChild;
  if (last) last.scrollIntoView({ block: 'nearest' });
}

async function monLoadDropFile(file) {
  const data = await api('/api/monster/drop?file=' + encodeURIComponent(file));
  MON.drop.file = data.file;
  MON.drop.data = data;
  MON.drop.create = false;
  MON.drop.baseSize = data.size;
  MON.drop.baseMtime = data.mtimeMs;
  MON.drop.edits.clear();
  MON.drop.added.length = 0;
  MON.drop.deleted.clear();
  return data;
}

async function monSwitchDrop(file) {
  if (file === MON.drop.file) return;
  if (monTabDirty('drop') && !confirm(`当前爆率文件有未保存修改，确定放弃并切换到 ${file}？`)) return;
  try {
    await monLoadDropFile(file);
    monRenderDrop();
    monUpdateMeta();
  } catch (e) {
    toast('加载爆率文件失败：' + e.message, 'err');
  }
}

function monStartNewDrop(file) {
  const clean = String(file == null ? '' : file).trim();
  if (!clean || !/^[^\\/:*?"<>|]+\.txt$/i.test(clean) || /[\x00-\x1f]/.test(clean)) {
    toast('文件名不合法，只能使用 <名称>.txt', 'err');
    return;
  }
  if (MON.detail) {
    const existing = MON.detail.drops.candidates.find((c) => c.file.toLowerCase() === clean.toLowerCase());
    if (existing) {
      monSwitchDrop(existing.file);
      return;
    }
  }
  if (clean === MON.drop.file && MON.drop.create) return;
  if (monTabDirty('drop') && !confirm('当前爆率修改尚未保存，确定放弃并新建文件？')) return;
  MON.drop.file = clean;
  MON.drop.data = null;
  MON.drop.create = true;
  MON.drop.baseSize = 0;
  MON.drop.baseMtime = 0;
  MON.drop.edits.clear();
  MON.drop.added.length = 0;
  MON.drop.deleted.clear();
  monRenderDrop();
  monUpdateMeta();
}

function monDropSame(a, b) {
  return String(a.n) === String(b.n) &&
    String(a.d) === String(b.d) &&
    String(a.item || '') === String(b.item || '') &&
    String(a.qty == null ? '' : a.qty) === String(b.qty == null ? '' : b.qty);
}

function monDropValues(tr) {
  const read = (role) => {
    const input = tr.querySelector(`input[data-role="${role}"]`);
    return input ? input.value : '';
  };
  const qtyRaw = read('qty').trim();
  return {
    n: read('n'),
    d: read('d'),
    item: read('item').trim(),
    qty: qtyRaw === '' ? null : qtyRaw
  };
}

function monDropMark(tr, base) {
  tr.querySelectorAll('input[data-role]').forEach((input) => {
    if (!base) {
      input.classList.add('dirty');
      return;
    }
    const role = input.dataset.role;
    let a = input.value;
    let b = base[role];
    if (role === 'item') {
      a = a.trim();
      b = b == null ? '' : String(b);
    } else if (role === 'qty') {
      a = a.trim();
      b = b == null ? '' : String(b);
    } else {
      a = String(a);
      b = String(b == null ? '' : b);
    }
    input.classList.toggle('dirty', a !== b);
  });
}

function monDropRows() {
  const out = [];
  if (MON.drop.data) {
    for (const row of MON.drop.data.rows) {
      if (MON.drop.deleted.has(row.index)) continue;
      out.push({
        added: false,
        index: row.index,
        base: row,
        row: MON.drop.edits.get(row.index) || row
      });
    }
  }
  MON.drop.added.forEach((row, k) => {
    out.push({ added: true, addIndex: k, row });
  });
  return out;
}

function monRenderDrop() {
  const bar = monEl('monDropBar');
  const table = monEl('monDropGrid');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  cfgClear(bar);
  cfgClear(thead);
  cfgClear(tbody);

  if (!MON.detail) {
    const box = monEl('monDropInvalid');
    if (box) box.textContent = '请选择怪物';
    return;
  }

  const candidates = MON.detail.drops.candidates;
  if (candidates.length) {
    const title = document.createElement('span');
    title.className = 'muted';
    title.textContent = '候选爆率：';
    bar.appendChild(title);
    const chips = document.createElement('div');
    chips.className = 'mon-chips';
    for (const cand of candidates) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mon-chip' + (cand.file === MON.drop.file ? ' active' : '');
      chip.dataset.dropFile = cand.file;
      chip.title = `${cand.file} · ${MON_TIER_LABELS[cand.tier] || cand.tier} · ${cand.rules} 条规则` +
        (cand.invalid ? ` · 异常 ${cand.invalid} 行` : '') +
        (cand.unknownItems ? ` · 未知物品 ${cand.unknownItems}` : '');
      const name = document.createElement('span');
      name.textContent = cand.file;
      chip.appendChild(name);
      const tier = document.createElement('span');
      tier.className = 'tier';
      tier.textContent = MON_TIER_LABELS[cand.tier] || cand.tier;
      chip.appendChild(tier);
      const count = document.createElement('span');
      count.textContent = cand.rules;
      chip.appendChild(count);
      if (cand.invalid || cand.unknownItems) {
        const bad = document.createElement('span');
        bad.className = 'bad';
        bad.textContent = '!';
        chip.appendChild(bad);
      }
      chips.appendChild(chip);
    }
    bar.appendChild(chips);
  } else {
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = '没有候选爆率文件';
    bar.appendChild(note);
    const field = document.createElement('span');
    field.className = 'inline-field';
    field.appendChild(document.createTextNode('新文件'));
    const input = document.createElement('input');
    input.dataset.dropNew = '1';
    input.value = MON.drop.file || monSafeDropName(MON.name);
    field.appendChild(input);
    bar.appendChild(field);
    bar.appendChild(monButton('使用此文件名', 'new-drop', 'btn small'));
  }

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  bar.appendChild(spacer);

  if (MON.drop.data) {
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `规则 ${MON.drop.data.rows.length} · 异常 ${MON.drop.data.invalid.length} · 空行 ${MON.drop.data.blanks} · 注释 ${MON.drop.data.comments}`;
    bar.appendChild(meta);
  } else if (MON.drop.create) {
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = '新文件，保存时创建';
    bar.appendChild(meta);
  }

  const add = monButton('新增规则', 'add-drop', 'btn small');
  add.disabled = MON.saving || !MON.drop.file || (!MON.drop.data && !MON.drop.create);
  bar.appendChild(add);
  const save = monButton(monTabDirty('drop') ? `保存爆率 (${monTabDirty('drop')})` : '保存爆率', 'save-drop', 'btn small primary');
  save.disabled = MON.saving || monTabDirty('drop') === 0;
  bar.appendChild(save);

  const htr = document.createElement('tr');
  for (const label of ['行', '分子', '分母', '物品', '数量', '操作']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '行') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const rows = monDropRows();
  if (!rows.length) {
    tbody.appendChild(monEmptyRow(6, MON.drop.create ? '新文件还没有规则，点击“新增规则”。' : '该爆率文件没有有效规则。'));
  }

  for (const item of rows) {
    const tr = document.createElement('tr');
    if (item.added) {
      tr.classList.add('added');
      tr.dataset.add = String(item.addIndex);
    } else {
      tr.dataset.index = String(item.index);
      tr.dataset.line = String(item.base.line);
      if (MON.drop.edits.has(item.index)) tr.classList.add('selected');
    }
    const row = item.row;

    const lineTd = document.createElement('td');
    lineTd.className = 'col-idx';
    if (item.added) {
      const tag = document.createElement('span');
      tag.className = 'new-tag';
      tag.textContent = '新';
      lineTd.appendChild(tag);
    } else {
      lineTd.textContent = String(item.base.line);
    }
    tr.appendChild(lineTd);

    const nTd = document.createElement('td');
    const nInput = document.createElement('input');
    nInput.type = 'number';
    nInput.step = '1';
    nInput.dataset.role = 'n';
    nInput.value = row.n == null ? '' : String(row.n);
    if (!item.added && String(row.n) !== String(item.base.n)) nInput.classList.add('dirty');
    nTd.appendChild(nInput);
    tr.appendChild(nTd);

    const dTd = document.createElement('td');
    const dInput = document.createElement('input');
    dInput.type = 'number';
    dInput.step = '1';
    dInput.min = '1';
    dInput.dataset.role = 'd';
    dInput.value = row.d == null ? '' : String(row.d);
    if (!item.added && String(row.d) !== String(item.base.d)) dInput.classList.add('dirty');
    dTd.appendChild(dInput);
    tr.appendChild(dTd);

    const itemTd = document.createElement('td');
    const itemInput = cfgText(row.item, 'itemList', 64);
    itemInput.dataset.role = 'item';
    if (!item.added && row.item !== item.base.item) itemInput.classList.add('dirty');
    itemTd.appendChild(itemInput);
    tr.appendChild(itemTd);

    const qtyTd = document.createElement('td');
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.step = '1';
    qtyInput.min = '1';
    qtyInput.placeholder = '无';
    qtyInput.dataset.role = 'qty';
    qtyInput.value = row.qty == null ? '' : String(row.qty);
    if (!item.added && String(row.qty == null ? '' : row.qty) !== String(item.base.qty == null ? '' : item.base.qty)) {
      qtyInput.classList.add('dirty');
    }
    qtyTd.appendChild(qtyInput);
    tr.appendChild(qtyTd);

    const opTd = document.createElement('td');
    opTd.className = 'mon-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mon-del';
    del.textContent = '删除';
    del.dataset.monDropDelete = item.added ? 'add' : String(item.index);
    if (item.added) del.dataset.addIndex = String(item.addIndex);
    opTd.appendChild(del);
    tr.appendChild(opTd);

    tbody.appendChild(tr);
  }

  monRenderDropInvalid();
}

function monRenderDropInvalid() {
  const box = monEl('monDropInvalid');
  cfgClear(box);
  if (!MON.drop.file) {
    box.textContent = '';
    return;
  }
  if (!MON.drop.data) {
    if (MON.drop.create) {
      box.textContent = `新文件：${MON.drop.file}\n保存后会创建该文件；新规则按“概率 物品 [数量]”写入。`;
    } else {
      box.textContent = '爆率文件尚未加载，请点击“重新加载”后再编辑。';
    }
    return;
  }

  const data = MON.drop.data;
  const lines = [];
  if (data.invalid.length) {
    lines.push(`异常行 ${data.invalid.length} 条（未参与结构化编辑，保存时原样保留）：`);
    for (const inv of data.invalid.slice(0, 100)) {
      lines.push(`  第 ${inv.line} 行：${inv.reason}\n    ${inv.text}`);
    }
    if (data.invalid.length > 100) lines.push(`  ...还有 ${data.invalid.length - 100} 行未显示`);
  } else {
    lines.push('没有格式异常的行。');
  }
  if (data.unknownItems.length) {
    lines.push('stditems.db 中不存在的物品：');
    for (const item of data.unknownItems.slice(0, 100)) {
      lines.push(`  ${item.item} × ${item.count}`);
    }
  }
  if (data.currencyCount) lines.push(`金币规则 ${data.currencyCount} 条（金币不作为普通物品校验）。`);
  box.textContent = lines.join('\n');
}

function monOnDropInput(e) {
  const input = e.target.closest('input[data-role]');
  if (!input) return;
  const tr = input.closest('tr');
  if (!tr) return;
  const values = monDropValues(tr);
  const addIndex = tr.dataset.add;
  if (addIndex !== undefined) {
    MON.drop.added[Number(addIndex)] = values;
    monDropMark(tr, null);
  } else {
    const index = Number(tr.dataset.index);
    const base = MON.drop.data && MON.drop.data.rows.find((r) => r.index === index);
    if (!base) return;
    if (monDropSame(values, base)) MON.drop.edits.delete(index);
    else MON.drop.edits.set(index, values);
    monDropMark(tr, base);
    tr.classList.toggle('selected', MON.drop.edits.has(index));
  }
  monUpdateMeta();
}

function monOnDropDelete(e) {
  const btn = e.target.closest('button[data-mon-drop-delete]');
  if (!btn) return;
  if (btn.dataset.monDropDelete === 'add') {
    MON.drop.added.splice(Number(btn.dataset.addIndex), 1);
  } else {
    const index = Number(btn.dataset.monDropDelete);
    MON.drop.deleted.add(index);
    MON.drop.edits.delete(index);
  }
  monRenderDrop();
  monUpdateMeta();
}

function monDropAdd() {
  if (!MON.drop.file) return;
  if (!MON.drop.data && !MON.drop.create) {
    toast('爆率文件尚未加载，请先重新加载', 'err');
    return;
  }
  MON.drop.added.push({ n: 1, d: 100, item: '', qty: null });
  monRenderDrop();
  monUpdateMeta();
  const body = monEl('monDropGrid').querySelector('tbody');
  const last = body.lastElementChild;
  if (last) last.scrollIntoView({ block: 'nearest' });
}

async function monOnDropBarClick(e) {
  const chip = e.target.closest('[data-drop-file]');
  if (chip) {
    await monSwitchDrop(chip.dataset.dropFile);
    return;
  }
  const btn = e.target.closest('[data-mon-action]');
  if (!btn) return;
  if (btn.dataset.monAction === 'add-drop') {
    monDropAdd();
  } else if (btn.dataset.monAction === 'save-drop') {
    await monSaveDrop();
  } else if (btn.dataset.monAction === 'new-drop') {
    const input = monEl('monDropBar').querySelector('[data-drop-new]');
    monStartNewDrop(input ? input.value : '');
  }
}

function monIssueLabel(code) {
  return MON_ISSUE_LABELS[code] || code;
}

function monHealthRow(text, actions) {
  const row = document.createElement('div');
  row.className = 'mon-issue';
  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.textContent = text;
  row.appendChild(msg);
  for (const action of actions || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small ghost';
    btn.textContent = action.text;
    if (action.openMonster) btn.dataset.openMonster = action.openMonster;
    if (action.openTab) btn.dataset.openTab = action.openTab;
    if (action.jump) monSetJump(btn, action.jump);
    row.appendChild(btn);
  }
  return row;
}

function monSetJump(btn, jump) {
  if (!jump) return;
  if (jump.tab) btn.dataset.jumpTab = jump.tab;
  if (jump.file) btn.dataset.jumpFile = jump.file;
  if (jump.index != null) btn.dataset.jumpIndex = String(jump.index);
  if (jump.line != null) btn.dataset.jumpLine = String(jump.line);
}

function monHealthGroup(title, count) {
  const group = document.createElement('div');
  group.className = 'mon-issue-group';
  const head = document.createElement('div');
  head.className = 'mon-issue-head';
  const strong = document.createElement('strong');
  strong.textContent = title;
  head.appendChild(strong);
  if (count != null) {
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = String(count);
    head.appendChild(badge);
  }
  group.appendChild(head);
  return group;
}

function monAddGlobalGroup(container, title, items, build) {
  if (!items || !items.length) return false;
  const group = monHealthGroup(title, items.length);
  const shown = items.slice(0, 200);
  for (const item of shown) group.appendChild(build(item));
  if (items.length > shown.length) {
    const more = document.createElement('div');
    more.className = 'mon-issue';
    more.textContent = `还有 ${items.length - shown.length} 条未显示`;
    group.appendChild(more);
  }
  container.appendChild(group);
  return true;
}

function monRenderHealth() {
  const list = monEl('monHealthList');
  cfgClear(list);
  if (!MON.detail && !MON.list) {
    list.appendChild(monHealthGroup('提示', null));
    const empty = document.createElement('div');
    empty.className = 'mon-empty';
    empty.textContent = '请选择怪物或加载怪物索引。';
    list.appendChild(empty);
    return;
  }

  let anyPer = false;
  if (MON.detail && MON.detail.issues.length) {
    for (const sev of ['error', 'warn', 'info']) {
      const issues = MON.detail.issues.filter((i) => i.severity === sev);
      if (!issues.length) continue;
      anyPer = true;
      const group = monHealthGroup(`当前怪物 · ${MON_SEV_LABELS[sev]}`, issues.length);
      for (const issue of issues) {
        const row = document.createElement('div');
        row.className = 'mon-issue';
        const sevEl = document.createElement('span');
        sevEl.className = 'mon-sev ' + sev;
        sevEl.textContent = MON_SEV_LABELS[sev];
        row.appendChild(sevEl);
        const msg = document.createElement('div');
        msg.className = 'msg';
        msg.textContent = `${monIssueLabel(issue.code)}：${issue.message}`;
        msg.title = issue.code;
        row.appendChild(msg);
        if (issue.jump && issue.jump.tab !== 'health') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn small ghost';
          btn.textContent = '查看';
          monSetJump(btn, issue.jump);
          row.appendChild(btn);
        }
        group.appendChild(row);
      }
      list.appendChild(group);
    }
  }
  if (MON.detail && !anyPer) {
    const group = monHealthGroup('当前怪物', null);
    const empty = document.createElement('div');
    empty.className = 'mon-empty';
    empty.textContent = '当前怪物没有发现问题。';
    group.appendChild(empty);
    list.appendChild(group);
  }

  if (!MON.list) return;
  const g = MON.list.globals;
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = '全局检查';
  list.appendChild(title);

  let anyGlobal = false;
  anyGlobal = monAddGlobalGroup(list, 'Monster.DB 同名记录', g.duplicateDbNames, (item) =>
    monHealthRow(`${item.name} · ${item.indexes.length} 条（#${item.indexes.map((i) => i + 1).join(', #')}）`, [
      { text: '查看', openMonster: item.name }
    ])
  ) || anyGlobal;

  anyGlobal = monAddGlobalGroup(list, '刷怪引用了不存在的怪物', g.spawnMissingDb, (name) =>
    monHealthRow(name, [{ text: '查看', openMonster: name }])
  ) || anyGlobal;

  anyGlobal = monAddGlobalGroup(list, '召唤关系引用缺失', g.unknownChild, (item) =>
    monHealthRow(`${item.parent} → ${item.child}（第 ${item.line + 1} 行）`, [
      { text: '父怪', openMonster: item.parent },
      { text: '子怪', openMonster: item.child }
    ])
  ) || anyGlobal;

  anyGlobal = monAddGlobalGroup(list, '无主爆率文件', g.orphanDropFiles, (item) => {
    const stem = item.file.replace(/\.txt$/i, '');
    return monHealthRow(`${item.file} · ${item.size} 字节`, [
      { text: '查看', openMonster: stem, openTab: 'drop' }
    ]);
  }) || anyGlobal;

  anyGlobal = monAddGlobalGroup(list, '爆率格式异常行', g.dropInvalid, (item) => {
    const stem = item.file.replace(/\.txt$/i, '');
    return monHealthRow(`${item.file} 第 ${item.line} 行：${item.reason || item.text}`, [
      { text: '查看', openMonster: stem, openTab: 'drop' }
    ]);
  }) || anyGlobal;

  anyGlobal = monAddGlobalGroup(list, '大写扩展名 .TXT', g.uppercaseFiles, (file) => {
    const stem = file.replace(/\.txt$/i, '');
    return monHealthRow(file, [{ text: '查看', openMonster: stem, openTab: 'drop' }]);
  }) || anyGlobal;

  anyGlobal = monAddGlobalGroup(list, '空爆率文件', g.zeroByteFiles, (file) => {
    const stem = file.replace(/\.txt$/i, '');
    return monHealthRow(`${file} · 0 字节`, [{ text: '查看', openMonster: stem, openTab: 'drop' }]);
  }) || anyGlobal;

  if (!anyGlobal) {
    const group = monHealthGroup('全局检查', null);
    const empty = document.createElement('div');
    empty.className = 'mon-empty';
    empty.textContent = '全局没有发现需要提示的问题。';
    group.appendChild(empty);
    list.appendChild(group);
  }
}

async function monJump(jump) {
  if (!jump || !jump.tab || jump.tab === 'health') return;
  switchMonTab(jump.tab);
  if (jump.tab === 'drop' && jump.file && (!MON.drop.data || MON.drop.file !== jump.file)) {
    if (monTabDirty('drop') && !confirm('当前爆率文件有未保存修改，确定放弃并跳转？')) return;
    try {
      await monLoadDropFile(jump.file);
      monRenderDrop();
      monUpdateMeta();
    } catch (e) {
      toast('加载爆率文件失败：' + e.message, 'err');
      return;
    }
  }
  if (jump.tab === 'spawn' && jump.index != null) {
    monHighlightRow('monSpawnGrid', `data-index="${Number(jump.index)}"`);
  } else if (jump.tab === 'drop' && jump.line != null) {
    monHighlightRow('monDropGrid', `data-line="${Number(jump.line)}"`);
  } else if (jump.tab === 'child' && jump.index != null) {
    monHighlightRow('monChildGrid', `data-index="${Number(jump.index)}"`);
  }
}

function monHighlightRow(tableId, selector) {
  const tr = monEl(tableId).querySelector(`tbody tr[${selector}]`);
  if (!tr) return;
  tr.scrollIntoView({ block: 'center' });
  tr.classList.add('selected');
  setTimeout(() => tr.classList.remove('selected'), 2200);
}

async function monOpenMonsterRow(name, tab) {
  if (!name) return;
  const found = MON.list && MON.list.monsters.some((m) => m.name === name);
  if (!found) {
    toast('怪物列表中没有该名字：' + name, 'err');
    return;
  }
  if (MON.name === name && MON.detail) {
    monShowShell();
    monSetHash(name);
    if (tab) switchMonTab(tab);
    return;
  }
  await openMonsterWorkbench(name);
  if (tab) switchMonTab(tab);
}

async function monOnHealthClick(e) {
  const open = e.target.closest('button[data-open-monster]');
  if (open) {
    await monOpenMonsterRow(open.dataset.openMonster, open.dataset.openTab || '');
    return;
  }
  const jump = e.target.closest('button[data-jump-tab]');
  if (!jump) return;
  const target = { tab: jump.dataset.jumpTab };
  if (jump.dataset.jumpFile) target.file = jump.dataset.jumpFile;
  if (jump.dataset.jumpIndex != null) target.index = Number(jump.dataset.jumpIndex);
  if (jump.dataset.jumpLine != null) target.line = Number(jump.dataset.jumpLine);
  await monJump(target);
}

async function monWithSaving(fn) {
  if (MON.saving) return;
  MON.saving = true;
  monUpdateMeta();
  try {
    await fn();
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
  } finally {
    MON.saving = false;
    monUpdateMeta();
  }
}

async function monAfterSave(nextName, tab) {
  if (tab) MON.tab = tab;
  try {
    await refreshState();
  } catch (e) {
  }
  MON.list = null;
  try {
    await monLoadList(true);
  } catch (e) {
    toast('重新加载怪物列表失败：' + e.message, 'err');
  }
  await monSelect(nextName || MON.name);
}

async function monSaveAttr() {
  const edits = MON.attr.edits;
  if (!edits.size || MON.attr.rowIndex < 0) return;

  for (const [key, value] of edits) {
    const sep = key.indexOf('\u0000');
    const field = key.slice(sep + 1);
    if (field === 'Name' && !String(value).trim()) {
      toast('怪物名称不能为空', 'err');
      return;
    }
  }

  let nextName = MON.name;
  const selectedName = edits.get(monAttrKey(MON.attr.rowIndex, 'Name'));
  if (selectedName !== undefined && String(selectedName).trim()) {
    nextName = String(selectedName).trim();
  }

  const byRow = new Map();
  for (const [key, value] of edits) {
    const sep = key.indexOf('\u0000');
    const index = Number(key.slice(0, sep));
    const field = key.slice(sep + 1);
    if (!byRow.has(index)) byRow.set(index, { index, values: {} });
    byRow.get(index).values[field] = value;
  }
  const changes = [...byRow.values()];

  await monWithSaving(async () => {
    const res = await api('/api/db/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'Monster.DB', changes, added: [] })
    });
    let msg = `保存成功：修改 ${res.changedRows} 条 Monster.DB 记录。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await monAfterSave(nextName, 'attr');
  });
}

async function monSaveSpawn() {
  if (!MON.detail || monTabDirty('spawn') === 0) return;
  const payload = {
    changes: [...MON.spawn.edits.entries()].map(([index, values]) => ({ index, values })),
    added: MON.spawn.added,
    deleted: [...MON.spawn.deleted]
  };
  await monWithSaving(async () => {
    const res = await api('/api/config/mongen/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let msg = `保存成功：刷怪修改 ${res.changedRows} / 新增 ${res.addedRows} / 删除 ${res.deletedRows}。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await monAfterSave(MON.name, 'spawn');
  });
}

async function monSaveDrop() {
  if (!MON.drop.file || monTabDirty('drop') === 0) return;
  const payload = {
    file: MON.drop.file,
    create: MON.drop.create,
    changes: [...MON.drop.edits.entries()].map(([index, values]) => ({ index, values })),
    added: MON.drop.added,
    deleted: [...MON.drop.deleted]
  };
  if (!MON.drop.create) {
    payload.baseSize = MON.drop.baseSize;
    payload.baseMtime = MON.drop.baseMtime;
  }
  await monWithSaving(async () => {
    const res = await api('/api/monster/drop/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.conflict) {
      toast('保存失败：' + (res.error || '文件已被修改，请重新加载'), 'err');
      return;
    }
    if (res.ok === false) throw new Error(res.error || '保存失败');
    let msg = `保存成功：${res.file}，修改 ${res.changedRows} / 新增 ${res.addedRows} / 删除 ${res.deletedRows}。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await monAfterSave(MON.name, 'drop');
  });
}

async function monSaveChild() {
  if (!MON.detail || monTabDirty('child') === 0) return;
  const payload = {
    chain: {},
    child: {
      changes: [...MON.child.edits.entries()].map(([index, values]) => ({ index, values })),
      added: MON.child.added,
      deleted: [...MON.child.deleted]
    }
  };
  await monWithSaving(async () => {
    const res = await api('/api/config/summons/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const c = res.child || {};
    let msg = `保存成功：子怪修改 ${c.changedRows || 0} / 新增 ${c.addedRows || 0} / 删除 ${c.deletedRows || 0}。`;
    if (c.backup) msg += '\n备份：' + c.backup;
    toast(msg, 'ok');
    await monAfterSave(MON.name, 'child');
  });
}

function monSaveCurrent() {
  if (!MON.detail || MON.saving) return;
  if (MON.tab === 'attr') monSaveAttr();
  else if (MON.tab === 'spawn') monSaveSpawn();
  else if (MON.tab === 'drop') monSaveDrop();
  else if (MON.tab === 'child') monSaveChild();
}

async function monReload() {
  if (!window.monsterConfirmDiscard()) return;
  MON.list = null;
  try {
    await monLoadList(true);
  } catch (e) {
    toast('加载怪物索引失败：' + e.message, 'err');
    return;
  }
  if (MON.name) await monSelect(MON.name);
  else await openMonsterWorkbench(undefined, true);
}

function monDiscardEdits() {
  MON.attr.edits.clear();
  MON.spawn.edits.clear();
  MON.spawn.added.length = 0;
  MON.spawn.deleted.clear();
  MON.drop.edits.clear();
  MON.drop.added.length = 0;
  MON.drop.deleted.clear();
  MON.child.edits.clear();
  MON.child.added.length = 0;
  MON.child.deleted.clear();
  if (MON.detail) monRenderAll();
  else monUpdateMeta();
}

function monInitEvents() {
  monEl('monFilter').addEventListener('input', () => {
    clearTimeout(monFilterTimer);
    monFilterTimer = setTimeout(() => {
      MON.filter = monEl('monFilter').value;
      monRenderList();
    }, 120);
  });

  monEl('monFlagFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mon-flag]');
    if (!btn) return;
    MON.flag = btn.dataset.monFlag;
    monRenderList();
  });

  monEl('monList').addEventListener('click', (e) => {
    const li = e.target.closest('.mon-item');
    if (!li || !li.dataset.name || li.dataset.name === MON.name) return;
    openMonsterWorkbench(li.dataset.name);
  });

  document.querySelectorAll('#monTabs [data-mon-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchMonTab(btn.dataset.monTab));
  });

  monEl('btnMonReload').addEventListener('click', monReload);
  monEl('btnMonSave').addEventListener('click', monSaveCurrent);
  monEl('btnMonSpawnAdd').addEventListener('click', monSpawnAdd);
  monEl('btnMonSpawnSave').addEventListener('click', monSaveSpawn);
  monEl('btnMonChildAdd').addEventListener('click', monChildAdd);
  monEl('btnMonChildSave').addEventListener('click', monSaveChild);

  monEl('monSpawnGrid').addEventListener('input', monOnSpawnInput);
  monEl('monSpawnGrid').addEventListener('click', monOnSpawnDelete);
  monEl('monDropGrid').addEventListener('input', monOnDropInput);
  monEl('monDropGrid').addEventListener('click', monOnDropDelete);
  monEl('monChildGrid').addEventListener('input', monOnChildInput);
  monEl('monChildGrid').addEventListener('click', monOnChildDelete);
  monEl('monChildParents').addEventListener('click', (e) => {
    const link = e.target.closest('[data-mon-open]');
    if (link) monOpenMonsterRow(link.dataset.monOpen);
  });
  monEl('monDropBar').addEventListener('click', monOnDropBarClick);
  monEl('monHealthList').addEventListener('click', monOnHealthClick);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.mode === 'monster') {
      e.preventDefault();
      monSaveCurrent();
    }
  });

  window.addEventListener('hashchange', () => {
    const name = monHashName();
    if (name) openMonsterWorkbench(name);
  });
}

window.openMonsterWorkbench = openMonsterWorkbench;
window.hideMonsterView = () => {
  monEl('monsterView').classList.add('hidden');
  if (monHashName()) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.monsterAnyDirty = () => monTotalDirty() > 0;
window.monsterConfirmDiscard = () => {
  const n = monTotalDirty();
  if (!n) return true;
  if (!confirm(`怪物工作台有 ${n} 处未保存修改，确定放弃并继续？`)) return false;
  monDiscardEdits();
  return true;
};
window.updateMonsterMeta = monUpdateMeta;

monInitEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const name = monHashName();
    if (name) openMonsterWorkbench(name);
    else monLoadList().catch(() => {});
  });
} else {
  window.addEventListener('app-ready', () => {
    const name = monHashName();
    if (name) openMonsterWorkbench(name);
    else monLoadList().catch(() => {});
  });
}

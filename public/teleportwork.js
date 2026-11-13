'use strict';

/* NPC 传送点工作台：可视化编辑 ComTrans1.py 的 NPCMAP 目的地 */

const TPW = {
  data: null,
  detail: null,
  key: '',
  filter: '',
  mode: 'all',
  editing: null,
  npcQuery: '',
  addMode: 'npc',
  autoKey: true,
  loading: false,
  stale: true
};

function tpwEl(id) {
  return document.getElementById(id);
}

function tpwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tpwText(id, text) {
  const el = tpwEl(id);
  if (el) el.textContent = text;
}

function tpwTag(text, cls) {
  return '<span class="npw-tag' + (cls ? ' ' + cls : '') + '">' + tpwEsc(text) + '</span>';
}

function tpwHashKey() {
  const m = /^#teleport(?:=(.*))?$/.exec(location.hash || '');
  return m && m[1] ? decodeURIComponent(m[1]) : '';
}

function tpwSetHash(key) {
  try {
    const base = location.pathname + location.search;
    history.replaceState(null, '', base + (key ? '#teleport=' + encodeURIComponent(key) : ''));
  } catch (e) {
  }
}

function tpwNpcName(entry) {
  const npc = entry && entry.npcs && entry.npcs[0];
  return npc ? npc.name : '未找到 NPC';
}

function tpwMapLabel(map, mapName) {
  return mapName ? map + ' · ' + mapName : map;
}

function tpwKnownMapName(map) {
  const rows = (TPW.data && TPW.data.mapOptions) || [];
  const row = rows.find((one) => one.code === map);
  return row && row.name ? row.name : '';
}

function tpwNewKey(map) {
  const base = 'ComTrans1_' + (String(map || '').replace(/[^A-Za-z0-9_]/g, '_') || 'NEW');
  const used = new Set();
  ((TPW.data && TPW.data.entries) || []).forEach((row) => used.add(row.key));
  ((TPW.data && TPW.data.npcCandidates) || []).forEach((row) => used.add(row.id));
  ((TPW.data && TPW.data.npcOptions) || []).forEach((row) => used.add(row.id));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(base + '_' + n)) n++;
  return base + '_' + n;
}

function tpwNpcPlacement(entry) {
  const npc = entry && entry.npcs && entry.npcs[0];
  return npc ? tpwMapLabel(npc.map, npc.mapName) + ' (' + npc.x + ',' + npc.y + ')' : '—';
}

function tpwDest(entry) {
  return entry ? tpwMapLabel(entry.map, entry.mapName) + ' (' + entry.x + ',' + entry.y + ')' : '—';
}

function tpwFillDatalists() {
  const maps = tpwEl('tpwMapList');
  if (!maps) return;
  const options = (TPW.data && TPW.data.mapOptions) || [];
  maps.innerHTML = options.map((row) =>
    '<option value="' + tpwEsc(row.code) + '" label="' +
    tpwEsc(tpwMapLabel(row.code, row.name)) + '"></option>'
  ).join('');
}

async function tpwLoad(force) {
  TPW.loading = true;
  try {
    const data = await api('/api/config/teleport' + (force ? '?refresh=1' : ''));
    TPW.data = data;
    TPW.stale = false;
    tpwFillDatalists();
    tpwRenderModes();
    tpwRenderList();
  } finally {
    TPW.loading = false;
  }
}

async function tpwLoadDetail(key, force) {
  if (!key) {
    TPW.detail = null;
    TPW.key = '';
    tpwRenderDetail();
    return;
  }
  tpwRenderDetail(null, '加载中...');
  try {
    TPW.detail = await api('/api/config/teleport/detail?key=' + encodeURIComponent(key) +
      (force ? '&refresh=1' : ''));
    TPW.key = key;
    TPW.editing = null;
    tpwRenderDetail();
    tpwRenderList();
  } catch (e) {
    if (e.status === 404) {
      TPW.detail = null;
      TPW.key = '';
      tpwRenderDetail('该传送点已不存在，可能已被删除。');
      return;
    }
    throw e;
  }
}

function tpwSelect(key) {
  if (!key) return;
  if (key === TPW.key && TPW.detail) {
    TPW.editing = null;
    tpwRenderDetail();
    return;
  }
  tpwSetHash(key);
  tpwLoadDetail(key).catch((e) => toast('加载传送点失败：' + e.message, 'err'));
}

function tpwRenderModes() {
  const box = tpwEl('tpwModeFilter');
  if (!box) return;
  const d = TPW.data;
  if (!d) {
    box.innerHTML = '';
    return;
  }
  const entries = d.entries || [];
  const modes = [
    ['all', '全部', entries.length],
    ['warn', '有告警', entries.filter((entry) => (entry.warnings || []).length).length],
    ['dup', '同目的地', entries.filter((entry) => entry.peerCount > 1).length],
    ['unconfigured', '未配置', (d.unconfigured || []).length]
  ];
  box.innerHTML = modes.map(([key, label, count]) =>
    '<button class="btn small' + (TPW.mode === key ? ' active' : '') + '" data-tpw-mode="' + key + '">' +
    tpwEsc(label) + ' ' + count + '</button>'
  ).join('');
}

function tpwRenderList() {
  const box = tpwEl('tpwList');
  if (!box) return;
  const d = TPW.data;
  if (!d) {
    box.innerHTML = '';
    tpwText('tpwListHint', '尚未加载');
    return;
  }
  const q = TPW.filter.trim().toLowerCase();
  const match = (text) => !q || String(text).toLowerCase().includes(q);

  if (TPW.mode === 'unconfigured') {
    const rows = (d.unconfigured || []).filter((row) =>
      match([row.id, row.name, row.map, row.mapName].join(' '))
    );
    box.innerHTML = rows.length
      ? rows.map((row) =>
        '<li class="file-item" data-tpw-new="' + tpwEsc(row.id) + '">' +
        '<div class="fname">' + tpwEsc(row.name) + tpwTag('未配置', 'warn') + '</div>' +
        '<div class="fmeta">' + tpwEsc(row.id) + ' · ' +
        tpwEsc(tpwMapLabel(row.map, row.mapName) + ' (' + row.x + ',' + row.y + ')') + '</div>' +
        '<div class="fmeta">NPCList 已引用 ComTrans1，但没有目的地</div></li>'
      ).join('')
      : '<li class="file-item"><div class="fmeta">没有未配置的传送 NPC</div></li>';
    tpwText('tpwListHint', rows.length + ' / ' + (d.unconfigured || []).length + ' 个未配置');
    return;
  }

  let entries = (d.entries || []).filter((entry) => {
    if (TPW.mode === 'warn' && !(entry.warnings || []).length) return false;
    if (TPW.mode === 'dup' && entry.peerCount <= 1) return false;
    return match([
      entry.key, entry.map, entry.mapName, entry.x, entry.y,
      entry.npcs.map((npc) => npc.name + ' ' + npc.map + ' ' + npc.mapName + ' ' + npc.x + ' ' + npc.y).join(' '),
      entry.peers.join(' ')
    ].join(' '));
  });

  if (!entries.length) {
    box.innerHTML = '<li class="file-item"><div class="fmeta">没有匹配的传送点</div></li>';
  } else {
    box.innerHTML = entries.map((entry) => {
      const active = TPW.key === entry.key ? ' active' : '';
      const warn = (entry.warnings || []).length ? tpwTag((entry.warnings || []).length, 'warn') : '';
      const peer = entry.peerCount > 1 ? tpwTag('共用 ' + entry.peerCount, 'task') : '';
      return '<li class="file-item' + active + '" data-tpw-key="' + tpwEsc(entry.key) + '">' +
        '<div class="fname">' + tpwEsc(tpwNpcName(entry)) + warn + peer + '</div>' +
        '<div class="fmeta">' + tpwEsc(entry.key) + ' · ' + tpwEsc(tpwNpcPlacement(entry)) + '</div>' +
        '<div class="fmeta">→ <span class="tpw-dest">' + tpwEsc(tpwDest(entry)) + '</span></div></li>';
    }).join('');
  }
  tpwText('tpwListHint', entries.length + ' / ' + (d.entries || []).length + ' 条' +
    (q || TPW.mode !== 'all' ? '（已过滤）' : ''));
}

function tpwBanners(d) {
  const out = [];
  if (d && d.writable === false) {
    out.push('<div class="nbw-banner bad">文件结构异常，只能查看，不能保存。</div>');
  }
  for (const warning of (d && d.fileWarnings) || []) {
    out.push('<div class="nbw-banner warn">' + tpwEsc(warning) + '</div>');
  }
  for (const warning of ((d && d.entry && d.entry.warnings) || [])) {
    out.push('<div class="nbw-banner warn">' + tpwEsc(warning) + '</div>');
  }
  return out.join('');
}

function tpwIntroHtml() {
  const d = TPW.data;
  const s = d && d.stats;
  const summary = s
    ? s.entries + ' 条传送点 · ' + s.npcRefs + ' 个 NPC · ' + s.destinations +
      ' 个目的地 · ' + s.duplicateGroups + ' 组同目的地'
    : '';
  return '<div class="nbw-intro">' +
    '<div class="npw-intro-title">NPC 传送点</div>' +
    '<p>左侧选择传送点后，可查看 NPC 放置位置、目的地，并修改目的地地图与坐标。</p>' +
    '<p>数据来自 <code>NPCScript/ComTrans1.py</code> 的 <code>NPCMAP</code>。脚本固定要求距离 ≤ 4，持有宝盒类物品时拒绝传送；这些规则本次不改。</p>' +
    '<p>' + tpwEsc(summary) + '。只写 ComTrans1.py，GBK/CRLF 保持原样，每次写入前自动备份。</p></div>';
}

function tpwPeerHtml(entry) {
  if (!entry.peers || !entry.peers.length) return '';
  const rows = entry.peers.map((peer) => {
    const names = (peer.npcs || []).map((npc) => npc.name).join('、') || '未找到 NPC';
    return '<li>' + tpwEsc(peer.key) + ' · ' + tpwEsc(names) + ' · ' +
      tpwEsc(tpwMapLabel(peer.map, peer.mapName)) + '</li>';
  }).join('');
  return '<div class="nbw-section"><div class="nbw-section-head"><h4>同目的地 NPC</h4>' +
    '<span class="muted">' + entry.peers.length + ' 个</span></div>' +
    '<ul class="iuw-peer-list">' + rows + '</ul></div>';
}

function tpwRawHtml(entry) {
  const raw = entry.raw || {};
  const lines = [raw.key, raw.map, raw.x, raw.y].filter((line) => line != null);
  return '<div class="nbw-section"><div class="nbw-section-head"><h4>原始代码（只读）</h4>' +
    '<span class="muted">第 ' + entry.keyLine + '–' + (entry.keyLine + 3) + ' 行</span></div>' +
    '<pre class="tpw-raw">' + tpwEsc(lines.join('\n')) + '</pre></div>';
}

function tpwDetailCard(d) {
  const entry = d.entry;
  const tags = [tpwTag('第 ' + entry.keyLine + '–' + (entry.keyLine + 3) + ' 行', 'task')];
  if (entry.closesDict) tags.push(tpwTag('NPCMAP 末条', 'task'));
  if (entry.peerCount > 1) tags.push(tpwTag('同目的地 ' + entry.peerCount + ' 个', 'task'));
  const buttons = d.writable
    ? '<button class="btn small" data-tpw-act="edit">编辑</button> ' +
      '<button class="btn small ghost" data-tpw-act="delete">删除</button>'
    : '';
  return '<div class="nbw-section">' +
    '<div class="nbw-section-head"><h4>' + tpwEsc(tpwNpcName(entry)) + ' · ' + tpwEsc(entry.key) + '</h4>' +
    tags.join(' ') + '<span class="spacer"></span>' + buttons + '</div>' +
    '<div class="nbw-note">NPC 放置：' + tpwEsc(tpwNpcPlacement(entry)) +
    ' · 目的地：<span class="tpw-dest">' + tpwEsc(tpwDest(entry)) + '</span></div>' +
    '<div class="nbw-table-wrap"><table><thead><tr><th>项目</th><th>值</th><th>行</th></tr></thead><tbody>' +
    '<tr><td class="namecell">NPC ID</td><td class="str">' + tpwEsc(entry.key) + '</td>' +
    '<td class="num">' + entry.keyLine + '</td></tr>' +
    '<tr><td class="namecell">NPC 放置</td><td class="str">' + tpwEsc(tpwNpcPlacement(entry)) + '</td>' +
    '<td class="num">' + ((entry.npcs[0] && entry.npcs[0].line) || '') + '</td></tr>' +
    '<tr><td class="namecell">目的地</td><td class="str tpw-dest">' + tpwEsc(tpwDest(entry)) + '</td>' +
    '<td class="num">' + (entry.keyLine + 1) + '–' + (entry.keyLine + 3) + '</td></tr>' +
    '<tr><td class="namecell">字典收尾</td><td class="str">' + (entry.closesDict ? '} }（最后一条）' : '},（中间条目）') + '</td>' +
    '<td class="num">' + (entry.keyLine + 3) + '</td></tr>' +
    '</tbody></table></div></div>' +
    tpwPeerHtml(entry) + tpwRawHtml(entry);
}

function tpwEditNpcOptions() {
  const rows = (TPW.data && TPW.data.npcOptions) || [];
  const current = TPW.editing ? TPW.editing.key : '';
  return rows.filter((row) => row.id === current || !row.configured);
}

function tpwEditNpcHtml() {
  const editing = TPW.editing;
  const rows = tpwEditNpcOptions();
  const hasCurrent = rows.some((row) => row.id === editing.key);
  let options = '';
  if (editing.key && !hasCurrent) {
    options += '<option value="' + tpwEsc(editing.key) + '" selected>' +
      tpwEsc(editing.key + '（NPCList 中未找到）') + '</option>';
  }
  options += rows.map((row) => {
    const current = row.id === editing.key;
    const label = row.name + ' · ' + row.id + ' · ' + row.map + ' (' + row.x + ',' + row.y + ')' +
      (current ? '（当前）' : '');
    return '<option value="' + tpwEsc(row.id) + '"' + (current ? ' selected' : '') + '>' +
      tpwEsc(label) + '</option>';
  }).join('');
  return '<div class="field"><label>NPC</label><select id="tpwKey">' + options + '</select></div>';
}

function tpwNpcCandidates() {
  return (TPW.data && TPW.data.npcCandidates) || [];
}

function tpwFilteredNpcs() {
  const q = String(TPW.npcQuery || '').trim().toLowerCase();
  const rows = tpwNpcCandidates();
  if (!q) return rows;
  return rows.filter((row) =>
    [row.name, row.id, row.map, row.mapName, row.script].join(' ').toLowerCase().includes(q)
  );
}

function tpwNpcHintText() {
  const sel = tpwEl('tpwKey');
  const id = sel ? sel.value : '';
  if (!id) {
    return '共 ' + tpwNpcCandidates().length + ' 个尚未配置传送的 NPC；可输入名称、ID、地图或脚本筛选。';
  }
  const row = tpwNpcCandidates().find((one) => one.id === id);
  if (!row) return '';
  if (row.script === 'ComTrans1') return '该 NPC 的脚本是 ComTrans1，保存后立即生效。';
  return '该 NPC 的脚本是 ' + row.script + '，保存后不会传送；需要先在 NPC 工作台把脚本改为 ComTrans1。';
}

function tpwUpdateNpcHint() {
  const hint = tpwEl('tpwNpcHint');
  if (hint) hint.textContent = tpwNpcHintText();
}

function tpwRenderNpcOptions() {
  const sel = tpwEl('tpwKey');
  if (!sel || !TPW.editing || TPW.editing.mode !== 'add') return;
  const keep = TPW.editing.key || '';
  const rows = tpwFilteredNpcs();
  const shown = rows.slice(0, 300);
  if (keep && !shown.some((row) => row.id === keep)) {
    const current = tpwNpcCandidates().find((row) => row.id === keep);
    if (current) shown.unshift(current);
  }
  let html = '<option value="">请选择 NPC</option>';
  html += shown.map((row) => {
    const label = row.name + ' · ' + row.id + ' · ' + row.map + ' (' + row.x + ',' + row.y + ') · ' +
      (row.script || '（空脚本）');
    return '<option value="' + tpwEsc(row.id) + '"' + (row.id === keep ? ' selected' : '') + '>' +
      tpwEsc(label) + '</option>';
  }).join('');
  sel.innerHTML = html;
  const hint = tpwEl('tpwNpcHint');
  if (hint) {
    const extra = rows.length > shown.length
      ? '（仅显示前 ' + shown.length + ' 条，请继续输入筛选）'
      : '';
    hint.textContent = tpwNpcHintText() +
      (TPW.npcQuery ? ' 匹配 ' + rows.length + ' 条' + extra : '');
  }
}

function tpwAddNpcHtml() {
  if (!tpwNpcCandidates().length) {
    return '<div class="field"><label>NPC</label><select id="tpwKey" disabled>' +
      '<option value="">没有可新增的 NPC</option></select></div>';
  }
  return '<div class="field"><label>NPC</label>' +
    '<input id="tpwNpcSearch" class="tpw-npc-search" placeholder="搜索名称 / ID / 地图 / 脚本" value="' +
    tpwEsc(TPW.npcQuery || '') + '">' +
    '<select id="tpwKey"></select>' +
    '<div id="tpwNpcHint" class="field-hint"></div></div>';
}

function tpwAddModeHtml() {
  const mode = TPW.addMode;
  return '<div class="field tpw-span2"><label>新增方式</label><select id="tpwAddMode">' +
    '<option value="npc"' + (mode === 'npc' ? ' selected' : '') + '>新建传送门 NPC（写入 NPCList.txt）</option>' +
    '<option value="reuse"' + (mode === 'reuse' ? ' selected' : '') + '>复用现有 NPC</option>' +
    '</select></div>';
}

function tpwDestFieldsHtml() {
  const editing = TPW.editing;
  return '<div class="field"><label>目的地地图</label><div class="tpw-map-row">' +
    '<input id="tpwMap" list="tpwMapList" value="' + tpwEsc(editing.map) + '" placeholder="选择或输入地图代码">' +
    '<button type="button" class="btn small" data-tpw-act="pick-map">选择</button></div></div>' +
    '<div class="field"><label>X 坐标</label><input id="tpwX" type="number" min="0" max="100000" value="' + tpwEsc(editing.x) + '"></div>' +
    '<div class="field"><label>Y 坐标</label><input id="tpwY" type="number" min="0" max="100000" value="' + tpwEsc(editing.y) + '"></div>';
}

function tpwAddNewHtml() {
  const editing = TPW.editing;
  return '<div class="field"><label>NPC 名称</label>' +
    '<input id="tpwName" maxlength="64" value="' + tpwEsc(editing.name || '传送门') + '"></div>' +
    '<div class="field"><label>NPC ID</label>' +
    '<input id="tpwKey" maxlength="64" value="' + tpwEsc(editing.key || '') +
    '" placeholder="选择所在地图后自动生成"></div>' +
    '<div class="field"><label>所在地图</label><div class="tpw-map-row">' +
    '<input id="tpwPlaceMap" list="tpwMapList" value="' + tpwEsc(editing.placeMap || '') +
    '" placeholder="选择或输入地图代码">' +
    '<button type="button" class="btn small" data-tpw-act="pick-place-map">选择</button></div>' +
    '<div id="tpwPlaceNote" class="tpw-map-note"></div></div>' +
    '<div class="field"><label>放置 X</label>' +
    '<input id="tpwPlaceX" type="number" min="0" max="100000" value="' + tpwEsc(editing.placeX) + '"></div>' +
    '<div class="field"><label>放置 Y</label>' +
    '<input id="tpwPlaceY" type="number" min="0" max="100000" value="' + tpwEsc(editing.placeY) + '"></div>' +
    tpwDestFieldsHtml();
}

function tpwFormHtml(d, adding) {
  const editing = TPW.editing;
  const newMode = adding && TPW.addMode === 'npc';
  const noNpc = adding && !newMode && !tpwNpcCandidates().length;
  const note = adding
    ? (newMode
      ? '<div class="nbw-note">保存会同时写入两个文件：NPCList.txt 新增一行（脚本 ComTrans1），ComTrans1.py 追加 NPCMAP 目的地。两个文件都会自动备份；进游戏后需要 @reloadnpc 或重启 GameServer 才生效。</div>'
      : (noNpc
        ? '<div class="nbw-note">NPCList 中没有可新增的 ComTrans1 NPC。</div>'
        : '<div class="nbw-note">只写入 ComTrans1.py。只有脚本为 ComTrans1 的 NPC 才会传送；其他脚本的 NPC 保存后不会生效。</div>'))
    : '<div class="nbw-note">可更换 NPC；更换后原 NPC 将不再传送。只替换 NPC ID、地图和坐标，不改行序、缩进和其它脚本内容。</div>';
  const lineNote = !adding && d && d.entry
    ? '第 ' + d.entry.keyLine + '–' + (d.entry.keyLine + 3) + ' 行，只修改 key/map/x/y'
    : (adding && !newMode ? '只修改 NPCMAP 的 key/map/x/y' : 'NPCList.txt + ComTrans1.py');
  return '<div class="nbw-section">' +
    '<div class="nbw-section-head"><h4>' + (adding ? '新增传送点' : '编辑「' + tpwEsc(editing.key) + '」') + '</h4>' +
    '<span class="muted">' + lineNote + '</span></div>' +
    '<div class="form-grid">' +
    (adding ? tpwAddModeHtml() : '') +
    (newMode ? tpwAddNewHtml() : (adding ? tpwAddNpcHtml() : tpwEditNpcHtml()) + tpwDestFieldsHtml()) +
    '</div>' + note +
    '<div class="nbw-actions">' +
    '<button class="btn primary" data-tpw-act="save"' + (noNpc ? ' disabled' : '') + '>' +
    (adding ? '添加传送点' : '保存修改') + '</button>' +
    '<button class="btn" data-tpw-act="cancel">取消</button></div></div>';
}

function tpwAutoKeyUpdate() {
  if (!TPW.editing || TPW.editing.mode !== 'add' || TPW.addMode !== 'npc') return;
  if (!TPW.autoKey) return;
  const mapInput = tpwEl('tpwPlaceMap');
  const keyInput = tpwEl('tpwKey');
  if (!mapInput || !keyInput) return;
  const code = mapInput.value.trim();
  const next = code ? tpwNewKey(code) : '';
  TPW.editing.key = next;
  keyInput.value = next;
}

function tpwUpdatePlaceLabel() {
  const note = tpwEl('tpwPlaceNote');
  if (!note) return;
  const input = tpwEl('tpwPlaceMap');
  const code = input ? input.value.trim() : '';
  if (!code) {
    note.textContent = '选择所在地图后会自动生成 NPC ID。';
    return;
  }
  const name = tpwKnownMapName(code);
  note.textContent = name
    ? '所在地图：' + code + ' · ' + name
    : '地图 ' + code + ' 不在 MapInfo/MiniMap 中，NPC 可能不会出现。';
}

function tpwRenderDetail(errorText, loadingText) {
  const box = tpwEl('tpwBody');
  if (!box) return;
  const adding = TPW.editing && TPW.editing.mode === 'add';
  tpwText('tpwMeta', adding ? '新增传送点' : (TPW.key || '未选择传送点'));
  if (loadingText) {
    box.innerHTML = '<div class="nbw-intro">' + tpwEsc(loadingText) + '</div>';
    return;
  }
  if (errorText) {
    box.innerHTML = '<div class="nbw-intro">' + tpwEsc(errorText) + '</div>';
    return;
  }
  if (adding) {
    box.innerHTML = '<div class="nbw-detail">' + tpwBanners(TPW.data) +
      tpwFormHtml(null, true) + '</div>';
    if (TPW.addMode === 'npc') {
      tpwAutoKeyUpdate();
      tpwUpdatePlaceLabel();
    } else {
      tpwRenderNpcOptions();
    }
    return;
  }
  const d = TPW.detail;
  if (!d) {
    box.innerHTML = tpwIntroHtml();
    return;
  }
  if (TPW.editing) {
    box.innerHTML = '<div class="nbw-detail">' + tpwBanners(d) +
      tpwFormHtml(d, false) + '</div>';
    return;
  }
  const s = TPW.data && TPW.data.stats;
  const meta = s ? s.entries + ' 条 · ' + s.npcRefs + ' 个 NPC · ' + s.warnings + ' 条提示' : '';
  box.innerHTML = '<div class="nbw-detail">' + tpwBanners(d) +
    '<div class="nbw-toolbar"><span class="muted">' + tpwEsc(meta) + '</span><span class="spacer"></span>' +
    (d.writable ? '<button class="btn primary" data-tpw-act="add">新增传送点</button>' : '') +
    '</div>' + tpwDetailCard(d) + '</div>';
}

function tpwStartAdd(key) {
  if (!TPW.data || TPW.data.writable === false) return;
  TPW.npcQuery = '';
  TPW.addMode = key ? 'reuse' : 'npc';
  TPW.autoKey = true;
  TPW.editing = {
    mode: 'add',
    key: key || '',
    name: '传送门',
    placeMap: '',
    placeX: '',
    placeY: '',
    map: '',
    x: '0',
    y: '0'
  };
  TPW.detail = null;
  TPW.key = '';
  tpwSetHash('');
  tpwRenderDetail();
  const input = TPW.addMode === 'npc' ? tpwEl('tpwPlaceMap')
    : (key ? tpwEl('tpwMap') : tpwEl('tpwNpcSearch'));
  if (input) input.focus();
}

function tpwStartEdit() {
  const d = TPW.detail;
  if (!d || !d.entry) return;
  TPW.editing = {
    mode: 'update',
    key: d.entry.key,
    map: d.entry.map,
    x: String(d.entry.x),
    y: String(d.entry.y)
  };
  tpwRenderDetail();
}

function tpwCancelEdit() {
  TPW.editing = null;
  tpwRenderDetail();
}

function tpwSnapshot() {
  const editing = TPW.editing;
  if (!editing) return;
  const key = tpwEl('tpwKey');
  const map = tpwEl('tpwMap');
  const x = tpwEl('tpwX');
  const y = tpwEl('tpwY');
  if (key) editing.key = key.value;
  if (map) editing.map = map.value;
  if (x) editing.x = x.value;
  if (y) editing.y = y.value;
  if (editing.mode === 'add' && TPW.addMode === 'npc') {
    const name = tpwEl('tpwName');
    const placeMap = tpwEl('tpwPlaceMap');
    const placeX = tpwEl('tpwPlaceX');
    const placeY = tpwEl('tpwPlaceY');
    if (name) editing.name = name.value;
    if (placeMap) editing.placeMap = placeMap.value;
    if (placeX) editing.placeX = placeX.value;
    if (placeY) editing.placeY = placeY.value;
  }
}

async function tpwRecoverConflict(e, target) {
  if (e.status === 409) {
    toast('文件已被外部修改，已重新加载，请确认后再保存', 'err');
    TPW.editing = null;
    await tpwLoad(true).catch(() => {});
    if (target) await tpwLoadDetail(target).catch(() => {});
    return true;
  }
  return false;
}

async function tpwSave() {
  const editing = TPW.editing;
  if (!editing) return;
  tpwSnapshot();
  const map = String(editing.map || '').trim();
  const key = String(editing.key || '').trim();
  const creating = editing.mode === 'add' && TPW.addMode === 'npc';

  if (creating) {
    const name = String(editing.name || '').trim();
    const placeMap = String(editing.placeMap || '').trim();
    const placeX = String(editing.placeX || '').trim();
    const placeY = String(editing.placeY || '').trim();
    if (!key) return toast('请填写 NPC ID', 'err');
    if (!name) return toast('请填写 NPC 名称', 'err');
    if (!placeMap) return toast('请填写 NPC 所在地图', 'err');
    if (!placeX || !placeY) return toast('请填写 NPC 放置坐标', 'err');
    if (!map) return toast('请填写目的地地图', 'err');
    if (String(editing.x).trim() === '' || String(editing.y).trim() === '') {
      return toast('请填写目的地 X/Y 坐标', 'err');
    }
    try {
      const r = await api('/api/config/teleport/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: 'ComTrans1.py',
          hash: TPW.data.hash,
          npcHash: TPW.data.npcHash,
          key,
          name,
          map: placeMap,
          x: Number(placeX),
          y: Number(placeY),
          destMap: map,
          destX: Number(editing.x),
          destY: Number(editing.y)
        })
      });
      const files = [];
      if (r.backups && r.backups.npcList) files.push('NPCList.txt');
      if (r.backups && r.backups.teleport) files.push('ComTrans1.py');
      toast('已新建传送门「' + key + '」' +
        (files.length ? '，已备份：' + files.join('、') : '') +
        '。进游戏后请 @reloadnpc 或重启 GameServer', 'ok');
      TPW.editing = null;
      await tpwLoad(true);
      await tpwLoadDetail(key);
      tpwSetHash(key);
    } catch (e) {
      if (await tpwRecoverConflict(e, key)) return;
      toast('新增失败：' + e.message, 'err');
    }
    return;
  }

  if (editing.mode === 'add' && !key) return toast('请选择 NPC', 'err');
  if (!map) return toast('请填写目的地地图', 'err');
  if (String(editing.x).trim() === '' || String(editing.y).trim() === '') {
    return toast('请填写 X/Y 坐标', 'err');
  }
  let op;
  let target;
  if (editing.mode === 'add') {
    target = key;
    op = { op: 'add', key, map, x: Number(editing.x), y: Number(editing.y) };
  } else {
    target = editing.key;
    const d = TPW.detail;
    if (!d || !d.entry) return;
    op = {
      op: 'update',
      keyLine: d.entry.keyLine,
      expectKey: d.entry.key,
      key,
      map,
      x: Number(editing.x),
      y: Number(editing.y)
    };
  }
  try {
    const r = await api('/api/config/teleport/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'ComTrans1.py', hash: TPW.data.hash, ops: [op] })
    });
    if (r.changed === false) toast('没有实际修改，未写入文件', 'ok');
    else toast((editing.mode === 'add' ? '已添加「' + target + '」' : '已保存「' + target + '」') +
      (r.backup ? '，备份：' + r.backup : ''), 'ok');
    TPW.editing = null;
    await tpwLoad(true);
    await tpwLoadDetail(target);
    tpwSetHash(target);
  } catch (e) {
    if (await tpwRecoverConflict(e, target)) return;
    toast('保存失败：' + e.message, 'err');
  }
}

async function tpwDelete() {
  const d = TPW.detail;
  if (!d || !d.entry) return;
  const names = d.entry.npcs.map((npc) => npc.name).join('、') || '未找到 NPC';
  if (!confirm('确定删除「' + d.entry.key + '」（' + names + '）的传送目的地？\n\n' +
    '只会删除 NPCMAP 中的这一条；NPCList 里的 NPC 不会被删除，删除后该 NPC 将不再传送。写入前自动备份。')) return;
  try {
    const r = await api('/api/config/teleport/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: 'ComTrans1.py',
        hash: d.hash,
        ops: [{ op: 'delete', keyLine: d.entry.keyLine, expectKey: d.entry.key }]
      })
    });
    toast('已删除「' + d.entry.key + '」' + (r.backup ? '，备份：' + r.backup : ''), 'ok');
    TPW.detail = null;
    TPW.key = '';
    TPW.editing = null;
    tpwSetHash('');
    await tpwLoad(true);
    const entries = (TPW.data && TPW.data.entries) || [];
    if (entries.length) await tpwLoadDetail(entries[0].key);
    else tpwRenderDetail();
  } catch (e) {
    if (e.status === 409) {
      toast('脚本已被外部修改，已重新加载，请确认后再删除', 'err');
      await tpwLoad(true).catch(() => {});
      await tpwLoadDetail(d.entry.key).catch(() => {});
      return;
    }
    toast('删除失败：' + e.message, 'err');
  }
}

async function openTeleportView(sel) {
  if (S.mode !== 'teleport' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'teleport';
  if (typeof hideAllViews === 'function') hideAllViews();
  if (window.hideNpcBuyView) window.hideNpcBuyView();
  if (window.hideItemUseView) window.hideItemUseView();
  const view = tpwEl('teleportView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('tpw');
  TPW.editing = null;
  const hashKey = tpwHashKey();
  const target = typeof sel === 'string' && sel ? sel : hashKey;
  try {
    if (!TPW.data || TPW.stale) await tpwLoad();
  } catch (e) {
    toast('加载传送点失败：' + e.message, 'err');
    tpwRenderDetail('加载失败：' + e.message);
    return;
  }
  tpwRenderModes();
  tpwRenderList();
  if (target) {
    if (target === TPW.key && TPW.detail) tpwRenderDetail();
    else await tpwLoadDetail(target);
  } else if (TPW.data.entries && TPW.data.entries.length) {
    await tpwLoadDetail(TPW.data.entries[0].key);
  } else {
    tpwRenderDetail();
  }
}

window.openTeleportView = openTeleportView;
window.hideTeleportView = () => {
  const view = tpwEl('teleportView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && tpwHashKey()) tpwSetHash('');
};
window.refreshTeleportState = () => {
  TPW.stale = true;
};

function tpwBindEvents() {
  const filter = tpwEl('tpwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      TPW.filter = filter.value;
      tpwRenderList();
    });
  }

  const modes = tpwEl('tpwModeFilter');
  if (modes) {
    modes.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tpw-mode]');
      if (!btn) return;
      TPW.mode = btn.dataset.tpwMode;
      tpwRenderModes();
      tpwRenderList();
    });
  }

  const list = tpwEl('tpwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const added = e.target.closest('[data-tpw-new]');
      if (added) {
        tpwStartAdd(added.dataset.tpwNew);
        return;
      }
      const row = e.target.closest('[data-tpw-key]');
      if (row) tpwSelect(row.dataset.tpwKey);
    });
  }

  const add = tpwEl('btnTpwAdd');
  if (add) add.addEventListener('click', () => tpwStartAdd());

  const reload = tpwEl('btnTpwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      try {
        await tpwLoad(true);
        if (TPW.key) await tpwLoadDetail(TPW.key, true);
        else if (TPW.data.entries && TPW.data.entries.length) await tpwLoadDetail(TPW.data.entries[0].key, true);
        else tpwRenderDetail();
        toast('已重新检查', 'ok');
      } catch (e) {
        toast('重新检查失败：' + e.message, 'err');
      }
    });
  }

  const view = tpwEl('teleportView');
  if (view) {
    view.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tpw-act]');
      if (!btn) return;
      const act = btn.dataset.tpwAct;
      if (act === 'add') tpwStartAdd();
      else if (act === 'edit') tpwStartEdit();
      else if (act === 'cancel') tpwCancelEdit();
      else if (act === 'save') tpwSave();
      else if (act === 'delete') tpwDelete();
      else if (act === 'pick-map') {
        tpwShowMapPicker('tpwMap');
      } else if (act === 'pick-place-map') {
        tpwShowMapPicker('tpwPlaceMap');
      }
    });
    view.addEventListener('input', (e) => {
      if (e.target.id === 'tpwNpcSearch') {
        TPW.npcQuery = e.target.value;
        tpwRenderNpcOptions();
      } else if (e.target.id === 'tpwPlaceMap' && TPW.editing) {
        TPW.editing.placeMap = e.target.value;
        tpwAutoKeyUpdate();
        tpwUpdatePlaceLabel();
      } else if (e.target.id === 'tpwKey' && TPW.editing && TPW.addMode === 'npc') {
        TPW.editing.key = e.target.value;
        TPW.autoKey = false;
      }
    });
    view.addEventListener('change', (e) => {
      if (e.target.id === 'tpwAddMode') {
        tpwSetAddMode(e.target.value);
        return;
      }
      if (e.target.id === 'tpwKey' && TPW.editing) {
        TPW.editing.key = e.target.value;
        if (TPW.editing.mode === 'add' && TPW.addMode === 'reuse') tpwUpdateNpcHint();
      }
    });
  }
}

function tpwShowMapPicker(id) {
  const input = tpwEl(id);
  if (!input) return;
  input.focus();
  if (typeof input.showPicker === 'function') {
    try { input.showPicker(); } catch (e) {
    }
  }
}

function tpwSetAddMode(value) {
  if (!TPW.editing) return;
  tpwSnapshot();
  TPW.addMode = value === 'reuse' ? 'reuse' : 'npc';
  TPW.npcQuery = '';
  TPW.autoKey = true;
  TPW.editing.key = '';
  if (TPW.addMode === 'npc' && !TPW.editing.name) TPW.editing.name = '传送门';
  tpwRenderDetail();
  const input = TPW.addMode === 'npc' ? tpwEl('tpwPlaceMap') : tpwEl('tpwNpcSearch');
  if (input) input.focus();
}

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(tpwBindEvents).catch(tpwBindEvents);
} else {
  document.addEventListener('DOMContentLoaded', tpwBindEvents);
}

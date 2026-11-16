'use strict';

const OPS_NOTICE_LABELS = {
  line: 'LineNotice.txt · 系统公告',
  float: 'FloatAD.txt · 滚动公告',
  bulletin: 'Bullitin.ini · 健康公告',
  bless: 'bless.txt · 祝福语'
};

function opsNoticeDirty() {
  const m = CFG.ops;
  let n = 0;
  for (const key of Object.keys(OPS_NOTICE_LABELS)) {
    if ((m.noticeTexts[key] || '') !== (m.noticeOriginal[key] || '')) n++;
  }
  return n;
}

function opsQuizList() {
  const m = CFG.ops;
  if (!m.data) return [];
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < m.data.quiz.rows.length; i++) {
    if (m.quizDeleted.has(i)) continue;
    const row = m.quizEdits.get(i) || m.data.quiz.rows[i];
    if (q && !`${row.question} ${row.options.join(' ')}`.toLowerCase().includes(q)) continue;
    out.push({ index: i, row, added: false });
  }
  for (let k = 0; k < m.quizAdded.length; k++) {
    const row = m.quizAdded[k];
    if (q && !`${row.question} ${row.options.join(' ')}`.toLowerCase().includes(q)) continue;
    out.push({ index: m.data.quiz.rows.length + k, row, added: true });
  }
  return out;
}

function getOpsQuizRow(index) {
  const m = CFG.ops;
  if (index < m.data.quiz.rows.length) return m.quizEdits.get(index) || m.data.quiz.rows[index];
  return m.quizAdded[index - m.data.quiz.rows.length];
}

function setOpsQuizRow(index, row) {
  const m = CFG.ops;
  if (index >= m.data.quiz.rows.length) {
    m.quizAdded[index - m.data.quiz.rows.length] = row;
    return;
  }
  const base = m.data.quiz.rows[index];
  if (row.question === base.question && row.options.join('/') === base.options.join('/')) m.quizEdits.delete(index);
  else m.quizEdits.set(index, row);
}

function opsSectionData(kind) {
  return kind === 'box' ? CFG.ops.data.boxes : CFG.ops.data.starter;
}

function opsSectionMaps(kind) {
  const m = CFG.ops;
  return kind === 'box'
    ? { edits: m.boxEdits, added: m.boxAdded, deleted: m.boxDeleted, groups: m.boxGroupEdits }
    : { edits: m.starterEdits, added: m.starterAdded, deleted: m.starterDeleted, groups: m.starterGroupEdits };
}

function opsSectionGroupName(kind, groupIndex) {
  const maps = opsSectionMaps(kind);
  const ds = opsSectionData(kind);
  return maps.groups.get(groupIndex) ?? ds.groups[groupIndex].name;
}

function opsSectionList(kind) {
  const m = CFG.ops;
  if (!m.data) return [];
  const ds = opsSectionData(kind);
  const maps = opsSectionMaps(kind);
  const q = m.search.trim().toLowerCase();
  const out = [];
  for (let i = 0; i < ds.rows.length; i++) {
    if (maps.deleted.has(i)) continue;
    const row = maps.edits.get(i) || ds.rows[i];
    const group = opsSectionGroupName(kind, row.groupIndex);
    if (q && !`${group} ${row.item}`.toLowerCase().includes(q)) continue;
    out.push({ index: i, row: { ...row, group }, added: false });
  }
  for (let k = 0; k < maps.added.length; k++) {
    const row = maps.added[k];
    if (q && !`${row.group} ${row.item}`.toLowerCase().includes(q)) continue;
    out.push({ index: ds.rows.length + k, row, added: true });
  }
  return out;
}

function getOpsSectionRow(kind, index) {
  const ds = opsSectionData(kind);
  const maps = opsSectionMaps(kind);
  if (index < ds.rows.length) return maps.edits.get(index) || ds.rows[index];
  return maps.added[index - ds.rows.length];
}

function setOpsSectionRow(kind, index, item) {
  const ds = opsSectionData(kind);
  const maps = opsSectionMaps(kind);
  if (index >= ds.rows.length) {
    maps.added[index - ds.rows.length].item = item;
    return;
  }
  const base = ds.rows[index];
  if (item === base.item) maps.edits.delete(index);
  else maps.edits.set(index, { item });
}

function renderOpsNotices() {
  const m = CFG.ops;
  for (const key of Object.keys(OPS_NOTICE_LABELS)) {
    const el = cfgEl('opsNotice-' + key);
    if (el && el.value !== (m.noticeTexts[key] || '')) el.value = m.noticeTexts[key] || '';
    const meta = cfgEl('opsNoticeMeta-' + key);
    if (meta) {
      const file = m.data.notices.files[key];
      meta.textContent = file && file.error ? '读取失败：' + file.error : `${(m.noticeTexts[key] || '').split('\n').length} 行`;
    }
  }
}

function renderOpsQuiz() {
  const m = CFG.ops;
  const thead = cfgEl('opsQuizGrid').querySelector('thead');
  const tbody = cfgEl('opsQuizGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '题目', '选项数', '选项']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  for (const item of opsQuizList()) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.quizSelected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [item.index + 1, item.row.question, item.row.options.length, item.row.options.join(' / ')];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 2) td.className = 'num';
      else if (i === 1) td.className = 'str namecell';
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
  cfgEl('opsQuizMeta').textContent = `${m.data.quiz.rows.length - m.quizDeleted.size + m.quizAdded.length} 道题`;
}

function renderOpsSection(kind) {
  const m = CFG.ops;
  const ds = opsSectionData(kind);
  const grid = cfgEl(kind === 'box' ? 'opsBoxesGrid' : 'opsStarterGrid');
  const thead = grid.querySelector('thead');
  const tbody = grid.querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  const htr = document.createElement('tr');
  for (const label of ['#', '分组', '物品']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  for (const item of opsSectionList(kind)) {
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    const selected = kind === 'box' ? m.boxSelected : m.starterSelected;
    if (item.index === selected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    const cells = [item.index + 1, item.row.group, item.row.item];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (i === 2) td.className = 'str namecell';
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
  const maps = opsSectionMaps(kind);
  cfgEl(kind === 'box' ? 'opsBoxesMeta' : 'opsStarterMeta').textContent =
    `${ds.groups.length} 组 · ${ds.rows.length - maps.deleted.size + maps.added.length} 条物品`;
}

function renderOps() {
  const m = CFG.ops;
  if (!m.data) return;
  const tabs = ['notices', 'quiz', 'boxes', 'starter'];
  for (const tab of tabs) {
    const id = 'opsTab' + tab.charAt(0).toUpperCase() + tab.slice(1);
    cfgEl(id).classList.toggle('active', m.tab === tab);
    cfgEl('ops' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Wrap').classList.toggle('hidden', m.tab !== tab);
  }
  const isNotices = m.tab === 'notices';
  cfgEl('opsSearch').classList.toggle('hidden', isNotices);
  cfgEl('btnOpsAdd').classList.toggle('hidden', isNotices);
  cfgEl('btnOpsDel').classList.toggle('hidden', isNotices);
  if (m.tab === 'notices') {
    renderOpsNotices();
    cfgEl('opsHint').textContent = '公告类文件按整段文本保存；修改后点击“保存”写入，所有文件都会先备份。';
  } else if (m.tab === 'quiz') {
    renderOpsQuiz();
    cfgEl('opsHint').textContent = '答题每行格式：题目/选项1/选项2/选项3；题目和选项不能包含斜杠。';
  } else if (m.tab === 'boxes') {
    renderOpsSection('box');
    cfgEl('opsHint').textContent = '宝盒按 [宝盒名] 分组，下面每行一个奖励物品；可以改名或新增分组。';
  } else {
    renderOpsSection('starter');
    cfgEl('opsHint').textContent = '新手礼包按职业/性别分组，每行一个礼包物品；保存后新角色创建时生效。';
  }
  cfgEl('opsMeta').textContent =
    `${Object.keys(OPS_NOTICE_LABELS).length} 个公告 · ${m.data.quiz.rows.length} 道题 · ` +
    `${m.data.boxes.rows.length} 个宝盒物品 · ${m.data.starter.rows.length} 个新手礼包`;
}

function buildOpsQuizForm(index) {
  const m = CFG.ops;
  const row = getOpsQuizRow(index);
  if (!row) return;
  const added = index >= m.data.quiz.rows.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = row.question || (added ? '新题目' : `题目 #${index + 1}`);
  cfgEl('cfgDetailSub').textContent = added ? '新增题目（保存后写入文件）' : `第 ${index + 1} 道题`;
  cfgEl('cfgNote').textContent = '答题行格式为“题目/选项1/选项2/选项3”，选项顺序就是游戏内显示顺序。';

  const question = cfgText(row.question, null, 200);
  question.addEventListener('input', () => {
    const cur = { ...getOpsQuizRow(index), options: [...getOpsQuizRow(index).options] };
    cur.question = question.value;
    setOpsQuizRow(index, cur);
    cfgEl('cfgDetailTitle').textContent = cur.question || (added ? '新题目' : `题目 #${index + 1}`);
    renderOpsQuiz();
    updateMeta();
  });
  form.appendChild(cfgField('题目', question, '不能包含 /'));

  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = '选项';
  form.appendChild(title);
  const list = document.createElement('div');
  list.className = 'mat-list';
  row.options.forEach((opt, pos) => {
    const line = document.createElement('div');
    line.className = 'mat-row';
    const input = cfgText(opt, null, 200);
    const del = document.createElement('button');
    del.className = 'btn small ghost';
    del.textContent = '移除';
    input.addEventListener('input', () => {
      const cur = { ...getOpsQuizRow(index), options: [...getOpsQuizRow(index).options] };
      cur.options[pos] = input.value;
      setOpsQuizRow(index, cur);
      renderOpsQuiz();
      updateMeta();
    });
    del.addEventListener('click', () => {
      if (getOpsQuizRow(index).options.length <= 2) return toast('至少需要两个选项', 'err');
      const cur = { ...getOpsQuizRow(index), options: [...getOpsQuizRow(index).options] };
      cur.options.splice(pos, 1);
      setOpsQuizRow(index, cur);
      renderOpsQuiz();
      buildOpsQuizForm(index);
      updateMeta();
    });
    line.appendChild(input);
    line.appendChild(del);
    list.appendChild(line);
  });
  form.appendChild(list);
  const add = document.createElement('button');
  add.className = 'btn small';
  add.textContent = '+ 添加选项';
  add.addEventListener('click', () => {
    const cur = { ...getOpsQuizRow(index), options: [...getOpsQuizRow(index).options, '新选项'] };
    setOpsQuizRow(index, cur);
    renderOpsQuiz();
    buildOpsQuizForm(index);
    updateMeta();
  });
  form.appendChild(add);
  cfgMarkSelected(cfgEl('opsQuizGrid').querySelector('tbody'), index);
}

function buildOpsSectionForm(kind, index) {
  const m = CFG.ops;
  const ds = opsSectionData(kind);
  const maps = opsSectionMaps(kind);
  const row = getOpsSectionRow(kind, index);
  if (!row) return;
  const added = index >= ds.rows.length;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  cfgEl('cfgDetail').classList.remove('hidden');
  cfgEl('cfgDetailTitle').textContent = added ? '新增物品' : `${opsSectionGroupName(kind, row.groupIndex)} · 物品 #${index + 1}`;
  cfgEl('cfgDetailSub').textContent = added ? '新增物品（保存后写入文件）' : `第 ${index + 1} 条`;
  cfgEl('cfgNote').textContent = kind === 'box'
    ? '分组名对应 [宝盒名]；修改已有记录的分组名会重命名整个分组。'
    : '分组名对应 [男战士] 等职业分组；可以新增礼包物品或新分组。';

  const group = cfgText(added ? row.group : opsSectionGroupName(kind, row.groupIndex), null, 64);
  const item = cfgText(row.item, 'itemList', 128);
  group.addEventListener('input', () => {
    if (added) {
      const cur = getOpsSectionRow(kind, index);
      cur.group = group.value;
      renderOpsSection(kind);
      updateMeta();
      return;
    }
    const gi = getOpsSectionRow(kind, index).groupIndex;
    if (group.value === ds.groups[gi].name) maps.groups.delete(gi);
    else maps.groups.set(gi, group.value);
    renderOpsSection(kind);
    updateMeta();
  });
  item.addEventListener('input', () => {
    setOpsSectionRow(kind, index, item.value);
    renderOpsSection(kind);
    updateMeta();
  });
  form.appendChild(cfgField('分组', group, added ? '可输入新分组' : '修改会重命名分组'));
  form.appendChild(cfgField('物品名称', item, '每行一个物品'));
  const grid = kind === 'box' ? cfgEl('opsBoxesGrid') : cfgEl('opsStarterGrid');
  cfgMarkSelected(grid.querySelector('tbody'), index);
}

function opsAdd() {
  const m = CFG.ops;
  if (!m.data) return;
  m.search = '';
  cfgEl('opsSearch').value = '';
  if (m.tab === 'quiz') {
    const selected = m.quizSelected >= 0 ? getOpsQuizRow(m.quizSelected) : null;
    const row = selected
      ? { question: `${selected.question}（副本）`, options: [...selected.options] }
      : { question: '新题目', options: ['选项1', '选项2', '选项3'] };
    m.quizAdded.push(row);
    m.quizSelected = m.data.quiz.rows.length + m.quizAdded.length - 1;
    renderOpsQuiz();
    buildOpsQuizForm(m.quizSelected);
    updateMeta();
    return;
  }
  const kind = m.tab === 'boxes' ? 'box' : 'starter';
  const ds = opsSectionData(kind);
  const maps = opsSectionMaps(kind);
  const selected = kind === 'box' ? m.boxSelected : m.starterSelected;
  const base = selected >= 0 ? getOpsSectionRow(kind, selected) : null;
  const group = base
    ? (selected < ds.rows.length ? opsSectionGroupName(kind, base.groupIndex) : base.group)
    : (ds.groups[0] ? opsSectionGroupName(kind, 0) : '新分组');
  maps.added.push({ group, item: kind === 'box' ? '新宝盒物品' : '新礼包(1级)' });
  const index = ds.rows.length + maps.added.length - 1;
  if (kind === 'box') m.boxSelected = index;
  else m.starterSelected = index;
  renderOpsSection(kind);
  buildOpsSectionForm(kind, index);
  updateMeta();
}

async function opsDelete() {
  const m = CFG.ops;
  if (!m.data) return;
  if (m.tab === 'quiz') {
    if (m.quizSelected < 0) return toast('请先选择一道题', 'err');
    const index = m.quizSelected;
    const row = getOpsQuizRow(index);
    if (!row) return;
    if (!(await uiConfirm({
      title: '删除题目',
      message: `删除题目：${row.question}？`,
      okText: '删除',
      danger: true
    }))) return;
    if (index >= m.data.quiz.rows.length) m.quizAdded.splice(index - m.data.quiz.rows.length, 1);
    else {
      m.quizDeleted.add(index);
      m.quizEdits.delete(index);
    }
    cfgCloseDetail();
    renderOpsQuiz();
    updateMeta();
    return;
  }
  const kind = m.tab === 'boxes' ? 'box' : 'starter';
  const ds = opsSectionData(kind);
  const maps = opsSectionMaps(kind);
  const selected = kind === 'box' ? m.boxSelected : m.starterSelected;
  if (selected < 0) return toast('请先选择一条物品', 'err');
  const row = getOpsSectionRow(kind, selected);
  if (!row) return;
  if (!(await uiConfirm({
    title: '删除物品',
    message: `删除物品：${row.item}？`,
    okText: '删除',
    danger: true
  }))) return;
  if (selected >= ds.rows.length) maps.added.splice(selected - ds.rows.length, 1);
  else {
    maps.deleted.add(selected);
    maps.edits.delete(selected);
  }
  cfgCloseDetail();
  renderOpsSection(kind);
  updateMeta();
}

function opsQuizPayload() {
  const m = CFG.ops;
  return {
    changes: [...m.quizEdits.entries()].map(([index, values]) => ({ index, values })),
    added: m.quizAdded,
    deleted: [...m.quizDeleted]
  };
}

function opsSectionPayload(kind) {
  const m = CFG.ops;
  const maps = opsSectionMaps(kind);
  return {
    changes: [...maps.edits.entries()].map(([index, values]) => ({ index, values })),
    added: maps.added,
    deleted: [...maps.deleted],
    groupChanges: [...maps.groups.entries()].map(([index, name]) => ({ index, name }))
  };
}

async function openOpsConfig(force, keepTab) {
  if (!force && !(await confirmDiscard())) return;
  try {
    const data = await api('/api/config/ops');
    const m = CFG.ops;
    m.data = data;
    m.tab = keepTab || 'notices';
    m.search = '';
    m.selected = -1;
    m.noticeTexts = {};
    m.noticeOriginal = {};
    for (const key of Object.keys(OPS_NOTICE_LABELS)) {
      const f = data.notices.files[key];
      m.noticeTexts[key] = f && typeof f.text === 'string' ? f.text : '';
      m.noticeOriginal[key] = m.noticeTexts[key];
    }
    m.quizEdits.clear();
    m.quizAdded = [];
    m.quizDeleted.clear();
    m.quizSelected = -1;
    m.boxEdits.clear();
    m.boxAdded = [];
    m.boxDeleted.clear();
    m.boxGroupEdits.clear();
    m.boxSelected = -1;
    m.starterEdits.clear();
    m.starterAdded = [];
    m.starterDeleted.clear();
    m.starterGroupEdits.clear();
    m.starterSelected = -1;
    cfgSetMode('cfgOps');
    cfgEl('opsSearch').value = '';
    renderOps();
    updateMeta();
  } catch (e) {
    toast('打开运营配置失败：' + e.message, 'err');
  }
}

async function saveOpsConfig() {
  const m = CFG.ops;
  if (!m.data || cfgDirty('cfgOps') === 0) return;
  const btn = cfgEl('btnOpsSave');
  btn.disabled = true;
  const messages = [];
  try {
    if (opsNoticeDirty() > 0) {
      const files = {};
      for (const key of Object.keys(OPS_NOTICE_LABELS)) files[key] = { text: m.noticeTexts[key] || '' };
      const res = await api('/api/config/ops/notices/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
      });
      messages.push(`公告保存 ${res.changedFiles} 个文件`);
      m.noticeOriginal = { ...m.noticeTexts };
    }
    if (m.quizEdits.size || m.quizAdded.length || m.quizDeleted.size) {
      const res = await api('/api/config/ops/quiz/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opsQuizPayload())
      });
      messages.push(`答题 修改 ${res.changedRows} / 新增 ${res.addedRows} / 删除 ${res.deletedRows}`);
    }
    for (const kind of ['box', 'starter']) {
      const maps = opsSectionMaps(kind);
      if (!maps.edits.size && !maps.added.length && !maps.deleted.size && !maps.groups.size) continue;
      const res = await api(`/api/config/ops/${kind === 'box' ? 'boxes' : 'starter'}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opsSectionPayload(kind))
      });
      messages.push(`${kind === 'box' ? '宝盒' : '新手礼包'} 修改 ${res.changedRows} / 新增 ${res.addedRows} / 删除 ${res.deletedRows}`);
    }
    toast('保存成功：' + messages.join('；'), 'ok');
    await refreshState();
    await openOpsConfig(true, m.tab);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateMeta();
  }
}

function setOpsTab(tab) {
  CFG.ops.tab = tab;
  CFG.ops.search = '';
  cfgEl('opsSearch').value = '';
  cfgCloseDetail();
  renderOps();
  updateMeta();
}

/* 事件绑定 */
for (const tab of ['notices', 'quiz', 'boxes', 'starter']) {
  const id = 'opsTab' + tab.charAt(0).toUpperCase() + tab.slice(1);
  cfgEl(id).addEventListener('click', () => setOpsTab(tab));
}
for (const key of Object.keys(OPS_NOTICE_LABELS)) {
  cfgEl('opsNotice-' + key).addEventListener('input', (e) => {
    CFG.ops.noticeTexts[key] = e.target.value;
    renderOpsNotices();
    updateMeta();
  });
}
cfgEl('opsQuizGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || !tr.dataset.index) return;
  CFG.ops.quizSelected = Number(tr.dataset.index);
  buildOpsQuizForm(CFG.ops.quizSelected);
});
for (const kind of ['box', 'starter']) {
  const grid = kind === 'box' ? cfgEl('opsBoxesGrid') : cfgEl('opsStarterGrid');
  grid.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr || !tr.dataset.index) return;
    const index = Number(tr.dataset.index);
    if (kind === 'box') CFG.ops.boxSelected = index;
    else CFG.ops.starterSelected = index;
    buildOpsSectionForm(kind, index);
  });
}
let opsSearchTimer = null;
cfgEl('opsSearch').addEventListener('input', () => {
  clearTimeout(opsSearchTimer);
  opsSearchTimer = setTimeout(() => {
    CFG.ops.search = cfgEl('opsSearch').value;
    renderOps();
  }, 150);
});
cfgEl('btnOpsAdd').addEventListener('click', opsAdd);
cfgEl('btnOpsDel').addEventListener('click', opsDelete);
cfgEl('btnOpsReload').addEventListener('click', () => openOpsConfig(false, CFG.ops.tab));
cfgEl('btnOpsSave').addEventListener('click', saveOpsConfig);

window.openOpsConfig = openOpsConfig;
window.saveOpsConfig = saveOpsConfig;

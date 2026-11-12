'use strict';

const TSK = {
  data: null,
  detail: null,
  detailId: '',
  loading: false,
  detailLoading: false,
  stale: true,
  tab: 'detail',
  filter: '',
  flag: 'all',
  selected: '',
  searchTimer: null,
  focusIds: null,
  focusLabel: '',
  options: null,
  optionsLoading: false
};

const TSK_TAB_LABEL = { detail: '详情', modules: '模块总览', health: '配置体检' };
const TSK_FLAG_LABEL = { all: '全部', enabled: '已启用', disabled: '未启用', issues: '有异常' };
const TSK_SEV = { error: '错误', warn: '警告', info: '提示' };
const TSK_ISSUE_LABELS = {
  task_module_unreadable: '模块不可读',
  npc_list_unreadable: 'NPCList 不可读',
  task_parse_error: '解析失败',
  task_script_missing: '任务脚本缺失',
  task_switch_orphan: '开关无对应任务',
  task_disabled: '任务未启用',
  task_duplicate_id: '任务 ID 重复',
  task_pretask_missing: '前置任务不存在',
  task_prize_target_missing: '奖励跳转任务不存在',
  task_prize_invalid: '奖励格式异常',
  task_monster_missing: '怪物不存在',
  task_item_missing: '物品不存在',
  task_npc_unplaced: '任务 NPC 未落位',
  task_npc_task_undefined: 'NPC 任务未定义',
  task_name_empty: '任务名为空'
};

function tskEl(id) {
  return document.getElementById(id);
}

function tskText(id, text) {
  const el = tskEl(id);
  if (el) el.textContent = text;
}

function tskClear(el) {
  if (el) el.innerHTML = '';
}

function tskChip(text, cls) {
  const span = document.createElement('span');
  span.className = 'tsk-chip' + (cls ? ' ' + cls : '');
  span.textContent = text;
  return span;
}

function tskButton(text, cls, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls || 'btn btn-sm';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function tskHashName() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash.startsWith('task=')) return '';
  return decodeURIComponent(hash.slice('task='.length));
}

function tskSetHash(id) {
  const base = location.pathname + location.search;
  const next = base + (id ? '#task=' + encodeURIComponent(id) : '');
  try {
    history.replaceState(null, '', next);
  } catch (e) {
  }
}

function tskFind(id) {
  if (!TSK.data) return null;
  return TSK.data.tasks.find((t) => String(t.id) === String(id)) || null;
}

function tskModules() {
  return TSK.data ? TSK.data.modules : [];
}

async function tskLoad(force) {
  if (TSK.loading) return;
  if (TSK.data && !force && !TSK.stale) return;
  TSK.loading = true;
  try {
    TSK.data = await api('/api/config/tasks');
    TSK.stale = false;
  } finally {
    TSK.loading = false;
  }
}

async function tskLoadDetail(id) {
  if (!id) {
    TSK.detail = null;
    TSK.detailId = '';
    return;
  }
  if (TSK.detailId === String(id) && TSK.detail && !TSK.stale) return;
  TSK.detailLoading = true;
  try {
    TSK.detail = await api('/api/config/task?id=' + encodeURIComponent(id));
    TSK.detailId = String(id);
  } catch (e) {
    TSK.detail = null;
    TSK.detailId = '';
    toast('加载任务 ' + id + ' 失败：' + e.message, 'err');
  } finally {
    TSK.detailLoading = false;
  }
}

function tskRenderMeta() {
  const el = tskEl('taskMeta');
  if (!el) return;
  if (!TSK.data) {
    el.textContent = TSK.stale ? '数据已变化，点击「重新检查」刷新' : '';
    return;
  }
  const s = TSK.data.stats;
  const warnTasks = TSK.data.tasks.filter((t) => t.issues.error + t.issues.warn > 0).length;
  el.textContent =
    '共 ' + s.tasks + ' 个任务 · 启用 ' + s.enabled + ' · 有异常 ' + warnTasks +
    ' · 问题 ' + s.issues.error + '/' + s.issues.warn + '/' + s.issues.info +
    (TSK.stale ? '（数据已变化，建议刷新）' : '');
}

function tskRenderTabs() {
  document.querySelectorAll('#taskTabs [data-task-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.taskTab === TSK.tab);
  });
  const panes = { detail: 'taskDetailPane', modules: 'taskModulesPane', health: 'taskHealthPane' };
  Object.entries(panes).forEach(([key, paneId]) => {
    const pane = tskEl(paneId);
    if (pane) pane.classList.toggle('hidden', key !== TSK.tab);
  });
}

function tskFlagMatch(task) {
  if (TSK.flag === 'enabled') return task.enabled;
  if (TSK.flag === 'disabled') return !task.enabled;
  if (TSK.flag === 'issues') return task.issues.error + task.issues.warn + task.issues.info > 0;
  return true;
}

function tskRenderList() {
  const ul = tskEl('taskList');
  const hint = tskEl('taskListHint');
  if (!ul) return;
  tskClear(ul);
  if (hint) hint.innerHTML = '';
  if (!TSK.data) {
    if (hint) hint.textContent = TSK.stale ? '正在加载任务数据...' : '正在加载...';
    return;
  }
  const focus = TSK.focusIds;
  const q = TSK.filter.trim().toLowerCase();
  const filtered = TSK.data.tasks.filter((t) => {
    if (focus) return focus.has(String(t.id));
    if (!tskFlagMatch(t)) return false;
    if (!q) return true;
    const hay = [
      t.id,
      t.name,
      t.module,
      t.file,
      t.conditions.join(' '),
      t.monsters.join(' '),
      t.items.join(' '),
      t.npcs.join(' ')
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
  if (hint && focus) {
    hint.textContent = '仅显示「' + (TSK.focusLabel || '筛选结果') + '」' + filtered.length + ' 个任务';
    hint.appendChild(tskButton('清除筛选', 'btn btn-sm tsk-hint-clear', () => tskClearFocus()));
  } else if (hint) {
    hint.textContent = filtered.length ? '显示 ' + filtered.length + ' 个任务' : '没有匹配的任务';
  }
  for (const t of filtered) {
    const li = document.createElement('li');
    li.className = 'file-item' + (String(t.id) === String(TSK.selected) ? ' active' : '');
    li.dataset.taskId = String(t.id);
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = '#' + t.id + ' ' + (t.name || '（未命名）');
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    const bad = t.issues.error + t.issues.warn;
    const level = t.levels ? 'Lv' + t.levels.min + (t.levels.max !== t.levels.min ? '-' + t.levels.max : '') : '无等级';
    meta.textContent = t.module + ' · ' + level + (t.enabled ? '' : ' · 未启用') + (bad ? ' · 异常 ' + bad : '');
    li.appendChild(name);
    li.appendChild(meta);
    li.addEventListener('click', () => tskSelect(t.id));
    ul.appendChild(li);
  }
}

function tskKv(label, value) {
  const box = document.createElement('div');
  box.className = 'tsk-kv';
  const k = document.createElement('span');
  k.className = 'tsk-kv-label';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'tsk-kv-value';
  v.textContent = value;
  box.appendChild(k);
  box.appendChild(v);
  return box;
}

function tskSection(title, note) {
  const sec = document.createElement('section');
  sec.className = 'tsk-section';
  const head = document.createElement('div');
  head.className = 'tsk-section-head';
  const h = document.createElement('h4');
  h.textContent = title;
  head.appendChild(h);
  if (note) {
    const n = document.createElement('span');
    n.className = 'act-cat';
    n.textContent = note;
    head.appendChild(n);
  }
  sec.appendChild(head);
  return sec;
}

function tskEmptyLine(text) {
  const div = document.createElement('div');
  div.className = 'tsk-empty';
  div.textContent = text;
  return div;
}

function tskTime(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const min = Math.round(seconds / 60);
  return seconds + ' 秒' + (min ? '（约 ' + min + ' 分钟）' : '');
}

function tskGotoTask(id) {
  const task = tskFind(id);
  if (!task) {
    toast('任务 ' + id + ' 未定义', 'err');
    return;
  }
  tskSelect(id);
}

function tskGotoMonster(name) {
  if (window.openMonsterWorkbench) window.openMonsterWorkbench(name);
}

async function tskGotoNpc(script) {
  if (!window.openNpcConfig) return;
  await window.openNpcConfig();
  if (S.mode !== 'cfgNpc') return;
  const input = tskEl('npcSearch');
  if (input) {
    input.value = script;
    input.dispatchEvent(new Event('input'));
  }
}

async function tskFocusTasks(ids, label) {
  TSK.focusIds = new Set((ids || []).map(String));
  TSK.focusLabel = label || '';
  TSK.filter = '';
  const input = tskEl('taskFilter');
  if (input) input.value = '';
  TSK.tab = 'detail';
  tskRenderTabs();
  tskRenderList();
}

function tskClearFocus() {
  TSK.focusIds = null;
  TSK.focusLabel = '';
  tskRenderList();
}

async function tskAfterWrite() {
  await tskLoad(true);
  TSK.detailId = '';
  if (TSK.focusIds) {
    const known = new Set(TSK.data.tasks.map((t) => String(t.id)));
    TSK.focusIds = new Set([...TSK.focusIds].filter((id) => known.has(id)));
    if (!TSK.focusIds.size) TSK.focusIds = null;
  }
  if (TSK.selected) await tskLoadDetail(TSK.selected);
  tskRenderAll();
  tskSetHash(TSK.selected);
  if (S.configs && S.configs.tasks && TSK.data) S.configs.tasks.tasks = TSK.data.stats.enabled;
}

function tskBackupNames(files) {
  return (files || []).map((f) => f.backup).filter(Boolean).map((b) => String(b).split(/[\\/]/).pop());
}

async function tskCleanupOrphans(switches) {
  const list = switches || [];
  if (!list.length) return;
  const sample = list.slice(0, 20).join(', ') + (list.length > 20 ? ' …' : '');
  if (
    !confirm(
      '将从所有模块的 TaskSwitchOnList 中移除 ' + list.length + ' 个没有对应任务定义的开关：\n' +
        sample +
        '\n\n写入前会自动备份，重启或重载服务端后生效。继续？'
    )
  )
    return;
  try {
    const res = await api('/api/config/task/cleanup-orphans', { method: 'POST' });
    const backups = tskBackupNames(res.files);
    toast(
      res.changed
        ? '已清理 ' + (res.ids || []).length + ' 个孤儿开关' +
            (backups.length ? '，已备份 ' + backups.join('、') : '') +
            '；重启或重载服务端后生效'
        : '没有可清理的孤儿开关',
      'ok'
    );
    await tskAfterWrite();
  } catch (e) {
    toast('清理失败：' + e.message, 'err');
  }
}

async function tskBatchModule(m, enabled) {
  if (!m) return;
  const count = enabled ? m.disabled : m.enabled;
  if (!count) return;
  const detail = enabled
    ? '会在 ' + m.file + ' 的 TaskSwitchOnList 中追加 ' + count + ' 个任务 ID。'
    : '会从所有模块的 TaskSwitchOnList 中移除 ' + count + ' 个任务 ID；若仍被其它任务或 NPC 引用，相关任务链可能中断。';
  if (
    !confirm(
      '将' + (enabled ? '启用' : '停用') + '模块 ' + m.id + ' 的 ' + count + ' 个任务。\n' +
        detail +
        '\n\n写入前自动备份，重启或重载服务端后生效。继续？'
    )
  )
    return;
  try {
    let res;
    try {
      res = await api('/api/config/task/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: m.id, enabled, force: !enabled })
      });
    } catch (e) {
      const deps = e.data && e.data.dependents;
      if (enabled || e.status !== 409 || !deps || !deps.total) throw e;
      const parts = [];
      if (deps.preTaskOf.length) parts.push(deps.preTaskOf.length + ' 个任务的前置条件');
      if (deps.prizeOf.length) parts.push(deps.prizeOf.length + ' 个任务的奖励跳转');
      if (deps.npcTasks.length) parts.push(deps.npcTasks.length + ' 个 NPC 任务列表');
      if (!confirm('部分任务仍被 ' + parts.join('、') + '引用。\n停用后相关任务链可能中断。仍要停用？')) return;
      res = await api('/api/config/task/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: m.id, enabled, force: true })
      });
    }
    const backups = tskBackupNames(res.files);
    toast(
      (res.enabled ? '已启用' : '已停用') + '模块 ' + m.id + ' 的 ' + res.count + ' 个任务' +
        (backups.length ? '，已备份 ' + backups.join('、') : '') +
        '；重启或重载服务端后生效',
      'ok'
    );
    await tskAfterWrite();
  } catch (e) {
    toast('批量操作失败：' + e.message, 'err');
  }
}

async function tskToggle(enabled) {
  const id = TSK.selected;
  if (!id) return;
  const btn = tskEl('btnTaskToggle');
  if (btn) btn.disabled = true;
  try {
    let res;
    try {
      res = await api('/api/config/task/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled })
      });
    } catch (e) {
      const deps = e.data && e.data.dependents;
      if (enabled || !deps || !deps.total) throw e;
      const parts = [];
      if (deps.preTaskOf.length) parts.push(deps.preTaskOf.length + ' 个任务的前置条件');
      if (deps.prizeOf.length) parts.push(deps.prizeOf.length + ' 个任务的奖励跳转');
      if (deps.npcTasks.length) parts.push(deps.npcTasks.length + ' 个 NPC 任务列表');
      if (!confirm('#' + id + ' 仍被 ' + parts.join('、') + '引用。\n停用后服务端重载时任务会被删除，相关任务链可能中断。仍要停用？')) return;
      res = await api('/api/config/task/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled, force: true })
      });
    }
    const backups = res.files
      ? res.files.map((f) => f.backup).filter(Boolean)
      : res.backup
        ? [res.backup]
        : [];
    toast(
      (res.enabled ? '已启用 #' : '已停用 #') +
        id +
        (backups.length ? '，已备份 ' + backups.map((b) => b.split(/[\\/]/).pop()).join('、') : '') +
        '；重启或重载服务端后生效',
      'ok'
    );
    await tskLoad(true);
    TSK.detailId = '';
    await tskLoadDetail(id);
    tskRenderAll();
    tskSetHash(id);
    if (S.configs && S.configs.tasks && TSK.data) S.configs.tasks.tasks = TSK.data.stats.enabled;
  } catch (e) {
    toast('操作失败：' + e.message, 'err');
  } finally {
    const again = tskEl('btnTaskToggle');
    if (again) again.disabled = false;
  }
}

function tskEnsureOptions() {
  if (TSK.options || TSK.optionsLoading) return;
  TSK.optionsLoading = true;
  api('/api/config/task/options')
    .then((opts) => {
      TSK.options = opts || { monsters: [], items: [] };
      if (S.mode === 'task' && TSK.tab === 'detail') tskRenderDetail();
    })
    .catch(() => {
      TSK.options = { monsters: [], items: [] };
    })
    .finally(() => {
      TSK.optionsLoading = false;
    });
}

function tskFillDatalist(id, values, labels) {
  let dl = document.getElementById(id);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = id;
    document.body.appendChild(dl);
  }
  if (dl.dataset.filled) return;
  values.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = String(v);
    if (labels && labels[i]) opt.textContent = labels[i];
    dl.appendChild(opt);
  });
  dl.dataset.filled = '1';
}

function tskRepairInput(kind, from) {
  const input = document.createElement('input');
  input.className = 'tsk-repair-input';
  if (kind === 'pretask' || kind === 'prize') {
    input.type = 'number';
    input.min = '1';
    input.placeholder = '任务 ID';
    if (TSK.data) {
      tskFillDatalist(
        'tskTaskIdOptions',
        TSK.data.tasks.map((t) => t.id),
        TSK.data.tasks.map((t) => '#' + t.id + ' ' + (t.name || ''))
      );
    }
    input.setAttribute('list', 'tskTaskIdOptions');
  } else {
    input.type = 'text';
    input.placeholder = kind === 'monster' ? '输入或选择怪物名' : '输入或选择物品名';
    const id = kind === 'monster' ? 'tskMonsterOptions' : 'tskItemOptions';
    if (TSK.options) tskFillDatalist(id, kind === 'monster' ? TSK.options.monsters : TSK.options.items);
    input.setAttribute('list', id);
  }
  return input;
}

function tskRepairRow(text, kind, from) {
  const row = document.createElement('div');
  row.className = 'tsk-repair-row';
  const label = document.createElement('span');
  label.className = 'tsk-repair-label';
  label.textContent = text;
  row.appendChild(label);
  const input = tskRepairInput(kind, from);
  row.appendChild(input);
  const btn = tskButton('保存', 'btn btn-sm primary', async () => {
    const to = input.value.trim();
    if (!to) {
      toast('请填写新值', 'err');
      return;
    }
    btn.disabled = true;
    try {
      await tskPatchDetail(kind, from, to);
    } finally {
      btn.disabled = false;
    }
  });
  row.appendChild(btn);
  return row;
}

function tskRepairSection(d) {
  const m = d.missing;
  if (!m) return null;
  const total =
    (m.monsters || []).length +
    (m.items || []).length +
    (m.preTasks || []).length +
    (m.prizeTasks || []).length;
  if (!total) return null;
  tskEnsureOptions();
  const sec = tskSection('配置修复', total + ' 项引用需要处理');
  (m.monsters || []).forEach((name) => {
    sec.appendChild(tskRepairRow('怪物「' + name + '」不在 Monster.DB，替换为：', 'monster', name));
  });
  (m.items || []).forEach((name) => {
    sec.appendChild(tskRepairRow('物品「' + name + '」不在 stditems.db，替换为：', 'item', name));
  });
  (m.preTasks || []).forEach((v) => {
    const abs = Math.abs(Number(v));
    sec.appendChild(
      tskRepairRow(
        '前置任务 #' + abs + ' 不存在' + (Number(v) < 0 ? '（原为未完成）' : '') + '，替换为：',
        'pretask',
        abs
      )
    );
  });
  (m.prizeTasks || []).forEach((v) => {
    sec.appendChild(tskRepairRow('奖励跳转任务 #' + v + ' 不存在，替换为：', 'prize', Number(v)));
  });
  return sec;
}

async function tskPatchDetail(kind, from, to) {
  const id = TSK.selected;
  if (!id) return;
  try {
    const res = await api('/api/config/task/patch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, kind, from, to })
    });
    const backup = res.backup ? String(res.backup).split(/[\\/]/).pop() : '';
    toast(
      '已修复任务 #' + id + (backup ? '，已备份 ' + backup : '') + '；重启或重载服务端后生效',
      'ok'
    );
    await tskAfterWrite();
  } catch (e) {
    toast('修复失败：' + e.message, 'err');
  }
}

function tskRenderDetail() {
  const box = tskEl('taskDetail');
  if (!box) return;
  tskClear(box);
  if (!TSK.selected) {
    box.appendChild(tskEmptyLine('在左侧选择一个任务查看详情，或用 #task=<ID> 打开。'));
    return;
  }
  if (TSK.detailLoading && String(TSK.detailId) !== String(TSK.selected)) {
    box.appendChild(tskEmptyLine('正在加载任务 #' + TSK.selected + ' ...'));
    return;
  }
  const d = TSK.detail;
  if (!d || String(d.id) !== String(TSK.selected)) {
    box.appendChild(tskEmptyLine('正在加载任务 #' + TSK.selected + ' ...'));
    return;
  }

  const head = document.createElement('div');
  head.className = 'tsk-head';
  const title = document.createElement('div');
  title.className = 'tsk-title';
  title.textContent = '#' + d.id + ' ' + (d.name || '（未命名）');
  head.appendChild(title);
  if (d.enabled) head.appendChild(tskChip('已启用', 'ok'));
  else head.appendChild(tskChip('未启用', 'warn'));
  if (d.generated) head.appendChild(tskChip('循环生成', 'info'));
  const cat = document.createElement('span');
  cat.className = 'act-cat';
  cat.textContent = d.module + ' · ' + d.moduleFile + ':' + d.line;
  head.appendChild(cat);
  const toggle = tskButton(
    d.enabled ? '停用任务' : '启用任务',
    d.enabled ? 'btn btn-sm' : 'btn btn-sm primary',
    () => tskToggle(!d.enabled)
  );
  toggle.id = 'btnTaskToggle';
  head.appendChild(toggle);
  box.appendChild(head);
  const hint = document.createElement('div');
  hint.className = 'act-cat';
  hint.textContent = '启用/停用只改写该模块的 TaskSwitchOnList，写入前自动备份；服务端重启或重载后生效。';
  box.appendChild(hint);

  const repair = tskRepairSection(d);
  if (repair) box.appendChild(repair);

  const grid = document.createElement('div');
  grid.className = 'tsk-grid';
  grid.appendChild(tskKv('任务脚本', (d.sourceFile || '未填写') + (d.sourceFile ? (d.scriptExists ? '（存在）' : '（缺失）') : '')));
  grid.appendChild(tskKv('任务状态', d.fields.TaskState == null ? '—' : String(d.fields.TaskState)));
  grid.appendChild(tskKv('限时', d.fields.TimeLimit == null ? '—' : tskTime(d.fields.TimeLimit)));
  grid.appendChild(tskKv('等级', d.fields.LevelList.length ? d.fields.LevelList.join(' / ') : '—'));
  grid.appendChild(tskKv('唯一 / 存档', (d.fields.UniqueFlag == null ? '—' : d.fields.UniqueFlag) + ' / ' + (d.fields.SaveFlag == null ? '—' : d.fields.SaveFlag)));
  grid.appendChild(tskKv('条件', d.conditions.length ? d.conditions.map((c) => c.label).join('、') : '—'));
  if (d.generated && d.baseId != null) {
    grid.appendChild(tskKv('基任务', '#' + d.baseId));
  }
  box.appendChild(grid);

  const pre = tskSection('前置任务', d.preTasks.length + ' 组');
  if (!d.preTasks.length) pre.appendChild(tskEmptyLine('无前置任务'));
  d.preTasks.forEach((group, gi) => {
    const row = document.createElement('div');
    row.className = 'tsk-pre-row';
    const tag = document.createElement('span');
    tag.className = 'tsk-pre-tag';
    tag.textContent = '组 ' + (gi + 1);
    row.appendChild(tag);
    group.forEach((ref) => {
      const label = '#' + Math.abs(ref.id) + (ref.negative ? ' 未完成' : '');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tsk-chip task' + (ref.exists ? '' : ' bad') + (ref.negative ? ' neg' : '');
      chip.textContent = label;
      chip.title = ref.exists ? '查看任务 #' + Math.abs(ref.id) : '任务未定义';
      chip.addEventListener('click', () => tskGotoTask(Math.abs(ref.id)));
      row.appendChild(chip);
    });
    pre.appendChild(row);
  });
  box.appendChild(pre);

  const npcSec = tskSection('状态 NPC', d.stateNpcMap.length + ' 个状态');
  if (!d.stateNpcMap.length) npcSec.appendChild(tskEmptyLine('未配置'));
  d.stateNpcMap.forEach((st) => {
    const row = document.createElement('div');
    row.className = 'tsk-state-row';
    const label = document.createElement('span');
    label.className = 'tsk-state-label';
    label.textContent = st.label;
    row.appendChild(label);
    st.npcs.forEach((npc) => {
      if (!npc) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tsk-chip npc';
      chip.textContent = npc;
      chip.title = '在 NPC 配置中搜索 ' + npc;
      chip.addEventListener('click', () => tskGotoNpc(npc));
      row.appendChild(chip);
    });
    npcSec.appendChild(row);
  });
  box.appendChild(npcSec);

  const missMon = new Set((d.missing && d.missing.monsters) || []);
  const monSec = tskSection('怪物', d.monsters.length + ' 个');
  if (!d.monsters.length && !d.monsterMap.length) monSec.appendChild(tskEmptyLine('未配置'));
  if (d.monsters.length) {
    const wrap = document.createElement('div');
    wrap.className = 'tsk-chips';
    d.monsters.forEach((name) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tsk-chip monster' + (missMon.has(name) ? ' bad' : '');
      chip.textContent = name;
      chip.title = missMon.has(name) ? 'Monster.DB 中不存在，可在上方「配置修复」中替换' : '打开怪物工作台';
      chip.addEventListener('click', () => tskGotoMonster(name));
      wrap.appendChild(chip);
    });
    monSec.appendChild(wrap);
  }
  if (d.monsterMap.length) {
    const table = document.createElement('table');
    table.className = 'tsk-table';
    table.innerHTML = '<thead><tr><th>怪物</th><th>数量</th><th>掉落</th><th>刷怪点</th><th>目标点</th></tr></thead>';
    const tbody = document.createElement('tbody');
    d.monsterMap.forEach((m) => {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'tsk-link' + (missMon.has(m.name) ? ' bad' : '');
      link.textContent = m.name;
      if (missMon.has(m.name)) link.title = 'Monster.DB 中不存在，可在上方「配置修复」中替换';
      link.addEventListener('click', () => tskGotoMonster(m.name));
      nameTd.appendChild(link);
      tr.appendChild(nameTd);
      tr.appendChild(document.createElement('td')).textContent = m.num == null ? '—' : String(m.num);
      tr.appendChild(document.createElement('td')).textContent = m.item || '—';
      tr.appendChild(document.createElement('td')).textContent = String(m.mobCordList.length);
      tr.appendChild(document.createElement('td')).textContent = String(m.destCordList.length);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    monSec.appendChild(table);
  }
  box.appendChild(monSec);

  const itemSec = tskSection('物品', d.items.length + ' 个');
  if (!d.items.length && !d.itemMap.length) itemSec.appendChild(tskEmptyLine('未配置'));
  if (d.items.length) {
    const wrap = document.createElement('div');
    wrap.className = 'tsk-chips';
    const missItem = new Set((d.missing && d.missing.items) || []);
    d.items.forEach((name) => {
      const chip = tskChip(name, missItem.has(name) ? 'item bad' : 'item');
      if (missItem.has(name)) chip.title = 'stditems.db 中不存在，可在上方「配置修复」中替换';
      wrap.appendChild(chip);
    });
    itemSec.appendChild(wrap);
  }
  if (d.itemMap.length) {
    const table = document.createElement('table');
    table.className = 'tsk-table';
    table.innerHTML = '<thead><tr><th>物品</th><th>参数</th></tr></thead>';
    const tbody = document.createElement('tbody');
    d.itemMap.forEach((it) => {
      const tr = document.createElement('tr');
      tr.appendChild(document.createElement('td')).textContent = it.name;
      tr.appendChild(document.createElement('td')).textContent = JSON.stringify(it.value);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    itemSec.appendChild(table);
  }
  box.appendChild(itemSec);

  const prizeSec = tskSection('状态奖励', d.statePrizeMap.length + ' 个状态');
  if (!d.statePrizeMap.length) prizeSec.appendChild(tskEmptyLine('未配置'));
  d.statePrizeMap.forEach((st) => {
    const sub = document.createElement('div');
    sub.className = 'tsk-sub';
    const h = document.createElement('div');
    h.className = 'tsk-sub-title';
    h.textContent = st.label;
    sub.appendChild(h);
    const table = document.createElement('table');
    table.className = 'tsk-table';
    table.innerHTML = '<thead><tr><th>几率</th><th>奖励</th></tr></thead>';
    const tbody = document.createElement('tbody');
    st.entries.forEach((e) => {
      const tr = document.createElement('tr');
      tr.appendChild(document.createElement('td')).textContent = e.chance == null ? '异常' : String(e.chance);
      const td = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'tsk-chips';
      e.items.forEach((it) => {
        if (it.pseudo) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'tsk-chip task' + (it.taskExists ? '' : ' bad');
          chip.textContent = it.name + ' → #' + it.taskId;
          chip.title = it.pseudo === 'next' ? '强制跳转任务' : '后置任务';
          chip.addEventListener('click', () => tskGotoTask(it.taskId));
          wrap.appendChild(chip);
        } else {
          wrap.appendChild(tskChip(it.name + ' ×' + it.count, 'item'));
        }
      });
      td.appendChild(wrap);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    sub.appendChild(table);
    prizeSec.appendChild(sub);
  });
  box.appendChild(prizeSec);

  const despSec = tskSection('状态对话', d.stateDespMap.length + ' 个状态');
  if (!d.stateDespMap.length) despSec.appendChild(tskEmptyLine('未配置'));
  d.stateDespMap.forEach((st) => {
    const sub = document.createElement('div');
    sub.className = 'tsk-sub';
    const h = document.createElement('div');
    h.className = 'tsk-sub-title';
    h.textContent = st.label;
    sub.appendChild(h);
    const pre = document.createElement('pre');
    pre.className = 'tsk-desc';
    pre.textContent = st.text;
    sub.appendChild(pre);
    despSec.appendChild(sub);
  });
  box.appendChild(despSec);

  const textBlocks = [
    ['任务描述', d.despList],
    ['故事背景', d.storyDespList],
    ['完成对话', d.fulfilDespList]
  ];
  textBlocks.forEach(([title, list]) => {
    if (!list.length) return;
    const sec = tskSection(title, list.length + ' 页');
    list.forEach((text, i) => {
      const pre = document.createElement('pre');
      pre.className = 'tsk-desc';
      pre.textContent = text;
      if (list.length > 1) {
        const label = document.createElement('div');
        label.className = 'tsk-sub-title';
        label.textContent = '第 ' + (i + 1) + ' 页';
        sec.appendChild(label);
      }
      sec.appendChild(pre);
    });
    box.appendChild(sec);
  });

  if (d.callbackList.length || d.callbackMap.length) {
    const sec = tskSection('回调', d.callbackList.length + ' 项');
    if (d.callbackList.length) {
      const wrap = document.createElement('div');
      wrap.className = 'tsk-chips';
      d.callbackList.forEach((n) => wrap.appendChild(tskChip(n, 'item')));
      sec.appendChild(wrap);
    }
    if (d.callbackMap.length) {
      const pre = document.createElement('pre');
      pre.className = 'tsk-desc';
      pre.textContent = d.callbackMap.map((c) => c.name + ': ' + JSON.stringify(c.value)).join('\n');
      sec.appendChild(pre);
    }
    box.appendChild(sec);
  }

  const funcs = [d.fields.CanUTFuncName, d.fields.UTFuncName, d.fields.TrigFuncName, d.fields.FulfilFuncName].filter(Boolean);
  if (funcs.length || Object.keys(d.extra).length) {
    const sec = tskSection('脚本函数与其它字段');
    const wrap = document.createElement('div');
    wrap.className = 'tsk-chips';
    funcs.forEach((f) => wrap.appendChild(tskChip(f, 'item')));
    if (wrap.childNodes.length) sec.appendChild(wrap);
    if (Object.keys(d.extra).length) {
      const pre = document.createElement('pre');
      pre.className = 'tsk-desc';
      pre.textContent = JSON.stringify(d.extra, null, 1);
      sec.appendChild(pre);
    }
    box.appendChild(sec);
  }
}

function tskRenderModules() {
  const box = tskEl('taskModuleCards');
  if (!box) return;
  tskClear(box);
  if (!TSK.data) {
    box.appendChild(tskEmptyLine('正在加载任务数据...'));
    return;
  }
  for (const m of tskModules()) {
    const card = document.createElement('div');
    card.className = 'act-card tsk-module-card';
    const head = document.createElement('div');
    head.className = 'act-card-head';
    const name = document.createElement('strong');
    name.textContent = m.id;
    head.appendChild(name);
    const badge = document.createElement('span');
    badge.className = 'act-status ' + (m.error ? 'error' : m.issues.error ? 'error' : m.issues.warn ? 'warn' : 'ok');
    badge.textContent = m.error ? '解析失败' : m.issues.error ? '有错误' : m.issues.warn ? m.issues.warn + ' 警告' : '正常';
    head.appendChild(badge);
    card.appendChild(head);
    const file = document.createElement('div');
    file.className = 'act-cat';
    file.textContent = m.file;
    card.appendChild(file);
    const metrics = document.createElement('div');
    metrics.className = 'act-metrics';
    [
      ['任务', m.tasks],
      ['启用', m.enabled],
      ['未启用', m.disabled],
      ['NPC', m.npcs],
      ['开关', m.switches]
    ].forEach(([label, value]) => {
      const chip = document.createElement('span');
      chip.className = 'act-metric';
      const b = document.createElement('b');
      b.textContent = String(value);
      const l = document.createElement('span');
      l.textContent = label;
      chip.appendChild(b);
      chip.appendChild(l);
      metrics.appendChild(chip);
    });
    card.appendChild(metrics);
    if (m.error) {
      const err = document.createElement('div');
      err.className = 'act-desc';
      err.textContent = m.error;
      card.appendChild(err);
    }
    const foot = document.createElement('div');
    foot.className = 'act-foot';
    const open = tskButton('查看该模块任务', 'btn btn-sm', () => {
      TSK.focusIds = null;
      TSK.focusLabel = '';
      TSK.filter = m.id;
      const input = tskEl('taskFilter');
      if (input) input.value = m.id;
      TSK.tab = 'detail';
      tskRenderTabs();
      tskRenderList();
    });
    foot.appendChild(open);
    if (m.disabled > 0) {
      foot.appendChild(tskButton('启用未启用 (' + m.disabled + ')', 'btn btn-sm', () => tskBatchModule(m, true)));
    }
    if (m.enabled > 0) {
      foot.appendChild(tskButton('停用已启用 (' + m.enabled + ')', 'btn btn-sm', () => tskBatchModule(m, false)));
    }
    card.appendChild(foot);
    box.appendChild(card);
  }
}

function tskIssueRow(issue) {
  const row = document.createElement('div');
  row.className = 'mon-issue';
  const sev = document.createElement('span');
  sev.className = 'mon-sev ' + issue.severity;
  sev.textContent = TSK_SEV[issue.severity] || issue.severity;
  row.appendChild(sev);
  const body = document.createElement('div');
  body.className = 'mon-issue-body';
  const msg = document.createElement('div');
  msg.textContent = (TSK_ISSUE_LABELS[issue.code] || issue.code) + '：' + issue.message;
  body.appendChild(msg);
  const meta = document.createElement('div');
  meta.className = 'act-issue-meta';
  meta.textContent = [issue.file, issue.line ? '第 ' + issue.line + ' 行' : ''].filter(Boolean).join(' · ');
  if (meta.textContent) body.appendChild(meta);
  row.appendChild(body);
  const actions = document.createElement('div');
  actions.className = 'tsk-issue-actions';
  if (issue.code === 'task_switch_orphan' && issue.switches && issue.switches.length) {
    actions.appendChild(
      tskButton('清理孤儿开关 (' + issue.switches.length + ')', 'btn btn-sm', () => tskCleanupOrphans(issue.switches))
    );
  }
  if (issue.tasks && issue.tasks.length) {
    const repairable = [
      'task_monster_missing',
      'task_item_missing',
      'task_pretask_missing',
      'task_prize_target_missing'
    ].includes(issue.code);
    actions.appendChild(
      tskButton((repairable ? '去修复' : '查看涉及任务') + ' (' + issue.tasks.length + ')', 'btn btn-sm', () => {
        tskFocusTasks(issue.tasks, TSK_ISSUE_LABELS[issue.code] || issue.code);
        if (repairable) tskSelect(issue.tasks[0]);
      })
    );
  }
  if (issue.jump && issue.jump.task != null) {
    actions.appendChild(tskButton('查看任务', 'btn btn-sm', () => tskGotoTask(issue.jump.task)));
  }
  if (actions.childNodes.length) row.appendChild(actions);
  return row;
}

function tskRenderHealth() {
  const box = tskEl('taskHealthList');
  if (!box) return;
  tskClear(box);
  if (!TSK.data) {
    box.appendChild(tskEmptyLine('正在加载任务数据...'));
    return;
  }
  const groups = new Map();
  for (const issue of TSK.data.issues) {
    const scope = issue.scope || 'global';
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(issue);
  }
  const order = [...tskModules().map((m) => m.id), 'global'];
  for (const scope of order) {
    const issues = groups.get(scope) || [];
    const mod = tskModules().find((m) => m.id === scope);
    const taskWarn = mod ? TSK.data.tasks.filter((t) => t.module === mod.id && t.issues.error + t.issues.warn > 0).length : 0;
    if (!mod && !issues.length) continue;
    const group = document.createElement('div');
    group.className = 'mon-issue-group';
    const head = document.createElement('div');
    head.className = 'mon-issue-head';
    const title = document.createElement('span');
    title.textContent = scope === 'global' ? '全局 / 跨模块' : mod ? mod.id + ' · ' + mod.file : scope;
    head.appendChild(title);
    if (mod) {
      const counts = document.createElement('span');
      counts.className = 'act-cat';
      counts.textContent = '错误 ' + mod.issues.error + ' · 警告 ' + mod.issues.warn + ' · 提示 ' + mod.issues.info;
      head.appendChild(counts);
    }
    group.appendChild(head);
    if (mod && mod.error) {
      group.appendChild(tskIssueRow({ code: 'task_parse_error', severity: 'error', message: mod.error, file: mod.file }));
    }
    if (taskWarn) {
      const row = document.createElement('div');
      row.className = 'mon-issue';
      const sev = document.createElement('span');
      sev.className = 'mon-sev warn';
      sev.textContent = '警告';
      row.appendChild(sev);
      const body = document.createElement('div');
      body.className = 'mon-issue-body';
      const msg = document.createElement('div');
      msg.textContent = mod.id + ' 有 ' + taskWarn + ' 个任务存在怪物/物品/前置任务等问题，可在左侧用「有异常」筛选。';
      body.appendChild(msg);
      row.appendChild(body);
      row.appendChild(
        tskButton('筛选异常', 'btn btn-sm', () => {
          TSK.focusIds = null;
          TSK.focusLabel = '';
          TSK.flag = 'issues';
          TSK.filter = mod.id;
          const input = tskEl('taskFilter');
          if (input) input.value = mod.id;
          document.querySelectorAll('#taskFlagFilter [data-task-flag]').forEach((b) => {
            b.classList.toggle('active', b.dataset.taskFlag === 'issues');
          });
          TSK.tab = 'detail';
          tskRenderTabs();
          tskRenderList();
        })
      );
      group.appendChild(row);
    }
    issues.forEach((issue) => group.appendChild(tskIssueRow(issue)));
    if (mod && !mod.error && !taskWarn && !issues.length) {
      const clear = document.createElement('div');
      clear.className = 'mon-empty';
      clear.textContent = '未发现问题。';
      group.appendChild(clear);
    }
    box.appendChild(group);
  }
  if (!box.childNodes.length) {
    box.appendChild(tskEmptyLine('未发现问题。'));
  }
}

function tskRenderAll() {
  tskRenderTabs();
  tskRenderMeta();
  tskRenderList();
  tskRenderDetail();
  tskRenderModules();
  tskRenderHealth();
  if (TSK.data) {
    tskText('taskCount', String(TSK.data.stats.enabled));
    const count = tskEl('taskCount');
    if (count) count.title = '已启用任务 / 总任务 ' + TSK.data.stats.enabled + ' / ' + TSK.data.stats.tasks;
  }
}

async function tskSelect(id) {
  TSK.selected = String(id);
  TSK.tab = 'detail';
  tskRenderTabs();
  tskRenderList();
  const row = document.querySelector('[data-task-id="' + id + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
  await tskLoadDetail(id);
  tskRenderDetail();
  tskSetHash(id);
  tskRenderMeta();
}

async function openTaskView(tab, id) {
  if (S.mode !== 'task' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  if (tab) TSK.tab = tab;
  S.mode = 'task';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
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
  const dbView = tskEl('dbView');
  const dropView = tskEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = tskEl('taskView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('tsk');
  tskRenderAll();
  if (!TSK.data || TSK.stale) {
    try {
      await tskLoad(true);
      tskRenderAll();
    } catch (e) {
      tskRenderAll();
      toast('加载任务配置失败：' + e.message, 'err');
    }
  }
  const target = id || TSK.selected;
  if (target) await tskSelect(target);
  else tskSetHash('');
}

window.openTaskView = openTaskView;
window.hideTaskView = () => {
  const view = tskEl('taskView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && tskHashName()) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshTaskState = (st) => {
  const info = st && st.configs ? st.configs.tasks : null;
  if (info && info.tasks != null) {
    tskText('taskCount', String(info.tasks));
  }
  TSK.stale = true;
  if (S.mode === 'task') tskRenderMeta();
};
window.updateTaskMeta = tskRenderMeta;

function tskBindEvents() {
  const filter = tskEl('taskFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(TSK.searchTimer);
      TSK.searchTimer = setTimeout(() => {
        TSK.filter = filter.value;
        if (TSK.focusIds) {
          TSK.focusIds = null;
          TSK.focusLabel = '';
        }
        tskRenderList();
      }, 150);
    });
  }
  document.querySelectorAll('#taskFlagFilter [data-task-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      TSK.flag = btn.dataset.taskFlag;
      TSK.focusIds = null;
      TSK.focusLabel = '';
      document.querySelectorAll('#taskFlagFilter [data-task-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      tskRenderList();
    });
  });
  const tabs = tskEl('taskTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-task-tab]');
      if (!btn) return;
      TSK.tab = btn.dataset.taskTab;
      tskRenderTabs();
    });
  }
  const reload = tskEl('btnTaskReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        await tskLoad(true);
        TSK.detailId = '';
        if (TSK.selected) await tskLoadDetail(TSK.selected);
        tskRenderAll();
        tskSetHash(TSK.selected);
        toast('任务配置已重新检查', 'ok');
      } catch (e) {
        tskRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const name = tskHashName();
    if (name) openTaskView(undefined, name);
  });
}

tskBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const name = tskHashName();
    if (name) openTaskView(undefined, name);
  });
} else {
  window.addEventListener('app-ready', () => {
    const name = tskHashName();
    if (name) openTaskView(undefined, name);
  });
}

'use strict';

const ACT = {
  data: null,
  loading: null,
  error: null,
  stale: false,
  tab: 'overview',
  filter: '',
  flag: 'all',
  selected: '',
  searchTimer: null,
  options: null,
  optionsLoading: null
};

const ACT_STATUS = { ok: '正常', warn: '警告', error: '异常', info: '提示' };
const ACT_SEV = { error: '错误', warn: '警告', info: '提示' };
const ACT_ISSUE_LABELS = {
  activity_file_missing: '文件缺失',
  activity_file_unreadable: '文件不可读',
  activity_dir_missing: '目录缺失',
  activity_line_invalid: '行格式异常',
  xml_root_invalid: 'XML 无节点',
  xml_monster_missing: '怪物未收录',
  xml_item_missing: '奖励未收录',
  xml_prob_invalid: '概率异常',
  xml_num_invalid: '数量异常',
  xml_attr_invalid: '属性异常',
  xml_copy_mismatch: '副本不一致',
  gemrand_not_monotonic: '数值非递增',
  gemrand_rate_range: '数值越界',
  gemrand_level_invalid: '等级异常',
  globeparams_switch_invalid: '开关取值异常',
  dialog_placeholder: '占位文本',
  dialog_section_empty: '对话为空',
  recharge_item_missing: '礼包物品未知',
  recharge_chance_invalid: '礼包概率异常',
  yb_zero_byte: '充值队列为空',
  yb_name_duplicate: '充值队列重名',
  yb_script_absolute_path: '脚本绝对路径',
  inferno_field_empty: '空字段',
  inferno_value_invalid: '数值列异常',
  sabuk_prize_type_unknown: '沙巴克奖励类型',
  gaimprize_count_mismatch: '改名奖励数量不符',
  ops_quiz_invalid: '答题格式异常',
  notice_file_unreadable: '公告读取失败',
  rank_script_missing: '榜单脚本缺失',
  rank_npc_missing: 'NPC 未引用',
  npc_list_unreadable: 'NPCList 不可读'
};

function actEl(id) {
  return document.getElementById(id);
}

function actText(id, text) {
  const el = actEl(id);
  if (el) el.textContent = text;
}

function actClear(el) {
  if (el) el.innerHTML = '';
}

function actHashName() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash.startsWith('activity=')) return '';
  return decodeURIComponent(hash.slice('activity='.length));
}

function actSetHash(name) {
  const base = location.pathname + location.search;
  const next = base + (name ? '#activity=' + encodeURIComponent(name) : '');
  try {
    history.replaceState(null, '', next);
  } catch (e) {
  }
}

function actFindActivity(id) {
  if (!ACT.data) return null;
  return ACT.data.activities.find((a) => a.id === id) || null;
}

function actFindFile(name) {
  if (!ACT.data) return null;
  for (const activity of ACT.data.activities) {
    const file = activity.files.find((f) => f.name === name);
    if (file) return { activity, file };
  }
  return null;
}

function actFindRanking(id) {
  if (!ACT.data) return null;
  return ACT.data.rankings.find((r) => r.id === id) || null;
}

async function actLoad(force) {
  if (ACT.loading) return ACT.loading;
  ACT.error = null;
  ACT.loading = api('/api/config/activity')
    .then((data) => {
      ACT.data = data;
      ACT.stale = false;
      return data;
    })
    .catch((e) => {
      ACT.error = e.message;
      throw e;
    })
    .finally(() => {
      ACT.loading = null;
    });
  return ACT.loading;
}

async function actOpenNpc(name) {
  if (window.hideActivityView) window.hideActivityView();
  try {
    if (window.openNpcConfig) await window.openNpcConfig();
    const input = actEl('npcSearch');
    if (input) {
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch (e) {
    toast('打开 NPC 分布失败：' + e.message, 'err');
  }
}

function actGotoFile(file) {
  if (!file || !file.exists) return toast('文件不存在：' + (file ? file.name : ''), 'err');
  if (file.view === 'extra' && window.openExtraKey) return window.openExtraKey(file.key);
  if (file.view === 'ops' && window.openOpsConfig) return window.openOpsConfig(false, file.tab || 'notices');
  if (file.dir) return toast(file.name + ' 是指标目录，无法直接编辑', 'err');
  toast('该文件没有可视化编辑器：' + file.name, 'err');
}

function actGotoEditor(editor) {
  if (!editor) return;
  if (editor.view === 'extra' && window.openExtraKey) return window.openExtraKey(editor.key);
  if (editor.view === 'ops' && window.openOpsConfig) return window.openOpsConfig(false, editor.tab || 'notices');
}

function actIssueJump(issue) {
  if (!issue) return null;
  if (issue.activityId.startsWith('rank:')) {
    const rank = actFindRanking(issue.activityId.slice(5));
    if (rank && issue.code === 'rank_npc_missing' && issue.message.indexOf('「') >= 0) {
      return { text: '查看 NPC', npc: rank.npc };
    }
    if (rank) return { text: '查看 NPC', npc: rank.npc };
    return null;
  }
  const found = issue.file ? actFindFile(issue.file) : null;
  if (found && found.file.exists) {
    const file = found.file;
    if (file.view === 'extra' && file.key) {
      const target = issue.target || (issue.line ? { editor: 'extra', key: file.key, line: issue.line } : null);
      return { text: target ? '去修复' : '打开文件', file, target };
    }
    if (file.view === 'ops') return { text: '打开文件', file };
  }
  if (issue.target && issue.target.editor === 'extra' && issue.target.key) {
    return { text: '去修复', key: issue.target.key, target: issue.target };
  }
  const activity = actFindActivity(issue.activityId);
  if (activity && activity.editors.length) {
    return { text: '打开活动', editor: activity.editors[0] };
  }
  return null;
}

function actRepairPath(jump) {
  if (!jump || !jump.target) return null;
  if (jump.file) return { file: jump.file, target: jump.target };
  if (jump.key) return { file: { name: jump.key, view: 'extra', key: jump.key, exists: true }, target: jump.target };
  return null;
}

function actOpenFileAt(file, target) {
  if (!file || !file.exists) return toast('文件不存在：' + (file ? file.name : ''), 'err');
  if (file.view === 'extra' && window.openExtraKeyAt) {
    return window.openExtraKeyAt(file.key, target).then((focused) => {
      if (!focused) toast('已打开文件，但没有定位到问题行（可能行格式无法识别）', 'warn');
    }).catch((e) => toast('打开配置失败：' + e.message, 'err'));
  }
  return actGotoFile(file);
}

function actEnsureOptions() {
  if (ACT.options) return Promise.resolve(ACT.options);
  if (ACT.optionsLoading) return ACT.optionsLoading;
  ACT.optionsLoading = api('/api/config/task/options')
    .then((res) => {
      ACT.options = {
        monsters: (res && res.monsters) || [],
        items: (res && res.items) || []
      };
      return ACT.options;
    })
    .catch(() => {
      ACT.options = { monsters: [], items: [] };
      return ACT.options;
    })
    .finally(() => {
      ACT.optionsLoading = null;
    });
  return ACT.optionsLoading;
}

function actFillDatalist(id, values) {
  let dl = document.getElementById(id);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = id;
    document.body.appendChild(dl);
  }
  const list = values || [];
  if (dl.dataset.filled === String(list.length)) return;
  dl.dataset.filled = String(list.length);
  dl.innerHTML = '';
  for (const value of list) {
    const opt = document.createElement('option');
    opt.value = value;
    dl.appendChild(opt);
  }
}

function actRepairPatch(data, repair, value) {
  const from = repair.from == null ? '' : String(repair.from);
  if (data.mode === 'xml') {
    const rows = data.rows || [];
    let row = null;
    if (repair.index != null) row = rows.find((r) => r.index === Number(repair.index)) || null;
    if (!row && repair.line) row = rows.find((r) => r.line === Number(repair.line) - 1) || null;
    if (!row) throw new Error('未找到对应 XML 节点，可能已被修改');
    if (from && String(row.attrs[repair.field]) !== from) throw new Error('节点内容已变化，请刷新后重试');
    const hits = from ? rows.filter((r) => String(r.attrs[repair.field]) === from) : [row];
    return {
      changes: hits.map((r) => ({
        index: r.index,
        values: { ...r.attrs, [repair.field]: value }
      }))
    };
  }
  if (data.mode === 'table') {
    const rows = data.rows || [];
    let row = null;
    if (repair.index != null) row = rows.find((r) => r.index === Number(repair.index)) || null;
    if (!row && repair.line) row = rows.find((r) => r.index === Number(repair.line) - 1) || null;
    if (!row) throw new Error('未找到对应配置行，可能已被修改');
    if (from && String(row.values[repair.field]) !== from) throw new Error('行内容已变化，请刷新后重试');
    const hits = from ? rows.filter((r) => String(r.values[repair.field]) === from) : [row];
    return {
      changes: hits.map((r) => {
        const values = r.values.slice();
        values[repair.field] = value;
        return { index: r.index, values };
      })
    };
  }
  throw new Error('该配置类型不支持一键修复');
}

async function actPatchIssue(issue, value, btn) {
  const repair = issue.target;
  if (!repair || !repair.key) return;
  const kindName = repair.kind === 'monster' ? '怪物' : '物品';
  if (!value) return toast('请输入新的' + kindName + '名称', 'err');
  if (repair.from && value === repair.from) return toast('新名称与原名称相同', 'err');
  const list = repair.kind === 'monster'
    ? ((ACT.options && ACT.options.monsters) || [])
    : ((ACT.options && ACT.options.items) || []);
  if (list.length && !list.includes(value)) return toast(`「${value}」不在${kindName}数据库中`, 'err');
  if (btn) btn.disabled = true;
  try {
    const data = await api('/api/config/extra/data?key=' + encodeURIComponent(repair.key));
    const payload = actRepairPatch(data, repair, value);
    const res = await api('/api/config/extra/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: repair.key, payload })
    });
    const count = (payload.changes || []).length;
    toast(`已修复 ${count} 处：${repair.from || '（空）'} → ${value}` + (res.backup ? '\n备份：' + res.backup : ''), 'ok');
    ACT.stale = true;
    await actLoad(true);
    actRenderAll();
    if (typeof refreshState === 'function') refreshState().catch(() => {});
  } catch (e) {
    toast('修复失败：' + e.message, 'err');
    if (btn) btn.disabled = false;
  }
}

function actRepairInput(issue) {
  const repair = issue.target;
  const wrap = document.createElement('div');
  wrap.className = 'act-repair';
  const label = document.createElement('span');
  label.className = 'act-repair-label';
  label.textContent = repair.kind === 'monster' ? '改为怪物' : '改为物品';
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'act-repair-input';
  input.autocomplete = 'off';
  input.placeholder = repair.from ? `替换「${repair.from}」为…` : '填写缺失名称…';
  if (ACT.options) {
    const listId = repair.kind === 'monster' ? 'actRepairMonsters' : 'actRepairItems';
    actFillDatalist(listId, repair.kind === 'monster' ? ACT.options.monsters : ACT.options.items);
    input.setAttribute('list', listId);
  } else {
    actEnsureOptions().then(() => {
      if (ACT.tab === 'health' && S.mode === 'activity') actRenderHealth();
    });
  }
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small';
  btn.textContent = '保存修复';
  btn.addEventListener('click', () => actPatchIssue(issue, input.value.trim(), btn));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn.click();
    }
  });
  wrap.appendChild(btn);
  return wrap;
}

function actStatusBadge(status) {
  const span = document.createElement('span');
  span.className = 'act-status ' + status;
  span.textContent = ACT_STATUS[status] || status;
  return span;
}

function actMetricChip(metric) {
  const span = document.createElement('span');
  span.className = 'act-metric';
  const b = document.createElement('b');
  b.textContent = String(metric.value);
  const label = document.createElement('span');
  label.textContent = metric.label;
  span.appendChild(b);
  span.appendChild(label);
  return span;
}

function actFileChip(activity, file) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'act-file' + (file.exists ? '' : ' bad') + (file.dir ? ' dir' : '');
  btn.textContent = file.dir
    ? `${file.name}/ (${file.fileCount || 0})`
    : file.name + (file.exists ? '' : ' · 缺失');
  btn.title = file.role + (file.exists ? '' : ' · 文件不存在') + (file.dir ? ' · 目录' : '');
  btn.addEventListener('click', () => actGotoFile(file));
  return btn;
}

function actRenderList() {
  const ul = actEl('actList');
  if (!ul) return;
  actClear(ul);
  if (!ACT.data) {
    actText('actListHint', ACT.error ? '检查失败：' + ACT.error : '正在加载活动数据...');
    return;
  }
  const q = ACT.filter.trim().toLowerCase();
  const all = ACT.data.activities;
  const filtered = all.filter((a) => {
    if (q) {
      const hay = (a.name + ' ' + a.id + ' ' + a.desc + ' ' + a.files.map((f) => f.name).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (ACT.flag === 'issues') {
      if (!a.issues.error && !a.issues.warn && !a.issues.info) return false;
    } else if (ACT.flag === 'missing') {
      if (!a.files.some((f) => !f.exists)) return false;
    }
    return true;
  });
  for (const a of filtered) {
    const li = document.createElement('li');
    li.className = 'file-item' + (ACT.selected === a.id ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = a.name;
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    const bad = a.issues.error + a.issues.warn;
    meta.textContent = `${a.fileCount} 个文件` + (bad ? ` · 异常 ${bad}` : a.issues.info ? ` · 提示 ${a.issues.info}` : ' · 正常');
    li.appendChild(name);
    li.appendChild(meta);
    li.title = a.name + ' · ' + a.category;
    li.addEventListener('click', () => actSelect(a.id));
    ul.appendChild(li);
  }
  let hint = `${filtered.length}/${all.length} 个活动`;
  const missing = all.reduce((n, a) => n + a.files.filter((f) => !f.exists).length, 0);
  if (missing) hint += ` · 缺失文件 ${missing}`;
  actText('actListHint', hint);
  document.querySelectorAll('#actFlagFilter [data-act-flag]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.actFlag === ACT.flag);
  });
}

function actRenderCards() {
  const box = actEl('activityCards');
  if (!box) return;
  actClear(box);
  if (!ACT.data) {
    const empty = document.createElement('div');
    empty.className = 'act-empty';
    empty.textContent = ACT.error ? '检查失败：' + ACT.error : '正在加载活动数据...';
    box.appendChild(empty);
    return;
  }
  for (const a of ACT.data.activities) {
    const card = document.createElement('div');
    card.className = 'act-card' + (ACT.selected === a.id ? ' selected' : '');
    card.dataset.actCard = a.id;

    const head = document.createElement('div');
    head.className = 'act-card-head';
    const title = document.createElement('strong');
    title.textContent = a.name;
    head.appendChild(title);
    head.appendChild(actStatusBadge(a.status));
    card.appendChild(head);

    const cat = document.createElement('div');
    cat.className = 'act-cat';
    cat.textContent = a.category;
    card.appendChild(cat);

    const desc = document.createElement('div');
    desc.className = 'act-desc';
    desc.textContent = a.desc;
    card.appendChild(desc);

    if (a.metrics.length) {
      const metrics = document.createElement('div');
      metrics.className = 'act-metrics';
      for (const m of a.metrics) metrics.appendChild(actMetricChip(m));
      card.appendChild(metrics);
    }

    const files = document.createElement('div');
    files.className = 'act-files';
    for (const f of a.files) files.appendChild(actFileChip(a, f));
    card.appendChild(files);

    const foot = document.createElement('div');
    foot.className = 'act-foot';
    if (a.editors.length) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn small';
      edit.textContent = '打开编辑器';
      edit.addEventListener('click', () => actGotoEditor(a.editors[0]));
      foot.appendChild(edit);
    }
    const total = a.issues.error + a.issues.warn + a.issues.info;
    if (total) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small ghost';
      btn.textContent = `异常 ${total}`;
      btn.title = `错误 ${a.issues.error} · 警告 ${a.issues.warn} · 提示 ${a.issues.info}`;
      btn.addEventListener('click', () => actFocusHealth(a.id));
      foot.appendChild(btn);
    } else {
      const ok = document.createElement('span');
      ok.className = 'act-ok';
      ok.textContent = '未发现问题';
      foot.appendChild(ok);
    }
    card.appendChild(foot);

    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      actSelect(a.id);
    });
    box.appendChild(card);
  }
}

function actRenderRankings() {
  const box = actEl('activityRankingCards');
  if (!box) return;
  actClear(box);
  if (!ACT.data) {
    const empty = document.createElement('div');
    empty.className = 'act-empty';
    empty.textContent = ACT.error ? '检查失败：' + ACT.error : '正在加载榜单数据...';
    box.appendChild(empty);
    return;
  }
  for (const r of ACT.data.rankings) {
    const card = document.createElement('div');
    card.className = 'act-card act-rank-card';

    const head = document.createElement('div');
    head.className = 'act-card-head';
    const title = document.createElement('strong');
    title.textContent = r.name;
    head.appendChild(title);
    const badge = document.createElement('span');
    badge.className = 'act-status ' + (r.npcFound ? 'ok' : 'warn');
    badge.textContent = r.npcFound ? 'NPC 存在' : 'NPC 缺失';
    head.appendChild(badge);
    card.appendChild(head);

    const npc = document.createElement('div');
    npc.className = 'act-desc';
    npc.textContent = 'NPC：' + r.npc + ' · 数据源：' + r.dataSource;
    card.appendChild(npc);

    const scripts = document.createElement('div');
    scripts.className = 'act-files';
    for (const s of r.scripts) {
      const chip = document.createElement('span');
      chip.className = 'act-file' + (s.exists ? '' : ' bad') + (s.exists && !s.referenced ? ' warn' : '');
      chip.textContent = s.name + (s.exists ? (s.referenced ? '' : ' · 未引用') : ' · 缺失');
      chip.title = s.exists ? (s.referenced ? '已被 NPCList 引用' : '脚本存在，但没有 NPC 调用') : '脚本文件不存在';
      scripts.appendChild(chip);
    }
    card.appendChild(scripts);

    const notes = document.createElement('div');
    notes.className = 'act-desc act-notes';
    notes.textContent = r.notes;
    card.appendChild(notes);

    const foot = document.createElement('div');
    foot.className = 'act-foot';
    if (r.npcFound) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = '查看 NPC 分布';
      btn.addEventListener('click', () => actOpenNpc(r.npc));
      foot.appendChild(btn);
    }
    card.appendChild(foot);
    box.appendChild(card);
  }
}

function actIssueRow(issue) {
  const row = document.createElement('div');
  row.className = 'mon-issue';
  row.dataset.actIssue = issue.code;
  const patchable = Boolean(issue.target && issue.target.key &&
    (issue.target.kind === 'monster' || issue.target.kind === 'item') &&
    issue.target.field != null);
  if (patchable) row.classList.add('act-issue-main');

  const sev = document.createElement('span');
  sev.className = 'mon-sev ' + issue.severity;
  sev.textContent = ACT_SEV[issue.severity] || issue.severity;
  row.appendChild(sev);

  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.textContent = (ACT_ISSUE_LABELS[issue.code] || issue.code) + '：' + issue.message;
  msg.title = issue.code;
  row.appendChild(msg);

  if (issue.file) {
    const meta = document.createElement('span');
    meta.className = 'act-issue-meta';
    meta.textContent = issue.file + (issue.line ? ':' + issue.line : '');
    row.appendChild(meta);
  }

  const jump = actIssueJump(issue);
  if (jump) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small ghost';
    btn.textContent = jump.text;
    btn.addEventListener('click', () => {
      const at = actRepairPath(jump);
      if (at) actOpenFileAt(at.file, at.target);
      else if (jump.file) actGotoFile(jump.file);
      else if (jump.editor) actGotoEditor(jump.editor);
      else if (jump.npc) actOpenNpc(jump.npc);
    });
    row.appendChild(btn);
  }
  if (patchable) row.appendChild(actRepairInput(issue));
  return row;
}

function actHealthGroup(title, id, issues) {
  const group = document.createElement('div');
  group.className = 'mon-issue-group';
  group.dataset.actGroup = id;
  const head = document.createElement('div');
  head.className = 'mon-issue-head';
  const strong = document.createElement('strong');
  strong.textContent = title;
  head.appendChild(strong);
  const badge = document.createElement('span');
  badge.className = 'count';
  badge.textContent = String(issues.length);
  head.appendChild(badge);
  group.appendChild(head);
  if (!issues.length) {
    const empty = document.createElement('div');
    empty.className = 'mon-empty';
    empty.textContent = '未发现问题';
    group.appendChild(empty);
    return group;
  }
  for (const issue of issues) group.appendChild(actIssueRow(issue));
  return group;
}

function actRenderHealth() {
  const list = actEl('activityHealthList');
  if (!list) return;
  actClear(list);
  if (!ACT.data) {
    const empty = document.createElement('div');
    empty.className = 'act-empty';
    empty.textContent = ACT.error ? '检查失败：' + ACT.error : '正在加载体检结果...';
    list.appendChild(empty);
    return;
  }
  const byActivity = new Map();
  for (const issue of ACT.data.issues) {
    if (!byActivity.has(issue.activityId)) byActivity.set(issue.activityId, []);
    byActivity.get(issue.activityId).push(issue);
  }
  for (const a of ACT.data.activities) {
    list.appendChild(actHealthGroup(a.name, a.id, byActivity.get(a.id) || []));
  }
  for (const r of ACT.data.rankings) {
    const issues = byActivity.get('rank:' + r.id) || [];
    if (issues.length) list.appendChild(actHealthGroup('榜单 · ' + r.name, 'rank:' + r.id, issues));
  }
  const globalIssues = byActivity.get('') || [];
  if (globalIssues.length) list.appendChild(actHealthGroup('全局检查', '', globalIssues));
}

function actRenderTabs() {
  document.querySelectorAll('#actTabs [data-act-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.actTab === ACT.tab);
  });
  const panes = { overview: 'actOverview', rankings: 'actRankings', health: 'actHealth' };
  for (const [key, id] of Object.entries(panes)) {
    const el = actEl(id);
    if (el) el.classList.toggle('hidden', key !== ACT.tab);
  }
}

function actRenderMeta() {
  if (!ACT.data) {
    actText('actMeta', ACT.error ? '检查失败：' + ACT.error : '正在检查配置...');
    return;
  }
  const st = ACT.data.stats;
  const time = new Date(ACT.data.generatedAt);
  const hhmm = Number.isNaN(time.getTime())
    ? ''
    : ` · ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')} 检查`;
  actText('actMeta',
    `${st.activities} 个活动 · ${st.rankings} 个榜单 · ${st.files} 个文件` +
    ` · 错误 ${st.issues.error} · 警告 ${st.issues.warn} · 提示 ${st.issues.info}` + hhmm +
    (ACT.stale ? ' · 数据已变化，建议重新检查' : ''));
}

function actRenderAll() {
  actRenderTabs();
  actRenderMeta();
  actRenderList();
  actRenderCards();
  actRenderRankings();
  actRenderHealth();
  if (ACT.data) actText('actCount', String(ACT.data.stats.activities));
}

function actSelect(id) {
  if (S.mode !== 'activity') {
    openActivityView('overview', id);
    return;
  }
  ACT.selected = id;
  ACT.tab = 'overview';
  actRenderAll();
  actSetHash(id);
  const card = document.querySelector(`[data-act-card="${id}"]`);
  if (card) card.scrollIntoView({ block: 'nearest' });
}

function actFocusHealth(id) {
  ACT.selected = id;
  ACT.tab = 'health';
  actRenderTabs();
  actRenderCards();
  const group = document.querySelector(`[data-act-group="${id}"]`);
  if (group) group.scrollIntoView({ block: 'start' });
}

async function openActivityView(tab, id) {
  if (S.mode !== 'activity' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  if (tab) ACT.tab = tab;
  if (id) ACT.selected = id;
  S.mode = 'activity';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  if (window.hideNpcBuyView) window.hideNpcBuyView();
  if (window.hideItemUseView) window.hideItemUseView();
  if (window.hideTeleportView) window.hideTeleportView();
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
  actEl('dbView').classList.add('hidden');
  actEl('dropView').classList.add('hidden');
  actEl('activityView').classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('act');
  actRenderAll();
  actSetHash(ACT.selected);
  if (!ACT.data || ACT.stale) {
    try {
      await actLoad(true);
      actRenderAll();
    } catch (e) {
      actRenderAll();
      toast('加载活动配置失败：' + e.message, 'err');
    }
  }
}

window.openActivityView = openActivityView;
window.hideActivityView = () => {
  const view = actEl('activityView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && actHashName()) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshActivityState = (st) => {
  const info = st && st.configs ? st.configs.activity : null;
  if (info && info.activities != null) actText('actCount', String(info.activities));
  ACT.stale = true;
  if (S.mode === 'activity') actRenderMeta();
};
window.updateActivityMeta = actRenderMeta;

function actBindEvents() {
  const filter = actEl('actFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(ACT.searchTimer);
      ACT.searchTimer = setTimeout(() => {
        ACT.filter = filter.value;
        actRenderList();
      }, 150);
    });
  }
  document.querySelectorAll('#actFlagFilter [data-act-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ACT.flag = btn.dataset.actFlag;
      actRenderList();
    });
  });
  const tabs = actEl('actTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act-tab]');
      if (!btn) return;
      ACT.tab = btn.dataset.actTab;
      actRenderTabs();
    });
  }
  const reload = actEl('btnActReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        await actLoad(true);
        actRenderAll();
        actSetHash(ACT.selected);
        toast('活动配置已重新检查', 'ok');
      } catch (e) {
        actRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const name = actHashName();
    if (name) openActivityView(undefined, name);
  });
}

actBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const name = actHashName();
    if (name) openActivityView(undefined, name);
  });
} else {
  window.addEventListener('app-ready', () => {
    const name = actHashName();
    if (name) openActivityView(undefined, name);
  });
}

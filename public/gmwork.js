'use strict';

/* GM 工作台：GM 名单、命令白名单、GM 入口与测试 NPC。仅白名单支持勾选写回。 */

const GW = {
  data: null,
  loading: false,
  saving: false,
  stale: true,
  q: '',
  filter: 'all',
  section: 'all',
  staged: new Map(),
  expected: '',
  lists: { main: [], entries: [] }
};

const GW_SECTIONS = [
  { key: 'all', label: '总览' },
  { key: 'commands', label: '命令目录' },
  { key: 'names', label: 'GM 名单' },
  { key: 'entries', label: '入口与检查' }
];

const GW_ISSUE_LABEL = {
  gm_catalog_invalid: '命令目录异常',
  gm_gmcmd_missing: '白名单缺失',
  gm_whitelist_empty: '白名单为空',
  gm_whitelist_malformed: '白名单格式',
  gm_whitelist_duplicate: '命令重复',
  gm_whitelist_unknown: '未收录命令',
  gm_gmnames_missing: 'GM 名单缺失',
  gm_names_empty: 'GM 名单为空',
  gm_names_malformed: '名单格式',
  gm_names_duplicate: '名单重复',
  gm_names_level: '权限等级',
  gm_backstage_item_missing: '入口物品缺失',
  gm_backstage_item_mode: '物品类型',
  gm_backstage_mapping_missing: '入口映射缺失',
  gm_backstage_map_unresolved: '入口地图缺失',
  gm_backstage_map_not_registered: '地图未登记',
  gm_backstage_key_space: '映射 key 空格',
  gm_test_npc_exposed: '测试 NPC 暴露'
};

function gwEl(id) {
  return document.getElementById(id);
}

function gwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function gwBadge(text, cls) {
  return '<span class="mon-sev ' + gwEsc(cls) + '">' + gwEsc(text) + '</span>';
}

function gwBtn(label, kind, val, line) {
  return '<button class="btn small" data-gw-kind="' + gwEsc(kind) +
    '" data-gw-val="' + gwEsc(val == null ? '' : val) +
    '" data-gw-line="' + (line == null ? '' : Number(line)) + '">' + gwEsc(label) + '</button>';
}

function gwSection(title, id, hint, body) {
  return '<div class="tsk-section" id="gwSec-' + id + '">' +
    '<div class="tsk-section-head"><h4>' + gwEsc(title) + '</h4>' +
    (hint ? '<span class="tsk-empty">' + gwEsc(hint) + '</span>' : '') + '</div>' +
    (body || '<div class="mpw-empty">没有相关数据。</div>') + '</div>';
}

function gwTable(headers, rows) {
  if (!rows.length) return '<div class="mpw-empty">没有符合当前筛选条件的数据。</div>';
  return '<table class="tsk-table"><thead><tr>' +
    headers.map((h) => '<th>' + gwEsc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
}

function gwMatches() {
  const q = GW.q.trim().toLowerCase();
  if (!q) return true;
  for (let i = 0; i < arguments.length; i++) {
    if (String(arguments[i] == null ? '' : arguments[i]).toLowerCase().includes(q)) return true;
  }
  return false;
}

function gwIssueLabel(issue) {
  return GW_ISSUE_LABEL[issue.code] || issue.code || '配置问题';
}

function gwActionLabel(action) {
  if (!action) return '';
  if (action.view === 'extra') return action.key === 'gmnames' ? '编辑名单' : '打开白名单';
  if (action.view === 'item') return '物品';
  if (action.view === 'script') return '定位脚本';
  if (action.view === 'map') return '打开地图';
  if (action.view === 'npc') return '定位 NPC';
  if (action.section === 'commands') return '命令目录';
  if (action.section === 'names') return 'GM 名单';
  if (action.section === 'entries') return '入口检查';
  return '定位';
}

function gwIssueRow(issue, listName, index) {
  const loc = [];
  if (issue.file) loc.push(issue.file + (issue.line ? ' 第 ' + issue.line + ' 行' : ''));
  if (issue.scope) loc.push(issue.scope);
  const action = issue.action ? '<button class="btn small" data-gw-issue-list="' + listName +
    '" data-gw-issue="' + index + '">' + gwEsc(gwActionLabel(issue.action)) + '</button>' : '';
  return '<div class="mon-issue mpw-issue">' +
    gwBadge({ error: '错误', warn: '警告', info: '提示' }[issue.severity] || issue.severity, issue.severity) +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + gwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + gwEsc(gwIssueLabel(issue)) +
    (loc.length ? ' · ' + gwEsc(loc.join(' · ')) : '') + '</div></div>' + action + '</div>';
}

function gwIssueList(issues, listName) {
  GW.lists[listName] = issues;
  if (!issues.length) return '<div class="mpw-empty">没有符合当前筛选条件的体检问题。</div>';
  return '<div class="mon-issues">' + issues.map((issue, i) => gwIssueRow(issue, listName, i)).join('') + '</div>';
}

function gwFilterIssues(issues) {
  return issues.filter((issue) =>
    gwMatches(issue.message, issue.code, issue.scope, issue.file, gwIssueLabel(issue)));
}

function gwActionBtn(action, text) {
  if (!action) return '';
  if (action.view === 'extra') return gwBtn(text, 'extra', action.key, action.line);
  if (action.view === 'item') return gwBtn(text, 'item', action.index);
  if (action.view === 'script') return gwBtn(text, 'script', action.name, action.line);
  if (action.view === 'map') return gwBtn(text, 'map', action.key);
  if (action.view === 'npc') return gwBtn(text, 'npc', action.index);
  if (action.section) return gwBtn(text, 'section', action.section);
  return '';
}

function gwCommandMap() {
  const map = new Map();
  const d = GW.data;
  if (!d) return map;
  for (const group of d.catalog.categories) {
    for (const cmd of group.commands) map.set(cmd.name, cmd);
  }
  return map;
}

function gwCommandOn(cmd) {
  return GW.staged.has(cmd.name) ? GW.staged.get(cmd.name) : cmd.enabled;
}

function gwStateText(cmd) {
  const on = gwCommandOn(cmd);
  if (on === cmd.enabled) return on ? '已启用' : '未启用';
  return on ? '已启用（待保存）' : '未启用（待保存）';
}

function gwCard(label, verdict, kind, summary, action) {
  const badge = kind === 'ok' ? 'info' : (kind === 'part' ? 'warn' : 'error');
  return '<div class="pw-cap-card ' + kind + '">' +
    '<div class="pw-cap-head"><strong>' + gwEsc(label) + '</strong>' + gwBadge(verdict, badge) + '</div>' +
    '<div class="pw-cap-summary">' + gwEsc(summary) + '</div>' +
    '<div class="pw-evidence"><div class="pw-ev">' + gwActionBtn(action, '查看') + '</div></div></div>';
}

function gwRenderOverview(d) {
  const s = d.stats;
  const w = d.whitelist;
  const e = d.entry;
  let whitelistKind = 'ok';
  if (!w.exists || !s.enabled) whitelistKind = 'miss';
  else if (w.unknown.length || w.malformed.length || w.duplicates.length) whitelistKind = 'part';

  let namesKind = 'ok';
  if (!d.gmNames.exists || !s.gmCount) namesKind = 'miss';
  else if (d.gmNames.duplicates.length || d.gmNames.invalid.length) namesKind = 'part';

  let entryKind = 'ok';
  let entryVerdict = '可用';
  if (!e.item) {
    entryKind = 'miss';
    entryVerdict = '物品缺失';
  } else if (!e.map || !e.map.exists) {
    entryKind = 'miss';
    entryVerdict = '地图缺失';
  } else if (!e.map.registered) {
    entryKind = 'part';
    entryVerdict = '地图未登记';
  }

  let testKind = 'ok';
  let testVerdict = '未发现';
  if (e.testNpc.exists && e.testNpc.npcLine) {
    testKind = 'miss';
    testVerdict = '已暴露';
  } else if (e.testNpc.exists) {
    testKind = 'part';
    testVerdict = '未引用';
  }

  const nameText = d.gmNames.entries.slice(0, 3).map((row) => row.name + ' ' + row.level).join('、');
  const cards = [
    gwCard('命令白名单', s.enabled + ' / ' + s.catalog, whitelistKind,
      (w.exists ? '白名单 ' + w.enabledNames.length + ' 条' : 'GMCmd.txt 缺失') +
      ' · 未收录 ' + s.unknown + ' · 格式错误 ' + w.malformed.length,
      { section: 'commands' }),
    gwCard('GM 名单', s.gmCount + ' 名', namesKind,
      nameText ? nameText + (d.gmNames.entries.length > 3 ? ' 等' : '') : '没有有效名单',
      { section: 'names' }),
    gwCard('GM 入口', entryVerdict, entryKind,
      e.item ? '#' + e.item.idx + ' · Stdmode ' + e.item.stdmode + ' · ' +
        (e.mapping.mapCode || '无地图映射') : 'stditems.db 中没有「' + e.itemName + '」',
      { section: 'entries' }),
    gwCard('测试入口', testVerdict, testKind,
      e.testNpc.exists ? 'ShadowTest.py 存在' +
        (e.testNpc.npcLine ? '，NPCList 第 ' + e.testNpc.npcLine + ' 行引用' : '，未被 NPCList 引用')
        : '未发现 ShadowTest 脚本',
      { section: 'entries' })
  ];

  const issues = gwFilterIssues(d.issues);
  return '<div class="pw-cap-grid">' + cards.join('') + '</div>' +
    gwSection('GM 体检', 'health', issues.length + ' 条', gwIssueList(issues, 'main'));
}

function gwRenderCommands(d) {
  const staged = GW.staged.size;
  const bar = '<div class="gw-bar" data-gw-bar="1">' +
    '<div class="side-note" id="gmwStagedInfo">' +
    (staged ? '已修改 ' + staged + ' 项，尚未写入 GMCmd.txt。' : '勾选命令后点击「保存白名单」写入；只增删整行，不改动其他内容。') +
    '</div><div class="spacer"></div>' +
    '<button class="btn small" data-gw-save="1"' + (staged ? '' : ' disabled') + '>保存白名单</button>' +
    '<button class="btn small" data-gw-revert="1"' + (staged ? '' : ' disabled') + '>撤销修改</button></div>' +
    '<div class="gw-filters">' +
    ['all', 'enabled', 'disabled'].map((key) =>
      '<button class="btn small' + (GW.filter === key ? ' active' : '') + '" data-gw-filter="' + key + '">' +
      ({ all: '全部', enabled: '已启用', disabled: '未启用' }[key]) + '</button>').join('') +
    '<span class="fmeta">当前白名单 ' + d.whitelist.enabledNames.length + ' 条，目录 ' + d.catalog.total + ' 条</span></div>' +
    '<div class="side-note gw-legend">游戏内聊天框输入 <code>@命令 参数</code>；' +
    '<code>&lt;...&gt;</code> 必填、<code>[...]</code> 可选。标「引擎」的用法提取自 NewGs.exe 的参数校验，' +
    '未标注的按命令语义整理；参数均以服务端实际校验为准。</div>';

  const sections = [];
  for (const group of d.catalog.categories) {
    const rows = group.commands.filter((cmd) => {
      const on = gwCommandOn(cmd);
      if (GW.filter === 'enabled' && !on) return false;
      if (GW.filter === 'disabled' && on) return false;
      return gwMatches(cmd.name, '@' + cmd.name, cmd.desc, group.label, cmd.usage, cmd.note);
    }).map((cmd) => {
      const on = gwCommandOn(cmd);
      const badge = cmd.src === 'engine' ? '<span class="gw-src">引擎</span>' : '';
      const note = cmd.note ? '<div class="gw-note">' + gwEsc(cmd.note) + '</div>' : '';
      return '<tr><td><input type="checkbox" data-gw-cmd="' + gwEsc(cmd.name) + '"' +
        (on ? ' checked' : '') + '></td>' +
        '<td><code>@' + gwEsc(cmd.name) + '</code></td>' +
        '<td><div class="gw-usage"><code>' + gwEsc(cmd.usage || '@' + cmd.name) + '</code>' + badge + note + '</div></td>' +
        '<td>' + gwEsc(cmd.desc || '—') + '</td>' +
        '<td data-gw-state="' + gwEsc(cmd.name) + '">' + gwEsc(gwStateText(cmd)) + '</td></tr>';
    });
    if (!rows.length) continue;
    sections.push(gwSection(group.label, 'cmd-' + group.key, rows.length + ' 条',
      gwTable(['启用', '命令', '用法', '说明', '状态'], rows)));
  }
  const commandBody = sections.join('') || '<div class="mpw-empty">没有符合当前筛选条件的命令。</div>';

  const abnormal = d.whitelist.unknown.map((row) => ({
    line: row.line, text: row.text, label: '未收录'
  })).concat(d.whitelist.malformed.map((row) => ({
    line: row.line, text: row.text, label: '格式错误'
  }))).filter((row) => gwMatches(row.text, row.line, row.label));
  const abnormalRows = abnormal.map((row) =>
    '<tr><td>' + row.line + '</td><td>' + gwBadge(row.label, row.label === '未收录' ? 'info' : 'warn') + '</td>' +
    '<td><code>' + gwEsc(row.text.trim()) + '</code></td>' +
    '<td>' + gwBtn('在扩展配置中编辑', 'extra', 'gmcmd') + '</td></tr>');
  const abnormalBody = gwTable(['行号', '类型', '内容', '操作'], abnormalRows);

  return bar + gwSection('命令目录', 'commands', d.catalog.total + ' 条', commandBody) +
    gwSection('白名单异常行', 'abnormal', abnormal.length + ' 条', abnormalBody);
}

function gwRenderNames(d) {
  const names = d.gmNames;
  const rows = names.entries
    .filter((row) => gwMatches(row.name, row.level, row.line))
    .map((row) =>
      '<tr><td>' + gwEsc(row.name) + '</td>' +
      '<td>' + (row.levelOk ? gwBadge('等级 ' + row.level, 'info') : gwBadge('等级 ' + (row.level || '空'), 'warn')) + '</td>' +
      '<td>第 ' + row.line + ' 行</td>' +
      '<td>' + gwBtn('在扩展配置中编辑', 'extra', 'gmnames', row.line) + '</td></tr>');
  const invalidRows = names.invalid
    .filter((row) => gwMatches(row.text, row.line))
    .map((row) =>
      '<tr><td>' + gwEsc(row.text.trim()) + '</td>' +
      '<td>' + gwBadge('格式错误', 'warn') + '</td>' +
      '<td>第 ' + row.line + ' 行</td>' +
      '<td>' + gwBtn('在扩展配置中编辑', 'extra', 'gmnames', row.line) + '</td></tr>');
  const body = gwTable(['角色名 / 内容', '状态', '位置', '操作'], rows.concat(invalidRows));
  const note = '<div class="side-note" style="margin:0 0 10px;">GMNames.txt 为只读汇总；修改请跳转到扩展配置，名单保存后会重新检查。</div>';
  const dupBody = names.duplicates.length
    ? '<div class="mon-issues">' + names.duplicates.map((dup) =>
      '<div class="mon-issue mpw-issue">' + gwBadge('重复', 'warn') +
      '<div class="mon-issue-body"><div class="mon-issue-msg">角色「' + gwEsc(dup.name) +
      '」出现 ' + dup.lines.length + ' 次</div><div class="mon-issue-meta">第 ' +
      gwEsc(dup.lines.join('、')) + ' 行</div></div></div>').join('') + '</div>'
    : '';
  return note + gwSection('GM 名单', 'names', names.entries.length + ' 名', body) +
    (names.duplicates.length ? gwSection('重复名单', 'name-dups', names.duplicates.length + ' 组', dupBody) : '');
}

function gwRenderEntries(d) {
  const e = d.entry;
  const mapBadge = !e.map ? gwBadge('无映射', 'warn') :
    (!e.map.exists ? gwBadge('缺失', 'warn') : (e.map.registered ? gwBadge('可用', 'info') : gwBadge('未登记', 'warn')));
  const mapText = !e.map ? '没有 MapCode' :
    (e.map.exists
      ? e.map.code + ' → ' + e.map.matched + '.map' + (e.map.registered ? '（MapInfo 已登记）' : '（未在 MapInfo 登记）')
      : e.map.code + ' 在 MapInfo 与 map/ 目录中均未找到');
  const testBadge = !e.testNpc.exists ? gwBadge('未发现', 'info') :
    (e.testNpc.npcLine ? gwBadge('已暴露', 'warn') : gwBadge('未引用', 'info'));
  const testText = e.testNpc.exists
    ? 'ShadowTest.py 存在' + (e.testNpc.npcLine ? '，NPCList 第 ' + e.testNpc.npcLine + ' 行引用' : '，未被 NPCList 引用')
    : 'NPCScript 中没有 ShadowTest.py / .pyc';

  const rows = [
    '<tr><td>GM 后台物品</td><td>' + (e.item ? gwBadge('存在', 'info') : gwBadge('缺失', 'warn')) + '</td>' +
    '<td>' + (e.item
      ? '#' + e.item.idx + ' · Stdmode ' + e.item.stdmode + ' · Shape ' + e.item.shape + ' · Stock ' + e.item.stock
      : 'stditems.db 中没有「' + gwEsc(e.itemName) + '」') + '</td>' +
    '<td>' + (e.item ? gwBtn('物品定位', 'item', e.item.idx) : '') + '</td></tr>',
    '<tr><td>入口映射</td><td>' + (e.mapping.line ? gwBadge('已配置', 'info') : gwBadge('缺失', 'warn')) + '</td>' +
    '<td>' + (e.mapping.line
      ? gwEsc(e.mapping.file) + ' 第 ' + e.mapping.line + ' 行 · ' +
        gwEsc(e.mapping.func || '—') + ' · MapCode ' + gwEsc(e.mapping.mapCode || '—') +
        (e.mapping.keyHasSpace ? ' · key 带尾随空格' : '')
      : e.mapping.file + ' 中没有「' + gwEsc(e.itemName) + '」的 moveToMap 映射') + '</td>' +
    '<td>' + (e.mapping.exists ? gwBtn('定位脚本', 'script', e.mapping.file.replace(/^NPCScript\//, ''), e.mapping.line) : '') + '</td></tr>',
    '<tr><td>目标地图</td><td>' + mapBadge + '</td><td>' + gwEsc(mapText) + '</td>' +
    '<td>' + (e.map && e.map.exists ? gwBtn('打开地图', 'map', e.map.matched) : '') + '</td></tr>',
    '<tr><td>测试 NPC</td><td>' + testBadge + '</td><td>' + gwEsc(testText) + '</td>' +
    '<td>' + (e.testNpc.exists ? gwBtn('定位脚本', 'script', 'ShadowTest.py') : '') + '</td></tr>'
  ];
  const body = gwTable(['项目', '状态', '详情', '操作'], rows);

  const entryIssues = d.issues.filter((issue) =>
    /^gm_backstage_|^gm_test_/.test(issue.code));
  return gwSection('GM 入口', 'entry', '4 项', body) +
    gwSection('入口体检', 'entry-health', entryIssues.length + ' 条',
      gwIssueList(gwFilterIssues(entryIssues), 'entries'));
}

function gwRenderSummary(d) {
  const box = gwEl('gmwSummary');
  if (!box) return;
  box.innerHTML = '<div class="side-note" style="margin:8px 2px 0;">' +
    '命令目录 ' + d.catalog.total + ' 条 · 白名单已启用 ' + d.stats.enabled + ' 条 · GM ' +
    d.stats.gmCount + ' 名 · ' + d.stats.error + ' 错误 / ' + d.stats.warn + ' 警告 / ' +
    d.stats.info + ' 提示</div>';
}

function gwRenderNav(d) {
  const list = gwEl('gmwNavList');
  if (!list) return;
  const counts = {
    all: d.issues.length + ' 条问题',
    commands: d.catalog.total + ' 条',
    names: d.gmNames.entries.length + ' 名',
    entries: '4 项'
  };
  list.innerHTML = GW_SECTIONS.map((s) =>
    '<li class="file-item' + (GW.section === s.key ? ' active' : '') + '" data-gw-section="' + s.key + '">' +
    '<div class="fname">' + gwEsc(s.label) + '</div>' +
    '<div class="fmeta">' + gwEsc(counts[s.key]) + '</div></li>').join('');
  const hint = gwEl('gmwListHint');
  if (hint) {
    hint.textContent = '已启用 ' + d.stats.enabled + ' / ' + d.catalog.total +
      ' · 未收录 ' + d.stats.unknown + ' · ' + d.stats.gmCount + ' 名 GM';
  }
}

function gwUpdateStaged() {
  const staged = GW.staged.size;
  const info = gwEl('gmwStagedInfo');
  if (info) {
    info.textContent = staged
      ? '已修改 ' + staged + ' 项，尚未写入 GMCmd.txt。'
      : '勾选命令后点击「保存白名单」写入；只增删整行，不改动其他内容。';
  }
  const flags = !staged || GW.saving;
  document.querySelectorAll('[data-gw-save]').forEach((btn) => { btn.disabled = flags; });
  document.querySelectorAll('[data-gw-revert]').forEach((btn) => { btn.disabled = flags; });
  const save = gwEl('btnGmwSave');
  if (save) save.disabled = flags;
}

function gwRender() {
  const d = GW.data;
  if (!d) return;
  gwRenderSummary(d);
  const box = gwEl('gmwContent');
  if (!box) return;
  const parts = {
    all: () => gwRenderOverview(d),
    commands: () => gwRenderCommands(d),
    names: () => gwRenderNames(d),
    entries: () => gwRenderEntries(d)
  };
  const showAll = !!GW.q.trim() || !parts[GW.section];
  box.innerHTML = showAll
    ? ['all', 'commands', 'names', 'entries'].map((k) => parts[k]()).join('')
    : parts[GW.section]();
  gwRenderNav(d);
  gwUpdateStaged();
  const meta = gwEl('gmwMeta');
  if (meta) {
    meta.textContent = '白名单 ' + d.stats.enabled + ' / ' + d.catalog.total +
      ' · GM ' + d.stats.gmCount + ' 名 · ' + d.stats.error + ' 错误 / ' +
      d.stats.warn + ' 警告 / ' + d.stats.info + ' 提示';
  }
}

async function gwLoad(refresh) {
  if (GW.loading) return;
  GW.loading = true;
  const meta = gwEl('gmwMeta');
  if (meta) meta.textContent = '正在检查 GM 配置…';
  try {
    GW.data = await api('/api/config/gmwork' + (refresh ? '?refresh=1' : ''));
    GW.expected = GW.data.whitelist.sha1 || '';
    GW.staged.clear();
    GW.stale = false;
    gwRender();
  } finally {
    GW.loading = false;
  }
}

async function gwSave() {
  if (!GW.staged.size || GW.saving) return;
  const changes = [...GW.staged.entries()].map(([name, enabled]) => ({ name, enabled }));
  GW.saving = true;
  gwUpdateStaged();
  try {
    const res = await api('/api/config/gmwork/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected: GW.expected, changes })
    });
    let msg = '白名单已保存：新增 ' + res.added + ' 条，删除 ' + res.removed + ' 条。';
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    GW.staged.clear();
    await gwLoad(true);
    if (typeof refreshState === 'function') refreshState().catch(() => {});
  } catch (e) {
    if (e.status === 409) {
      toast('GMCmd.txt 已被其他操作修改，正在重新加载。', 'warn');
      GW.staged.clear();
      await gwLoad(true);
    } else {
      toast('保存白名单失败：' + e.message, 'err');
    }
  } finally {
    GW.saving = false;
    gwUpdateStaged();
  }
}

async function gwRunAction(action) {
  if (!action) return;
  if (action.section) {
    gwSelectSection(action.section);
    return;
  }
  if (window.hideGmWorkView) window.hideGmWorkView();
  if (action.view === 'extra' && action.key) {
    if (action.line && window.openExtraKeyAt) return window.openExtraKeyAt(action.key, { line: action.line });
    if (window.openExtraKey) return window.openExtraKey(action.key);
    return;
  }
  if (action.view === 'item' && action.index != null) {
    if (window.openItemDropView) return window.openItemDropView({ tab: 'detail', itemIndex: Number(action.index) });
    return;
  }
  if (action.view === 'script' && action.name) {
    if (window.openScriptView) return window.openScriptView({ tab: 'detail', name: action.name, line: action.line });
    return;
  }
  if (action.view === 'map' && action.key) {
    if (window.openMapView) return window.openMapView({ tab: 'detail', key: action.key });
    return;
  }
  if (action.view === 'npc' && action.index != null) {
    if (window.openNpcWorkView) return window.openNpcWorkView(Number(action.index));
  }
}

async function gwJump(btn) {
  const kind = btn.dataset.gwKind;
  const val = btn.dataset.gwVal || '';
  const line = btn.dataset.gwLine ? Number(btn.dataset.gwLine) : 0;
  if (!kind) return;
  if (kind === 'section') {
    gwSelectSection(val);
    return;
  }
  await gwRunAction({
    view: kind === 'extra' || kind === 'item' || kind === 'script' || kind === 'map' || kind === 'npc' ? kind : '',
    key: kind === 'extra' || kind === 'map' ? val : undefined,
    name: kind === 'script' ? val : undefined,
    index: kind === 'item' || kind === 'npc' ? Number(val) : undefined,
    line: line || undefined
  });
}

function gwSelectSection(key) {
  GW.section = key || 'all';
  gwRender();
  gwSetHash();
  const content = gwEl('gmwContent');
  if (content) content.scrollIntoView({ block: 'start' });
}

function gwHashState() {
  const m = /^#gmwork(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  let raw = m[1] || '';
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
  }
  return { section: GW_SECTIONS.some((s) => s.key === raw) ? raw : 'all' };
}

function gwSetHash() {
  const next = GW.section && GW.section !== 'all' ? '#gmwork=' + GW.section : '#gmwork';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function openGmWorkView(sel) {
  if (S.mode !== 'gmwork' && typeof confirmDiscard === 'function' && !(await confirmDiscard())) return;
  S.mode = 'gmwork';
  if (typeof hideAllViews === 'function') hideAllViews();
  const view = gwEl('gmworkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('gmw');
  if (window.updateMeta) window.updateMeta();
  const status = gwEl('statusText');
  if (status) status.textContent = 'GM 管理 · 白名单可勾选保存';
  const target = sel || gwHashState();
  if (target && target.section) GW.section = target.section;
  if (sel) {
    GW.q = '';
    const query = gwEl('gmwFilter');
    if (query) query.value = '';
  }
  gwRender();
  try {
    if (!GW.data || GW.stale) await gwLoad(false);
    else gwRender();
  } catch (e) {
    gwRender();
    if (typeof toast === 'function') toast('加载 GM 工作台失败：' + e.message, 'err');
    return;
  }
  gwSetHash();
}

function hideGmWorkView() {
  const view = gwEl('gmworkView');
  if (view) view.classList.add('hidden');
}

function refreshGmWorkState() {
  GW.stale = true;
}

function gwToggleCommand(name, checked) {
  const cmd = gwCommandMap().get(name);
  if (!cmd) return;
  if (checked === cmd.enabled) GW.staged.delete(name);
  else GW.staged.set(name, checked);
  const cell = document.querySelector('[data-gw-state="' + name + '"]');
  if (cell) cell.textContent = gwStateText(cmd);
  gwUpdateStaged();
}

function gwBind() {
  const filter = gwEl('gmwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      GW.q = filter.value;
      if (GW.data) gwRender();
    });
  }
  const nav = gwEl('gmwNavList');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const item = e.target.closest('[data-gw-section]');
      if (!item) return;
      gwSelectSection(item.dataset.gwSection);
    });
  }
  const content = gwEl('gmwContent');
  if (content) {
    content.addEventListener('change', (e) => {
      const box = e.target.closest('[data-gw-cmd]');
      if (!box) return;
      gwToggleCommand(box.dataset.gwCmd, box.checked);
    });
    content.addEventListener('click', (e) => {
      const issueBtn = e.target.closest('[data-gw-issue]');
      if (issueBtn) {
        const list = GW.lists[issueBtn.dataset.gwIssueList] || [];
        const issue = list[Number(issueBtn.dataset.gwIssue)];
        if (issue) gwRunAction(issue.action).catch((err) => {
          if (typeof toast === 'function') toast('定位失败：' + err.message, 'err');
        });
        return;
      }
      const save = e.target.closest('[data-gw-save]');
      if (save) {
        gwSave().catch((err) => toast('保存白名单失败：' + err.message, 'err'));
        return;
      }
      const revert = e.target.closest('[data-gw-revert]');
      if (revert) {
        GW.staged.clear();
        gwRender();
        return;
      }
      const flt = e.target.closest('[data-gw-filter]');
      if (flt) {
        GW.filter = flt.dataset.gwFilter || 'all';
        gwRender();
        return;
      }
      const btn = e.target.closest('[data-gw-kind]');
      if (!btn) return;
      gwJump(btn).catch((err) => {
        if (typeof toast === 'function') toast('定位失败：' + err.message, 'err');
      });
    });
  }
  const reload = gwEl('btnGmwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      if (GW.staged.size) {
        const ok = await uiConfirm({
          title: '放弃未保存的白名单修改',
          message: '当前有 ' + GW.staged.size + ' 项勾选尚未保存，确定重新加载并放弃这些修改？',
          danger: true,
          okText: '放弃修改'
        });
        if (!ok) return;
      }
      gwLoad(true).catch((e) => {
        if (typeof toast === 'function') toast('重新检查失败：' + e.message, 'err');
      });
    });
  }
  const save = gwEl('btnGmwSave');
  if (save) {
    save.addEventListener('click', () => {
      gwSave().catch((err) => toast('保存白名单失败：' + err.message, 'err'));
    });
  }
  window.addEventListener('hashchange', () => {
    const state = gwHashState();
    if (state) openGmWorkView(state);
  });
}

window.openGmWorkView = openGmWorkView;
window.hideGmWorkView = hideGmWorkView;
window.refreshGmWorkState = refreshGmWorkState;

gwBind();

const gwInitial = gwHashState();
if (gwInitial) {
  if (window.appReady && typeof window.appReady.then === 'function') {
    window.appReady.then(() => openGmWorkView(gwInitial));
  } else {
    openGmWorkView(gwInitial);
  }
}

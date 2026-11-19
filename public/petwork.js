'use strict';

/* 灵兽与骑乘工作台：只读汇总灵兽成长、转生材料、骑乘与马牌配置 */

const PW = {
  data: null,
  loading: false,
  stale: true,
  q: '',
  section: 'all',
  lists: { main: [], ride: [] }
};

const PW_SECTIONS = [
  { key: 'all', label: '总览' },
  { key: 'growth', label: '灵兽成长' },
  { key: 'rebirth', label: '转生与材料' },
  { key: 'ride', label: '骑乘' }
];

const PW_ISSUE_LABEL = {
  pet_stage_form_missing: '灵兽形态缺失',
  pet_material_missing: '材料缺失',
  pet_material_required_missing: '必需材料缺失',
  pet_material_no_source: '材料无来源',
  pet_armor_rule_mismatch: '铠甲要求不一致',
  pet_water_name_mismatch: '材料名称不一致',
  pet_rebirth_script_gap: '二转脚本缺口',
  pet_merstabl_source_missing: '脚本源码缺失',
  pet_growth_anomalies: '成长异常汇总',
  pet_supply_no_source: '补给无来源',
  pet_mount_no_source: '骑乘物品无来源'
};

function pwEl(id) {
  return document.getElementById(id);
}

function pwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pwBadge(text, cls) {
  return '<span class="mon-sev ' + pwEsc(cls) + '">' + pwEsc(text) + '</span>';
}

function pwBtn(label, kind, val, line) {
  return '<button class="btn small" data-pw-kind="' + pwEsc(kind) +
    '" data-pw-val="' + pwEsc(val == null ? '' : val) +
    '" data-pw-line="' + (line == null ? '' : Number(line)) + '">' + pwEsc(label) + '</button>';
}

function pwSection(title, id, hint, body) {
  return '<div class="tsk-section" id="pwSec-' + id + '">' +
    '<div class="tsk-section-head"><h4>' + pwEsc(title) + '</h4>' +
    (hint ? '<span class="tsk-empty">' + pwEsc(hint) + '</span>' : '') + '</div>' +
    (body || '<div class="mpw-empty">没有相关数据。</div>') + '</div>';
}

function pwTable(headers, rows) {
  if (!rows.length) return '<div class="mpw-empty">没有符合当前筛选条件的数据。</div>';
  return '<table class="tsk-table"><thead><tr>' +
    headers.map((h) => '<th>' + pwEsc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
}

function pwMatches() {
  const q = PW.q.trim().toLowerCase();
  if (!q) return true;
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (String(v == null ? '' : v).toLowerCase().includes(q)) return true;
  }
  return false;
}

function pwIssueLabel(issue) {
  return PW_ISSUE_LABEL[issue.code] || issue.code || '配置问题';
}

function pwActionLabel(action) {
  if (!action) return '';
  if (action.view === 'growth') return '成长曲线';
  if (action.view === 'item') return '物品';
  if (action.section === 'growth') return '查看图鉴';
  if (action.section === 'rebirth') return '查看材料';
  if (action.section === 'ride') return '查看骑乘';
  return '定位';
}

function pwIssueRow(issue, listName, index) {
  const loc = [];
  if (issue.file) loc.push(issue.file + (issue.line ? ' 第 ' + issue.line + ' 行' : ''));
  if (issue.scope) loc.push(issue.scope);
  const action = issue.action ? '<button class="btn small" data-pw-issue-list="' + listName +
    '" data-pw-issue="' + index + '">' + pwEsc(pwActionLabel(issue.action)) + '</button>' : '';
  return '<div class="mon-issue mpw-issue">' +
    pwBadge({ error: '错误', warn: '警告', info: '提示' }[issue.severity] || issue.severity, issue.severity) +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + pwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + pwEsc(pwIssueLabel(issue)) +
    (loc.length ? ' · ' + pwEsc(loc.join(' · ')) : '') + '</div></div>' + action + '</div>';
}

function pwIssueList(issues, listName) {
  PW.lists[listName] = issues;
  if (!issues.length) return '<div class="mpw-empty">没有符合当前筛选条件的体检问题。</div>';
  return '<div class="mon-issues">' + issues.map((issue, i) => pwIssueRow(issue, listName, i)).join('') + '</div>';
}

function pwFilterIssues(issues) {
  return issues.filter((issue) =>
    pwMatches(issue.message, issue.code, issue.scope, issue.file, pwIssueLabel(issue)));
}

function pwSourceText(sources) {
  if (!sources || !sources.total) return '<span class="fmeta">无来源</span>';
  return pwEsc(sources.samples.join(' · '));
}

function pwSampleRows(rows, max) {
  if (!rows || rows.length <= max) return rows || [];
  const out = [];
  const step = (rows.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(rows[Math.round(i * step)]);
  }
  return out.filter((row, i, arr) => i === 0 || row !== arr[i - 1]);
}

function pwVerdictKind(verdict) {
  if (verdict === '完整' || verdict === '已配置') return 'ok';
  if (verdict === '未启用' || verdict === '未配置') return 'miss';
  return 'part';
}

function pwCapBadge(verdict) {
  const cls = { ok: 'info', part: 'warn', miss: 'error' }[pwVerdictKind(verdict)] || 'info';
  return pwBadge(verdict, cls);
}

function pwActionBtn(action, text) {
  if (!action) return '';
  if (action.view === 'growth') return pwBtn(text, 'section', 'growth');
  if (action.view === 'item') return pwBtn(text, 'item', action.index);
  if (action.view === 'script') return pwBtn(text, 'script', action.name, action.line);
  if (action.view === 'npc') return pwBtn(text, 'npc', action.index);
  if (action.view === 'param') return pwBtn(text, 'param', action.line, action.line);
  if (action.section) return pwBtn(text, 'section', action.section);
  return '';
}

function pwEvidenceList(cap) {
  return '<div class="pw-evidence">' + cap.evidence.map((e) =>
    '<div class="pw-ev' + (e.ok ? '' : ' miss') + '">' +
    '<span class="pw-ev-mark">' + (e.ok ? '✓' : '✗') + '</span>' +
    '<span class="pw-ev-label">' + pwEsc(e.label) + '</span>' +
    '<span class="pw-ev-detail">' + pwEsc(e.detail) + '</span>' +
    pwActionBtn(e.action, '定位') + '</div>').join('') + '</div>';
}

function pwCapCard(cap) {
  return '<div class="pw-cap-card ' + pwVerdictKind(cap.verdict) + '">' +
    '<div class="pw-cap-head"><strong>' + pwEsc(cap.label) + '</strong>' + pwCapBadge(cap.verdict) + '</div>' +
    '<div class="pw-cap-summary">' + pwEsc(cap.summary) + '</div>' +
    pwEvidenceList(cap) + '</div>';
}

function pwRenderSummary(d) {
  const box = pwEl('petwSummary');
  if (!box) return;
  const s = d.stats;
  const caps = d.capabilities || [];
  let hint = d.server.name ? '当前区：' + d.server.name + (d.server.index !== '' ? '（索引 ' + d.server.index + '）' : '') : '未读取区名';
  hint += ' · ' + s.error + ' 错误 / ' + s.warn + ' 警告 / ' + s.info + ' 提示';
  box.innerHTML = (caps.length && PW.section !== 'all'
    ? '<div class="pw-caps">' + caps.map((c) =>
      '<div class="pw-cap ' + pwVerdictKind(c.verdict) + '">' +
      '<div class="pw-cap-head"><strong>' + pwEsc(c.label) + '</strong>' + pwCapBadge(c.verdict) + '</div>' +
      '<div class="pw-cap-line">' + pwEsc(c.summary) + '</div></div>').join('') + '</div>'
    : '') +
    '<div class="side-note" style="margin:8px 2px 0;">' + pwEsc(hint) + '</div>';
}

function pwRenderOverview(d) {
  const issues = pwFilterIssues(d.issues);
  const notes = d.notes.filter((n) => pwMatches(n.tag, n.text));
  const caps = d.capabilities || [];
  const capBody = caps.length
    ? '<div class="pw-cap-grid">' + caps.map(pwCapCard).join('') + '</div>'
    : '<div class="mpw-empty">没有能力判定数据。</div>';
  const issueBody = pwIssueList(issues, 'main');
  const noteBody = notes.length
    ? '<div class="mon-issues">' + notes.map((n) =>
      '<div class="mon-issue mpw-issue">' + pwBadge(n.tag || '说明', 'info') +
      '<div class="mon-issue-body"><div class="mon-issue-msg">' + pwEsc(n.text) + '</div></div></div>').join('') + '</div>'
    : '<div class="mpw-empty">没有符合当前筛选条件的说明。</div>';
  return pwSection('能力判定', 'caps', caps.length + ' 项', capBody) +
    pwSection('配置体检', 'health', issues.length + ' 条', issueBody) +
    pwSection('说明', 'notes', notes.length + ' 条', noteBody);
}

function pwStageBadge(stage) {
  return stage.inMonster ? pwBadge('已登记', 'info') : pwBadge('未登记', 'warn');
}

function pwRenderGrowth(d) {
  const g = d.growth;
  const speciesRows = d.species
    .filter((fam) => pwMatches(fam.name, fam.stone, fam.stages.map((s) => s.name).join(' ')))
    .map((fam) => {
      const stages = fam.stages.map((s) => {
        const label = (s.tier + 1) + '·' + s.name;
        return s.inMonster ? label : label + '（未登记）';
      }).join(' → ');
      const growthLinks = fam.stages.filter((s) => s.growthKey).map((s) =>
        pwBtn(s.name + ' ' + s.growthLevels + ' 级', 'section', 'growth')).join(' ');
      const status = fam.missingStages.length
        ? pwBadge('缺 ' + fam.missingStages.length + ' 个形态', 'warn')
        : pwBadge('完整', 'info');
      return '<tr><td>' + pwEsc(fam.name) + '</td><td>' + pwEsc(stages) + '</td>' +
        '<td>' + pwEsc(fam.stone) + '</td>' +
        '<td>' + (growthLinks || '<span class="fmeta">无独立成长表</span>') + '</td>' +
        '<td>' + status + '</td></tr>';
    });
  const speciesBody = pwTable(['系别', '阶段链', '灵兽石', '成长表', '形态状态'], speciesRows);

  const curves = [];
  if (g.special) curves.push(g.special);
  curves.push(...g.taoist);
  const curveRows = curves
    .filter((p) => pwMatches(p.name, p.key, p.file))
    .map((p) => {
      const st = p.stats;
      const exp = st.expStart == null ? '—' : st.expStart + ' → ' + st.expEnd;
      const iss = p.issues || { error: 0, warn: 0, info: 0 };
      const issueText = (iss.error + iss.warn + iss.info) ? (iss.error + ' / ' + iss.warn + ' / ' + iss.info) : '0';
      return '<tr><td>' + pwEsc(p.name) + ' <span class="fmeta">' + pwEsc(p.file) + '</span></td>' +
        '<td>' + pwEsc(st.levelMin + '–' + st.levelMax + '（' + st.levels + ' 级）') + '</td>' +
        '<td>' + pwEsc(st.hpStart + ' → ' + st.hpEnd) + '</td>' +
        '<td>' + pwEsc(exp) + '</td><td>' + pwEsc(issueText) + '</td>' +
        '<td>' + pwBtn('成长曲线', 'section', 'growth') + '</td></tr>';
    });
  const curveBody = pwTable(['成长表', '等级范围', 'HP', '经验', '错误/警告/提示', '操作'], curveRows);

  const samples = curves
    .filter((p) => pwMatches(p.name, p.key, p.file))
    .map((p) => {
      const rows = pwSampleRows(p.rows || [], 9).map((r) => {
        const exp = r.exp == null ? '—' : r.exp;
        return '<tr><td>' + r.level + '</td><td>' + (r.exp == null ? '—' : exp) + '</td>' +
          '<td>' + r.hp + '</td><td>' + r.dc + '–' + r.dcMax + '</td>' +
          '<td>' + r.ac + '–' + r.acMax + '</td>' +
          '<td>' + pwEsc(r.describe || '—') + '</td></tr>';
      });
      return '<div class="pw-curve"><div class="tsk-section-head"><h4>' + pwEsc(p.name) +
        '</h4><span class="tsk-empty">抽样 ' + pwSampleRows(p.rows || [], 9).length + ' / ' +
        (p.rows || []).length + ' 级</span></div>' +
        pwTable(['等级', '经验', 'HP', '攻击', '防御', '说明'], rows) + '</div>';
    }).join('');
  const sampleBody = samples || '<div class="mpw-empty">没有符合当前筛选条件的成长曲线。</div>';

  const gIssues = (g.issues || []).filter((i) => pwMatches(i.message, i.code, i.petKey));
  const issueRows = gIssues.map((i) =>
    '<tr><td>' + pwBadge({ error: '错误', warn: '警告', info: '提示' }[i.severity] || i.severity, i.severity) + '</td>' +
    '<td>' + pwEsc(i.message) + '</td><td>' + pwEsc(i.petKey || '—') + '</td>' +
    '<td>' + (i.petKey ? pwBtn('成长曲线', 'section', 'growth') : '—') + '</td></tr>');
  const issueBody = pwTable(['级别', '问题', '宠物', '操作'], issueRows);

  const note = '<div class="side-note" style="margin:0 0 10px;">本页只包含灵兽（特殊宠物与豹/狮/麒麟系）；道士召唤兽与宠物升级经验见「职业与技能」。</div>';
  return note + pwSection('灵兽图鉴', 'species', d.species.length + ' 系 / ' + d.stats.stages + ' 阶段', speciesBody) +
    pwSection('成长曲线', 'curves', curves.length + ' 条', curveBody) +
    pwSection('成长抽样', 'samples', '', sampleBody) +
    pwSection('成长异常', 'growth-issues', gIssues.length + ' 条', issueBody);
}

function pwMaterialByName(d, name) {
  return d.materials.find((m) => m.name === name) || null;
}

function pwMaterialBadge(m) {
  if (!m) return pwBadge('未定义', 'warn');
  return m.present ? pwBadge('物品存在', 'info') : pwBadge('物品缺失', 'warn');
}

function pwRenderRebirth(d) {
  const stone = (fam) => pwMaterialByName(d, fam.stone);
  const water = pwMaterialByName(d, '豹神水');
  const armor = pwMaterialByName(d, '踏云玄铠');
  const soul = pwMaterialByName(d, '灵兽铠');
  const godWater = pwMaterialByName(d, '兽神水');
  const flowRows = d.species
    .filter((fam) => pwMatches(fam.name, fam.stone, fam.stages.map((s) => s.name).join(' ')))
    .map((fam) => {
      const one = fam.stages[0].name + ' → ' + fam.stages[1].name;
      const two = fam.stages[1].name + ' → ' + fam.stages[2].name;
      const armorText = fam.key === 'leopard'
        ? ' + 踏云玄铠 ' + pwMaterialBadge(armor) + '（文案灵兽铠 ' + pwMaterialBadge(soul) + '）'
        : '';
      return '<tr><td>' + pwEsc(fam.name) + '</td>' +
        '<td>' + pwEsc(one) + '</td>' +
        '<td>' + pwEsc(fam.stone) + ' ' + pwMaterialBadge(stone(fam)) + ' + 豹神水 ' + pwMaterialBadge(water) +
        armorText + '</td>' +
        '<td>' + pwEsc(two) + '</td>' +
        '<td>' + pwEsc(fam.stone) + ' + 豹神水（文案写作兽神水 ' + pwMaterialBadge(godWater) + '）+ 20 点灵力</td></tr>';
    });
  const flowBody = pwTable(['系别', '一转', '一转材料', '二转', '二转材料'], flowRows);

  const materialRows = d.materials
    .filter((m) => pwMatches(m.name, m.kind, m.note, m.uses.map((u) => u.script).join(' ')))
    .map((m) => {
      const useText = m.uses.length
        ? m.uses.slice(0, 3).map((u) => u.script + ' 第 ' + u.line + ' 行').join('；') +
          (m.uses.length > 3 ? ' 等 ' + m.uses.length + ' 处' : '')
        : '—';
      return '<tr><td>' + pwEsc(m.name) + '</td><td>' + pwEsc(m.kind) + '</td>' +
        '<td>' + (m.present ? pwBadge('存在', 'info') : pwBadge('缺失', 'warn')) + '</td>' +
        '<td>' + (m.required ? '是' : '否') + '</td>' +
        '<td>' + pwSourceText(m.sources) + '</td>' +
        '<td>' + pwEsc(useText) + '</td>' +
        '<td>' + (m.item ? pwBtn('物品', 'item', m.item.index) : '—') + '</td></tr>';
    });
  const materialBody = pwTable(['材料', '类型', '状态', '脚本消耗', '来源', '引用位置', '操作'], materialRows);

  const scriptRows = d.scripts
    .filter((s) => pwMatches(s.name, s.apis.join(' '), s.items.join(' ')))
    .map((s) => {
      const items = s.items || [];
      const itemText = items.length
        ? items.slice(0, 6).map((it) => '<span class="pw-item">' + pwEsc(it) + '</span>').join('') +
          (items.length > 6 ? '<span class="fmeta">等 ' + items.length + ' 种</span>' : '')
        : '—';
      return '<tr><td>' + pwEsc(s.name) + '</td><td>' + s.refs + '</td>' +
        '<td>' + pwEsc(s.apis.join('、') || '—') + '</td>' +
        '<td class="pw-items" title="' + pwEsc(items.join('、')) + '">' + itemText + '</td>' +
        '<td>' + pwBtn('定位脚本', 'script', s.name, s.firstLine) + '</td></tr>';
    });
  const scriptBody = pwTable(['脚本', '引用行', '接口', '涉及物品', '操作'], scriptRows);

  const npcRows = d.npcs.rebirth
    .filter((n) => pwMatches(n.name, n.script, n.mapName, n.map))
    .map((n) => {
      const where = n.mapName ? n.mapName + '(' + n.map + ')' : n.map;
      return '<tr><td>' + pwEsc(n.name) + ' <span class="fmeta">' + pwEsc(n.id) + '</span></td>' +
        '<td>' + pwEsc(n.script) + '</td><td>' + pwEsc(where) + ' ' + n.x + ',' + n.y + '</td>' +
        '<td>' + pwBtn('定位 NPC', 'npc', n.index) + '</td></tr>';
    });
  const npcBody = pwTable(['NPC', '脚本', '位置', '操作'], npcRows);

  return pwSection('转生流程', 'flow', '', flowBody) +
    pwSection('材料与来源', 'materials', d.materials.length + ' 项', materialBody) +
    pwSection('转生脚本', 'rebirth-scripts', d.scripts.length + ' 个', scriptBody) +
    pwSection('转生入口 NPC', 'rebirth-npcs', d.npcs.rebirth.length + ' 个', npcBody);
}

function pwRenderRideParams(d) {
  const all = d.params.rows.filter((r) => r.domain === 'ride');
  const rows = all
    .filter((r) => pwMatches(r.key, r.value, r.label, r.desc))
    .map((r) =>
      '<tr><td>' + pwEsc(r.label) + ' <span class="fmeta">' + pwEsc(r.key) + '</span></td>' +
      '<td><code class="pw-value">' + pwEsc(r.value) + '</code></td>' +
      '<td>' + pwEsc(r.desc) + '</td>' +
      '<td>' + pwEsc(r.file) + ' 第 ' + r.line + ' 行</td>' +
      '<td>' + pwBtn('编辑', 'param', r.line, r.line) + '</td></tr>');
  const body = pwTable(['参数', '当前值', '说明', '位置', '操作'], rows) +
    '<div class="side-note pw-param-note">修改会跳转到「扩展配置 · 服务器启动配置」，保存沿用现有备份与校验流程，通常重启服务端后生效。</div>';
  return pwSection('骑乘参数', 'ride-params', all.length + ' 项', body);
}

function pwRenderRide(d) {
  const itemRows = d.mounts.items
    .filter((m) => pwMatches(m.name, m.stdmode, m.idx))
    .map((m) =>
      '<tr><td>' + pwEsc(m.name) + ' <span class="fmeta">#' + pwEsc(m.idx) + '</span></td>' +
      '<td>' + pwEsc(m.stdmode) + '</td><td>' + pwEsc(m.needLevel) + '</td>' +
      '<td>' + pwEsc(m.price) + '</td><td>' + pwSourceText(m.sources) + '</td>' +
      '<td>' + pwBtn('物品', 'item', m.index) + '</td></tr>');
  const itemBody = pwTable(['物品', 'Stdmode', '需求等级', '价格', '来源', '操作'], itemRows);

  const raceRows = d.mounts.races
    .filter((r) => pwMatches(r.name, r.race))
    .map((r) =>
      '<tr><td>' + pwEsc(r.name) + '</td><td>' + pwEsc(r.race) + '</td>' +
      '<td>' + pwEsc(r.appr) + '</td><td>' + pwEsc(r.hp) + '</td></tr>');
  const raceBody = pwTable(['名称', 'Race', 'Appr', 'HP'], raceRows);

  const rideScripts = d.scripts.filter((s) =>
    s.apis.includes('getPetsNumExpertHorse') || s.apis.includes('giveHorseTicket') ||
    /merlotte|merstabl|quejacka|spemaper/i.test(s.name));
  const scriptRows = rideScripts
    .filter((s) => pwMatches(s.name, s.apis.join(' '), s.items.join(' ')))
    .map((s) =>
      '<tr><td>' + pwEsc(s.name) + '</td><td>' + s.refs + '</td>' +
      '<td>' + pwEsc(s.apis.join('、') || '—') + '</td>' +
      '<td>' + pwBtn('定位脚本', 'script', s.name, s.firstLine) + '</td></tr>');
  const scriptBody = pwTable(['脚本', '引用行', '骑乘接口', '操作'], scriptRows);

  const npcRows = d.npcs.ride
    .filter((n) => pwMatches(n.name, n.script, n.mapName, n.map))
    .map((n) => {
      const where = n.mapName ? n.mapName + '(' + n.map + ')' : n.map;
      return '<tr><td>' + pwEsc(n.name) + ' <span class="fmeta">' + pwEsc(n.id) + '</span></td>' +
        '<td>' + pwEsc(n.script) + '</td><td>' + pwEsc(where) + ' ' + n.x + ',' + n.y + '</td>' +
        '<td>' + pwBtn('定位 NPC', 'npc', n.index) + '</td></tr>';
    });
  const npcBody = pwTable(['NPC', '脚本', '位置', '操作'], npcRows);

  const rideIssues = d.issues.filter((issue) =>
    /merstabl|骑乘|骑|马/i.test(String(issue.scope || '') + ' ' + issue.code + ' ' + issue.message));
  const issueBody = pwIssueList(pwFilterIssues(rideIssues), 'ride');

  return pwRenderRideParams(d) +
    pwSection('马牌与骑乘物品', 'mount-items', d.mounts.items.length + ' 项', itemBody) +
    pwSection('坐骑形态', 'races', d.mounts.races.length + ' 个', raceBody) +
    pwSection('骑乘脚本', 'ride-scripts', rideScripts.length + ' 个', scriptBody) +
    pwSection('骑乘相关 NPC', 'ride-npcs', d.npcs.ride.length + ' 个', npcBody) +
    pwSection('骑乘体检', 'ride-health', rideIssues.length + ' 条', issueBody);
}

function pwRenderNav(d) {
  const list = pwEl('petwNavList');
  if (!list) return;
  const counts = {
    all: (d.capabilities || []).length,
    growth: d.stats.stages,
    rebirth: d.materials.length,
    ride: d.mounts.items.length
  };
  list.innerHTML = PW_SECTIONS.map((s) =>
    '<li class="file-item' + (PW.section === s.key ? ' active' : '') + '" data-pw-section="' + s.key + '">' +
    '<div class="fname">' + pwEsc(s.label) + '</div>' +
    '<div class="fmeta">' + counts[s.key] + ' 项</div></li>').join('');
  const hint = pwEl('petwListHint');
  if (hint) {
    hint.textContent = (d.capabilities || []).map((c) => c.label + ' ' + c.verdict).join(' · ');
  }
}

function pwRender() {
  const d = PW.data;
  if (!d) return;
  pwRenderSummary(d);
  const box = pwEl('petwContent');
  if (!box) return;
  const parts = {
    all: () => pwRenderOverview(d),
    growth: () => pwRenderGrowth(d),
    rebirth: () => pwRenderRebirth(d),
    ride: () => pwRenderRide(d)
  };
  const showAll = !!PW.q.trim() || !parts[PW.section];
  box.innerHTML = showAll
    ? ['all', 'growth', 'rebirth', 'ride'].map((k) => parts[k]()).join('')
    : parts[PW.section]();
  pwRenderNav(d);
  const meta = pwEl('petwMeta');
  if (meta) {
    meta.textContent = (d.server.name || '未读取区名') + ' · ' +
      (d.capabilities || []).map((c) => c.label + ' ' + c.verdict).join(' · ') + ' · ' +
      d.stats.error + ' 错误 / ' + d.stats.warn + ' 警告 / ' + d.stats.info + ' 提示';
  }
}

async function pwLoad(refresh) {
  if (PW.loading) return;
  PW.loading = true;
  const meta = pwEl('petwMeta');
  if (meta) meta.textContent = '正在检查灵兽与骑乘配置…';
  try {
    PW.data = await api('/api/config/petwork' + (refresh ? '?refresh=1' : ''));
    PW.stale = false;
    pwRender();
  } finally {
    PW.loading = false;
  }
}

async function pwRunAction(action) {
  if (!action) return;
  if (action.section) {
    pwSelectSection(action.section);
    return;
  }
  if (action.view === 'growth') {
    pwSelectSection('growth');
    return;
  }
  if (action.view === 'item') {
    if (window.hidePetWorkView) window.hidePetWorkView();
    if (window.openItemDropView) return window.openItemDropView({ tab: 'detail', itemIndex: Number(action.index) });
    return;
  }
  if (action.view === 'script' && action.name) {
    if (window.hidePetWorkView) window.hidePetWorkView();
    if (window.openScriptView) return window.openScriptView({ tab: 'detail', name: action.name, line: action.line });
    return;
  }
  if (action.view === 'npc' && action.index != null) {
    if (window.hidePetWorkView) window.hidePetWorkView();
    if (window.openNpcWorkView) return window.openNpcWorkView(Number(action.index));
  }
}

async function pwJump(btn) {
  const kind = btn.dataset.pwKind;
  const val = btn.dataset.pwVal || '';
  const line = btn.dataset.pwLine ? Number(btn.dataset.pwLine) : 0;
  if (!kind) return;
  if (kind === 'section' || kind === 'growth') {
    pwSelectSection(kind === 'growth' ? 'growth' : val);
    return;
  }
  if (window.hidePetWorkView) window.hidePetWorkView();
  if (kind === 'item') {
    if (window.openItemDropView) return window.openItemDropView({ tab: 'detail', itemIndex: Number(val) });
    return;
  }
  if (kind === 'script') {
    if (window.openScriptView) return window.openScriptView({ tab: 'detail', name: val, line: line || undefined });
    return;
  }
  if (kind === 'npc') {
    if (window.openNpcWorkView) return window.openNpcWorkView(Number(val));
    return;
  }
  if (kind === 'param') {
    if (window.openExtraKeyAt) return window.openExtraKeyAt('gameserver', { line });
  }
}

function pwSelectSection(key) {
  PW.section = key || 'all';
  pwRender();
  pwSetHash();
  const content = pwEl('petwContent');
  if (content) content.scrollIntoView({ block: 'start' });
}

function pwHashState() {
  const m = /^#petwork(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  let raw = m[1] || '';
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
  }
  return { section: PW_SECTIONS.some((s) => s.key === raw) ? raw : 'all' };
}

function pwSetHash() {
  const next = PW.section && PW.section !== 'all' ? '#petwork=' + PW.section : '#petwork';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function openPetWorkView(sel) {
  if (S.mode !== 'petwork' && typeof confirmDiscard === 'function' && !(await confirmDiscard())) return;
  S.mode = 'petwork';
  if (typeof hideAllViews === 'function') hideAllViews();
  const view = pwEl('petworkView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('petw');
  if (window.updateMeta) window.updateMeta();
  const status = pwEl('statusText');
  if (status) status.textContent = '灵兽与骑乘 · 只读汇总';
  const target = sel || pwHashState();
  if (target && target.section) PW.section = target.section;
  if (sel) {
    PW.q = '';
    const query = pwEl('petwFilter');
    if (query) query.value = '';
  }
  pwRender();
  try {
    if (!PW.data || PW.stale) await pwLoad(false);
    else pwRender();
  } catch (e) {
    pwRender();
    if (typeof toast === 'function') toast('加载灵兽与骑乘工作台失败：' + e.message, 'err');
    return;
  }
  pwSetHash();
}

function hidePetWorkView() {
  const view = pwEl('petworkView');
  if (view) view.classList.add('hidden');
}

function refreshPetWorkState() {
  PW.stale = true;
}

function pwBind() {
  const filter = pwEl('petwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      PW.q = filter.value;
      if (PW.data) pwRender();
    });
  }
  const nav = pwEl('petwNavList');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const item = e.target.closest('[data-pw-section]');
      if (!item) return;
      pwSelectSection(item.dataset.pwSection);
    });
  }
  const content = pwEl('petwContent');
  if (content) {
    content.addEventListener('click', (e) => {
      const issueBtn = e.target.closest('[data-pw-issue]');
      if (issueBtn) {
        const list = PW.lists[issueBtn.dataset.pwIssueList] || [];
        const issue = list[Number(issueBtn.dataset.pwIssue)];
        if (issue) pwRunAction(issue.action).catch((err) => {
          if (typeof toast === 'function') toast('定位失败：' + err.message, 'err');
        });
        return;
      }
      const btn = e.target.closest('[data-pw-kind]');
      if (!btn) return;
      pwJump(btn).catch((err) => {
        if (typeof toast === 'function') toast('定位失败：' + err.message, 'err');
      });
    });
  }
  const reload = pwEl('btnPetwReload');
  if (reload) {
    reload.addEventListener('click', () => {
      pwLoad(true).catch((e) => {
        if (typeof toast === 'function') toast('重新检查失败：' + e.message, 'err');
      });
    });
  }
  window.addEventListener('hashchange', () => {
    const state = pwHashState();
    if (state) openPetWorkView(state);
  });
}

window.openPetWorkView = openPetWorkView;
window.hidePetWorkView = hidePetWorkView;
window.refreshPetWorkState = refreshPetWorkState;

pwBind();

const pwInitial = pwHashState();
if (pwInitial) {
  if (window.appReady && typeof window.appReady.then === 'function') {
    window.appReady.then(() => openPetWorkView(pwInitial));
  } else {
    openPetWorkView(pwInitial);
  }
}

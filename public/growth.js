'use strict';

/* 数值 / 成长工作台：技能、三职业成长、升级经验、宠物成长与配置体检（只读） */

const GRW = {
  data: null,
  loading: false,
  stale: true,
  tab: 'skills',
  filter: '',
  job: 'all',
  flag: 'all',
  skillId: null,
  classKey: 'warrior',
  classMetric: 'hp',
  upgradeLevel: null,
  petKey: null,
  searchTimer: null
};

const GRW_TAB_KEYS = ['skills', 'classes', 'upgrades', 'pets', 'health'];

const GRW_SEV = { error: '错误', warn: '警告', info: '提示' };

const GRW_ISSUE_LABEL = {
  growth_file_unreadable: '文件无法读取',
  growth_magic_duplicate_id: '技能 ID 重复',
  growth_magic_duplicate_name: '技能重名',
  growth_magic_id_gap: '技能 ID 不连续',
  growth_magic_name_empty: '技能缺少名称',
  growth_magic_power: '技能威力异常',
  growth_magic_need_order: '需求等级不递增',
  growth_magic_negative: '技能数值为负',
  growth_magic_level_over: '技能等级超上限',
  growth_class_exp_decrease: '经验下降',
  growth_class_exp_plateau: '经验封顶',
  growth_class_stat_decrease: '属性下降',
  growth_class_negative: '属性为负',
  growth_class_length: '职业表长度不一致',
  growth_upgrade_duplicate: '升级档位重复',
  growth_upgrade_exp_decrease: '升级经验下降',
  growth_upgrade_negative: '升级经验为负',
  growth_upgrade_level_gap: '升级档位缺失',
  growth_pet_level_gap: '宠物等级断档',
  growth_pet_stat_decrease: '宠物属性下降',
  growth_pet_exp_decrease: '宠物经验下降',
  growth_pet_exp_plateau: '宠物经验封顶',
  growth_pet_negative: '宠物数值为负'
};

const GRW_GROUPS = {
  magic: '技能',
  class: '职业成长',
  upgrade: '升级经验',
  pet: '宠物成长',
  tab: '总览',
  other: '其他'
};

function grwEl(id) {
  return document.getElementById(id);
}

function grwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function grwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function grwText(id, text) {
  const el = grwEl(id);
  if (el) el.textContent = text;
}

function grwIssueCount(n) {
  return (n && (n.error + n.warn)) || 0;
}

function grwTotalIssue(n) {
  return (n && (n.error + n.warn + n.info)) || 0;
}

function grwFmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 100000000) return (v / 100000000).toFixed(2).replace(/\.?0+$/, '') + ' 亿';
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(2).replace(/\.?0+$/, '') + ' 万';
  return String(Math.round(v));
}

function grwFmtExact(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US');
}

function grwBadge(text, cls) {
  return '<span class="grw-badge' + (cls ? ' ' + cls : '') + '">' + grwEsc(text) + '</span>';
}

function grwKv(label, value, cls) {
  return '<div class="tsk-kv"><div class="tsk-kv-label">' + grwEsc(label) +
    '</div><div class="tsk-kv-value' + (cls ? ' ' + cls : '') + '">' +
    grwEsc(value == null || value === '' ? '—' : value) + '</div></div>';
}

function grwSection(title, note, body) {
  return '<div class="tsk-section"><div class="tsk-section-head"><h4>' + grwEsc(title) + '</h4>' +
    (note ? '<span class="tsk-empty">' + grwEsc(note) + '</span>' : '') + '</div>' + body + '</div>';
}

function grwHashState() {
  const m = /^#growth(?:=(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  const raw = m[1] || '';
  if (!raw) return { tab: 'skills' };
  if (raw === 'health') return { tab: 'health' };
  if (raw === 'classes') return { tab: 'classes' };
  if (raw === 'upgrades') return { tab: 'upgrades' };
  if (raw === 'pets') return { tab: 'pets' };
  if (raw === 'skills') return { tab: 'skills' };
  let mm = /^skill-(\d+)$/.exec(raw);
  if (mm) return { tab: 'skills', skillId: Number(mm[1]) };
  mm = /^class-(\w+)$/.exec(raw);
  if (mm) return { tab: 'classes', classKey: mm[1] };
  mm = /^upgrade-(\d+)$/.exec(raw);
  if (mm) return { tab: 'upgrades', upgradeLevel: Number(mm[1]) };
  mm = /^pet-([\w-]+)$/.exec(raw);
  if (mm) return { tab: 'pets', petKey: mm[1] };
  return { tab: 'skills' };
}

function grwSetHash(sel) {
  let raw = '';
  if (sel && sel.tab === 'skills' && sel.skillId != null) raw = 'skill-' + sel.skillId;
  else if (sel && sel.tab === 'classes' && sel.classKey) raw = 'class-' + sel.classKey;
  else if (sel && sel.tab === 'upgrades' && sel.upgradeLevel != null) raw = 'upgrade-' + sel.upgradeLevel;
  else if (sel && sel.tab === 'pets' && sel.petKey) raw = 'pet-' + sel.petKey;
  else if (sel && sel.tab === 'health') raw = 'health';
  const next = raw ? '#growth=' + raw : '#growth';
  if (next === (location.hash || '')) return;
  try {
    history.replaceState(null, '', location.pathname + location.search + next);
  } catch (e) {
  }
}

async function grwLoad() {
  if (GRW.loading) return;
  GRW.loading = true;
  grwRenderMeta();
  try {
    const data = await api('/api/config/growth');
    GRW.data = data;
    GRW.stale = false;
    grwText('grwCount', String(data.stats.skills));
    grwEnsureSelection();
  } finally {
    GRW.loading = false;
  }
}

function grwEnsureSelection() {
  const d = GRW.data;
  if (!d) return;
  if (GRW.skillId == null && d.skills.length) GRW.skillId = d.skills[0].id;
  if (!d.classes.some((c) => c.key === GRW.classKey)) GRW.classKey = d.classes[0] ? d.classes[0].key : null;
  if (GRW.upgradeLevel == null && d.upgrades.length) GRW.upgradeLevel = d.upgrades[0].level;
  if (!d.upgrades.some((u) => u.level === GRW.upgradeLevel) && d.upgrades.length) {
    GRW.upgradeLevel = d.upgrades[0].level;
  }
  if (GRW.petKey == null && d.pets.length) GRW.petKey = d.pets[0].key;
  if (!d.pets.some((p) => p.key === GRW.petKey)) GRW.petKey = d.pets[0] ? d.pets[0].key : null;
}

function grwRenderMeta() {
  const meta = grwEl('grwMeta');
  if (!meta) return;
  if (!GRW.data) {
    meta.textContent = GRW.loading ? '正在加载…' : '';
    return;
  }
  const s = GRW.data.stats;
  meta.textContent = [
    s.skills + ' 个技能',
    '战士 ' + s.jobs.warrior + ' / 法师 ' + s.jobs.mage + ' / 道士 ' + s.jobs.taoist,
    s.classes + ' 张职业表（' + s.classLevels + ' 级）',
    s.upgrades + ' 组升级',
    s.pets + ' 种宠物（' + s.petLevels + ' 级）',
    '问题 ' + s.issues.error + ' 错误 / ' + s.issues.warn + ' 警告 / ' + s.issues.info + ' 提示'
  ].join(' · ');
  grwText('grwCount', String(s.skills));
}

function grwRenderTabs() {
  document.querySelectorAll('#grwTabs [data-grw-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.grwTab === GRW.tab);
  });
  const map = {
    skills: 'grwSkillPane',
    classes: 'grwClassPane',
    upgrades: 'grwUpgradePane',
    pets: 'grwPetPane',
    health: 'grwHealthPane'
  };
  Object.keys(map).forEach((key) => {
    const el = grwEl(map[key]);
    if (el) el.classList.toggle('hidden', key !== GRW.tab);
  });
}

function grwSelectTab(tab) {
  if (GRW_TAB_KEYS.indexOf(tab) < 0) return;
  GRW.tab = tab;
  grwRenderTabs();
  if (tab === 'skills') grwRenderSkill();
  else if (tab === 'classes') grwRenderClass();
  else if (tab === 'upgrades') grwRenderUpgrade();
  else if (tab === 'pets') grwRenderPet();
  else grwRenderHealth();
  if (tab === 'skills') grwSetHash({ tab: 'skills', skillId: GRW.skillId });
  else if (tab === 'classes') grwSetHash({ tab: 'classes', classKey: GRW.classKey });
  else if (tab === 'upgrades') grwSetHash({ tab: 'upgrades', upgradeLevel: GRW.upgradeLevel });
  else if (tab === 'pets') grwSetHash({ tab: 'pets', petKey: GRW.petKey });
  else grwSetHash({ tab: 'health' });
}

function grwMatchesSkill(s, q) {
  if (!q) return true;
  return (
    String(s.name || '').toLowerCase().includes(q) ||
    String(s.id) === q ||
    String(s.jobLabel || '').toLowerCase().includes(q)
  );
}

function grwRenderList() {
  const list = grwEl('grwList');
  const hint = grwEl('grwListHint');
  if (!list) return;
  grwClear(list);
  if (!GRW.data) {
    if (hint) hint.textContent = GRW.loading ? '正在加载成长数据…' : '';
    return;
  }
  const q = GRW.filter.trim().toLowerCase();
  const all = GRW.data.skills.filter((s) => {
    if (GRW.job !== 'all' && s.jobGroup !== GRW.job) return false;
    if (GRW.flag === 'issues' && grwIssueCount(s.issues) === 0) return false;
    return grwMatchesSkill(s, q);
  });
  for (const s of all) {
    const li = document.createElement('li');
    li.className = 'file-item' + (GRW.skillId === s.id ? ' active' : '');
    li.dataset.grwSkill = String(s.id);
    const name = document.createElement('div');
    name.className = 'fname';
    name.textContent = s.name || '（未命名技能）';
    name.insertAdjacentHTML('beforeend', grwBadge(s.jobLabel, s.jobGroup === 'special' ? 'special' : ''));
    const issues = grwIssueCount(s.issues);
    if (issues) name.insertAdjacentHTML('beforeend', grwBadge('问题 ' + issues, 'bad'));
    li.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    meta.textContent = ['MagID ' + s.id, '需求 ' + s.need.join('/'), '威力 ' + s.power + '–' + s.maxPower].join(' · ');
    li.appendChild(meta);
    list.appendChild(li);
  }
  if (!all.length) {
    const empty = document.createElement('li');
    empty.className = 'side-note';
    empty.textContent = '没有符合条件的技能。';
    list.appendChild(empty);
  }
  if (hint) hint.textContent = '共 ' + all.length + ' 个技能。';
}

function grwSkillIssues(id) {
  if (!GRW.data) return [];
  return GRW.data.issues.filter((i) => i.action && i.action.view === 'magic' && i.action.id === id);
}

function grwRenderSkill() {
  const box = grwEl('grwSkillDetail');
  if (!box) return;
  const d = GRW.data;
  if (!d) {
    box.innerHTML = '<div class="grw-empty">正在加载技能数据…</div>';
    return;
  }
  const skill = d.skills.find((s) => s.id === GRW.skillId) || d.skills[0];
  if (!skill) {
    box.innerHTML = '<div class="grw-empty">没有可展示的技能。</div>';
    return;
  }
  GRW.skillId = skill.id;
  const issues = grwSkillIssues(skill.id);
  const head =
    '<div class="grw-skill-head">' +
      '<div><strong>' + grwEsc(skill.name || '（未命名技能）') + '</strong>' +
      '<div class="muted">' + grwEsc(skill.jobLabel) + ' · MagID ' + grwEsc(skill.id) +
      ' · magic.db 第 ' + grwEsc(skill.row + 1) + ' 条</div></div>' +
      '<div class="grw-skill-tags">' +
        grwBadge('需求 ' + skill.need.join(' / ') + ' 级', 'job') +
        (skill.delay ? grwBadge('延迟 ' + skill.delay, '') : '') +
        (issues.length ? grwBadge('问题 ' + issues.length, 'bad') : '') +
      '</div>' +
    '</div>';
  const kv = '<div class="grw-kv-grid">' +
    grwKv('MagID', skill.id) +
    grwKv('职业', skill.jobLabel) +
    grwKv('效果类型 EffectType', skill.effectType) +
    grwKv('效果 Effect', skill.effect) +
    grwKv('吟唱 Spell', skill.spell) +
    grwKv('延迟 Delay', skill.delay) +
    grwKv('威力 Power', skill.power) +
    grwKv('威力上限 MaxPower', skill.maxPower, skill.maxPower < skill.power ? 'bad' : '') +
    grwKv('防御 DefSpell', skill.defSpell) +
    grwKv('防御下限 DefPower', skill.defPower) +
    grwKv('防御上限 DefMaxPower', skill.defMaxPower) +
    '</div>';
  const levelRows = [1, 2, 3].map((n) =>
    '<tr><td>' + n + ' 级</td><td>' + grwFmtExact(skill.need[n - 1]) + '</td><td>' +
    grwFmtExact(skill.train[n - 1]) + '</td></tr>').join('');
  const levelTable = '<table class="grw-table"><thead><tr><th>阶段</th><th>需求等级</th><th>修炼点</th></tr></thead>' +
    '<tbody>' + levelRows + '</tbody></table>';
  const descr = skill.descr
    ? '<div class="grw-text">' + grwEsc(skill.descr) + '</div>'
    : '<div class="grw-empty">magic.db 未填写 Descr 描述。</div>';
  const equal = skill.equal
    ? '<div class="grw-text">' + grwEsc(skill.equal) + '</div>'
    : '<div class="grw-empty">无 Equal 备注。</div>';
  const issueHtml = issues.length
    ? '<div class="mon-issues">' + issues.map((i) => grwIssueRow(i)).join('') + '</div>'
    : '<div class="grw-empty">该技能未发现问题。</div>';
  const actions = '<div class="grw-actions">' +
    '<button class="btn btn-sm" data-grw-act="db" data-name="magic.db" data-search="' + grwEsc(skill.name) + '">在 DB 编辑器中打开 magic.db</button>' +
    '</div>';
  box.innerHTML = head +
    grwSection('基础数值', '', kv) +
    grwSection('逐级需求', skill.need.join(' / ') + ' 级', levelTable) +
    grwSection('描述', '', descr) +
    grwSection('备注', '', equal) +
    grwSection('该技能体检', issues.length ? issues.length + ' 项' : '', issueHtml) +
    actions;
}

function grwChart(series, opts) {
  const o = opts || {};
  const W = 720;
  const H = o.height || 220;
  const pad = { l: 58, r: 16, t: 16, b: 28 };
  const vals = [];
  for (const s of series) {
    for (const v of s.values) {
      if (v != null && Number.isFinite(Number(v))) vals.push(Number(v));
    }
  }
  if (!vals.length) return '<div class="grw-empty">暂无可绘制数据。</div>';
  const lo0 = Math.min.apply(null, vals);
  const hi0 = Math.max.apply(null, vals);
  const log = !!o.log && hi0 >= Math.max(1, lo0) * 20;
  const tr = (v) => (log ? Math.log10(Math.max(1, v)) : v);
  const lo = log ? Math.max(1, lo0) : lo0;
  const hi = hi0;
  let tlo = tr(lo);
  let thi = tr(hi);
  if (thi === tlo) thi = tlo + 1;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const x = (i) => pad.l + (i / (n - 1)) * iw;
  const y = (v) => pad.t + ih - ((tr(v) - tlo) / (thi - tlo)) * ih;
  let svg = '<svg class="grw-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
    grwEsc(o.title || '成长曲线') + '">';
  for (let g = 0; g <= 4; g++) {
    const raw = tlo + ((thi - tlo) * g) / 4;
    const val = log ? Math.pow(10, raw) : raw;
    const yy = y(val);
    svg += '<line class="grw-grid" x1="' + pad.l + '" y1="' + yy.toFixed(1) + '" x2="' + (W - pad.r) +
      '" y2="' + yy.toFixed(1) + '"></line>';
    svg += '<text class="grw-axis" x="' + (pad.l - 8) + '" y="' + (yy + 4).toFixed(1) +
      '" text-anchor="end">' + grwEsc(grwFmt(val)) + '</text>';
  }
  for (const s of series) {
    const pts = [];
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(Number(v))) return;
      pts.push(x(i).toFixed(1) + ',' + y(Number(v)).toFixed(1));
    });
    if (pts.length) {
      svg += '<polyline class="grw-line" style="stroke:' + grwEsc(s.color) + '" points="' + pts.join(' ') +
        '"></polyline>';
      if (pts.length === 1) {
        const p = pts[0].split(',');
        svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="' + grwEsc(s.color) + '"></circle>';
      }
    }
  }
  svg += '</svg>';
  const legend = '<div class="grw-legend">' + series.map((s) =>
    '<span><i class="grw-swatch" style="background:' + grwEsc(s.color) + '"></i>' + grwEsc(s.label) + '</span>'
  ).join('') + (log ? '<span class="muted">纵轴为对数刻度</span>' : '') + '</div>';
  return svg + legend;
}

function grwClassIssues(key) {
  if (!GRW.data) return [];
  return GRW.data.issues.filter((i) => i.action && i.action.view === 'class' && i.action.key === key);
}

function grwClassSeries(cls, metric) {
  const rows = cls.rows;
  const pick = (field) => rows.map((r) => r[field]);
  if (metric === 'hp') return { title: 'HP 成长', log: false, series: [{ label: 'HP', color: '#e05c5c', values: pick('hp') }] };
  if (metric === 'mp') return { title: 'MP 成长', log: false, series: [{ label: 'MP', color: '#4f8fe0', values: pick('mp') }] };
  if (metric === 'exp') return { title: '升级经验', log: true, series: [{ label: '经验', color: '#d8a531', values: pick('exp') }] };
  if (metric === 'attack') return { title: '攻击成长', log: false, series: [
    { label: '下限', color: '#e05c5c', values: pick('dcMin') },
    { label: '上限', color: '#e0955c', values: pick('dcMax') }
  ] };
  if (metric === 'magic') return { title: '魔法成长', log: false, series: [
    { label: '下限', color: '#4f8fe0', values: pick('mcMin') },
    { label: '上限', color: '#6fa8ec', values: pick('mcMax') }
  ] };
  if (metric === 'taoist') return { title: '道术成长', log: false, series: [
    { label: '下限', color: '#3aa981', values: pick('scMin') },
    { label: '上限', color: '#64c9a3', values: pick('scMax') }
  ] };
  if (metric === 'ac') return { title: '防御成长', log: false, series: [
    { label: '下限', color: '#8a7bd8', values: pick('acMin') },
    { label: '上限', color: '#a99be8', values: pick('acMax') }
  ] };
  return { title: '魔法防御成长', log: false, series: [
    { label: '下限', color: '#8a7bd8', values: pick('macMin') },
    { label: '上限', color: '#a99be8', values: pick('macMax') }
  ] };
}

const GRW_CLASS_METRICS = [
  ['hp', 'HP'], ['mp', 'MP'], ['exp', '经验'], ['attack', '攻击'],
  ['magic', '魔法'], ['taoist', '道术'], ['ac', '防御'], ['mac', '魔防']
];

function grwRenderClass() {
  const box = grwEl('grwClass');
  if (!box) return;
  const d = GRW.data;
  if (!d) {
    box.innerHTML = '<div class="grw-empty">正在加载职业数据…</div>';
    return;
  }
  if (!d.classes.length) {
    box.innerHTML = '<div class="grw-empty">没有可用的职业成长表。</div>';
    return;
  }
  const cls = d.classes.find((c) => c.key === GRW.classKey) || d.classes[0];
  GRW.classKey = cls.key;
  const issueCount = grwTotalIssue(cls.issues);
  const seg = '<div class="grw-seg">' + d.classes.map((c) => {
    const cnt = grwIssueCount(c.issues);
    return '<button class="btn btn-sm' + (c.key === cls.key ? ' active' : '') + '" data-grw-class="' + grwEsc(c.key) +
      '">' + grwEsc(c.name) + ' ' + c.rows.length + ' 级' + (cnt ? ' · 问题 ' + cnt : '') + '</button>';
  }).join('') + '</div>';
  const metrics = '<div class="grw-seg grw-seg-sm">' + GRW_CLASS_METRICS.map(([key, label]) =>
    '<button class="btn btn-sm' + (key === GRW.classMetric ? ' active' : '') + '" data-grw-metric="' + key + '">' +
    label + '</button>').join('') + '</div>';
  const conf = grwClassSeries(cls, GRW.classMetric);
  const chart = grwChart(conf.series, { title: cls.name + ' ' + conf.title, log: conf.log });
  const stats = '<div class="grw-kv-grid">' +
    grwKv('等级范围', cls.rows[0].level + ' – ' + cls.rows[cls.rows.length - 1].level + ' 级') +
    grwKv('HP', grwFmtExact(cls.stats.hpStart) + ' → ' + grwFmtExact(cls.stats.hpEnd)) +
    grwKv('MP', grwFmtExact(cls.stats.mpStart) + ' → ' + grwFmtExact(cls.stats.mpEnd)) +
    grwKv('升级经验', grwFmt(cls.stats.expStart) + ' → ' + grwFmt(cls.stats.expEnd)) +
    '</div>';
  const rows = cls.rows.map((r) =>
    '<tr><td>' + r.level + '</td><td>' + grwFmtExact(r.exp) + '</td><td>' + grwFmtExact(r.hp) +
    '</td><td>' + grwFmtExact(r.mp) + '</td><td>' + r.dcMin + '-' + r.dcMax + '</td><td>' + r.mcMin + '-' + r.mcMax +
    '</td><td>' + r.scMin + '-' + r.scMax + '</td><td>' + r.acMin + '-' + r.acMax +
    '</td><td>' + r.macMin + '-' + r.macMax + '</td></tr>').join('');
  const table = '<div class="grw-table-wrap"><table class="grw-table"><thead><tr>' +
    '<th>等级</th><th>经验</th><th>HP</th><th>MP</th><th>攻击</th><th>魔法</th><th>道术</th><th>防御</th><th>魔防</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  const issues = grwClassIssues(cls.key);
  const issueHtml = issues.length
    ? '<div class="mon-issues">' + issues.map((i) => grwIssueRow(i)).join('') + '</div>'
    : '<div class="grw-empty">该职业表未发现问题。</div>';
  const actions = '<div class="grw-actions">' +
    '<button class="btn btn-sm" data-grw-act="db" data-name="' + grwEsc(cls.file) + '">在 DB 编辑器中打开 ' + grwEsc(cls.file) + '</button>' +
    '</div>';
  box.innerHTML = seg + metrics +
    grwSection(cls.name + '总览', issueCount ? '问题 ' + issueCount : '', stats) +
    grwSection(cls.name + '成长曲线', conf.title, chart) +
    grwSection(cls.name + '逐级数值', cls.rows.length + ' 级', table) +
    grwSection(cls.name + '体检', issues.length ? issues.length + ' 项' : '', issueHtml) +
    actions;
}

function grwUpgradeIssues(level) {
  if (!GRW.data) return [];
  return GRW.data.issues.filter((i) =>
    i.action && i.action.view === 'upgrade' && i.action.level === level);
}

function grwRenderUpgrade() {
  const box = grwEl('grwUpgrade');
  if (!box) return;
  const d = GRW.data;
  if (!d) {
    box.innerHTML = '<div class="grw-empty">正在加载升级数据…</div>';
    return;
  }
  if (!d.upgrades.length) {
    box.innerHTML = '<div class="grw-empty">没有可用的升级经验数据。</div>';
    return;
  }
  const up = d.upgrades.find((u) => u.level === GRW.upgradeLevel) || d.upgrades[0];
  GRW.upgradeLevel = up.level;
  const seg = '<div class="grw-seg">' + d.upgrades.map((u) =>
    '<button class="btn btn-sm' + (u.level === up.level ? ' active' : '') + '" data-grw-upgrade="' + u.level +
    '">怪物等级 ' + u.level + (u.missing.length ? ' · 缺 ' + u.missing.join('/') : '') + '</button>').join('') + '</div>';
  const chart = grwChart([{ label: '升级经验', color: '#d8a531', values: up.rows.map((r) => r.exp) }],
    { title: '怪物等级 ' + up.level + ' 升级经验', log: true });
  const stats = '<div class="grw-kv-grid">' +
    grwKv('档位范围', (up.stats.minUpgrade || '—') + ' – ' + (up.stats.maxUpgrade || '—')) +
    grwKv('经验范围', grwFmt(up.stats.expMin) + ' – ' + grwFmt(up.stats.expMax)) +
    grwKv('缺失档位', up.missing.length ? up.missing.join('、') : '无') +
    grwKv('数据行数', up.rows.length) +
    '</div>';
  const rows = up.rows.map((r) =>
    '<tr><td>升级 ' + r.level + '</td><td>' + grwFmtExact(r.exp) + '</td><td>' +
    grwEsc(r.describe || '—') + '</td><td>Upgrade.DB 第 ' + (r.row + 1) + ' 行</td></tr>').join('');
  const table = '<div class="grw-table-wrap"><table class="grw-table"><thead><tr>' +
    '<th>升级档位</th><th>经验</th><th>Describe</th><th>来源</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  const issues = grwUpgradeIssues(up.level);
  const issueHtml = issues.length
    ? '<div class="mon-issues">' + issues.map((i) => grwIssueRow(i)).join('') + '</div>'
    : '<div class="grw-empty">该怪物等级未发现问题。</div>';
  const actions = '<div class="grw-actions">' +
    '<button class="btn btn-sm" data-grw-act="db" data-name="Upgrade.DB">在 DB 编辑器中打开 Upgrade.DB</button>' +
    '</div>';
  box.innerHTML = seg +
    grwSection('怪物等级 ' + up.level + ' 总览', '', stats) +
    grwSection('升级经验曲线', '', chart) +
    grwSection('逐档数据', up.rows.length + ' 档', table) +
    grwSection('体检', issues.length ? issues.length + ' 项' : '', issueHtml) +
    actions;
}

function grwPetIssues(key) {
  if (!GRW.data) return [];
  return GRW.data.issues.filter((i) => i.action && i.action.view === 'pet' && i.action.key === key);
}

function grwRenderPet() {
  const box = grwEl('grwPet');
  if (!box) return;
  const d = GRW.data;
  if (!d) {
    box.innerHTML = '<div class="grw-empty">正在加载宠物数据…</div>';
    return;
  }
  if (!d.pets.length) {
    box.innerHTML = '<div class="grw-empty">没有可用的宠物成长数据。</div>';
    return;
  }
  const pet = d.pets.find((p) => p.key === GRW.petKey) || d.pets[0];
  GRW.petKey = pet.key;
  const seg = '<div class="grw-seg">' + d.pets.map((p) => {
    const cnt = grwIssueCount(p.issues);
    return '<button class="btn btn-sm' + (p.key === pet.key ? ' active' : '') + '" data-grw-pet="' + grwEsc(p.key) +
      '">' + grwEsc(p.name) + ' · ' + p.rows.length + ' 级' + (cnt ? ' · 问题 ' + cnt : '') + '</button>';
  }).join('') + '</div>';
  const series = [
    { label: 'HP', color: '#e05c5c', values: pet.rows.map((r) => r.hp) },
    { label: '攻击下限', color: '#d8a531', values: pet.rows.map((r) => r.dc) },
    { label: '攻击上限', color: '#e0955c', values: pet.rows.map((r) => r.dcMax) },
    { label: '防御', color: '#6fa8ec', values: pet.rows.map((r) => r.ac) },
    { label: '防御上限', color: '#a99be8', values: pet.rows.map((r) => r.acMax) }
  ];
  if (pet.kind === 'taoist') {
    series.push({ label: '魔防', color: '#3aa981', values: pet.rows.map((r) => r.mac) });
  }
  const chart = grwChart(series, { title: pet.name + '成长曲线' });
  const expChart = pet.kind === 'special'
    ? grwSection('宠物经验曲线', '对数刻度',
        grwChart([{ label: '经验', color: '#d8a531', values: pet.rows.map((r) => r.exp) }],
          { title: pet.name + '经验', log: true }))
    : '';
  const stats = '<div class="grw-kv-grid">' +
    grwKv('等级范围', pet.stats.levelMin + ' – ' + pet.stats.levelMax + ' 级') +
    grwKv('HP', grwFmtExact(pet.stats.hpStart) + ' → ' + grwFmtExact(pet.stats.hpEnd)) +
    (pet.kind === 'special'
      ? grwKv('经验', grwFmt(pet.stats.expStart) + ' → ' + grwFmt(pet.stats.expEnd))
      : grwKv('宠物类型', 'PetType ' + pet.type)) +
    grwKv('数据来源', pet.file) +
    '</div>';
  const rows = pet.rows.map((r) =>
    '<tr><td>' + r.level + '</td><td>' + (r.exp == null ? '—' : grwFmtExact(r.exp)) + '</td><td>' +
    grwFmtExact(r.hp) + '</td><td>' + r.dc + '-' + r.dcMax + '</td><td>' + r.ac + '-' + r.acMax +
    '</td><td>' + (r.mac == null ? '—' : r.mac) + '</td><td>' + grwEsc(r.describe || '—') + '</td></tr>').join('');
  const table = '<div class="grw-table-wrap"><table class="grw-table"><thead><tr>' +
    '<th>等级</th><th>经验</th><th>HP</th><th>攻击</th><th>防御</th><th>魔防</th><th>Describe</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  const issues = grwPetIssues(pet.key);
  const issueHtml = issues.length
    ? '<div class="mon-issues">' + issues.map((i) => grwIssueRow(i)).join('') + '</div>'
    : '<div class="grw-empty">该宠物未发现问题。</div>';
  const actions = '<div class="grw-actions">' +
    '<button class="btn btn-sm" data-grw-act="db" data-name="' + grwEsc(pet.file) + '">在 DB 编辑器中打开 ' +
    grwEsc(pet.file) + '</button></div>';
  box.innerHTML = seg +
    grwSection(pet.name + '总览', '', stats) +
    grwSection(pet.name + '成长曲线', '', chart) +
    expChart +
    grwSection(pet.name + '逐级数值', pet.rows.length + ' 级', table) +
    grwSection(pet.name + '体检', issues.length ? issues.length + ' 项' : '', issueHtml) +
    actions;
}

function grwIssueGroup(issue) {
  const view = issue.action && issue.action.view;
  return GRW_GROUPS[view] || GRW_GROUPS.other;
}

function grwIssueRow(issue) {
  const sev = issue.severity || 'info';
  const label = GRW_ISSUE_LABEL[issue.code] || issue.code;
  const where = issue.file ? issue.file + (issue.line != null ? ':' + issue.line : '') : '';
  const idx = GRW.data ? GRW.data.issues.indexOf(issue) : -1;
  const jump = issue.action && idx >= 0
    ? '<button class="btn btn-sm ghost" data-grw-act="jump" data-grw-issue="' + idx + '">查看</button>'
    : '';
  return '<div class="mon-issue grw-issue">' +
    '<span class="mon-sev ' + sev + '">' + grwEsc(GRW_SEV[sev] || sev) + '</span>' +
    '<div class="mon-issue-body"><div class="mon-issue-msg">' + grwEsc(issue.message) + '</div>' +
    '<div class="mon-issue-meta">' + grwEsc(label) +
    (where ? ' · ' + grwEsc(where) : '') + '</div></div>' + jump + '</div>';
}

function grwRenderHealth() {
  const box = grwEl('grwHealthList');
  if (!box) return;
  if (!GRW.data) {
    box.innerHTML = '<div class="grw-empty">正在加载体检数据…</div>';
    return;
  }
  const issues = GRW.data.issues;
  if (!issues.length) {
    box.innerHTML = '<div class="grw-empty">没有发现配置问题。</div>';
    return;
  }
  const groups = {};
  for (const issue of issues) {
    const g = grwIssueGroup(issue);
    if (!groups[g]) groups[g] = [];
    groups[g].push(issue);
  }
  const order = ['技能', '职业成长', '升级经验', '宠物成长', '总览', '其他'];
  let html = '';
  for (const g of order) {
    const list = groups[g];
    if (!list || !list.length) continue;
    const counts = { error: 0, warn: 0, info: 0 };
    for (const i of list) counts[i.severity] = (counts[i.severity] || 0) + 1;
    html += '<div class="mon-issue-group"><div class="mon-issue-head"><strong>' + grwEsc(g) + '</strong>' +
      '<span class="muted">' + list.length + ' 项 · ' + counts.error + ' 错误 / ' + counts.warn +
      ' 警告 / ' + counts.info + ' 提示</span></div>' +
      list.map((i) => grwIssueRow(i)).join('') + '</div>';
  }
  box.innerHTML = html;
}

function grwJumpIssue(issue) {
  if (!issue || !issue.action) return;
  const a = issue.action;
  if (a.view === 'magic') {
    const skill = GRW.data && GRW.data.skills.find((s) => s.id === a.id);
    if (skill) {
      GRW.tab = 'skills';
      GRW.skillId = skill.id;
      grwRenderAll();
      grwSetHash({ tab: 'skills', skillId: skill.id });
      const row = document.querySelector('#grwList [data-grw-skill="' + skill.id + '"]');
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  } else if (a.view === 'class') {
    const cls = GRW.data && GRW.data.classes.find((c) => c.key === a.key);
    if (cls) {
      GRW.tab = 'classes';
      GRW.classKey = cls.key;
      grwRenderAll();
      grwSetHash({ tab: 'classes', classKey: cls.key });
    }
  } else if (a.view === 'upgrade') {
    GRW.tab = 'upgrades';
    GRW.upgradeLevel = a.level;
    grwRenderAll();
    grwSetHash({ tab: 'upgrades', upgradeLevel: a.level });
  } else if (a.view === 'pet') {
    const pet = GRW.data && GRW.data.pets.find((p) => p.key === a.key);
    if (pet) {
      GRW.tab = 'pets';
      GRW.petKey = pet.key;
      grwRenderAll();
      grwSetHash({ tab: 'pets', petKey: pet.key });
    }
  } else if (a.view === 'tab') {
    if (a.tab === 'health') {
      GRW.tab = 'health';
      grwRenderAll();
      grwSetHash({ tab: 'health' });
    } else if (GRW_TAB_KEYS.indexOf(a.tab) >= 0) {
      grwSelectTab(a.tab);
    }
  }
}

async function grwGotoDb(name, search) {
  if (!window.openDb) return;
  await window.openDb(name);
  const input = grwEl('rowSearch');
  if (input && search) {
    input.value = search;
    input.dispatchEvent(new Event('input'));
  }
}

function grwRenderAll() {
  grwRenderMeta();
  grwRenderTabs();
  grwRenderList();
  if (GRW.tab === 'skills') grwRenderSkill();
  else if (GRW.tab === 'classes') grwRenderClass();
  else if (GRW.tab === 'upgrades') grwRenderUpgrade();
  else if (GRW.tab === 'pets') grwRenderPet();
  else grwRenderHealth();
}

function grwSelectSkill(id) {
  if (!GRW.data) return;
  const skill = GRW.data.skills.find((s) => s.id === id);
  if (!skill) return;
  GRW.skillId = id;
  GRW.tab = 'skills';
  grwRenderTabs();
  grwRenderList();
  grwRenderSkill();
  grwSetHash({ tab: 'skills', skillId: id });
  const row = document.querySelector('#grwList [data-grw-skill="' + id + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

async function openGrowthView(sel) {
  if (S.mode !== 'growth' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'growth';
  if (window.hideConfigViews) window.hideConfigViews();
  if (window.hideMonsterView) window.hideMonsterView();
  if (window.hideActivityView) window.hideActivityView();
  if (window.hideTaskView) window.hideTaskView();
  if (window.hideNpcWorkView) window.hideNpcWorkView();
  if (window.hideItemWorkView) window.hideItemWorkView();
  if (window.hideDropWorkView) window.hideDropWorkView();
  if (window.hideSpawnWorkView) window.hideSpawnWorkView();
  if (window.hideMapWorkView) window.hideMapWorkView();
  const dbView = grwEl('dbView');
  const dropView = grwEl('dropView');
  if (dbView) dbView.classList.add('hidden');
  if (dropView) dropView.classList.add('hidden');
  const view = grwEl('growthView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('grw');
  const target = sel || grwHashState() || { tab: GRW.tab };
  if (target.tab && GRW_TAB_KEYS.indexOf(target.tab) >= 0) GRW.tab = target.tab;
  if (target.skillId != null) GRW.skillId = target.skillId;
  if (target.classKey) GRW.classKey = target.classKey;
  if (target.upgradeLevel != null) GRW.upgradeLevel = target.upgradeLevel;
  if (target.petKey) GRW.petKey = target.petKey;
  grwRenderAll();
  if (!GRW.data || GRW.stale) {
    try {
      await grwLoad();
      grwRenderAll();
    } catch (e) {
      grwRenderAll();
      toast('加载成长数据失败：' + e.message, 'err');
      return;
    }
  }
  grwRenderAll();
  if (GRW.tab === 'skills' && GRW.skillId != null) {
    grwSetHash({ tab: 'skills', skillId: GRW.skillId });
    const row = document.querySelector('#grwList [data-grw-skill="' + GRW.skillId + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
  } else if (GRW.tab === 'classes') {
    grwSetHash({ tab: 'classes', classKey: GRW.classKey });
  } else if (GRW.tab === 'upgrades') {
    grwSetHash({ tab: 'upgrades', upgradeLevel: GRW.upgradeLevel });
  } else if (GRW.tab === 'pets') {
    grwSetHash({ tab: 'pets', petKey: GRW.petKey });
  } else {
    grwSetHash({ tab: 'health' });
  }
}

window.openGrowthView = openGrowthView;
window.hideGrowthView = () => {
  const view = grwEl('growthView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && grwHashState() != null) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
    }
  }
};
window.refreshGrowthState = (st) => {
  const info = st && st.configs ? st.configs.growth : null;
  if (info && info.skills != null) grwText('grwCount', String(info.skills));
  GRW.stale = true;
  if (S.mode === 'growth') grwRenderMeta();
};
window.updateGrowthMeta = grwRenderMeta;

function grwBindEvents() {
  const filter = grwEl('grwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(GRW.searchTimer);
      GRW.searchTimer = setTimeout(() => {
        GRW.filter = filter.value;
        grwRenderList();
      }, 150);
    });
  }
  const job = grwEl('grwJob');
  if (job) {
    job.addEventListener('change', () => {
      GRW.job = job.value;
      grwRenderList();
    });
  }
  document.querySelectorAll('#grwFlagFilter [data-grw-flag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      GRW.flag = btn.dataset.grwFlag;
      document.querySelectorAll('#grwFlagFilter [data-grw-flag]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      grwRenderList();
    });
  });
  const list = grwEl('grwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-grw-skill]');
      if (!li) return;
      grwSelectSkill(Number(li.dataset.grwSkill));
    });
  }
  const tabs = grwEl('grwTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-grw-tab]');
      if (!btn) return;
      grwSelectTab(btn.dataset.grwTab);
    });
  }
  const main = grwEl('growthView');
  if (main) {
    main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-grw-class],[data-grw-metric],[data-grw-upgrade],[data-grw-pet],[data-grw-act]');
      if (!btn) return;
      if (btn.dataset.grwClass) {
        GRW.classKey = btn.dataset.grwClass;
        grwRenderClass();
        grwSetHash({ tab: 'classes', classKey: GRW.classKey });
      } else if (btn.dataset.grwMetric) {
        GRW.classMetric = btn.dataset.grwMetric;
        grwRenderClass();
      } else if (btn.dataset.grwUpgrade) {
        GRW.upgradeLevel = Number(btn.dataset.grwUpgrade);
        grwRenderUpgrade();
        grwSetHash({ tab: 'upgrades', upgradeLevel: GRW.upgradeLevel });
      } else if (btn.dataset.grwPet) {
        GRW.petKey = btn.dataset.grwPet;
        grwRenderPet();
        grwSetHash({ tab: 'pets', petKey: GRW.petKey });
      } else if (btn.dataset.grwAct === 'db') {
        grwGotoDb(btn.dataset.name, btn.dataset.search || '');
      } else if (btn.dataset.grwAct === 'jump') {
        const idx = Number(btn.dataset.grwIssue);
        if (GRW.data && GRW.data.issues[idx]) grwJumpIssue(GRW.data.issues[idx]);
      }
    });
  }
  const reload = grwEl('btnGrwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      reload.disabled = true;
      try {
        GRW.stale = true;
        await grwLoad();
        grwRenderAll();
        toast('成长数据已重新检查', 'ok');
      } catch (e) {
        grwRenderAll();
        toast('检查失败：' + e.message, 'err');
      } finally {
        reload.disabled = false;
      }
    });
  }
  window.addEventListener('hashchange', () => {
    const state = grwHashState();
    if (state) openGrowthView(state);
  });
}

grwBindEvents();

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(() => {
    const state = grwHashState();
    if (state) openGrowthView(state);
  });
} else {
  window.addEventListener('app-ready', () => {
    const state = grwHashState();
    if (state) openGrowthView(state);
  });
}

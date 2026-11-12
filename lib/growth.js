'use strict';

const fs = require('fs');
const path = require('path');
const dbe = require('./dbe');

const CLASS_DEFS = [
  { key: 'warrior', job: 0, name: '战士', file: 'zhanshi.db' },
  { key: 'mage', job: 1, name: '法师', file: 'fashi.db' },
  { key: 'taoist', job: 2, name: '道士', file: 'daoshi.db' }
];

const JOB_LABELS = { 0: '战士', 1: '法师', 2: '道士' };

const PET_LABELS = {
  0: '骷髅', 1: '神兽（伏下）', 2: '神兽（站立）', 3: '尸灵 1',
  4: '尸灵 2', 5: '尸灵 3', 6: '尸灵 4', 7: '强化骷髅',
  8: '丛林豹', 9: '踏云豹'
};

const CLASS_STAT_FIELDS = [
  ['hp', 'HP'], ['mp', 'MP'], ['dcMin', '攻击下限'], ['dcMax', '攻击上限'],
  ['mcMin', '魔法下限'], ['mcMax', '魔法上限'], ['scMin', '道术下限'], ['scMax', '道术上限'],
  ['acMin', '防御下限'], ['acMax', '防御上限'], ['macMin', '魔防下限'], ['macMax', '魔防上限'],
  ['weight', '负重'], ['equipWeight', '装备负重'], ['wristWeight', '腕力'],
  ['precision', '准确'], ['celerity', '敏捷'], ['magicAvoid', '魔法躲避'],
  ['hpRenew', 'HP 恢复'], ['mpRenew', 'MP 恢复'], ['vigor', '体力']
];

function jobLabel(job) {
  return JOB_LABELS[job] || ('特殊（Job ' + job + '）');
}

function jobGroup(job) {
  return job === 0 || job === 1 || job === 2 ? String(job) : 'special';
}

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function create(options) {
  const dbDir = path.resolve(options.dbDir);
  const files = {
    magic: path.join(dbDir, 'magic.db'),
    upgrade: path.join(dbDir, 'Upgrade.DB'),
    specialPet: path.join(dbDir, 'SpecialPet.db'),
    taoistPet: path.join(dbDir, 'TaoistPet.db')
  };
  for (const def of CLASS_DEFS) files[def.key] = path.join(dbDir, def.file);
  let cache = null;

  function signature() {
    return Object.keys(files).sort().map((k) => k + '|' + statSig(files[k])).join(';');
  }

  function build() {
    const issues = [];
    const counts = { error: 0, warn: 0, info: 0 };
    const skillIssueCounts = new Map();
    const classIssueCounts = new Map();
    const petIssueCounts = new Map();
    const upgradeIssueCounts = new Map();

    function addIssue(code, severity, message, extra) {
      const e = extra || {};
      issues.push({
        code,
        severity,
        message,
        scope: e.scope || '',
        file: e.file || '',
        line: e.line == null ? null : e.line,
        action: e.action || null
      });
      counts[severity]++;
      if (e.skillId != null) {
        const c = skillIssueCounts.get(e.skillId) || { error: 0, warn: 0, info: 0 };
        c[severity]++;
        skillIssueCounts.set(e.skillId, c);
      }
      if (e.classKey) {
        const c = classIssueCounts.get(e.classKey) || { error: 0, warn: 0, info: 0 };
        c[severity]++;
        classIssueCounts.set(e.classKey, c);
      }
      if (e.petKey) {
        const c = petIssueCounts.get(e.petKey) || { error: 0, warn: 0, info: 0 };
        c[severity]++;
        petIssueCounts.set(e.petKey, c);
      }
      if (e.upgradeLevel != null) {
        const c = upgradeIssueCounts.get(e.upgradeLevel) || { error: 0, warn: 0, info: 0 };
        c[severity]++;
        upgradeIssueCounts.set(e.upgradeLevel, c);
      }
    }

    function load(file, label) {
      try {
        return dbe.loadDb(file);
      } catch (e) {
        addIssue('growth_file_unreadable', 'error', `${label} 读取失败：${e.message}`, {
          file: path.basename(file),
          action: null
        });
        return null;
      }
    }

    // 技能
    const magicDb = load(files.magic, 'magic.db');
    const skills = [];
    const seenIds = new Map();
    const seenNames = new Map();
    if (magicDb) {
      for (let i = 0; i < magicDb.rows.length; i++) {
        const r = magicDb.rows[i];
        const id = num(r.MagID);
        const name = String(r.MagName == null ? '' : r.MagName).trim();
        if (!seenIds.has(id)) seenIds.set(id, []);
        seenIds.get(id).push(i);
        if (name) {
          if (!seenNames.has(name)) seenNames.set(name, []);
          seenNames.get(name).push(i);
        }
        const need = [num(r.NeedL1), num(r.NeedL2), num(r.NeedL3)];
        const train = [num(r.L1Train), num(r.L2Train), num(r.L3Train)];
        skills.push({
          id,
          row: i,
          name,
          job: num(r.Job),
          jobLabel: jobLabel(num(r.Job)),
          jobGroup: jobGroup(num(r.Job)),
          effectType: num(r.EffectType),
          effect: num(r.Effect),
          spell: num(r.Spell),
          power: num(r.Power),
          maxPower: num(r.MaxPower),
          defSpell: num(r.DefSpell),
          defPower: num(r.DefPower),
          defMaxPower: num(r.DefMaxPower),
          need,
          train,
          delay: num(r.Delay),
          descr: String(r.Descr == null ? '' : r.Descr),
          equal: String(r.Equal == null ? '' : r.Equal),
          file: 'magic.db'
        });
      }
      for (const [id, indexes] of seenIds) {
        if (indexes.length < 2) continue;
        addIssue('growth_magic_duplicate_id', 'warn',
          `技能 MagID ${id} 重复 ${indexes.length} 次（第 ${indexes.map((i) => i + 1).join(' / ')} 条）`,
          { file: 'magic.db', line: indexes[0] + 1, skillId: id, action: { view: 'magic', id } });
      }
      for (const [name, indexes] of seenNames) {
        if (indexes.length < 2) continue;
        const id = num(magicDb.rows[indexes[0]].MagID);
        addIssue('growth_magic_duplicate_name', 'warn',
          `技能名称「${name}」出现 ${indexes.length} 次（MagID ${indexes.map((i) => magicDb.rows[i].MagID).join(' / ')}）`,
          { file: 'magic.db', line: indexes[0] + 1, skillId: id, action: { view: 'magic', id } });
      }
      const missingIds = [];
      const ids = [...seenIds.keys()].sort((a, b) => a - b);
      for (let i = 1; i < ids.length; i++) {
        for (let id = ids[i - 1] + 1; id < ids[i]; id++) missingIds.push(id);
      }
      if (missingIds.length) {
        addIssue('growth_magic_id_gap', 'info',
          `magic.db 中 MagID 不连续，缺少 ${missingIds.join('、')}（可能是已删除技能）`,
          { file: 'magic.db', action: { view: 'tab', tab: 'skills' } });
      }
      for (const s of skills) {
        if (!s.name) {
          addIssue('growth_magic_name_empty', 'warn', `第 ${s.row + 1} 条技能没有名称（MagID ${s.id}）`,
            { file: 'magic.db', line: s.row + 1, skillId: s.id, action: { view: 'magic', id: s.id } });
        }
        if (s.maxPower < s.power) {
          addIssue('growth_magic_power', 'warn',
            `技能「${s.name}」威力上限 ${s.maxPower} 小于威力下限 ${s.power}`,
            { file: 'magic.db', line: s.row + 1, skillId: s.id, action: { view: 'magic', id: s.id } });
        }
        if (s.need[0] > s.need[1] || s.need[1] > s.need[2]) {
          addIssue('growth_magic_need_order', 'warn',
            `技能「${s.name}」的需求等级不是逐级递增（${s.need.join(' / ')}）`,
            { file: 'magic.db', line: s.row + 1, skillId: s.id, action: { view: 'magic', id: s.id } });
        }
        if (s.need.some((v) => v < 0) || s.train.some((v) => v < 0) ||
            [s.power, s.maxPower, s.spell, s.delay].some((v) => v < 0)) {
          addIssue('growth_magic_negative', 'warn', `技能「${s.name}」存在负数或异常数值`,
            { file: 'magic.db', line: s.row + 1, skillId: s.id, action: { view: 'magic', id: s.id } });
        }
        if (s.job === 0 || s.job === 1 || s.job === 2) {
          const maxLevel = s.job === 0 ? 100 : 90;
          if (s.need[2] > maxLevel) {
            addIssue('growth_magic_level_over', 'warn',
              `技能「${s.name}」三级需求等级 ${s.need[2]} 超过 ${s.jobLabel} 等级上限 ${maxLevel}`,
              { file: 'magic.db', line: s.row + 1, skillId: s.id, action: { view: 'magic', id: s.id } });
          }
        }
      }
    }

    // 三职业成长
    const classes = [];
    for (const def of CLASS_DEFS) {
      const db = load(files[def.key], def.file);
      if (!db) continue;
      const rows = [];
      for (let i = 0; i < db.rows.length; i++) {
        const r = db.rows[i];
        rows.push({
          level: i + 1,
          exp: num(r.DwExp),
          hp: num(r.WHP),
          mp: num(r.WMP),
          dcMin: num(r.ByDC), dcMax: num(r.ByDC2),
          mcMin: num(r.ByMC), mcMax: num(r.ByMC2),
          scMin: num(r.BySC), scMax: num(r.BySC2),
          acMin: num(r.ByAC), acMax: num(r.ByAC2),
          macMin: num(r.ByMac), macMax: num(r.ByMac2),
          weight: num(r.WPkgWeight), equipWeight: num(r.ByEquipWeight), wristWeight: num(r.ByWristWeight),
          precision: num(r.ByPrecision), celerity: num(r.ByCelerity), magicAvoid: num(r.ByMagicAvoid),
          hpRenew: num(r.HPRenew), mpRenew: num(r.MPRenew), zazenExp: num(r.Zazen2ExpRate),
          vigor: num(r.ByVigor)
        });
      }
      const last = rows[rows.length - 1] || {};
      const first = rows[0] || {};
      const cls = {
        key: def.key,
        name: def.name,
        job: def.job,
        file: def.file,
        row: 0,
        rows,
        stats: {
          levels: rows.length,
          hpStart: first.hp || 0,
          hpEnd: last.hp || 0,
          mpStart: first.mp || 0,
          mpEnd: last.mp || 0,
          expStart: first.exp || 0,
          expEnd: last.exp || 0
        }
      };
      const issueBase = { file: def.file, classKey: def.key, action: { view: 'class', key: def.key } };
      const plateauStart = [];
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].exp < rows[i - 1].exp) {
          addIssue('growth_class_exp_decrease', 'warn',
            `${def.name} ${rows[i].level} 级经验 ${rows[i].exp} 小于 ${rows[i - 1].level} 级经验 ${rows[i - 1].exp}`,
            Object.assign({}, issueBase, { line: rows[i].level }));
          plateauStart.length = 0;
        } else if (rows[i].exp === rows[i - 1].exp) {
          if (!plateauStart.length) plateauStart.push(rows[i - 1].level);
          plateauStart.push(rows[i].level);
        } else {
          if (plateauStart.length >= 3) {
            addIssue('growth_class_exp_plateau', 'info',
              `${def.name} ${plateauStart[0]}–${plateauStart[plateauStart.length - 1]} 级经验固定为 ${rows[plateauStart[0] - 1].exp}`,
              Object.assign({}, issueBase, { line: plateauStart[0] }));
          }
          plateauStart.length = 0;
        }
        for (const [field, label] of CLASS_STAT_FIELDS) {
          if (rows[i][field] < rows[i - 1][field]) {
            addIssue('growth_class_stat_decrease', 'warn',
              `${def.name} ${rows[i].level} 级${label} ${rows[i][field]} 小于 ${rows[i - 1].level} 级 ${rows[i - 1][field]}`,
              Object.assign({}, issueBase, { line: rows[i].level }));
          }
        }
        for (const [field, label] of CLASS_STAT_FIELDS.concat([['exp', '经验']])) {
          if (rows[i][field] < 0) {
            addIssue('growth_class_negative', 'warn',
              `${def.name} ${rows[i].level} 级${label}为负数（${rows[i][field]}）`,
              Object.assign({}, issueBase, { line: rows[i].level }));
          }
        }
      }
      if (plateauStart.length >= 3) {
        addIssue('growth_class_exp_plateau', 'info',
          `${def.name} ${plateauStart[0]}–${plateauStart[plateauStart.length - 1]} 级经验固定为 ${rows[plateauStart[0] - 1].exp}`,
          Object.assign({}, issueBase, { line: plateauStart[0] }));
      }
      cls.issues = classIssueCounts.get(def.key) || { error: 0, warn: 0, info: 0 };
      classes.push(cls);
    }
    const levelCounts = classes.map((c) => c.rows.length);
    if (new Set(levelCounts).size > 1) {
      addIssue('growth_class_length', 'info',
        `三职业等级表长度不一致：${classes.map((c) => c.name + ' ' + c.rows.length + ' 级').join('，')}`,
        { action: { view: 'tab', tab: 'classes' } });
    }

    // 升级经验
    const upgradeDb = load(files.upgrade, 'Upgrade.DB');
    const upgrades = [];
    if (upgradeDb) {
      const byMonster = new Map();
      const combos = new Map();
      for (let i = 0; i < upgradeDb.rows.length; i++) {
        const r = upgradeDb.rows[i];
        const ml = num(r.MonsterLevel);
        const ul = num(r.UpgradeLevel);
        if (!byMonster.has(ml)) byMonster.set(ml, []);
        byMonster.get(ml).push({ level: ul, exp: num(r.EXP), describe: String(r.Describe == null ? '' : r.Describe), row: i });
        const key = ml + ':' + ul;
        if (!combos.has(key)) combos.set(key, []);
        combos.get(key).push(i);
        if (num(r.EXP) < 0) {
          addIssue('growth_upgrade_negative', 'warn',
            `怪物等级 ${ml} / 升级 ${ul} 的经验为负数（${r.EXP}）`,
            { file: 'Upgrade.DB', line: i + 1, upgradeLevel: ml, action: { view: 'upgrade', level: ml } });
        }
      }
      for (const [key, indexes] of combos) {
        if (indexes.length < 2) continue;
        const [ml, ul] = key.split(':');
        addIssue('growth_upgrade_duplicate', 'warn',
          `怪物等级 ${ml} / 升级 ${ul} 重复 ${indexes.length} 次`,
          { file: 'Upgrade.DB', line: indexes[0] + 1, upgradeLevel: Number(ml), action: { view: 'upgrade', level: Number(ml) } });
      }
      const monsterLevels = [...byMonster.keys()].sort((a, b) => a - b);
      const maxUpgrade = 9;
      const missingSummary = [];
      for (const ml of monsterLevels) {
        const rows = byMonster.get(ml).slice().sort((a, b) => a.level - b.level);
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].exp < rows[i - 1].exp) {
            addIssue('growth_upgrade_exp_decrease', 'warn',
              `怪物等级 ${ml} 升级 ${rows[i].level} 的经验 ${rows[i].exp} 小于升级 ${rows[i - 1].level} 的 ${rows[i - 1].exp}`,
              { file: 'Upgrade.DB', line: rows[i].row + 1, upgradeLevel: ml, action: { view: 'upgrade', level: ml } });
          }
        }
        const present = new Set(rows.map((r) => r.level));
        const missing = [];
        for (let lv = 1; lv <= maxUpgrade; lv++) if (!present.has(lv)) missing.push(lv);
        if (missing.length) missingSummary.push(`${ml}（缺 ${missing.join('、')}）`);
        const item = {
          level: ml,
          rows,
          missing,
          stats: {
            minUpgrade: rows.length ? rows[0].level : null,
            maxUpgrade: rows.length ? rows[rows.length - 1].level : null,
            expMin: rows.length ? Math.min(...rows.map((r) => r.exp)) : 0,
            expMax: rows.length ? Math.max(...rows.map((r) => r.exp)) : 0
          }
        };
        item.issues = upgradeIssueCounts.get(ml) || { error: 0, warn: 0, info: 0 };
        upgrades.push(item);
      }
      upgrades.sort((a, b) => a.level - b.level);
      if (missingSummary.length) {
        addIssue('growth_upgrade_level_gap', 'info',
          `部分怪物等级缺少较高升级档位：${missingSummary.join('；')}`,
          { file: 'Upgrade.DB', action: { view: 'upgrade', level: Number(missingSummary[0].split('（')[0]) } });
      }
    }

    // 宠物成长
    const pets = [];
    const specialDb = load(files.specialPet, 'SpecialPet.db');
    if (specialDb) {
      const rows = specialDb.rows.map((r, i) => ({
        level: num(r.PetLevel),
        exp: num(r.PetExp),
        hp: num(r.HP),
        dc: num(r.DC), dcMax: num(r.MaxDC),
        ac: num(r.AC), acMax: num(r.MaxAC),
        mac: null,
        describe: '',
        row: i
      })).sort((a, b) => a.level - b.level);
      const pet = {
        key: 'special',
        kind: 'special',
        name: '特殊宠物',
        type: null,
        file: 'SpecialPet.db',
        rows,
        stats: {
          levels: rows.length,
          levelMin: rows.length ? rows[0].level : null,
          levelMax: rows.length ? rows[rows.length - 1].level : null,
          hpStart: rows.length ? rows[0].hp : 0,
          hpEnd: rows.length ? rows[rows.length - 1].hp : 0,
          expStart: rows.length ? rows[0].exp : 0,
          expEnd: rows.length ? rows[rows.length - 1].exp : 0
        }
      };
      checkPet(pet, { exp: true, mac: false });
      pet.issues = petIssueCounts.get('special') || { error: 0, warn: 0, info: 0 };
      pets.push(pet);
    }
    const taoistDb = load(files.taoistPet, 'TaoistPet.db');
    if (taoistDb) {
      const byType = new Map();
      for (let i = 0; i < taoistDb.rows.length; i++) {
        const r = taoistDb.rows[i];
        const type = num(r.PetType);
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type).push({
          level: num(r.Level),
          exp: null,
          hp: num(r.HP),
          dc: num(r.DC), dcMax: num(r.MaxDC),
          ac: num(r.AC), acMax: num(r.Mac),
          mac: num(r.Mac),
          describe: String(r.Describe == null ? '' : r.Describe),
          row: i
        });
      }
      const types = [...byType.keys()].sort((a, b) => a - b);
      for (const type of types) {
        const rows = byType.get(type).slice().sort((a, b) => a.level - b.level);
        const pet = {
          key: 'taoist-' + type,
          kind: 'taoist',
          name: PET_LABELS[type] || ('宠物类型 ' + type),
          type,
          file: 'TaoistPet.db',
          rows,
          stats: {
            levels: rows.length,
            levelMin: rows.length ? rows[0].level : null,
            levelMax: rows.length ? rows[rows.length - 1].level : null,
            hpStart: rows.length ? rows[0].hp : 0,
            hpEnd: rows.length ? rows[rows.length - 1].hp : 0,
            expStart: null,
            expEnd: null
          }
        };
        checkPet(pet, { exp: false, mac: true });
        pet.issues = petIssueCounts.get(pet.key) || { error: 0, warn: 0, info: 0 };
        pets.push(pet);
      }
    }

    function checkPet(pet, opts) {
      const issueBase = { file: pet.file, petKey: pet.key, action: { view: 'pet', key: pet.key } };
      let plateau = [];
      for (let i = 0; i < pet.rows.length; i++) {
        const row = pet.rows[i];
        if (i > 0) {
          const prev = pet.rows[i - 1];
          if (row.level !== prev.level + 1) {
            addIssue('growth_pet_level_gap', 'warn',
              `${pet.name} 等级不连续：${prev.level} 之后是 ${row.level}`,
              Object.assign({}, issueBase, { line: row.row + 1 }));
          }
          for (const [field, label] of [['hp', 'HP'], ['dc', '攻击下限'], ['dcMax', '攻击上限'], ['ac', '防御'], ['acMax', '防御上限'], ['mac', '魔防']]) {
            if (field === 'mac' && !opts.mac) continue;
            if (row[field] == null) continue;
            if (row[field] < prev[field]) {
              addIssue('growth_pet_stat_decrease', 'warn',
                `${pet.name} ${row.level} 级${label} ${row[field]} 小于 ${prev.level} 级 ${prev[field]}`,
                Object.assign({}, issueBase, { line: row.row + 1 }));
            }
          }
          if (opts.exp && row.exp != null && prev.exp != null) {
            if (row.exp < prev.exp) {
              addIssue('growth_pet_exp_decrease', 'warn',
                `${pet.name} ${row.level} 级经验 ${row.exp} 小于 ${prev.level} 级 ${prev.exp}`,
                Object.assign({}, issueBase, { line: row.row + 1 }));
              plateau = [];
            } else if (row.exp === prev.exp) {
              if (!plateau.length) plateau.push(prev.level);
              plateau.push(row.level);
            } else if (plateau.length) {
              if (plateau.length >= 3) {
                addIssue('growth_pet_exp_plateau', 'info',
                  `${pet.name} ${plateau[0]}–${plateau[plateau.length - 1]} 级经验固定为 ${prev.exp}`,
                  Object.assign({}, issueBase, { line: pet.rows[plateau[0]].row + 1 }));
              }
              plateau = [];
            }
          }
        }
        for (const [field, label] of [['hp', 'HP'], ['dc', '攻击下限'], ['dcMax', '攻击上限'], ['ac', '防御'], ['mac', '魔防'], ['exp', '经验']]) {
          if (field === 'mac' && !opts.mac) continue;
          if (row[field] == null) continue;
          if (row[field] < 0) {
            addIssue('growth_pet_negative', 'warn',
              `${pet.name} ${row.level} 级${label}为负数（${row[field]}）`,
              Object.assign({}, issueBase, { line: row.row + 1 }));
          }
        }
      }
      if (opts.exp && plateau.length >= 3) {
        addIssue('growth_pet_exp_plateau', 'info',
          `${pet.name} ${plateau[0]}–${plateau[plateau.length - 1]} 级经验固定为 ${pet.rows[plateau[0]].exp}`,
          Object.assign({}, issueBase, { line: pet.rows[plateau[0]].row + 1 }));
      }
    }

    const order = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) =>
      (order[a.severity] - order[b.severity]) ||
      String(a.code).localeCompare(String(b.code)) ||
      String(a.scope).localeCompare(String(b.scope), 'zh-CN'));

    const jobs = { warrior: 0, mage: 0, taoist: 0, special: 0 };
    for (const s of skills) {
      if (s.jobGroup === 'special') jobs.special++;
      else jobs[s.jobGroup === '0' ? 'warrior' : s.jobGroup === '1' ? 'mage' : 'taoist']++;
    }
    const issuesBySkill = new Map();
    for (const s of skills) issuesBySkill.set(s.id, skillIssueCounts.get(s.id) || { error: 0, warn: 0, info: 0 });

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        skills: skills.length,
        jobs,
        classes: classes.length,
        classLevels: levelCounts.reduce((a, b) => a + b, 0),
        upgrades: upgrades.length,
        pets: pets.length,
        petLevels: pets.reduce((a, p) => a + p.rows.length, 0),
        issues: counts
      },
      skills: skills.map((s) => Object.assign({}, s, { issues: issuesBySkill.get(s.id) })),
      classes,
      upgrades,
      pets,
      issues
    };
  }

  function ensure() {
    const sig = signature();
    if (cache && cache.sig === sig) return cache.data;
    const data = build();
    cache = { sig, data };
    return data;
  }

  return {
    list() {
      return ensure();
    },
    summary() {
      try {
        const d = ensure();
        return { skills: d.stats.skills, classes: d.stats.classes, issues: d.stats.issues };
      } catch (e) {
        return { error: e.message };
      }
    },
    health() {
      try {
        const raw = ensure();
        const d = raw && raw.data ? raw.data : raw;
        return { generatedAt: d.generatedAt, issues: d.issues || [] };
      } catch (e) {
        return { generatedAt: null, issues: [], error: e.message };
      }
    },
    invalidate() {
      cache = null;
    }
  };
}

module.exports = { create };

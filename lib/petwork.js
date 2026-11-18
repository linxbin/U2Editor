'use strict';

/* 灵兽与骑乘工作台：只读汇总灵兽成长、转生材料、骑乘与马牌配置 */

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const configs = require('./configs');
const npcData = require('./npc');
const dbe = require('./dbe');

const FAMILIES = [
  {
    key: 'leopard',
    name: '豹系',
    stone: '豹魔石',
    stages: ['丛林豹', '踏云豹', '迅天雷豹']
  },
  {
    key: 'lion',
    name: '狮系',
    stone: '狮魔石',
    stages: ['天狮兽', '震天狮', '战天狂狮']
  },
  {
    key: 'qilin',
    name: '麒麟系',
    stone: '麒麟石',
    stages: ['麒麟兽', '圣麒麟', '玄天麒麟']
  }
];

const MATERIAL_DEFS = [
  { name: '豹魔石', kind: '灵兽石', note: '豹系一转、二转与复活' },
  { name: '狮魔石', kind: '灵兽石', note: '狮系一转、二转与复活' },
  { name: '麒麟石', kind: '灵兽石', note: '麒麟系一转、二转与复活' },
  { name: '豹神水', kind: '转生材料', note: '脚本实际检查的一转/复活材料' },
  { name: '兽神水', kind: '转生材料', note: '脚本文案提到的二转材料' },
  { name: '灵兽铠', kind: '转生材料', note: '脚本文案提到的一转铠甲' },
  { name: '踏云玄铠', kind: '转生材料', note: 'QueXss 一转实际检查的铠甲' },
  { name: '豹粮', kind: '灵兽补给', note: '灵兽喂养' },
  { name: '兽粮', kind: '灵兽补给', note: '灵兽喂养' },
  { name: '灵兽神丹', kind: '灵兽补给', note: '灵兽成长道具' },
  { name: '灵兽项圈', kind: '灵兽补给', note: '灵兽道具' },
  { name: '御兽天袍', kind: '骑乘装备', note: '骑乘坐骑所需装备' },
  { name: '御兽天衣', kind: '骑乘装备', note: '骑乘坐骑所需装备' }
];

const MOUNT_ITEM_NAMES = ['马鞭', '骑兵竞技入场牌'];
const PET_HINT_RE = /灵兽|豹|狮|麒麟|骑兵|骑马|马鞭|马牌|兽神水|豹神水|踏云玄铠|灵兽铠|upgradeSpecialPet|relivePet|getPetsNumExpertHorse|giveHorseTicket/i;
const CALL_RE = /(checkPlayerItems|checkTemporaryItems|takeItemFromPlayer|popItemBag|giveItemToPlayerAndSetItemCavalryProperty|giveItemToPlayer|upgradeSpecialPet|relivePet)\s*\(\s*player\s*,\s*'([^']+)'/g;
const API_RE = /\b(upgradeSpecialPet|relivePet|getPetsNumExpertHorse|giveHorseTicket)\b/;
const FUNC_RE = /^\s*def\s+([A-Za-z_]\w*)/;
const GAMESERVER_KEY_RE = /horse|pet|mount|cavalry|stall|ride/i;
const SEV_ORDER = { error: 0, warn: 1, info: 2 };

function fileSig(file) {
  try {
    const st = fs.statSync(file);
    return st.size + ':' + st.mtimeMs;
  } catch (e) {
    return 'missing';
  }
}

function dirSig(dir, re) {
  try {
    return fs.readdirSync(dir)
      .filter((n) => re.test(n))
      .sort()
      .map((n) => n + ':' + fileSig(path.join(dir, n)))
      .join('|');
  } catch (e) {
    return 'missing';
  }
}

function baseName(name) {
  return String(name || '').replace(/\.pyc?$/i, '');
}

function create(options) {
  const envirDir = options.envirDir;
  const npcFile = options.npcFile;
  const scriptDir = options.scriptDir;
  const gameServerIni = options.gameServerIni;
  const monsterFile = options.monsterFile;
  const itemWorkbench = options.itemWorkbench;
  const growthWorkbench = options.growthWorkbench;
  const mapInfoFile = path.join(envirDir, 'MapInfo');

  let cache = null;

  function signature() {
    return [
      fileSig(gameServerIni),
      fileSig(npcFile),
      fileSig(monsterFile),
      fileSig(mapInfoFile),
      fileSig(path.join(envirDir, 'DB', 'stditems.db')),
      fileSig(path.join(envirDir, 'DB', 'SpecialPet.db')),
      fileSig(path.join(envirDir, 'DB', 'TaoistPet.db')),
      dirSig(scriptDir, /\.(py|pyc)$/i)
    ].join('#');
  }

  function readServerInfo() {
    try {
      const { lines } = configs.readFileLines(gameServerIni);
      let name = '';
      let index = '';
      for (const line of lines) {
        const m = /^\s*(ServerName|ServerIndex|ServerID|ServerPort)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) continue;
        if (m[1] === 'ServerName') name = m[2];
        else if (m[1] === 'ServerIndex') index = m[2];
      }
      return { name, index, file: path.basename(gameServerIni) };
    } catch (e) {
      return { name: '', index: '', file: path.basename(gameServerIni), error: e.message };
    }
  }

  function readParams() {
    try {
      const { lines } = configs.readFileLines(gameServerIni);
      const rows = [];
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
        const m = /^\s*([^=;]+?)\s*=\s*(.*?)\s*$/.exec(raw);
        if (!m) continue;
        if (!GAMESERVER_KEY_RE.test(m[1])) continue;
        rows.push({ key: m[1], value: m[2], line: i + 1 });
      }
      return { rows, file: path.basename(gameServerIni) };
    } catch (e) {
      return { rows: [], file: path.basename(gameServerIni), error: e.message };
    }
  }

  function scanScripts() {
    const scripts = [];
    const uses = new Map();
    const mentions = new Map();
    const files = [];
    const scriptFiles = new Set();
    try {
      for (const name of fs.readdirSync(scriptDir)) {
        if (!/\.(py|pyc)$/i.test(name)) continue;
        scriptFiles.add(name.toLowerCase());
        if (/\.py$/i.test(name)) files.push(name);
      }
    } catch (e) {
      return { scripts, uses, mentions, files: scriptFiles, error: e.message };
    }
    for (const file of files) {
      let text = '';
      try {
        text = gbk.decodeText(fs.readFileSync(path.join(scriptDir, file)));
      } catch (e) {
        continue;
      }
      if (!PET_HINT_RE.test(text)) continue;
      const lines = text.split(/\r?\n/);
      const items = new Set();
      const apiSet = new Set();
      const funcs = new Set();
      let refs = 0;
      let firstLine = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const def = FUNC_RE.exec(line);
        if (def) funcs.add(def[1]);
        let hit = false;
        CALL_RE.lastIndex = 0;
        let call;
        while ((call = CALL_RE.exec(line))) {
          hit = true;
          const fn = call[1];
          const item = call[2].trim();
          if (!item || item.startsWith('请')) continue;
          items.add(item);
          const kind = /^check/.test(fn) ? 'require' :
            /^give/.test(fn) ? 'give' : 'consume';
          if (kind !== 'give') {
            if (!uses.has(item)) uses.set(item, []);
            uses.get(item).push({ script: file, line: i + 1, kind });
          }
        }
        const api = API_RE.exec(line);
        if (api) {
          hit = true;
          apiSet.add(api[1]);
        }
        for (const def of MATERIAL_DEFS) {
          if (!line.includes(def.name)) continue;
          hit = true;
          if (!mentions.has(def.name)) mentions.set(def.name, []);
          mentions.get(def.name).push({ script: file, line: i + 1 });
        }
        if (!hit) continue;
        refs++;
        if (!firstLine) firstLine = i + 1;
      }
      if (!refs) continue;
      const base = baseName(file).toLowerCase();
      if (!apiSet.size && !/^(aaa|animal|quexss|merlotte|merstabl|quejacka|spemaper1_0)/i.test(base)) continue;
      scripts.push({
        name: file,
        refs,
        firstLine,
        items: [...items].sort((a, b) => a.localeCompare(b, 'zh-CN')),
        apis: [...apiSet].sort(),
        funcs: [...funcs]
      });
    }
    scripts.sort((a, b) => b.refs - a.refs || a.name.localeCompare(b.name, 'zh-CN'));
    return { scripts, uses, mentions, files: scriptFiles };
  }

  function readItems() {
    let list = [];
    try {
      list = itemWorkbench.list().items || [];
    } catch (e) {
      return { items: [], byName: new Map(), details: new Map(), error: e.message };
    }
    const byName = new Map();
    for (const it of list) {
      const name = String(it.name == null ? '' : it.name).trim();
      if (name && !byName.has(name)) byName.set(name, it);
    }
    const details = new Map();
    const indices = new Set();
    for (const def of MATERIAL_DEFS) {
      const it = byName.get(def.name);
      if (it) indices.add(it.index);
    }
    for (const it of list) {
      if (it.stdmode === 33 || it.stdmode === 32) indices.add(it.index);
      if (MOUNT_ITEM_NAMES.includes(String(it.name == null ? '' : it.name))) indices.add(it.index);
    }
    if (indices.size) {
      try {
        const rows = itemWorkbench.details([...indices]);
        let i = 0;
        for (const index of indices) {
          details.set(index, rows[i++] || null);
        }
      } catch (e) {
      }
    }
    return { items: list, byName, details };
  }

  function sourceInfo(it, detail) {
    const drops = (detail && detail.drops) || [];
    const shops = (detail && detail.shops) || [];
    const tasks = (detail && detail.tasks) || [];
    const recipes = ((detail && detail.recipesUse) || []).length +
      ((detail && detail.recipesMake) || []).length;
    const goods = (detail && detail.goods) || [];
    const mall = (detail && detail.mall) || [];
    const total = drops.length + shops.length + tasks.length + recipes + goods.length + mall.length;
    const samples = [];
    if (drops.length) {
      const names = drops.slice(0, 3).map((d) => d.monster).filter(Boolean);
      samples.push('掉落 ' + drops.length + (names.length ? '（' + names.join('、') + '）' : ''));
    }
    if (shops.length) {
      const names = shops.slice(0, 3).map((s) => s.npc).filter(Boolean);
      samples.push('商店 ' + shops.length + (names.length ? '（' + names.join('、') + '）' : ''));
    }
    if (tasks.length) samples.push('任务 ' + tasks.length);
    if (recipes) samples.push('合成 ' + recipes);
    if (goods.length) samples.push('商城 ' + goods.length);
    if (mall.length) samples.push('元宝商城 ' + mall.length);
    return {
      total,
      drops: drops.length,
      shops: shops.length,
      tasks: tasks.length,
      recipes,
      goods: goods.length,
      mall: mall.length,
      samples
    };
  }

  function buildMaterials(items, scanned) {
    return MATERIAL_DEFS.map((def) => {
      const it = items.byName.get(def.name) || null;
      const detail = it ? items.details.get(it.index) : null;
      const sources = it ? sourceInfo(it, detail) : sourceInfo(null, null);
      const uses = scanned.uses.get(def.name) || [];
      const mentions = scanned.mentions.get(def.name) || [];
      return {
        name: def.name,
        kind: def.kind,
        note: def.note,
        item: it ? {
          index: it.index,
          idx: it.idx,
          stdmode: it.stdmode,
          needLevel: it.needLevel,
          price: it.price
        } : null,
        present: !!it,
        uses,
        mentions,
        required: uses.length > 0,
        sources
      };
    });
  }

  function buildSpecies(monsterNames) {
    const growthPets = growthPetsSafe();
    const byName = new Map(growthPets.map((p) => [p.name, p]));
    return FAMILIES.map((family) => {
      const stages = family.stages.map((name, i) => {
        const pet = byName.get(name) || null;
        return {
          tier: i,
          name,
          inMonster: monsterNames.has(name),
          growthKey: pet ? pet.key : null,
          growthLevels: pet ? pet.stats.levels : 0,
          growthMaxLevel: pet ? pet.stats.levelMax : null
        };
      });
      const missingStages = stages.filter((s) => !s.inMonster).map((s) => s.name);
      return {
        key: family.key,
        name: family.name,
        stone: family.stone,
        stages,
        missingStages
      };
    });
  }

  let growthCache = null;
  function growthPetsSafe() {
    if (growthCache) return growthCache;
    try {
      const data = growthWorkbench.list();
      growthCache = data.pets || [];
      return growthCache;
    } catch (e) {
      growthCache = [];
      return growthCache;
    }
  }

  function buildGrowth() {
    let data = null;
    let error = '';
    try {
      data = growthWorkbench.list();
    } catch (e) {
      error = e.message;
    }
    if (!data) return { special: null, taoist: [], otherTypes: 0, issues: [], error };
    const pets = data.pets || [];
    const specialPet = pets.find((p) => p.key === 'special') || null;
    const taoist = pets.filter((p) => p.kind === 'taoist' && (p.type === 8 || p.type === 9));
    const otherTypes = pets.filter((p) => p.kind === 'taoist' && p.type !== 8 && p.type !== 9).length;
    const petIssues = (data.issues || []).filter((i) => /^growth_pet_/.test(i.code));
    const pick = (p) => p ? {
      key: p.key,
      name: p.name,
      type: p.type,
      file: p.file,
      stats: p.stats,
      issues: p.issues,
      rows: p.rows
    } : null;
    return {
      special: pick(specialPet),
      taoist: taoist.map(pick),
      otherTypes,
      issues: petIssues.map((i) => ({
        code: i.code,
        severity: i.severity,
        message: i.message,
        file: i.file,
        line: i.line == null ? null : i.line,
        petKey: i.petKey || null
      })),
      error
    };
  }

  function buildMounts(items, monsterRows) {
    const monsterByName = new Map(monsterRows.map((r) => [String(r.Name == null ? '' : r.Name).trim(), r]));
    const cards = [];
    const extra = [];
    for (const it of items.items) {
      if (it.stdmode === 33 || it.stdmode === 32) cards.push(it);
    }
    for (const name of MOUNT_ITEM_NAMES) {
      const it = items.byName.get(name);
      if (it) extra.push(it);
    }
    const all = [...cards, ...extra];
    const seen = new Set();
    const rows = [];
    for (const it of all) {
      if (seen.has(it.index)) continue;
      seen.add(it.index);
      const detail = items.details.get(it.index);
      const sources = sourceInfo(it, detail);
      rows.push({
        index: it.index,
        idx: it.idx,
        name: it.name,
        stdmode: it.stdmode,
        needLevel: it.needLevel,
        price: it.price,
        sources
      });
    }
    rows.sort((a, b) =>
      (a.stdmode === 33 ? 0 : 1) - (b.stdmode === 33 ? 0 : 1) ||
      a.name.localeCompare(b.name, 'zh-CN'));
    const races = ['枣红马', '黄金宝马', '高头大马', '迎亲宝马', '丛林豹']
      .filter((name) => monsterByName.has(name))
      .map((name) => {
        const row = monsterByName.get(name);
        return {
          name,
          race: row.Race == null ? null : row.Race,
          appr: row.Appr == null ? null : row.Appr,
          hp: row.HP == null ? null : row.HP
        };
      });
    return { cards: rows.filter((r) => r.stdmode === 33 || r.stdmode === 32), items: rows, races };
  }

  function readNpcs() {
    const rebirth = [];
    const ride = [];
    let mapNames = new Map();
    try {
      const names = npcData.parseMapNames(mapInfoFile);
      mapNames = new Map(names.map((m) => [m.code, m.name]));
    } catch (e) {
    }
    const isRebirth = (base) => /^(aaa|animal|quexss)$/i.test(base);
    const isRide = (base) => /^(merlotte|merstabl|quejacka|spemaper)/i.test(base);
    try {
      const { rows } = npcData.parseNpc(npcFile);
      rows.forEach((row, index) => {
        const base = baseName(row.script);
        const kind = isRebirth(base) ? 'rebirth' : isRide(base) ? 'ride' : '';
        if (!kind) return;
        const entry = {
          index,
          id: row.id,
          name: row.name,
          script: row.script,
          base,
          map: row.map,
          mapName: mapNames.get(row.map) || '',
          x: row.x,
          y: row.y,
          line: row.line + 1,
          source: kind
        };
        if (kind === 'rebirth') rebirth.push(entry);
        else ride.push(entry);
      });
    } catch (e) {
    }
    return { rebirth, ride };
  }

  function build() {
    const server = readServerInfo();
    const params = readParams();
    const items = readItems();
    const scanned = scanScripts();
    let monsterRows = [];
    const monsterNames = new Set();
    try {
      const db = dbe.loadDb(monsterFile);
      monsterRows = db.rows;
      for (const row of db.rows) {
        const name = String(row.Name == null ? '' : row.Name).trim();
        if (name) monsterNames.add(name);
      }
    } catch (e) {
    }
    const materials = buildMaterials(items, scanned);
    const species = buildSpecies(monsterNames);
    const growth = buildGrowth();
    const mounts = buildMounts(items, monsterRows);
    const npcs = readNpcs();
    const issues = [];

    function addIssue(code, severity, message, extra) {
      issues.push(Object.assign({ code, severity, message }, extra || {}));
    }

    for (const fam of species) {
      if (!fam.missingStages.length) continue;
      addIssue('pet_stage_form_missing', 'info',
        `${fam.name}的「${fam.missingStages.join('、')}」未在 Monster.DB 登记；若由灵兽石驱动形态则属正常，请确认。`,
        { scope: fam.name, action: { section: 'growth', family: fam.key } });
    }

    for (const m of materials) {
      if (m.required && !m.present) {
        addIssue('pet_material_required_missing', 'error',
          `转生脚本会消耗「${m.name}」，但 stditems.db 中没有该物品。`,
          { scope: m.name, action: { section: 'rebirth' } });
      } else if (m.mentions.length && !m.present) {
        addIssue('pet_material_missing', 'warn',
          `脚本或文案提到「${m.name}」，但 stditems.db 中没有该物品。`,
          { scope: m.name, action: { section: 'rebirth' } });
      }
      if (m.required && m.present && !m.sources.total) {
        addIssue('pet_material_no_source', 'info',
          `「${m.name}」会被转生脚本消耗，但没有找到掉落、商店、任务或合成来源。`,
          { scope: m.name, action: m.item ? { view: 'item', index: m.item.index } : { section: 'rebirth' } });
      }
    }

    const upgradeScripts = scanned.scripts.filter((s) => s.apis.includes('upgradeSpecialPet'));
    const armorScripts = upgradeScripts.filter((s) => s.items.includes('踏云玄铠') || s.items.includes('灵兽铠'));
    if (upgradeScripts.length > 1 && armorScripts.length > 0 && armorScripts.length < upgradeScripts.length) {
      addIssue('pet_armor_rule_mismatch', 'warn',
        `一转脚本对铠甲的要求不一致：${armorScripts.map((s) => s.name).join('、')} 检查铠甲，其余脚本不检查。`,
        { scope: '一转铠甲', action: { section: 'rebirth' } });
    }
    const waterText = materials.find((m) => m.name === '兽神水');
    const waterCode = materials.find((m) => m.name === '豹神水');
    if (waterText && waterCode && waterText.mentions.length && waterCode.required) {
      addIssue('pet_water_name_mismatch', 'warn',
        '资料文案写的是「兽神水」，但转生脚本实际检查并消耗「豹神水」。',
        { scope: '转生材料', action: { section: 'rebirth' } });
    }
    const secondScripts = upgradeScripts.filter((s) => s.funcs.includes('upgradepet2') || s.funcs.includes('SpecialUpgrade2'));
    if (upgradeScripts.length > 1 && secondScripts.length > 0 && secondScripts.length < upgradeScripts.length) {
      addIssue('pet_rebirth_script_gap', 'info',
        `二转逻辑只出现在 ${secondScripts.map((s) => s.name).join('、')}，其余一转脚本没有二转入口。`,
        { scope: '二转脚本', action: { section: 'rebirth' } });
    }

    const pyBases = new Set();
    const pycBases = new Set();
    for (const name of scanned.files) {
      const base = name.replace(/\.(py|pyc)$/i, '').toLowerCase();
      if (/\.pyc$/i.test(name)) pycBases.add(base);
      else pyBases.add(base);
    }
    for (const base of pycBases) {
      if (!/^merstabl/.test(base) || pyBases.has(base)) continue;
      addIssue('pet_merstabl_source_missing', 'error',
        `NPC 脚本 ${base} 只有 .pyc，没有可编辑的 .py 源文件。`,
        { file: base + '.pyc', scope: 'MerStabl', action: { section: 'ride' } });
    }

    if (growth.issues.length) {
      addIssue('pet_growth_anomalies', 'info',
        `宠物成长曲线有 ${growth.issues.length} 条异常，详情见成长工作台的宠物页。`,
        { scope: '成长曲线', action: { view: 'growth', petKey: growth.issues[0].petKey || 'special' } });
    }

    const noSourceSupplies = materials.filter((m) =>
      m.present && !m.required && (m.kind === '灵兽补给' || m.kind === '骑乘装备') && !m.sources.total);
    if (noSourceSupplies.length) {
      addIssue('pet_supply_no_source', 'info',
        `这些灵兽/骑乘物品没有任何产出或购买来源：${noSourceSupplies.map((m) => m.name).join('、')}。`,
        { scope: '物品来源', action: { section: 'rebirth' } });
    }
    const noSourceMounts = mounts.items.filter((m) => !m.sources.total);
    if (noSourceMounts.length) {
      addIssue('pet_mount_no_source', 'info',
        `这些骑乘相关物品没有找到来源：${noSourceMounts.map((m) => m.name).join('、')}。`,
        { scope: '骑乘物品', action: { section: 'ride' } });
    }

    issues.sort((a, b) =>
      (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) ||
      String(a.code).localeCompare(String(b.code)) ||
      String(a.scope || '').localeCompare(String(b.scope || ''), 'zh-CN'));
    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) counts[issue.severity]++;
    const missingForms = species.reduce((n, fam) => n + fam.missingStages.length, 0);
    const missingMaterials = materials.filter((m) => !m.present).length;

    const notes = [
      { tag: '只读', text: '本工作台只汇总灵兽与骑乘配置；修改请通过物品与掉落、脚本、成长、NPC 或扩展配置完成。' },
      { tag: '阶段', text: '三系灵兽各有小灵兽、一转、二转三个阶段；二转后按脚本说明开启资质、五行与骑战继承。' },
      { tag: '材料', text: '一转脚本实际检查灵兽石与豹神水；部分脚本额外检查踏云玄铠，二转文案提到兽神水。' },
      { tag: '骑乘', text: '骑马需要马鞭并驯服野马；骑兵竞技使用骑兵竞技入场牌，灵兽以外的宠物不能带入竞技场。' },
      { tag: '脚本', text: 'MerStabl 目前只有 .pyc 时，无法在脚本工作台查看或修改源码，只能确认其引用关系。' }
    ];

    return {
      generatedAt: new Date().toISOString(),
      root: envirDir,
      server,
      params,
      species,
      growth,
      materials,
      scripts: scanned.scripts,
      npcs,
      mounts,
      notes,
      issues,
      stats: {
        species: species.length,
        stages: species.reduce((n, f) => n + f.stages.length, 0),
        missingForms,
        materials: materials.length,
        missingMaterials,
        mounts: mounts.items.length,
        npcs: npcs.rebirth.length + npcs.ride.length,
        scripts: scanned.scripts.length,
        error: counts.error,
        warn: counts.warn,
        info: counts.info,
        issues: issues.length
      }
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
      const d = ensure();
      return {
        species: d.stats.species,
        stages: d.stats.stages,
        missingForms: d.stats.missingForms,
        materials: d.stats.materials,
        missingMaterials: d.stats.missingMaterials,
        mounts: d.stats.mounts,
        npcs: d.stats.npcs,
        issues: d.stats.issues
      };
    },
    health() {
      const d = ensure();
      return { generatedAt: d.generatedAt, issues: d.issues };
    },
    invalidate() {
      cache = null;
      growthCache = null;
    }
  };
}

module.exports = { create };

'use strict';

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const npcData = require('./npc');
const templates = require('./npctemplates');
const pySyntax = require('./pysyntax');
const { checkToken, isInt } = require('./configs');
const { backupFile } = require('./dbe');

const MAX_SCRIPT = 5 * 1024 * 1024;
const RESERVED_DAILY_TYPES = [2, 4, 8, 16, 32];
const MODULE_KEYS = [
  'purchase', 'shop', 'warehouse', 'repair', 'recycle',
  'skill', 'daily', 'craft', 'teleport', 'teleportlist'
];

function warnMenuLength(warnings, label, count) {
  const lines = Math.ceil(count / 2) + 2;
  if (lines > 10) {
    warnings.push('「' + label + '」菜单约 ' + lines + ' 行，可能超出对话框显示范围，建议减少条目。');
  }
}

const TEMPLATES = [
  {
    key: 'purchase',
    label: '金币购买',
    description: '按脚本内自定义的金币价格出售物品，支持多种货品与单次数量。'
  },
  {
    key: 'shop',
    label: '标准商店',
    description: '生成引擎标准买卖菜单，货品价格取自 stditems.db，交易类型按货品 Stdmode 自动写入。'
  },
  {
    key: 'warehouse',
    label: '仓库保管',
    description: '提供存取物品与取回物品菜单，取回沿用引擎的离线时间与仓库锁验证。'
  },
  {
    key: 'repair',
    label: '装备修理',
    description: '提供普通修理与特修菜单，费用由引擎按装备耐久自动计算。'
  },
  {
    key: 'recycle',
    label: '物品回收',
    description: '按固定金币价格回收指定物品，每次回收 1 个。'
  },
  {
    key: 'skill',
    label: '技能学习',
    description: '教授 magic.db 中的技能，可按等级、职业与金币费用限制。'
  },
  {
    key: 'daily',
    label: '每日/限时福利',
    description: '每位玩家每天领取一次奖励，可设置开放小时段、等级门槛与金币/经验/物品奖励。'
  },
  {
    key: 'craft',
    label: '物品合成',
    description: '按自定义配方消耗材料与金币合成新物品，支持多个配方、成功率与失败返还材料。'
  },
  {
    key: 'teleport',
    label: '收费传送',
    description: '收取金币后把玩家移动到指定地图坐标。'
  },
  {
    key: 'teleportlist',
    label: '多目标传送',
    description: '一次配置多个传送目的地，每个目的地可单独设置等级与费用。'
  },
  {
    key: 'copy',
    label: '复制现有脚本',
    description: '以现有 NPC 脚本为起点创建独立副本，原样保留脚本内容。'
  }
];

function intField(value, label, min, max, fallback) {
  let n;
  if (value === undefined || value === null || value === '') {
    if (fallback === undefined) throw new Error(label + ' 不能为空');
    n = fallback;
  } else {
    n = Number(value);
  }
  if (!isInt(n, min, max)) throw new Error(`${label} 需要 ${min}-${max} 的整数`);
  return n;
}

function scriptConflict(base, ctx) {
  const hit = ctx.scriptBases.get(base.toLowerCase());
  if (hit) return `脚本已存在：${hit}.py`;
  for (const ext of ['.py', '.pyc']) {
    try {
      if (fs.existsSync(path.join(ctx.scriptDir, base + ext))) return `脚本已存在：${base}${ext}`;
    } catch (e) {
      /* 目录不可读时由后续写入报错 */
    }
  }
  return '';
}

function lineRanges(buf) {
  const ranges = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) {
      ranges.push({ start, contentEnd: i, end: i + 2 });
      i++;
      start = i + 1;
    } else if (buf[i] === 0x0a) {
      ranges.push({ start, contentEnd: i, end: i + 1 });
      start = i + 1;
    }
  }
  ranges.push({ start, contentEnd: buf.length, end: buf.length });
  return ranges;
}

function create(options) {
  const scriptDir = options.scriptDir;
  const npcFile = options.npcFile;
  const mapInfoFile = options.mapInfoFile;
  const itemNames = options.itemNames || (() => []);
  const itemModes = options.itemModes || (() => new Map());
  const magicNames = options.magicNames || (() => new Map());
  const mapCodes = options.mapCodes || (() => []);
  const mapNames = options.mapNames || (() => ({}));
  const invalidate = options.invalidate || (() => {});

  function context() {
    const parsed = npcData.parseNpc(npcFile);
    const codes = [];
    const byLower = new Map();
    for (const raw of mapCodes() || []) {
      const code = String(raw == null ? '' : raw).trim();
      if (!code || byLower.has(code.toLowerCase())) continue;
      byLower.set(code.toLowerCase(), code);
      codes.push(code);
    }
    let names = {};
    try {
      names = mapNames() || {};
    } catch (e) {
      names = {};
    }
    const nameByLower = new Map();
    for (const key of Object.keys(names)) nameByLower.set(key.toLowerCase(), names[key]);
    const registered = new Set();
    try {
      for (const row of npcData.parseMapNames(mapInfoFile)) {
        registered.add(String(row.code).toUpperCase());
      }
    } catch (e) {
      /* MapInfo 缺失时只影响告警 */
    }
    let itemSet = new Set();
    try {
      itemSet = new Set((itemNames() || []).map((name) => String(name)));
    } catch (e) {
      itemSet = new Set();
    }
    let itemModesMap = new Map();
    try {
      itemModesMap = itemModes() || new Map();
    } catch (e) {
      itemModesMap = new Map();
    }
    let magicMap = new Map();
    try {
      magicMap = magicNames() || new Map();
    } catch (e) {
      magicMap = new Map();
    }
    const scriptBases = new Map();
    try {
      for (const name of fs.readdirSync(scriptDir)) {
        const m = /^(.+)\.py$/i.exec(name);
        if (m) scriptBases.set(m[1].toLowerCase(), m[1]);
      }
    } catch (e) {
      /* 脚本目录缺失时 options 会显示为空 */
    }
    return {
      parsed,
      scriptDir,
      maps: { codes, byLower, names, nameByLower, registered },
      items: itemSet,
      itemModes: itemModesMap,
      magic: magicMap,
      scriptBases
    };
  }

  function mapDisplayName(ctx, code) {
    return ctx.maps.names[code] || ctx.maps.nameByLower.get(code.toLowerCase()) || '';
  }

  function normalizeMap(raw, ctx, label) {
    const code = checkToken(raw, label, 64);
    const hit = ctx.maps.byLower.get(code.toLowerCase());
    if (!hit) {
      throw new Error(`${label}未登记或不存在：${code}。请先在 MapInfo、MiniMap 或地图文件中登记。`);
    }
    return hit;
  }

  function suggest(ctx) {
    for (let i = 1; i <= 9999; i++) {
      const n = ('000' + i).slice(-3);
      const id = 'NpcNew' + n;
      if (ctx.parsed.rows.some((r) => r.id.toLowerCase() === id.toLowerCase())) continue;
      if (scriptConflict(id, ctx)) continue;
      return { id, script: id };
    }
    const suffix = Date.now().toString(36).toUpperCase();
    return { id: 'NpcNew' + suffix, script: 'NpcNew' + suffix };
  }

  function looksSummary(rows) {
    const map = new Map();
    for (const row of rows) {
      const raw = row.extra && row.extra[1];
      if (raw == null || !/^\d+$/.test(String(raw))) continue;
      const value = Number(raw);
      let entry = map.get(value);
      if (!entry) {
        entry = { value, count: 0, names: [] };
        map.set(value, entry);
      }
      entry.count += 1;
      if (entry.names.length < 3 && row.name && entry.names.indexOf(row.name) < 0) {
        entry.names.push(row.name);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.value - b.value);
  }

  function buildOptions() {
    const ctx = context();
    const used = new Map();
    for (const row of ctx.parsed.rows) {
      const key = row.script.toLowerCase();
      used.set(key, (used.get(key) || 0) + 1);
    }
    const scripts = [];
    for (const [lower, base] of ctx.scriptBases) {
      scripts.push({ base, file: base + '.py', usedBy: used.get(lower) || 0 });
    }
    scripts.sort((a, b) => a.base.localeCompare(b.base, 'zh-CN'));
    const maps = ctx.maps.codes.map((code) => ({
      code,
      name: mapDisplayName(ctx, code),
      registered: ctx.maps.registered.has(code.toUpperCase())
    }));
    maps.sort((a, b) => a.code.localeCompare(b.code, 'zh-CN'));
    const skills = [...ctx.magic].map(([name, m]) => ({
      name,
      job: Number(m && m.job != null ? m.job : -1),
      need: Array.isArray(m && m.need) ? m.need.map(Number) : [0, 0, 0]
    })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return {
      maps,
      items: [...ctx.items].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      scripts,
      skills,
      looks: looksSummary(ctx.parsed.rows),
      templates: TEMPLATES,
      suggested: suggest(ctx),
      counts: {
        npcs: ctx.parsed.rows.length,
        maps: maps.length,
        items: ctx.items.size,
        scripts: scripts.length,
        skills: skills.length
      }
    };
  }

  function normalizeScript(raw, ctx) {
    const text = checkToken(raw, '脚本文件名', 64);
    const base = text.replace(/\.py$/i, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) {
      throw new Error('脚本文件名只能包含英文字母、数字和下划线，且不能以数字开头');
    }
    if (base.length > 60) throw new Error('脚本文件名太长');
    const conflict = scriptConflict(base, ctx);
    if (conflict) throw new Error(conflict);
    return base;
  }

  function normalizeLooks(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return 165;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100000) {
      throw new Error('NPC 形象编号需要 0-100000 的整数');
    }
    return n;
  }

  function normalizePurchase(raw, ctx, warnings) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const minLevel = intField(src.minLevel, '最低等级', 0, 65535, 0);
    const maxQty = intField(src.maxQty, '单次最大数量', 1, 99, 1);
    const list = Array.isArray(src.goods) ? src.goods : [];
    if (!list.length) throw new Error('请至少添加一种货品');
    if (list.length > 12) throw new Error('货品最多 12 种');
    if (!ctx.items.size) throw new Error('stditems.db 中没有可用的物品数据，无法校验货品');
    const seen = new Set();
    const goods = list.map((good, index) => {
      const item = checkToken(good && good.item, `货品 ${index + 1} 名称`, 64);
      if (/[<>\r\n\/@]/.test(item)) {
        throw new Error(`货品「${item}」包含菜单保留字符（< > / @）`);
      }
      if (!ctx.items.has(item)) throw new Error(`物品不存在于 stditems.db：${item}`);
      const price = intField(good && good.price, `货品「${item}」单价`, 0, 1000000000);
      if (seen.has(item)) warnings.push(`货品「${item}」重复，购买菜单会出现多项相同物品。`);
      seen.add(item);
      return { item, price };
    });
    return { minLevel, maxQty, goods };
  }

  function normalizeShop(raw, ctx) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const sellPercent = intField(src.sellPercent, '出售比例', 0, 1000, 100);
    const buyPercent = intField(src.buyPercent, '收购比例', 0, 1000, 100);
    const list = Array.isArray(src.goods) ? src.goods : [];
    if (!list.length) throw new Error('请至少添加一种商店货品');
    if (list.length > 40) throw new Error('商店货品最多 40 种');
    if (!ctx.items.size) throw new Error('stditems.db 中没有可用的物品数据，无法校验货品');
    const modes = [];
    const modeSet = new Set();
    const goods = list.map((good, index) => {
      const item = checkToken(good && good.item, `货品 ${index + 1} 名称`, 64);
      if (/[<>\r\n\/@]/.test(item)) {
        throw new Error(`货品「${item}」包含菜单保留字符（< > / @）`);
      }
      if (!ctx.items.has(item)) throw new Error(`物品不存在于 stditems.db：${item}`);
      const mode = Number(ctx.itemModes.get(item));
      if (!Number.isFinite(mode)) {
        throw new Error(`无法读取物品「${item}」的类型（Stdmode），请检查 stditems.db`);
      }
      if (!modeSet.has(mode)) {
        modeSet.add(mode);
        modes.push(mode);
      }
      const count = intField(good && good.count, `货品「${item}」数量`, 1, 9999, 100);
      const time = intField(good && good.time, `货品「${item}」刷新时间`, 0, 9999, 10);
      return { item, count, time };
    });
    return { sellPercent, buyPercent, modes, goods };
  }

  function normalizeWarehouse() {
    return {};
  }

  function normalizeRepair(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const normal = src.normal === undefined ? true : !!src.normal;
    const special = src.special === undefined ? true : !!src.special;
    if (!normal && !special) throw new Error('请至少启用一种修理方式');
    return { normal, special };
  }

  function normalizeRecycle(raw, ctx) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const list = Array.isArray(src.goods) ? src.goods : [];
    if (!list.length) throw new Error('请至少添加一种回收物品');
    if (list.length > 20) throw new Error('回收物品最多 20 种');
    if (!ctx.items.size) throw new Error('stditems.db 中没有可用的物品数据，无法校验回收物品');
    return list.map((good, index) => {
      const item = checkToken(good && good.item, `回收物品 ${index + 1} 名称`, 64);
      if (/[<>\r\n\/@]/.test(item)) {
        throw new Error(`回收物品「${item}」包含菜单保留字符（< > / @）`);
      }
      if (!ctx.items.has(item)) throw new Error(`物品不存在于 stditems.db：${item}`);
      const price = intField(good && good.price, `回收物品「${item}」价格`, 0, 1000000000);
      return { item, price };
    });
  }

  function normalizeSkill(raw, ctx, warnings) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const name = checkToken(src.name, '技能名称', 64);
    if (/[<>\r\n\/@]/.test(name)) throw new Error('技能名称包含菜单保留字符（< > / @）');
    let magic = null;
    if (ctx.magic.size) {
      magic = ctx.magic.get(name) || null;
      if (!magic) throw new Error('magic.db 中不存在技能：' + name);
    } else {
      warnings.push('未能读取 magic.db，无法校验技能名称与职业限制。');
    }
    let job = -1;
    if (magic) {
      const value = Number(magic.job);
      if (Number.isInteger(value) && value >= 0 && value <= 2) job = value;
    }
    const levels = magic && Array.isArray(magic.need) ? magic.need : [];
    const fallbackNeed = Number(levels[0]) || 0;
    const needLevel = intField(src.needLevel, '最低等级', 0, 65535, fallbackNeed);
    const price = intField(src.price, '学习费用', 0, 1000000000, 0);
    return { name, job, needLevel, price };
  }

  function collectDailyTypes(ctx) {
    const used = new Set(RESERVED_DAILY_TYPES);
    let files = [];
    try {
      files = fs.readdirSync(ctx.scriptDir).filter((name) => /\.py$/i.test(name));
    } catch (e) {
      return used;
    }
    const patterns = [
      /DAILYTASK_TYPE\s*=\s*(\d+)/g,
      /DAILY_TYPE\s*=\s*(\d+)/g,
      /canUndertakeDailyTask\s*\(\s*player\s*,\s*(\d+)\s*\)/g,
      /recordDailyTask\s*\(\s*player\s*,\s*(\d+)\s*\)/g
    ];
    for (const name of files) {
      let raw;
      try {
        raw = fs.readFileSync(path.join(ctx.scriptDir, name));
      } catch (e) {
        continue;
      }
      if (raw.indexOf('DailyTask') < 0 && raw.indexOf('DAILYTASK_TYPE') < 0 && raw.indexOf('DAILY_TYPE') < 0) {
        continue;
      }
      let text;
      try {
        text = gbk.decodeText(raw);
      } catch (e) {
        continue;
      }
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const value = Number(match[1]);
          if (Number.isInteger(value) && value >= 1 && value <= 64) used.add(value);
        }
      }
    }
    return used;
  }

  function allocateDailyType(ctx) {
    const used = collectDailyTypes(ctx);
    for (let value = 1; value <= 64; value++) {
      if (!used.has(value)) return value;
    }
    throw new Error('每日标记类型 1-64 已全部占用，请先清理不再使用的每日福利脚本');
  }

  function normalizeDaily(raw, ctx) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const dailyType = allocateDailyType(ctx);
    const minLevel = intField(src.minLevel, '最低等级', 0, 65535, 0);
    const startHour = intField(src.startHour, '开放开始小时', 0, 23, 0);
    const endHour = intField(src.endHour, '开放结束小时', 0, 23, 0);
    if (startHour === endHour && startHour !== 0) {
      throw new Error('开放开始与结束小时不能相同；全天开放请都填 0');
    }
    const gold = intField(src.gold, '金币奖励', 0, 1000000000, 0);
    const exp = intField(src.exp, '经验奖励', 0, 1000000000, 0);
    const list = Array.isArray(src.rewards) ? src.rewards : [];
    if (list.length > 12) throw new Error('奖励物品最多 12 种');
    const rewards = list.map((reward, index) => {
      const item = checkToken(reward && reward.item, `奖励物品 ${index + 1} 名称`, 64);
      if (/[<>\r\n\/@]/.test(item)) {
        throw new Error(`奖励物品「${item}」包含菜单保留字符（< > / @）`);
      }
      if (!ctx.items.has(item)) throw new Error(`物品不存在于 stditems.db：${item}`);
      const count = intField(reward && reward.count, `奖励物品「${item}」数量`, 1, 9999, 1);
      return { item, count };
    });
    if (!rewards.length && gold <= 0 && exp <= 0) {
      throw new Error('请至少设置一种奖励（金币、经验或物品）');
    }
    return { dailyType, minLevel, startHour, endHour, gold, exp, rewards };
  }

  function normalizeCraft(raw, ctx, warnings) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const list = Array.isArray(src.recipes) ? src.recipes : [];
    if (!list.length) throw new Error('请至少添加一个合成配方');
    if (list.length > 12) throw new Error('合成配方最多 12 个');
    if (!ctx.items.size) throw new Error('stditems.db 中没有可用的物品数据，无法校验合成物品');
    const seenNames = new Set();
    const recipes = list.map((recipe, index) => {
      const label = `配方 ${index + 1}`;
      const output = checkToken(recipe && recipe.output, `${label} 产物名称`, 64);
      if (/[<>\r\n\/@]/.test(output)) {
        throw new Error(`产物「${output}」包含菜单保留字符（< > / @）`);
      }
      if (!ctx.items.has(output)) throw new Error(`物品不存在于 stditems.db：${output}`);
      const count = intField(recipe && recipe.count, `产物「${output}」数量`, 1, 9999, 1);
      const materials = Array.isArray(recipe && recipe.materials) ? recipe.materials : [];
      if (!materials.length) throw new Error(`${label}（${output}）请至少添加一种材料`);
      if (materials.length > 6) throw new Error(`${label}（${output}）材料最多 6 种`);
      const seenMaterials = new Set();
      const parsedMaterials = materials.map((material, mi) => {
        const item = checkToken(material && material.item, `${label} 材料 ${mi + 1} 名称`, 64);
        if (/[<>\r\n\/@]/.test(item)) {
          throw new Error(`材料「${item}」包含菜单保留字符（< > / @）`);
        }
        if (!ctx.items.has(item)) throw new Error(`物品不存在于 stditems.db：${item}`);
        if (seenMaterials.has(item)) {
          throw new Error(`${label}（${output}）的材料「${item}」重复，请合并为一行`);
        }
        seenMaterials.add(item);
        const amount = intField(material && material.count, `材料「${item}」数量`, 1, 9999, 1);
        return { item, count: amount };
      });
      const gold = intField(recipe && recipe.gold, `${label} 合成费用`, 0, 1000000000, 0);
      const rate = intField(recipe && recipe.rate, `${label} 成功率`, 1, 100, 100);
      const refund = recipe && recipe.refund !== undefined ? !!recipe.refund : true;
      let name = String(recipe && recipe.name != null ? recipe.name : '').trim();
      if (!name) name = count > 1 ? output + ' x' + count : output;
      if (/[<>\r\n\/@]/.test(name)) {
        throw new Error(`${label}显示名称包含菜单保留字符（< > / @）`);
      }
      if (name.length > 64) throw new Error(`${label}显示名称太长`);
      if (seenNames.has(name)) warnings.push(`合成配方名称「${name}」重复，合成菜单会出现多项同名条目。`);
      seenNames.add(name);
      return { name, materials: parsedMaterials, gold, output, count, rate, refund };
    });
    return { recipes };
  }

  function normalizeTeleportList(raw, ctx) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const list = Array.isArray(src.destinations) ? src.destinations : [];
    if (!list.length) throw new Error('请至少添加一个传送目的地');
    if (list.length > 12) throw new Error('传送目的地最多 12 个');
    return {
      destinations: list.map((dest, index) => {
        const label = `目的地 ${index + 1}`;
        const target = normalizeMap(dest && dest.map, ctx, label + '地图');
        const x = intField(dest && dest.x, label + ' X 坐标', 0, 100000, 0);
        const y = intField(dest && dest.y, label + ' Y 坐标', 0, 100000, 0);
        const price = intField(dest && dest.price, label + '费用', 0, 1000000000, 0);
        const minLevel = intField(dest && dest.minLevel, label + '最低等级', 0, 65535, 0);
        let name = String(dest && dest.name != null ? dest.name : '').trim();
        if (!name) name = mapDisplayName(ctx, target) || target;
        if (/[<>\r\n\/@]/.test(name)) {
          throw new Error(`${label}名称包含菜单保留字符（< > / @）`);
        }
        if (name.length > 64) throw new Error(label + '名称太长');
        return { name, map: target, x, y, price, minLevel };
      })
    };
  }

  function normalizeTeleport(raw, ctx) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const target = normalizeMap(src.map, ctx, '传送目标地图');
    const x = intField(src.x, '传送 X 坐标', 0, 100000, 0);
    const y = intField(src.y, '传送 Y 坐标', 0, 100000, 0);
    const price = intField(src.price, '传送费用', 0, 1000000000, 0);
    const minLevel = intField(src.minLevel, '最低等级', 0, 65535, 0);
    let targetName = String(src.name == null ? '' : src.name).trim();
    if (!targetName) targetName = mapDisplayName(ctx, target) || target;
    if (/[\r\n]/.test(targetName)) throw new Error('传送地点名称不能包含换行');
    if (targetName.length > 64) throw new Error('传送地点名称太长');
    return { target, x, y, price, minLevel, targetName };
  }

  function normalizeCopy(raw, ctx) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const rawName = String(src.source == null ? '' : src.source).trim();
    if (!rawName) throw new Error('请选择要复制的源脚本');
    const base = rawName.replace(/\.py$/i, '');
    if (!base || /[\\/:*?"<>|]/.test(base)) throw new Error('源脚本名称不合法');
    const file = path.join(scriptDir, base + '.py');
    if (!fs.existsSync(file)) throw new Error('源脚本不存在：' + base + '.py');
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error('源脚本不是文件：' + base + '.py');
    if (st.size > MAX_SCRIPT) throw new Error('源脚本超过 5MB，无法复制');
    const buf = fs.readFileSync(file);
    return { base, buf, text: gbk.decodeText(buf) };
  }

  function moduleLabel(key) {
    const hit = TEMPLATES.find((t) => t.key === key);
    return hit ? hit.label : key;
  }

  function menuText(value, fieldLabel, maxLen, fallback) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return fallback;
    if (text.length > maxLen) throw new Error(fieldLabel + '不能超过 ' + maxLen + ' 个字符');
    if (/[<>@\r\n]/.test(text)) throw new Error(fieldLabel + '不能包含 < > @ 或换行');
    return text;
  }

  function normalizeMenu(raw, selected, name) {
    const menu = raw && typeof raw === 'object' ? raw : {};
    const labels = {};
    const seen = new Set();
    const rawLabels = menu.labels && typeof menu.labels === 'object' ? menu.labels : {};
    for (const mod of selected) {
      const fallback = moduleLabel(mod.key);
      const label = menuText(rawLabels[mod.key], '「' + fallback + '」菜单名称', 20, fallback);
      if (seen.has(label)) throw new Error('菜单名称重复：' + label);
      seen.add(label);
      labels[mod.key] = label;
    }
    const greeting = menuText(menu.greeting, '欢迎标语', 80, '欢迎光临，' + name + '。');
    return { greeting, labels };
  }

  function normalizeModules(raw, p) {
    if (!Array.isArray(raw) || !raw.length) return null;
    if (raw.length > MODULE_KEYS.length) {
      throw new Error('综合 NPC 最多 ' + MODULE_KEYS.length + ' 项功能');
    }
    const seen = new Set();
    return raw.map((mod) => {
      const key = String(mod && mod.key || '').toLowerCase();
      if (key === 'copy') throw new Error('「复制现有脚本」不能与其他功能组合');
      if (MODULE_KEYS.indexOf(key) < 0) throw new Error('未知的功能模块：' + (key || '（空）'));
      const label = moduleLabel(key);
      if (seen.has(key)) throw new Error('功能模块重复：' + label);
      seen.add(key);
      const config = mod && mod.config != null ? mod.config : p[key];
      return { key, label, config };
    });
  }

  function buildModule(key, raw, name, ctx, warnings) {
    let script;
    let summary = null;
    if (key === 'purchase') {
      const cfg = normalizePurchase(raw, ctx, warnings);
      warnMenuLength(warnings, '金币购买', cfg.goods.length * (cfg.maxQty > 1 ? 2 : 1));
      script = templates.purchase({ name, ...cfg });
    } else if (key === 'shop') {
      const cfg = normalizeShop(raw, ctx);
      script = templates.shop({ name, ...cfg });
      summary = '出售比例 ' + cfg.sellPercent + '%、收购比例 ' + cfg.buyPercent +
        '%，允许交易类型 ' + cfg.modes.join(' / ') + '（由货品 Stdmode 自动推导）。';
    } else if (key === 'warehouse') {
      normalizeWarehouse();
      script = templates.warehouse();
    } else if (key === 'repair') {
      const cfg = normalizeRepair(raw);
      script = templates.repair(cfg);
    } else if (key === 'recycle') {
      const goods = normalizeRecycle(raw, ctx);
      warnMenuLength(warnings, '物品回收', goods.length);
      script = templates.recycle({ goods });
    } else if (key === 'skill') {
      const cfg = normalizeSkill(raw, ctx, warnings);
      script = templates.skill(cfg);
      summary = '技能「' + cfg.name + '」，' +
        (cfg.job >= 0 ? '职业 ' + ['战士', '法师', '道士'][cfg.job] : '不限职业') +
        '，最低等级 ' + cfg.needLevel + '，费用 ' + cfg.price + ' 金币。';
    } else if (key === 'daily') {
      const cfg = normalizeDaily(raw, ctx);
      script = templates.daily(cfg);
      summary = '每日 1 次（自动分配标记类型 ' + cfg.dailyType + '），' +
        (cfg.startHour === 0 && cfg.endHour === 0
          ? '全天开放'
          : '开放时间 ' + cfg.startHour + ':00 - ' + cfg.endHour + ':00') +
        '，奖励：' + [
          cfg.gold > 0 ? cfg.gold + ' 金币' : '',
          cfg.exp > 0 ? cfg.exp + ' 经验' : '',
          cfg.rewards.map((r) => r.item + ' x' + r.count).join('、')
        ].filter(Boolean).join('、') + '。';
    } else if (key === 'craft') {
      const cfg = normalizeCraft(raw, ctx, warnings);
      warnMenuLength(warnings, '物品合成', cfg.recipes.length);
      script = templates.craft(cfg);
      summary = '共 ' + cfg.recipes.length + ' 个合成配方。';
    } else if (key === 'teleportlist') {
      const cfg = normalizeTeleportList(raw, ctx);
      warnMenuLength(warnings, '多目标传送', cfg.destinations.length);
      script = templates.teleportList(cfg);
      summary = '共 ' + cfg.destinations.length + ' 个传送目的地。';
    } else {
      const cfg = normalizeTeleport(raw, ctx);
      script = templates.teleport(cfg);
    }
    return { key, label: moduleLabel(key), script, summary };
  }

  function prepare(payload) {
    const ctx = context();
    const p = payload && typeof payload === 'object' ? payload : {};
    const name = checkToken(p.name, 'NPC 名称', 64);
    const id = checkToken(p.id, 'NPC 唯一编号', 64);
    const looks = normalizeLooks(p.looks);
    const scripts = normalizeScript(p.script, ctx);
    const map = normalizeMap(p.map, ctx, '地图编号');
    const x = intField(p.x, 'X 坐标', 0, 100000);
    const y = intField(p.y, 'Y 坐标', 0, 100000);
    const selected = normalizeModules(p.modules, p);
    const menu = selected && selected.length > 1 ? normalizeMenu(p.menu, selected, name) : null;
    let key;
    if (selected) {
      key = selected.length === 1 ? selected[0].key : 'combined';
    } else {
      key = String(p.template || 'purchase').toLowerCase();
      if (!TEMPLATES.some((t) => t.key === key)) throw new Error('未知的功能模板：' + key);
    }

    const warnings = [];
    const checks = [];

    if (ctx.parsed.rows.some((row) => row.id.toLowerCase() === id.toLowerCase())) {
      throw new Error('NPC 唯一编号已存在：' + id);
    }
    if (ctx.parsed.rows.some((row) => row.name === name)) {
      warnings.push(`NPCList.txt 中已有同名 NPC「${name}」，请确认是否需要区分。`);
    }
    const sameSpot = ctx.parsed.rows.filter((row) =>
      row.map.toLowerCase() === map.toLowerCase() && row.x === x && row.y === y);
    if (sameSpot.length) {
      warnings.push(`坐标 (${x}, ${y}) 已有 ${sameSpot.length} 个 NPC，可能出现重叠。`);
    }
    if (!ctx.maps.registered.has(map.toUpperCase())) {
      warnings.push(`地图「${map}」未在 MapInfo 登记，建议在地图工作台补登记后再放置 NPC。`);
    }

    let scriptText;
    let scriptBuffer;
    let source = null;

    let summary = null;
    if (selected) {
      const built = selected.map((mod) => buildModule(mod.key, mod.config, name, ctx, warnings));
      if (built.length === 1) {
        scriptText = built[0].script;
        summary = built[0].summary;
      } else {
        for (const mod of built) mod.label = menu.labels[mod.key] || mod.label;
        warnMenuLength(warnings, '综合主菜单', built.length);
        scriptText = templates.compose({
          name,
          greeting: menu.greeting,
          modules: built.map((mod) => ({ key: mod.key, label: mod.label, script: mod.script }))
        });
        summary = '综合 NPC（' + built.length + ' 项功能）：' + built.map((mod) => mod.label).join('、') + '。';
        const details = built.map((mod) => mod.summary).filter(Boolean);
        if (details.length) summary += ' ' + details.join(' ');
      }
    } else if (key === 'purchase') {
      const cfg = normalizePurchase(p.purchase, ctx, warnings);
      warnMenuLength(warnings, '金币购买', cfg.goods.length * (cfg.maxQty > 1 ? 2 : 1));
      scriptText = templates.purchase({ name, ...cfg });
    } else if (key === 'shop') {
      const cfg = normalizeShop(p.shop, ctx);
      scriptText = templates.shop({ name, ...cfg });
      summary = '出售比例 ' + cfg.sellPercent + '%、收购比例 ' + cfg.buyPercent +
        '%，允许交易类型 ' + cfg.modes.join(' / ') + '（由货品 Stdmode 自动推导）。';
    } else if (key === 'warehouse') {
      normalizeWarehouse();
      scriptText = templates.warehouse();
    } else if (key === 'repair') {
      const cfg = normalizeRepair(p.repair);
      scriptText = templates.repair(cfg);
    } else if (key === 'recycle') {
      const goods = normalizeRecycle(p.recycle, ctx);
      warnMenuLength(warnings, '物品回收', goods.length);
      scriptText = templates.recycle({ goods });
    } else if (key === 'skill') {
      const cfg = normalizeSkill(p.skill, ctx, warnings);
      scriptText = templates.skill(cfg);
      summary = '技能「' + cfg.name + '」，' +
        (cfg.job >= 0 ? '职业 ' + ['战士', '法师', '道士'][cfg.job] : '不限职业') +
        '，最低等级 ' + cfg.needLevel + '，费用 ' + cfg.price + ' 金币。';
    } else if (key === 'daily') {
      const cfg = normalizeDaily(p.daily, ctx);
      scriptText = templates.daily(cfg);
      summary = '每日 1 次（自动分配标记类型 ' + cfg.dailyType + '），' +
        (cfg.startHour === 0 && cfg.endHour === 0
          ? '全天开放'
          : '开放时间 ' + cfg.startHour + ':00 - ' + cfg.endHour + ':00') +
        '，奖励：' + [
          cfg.gold > 0 ? cfg.gold + ' 金币' : '',
          cfg.exp > 0 ? cfg.exp + ' 经验' : '',
          cfg.rewards.map((r) => r.item + ' x' + r.count).join('、')
        ].filter(Boolean).join('、') + '。';
    } else if (key === 'craft') {
      const cfg = normalizeCraft(p.craft, ctx, warnings);
      warnMenuLength(warnings, '物品合成', cfg.recipes.length);
      scriptText = templates.craft(cfg);
      summary = '共 ' + cfg.recipes.length + ' 个合成配方：' +
        cfg.recipes.map((r) => r.name + '（成功率 ' + r.rate + '%，' +
          (r.refund ? '失败返还材料' : '失败不返还') + '）').join('、') + '。';
    } else if (key === 'teleportlist') {
      const cfg = normalizeTeleportList(p.teleports, ctx);
      warnMenuLength(warnings, '多目标传送', cfg.destinations.length);
      scriptText = templates.teleportList(cfg);
      summary = '共 ' + cfg.destinations.length + ' 个传送目的地。';
    } else if (key === 'teleport') {
      const cfg = normalizeTeleport(p.teleport, ctx);
      scriptText = templates.teleport(cfg);
    } else {
      const copy = normalizeCopy(p.copy, ctx);
      source = copy.base;
      scriptText = copy.text;
      scriptBuffer = copy.buf;
      warnings.push('复制模板会原样保留源脚本内容，菜单文字与 NPC 名称可能需要手动调整。');
    }

    if (!scriptBuffer) {
      const clean = scriptText.replace(/\r\n/g, '\n');
      const finalText = clean.replace(/\n/g, '\r\n');
      try {
        scriptBuffer = gbk.encode(finalText);
      } catch (e) {
        throw new Error('生成脚本包含 GBK 无法编码的字符：' + e.message);
      }
      if (gbk.decodeText(scriptBuffer) !== finalText) {
        throw new Error('生成脚本无法无损转换为 GBK，请检查 NPC 名称或物品名称');
      }
      scriptText = finalText;
    }

    const row = {
      id,
      script: scripts,
      map,
      x,
      y,
      name,
      extra: ['0', String(looks), '0', '0']
    };
    const npcLine = [id, scripts, map, x, y, name, '0', String(looks), '0', '0'].join('\t');

    const hasModule = (name) => (selected ? selected.some((mod) => mod.key === name) : key === name);

    for (const message of warnings) checks.push({ severity: 'warn', message });
    checks.push({
      severity: 'info',
      message: `将新建 ${scripts}.py（GBK / CRLF），并在 NPCList.txt 中写入 1 条记录；NPCList.txt 写入前会自动备份。`
    });
    if (summary) checks.push({ severity: 'info', message: summary });
    if (key === 'combined') {
      checks.push({
        severity: 'info',
        message: '综合 NPC 的 main 菜单会按勾选顺序列出各功能，功能处理函数已加前缀避免重名。'
      });
    }
    if (hasModule('purchase')) {
      checks.push({
        severity: 'info',
        message: '货品价格由生成的脚本控制，与 stditems.db 中的售价无关。'
      });
    }
    if (hasModule('shop')) {
      checks.push({
        severity: 'info',
        message: '标准商店的售价与收购价取自 stditems.db，并由买卖比例调整。'
      });
    }
    if (hasModule('warehouse')) {
      checks.push({
        severity: 'info',
        message: '仓库存取与取回验证由引擎完成，不需要额外配置。'
      });
    }
    if (hasModule('repair')) {
      checks.push({
        severity: 'info',
        message: '修理费用由引擎按装备耐久自动计算。'
      });
    }
    if (hasModule('recycle')) {
      checks.push({
        severity: 'info',
        message: '回收只检查背包内的物品，回收价格由模板固定。'
      });
    }
    if (hasModule('daily')) {
      checks.push({
        severity: 'info',
        message: '每日领取状态由引擎按玩家记录，无需额外存档；修改开放时间后请重新加载脚本。'
      });
    }
    if (hasModule('craft')) {
      checks.push({
        severity: 'info',
        message: '合成前会先校验全部材料、金币与背包空位，再扣除；失败返还只返还材料，金币不返还。'
      });
    }
    if (key !== 'copy') {
      let syntax = null;
      try {
        syntax = pySyntax.check(scriptText);
      } catch (e) {
        checks.push({ severity: 'warn', message: '未能执行语法检查：' + e.message });
      }
      if (syntax) {
        if (!syntax.ok) {
          const first = (syntax.errors && syntax.errors[0]) || null;
          checks.push({
            severity: 'error',
            message: '生成的脚本未通过语法检查' + (first ? '：' + first.message : '')
          });
        }
        for (const warn of syntax.warnings || []) {
          checks.push({
            severity: 'warn',
            message: 'Python 兼容性：' + warn.message + (warn.line ? '（第 ' + warn.line + ' 行）' : '')
          });
        }
        if (syntax.note) checks.push({ severity: 'info', message: syntax.note });
      }
    }

    const errors = checks.filter((c) => c.severity === 'error');
    return {
      ok: errors.length === 0,
      template: key,
      name,
      id,
      script: scripts,
      scriptFile: scripts + '.py',
      map,
      x,
      y,
      npcLine,
      scriptText,
      checks,
      errors: errors.map((c) => c.message),
      source,
      row,
      buffer: scriptBuffer
    };
  }

  function preview(payload) {
    const p = prepare(payload);
    return {
      ok: p.ok,
      template: p.template,
      name: p.name,
      id: p.id,
      script: p.script,
      scriptFile: p.scriptFile,
      map: p.map,
      x: p.x,
      y: p.y,
      npcLine: p.npcLine,
      scriptText: p.scriptText,
      scriptEncoding: 'GBK',
      eol: 'CRLF',
      checks: p.checks,
      errors: p.errors,
      source: p.source
    };
  }

  function writeNewScript(file, buf) {
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
    try {
      fs.writeFileSync(tmp, buf, { flag: 'wx' });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (e2) { /* 临时文件可能未创建 */ }
      throw e;
    }
  }

  function appendNpcLine(buf, parsed, row) {
    const text = gbk.decodeText(buf);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const trailing = text.endsWith('\n');
    const eolBuf = Buffer.from(eol, 'utf8');
    const rowBuf = gbk.encode(
      [row.id, row.script, row.map, row.x, row.y, row.name, ...row.extra].join('\t')
    );

    let anchor = -1;
    for (const item of parsed.rows) {
      if (item.map !== row.map) continue;
      if (item.line > anchor) anchor = item.line;
    }

    if (anchor < 0) {
      const parts = [buf];
      if (buf.length && !trailing) parts.push(eolBuf);
      parts.push(rowBuf);
      if (trailing) parts.push(eolBuf);
      return Buffer.concat(parts);
    }

    const ranges = lineRanges(buf);
    const line = ranges[anchor];
    if (!line) {
      const parts = [buf];
      if (buf.length && !trailing) parts.push(eolBuf);
      parts.push(rowBuf);
      if (trailing) parts.push(eolBuf);
      return Buffer.concat(parts);
    }
    if (line.end === buf.length && !trailing) {
      return Buffer.concat([buf, eolBuf, rowBuf]);
    }
    return Buffer.concat([
      buf.slice(0, line.end),
      rowBuf,
      eolBuf,
      buf.slice(line.end)
    ]);
  }

  function createNpc(payload) {
    const prepared = prepare(payload);
    if (!prepared.ok) {
      const e = new Error(prepared.errors.join('；'));
      e.status = 400;
      throw e;
    }

    const fresh = context();
    if (fresh.parsed.rows.some((row) => row.id.toLowerCase() === prepared.id.toLowerCase())) {
      const e = new Error('NPC 唯一编号已存在：' + prepared.id);
      e.status = 409;
      throw e;
    }
    const conflict = scriptConflict(prepared.script, fresh);
    if (conflict) {
      const e = new Error(conflict);
      e.status = 409;
      throw e;
    }

    const scriptPath = path.join(scriptDir, prepared.script + '.py');
    const before = fs.readFileSync(npcFile);
    let wroteScript = false;
    let backup = null;
    try {
      writeNewScript(scriptPath, prepared.buffer);
      wroteScript = true;
      const parsedNow = npcData.parseNpc(npcFile);
      const next = appendNpcLine(before, parsedNow, prepared.row);
      backup = backupFile(npcFile);
      fs.writeFileSync(npcFile, next);
    } catch (e) {
      if (wroteScript) {
        try { fs.unlinkSync(scriptPath); } catch (e2) { /* 已不存在 */ }
      }
      try {
        const now = fs.readFileSync(npcFile);
        if (!now.equals(before)) fs.writeFileSync(npcFile, before);
      } catch (e2) {
        /* 回滚失败时保留原始错误 */
      }
      throw e;
    }

    invalidate();

    let index = -1;
    try {
      const after = npcData.parseNpc(npcFile);
      index = after.rows.findIndex((row) =>
        row.id === prepared.id &&
        row.script === prepared.script &&
        row.map === prepared.map &&
        row.x === prepared.x &&
        row.y === prepared.y);
    } catch (e) {
      /* 索引仅用于跳转，失败不影响创建结果 */
    }

    return {
      ok: true,
      id: prepared.id,
      name: prepared.name,
      script: prepared.script,
      scriptFile: prepared.scriptFile,
      map: prepared.map,
      x: prepared.x,
      y: prepared.y,
      npcLine: prepared.npcLine,
      template: prepared.template,
      source: prepared.source,
      index,
      backup,
      warnings: prepared.checks.filter((c) => c.severity === 'warn').map((c) => c.message)
    };
  }

  return { options: buildOptions, preview, create: createNpc };
}

module.exports = { create };

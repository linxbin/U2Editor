'use strict';

const fs = require('fs');
const path = require('path');
const dbe = require('./dbe');
const gbk = require('./gbk');
const configs = require('./configs');
const extras = require('./extras');
const mallData = require('./mall');
const npcData = require('./npc');
const monsterData = require('./monster');

const PSEUDO_ITEMS = new Set([
  '金币', '经验', '声望', '元宝', '银币', '绑定金币', '绑定元宝',
  '活力', '荣誉', '积分', '游戏币', '强制任务', '后置任务'
]);

const STDMODE_LABELS = {
  0: '药品', 1: '食物', 2: '技能卷轴', 3: '卷轴/消耗', 4: '技能书',
  5: '武器', 6: '武器', 7: '宝盒', 9: '特殊', 10: '男装', 11: '女装',
  15: '头盔', 18: '特殊项链', 19: '项链', 20: '项链', 21: '项链',
  22: '戒指', 23: '戒指', 24: '手镯', 25: '毒药', 26: '手套/护腕',
  29: '神佑', 30: '照明/勋章', 31: '药包', 32: '马牌', 33: '马牌',
  34: '道符', 35: '卷包', 36: '金条/红包', 37: '传音/凭证', 38: '特殊道具',
  40: '肉', 41: '碎片', 42: '材料', 43: '矿石', 44: '材料', 45: '材料',
  46: '信件/凭证', 47: '特殊道具', 48: '材料', 49: '彩票/喜帖', 50: '宝盒',
  51: '鞭炮', 52: '花束', 53: '兽粮', 54: '材料', 55: '宝石/令牌',
  56: '特殊道具', 57: '技能', 58: '腰带', 59: '宝石', 61: '宝石',
  62: '鉴定卷轴', 70: '元神', 71: '灵石', 72: '信物',
  81: '靴子', 82: '未鉴定装备', 83: '未鉴定装备'
};

function typeLabel(mode) {
  return STDMODE_LABELS[mode] || ('类型 ' + mode);
}

function stripDigits(name) {
  return String(name == null ? '' : name).replace(/[0-9]+$/, '');
}

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function dirSig(dir, re) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => re.test(n)).sort();
  } catch (e) {
    return 'missing';
  }
  return names.map((n) => {
    try {
      const st = fs.statSync(path.join(dir, n));
      return `${n}:${st.size}:${st.mtimeMs}`;
    } catch (e) {
      return n + ':missing';
    }
  }).join('|');
}

function parseDesc(file) {
  const map = new Map();
  let text = '';
  try {
    text = gbk.decodeText(fs.readFileSync(file));
  } catch (e) {
    return map;
  }
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\[(.+)\]\s*$/.exec(line.trim());
    if (m) {
      cur = { name: m[1].trim(), lines: [] };
      map.set(cur.name, cur);
      continue;
    }
    if (cur && line.trim()) cur.lines.push(line.trim());
  }
  const out = new Map();
  for (const [name, entry] of map) out.set(name, entry.lines.join('\n'));
  return out;
}

function create(options) {
  const dbFile = path.resolve(options.dbFile);
  const descFile = path.resolve(options.descFile);
  const dropDir = path.resolve(options.dropDir);
  const monsterFile = path.resolve(options.monsterFile);
  const npcFile = path.resolve(options.npcFile);
  const scriptDir = path.resolve(options.scriptDir);
  const makeItemFile = path.resolve(options.makeItemFile);
  const goodsFile = path.resolve(options.goodsFile);
  const mallFile = path.resolve(options.mallFile);
  const taskWorkbench = options.taskWorkbench || null;
  let cache = null;

  function taskSig() {
    try {
      return taskWorkbench.list().generatedAt;
    } catch (e) {
      return 'error:' + e.message;
    }
  }

  function signature() {
    return [
      'db|' + statSig(dbFile),
      'desc|' + statSig(descFile),
      'mon|' + statSig(monsterFile),
      'npc|' + statSig(npcFile),
      'shop|' + dirSig(scriptDir, /\.py$/i),
      'make|' + statSig(makeItemFile),
      'goods|' + statSig(goodsFile),
      'mall|' + statSig(mallFile),
      'drop|' + dirSig(dropDir, /\.txt$/i),
      'task|' + (taskWorkbench ? taskSig() : 'none')
    ].join(';');
  }

  function build() {
    const { schema, rows } = dbe.loadDb(dbFile);
    const desc = parseDesc(descFile);
    const issues = [];
    const itemNames = new Set();
    const byName = new Map();
    const byNorm = new Map();
    const normName = (s) => String(s == null ? '' : s).replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
    for (let i = 0; i < rows.length; i++) {
      const raw = String(rows[i].Name == null ? '' : rows[i].Name).trim();
      if (!raw) continue;
      itemNames.add(raw);
      if (!byName.has(raw)) byName.set(raw, []);
      byName.get(raw).push(i);
      if (!byNorm.has(normName(raw))) byNorm.set(normName(raw), raw);
    }
    const rowIssues = rows.map(() => ({ error: 0, warn: 0, info: 0 }));
    const addIssue = (code, severity, message, extra) => {
      const issue = {
        code,
        severity,
        message,
        index: extra && extra.index != null ? extra.index : null,
        item: (extra && extra.item) || '',
        source: (extra && extra.source) || '',
        action: (extra && extra.action) || null
      };
      issues.push(issue);
      if (issue.index != null && rowIssues[issue.index]) rowIssues[issue.index][severity]++;
    };

    // 爆率反向索引
    const dropByName = new Map();
    let dropRows = 0;
    let dropFiles = 0;
    let dropInvalid = 0;
    let dropUnknownMonster = 0;
    const unknownDropMonsterSamples = [];
    let monsterNames = new Set();
    try {
      const mdb = dbe.loadDb(monsterFile);
      monsterNames = new Set(mdb.rows.map((r) => String(r.Name == null ? '' : r.Name).trim()).filter(Boolean));
    } catch (e) {
    }
    const unknown = new Map();
    const addUnknown = (source, name, detail) => {
      if (!name || PSEUDO_ITEMS.has(name) || itemNames.has(name)) return;
      const key = source + '|' + name;
      if (!unknown.has(key)) unknown.set(key, { source, name, count: 0, detail: detail || {} });
      const u = unknown.get(key);
      u.count++;
      if (!u.detail.kind) u.detail = Object.assign({}, detail, { kind: u.detail.kind });
    };

    let dropList = [];
    try {
      dropList = fs.readdirSync(dropDir).filter((n) => /\.txt$/i.test(n)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    } catch (e) {
      issues.push({ code: 'item_drops_unreadable', severity: 'error', message: `爆率目录读取失败：${e.message}`, index: null, item: '', source: '', action: null });
    }
    for (const file of dropList) {
      dropFiles++;
      const stem = file.replace(/\.txt$/i, '');
      let monster = stem;
      let monsterKnown = monsterNames.has(stem);
      if (!monsterKnown) {
        const base = stripDigits(stem);
        if (monsterNames.has(base)) {
          monster = base;
          monsterKnown = true;
        }
      }
      if (!monsterKnown) {
        dropUnknownMonster++;
        if (unknownDropMonsterSamples.length < 5) unknownDropMonsterSamples.push(file);
      }
      let data;
      try {
        data = configs.readFileLines(path.join(dropDir, file));
      } catch (e) {
        continue;
      }
      const parsed = monsterData.parseDropLines(data.lines);
      dropInvalid += parsed.invalid.length;
      for (const row of parsed.rows) {
        dropRows++;
        if (!itemNames.has(row.item)) {
          addUnknown('drop', row.item, { monster, file, line: row.line, monsterKnown });
          continue;
        }
        if (!dropByName.has(row.item)) dropByName.set(row.item, []);
        dropByName.get(row.item).push({
          monster,
          monsterKnown,
          file,
          line: row.line,
          n: row.n,
          d: row.d,
          qty: row.qty
        });
      }
    }

    // NPC 商店
    let shops = null;
    try {
      const npc = npcData.parseNpc(npcFile);
      shops = npcData.parseShops(scriptDir, npc.rows);
    } catch (e) {
      issues.push({ code: 'item_shops_unreadable', severity: 'warn', message: `商店配置读取失败：${e.message}`, index: null, item: '', source: '', action: null });
    }
    const shopByName = new Map();
    let shopRefs = 0;
    const baseShops = new Map();
    if (shops) {
      for (const shop of shops.shops) {
        for (const src of shop.sources || []) {
          if (!baseShops.has(src.base)) baseShops.set(src.base, []);
          baseShops.get(src.base).push(shop.name);
        }
      }
      for (const file of shops.files) {
        const npcs = baseShops.get(file.base) || [];
        for (const good of file.goods) {
          shopRefs++;
          if (!itemNames.has(good.item)) {
            addUnknown('shop', good.item, { file: file.name, line: good.line, npc: npcs[0] || '' });
            continue;
          }
          if (!shopByName.has(good.item)) shopByName.set(good.item, []);
          for (const npc of (npcs.length ? npcs : [''])) {
            shopByName.get(good.item).push({
              npc,
              file: file.name,
              base: file.base,
              line: good.line,
              count: good.count,
              time: good.time
            });
          }
        }
      }
    }

    // 任务
    const taskByName = new Map();
    let taskRefs = 0;
    if (taskWorkbench) {
      try {
        const data = taskWorkbench.list();
        for (const task of data.tasks || []) {
          for (const name of task.items || []) {
            taskRefs++;
            if (!itemNames.has(name)) {
              addUnknown('task', name, { taskId: task.id, taskName: task.name });
              continue;
            }
            if (!taskByName.has(name)) taskByName.set(name, []);
            taskByName.get(name).push({ id: task.id, name: task.name, enabled: !!task.enabled, module: task.module || '' });
          }
        }
      } catch (e) {
        issues.push({ code: 'item_tasks_unreadable', severity: 'warn', message: `任务配置读取失败：${e.message}`, index: null, item: '', source: '', action: null });
      }
    }

    // 合成
    let recipes = [];
    try {
      recipes = configs.parseMakeItem(makeItemFile).recipes || [];
    } catch (e) {
      issues.push({ code: 'item_make_unreadable', severity: 'warn', message: `合成配置读取失败：${e.message}`, index: null, item: '', source: '', action: null });
    }
    const recipeUse = new Map();
    const recipeMake = new Map();
    for (const recipe of recipes) {
      addUnknown('make', recipe.name, { recipe: recipe.name, line: recipe.headerLine });
      if (itemNames.has(recipe.name)) {
        if (!recipeMake.has(recipe.name)) recipeMake.set(recipe.name, []);
        recipeMake.get(recipe.name).push({ name: recipe.name, line: recipe.headerLine });
      }
      for (const mat of recipe.items || []) {
        addUnknown('make', mat.name, { recipe: recipe.name, line: mat.line });
        if (!itemNames.has(mat.name)) continue;
        if (!recipeUse.has(mat.name)) recipeUse.set(mat.name, []);
        recipeUse.get(mat.name).push({ recipe: recipe.name, count: mat.count, line: mat.line });
      }
    }

    // 商城商品 goodsconfig
    let goodsEntries = [];
    try {
      goodsEntries = extras.parseGoodsConfig(goodsFile).entries || [];
    } catch (e) {
      issues.push({ code: 'item_goods_unreadable', severity: 'warn', message: `商城商品读取失败：${e.message}`, index: null, item: '', source: '', action: null });
    }
    const goodsByName = new Map();
    for (const entry of goodsEntries) {
      addUnknown('goods', entry.name, { goodsId: entry.id, line: entry.line });
      if (!itemNames.has(entry.name)) continue;
      if (!goodsByName.has(entry.name)) goodsByName.set(entry.name, []);
      goodsByName.get(entry.name).push({ id: entry.id, version: entry.version, line: entry.line });
    }

    // 商城配置 PTItems.xml
    let mallItems = [];
    try {
      mallItems = mallData.parseMall(mallFile).items || [];
    } catch (e) {
      issues.push({ code: 'item_mall_unreadable', severity: 'warn', message: `商城配置读取失败：${e.message}`, index: null, item: '', source: '', action: null });
    }
    const mallByName = new Map();
    for (const item of mallItems) {
      const v = item.values || {};
      const name = String(v.name == null ? '' : v.name).trim();
      addUnknown('mall', name, { mallId: v.id, line: item.line + 1 });
      if (!itemNames.has(name)) continue;
      if (!mallByName.has(name)) mallByName.set(name, []);
      mallByName.get(name).push({
        id: v.id,
        price: v.price,
        unitnum: v.unitnum,
        line: item.line + 1,
        classType: item.classType || '',
        subType: item.subType || ''
      });
    }

    // 物品行与问题
    for (const [name, indexes] of byName) {
      if (indexes.length < 2) continue;
      addIssue('item_name_duplicate', 'warn',
        `物品名称「${name}」出现 ${indexes.length} 次（Idx ${indexes.map((i) => rows[i].Idx).join(' / ')}）`,
        { item: name, index: indexes[0] });
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row.Name == null ? '' : row.Name).trim();
      if (!name) {
        addIssue('item_name_empty', 'error', `第 ${i + 1} 行物品没有名称`, { index: i });
      }
      if (Number(row.Price) < 0) {
        addIssue('item_price_negative', 'warn', `物品「${name}」价格为负数（${row.Price}）`, { item: name, index: i });
      }
      if (Number(row.Weight) < 0) {
        addIssue('item_weight_negative', 'warn', `物品「${name}」重量为负数（${row.Weight}）`, { item: name, index: i });
      }
    }

    const items = rows.map((row, i) => {
      const name = String(row.Name == null ? '' : row.Name).trim();
      const drops = dropByName.get(name) || [];
      const shopList = shopByName.get(name) || [];
      const tasks = taskByName.get(name) || [];
      const use = recipeUse.get(name) || [];
      const make = recipeMake.get(name) || [];
      const mallList = mallByName.get(name) || [];
      const goodsList = goodsByName.get(name) || [];
      return {
        index: i,
        idx: row.Idx,
        name: row.Name,
        stdmode: row.Stdmode,
        type: typeLabel(row.Stdmode),
        weight: row.Weight,
        price: row.Price,
        needLevel: row.NeedLevel,
        looks: row.Looks,
        hasDesc: desc.has(name),
        drops: drops.length,
        shops: shopList.length,
        tasks: tasks.length,
        recipes: use.length + make.length,
        mall: mallList.length,
        goods: goodsList.length,
        sources: drops.length + shopList.length + tasks.length + use.length + make.length + mallList.length + goodsList.length,
        issues: rowIssues[i]
      };
    });

    const noSource = items.filter((it) => it.name && it.sources === 0).length;
    const noDesc = items.filter((it) => it.name && !it.hasDesc).length;
    if (noSource) {
      addIssue('item_no_source', 'info',
        `${noSource} 件物品没有任何掉落、商店、任务、合成或商城引用`, { action: { view: 'filter', flag: 'nosource' } });
    }
    if (noDesc) {
      addIssue('item_desc_missing', 'info',
        `${noDesc} 件物品在 itemdesc.txt 中没有描述`, { action: { view: 'filter', flag: 'nodesc' } });
    }
    if (dropInvalid) {
      addIssue('item_drop_invalid_line', 'info',
        `爆率文件中有 ${dropInvalid} 行无法解析，可在怪物工作台或原始爆率编辑器中检查`, {});
    }
    if (dropUnknownMonster) {
      addIssue('item_drop_unknown_monster', 'warn',
        `${dropUnknownMonster} 个爆率文件找不到对应怪物（如 ${unknownDropMonsterSamples.join('、')}${dropUnknownMonster > 5 ? ' …' : ''}）`, {});
    }

    // 引用不存在的物品
    const unknownList = [...unknown.values()].sort((a, b) =>
      a.source.localeCompare(b.source) || a.name.localeCompare(b.name, 'zh-CN'));
    const SOURCE_LABEL = { drop: '爆率', shop: '商店', task: '任务', make: '合成', goods: '商城商品', mall: '商城配置' };
    for (const u of unknownList) {
      const label = SOURCE_LABEL[u.source] || u.source;
      let where = '';
      let action = null;
      if (u.source === 'drop') {
        where = u.detail.file ? `（${u.detail.file}${u.detail.line ? ' 第 ' + u.detail.line + ' 行' : ''}）` : '';
        if (u.detail.monsterKnown) action = { view: 'monster', name: u.detail.monster };
      } else if (u.source === 'shop') {
        where = u.detail.npc ? `（NPC ${u.detail.npc}，${u.detail.file}）` : '';
        action = { view: 'shop', search: u.detail.npc || u.name };
      } else if (u.source === 'task') {
        where = u.detail.taskName ? `（任务 ${u.detail.taskId} ${u.detail.taskName}）` : '';
        if (u.detail.taskId != null) action = { view: 'task', id: u.detail.taskId };
      } else if (u.source === 'make') {
        where = u.detail.recipe ? `（配方 ${u.detail.recipe}）` : '';
        action = { view: 'make' };
      } else if (u.source === 'goods') {
        where = u.detail.goodsId ? `（商品 ${u.detail.goodsId}）` : '';
        action = { view: 'goods' };
      } else if (u.source === 'mall') {
        where = u.detail.mallId ? `（商品 ${u.detail.mallId}）` : '';
        action = { view: 'mall' };
      }
      const alt = byNorm.get(normName(u.name));
      const hint = alt && alt !== u.name ? `（数据库写作「${alt}」）` : '';
      addIssue('item_ref_missing', 'warn',
        `${label}引用了数据库中不存在的物品「${u.name}」${u.count > 1 ? '（' + u.count + ' 处）' : ''}${where}${hint}`,
        { item: u.name, source: u.source, action });
    }

    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) counts[issue.severity]++;
    issues.sort((a, b) => {
      const order = { error: 0, warn: 1, info: 2 };
      return (order[a.severity] - order[b.severity]) ||
        String(a.code).localeCompare(String(b.code)) ||
        String(a.item).localeCompare(String(b.item), 'zh-CN');
    });

    const typeMap = new Map();
    for (const it of items) {
      if (!typeMap.has(it.type)) typeMap.set(it.type, { label: it.type, modes: [], count: 0 });
      const t = typeMap.get(it.type);
      t.count++;
      if (!t.modes.includes(it.stdmode)) t.modes.push(it.stdmode);
    }
    const types = [...typeMap.values()].sort((a, b) => Math.min(...a.modes) - Math.min(...b.modes));

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        items: rows.length,
        types: types.length,
        drops: dropRows,
        dropFiles,
        shops: shopRefs,
        tasks: taskRefs,
        recipes: recipes.length,
        goods: goodsEntries.length,
        mall: mallItems.length,
        descriptions: desc.size,
        noSource,
        unknownRefs: unknownList.length,
        issues: counts
      },
      types,
      items,
      issues,
      _raw: { schema, rows, desc, dropByName, shopByName, taskByName, recipeUse, recipeMake, goodsByName, mallByName }
    };
  }

  function ensure() {
    const sig = signature();
    if (cache && cache.sig === sig) return cache.data;
    const data = build();
    cache = { sig, data };
    return data;
  }

  function publicList() {
    const data = ensure();
    const { _raw, ...rest } = data;
    return rest;
  }

  function findDetail(index, data) {
    data = data || ensure();
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n >= data.items.length) return null;
    const item = data.items[n];
    const raw = data._raw;
    const row = raw.rows[n];
    const name = String(row.Name == null ? '' : row.Name).trim();
    const issues = data.issues.filter((issue) => issue.index === n || (issue.item && issue.item === name));
    return {
      item: {
        index: n,
        idx: row.Idx,
        name: row.Name,
        type: item.type,
        stdmode: row.Stdmode,
        fields: row,
        desc: raw.desc.get(name) || '',
        hasDesc: raw.desc.has(name)
      },
      drops: (raw.dropByName.get(name) || []).slice().sort((a, b) =>
        a.monster.localeCompare(b.monster, 'zh-CN') || a.line - b.line),
      shops: (raw.shopByName.get(name) || []).slice().sort((a, b) =>
        a.npc.localeCompare(b.npc, 'zh-CN') || a.line - b.line),
      tasks: (raw.taskByName.get(name) || []).slice().sort((a, b) => a.id - b.id),
      recipesUse: (raw.recipeUse.get(name) || []).slice(),
      recipesMake: (raw.recipeMake.get(name) || []).slice(),
      goods: (raw.goodsByName.get(name) || []).slice(),
      mall: (raw.mallByName.get(name) || []).slice(),
      issues
    };
  }

  return {
    list() {
      return publicList();
    },
    detail(index) {
      return findDetail(index);
    },
    details(indices) {
      const data = ensure();
      return indices.map((i) => findDetail(i, data));
    },
    summary() {
      try {
        const d = ensure();
        return { items: d.stats.items, drops: d.stats.drops, issues: d.stats.issues };
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

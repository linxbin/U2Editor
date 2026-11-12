'use strict';

const fs = require('fs');
const path = require('path');
const dbe = require('./dbe');
const configs = require('./configs');
const extras = require('./extras');
const mallData = require('./mall');

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function lineNo(line) {
  return Number(line) + 1;
}

function create(options) {
  const dbFile = path.resolve(options.dbFile);
  const makeItemFile = path.resolve(options.makeItemFile);
  const goodsFile = path.resolve(options.goodsFile);
  const mallFile = path.resolve(options.mallFile);
  let cache = null;

  function signature() {
    return [
      'db|' + statSig(dbFile),
      'make|' + statSig(makeItemFile),
      'goods|' + statSig(goodsFile),
      'mall|' + statSig(mallFile)
    ].join(';');
  }

  function build() {
    const generatedAt = Date.now();
    const issues = [];
    const addIssue = (code, severity, message, extra) => {
      const e = extra || {};
      issues.push({
        code,
        severity,
        message,
        source: e.source || '',
        index: e.index == null ? null : e.index,
        name: e.name || '',
        line: e.line == null ? null : e.line,
        action: e.action || null
      });
    };

    const byName = new Map();
    try {
      const db = dbe.loadDb(dbFile);
      for (let i = 0; i < db.rows.length; i++) {
        const name = String(db.rows[i].Name == null ? '' : db.rows[i].Name).trim();
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(i);
      }
    } catch (e) {
      addIssue('shop_items_unreadable', 'warn', `物品数据库读取失败：${e.message}`, null);
    }

    function itemRef(name) {
      const key = String(name == null ? '' : name).trim();
      const rows = byName.get(key) || [];
      return {
        name: key,
        index: rows.length ? rows[0] : null,
        exists: rows.length > 0,
        duplicateCount: rows.length
      };
    }

    let recipes = [];
    let makeLines = [];
    try {
      const parsed = configs.parseMakeItem(makeItemFile);
      recipes = parsed.recipes || [];
      makeLines = parsed.lines || [];
    } catch (e) {
      addIssue('shop_recipe_unreadable', 'warn', `合成配方读取失败：${e.message}`, null);
    }

    let goods = [];
    let goodsSpecial = [];
    try {
      const parsed = extras.parseGoodsConfig(goodsFile);
      goods = parsed.entries || [];
      goodsSpecial = parsed.special || [];
    } catch (e) {
      addIssue('shop_goods_unreadable', 'warn', `UU 商城配置读取失败：${e.message}`, null);
    }

    let mall = { classes: [], subclasses: [], items: [], hotItems: [], special: [] };
    try {
      mall = mallData.parseMall(mallFile);
    } catch (e) {
      addIssue('shop_mall_unreadable', 'warn', `元宝商城配置读取失败：${e.message}`, null);
    }
    const mallItems = mall.items || [];
    const classes = mall.classes || [];
    const subclasses = mall.subclasses || [];
    const hotItems = mall.hotItems || [];
    const mallSpecial = mall.special || [];

    const recipeByName = new Map();
    for (let i = 0; i < recipes.length; i++) {
      const r = recipes[i];
      if (!recipeByName.has(r.name)) recipeByName.set(r.name, []);
      recipeByName.get(r.name).push(i);
    }

    for (const [name, indexes] of recipeByName) {
      if (indexes.length <= 1) continue;
      const first = indexes[0];
      addIssue(
        'shop_recipe_duplicate',
        'warn',
        `配方「${name}」出现 ${indexes.length} 次`,
        { source: 'recipe', index: first, name, line: lineNo(recipes[first].headerLine), action: { view: 'recipe', index: first } }
      );
    }

    const parsedRecipeLines = new Set();
    for (const r of recipes) {
      parsedRecipeLines.add(r.headerLine);
      for (const li of r.itemLines || []) parsedRecipeLines.add(li);
    }

    const producedBy = new Map();
    for (let i = 0; i < recipes.length; i++) {
      const r = recipes[i];
      if (!producedBy.has(r.name)) producedBy.set(r.name, []);
      producedBy.get(r.name).push(i);
    }

    for (let i = 0; i < recipes.length; i++) {
      const r = recipes[i];
      const product = itemRef(r.name);
      if (!product.exists) {
        addIssue(
          'shop_recipe_product_missing',
          'error',
          `配方「${r.name}」的产物在物品库中不存在`,
          { source: 'recipe', index: i, name: r.name, line: lineNo(r.headerLine), action: { view: 'recipe', index: i } }
        );
      }
      const seen = new Set();
      for (const mat of r.items || []) {
        if (seen.has(mat.name)) {
          addIssue(
            'shop_recipe_material_duplicate',
            'warn',
            `配方「${r.name}」重复列出材料「${mat.name}」`,
            { source: 'recipe', index: i, name: r.name, line: lineNo(mat.line), action: { view: 'recipe', index: i } }
          );
        }
        seen.add(mat.name);
        if (!itemRef(mat.name).exists) {
          addIssue(
            'shop_recipe_material_missing',
            'error',
            `配方「${r.name}」的材料「${mat.name}」在物品库中不存在`,
            { source: 'recipe', index: i, name: r.name, line: lineNo(mat.line), action: { view: 'recipe', index: i } }
          );
        }
        if (!Number.isInteger(mat.count) || mat.count < 1) {
          addIssue(
            'shop_recipe_count_invalid',
            'warn',
            `配方「${r.name}」的材料「${mat.name}」数量无效：${mat.count}`,
            { source: 'recipe', index: i, name: r.name, line: lineNo(mat.line), action: { view: 'recipe', index: i } }
          );
        }
      }
      for (let li = r.headerLine + 1; li < (recipes[i + 1] ? recipes[i + 1].headerLine : makeLines.length); li++) {
        if (parsedRecipeLines.has(li)) continue;
        const text = String(makeLines[li] || '').trim();
        if (!text || text.startsWith(';')) continue;
        addIssue(
          'shop_recipe_unparsed',
          'info',
          `配方「${r.name}」有无法解析的行：第 ${lineNo(li)} 行`,
          { source: 'recipe', index: i, name: r.name, line: lineNo(li), action: { view: 'recipe', index: i } }
        );
      }
    }

    const cycleKeys = new Set();
    const visiting = new Set();
    const visited = new Set();
    function walk(name, stack) {
      if (visiting.has(name)) {
        const at = stack.indexOf(name);
        const cycle = stack.slice(at >= 0 ? at : 0).concat(name);
        const key = [...new Set(cycle)].sort().join('|');
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          const indexes = cycle.map((n) => producedBy.get(n)[0]).filter((n) => n != null);
          const first = indexes.length ? indexes[0] : recipes.length;
          addIssue(
            'shop_recipe_cycle',
            'error',
            `配方材料存在循环：${cycle.join(' → ')}`,
            { source: 'recipe', index: first, name, line: first < recipes.length ? lineNo(recipes[first].headerLine) : null, action: first < recipes.length ? { view: 'recipe', index: first } : null }
          );
        }
        return;
      }
      if (visited.has(name)) return;
      const owners = producedBy.get(name);
      if (!owners) return;
      visiting.add(name);
      for (const ri of owners) {
        for (const mat of recipes[ri].items || []) {
          if (producedBy.has(mat.name)) walk(mat.name, stack.concat(name));
        }
      }
      visiting.delete(name);
      visited.add(name);
    }
    for (const name of producedBy.keys()) walk(name, []);

    const goodsKeyMap = new Map();
    for (let i = 0; i < goods.length; i++) {
      const g = goods[i];
      const key = g.version ? `${g.id}-${g.version}` : g.id;
      if (!goodsKeyMap.has(key)) goodsKeyMap.set(key, []);
      goodsKeyMap.get(key).push(i);
      const item = itemRef(g.name);
      if (!item.exists) {
        addIssue(
          'shop_goods_item_missing',
          'error',
          `UU 商品「${g.name}」在物品库中不存在`,
          { source: 'goods', index: i, name: g.name, line: lineNo(g.line), action: { view: 'goods', index: i } }
        );
      }
      if (!/^20\d{6}$/.test(g.version)) {
        addIssue(
          'shop_goods_version_invalid',
          'warn',
          `UU 商品「${g.name}」的版本号「${g.version}」不是 8 位日期`,
          { source: 'goods', index: i, name: g.name, line: lineNo(g.line), action: { view: 'goods', index: i } }
        );
      }
    }
    for (const [key, indexes] of goodsKeyMap) {
      if (indexes.length <= 1) continue;
      const first = indexes[0];
      addIssue(
        'shop_goods_duplicate_key',
        'warn',
        `UU 商品键「${key}」重复 ${indexes.length} 次`,
        { source: 'goods', index: first, name: goods[first].name, line: lineNo(goods[first].line), action: { view: 'goods', index: first } }
      );
    }
    for (const sp of goodsSpecial) {
      addIssue(
        'shop_goods_unparsed',
        'info',
        `UU 商城有无法解析的内容：第 ${lineNo(sp.line)} 行`,
        { source: 'goods', line: lineNo(sp.line) }
      );
    }
    for (const sp of mallSpecial) {
      addIssue(
        'shop_mall_unparsed',
        'info',
        `元宝商城有无法解析的内容：第 ${lineNo(sp.line)} 行（${sp.reason || '未知原因'}）`,
        { source: 'mall', line: lineNo(sp.line) }
      );
    }

    const mallById = new Map();
    const mallByName = new Map();
    const goodsNameSet = new Set(goods.map((g) => g.name));
    for (let i = 0; i < mallItems.length; i++) {
      const it = mallItems[i];
      const v = it.values || {};
      const item = itemRef(v.name);
      if (!item.exists) {
        addIssue(
          'shop_mall_item_missing',
          'error',
          `元宝商品「${v.dispname || v.name}」的物品「${v.name}」在物品库中不存在`,
          { source: 'mall', index: i, name: v.name, line: lineNo(it.line), action: { view: 'mall', index: i } }
        );
      }
      if (!(Number(v.price) > 0)) {
        addIssue(
          'shop_mall_price_invalid',
          'warn',
          `元宝商品「${v.dispname || v.name}」的价格无效：${v.price}`,
          { source: 'mall', index: i, name: v.name, line: lineNo(it.line), action: { view: 'mall', index: i } }
        );
      }
      if (!(Number(v.unitnum) >= 1)) {
        addIssue(
          'shop_mall_unit_invalid',
          'warn',
          `元宝商品「${v.dispname || v.name}」的单位数量无效：${v.unitnum}`,
          { source: 'mall', index: i, name: v.name, line: lineNo(it.line), action: { view: 'mall', index: i } }
        );
      }
      if (!mallById.has(v.id)) mallById.set(v.id, []);
      mallById.get(v.id).push(i);
      if (!mallByName.has(v.name)) mallByName.set(v.name, []);
      mallByName.get(v.name).push(i);
    }

    for (const [id, indexes] of mallById) {
      if (indexes.length <= 1) continue;
      const first = indexes[0];
      const sameSub = indexes.every((i) =>
        mallItems[i].classIndex === mallItems[first].classIndex &&
        mallItems[i].subIndex === mallItems[first].subIndex
      );
      const places = indexes.map((i) => {
        const it = mallItems[i];
        return `${it.classType || it.classId}/${it.subType || it.subId}`;
      });
      addIssue(
        'shop_mall_id_duplicate',
        sameSub ? 'warn' : 'info',
        `元宝商品 ID「${id}」出现 ${indexes.length} 次：${places.join('、')}`,
        { source: 'mall', index: first, name: mallItems[first].values.name, line: lineNo(mallItems[first].line), action: { view: 'mall', index: first } }
      );
    }

    const subCount = new Map();
    for (const it of mallItems) subCount.set(it.subIndex, (subCount.get(it.subIndex) || 0) + 1);
    for (const sub of subclasses) {
      if (subCount.get(sub.index)) continue;
      const cls = classes[sub.classIndex];
      addIssue(
        'shop_mall_empty_sub',
        'info',
        `元宝商城子类「${cls ? cls.type + ' / ' : ''}${sub.type || sub.id}」没有任何商品`,
        { source: 'mall', name: sub.type || sub.id, line: lineNo(sub.line) }
      );
    }

    const mallFullIds = new Set(mallItems.map((it) => `${it.classId}${it.subId}${it.values.id}`));
    const hotByIndex = new Map();
    for (let i = 0; i < hotItems.length; i++) {
      const h = hotItems[i];
      const v = h.values || {};
      const matched = mallFullIds.has(v.id);
      hotByIndex.set(i, matched);
      if (!matched) {
        addIssue(
          'shop_mall_hot_missing',
          'warn',
          `热卖商品「${v.dispname || v.id}」在商城目录中不存在`,
          { source: 'mall', name: v.dispname || v.id, line: lineNo(h.line) }
        );
        continue;
      }
      const target = mallItems.find((it) => `${it.classId}${it.subId}${it.values.id}` === v.id);
      if (target && (String(target.values.dispname) !== String(v.dispname) || Number(target.values.price) !== Number(v.price))) {
        addIssue(
          'shop_mall_hot_mismatch',
          'warn',
          `热卖商品「${v.dispname}」与目录中的名称或价格不一致`,
          { source: 'mall', index: target.index, name: target.values.name, line: lineNo(h.line), action: { view: 'mall', index: target.index } }
        );
      }
    }

    function issueCount(source, index) {
      let n = 0;
      for (const issue of issues) {
        if (issue.source === source && issue.index === index) n++;
      }
      return n;
    }

    const recipeList = recipes.map((r, i) => {
      const materials = r.items || [];
      return {
        index: i,
        name: r.name,
        line: lineNo(r.headerLine),
        product: itemRef(r.name),
        materialCount: materials.length,
        materialTotal: materials.reduce((n, it) => n + (Number(it.count) || 0), 0),
        missingMaterials: materials.filter((it) => !itemRef(it.name).exists).map((it) => it.name),
        materials: materials.map((it) => ({
          name: it.name,
          count: it.count,
          line: lineNo(it.line),
          item: itemRef(it.name),
          producedBy: (producedBy.get(it.name) || []).map((ri) => ({ index: ri, name: recipes[ri].name }))
        })),
        issueCount: issueCount('recipe', i)
      };
    });

    const goodsList = goods.map((g, i) => ({
      index: i,
      id: g.id,
      version: g.version,
      name: g.name,
      line: lineNo(g.line),
      item: itemRef(g.name),
      mallCount: (mallByName.get(g.name) || []).length,
      versionOk: /^20\d{6}$/.test(g.version),
      issueCount: issueCount('goods', i)
    }));

    const hotIds = new Set(hotItems.map((h) => h.values.id));
    const mallList = mallItems.map((it, i) => {
      const v = it.values || {};
      return {
        index: i,
        id: v.id,
        dispname: v.dispname,
        name: v.name,
        price: v.price,
        unitnum: v.unitnum,
        classId: it.classId,
        classType: it.classType,
        subId: it.subId,
        subType: it.subType,
        line: lineNo(it.line),
        item: itemRef(v.name),
        hot: hotIds.has(`${it.classId}${it.subId}${v.id}`),
        duplicateId: (mallById.get(v.id) || []).length > 1,
        goodsCount: goodsNameSet.has(v.name) ? 1 : 0,
        issueCount: issueCount('mall', i)
      };
    });

    const classList = classes.map((c) => ({
      index: c.index,
      id: c.id,
      type: c.type,
      line: lineNo(c.line),
      count: mallItems.filter((it) => it.classIndex === c.index).length,
      subs: subclasses.filter((s) => s.classIndex === c.index).map((s) => ({
        index: s.index,
        id: s.id,
        type: s.type,
        line: lineNo(s.line),
        count: subCount.get(s.index) || 0
      }))
    }));

    const hotList = hotItems.map((h, i) => ({
      index: i,
      id: h.values.id,
      dispname: h.values.dispname,
      price: h.values.price,
      line: lineNo(h.line),
      matched: !!hotByIndex.get(i)
    }));

    const sev = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) if (sev[issue.severity] != null) sev[issue.severity]++;

    const materialNames = new Set();
    for (const r of recipes) for (const it of r.items || []) materialNames.add(it.name);
    const mallNames = new Set(mallList.map((it) => it.name));
    const overlap = [...mallNames].filter((name) => goodsNameSet.has(name)).length;

    const stats = {
      recipes: recipes.length,
      recipeMaterials: materialNames.size,
      recipeMaterialTotal: recipes.reduce((n, r) => n + (r.items || []).length, 0),
      goods: goods.length,
      goodsKnown: goodsList.filter((g) => g.item.exists).length,
      mall: mallItems.length,
      mallKnown: mallList.filter((it) => it.item.exists).length,
      classes: classes.length,
      subclasses: subclasses.length,
      hot: hotItems.length,
      goodsMallOverlap: overlap,
      issues: sev
    };

    return {
      generatedAt,
      stats,
      recipes: recipeList,
      goods: goodsList,
      mall: mallList,
      classes: classList,
      hot: hotList,
      issues
    };
  }

  function get() {
    const sig = signature();
    if (!cache || cache.sig !== sig) {
      const data = build();
      data.sig = sig;
      cache = data;
    }
    return cache;
  }

  function list() {
    const d = get();
    return {
      generatedAt: d.generatedAt,
      stats: d.stats,
      recipes: d.recipes,
      goods: d.goods,
      mall: d.mall,
      classes: d.classes,
      hot: d.hot,
      issues: d.issues
    };
  }

  function summary() {
    const d = get();
    return { generatedAt: d.generatedAt, stats: d.stats };
  }

  function detail(type, index) {
    const d = get();
    const i = Number(index);
    if (!Number.isInteger(i)) return null;
    if (type === 'recipe') {
      const row = d.recipes[i];
      if (!row) return null;
      return {
        generatedAt: d.generatedAt,
        type,
        index: i,
        recipe: row,
        usedAsMaterial: d.recipes
          .filter((r) => r.materials.some((it) => it.name === row.name))
          .map((r) => ({ index: r.index, name: r.name })),
        issues: d.issues.filter((issue) => issue.source === 'recipe' && issue.index === i)
      };
    }
    if (type === 'goods') {
      const row = d.goods[i];
      if (!row) return null;
      const parsed = extras.parseGoodsConfig(goodsFile).entries[i];
      const mallMatches = d.mall.filter((it) => it.name === parsed.name);
      return {
        generatedAt: d.generatedAt,
        type,
        index: i,
        goods: { ...row, ...parsed, line: lineNo(parsed.line) },
        mallMatches,
        issues: d.issues.filter((issue) => issue.source === 'goods' && issue.index === i)
      };
    }
    if (type === 'mall') {
      const row = d.mall[i];
      if (!row) return null;
      const parsed = mallData.parseMall(mallFile).items[i];
      const v = parsed.values || {};
      const fullId = `${parsed.classId}${parsed.subId}${v.id}`;
      const sameId = d.mall.filter((it) => it.index !== i && it.id === v.id);
      const sameName = d.mall.filter((it) => it.index !== i && it.name === v.name);
      const goodsMatches = d.goods.filter((g) => g.name === v.name);
      const hot = d.hot.find((h) => h.id === fullId) || null;
      return {
        generatedAt: d.generatedAt,
        type,
        index: i,
        item: {
          ...row,
          type: v.type,
          looks: v.looks,
          biglooks: v.biglooks,
          desc: v.desc,
          classIndex: parsed.classIndex,
          subIndex: parsed.subIndex
        },
        sameId,
        sameName,
        goodsMatches,
        hot,
        issues: d.issues.filter((issue) => issue.source === 'mall' && issue.index === i)
      };
    }
    return null;
  }

  function invalidate() {
    cache = null;
  }

  return { list, summary, detail, invalidate };
}

module.exports = { create };

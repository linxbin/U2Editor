'use strict';

function pyStr(value) {
  return "'" + String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n') + "'";
}

function header(title, note, extraImports) {
  const lines = ['# 由 DB Editor「新建 NPC」向导生成', '# 模板：' + title];
  if (note) lines.push('# ' + note);
  lines.push('', 'import user');
  for (const name of extraImports || []) lines.push('import ' + name);
  lines.push('', "NL = '\\\\'");
  return lines;
}

function purchase(cfg) {
  const goods = cfg.goods || [];
  const lines = header('金币购买', '价格由本脚本控制，不读取 stditems.db 的售价');
  lines.push('NPC_TITLE = ' + pyStr(cfg.name));
  lines.push('MIN_LEVEL = ' + cfg.minLevel);
  lines.push('MAX_QTY = ' + cfg.maxQty);
  lines.push('GOODS = [');
  for (const good of goods) {
    lines.push('    (' + pyStr(good.item) + ', ' + good.price + '),');
  }
  lines.push(']');
  lines.push('', '');
  lines.push('def initialize(npc):', '    pass');
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '欢迎光临，' + NPC_TITLE + '。' + NL");
  if (cfg.minLevel > 0) {
    lines.push("    if user.getPlayerAttribute(player, 'Level') < MIN_LEVEL:");
    lines.push("        user.tell(player, npc, msg + '需要等级 ' + str(MIN_LEVEL) + ' 才能购买。' + NL + '<离开/@exit>')");
    lines.push('        return');
  }
  goods.forEach((good, i) => {
    const n = i + 1;
    lines.push('    msg += ' + pyStr('<' + good.item + '  ' + good.price + ' 金币/@buy' + n + '>') + ' + NL');
    if (cfg.maxQty > 1) {
      const total = good.price * cfg.maxQty;
      lines.push('    msg += ' + pyStr('<' + good.item + ' x' + cfg.maxQty + '  ' + total + ' 金币/@buy' + n + 'n>') + ' + NL');
    }
  });
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def buyitem(player, npc, index, qty, total):');
  lines.push('    item = GOODS[index][0]');
  if (cfg.minLevel > 0) {
    lines.push("    if user.getPlayerAttribute(player, 'Level') < MIN_LEVEL:");
    lines.push("        user.tell(player, npc, '需要等级 ' + str(MIN_LEVEL) + ' 才能购买。' + NL + '<返回/@main>')");
    lines.push('        return');
  }
  lines.push("    if total > 0 and user.getPlayerAttribute(player, 'Gold') < total:");
  lines.push("        user.tell(player, npc, '金币不足，需要 ' + str(total) + ' 金币。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if user.getSpaceInBag(player) < qty:');
  lines.push("        user.tell(player, npc, '背包空间不足，需要 ' + str(qty) + ' 个空位。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if total > 0:');
  lines.push("        user.takeItemFromPlayer(player, '金币', total)");
  lines.push('    user.giveItemToPlayer(player, item, qty)');
  lines.push("    user.tell(player, npc, '购买成功：' + item + ' x' + str(qty) + '，花费 ' + str(total) + ' 金币。' + NL + '<继续购买/@main>' + NL + '<离开/@exit>')");
  lines.push('', '');
  goods.forEach((good, i) => {
    const n = i + 1;
    lines.push('def buy' + n + '(player, npc):');
    lines.push('    buyitem(player, npc, ' + i + ', 1, ' + good.price + ')');
    lines.push('', '');
    if (cfg.maxQty > 1) {
      lines.push('def buy' + n + 'n(player, npc):');
      lines.push('    buyitem(player, npc, ' + i + ', MAX_QTY, ' + (good.price * cfg.maxQty) + ')');
      lines.push('', '');
    }
  });
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function teleport(cfg) {
  const lines = header('收费传送');
  lines.push('TARGET_MAP = ' + pyStr(cfg.target));
  lines.push('TARGET_X = ' + cfg.x);
  lines.push('TARGET_Y = ' + cfg.y);
  lines.push('TARGET_NAME = ' + pyStr(cfg.targetName));
  lines.push('PRICE = ' + cfg.price);
  lines.push('MIN_LEVEL = ' + cfg.minLevel);
  lines.push('', '');
  lines.push('def initialize(npc):', '    pass');
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '我可以送你去 ' + TARGET_NAME + ' (' + TARGET_MAP + ' ' + str(TARGET_X) + ', ' + str(TARGET_Y) + ')。' + NL");
  lines.push('    if PRICE > 0:');
  lines.push("        msg += '费用 ' + str(PRICE) + ' 金币。' + NL");
  lines.push("    msg += '<出发/@go>' + NL");
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def go(player, npc):');
  if (cfg.minLevel > 0) {
    lines.push("    if user.getPlayerAttribute(player, 'Level') < MIN_LEVEL:");
    lines.push("        user.tell(player, npc, '需要等级 ' + str(MIN_LEVEL) + ' 才能传送。' + NL + '<返回/@main>')");
    lines.push('        return');
  }
  if (cfg.price > 0) {
    lines.push("    if user.getPlayerAttribute(player, 'Gold') < PRICE:");
    lines.push("        user.tell(player, npc, '金币不足，需要 ' + str(PRICE) + ' 金币。' + NL + '<返回/@main>')");
    lines.push('        return');
    lines.push("    user.takeItemFromPlayer(player, '金币', PRICE)");
  }
  lines.push('    user.playerMapMove(player, TARGET_MAP, TARGET_X, TARGET_Y)');
  lines.push('    user.closeDialog(player, npc)');
  lines.push('', '');
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function shop(cfg) {
  const lines = header('标准商店', '货品价格取自 stditems.db，允许交易类型由货品 Stdmode 自动推导');
  lines.push('NPC_TITLE = ' + pyStr(cfg.name));
  lines.push('SELL_PERCENT = ' + cfg.sellPercent);
  lines.push('BUY_PERCENT = ' + cfg.buyPercent);
  lines.push('', '');
  lines.push('def initialize(npc):');
  lines.push('    user.setSellGoodsPercent(npc, SELL_PERCENT)');
  lines.push('    user.setBuyGoodsPercent(npc, BUY_PERCENT)');
  for (const mode of cfg.modes) {
    lines.push('    user.addAllowedModes(npc, ' + mode + ')');
  }
  for (const good of cfg.goods) {
    lines.push('    user.addGoods(npc, ' + pyStr(good.item) + ", '" + good.count + "', '" + good.time + "')");
  }
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '欢迎光临，' + NPC_TITLE + '。' + NL");
  lines.push("    msg += '<购买物品/@buy>' + NL");
  lines.push("    msg += '<出售物品/@sell>' + NL");
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def buy(player, npc):');
  lines.push('    user.buy(player, npc)');
  lines.push('', '');
  lines.push('def sell(player, npc):');
  lines.push('    user.sell(player, npc)');
  lines.push('', '');
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function warehouse() {
  const lines = header('仓库保管');
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '这里可以保管和取回物品。' + NL");
  lines.push("    msg += '<存取物品/@storage>' + NL");
  lines.push("    msg += '<取回物品/@getback>' + NL");
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def storage(player, npc):');
  lines.push('    user.storage(player, npc)');
  lines.push('', '');
  lines.push('def getback(player, npc):');
  lines.push('    if not user.checkStoreInterval(player, 135):');
  lines.push("        user.tell(player, npc, '为了仓库安全，请下线 2 分钟后再来取回。' + NL + '<离开/@exit>')");
  lines.push('        return');
  lines.push('    if user.checkStoreEKeyBinded(player) and not user.checkStoreEKeyValid(player):');
  lines.push('        user.closeDialog(player, npc)');
  lines.push('        user.playerValidEKey(player)');
  lines.push('        return');
  lines.push('    user.getBack(player, npc)');
  lines.push('', '');
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function repair(cfg) {
  const lines = header('装备修理', '修理费用由引擎按装备耐久自动计算');
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '需要修理装备吗？' + NL");
  if (cfg.normal) lines.push("    msg += '<普通修理/@repair>' + NL");
  if (cfg.special) lines.push("    msg += '<特修装备/@s_repair>' + NL");
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  if (cfg.normal) {
    lines.push('def repair(player, npc):');
    lines.push('    user.repair(player, npc, 0)');
    lines.push('', '');
  }
  if (cfg.special) {
    lines.push('def s_repair(player, npc):');
    lines.push('    user.repair(player, npc, 1)');
    lines.push('', '');
  }
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function recycle(cfg) {
  const lines = header('物品回收', '回收价格由本模板固定，与 stditems.db 售价无关');
  lines.push('RECYCLE_ITEMS = [');
  for (const good of cfg.goods) {
    lines.push('    (' + pyStr(good.item) + ', ' + good.price + '),');
  }
  lines.push(']');
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '我可以回收这些物品：' + NL");
  cfg.goods.forEach((good, i) => {
    lines.push('    msg += ' + pyStr('<' + good.item + '  ' + good.price + ' 金币/@sell' + (i + 1) + '>') + ' + NL');
  });
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def recycleitem(player, npc, index):');
  lines.push('    item = RECYCLE_ITEMS[index][0]');
  lines.push('    price = RECYCLE_ITEMS[index][1]');
  lines.push('    if not user.checkPlayerItems(player, item, 1):');
  lines.push("        user.tell(player, npc, '背包里没有 ' + item + '。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    user.takeItemFromPlayer(player, item, 1)');
  lines.push("    user.giveItemToPlayer(player, '金币', price)");
  lines.push("    user.tell(player, npc, '回收成功：' + item + '，获得 ' + str(price) + ' 金币。' + NL + '<继续回收/@main>' + NL + '<离开/@exit>')");
  lines.push('', '');
  cfg.goods.forEach((good, i) => {
    lines.push('def sell' + (i + 1) + '(player, npc):');
    lines.push('    recycleitem(player, npc, ' + i + ')');
    lines.push('', '');
  });
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function skill(cfg) {
  const lines = header('技能学习', '技能名称必须与 magic.db 中的技能名一致');
  lines.push('SKILL_NAME = ' + pyStr(cfg.name));
  lines.push('SKILL_JOB = ' + cfg.job);
  lines.push('NEED_LEVEL = ' + cfg.needLevel);
  lines.push('PRICE = ' + cfg.price);
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '我可以教你「' + SKILL_NAME + '」。' + NL");
  lines.push('    if PRICE > 0:');
  lines.push("        msg += '学费 ' + str(PRICE) + ' 金币。' + NL");
  lines.push("    msg += '<学习技能/@learn>' + NL");
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def learn(player, npc):');
  lines.push('    if NEED_LEVEL > 0 and user.getPlayerAttribute(player, \'Level\') < NEED_LEVEL:');
  lines.push("        user.tell(player, npc, '需要等级 ' + str(NEED_LEVEL) + ' 才能学习。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if SKILL_JOB >= 0 and user.getPlayerAttribute(player, \'Job\') != SKILL_JOB:');
  lines.push("        user.tell(player, npc, '该技能不适合你的职业。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if PRICE > 0 and user.getPlayerAttribute(player, \'Gold\') < PRICE:');
  lines.push("        user.tell(player, npc, '金币不足，需要 ' + str(PRICE) + ' 金币。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if PRICE > 0:');
  lines.push("        user.takeItemFromPlayer(player, '金币', PRICE)");
  lines.push('    user.learnSkill(player, SKILL_NAME)');
  lines.push("    user.sendSysMessage(player, '学会了 ' + SKILL_NAME + '。')");
  lines.push('    user.closeDialog(player, npc)');
  lines.push('', '');
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function teleportList(cfg) {
  const lines = header('多目标传送');
  lines.push('DESTINATIONS = [');
  for (const dest of cfg.destinations) {
    lines.push('    (' + pyStr(dest.name) + ', ' + pyStr(dest.map) + ', ' + dest.x + ', ' + dest.y + ', ' + dest.price + ', ' + dest.minLevel + '),');
  }
  lines.push(']');
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '我可以送你去这些地方：' + NL");
  cfg.destinations.forEach((dest, i) => {
    const label = dest.name + ' (' + dest.map + ' ' + dest.x + ', ' + dest.y + ')' +
      (dest.price > 0 ? '  ' + dest.price + ' 金币' : '');
    lines.push('    msg += ' + pyStr('<' + label + '/@go' + (i + 1) + '>') + ' + NL');
  });
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def goitem(player, npc, index):');
  lines.push('    name = DESTINATIONS[index][0]');
  lines.push('    mapCode = DESTINATIONS[index][1]');
  lines.push('    x = DESTINATIONS[index][2]');
  lines.push('    y = DESTINATIONS[index][3]');
  lines.push('    price = DESTINATIONS[index][4]');
  lines.push('    minLevel = DESTINATIONS[index][5]');
  lines.push('    if minLevel > 0 and user.getPlayerAttribute(player, \'Level\') < minLevel:');
  lines.push("        user.tell(player, npc, '需要等级 ' + str(minLevel) + ' 才能前往 ' + name + '。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if price > 0 and user.getPlayerAttribute(player, \'Gold\') < price:');
  lines.push("        user.tell(player, npc, '金币不足，需要 ' + str(price) + ' 金币。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if price > 0:');
  lines.push("        user.takeItemFromPlayer(player, '金币', price)");
  lines.push('    user.playerMapMove(player, mapCode, x, y)');
  lines.push('    user.closeDialog(player, npc)');
  lines.push('', '');
  cfg.destinations.forEach((dest, i) => {
    lines.push('def go' + (i + 1) + '(player, npc):');
    lines.push('    goitem(player, npc, ' + i + ')');
    lines.push('', '');
  });
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function daily(cfg) {
  const lines = header('每日/限时福利', '每日领取次数由引擎 canUndertakeDailyTask / recordDailyTask 记录，时间窗口使用服务器小时');
  lines.push('DAILY_TYPE = ' + cfg.dailyType);
  lines.push('MIN_LEVEL = ' + cfg.minLevel);
  lines.push('START_HOUR = ' + cfg.startHour);
  lines.push('END_HOUR = ' + cfg.endHour);
  lines.push('GOLD = ' + cfg.gold);
  lines.push('EXP = ' + cfg.exp);
  lines.push('REWARDS = [');
  for (const reward of cfg.rewards) {
    lines.push('    (' + pyStr(reward.item) + ', ' + reward.count + '),');
  }
  lines.push(']');
  lines.push('', '');
  lines.push('def initialize(npc):', '    pass');
  lines.push('', '');
  lines.push('def timeopen():');
  lines.push('    if START_HOUR == 0 and END_HOUR == 0:');
  lines.push('        return True');
  lines.push("    hour = user.getTime('hour')");
  lines.push('    if START_HOUR < END_HOUR:');
  lines.push('        return START_HOUR <= hour and hour < END_HOUR');
  lines.push('    return hour >= START_HOUR or hour < END_HOUR');
  lines.push('', '');
  lines.push('def rewardtext():');
  lines.push('    parts = []');
  lines.push('    if GOLD > 0:');
  lines.push("        parts.append(str(GOLD) + ' 金币')");
  lines.push('    if EXP > 0:');
  lines.push("        parts.append(str(EXP) + ' 经验')");
  lines.push('    for (item, count) in REWARDS:');
  lines.push("        parts.append(item + ' x' + str(count))");
  lines.push("    return '、'.join(parts)");
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '今天的福利：' + rewardtext() + '。' + NL");
  if (cfg.minLevel > 0) {
    lines.push("    if user.getPlayerAttribute(player, 'Level') < MIN_LEVEL:");
    lines.push("        user.tell(player, npc, msg + '需要等级 ' + str(MIN_LEVEL) + ' 才能领取。' + NL + '<离开/@exit>')");
    lines.push('        return');
  }
  if (cfg.startHour !== 0 || cfg.endHour !== 0) {
    lines.push("    msg += '开放时间：' + str(START_HOUR) + ':00 - ' + str(END_HOUR) + ':00。' + NL");
  }
  lines.push('    if not user.canUndertakeDailyTask(player, DAILY_TYPE):');
  lines.push("        user.tell(player, npc, msg + '今天已经领取过了，明天再来吧。' + NL + '<离开/@exit>')");
  lines.push('        return');
  lines.push('    if not timeopen():');
  lines.push("        user.tell(player, npc, msg + '现在不在领取时间内。' + NL + '<离开/@exit>')");
  lines.push('        return');
  lines.push("    msg += '<领取福利/@claim>' + NL");
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def claim(player, npc):');
  if (cfg.minLevel > 0) {
    lines.push("    if user.getPlayerAttribute(player, 'Level') < MIN_LEVEL:");
    lines.push("        user.tell(player, npc, '需要等级 ' + str(MIN_LEVEL) + ' 才能领取。' + NL + '<返回/@main>')");
    lines.push('        return');
  }
  lines.push('    if not timeopen():');
  lines.push("        user.tell(player, npc, '现在不在领取时间内。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if not user.canUndertakeDailyTask(player, DAILY_TYPE):');
  lines.push("        user.tell(player, npc, '今天已经领取过了，明天再来吧。' + NL + '<返回/@main>')");
  lines.push('        return');
  if (cfg.rewards.length) {
    lines.push('    if user.getSpaceInBag(player) < ' + cfg.rewards.length + ':');
    lines.push("        user.tell(player, npc, '背包空间不足，需要 " + cfg.rewards.length + " 个空位。' + NL + '<返回/@main>')");
    lines.push('        return');
  }
  if (cfg.gold > 0) {
    lines.push("    user.giveItemToPlayer(player, '金币', GOLD)");
  }
  if (cfg.exp > 0) {
    lines.push('    user.addExp(player, EXP)');
  }
  for (const reward of cfg.rewards) {
    lines.push('    user.giveItemToPlayer(player, ' + pyStr(reward.item) + ', ' + reward.count + ')');
  }
  lines.push('    user.recordDailyTask(player, DAILY_TYPE)');
  lines.push("    user.tell(player, npc, '领取成功：' + rewardtext() + '。' + NL + '<离开/@exit>')");
  lines.push('', '');
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

function craft(cfg) {
  const lines = header('物品合成', '每个配方先校验材料与金币，再按成功率判定；金币在判定前扣除', ['random']);
  lines.push('RECIPES = [');
  for (const recipe of cfg.recipes) {
    lines.push('    {');
    lines.push("        'name': " + pyStr(recipe.name) + ',');
    lines.push("        'materials': [");
    for (const material of recipe.materials) {
      lines.push('            (' + pyStr(material.item) + ', ' + material.count + '),');
    }
    lines.push('        ],');
    lines.push("        'gold': " + recipe.gold + ',');
    lines.push("        'output': " + pyStr(recipe.output) + ',');
    lines.push("        'count': " + recipe.count + ',');
    lines.push("        'rate': " + recipe.rate + ',');
    lines.push("        'refund': " + (recipe.refund ? 'True' : 'False'));
    lines.push('    },');
  }
  lines.push(']');
  lines.push('', '');
  lines.push('def initialize(npc):', '    pass');
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push("    msg = '我可以帮你合成以下物品：' + NL");
  cfg.recipes.forEach((recipe, i) => {
    lines.push('    msg += ' + pyStr('<' + recipe.name + '/@craft' + (i + 1) + '>') + ' + NL');
  });
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  lines.push('', '');
  lines.push('def craftitem(player, npc, index):');
  lines.push('    recipe = RECIPES[index]');
  lines.push("    for (item, count) in recipe['materials']:");
  lines.push('        if not user.checkPlayerItems(player, item, count):');
  lines.push("            user.tell(player, npc, '缺少材料：' + item + ' x' + str(count) + '。' + NL + '<返回/@main>')");
  lines.push('            return');
  lines.push("    if recipe['gold'] > 0 and user.getPlayerAttribute(player, 'Gold') < recipe['gold']:");
  lines.push("        user.tell(player, npc, '金币不足，需要 ' + str(recipe['gold']) + ' 金币。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push('    if user.getSpaceInBag(player) < 1:');
  lines.push("        user.tell(player, npc, '背包空间不足，至少需要 1 个空位。' + NL + '<返回/@main>')");
  lines.push('        return');
  lines.push("    for (item, count) in recipe['materials']:");
  lines.push('        user.takeItemFromPlayer(player, item, count)');
  lines.push("    if recipe['gold'] > 0:");
  lines.push("        user.takeItemFromPlayer(player, '金币', recipe['gold'])");
  lines.push("    if random.randint(1, 100) <= recipe['rate']:");
  lines.push("        user.giveItemToPlayer(player, recipe['output'], recipe['count'])");
  lines.push("        user.tell(player, npc, '合成成功：获得 ' + recipe['output'] + ' x' + str(recipe['count']) + '。' + NL + '<继续合成/@main>' + NL + '<离开/@exit>')");
  lines.push("    elif recipe['refund']:");
  lines.push("        for (item, count) in recipe['materials']:");
  lines.push('            user.giveItemToPlayer(player, item, count)');
  lines.push("        user.tell(player, npc, '合成失败，材料已返还，金币不返还。' + NL + '<继续合成/@main>' + NL + '<离开/@exit>')");
  lines.push('    else:');
  lines.push("        user.tell(player, npc, '合成失败，材料和金币都没有了。' + NL + '<继续合成/@main>' + NL + '<离开/@exit>')");
  lines.push('', '');
  cfg.recipes.forEach((recipe, i) => {
    lines.push('def craft' + (i + 1) + '(player, npc):');
    lines.push('    craftitem(player, npc, ' + i + ')');
    lines.push('', '');
  });
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

const MODULE_LABELS = {
  purchase: '金币购买',
  shop: '标准商店',
  warehouse: '仓库保管',
  repair: '装备修理',
  recycle: '物品回收',
  skill: '技能学习',
  daily: '每日/限时福利',
  craft: '物品合成',
  teleport: '收费传送',
  teleportlist: '多目标传送'
};

const MODULE_CONSTS = {
  purchase: ['NPC_TITLE', 'MIN_LEVEL', 'MAX_QTY', 'GOODS'],
  teleport: ['TARGET_MAP', 'TARGET_X', 'TARGET_Y', 'TARGET_NAME', 'PRICE', 'MIN_LEVEL'],
  shop: ['NPC_TITLE', 'SELL_PERCENT', 'BUY_PERCENT'],
  recycle: ['RECYCLE_ITEMS'],
  skill: ['SKILL_NAME', 'SKILL_JOB', 'NEED_LEVEL', 'PRICE'],
  teleportlist: ['DESTINATIONS'],
  daily: ['DAILY_TYPE', 'MIN_LEVEL', 'START_HOUR', 'END_HOUR', 'GOLD', 'EXP', 'REWARDS'],
  craft: ['RECIPES']
};

function trimBlank(lines) {
  const copy = lines.slice();
  while (copy.length && copy[0].trim() === '') copy.shift();
  while (copy.length && copy[copy.length - 1].trim() === '') copy.pop();
  return copy;
}

function splitModule(key, script) {
  const all = String(script).replace(/\r\n/g, '\n').split('\n');
  let start = all.findIndex((line) => /^NL = /.test(line));
  start = start < 0 ? 0 : start + 1;
  let text = all.slice(start).join('\n');
  for (const name of MODULE_CONSTS[key] || []) {
    text = text.replace(new RegExp('\\b' + name + '\\b', 'g'), key + '_' + name);
  }
  text = text.replace(/def main\(/g, 'def ' + key + '_main(');
  text = text.replace(/@main\b/g, '@' + key + '_main');

  const sections = [];
  let current = { name: '', lines: [] };
  for (const line of text.split('\n')) {
    const match = /^def ([A-Za-z_][A-Za-z0-9_]*)\(/.exec(line);
    if (match) {
      sections.push(current);
      current = { name: match[1], lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  for (const section of sections) {
    if (section.name !== key + '_main') continue;
    section.lines = section.lines.map((line) =>
      line === "    msg += '<离开/@exit>'" ? "    msg += '<返回主菜单/@main>' + NL" : line);
  }
  return sections;
}

function compose(cfg) {
  const modules = cfg.modules || [];
  if (!modules.length) throw new Error('综合 NPC 至少需要一个功能模块');
  const imports = modules.some((mod) => mod.key === 'craft') ? ['random'] : [];
  const labels = modules.map((mod) => mod.label || MODULE_LABELS[mod.key] || mod.key);
  const greeting = cfg.greeting || ('欢迎光临，' + cfg.name + '。');
  const lines = header(
    '综合 NPC（' + labels.join('、') + '）',
    '各功能入口在 main 菜单中列出，处理函数按功能前缀命名以避免重名',
    imports
  );
  const preamble = [];
  const functions = [];
  const init = [];
  const seen = new Set(['main', 'initialize', 'exit']);
  for (const mod of modules) {
    for (const section of splitModule(mod.key, mod.script)) {
      if (!section.name) {
        preamble.push(...trimBlank(section.lines));
        continue;
      }
      if (section.name === 'exit') continue;
      if (section.name === 'initialize') {
        for (const line of section.lines.slice(1)) {
          if (line.trim() && line.trim() !== 'pass') init.push(line);
        }
        continue;
      }
      if (seen.has(section.name)) throw new Error('功能组合存在重名函数：' + section.name);
      seen.add(section.name);
      functions.push(trimBlank(section.lines));
    }
  }

  if (preamble.length) lines.push(...preamble, '', '');
  lines.push('def initialize(npc):');
  if (init.length) lines.push(...init); else lines.push('    pass');
  lines.push('', '');
  lines.push('def main(player, npc):');
  lines.push('    msg = ' + pyStr(greeting) + ' + NL');
  modules.forEach((mod, i) => {
    lines.push('    msg += ' + pyStr('<' + labels[i] + '/@' + mod.key + '_main>') + ' + NL');
  });
  lines.push("    msg += '<离开/@exit>'");
  lines.push('    user.tell(player, npc, msg)');
  for (const fn of functions) lines.push('', ...fn);
  lines.push('', '');
  lines.push('def exit(player, npc):');
  lines.push('    user.closeDialog(player, npc)');
  return lines.join('\n') + '\n';
}

module.exports = {
  purchase,
  teleport,
  shop,
  warehouse,
  repair,
  recycle,
  skill,
  teleportList,
  daily,
  craft,
  compose,
  pyStr
};

'use strict';

/* 新建 NPC 向导：一次创建 NPCScript 脚本与 NPCList.txt 行（写入前自动备份） */

const NPWZ = {
  options: null,
  preview: null,
  result: null,
  step: 1,
  busy: false,
  dirty: false,
  visible: false,
  prefill: null,
  els: null
};

const NPWZ_SEV = { error: '错误', warn: '警告', info: '提示' };

function npwzEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function npwzEl(id) {
  return document.getElementById(id);
}

function npwzVal(id) {
  const el = npwzEl(id);
  return el ? String(el.value == null ? '' : el.value).trim() : '';
}

function npwzInt(id) {
  const text = npwzVal(id);
  if (!text) return NaN;
  return Number(text);
}

function npwzIsInt(n, min, max) {
  return Number.isInteger(n) && n >= min && n <= max;
}

function npwzTemplate() {
  const input = document.querySelector('input[name="npwzTemplate"]:checked');
  return input ? input.value : 'purchase';
}

function npwzSetStatus(text) {
  const el = npwzEl('npwzStatus');
  if (el) el.textContent = text || '';
}

function npwzMapInfo(code) {
  if (!NPWZ.options || !code) return null;
  const lower = code.toLowerCase();
  return NPWZ.options.maps.find((m) => m.code.toLowerCase() === lower) || null;
}

function npwzUpdateMapHint() {
  const hint = npwzEl('npwzMapName');
  if (!hint) return;
  const code = npwzVal('npwzMap');
  const map = npwzMapInfo(code);
  if (!code) {
    hint.textContent = '填写 MapInfo / 地图文件中已有的编号';
  } else if (!map) {
    hint.textContent = '该地图不在已知列表中，创建时会被拒绝';
    hint.className = 'npwz-hint bad';
  } else {
    hint.textContent = (map.name || '未命名') + (map.registered ? ' · 已登记 MapInfo' : ' · 尚未登记 MapInfo');
    hint.className = 'npwz-hint' + (map.registered ? '' : ' warn');
  }
}

function npwzUpdateSkillInfo() {
  const hint = npwzEl('npwzSkillInfo');
  if (!hint) return;
  const name = npwzVal('npwzSkillName');
  if (!name) {
    hint.textContent = '技能名称来自 magic.db';
    hint.className = 'npwz-hint';
    return;
  }
  const row = (NPWZ.options && NPWZ.options.skills || []).find((s) => s.name === name);
  if (!row) {
    hint.textContent = 'magic.db 中未找到该技能，创建时会被拒绝';
    hint.className = 'npwz-hint bad';
    return;
  }
  const jobs = ['战士', '法师', '道士'];
  hint.textContent = '职业：' + (jobs[row.job] || '不限') + ' · 一级需求等级：' + (row.need[0] || 0);
  hint.className = 'npwz-hint';
  const need = npwzEl('npwzSkillNeed');
  if (need && Number(need.value) === 0 && row.need[0] > 0) need.value = String(row.need[0]);
}

function npwzBuild() {
  if (NPWZ.els) return;
  const mask = document.createElement('div');
  mask.id = 'npwzMask';
  mask.className = 'npwz-mask hidden';
  mask.innerHTML = [
    '<div class="npwz-panel" role="dialog" aria-modal="true" aria-labelledby="npwzTitle">',
    '  <div class="npwz-head">',
    '    <div class="npwz-title-block">',
    '      <strong id="npwzTitle">新建 NPC</strong>',
    '      <span id="npwzSub" class="muted"></span>',
    '    </div>',
    '    <button type="button" class="btn ghost small" data-npwz-close>关闭</button>',
    '  </div>',
    '  <ol class="npwz-steps">',
    '    <li data-npwz-step="1">基础信息</li>',
    '    <li data-npwz-step="2">功能模板</li>',
    '    <li data-npwz-step="3">预览与创建</li>',
    '  </ol>',
    '  <div class="npwz-body">',
    '    <section class="npwz-pane" data-npwz-pane="1">',
    '      <div class="npwz-grid">',
    '        <label class="npwz-field"><span>NPC 名称 <em>*</em></span><input id="npwzName" maxlength="64" autocomplete="off" placeholder="例如：祝福使者"></label>',
    '        <label class="npwz-field"><span>唯一编号 <em>*</em></span><input id="npwzId" maxlength="64" autocomplete="off" placeholder="例如：NpcNew001"></label>',
    '        <label class="npwz-field"><span>脚本文件名 <em>*</em></span><span class="npwz-input-wrap"><input id="npwzScript" maxlength="60" autocomplete="off" placeholder="英文字母、数字、下划线"><small class="npwz-suffix">.py</small></span></label>',
    '        <label class="npwz-field"><span>地图编号 <em>*</em></span><input id="npwzMap" list="npwzMapList" maxlength="64" autocomplete="off" placeholder="例如：MH008"><small id="npwzMapName" class="npwz-hint"></small></label>',
    '        <label class="npwz-field"><span>X 坐标 <em>*</em></span><input id="npwzX" type="number" min="0" max="100000" step="1" value="0"></label>',
    '        <label class="npwz-field"><span>Y 坐标 <em>*</em></span><input id="npwzY" type="number" min="0" max="100000" step="1" value="0"></label>',
    '      </div>',
    '      <div class="npwz-note">新 NPC 以附加字段 0 / 165 / 0 / 0 写入 NPCList.txt。创建后仍可在「NPC 分布」中调整坐标与脚本。</div>',
    '    </section>',
    '    <section class="npwz-pane hidden" data-npwz-pane="2">',
    '      <div class="npwz-templates">',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="purchase" checked><span class="npwz-card-body"><strong>金币购买</strong><em>按脚本内自定义的金币价格出售物品，支持多种货品与单次数量。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="shop"><span class="npwz-card-body"><strong>标准商店</strong><em>引擎标准买卖菜单，价格取自 stditems.db，交易类型按物品 Stdmode 自动写入。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="warehouse"><span class="npwz-card-body"><strong>仓库保管</strong><em>提供存取物品与取回物品菜单，沿用引擎的仓库安全验证。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="repair"><span class="npwz-card-body"><strong>装备修理</strong><em>普通修理与特修菜单，费用由引擎按装备耐久计算。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="recycle"><span class="npwz-card-body"><strong>物品回收</strong><em>按固定金币价格回收指定物品，每次回收 1 个。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="skill"><span class="npwz-card-body"><strong>技能学习</strong><em>教授 magic.db 中的技能，可按职业、等级与金币费用限制。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="daily"><span class="npwz-card-body"><strong>每日/限时福利</strong><em>每位玩家每天领取一次奖励，可设置开放小时段与等级门槛。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="craft"><span class="npwz-card-body"><strong>物品合成</strong><em>按自定义配方消耗材料与金币合成新物品，支持成功率与失败返还。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="teleport"><span class="npwz-card-body"><strong>收费传送</strong><em>收取金币后把玩家移动到指定地图坐标。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="teleportlist"><span class="npwz-card-body"><strong>多目标传送</strong><em>一次配置多个目的地，每个目的地可单独设置等级与费用。</em></span></label>',
    '        <label class="npwz-card"><input type="radio" name="npwzTemplate" value="copy"><span class="npwz-card-body"><strong>复制现有脚本</strong><em>以现有 NPC 脚本为起点创建独立副本，原样保留内容。</em></span></label>',
    '      </div>',
    '      <div class="npwz-sub" data-npwz-panel="purchase">',
    '        <div class="npwz-grid npwz-grid-2">',
    '          <label class="npwz-field"><span>最低等级</span><input id="npwzMinLevel" type="number" min="0" max="65535" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>单次最大数量</span><input id="npwzMaxQty" type="number" min="1" max="99" step="1" value="1"></label>',
    '        </div>',
    '        <div class="npwz-good-head"><strong>货品与金币单价</strong><span class="muted">价格由生成的脚本控制，与 stditems.db 售价无关</span><span class="spacer"></span><button type="button" class="btn small" data-npwz-add-good>添加货品</button></div>',
    '        <div id="npwzGoods" class="npwz-goods"></div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="shop">',
    '        <div class="npwz-grid npwz-grid-2">',
    '          <label class="npwz-field"><span>出售比例（%）</span><input id="npwzShopSell" type="number" min="0" max="1000" step="1" value="100"></label>',
    '          <label class="npwz-field"><span>收购比例（%）</span><input id="npwzShopBuy" type="number" min="0" max="1000" step="1" value="100"></label>',
    '        </div>',
    '        <div class="npwz-good-head"><strong>商店货品</strong><span class="muted">价格取自 stditems.db；数量与刷新时间对应 addGoods 参数</span><span class="spacer"></span><button type="button" class="btn small" data-npwz-add-shop>添加货品</button></div>',
    '        <div id="npwzShopGoods" class="npwz-goods"></div>',
    '        <div class="npwz-note">允许交易类型会根据货品在 stditems.db 中的 Stdmode 自动写入 addAllowedModes。</div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="warehouse">',
    '        <div class="npwz-note">生成“存取物品 / 取回物品”两个菜单；取回沿用引擎的离线时间与仓库锁验证。</div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="repair">',
    '        <div class="npwz-checks-inline">',
    '          <label><input id="npwzRepairNormal" type="checkbox" checked> 普通修理（@repair）</label>',
    '          <label><input id="npwzRepairSpecial" type="checkbox" checked> 特修装备（@s_repair）</label>',
    '        </div>',
    '        <div class="npwz-note">修理费用由引擎按装备耐久自动计算。</div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="recycle">',
    '        <div class="npwz-good-head"><strong>回收清单</strong><span class="muted">每次回收 1 个，价格由本模板固定</span><span class="spacer"></span><button type="button" class="btn small" data-npwz-add-recycle>添加物品</button></div>',
    '        <div id="npwzRecycleGoods" class="npwz-goods"></div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="skill">',
    '        <div class="npwz-grid npwz-grid-2">',
    '          <label class="npwz-field"><span>技能名称 <em>*</em></span><input id="npwzSkillName" list="npwzSkillList" maxlength="64" autocomplete="off" placeholder="例如：攻杀剑术"><small id="npwzSkillInfo" class="npwz-hint">技能名称来自 magic.db</small></label>',
    '          <label class="npwz-field"><span>最低等级</span><input id="npwzSkillNeed" type="number" min="0" max="65535" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>学习费用（金币）</span><input id="npwzSkillPrice" type="number" min="0" max="1000000000" step="1" value="1000"></label>',
    '        </div>',
    '        <div class="npwz-note">职业限制会自动读取 magic.db 中该技能的 Job。</div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="daily">',
    '        <div class="npwz-grid npwz-grid-2">',
    '          <label class="npwz-field"><span>最低等级</span><input id="npwzDailyMinLevel" type="number" min="0" max="65535" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>开放开始小时</span><input id="npwzDailyStart" type="number" min="0" max="23" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>开放结束小时</span><input id="npwzDailyEnd" type="number" min="0" max="23" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>金币奖励</span><input id="npwzDailyGold" type="number" min="0" max="1000000000" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>经验奖励</span><input id="npwzDailyExp" type="number" min="0" max="1000000000" step="1" value="0"></label>',
    '        </div>',
    '        <div class="npwz-good-head"><strong>奖励物品</strong><span class="muted">开始与结束小时都填 0 表示全天开放；支持跨午夜，如 22 点到 2 点</span><span class="spacer"></span><button type="button" class="btn small" data-npwz-add-daily>添加奖励</button></div>',
    '        <div id="npwzDailyRewards" class="npwz-goods"></div>',
    '        <div class="npwz-note">金币、经验与物品至少设置一种；领取状态由引擎按玩家记录，每天一次。</div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="craft">',
    '        <div class="npwz-good-head"><strong>合成配方</strong><span class="muted">每个配方可单独设置材料、金币、成功率与失败返还</span><span class="spacer"></span><button type="button" class="btn small" data-npwz-add-recipe>添加配方</button></div>',
    '        <div id="npwzRecipes" class="npwz-recipes"></div>',
    '        <div class="npwz-note">合成前会先校验全部材料、金币与背包空位；失败返还只返还材料，金币不返还。</div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="teleportlist">',
    '        <div class="npwz-good-head"><strong>目的地</strong><span class="muted">字段依次为 名称（可留空）/ 地图 / X / Y / 金币 / 最低等级</span><span class="spacer"></span><button type="button" class="btn small" data-npwz-add-dest>添加目的地</button></div>',
    '        <div id="npwzDests" class="npwz-goods"></div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="teleport">',
    '        <div class="npwz-grid">',
    '          <label class="npwz-field"><span>目标地图 <em>*</em></span><input id="npwzTeleMap" list="npwzMapList" maxlength="64" autocomplete="off" placeholder="例如：MH008"></label>',
    '          <label class="npwz-field"><span>目标 X <em>*</em></span><input id="npwzTeleX" type="number" min="0" max="100000" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>目标 Y <em>*</em></span><input id="npwzTeleY" type="number" min="0" max="100000" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>传送费用（金币）</span><input id="npwzTelePrice" type="number" min="0" max="1000000000" step="1" value="1000"></label>',
    '          <label class="npwz-field"><span>最低等级</span><input id="npwzTeleLevel" type="number" min="0" max="65535" step="1" value="0"></label>',
    '          <label class="npwz-field"><span>地点名称（可选）</span><input id="npwzTeleName" maxlength="64" autocomplete="off" placeholder="留空则使用地图名称"></label>',
    '        </div>',
    '      </div>',
    '      <div class="npwz-sub hidden" data-npwz-panel="copy">',
    '        <label class="npwz-field"><span>源脚本 <em>*</em></span><select id="npwzCopySource"></select></label>',
    '        <div class="npwz-note">复制会原样保留源脚本内容，仅新建独立的 .py 文件；脚本里的 NPC 名称与菜单可能需要手动调整。</div>',
    '      </div>',
    '    </section>',
    '    <section class="npwz-pane hidden" data-npwz-pane="3">',
    '      <div id="npwzResult" class="npwz-result hidden"></div>',
    '      <div id="npwzPreviewWrap">',
    '        <div id="npwzChecks" class="npwz-checks"></div>',
    '        <div class="npwz-preview"><div class="npwz-preview-head"><strong>NPCList.txt 新行</strong></div><pre id="npwzLine"></pre></div>',
    '        <div class="npwz-preview"><div class="npwz-preview-head"><strong>脚本预览</strong><span id="npwzScriptMeta" class="muted"></span></div><pre id="npwzScriptText" class="npwz-code"></pre></div>',
    '      </div>',
    '    </section>',
    '  </div>',
    '  <div class="npwz-foot">',
    '    <span id="npwzStatus" class="muted"></span>',
    '    <span class="spacer"></span>',
    '    <button type="button" class="btn" data-npwz-prev>上一步</button>',
    '    <button type="button" class="btn primary" data-npwz-next>下一步</button>',
    '    <button type="button" class="btn primary hidden" data-npwz-create>创建 NPC</button>',
    '  </div>',
    '  <datalist id="npwzMapList"></datalist>',
    '  <datalist id="npwzItemList"></datalist>',
    '  <datalist id="npwzSkillList"></datalist>',
    '</div>'
  ].join('\n');

  document.body.appendChild(mask);

  NPWZ.els = {
    mask,
    panel: mask.querySelector('.npwz-panel'),
    sub: npwzEl('npwzSub'),
    status: npwzEl('npwzStatus'),
    prev: mask.querySelector('[data-npwz-prev]'),
    next: mask.querySelector('[data-npwz-next]'),
    create: mask.querySelector('[data-npwz-create]'),
    goods: npwzEl('npwzGoods'),
    shopGoods: npwzEl('npwzShopGoods'),
    recycleGoods: npwzEl('npwzRecycleGoods'),
    dailyRewards: npwzEl('npwzDailyRewards'),
    recipes: npwzEl('npwzRecipes'),
    dests: npwzEl('npwzDests'),
    result: npwzEl('npwzResult'),
    previewWrap: npwzEl('npwzPreviewWrap')
  };

  mask.addEventListener('click', (e) => {
    if (e.target === mask) {
      requestClose();
      return;
    }
    if (e.target.closest('[data-npwz-close]')) {
      requestClose();
      return;
    }
    if (e.target.closest('[data-npwz-next]')) {
      nextStep();
      return;
    }
    if (e.target.closest('[data-npwz-prev]')) {
      gotoStep(NPWZ.step - 1);
      return;
    }
    if (e.target.closest('[data-npwz-create]')) {
      createNpc();
      return;
    }
    if (e.target.closest('[data-npwz-add-good]')) {
      addGoodRow('', '');
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-remove-good]')) {
      const row = e.target.closest('.npwz-good');
      if (row) row.remove();
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-add-shop]')) {
      addShopGoodRow('', '', '');
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-remove-shop]')) {
      const row = e.target.closest('.npwz-shop-good');
      if (row) row.remove();
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-add-recycle]')) {
      addRecycleRow('', '');
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-remove-recycle]')) {
      const row = e.target.closest('.npwz-recycle-good');
      if (row) row.remove();
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-add-daily]')) {
      addDailyRewardRow('', '');
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-remove-daily]')) {
      const row = e.target.closest('.npwz-daily-reward');
      if (row) row.remove();
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-add-recipe]')) {
      addRecipeRow({});
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-remove-recipe]')) {
      const block = e.target.closest('.npwz-recipe');
      if (block) block.remove();
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-add-material]')) {
      const block = e.target.closest('.npwz-recipe');
      if (block) addCraftMaterialRow(block.querySelector('.npwz-craft-mats'), '', '');
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-remove-material]')) {
      const row = e.target.closest('.npwz-craft-mat');
      if (row) row.remove();
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-add-dest]')) {
      addDestRow({});
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-remove-dest]')) {
      const row = e.target.closest('.npwz-dest');
      if (row) row.remove();
      NPWZ.dirty = true;
      return;
    }
    if (e.target.closest('[data-npwz-open-npc]')) {
      openResultNpc();
      return;
    }
    if (e.target.closest('[data-npwz-open-script]')) {
      openResultScript();
      return;
    }
    if (e.target.closest('[data-npwz-again]')) {
      openNpcWizard(NPWZ.prefill);
      return;
    }
  });

  mask.addEventListener('input', (e) => {
    NPWZ.dirty = true;
    if (e.target && e.target.id === 'npwzMap') npwzUpdateMapHint();
    if (e.target && e.target.id === 'npwzSkillName') npwzUpdateSkillInfo();
  });
  mask.addEventListener('change', (e) => {
    NPWZ.dirty = true;
    if (e.target && e.target.name === 'npwzTemplate') npwzRenderTemplate();
    if (e.target && e.target.id === 'npwzMap') npwzUpdateMapHint();
    if (e.target && e.target.id === 'npwzSkillName') npwzUpdateSkillInfo();
  });

  document.addEventListener('keydown', (e) => {
    if (!NPWZ.visible || e.key !== 'Escape' || NPWZ.busy) return;
    if (window.uiDialogOpen && window.uiDialogOpen()) return;
    e.preventDefault();
    requestClose();
  });
}

function npwzRenderTemplate() {
  const key = npwzTemplate();
  document.querySelectorAll('[data-npwz-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.npwzPanel !== key);
  });
}

function npwzFillOptions() {
  const opts = NPWZ.options;
  if (!opts) return;
  const mapList = npwzEl('npwzMapList');
  if (mapList) {
    mapList.innerHTML = opts.maps.map((m) =>
      '<option value="' + npwzEsc(m.code) + '">' +
      npwzEsc(m.code + (m.name ? ' · ' + m.name : '') + (m.registered ? '' : ' · 未登记')) +
      '</option>').join('');
  }
  const itemList = npwzEl('npwzItemList');
  if (itemList) {
    itemList.innerHTML = opts.items.map((name) =>
      '<option value="' + npwzEsc(name) + '"></option>').join('');
  }
  const skillList = npwzEl('npwzSkillList');
  if (skillList) {
    skillList.innerHTML = (opts.skills || []).map((s) =>
      '<option value="' + npwzEsc(s.name) + '"></option>').join('');
  }
  const copySelect = npwzEl('npwzCopySource');
  if (copySelect) {
    copySelect.innerHTML = opts.scripts.length
      ? opts.scripts.map((s) =>
        '<option value="' + npwzEsc(s.base) + '">' +
        npwzEsc(s.file + (s.usedBy ? '（被 ' + s.usedBy + ' 个 NPC 引用）' : '（未被引用）')) +
        '</option>').join('')
      : '<option value="">没有可用的 .py 脚本</option>';
  }
  if (NPWZ.els.sub) {
    NPWZ.els.sub.textContent = [
      opts.counts.npcs + ' 个 NPC',
      opts.counts.maps + ' 张地图',
      opts.counts.items + ' 种物品',
      opts.counts.skills + ' 个技能',
      opts.counts.scripts + ' 个脚本'
    ].join(' · ');
  }
}

function npwzResetForm() {
  const opts = NPWZ.options;
  const suggested = (opts && opts.suggested) || { id: '', script: '' };
  const prefill = NPWZ.prefill || {};
  const set = (id, value) => {
    const el = npwzEl(id);
    if (el) el.value = value == null ? '' : String(value);
  };
  set('npwzName', prefill.name || '');
  set('npwzId', prefill.id || suggested.id);
  set('npwzScript', prefill.script || suggested.script);
  set('npwzMap', prefill.map || '');
  set('npwzX', prefill.x == null ? 0 : prefill.x);
  set('npwzY', prefill.y == null ? 0 : prefill.y);
  set('npwzMinLevel', 0);
  set('npwzMaxQty', 1);
  set('npwzTeleMap', prefill.map || '');
  set('npwzTeleX', prefill.x == null ? 0 : prefill.x);
  set('npwzTeleY', prefill.y == null ? 0 : prefill.y);
  set('npwzTelePrice', 1000);
  set('npwzTeleLevel', 0);
  set('npwzTeleName', '');
  set('npwzShopSell', 100);
  set('npwzShopBuy', 100);
  const repairNormal = npwzEl('npwzRepairNormal');
  if (repairNormal) repairNormal.checked = true;
  const repairSpecial = npwzEl('npwzRepairSpecial');
  if (repairSpecial) repairSpecial.checked = true;
  set('npwzSkillName', '');
  set('npwzSkillNeed', 0);
  set('npwzSkillPrice', 1000);
  set('npwzDailyMinLevel', 0);
  set('npwzDailyStart', 0);
  set('npwzDailyEnd', 0);
  set('npwzDailyGold', 0);
  set('npwzDailyExp', 0);
  const skillInfo = npwzEl('npwzSkillInfo');
  if (skillInfo) {
    skillInfo.textContent = '技能名称来自 magic.db';
    skillInfo.className = 'npwz-hint';
  }
  const purchase = document.querySelector('input[name="npwzTemplate"][value="purchase"]');
  if (purchase) purchase.checked = true;
  npwzRenderTemplate();
  if (NPWZ.els.goods) NPWZ.els.goods.innerHTML = '';
  addGoodRow(prefill.item || '', '');
  if (NPWZ.els.shopGoods) NPWZ.els.shopGoods.innerHTML = '';
  addShopGoodRow('', '', '');
  if (NPWZ.els.recycleGoods) NPWZ.els.recycleGoods.innerHTML = '';
  addRecycleRow('', '');
  if (NPWZ.els.dailyRewards) NPWZ.els.dailyRewards.innerHTML = '';
  addDailyRewardRow('', '');
  if (NPWZ.els.recipes) NPWZ.els.recipes.innerHTML = '';
  addRecipeRow({});
  if (NPWZ.els.dests) NPWZ.els.dests.innerHTML = '';
  addDestRow({ map: prefill.map || '' });
  npwzUpdateMapHint();
  NPWZ.dirty = false;
}

function addGoodRow(item, price) {
  if (!NPWZ.els.goods) return;
  const row = document.createElement('div');
  row.className = 'npwz-good';
  row.innerHTML = '<input class="npwz-good-item" list="npwzItemList" maxlength="64" autocomplete="off" placeholder="物品名称">' +
    '<input class="npwz-good-price" type="number" min="0" max="1000000000" step="1" placeholder="金币单价">' +
    '<button type="button" class="btn ghost small" data-npwz-remove-good>删除</button>';
  const itemInput = row.querySelector('.npwz-good-item');
  const priceInput = row.querySelector('.npwz-good-price');
  if (itemInput) itemInput.value = item || '';
  if (priceInput) priceInput.value = price == null ? '' : String(price);
  NPWZ.els.goods.appendChild(row);
  if (itemInput && !item) itemInput.focus();
}

function addShopGoodRow(item, count, time) {
  if (!NPWZ.els.shopGoods) return;
  const row = document.createElement('div');
  row.className = 'npwz-good npwz-shop-good';
  row.innerHTML = '<input class="npwz-shop-item" list="npwzItemList" maxlength="64" autocomplete="off" placeholder="物品名称">' +
    '<input class="npwz-shop-count" type="number" min="1" max="9999" step="1" placeholder="数量">' +
    '<input class="npwz-shop-time" type="number" min="0" max="9999" step="1" placeholder="刷新时间">' +
    '<button type="button" class="btn ghost small" data-npwz-remove-shop>删除</button>';
  const itemInput = row.querySelector('.npwz-shop-item');
  if (itemInput) itemInput.value = item || '';
  row.querySelector('.npwz-shop-count').value = count === '' || count == null ? '100' : String(count);
  row.querySelector('.npwz-shop-time').value = time === '' || time == null ? '10' : String(time);
  NPWZ.els.shopGoods.appendChild(row);
  if (itemInput && !item) itemInput.focus();
}

function addRecycleRow(item, price) {
  if (!NPWZ.els.recycleGoods) return;
  const row = document.createElement('div');
  row.className = 'npwz-good npwz-recycle-good';
  row.innerHTML = '<input class="npwz-recycle-item" list="npwzItemList" maxlength="64" autocomplete="off" placeholder="物品名称">' +
    '<input class="npwz-recycle-price" type="number" min="0" max="1000000000" step="1" placeholder="回收金币">' +
    '<button type="button" class="btn ghost small" data-npwz-remove-recycle>删除</button>';
  const itemInput = row.querySelector('.npwz-recycle-item');
  const priceInput = row.querySelector('.npwz-recycle-price');
  if (itemInput) itemInput.value = item || '';
  if (priceInput) priceInput.value = price == null ? '' : String(price);
  NPWZ.els.recycleGoods.appendChild(row);
  if (itemInput && !item) itemInput.focus();
}

function addDailyRewardRow(item, count) {
  if (!NPWZ.els.dailyRewards) return;
  const row = document.createElement('div');
  row.className = 'npwz-good npwz-daily-reward';
  row.innerHTML = '<input class="npwz-daily-item" list="npwzItemList" maxlength="64" autocomplete="off" placeholder="物品名称">' +
    '<input class="npwz-daily-count" type="number" min="1" max="9999" step="1" placeholder="数量">' +
    '<button type="button" class="btn ghost small" data-npwz-remove-daily>删除</button>';
  const itemInput = row.querySelector('.npwz-daily-item');
  const countInput = row.querySelector('.npwz-daily-count');
  if (itemInput) itemInput.value = item || '';
  if (countInput) countInput.value = count === '' || count == null ? '1' : String(count);
  NPWZ.els.dailyRewards.appendChild(row);
  if (itemInput && !item) itemInput.focus();
}

function addRecipeRow(recipe) {
  if (!NPWZ.els.recipes) return;
  const r = recipe || {};
  const block = document.createElement('div');
  block.className = 'npwz-recipe';
  block.innerHTML = '<div class="npwz-recipe-head"><strong>配方</strong><span class="spacer"></span>' +
    '<button type="button" class="btn ghost small" data-npwz-remove-recipe>删除配方</button></div>' +
    '<div class="npwz-recipe-grid">' +
    '<label class="npwz-field"><span>菜单名称（可选）</span><input class="npwz-recipe-name" maxlength="64" autocomplete="off" placeholder="留空则用产物名称"></label>' +
    '<label class="npwz-field"><span>产物 <em>*</em></span><input class="npwz-recipe-output" list="npwzItemList" maxlength="64" autocomplete="off" placeholder="物品名称"></label>' +
    '<label class="npwz-field"><span>产物数量</span><input class="npwz-recipe-count" type="number" min="1" max="9999" step="1" value="1"></label>' +
    '<label class="npwz-field"><span>合成费用（金币）</span><input class="npwz-recipe-gold" type="number" min="0" max="1000000000" step="1" value="0"></label>' +
    '<label class="npwz-field"><span>成功率（%）</span><input class="npwz-recipe-rate" type="number" min="1" max="100" step="1" value="100"></label>' +
    '<label class="npwz-check-field"><input class="npwz-recipe-refund" type="checkbox" checked> 失败返还材料</label>' +
    '</div>' +
    '<div class="npwz-craft-mats-head"><span>材料</span><span class="muted">每种材料一行，单个配方最多 6 种</span>' +
    '<span class="spacer"></span><button type="button" class="btn ghost small" data-npwz-add-material>添加材料</button></div>' +
    '<div class="npwz-craft-mats"></div>';
  block.querySelector('.npwz-recipe-name').value = r.name || '';
  block.querySelector('.npwz-recipe-output').value = r.output || '';
  block.querySelector('.npwz-recipe-count').value = r.count == null ? '1' : String(r.count);
  block.querySelector('.npwz-recipe-gold').value = r.gold == null ? '0' : String(r.gold);
  block.querySelector('.npwz-recipe-rate').value = r.rate == null ? '100' : String(r.rate);
  block.querySelector('.npwz-recipe-refund').checked = r.refund !== false;
  NPWZ.els.recipes.appendChild(block);
  addCraftMaterialRow(block.querySelector('.npwz-craft-mats'), '', '');
  const output = block.querySelector('.npwz-recipe-output');
  if (output && !r.output) output.focus();
}

function addCraftMaterialRow(container, item, count) {
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'npwz-good npwz-craft-mat';
  row.innerHTML = '<input class="npwz-craft-item" list="npwzItemList" maxlength="64" autocomplete="off" placeholder="材料名称">' +
    '<input class="npwz-craft-count" type="number" min="1" max="9999" step="1" placeholder="数量">' +
    '<button type="button" class="btn ghost small" data-npwz-remove-material>删除</button>';
  const itemInput = row.querySelector('.npwz-craft-item');
  const countInput = row.querySelector('.npwz-craft-count');
  if (itemInput) itemInput.value = item || '';
  if (countInput) countInput.value = count === '' || count == null ? '1' : String(count);
  container.appendChild(row);
  if (itemInput && !item) itemInput.focus();
}

function addDestRow(dest) {
  if (!NPWZ.els.dests) return;
  const d = dest || {};
  const row = document.createElement('div');
  row.className = 'npwz-good npwz-dest';
  row.innerHTML = '<input class="npwz-dest-name" maxlength="64" autocomplete="off" placeholder="名称（可选）">' +
    '<input class="npwz-dest-map" list="npwzMapList" maxlength="64" autocomplete="off" placeholder="地图编号">' +
    '<input class="npwz-dest-x" type="number" min="0" max="100000" step="1" placeholder="X">' +
    '<input class="npwz-dest-y" type="number" min="0" max="100000" step="1" placeholder="Y">' +
    '<input class="npwz-dest-price" type="number" min="0" max="1000000000" step="1" placeholder="金币">' +
    '<input class="npwz-dest-level" type="number" min="0" max="65535" step="1" placeholder="等级">' +
    '<button type="button" class="btn ghost small" data-npwz-remove-dest>删除</button>';
  row.querySelector('.npwz-dest-name').value = d.name || '';
  row.querySelector('.npwz-dest-map').value = d.map || '';
  row.querySelector('.npwz-dest-x').value = d.x == null ? '0' : String(d.x);
  row.querySelector('.npwz-dest-y').value = d.y == null ? '0' : String(d.y);
  row.querySelector('.npwz-dest-price').value = d.price == null ? '1000' : String(d.price);
  row.querySelector('.npwz-dest-level').value = d.minLevel == null ? '0' : String(d.minLevel);
  NPWZ.els.dests.appendChild(row);
  if (!d.map) row.querySelector('.npwz-dest-map').focus();
}

function npwzGoalStep(step) {
  const buttons = NPWZ.els;
  const total = 3;
  const s = Math.max(1, Math.min(total, step));
  NPWZ.step = s;
  document.querySelectorAll('[data-npwz-step]').forEach((li) => {
    const n = Number(li.dataset.npwzStep);
    li.classList.toggle('active', n === s);
    li.classList.toggle('done', n < s || (NPWZ.result && n === 3));
  });
  document.querySelectorAll('[data-npwz-pane]').forEach((pane) => {
    pane.classList.toggle('hidden', Number(pane.dataset.npwzPane) !== s);
  });
  if (buttons) {
    buttons.prev.classList.toggle('hidden', s === 1 || !!NPWZ.result);
    buttons.next.classList.toggle('hidden', s === total || !!NPWZ.result);
    buttons.create.classList.toggle('hidden', s !== total || !!NPWZ.result);
    buttons.create.disabled = !NPWZ.preview || !NPWZ.preview.ok;
  }
  if (NPWZ.els.result && NPWZ.els.previewWrap) {
    NPWZ.els.result.classList.toggle('hidden', !NPWZ.result);
    NPWZ.els.previewWrap.classList.toggle('hidden', !!NPWZ.result);
  }
}

function gotoStep(step) {
  if (step === 3) {
    previewStep();
    return;
  }
  npwzSetStatus('');
  npwzGoalStep(step);
}

function nextStep() {
  if (NPWZ.step === 1) {
    if (!validateBase()) return;
    npwzGoalStep(2);
    return;
  }
  if (NPWZ.step === 2) {
    if (!validateTemplate()) return;
    previewStep();
  }
}

function validateBase() {
  const name = npwzVal('npwzName');
  const id = npwzVal('npwzId');
  const script = npwzVal('npwzScript').replace(/\.py$/i, '');
  const map = npwzVal('npwzMap');
  if (!name) {
    toast('请填写 NPC 名称', 'err');
    return false;
  }
  if (!id) {
    toast('请填写 NPC 唯一编号', 'err');
    return false;
  }
  if (!script || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(script)) {
    toast('脚本文件名只能包含英文字母、数字和下划线，且不能以数字开头', 'err');
    return false;
  }
  if (!map) {
    toast('请填写地图编号', 'err');
    return false;
  }
  const x = npwzInt('npwzX');
  const y = npwzInt('npwzY');
  if (!npwzIsInt(x, 0, 100000) || !npwzIsInt(y, 0, 100000)) {
    toast('X / Y 坐标需要 0-100000 的整数', 'err');
    return false;
  }
  return true;
}

function validateTemplate() {
  const key = npwzTemplate();
  if (key === 'purchase') {
    const minLevel = npwzInt('npwzMinLevel');
    const maxQty = npwzInt('npwzMaxQty');
    if (!npwzIsInt(minLevel, 0, 65535)) {
      toast('最低等级需要 0-65535 的整数', 'err');
      return false;
    }
    if (!npwzIsInt(maxQty, 1, 99)) {
      toast('单次最大数量需要 1-99 的整数', 'err');
      return false;
    }
    const rows = Array.from(document.querySelectorAll('#npwzGoods .npwz-good'));
    if (!rows.length) {
      toast('请至少添加一种货品', 'err');
      return false;
    }
    for (const row of rows) {
      const item = row.querySelector('.npwz-good-item');
      const price = row.querySelector('.npwz-good-price');
      if (!item || !item.value.trim()) {
        toast('请填写货品名称', 'err');
        if (item) item.focus();
        return false;
      }
      const n = Number(price ? price.value : '');
      if (!npwzIsInt(n, 0, 1000000000)) {
        toast('货品「' + item.value.trim() + '」的金币单价需要非负整数', 'err');
        if (price) price.focus();
        return false;
      }
    }
    return true;
  }
  if (key === 'shop') {
    const sell = npwzInt('npwzShopSell');
    const buy = npwzInt('npwzShopBuy');
    if (!npwzIsInt(sell, 0, 1000) || !npwzIsInt(buy, 0, 1000)) {
      toast('出售/收购比例需要 0-1000 的整数', 'err');
      return false;
    }
    const rows = Array.from(document.querySelectorAll('#npwzShopGoods .npwz-shop-good'));
    if (!rows.length) {
      toast('请至少添加一种商店货品', 'err');
      return false;
    }
    for (const row of rows) {
      const item = row.querySelector('.npwz-shop-item');
      const count = Number(row.querySelector('.npwz-shop-count').value);
      const time = Number(row.querySelector('.npwz-shop-time').value);
      if (!item || !item.value.trim()) {
        toast('请填写商店货品名称', 'err');
        if (item) item.focus();
        return false;
      }
      if (!npwzIsInt(count, 1, 9999) || !npwzIsInt(time, 0, 9999)) {
        toast('货品「' + item.value.trim() + '」的数量需要 1-9999，刷新时间需要 0-9999', 'err');
        return false;
      }
    }
    return true;
  }
  if (key === 'warehouse') return true;
  if (key === 'repair') {
    const normal = npwzEl('npwzRepairNormal');
    const special = npwzEl('npwzRepairSpecial');
    if (!(normal && normal.checked) && !(special && special.checked)) {
      toast('请至少启用一种修理方式', 'err');
      return false;
    }
    return true;
  }
  if (key === 'recycle') {
    const rows = Array.from(document.querySelectorAll('#npwzRecycleGoods .npwz-recycle-good'));
    if (!rows.length) {
      toast('请至少添加一种回收物品', 'err');
      return false;
    }
    for (const row of rows) {
      const item = row.querySelector('.npwz-recycle-item');
      const price = Number(row.querySelector('.npwz-recycle-price').value);
      if (!item || !item.value.trim()) {
        toast('请填写回收物品名称', 'err');
        if (item) item.focus();
        return false;
      }
      if (!npwzIsInt(price, 0, 1000000000)) {
        toast('回收物品「' + item.value.trim() + '」的金币价格需要非负整数', 'err');
        return false;
      }
    }
    return true;
  }
  if (key === 'skill') {
    if (!npwzVal('npwzSkillName')) {
      toast('请填写技能名称', 'err');
      return false;
    }
    if (!npwzIsInt(npwzInt('npwzSkillNeed'), 0, 65535)) {
      toast('最低等级需要 0-65535 的整数', 'err');
      return false;
    }
    if (!npwzIsInt(npwzInt('npwzSkillPrice'), 0, 1000000000)) {
      toast('学习费用需要非负整数', 'err');
      return false;
    }
    return true;
  }
  if (key === 'daily') {
    const minLevel = npwzInt('npwzDailyMinLevel');
    const start = npwzInt('npwzDailyStart');
    const end = npwzInt('npwzDailyEnd');
    const gold = npwzInt('npwzDailyGold');
    const exp = npwzInt('npwzDailyExp');
    if (!npwzIsInt(minLevel, 0, 65535)) {
      toast('最低等级需要 0-65535 的整数', 'err');
      return false;
    }
    if (!npwzIsInt(start, 0, 23) || !npwzIsInt(end, 0, 23)) {
      toast('开放开始/结束小时需要 0-23 的整数', 'err');
      return false;
    }
    if (start === end && start !== 0) {
      toast('开始与结束小时不能相同；全天开放请都填 0', 'err');
      return false;
    }
    if (!npwzIsInt(gold, 0, 1000000000) || !npwzIsInt(exp, 0, 1000000000)) {
      toast('金币与经验奖励需要非负整数', 'err');
      return false;
    }
    let itemCount = 0;
    for (const row of Array.from(document.querySelectorAll('#npwzDailyRewards .npwz-daily-reward'))) {
      const item = row.querySelector('.npwz-daily-item');
      const count = Number(row.querySelector('.npwz-daily-count').value);
      if (!item || !item.value.trim()) continue;
      itemCount++;
      if (!npwzIsInt(count, 1, 9999)) {
        toast('奖励物品「' + item.value.trim() + '」的数量需要 1-9999 的整数', 'err');
        return false;
      }
    }
    if (!itemCount && gold <= 0 && exp <= 0) {
      toast('请至少设置一种奖励（金币、经验或物品）', 'err');
      return false;
    }
    return true;
  }
  if (key === 'craft') {
    const blocks = Array.from(document.querySelectorAll('#npwzRecipes .npwz-recipe'));
    if (!blocks.length) {
      toast('请至少添加一个合成配方', 'err');
      return false;
    }
    for (const block of blocks) {
      const output = block.querySelector('.npwz-recipe-output');
      const count = Number(block.querySelector('.npwz-recipe-count').value);
      const gold = Number(block.querySelector('.npwz-recipe-gold').value);
      const rate = Number(block.querySelector('.npwz-recipe-rate').value);
      if (!output || !output.value.trim()) {
        toast('请填写合成产物名称', 'err');
        if (output) output.focus();
        return false;
      }
      const label = '产物「' + output.value.trim() + '」';
      if (!npwzIsInt(count, 1, 9999) || !npwzIsInt(gold, 0, 1000000000) || !npwzIsInt(rate, 1, 100)) {
        toast(label + '的数量、费用或成功率不合法', 'err');
        return false;
      }
      const mats = Array.from(block.querySelectorAll('.npwz-craft-mat'))
        .map((row) => ({
          itemEl: row.querySelector('.npwz-craft-item'),
          countEl: row.querySelector('.npwz-craft-count')
        }))
        .filter((mat) => mat.itemEl && mat.itemEl.value.trim());
      if (!mats.length) {
        toast(label + '至少需要一种材料', 'err');
        return false;
      }
      if (mats.length > 6) {
        toast(label + '的材料最多 6 种', 'err');
        return false;
      }
      for (const mat of mats) {
        const amount = Number(mat.countEl ? mat.countEl.value : '');
        if (!npwzIsInt(amount, 1, 9999)) {
          toast('材料「' + mat.itemEl.value.trim() + '」的数量需要 1-9999 的整数', 'err');
          return false;
        }
      }
    }
    return true;
  }
  if (key === 'teleportlist') {
    const rows = Array.from(document.querySelectorAll('#npwzDests .npwz-dest'));
    if (!rows.length) {
      toast('请至少添加一个传送目的地', 'err');
      return false;
    }
    for (const row of rows) {
      const map = row.querySelector('.npwz-dest-map');
      const x = Number(row.querySelector('.npwz-dest-x').value);
      const y = Number(row.querySelector('.npwz-dest-y').value);
      const price = Number(row.querySelector('.npwz-dest-price').value);
      const level = Number(row.querySelector('.npwz-dest-level').value);
      if (!map || !map.value.trim()) {
        toast('请填写传送目的地的地图编号', 'err');
        if (map) map.focus();
        return false;
      }
      if (!npwzIsInt(x, 0, 100000) || !npwzIsInt(y, 0, 100000) ||
        !npwzIsInt(price, 0, 1000000000) || !npwzIsInt(level, 0, 65535)) {
        toast('目的地「' + map.value.trim() + '」的坐标、费用或等级不合法', 'err');
        return false;
      }
    }
    return true;
  }
  if (key === 'teleport') {
    if (!npwzVal('npwzTeleMap')) {
      toast('请填写传送目标地图', 'err');
      return false;
    }
    const x = npwzInt('npwzTeleX');
    const y = npwzInt('npwzTeleY');
    const price = npwzInt('npwzTelePrice');
    const level = npwzInt('npwzTeleLevel');
    if (!npwzIsInt(x, 0, 100000) || !npwzIsInt(y, 0, 100000)) {
      toast('传送目标坐标需要 0-100000 的整数', 'err');
      return false;
    }
    if (!npwzIsInt(price, 0, 1000000000)) {
      toast('传送费用需要非负整数', 'err');
      return false;
    }
    if (!npwzIsInt(level, 0, 65535)) {
      toast('最低等级需要 0-65535 的整数', 'err');
      return false;
    }
    return true;
  }
  if (!npwzVal('npwzCopySource')) {
    toast('请选择要复制的源脚本', 'err');
    return false;
  }
  return true;
}

function collectPayload() {
  const template = npwzTemplate();
  const goods = Array.from(document.querySelectorAll('#npwzGoods .npwz-good')).map((row) => ({
    item: row.querySelector('.npwz-good-item').value.trim(),
    price: row.querySelector('.npwz-good-price').value.trim()
  }));
  return {
    name: npwzVal('npwzName'),
    id: npwzVal('npwzId'),
    script: npwzVal('npwzScript').replace(/\.py$/i, ''),
    map: npwzVal('npwzMap'),
    x: npwzVal('npwzX'),
    y: npwzVal('npwzY'),
    template,
    purchase: {
      minLevel: npwzVal('npwzMinLevel'),
      maxQty: npwzVal('npwzMaxQty'),
      goods
    },
    shop: {
      sellPercent: npwzVal('npwzShopSell'),
      buyPercent: npwzVal('npwzShopBuy'),
      goods: Array.from(document.querySelectorAll('#npwzShopGoods .npwz-shop-good')).map((row) => ({
        item: row.querySelector('.npwz-shop-item').value.trim(),
        count: row.querySelector('.npwz-shop-count').value.trim(),
        time: row.querySelector('.npwz-shop-time').value.trim()
      }))
    },
    warehouse: {},
    repair: {
      normal: !!(npwzEl('npwzRepairNormal') && npwzEl('npwzRepairNormal').checked),
      special: !!(npwzEl('npwzRepairSpecial') && npwzEl('npwzRepairSpecial').checked)
    },
    recycle: {
      goods: Array.from(document.querySelectorAll('#npwzRecycleGoods .npwz-recycle-good')).map((row) => ({
        item: row.querySelector('.npwz-recycle-item').value.trim(),
        price: row.querySelector('.npwz-recycle-price').value.trim()
      }))
    },
    skill: {
      name: npwzVal('npwzSkillName'),
      needLevel: npwzVal('npwzSkillNeed'),
      price: npwzVal('npwzSkillPrice')
    },
    daily: {
      minLevel: npwzVal('npwzDailyMinLevel'),
      startHour: npwzVal('npwzDailyStart'),
      endHour: npwzVal('npwzDailyEnd'),
      gold: npwzVal('npwzDailyGold'),
      exp: npwzVal('npwzDailyExp'),
      rewards: Array.from(document.querySelectorAll('#npwzDailyRewards .npwz-daily-reward'))
        .map((row) => ({
          item: row.querySelector('.npwz-daily-item').value.trim(),
          count: row.querySelector('.npwz-daily-count').value.trim()
        }))
        .filter((reward) => reward.item)
    },
    craft: {
      recipes: Array.from(document.querySelectorAll('#npwzRecipes .npwz-recipe')).map((block) => ({
        name: block.querySelector('.npwz-recipe-name').value.trim(),
        output: block.querySelector('.npwz-recipe-output').value.trim(),
        count: block.querySelector('.npwz-recipe-count').value.trim(),
        gold: block.querySelector('.npwz-recipe-gold').value.trim(),
        rate: block.querySelector('.npwz-recipe-rate').value.trim(),
        refund: !!block.querySelector('.npwz-recipe-refund').checked,
        materials: Array.from(block.querySelectorAll('.npwz-craft-mat'))
          .map((mat) => ({
            item: mat.querySelector('.npwz-craft-item').value.trim(),
            count: mat.querySelector('.npwz-craft-count').value.trim()
          }))
          .filter((material) => material.item)
      }))
    },
    teleports: {
      destinations: Array.from(document.querySelectorAll('#npwzDests .npwz-dest')).map((row) => ({
        name: row.querySelector('.npwz-dest-name').value.trim(),
        map: row.querySelector('.npwz-dest-map').value.trim(),
        x: row.querySelector('.npwz-dest-x').value.trim(),
        y: row.querySelector('.npwz-dest-y').value.trim(),
        price: row.querySelector('.npwz-dest-price').value.trim(),
        minLevel: row.querySelector('.npwz-dest-level').value.trim()
      }))
    },
    teleport: {
      map: npwzVal('npwzTeleMap'),
      x: npwzVal('npwzTeleX'),
      y: npwzVal('npwzTeleY'),
      price: npwzVal('npwzTelePrice'),
      minLevel: npwzVal('npwzTeleLevel'),
      name: npwzVal('npwzTeleName')
    },
    copy: {
      source: npwzVal('npwzCopySource')
    }
  };
}

function renderPreview(data) {
  const checks = npwzEl('npwzChecks');
  if (checks) {
    checks.innerHTML = (data.checks || []).map((c) => {
      const sev = NPWZ_SEV[c.severity] ? c.severity : 'info';
      return '<div class="npwz-check ' + sev + '"><span class="npwz-sev">' + npwzEsc(NPWZ_SEV[sev]) +
        '</span><span>' + npwzEsc(c.message) + '</span></div>';
    }).join('') || '<div class="npwz-check info"><span class="npwz-sev">提示</span><span>没有额外检查项。</span></div>';
  }
  const line = npwzEl('npwzLine');
  if (line) line.textContent = data.npcLine || '';
  const text = npwzEl('npwzScriptText');
  if (text) text.textContent = data.scriptText || '';
  const meta = npwzEl('npwzScriptMeta');
  if (meta) {
    const lines = String(data.scriptText || '').split('\n').length;
    meta.textContent = data.scriptFile + ' · GBK · ' + data.eol + ' · ' + lines + ' 行';
  }
}

async function previewStep() {
  if (NPWZ.busy) return;
  NPWZ.busy = true;
  npwzSetStatus('正在生成预览…');
  const buttons = NPWZ.els;
  if (buttons) {
    buttons.next.disabled = true;
    buttons.create.disabled = true;
  }
  try {
    const data = await api('/api/config/npcwork/create/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload())
    });
    NPWZ.preview = data;
    NPWZ.result = null;
    renderPreview(data);
    npwzGoalStep(3);
    npwzSetStatus(data.ok ? '检查通过，可以创建。' : '存在错误，请返回修改。');
  } catch (e) {
    NPWZ.preview = null;
    npwzSetStatus('');
    toast('预览失败：' + e.message, 'err');
  } finally {
    NPWZ.busy = false;
    if (buttons) {
      buttons.next.disabled = false;
      buttons.create.disabled = !NPWZ.preview || !NPWZ.preview.ok;
    }
  }
}

function renderResult(res) {
  const box = NPWZ.els.result;
  if (!box) return;
  const warnings = (res.warnings || []).map((w) =>
    '<div class="npwz-check warn"><span class="npwz-sev">注意</span><span>' + npwzEsc(w) + '</span></div>').join('');
  box.innerHTML = '<div class="npwz-success-head"><strong>NPC 创建成功</strong>' +
    '<span class="npwz-chip">' + npwzEsc(res.name || res.id) + '</span>' +
    '<span class="npwz-chip">' + npwzEsc(res.scriptFile || '') + '</span></div>' +
    '<div class="npwz-grid">' +
    '<div class="npwz-kv"><span>唯一编号</span><strong>' + npwzEsc(res.id) + '</strong></div>' +
    '<div class="npwz-kv"><span>位置</span><strong>' + npwzEsc(res.map + ' (' + res.x + ', ' + res.y + ')') + '</strong></div>' +
    '<div class="npwz-kv"><span>脚本</span><strong>' + npwzEsc(res.scriptFile) + '</strong></div>' +
    '<div class="npwz-kv"><span>NPCList 备份</span><strong>' + npwzEsc(res.backup || '—') + '</strong></div>' +
    '</div>' +
    warnings +
    '<div class="npwz-note">新脚本没有 .pyc，请重启或重新加载 GameServer 后再进游戏验证；如需编辑脚本，可在脚本工作台打开。</div>' +
    '<div class="npwz-result-actions">' +
    '<button type="button" class="btn primary" data-npwz-open-npc>在 NPC 工作台查看</button>' +
    '<button type="button" class="btn" data-npwz-open-script>打开脚本</button>' +
    '<button type="button" class="btn" data-npwz-again>继续新建</button>' +
    '<button type="button" class="btn ghost" data-npwz-close>关闭</button>' +
    '</div>';
}

async function createNpc() {
  if (NPWZ.busy || !NPWZ.preview || !NPWZ.preview.ok) return;
  NPWZ.busy = true;
  const buttons = NPWZ.els;
  if (buttons) {
    buttons.prev.disabled = true;
    buttons.create.disabled = true;
  }
  npwzSetStatus('正在写入…');
  try {
    const res = await api('/api/config/npcwork/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload())
    });
    NPWZ.result = res;
    NPWZ.dirty = false;
    renderResult(res);
    npwzGoalStep(3);
    npwzSetStatus('已创建；NPCList 已备份。');
    toast('NPC 创建成功：' + (res.name || res.id), 'ok');
    if (typeof refreshState === 'function') refreshState().catch(() => {});
  } catch (e) {
    npwzSetStatus('');
    toast('创建失败：' + e.message, 'err');
  } finally {
    NPWZ.busy = false;
    if (buttons) buttons.prev.disabled = false;
  }
}

function openResultNpc() {
  const res = NPWZ.result;
  closeNpcWizard();
  if (!res) return;
  if (!window.openNpcWorkView) {
    toast('NPC 工作台不可用', 'err');
    return;
  }
  window.openNpcWorkView(res.index != null && res.index >= 0 ? res.index : undefined);
}

function openResultScript() {
  const res = NPWZ.result;
  closeNpcWizard();
  if (!res) return;
  if (!window.openScriptView) {
    toast('脚本工作台不可用', 'err');
    return;
  }
  window.openScriptView({ tab: 'detail', name: res.scriptFile || res.script + '.py' });
}

function closeNpcWizard() {
  if (!NPWZ.els) return;
  NPWZ.els.mask.classList.add('hidden');
  NPWZ.visible = false;
  NPWZ.busy = false;
  NPWZ.dirty = false;
  NPWZ.result = null;
  NPWZ.preview = null;
  NPWZ.step = 1;
  npwzSetStatus('');
}

async function requestClose() {
  if (NPWZ.busy) return;
  if (!NPWZ.dirty) {
    closeNpcWizard();
    return;
  }
  const options = {
    title: '放弃新建 NPC？',
    message: '已填写的内容不会保存。',
    danger: true,
    okText: '放弃',
    cancelText: '继续编辑'
  };
  const ok = window.uiConfirm ? await window.uiConfirm(options) : window.confirm(options.message);
  if (ok) closeNpcWizard();
}

async function openNpcWizard(prefill) {
  npwzBuild();
  NPWZ.prefill = prefill && typeof prefill === 'object' ? prefill : null;
  NPWZ.result = null;
  NPWZ.preview = null;
  NPWZ.step = 1;
  npwzSetStatus('正在加载选项…');
  NPWZ.els.mask.classList.remove('hidden');
  NPWZ.visible = true;
  NPWZ.dirty = false;
  try {
    NPWZ.options = await api('/api/config/npcwork/create/options');
    npwzFillOptions();
    npwzResetForm();
    npwzGoalStep(1);
    npwzSetStatus('');
    const name = npwzEl('npwzName');
    if (name) setTimeout(() => name.focus(), 0);
  } catch (e) {
    closeNpcWizard();
    toast('加载新建 NPC 选项失败：' + e.message, 'err');
  }
}

window.openNpcWizard = openNpcWizard;

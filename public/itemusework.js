'use strict';

/* 物品使用触发工作台：可视化编辑 ItemCtrl.py 的 itemMap 与礼包内容 */

const IUW = {
  data: null,
  detail: null,
  item: '',
  filter: '',
  category: '全部',
  editing: null,
  loading: false,
  stale: true
};

function iuwEl(id) {
  return document.getElementById(id);
}

function iuwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function iuwText(id, text) {
  const el = iuwEl(id);
  if (el) el.textContent = text;
}

function iuwTag(text, cls) {
  return '<span class="npw-tag' + (cls ? ' ' + cls : '') + '">' + iuwEsc(text) + '</span>';
}

function iuwHashItem() {
  const m = /^#itemuse(?:=(.*))?$/.exec(location.hash || '');
  return m && m[1] ? decodeURIComponent(m[1]) : '';
}

function iuwSetHash(item) {
  try {
    const base = location.pathname + location.search;
    history.replaceState(null, '', base + (item ? '#itemuse=' + encodeURIComponent(item) : ''));
  } catch (e) {
  }
}

function iuwSpecs(func) {
  const schema = IUW.data && IUW.data.schema;
  return ((schema && schema[func]) || []).filter((s) => s.kind !== 'itemlist');
}

function iuwNeedsList(func) {
  const schema = IUW.data && IUW.data.schema;
  return ((schema && schema[func]) || []).some((s) => s.kind === 'itemlist');
}

function iuwFuncDesc(name) {
  const funcs = (IUW.data && IUW.data.funcs) || [];
  const found = funcs.find((f) => f.name === name);
  return (found && found.desc) || '';
}

function iuwFuncLabel(f) {
  const parts = [f.name];
  if (f.desc) parts.push('— ' + f.desc);
  if (!f.arityOk) parts.push('（参数数异常）');
  return parts.join(' ');
}

function iuwFillDatalists(data) {
  const items = iuwEl('itemList');
  if (items && Array.isArray(data.items)) {
    items.innerHTML = data.items.map((name) => '<option value="' + iuwEsc(name) + '"></option>').join('');
  }
  const maps = iuwEl('iuwMapCodeList');
  if (maps && Array.isArray(data.mapCodes)) {
    maps.innerHTML = data.mapCodes.map((code) => '<option value="' + iuwEsc(code) + '"></option>').join('');
  }
}

async function iuwLoad(force) {
  IUW.loading = true;
  try {
    const data = await api('/api/config/itemuse' + (force ? '?refresh=1' : ''));
    IUW.data = data;
    IUW.stale = false;
    iuwFillDatalists(data);
    iuwRenderCategories();
    iuwRenderList();
  } finally {
    IUW.loading = false;
  }
}

async function iuwLoadDetail(item, force) {
  if (!item) {
    IUW.detail = null;
    IUW.item = '';
    iuwRenderDetail();
    return;
  }
  iuwRenderDetail(null, '加载中...');
  try {
    IUW.detail = await api('/api/config/itemuse/detail?item=' + encodeURIComponent(item) +
      (force ? '&refresh=1' : ''));
    IUW.item = item;
    IUW.editing = null;
    iuwRenderDetail();
    iuwRenderList();
  } catch (e) {
    if (e.status === 404) {
      IUW.detail = null;
      IUW.item = '';
      iuwRenderDetail('该物品已不存在，可能已被删除或改名。');
      return;
    }
    throw e;
  }
}

function iuwSelect(item) {
  if (!item) return;
  if (item === IUW.item && IUW.detail) {
    IUW.editing = null;
    iuwRenderDetail();
    return;
  }
  iuwSetHash(item);
  iuwLoadDetail(item).catch((e) => toast('加载物品触发失败：' + e.message, 'err'));
}

function iuwRenderCategories() {
  const box = iuwEl('iuwCatFilter');
  if (!box) return;
  const d = IUW.data;
  if (!d) {
    box.innerHTML = '';
    return;
  }
  const cats = [{ name: '全部', count: (d.entries || []).length }].concat(d.categories || []);
  box.innerHTML = cats.map((c) =>
    '<button class="btn small' + (IUW.category === c.name ? ' active' : '') +
    '" data-iuw-cat="' + iuwEsc(c.name) + '">' + iuwEsc(c.name) + ' ' + c.count + '</button>'
  ).join('');
}

function iuwRenderList() {
  const box = iuwEl('iuwList');
  if (!box) return;
  const d = IUW.data;
  if (!d) {
    box.innerHTML = '';
    iuwText('iuwListHint', '尚未加载');
    return;
  }
  const q = IUW.filter.trim().toLowerCase();
  const entries = (d.entries || []).filter((e) => {
    if (IUW.category !== '全部' && e.category !== IUW.category) return false;
    if (!q) return true;
    return [e.item, e.func, e.category, e.summary].join(' ').toLowerCase().includes(q);
  });
  if (!entries.length) {
    box.innerHTML = '<li class="file-item"><div class="fmeta">没有匹配的物品</div></li>';
  } else {
    box.innerHTML = entries.map((e) => {
      const active = IUW.item === e.item ? ' active' : '';
      const badge = e.warningCount ? iuwTag(e.warningCount, 'warn') : '';
      return '<li class="file-item' + active + '" data-iuw-item="' + iuwEsc(e.item) + '">' +
        '<div class="fname">' + iuwEsc(e.item) + badge + '</div>' +
        '<div class="fmeta">' + iuwEsc(e.func + ' · ' + e.category) + '</div></li>';
    }).join('');
  }
  iuwText('iuwListHint', entries.length + ' / ' + (d.entries || []).length + ' 条' +
    (q || IUW.category !== '全部' ? '（已过滤）' : ''));
}

function iuwDefaultFunc() {
  const funcs = ((IUW.data && IUW.data.funcs) || []).filter((f) => f.name !== 'useItem');
  const preferred = funcs.find((f) => f.name === 'mobMonster');
  return (preferred || funcs[0] || {}).name || '';
}

function iuwDefaultValue(spec) {
  if (spec.kind === 'int') return spec.min == null ? '0' : String(spec.min);
  return '';
}

function iuwStartAdd() {
  const d = IUW.detail;
  if (!d || !d.supported) return;
  const func = iuwDefaultFunc();
  const params = {};
  for (const spec of iuwSpecs(func)) params[spec.key] = iuwDefaultValue(spec);
  IUW.editing = { mode: 'add', item: '', func, params, itemList: [] };
  iuwRenderDetail();
  const input = iuwEl('iuwItem');
  if (input) input.focus();
}

function iuwStartEdit() {
  const d = IUW.detail;
  if (!d) return;
  const params = {};
  for (const p of d.params || []) {
    params[p.key] = Array.isArray(p.value) ? p.value.join('\n') : String(p.value);
  }
  IUW.editing = {
    mode: 'update',
    func: d.func,
    params,
    itemList: (d.itemList || []).map((row) => ({ name: row.name, prop: row.prop, count: row.count }))
  };
  iuwRenderDetail();
}

function iuwCancelEdit() {
  IUW.editing = null;
  iuwRenderDetail();
}

function iuwSnapshot() {
  const editing = IUW.editing;
  if (!editing) return;
  const params = {};
  document.querySelectorAll('[data-iuw-param]').forEach((el) => {
    params[el.dataset.iuwParam] = el.value;
  });
  editing.params = params;
  const gift = document.querySelector('[data-iuw-gift]');
  if (gift) {
    const rows = [];
    gift.querySelectorAll('[data-iuw-row]').forEach((tr) => {
      const name = tr.querySelector('[data-iuw-row-name]');
      const prop = tr.querySelector('[data-iuw-row-prop]');
      const count = tr.querySelector('[data-iuw-row-count]');
      rows.push({
        name: name ? name.value : '',
        prop: prop ? prop.value : '1',
        count: count ? count.value : '1'
      });
    });
    editing.itemList = rows;
  }
  const itemInput = iuwEl('iuwItem');
  if (itemInput) editing.item = itemInput.value;
}

function iuwFuncOptions(selected) {
  const funcs = ((IUW.data && IUW.data.funcs) || []).filter((f) => f.name !== 'useItem');
  const groups = new Map();
  for (const f of funcs) {
    if (!groups.has(f.category)) groups.set(f.category, []);
    groups.get(f.category).push(f);
  }
  return [...groups.entries()].map(([name, list]) =>
    '<optgroup label="' + iuwEsc(name) + '">' +
    list.map((f) =>
      '<option value="' + iuwEsc(f.name) + '" title="' + iuwEsc(f.desc || f.name) + '"' +
      (f.name === selected ? ' selected' : '') + '>' +
      iuwEsc(iuwFuncLabel(f)) + '</option>'
    ).join('') + '</optgroup>'
  ).join('');
}

function iuwParamField(spec, value) {
  const label = iuwEsc(spec.key) + (spec.required ? ' *' : '');
  const attr = 'data-iuw-param="' + iuwEsc(spec.key) + '"';
  let control;
  if (spec.kind === 'int') {
    control = '<input ' + attr + ' type="number" min="' + (spec.min == null ? 0 : spec.min) +
      '" max="' + (spec.max == null ? 1000000000 : spec.max) + '" value="' + iuwEsc(value) + '">';
  } else if (spec.kind === 'list' || spec.kind === 'flex') {
    const text = Array.isArray(value) ? value.join('\n') : value;
    control = '<textarea class="field-textarea" ' + attr + ' rows="4" placeholder="每行一项">' +
      iuwEsc(text) + '</textarea>';
  } else {
    let list = '';
    if (spec.key === 'MonsterName') list = ' list="monsterList"';
    else if (spec.key === 'MapCode' || spec.key === 'UseMapCode') list = ' list="iuwMapCodeList"';
    control = '<input ' + attr + ' value="' + iuwEsc(value) + '"' + list + '>';
  }
  return '<div class="field"><label>' + label + '<span class="kind">' + iuwEsc(spec.kind) + '</span></label>' +
    control + '</div>';
}

function iuwGiftHtml(rows) {
  const body = rows.map((row, index) =>
    '<tr data-iuw-row="' + index + '">' +
    '<td><input data-iuw-row-name list="itemList" value="' + iuwEsc(row.name) + '" placeholder="物品名"></td>' +
    '<td class="num"><input data-iuw-row-prop type="number" min="1" value="' + iuwEsc(row.prop) + '"></td>' +
    '<td class="num"><input data-iuw-row-count type="number" min="1" value="' + iuwEsc(row.count) + '"></td>' +
    '<td><button class="btn small ghost" data-iuw-act="row-del" data-row="' + index + '">删除</button></td>' +
    '</tr>'
  ).join('');
  return '<div data-iuw-gift><div class="iuw-gift-wrap"><table class="iuw-gift-table">' +
    '<thead><tr><th>礼包物品</th><th>权重</th><th>数量</th><th></th></tr></thead><tbody>' +
    (body || '<tr><td colspan="4" class="muted">还没有礼包物品，至少需要一行</td></tr>') +
    '</tbody></table></div>' +
    '<div class="nbw-actions"><button class="btn small" data-iuw-act="row-add">添加礼包物品</button>' +
    '<span class="muted">「经验」是特殊奖励，可直接填写</span></div></div>';
}

function iuwFormHtml(d) {
  const editing = IUW.editing;
  const adding = editing.mode === 'add';
  const specs = iuwSpecs(editing.func);
  const needsList = iuwNeedsList(editing.func);
  const itemField = adding
    ? '<div class="field"><label>物品名</label><input id="iuwItem" list="itemList" value="' +
      iuwEsc(editing.item) + '" placeholder="输入或选择 stditems 物品"></div>'
    : '<div class="field"><label>物品名</label><div class="nbw-static">' +
      iuwEsc(d.item) + '（第 ' + d.line + ' 行）</div></div>';
  return '<div class="nbw-section">' +
    '<div class="nbw-section-head"><h4>' + (adding ? '新增物品使用触发' : '编辑「' + iuwEsc(d.item) + '」') + '</h4>' +
    '<span class="muted">使用物品时执行 FuncName 指向的函数</span></div>' +
    '<div class="form-grid">' + itemField +
    '<div class="field"><label>效果函数</label><select id="iuwFunc">' +
    (iuwFuncOptions(editing.func) || '<option value="">（没有可用函数）</option>') + '</select>' +
    (iuwFuncDesc(editing.func)
      ? '<div class="iuw-func-desc">' + iuwEsc(iuwFuncDesc(editing.func)) + '</div>'
      : '') + '</div>' +
    specs.map((spec) => iuwParamField(spec, editing.params[spec.key] == null ? '' : editing.params[spec.key])).join('') +
    '</div>' +
    (needsList ? '<div class="nbw-note">礼包内容：权重越大越容易抽到，数量是发放个数。</div>' +
      iuwGiftHtml(editing.itemList || []) : '') +
    '<div class="nbw-actions">' +
    '<button class="btn primary" data-iuw-act="save">' + (adding ? '添加触发' : '保存修改') + '</button>' +
    '<button class="btn" data-iuw-act="cancel">取消</button>' +
    '</div></div>';
}

function iuwValueText(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value == null ? '' : value);
}

function iuwFieldsHtml(d) {
  const rows = (d.fields || []).map((f) =>
    '<tr><td class="namecell">' + iuwEsc(f.key) + '</td>' +
    '<td class="str">' + iuwEsc(iuwValueText(f.value)) + '</td>' +
    '<td class="num">' + f.line + (f.endLine !== f.line ? '–' + f.endLine : '') + '</td>' +
    '<td class="str">' + iuwEsc(f.suffix) + '</td></tr>'
  ).join('');
  return '<div class="nbw-table-wrap iuw-fields"><table>' +
    '<thead><tr><th>字段</th><th>值</th><th>行</th><th>行尾</th></tr></thead><tbody>' +
    rows + '</tbody></table></div>';
}

function iuwGiftReadonlyHtml(d) {
  if (!d.itemList || !d.itemList.length) return '';
  const rows = d.itemList.map((row) =>
    '<tr><td class="namecell">' + iuwEsc(row.name) + '</td>' +
    '<td class="num">' + iuwEsc(row.prop) + '</td>' +
    '<td class="num">' + iuwEsc(row.count) + '</td></tr>'
  ).join('');
  return '<div class="nbw-section"><div class="nbw-section-head"><h4>礼包内容</h4>' +
    '<span class="muted">' + d.itemList.length + ' 行</span></div>' +
    '<div class="nbw-table-wrap"><table><thead><tr><th>物品</th><th>权重</th><th>数量</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div></div>';
}

function iuwBanners(d) {
  const out = [];
  for (const warning of d.fileWarnings || []) {
    if (String(warning).includes('是旧副本')) continue;
    out.push('<div class="nbw-banner bad">' + iuwEsc(warning) + '</div>');
  }
  for (const warning of d.warnings || []) {
    out.push('<div class="nbw-banner warn">' + iuwEsc(warning) + '</div>');
  }
  return out.join('');
}

function iuwStaleBanner(d) {
  const s = d.staleCopy;
  if (!s || !s.exists) return '';
  if (s.error) {
    return '<div class="nbw-banner warn">旧副本 ' + iuwEsc(s.file) + ' 读取失败：' + iuwEsc(s.error) + '</div>';
  }
  if (s.itemMapIdentical) {
    return '<div class="nbw-banner">旧副本 ' + iuwEsc(s.file) + ' 的 itemMap 与根文件一致，但本工作台只写根目录 ItemCtrl.py。</div>';
  }
  return '<div class="nbw-banner warn">旧副本 ' + iuwEsc(s.file) + ' 与根文件的 itemMap 不一致；本工作台只写根目录 ItemCtrl.py。</div>';
}

function iuwPeersHtml(d) {
  if (!d.magicPeers || !d.magicPeers.length) return '';
  const rows = d.magicPeers.map((peer) => {
    if (!peer.exists) return '<li>' + iuwEsc(peer.file) + '：不存在</li>';
    if (peer.error) return '<li>' + iuwEsc(peer.file) + '：解析失败 ' + iuwEsc(peer.error) + '</li>';
    const notes = [];
    if (peer.missingHere && peer.missingHere.length) notes.push('本文件缺少 ' + peer.missingHere.length + ' 条（' + peer.missingHere.join('、') + '）');
    if (peer.missingThere && peer.missingThere.length) notes.push('副本缺少 ' + peer.missingThere.length + ' 条（' + peer.missingThere.join('、') + '）');
    if (peer.diffs && peer.diffs.length) notes.push('值不同 ' + peer.diffs.length + ' 条（' + peer.diffs.join('、') + '）');
    return '<li>' + iuwEsc(peer.file) + '：' + (notes.length ? iuwEsc(notes.join('；')) : '与当前 MAGICMAP 一致') + '</li>';
  }).join('');
  return '<div class="nbw-note">副本差异：<ul class="iuw-peer-list">' + rows + '</ul></div>';
}

function iuwMagicHtml(d) {
  if (!d.magic) return '';
  if (d.magic.error) {
    return '<div class="nbw-section"><div class="nbw-section-head"><h4>MAGICMAP 技能条件（只读）</h4></div>' +
      '<div class="nbw-banner warn">解析失败：' + iuwEsc(d.magic.error) + '</div></div>';
  }
  const rows = (d.magic.entries || []).map((e) =>
    '<tr><td class="namecell">' + iuwEsc(e.key) + '</td>' +
    '<td class="str">' + iuwEsc(e.SkillName) + '</td>' +
    '<td class="num">' + iuwEsc(e.needJob) + '</td>' +
    '<td class="num">' + iuwEsc(e.needLevel) + '</td>' +
    '<td class="str">' + iuwEsc(iuwValueText(e.preSkill == null ? '' : e.preSkill)) + '</td>' +
    '<td class="str">' + iuwEsc(iuwValueText(e.nopreSkill == null ? '' : e.nopreSkill)) + '</td>' +
    '<td class="num">' + e.line + '</td></tr>'
  ).join('');
  return '<div class="nbw-section"><div class="nbw-section-head"><h4>MAGICMAP 技能条件（只读）</h4>' +
    '<span class="muted">' + (d.magic.entries || []).length + ' 条 · jineng 按物品 RealName 查表</span></div>' +
    iuwPeersHtml(d) +
    '<div class="nbw-table-wrap iuw-magic"><table><thead><tr><th>物品</th><th>技能</th><th>职业</th>' +
    '<th>等级</th><th>前置技能</th><th>无前置</th><th>行</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function iuwDetailCard(d) {
  const funcDesc = iuwFuncDesc(d.func);
  const tags = [iuwTag(d.category, 'task')];
  if (d.closesDict) tags.push(iuwTag('itemMap 末条', 'task'));
  const buttons = '<button class="btn small" data-iuw-act="edit">编辑</button> ' +
    '<button class="btn small ghost" data-iuw-act="delete">删除</button>';
  return '<div class="nbw-section">' +
    '<div class="nbw-section-head"><h4>' + iuwEsc(d.item) + '</h4>' + tags.join(' ') +
    '<span class="spacer"></span>' + buttons + '</div>' +
    '<div class="nbw-note">第 ' + d.startLine + '–' + d.endLine + ' 行 · ' + iuwEsc(d.func) +
    (funcDesc ? ' — ' + iuwEsc(funcDesc) : '') +
    ' · ' + iuwEsc(d.summary || '') + '</div>' +
    iuwFieldsHtml(d) + '</div>';
}

function iuwRenderDetail(errorText, loadingText) {
  const box = iuwEl('iuwBody');
  if (!box) return;
  iuwText('iuwMeta', IUW.item ? IUW.item : '未选择物品');
  if (loadingText) {
    box.innerHTML = '<div class="nbw-intro">' + iuwEsc(loadingText) + '</div>';
    return;
  }
  if (errorText) {
    box.innerHTML = '<div class="nbw-intro">' + iuwEsc(errorText) + '</div>';
    return;
  }
  const d = IUW.detail;
  const list = IUW.data;
  if (!d) {
    const summary = list ? list.entries.length + ' 条物品使用触发 · ' + list.funcs.length +
      ' 个效果函数' + (list.magic ? ' · MAGICMAP ' + list.magic.count + ' 条' : '') : '';
    box.innerHTML = '<div class="nbw-intro">' +
      '<div class="npw-intro-title">物品使用触发</div>' +
      '<p>左侧选择物品后，可查看和修改使用该物品时执行的效果函数、参数与礼包内容。</p>' +
      '<p>数据来自 <code>NPCScript/ItemCtrl.py</code> 的 <code>itemMap</code>：使用物品 → eval(FuncName) 执行效果函数。</p>' +
      '<p>' + iuwEsc(summary) + '。只写根目录 ItemCtrl.py，GBK/CRLF 保持原样，每次写入前自动备份。</p></div>';
    return;
  }
  if (!d.supported) {
    box.innerHTML = '<div class="nbw-banner bad">该脚本无法安全编辑：' +
      iuwEsc((d.fileWarnings || []).join('；') || '结构异常') + '</div>';
    return;
  }
  const meta = (IUW.data ? IUW.data.entries.length + ' 条 · ' + IUW.data.funcs.length + ' 个函数' : '') +
    ' · ' + d.eol + (d.trailing ? ' · 末尾换行' : ' · 无末尾换行');
  const activeFunc = IUW.editing ? IUW.editing.func : d.func;
  box.innerHTML = '<div class="nbw-detail">' +
    iuwStaleBanner(d) +
    iuwBanners(d) +
    ((d.quirks || []).length ? '<div class="nbw-banner warn"><div>' +
      d.quirks.map((q) => iuwEsc((q.line ? '第 ' + q.line + ' 行：' : '') + q.text)).join('<br>') +
      '</div></div>' : '') +
    '<div class="nbw-toolbar"><span class="muted">' + iuwEsc(meta) + '</span><span class="spacer"></span>' +
    '<button class="btn primary" data-iuw-act="add">新增触发</button></div>' +
    (IUW.editing ? iuwFormHtml(d) : iuwDetailCard(d)) +
    (IUW.editing ? '' : iuwGiftReadonlyHtml(d)) +
    (activeFunc === 'jineng' ? iuwMagicHtml(d) : '') +
    '</div>';
}

function iuwBuildParams(func, editing) {
  const params = {};
  const schema = ((IUW.data && IUW.data.schema) || {})[func] || [];
  for (const spec of schema) {
    if (spec.kind === 'itemlist') continue;
    const raw = editing.params[spec.key];
    if (spec.kind === 'list' || spec.kind === 'flex') {
      const values = String(raw == null ? '' : raw).split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
      if (values.length) params[spec.key] = values;
      else if (spec.required) throw new Error('参数 ' + spec.key + ' 至少需要一项');
    } else if (spec.kind === 'int') {
      const text = String(raw == null ? '' : raw).trim();
      if (text === '') {
        if (spec.required) throw new Error('参数 ' + spec.key + ' 不能为空');
      } else {
        const n = Number(text);
        if (!Number.isInteger(n)) throw new Error('参数 ' + spec.key + ' 必须是整数');
        params[spec.key] = n;
      }
    } else {
      const text = String(raw == null ? '' : raw).trim();
      if (text || spec.required) params[spec.key] = text;
    }
  }
  return params;
}

async function iuwSave() {
  const d = IUW.detail;
  const editing = IUW.editing;
  if (!d || !editing) return;
  iuwSnapshot();
  let params;
  let itemList = [];
  try {
    params = iuwBuildParams(editing.func, editing);
    if (iuwNeedsList(editing.func)) {
      itemList = (editing.itemList || []).map((row) => ({
        name: String(row.name == null ? '' : row.name).trim(),
        prop: Number(row.prop),
        count: Number(row.count)
      })).filter((row) => row.name);
      if (!itemList.length) throw new Error('礼包至少需要一行有效物品');
    }
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  let op;
  let target;
  if (editing.mode === 'add') {
    target = String(editing.item || '').trim();
    if (!target) return toast('请填写物品名', 'err');
    op = { op: 'add', item: target, func: editing.func, params, itemList };
  } else {
    target = d.item;
    op = {
      op: 'update',
      item: d.item,
      keyLine: d.keyLine,
      expectKey: d.rawKeyLine,
      changes: { func: editing.func, params, itemList }
    };
  }
  try {
    const r = await api('/api/config/itemuse/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: d.file, hash: d.hash, ops: [op] })
    });
    if (r.changed === false) toast('没有实际修改，未写入文件', 'ok');
    else toast(/^add$/.test(op.op) ? '已添加「' + target + '」' + (r.backup ? '，备份：' + r.backup : '')
      : '已保存' + (r.backup ? '，备份：' + r.backup : ''), 'ok');
    await iuwLoad(true);
    await iuwLoadDetail(target);
  } catch (e) {
    if (e.status === 409) {
      toast('脚本已被外部修改，已重新加载，请确认后再保存', 'err');
      await iuwLoad(true);
      await iuwLoadDetail(target).catch(() => {});
      return;
    }
    toast('保存失败：' + e.message, 'err');
  }
}

async function iuwDelete() {
  const d = IUW.detail;
  if (!d) return;
  if (!confirm('确定删除「' + d.item + '」的使用触发？\n\n只会删除 itemMap 中的这一条，其他条目与函数不动；写入前自动备份。')) return;
  try {
    const r = await api('/api/config/itemuse/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: d.file,
        hash: d.hash,
        ops: [{ op: 'delete', item: d.item, keyLine: d.keyLine, expectKey: d.rawKeyLine }]
      })
    });
    toast('已删除「' + d.item + '」' + (r.backup ? '，备份：' + r.backup : ''), 'ok');
    IUW.editing = null;
    IUW.detail = null;
    IUW.item = '';
    iuwSetHash('');
    await iuwLoad(true);
    const entries = (IUW.data && IUW.data.entries) || [];
    if (entries.length) await iuwLoadDetail(entries[0].item);
    else iuwRenderDetail();
  } catch (e) {
    if (e.status === 409) {
      toast('脚本已被外部修改，已重新加载，请确认后再删除', 'err');
      await iuwLoad(true);
      await iuwLoadDetail(d.item).catch(() => {});
      return;
    }
    toast('删除失败：' + e.message, 'err');
  }
}

async function openItemUseView(sel) {
  if (S.mode !== 'itemuse' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'itemuse';
  if (typeof hideAllViews === 'function') hideAllViews();
  if (window.hideNpcBuyView) window.hideNpcBuyView();
  const view = iuwEl('itemUseView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('itwu');
  IUW.editing = null;
  const hashItem = iuwHashItem();
  const target = typeof sel === 'string' && sel ? sel : hashItem;
  try {
    if (!IUW.data || IUW.stale) await iuwLoad();
  } catch (e) {
    toast('加载物品使用触发失败：' + e.message, 'err');
    iuwRenderDetail('加载失败：' + e.message);
    return;
  }
  iuwRenderList();
  if (target) {
    if (target === IUW.item && IUW.detail) iuwRenderDetail();
    else await iuwLoadDetail(target);
  } else if (IUW.data.entries && IUW.data.entries.length) {
    await iuwLoadDetail(IUW.data.entries[0].item);
  } else {
    iuwRenderDetail();
  }
}

window.openItemUseView = openItemUseView;
window.hideItemUseView = () => {
  const view = iuwEl('itemUseView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && iuwHashItem()) iuwSetHash('');
};
window.refreshItemUseState = () => {
  IUW.stale = true;
};

function iuwBindEvents() {
  const filter = iuwEl('iuwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      IUW.filter = filter.value;
      iuwRenderList();
    });
  }

  const cats = iuwEl('iuwCatFilter');
  if (cats) {
    cats.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-iuw-cat]');
      if (!btn) return;
      IUW.category = btn.dataset.iuwCat;
      iuwRenderCategories();
      iuwRenderList();
    });
  }

  const list = iuwEl('iuwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const item = e.target.closest('[data-iuw-item]');
      if (!item) return;
      iuwSelect(item.dataset.iuwItem);
    });
  }

  const reload = iuwEl('btnIuwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      try {
        await iuwLoad(true);
        if (IUW.item) await iuwLoadDetail(IUW.item, true);
        else if (IUW.data.entries && IUW.data.entries.length) await iuwLoadDetail(IUW.data.entries[0].item, true);
        else iuwRenderDetail();
        toast('已重新检查', 'ok');
      } catch (e) {
        toast('重新检查失败：' + e.message, 'err');
      }
    });
  }

  const view = iuwEl('itemUseView');
  if (view) {
    view.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-iuw-act]');
      if (!btn) return;
      const act = btn.dataset.iuwAct;
      if (act === 'add') iuwStartAdd();
      else if (act === 'edit') iuwStartEdit();
      else if (act === 'cancel') iuwCancelEdit();
      else if (act === 'save') iuwSave();
      else if (act === 'delete') iuwDelete();
      else if (act === 'row-add') {
        iuwSnapshot();
        IUW.editing.itemList.push({ name: '', prop: 1, count: 1 });
        iuwRenderDetail();
      } else if (act === 'row-del') {
        iuwSnapshot();
        const index = Number(btn.dataset.row);
        if (Number.isInteger(index)) IUW.editing.itemList.splice(index, 1);
        iuwRenderDetail();
      }
    });
    view.addEventListener('change', (e) => {
      if (!e.target || e.target.id !== 'iuwFunc' || !IUW.editing) return;
      iuwSnapshot();
      const nextFunc = e.target.value;
      if (nextFunc === IUW.editing.func) return;
      const previous = IUW.editing.params || {};
      const params = {};
      for (const spec of iuwSpecs(nextFunc)) {
        params[spec.key] = previous[spec.key] == null ? iuwDefaultValue(spec) : previous[spec.key];
      }
      IUW.editing.func = nextFunc;
      IUW.editing.params = params;
      if (!iuwNeedsList(nextFunc)) IUW.editing.itemList = [];
      iuwRenderDetail();
    });
  }
}

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(iuwBindEvents).catch(iuwBindEvents);
} else {
  document.addEventListener('DOMContentLoaded', iuwBindEvents);
}

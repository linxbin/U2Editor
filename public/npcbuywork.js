'use strict';

/* NPC 购买菜单工作台：可视化增删改脚本里的通用购买项与价目 */

const NBW = {
  data: null,
  detail: null,
  file: '',
  filter: '',
  entryFilter: '',
  editing: null,
  loading: false,
  detailLoading: false,
  stale: true
};

const NBW_GOLD_UNIT = 1000000;

function nbwEl(id) {
  return document.getElementById(id);
}

function nbwEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nbwText(id, text) {
  const el = nbwEl(id);
  if (el) el.textContent = text;
}

function nbwTag(text, cls) {
  return '<span class="npw-tag' + (cls ? ' ' + cls : '') + '">' + nbwEsc(text) + '</span>';
}

function nbwGold(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n) * NBW_GOLD_UNIT;
  return v >= 10000 ? Math.round(v).toLocaleString('zh-CN') : String(Math.round(v));
}

function nbwHashFile() {
  const m = /^#npcbuy(?:=(.*))?$/.exec(location.hash || '');
  return m && m[1] ? decodeURIComponent(m[1]) : '';
}

function nbwSetHash(file) {
  try {
    const base = location.pathname + location.search;
    history.replaceState(null, '', base + (file ? '#npcbuy=' + encodeURIComponent(file) : ''));
  } catch (e) {
  }
}

function nbwFillItems(items) {
  const dl = nbwEl('itemList');
  if (!dl || !Array.isArray(items)) return;
  dl.innerHTML = items.map((name) => '<option value="' + nbwEsc(name) + '"></option>').join('');
}

async function nbwLoad(force) {
  NBW.loading = true;
  try {
    const data = await api('/api/config/npcbuy' + (force ? '?refresh=1' : ''));
    NBW.data = data;
    NBW.stale = false;
    nbwFillItems(data.items);
    nbwRenderList();
  } finally {
    NBW.loading = false;
  }
}

async function nbwLoadDetail(file) {
  NBW.detailLoading = true;
  nbwRenderDetail(null, '加载中...');
  try {
    NBW.detail = await api('/api/config/npcbuy/detail?file=' + encodeURIComponent(file));
    NBW.file = file;
    NBW.editing = null;
    nbwRenderDetail();
    nbwRenderList();
  } finally {
    NBW.detailLoading = false;
  }
}

function nbwFileLabel(item) {
  const parts = [];
  if (item.npcs) parts.push(item.npcs + ' 个 NPC');
  if (item.maps && item.maps.length) parts.push(item.maps.join('、'));
  else if (item.importedBy && item.importedBy.length) parts.push('被 ' + item.importedBy.length + ' 个脚本引用');
  else parts.push('未挂载');
  parts.push(item.purchases + ' 个购买项');
  return parts.join(' · ');
}

function nbwRenderList() {
  const box = nbwEl('nbwList');
  if (!box) return;
  const d = NBW.data;
  if (!d) {
    box.innerHTML = '';
    nbwText('nbwListHint', '尚未加载');
    return;
  }
  const q = NBW.filter.trim().toLowerCase();
  const files = (d.files || []).filter((f) => {
    if (!q) return true;
    return [f.file, f.base, ...(f.maps || []), ...(f.importedBy || [])]
      .join(' ').toLowerCase().includes(q);
  });
  box.innerHTML = files.map((f) => {
    const active = NBW.file === f.file ? ' active' : '';
    const badge = f.warnings ? nbwTag(f.warnings, 'warn') : '';
    return '<li class="file-item' + active + '" data-nbw-file="' + nbwEsc(f.file) + '">' +
      '<div class="fname">' + nbwEsc(f.file) + badge + '</div>' +
      '<div class="fmeta">' + nbwEsc(nbwFileLabel(f)) + '</div></li>';
  }).join('');
  nbwText('nbwListHint', files.length + ' 个脚本可编辑' + (q ? '（已过滤）' : ''));
}

function nbwSelect(file) {
  if (!file || file === NBW.file) {
    if (file && NBW.detail) nbwRenderDetail();
    return;
  }
  nbwSetHash(file);
  nbwLoadDetail(file).catch((e) => toast('加载脚本失败：' + e.message, 'err'));
}

function nbwStartAdd() {
  const d = NBW.detail;
  if (!d || !d.supported) return;
  const page = (d.pages.find((p) => p.name === 'main') || d.pages[0] || {}).name || '';
  NBW.editing = { mode: 'add', page, item: '', label: '', count: 1, price: 1 };
  nbwRenderDetail();
  const input = nbwEl('nbwItem');
  if (input) input.focus();
}

function nbwStartEdit(entry) {
  NBW.editing = {
    mode: 'update',
    entry,
    label: entry.generated ? (entry.menuLabel || entry.label) : entry.label,
    count: Number(entry.count) || 1,
    price: entry.price == null ? 1 : Number(entry.price)
  };
  nbwRenderDetail();
  const input = nbwEl('nbwLabel');
  if (input) input.focus();
}

function nbwCancelEdit() {
  NBW.editing = null;
  nbwRenderDetail();
}

function nbwFormHtml(d) {
  const editing = NBW.editing;
  const adding = editing && editing.mode === 'add';
  const updating = editing && editing.mode === 'update';
  const entry = updating ? editing.entry : null;
  const page = adding ? editing.page : (entry ? entry.page : '');
  const label = adding ? editing.label : (entry ? (entry.generated ? (entry.menuLabel || entry.label) : entry.label) : '');
  const item = adding ? editing.item : (entry ? entry.item : '');
  const count = adding ? editing.count : (entry ? entry.count : 1);
  const price = adding ? editing.price : (entry ? entry.price : 1);
  const pageOptions = (d.pages || []).map((p) =>
    '<option value="' + nbwEsc(p.name) + '" title="' + nbwEsc(p.desc || '') + '"' +
    (p.name === page ? ' selected' : '') + '>' +
    nbwEsc(p.name + (p.desc ? ' · ' + p.desc : '') +
      (p.purchases ? '（已有 ' + p.purchases + ' 个购买项）' : '')) + '</option>'
  ).join('');
  const head = updating
    ? '编辑购买项' + nbwTag(entry.generated ? '生成页' : '手写页', entry.generated ? 'task' : '')
    : '新增购买项';
  const pageInfo = (d.pages || []).find((p) => p.name === page);
  const pageText = page + (pageInfo && pageInfo.desc ? ' · ' + pageInfo.desc : '');
  const pagesField = updating
    ? '<div class="field"><label>菜单页</label><div class="nbw-static">' + nbwEsc(pageText) + '</div></div>'
    : '<div class="field"><label>菜单页</label><select id="nbwPage">' +
      (pageOptions || '<option value="">（无可用菜单页）</option>') + '</select></div>';
  const itemField = updating
    ? '<div class="field"><label>物品</label><div class="nbw-static">' + nbwEsc(item) + '</div></div>'
    : '<div class="field"><label>物品</label><input id="nbwItem" list="itemList" value="' + nbwEsc(item) + '" placeholder="输入或选择 stditems 物品"></div>';
  const priceHint = entry && entry.price == null ? '（当前物品还没有价目，保存时会新增）' : '';
  const extra = updating && entry && entry.generated
    ? '<div class="nbw-note">此购买项由「菜单入口 + 自动购买页」组成，删除时会一并移除入口和购买页。</div>'
    : '';
  return '<div class="nbw-section">' +
    '<div class="nbw-section-head"><h4>' + head + '</h4>' +
    '<span class="muted">单价按物品统一，金币模式由脚本自动折算</span></div>' +
    '<div class="form-grid">' +
    pagesField +
    '<div class="field"><label>菜单文字</label><input id="nbwLabel" value="' + nbwEsc(label) +
    '" maxlength="40" placeholder="例如：购买祝福油罐"></div>' +
    itemField +
    '<div class="field"><label>数量</label><input id="nbwCount" type="number" min="1" max="9999" value="' + nbwEsc(count) + '"></div>' +
    '<div class="field"><label>单价（元宝/个）' + nbwEsc(priceHint) + '</label>' +
    '<input id="nbwPrice" type="number" min="0.01" step="0.01" value="' + nbwEsc(price) + '"></div>' +
    '</div>' +
    extra +
    '<div class="nbw-actions">' +
    '<button class="btn primary" data-nbw-act="save">' + (updating ? '保存修改' : '添加购买项') + '</button>' +
    '<button class="btn" data-nbw-act="cancel">取消</button>' +
    '</div></div>';
}

function nbwEntriesHtml(d) {
  const q = NBW.entryFilter.trim().toLowerCase();
  const entries = (d.entries || []).filter((e) => {
    if (!q) return true;
    return [e.page, e.item, e.count, e.menuLabel, e.label].join(' ').toLowerCase().includes(q);
  });
  if (!entries.length) {
    return '<div class="tsk-empty">' + ((d.entries || []).length ? '没有匹配的购买项' : '脚本里还没有购买项，可用上方表单新增') + '</div>';
  }
  const descByPage = new Map((d.pages || []).map((p) => [p.name, p.desc || '']));
  const rows = entries.map((e) => {
    const label = e.generated ? e.menuLabel || e.label : e.label;
    const tags = [];
    for (const w of e.warnings || []) tags.push(nbwTag(w, 'warn'));
    if (e.generated && !e.menuLinks.length) tags.push(nbwTag('入口缺失', 'bad'));
    return '<tr data-nbw-entry="' + nbwEsc(e.id) + '">' +
      '<td class="str" title="' + nbwEsc(descByPage.get(e.page) || '') + '">' + nbwEsc(e.page) + '</td>' +
      '<td class="str">' + nbwEsc(label) + '</td>' +
      '<td class="namecell">' + nbwEsc(e.item) + '</td>' +
      '<td class="num">' + nbwEsc(e.count) + '</td>' +
      '<td class="num">' + (e.price == null ? '—' : nbwEsc(e.price)) + '</td>' +
      '<td class="num">' + (e.price == null ? '—' : nbwEsc(e.total)) + '</td>' +
      '<td class="num">≈ ' + nbwGold(e.total) + '</td>' +
      '<td class="col-idx">' + (e.line + 1) + '</td>' +
      '<td>' + (tags.join(' ') || '<span class="muted">—</span>') + '</td>' +
      '<td><button class="btn small" data-nbw-act="edit" data-id="' + nbwEsc(e.id) + '">编辑</button> ' +
      '<button class="btn small ghost" data-nbw-act="delete" data-id="' + nbwEsc(e.id) + '">删除</button></td>' +
      '</tr>';
  }).join('');
  return '<div class="nbw-table-wrap"><table>' +
    '<thead><tr><th>菜单页</th><th>菜单文字</th><th>物品</th><th>数量</th><th>单价<span class="th-cn">元宝</span></th>' +
    '<th>合计<span class="th-cn">元宝</span></th><th>金币折算</th><th>行</th><th>提示</th><th>操作</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

function nbwPrizesHtml(d) {
  if (!d.prizes || !d.prizes.length) return '<div class="tsk-empty">没有价目</div>';
  const rows = d.prizes.map((p) => {
    const dup = p.closing ? nbwTag('末行含 }', 'warn') : '';
    return '<tr><td class="namecell">' + nbwEsc(p.key) + '</td>' +
      '<td class="num">' + nbwEsc(p.value) + '</td>' +
      '<td class="num">' + p.used + '</td>' +
      '<td class="num">' + (p.line + 1) + '</td>' +
      '<td>' + (dup || '<span class="muted">—</span>') + '</td></tr>';
  }).join('');
  return '<div class="nbw-table-wrap"><table>' +
    '<thead><tr><th>物品</th><th>单价<span class="th-cn">元宝</span></th><th>引用</th><th>行</th><th>提示</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

function nbwRenderDetail(errorText, loadingText) {
  const box = nbwEl('nbwBody');
  if (!box) return;
  nbwText('nbwMeta', NBW.file ? NBW.file : '未选择脚本');
  if (loadingText) {
    box.innerHTML = '<div class="nbw-intro">' + nbwEsc(loadingText) + '</div>';
    return;
  }
  if (errorText) {
    box.innerHTML = '<div class="nbw-intro">' + nbwEsc(errorText) + '</div>';
    return;
  }
  const d = NBW.detail;
  if (!d) {
    box.innerHTML = '<div class="nbw-intro">' +
      '<div class="npw-intro-title">NPC 购买菜单</div>' +
      '<p>左侧选择脚本后，可查看并增删改 NPC 对话里的购买项。</p>' +
      '<p>目前支持自带 <code>PRIZEMAP</code> 价表和 <code>popnewchange</code> 通用购买函数的脚本（红袖 ComSleev、丹药 dan）。</p>' +
      '<p>新增购买项会生成独立购买页，并自动补价目表；所有写入都会先备份脚本。</p></div>';
    return;
  }
  if (!d.supported) {
    box.innerHTML = '<div class="nbw-banner bad">该脚本不支持购买菜单编辑：' + nbwEsc((d.warnings || []).join('；') || '缺少购买机制') + '</div>';
    return;
  }
  const banners = [];
  if (d.sharing && d.sharing.npcs) {
    banners.push('<div class="nbw-banner">该脚本被 <strong>' + d.sharing.npcs + '</strong> 个 NPC 共用（' +
      nbwEsc((d.sharing.maps || []).join('、')) + '），保存会同时影响这些 NPC。</div>');
  }
  if (d.duplicate) {
    banners.push('<div class="nbw-banner warn">这是同名脚本副本，可能不会被游戏加载，请确认是否编辑。</div>');
  }
  if (d.sharing && d.sharing.importedBy && d.sharing.importedBy.length) {
    banners.push('<div class="nbw-banner">被其他脚本引用：' + nbwEsc(d.sharing.importedBy.join('、')) + '</div>');
  }
  const meta = d.entries.length + ' 个购买项 · ' + d.pages.length + ' 个菜单页 · ' + d.eol +
    (d.trailing ? ' · 末尾换行' : ' · 无末尾换行');
  box.innerHTML = '<div class="nbw-detail">' +
    banners.join('') +
    '<div class="nbw-toolbar"><span class="muted">' + nbwEsc(meta) + '</span><span class="spacer"></span>' +
    '<button class="btn primary" data-nbw-act="add">新增购买项</button></div>' +
    (NBW.editing ? nbwFormHtml(d) : '') +
    '<div class="nbw-section"><div class="nbw-section-head"><h4>购买项</h4>' +
    '<input id="nbwEntryFilter" class="filter" placeholder="过滤物品 / 菜单页..." value="' + nbwEsc(NBW.entryFilter) + '">' +
    '</div>' + nbwEntriesHtml(d) + '</div>' +
    '<div class="nbw-section"><div class="nbw-section-head"><h4>价目表 PRIZEMAP</h4>' +
    '<span class="muted">删除购买项时，若物品无其他购买入口会一并清理价目</span></div>' +
    nbwPrizesHtml(d) + '</div>' +
    '</div>';
}

function nbwFindEntry(id) {
  const d = NBW.detail;
  if (!d) return null;
  return (d.entries || []).find((e) => e.id === id) || null;
}

async function nbwSaveForm() {
  const d = NBW.detail;
  const editing = NBW.editing;
  if (!d || !editing) return;
  const labelInput = nbwEl('nbwLabel');
  const countInput = nbwEl('nbwCount');
  const priceInput = nbwEl('nbwPrice');
  let label = labelInput ? labelInput.value.trim() : '';
  const count = countInput ? Number(countInput.value) : 0;
  const price = priceInput ? Number(priceInput.value) : 0;
  if (editing.mode === 'add') {
    const itemInput = nbwEl('nbwItem');
    const pageInput = nbwEl('nbwPage');
    const item = itemInput ? itemInput.value.trim() : '';
    const page = pageInput ? pageInput.value : '';
    if (!page) return toast('请选择菜单页', 'err');
    if (!item) return toast('请选择物品', 'err');
    if (!label) label = '购买' + item;
    try {
      const r = await api('/api/config/npcbuy/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: d.file, hash: d.hash, ops: [{ op: 'add', page, item, count, price, label }] })
      });
      toast('已添加「' + label + '」' + (r.backup ? '，备份：' + r.backup : ''), 'ok');
      await nbwLoad(true);
      await nbwLoadDetail(d.file);
    } catch (e) {
      toast('保存失败：' + e.message, 'err');
    }
    return;
  }
  const entry = editing.entry;
  if (!label) return toast('菜单文字不能为空', 'err');
  try {
    const r = await api('/api/config/npcbuy/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: d.file,
        hash: d.hash,
        ops: [{ op: 'update', line: entry.line, tokenStart: entry.tokenStart, expect: entry.raw, label, count, price }]
      })
    });
    toast('已保存' + (r.backup ? '，备份：' + r.backup : ''), 'ok');
    if (r.warning) toast(r.warning, 'err');
    await nbwLoad(true);
    await nbwLoadDetail(d.file);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
  }
}

async function nbwDeleteEntry(entry) {
  const d = NBW.detail;
  if (!d || !entry) return;
  const label = entry.generated ? (entry.menuLabel || entry.item) : entry.item;
  if (!confirm('确定删除购买项「' + label + '」？\n\n会先备份脚本；如果该物品没有其他购买入口，价目也会一并清理。')) return;
  try {
    const r = await api('/api/config/npcbuy/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: d.file,
        hash: d.hash,
        ops: [{ op: 'delete', line: entry.line, tokenStart: entry.tokenStart, expect: entry.raw, removePrice: true }]
      })
    });
    toast('已删除' + (r.backup ? '，备份：' + r.backup : ''), 'ok');
    if (r.warning) toast(r.warning, 'err');
    NBW.editing = null;
    await nbwLoad(true);
    await nbwLoadDetail(d.file);
  } catch (e) {
    toast('删除失败：' + e.message, 'err');
  }
}

async function openNpcBuyView(sel) {
  if (S.mode !== 'npcbuy' && typeof confirmDiscard === 'function' && !confirmDiscard()) return;
  S.mode = 'npcbuy';
  if (typeof hideAllViews === 'function') hideAllViews();
  if (window.hideItemUseView) window.hideItemUseView();
  if (window.hideTeleportView) window.hideTeleportView();
  const view = nbwEl('npcBuyView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('nbw');
  NBW.editing = null;
  const hashFile = nbwHashFile();
  const target = typeof sel === 'string' && sel ? sel : hashFile;
  try {
    if (!NBW.data || NBW.stale) await nbwLoad();
  } catch (e) {
    toast('加载购买菜单失败：' + e.message, 'err');
    nbwRenderDetail('加载失败：' + e.message);
    return;
  }
  nbwRenderList();
  if (target) {
    if (target === NBW.file && NBW.detail) nbwRenderDetail();
    else await nbwLoadDetail(target);
  } else if (NBW.data.files && NBW.data.files.length) {
    await nbwLoadDetail(NBW.data.files[0].file);
  } else {
    nbwRenderDetail();
  }
}

window.openNpcBuyView = openNpcBuyView;
window.hideNpcBuyView = () => {
  const view = nbwEl('npcBuyView');
  if (!view) return;
  const wasVisible = !view.classList.contains('hidden');
  view.classList.add('hidden');
  if (wasVisible && nbwHashFile()) nbwSetHash('');
};
window.refreshNpcBuyState = () => {
  NBW.stale = true;
};

function nbwBindEvents() {
  const filter = nbwEl('nbwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      NBW.filter = filter.value;
      nbwRenderList();
    });
  }

  const list = nbwEl('nbwList');
  if (list) {
    list.addEventListener('click', (e) => {
      const item = e.target.closest('[data-nbw-file]');
      if (!item) return;
      nbwSelect(item.dataset.nbwFile);
    });
  }

  const reload = nbwEl('btnNbwReload');
  if (reload) {
    reload.addEventListener('click', async () => {
      try {
        await nbwLoad(true);
        if (NBW.file) await nbwLoadDetail(NBW.file);
        else nbwRenderDetail();
        toast('已重新检查', 'ok');
      } catch (e) {
        toast('重新检查失败：' + e.message, 'err');
      }
    });
  }

  const view = nbwEl('npcBuyView');
  if (view) {
    view.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-nbw-act]');
      if (!btn) return;
      const act = btn.dataset.nbwAct;
      if (act === 'add') nbwStartAdd();
      else if (act === 'cancel') nbwCancelEdit();
      else if (act === 'save') nbwSaveForm();
      else if (act === 'edit') {
        const entry = nbwFindEntry(btn.dataset.id);
        if (entry) nbwStartEdit(entry);
      } else if (act === 'delete') {
        const entry = nbwFindEntry(btn.dataset.id);
        if (entry) nbwDeleteEntry(entry);
      }
    });
    view.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'nbwEntryFilter') {
        NBW.entryFilter = e.target.value;
        const d = NBW.detail;
        if (!d) return;
        const section = e.target.closest('.nbw-section');
        if (section) {
          const wrap = section.querySelector('.nbw-table-wrap, .tsk-empty');
          const html = nbwEntriesHtml(d);
          if (wrap) {
            const temp = document.createElement('div');
            temp.innerHTML = html;
            wrap.replaceWith(temp.firstElementChild);
          }
          const input = nbwEl('nbwEntryFilter');
          if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }
      }
    });
  }
}

if (window.appReady && typeof window.appReady.then === 'function') {
  window.appReady.then(nbwBindEvents).catch(nbwBindEvents);
} else {
  document.addEventListener('DOMContentLoaded', nbwBindEvents);
}

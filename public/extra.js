'use strict';

const EXTRA_KV_COLUMNS = [
  { key: 'key', label: '参数名', type: 'text' },
  { key: 'value', label: '参数值', type: 'text' },
  { key: 'comment', label: '备注', type: 'text' }
];

let extraSearchTimer = null;

function extraRegistry() {
  return CFG.extra.registry || [];
}

async function ensureExtraRegistry() {
  if (!CFG.extra.registry) {
    const res = await api('/api/config/extra');
    CFG.extra.registry = res.files || [];
  }
  return CFG.extra.registry;
}

function extraSpec() {
  const m = CFG.extra;
  return extraRegistry().find((f) => f.key === m.key) || null;
}

function extraCurrentSectionName() {
  const m = CFG.extra;
  if (!m.data || !m.data.sectioned) return '';
  const sec = m.data.sections[m.section];
  return sec ? sec.name : '';
}

function extraSchema() {
  const m = CFG.extra;
  if (!m.data) return null;
  if (m.data.sectionSchemas) {
    const name = extraCurrentSectionName();
    return m.data.sectionSchemas[name] || null;
  }
  return { columns: m.data.columns || [], defaults: m.data.defaults || [] };
}

function extraColumns() {
  const m = CFG.extra;
  if (!m.data) return [];
  if (m.data.mode === 'kv') return EXTRA_KV_COLUMNS;
  if (m.data.mode === 'xml' || m.data.mode === 'sections' || m.data.mode === 'raw') return [];
  const schema = extraSchema();
  return schema ? schema.columns : [];
}

/* 后端以“文件行号”标识原始行/章节；新增行使用负数键：新增行 -1-k，新增章节 -2-k（-1 为全局头部）。 */
function extraAddedKey(k) { return -2 - k; }
function extraAddedIndex(key) { return -2 - key; }
function extraSectionAddedKey(k) { return -2 - k; }
function extraSectionAddedIndex(key) { return -2 - key; }

function extraRowBase(index) {
  const m = CFG.extra;
  if (!m.data) return null;
  if (index >= 0) return m.rowMap.get(index) || null;
  return m.added[extraAddedIndex(index)] || null;
}

function extraGetRow(index) {
  const m = CFG.extra;
  const base = extraRowBase(index);
  if (!base) return null;
  if (index < 0) return base.values;
  if (m.data.mode === 'kv') return m.edits.get(index) || base;
  if (m.data.mode === 'xml') return m.edits.get(index) || base.attrs;
  return m.edits.get(index) || base.values;
}

function extraSetRow(index, values) {
  const m = CFG.extra;
  const base = extraRowBase(index);
  if (!base) return;
  if (index < 0) {
    if (m.data.mode === 'kv') base.values = { ...values };
    else base.values = values.slice();
    return;
  }
  if (m.data.mode === 'kv') {
    const same = values.key === base.key && values.value === base.value && (values.comment || '') === (base.comment || '');
    if (same) m.edits.delete(index);
    else m.edits.set(index, { ...values });
  } else if (m.data.mode === 'xml') {
    const same = Object.keys(values).every((k) => String(values[k]) === String(base.attrs[k]));
    if (same) m.edits.delete(index);
    else m.edits.set(index, { ...values });
  } else {
    const same = values.length === base.values.length && values.every((v, i) => String(v) === String(base.values[i]));
    if (same) m.edits.delete(index);
    else m.edits.set(index, values.slice());
  }
  if (index === m.selected) updateExtraMeta();
}

function extraRowMatches(index) {
  const m = CFG.extra;
  const base = extraRowBase(index);
  if (!base) return false;
  if (m.data.sectioned && m.section >= 0 && base.section !== m.section) return false;
  const q = m.search.trim().toLowerCase();
  if (!q) return true;
  if (m.data.mode === 'kv') {
    const row = extraGetRow(index);
    return `${row.key} ${row.value} ${row.comment || ''}`.toLowerCase().includes(q);
  }
  if (m.data.mode === 'xml') {
    const row = base;
    return `${row.tag} ${row.path} ${Object.values(row.attrs).join(' ')}`.toLowerCase().includes(q);
  }
  const row = extraGetRow(index);
  return `${row.join(' ')} ${base.comment || ''}`.toLowerCase().includes(q);
}

function extraRows() {
  const m = CFG.extra;
  if (!m.data) return [];
  const out = [];
  for (const row of m.data.rows) {
    if (m.deleted.has(row.index) || !extraRowMatches(row.index)) continue;
    out.push({ index: row.index, added: false });
  }
  for (let k = 0; k < m.added.length; k++) {
    const index = extraAddedKey(k);
    if (!extraRowMatches(index)) continue;
    out.push({ index, added: true });
  }
  return out;
}

function extraGetSection(index) {
  const m = CFG.extra;
  if (index === -1) return { name: '（全局头部）', text: m.head };
  if (index < -1) return m.sectionAdded[extraSectionAddedIndex(index)] || null;
  const base = m.sectionMap.get(index);
  return m.edits.get(index) || base || null;
}

function extraSetSection(index, values) {
  const m = CFG.extra;
  if (index === -1) {
    m.head = values.text;
    m.headDirty = m.head !== m.headOriginal;
    return;
  }
  if (index < -1) {
    const add = m.sectionAdded[extraSectionAddedIndex(index)];
    if (add) Object.assign(add, values);
    return;
  }
  const base = m.sectionMap.get(index);
  if (!base) return;
  const same = values.name === base.name && values.text === base.text;
  if (same) m.edits.delete(index);
  else m.edits.set(index, { name: values.name, text: values.text });
}

function extraSections() {
  const m = CFG.extra;
  if (!m.data) return [];
  const out = [];
  const q = m.search.trim().toLowerCase();
  const add = (index, name, preview, lineCount) => {
    if (q && !`${name} ${preview}`.toLowerCase().includes(q)) return;
    out.push({ index, name, preview, lineCount });
  };
  if (!q || `${m.head} 全局头部`.toLowerCase().includes(q)) {
    add(-1, '（全局头部 / 变量）', m.head.split('\n')[0] || '', m.head.split('\n').length);
  }
  for (const item of m.data.sections) {
    if (m.deleted.has(item.index)) continue;
    const sec = extraGetSection(item.index);
    add(item.index, sec.name, String(sec.text || '').split('\n').find((x) => x.trim()) || '', String(sec.text || '').split('\n').length);
  }
  for (let k = 0; k < m.sectionAdded.length; k++) {
    const sec = m.sectionAdded[k];
    add(extraSectionAddedKey(k), sec.name, String(sec.text || '').split('\n').find((x) => x.trim()) || '', String(sec.text || '').split('\n').length);
  }
  return out;
}

function extraPaged(list) {
  const m = CFG.extra;
  const totalPages = Math.max(1, Math.ceil(list.length / m.pageSize));
  if (m.page >= totalPages) m.page = totalPages - 1;
  if (m.page < 0) m.page = 0;
  return { list: list.slice(m.page * m.pageSize, (m.page + 1) * m.pageSize), totalPages };
}

function extraCell(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function extraBuildFileSelect() {
  const sel = cfgEl('extraFile');
  cfgClear(sel);
  let group = null;
  let groupName = '';
  for (const f of extraRegistry()) {
    if (f.group !== groupName) {
      groupName = f.group;
      group = document.createElement('optgroup');
      group.label = groupName;
      sel.appendChild(group);
    }
    const o = document.createElement('option');
    o.value = f.key;
    o.textContent = `${f.label} · ${f.file}`;
    group.appendChild(o);
  }
  sel.value = CFG.extra.key;
}

function extraBuildSectionSelect() {
  const m = CFG.extra;
  const sel = cfgEl('extraSection');
  cfgClear(sel);
  const visible = m.data && m.data.sectioned && m.data.mode !== 'sections';
  sel.classList.toggle('hidden', !visible);
  if (!visible) return;
  const hints = m.data.sectionHints || {};
  for (let i = 0; i < m.data.sections.length; i++) {
    const name = m.data.sections[i].name;
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = hints[name] ? `${name}（${hints[name]}）` : name;
    sel.appendChild(o);
  }
  if (m.section < 0 && m.data.sections.length) m.section = 0;
  sel.value = String(m.section);
}

function extraRenderGrid() {
  const m = CFG.extra;
  const thead = cfgEl('extraGrid').querySelector('thead');
  const tbody = cfgEl('extraGrid').querySelector('tbody');
  cfgClear(thead);
  cfgClear(tbody);
  if (!m.data) return;

  if (m.data.mode === 'sections') {
    const htr = document.createElement('tr');
    for (const label of ['#', '章节', '行数', '内容预览']) {
      const th = document.createElement('th');
      th.textContent = label;
      if (label === '#') th.className = 'col-idx';
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    const list = extraSections();
    const page = extraPaged(list);
    const offset = m.page * m.pageSize;
    page.list.forEach((item, pos) => {
      const tr = document.createElement('tr');
      tr.dataset.index = item.index;
      if (item.index === m.selected) tr.classList.add('selected');
      if (item.index < -1) tr.classList.add('added');
      [item.index === -1 ? '头' : offset + pos + 1, item.name, item.lineCount, item.preview].forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v == null ? '' : v;
        if (i === 0) td.className = 'col-idx';
        else if (i === 1) td.className = 'str namecell';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    cfgEl('extraPageInfo').textContent = `第 ${m.page + 1}/${page.totalPages} 页 · 共 ${list.length} 个章节`;
    cfgEl('extraPrev').disabled = m.page <= 0;
    cfgEl('extraNext').disabled = m.page >= page.totalPages - 1;
    return;
  }

  if (m.data.mode === 'xml') {
    const htr = document.createElement('tr');
    for (const label of ['#', '节点', '层级路径', '属性']) {
      const th = document.createElement('th');
      th.textContent = label;
      if (label === '#') th.className = 'col-idx';
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    const list = extraRows();
    const page = extraPaged(list);
    const offset = m.page * m.pageSize;
    page.list.forEach((item, pos) => {
      const base = m.rowMap.get(item.index);
      const row = extraGetRow(item.index);
      const tr = document.createElement('tr');
      tr.dataset.index = item.index;
      if (item.index === m.selected) tr.classList.add('selected');
      if (m.edits.has(item.index)) tr.classList.add('added');
      const attrs = Object.entries(row).map(([k, v]) => `${k}=${v}`).join('  ');
      [offset + pos + 1, base.tag, base.path, attrs].forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v == null ? '' : v;
        if (i === 0) td.className = 'col-idx';
        else if (i === 1) td.className = 'str namecell';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    cfgEl('extraPageInfo').textContent = `第 ${m.page + 1}/${page.totalPages} 页 · 共 ${list.length} 个 XML 节点`;
    cfgEl('extraPrev').disabled = m.page <= 0;
    cfgEl('extraNext').disabled = m.page >= page.totalPages - 1;
    return;
  }

  const columns = extraColumns();
  const keyHints = m.data.mode === 'kv' && m.data.keyHints ? m.data.keyHints : null;
  const htr = document.createElement('tr');
  const headers = ['#'].concat(columns.map((c) => c.label));
  if (m.data.showComment) headers.push('说明');
  if (keyHints) headers.push('中文说明');
  for (const label of headers) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === '#') th.className = 'col-idx';
    htr.appendChild(th);
  }
  thead.appendChild(htr);

  const list = extraRows();
  const page = extraPaged(list);
  const offset = m.page * m.pageSize;
  page.list.forEach((item, pos) => {
    const base = extraRowBase(item.index);
    const row = extraGetRow(item.index);
    const values = m.data.mode === 'kv'
      ? columns.map((c) => row[c.key])
      : row;
    const tr = document.createElement('tr');
    tr.dataset.index = item.index;
    if (item.index === m.selected) tr.classList.add('selected');
    if (item.added) tr.classList.add('added');
    if (m.edits.has(item.index)) tr.classList.add('added');
    const cells = [offset + pos + 1].concat(values || []);
    if (m.data.showComment) cells.push(base ? base.comment || '' : '');
    if (keyHints) {
      const hintKey = base ? base.key : row.key;
      cells.push(hintKey ? keyHints[hintKey] || '' : '');
    }
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v == null ? '' : v;
      if (i === 0) td.className = 'col-idx';
      else if (columns[i - 1] && columns[i - 1].type === 'number') td.className = 'num';
      else if (i === 1) td.className = 'str namecell';
      if (i === 0 && item.added) {
        const tag = document.createElement('span');
        tag.className = 'new-tag';
        tag.textContent = '新';
        td.appendChild(tag);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  cfgEl('extraPageInfo').textContent = `第 ${m.page + 1}/${page.totalPages} 页 · 共 ${list.length} 条`;
  cfgEl('extraPrev').disabled = m.page <= 0;
  cfgEl('extraNext').disabled = m.page >= page.totalPages - 1;
}

function extraInput(value, type) {
  if (type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.value = value == null ? '' : String(value);
    return input;
  }
  return cfgText(value == null ? '' : String(value), null, 4000);
}

function extraBuildForm(index) {
  const m = CFG.extra;
  if (!m.data) return;
  const form = cfgEl('cfgForm');
  cfgClear(form);
  const mode = m.data.mode;

  if (mode === 'sections') {
    const sec = extraGetSection(index);
    if (!sec) return;
    const pos = index >= 0 ? m.data.sections.findIndex((s) => s.index === index) + 1 : 0;
    cfgEl('cfgDetail').classList.remove('hidden');
    cfgEl('cfgDetailTitle').textContent = index === -1 ? '全局头部 / 变量' : sec.name;
    cfgEl('cfgDetailSub').textContent = index === -1
      ? '文件开头到第一个章节之间的内容'
      : (pos > 0 ? `第 ${pos} 个章节` : '新增章节（保存后写入）');
    cfgEl('cfgNote').textContent = index < 0
      ? '这里通常放全局变量、说明注释；保存时只改写发生变化的章节。'
      : '章节名称对应方括号内的标题；正文按原样保存。';
    if (index !== -1) {
      const name = cfgText(sec.name, null, 120);
      name.addEventListener('input', () => {
        extraSetSection(index, { name: name.value, text: extraGetSection(index).text });
        cfgEl('cfgDetailTitle').textContent = name.value;
        extraRenderGrid();
        updateExtraMeta();
      });
      form.appendChild(cfgField('章节名称', name, '[标题]'));
    }
    const text = document.createElement('textarea');
    text.className = 'field-textarea';
    text.value = sec.text;
    text.style.minHeight = '260px';
    text.addEventListener('input', () => {
      extraSetSection(index, { name: index === -1 ? '' : extraGetSection(index).name, text: text.value });
      extraRenderGrid();
      updateExtraMeta();
    });
    form.appendChild(cfgField(index < 0 ? '头部内容' : '正文', text, '按原格式保存'));
    cfgMarkSelected(cfgEl('extraGrid').querySelector('tbody'), index);
    return;
  }

  const base = extraRowBase(index);
  const row = extraGetRow(index);
  if (!base || !row) return;
  cfgEl('cfgDetail').classList.remove('hidden');
  const keyHints = mode === 'kv' && m.data.keyHints ? m.data.keyHints : null;
  const rowHint = keyHints ? keyHints[base.key] || '' : '';
  cfgEl('cfgDetailTitle').textContent = mode === 'xml'
    ? `<${base.tag}>`
    : `${m.data.label} · ${index < 0 ? '新增记录' : '第 ' + (index + 1) + ' 行'}${rowHint ? ' · ' + rowHint : ''}`;
  cfgEl('cfgDetailSub').textContent = mode === 'xml' ? base.path : (index < 0 ? '新增记录（保存后写入）' : '修改后点击保存');
  cfgEl('cfgNote').textContent = mode === 'xml'
    ? '这里只修改 XML 节点属性；节点结构和未修改属性保持原样。'
    : m.data.showComment ? '“说明”来自上一行注释，仅用于辨认；修改时不会改动注释。' : '保存时只改写修改过的行，并自动备份原文件。';

  if (m.data.sectioned && mode !== 'sections' && !m.data.sectionSchemas) {
    const name = extraCurrentSectionName() || '';
    const input = cfgText(name, null, 120);
    input.addEventListener('input', () => {
      if (input.value === name) m.sectionEdits.delete(m.section);
      else m.sectionEdits.set(m.section, input.value);
      extraRenderGrid();
      updateExtraMeta();
    });
    const sectionHints = m.data.sectionHints || {};
    form.appendChild(cfgField('所属分组名称', input, sectionHints[name] || '改名会更新方括号标题'));
  }

  if (mode === 'kv') {
    let updateHint = null;
    if (keyHints && Object.keys(keyHints).length) {
      const info = document.createElement('div');
      info.className = 'field-hint';
      updateHint = () => {
        const current = extraGetRow(index);
        info.textContent = keyHints[current.key] || '暂无中文说明，可参考“备注”列或原文件注释。';
      };
      updateHint();
      form.appendChild(info);
    }
    const fields = [
      ['key', '参数名'],
      ['value', '参数值'],
      ['comment', '备注']
    ];
    for (const [key, label] of fields) {
      const input = cfgText(row[key] || '', null, 4000);
      input.addEventListener('input', () => {
        const values = { ...extraGetRow(index), [key]: input.value };
        extraSetRow(index, values);
        extraRenderGrid();
        updateExtraMeta();
        if (key === 'key' && updateHint) updateHint();
      });
      form.appendChild(cfgField(label, input));
    }
    cfgMarkSelected(cfgEl('extraGrid').querySelector('tbody'), index);
    return;
  }

  if (mode === 'xml') {
    for (const [key, value] of Object.entries(row)) {
      const input = cfgText(value, null, 4000);
      input.addEventListener('input', () => {
        const values = { ...extraGetRow(index), [key]: input.value };
        extraSetRow(index, values);
        extraRenderGrid();
        updateExtraMeta();
      });
      const attrHints = m.data.attrHints || {};
      form.appendChild(cfgField(key, input, attrHints[key] || 'XML 属性'));
    }
    cfgMarkSelected(cfgEl('extraGrid').querySelector('tbody'), index);
    return;
  }

  const columns = extraColumns();
  const values = row.slice();
  columns.forEach((col, pos) => {
    const input = extraInput(values[pos], col.type);
    input.addEventListener('input', () => {
      const next = extraGetRow(index).slice();
      next[pos] = input.value;
      extraSetRow(index, next);
      extraRenderGrid();
      updateExtraMeta();
    });
    form.appendChild(cfgField(col.label, input, col.type === 'number' ? '整数' : ''));
  });
  cfgMarkSelected(cfgEl('extraGrid').querySelector('tbody'), index);
}

function extraSelect(index) {
  CFG.extra.selected = index;
  extraBuildForm(index);
}

function extraAdd() {
  const m = CFG.extra;
  if (!m.data) return;
  if (m.data.mode === 'sections') {
    m.sectionAdded.push({ name: '新章节', text: '' });
    m.selected = extraSectionAddedKey(m.sectionAdded.length - 1);
    m.page = Math.max(0, Math.ceil(extraSections().length / m.pageSize) - 1);
  } else if (m.data.mode === 'table' || m.data.mode === 'kv') {
    if (m.data.sectioned && m.section < 0) return toast('请先选择分组', 'err');
    const schema = extraSchema();
    const defaults = (schema && schema.defaults && schema.defaults.length)
      ? schema.defaults.slice()
      : extraColumns().map((c) => (c.type === 'number' ? '0' : ''));
    if (m.data.mode === 'kv') {
      m.added.push({ section: m.section, values: { key: 'NewKey', value: '', comment: '' } });
    } else {
      m.added.push({ section: m.section, values: defaults });
    }
    m.selected = extraAddedKey(m.added.length - 1);
    m.page = Math.max(0, Math.ceil(extraRows().length / m.pageSize) - 1);
  } else {
    return;
  }
  extraRenderGrid();
  extraBuildForm(m.selected);
  updateExtraMeta();
}

function extraDuplicate() {
  const m = CFG.extra;
  if (!m.data) return;
  if (m.data.mode === 'sections') {
    if (m.selected === -1) return toast('全局头部不能复制为章节', 'err');
    const sec = extraGetSection(m.selected);
    if (!sec) return toast('请先选择一条记录', 'err');
    m.sectionAdded.push({ name: sec.name + '副本', text: sec.text });
    m.selected = extraSectionAddedKey(m.sectionAdded.length - 1);
  } else if (m.data.mode === 'table' || m.data.mode === 'kv') {
    if (m.selected === -1) return toast('请先选择一条记录', 'err');
    const row = extraGetRow(m.selected);
    if (!row) return;
    if (m.data.mode === 'kv') m.added.push({ section: m.section, values: { ...row } });
    else m.added.push({ section: m.section, values: row.slice() });
    m.selected = extraAddedKey(m.added.length - 1);
  } else {
    return;
  }
  extraRenderGrid();
  extraBuildForm(m.selected);
  updateExtraMeta();
}

function extraDelete() {
  const m = CFG.extra;
  if (!m.data) return;
  if (m.data.mode === 'sections') {
    const index = m.selected;
    if (index === -1) return toast('全局头部不能删除', 'err');
    if (index < -1) {
      m.sectionAdded.splice(extraSectionAddedIndex(index), 1);
    } else if (index >= 0) {
      m.deleted.add(index);
      m.edits.delete(index);
    } else {
      return toast('请先选择一条记录', 'err');
    }
  } else if (m.data.mode === 'table' || m.data.mode === 'kv') {
    const index = m.selected;
    if (index === -1) return toast('请先选择一条记录', 'err');
    if (index < -1) m.added.splice(extraAddedIndex(index), 1);
    else {
      m.deleted.add(index);
      m.edits.delete(index);
    }
  } else {
    return;
  }
  m.selected = -1;
  cfgCloseDetail();
  extraRenderGrid();
  updateExtraMeta();
}

function extraRender() {
  const m = CFG.extra;
  const d = m.data;
  if (!d) return;
  const isRaw = d.mode === 'raw';
  cfgEl('extraFile').value = m.key;
  cfgEl('extraFile').classList.toggle('hidden', S.mode === 'cfgServercfg');
  cfgEl('extraMeta').textContent = `${d.label} · ${d.file}`;
  cfgEl('extraTableWrap').classList.toggle('hidden', isRaw);
  cfgEl('extraTextWrap').classList.toggle('hidden', !isRaw);
  cfgEl('extraPager').classList.toggle('hidden', isRaw);
  cfgEl('extraSearch').classList.toggle('hidden', isRaw);
  cfgEl('extraSection').classList.toggle('hidden', !d.sectioned || d.mode === 'sections' || isRaw);
  cfgEl('btnExtraAdd').classList.toggle('hidden', !(d.mode === 'table' || d.mode === 'kv' || d.mode === 'sections'));
  cfgEl('btnExtraDup').classList.toggle('hidden', !(d.mode === 'table' || d.mode === 'kv' || d.mode === 'sections'));
  cfgEl('btnExtraDel').classList.toggle('hidden', !(d.mode === 'table' || d.mode === 'kv' || d.mode === 'sections'));
  cfgEl('btnExtraAdd').textContent = d.mode === 'sections' ? '新增章节' : (d.mode === 'kv' ? '新增参数' : '新增行');
  if (isRaw) {
    if (cfgEl('extraText').value !== m.text) cfgEl('extraText').value = m.text;
    cfgEl('extraHint').textContent = `${m.text.split('\n').length} 行 · 直接编辑文本，保存时自动备份`;
    return;
  }
  if (d.mode === 'sections') {
    cfgEl('extraHint').textContent = '选择章节后在右侧编辑；全局头部可修改变量和注释';
  } else if (d.mode === 'xml') {
    cfgEl('extraHint').textContent = '选择任意 XML 节点后修改属性；不支持增删节点';
  } else if (d.mode === 'kv') {
    const hasHints = d.keyHints && Object.keys(d.keyHints).length;
    cfgEl('extraHint').textContent = hasHints
      ? '“中文说明”按参数名自动匹配，仅供参考；保存只改写修改过的行'
      : (d.sectioned ? '按分组编辑参数；保存只改写修改过的行' : '直接修改参数值或备注；保存只改写修改过的行');
  } else {
    cfgEl('extraHint').textContent = d.sectioned ? '按分组显示；新增行会加入当前分组' : '点击行后在右侧编辑字段';
  }
  extraBuildSectionSelect();
  extraRenderGrid();
}

function updateExtraMeta() {
  const m = CFG.extra;
  const n = cfgDirty('cfgExtra');
  cfgEl('dirtyDot').classList.toggle('on', n > 0);
  const btn = cfgEl('btnExtraSave');
  btn.disabled = n === 0;
  btn.textContent = n > 0 ? `保存 (${n})` : '保存';
  if (m.data) {
    const count = m.data.mode === 'sections'
      ? extraSections().length
      : (m.data.mode === 'raw' ? m.text.split('\n').length : extraRows().length);
    const prefix = S.mode === 'cfgServercfg' ? '服务器启动配置' : '扩展配置';
    cfgEl('statusText').textContent = `${prefix} · ${m.data.label} · ${count} ${m.data.mode === 'raw' ? '行' : '条'}` + (n ? ` · ${n} 处未保存` : '');
  }
}

function extraResetState(data) {
  const m = CFG.extra;
  m.data = data;
  m.key = data.key;
  m.rowMap = new Map((data.rows || []).map((r) => [r.index, r]));
  m.sectionMap = new Map((data.sections || []).map((s) => [s.index, s]));
  m.search = '';
  m.page = 0;
  m.selected = -1;
  m.section = data.sectioned && data.sections.length ? 0 : -1;
  m.edits.clear();
  m.added = [];
  m.deleted.clear();
  m.sectionEdits.clear();
  m.sectionAdded = [];
  m.text = data.text || '';
  m.textOriginal = m.text;
  m.head = data.head || '';
  m.headOriginal = m.head;
  m.headDirty = false;
}

async function loadExtraFile(key, force) {
  if (!force && !confirmDiscard()) return;
  const data = await api('/api/config/extra/data?key=' + encodeURIComponent(key));
  extraResetState(data);
  cfgEl('extraSearch').value = '';
  if (data.mode === 'sections') cfgEl('extraText').value = '';
  extraRender();
  updateExtraMeta();
}

async function openExtraConfig(force) {
  if (!force && !confirmDiscard()) return false;
  try {
    await ensureExtraRegistry();
    if (!CFG.extra.key) CFG.extra.key = 'server';
    const data = await api('/api/config/extra/data?key=' + encodeURIComponent(CFG.extra.key));
    extraResetState(data);
    cfgSetMode('cfgExtra');
    extraBuildFileSelect();
    cfgEl('extraFile').value = CFG.extra.key;
    cfgEl('extraSearch').value = '';
    extraRender();
    updateExtraMeta();
    return true;
  } catch (e) {
    toast('打开扩展配置失败：' + e.message, 'err');
    return false;
  }
}

window.openExtraKey = (key, force) => {
  CFG.extra.key = key;
  return openExtraConfig(force);
};

/* 从体检/任务等外部入口打开配置并定位到问题行/章节 */
function extraFocusRow(index) {
  const m = CFG.extra;
  if (!m.data) return false;
  const list = m.data.mode === 'sections' ? extraSections() : extraRows();
  const pos = list.findIndex((item) => item.index === index);
  if (pos < 0) return false;
  m.page = Math.floor(pos / m.pageSize);
  extraRenderGrid();
  extraSelect(index);
  const tr = cfgEl('extraGrid').querySelector('tbody tr[data-index="' + index + '"]');
  if (tr) {
    tr.scrollIntoView({ block: 'center' });
    tr.classList.add('focus-pulse');
    setTimeout(() => tr.classList.remove('focus-pulse'), 1600);
  }
  return true;
}

function extraFocusTarget(target) {
  const m = CFG.extra;
  const d = m.data;
  if (!d || d.mode === 'raw') return false;
  const line = target.line ? Number(target.line) : 0;
  m.search = '';
  cfgEl('extraSearch').value = '';

  if (d.mode === 'sections') {
    const sections = d.sections || [];
    let sec = target.section ? sections.find((s) => s.name === target.section) : null;
    if (!sec && line) {
      const before = sections.filter((s) => s.index <= line - 1);
      sec = before.length ? before[before.length - 1] : null;
    }
    if (!sec) return false;
    return extraFocusRow(sec.index);
  }

  let row = null;
  if (d.mode === 'xml') {
    const rows = d.rows || [];
    if (target.index != null) row = rows.find((r) => r.index === Number(target.index)) || null;
    if (!row && line) row = rows.find((r) => r.line === line - 1) || null;
  } else {
    if (target.index != null) row = m.rowMap.get(Number(target.index)) || null;
    if (!row && line) row = m.rowMap.get(line - 1) || null;
  }
  if (!row) return false;

  if (d.sectioned && d.mode !== 'xml' && row.section != null && row.section >= 0) {
    m.section = row.section;
    const sel = cfgEl('extraSection');
    if (sel) sel.value = String(row.section);
  }
  return extraFocusRow(row.index);
}

window.openExtraKeyAt = async (key, target) => {
  const opened = await window.openExtraKey(key);
  if (!opened) return false;
  return extraFocusTarget(target || {});
};

async function openServerConfig(force) {
  if (!force && !confirmDiscard()) return;
  try {
    await ensureExtraRegistry();
    CFG.extra.key = 'gameserver';
    const data = await api('/api/config/extra/data?key=gameserver');
    extraResetState(data);
    cfgSetMode('cfgServercfg');
    extraBuildFileSelect();
    cfgEl('extraFile').value = 'gameserver';
    cfgEl('extraSearch').value = '';
    extraRender();
    updateExtraMeta();
  } catch (e) {
    toast('打开服务器启动配置失败：' + e.message, 'err');
  }
}

function extraPayload() {
  const m = CFG.extra;
  const d = m.data;
  if (d.mode === 'raw') return { text: m.text };
  if (d.mode === 'sections') {
    return {
      head: m.head,
      changes: [...m.edits.entries()].map(([index, values]) => ({ index, name: values.name, text: values.text })),
      added: m.sectionAdded.map((s) => ({ name: s.name, text: s.text })),
      deleted: [...m.deleted]
    };
  }
  if (d.mode === 'xml') {
    return { changes: [...m.edits.entries()].map(([index, values]) => ({ index, values })) };
  }
  const base = {
    changes: [...m.edits.entries()].map(([index, values]) => ({ index, values })),
    added: m.added.map((row) => ({ section: row.section, values: row.values })),
    deleted: [...m.deleted],
    sectionChanges: [...m.sectionEdits.entries()].map(([index, name]) => ({ index, name }))
  };
  return base;
}

async function saveExtraConfig() {
  const m = CFG.extra;
  const n = cfgDirty('cfgExtra');
  if (!m.data || n === 0) return;
  const btn = cfgEl('btnExtraSave');
  btn.disabled = true;
  try {
    const key = m.key;
    const res = await api('/api/config/extra/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, payload: extraPayload() })
    });
    let msg = `保存成功：修改 ${res.changedRows} 条，新增 ${res.addedRows} 条，删除 ${res.deletedRows} 条。`;
    if (res.backup) msg += '\n备份：' + res.backup;
    toast(msg, 'ok');
    await refreshState();
    await loadExtraFile(key, true);
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    updateExtraMeta();
  }
}

/* 事件绑定 */
cfgEl('extraFile').addEventListener('change', () => {
  const key = cfgEl('extraFile').value;
  loadExtraFile(key).catch((e) => toast('打开配置失败：' + e.message, 'err'));
});
cfgEl('extraSection').addEventListener('change', () => {
  CFG.extra.section = Number(cfgEl('extraSection').value);
  CFG.extra.page = 0;
  CFG.extra.selected = -1;
  cfgCloseDetail();
  extraRenderGrid();
});
cfgEl('extraSearch').addEventListener('input', () => {
  clearTimeout(extraSearchTimer);
  extraSearchTimer = setTimeout(() => {
    CFG.extra.search = cfgEl('extraSearch').value;
    CFG.extra.page = 0;
    extraRenderGrid();
  }, 150);
});
cfgEl('extraPrev').addEventListener('click', () => {
  if (CFG.extra.page > 0) {
    CFG.extra.page--;
    extraRenderGrid();
  }
});
cfgEl('extraNext').addEventListener('click', () => {
  CFG.extra.page++;
  extraRenderGrid();
});
cfgEl('extraGrid').querySelector('tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr || tr.dataset.index === undefined) return;
  extraSelect(Number(tr.dataset.index));
});
cfgEl('extraText').addEventListener('input', () => {
  CFG.extra.text = cfgEl('extraText').value;
  updateExtraMeta();
});
cfgEl('btnExtraAdd').addEventListener('click', extraAdd);
cfgEl('btnExtraDup').addEventListener('click', extraDuplicate);
cfgEl('btnExtraDel').addEventListener('click', extraDelete);
cfgEl('btnExtraReload').addEventListener('click', () => {
  loadExtraFile(CFG.extra.key).catch((e) => toast('重新加载失败：' + e.message, 'err'));
});
cfgEl('btnExtraSave').addEventListener('click', saveExtraConfig);

window.openExtraConfig = openExtraConfig;
window.openServerConfig = openServerConfig;
window.saveExtraConfig = saveExtraConfig;

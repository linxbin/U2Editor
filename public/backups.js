'use strict';

/* 备份与历史：按时间线查看自动备份、对比当前文件并恢复（恢复前自动再备份） */

const BKW = {
  data: null,
  events: [],
  loading: false,
  version: null,
  diff: null,
  diffError: '',
  diffLoading: false,
  filter: '',
  fileFilter: null
};

let bkwSearchTimer = null;

function bkwEl(id) {
  return document.getElementById(id);
}

function bkwText(id, text) {
  const el = bkwEl(id);
  if (el) el.textContent = text;
}

function bkwClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function bkwAdd(parent, tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}

function bkwSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function bkwBaseName(file) {
  const i = String(file || '').lastIndexOf('/');
  return i >= 0 ? file.slice(i + 1) : file;
}

function bkwPad2(n) {
  return String(n).padStart(2, '0');
}

function bkwDayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + bkwPad2(d.getMonth() + 1) + '-' + bkwPad2(d.getDate());
}

function bkwDayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((today - day) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return bkwDayKey(ts);
}

function bkwClock(ts) {
  const d = new Date(ts);
  return bkwPad2(d.getHours()) + ':' + bkwPad2(d.getMinutes()) + ':' + bkwPad2(d.getSeconds());
}

function bkwShortWhen(ts) {
  const d = new Date(ts);
  const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((today - day) / 86400000);
  const hm = bkwClock(ts).slice(0, 5);
  if (days === 0) return '今天 ' + hm;
  if (days === 1) return '昨天 ' + hm;
  const md = bkwPad2(d.getMonth() + 1) + '-' + bkwPad2(d.getDate());
  if (d.getFullYear() === now.getFullYear()) return md + ' ' + hm;
  return d.getFullYear() + '-' + md + ' ' + hm;
}

function bkwFlatten(groups) {
  const out = [];
  for (const group of groups || []) {
    for (const version of group.versions || []) out.push({ group, version });
  }
  out.sort(
    (a, b) =>
      b.version.ts - a.version.ts ||
      a.group.file.localeCompare(b.group.file, 'zh-CN') ||
      (a.version.name < b.version.name ? 1 : a.version.name > b.version.name ? -1 : 0)
  );
  return out;
}

function bkwEventById(id) {
  if (!id) return null;
  return BKW.events.find((ev) => ev.version.id === id) || null;
}

function bkwSelectedEvent() {
  return bkwEventById(BKW.version);
}

function bkwMatches(ev) {
  if (BKW.fileFilter && ev.group.file !== BKW.fileFilter) return false;
  const q = BKW.filter.trim().toLowerCase();
  return !q || ev.group.file.toLowerCase().includes(q);
}

function bkwVisibleEvents() {
  return BKW.events.filter(bkwMatches);
}

function bkwSortedGroups() {
  if (!BKW.data) return [];
  return BKW.data.groups.slice().sort((a, b) => {
    const at = a.versions.length ? a.versions[0].ts : 0;
    const bt = b.versions.length ? b.versions[0].ts : 0;
    return bt - at || a.file.localeCompare(b.file, 'zh-CN');
  });
}

function bkwHashWanted() {
  return /^#backups(?:=|$)/.test(location.hash || '');
}

async function openBackupView() {
  if (S.mode !== 'backup' && typeof confirmDiscard === 'function' && !(await confirmDiscard())) return;
  S.mode = 'backup';
  if (typeof hideAllViews === 'function') hideAllViews();
  const view = bkwEl('backupView');
  if (view) view.classList.remove('hidden');
  if (window.showSideTab) window.showSideTab('bkw');
  if (location.hash !== '#backups') {
    try {
      history.replaceState(null, '', location.pathname + location.search + '#backups');
    } catch (e) {
    }
  }
  await bkwLoad();
}

function hideBackupView() {
  const view = bkwEl('backupView');
  if (view) view.classList.add('hidden');
}

function bkwRenderMeta() {
  const meta = bkwEl('bkwMeta');
  if (meta) {
    if (!BKW.data) meta.textContent = BKW.loading ? '正在扫描备份…' : '';
    else {
      meta.textContent =
        BKW.data.totals.files + ' 个文件 · ' + BKW.data.totals.versions + ' 个备份版本' +
        (BKW.data.truncated ? ' · 数量较多，已截断' : '');
    }
  }
  const hint = bkwEl('bkwListHint');
  if (hint) {
    if (!BKW.data) hint.textContent = BKW.loading ? '正在扫描备份目录…' : '';
    else if (BKW.fileFilter) hint.textContent = '仅显示 ' + bkwBaseName(BKW.fileFilter) + '；再次点击该文件可取消';
    else hint.textContent = '按备份时间从新到旧排列；点击文件可只看该文件';
  }
}

function bkwRenderFiles() {
  const list = bkwEl('bkwFileList');
  if (!list) return;
  bkwClear(list);
  if (!BKW.data) {
    bkwAdd(list, 'div', 'mpw-empty', BKW.loading ? '正在扫描备份…' : '暂无备份数据');
    return;
  }
  if (!BKW.data.groups.length) {
    bkwAdd(list, 'div', 'mpw-empty', '还没有任何备份。编辑并保存配置后会自动生成。');
    return;
  }
  const q = BKW.filter.trim().toLowerCase();
  const groups = bkwSortedGroups().filter((g) => !q || g.file.toLowerCase().includes(q));

  const all = bkwAdd(list, 'div', 'file-item' + (BKW.fileFilter ? '' : ' active'));
  all.dataset.bkwAll = '1';
  bkwAdd(all, 'div', 'fname', '全部文件');
  bkwAdd(all, 'div', 'fmeta', BKW.events.length + ' 个备份版本');

  if (!groups.length) {
    bkwAdd(list, 'div', 'mpw-empty', '没有匹配的备份文件。');
    return;
  }
  for (const group of groups) {
    const item = bkwAdd(list, 'div', 'file-item' + (group.file === BKW.fileFilter ? ' active' : ''));
    item.dataset.bkwFile = group.file;
    const name = bkwAdd(item, 'div', 'fname');
    name.textContent = bkwBaseName(group.file);
    name.title = group.file;
    const meta = bkwAdd(item, 'div', 'fmeta' + (group.exists ? '' : ' err'));
    const bits = [];
    if (group.dir && group.dir !== '根目录') bits.push(group.dir);
    const latest = group.versions[0];
    if (latest) bits.push(bkwShortWhen(latest.ts));
    bits.push(group.count + ' 个版本');
    if (!group.exists) bits.push('当前文件已删除');
    meta.textContent = bits.join(' · ');
  }
}

function bkwRenderTimeline() {
  const list = bkwEl('bkwVersionList');
  if (!list) return;
  bkwClear(list);
  const visible = bkwVisibleEvents();
  const filtered = Boolean(BKW.filter.trim() || BKW.fileFilter);
  bkwText('bkwVersionHint', BKW.data ? (filtered ? visible.length + ' / ' + BKW.events.length : visible.length) + ' 条' : '');

  if (!BKW.data) {
    bkwAdd(list, 'div', 'bkw-empty', BKW.loading ? '正在扫描备份…' : '暂无备份数据');
    return;
  }
  if (!visible.length) {
    bkwAdd(
      list,
      'div',
      'bkw-empty',
      filtered ? '没有匹配的备份记录。' : '还没有任何备份。编辑并保存配置后会自动生成。'
    );
    return;
  }

  let lastDay = null;
  for (const ev of visible) {
    const day = bkwDayKey(ev.version.ts);
    if (day !== lastDay) {
      bkwAdd(list, 'div', 'bkw-day', bkwDayLabel(ev.version.ts));
      lastDay = day;
    }
    const item = bkwAdd(list, 'div', 'file-item bkw-event' + (ev.version.id === BKW.version ? ' active' : ''));
    item.dataset.bkwVersion = ev.version.id;
    item.title = ev.group.file + '\n备份于 ' + ev.version.time + ' · ' + bkwSize(ev.version.size);
    const name = bkwAdd(item, 'div', 'fname');
    bkwAdd(name, 'span', 'bkw-event-time', bkwClock(ev.version.ts));
    bkwAdd(name, 'span', 'bkw-event-file', bkwBaseName(ev.group.file));
    const meta = bkwAdd(item, 'div', 'fmeta' + (ev.group.exists ? '' : ' err'));
    const bits = [];
    if (ev.group.dir && ev.group.dir !== '根目录') bits.push(ev.group.dir);
    bits.push(bkwSize(ev.version.size));
    if (ev.group.count > 1) bits.push('该文件共 ' + ev.group.count + ' 个版本');
    if (!ev.group.exists) bits.push('当前文件已删除');
    meta.textContent = bits.join(' · ');
  }
}

function bkwDiffMetaText(diff) {
  const parts = [];
  const ev = bkwSelectedEvent();
  if (ev) parts.push(ev.version.time);
  if (!diff.targetExists) parts.push('当前文件不存在');
  if (diff.mode === 'text') {
    const s = diff.stats || {};
    parts.push((s.approx ? '约 ' : '') + '+' + s.added + ' / -' + s.removed);
    parts.push('备份 ' + diff.base.lines + ' 行 · 当前 ' + (diff.current ? diff.current.lines : 0) + ' 行');
    if (diff.eolChanged) parts.push('换行符有变化');
    if (diff.finalNewlineChanged) parts.push('末尾换行有变化');
    if (diff.truncated) parts.push(s.approx ? '差异过大，仅显示统计' : '差异已截断');
  } else if (diff.mode === 'db') {
    parts.push('记录数 ' + diff.base.recordCount + ' → ' + (diff.current ? diff.current.recordCount : 0));
    parts.push('容量 ' + diff.base.capacity + ' → ' + (diff.current ? diff.current.capacity : 0));
  } else {
    parts.push('二进制文件，仅显示大小');
  }
  return parts.join(' · ');
}

function bkwRenderDiff() {
  const box = bkwEl('bkwDiff');
  if (!box) return;
  bkwClear(box);
  const restoreBtn = bkwEl('bkwRestore');
  const diff = BKW.diff;
  bkwText('bkwDiffTitle', diff ? diff.file : '选择左侧的备份记录查看差异');
  bkwText('bkwDiffMeta', diff ? bkwDiffMetaText(diff) : '');

  if (BKW.diffLoading && !diff) {
    bkwAdd(box, 'div', 'bkw-empty', '正在读取差异…');
    if (restoreBtn) restoreBtn.disabled = true;
    return;
  }
  if (BKW.diffError) {
    bkwAdd(box, 'div', 'bkw-empty err', BKW.diffError);
    if (restoreBtn) restoreBtn.disabled = true;
    return;
  }
  if (!diff) {
    bkwAdd(box, 'div', 'bkw-empty', '选择左侧的备份记录，右侧会显示它和当前文件的差异。');
    if (restoreBtn) restoreBtn.disabled = true;
    return;
  }
  if (restoreBtn) restoreBtn.disabled = !bkwSelectedEvent();

  if (diff.mode === 'text') {
    if (!diff.stats.added && !diff.stats.removed) {
      bkwAdd(box, 'div', 'bkw-empty ok', '当前文件与该备份内容一致。');
    }
    for (const hunk of diff.hunks || []) {
      const block = bkwAdd(box, 'div', 'bkw-hunk');
      bkwAdd(
        block,
        'div',
        'bkw-hunk-head',
        '@@ -' + hunk.oldStart + ',' + hunk.oldLen + ' +' + hunk.newStart + ',' + hunk.newLen + ' @@'
      );
      for (const line of hunk.lines) {
        const row = bkwAdd(block, 'div', 'bkw-line' + (line.t === '+' ? ' add' : line.t === '-' ? ' del' : ''));
        bkwAdd(row, 'span', 'no old', line.oldNo == null ? '' : String(line.oldNo));
        bkwAdd(row, 'span', 'no new', line.newNo == null ? '' : String(line.newNo));
        bkwAdd(row, 'span', 'sign', line.t === ' ' ? '' : line.t);
        bkwAdd(row, 'span', 'text', line.text);
      }
    }
    return;
  }

  if (diff.mode === 'db') {
    const table = bkwAdd(box, 'table', 'bkw-table');
    const head = bkwAdd(table, 'thead');
    const hr = bkwAdd(head, 'tr');
    for (const label of ['项目', '备份', '当前', '变化']) bkwAdd(hr, 'th', '', label);
    const body = bkwAdd(table, 'tbody');
    const rows = [
      ['记录数', diff.base.recordCount, diff.current ? diff.current.recordCount : '—', diff.delta.records],
      ['容量', diff.base.capacity, diff.current ? diff.current.capacity : '—', diff.delta.capacity],
      ['记录大小', diff.base.recSize + ' B', diff.current ? diff.current.recSize + ' B' : '—', ''],
      ['文件大小', bkwSize(diff.base.size), diff.current ? bkwSize(diff.current.size) : '—', '']
    ];
    for (const row of rows) {
      const tr = bkwAdd(body, 'tr');
      bkwAdd(tr, 'td', '', row[0]);
      bkwAdd(tr, 'td', '', String(row[1]));
      bkwAdd(tr, 'td', '', String(row[2]));
      const delta = row[3];
      const changed = delta !== '' && delta !== 0;
      bkwAdd(tr, 'td', changed ? (delta > 0 ? 'bkw-up' : 'bkw-down') : '', delta === '' ? '' : (delta > 0 ? '+' + delta : String(delta)));
    }
    bkwAdd(box, 'div', 'bkw-note', '数据库备份只对比文件元信息，不逐条比较记录字段。恢复会原样写回备份字节。');
    return;
  }

  bkwAdd(
    box,
    'div',
    'bkw-empty',
    '该文件无法按文本解析（可能是二进制或编码异常）。备份大小 ' +
      bkwSize(diff.base.size) + '，当前 ' + (diff.current ? bkwSize(diff.current.size) : '不存在') + '。'
  );
}

async function bkwSelectVersion(id) {
  if (!id) return;
  BKW.version = id;
  BKW.diff = null;
  BKW.diffError = '';
  BKW.diffLoading = true;
  bkwRenderTimeline();
  bkwRenderDiff();
  bkwRenderMeta();
  try {
    const diff = await api('/api/backups/diff?id=' + encodeURIComponent(id));
    if (BKW.version !== id) return;
    BKW.diff = diff;
  } catch (e) {
    if (BKW.version !== id) return;
    BKW.diffError = '读取差异失败：' + e.message;
  } finally {
    if (BKW.version === id) {
      BKW.diffLoading = false;
      bkwRenderDiff();
    }
  }
}

function bkwEnsureSelection() {
  const visible = bkwVisibleEvents();
  const current = bkwSelectedEvent();
  bkwRenderTimeline();
  bkwRenderMeta();
  if (current && visible.some((ev) => ev.version.id === current.version.id)) {
    bkwRenderDiff();
    return;
  }
  if (!visible.length) {
    BKW.version = null;
    BKW.diff = null;
    BKW.diffError = '';
    BKW.diffLoading = false;
    bkwRenderTimeline();
    bkwRenderDiff();
    bkwRenderMeta();
    return;
  }
  bkwSelectVersion(visible[0].version.id);
}

function bkwSelectFile(file) {
  BKW.fileFilter = BKW.fileFilter === file ? null : file;
  bkwRenderFiles();
  bkwEnsureSelection();
}

async function bkwLoad(keepVersion) {
  if (BKW.loading) return;
  BKW.loading = true;
  bkwRenderMeta();
  try {
    const data = await api('/api/backups');
    BKW.data = data;
    BKW.events = bkwFlatten(data.groups);
    if (BKW.fileFilter && !data.groups.some((g) => g.file === BKW.fileFilter)) BKW.fileFilter = null;
    bkwRenderFiles();
    const keep = keepVersion && bkwEventById(keepVersion);
    const current = keep || bkwEventById(BKW.version);
    if (current) {
      await bkwSelectVersion(current.version.id);
      return;
    }
    const visible = bkwVisibleEvents();
    if (visible.length) {
      await bkwSelectVersion(visible[0].version.id);
      return;
    }
    BKW.version = null;
    BKW.diff = null;
    BKW.diffError = '';
    bkwRenderTimeline();
    bkwRenderDiff();
  } catch (e) {
    const box = bkwEl('bkwDiff');
    if (box) {
      bkwClear(box);
      bkwAdd(box, 'div', 'bkw-empty err', '加载备份列表失败：' + e.message);
    }
    toast('加载备份列表失败：' + e.message, 'err');
  } finally {
    BKW.loading = false;
    bkwRenderMeta();
  }
}

async function bkwRestoreSelected() {
  const diff = BKW.diff;
  const ev = bkwSelectedEvent();
  if (!diff || !ev) return;
  const version = ev.version;
  const group = ev.group;
  const allowMissing = !diff.targetExists;
  const btn = bkwEl('bkwRestore');
  if (btn) btn.disabled = true;
  const confirmed = await window.uiConfirm({
    title: '恢复备份',
    danger: true,
    message: '将用 ' + version.time + ' 的备份覆盖当前文件：',
    sections: [
      { title: '目标文件', lines: [group.file] },
      { title: '备份版本', lines: [version.time + ' · ' + bkwSize(version.size)] },
      {
        title: '恢复说明',
        tone: 'warn',
        lines: [
          allowMissing ? '目标文件当前不存在，恢复会重新创建它。' : '会覆盖当前文件内容。',
          diff.targetExists ? '恢复前会自动把当前版本再备份一次，可在本页回退。' : '恢复前没有可备份的当前文件。'
        ]
      }
    ],
    okText: '确认恢复'
  });
  if (!confirmed) {
    if (btn) btn.disabled = !BKW.diff || !bkwSelectedEvent();
    return;
  }
  try {
    const result = await api('/api/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: version.id,
        expectedToken: diff.currentToken,
        allowMissing
      })
    });
    toast('已恢复：' + result.file + (result.backup ? '\n原版本已备份：' + result.backup : ''), 'ok');
    await bkwLoad(version.id);
  } catch (e) {
    if (e.data && e.data.code === 'stale') {
      toast('文件已被修改，已重新加载差异，请确认后再次恢复。', 'warn');
    } else if (e.data && e.data.code === 'missing') {
      toast('目标文件不存在，恢复需要重新创建文件。', 'warn');
    } else {
      toast('恢复失败：' + e.message, 'err');
    }
    await bkwLoad(BKW.version);
  }
}

window.openBackupView = openBackupView;
window.hideBackupView = hideBackupView;

document.addEventListener('DOMContentLoaded', () => {
  const filter = bkwEl('bkwFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      clearTimeout(bkwSearchTimer);
      bkwSearchTimer = setTimeout(() => {
        BKW.filter = filter.value;
        bkwRenderFiles();
        bkwEnsureSelection();
      }, 150);
    });
  }
  const files = bkwEl('bkwFileList');
  if (files) {
    files.addEventListener('click', (e) => {
      if (e.target.closest('[data-bkw-all]')) {
        BKW.fileFilter = null;
        bkwRenderFiles();
        bkwEnsureSelection();
        return;
      }
      const item = e.target.closest('[data-bkw-file]');
      if (item) bkwSelectFile(item.dataset.bkwFile);
    });
  }
  const versions = bkwEl('bkwVersionList');
  if (versions) {
    versions.addEventListener('click', (e) => {
      const item = e.target.closest('[data-bkw-version]');
      if (item) bkwSelectVersion(item.dataset.bkwVersion);
    });
  }
  const reload = bkwEl('bkwRefresh');
  if (reload) {
    reload.addEventListener('click', () => bkwLoad(BKW.version));
  }
  const restore = bkwEl('bkwRestore');
  if (restore) restore.addEventListener('click', bkwRestoreSelected);

  function openFromHash() {
    if (bkwHashWanted() && S.mode !== 'backup') openBackupView();
  }
  if (window.appReady && typeof window.appReady.then === 'function') {
    window.appReady.then(() => setTimeout(openFromHash, 30));
  } else {
    openFromHash();
  }
  window.addEventListener('hashchange', openFromHash);
});

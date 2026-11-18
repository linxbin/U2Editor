'use strict';

/* 备份与历史：按文件查看自动备份、对比当前文件并恢复（恢复前自动再备份） */

const BKW = {
  data: null,
  loading: false,
  group: null,
  version: null,
  diff: null,
  diffError: '',
  diffLoading: false,
  filter: ''
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

function bkwGroup() {
  if (!BKW.data) return null;
  return BKW.data.groups.find((g) => g.file === BKW.group) || null;
}

function bkwVersionInfo() {
  const group = bkwGroup();
  if (!group) return null;
  return group.versions.find((v) => v.id === BKW.version) || null;
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
    else {
      const group = bkwGroup();
      hint.textContent = group
        ? group.file + ' · ' + group.count + ' 个版本'
        : '选择一个文件查看备份版本';
    }
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
  const q = BKW.filter.trim().toLowerCase();
  const groups = BKW.data.groups.filter((g) => !q || g.file.toLowerCase().includes(q));
  if (!groups.length) {
    bkwAdd(list, 'div', 'mpw-empty', q ? '没有匹配的备份文件。' : '还没有任何备份。编辑并保存配置后会自动生成。');
    return;
  }
  let lastDir = null;
  for (const group of groups) {
    if (group.dir !== lastDir) {
      bkwAdd(list, 'div', 'bkw-group-head', group.dir || '根目录');
      lastDir = group.dir;
    }
    const item = bkwAdd(list, 'div', 'file-item' + (group.file === BKW.group ? ' active' : ''));
    item.dataset.bkwFile = group.file;
    const name = bkwAdd(item, 'div', 'fname');
    name.textContent = bkwBaseName(group.file);
    name.title = group.file;
    const meta = bkwAdd(item, 'div', 'fmeta' + (group.exists ? '' : ' err'));
    meta.textContent = group.count + ' 个版本' + (group.exists ? '' : ' · 当前文件已删除');
  }
}

function bkwRenderVersions() {
  const list = bkwEl('bkwVersionList');
  if (!list) return;
  bkwClear(list);
  const group = bkwGroup();
  bkwText('bkwVersionHint', group ? group.count + ' 个' : '');
  if (!group) {
    bkwAdd(list, 'div', 'bkw-empty', '请选择左侧的备份文件。');
    return;
  }
  if (!group.versions.length) {
    bkwAdd(list, 'div', 'bkw-empty', '该文件暂无备份版本。');
    return;
  }
  for (const version of group.versions) {
    const item = bkwAdd(list, 'div', 'file-item' + (version.id === BKW.version ? ' active' : ''));
    item.dataset.bkwVersion = version.id;
    bkwAdd(item, 'div', 'fname', version.time);
    bkwAdd(item, 'div', 'fmeta', bkwSize(version.size) + ' · ' + version.name);
  }
}

function bkwDiffMetaText(diff) {
  const parts = [];
  const v = bkwVersionInfo();
  if (v) parts.push(v.time);
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
  bkwText('bkwDiffTitle', diff ? diff.file : '选择左侧版本查看差异');
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
    bkwAdd(box, 'div', 'bkw-empty', '选择左侧的备份版本，右侧会显示它和当前文件的差异。');
    if (restoreBtn) restoreBtn.disabled = true;
    return;
  }
  if (restoreBtn) restoreBtn.disabled = !bkwVersionInfo();

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
  bkwRenderVersions();
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

function bkwSelectGroup(file) {
  if (!file) return;
  BKW.group = file;
  BKW.version = null;
  BKW.diff = null;
  BKW.diffError = '';
  bkwRenderFiles();
  bkwRenderVersions();
  bkwRenderDiff();
  bkwRenderMeta();
  const group = bkwGroup();
  if (group && group.versions.length) bkwSelectVersion(group.versions[0].id);
}

async function bkwLoad(keepVersion) {
  if (BKW.loading) return;
  BKW.loading = true;
  bkwRenderMeta();
  try {
    const data = await api('/api/backups');
    BKW.data = data;
    const groups = data.groups;
    const current = BKW.group && groups.find((g) => g.file === BKW.group);
    if (!current) BKW.group = groups.length ? groups[0].file : null;
    bkwRenderFiles();
    const group = bkwGroup();
    if (!group) {
      BKW.version = null;
      BKW.diff = null;
      BKW.diffError = '';
      bkwRenderVersions();
      bkwRenderDiff();
      return;
    }
    const wanted =
      (keepVersion && group.versions.find((v) => v.id === keepVersion)) ||
      (BKW.version && group.versions.find((v) => v.id === BKW.version)) ||
      group.versions[0];
    if (wanted) await bkwSelectVersion(wanted.id);
    else {
      BKW.version = null;
      BKW.diff = null;
      bkwRenderVersions();
      bkwRenderDiff();
    }
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
  const version = bkwVersionInfo();
  const group = bkwGroup();
  if (!diff || !version || !group) return;
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
    if (btn) btn.disabled = !BKW.diff || !bkwVersionInfo();
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
      }, 150);
    });
  }
  const files = bkwEl('bkwFileList');
  if (files) {
    files.addEventListener('click', (e) => {
      const item = e.target.closest('[data-bkw-file]');
      if (item) bkwSelectGroup(item.dataset.bkwFile);
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

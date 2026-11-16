'use strict';

const path = require('path');
const dbe = require('./dbe');

const SAMPLE_LIMIT = 8;
const ACTIVITY_XML_KEYS = [
  'goaldelivery0', 'goaldelivery1', 'goaldelivery2',
  'rescueprincess0', 'rescueprincess1', 'rescueprincess2'
];
const STARTER_LABELS = {
  starter: '新手礼包',
  diamond: '钻石礼包',
  golden1: '黄金礼包 1',
  golden2: '黄金礼包 2'
};
const SCRIPT_ITEM_API = /(?:giveItemToPlayer(?:AndSetItemBind)?|giveItemToPlayerWithDura|takeItemFromPlayer|checkPlayerItems(?:Num|W)?)\s*\([^\n]*?(['"])%NAME%\1/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeIndices(indices, recordCount) {
  if (!Array.isArray(indices) || !indices.length) {
    throw httpError(400, '请选择要删除的记录');
  }
  const out = [];
  const seen = new Set();
  for (const raw of indices) {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= recordCount) {
      throw httpError(400, `记录序号无效：${raw}`);
    }
    if (seen.has(index)) continue;
    seen.add(index);
    out.push(index);
  }
  return out.sort((a, b) => a - b);
}

function sameExceptIdx(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === 'Idx') continue;
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addGroup(groups, key, label, severity, samples) {
  if (!samples.length) return;
  groups.push({
    key,
    label,
    severity,
    count: samples.length,
    samples: samples.slice(0, SAMPLE_LIMIT),
    truncated: samples.length > SAMPLE_LIMIT
  });
}

function create(options) {
  const itemWorkbench = options.itemWorkbench;
  const taskWorkbench = options.taskWorkbench;
  const starterWorkbench = options.starterWorkbench;
  const castleWorkbench = options.castleWorkbench;
  const scriptWorkbench = options.scriptWorkbench;
  const extraData = options.extraData;
  const opsData = options.opsData;
  const envirDir = path.resolve(options.envirDir);
  const itemFile = path.resolve(options.itemFile);

  function critical(name, fn) {
    try {
      return fn();
    } catch (e) {
      throw httpError(500, `${name}读取失败，已取消删除：${e.message}`);
    }
  }

  function collectOptional(groups, notes, key, label, fn) {
    try {
      const samples = fn();
      addGroup(groups, key, label, 'block', samples);
    } catch (e) {
      notes.push(`${label}读取失败：${e.message}`);
    }
  }

  function collectReferences(groups, notes, name, detail, lastOfName) {
    const drops = (detail.drops || []).map((d) =>
      `${d.file} 第 ${d.line} 行 · ${d.monster || '未知怪物'}`);
    addGroup(groups, 'drop', '爆率 MonItems', 'block', drops);

    const shops = (detail.shops || []).map((s) =>
      `${s.npc ? s.npc + ' · ' : ''}${s.file} 第 ${Number(s.line) + 1} 行`);
    addGroup(groups, 'shop', 'NPC 商店', 'block', shops);

    const tasks = critical('任务配置', () => taskWorkbench.itemReferences(name))
      .map((t) => `任务 ${t.id} ${t.name}${t.fields.length ? '（' + t.fields.join(' / ') + '）' : ''}`);
    addGroup(groups, 'task', '任务（含完成奖励）', 'block', tasks);

    const made = (detail.recipesMake || []).map((r) =>
      `配方「${r.name}」第 ${Number(r.line) + 1} 行`);
    addGroup(groups, 'makeProduct', '合成产物', 'block', made);

    const used = (detail.recipesUse || []).map((r) =>
      `配方「${r.recipe}」需要 ×${r.count}`);
    addGroup(groups, 'makeMaterial', '合成材料', 'block', used);

    const goods = (detail.goods || []).map((g) =>
      `商品 ${g.id}${g.version != null ? ' v' + g.version : ''} 第 ${Number(g.line) + 1} 行`);
    addGroup(groups, 'goods', '商城商品', 'block', goods);

    const mall = (detail.mall || []).map((m) =>
      `商城 ${m.id} 第 ${m.line} 行`);
    addGroup(groups, 'mall', '商城配置 PTItems.xml', 'block', mall);

    const starter = critical('新手/充值礼包', () => {
      const data = starterWorkbench.list();
      const out = [];
      for (const entry of data.entries || []) {
        const label = STARTER_LABELS[entry.source] || entry.label || '礼包';
        for (const item of entry.items || []) {
          if (text(item.name) === name) {
            out.push(`${label}·${entry.label} 第 ${Number(item.line) + 1} 行`);
          }
        }
        for (const row of entry.rows || []) {
          if (text(row.item) === name) {
            out.push(`${label}·${entry.label} 第 ${Number(row.line) + 1} 行`);
          }
        }
      }
      return out;
    });
    addGroup(groups, 'starter', '新手 / 充值礼包', 'block', starter);

    const castle = critical('沙城奖励', () => {
      const data = castleWorkbench.list();
      return ((data.prizes && data.prizes.rows) || [])
        .filter((row) => text(row.item) === name)
        .map((row) => `SabukPrizes.txt 第 ${row.line} 行`);
    });
    addGroup(groups, 'castle', '沙城奖励', 'block', castle);

    collectOptional(groups, notes, 'activity', '活动 XML', () => {
      const out = [];
      for (const key of ACTIVITY_XML_KEYS) {
        const parsed = extraData.parseExtra(envirDir, key);
        for (const row of parsed.rows || []) {
          if (row.tag === 'PrizeObject' && text(row.attrs && row.attrs.name) === name) {
            out.push(`${key}.xml 第 ${Number(row.line) + 1} 行`);
          }
        }
      }
      return out;
    });

    collectOptional(groups, notes, 'boxes', '宝盒奖励', () => {
      const parsed = opsData.parseSectionList(
        path.join(envirDir, opsData.BOX_FILE), '宝盒物品');
      return (parsed.rows || [])
        .filter((row) => text(row.item) === name)
        .map((row) => `宝盒「${row.group}」第 ${Number(row.line) + 1} 行`);
    });

    collectOptional(groups, notes, 'gaimprize', '改名奖励', () => {
      const parsed = extraData.parseExtra(envirDir, 'gaimprize');
      return (parsed.rows || [])
        .filter((row) => row.key === 'prizename' && text(row.value) === name)
        .map((row) => `gaimprize.txt 第 ${Number(row.index) + 1} 行`);
    });

    collectOptional(groups, notes, 'marriage', '婚姻物品', () => {
      const parsed = extraData.parseExtra(envirDir, 'relation');
      return (parsed.rows || [])
        .filter((row) => (row.key === 'ItemsForMarry' || row.key === 'ItemForMarry') &&
          text(row.value) === name)
        .map((row) => `relation.ini ${row.key} 第 ${Number(row.index) + 1} 行`);
    });

    if (detail.item && detail.item.hasDesc) {
      addGroup(groups, 'desc', 'itemdesc.txt 描述', 'info', ['删除后会留下无对应物品的描述分段']);
    }

    if (lastOfName) {
      try {
        const found = scriptWorkbench.search(name, 1000);
        const re = new RegExp(SCRIPT_ITEM_API.source.replace('%NAME%', () => escapeRegExp(name)));
        const scriptRefs = (found.results || [])
          .filter((row) => re.test(row.text || ''))
          .map((row) => `${row.name} 第 ${row.line} 行 · ${row.text}`);
        addGroup(groups, 'script', 'NPC 脚本物品调用（提示）', 'warn', scriptRefs);
      } catch (e) {
        notes.push(`NPC 脚本扫描失败：${e.message}`);
      }
    }
  }

  function check(file, indices, targets) {
    const abs = path.resolve(file);
    if (path.basename(abs).toLowerCase() !== path.basename(itemFile).toLowerCase()) {
      throw httpError(400, '暂仅支持物品数据表删除');
    }
    const loaded = dbe.loadDb(abs);
    const rows = loaded.rows;
    const schema = loaded.schema;
    const nameField = schema.nameField;
    const list = normalizeIndices(indices, rows.length);
    const selected = new Set(list);
    const targetMap = new Map();

    if (targets !== undefined && targets !== null) {
      if (!Array.isArray(targets)) throw httpError(400, '删除校验数据格式不正确');
      for (const item of targets) {
        if (!item || typeof item !== 'object') throw httpError(400, '删除校验数据格式不正确');
        const index = Number(item.index);
        if (!Number.isInteger(index) || !selected.has(index)) {
          throw httpError(400, '删除校验记录与删除列表不一致');
        }
        targetMap.set(index, item);
      }
    }

    for (const index of list) {
      const row = rows[index];
      const name = text(row[nameField]);
      const idx = row.Idx == null ? null : Number(row.Idx);
      const target = targetMap.get(index);
      if (target) {
        if (name !== text(target.name) || Number(idx) !== Number(target.idx)) {
          throw httpError(409, '记录内容已变化，请重新加载后再删除');
        }
      } else {
        targetMap.set(index, { index, name, idx });
      }
    }

    const byName = new Map();
    for (const index of list) {
      const name = text(rows[index][nameField]);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(index);
    }

    const checks = [];
    let blocked = false;
    for (const [name, indexes] of byName) {
      const repIndex = indexes[0];
      const repRow = rows[repIndex];
      const remainingSameName = [];
      for (let i = 0; i < rows.length; i++) {
        if (selected.has(i) || text(rows[i][nameField]) !== name) continue;
        remainingSameName.push({
          index: i,
          idx: rows[i].Idx == null ? null : Number(rows[i].Idx),
          name: rows[i][nameField] == null ? '' : rows[i][nameField],
          sameFields: sameExceptIdx(rows[i], repRow)
        });
      }

      const duplicateIdx = [];
      const seenDup = new Set();
      for (const index of indexes) {
        const idx = rows[index].Idx == null ? null : Number(rows[index].Idx);
        if (idx == null) continue;
        for (let i = 0; i < rows.length; i++) {
          if (selected.has(i)) continue;
          if (Number(rows[i].Idx) !== idx) continue;
          const key = i + ':' + idx;
          if (seenDup.has(key)) continue;
          seenDup.add(key);
          duplicateIdx.push({
            index: i,
            idx,
            name: rows[i][nameField] == null ? '' : rows[i][nameField]
          });
        }
      }

      const lastOfName = name !== '' && remainingSameName.length === 0;
      const groups = [];
      const notes = [];
      const detail = critical('物品引用', () => itemWorkbench.detail(repIndex));
      if (!detail || !detail.item) throw httpError(500, '物品引用检查失败，已取消删除');
      collectReferences(groups, notes, name, detail, lastOfName);
      if (notes.length) {
        groups.push({
          key: 'checkError',
          label: '部分配置读取提示',
          severity: 'warn',
          count: notes.length,
          samples: notes.slice(0, SAMPLE_LIMIT),
          truncated: notes.length > SAMPLE_LIMIT
        });
      }

      const hasBlock = groups.some((g) => g.severity === 'block');
      if (lastOfName && hasBlock) blocked = true;
      checks.push({
        name,
        targets: indexes.map((index) => ({
          index,
          name: text(rows[index][nameField]),
          idx: rows[index].Idx == null ? null : Number(rows[index].Idx)
        })),
        lastOfName,
        remainingSameName,
        duplicateIdx,
        references: groups,
        blocked: lastOfName && hasBlock
      });
    }

    return {
      ok: true,
      file: path.basename(abs),
      supported: true,
      stale: false,
      count: rows.length,
      capacity: schema.capacity,
      indices: list,
      checks,
      blocked
    };
  }

  return { check };
}

module.exports = { create };

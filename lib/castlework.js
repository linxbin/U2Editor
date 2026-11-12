'use strict';

const fs = require('fs');
const path = require('path');
const npcData = require('./npc');
const configs = require('./configs');
const dbe = require('./dbe');

const PSEUDO_ITEMS = new Set(['金币', '经验', '声望', '元宝']);
const MAX_STRING = 60;

const EDITABLE = {
  CastleName: { type: 'string', label: '沙城名称', required: true },
  OwnGuild: { type: 'string', label: '归属行会', required: false },
  CastleMap: { type: 'string', label: '沙城地图', required: true, map: true },
  RoyalMap: { type: 'string', label: '王城地图', required: true, map: true },
  MainDoorOpen: { type: 'int', label: '城门开启', min: 0, max: 1 },
  ArcherMode: { type: 'int', label: '弓箭手模式', min: 0, max: 9 },
  WarDate: { type: 'int', label: '攻城日期模式', min: 0, max: 9 },
  TotalGold: { type: 'int', label: '沙城资金', min: 0, max: 2000000000 },
  IncomeToday: { type: 'int', label: '今日收入', min: 0, max: 2000000000 }
};

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function toInt(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function trimName(value) {
  return String(value == null ? '' : value).trim();
}

function create(options) {
  const files = {
    sabuk: options.sabukFile,
    prizes: options.prizesFile,
    war: options.warFile,
    guild: options.guildFile,
    hero: options.heroFile,
    guard: options.guardFile
  };
  let cache = null;

  function signature() {
    return [
      ...Object.values(files).map((f) => statSig(f)),
      'maps|' + statSig(options.mapInfoFile),
      'items|' + statSig(options.itemFile || '')
    ].join(';');
  }

  function readSafe(file) {
    return configs.readFileLines(file);
  }

  function build() {
    const issues = [];
    const add = (code, severity, section, message, extra) => {
      const e = extra || {};
      issues.push({
        code,
        severity,
        section,
        message,
        file: e.file || '',
        line: e.line == null ? null : e.line,
        action: { view: 'section', section }
      });
    };

    let mapNames = new Map();
    try {
      for (const m of npcData.parseMapNames(options.mapInfoFile)) mapNames.set(m.code, m.name);
    } catch (e) {
      add('castle_mapinfo_unreadable', 'warn', 'overview', `MapInfo 读取失败：${e.message}`);
    }

    let items = null;
    if (options.itemNames) {
      try {
        items = new Set(options.itemNames());
      } catch (e) {
        add('castle_items_unreadable', 'warn', 'prizes', `物品库读取失败：${e.message}`);
      }
    } else if (options.itemFile) {
      try {
        items = new Set(dbe.loadDb(options.itemFile).rows
          .map((r) => trimName(r.Name)).filter(Boolean));
      } catch (e) {
        add('castle_items_unreadable', 'warn', 'prizes', `物品库读取失败：${e.message}`);
      }
    }
    const itemOk = (name) => !items || items.has(name) || PSEUDO_ITEMS.has(name);

    const castle = parseCastle(add, mapNames);
    const prizes = parsePrizes(add, itemOk);
    const war = parseWar(add);
    const guilds = parseGuilds(add);
    const hero = parseHero(add);
    const guards = parseGuards(add, mapNames);

    const counts = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) counts[issue.severity]++;
    issues.sort((a, b) => {
      const order = { error: 0, warn: 1, info: 2 };
      return (order[a.severity] - order[b.severity]) ||
        String(a.code).localeCompare(String(b.code)) ||
        ((a.line == null ? -1 : a.line) - (b.line == null ? -1 : b.line));
    });

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        prizes: prizes.rows.length,
        guilds: guilds.names.length,
        heroGroups: hero.groups.length,
        heroPoints: hero.totalPoints,
        guards: guards.rows.length,
        defenses: castle.defenses.length,
        issues: counts
      },
      castle,
      prizes,
      war,
      guilds,
      hero,
      guards,
      issues
    };
  }

  function parseCastle(add, mapNames) {
    const out = {
      fields: [],
      setup: {},
      mapName: '',
      royalName: '',
      defenses: [],
      sections: [],
      missing: [],
      error: ''
    };
    let parsed;
    try {
      parsed = readSafe(files.sabuk);
    } catch (e) {
      out.error = e.message;
      add('castle_unreadable', 'error', 'overview', `Sabuk.txt 读取失败：${e.message}`);
      return out;
    }
    let section = '';
    const values = new Map();
    for (let i = 0; i < parsed.lines.length; i++) {
      const line = parsed.lines[i];
      const s = line.trim();
      if (!s || s.startsWith(';')) continue;
      const sm = /^\[(.+)\]$/.exec(s);
      if (sm) {
        section = sm[1].trim().toLowerCase();
        if (!out.sections.includes(section)) out.sections.push(section);
        continue;
      }
      const m = /^([A-Za-z][A-Za-z0-9_]*)\s*=(.*)$/.exec(s);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim();
      if (section === 'setup') {
        if (!values.has(key)) {
          values.set(key, { key, value, line: i + 1, raw: line });
          out.fields.push({ key, value, line: i + 1, type: EDITABLE[key] ? EDITABLE[key].type : 'raw' });
          out.setup[key] = value;
        }
      } else if (section === 'defense') {
        if (!values.has(key)) values.set(key, { key, value, line: i + 1, raw: line });
      }
    }
    for (const name of ['setup', 'defense']) {
      if (!out.sections.includes(name)) {
        out.missing.push(name);
        add('castle_section_missing', 'warn', 'overview', `Sabuk.txt 缺少 [${name}] 段`);
      }
    }

    out.mapName = mapNames.get(out.setup.CastleMap) || '';
    out.royalName = mapNames.get(out.setup.RoyalMap) || '';
    for (const key of ['CastleMap', 'RoyalMap']) {
      const value = out.setup[key];
      if (value == null || value === '') {
        add('castle_field_empty', 'warn', 'overview', `Sabuk.txt 的 ${key} 为空`);
      } else if (mapNames.size && !mapNames.has(value)) {
        add('castle_map_missing', 'warn', 'overview',
          `${key} 指向的地图 ${value} 不在 MapInfo 中`);
      }
    }
    for (const key of ['CastleName', 'OwnGuild']) {
      if (!trimName(out.setup[key])) {
        add('castle_field_empty', 'warn', 'overview', `Sabuk.txt 的 ${key} 为空`);
      }
    }
    for (const field of out.fields) {
      const spec = EDITABLE[field.key];
      if (!spec) continue;
      if (spec.type === 'int') {
        const n = toInt(field.value);
        if (n == null || n < spec.min || n > spec.max) {
          add('castle_field_invalid', 'warn', 'overview',
            `${field.key}=${field.value || '（空）'} 不是有效数值（${spec.min}–${spec.max}）`,
            { file: 'Sabuk.txt', line: field.line });
        }
      } else if (spec.required && !trimName(field.value)) {
        add('castle_field_empty', 'warn', 'overview',
          `${field.key} 为空`, { file: 'Sabuk.txt', line: field.line });
      }
    }

    const get = (key) => values.has(key) ? values.get(key).value : null;
    const lineOf = (key) => values.has(key) ? values.get(key).line : null;
    const obj = (kind, label, keys, index) => {
      const name = get(keys.name);
      const x = toInt(get(keys.x));
      const y = toInt(get(keys.y));
      const hp = toInt(get(keys.hp));
      const money = toInt(get(keys.money));
      const entry = {
        kind,
        label,
        index,
        name: name == null ? '' : name,
        x,
        y,
        hp,
        money,
        hpText: get(keys.hp),
        moneyText: get(keys.money),
        line: lineOf(keys.x) || lineOf(keys.name),
        keys
      };
      if (x == null || y == null) {
        add('castle_defense_incomplete', 'warn', 'overview',
          `${label}缺少有效坐标（${keys.x}=${get(keys.x) || '空'}，${keys.y}=${get(keys.y) || '空'}）`,
          { file: 'Sabuk.txt', line: entry.line });
      } else if (x < 0 || y < 0) {
        add('castle_coord_invalid', 'warn', 'overview', `${label}坐标 (${x}, ${y}) 为负数`,
          { file: 'Sabuk.txt', line: entry.line });
      }
      if (hp != null && hp < 0) {
        add('castle_field_invalid', 'warn', 'overview', `${label} HP 为负数（${hp}）`, { file: 'Sabuk.txt', line: entry.line });
      }
      if (money != null && money < 0) {
        add('castle_field_invalid', 'warn', 'overview', `${label} 修理费为负数（${money}）`, { file: 'Sabuk.txt', line: entry.line });
      }
      return entry;
    };

    const wallKeys = (prefix) => ({
      name: prefix + 'Name',
      x: prefix + 'X',
      y: prefix + 'Y',
      hp: prefix + 'HP',
      money: prefix + 'Money'
    });
    out.defenses.push(obj('door', '城门', wallKeys('MainDoor'), 0));
    out.defenses.push(obj('wall', '左墙', wallKeys('LeftWall'), 0));
    out.defenses.push(obj('wall', '中墙', wallKeys('CenterWall'), 0));
    out.defenses.push(obj('wall', '右墙', wallKeys('RightWall'), 0));
    const archers = [...values.keys()]
      .map((key) => /^Archer_(\d+)_X$/.exec(key))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    for (const n of archers) {
      const prefix = `Archer_${n}`;
      out.defenses.push(obj('archer', `弓箭手 ${n}`, {
        name: null,
        x: prefix + '_X',
        y: prefix + '_Y',
        hp: prefix + '_HP',
        money: prefix + '_MONEY'
      }, n));
    }

    const seen = new Map();
    for (const d of out.defenses) {
      if (d.x == null || d.y == null) continue;
      const key = `${d.x},${d.y}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(d);
    }
    for (const [coord, list] of seen) {
      if (list.length < 2) continue;
      add('castle_coord_duplicate', 'info', 'overview',
        `防御设施坐标 ${coord} 重复（${list.map((d) => d.label).join('、')}）`);
    }
    return out;
  }

  function parsePrizes(add, itemOk) {
    const out = { rows: [], error: '' };
    let parsed;
    try {
      parsed = readSafe(files.prizes);
    } catch (e) {
      out.error = e.message;
      add('prizes_unreadable', 'error', 'prizes', `SabukPrizes.txt 读取失败：${e.message}`);
      return out;
    }
    for (let i = 0; i < parsed.lines.length; i++) {
      const raw = parsed.lines[i];
      const s = raw.trim();
      if (!s || s.startsWith(';')) continue;
      const tok = raw.split('\t').map((t) => t.trim());
      const count = toInt(tok[0]);
      const item = tok[1] || '';
      const gold = toInt(tok[2]);
      if (tok.length < 3 || !item) {
        add('prize_row_invalid', 'warn', 'prizes',
          `第 ${i + 1} 行不是「数量 物品 金币」三列格式`, { file: 'SabukPrizes.txt', line: i + 1 });
        continue;
      }
      if (count == null || count <= 0) {
        add('prize_number_invalid', 'warn', 'prizes',
          `第 ${i + 1} 行奖励数量 ${tok[0] || '（空）'} 无效`, { file: 'SabukPrizes.txt', line: i + 1 });
      }
      if (gold == null || gold < 0) {
        add('prize_number_invalid', 'warn', 'prizes',
          `第 ${i + 1} 行金币 ${tok[2] || '（空）'} 无效`, { file: 'SabukPrizes.txt', line: i + 1 });
      }
      if (item && !itemOk(item)) {
        add('prize_item_missing', 'warn', 'prizes',
          `第 ${i + 1} 行奖励物品「${item}」不在 stditems.db 中`, { file: 'SabukPrizes.txt', line: i + 1 });
      }
      out.rows.push({
        index: out.rows.length + 1,
        count,
        item,
        gold,
        countText: tok[0],
        goldText: tok[2],
        itemOk: itemOk(item),
        line: i + 1
      });
    }
    return out;
  }

  function parseWar(add) {
    const out = { entries: [], lineCount: 0, error: '' };
    let parsed;
    try {
      parsed = readSafe(files.war);
    } catch (e) {
      out.error = e.message;
      add('war_unreadable', 'error', 'war', `WarDate.txt 读取失败：${e.message}`);
      return out;
    }
    out.lineCount = parsed.lines.length;
    for (let i = 0; i < parsed.lines.length; i++) {
      const s = parsed.lines[i].trim();
      if (!s || s.startsWith(';')) continue;
      const tok = s.split(/[\t,]/).map((t) => t.trim());
      const recorded = toInt(tok[2]);
      if (tok.length < 3 || tok[0] === '' || tok[1] === '' || (recorded !== 0 && recorded !== 1)) {
        add('war_row_invalid', 'warn', 'war',
          `第 ${i + 1} 行不是「行会 时间 已记录(0/1)」格式`, { file: 'WarDate.txt', line: i + 1 });
        continue;
      }
      out.entries.push({ guild: tok[0], time: tok[1], recorded: recorded === 1, line: i + 1 });
    }
    if (!out.entries.length) {
      add('war_empty', 'info', 'war', 'WarDate.txt 没有手动攻城记录（仅注释或空文件）');
    }
    return out;
  }

  function parseGuilds(add) {
    const out = { names: [], error: '' };
    let parsed;
    try {
      parsed = readSafe(files.guild);
    } catch (e) {
      out.error = e.message;
      add('guild_unreadable', 'error', 'guilds', `Guildlist.txt 读取失败：${e.message}`);
      return out;
    }
    const seen = new Map();
    for (let i = 0; i < parsed.lines.length; i++) {
      const s = parsed.lines[i].trim();
      if (!s || s.startsWith(';')) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) {
        add('guild_duplicate', 'warn', 'guilds',
          `行会「${s}」重复（第 ${seen.get(key)} 行与第 ${i + 1} 行）`, { file: 'Guildlist.txt', line: i + 1 });
        continue;
      }
      seen.set(key, i + 1);
      out.names.push({ name: s, line: i + 1 });
    }
    if (!out.names.length) {
      add('guild_empty', 'info', 'guilds', 'Guildlist.txt 没有行会名单，行会数据可能由数据库维护');
    }
    return out;
  }

  function parseHero(add) {
    const out = { groups: [], totalPoints: 0, error: '' };
    let parsed;
    try {
      parsed = readSafe(files.hero);
    } catch (e) {
      out.error = e.message;
      add('hero_unreadable', 'error', 'hero', `Herofightmappointlist.TXT 读取失败：${e.message}`);
      return out;
    }
    let group = null;
    for (let i = 0; i < parsed.lines.length; i++) {
      const raw = parsed.lines[i];
      const s = raw.trim();
      if (!s) {
        group = null;
        continue;
      }
      if (s.startsWith(';')) continue;
      const tok = s.split(/\s+/).map((t) => t.trim()).filter(Boolean);
      const x = toInt(tok[0]);
      const y = toInt(tok[1]);
      if (tok.length < 2 || x == null || y == null) {
        add('hero_row_invalid', 'warn', 'hero',
          `第 ${i + 1} 行不是「X Y」坐标`, { file: 'Herofightmappointlist.TXT', line: i + 1 });
        continue;
      }
      if (!group) {
        group = { index: out.groups.length + 1, line: i + 1, points: [] };
        out.groups.push(group);
      }
      if (x < 0 || y < 0) {
        add('hero_coord_invalid', 'warn', 'hero',
          `第 ${i + 1} 行坐标 (${x}, ${y}) 为负数`, { file: 'Herofightmappointlist.TXT', line: i + 1 });
      }
      const dup = group.points.find((p) => p.x === x && p.y === y);
      if (dup) {
        add('hero_duplicate', 'info', 'hero',
          `第 ${group.index} 组坐标 (${x}, ${y}) 重复`, { file: 'Herofightmappointlist.TXT', line: i + 1 });
      }
      group.points.push({ x, y, line: i + 1 });
      out.totalPoints++;
    }
    return out;
  }

  function parseGuards(add, mapNames) {
    const out = { rows: [], maps: [], error: '' };
    let parsed;
    try {
      parsed = readSafe(files.guard);
    } catch (e) {
      out.error = e.message;
      add('guard_unreadable', 'error', 'guards', `GuardList.txt 读取失败：${e.message}`);
      return out;
    }
    const seen = new Map();
    for (let i = 0; i < parsed.lines.length; i++) {
      const s = parsed.lines[i].trim();
      if (!s || s.startsWith(';')) continue;
      const m = /^(\S+)\s+(\S+)\s+(\d+)\s*,\s*(\d+)\s*:\s*(\d+)$/.exec(s);
      if (!m) {
        add('guard_row_invalid', 'warn', 'guards',
          `第 ${i + 1} 行不是「名称 地图 坐标 : 方向」格式`, { file: 'GuardList.txt', line: i + 1 });
        continue;
      }
      const row = {
        name: m[1],
        map: m[2],
        mapName: mapNames.get(m[2]) || '',
        x: Number(m[3]),
        y: Number(m[4]),
        dir: Number(m[5]),
        line: i + 1
      };
      if (mapNames.size && !mapNames.has(row.map)) {
        add('guard_map_missing', 'warn', 'guards',
          `第 ${i + 1} 行守卫所在地图 ${row.map} 不在 MapInfo 中`, { file: 'GuardList.txt', line: i + 1 });
      }
      if (row.dir < 0 || row.dir > 7) {
        add('guard_direction_invalid', 'warn', 'guards',
          `第 ${i + 1} 行方向 ${row.dir} 超出 0–7`, { file: 'GuardList.txt', line: i + 1 });
      }
      const key = `${row.map}|${row.x}|${row.y}`;
      if (seen.has(key)) {
        add('guard_duplicate', 'info', 'guards',
          `第 ${i + 1} 行与第 ${seen.get(key)} 行守卫坐标重复（地图 ${row.map} ${row.x}, ${row.y}）`,
          { file: 'GuardList.txt', line: i + 1 });
      } else {
        seen.set(key, i + 1);
      }
      out.rows.push(row);
    }
    const mapStats = new Map();
    for (const row of out.rows) {
      if (!mapStats.has(row.map)) {
        mapStats.set(row.map, { map: row.map, mapName: row.mapName, count: 0 });
      }
      mapStats.get(row.map).count++;
    }
    out.maps = [...mapStats.values()].sort((a, b) => {
      const na = Number(a.map);
      const nb = Number(b.map);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.map.localeCompare(b.map, 'zh-CN');
    });
    return out;
  }

  function ensure() {
    const sig = signature();
    if (cache && cache.sig === sig) return cache.data;
    const data = build();
    cache = { sig, data };
    return data;
  }

  function list() {
    const d = ensure();
    return {
      generatedAt: d.generatedAt,
      stats: d.stats,
      castle: d.castle,
      prizes: d.prizes,
      war: d.war,
      guilds: d.guilds,
      hero: d.hero,
      guards: d.guards,
      issues: d.issues
    };
  }

  function save(body) {
    const input = body && body.fields ? body.fields : body;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('缺少要保存的字段');
    }
    const parsed = readSafe(files.sabuk);
    let mapNames = null;
    try {
      mapNames = new Map(npcData.parseMapNames(options.mapInfoFile).map((m) => [m.code, m.name]));
    } catch (e) {
      mapNames = null;
    }
    const lines = parsed.lines.slice();
    const changed = [];
    for (const [key, raw] of Object.entries(input)) {
      const spec = EDITABLE[key];
      if (!spec) throw new Error(`不能修改字段 ${key}`);
      const value = String(raw == null ? '' : raw).trim();
      if (/[\r\n]/.test(value)) throw new Error(`字段 ${key} 不能包含换行`);
      if (value.length > MAX_STRING) throw new Error(`字段 ${key} 过长（最多 ${MAX_STRING} 字符）`);
      if (spec.required && !value) throw new Error(`${spec.label}不能为空`);
      if (spec.type === 'int') {
        if (!/^\d+$/.test(value)) throw new Error(`${spec.label}必须是整数`);
        const n = Number(value);
        if (n < spec.min || n > spec.max) throw new Error(`${spec.label}必须在 ${spec.min}–${spec.max} 之间`);
      }
      if (spec.map && mapNames && mapNames.size && value && !mapNames.has(value)) {
        throw new Error(`${spec.label} ${value} 不在 MapInfo 中`);
      }
      let hit = false;
      for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*[A-Za-z][A-Za-z0-9_]*\s*=)(.*)$/.exec(lines[i]);
        if (!m) continue;
        const km = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=/.exec(m[1]);
        if (!km || km[1] !== key) continue;
        hit = true;
        if (m[2].trim() !== value) {
          lines[i] = m[1] + value;
          changed.push({ key, from: m[2].trim(), to: value });
        }
        break;
      }
      if (!hit) throw new Error(`Sabuk.txt 中找不到字段 ${key} 的定义`);
    }
    if (!changed.length) {
      return { ok: true, changed: 0, backup: null, fields: changed };
    }
    const backup = configs.writeFileLines(files.sabuk, lines, parsed.eol, parsed.trailing);
    return { ok: true, changed: changed.length, backup, fields: changed };
  }

  function summary() {
    try {
      const d = ensure();
      return {
        stats: {
          prizes: d.stats.prizes,
          guilds: d.stats.guilds,
          heroGroups: d.stats.heroGroups,
          guards: d.stats.guards,
          issues: d.stats.issues
        }
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  return { list, save, summary, invalidate: () => { cache = null; } };
}

module.exports = { create };

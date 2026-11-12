'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dbe = require('./lib/dbe');
const gbk = require('./lib/gbk');
const configs = require('./lib/configs');
const npcData = require('./lib/npc');
const extras = require('./lib/extras');
const mallData = require('./lib/mall');
const mapData = require('./lib/mapinfo');
const opsData = require('./lib/ops');
const extraData = require('./lib/extra');
const monsterData = require('./lib/monster');
const activityData = require('./lib/activity');
const taskData = require('./lib/tasks');
const npcWorkData = require('./lib/npcwork');
const itemWorkData = require('./lib/itemwork');
const growthData = require('./lib/growth');
const dropWorkData = require('./lib/dropwork');
const spawnWorkData = require('./lib/spawnwork');
const mapWorkData = require('./lib/mapwork');
const shopWorkData = require('./lib/shopwork');
const scriptWorkData = require('./lib/scriptwork');
const castleWorkData = require('./lib/castlework');
const textWorkData = require('./lib/textwork');
const starterWorkData = require('./lib/starterwork');
const healthWorkData = require('./lib/healthwork');

const APP_DIR = __dirname;
const ROOT = process.env.DBEDITOR_ROOT
  ? path.resolve(process.env.DBEDITOR_ROOT)
  : path.resolve(APP_DIR, '..', '..');
const ENVIR_DIR = path.resolve(
  process.env.DBEDITOR_ENVIR_DIR || path.join(ROOT, 'GameServer', 'Envir')
);
const DB_DIR = path.resolve(
  process.env.DBEDITOR_DB_DIR || path.join(ENVIR_DIR, 'DB')
);
const DROP_DIR = path.resolve(
  process.env.DBEDITOR_DROP_DIR || path.join(ENVIR_DIR, 'MonItems')
);
const MONGEN_FILE = path.join(ENVIR_DIR, 'Mongen.txt');
const MAKEITEM_FILE = path.join(ENVIR_DIR, 'MakeItem.txt');
const APPELLATION_FILE = path.join(ENVIR_DIR, 'appellation.txt');
const NPC_FILE = path.join(ENVIR_DIR, 'NPCList.txt');
const NPC_SCRIPT_DIR = path.join(ENVIR_DIR, 'NPCScript');
const MAPINFO_FILE = path.join(ENVIR_DIR, 'MapInfo');
const GOODS_FILE = path.join(ENVIR_DIR, 'goodsconfig');
const MONSTER_CHAIN_FILE = path.join(ENVIR_DIR, 'MonsterChain.ini');
const MONSTER_CHILD_FILE = path.join(ENVIR_DIR, 'MonsterChild.ini');
const MALL_FILE = path.join(ENVIR_DIR, 'PTItems.xml');
const SABUK_FILE = path.join(ENVIR_DIR, 'Sabuk.txt');
const SABUK_PRIZES_FILE = path.join(ENVIR_DIR, 'SabukPrizes.txt');
const WAR_FILE = path.join(ENVIR_DIR, 'WarDate.txt');
const GUILD_FILE = path.join(ENVIR_DIR, 'Guildlist.txt');
const HERO_FILE = path.join(ENVIR_DIR, 'Herofightmappointlist.TXT');
const GUARD_FILE = path.join(ENVIR_DIR, 'GuardList.txt');
const ITEMDESC_FILE = path.join(ENVIR_DIR, 'itemdesc.txt');
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const BASE_PORT = Number(process.env.PORT || 8866);

const monsterWorkbench = monsterData.create({
  dbFile: path.join(DB_DIR, 'Monster.DB'),
  itemFile: path.join(DB_DIR, 'stditems.db'),
  mongenFile: MONGEN_FILE,
  childFile: MONSTER_CHILD_FILE,
  mapInfoFile: MAPINFO_FILE,
  dropDir: DROP_DIR
});

const activityWorkbench = activityData.create({
  envirDir: ENVIR_DIR,
  dbDir: DB_DIR,
  scriptDir: NPC_SCRIPT_DIR,
  npcFile: NPC_FILE
});

const taskWorkbench = taskData.create({
  scriptDir: NPC_SCRIPT_DIR,
  npcFile: NPC_FILE,
  dbDir: DB_DIR
});

const npcWorkbench = npcWorkData.create({
  scriptDir: NPC_SCRIPT_DIR,
  npcFile: NPC_FILE,
  mapInfoFile: MAPINFO_FILE,
  itemFile: path.join(DB_DIR, 'stditems.db'),
  itemNames,
  taskWorkbench
});

const growthWorkbench = growthData.create({
  dbDir: DB_DIR
});

const dropWorkbench = dropWorkData.create({
  dropDir: DROP_DIR,
  monsterFile: path.join(DB_DIR, 'Monster.DB'),
  itemFile: path.join(DB_DIR, 'stditems.db'),
  mongenFile: MONGEN_FILE
});

const spawnWorkbench = spawnWorkData.create({
  mongenFile: MONGEN_FILE,
  monsterFile: path.join(DB_DIR, 'Monster.DB'),
  mapinfoFile: MAPINFO_FILE,
  dropDir: DROP_DIR,
  mapDir: path.join(ENVIR_DIR, 'map')
});

const mapWorkbench = mapWorkData.create({
  mapinfoFile: MAPINFO_FILE,
  mapDir: path.join(ENVIR_DIR, 'map'),
  npcFile: NPC_FILE,
  mongenFile: MONGEN_FILE,
  miniMapFile: path.join(ENVIR_DIR, 'MiniMap.txt'),
  miniListFile: path.join(ENVIR_DIR, 'minmaplist.txt')
});

const shopWorkbench = shopWorkData.create({
  dbFile: path.join(DB_DIR, 'stditems.db'),
  makeItemFile: MAKEITEM_FILE,
  goodsFile: GOODS_FILE,
  mallFile: MALL_FILE
});

const scriptWorkbench = scriptWorkData.create({
  scriptDir: NPC_SCRIPT_DIR,
  npcFile: NPC_FILE,
  mapInfoFile: MAPINFO_FILE,
  taskWorkbench
});

const castleWorkbench = castleWorkData.create({
  sabukFile: SABUK_FILE,
  prizesFile: SABUK_PRIZES_FILE,
  warFile: WAR_FILE,
  guildFile: GUILD_FILE,
  heroFile: HERO_FILE,
  guardFile: GUARD_FILE,
  mapInfoFile: MAPINFO_FILE,
  itemFile: path.join(DB_DIR, 'stditems.db'),
  itemNames
});

const textWorkbench = textWorkData.create({
  envirDir: ENVIR_DIR,
  itemFile: path.join(DB_DIR, 'stditems.db'),
  mapInfoFile: MAPINFO_FILE
});

const starterWorkbench = starterWorkData.create({
  envirDir: ENVIR_DIR,
  itemFile: path.join(DB_DIR, 'stditems.db')
});

const itemWorkbench = itemWorkData.create({
  dbFile: path.join(DB_DIR, 'stditems.db'),
  descFile: ITEMDESC_FILE,
  dropDir: DROP_DIR,
  monsterFile: path.join(DB_DIR, 'Monster.DB'),
  npcFile: NPC_FILE,
  scriptDir: NPC_SCRIPT_DIR,
  makeItemFile: MAKEITEM_FILE,
  goodsFile: GOODS_FILE,
  mallFile: MALL_FILE,
  taskWorkbench
});

const healthWorkbench = healthWorkData.create({
  sources: [
    { key: 'itemwork', label: '物品 / 装备', health: () => itemWorkbench.health(), invalidate: () => itemWorkbench.invalidate() },
    { key: 'growth', label: '数值 / 成长', health: () => growthWorkbench.health(), invalidate: () => growthWorkbench.invalidate() },
    { key: 'dropwork', label: '爆率', health: () => dropWorkbench.health(), invalidate: () => dropWorkbench.invalidate() },
    { key: 'spawnwork', label: '刷怪', health: () => spawnWorkbench.health(), invalidate: () => spawnWorkbench.invalidate() },
    { key: 'mapwork', label: '地图', health: () => mapWorkbench.health(), invalidate: () => mapWorkbench.invalidate() },
    { key: 'shopwork', label: '合成 / 商城', health: () => shopWorkbench.health(), invalidate: () => shopWorkbench.invalidate() },
    { key: 'scriptwork', label: '脚本检索', health: () => scriptWorkbench.health(), invalidate: () => scriptWorkbench.invalidate() },
    { key: 'castlework', label: '沙城 / 攻城', health: () => castleWorkbench.health(), invalidate: () => castleWorkbench.invalidate() },
    { key: 'textwork', label: '文案 / 对话', health: () => textWorkbench.health(), invalidate: () => textWorkbench.invalidate() },
    { key: 'starterwork', label: '新手 / 充值', health: () => starterWorkbench.health(), invalidate: () => starterWorkbench.invalidate() }
  ]
});

const DB_NAME_RE = /^[^\\/:*?"<>|]+\.db$/i;
const DROP_NAME_RE = /^[^\\/:*?"<>|]+\.txt$/i;

function safePath(dir, name, re) {
  if (typeof name !== 'string' || !re.test(name)) {
    throw new Error('文件名不合法');
  }
  const full = path.resolve(dir, name);
  if (path.dirname(full) !== dir) {
    throw new Error('路径不合法');
  }
  return full;
}

function json(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('请求 JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function listDbs() {
  const out = [];
  for (const name of fs.readdirSync(DB_DIR)) {
    if (!/\.db$/i.test(name)) continue;
    const full = path.join(DB_DIR, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (e) {
      continue;
    }
    if (!st.isFile()) continue;
    let info = { name, size: st.size, mtime: st.mtimeMs, count: null, capacity: null, recSize: null, error: null };
    try {
      const schema = dbe.parseSchema(fs.readFileSync(full));
      info.count = schema.recordCount;
      info.capacity = schema.capacity;
      info.recSize = schema.recSize;
    } catch (e) {
      info.error = e.message;
    }
    out.push(info);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return out;
}

function listDrops() {
  const out = [];
  for (const name of fs.readdirSync(DROP_DIR)) {
    if (!/\.txt$/i.test(name)) continue;
    const full = path.join(DROP_DIR, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (e) {
      continue;
    }
    if (!st.isFile()) continue;
    out.push({ name, size: st.size, mtime: st.mtimeMs });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return out;
}

const STATIC = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/configs.js': { file: 'configs.js', type: 'application/javascript; charset=utf-8' },
  '/npc.js': { file: 'npc.js', type: 'application/javascript; charset=utf-8' },
  '/labels.js': { file: 'labels.js', type: 'application/javascript; charset=utf-8' },
  '/extras.js': { file: 'extras.js', type: 'application/javascript; charset=utf-8' },
  '/mall.js': { file: 'mall.js', type: 'application/javascript; charset=utf-8' },
  '/mapinfo.js': { file: 'mapinfo.js', type: 'application/javascript; charset=utf-8' },
  '/ops.js': { file: 'ops.js', type: 'application/javascript; charset=utf-8' },
  '/extra.js': { file: 'extra.js', type: 'application/javascript; charset=utf-8' },
  '/monsters.js': { file: 'monsters.js', type: 'application/javascript; charset=utf-8' },
  '/activity.js': { file: 'activity.js', type: 'application/javascript; charset=utf-8' },
  '/tasks.js': { file: 'tasks.js', type: 'application/javascript; charset=utf-8' },
  '/npcwork.js': { file: 'npcwork.js', type: 'application/javascript; charset=utf-8' },
  '/itemwork.js': { file: 'itemwork.js', type: 'application/javascript; charset=utf-8' },
  '/growth.js': { file: 'growth.js', type: 'application/javascript; charset=utf-8' },
  '/drops.js': { file: 'drops.js', type: 'application/javascript; charset=utf-8' },
  '/spawns.js': { file: 'spawns.js', type: 'application/javascript; charset=utf-8' },
  '/maps.js': { file: 'maps.js', type: 'application/javascript; charset=utf-8' },
  '/shopwork.js': { file: 'shopwork.js', type: 'application/javascript; charset=utf-8' },
  '/scriptwork.js': { file: 'scriptwork.js', type: 'application/javascript; charset=utf-8' },
  '/castlework.js': { file: 'castlework.js', type: 'application/javascript; charset=utf-8' },
  '/textwork.js': { file: 'textwork.js', type: 'application/javascript; charset=utf-8' },
  '/starterwork.js': { file: 'starterwork.js', type: 'application/javascript; charset=utf-8' },
  '/healthwork.js': { file: 'healthwork.js', type: 'application/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' }
};

let cachedMonsterNames = null;
let cachedItemNames = null;

function readNames(file) {
  const { rows } = dbe.loadDb(file);
  const set = new Set();
  for (const row of rows) {
    const name = row.Name == null ? '' : String(row.Name).trim();
    if (name) set.add(name);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function monsterNames() {
  if (!cachedMonsterNames) cachedMonsterNames = readNames(path.join(DB_DIR, 'Monster.DB'));
  return cachedMonsterNames;
}

function itemNames() {
  if (!cachedItemNames) cachedItemNames = readNames(path.join(DB_DIR, 'stditems.db'));
  return cachedItemNames;
}

function configSummary() {
  const out = {};
  try {
    const m = configs.parseMongen(MONGEN_FILE);
    out.mongen = { entries: m.entries.length, maps: m.maps.length, invalid: m.special.length };
  } catch (e) {
    out.mongen = { error: e.message };
  }
  try {
    const m = configs.parseMakeItem(MAKEITEM_FILE);
    out.makeitem = { recipes: m.recipes.length, items: m.recipes.reduce((n, r) => n + r.items.length, 0) };
  } catch (e) {
    out.makeitem = { error: e.message };
  }
  try {
    const a = configs.parseAppellation(APPELLATION_FILE);
    out.appellation = { rows: a.rows.length, sections: a.sections.map((s) => s.name) };
  } catch (e) {
    out.appellation = { error: e.message };
  }
  try {
    const n = npcData.parseNpc(NPC_FILE);
    out.npc = { rows: n.rows.length, maps: n.maps.length, scripts: n.scripts.length };
    const s = npcData.parseShops(NPC_SCRIPT_DIR, n.rows);
    out.shops = { npcs: s.shops.length, files: s.files.length, goods: s.goods };
  } catch (e) {
    out.npc = { error: e.message };
    out.shops = { error: e.message };
  }
  try {
    const g = extras.parseGoodsConfig(GOODS_FILE);
    out.goods = { entries: g.entries.length, invalid: g.special.length };
  } catch (e) {
    out.goods = { error: e.message };
  }
  try {
    const c = extras.parseMonsterChain(MONSTER_CHAIN_FILE);
    const ch = extras.parseMonsterChild(MONSTER_CHILD_FILE);
    out.summons = {
      chainGroups: c.groups.length,
      chainEntries: c.entries.length,
      chainInvalid: c.special.length,
      childGroups: ch.groups.length,
      childEntries: ch.rows.length,
      childInvalid: ch.special.length
    };
  } catch (e) {
    out.summons = { error: e.message };
  }
  try {
    const m = mallData.parseMall(MALL_FILE);
    out.mall = {
      items: m.items.length,
      hot: m.hotItems.length,
      classes: m.classes.length,
      subclasses: m.subclasses.length,
      invalid: m.special.length
    };
  } catch (e) {
    out.mall = { error: e.message };
  }
  try {
    const m = mapData.parseMapInfo(MAPINFO_FILE);
    const counts = {};
    let total = 0;
    for (const def of mapData.SECTIONS) {
      const n = m.sections[def.key].rows.length;
      counts[def.key] = n;
      total += n;
    }
    out.mapinfo = { total, counts };
  } catch (e) {
    out.mapinfo = { error: e.message };
  }
  try {
    const o = opsData.parseOps(ENVIR_DIR);
    out.ops = {
      notices: Object.keys(o.notices.files).length,
      quiz: o.quiz.rows.length,
      boxes: o.boxes.rows.length,
      starter: o.starter.rows.length
    };
  } catch (e) {
    out.ops = { error: e.message };
  }
  try {
    out.extra = { files: extraData.listFiles().length };
  } catch (e) {
    out.extra = { error: e.message };
  }
  try {
    out.activity = activityWorkbench.summary();
  } catch (e) {
    out.activity = { error: e.message };
  }
  try {
    out.tasks = taskWorkbench.summary();
  } catch (e) {
    out.tasks = { error: e.message };
  }
  try {
    out.npcwork = npcWorkbench.summary();
  } catch (e) {
    out.npcwork = { error: e.message };
  }
  try {
    out.itemwork = itemWorkbench.summary();
  } catch (e) {
    out.itemwork = { error: e.message };
  }
  try {
    out.growth = growthWorkbench.summary();
  } catch (e) {
    out.growth = { error: e.message };
  }
  try {
    out.dropwork = dropWorkbench.summary();
  } catch (e) {
    out.dropwork = { error: e.message };
  }
  try {
    out.spawnwork = spawnWorkbench.summary();
  } catch (e) {
    out.spawnwork = { error: e.message };
  }
  try {
    out.mapwork = mapWorkbench.summary();
  } catch (e) {
    out.mapwork = { error: e.message };
  }
  try {
    out.shopwork = shopWorkbench.summary();
  } catch (e) {
    out.shopwork = { error: e.message };
  }
  try {
    out.scriptwork = scriptWorkbench.summary();
  } catch (e) {
    out.scriptwork = { error: e.message };
  }
  try {
    out.castlework = castleWorkbench.summary();
  } catch (e) {
    out.castlework = { error: e.message };
  }
  try {
    out.textwork = textWorkbench.summary();
  } catch (e) {
    out.textwork = { error: e.message };
  }
  try {
    out.starterwork = starterWorkbench.summary();
  } catch (e) {
    out.starterwork = { error: e.message };
  }
  try {
    out.healthwork = healthWorkbench.summary();
  } catch (e) {
    out.healthwork = { error: e.message };
  }
  return out;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (req.method === 'GET' && STATIC[pathname]) {
    const item = STATIC[pathname];
    const full = path.join(PUBLIC_DIR, item.file);
    const data = fs.readFileSync(full);
    res.writeHead(200, {
      'Content-Type': item.type,
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    });
    res.end(data);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    json(res, 200, {
      root: ROOT,
      dbDir: DB_DIR,
      dropDir: DROP_DIR,
      dbs: listDbs(),
      drops: listDrops(),
      configs: configSummary()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/db') {
    const file = safePath(DB_DIR, url.searchParams.get('file'), DB_NAME_RE);
    const { schema, rows } = dbe.loadDb(file);
    json(res, 200, {
      file: path.basename(file),
      schema: {
        recSize: schema.recSize,
        recordCount: schema.recordCount,
        capacity: schema.capacity,
        fields: schema.fields.map((f) => ({ name: f.name, kind: f.kind, width: f.width })),
        nameField: schema.nameField,
        nameFieldIsString: schema.nameFieldIsString
      },
      rows
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/db/save') {
    const body = await readBody(req);
    const file = safePath(DB_DIR, body.file, DB_NAME_RE);
    const result = dbe.saveDb(file, body.changes, body.added);
    const saved = path.basename(file).toLowerCase();
    if (saved === 'monster.db') cachedMonsterNames = null;
    if (saved === 'stditems.db') cachedItemNames = null;
    json(res, 200, result);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/drop') {
    const file = safePath(DROP_DIR, url.searchParams.get('file'), DROP_NAME_RE);
    const text = gbk.decodeText(fs.readFileSync(file));
    json(res, 200, { file: path.basename(file), text, size: fs.statSync(file).size });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/drop/save') {
    const body = await readBody(req);
    const file = safePath(DROP_DIR, body.file, DROP_NAME_RE);
    if (typeof body.text !== 'string') throw new Error('缺少文本内容');
    const backup = dbe.backupFile(file);
    fs.writeFileSync(file, gbk.encode(body.text));
    json(res, 200, { ok: true, file: path.basename(file), backup, size: fs.statSync(file).size });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/mongen') {
    const parsed = configs.parseMongen(MONGEN_FILE);
    json(res, 200, {
      file: 'Mongen.txt',
      entries: parsed.entries.map((e) => ({
        map: e.map, x: e.x, y: e.y, monster: e.monster,
        range: e.range, count: e.count, interval: e.interval
      })),
      maps: parsed.maps,
      invalid: parsed.special.map((s) => s.text),
      monsters: monsterNames()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/mongen/save') {
    const body = await readBody(req);
    json(res, 200, { file: 'Mongen.txt', ...configs.saveMongen(MONGEN_FILE, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/makeitem') {
    const parsed = configs.parseMakeItem(MAKEITEM_FILE);
    json(res, 200, {
      file: 'MakeItem.txt',
      recipes: parsed.recipes.map((r) => ({
        name: r.name,
        items: r.items.map((it) => ({ name: it.name, count: it.count }))
      })),
      items: itemNames()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/makeitem/save') {
    const body = await readBody(req);
    json(res, 200, { file: 'MakeItem.txt', ...configs.saveMakeItem(MAKEITEM_FILE, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/appellation') {
    const parsed = configs.parseAppellation(APPELLATION_FILE);
    json(res, 200, {
      file: 'appellation.txt',
      sections: parsed.sections.map((s) => s.name),
      rows: parsed.rows.map((r) => ({
        cls: r.cls, level: r.level, stage: r.stage,
        start: r.start, end: r.end, title: r.title
      }))
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/appellation/save') {
    const body = await readBody(req);
    json(res, 200, { file: 'appellation.txt', ...configs.saveAppellation(APPELLATION_FILE, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/npc') {
    const parsed = npcData.parseNpc(NPC_FILE);
    const mapNames = {};
    for (const m of npcData.parseMapNames(MAPINFO_FILE)) mapNames[m.code] = m.name;
    const pyFiles = new Set(
      fs.readdirSync(NPC_SCRIPT_DIR).filter((f) => /\.py$/i.test(f)).map((f) => f.replace(/\.py$/i, ''))
    );
    json(res, 200, {
      file: 'NPCList.txt',
      rows: parsed.rows.map((r) => ({
        id: r.id, script: r.script, map: r.map, x: r.x, y: r.y, name: r.name, extra: r.extra
      })),
      maps: parsed.maps.map((m) => ({ name: m.name, count: m.count, label: mapNames[m.name] || '' })),
      mapNames,
      scripts: parsed.scripts.map((s) => ({ name: s.name, count: s.count, hasFile: pyFiles.has(s.name) })),
      duplicateIds: parsed.duplicateIds,
      special: parsed.special.map((s) => s.text),
      comments: parsed.comments,
      blanks: parsed.blanks
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/npc/save') {
    const body = await readBody(req);
    json(res, 200, { file: 'NPCList.txt', ...npcData.saveNpc(NPC_FILE, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shops') {
    const npcParsed = npcData.parseNpc(NPC_FILE);
    const parsed = npcData.parseShops(NPC_SCRIPT_DIR, npcParsed.rows);
    const mapNames = {};
    for (const m of npcData.parseMapNames(MAPINFO_FILE)) mapNames[m.code] = m.name;
    json(res, 200, {
      files: parsed.files,
      shops: parsed.shops.map((s) => ({ ...s, mapName: mapNames[s.map] || '' })),
      goods: parsed.goods,
      special: parsed.special,
      items: itemNames(),
      mapNames
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shops/save') {
    const body = await readBody(req);
    const result = npcData.saveShops(NPC_SCRIPT_DIR, body, new Set(itemNames()));
    json(res, 200, result);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/npcwork') {
    json(res, 200, npcWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/npcwork/detail') {
    const raw = url.searchParams.get('index');
    if (raw == null || !/^\d+$/.test(raw)) {
      json(res, 400, { error: 'NPC 序号无效' });
      return;
    }
    const detail = npcWorkbench.detail(Number(raw));
    if (!detail) {
      json(res, 404, { error: '未找到 NPC' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/npcwork/script') {
    const name = url.searchParams.get('name') || '';
    try {
      json(res, 200, npcWorkbench.script(name));
    } catch (e) {
      const status = e && e.code === 'ENOENT' ? 404 : 400;
      json(res, status, { error: status === 404 ? `脚本不存在：${name}` : e.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/drops') {
    json(res, 200, dropWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/drops/item') {
    const key = url.searchParams.get('key');
    if (key == null || key === '') {
      json(res, 400, { error: '物品名称无效' });
      return;
    }
    const detail = dropWorkbench.detail(key);
    if (!detail) {
      json(res, 404, { error: '未找到掉落物品' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/spawns') {
    if (url.searchParams.get('refresh') === '1') spawnWorkbench.invalidate();
    json(res, 200, spawnWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/spawns/map') {
    const key = url.searchParams.get('key');
    if (key == null || key === '') {
      json(res, 400, { error: '地图编号无效' });
      return;
    }
    const detail = spawnWorkbench.detail(key);
    if (!detail) {
      json(res, 404, { error: '未找到刷怪地图' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/maps') {
    if (url.searchParams.get('refresh') === '1') mapWorkbench.invalidate();
    json(res, 200, mapWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/maps/detail') {
    const key = url.searchParams.get('key');
    if (key == null || key === '') {
      json(res, 400, { error: '地图编号无效' });
      return;
    }
    const detail = mapWorkbench.detail(key);
    if (!detail) {
      json(res, 404, { error: '未找到地图' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/growth') {
    json(res, 200, growthWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/shopwork') {
    if (url.searchParams.get('refresh') === '1') shopWorkbench.invalidate();
    json(res, 200, shopWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/shopwork/detail') {
    const type = url.searchParams.get('type');
    const raw = url.searchParams.get('index');
    if (!['recipe', 'goods', 'mall'].includes(type) || raw == null || !/^\d+$/.test(raw)) {
      json(res, 400, { error: '商品类型或序号无效' });
      return;
    }
    const detail = shopWorkbench.detail(type, Number(raw));
    if (!detail) {
      json(res, 404, { error: '未找到商品' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/scriptwork') {
    if (url.searchParams.get('refresh') === '1') scriptWorkbench.invalidate();
    json(res, 200, scriptWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/scriptwork/detail') {
    const name = url.searchParams.get('name');
    if (!name) {
      json(res, 400, { error: '脚本名无效' });
      return;
    }
    const detail = scriptWorkbench.detail(name);
    if (!detail) {
      json(res, 404, { error: '未找到脚本' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/scriptwork/search') {
    const q = url.searchParams.get('q') || '';
    json(res, 200, scriptWorkbench.search(q, url.searchParams.get('limit')));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/castlework') {
    if (url.searchParams.get('refresh') === '1') castleWorkbench.invalidate();
    json(res, 200, castleWorkbench.list());
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/castlework/save') {
    const body = await readBody(req);
    try {
      json(res, 200, { file: 'Sabuk.txt', ...castleWorkbench.save(body) });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/textwork') {
    if (url.searchParams.get('refresh') === '1') textWorkbench.invalidate();
    json(res, 200, textWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/textwork/detail') {
    const detail = textWorkbench.detail(url.searchParams.get('source'), url.searchParams.get('index'));
    if (!detail) {
      json(res, 404, { error: '未找到文案条目' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/textwork/search') {
    const q = url.searchParams.get('q') || '';
    json(res, 200, textWorkbench.search(q, url.searchParams.get('limit')));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/starterwork') {
    if (url.searchParams.get('refresh') === '1') starterWorkbench.invalidate();
    json(res, 200, starterWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/starterwork/detail') {
    const detail = starterWorkbench.detail(url.searchParams.get('source'), url.searchParams.get('index'));
    if (!detail) {
      json(res, 404, { error: '未找到礼包条目' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/starterwork/search') {
    const q = url.searchParams.get('q') || '';
    json(res, 200, starterWorkbench.search(q, url.searchParams.get('limit')));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/healthwork') {
    if (url.searchParams.get('refresh') === '1') healthWorkbench.invalidate();
    json(res, 200, healthWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/healthwork/search') {
    json(res, 200, healthWorkbench.search(url.searchParams.get('q') || '', url.searchParams.get('limit')));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/itemwork') {
    json(res, 200, itemWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/itemwork/detail') {
    const raw = url.searchParams.get('index');
    if (raw == null || !/^\d+$/.test(raw)) {
      json(res, 400, { error: '物品序号无效' });
      return;
    }
    const detail = itemWorkbench.detail(Number(raw));
    if (!detail) {
      json(res, 404, { error: '未找到物品' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/goods') {
    const parsed = extras.parseGoodsConfig(GOODS_FILE);
    json(res, 200, {
      file: 'goodsconfig',
      entries: parsed.entries.map((e) => ({ id: e.id, version: e.version, name: e.name })),
      invalid: parsed.special.map((s) => s.text)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/goods/save') {
    const body = await readBody(req);
    json(res, 200, { file: 'goodsconfig', ...extras.saveGoodsConfig(GOODS_FILE, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/summons') {
    const chain = extras.parseMonsterChain(MONSTER_CHAIN_FILE);
    const child = extras.parseMonsterChild(MONSTER_CHILD_FILE);
    json(res, 200, {
      files: { chain: 'MonsterChain.ini', child: 'MonsterChild.ini' },
      chain: {
        groups: chain.groups,
        entries: chain.entries.map((e) => ({
          group: e.group, monster: e.monster, x: e.x, y: e.y, range: e.range, count: e.count
        })),
        invalid: chain.special.map((s) => s.text)
      },
      child: {
        groups: child.groups,
        rows: child.rows.map((r) => ({ parent: r.parent, child: r.child })),
        invalid: child.special.map((s) => s.text)
      },
      monsters: monsterNames()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/summons/save') {
    const body = await readBody(req);
    json(res, 200, extras.saveSummons(MONSTER_CHAIN_FILE, MONSTER_CHILD_FILE, body));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/mall') {
    const parsed = mallData.parseMall(MALL_FILE);
    json(res, 200, {
      file: 'PTItems.xml',
      classes: parsed.classes.map((c) => ({ index: c.index, id: c.id, type: c.type })),
      subclasses: parsed.subclasses.map((s) => ({
        index: s.index, classIndex: s.classIndex, classId: s.classId, id: s.id, type: s.type
      })),
      items: parsed.items.map((it) => ({
        index: it.index,
        classIndex: it.classIndex,
        classId: it.classId,
        classType: it.classType,
        subIndex: it.subIndex,
        subId: it.subId,
        subType: it.subType,
        ...it.values
      })),
      hotItems: parsed.hotItems.map((it) => ({ index: it.index, ...it.values })),
      scroll: parsed.scroll ? parsed.scroll.value : null,
      invalid: parsed.special.map((s) => s.text)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/mall/save') {
    const body = await readBody(req);
    json(res, 200, { file: 'PTItems.xml', ...mallData.saveMall(MALL_FILE, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/mapinfo') {
    const parsed = mapData.parseMapInfo(MAPINFO_FILE);
    const sections = mapData.SECTIONS.map((def) => {
      const sec = parsed.sections[def.key];
      return {
        key: def.key,
        name: def.name,
        label: def.label,
        kind: def.kind,
        rows: sec.rows.map((r) => ({ index: r.index, ...r.values })),
        invalid: sec.special.map((s) => s.text)
      };
    });
    const mapNames = {};
    for (const m of npcData.parseMapNames(MAPINFO_FILE)) mapNames[m.code] = m.name;
    json(res, 200, { file: 'MapInfo', sections, mapNames });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/mapinfo/save') {
    const body = await readBody(req);
    json(res, 200, { file: 'MapInfo', ...mapData.saveMapInfo(MAPINFO_FILE, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/ops') {
    json(res, 200, opsData.parseOps(ENVIR_DIR));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/ops/notices/save') {
    const body = await readBody(req);
    json(res, 200, opsData.saveNotices(ENVIR_DIR, body));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/ops/quiz/save') {
    const body = await readBody(req);
    json(res, 200, { file: opsData.QUIZ_FILE, ...opsData.saveQuiz(path.join(ENVIR_DIR, opsData.QUIZ_FILE), body) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/ops/boxes/save') {
    const body = await readBody(req);
    json(res, 200, { file: opsData.BOX_FILE, ...opsData.saveBoxes(ENVIR_DIR, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/extra') {
    json(res, 200, { files: extraData.listFiles() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/extra/data') {
    const key = url.searchParams.get('key');
    json(res, 200, extraData.parseExtra(ENVIR_DIR, key));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/extra/save') {
    const body = await readBody(req);
    json(res, 200, { file: body.key, ...extraData.saveExtra(ENVIR_DIR, body.key, body.payload || {}) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/ops/starter/save') {
    const body = await readBody(req);
    json(res, 200, { file: opsData.STARTER_FILE, ...opsData.saveStarter(ENVIR_DIR, body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/activity') {
    json(res, 200, activityWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/tasks') {
    json(res, 200, taskWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/task/options') {
    json(res, 200, taskWorkbench.options());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config/task') {
    const id = url.searchParams.get('id');
    if (id == null || !/^\d+$/.test(id)) {
      json(res, 400, { error: '任务 ID 无效' });
      return;
    }
    const detail = taskWorkbench.detail(id);
    if (!detail) {
      json(res, 404, { error: '未找到任务 ' + id });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/task/toggle') {
    const body = await readBody(req);
    const id = body.id;
    if (id == null || !/^\d+$/.test(String(id))) {
      json(res, 400, { error: '任务 ID 无效' });
      return;
    }
    if (typeof body.enabled !== 'boolean') {
      json(res, 400, { error: '缺少 enabled 参数' });
      return;
    }
    const result = taskWorkbench.setEnabled(id, body.enabled, { force: !!body.force });
    if (result.notFound) {
      json(res, 404, { error: '未找到任务 ' + id });
      return;
    }
    if (result.blocked) {
      json(res, 409, { error: '任务仍被引用', dependents: result.dependents });
      return;
    }
    json(res, 200, result);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/task/batch') {
    const body = await readBody(req);
    const moduleId = String(body.module || '').trim();
    if (!moduleId) {
      json(res, 400, { error: '缺少模块 ID' });
      return;
    }
    if (typeof body.enabled !== 'boolean') {
      json(res, 400, { error: '缺少 enabled 参数' });
      return;
    }
    const result = taskWorkbench.setModuleEnabled(moduleId, body.enabled, { force: !!body.force });
    if (result.notFound) {
      json(res, 404, { error: '未知模块 ' + moduleId });
      return;
    }
    if (result.blocked) {
      json(res, 409, { error: '部分任务仍被引用', dependents: result.dependents });
      return;
    }
    json(res, 200, result);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/task/cleanup-orphans') {
    json(res, 200, taskWorkbench.cleanOrphanSwitches());
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/task/patch') {
    const body = await readBody(req);
    const id = body.id;
    if (id == null || !/^\d+$/.test(String(id))) {
      json(res, 400, { error: '任务 ID 无效' });
      return;
    }
    if (!body.kind) {
      json(res, 400, { error: '缺少修复类型' });
      return;
    }
    try {
      const result = taskWorkbench.patchTask(id, { kind: body.kind, from: body.from, to: body.to });
      if (result.notFound) {
        json(res, 404, { error: '未找到任务 ' + id });
        return;
      }
      json(res, 200, result);
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/monster/list') {
    json(res, 200, monsterWorkbench.list());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/monster/detail') {
    json(res, 200, monsterWorkbench.detail(url.searchParams.get('name')));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/monster/drop') {
    json(res, 200, monsterWorkbench.drop(url.searchParams.get('file')));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/monster/drop/save') {
    const body = await readBody(req);
    json(res, 200, monsterWorkbench.saveDrop(body.file, body));
    return;
  }

  json(res, 404, { error: '接口不存在' });
}

let port = BASE_PORT;
let attempts = 0;

function start() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) {
        json(res, 500, { error: err.message || String(err) });
      } else {
        res.end();
      }
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts < 10) {
      attempts++;
      port++;
      start();
      return;
    }
    console.error('启动失败：' + err.message);
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log('');
    console.log('  传世 DB 编辑器已启动');
    console.log('  数据库目录：' + DB_DIR);
    console.log('  爆率目录：  ' + DROP_DIR);
    console.log('  地址：      ' + url);
    console.log('  关闭此窗口即退出编辑器');
    console.log('');
    if (process.platform === 'win32' && !process.env.DBEDITOR_NO_OPEN) {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    }
  });
}

start();

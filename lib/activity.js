'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbe = require('./dbe');
const npcData = require('./npc');
const extraData = require('./extra');
const opsData = require('./ops');
const configs = require('./configs');

const YB_DIR = '元宝充值';
const YB_SCRIPT = 'YuanbSz_0.py';
const VIRTUAL_PRIZES = new Set(['金币', '经验', '声望', '元宝', '灵符']);
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

const SWITCH_KEYS = new Set([
  'quiz', 'starstone', 'changebox', 'TollGate', 'ARENA', 'bigredbag', 'tulonggiven',
  'newyearblock', 'tianlaofree', 'skyrocket', 'globalbx', 'b_jdcstart', '100Beast',
  'onlyyou', 'DemonHunter', 'shenxuse', 'muxuse', 'jinxuse', 'tuxuse', 'huoxuse', 'shuixuse'
]);

const PLACEHOLDER_RE = /^(这是类型\s*\d+|类型\s*\d+|no|无|暂无|todo)[。.!！]?$/i;

const EF = (name, role, key) => ({ name, role, view: 'extra', key });
const OF = (name, role, tab) => ({ name, role, view: 'ops', tab });
const ED = (label, view, key, tab) => ({ label, view, key, tab });

const ACTIVITIES = [
  {
    id: 'goaldelivery', name: '送宝活动', category: '活动副本',
    desc: '限时刷怪送宝：按玩家等级生成怪物与奖品，0/1/2 三份副本内容应保持一致。',
    files: [EF('goaldelivery0.xml', '副本 0', 'goaldelivery0'), EF('goaldelivery1.xml', '副本 1', 'goaldelivery1'), EF('goaldelivery2.xml', '副本 2', 'goaldelivery2')],
    editors: [ED('编辑副本 0', 'extra', 'goaldelivery0'), ED('编辑副本 1', 'extra', 'goaldelivery1'), ED('编辑副本 2', 'extra', 'goaldelivery2')]
  },
  {
    id: 'rescueprincess', name: '救公主', category: '活动副本',
    desc: '救公主副本：怪物波次、奖品概率和时间段配置，0/1/2 三份副本内容应保持一致。',
    files: [EF('rescueprincess0.xml', '副本 0', 'rescueprincess0'), EF('rescueprincess1.xml', '副本 1', 'rescueprincess1'), EF('rescueprincess2.xml', '副本 2', 'rescueprincess2')],
    editors: [ED('编辑副本 0', 'extra', 'rescueprincess0'), ED('编辑副本 1', 'extra', 'rescueprincess1'), ED('编辑副本 2', 'extra', 'rescueprincess2')]
  },
  {
    id: 'sabuk', name: '沙巴克', category: '攻城',
    desc: '沙巴克城堡设置、攻城日期和城主奖励（人数/次数、奖励类型、数值）。',
    files: [EF('SabukPrizes.txt', '城主奖励', 'sabukprizes'), EF('Sabuk.txt', '城堡设置', 'sabuk'), EF('WarDate.txt', '攻城记录', 'wardate')],
    editors: [ED('编辑城主奖励', 'extra', 'sabukprizes'), ED('编辑城堡设置', 'extra', 'sabuk'), ED('编辑攻城记录', 'extra', 'wardate')]
  },
  {
    id: 'inferno', name: '炼狱', category: '地图玩法',
    desc: '炼狱地图刷怪与怪物攻击参数；文件使用 TAB 分列，空列会导致该行参数错位。',
    files: [EF('infernonormal.txt', '普通刷怪', 'infernonormal'), EF('infernoattack.txt', '怪物攻击', 'infernoattack')],
    editors: [ED('编辑普通刷怪', 'extra', 'infernonormal'), ED('编辑怪物攻击', 'extra', 'infernoattack')]
  },
  {
    id: 'gemrand', name: '宝石随机', category: '养成玩法',
    desc: '宝石升级随机百分比按等级配置，数值应随等级递增且不超过 100。',
    files: [EF('GemRandState.TXT', '随机状态', 'gemrand')],
    editors: [ED('编辑随机状态', 'extra', 'gemrand')]
  },
  {
    id: 'recharge', name: '充值礼包', category: '充值',
    desc: '钻石/黄金账号礼包奖励，以及元宝充值队列文件（yb*.txt）。',
    files: [EF('DiamondAccount.txt', '钻石礼包', 'diamond'), EF('goldenaccount1.txt', '黄金礼包 1', 'golden1'), EF('goldenaccount2.txt', '黄金礼包 2', 'golden2')],
    dirs: [{ name: YB_DIR, role: '元宝充值队列' }],
    editors: [ED('编辑钻石礼包', 'extra', 'diamond'), ED('编辑黄金礼包 1', 'extra', 'golden1'), ED('编辑黄金礼包 2', 'extra', 'golden2')]
  },
  {
    id: 'quiz', name: '王城答题', category: '运营活动',
    desc: '王城答题题库，每行「题目/选项/选项/选项」。',
    files: [OF('qlib.TXT', '题库', 'quiz')],
    editors: [ED('编辑答题题库', 'ops', null, 'quiz')]
  },
  {
    id: 'boxes', name: '宝盒与新手礼包', category: '运营活动',
    desc: '宝盒奖励池和出生礼包物品。',
    files: [OF('宝盒设置.ini', '宝盒奖励池', 'boxes'), OF('newPlayerItem.ini', '新手礼包', 'starter')],
    editors: [ED('编辑宝盒奖励池', 'ops', null, 'boxes'), ED('编辑新手礼包', 'ops', null, 'starter')]
  },
  {
    id: 'notices', name: '系统公告', category: '运营活动',
    desc: '登录公告、滚动公告、健康公告和祝福语文本。',
    files: [OF('LineNotice.txt', '系统公告', 'notices'), OF('FloatAD.txt', '滚动公告', 'notices'), OF('Bullitin.ini', '健康公告', 'notices'), OF('bless.txt', '祝福语', 'notices')],
    editors: [ED('编辑系统公告', 'ops', null, 'notices')]
  },
  {
    id: 'monsterdialog', name: '活动对话', category: '活动文本',
    desc: '按类型分段的活动对白文本；占位文本说明该类型尚未撰写。',
    files: [EF('MonsterDialog.txt', '对话文本', 'monsterdialog')],
    editors: [ED('编辑活动对话', 'extra', 'monsterdialog')]
  },
  {
    id: 'speaking', name: 'BOSS 喊话', category: '地图玩法',
    desc: '特殊 BOSS 的地图、存活/死亡喊话和召唤信息。',
    files: [EF('speckingmonster.txt', '喊话配置', 'speckingmonster')],
    editors: [ED('编辑 BOSS 喊话', 'extra', 'speckingmonster')]
  },
  {
    id: 'gaimprize', name: '改名奖励', category: '福利',
    desc: '改名成功后发放的七龙珠奖励，prizenum 应与 prizename 数量一致。',
    files: [EF('gaimprize.txt', '奖励配置', 'gaimprize')],
    editors: [ED('编辑改名奖励', 'extra', 'gaimprize')]
  },
  {
    id: 'globals', name: '全局活动开关', category: '活动开关',
    desc: 'globeparams.txt 中的活动开关（0 关闭 / 1 开启）与全局参数。',
    files: [EF('globeparams.txt', '全局参数', 'globeparams')],
    editors: [ED('编辑全局参数', 'extra', 'globeparams')]
  }
];

const RANKINGS = [
  {
    id: 'guildExp', name: '行会经验排行', npc: '江湖百晓生',
    scripts: ['SocAknow_0.py'],
    dataSource: '引擎 API（maxGuildExp / guildExpNextPage）',
    notes: '行会经验排行由引擎实时统计，没有本地配置文件。'
  },
  {
    id: 'hero', name: '英雄排行榜', npc: '英雄排行榜',
    scripts: ['QueWish9_0.py', 'yingxiongbang.py'],
    dataSource: 'MySQL（pyYuanlContest153 / pyYuanlContestLog）',
    notes: '排行榜数据存于 MySQL；yingxiongbang.py 需要被 NPC 调用才会生效。'
  },
  {
    id: 'smallGame', name: '江湖公告 / 武馆 Top50', npc: '江湖公告',
    scripts: ['Speband_0.py', 'Speband_1.py', 'Speband_2.py', 'Speband_3.py', 'Speband_4.py', 'Speband_5.py', 'Speband_7.py'],
    dataSource: '引擎 API（showSmallGameTop50）',
    notes: 'Top50 数据由引擎接口实时生成，脚本只负责展示。'
  },
  {
    id: 'princessBox', name: '救公主宝箱排行', npc: '国王',
    scripts: ['SocKing_SH000.py', 'SocKing_SH050.py'],
    dataSource: 'MySQL（pyPrincessPrize）',
    notes: '宝箱积分存于 MySQL；国王 NPC 分布在多个 SH 编号地图。'
  }
];

function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch (e) {
    return 'missing';
  }
}

function dirSig(dir) {
  try {
    const names = fs.readdirSync(dir).sort();
    return names.map((n) => {
      try {
        const st = fs.statSync(path.join(dir, n));
        return `${n}:${st.size}:${st.mtimeMs}`;
      } catch (e) {
        return n + ':?';
      }
    }).join(',');
  } catch (e) {
    return 'missing';
  }
}

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function isIntStr(value) {
  return /^-?\d+$/.test(String(value == null ? '' : value).trim());
}

function intIn(value, min, max) {
  if (!isIntStr(value)) return false;
  const n = Number(value);
  return n >= min && n <= max;
}

function stripComment(line) {
  const semi = line.indexOf(';');
  return semi >= 0 ? line.slice(0, semi) : line;
}

function makeCollector(add, code, severity, activityId, file) {
  const items = [];
  let total = 0;
  return {
    push(line, message) {
      total++;
      if (items.length < 20) items.push({ line, message });
    },
    flush() {
      for (const item of items) {
        add(code, severity, item.message, activityId, { file, line: item.line });
      }
      if (total > items.length) {
        add(code, severity, `${file} 另有 ${total - items.length} 处同类问题未逐条列出`, activityId, { file });
      }
    },
    get total() {
      return total;
    }
  };
}

function create(options) {
  const envirDir = options.envirDir;
  const dbDir = options.dbDir;
  const scriptDir = options.scriptDir;
  const npcFile = options.npcFile;
  let cache = null;

  function signature() {
    const parts = [];
    for (const act of ACTIVITIES) {
      for (const f of act.files) parts.push(f.name + '|' + statSig(path.join(envirDir, f.name)));
      for (const d of act.dirs || []) parts.push(d.name + '|' + dirSig(path.join(envirDir, d.name)));
    }
    for (const name of ['Monster.DB', 'stditems.db']) parts.push(name + '|' + statSig(path.join(dbDir, name)));
    parts.push('NPCList.txt|' + statSig(npcFile));
    for (const rank of RANKINGS) {
      for (const s of rank.scripts) parts.push(s + '|' + statSig(path.join(scriptDir, s)));
    }
    parts.push(YB_SCRIPT + '|' + statSig(path.join(scriptDir, YB_SCRIPT)));
    return parts.join(';');
  }

  function build() {
    const issues = [];
    const issuesByActivity = new Map();
    const md5Cache = new Map();
    const globalsInfo = {
      xmlCopies: [],
      switches: { checked: 0, invalid: 0, total: 0 },
      yb: { files: 0, zeroByte: 0, duplicateNames: [], script: YB_SCRIPT, scriptExists: false, absolutePaths: 0 }
    };

    function add(code, severity, message, activityId, extra) {
      const issue = {
        code,
        severity,
        message,
        activityId: activityId || '',
        scope: (extra && extra.scope) || '',
        file: (extra && extra.file) || '',
        line: (extra && extra.line) || 0,
        jump: (extra && extra.jump) || null
      };
      issues.push(issue);
      const id = issue.activityId;
      if (!issuesByActivity.has(id)) issuesByActivity.set(id, { error: 0, warn: 0, info: 0 });
      issuesByActivity.get(id)[severity]++;
    }

    function fileMd5(name) {
      if (!md5Cache.has(name)) {
        try {
          md5Cache.set(name, md5(path.join(envirDir, name)));
        } catch (e) {
          md5Cache.set(name, null);
        }
      }
      return md5Cache.get(name);
    }

    function enrichFile(activity, f) {
      const full = path.join(envirDir, f.name);
      const out = {
        name: f.name, role: f.role, view: f.view, key: f.key || null, tab: f.tab || null,
        dir: false, exists: false, size: 0, mtime: 0
      };
      let st = null;
      try {
        st = fs.statSync(full);
      } catch (e) {
        st = null;
      }
      if (!st || !st.isFile()) {
        add('activity_file_missing', 'error', `缺少文件 ${f.name}`, activity.id, { file: f.name });
        return out;
      }
      out.exists = true;
      out.size = st.size;
      out.mtime = st.mtimeMs;
      try {
        fs.accessSync(full, fs.constants.R_OK);
      } catch (e) {
        add('activity_file_unreadable', 'error', `${f.name} 无法读取：${e.message}`, activity.id, { file: f.name });
      }
      return out;
    }

    function enrichDir(activity, d) {
      const full = path.join(envirDir, d.name);
      const out = {
        name: d.name, role: d.role, view: null, key: null, tab: null,
        dir: true, exists: false, size: 0, mtime: 0, fileCount: 0
      };
      let st = null;
      try {
        st = fs.statSync(full);
      } catch (e) {
        st = null;
      }
      if (!st || !st.isDirectory()) {
        add('activity_dir_missing', 'error', `缺少目录 ${d.name}`, activity.id, { file: d.name });
        return out;
      }
      out.exists = true;
      out.mtime = st.mtimeMs;
      try {
        out.fileCount = fs.readdirSync(full).filter((n) => fs.statSync(path.join(full, n)).isFile()).length;
      } catch (e) {
        add('activity_file_unreadable', 'error', `${d.name} 目录无法读取：${e.message}`, activity.id, { file: d.name });
      }
      return out;
    }

    const activities = ACTIVITIES.map((act) => {
      const files = act.files.map((f) => enrichFile(act, f));
      const dirs = (act.dirs || []).map((d) => enrichDir(act, d));
      return {
        id: act.id,
        name: act.name,
        category: act.category,
        desc: act.desc,
        fileCount: act.files.length,
        files: files.concat(dirs),
        dirCount: dirs.length,
        editors: act.editors,
        metrics: [],
        issues: { error: 0, warn: 0, info: 0 }
      };
    });
    const byId = new Map(activities.map((a) => [a.id, a]));
    const fileByName = new Map();
    for (const act of activities) {
      for (const f of act.files) fileByName.set(f.name, f);
    }

    let monsterSet = null;
    let itemSet = null;
    function dbNames(file, label) {
      try {
        const { rows } = dbe.loadDb(path.join(dbDir, file));
        return new Set(rows.map((r) => String(r.Name == null ? '' : r.Name).trim()).filter(Boolean));
      } catch (e) {
        add('activity_file_unreadable', 'error', `无法读取 ${label}：${e.message}`, '', { file });
        return null;
      }
    }
    function monsters() {
      if (!monsterSet) monsterSet = dbNames('Monster.DB', 'Monster.DB') || false;
      return monsterSet || null;
    }
    function items() {
      if (!itemSet) itemSet = dbNames('stditems.db', 'stditems.db') || false;
      return itemSet || null;
    }

    function parseExtraFile(file) {
      try {
        return extraData.parseExtra(envirDir, file.key);
      } catch (e) {
        add('activity_file_unreadable', 'error', `${file.name} 解析失败：${e.message}`, findActivityId(file.name), { file: file.name });
        return null;
      }
    }
    function findActivityId(name) {
      for (const act of ACTIVITIES) {
        if (act.files.some((f) => f.name === name)) return act.id;
      }
      return '';
    }

    function checkTableInvalid(activity, file, parsed) {
      if (!parsed || !parsed.invalid || !parsed.invalid.length) return;
      const first = parsed.invalid[0];
      add('activity_line_invalid', 'warn',
        `${file.name} 有 ${parsed.invalid.length} 行无法识别（首个在第 ${first.line + 1} 行）`,
        activity.id, { file: file.name, line: first.line + 1 });
    }

    function checkXml(activity, file) {
      const parsed = parseExtraFile(file);
      if (!parsed) return null;
      const rows = parsed.rows || [];
      if (!rows.length) {
        add('xml_root_invalid', 'warn', `${file.name} 中没有可识别的 XML 属性节点`, activity.id, { file: file.name, line: 1 });
        return null;
      }
      const mset = monsters();
      const iset = items();
      const missingMonsters = new Map();
      const missingItems = new Map();
      const prob = makeCollector(add, 'xml_prob_invalid', 'warn', activity.id, file.name);
      const num = makeCollector(add, 'xml_num_invalid', 'warn', activity.id, file.name);
      const attr = makeCollector(add, 'xml_attr_invalid', 'warn', activity.id, file.name);
      const monsterNames = new Set();
      let monsterObjects = 0;
      let prizeObjects = 0;
      let prizeProbs = 0;
      for (const row of rows) {
        const line = row.line + 1;
        const a = row.attrs;
        if (row.tag === 'MonsterObject') {
          monsterObjects++;
          if (!a.name) attr.push(line, `${file.name} 第 ${line} 行 MonsterObject 缺少 name`);
          else {
            monsterNames.add(a.name);
            if (mset && !mset.has(a.name) && !missingMonsters.has(a.name)) missingMonsters.set(a.name, line);
          }
          if (!intIn(a.num, 0, 100000)) num.push(line, `第 ${line} 行怪物数量 num="${a.num || ''}" 不是 0-100000 的整数`);
          for (const k of ['posx', 'posy', 'range']) {
            if (!intIn(a[k], 0, 100000)) attr.push(line, `第 ${line} 行 ${k}="${a[k] || ''}" 不是 0-100000 的整数`);
          }
        } else if (row.tag === 'Position') {
          for (const k of ['posx', 'posy', 'range']) {
            if (!intIn(a[k], 0, 100000)) attr.push(line, `第 ${line} 行 ${k}="${a[k] || ''}" 不是 0-100000 的整数`);
          }
        } else if (row.tag === 'PrizeObject') {
          prizeObjects++;
          if (!a.name) attr.push(line, `${file.name} 第 ${line} 行 PrizeObject 缺少 name`);
          else if (iset && !iset.has(a.name) && !VIRTUAL_PRIZES.has(a.name) && !missingItems.has(a.name)) {
            missingItems.set(a.name, line);
          }
          if (!intIn(a.num, 0, 100000000)) num.push(line, `第 ${line} 行奖励数量 num="${a.num || ''}" 不是非负整数`);
        } else if (row.tag === 'PrizeProb' || row.tag === 'MonsterProb') {
          if (row.tag === 'PrizeProb') prizeProbs++;
          if (!intIn(a.prob, 0, 1000)) prob.push(line, `第 ${line} 行 ${row.tag} 概率 prob="${a.prob || ''}" 不是 0-1000 的整数`);
        } else if (row.tag === 'PlayerInfo') {
          if (!intIn(a.level, 0, 10000)) attr.push(line, `第 ${line} 行等级 level="${a.level || ''}" 不是非负整数`);
        } else if (row.tag === 'TimeInfo') {
          if (!intIn(a.time, 0, 1000000000)) attr.push(line, `第 ${line} 行时间 time="${a.time || ''}" 不是非负整数`);
        } else if (row.tag === 'SpecialPrize') {
          for (const k of ['loopStep1', 'loopStep2']) {
            if (!intIn(a[k], 0, 1000000000)) attr.push(line, `第 ${line} 行 ${k}="${a[k] || ''}" 不是非负整数`);
          }
        }
      }
      prob.flush();
      num.flush();
      attr.flush();
      let count = 0;
      for (const [name, line] of missingMonsters) {
        count++;
        if (count <= 20) add('xml_monster_missing', 'warn', `${file.name} 第 ${line} 行怪物「${name}」不在 Monster.DB`, activity.id, { file: file.name, line });
      }
      if (count > 20) add('xml_monster_missing', 'warn', `${file.name} 另有 ${count - 20} 个未收录怪物未列出`, activity.id, { file: file.name });
      count = 0;
      for (const [name, line] of missingItems) {
        count++;
        if (count <= 20) add('xml_item_missing', 'warn', `${file.name} 第 ${line} 行奖励「${name}」不在 stditems.db`, activity.id, { file: file.name, line });
      }
      if (count > 20) add('xml_item_missing', 'warn', `${file.name} 另有 ${count - 20} 个未收录奖励未列出`, activity.id, { file: file.name });
      return {
        monsterObjects,
        uniqueMonsters: monsterNames.size,
        prizeObjects,
        prizeProbs
      };
    }

    function checkCopies(activity) {
      const names = activity.files.filter((f) => !f.dir).map((f) => f.name);
      const info = names.map((name) => ({ name, exists: fileByName.get(name).exists, md5: fileMd5(name) }));
      const present = info.filter((x) => x.exists && x.md5);
      let identical = false;
      if (!present.length) return { group: activity.id, label: activity.name, identical: false, md5: null, files: info };
      identical = present.length === names.length && present.every((x) => x.md5 === present[0].md5);
      if (present.length === names.length && !identical) {
        const diff = present.map((x) => `${x.name}(${x.md5.slice(0, 8)})`).join('、');
        add('xml_copy_mismatch', 'warn', `${activity.name} 三份副本内容不一致：${diff}`, activity.id, { file: names[0] });
      }
      return {
        group: activity.id,
        label: activity.name,
        identical,
        md5: present[0].md5 || null,
        files: info
      };
    }

    function setXmlMetrics(activity, file, stats) {
      if (!stats) return;
      activity.metrics = [
        { label: '刷怪节点', value: stats.monsterObjects },
        { label: '奖励节点', value: stats.prizeObjects },
        { label: '概率组', value: stats.prizeProbs },
        { label: '唯一怪物', value: stats.uniqueMonsters }
      ];
    }

    const xmlCopies = [];

    for (const activity of activities) {
      if (activity.id === 'goaldelivery' || activity.id === 'rescueprincess') {
        const first = activity.files.find((f) => !f.dir && f.name.endsWith('0.xml'));
        for (const file of activity.files) {
          if (file.dir || !file.exists) continue;
          const stats = checkXml(activity, file);
          if (first && file.name === first.name) setXmlMetrics(activity, file, stats);
        }
        xmlCopies.push(checkCopies(activity));
      }

      if (activity.id === 'sabuk') {
        const prizeFile = activity.files.find((f) => f.key === 'sabukprizes');
        if (prizeFile && prizeFile.exists) {
          const parsed = parseExtraFile(prizeFile);
          if (parsed) {
            checkTableInvalid(activity, prizeFile, parsed);
            activity.metrics = [{ label: '奖励行', value: (parsed.rows || []).length }];
            let badType = 0;
            for (const row of parsed.rows || []) {
              const type = row.values[1];
              if (!VIRTUAL_PRIZES.has(type)) {
                badType++;
                if (badType <= 20) add('sabuk_prize_type_unknown', 'info', `第 ${row.index + 1} 行奖励类型「${type}」不在 金币/经验/声望/元宝 中`, activity.id, { file: prizeFile.name, line: row.index + 1 });
              }
            }
            if (badType > 20) add('sabuk_prize_type_unknown', 'info', `${prizeFile.name} 另有 ${badType - 20} 行未知奖励类型未列出`, activity.id, { file: prizeFile.name });
          }
        }
        for (const file of activity.files) {
          if (file.dir || file.key === 'sabukprizes' || !file.exists) continue;
          const parsed = parseExtraFile(file);
          checkTableInvalid(activity, file, parsed);
        }
        const kv = activity.files.find((f) => f.key === 'sabuk');
        if (kv && kv.exists) {
          const parsed = parseExtraFile(kv);
          if (parsed) activity.metrics.push({ label: '城堡参数', value: (parsed.rows || []).length });
        }
      }

      if (activity.id === 'inferno') {
        const specs = [
          { key: 'infernonormal', name: 'infernonormal.txt', cols: 7, label: '普通刷怪', field: 'inferno_field_empty' },
          { key: 'infernoattack', name: 'infernoattack.txt', cols: 9, label: '怪物攻击', field: 'inferno_field_empty' }
        ];
        for (const spec of specs) {
          const file = activity.files.find((f) => f.key === spec.key);
          if (!file || !file.exists) continue;
          let lines;
          try {
            lines = configs.readFileLines(path.join(envirDir, file.name)).lines;
          } catch (e) {
            add('activity_file_unreadable', 'error', `${file.name} 读取失败：${e.message}`, activity.id, { file: file.name });
            continue;
          }
          let rows = 0;
          let emptyLines = 0;
          let firstEmpty = 0;
          const valueIssues = makeCollector(add, 'inferno_value_invalid', 'warn', activity.id, file.name);
          for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const s = raw.trim();
            if (!s || s.startsWith(';') || s.startsWith('#')) continue;
            rows++;
            if (/\t\s*\t/.test(raw) || /\t\s*$/.test(raw)) {
              emptyLines++;
              if (!firstEmpty) firstEmpty = i + 1;
              continue;
            }
            const parts = raw.split('\t').map((x) => x.trim());
            if (parts.length !== spec.cols) {
              valueIssues.push(i + 1, `第 ${i + 1} 行应为 ${spec.cols} 列，实际 ${parts.length} 列`);
              continue;
            }
            const numeric = spec.cols === 7 ? [1, 2, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7, 8];
            for (const col of numeric) {
              if (!isIntStr(parts[col])) {
                valueIssues.push(i + 1, `第 ${i + 1} 行第 ${col + 1} 列「${parts[col]}」不是整数`);
                break;
              }
            }
          }
          if (emptyLines) {
            add('inferno_field_empty', 'warn',
              `${file.name} 有 ${emptyLines} 行存在空字段（首个在第 ${firstEmpty} 行），可能导致参数错位`,
              activity.id, { file: file.name, line: firstEmpty });
          }
          valueIssues.flush();
          activity.metrics.push({ label: spec.label + '行', value: rows });
        }
      }

      if (activity.id === 'gemrand') {
        const file = activity.files.find((f) => f.key === 'gemrand');
        if (file && file.exists) {
          let lines;
          try {
            lines = configs.readFileLines(path.join(envirDir, file.name)).lines;
          } catch (e) {
            add('activity_file_unreadable', 'error', `${file.name} 读取失败：${e.message}`, activity.id, { file: file.name });
            lines = [];
          }
          let prevRate = null;
          let prevLevel = null;
          let rows = 0;
          const levels = new Set();
          for (let i = 0; i < lines.length; i++) {
            const s = lines[i].trim();
            if (!s || s.startsWith(';') || s.startsWith('#')) continue;
            const parts = s.split(/\s+/);
            const level = parts[0];
            const rate = parts[1];
            rows++;
            if (!isIntStr(level)) {
              add('gemrand_level_invalid', 'warn', `第 ${i + 1} 行等级「${level}」不是整数`, activity.id, { file: file.name, line: i + 1 });
              prevRate = null;
              continue;
            }
            const lv = Number(level);
            if (prevLevel !== null && lv <= prevLevel) {
              add('gemrand_level_invalid', 'warn', `第 ${i + 1} 行等级 ${lv} 未按升序排列或重复`, activity.id, { file: file.name, line: i + 1 });
            }
            if (levels.has(lv)) {
              add('gemrand_level_invalid', 'warn', `第 ${i + 1} 行等级 ${lv} 重复`, activity.id, { file: file.name, line: i + 1 });
            }
            levels.add(lv);
            prevLevel = lv;
            const val = Number(rate);
            if (rate === undefined || rate === '' || !Number.isFinite(val) || val < 0 || val > 100) {
              add('gemrand_rate_range', 'warn', `第 ${i + 1} 行数值「${rate == null ? '' : rate}」不在 0-100 范围内`, activity.id, { file: file.name, line: i + 1 });
              prevRate = null;
              continue;
            }
            if (prevRate !== null && val < prevRate) {
              add('gemrand_not_monotonic', 'warn', `第 ${i + 1} 行数值 ${val} 小于上一档 ${prevRate}`, activity.id, { file: file.name, line: i + 1 });
            }
            prevRate = val;
          }
          activity.metrics = [{ label: '等级档位', value: rows }];
        }
      }

      if (activity.id === 'recharge') {
        const iset = items();
        let rewardRows = 0;
        for (const file of activity.files) {
          if (file.dir || !file.exists) continue;
          const parsed = parseExtraFile(file);
          if (!parsed) continue;
          checkTableInvalid(activity, file, parsed);
          for (const row of parsed.rows || []) {
            rewardRows++;
            const [item, count, chance] = row.values;
            const line = row.index + 1;
            if (!item) {
              add('recharge_item_missing', 'warn', `${file.name} 第 ${line} 行缺少奖励物品`, activity.id, { file: file.name, line });
            } else if (iset && !iset.has(item) && !VIRTUAL_PRIZES.has(item)) {
              add('recharge_item_missing', 'warn', `${file.name} 第 ${line} 行奖励「${item}」不在 stditems.db`, activity.id, { file: file.name, line });
            }
            if (!isIntStr(count) || Number(count) < 0) {
              add('recharge_chance_invalid', 'warn', `${file.name} 第 ${line} 行数量「${count}」不是非负整数`, activity.id, { file: file.name, line });
            }
            if (!isIntStr(chance) || Math.abs(Number(chance)) > 1000) {
              add('recharge_chance_invalid', 'warn', `${file.name} 第 ${line} 行几率「${chance}」不是整数或超出 ±1000`, activity.id, { file: file.name, line });
            }
          }
        }
        const ybDir = activity.files.find((f) => f.dir);
        if (ybDir && ybDir.exists) {
          let names = [];
          try {
            names = fs.readdirSync(path.join(envirDir, ybDir.name)).filter((n) => /\.txt$/i.test(n));
          } catch (e) {
            names = [];
          }
          const zero = [];
          const byNumber = new Map();
          let fileCount = 0;
          for (const name of names) {
            fileCount++;
            try {
              const st = fs.statSync(path.join(envirDir, ybDir.name, name));
              if (st.size === 0) zero.push(name);
            } catch (e) {
            }
            const m = /^yb0*(\d+)\.txt$/i.exec(name);
            if (m) {
              const key = 'yb' + Number(m[1]);
              if (!byNumber.has(key)) byNumber.set(key, []);
              byNumber.get(key).push(name);
            }
          }
          ybDir.fileCount = fileCount;
          activity.metrics.push({ label: '礼包奖励', value: rewardRows });
          activity.metrics.push({ label: '元宝队列', value: fileCount });
          const duplicates = [];
          if (zero.length) {
            add('yb_zero_byte', 'info', `元宝充值目录有 ${zero.length} 个 0 字节队列文件${fileCount === zero.length ? '（全部为空，说明尚未产生充值订单）' : ''}`, activity.id, { file: ybDir.name });
          }
          for (const [key, list] of byNumber) {
            if (list.length > 1) duplicates.push({ key, files: list });
          }
          if (duplicates.length) {
            const sample = duplicates.slice(0, 9).map((d) => d.files.join(' / ')).join('；');
            add('yb_name_duplicate', 'warn',
              `${duplicates.length} 组队列文件名重复（${sample}${duplicates.length > 9 ? ' …' : ''}），脚本按固定文件名读取时可能取错`,
              activity.id, { file: ybDir.name });
          }
          globalsInfo.yb.files = fileCount;
          globalsInfo.yb.zeroByte = zero.length;
          globalsInfo.yb.duplicateNames = duplicates;
        }
        const scriptFile = path.join(scriptDir, YB_SCRIPT);
        try {
          const text = configs.readFileLines(scriptFile).text;
          const hits = [];
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (/[A-Za-z]:[\\/]/.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() });
          }
          if (hits.length) {
            globalsInfo.yb.absolutePaths = hits.length;
            add('yb_script_absolute_path', 'info', `${YB_SCRIPT} 有 ${hits.length} 处写死盘符路径（首个在第 ${hits[0].line} 行），换机器部署会失效`, activity.id, { file: YB_SCRIPT, line: hits[0].line });
          }
        } catch (e) {
          add('rank_script_missing', 'warn', `元宝充值脚本 ${YB_SCRIPT} 不存在或不可读`, activity.id, { file: YB_SCRIPT });
        }
        try {
          globalsInfo.yb.scriptExists = fs.statSync(scriptFile).isFile();
        } catch (e) {
          globalsInfo.yb.scriptExists = false;
        }
      }

      if (activity.id === 'quiz') {
        const file = activity.files.find((f) => !f.dir);
        if (file && file.exists) {
          try {
            const parsed = opsData.parseQuiz(path.join(envirDir, file.name));
            activity.metrics = [{ label: '题目', value: parsed.rows.length }];
            if (parsed.special.length) {
              add('ops_quiz_invalid', 'warn',
                `${file.name} 有 ${parsed.special.length} 行不是「题目/选项/选项」格式（首个在第 ${parsed.special[0].line + 1} 行）`,
                activity.id, { file: file.name, line: parsed.special[0].line + 1 });
            }
          } catch (e) {
            add('activity_file_unreadable', 'error', `${file.name} 读取失败：${e.message}`, activity.id, { file: file.name });
          }
        }
      }

      if (activity.id === 'boxes') {
        const boxFile = activity.files.find((f) => f.tab === 'boxes');
        const starterFile = activity.files.find((f) => f.tab === 'starter');
        if (boxFile && boxFile.exists) {
          try {
            const parsed = opsData.parseSectionList(path.join(envirDir, boxFile.name), '宝盒物品');
            activity.metrics.push({ label: '宝盒分组', value: parsed.groups.length });
            activity.metrics.push({ label: '宝盒物品', value: parsed.rows.length });
          } catch (e) {
            add('activity_file_unreadable', 'error', `${boxFile.name} 读取失败：${e.message}`, activity.id, { file: boxFile.name });
          }
        }
        if (starterFile && starterFile.exists) {
          try {
            const parsed = opsData.parseSectionList(path.join(envirDir, starterFile.name), '新手礼包');
            activity.metrics.push({ label: '礼包分组', value: parsed.groups.length });
            activity.metrics.push({ label: '礼包物品', value: parsed.rows.length });
          } catch (e) {
            add('activity_file_unreadable', 'error', `${starterFile.name} 读取失败：${e.message}`, activity.id, { file: starterFile.name });
          }
        }
      }

      if (activity.id === 'notices') {
        let readable = 0;
        for (const file of activity.files) {
          if (file.dir || !file.exists) continue;
          try {
            configs.readFileLines(path.join(envirDir, file.name));
            readable++;
          } catch (e) {
            add('notice_file_unreadable', 'error', `${file.name} 读取失败：${e.message}`, activity.id, { file: file.name });
          }
        }
        activity.metrics = [{ label: '公告文件', value: readable }];
      }

      if (activity.id === 'monsterdialog') {
        const file = activity.files.find((f) => !f.dir);
        if (file && file.exists) {
          const parsed = parseExtraFile(file);
          if (parsed) {
            const sections = parsed.sections || [];
            activity.metrics = [{ label: '对话段', value: sections.length }];
            for (const sec of sections) {
              const text = String(sec.text || '').trim();
              const line = sec.index + 2;
              if (!text) {
                add('dialog_section_empty', 'info', `${file.name} 中「${sec.name}」没有正文`, activity.id, { file: file.name, line });
              } else if (PLACEHOLDER_RE.test(text.split(/\r?\n/)[0].trim())) {
                add('dialog_placeholder', 'info', `${file.name} 中「${sec.name}」仍是占位文本：${text.split(/\r?\n/)[0].trim()}`, activity.id, { file: file.name, line });
              }
            }
          }
        }
      }

      if (activity.id === 'speaking') {
        const file = activity.files.find((f) => !f.dir);
        if (file && file.exists) {
          const parsed = parseExtraFile(file);
          if (parsed) {
            checkTableInvalid(activity, file, parsed);
            activity.metrics = [{ label: '配置项', value: (parsed.rows || []).length }];
          }
        }
      }

      if (activity.id === 'gaimprize') {
        const file = activity.files.find((f) => !f.dir);
        if (file && file.exists) {
          const parsed = parseExtraFile(file);
          if (parsed) {
            checkTableInvalid(activity, file, parsed);
            const rows = parsed.rows || [];
            const nums = rows.filter((r) => r.key === 'prizenum').map((r) => r.value);
            const names = rows.filter((r) => r.key === 'prizename');
            activity.metrics = [{ label: '奖励物品', value: names.length }];
            const expected = nums.length ? Number(nums[0]) : NaN;
            if (!Number.isInteger(expected) || expected !== names.length) {
              add('gaimprize_count_mismatch', 'warn',
                `${file.name} prizenum 为 ${nums.length ? nums[0] : '缺失'}，但 prizename 有 ${names.length} 条`,
                activity.id, { file: file.name });
            }
          }
        }
      }

      if (activity.id === 'globals') {
        const file = activity.files.find((f) => !f.dir);
        if (file && file.exists) {
          let lines;
          try {
            lines = configs.readFileLines(path.join(envirDir, file.name)).lines;
          } catch (e) {
            add('activity_file_unreadable', 'error', `${file.name} 读取失败：${e.message}`, activity.id, { file: file.name });
            lines = [];
          }
          let checked = 0;
          let invalid = 0;
          let total = 0;
          for (let i = 0; i < lines.length; i++) {
            const body = stripComment(lines[i]).trim();
            if (!body) continue;
            const m = /^(\S+)(?:\s+(.*))?$/.exec(body);
            if (!m) continue;
            total++;
            if (!SWITCH_KEYS.has(m[1])) continue;
            checked++;
            const value = (m[2] || '').trim();
            if (value !== '0' && value !== '1') {
              invalid++;
              add('globeparams_switch_invalid', 'warn',
                `第 ${i + 1} 行开关 ${m[1]} 的值「${value}」不是 0 或 1`,
                activity.id, { file: file.name, line: i + 1 });
            }
          }
          activity.metrics = [{ label: '开关项', value: checked }, { label: '参数行', value: total }];
          globalsInfo.switches = { checked, invalid, total };
        }
      }
    }

    const activitiesById = new Map(activities.map((a) => [a.id, a]));
    globalsInfo.xmlCopies = xmlCopies;
    for (const issue of issues) {
      const act = activitiesById.get(issue.activityId);
      if (act) act.issues[issue.severity]++;
    }
    for (const act of activities) {
      act.status = act.issues.error ? 'error' : act.issues.warn ? 'warn' : act.issues.info ? 'info' : 'ok';
    }

    const rankings = buildRankings(add);
    issues.sort((a, b) =>
      (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
      String(a.activityId).localeCompare(String(b.activityId)) ||
      (a.line - b.line)
    );

    const issueSummary = { error: 0, warn: 0, info: 0 };
    for (const issue of issues) issueSummary[issue.severity]++;
    const issueCodes = [...new Set(issues.map((i) => i.code))].sort();
    const fileCount = activities.reduce((n, a) => n + a.fileCount, 0) + activities.reduce((n, a) => n + a.dirCount, 0);
    const missingFiles = activities.reduce((n, a) => n + a.files.filter((f) => !f.exists).length, 0);
    const missingRankingScripts = rankings.reduce((n, r) => n + r.scripts.filter((s) => !s.exists).length, 0);

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        activities: activities.length,
        files: fileCount,
        missingFiles,
        rankings: rankings.length,
        missingRankingScripts,
        issues: issueSummary,
        issueCodes
      },
      activities,
      rankings,
      issues,
      globals: globalsInfo
    };
  }

  function buildRankings(add) {
    let npcRows = null;
    try {
      npcRows = npcData.parseNpc(npcFile).rows;
    } catch (e) {
      add('npc_list_unreadable', 'error', `NPCList.txt 读取失败：${e.message}`, '', { file: 'NPCList.txt' });
    }
    const referencedScripts = new Set();
    const npcNames = new Set();
    if (npcRows) {
      for (const row of npcRows) {
        referencedScripts.add(row.script);
        npcNames.add(row.name);
      }
    }
    return RANKINGS.map((rank) => {
      const scripts = rank.scripts.map((name) => {
        const stem = name.replace(/\.py$/i, '');
        let exists = false;
        try {
          exists = fs.statSync(path.join(scriptDir, name)).isFile();
        } catch (e) {
          exists = false;
        }
        if (!exists) {
          add('rank_script_missing', 'warn', `榜单脚本 ${name} 不存在`, 'rank:' + rank.id, { file: name });
        } else if (npcRows && !referencedScripts.has(stem)) {
          add('rank_npc_missing', 'info', `榜单脚本 ${name} 未被 NPCList.txt 引用，修改后不会生效`, 'rank:' + rank.id, { file: name });
        }
        return { name, exists, referenced: Boolean(npcRows && referencedScripts.has(stem)) };
      });
      const npcFound = Boolean(npcRows && npcNames.has(rank.npc));
      if (npcRows && !npcFound) {
        add('rank_npc_missing', 'warn', `榜单 NPC「${rank.npc}」未出现在 NPCList.txt`, 'rank:' + rank.id, { file: 'NPCList.txt' });
      }
      return {
        id: rank.id,
        name: rank.name,
        npc: rank.npc,
        npcFound,
        scripts,
        dataSource: rank.dataSource,
        notes: rank.notes
      };
    });
  }

  return {
    list() {
      const sig = signature();
      if (cache && cache.sig === sig) return cache.data;
      const data = build();
      cache = { sig, data };
      return data;
    },
    summary() {
      return { activities: ACTIVITIES.length, rankings: RANKINGS.length };
    },
    invalidate() {
      cache = null;
    }
  };
}

module.exports = { create, ACTIVITIES, RANKINGS };

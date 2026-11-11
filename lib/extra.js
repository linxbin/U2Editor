'use strict';

const fs = require('fs');
const path = require('path');
const gbk = require('./gbk');
const { backupFile } = require('./dbe');

function readText(file) {
  const buf = fs.readFileSync(file);
  const text = gbk.decodeText(buf);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let trailing = false;
  if (lines.length && lines[lines.length - 1] === '') {
    trailing = true;
    lines.pop();
  }
  return { text, eol, lines, trailing };
}

function writeLines(file, lines, eol, trailing) {
  const backup = backupFile(file);
  fs.writeFileSync(file, gbk.encode(lines.join(eol) + (trailing ? eol : '')));
  return backup;
}

function sameLines(a, b) {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function cleanText(value, label, maxLen = 4000) {
  const s = String(value == null ? '' : value);
  if (/[\r\n]/.test(s)) throw new Error(label + '不能包含换行');
  if (s.length > maxLen) throw new Error(label + '太长');
  return s.trim();
}

function cleanRaw(value, label, maxLen = 200000) {
  const s = String(value == null ? '' : value);
  if (s.length > maxLen) throw new Error(label + '太长');
  return s;
}

function cleanSectionName(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) throw new Error('分组名称不能为空');
  if (/[\]\r\n]/.test(s)) throw new Error('分组名称不能包含 ] 或换行');
  return s;
}

function tokens(line, min, max) {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts.length < min || parts.length > max) return null;
  return parts;
}

function joinParts(values) {
  const out = values.map((v) => String(v == null ? '' : v).trim());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\t');
}

const C = (key, label, type = 'text') => ({ key, label, type });

function standardParse(line, min, max) {
  return tokens(line, min, max);
}

const XML_ATTR_HINTS = {
  version: 'XML 版本', encoding: '文件编码',
  prefix: '怪物/物件标识前缀', posx: 'X 坐标', posy: 'Y 坐标', range: '范围',
  level: '等级要求', prob: '概率（%或权重）', name: '名称', num: '数量',
  loop: '循环次数', loopStep1: '循环参数 1', loopStep2: '循环参数 2',
  time: '时间/时长', flag: '标记', status: '状态', timespace: '时间间隔',
  randrange: '随机范围', content: '内容文本'
};

const GAMESERVER_KEY_HINTS = {
  BurstRate: '爆率倍数', ServerOfMaxNumber: '最大在线人数', ExpTimes: '经验倍率（基数，越大升级越快）',
  GameDBName: '游戏数据库名', GSIP: '游戏服务器 IP', GSVersion: '游戏版本号', GDIP: '网关 IP',
  BornLevel: '出生等级', ShadowBornLevel: '影子角色出生等级', ServerCount: '分区/服务器数量',
  TaskStandTime: '任务停留时间（秒）', UpdateWeaponMoney: '升级武器所需金币', BornMoney: '出生赠送金币',
  SabukInWhichGS: '沙巴克所在服务器编号', BornMapCode: '出生地图编号', ServerAccount: '服务器账号',
  HorseName: '默认坐骑名称', User: '数据库用户名', PassWord: '数据库密码', MysqlPort: 'MySQL 端口',
  MsmqPath: '消息队列路径', MsmqLabel: '消息队列标签', FastClock: '快时钟（毫秒）', SlowClock: '慢时钟（毫秒）',
  ItemOutTime: '地面物品消失时间（秒）', ItemPickTime: '物品拾取保护时间（秒）',
  BulePrintTime: '新手提示显示时间（秒）', RunSpeed: '跑步速度参数', WalkSpeed: '走路速度参数',
  StallPet5MinExp: '摆摊宠物 5 分钟经验', StallPetWalkTime: '摆摊宠物走动间隔（秒）',
  ServerIndex: '区服编号', ServerPort: '游戏服务器端口', ServerName: '服务器名称', ServerID: '服务器标识',
  Section: '区段标识', SectionName: '区段显示名称', DBIP: '数据库 IP', DBPort: '数据库端口',
  LogSrvIP: '日志服务器 IP', LogSrvPort: '日志服务器端口', MsgSrvIP: '消息服务器 IP', MsgSrvPort: '消息服务器端口',
  GameLogIp: '游戏日志 IP', GameLogPort: '游戏日志端口',
  SendMsmqIP: '发送消息队列 IP', RecvMsmqIP: '接收消息队列 IP', SendQueue: '发送队列名称', RecvQueue: '接收队列名称',
  PTSendMsmqIP: '平台发送队列 IP', PTRecvMsmqIP: '平台接收队列 IP', PTSendQueue: '平台发送队列名', PTRecvQueue: '平台接收队列名',
  PtMsmqIP: '平台消息队列 IP',
  EnvirDir: '配置目录（Envir 路径）', MapDir: '地图文件目录', GuildDir: '行会数据目录',
  ValidSrvIP: '账号验证服务器 IP', ValidSrvPort: '账号验证服务器端口',
  NewAttackPolicy: '启用新攻击策略（TRUE/FALSE）', SuccInRun: '跑步成功率（%）',
  SuccInRunByHorse: '骑马跑步成功率（%）', OldSuccInRun: '旧跑步成功率（%）',
  TimeStampURL: '时间戳服务地址', ConfigURL: '实时配置地址', TaskConfigURL: '任务配置地址',
  ScriptFileURL: '脚本文件下载地址', FetchInterVal: '拉取间隔（毫秒）'
};
const GAMESERVER_SECTION_HINTS = {
  Server: '服务器基本设置', Share: '共享目录设置', ValidServer: '账号验证服务器',
  Attack: '攻击与移动设置', RealTimeConfig: '实时配置拉取'
};

const RELATION_KEY_HINTS = {
  shengwangLevel: '声望等级要求', BaiShiLevel: '拜师等级要求', ShouTuLevel: '收徒等级要求',
  GraduateLevel: '出师等级要求', StudentPoint: '徒弟奖励参数（逗号分隔）', TeacherPoint: '师傅奖励参数（逗号分隔）',
  MoneyForMarry: '结婚所需金币', ItemsForMarry: '结婚所需物品', ItemForMarry: '结婚所需物品（单件）'
};
const RELATION_SECTION_HINTS = { Teacher: '师徒系统', Marry: '婚姻系统' };

const SABUK_KEY_HINTS = {
  CastleMap: '城堡所在地图编号', RoyalMap: '皇宫地图编号', HomeTownX: '沙巴克城镇 X 坐标', HomeTownY: '沙巴克城镇 Y 坐标',
  CastleName: '城堡名称', OwnGuild: '当前占有行会', MainDoorOpen: '城门开关（0 关闭 / 1 打开）',
  ArcherMode: '弓箭手模式', WarDate: '攻城日期', TotalGold: '城堡总资金', IncomeToday: '今日税收',
  MainDoorName: '城门名称', MainDoorX: '城门 X 坐标', MainDoorY: '城门 Y 坐标',
  MainDoorHP: '城门当前血量', MainDoorMoney: '城门维修费用',
  LeftWallName: '左墙名称', LeftWallX: '左墙 X 坐标', LeftWallY: '左墙 Y 坐标',
  LeftWallHP: '左墙当前血量', LeftWallMoney: '左墙维修费用',
  CenterWallName: '中墙名称', CenterWallX: '中墙 X 坐标', CenterWallY: '中墙 Y 坐标',
  CenterWallHP: '中墙当前血量', CenterWallMoney: '中墙维修费用',
  RightWallName: '右墙名称', RightWallX: '右墙 X 坐标', RightWallY: '右墙 Y 坐标',
  RightWallHP: '右墙当前血量', RightWallMoney: '右墙维修费用'
};
for (let i = 1; i <= 12; i++) {
  SABUK_KEY_HINTS['Archer_' + i + '_X'] = `第 ${i} 号弓箭手 X 坐标`;
  SABUK_KEY_HINTS['Archer_' + i + '_Y'] = `第 ${i} 号弓箭手 Y 坐标`;
  SABUK_KEY_HINTS['Archer_' + i + '_HP'] = `第 ${i} 号弓箭手血量`;
  SABUK_KEY_HINTS['Archer_' + i + '_MONEY'] = `第 ${i} 号弓箭手配置费用`;
}
const SABUK_SECTION_HINTS = { setup: '基本设置', defense: '防御设施' };

const SPECKING_KEY_HINTS = {
  mapcode: '地图编号', mapname: '地图名称',
  alivespeakingnpc: 'BOSS 存活时 NPC 喊话', deadspeakingnpc: 'BOSS 死亡后 NPC 喊话（%s 为复活倒计时）',
  alivespeakingmon: 'BOSS 存活时小怪喊话', deadspeakingmon: 'BOSS 死亡后小怪喊话（%s 为复活倒计时）',
  speakingmon: '小怪配置（怪物名,地图,概率）', speakingnpc: '喊话 NPC 坐标（地图,X,Y）'
};

const GAIMPRIZE_KEY_HINTS = {
  prizenum: '奖励物品数量', prizename: '奖励物品名称',
  fullhint: '包裹满时的提示文字', succhint: '领取成功提示文字'
};

const MINMAPLIST_SECTION_HINTS = {
  'WORLD MAP': '世界地图', 'AREA MAP': '区域地图', 'JUMP POINT': '跳转点', 'NPC': 'NPC 分布'
};

const FILES = [
  {
    key: 'gameserver', group: '服务与网络', label: '服务器启动配置', file: 'GameServer.ini', base: '..', mode: 'kv', kvDelimiter: '=', sectioned: true,
    desc: 'GameServer 启动参数：经验倍率、出生等级/金币/地图、人数上限、端口、数据库与网关地址。',
    keyHints: GAMESERVER_KEY_HINTS, sectionHints: GAMESERVER_SECTION_HINTS
  },
  {
    key: 'freewoolext', group: '服务与网络', label: '插件经验倍率', file: 'FreeWooolExt.ini', base: '..', mode: 'kv', kvDelimiter: '=', sectioned: true,
    desc: 'FreeWolExt 插件配置：ExpMultiple 为经验倍率（1=原版，4=4 倍），重启 GameServer 生效。',
    keyHints: { ExpMultiple: '经验倍率（1=原版，4=4 倍）' },
    sectionHints: { Server: '插件设置' }
  },
  { key: 'server', group: '服务与网络', label: '服务器注册', file: 'server.txt', mode: 'raw', desc: 'GameServer 启动用的服务器名称、区服、数据库账号配置。' },
  { key: 'gsip', group: '服务与网络', label: 'GS 白名单', file: 'GSIP.txt', mode: 'raw', desc: '允许连接游戏服务器的 IP 列表，每行一个。' },
  { key: 'gdip', group: '服务与网络', label: 'GD 白名单', file: 'GDIP.txt', mode: 'raw', desc: '允许连接网关的 IP 列表，每行一个。' },
  { key: 'servertable', group: '服务与网络', label: '区服列表', file: 'Servertable.ini', mode: 'raw', desc: '区服编号与网关地址，例如 0 127.0.0.1/7200。' },
  {
    key: 'gmnames', group: '服务与网络', label: 'GM 名单', file: 'GMNames.txt', mode: 'table',
    columns: [C('name', '角色名'), C('level', '权限', 'number')],
    parse: (line) => standardParse(line, 1, 2),
    format: (v) => joinParts(v),
    defaults: ['', '1']
  },
  { key: 'gmcmd', group: '服务与网络', label: 'GM 命令白名单', file: 'GMCmd.txt', mode: 'raw', desc: '允许使用的 GM 命令列表，每行一个。' },
  { key: 'guildlist', group: '服务与网络', label: '行会列表', file: 'Guildlist.txt', mode: 'raw', desc: '当前行会数据；空文件表示没有行会记录。' },
  { key: 'spylist', group: '服务与网络', label: '监听名单', file: 'spylist.txt', mode: 'raw', desc: '服务器监听名单，每行一个角色。' },
  { key: 'wardate', group: '服务与网络', label: '攻城记录', file: 'WarDate.txt', mode: 'raw', desc: '攻城行会、攻城时间和记录标记。' },

  {
    key: 'minimap', group: '地图与传送', label: '小地图映射', file: 'MiniMap.txt', mode: 'table',
    columns: [C('map', '地图编号'), C('minimap', '小地图编号')],
    parse: (line) => standardParse(line, 2, 2),
    format: (v) => joinParts(v),
    defaults: ['', '']
  },
  {
    key: 'minmaplist', group: '地图与传送', label: '世界地图列表', file: 'minmaplist.txt', mode: 'table',
    sectioned: true, sectionHints: MINMAPLIST_SECTION_HINTS,
    columns: [C('id', '地图 ID'), C('icon', '图标编号'), C('name', '地图名称')],
    sectionSchemas: {
      'WORLD MAP': {
        columns: [C('id', '地图 ID'), C('icon', '图标编号'), C('name', '地图名称')],
        parse: (line) => {
          const m = line.match(/^\s*([^\s,]+)\s*\t\s*([^,]+),\s*(.*?)\s*$/) ||
            line.match(/^\s*([^,]+),\s*([^,]+),\s*(.*?)\s*$/);
          return m ? [m[1].trim(), m[2].trim(), m[3].trim()] : null;
        },
        format: (v) => `${v[0]},  ${v[1]},   ${v[2]}`,
        defaults: ['', '00000', '']
      },
      'AREA MAP': {
        columns: [C('id', '地图 ID'), C('icon', '图标编号'), C('name', '地图名称')],
        parse: (line) => {
          const m = line.match(/^\s*([^\s,]+)\s*\t\s*([^,]+),\s*(.*?)\s*$/) ||
            line.match(/^\s*([^,]+),\s*([^,]+),\s*(.*?)\s*$/);
          return m ? [m[1].trim(), m[2].trim(), m[3].trim()] : null;
        },
        format: (v) => `${v[0]},  ${v[1]},   ${v[2]}`,
        defaults: ['', '00000', '']
      },
      'JUMP POINT': {
        columns: [C('src', '源地图'), C('x', '源 X', 'number'), C('y', '源 Y', 'number'), C('dest', '目标地图'), C('dx', '目标 X', 'number'), C('dy', '目标 Y', 'number')],
        parse: (line) => {
          const m = line.match(/^\s*(\S+)\s+(\d+)\s*,\s*(\d+)\s*->\s*(\S+)\s+(\d+)\s*,\s*(\d+)\s*$/);
          return m ? m.slice(1) : null;
        },
        format: (v) => `${v[0]}\t${v[1]},${v[2]} ->${v[3]}\t${v[4]},${v[5]}`,
        defaults: ['', '0', '0', '', '0', '0']
      },
      'NPC': {
        columns: [C('map', '地图'), C('x', 'X', 'number'), C('y', 'Y', 'number'), C('name', 'NPC 名称'), C('desc', '说明')],
        parse: (line) => {
          const m = line.match(/^\s*(\S+)\s+(\d+)\s*,\s*(\d+)\s+(\S+)\s*(.*?)\s*$/);
          return m ? m.slice(1) : null;
        },
        format: (v) => `${v[0]}\t${v[1]},${v[2]} ${v[3]} ${v[4]}`.trimEnd(),
        defaults: ['', '0', '0', '', '']
      }
    }
  },
  {
    key: 'herofight', group: '地图与传送', label: '英雄战场坐标', file: 'Herofightmappointlist.TXT', mode: 'table',
    columns: [C('x', 'X', 'number'), C('y', 'Y', 'number')],
    parse: (line) => standardParse(line, 2, 2),
    format: (v) => joinParts(v),
    defaults: ['0', '0']
  },
  {
    key: 'checknum', group: '地图与传送', label: '地图人数限制', file: 'CheckNumInfo.txt', mode: 'table',
    showComment: true,
    columns: [C('map', '地图编号'), C('x', '数值 1', 'number'), C('y', '数值 2', 'number'), C('v1', '数值 3', 'number'), C('v2', '数值 4', 'number')],
    parse: (line) => standardParse(line, 5, 5),
    format: (v) => joinParts(v),
    defaults: ['0', '0', '0', '0', '0']
  },
  {
    key: 'guardlist', group: '地图与传送', label: '卫士分布', file: 'GuardList.txt', mode: 'table',
    showComment: true,
    columns: [C('name', '卫士'), C('map', '地图'), C('x', 'X', 'number'), C('y', 'Y', 'number'), C('dir', '方向', 'number')],
    parse: (line) => {
      const m = line.match(/^\s*(\S+)\s+(\S+)\s+(\d+)\s*,\s*(\d+)\s*:\s*(\d+)\s*$/);
      return m ? [m[1], m[2], m[3], m[4], m[5]] : null;
    },
    format: (v) => `${v[0]}\t${v[1]}\t${v[2]}, ${v[3]}\t: ${v[4]}`,
    defaults: ['卫士', '0', '0', '0', '0']
  },

  {
    key: 'gemrand', group: '活动与玩法', label: '宝石随机状态', file: 'GemRandState.TXT', mode: 'table',
    columns: [C('level', '等级', 'number'), C('rate', '数值')],
    parse: (line) => standardParse(line, 2, 2),
    format: (v) => joinParts(v),
    defaults: ['0', '0']
  },
  {
    key: 'sabukprizes', group: '活动与玩法', label: '沙巴克奖励', file: 'SabukPrizes.txt', mode: 'table',
    columns: [C('count', '人数/次数', 'number'), C('type', '奖励类型'), C('value', '奖励数值', 'number')],
    parse: (line) => standardParse(line, 3, 3),
    format: (v) => joinParts(v),
    defaults: ['1', '金币', '0']
  },
  {
    key: 'infernonormal', group: '活动与玩法', label: '炼狱普通刷怪', file: 'infernonormal.txt', mode: 'table',
    columns: [C('map', '地图'), C('x', 'X', 'number'), C('y', 'Y', 'number'), C('name', '怪物'), C('range', '范围', 'number'), C('count', '数量', 'number'), C('time', '时间', 'number')],
    parse: (line) => standardParse(line, 7, 7),
    format: (v) => joinParts(v),
    defaults: ['', '0', '0', '', '0', '0', '0']
  },
  {
    key: 'infernoattack', group: '活动与玩法', label: '炼狱怪物攻击', file: 'infernoattack.txt', mode: 'table',
    columns: [C('name', '怪物'), C('p1', '参数 1', 'number'), C('p2', '参数 2', 'number'), C('p3', '参数 3', 'number'), C('p4', '参数 4', 'number'), C('p5', '参数 5', 'number'), C('p6', '参数 6', 'number'), C('p7', '参数 7', 'number'), C('p8', '参数 8', 'number')],
    parse: (line) => standardParse(line, 9, 9),
    format: (v) => joinParts(v),
    defaults: ['', '0', '0', '0', '0', '0', '0', '0', '0']
  },
  {
    key: 'diamond', group: '充值礼包', label: '钻石账号奖励', file: 'DiamondAccount.txt', mode: 'table',
    sectioned: true,
    columns: [C('item', '道具名称'), C('count', '数量', 'number'), C('chance', '几率', 'number'), C('class', '职业', 'number'), C('gender', '性别', 'number')],
    parse: (line) => standardParse(line, 3, 5),
    format: (v) => joinParts(v),
    defaults: ['', '1', '100', '-1', '-1']
  },
  {
    key: 'golden1', group: '充值礼包', label: '黄金账号奖励 1', file: 'goldenaccount1.txt', mode: 'table',
    sectioned: true,
    columns: [C('item', '道具名称'), C('count', '数量', 'number'), C('chance', '几率', 'number'), C('class', '职业', 'number'), C('gender', '性别', 'number')],
    parse: (line) => standardParse(line, 3, 5),
    format: (v) => joinParts(v),
    defaults: ['', '1', '100', '-1', '-1']
  },
  {
    key: 'golden2', group: '充值礼包', label: '黄金账号奖励 2', file: 'goldenaccount2.txt', mode: 'table',
    sectioned: true,
    columns: [C('item', '道具名称'), C('count', '数量', 'number'), C('chance', '几率', 'number'), C('class', '职业', 'number'), C('gender', '性别', 'number')],
    parse: (line) => standardParse(line, 3, 5),
    format: (v) => joinParts(v),
    defaults: ['', '1', '100', '-1', '-1']
  },

  { key: 'globeparams', group: '系统参数', label: '全局参数', file: 'globeparams.txt', mode: 'kv', kvDelimiter: ' ', desc: '服务器全局开关、倍率和活动参数；直接改数值即可。' },
  {
    key: 'relation', group: '系统参数', label: '师徒婚姻规则', file: 'relation.ini', mode: 'kv', kvDelimiter: '=', sectioned: true,
    desc: '[Teacher] / [Marry] 下的规则参数。', keyHints: RELATION_KEY_HINTS, sectionHints: RELATION_SECTION_HINTS
  },
  {
    key: 'sabuk', group: '系统参数', label: '沙巴克设置', file: 'Sabuk.txt', mode: 'kv', kvDelimiter: '=', sectioned: true,
    desc: '沙巴克城堡、城门、弓箭手和攻城日期设置。', keyHints: SABUK_KEY_HINTS, sectionHints: SABUK_SECTION_HINTS
  },
  {
    key: 'speckingmonster', group: '系统参数', label: 'BOSS 喊话', file: 'speckingmonster.txt', mode: 'kv', kvDelimiter: '=', sectioned: true,
    desc: '特殊 BOSS 的地图、存活/死亡喊话和召唤信息。', keyHints: SPECKING_KEY_HINTS
  },
  {
    key: 'gaimprize', group: '系统参数', label: '改名奖励', file: 'gaimprize.txt', mode: 'kv', kvDelimiter: '=', sectioned: false,
    desc: '改名成功后的七龙珠奖励配置。', keyHints: GAIMPRIZE_KEY_HINTS
  },
  { key: 'playermode', group: '系统参数', label: '玩家模式限制', file: 'PlayerMode.config', mode: 'raw', desc: '玩家行为限制配置；保留原有分段格式。' },
  { key: 'blueprint', group: '系统参数', label: '新手提示文本', file: 'BluePrint.txt', mode: 'raw', desc: '新手玩家提示与服务器玩法说明。' },
  { key: 'itemdesc', group: '系统文本', label: '道具说明', file: 'itemdesc.txt', mode: 'sections', desc: '[道具名] 下方的多行说明文本。' },
  { key: 'monsterdialog', group: '系统文本', label: '活动对话文本', file: 'MonsterDialog.txt', mode: 'sections', desc: '[类型] 下方的活动对白。' },
  { key: 'emotionchat', group: '系统文本', label: '表情动作文本', file: 'EmotionChat.txt', mode: 'sections', desc: '全局称谓变量 + 每个动作的 1-4 号聊天文本。' },

  { key: 'goaldelivery0', group: '活动副本 XML', label: '送宝活动 0', file: 'goaldelivery0.xml', mode: 'xml', desc: 'XML 节点属性编辑；适合调整爆率、数量、坐标和时间。' },
  { key: 'goaldelivery1', group: '活动副本 XML', label: '送宝活动 1', file: 'goaldelivery1.xml', mode: 'xml', desc: 'XML 节点属性编辑；适合调整爆率、数量、坐标和时间。' },
  { key: 'goaldelivery2', group: '活动副本 XML', label: '送宝活动 2', file: 'goaldelivery2.xml', mode: 'xml', desc: 'XML 节点属性编辑；适合调整爆率、数量、坐标和时间。' },
  { key: 'rescueprincess0', group: '活动副本 XML', label: '救公主 0', file: 'rescueprincess0.xml', mode: 'xml', desc: 'XML 节点属性编辑；适合调整怪物、奖励、概率和喊话。' },
  { key: 'rescueprincess1', group: '活动副本 XML', label: '救公主 1', file: 'rescueprincess1.xml', mode: 'xml', desc: 'XML 节点属性编辑；适合调整怪物、奖励、概率和喊话。' },
  { key: 'rescueprincess2', group: '活动副本 XML', label: '救公主 2', file: 'rescueprincess2.xml', mode: 'xml', desc: 'XML 节点属性编辑；适合调整怪物、奖励、概率和喊话。' }
];

const BY_KEY = new Map(FILES.map((f) => [f.key, f]));

function listFiles() {
  return FILES.map((f) => ({
    key: f.key,
    group: f.group,
    label: f.label,
    file: f.file,
    mode: f.mode,
    desc: f.desc || '',
    sectioned: Boolean(f.sectioned),
    showComment: Boolean(f.showComment),
    columns: f.columns || null,
    sectionSchemas: f.sectionSchemas
      ? Object.fromEntries(Object.entries(f.sectionSchemas).map(([name, s]) => [name, { columns: s.columns, defaults: s.defaults || [] }]))
      : null
  }));
}

function specOf(key) {
  const spec = BY_KEY.get(key);
  if (!spec) throw new Error('未知配置文件：' + key);
  return spec;
}

function fileOf(dir, spec) {
  return path.join(dir, spec.base || '', spec.file);
}

function schemaOf(spec, sectionName) {
  if (!spec.sectionSchemas) return spec;
  return spec.sectionSchemas[sectionName] || null;
}

function parseTable(spec, text, eol) {
  const lines = text.split(/\r?\n/);
  let trailing = false;
  if (lines.length && lines[lines.length - 1] === '') {
    trailing = true;
    lines.pop();
  }
  const sections = [];
  const rows = [];
  const invalid = [];
  let section = -1;
  let comment = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      comment = '';
      continue;
    }
    if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
      comment = trimmed.replace(/^[;#]+\s*/, '');
      continue;
    }
    if (spec.sectioned) {
      const sm = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (sm) {
        sections.push({ index: i, name: sm[1].trim() });
        section = sections.length - 1;
        comment = '';
        continue;
      }
    }
    const sectionName = section >= 0 && sections[section] ? sections[section].name : '';
    const schema = schemaOf(spec, sectionName);
    const values = schema ? schema.parse(line) : null;
    if (!values) {
      invalid.push({ line: i, text: line });
      comment = '';
      continue;
    }
    rows.push({ index: i, section, schema: sectionName, values, comment: spec.showComment ? comment : '' });
    comment = '';
  }
  return { text, eol, lines, trailing, sections, rows, invalid };
}

function parseKvLine(line, spec) {
  const semi = line.indexOf(';');
  const body = (semi >= 0 ? line.slice(0, semi) : line).trimEnd();
  const comment = semi >= 0 ? line.slice(semi + 1).trim() : '';
  if (!body.trim()) return null;
  if (spec.kvDelimiter === '=') {
    const eq = body.indexOf('=');
    if (eq < 0) return null;
    const key = body.slice(0, eq).trim();
    const value = body.slice(eq + 1).trim();
    if (!key) return null;
    return { key, value, comment };
  }
  const m = body.match(/^(\S+)(?:\s+(.*?))?\s*$/);
  if (!m) return null;
  return { key: m[1], value: (m[2] || '').trim(), comment };
}

function parseKv(spec, text, eol) {
  const lines = text.split(/\r?\n/);
  let trailing = false;
  if (lines.length && lines[lines.length - 1] === '') {
    trailing = true;
    lines.pop();
  }
  const sections = [];
  const rows = [];
  const invalid = [];
  let section = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    if (spec.sectioned) {
      const sm = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (sm) {
        sections.push({ index: i, name: sm[1].trim() });
        section = sections.length - 1;
        continue;
      }
    }
    const parsed = parseKvLine(line, spec);
    if (!parsed) {
      invalid.push({ line: i, text: line });
      continue;
    }
    rows.push({ index: i, section, ...parsed });
  }
  return { text, eol, lines, trailing, sections, rows, invalid };
}

function parseSectionsData(text, eol) {
  const lines = text.split(/\r?\n/);
  let trailing = false;
  if (lines.length && lines[lines.length - 1] === '') {
    trailing = true;
    lines.pop();
  }
  const heads = [];
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) {
      if (current) {
        current.text = current.lines.join('\n');
        sections.push(current);
      }
      current = { index: i, name: m[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(lines[i]);
    else heads.push(lines[i]);
  }
  if (current) {
    current.text = current.lines.join('\n');
    sections.push(current);
  }
  const head = heads.join('\n');
  return {
    text, eol, lines, trailing, head,
    sections: sections.map((s) => ({
      index: s.index, name: s.name, text: s.text, body: s.lines,
      lineCount: s.lines.length,
      preview: s.lines.find((x) => x.trim()) || ''
    }))
  };
}

function findLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineOfOffset(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi;
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseXmlData(text, eol) {
  const lines = text.split(/\r?\n/);
  let trailing = false;
  if (lines.length && lines[lines.length - 1] === '') {
    trailing = true;
    lines.pop();
  }
  const starts = findLineStarts(text);
  const rows = [];
  const stack = [];
  const tagRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(text))) {
    const raw = m[0];
    if (raw.startsWith('<!--') || raw.startsWith('<?') || raw.startsWith('<!')) continue;
    const name = m[1];
    if (!name) continue;
    const closing = raw.startsWith('</');
    if (closing) {
      if (stack.length && stack[stack.length - 1] === name) stack.pop();
      continue;
    }
    const attrs = {};
    const list = [];
    const attrRe = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attrRe.exec(raw))) {
      const value = decodeXml(a[3] !== undefined ? a[3] : a[4]);
      attrs[a[1]] = value;
      list.push({ name: a[1], value });
    }
    if (list.length) {
      const line = lineOfOffset(starts, m.index);
      const lineStart = starts[line];
      rows.push({
        index: rows.length,
        line,
        tag: name,
        path: [...stack, name].join(' / '),
        attrs,
        values: list,
        tagStart: m.index - lineStart,
        tagEnd: m.index - lineStart + raw.length
      });
    }
    if (!m[3]) stack.push(name);
  }
  return { text, eol, lines, trailing, rows };
}

function parseExtra(dir, key) {
  const spec = specOf(key);
  const file = fileOf(dir, spec);
  const info = readText(file);
  const base = {
    key, group: spec.group, label: spec.label, file: spec.file, mode: spec.mode,
    desc: spec.desc || '', columns: spec.columns || null,
    defaults: spec.defaults || null,
    sectioned: Boolean(spec.sectioned), showComment: Boolean(spec.showComment),
    keyHints: spec.keyHints || null,
    attrHints: spec.attrHints || (spec.mode === 'xml' ? XML_ATTR_HINTS : null),
    sectionHints: spec.sectionHints || null
  };
  if (spec.mode === 'raw') {
    return { ...base, text: info.text, lineCount: info.lines.length };
  }
  if (spec.mode === 'table') {
    const data = parseTable(spec, info.text, info.eol);
    const sectionSchemas = spec.sectionSchemas
      ? Object.fromEntries(Object.entries(spec.sectionSchemas).map(([name, s]) => [name, { columns: s.columns, defaults: s.defaults || [] }]))
      : null;
    return { ...base, sections: data.sections, rows: data.rows, invalid: data.invalid, sectionSchemas };
  }
  if (spec.mode === 'kv') {
    const data = parseKv(spec, info.text, info.eol);
    return {
      ...base, delimiter: spec.kvDelimiter,
      sections: data.sections, rows: data.rows, invalid: data.invalid
    };
  }
  if (spec.mode === 'sections') {
    const data = parseSectionsData(info.text, info.eol);
    return {
      ...base, head: data.head,
      sections: data.sections.map((s) => ({
        index: s.index, name: s.name, text: s.text,
        lineCount: s.lineCount, preview: s.preview
      }))
    };
  }
  if (spec.mode === 'xml') {
    const data = parseXmlData(info.text, info.eol);
    return { ...base, rows: data.rows };
  }
  throw new Error('未知配置模式');
}

function normalizeRowValues(schema, values) {
  if (!Array.isArray(values)) throw new Error('行数据格式错误');
  const cols = schema.columns.length;
  const out = values.slice(0, cols);
  while (out.length < cols) out.push('');
  return out;
}

function rowLine(spec, values, sectionName) {
  const schema = schemaOf(spec, sectionName) || spec;
  if (!schema.parse || !schema.format) throw new Error('该分组不支持新增行');
  const clean = normalizeRowValues(schema, values);
  if (spec.key === 'diamond' || spec.key === 'golden1' || spec.key === 'golden2') {
    return joinParts(clean);
  }
  return schema.format(clean);
}

function patchSectionHeader(line, name) {
  const m = line.match(/^(\s*)\[[^\]]+\](\s*)$/);
  return (m ? m[1] : '') + '[' + name + ']' + (m ? m[2] : '');
}

function buildTableLines(spec, info, parsed, payload) {
  const lines = info.lines.slice();
  const deleted = new Set((payload.deleted || []).map(Number));
  for (const idx of deleted) {
    if (!parsed.rows.some((r) => r.index === idx)) throw new Error('删除行不存在：' + idx);
  }
  const overrides = new Map();
  for (const ch of payload.changes || []) {
    const idx = Number(ch.index);
    const row = parsed.rows.find((r) => r.index === idx);
    if (!row) throw new Error('修改行不存在：' + idx);
    overrides.set(idx, rowLine(spec, ch.values, row.schema));
  }
  for (const ch of payload.sectionChanges || []) {
    const sec = parsed.sections[Number(ch.index)];
    if (!sec) throw new Error('分组不存在：' + ch.index);
    overrides.set(sec.index, patchSectionHeader(lines[sec.index], cleanSectionName(ch.name)));
  }
  const addAfter = new Map();
  const append = (anchor, line) => {
    if (!addAfter.has(anchor)) addAfter.set(anchor, []);
    addAfter.get(anchor).push(line);
  };
  const anchorFor = (section) => {
    if (spec.sectioned) {
      const sidx = Number(section);
      if (!parsed.sections[sidx]) throw new Error('新增行缺少有效分组');
      const kept = parsed.rows.filter((r) => r.section === sidx && !deleted.has(r.index));
      if (kept.length) return kept[kept.length - 1].index;
      return parsed.sections[sidx].index;
    }
    const kept = parsed.rows.filter((r) => !deleted.has(r.index));
    return kept.length ? kept[kept.length - 1].index : lines.length - 1;
  };
  for (const add of payload.added || []) {
    const sectionName = spec.sectioned && parsed.sections[Number(add.section)]
      ? parsed.sections[Number(add.section)].name : '';
    const line = rowLine(spec, add.values, add.schema || sectionName);
    if (!line.trim()) throw new Error('新增行为空');
    append(anchorFor(add.section), line);
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!deleted.has(i)) out.push(overrides.has(i) ? overrides.get(i) : lines[i]);
    if (addAfter.has(i)) out.push(...addAfter.get(i));
  }
  for (const add of payload.sectionAdds || []) {
    const name = cleanSectionName(add.name);
    if (parsed.sections.some((s) => s.name === name)) throw new Error('分组已存在：' + name);
    const schema = schemaOf(spec, name) || spec;
    const line = add.values && add.values.some((v) => String(v).trim() !== '')
      ? rowLine(spec, add.values, name) : '';
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('[' + name + ']');
    if (line.trim()) out.push(line);
  }
  return out;
}

function saveTable(dir, spec, payload) {
  const file = fileOf(dir, spec);
  const info = readText(file);
  const parsed = parseTable(spec, info.text, info.eol);
  const out = buildTableLines(spec, info, parsed, payload);
  const changedRows = (payload.changes || []).length;
  const addedRows = (payload.added || []).length + (payload.sectionAdds || []).length;
  const deletedRows = (payload.deleted || []).length;
  if (sameLines(out, info.lines)) {
    return { backup: null, changedRows: 0, addedRows: 0, deletedRows: 0, count: parsed.rows.length };
  }
  const backup = writeLines(file, out, info.eol, info.trailing);
  return {
    backup, changedRows, addedRows, deletedRows,
    count: parsed.rows.length - deletedRows + addedRows
  };
}

function kvLine(spec, row) {
  const key = cleanText(row.key, '参数名', 120);
  if (!key) throw new Error('参数名不能为空');
  if (spec.kvDelimiter === ' ' && /\s/.test(key)) throw new Error('参数名不能包含空格');
  if (spec.kvDelimiter === '=' && key.includes('=')) throw new Error('参数名不能包含 =');
  const value = cleanText(row.value, '参数值', 4000);
  let line = spec.kvDelimiter === '=' ? `${key}=${value}` : `${key}\t${value}`;
  const comment = cleanText(row.comment || '', '备注', 1000);
  if (comment) line += `  ; ${comment}`;
  return line;
}

function buildKvLines(spec, info, parsed, payload) {
  const lines = info.lines.slice();
  const deleted = new Set((payload.deleted || []).map(Number));
  for (const idx of deleted) {
    if (!parsed.rows.some((r) => r.index === idx)) throw new Error('删除参数不存在：' + idx);
  }
  const overrides = new Map();
  for (const ch of payload.changes || []) {
    const idx = Number(ch.index);
    if (!parsed.rows.some((r) => r.index === idx)) throw new Error('修改参数不存在：' + idx);
    overrides.set(idx, kvLine(spec, ch.values || {}));
  }
  for (const ch of payload.sectionChanges || []) {
    const sec = parsed.sections[Number(ch.index)];
    if (!sec) throw new Error('分组不存在：' + ch.index);
    overrides.set(sec.index, patchSectionHeader(lines[sec.index], cleanSectionName(ch.name)));
  }
  const addAfter = new Map();
  const append = (anchor, line) => {
    if (!addAfter.has(anchor)) addAfter.set(anchor, []);
    addAfter.get(anchor).push(line);
  };
  const anchorFor = (section) => {
    if (spec.sectioned) {
      const sidx = Number(section);
      if (!parsed.sections[sidx]) throw new Error('新增参数缺少有效分组');
      const kept = parsed.rows.filter((r) => r.section === sidx && !deleted.has(r.index));
      if (kept.length) return kept[kept.length - 1].index;
      return parsed.sections[sidx].index;
    }
    const kept = parsed.rows.filter((r) => !deleted.has(r.index));
    return kept.length ? kept[kept.length - 1].index : lines.length - 1;
  };
  for (const add of payload.added || []) {
    append(anchorFor(add.section), kvLine(spec, add.values || {}));
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!deleted.has(i)) out.push(overrides.has(i) ? overrides.get(i) : lines[i]);
    if (addAfter.has(i)) out.push(...addAfter.get(i));
  }
  for (const add of payload.sectionAdds || []) {
    const name = cleanSectionName(add.name);
    if (parsed.sections.some((s) => s.name === name)) throw new Error('分组已存在：' + name);
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('[' + name + ']');
    for (const row of add.rows || []) out.push(kvLine(spec, row));
  }
  return out;
}

function saveKv(dir, spec, payload) {
  const file = fileOf(dir, spec);
  const info = readText(file);
  const parsed = parseKv(spec, info.text, info.eol);
  const out = buildKvLines(spec, info, parsed, payload);
  const changedRows = (payload.changes || []).length;
  const addedRows = (payload.added || []).length;
  const deletedRows = (payload.deleted || []).length;
  if (sameLines(out, info.lines)) {
    return { backup: null, changedRows: 0, addedRows: 0, deletedRows: 0, count: parsed.rows.length };
  }
  const backup = writeLines(file, out, info.eol, info.trailing);
  return { backup, changedRows, addedRows, deletedRows, count: parsed.rows.length - deletedRows + addedRows };
}

function splitTextLines(text) {
  if (text === '') return [];
  const lines = String(text).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function saveSections(dir, spec, payload) {
  const file = fileOf(dir, spec);
  const info = readText(file);
  const parsed = parseSectionsData(info.text, info.eol);
  const deleted = new Set((payload.deleted || []).map(Number));
  for (const idx of deleted) {
    if (!parsed.sections.some((s) => s.index === idx)) throw new Error('删除章节不存在：' + idx);
  }
  const changes = new Map();
  for (const ch of payload.changes || []) {
    const idx = Number(ch.index);
    if (!parsed.sections.some((s) => s.index === idx)) throw new Error('修改章节不存在：' + idx);
    changes.set(idx, { text: String(ch.text == null ? '' : ch.text), name: ch.name });
  }
  const headLines = payload.head !== undefined && payload.head !== parsed.head
    ? splitTextLines(payload.head)
    : info.lines.slice(0, parsed.sections.length ? parsed.sections[0].index : info.lines.length);
  const out = headLines.slice();
  for (const sec of parsed.sections) {
    if (deleted.has(sec.index)) continue;
    const ch = changes.get(sec.index);
    const name = ch && ch.name !== undefined ? cleanSectionName(ch.name) : sec.name;
    out.push('[' + name + ']');
    const body = ch ? splitTextLines(ch.text) : sec.body;
    out.push(...body);
  }
  for (const add of payload.added || []) {
    const name = cleanSectionName(add.name);
    if (parsed.sections.some((s) => s.name === name)) throw new Error('章节已存在：' + name);
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('[' + name + ']');
    out.push(...splitTextLines(add.text || ''));
  }
  const changedRows = (payload.changes || []).length;
  const addedRows = (payload.added || []).length;
  const deletedRows = (payload.deleted || []).length;
  if (sameLines(out, info.lines)) {
    return { backup: null, changedRows: 0, addedRows: 0, deletedRows: 0, count: parsed.sections.length };
  }
  const backup = writeLines(file, out, info.eol, info.trailing);
  return { backup, changedRows, addedRows, deletedRows, count: parsed.sections.length - deletedRows + addedRows };
}

function saveRaw(dir, spec, payload) {
  const file = fileOf(dir, spec);
  const info = readText(file);
  const text = cleanRaw(payload.text, '文件内容');
  if (text === info.text) {
    return { backup: null, changedRows: 0, addedRows: 0, deletedRows: 0, count: 0 };
  }
  const backup = backupFile(file);
  fs.writeFileSync(file, gbk.encode(text));
  return { backup, changedRows: 1, addedRows: 0, deletedRows: 0, count: 0 };
}

function saveXml(dir, spec, payload) {
  const file = fileOf(dir, spec);
  const info = readText(file);
  const parsed = parseXmlData(info.text, info.eol);
  const changes = payload.changes || [];
  const lines = info.lines.slice();
  for (const ch of changes) {
    const idx = Number(ch.index);
    const row = parsed.rows.find((r) => r.index === idx);
    if (!row) throw new Error('XML 节点不存在：' + idx);
    const line = lines[row.line] || '';
    let tag = line.slice(row.tagStart, row.tagEnd);
    for (const [name, value] of Object.entries(ch.values || {})) {
      if (!(name in row.attrs)) continue;
      const escaped = encodeXml(cleanText(value, '属性 ' + name, 4000));
      const re = new RegExp("(\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\s*=\\s*)([\"'])([^\"']*)(\\2)");
      tag = tag.replace(re, (all, pre, q) => pre + q + escaped + q);
    }
    lines[row.line] = line.slice(0, row.tagStart) + tag + line.slice(row.tagEnd);
  }
  if (sameLines(lines, info.lines)) {
    return { backup: null, changedRows: 0, addedRows: 0, deletedRows: 0, count: parsed.rows.length };
  }
  const backup = writeLines(file, lines, info.eol, info.trailing);
  return { backup, changedRows: changes.length, addedRows: 0, deletedRows: 0, count: parsed.rows.length };
}

function saveExtra(dir, key, payload) {
  const spec = specOf(key);
  if (spec.mode === 'raw') return saveRaw(dir, spec, payload);
  if (spec.mode === 'table') return saveTable(dir, spec, payload);
  if (spec.mode === 'kv') return saveKv(dir, spec, payload);
  if (spec.mode === 'sections') return saveSections(dir, spec, payload);
  if (spec.mode === 'xml') return saveXml(dir, spec, payload);
  throw new Error('未知配置模式');
}

module.exports = { listFiles, parseExtra, saveExtra };

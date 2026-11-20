'use strict';

/*
 * GM 命令静态目录。
 * 名称来源：NewGs.exe 主命令字符串表（文件偏移 0x73a160-0x73bc3c，只读提取），
 * 去掉编译产物/调试字符串后按功能归类。运行时不读取 exe。
 * usage/src 说明：src=engine 的参数格式取自 exe 内命令校验提示；
 * src=ref 的用法按命令语义整理，实际参数以服务端校验为准。
 */

const COMMANDS = [
  {
    name: 'move',
    desc: '在当前地图内移动',
    category: '传送与坐标',
    usage: '@move <X> <Y>',
    src: 'engine',
    note: '仅限当前地图；每 10 秒只能瞬移一次'
  },
  { name: 'go', desc: '随机移动', category: '传送与坐标', usage: '@go <地图编号>', src: 'engine' },
  { name: 'goto', desc: '定点移动', category: '传送与坐标', usage: '@goto <地图编号> <X> <Y>', src: 'engine' },
  { name: 'gohere2', desc: '召唤玩家2', category: '传送与坐标', usage: '@gohere2 <角色名>', src: 'engine' },
  { name: 'recallhorse', desc: '驯马', category: '传送与坐标', usage: '@recallhorse', src: 'ref' },
  { name: 'offhorse', desc: '下马', category: '传送与坐标', usage: '@offhorse', src: 'ref' },
  { name: 'uphorse', desc: '上马', category: '传送与坐标', usage: '@uphorse', src: 'ref' },
  { name: 'horserest', desc: '让坐骑休息', category: '传送与坐标', usage: '@horserest', src: 'ref' },
  { name: 'rest', desc: '原地休息', category: '传送与坐标', usage: '@rest', src: 'ref' },
  {
    name: 'dingdianmon',
    desc: '造怪物攻城',
    category: '传送与坐标',
    usage: '@dingdianmon <怪物名> <数量> <X1> <Y1> 或 @dingdianmon <怪物名> <数量> <X0> <Y0> <X1> <Y1>',
    src: 'engine',
    note: '两种格式：指定单点坐标，或指定出生区域两角坐标；数量有上限'
  },
  {
    name: 'cfjh',
    desc: '超级飞行（传送）',
    category: '传送与坐标',
    usage: '@cfjh <地图编号> <X> <Y>',
    src: 'ref',
    note: '超级飞行，传送到指定地图坐标'
  },
  {
    name: 'clearitem',
    desc: '清除物品',
    category: '物品与装备',
    usage: '@clearitem [范围]',
    src: 'ref',
    note: '不带范围时清理当前地图地面物品'
  },
  { name: 'clearitemfrompkg', desc: '从背包中删除物品', category: '物品与装备', usage: '@clearitemfrompkg <角色名> <物品名称> [数量]', src: 'engine' },
  { name: 'delitem', desc: '删除物品', category: '物品与装备', usage: '@delitem <物品名> [数量]', src: 'ref' },
  { name: 'chaxunitem', desc: '查询装备', category: '物品与装备', usage: '@chaxunitem <物品名>', src: 'ref' },
  { name: 'equipdura', desc: '更改装备持久力', category: '物品与装备', usage: '@equipdura <持久值>', src: 'ref' },
  { name: 'clothescolor', desc: '染色', category: '物品与装备', usage: '@clothescolor <颜色值>', src: 'ref' },
  {
    name: 'color',
    desc: '改变颜色',
    category: '物品与装备',
    usage: '@color <颜色值>',
    src: 'ref',
    note: '设置角色名字颜色'
  },
  { name: 'hair', desc: '更换头发', category: '物品与装备', usage: '@hair <发型编号>', src: 'ref' },
  {
    name: 'gender',
    desc: '更换性别',
    category: '物品与装备',
    usage: '@gender',
    src: 'engine',
    note: '每执行一次在男/女之间切换'
  },
  { name: 'adjustgender', desc: '调整性别', category: '物品与装备', usage: '@adjustgender <性别(0/1)>', src: 'ref' },
  { name: 'zhizao', desc: '造物品', category: '物品与装备', usage: '@zhizao <物品名> [数量]', src: 'ref' },
  {
    name: 'zhizao2',
    desc: '造物品设定持久',
    category: '物品与装备',
    usage: '@zhizao2 <物品名> [数量]',
    src: 'ref',
    note: '制造物品的扩展分支'
  },
  {
    name: 'zhizao3',
    desc: '造物品设定附加属性',
    category: '物品与装备',
    usage: '@zhizao3 <名称> <数量> <附加属性24位>',
    src: 'engine',
    note: '附加属性只能由 0-9、A-F、a-f 组成，共 24 位'
  },
  {
    name: 'zhizao4',
    desc: '造物品设定黑暗属性',
    category: '物品与装备',
    usage: '@zhizao4 <名称> <数量> <黑暗属性28位>',
    src: 'engine',
    note: '黑暗属性只能由 0-9、A-F、a-f 组成，共 28 位'
  },
  {
    name: 'zhizao5',
    desc: '造物品设定附魔属性',
    category: '物品与装备',
    usage: '@zhizao5 <名称> <数量> <附魔属性30位> <心魔名字> <次数>',
    src: 'engine',
    note: '附魔属性只能由 0-9、A-F、a-f 组成，共 30 位'
  },
  {
    name: 'zhizao6',
    desc: '造物品设定骑战属性',
    category: '物品与装备',
    usage: '@zhizao6 <名称> <五行1> <五行2> <附加属性24位> <骑战属性24位>',
    src: 'engine',
    note: '附加/骑战属性只能由 0-9、A-F、a-f 组成，各 24 位'
  },
  {
    name: 'zhizao7',
    desc: '造封元印',
    category: '物品与装备',
    usage: '@zhizao7 <物品名> [数量] [属性串]',
    src: 'ref',
    note: '参数未完全标注，以服务端校验为准'
  },
  {
    name: 'setgemnum',
    desc: '设置宝石数量',
    category: '物品与装备',
    usage: '@setgemnum <角色名> <宝石类型> <数量>',
    src: 'engine',
    note: '宝石类型：0 红 / 1 蓝 / 2 绿 / 3 三种宝石；数量最大 255'
  },
  {
    name: 'querygemnum',
    desc: '查询宝石数量',
    category: '物品与装备',
    usage: '@querygemnum <角色名>',
    src: 'engine',
    note: '输出该角色红、蓝、绿宝石数量'
  },
  {
    name: 'cleanuppkg',
    desc: '清包裹',
    category: '物品与装备',
    usage: '@cleanuppkg',
    src: 'ref',
    note: '整理当前角色背包'
  },
  { name: 'setstall', desc: '设定摊位类型', category: '物品与装备', usage: '@setstall <摊位类型>', src: 'engine' },
  { name: 'setstallflagcolor', desc: '设定旗子颜色', category: '物品与装备', usage: '@setstallflagcolor <颜色值>', src: 'ref' },
  {
    name: 'addyuanbao',
    desc: '增加元宝',
    category: '物品与装备',
    usage: '@addyuanbao [账号] <数量>',
    src: 'engine',
    note: '不填账号时给自己增加元宝'
  },
  { name: 'queryyuanbao', desc: '查询元宝系统状态', category: '物品与装备', usage: '@queryyuanbao [账号]', src: 'ref' },
  { name: 'openyuanbao', desc: '打开元宝系统', category: '物品与装备', usage: '@openyuanbao', src: 'ref' },
  { name: 'closeyuanbao', desc: '关闭元宝系统', category: '物品与装备', usage: '@closeyuanbao', src: 'ref' },
  {
    name: 'jueseyuanbao',
    desc: '根据角色名查询元宝数',
    category: '物品与装备',
    usage: '@jueseyuanbao <角色名> <数量>',
    src: 'ref',
    note: '参数未标注，以服务端校验为准'
  },
  {
    name: 'zhanghaoyuanbao',
    desc: '根据帐号查询元宝数',
    category: '物品与装备',
    usage: '@zhanghaoyuanbao <账号> <数量>',
    src: 'ref',
    note: '参数未标注，以服务端校验为准'
  },
  {
    name: 'jiaqian',
    desc: '增加金币',
    category: '物品与装备',
    usage: '@jiaqian <数量>',
    src: 'ref',
    note: '增加金币'
  },
  {
    name: 'invest',
    desc: '投资',
    category: '物品与装备',
    usage: '@invest <数量>',
    src: 'ref',
    note: '参数未标注，以服务端校验为准'
  },
  {
    name: 'reloadptxml',
    desc: '重载商城道具 XML',
    category: '物品与装备',
    usage: '@reloadptxml',
    src: 'ref',
    note: '重载商城道具 XML'
  },
  {
    name: 'changelock',
    desc: '锁定',
    category: '物品与装备',
    usage: '@changelock <状态(0/1)>',
    src: 'ref',
    note: '锁定或解锁装备'
  },
  { name: 'stall', desc: '摆摊控制', category: '物品与装备', usage: '@stall <摊位类型>', src: 'ref' },
  { name: 'cleargiftandbless', desc: '清除送礼和祝福信息', category: '物品与装备', usage: '@cleargiftandbless [角色名]', src: 'ref' },
  { name: 'setenergy', desc: '设置元神能量', category: '角色属性', usage: '@setenergy <数值>', src: 'ref' },
  { name: 'setxiulian', desc: '设置修炼值', category: '角色属性', usage: '@setxiulian <数值>', src: 'ref' },
  { name: 'setphase', desc: '设置元神境界', category: '角色属性', usage: '@setphase <阶段>', src: 'ref' },
  { name: 'addvigor', desc: '增加活力', category: '角色属性', usage: '@addvigor <数值>', src: 'ref' },
  { name: 'queryvigor', desc: '查询活力', category: '角色属性', usage: '@queryvigor', src: 'ref' },
  { name: 'addshengwang', desc: '增加声望值', category: '角色属性', usage: '@addshengwang <数值>', src: 'ref' },
  { name: 'chaxunshengwang', desc: '查询声望值', category: '角色属性', usage: '@chaxunshengwang', src: 'ref' },
  { name: 'setracemoney', desc: '设置马票金额', category: '角色属性', usage: '@setracemoney <数额>', src: 'ref' },
  { name: 'getracemoney', desc: '取得马票金额', category: '角色属性', usage: '@getracemoney', src: 'ref' },
  { name: 'setplayerflag', desc: '设置指定玩家的标记', category: '角色属性', usage: '@setplayerflag <角色名> <标记编号> <值>', src: 'engine' },
  { name: 'queryplayerflag', desc: '查看指定玩家的标记', category: '角色属性', usage: '@queryplayerflag <角色名> <标记编号>', src: 'engine' },
  { name: 'setflag', desc: '设置玩家的标记', category: '角色属性', usage: '@setflag <标记编号> <值>', src: 'engine' },
  { name: 'displayflag', desc: '查看玩家的标记', category: '角色属性', usage: '@displayflag <标记编号>', src: 'engine' },
  {
    name: 'adjustjob',
    desc: '调整职业',
    category: '角色属性',
    usage: '@adjustjob <职业>',
    src: 'ref',
    note: '职业常用取值：0 战士 / 1 法师 / 2 道士'
  },
  { name: 'adjustmagiclevel', desc: '调整技能', category: '角色属性', usage: '@adjustmagiclevel <技能名> <等级>', src: 'ref' },
  {
    name: 'fullmphp',
    desc: '满红蓝血',
    category: '角色属性',
    usage: '@fullmphp',
    src: 'ref',
    note: '回满 HP/MP'
  },
  {
    name: 'fullyq',
    desc: '元气Full',
    category: '角色属性',
    usage: '@fullyq',
    src: 'ref',
    note: '回满元气'
  },
  {
    name: 'wudi',
    desc: '无敌模式',
    category: '角色属性',
    usage: '@wudi',
    src: 'engine',
    note: '在普通模式与无敌模式之间切换'
  },
  {
    name: 'setparam',
    desc: '设置NPC全局变量',
    category: '角色属性',
    usage: '@setparam <变量名> <值>',
    src: 'engine',
    note: '设置 NPC 全局变量；变量名不存在会提示设置失败'
  },
  {
    name: 'queryparam',
    desc: '查询NPC全局变量',
    category: '角色属性',
    usage: '@queryparam <变量名>',
    src: 'engine',
    note: '查询 NPC 全局变量'
  },
  { name: 'setparaminmem', desc: '设置内存参数', category: '角色属性', usage: '@setparaminmem <参数名称> <参数值>', src: 'engine' },
  { name: 'setextrainfo', desc: '设置扩展信息', category: '角色属性', usage: '@setextrainfo <键> <值>', src: 'ref' },
  { name: 'getextrainfo', desc: '查询扩展信息', category: '角色属性', usage: '@getextrainfo <键>', src: 'ref' },
  { name: 'settmpinfo', desc: '设置临时信息', category: '角色属性', usage: '@settmpinfo <键> <值>', src: 'ref' },
  { name: 'gettmpinfo', desc: '查询临时信息', category: '角色属性', usage: '@gettmpinfo <键>', src: 'ref' },
  { name: 'setactivetmpinfo', desc: '设置活跃临时信息', category: '角色属性', usage: '@setactivetmpinfo <键> <值>', src: 'ref' },
  { name: 'setekinfo', desc: '设置 EK 信息', category: '角色属性', usage: '@setekinfo <角色名> <是否绑定密宝> <是否验证过密宝>', src: 'engine' },
  {
    name: 'addyq',
    desc: '设置元气',
    category: '角色属性',
    usage: '@addyq <数值>',
    src: 'ref',
    note: '增加元气'
  },
  {
    name: 'skill',
    desc: '学习技能',
    category: '技能魔法',
    usage: '@skill <技能名>',
    src: 'ref',
    note: '学习技能'
  },
  { name: 'setskill', desc: '调整技能等级', category: '技能魔法', usage: '@setskill <技能名> <等级>', src: 'ref' },
  { name: 'delskill', desc: '删除技能', category: '技能魔法', usage: '@delskill <技能名>', src: 'ref' },
  { name: 'reloadmagicprop', desc: '重载魔法属性配置', category: '技能魔法', usage: '@reloadmagicprop', src: 'ref' },
  { name: 'shadowinfo', desc: '查看元神信息', category: '技能魔法', usage: '@shadowinfo', src: 'ref' },
  { name: 'createshadow', desc: '创建特定的元神', category: '技能魔法', usage: '@createshadow <姓名> <性别(0/1)> <职业(0/1/2)> <发型> [等级]', src: 'engine' },
  { name: 'callshadow', desc: '召唤元神', category: '技能魔法', usage: '@callshadow', src: 'ref' },
  { name: 'clearshadow', desc: '清除元神', category: '技能魔法', usage: '@clearshadow', src: 'ref' },
  { name: 'hideshadow', desc: '改变元神显示模式', category: '技能魔法', usage: '@hideshadow', src: 'ref' },
  { name: 'setshadowtonic', desc: '设置元神灵珠', category: '技能魔法', usage: '@setshadowtonic <强化值>', src: 'ref' },
  { name: 'callex', desc: '调用脚本函数', category: '技能魔法', usage: '@callex <脚本名> <函数名>', src: 'engine' },
  { name: 'getresearchresult', desc: '查询调查问答结果', category: '技能魔法', usage: '@getresearchresult', src: 'ref' },
  { name: 'clearresearchresult', desc: '清除调查问答结果', category: '技能魔法', usage: '@clearresearchresult', src: 'ref' },
  { name: 'setlevel', desc: '升级', category: '等级经验', usage: '@setlevel <等级>', src: 'engine' },
  { name: 'setexp', desc: '设置经验', category: '等级经验', usage: '@setexp <经验值>', src: 'ref' },
  { name: 'addexp', desc: '增加经验', category: '等级经验', usage: '@addexp <经验值>', src: 'ref' },
  { name: 'jingyan', desc: '调整经验', category: '等级经验', usage: '@jingyan <经验值>', src: 'engine' },
  { name: 'jibie', desc: '调整等级', category: '等级经验', usage: '@jibie <等级>', src: 'engine' },
  {
    name: 'logexp',
    desc: '玩家经验日志开关',
    category: '等级经验',
    usage: '@logexp <角色名>',
    src: 'engine',
    note: '开关该角色的经验日志'
  },
  { name: 'setpetlevel', desc: '设置宠物等级和经验', category: '等级经验', usage: '@setpetlevel <宠物名称> <宠物等级> <宠物经验>', src: 'engine' },
  { name: 'mon', desc: '造怪物', category: '怪物与召唤', usage: '@mon <怪物名> [数量]', src: 'ref' },
  { name: 'monappr', desc: '设置怪物外观', category: '怪物与召唤', usage: '@monappr <外观编号>', src: 'ref' },
  { name: 'minfo', desc: '查询周围怪物', category: '怪物与召唤', usage: '@minfo', src: 'ref' },
  { name: 'somemob', desc: '批量造怪物', category: '怪物与召唤', usage: '@somemob <怪物名> <数量>', src: 'ref' },
  { name: 'clearmob', desc: '清除怪物', category: '怪物与召唤', usage: '@clearmob [范围]', src: 'ref' },
  { name: 'clearmobfight', desc: '清除怪物活动', category: '怪物与召唤', usage: '@clearmobfight', src: 'ref' },
  {
    name: 'startmobfight',
    desc: '开始怪物活动',
    category: '怪物与召唤',
    usage: '@startmobfight <地图编号> <X> <Y>',
    src: 'ref',
    note: '参数未标注，以服务端校验为准'
  },
  { name: 'endmobfight', desc: '结束怪物活动', category: '怪物与召唤', usage: '@endmobfight', src: 'ref' },
  { name: 'querymobfight', desc: '查询怪物活动', category: '怪物与召唤', usage: '@querymobfight', src: 'ref' },
  {
    name: 'monsterburst',
    desc: '查询怪物爆率',
    category: '怪物与召唤',
    usage: '@monsterburst <怪物名>',
    src: 'engine',
    note: '怪物不存在时会提示「不存在该怪物」'
  },
  {
    name: 'rangemob',
    desc: '范围内造怪物',
    category: '怪物与召唤',
    usage: '@rangemob <怪物名> <数量> <范围> 或 @rangemob <怪物名> <数量> <X> <Y> <范围>',
    src: 'engine',
    note: '两种格式：只给范围，或给中心坐标与范围；数量有上限'
  },
  {
    name: 'rangemob2',
    desc: '范围内造怪物2',
    category: '怪物与召唤',
    usage: '@rangemob2 <怪物名> <数量> <范围> 或 @rangemob2 <怪物名> <数量> <X> <Y> <范围>',
    src: 'engine',
    note: '参数格式与 @rangemob 相同'
  },
  {
    name: 'rangemob3',
    desc: '范围内造怪物3',
    category: '怪物与召唤',
    usage: '@rangemob3 <怪物名> <数量> <范围> 或 @rangemob3 <怪物名> <数量> <X> <Y> <范围>',
    src: 'engine',
    note: '两种格式：只给范围，或给中心坐标与范围'
  },
  { name: 'lookformonster', desc: '查看地图上某种怪物的位置', category: '怪物与召唤', usage: '@lookformonster <怪物名>', src: 'ref' },
  { name: 'lookformonster2', desc: '查看地图上某种怪物的数量', category: '怪物与召唤', usage: '@lookformonster2 <怪物名>', src: 'ref' },
  {
    name: 'speakingmob',
    desc: '造说话怪物',
    category: '怪物与召唤',
    usage: '@speakingmob <怪物名> <数量> <X> <Y> <范围> <内容类型> <频率> <空间>',
    src: 'engine',
    note: '内容类型/频率/空间为服务端参数，按实际提示填写'
  },
  { name: 'clearspecialmob', desc: '清除指定怪物', category: '怪物与召唤', usage: '@clearspecialmob <怪物名>', src: 'engine' },
  { name: 'startkillmob', desc: '开始杀怪', category: '怪物与召唤', usage: '@startkillmob', src: 'ref' },
  { name: 'querykillmob', desc: '结束杀怪', category: '怪物与召唤', usage: '@querykillmob', src: 'ref' },
  {
    name: 'chongwu',
    desc: '召唤宠物',
    category: '怪物与召唤',
    usage: '@chongwu <参数…>',
    src: 'ref',
    note: '参数未标注，以服务端校验为准'
  },
  {
    name: 'mqenable',
    desc: '打开MQ',
    category: '怪物与召唤',
    usage: '@mqenable <参数…>',
    src: 'ref',
    note: '参数未标注，以服务端校验为准'
  },
  { name: 'querymq', desc: '查询MQ状态', category: '怪物与召唤', usage: '@querymq', src: 'ref' },
  { name: 'mapno', desc: '查询地图编号', category: '地图与刷怪', usage: '@mapno', src: 'ref' },
  { name: 'mapview', desc: '查询地图人数怪物数', category: '地图与刷怪', usage: '@mapview [地图编号]', src: 'ref' },
  { name: 'reloadmapprop', desc: '重载地图属性配置', category: '地图与刷怪', usage: '@reloadmapprop', src: 'ref' },
  { name: 'clearposlist', desc: '清除指定坐标链表对象', category: '地图与刷怪', usage: '@clearposlist <地图编号> <X> <Y> <链表索引(0/1)>', src: 'engine' },
  { name: 'logposlist', desc: '记录指定坐标链表对象', category: '地图与刷怪', usage: '@logposlist <地图编号> <X> <Y>', src: 'engine' },
  { name: 'checkguild', desc: '检查行会', category: '行会与沙城', usage: '@checkguild <行会名>', src: 'ref' },
  { name: 'checkguildmember', desc: '检查行会成员', category: '行会与沙城', usage: '@checkguildmember <行会名>', src: 'ref' },
  { name: 'reloadguild', desc: '重新加载行会', category: '行会与沙城', usage: '@reloadguild', src: 'ref' },
  { name: 'setguildshutup', desc: '设置行会聊天标志', category: '行会与沙城', usage: '@setguildshutup <行会名> <状态(0/1)>', src: 'engine' },
  { name: 'setplayerguildexp', desc: '增加行会经验和行会能量', category: '行会与沙城', usage: '@setplayerguildexp <角色名> <经验值>', src: 'ref' },
  { name: 'changeguildlevel', desc: '修改行会等级', category: '行会与沙城', usage: '@changeguildlevel <行会名> <等级>', src: 'ref' },
  { name: 'changeguildexp', desc: '修改行会经验', category: '行会与沙城', usage: '@changeguildexp <行会名> <经验值>', src: 'ref' },
  { name: 'reloadsabuk', desc: '重载沙巴克', category: '行会与沙城', usage: '@reloadsabuk', src: 'ref' },
  { name: 'reloadsabukprize', desc: '加载沙城奖励信息', category: '行会与沙城', usage: '@reloadsabukprize', src: 'ref' },
  { name: 'checksabuk', desc: '查询沙巴克', category: '行会与沙城', usage: '@checksabuk', src: 'ref' },
  { name: 'querysabukwar', desc: '查询攻城战', category: '行会与沙城', usage: '@querysabukwar', src: 'ref' },
  { name: 'kaishishacheng', desc: '添加攻城战', category: '行会与沙城', usage: '@kaishishacheng [行会名]', src: 'ref' },
  { name: 'deletesabukwar', desc: '删除攻城战', category: '行会与沙城', usage: '@deletesabukwar', src: 'ref' },
  {
    name: 'bloodcity',
    desc: '查询铁血魔城行会排名',
    category: '行会与沙城',
    usage: '@bloodcity <参数…>',
    src: 'ref',
    note: '参数未标注，以服务端校验为准'
  },
  { name: 'chaxunshacheng', desc: '查询城内金币', category: '行会与沙城', usage: '@chaxunshacheng', src: 'ref' },
  {
    name: 'shezhipk',
    desc: '设置PK值',
    category: '行会与沙城',
    usage: '@shezhipk <角色名> <PK值>',
    src: 'engine',
    note: 'PK 值不能超过 20000'
  },
  { name: 'releasepk', desc: '释放PK', category: '行会与沙城', usage: '@releasepk <角色名>', src: 'ref' },
  { name: 'chaxunpk', desc: '查询PK值', category: '行会与沙城', usage: '@chaxunpk [角色名]', src: 'ref' },
  { name: 'releasegd', desc: '取消管理员身份', category: '行会与沙城', usage: '@releasegd [地图编号]', src: 'ref' },
  { name: 'zhidingchengzhu', desc: '更换城主', category: '行会与沙城', usage: '@zhidingchengzhu <行会名>', src: 'ref' },
  {
    name: 'globemessage',
    desc: '全体留言',
    category: '公告与消息',
    usage: '@globemessage <内容> <持续时间>',
    src: 'engine',
    note: '需要在 GS0 上执行'
  },
  { name: 'screenmsg', desc: '红飘', category: '公告与消息', usage: '@screenmsg <内容>', src: 'ref' },
  { name: 'topmsg', desc: '顶部公告', category: '公告与消息', usage: '@topmsg <内容>', src: 'ref' },
  { name: 'floatmsg', desc: '浮动公告', category: '公告与消息', usage: '@floatmsg <内容>', src: 'ref' },
  { name: 'playershow', desc: '玩家现身', category: '公告与消息', usage: '@playershow <角色名>', src: 'ref' },
  {
    name: 'npchide',
    desc: 'NPC隐身',
    category: '公告与消息',
    usage: '@npchide <X> <Y>',
    src: 'engine',
    note: '让指定坐标的 NPC 隐身'
  },
  {
    name: 'npcshow',
    desc: 'NPC现身',
    category: '公告与消息',
    usage: '@npcshow <X> <Y>',
    src: 'engine',
    note: '让指定坐标的 NPC 现身'
  },
  { name: 'querynpc', desc: '查询NPC', category: '公告与消息', usage: '@querynpc <NPC名称>', src: 'engine' },
  { name: 'info', desc: '查询玩家信息', category: '公告与消息', usage: '@info [角色名]', src: 'ref' },
  {
    name: 'gm',
    desc: '修改角色名',
    category: '玩家管理',
    usage: '@gm <新角色名>',
    src: 'engine',
    note: '新名不可与老名相同（保留原名改用 @bgm）；最长 14 个字母或 7 个汉字'
  },
  {
    name: 'gm2',
    desc: '修改指定角色名',
    category: '玩家管理',
    usage: '@gm2 <老角色名> <新角色名>',
    src: 'engine',
    note: '老角色名与新角色名不能相同'
  },
  {
    name: 'gmmode',
    desc: '观察模式',
    category: '玩家管理',
    usage: '@gmmode',
    src: 'ref',
    note: '切换 GM 模式'
  },
  { name: 'online', desc: '查询人数', category: '玩家管理', usage: '@online', src: 'ref' },
  { name: 'limitplayernum', desc: '设置范围人数限制', category: '玩家管理', usage: '@limitplayernum <人数>', src: 'ref' },
  {
    name: 'jiehun',
    desc: '结婚',
    category: '玩家管理',
    usage: '@jiehun <男方角色名> <女方角色名>',
    src: 'engine',
    note: '按男方、女方顺序输入'
  },
  { name: 'lihun', desc: '离婚', category: '玩家管理', usage: '@lihun [角色名]', src: 'ref' },
  { name: 'shitu', desc: '拜师', category: '玩家管理', usage: '@shitu <角色名>', src: 'ref' },
  { name: 'jiechushitu', desc: '解除师徒', category: '玩家管理', usage: '@jiechushitu <徒弟角色名>', src: 'engine' },
  { name: 'chaxunguanxi', desc: '查询关系', category: '玩家管理', usage: '@chaxunguanxi [角色名]', src: 'ref' },
  { name: 'setmaster', desc: '设置元神的主人', category: '玩家管理', usage: '@setmaster <角色名> <师傅名>', src: 'ref' },
  {
    name: 'checkjieduan',
    desc: '检查阶段',
    category: '玩家管理',
    usage: '@checkjieduan <炉编号>',
    src: 'engine',
    note: '查看该号炉当前阶段'
  },
  { name: 'setjieduan', desc: '设置阶段', category: '玩家管理', usage: '@setjieduan <炉编号> <阶段>', src: 'engine' },
  {
    name: 'checkwendu',
    desc: '检查温度',
    category: '玩家管理',
    usage: '@checkwendu <炉编号>',
    src: 'engine',
    note: '查看该号炉当前温度'
  },
  { name: 'setwendu', desc: '设置温度', category: '玩家管理', usage: '@setwendu <炉编号> <温度>', src: 'engine' },
  {
    name: 'checkfreeze',
    desc: '查看帐号是否被冻结',
    category: '玩家管理',
    usage: '@checkfreeze <帐号名>',
    src: 'engine',
    note: '按帐号查询冻结状态'
  },
  {
    name: 'unfreeze',
    desc: '解冻',
    category: '玩家管理',
    usage: '@unfreeze <帐号名>',
    src: 'engine',
    note: '按帐号解冻'
  },
  {
    name: 'freeze',
    desc: '将玩家的帐号冻结',
    category: '玩家管理',
    usage: '@freeze <角色名>',
    src: 'engine',
    note: '缺少参数时会提示「缺少参数:角色名！」'
  },
  {
    name: 'qingchu',
    desc: '清除争霸赛结果',
    category: '玩家管理',
    usage: '@qingchu',
    src: 'engine',
    note: '清除争霸赛结果'
  },
  {
    name: 'chaxun',
    desc: '争霸赛结果',
    category: '玩家管理',
    usage: '@chaxun',
    src: 'engine',
    note: '查询争霸赛结果'
  },
  {
    name: 'kaishi',
    desc: '开始行会争霸',
    category: '玩家管理',
    usage: '@kaishi',
    src: 'engine',
    note: '开始行会争霸'
  },
  {
    name: 'jieshu',
    desc: '终止行会争霸',
    category: '玩家管理',
    usage: '@jieshu',
    src: 'engine',
    note: '终止行会争霸'
  },
  { name: 'checkdelay', desc: '检查延迟', category: '玩家管理', usage: '@checkdelay [角色名]', src: 'ref' },
  {
    name: 'addaccount',
    desc: '添加账号',
    category: '玩家管理',
    usage: '@addaccount <账号> <类型>',
    src: 'engine',
    note: '第二个参数为账号类型'
  },
  { name: 'attackmode', desc: '攻击模式', category: '玩家管理', usage: '@attackmode <模式>', src: 'ref' },
  { name: 'closeattack', desc: '取消GM攻击模式', category: '玩家管理', usage: '@closeattack', src: 'ref' },
  { name: 'openattack', desc: 'GM攻击模式', category: '玩家管理', usage: '@openattack', src: 'ref' },
  {
    name: 'searchobj',
    desc: '根据指针查找对象',
    category: '玩家管理',
    usage: '@searchobj <对象指针> [X Y 范围]',
    src: 'engine',
    note: '服务端提示中的命令名为 findobject'
  },
  {
    name: 'xiaxian',
    desc: '踢人',
    category: '玩家管理',
    usage: '@xiaxian <角色名>',
    src: 'ref',
    note: '强制角色下线'
  },
  {
    name: 'hide',
    desc: '隐身或现身',
    category: '玩家管理',
    usage: '@hide',
    src: 'ref',
    note: '隐身或现身'
  },
  {
    name: 'clearmarrylist',
    desc: '清空结婚列表',
    category: '玩家管理',
    usage: '@clearmarrylist',
    src: 'engine',
    note: '清空结婚列表'
  },
  {
    name: 'querymarrylist',
    desc: '查询结婚列表',
    category: '玩家管理',
    usage: '@querymarrylist',
    src: 'engine',
    note: '查询本服夫妇数量'
  },
  { name: 'reloadscript', desc: '重载脚本', category: '服务器控制', usage: '@reloadscript <脚本名>', src: 'engine' },
  { name: 'reloadtask', desc: '重新加载任务', category: '服务器控制', usage: '@reloadtask', src: 'ref' },
  { name: 'reloadnpc', desc: '重新加载NPC', category: '服务器控制', usage: '@reloadnpc', src: 'ref' },
  { name: 'reloadquestion', desc: '重新题库', category: '服务器控制', usage: '@reloadquestion', src: 'ref' },
  { name: 'reloadtianguan', desc: '重新天关', category: '服务器控制', usage: '@reloadtianguan', src: 'ref' },
  { name: 'reloadarena', desc: '重载英雄擂台地图坐标', category: '服务器控制', usage: '@reloadarena', src: 'ref' },
  { name: 'reloadarenaprize', desc: '重载英雄擂台奖品列表', category: '服务器控制', usage: '@reloadarenaprize', src: 'ref' },
  { name: 'reloaditemprop', desc: '重载物品属性配置', category: '服务器控制', usage: '@reloaditemprop', src: 'ref' },
  {
    name: 'endtime',
    desc: '查询点卡剩余时间',
    category: '服务器控制',
    usage: '@endtime <角色名>',
    src: 'engine',
    note: '查询角色点卡剩余秒数与点卡类型'
  },
  {
    name: 'debuginfo',
    desc: '查指定点的信息',
    category: '服务器控制',
    usage: '@debuginfo <子命令> [参数]',
    src: 'engine',
    note: '子命令：rungatecount、printobjmap、printplayermap、checkobjmap、checkplayermap、deadloop、mappoint'
  },
  { name: 'gsinfo', desc: 'GS的相关信息', category: '服务器控制', usage: '@gsinfo', src: 'ref' },
  { name: 'beacon', desc: '播放烟火', category: '服务器控制', usage: '@beacon <烟火类型> <地图编号> <坐标X> <坐标Y>', src: 'engine' },
  {
    name: 'bgm',
    desc: '确认系统分配的角色名',
    category: '服务器控制',
    usage: '@bgm',
    src: 'engine',
    note: '仅可使用一次；确认后系统赠送一套七龙珠'
  },
  { name: 'conditionshut', desc: '条件禁言', category: '服务器控制', usage: '@conditionshut <等级> <关键字1> <关键字2> <关键字3> ...', src: 'engine' },
  {
    name: 'supershut',
    desc: '永久禁言',
    category: '服务器控制',
    usage: '@supershut <角色名> <标记>',
    src: 'engine',
    note: '标记：0 解除禁言 / 1 永久禁言'
  },
  { name: 'stopshut', desc: '释放禁言', category: '服务器控制', usage: '@stopshut', src: 'ref' },
  {
    name: 'shut',
    desc: '禁言',
    category: '服务器控制',
    usage: '@shut <角色名> <分钟>',
    src: 'engine',
    note: '禁言指定分钟数'
  },
  {
    name: 'guanzhong',
    desc: '观众模式',
    category: '服务器控制',
    usage: '@guanzhong <角色名> <分钟>',
    src: 'engine',
    note: '设置观众模式'
  },
  {
    name: 'stopguanzhong',
    desc: '取消观众模式',
    category: '服务器控制',
    usage: '@stopguanzhong <角色名>',
    src: 'engine',
    note: '取消观众模式'
  },
  {
    name: 'changeweather',
    desc: '改变天气',
    category: '服务器控制',
    usage: '@changeweather <天气编号>',
    src: 'engine',
    note: '天气参数必须在 0-11 之间'
  },
  { name: 'writeguessresulttofile', desc: '把猜谜数据导到文件中', category: '服务器控制', usage: '@writeguessresulttofile', src: 'ref' },
  { name: 'clearguesshistory', desc: '清除猜谜数据', category: '服务器控制', usage: '@clearguesshistory', src: 'ref' },
  {
    name: 'addnpc',
    desc: '添加NPC',
    category: '服务器控制',
    usage: '@addnpc <唯一标识> <脚本名> <地图编号> <X坐标> <Y坐标> <NPC名称> <方向> <外形> <特殊标记>',
    src: 'engine',
    note: '特殊标记：0 普通 NPC / 1 沙巴克城主专用 / 2 魔幻镜 / 3 隐身'
  },
  { name: 'delnpc', desc: '删除 NPC', category: '服务器控制', usage: '@delnpc <地图编号> <X坐标> <Y坐标>', src: 'engine' },
  { name: 'dotask', desc: '执行任务', category: '任务与杂项', usage: '@dotask <任务编号> <完成次数(最大100)>', src: 'engine' },
  { name: 'setsubtask', desc: '设置任务的子状态', category: '任务与杂项', usage: '@setsubtask <任务编号> <子状态>', src: 'engine' },
  { name: 'settask', desc: '设置任务的状态', category: '任务与杂项', usage: '@settask <任务编号> <任务状态>', src: 'engine' },
  { name: 'cleartask', desc: '清除玩家的历史任务信息', category: '任务与杂项', usage: '@cleartask <任务编号>', src: 'ref' },
  { name: 'htaskinfo', desc: '查看玩家的历史任务信息', category: '任务与杂项', usage: '@htaskinfo <任务编号>', src: 'engine' },
  { name: 'taskinfo', desc: '查看玩家当前的任务信息', category: '任务与杂项', usage: '@taskinfo <任务编号>', src: 'ref' },
  { name: 'sortsmallgame', desc: '重新排名休闲游戏积分', category: '任务与杂项', usage: '@sortsmallgame', src: 'ref' },
  {
    name: 'work',
    desc: '更换职业',
    category: '任务与杂项',
    usage: '@work <职业>',
    src: 'engine',
    note: '职业无效时会提示「无效的职业」'
  },
  {
    name: 'sdif2',
    desc: '查询玩家信息2',
    category: '任务与杂项',
    usage: '@sdif2 <角色名>',
    src: 'engine',
    note: '查询指定玩家信息'
  },
  {
    name: 'superti',
    desc: '送周围玩家',
    category: '任务与杂项',
    usage: '@superti <参数…>',
    src: 'ref',
    note: '语义未标注，参数以服务端校验为准'
  },
  {
    name: 'ti',
    desc: '送某一玩家',
    category: '任务与杂项',
    usage: '@ti <参数…>',
    src: 'ref',
    note: '语义未标注，参数以服务端校验为准'
  },
  {
    name: 'zhua',
    desc: '召唤玩家',
    category: '任务与杂项',
    usage: '@zhua <角色名>',
    src: 'engine',
    note: '只能召唤本 GS 在线玩家'
  },
  { name: 'racingclear2', desc: '清除赛马记录2', category: '任务与杂项', usage: '@racingclear2', src: 'ref' },
  { name: 'racingscore2', desc: '查询赛马选手得分2', category: '任务与杂项', usage: '@racingscore2 <分数>', src: 'ref' },
  { name: 'racingend2', desc: '结束赛马2', category: '任务与杂项', usage: '@racingend2', src: 'ref' },
  { name: 'racingbegin2', desc: '开始赛马2', category: '任务与杂项', usage: '@racingbegin2', src: 'ref' },
  { name: 'racingclear', desc: '清除赛马记录', category: '任务与杂项', usage: '@racingclear', src: 'ref' },
  { name: 'racingscore', desc: '查询赛马选手得分', category: '任务与杂项', usage: '@racingscore <分数>', src: 'ref' },
  { name: 'racingend', desc: '结束赛马', category: '任务与杂项', usage: '@racingend', src: 'ref' },
  { name: 'racingbegin', desc: '开始赛马', category: '任务与杂项', usage: '@racingbegin', src: 'ref' },
];

const CATEGORIES = [
  '传送与坐标',
  '物品与装备',
  '角色属性',
  '技能魔法',
  '等级经验',
  '怪物与召唤',
  '地图与刷怪',
  '行会与沙城',
  '公告与消息',
  '玩家管理',
  '服务器控制',
  '任务与杂项'
];

const NAME_RE = /^[a-z][a-z0-9]{1,24}$/;
const byName = new Map();
for (const cmd of COMMANDS) {
  if (!byName.has(cmd.name)) byName.set(cmd.name, cmd);
}

function list() {
  return COMMANDS;
}

function categories() {
  return CATEGORIES.slice();
}

function selfCheck() {
  const issues = [];
  const seen = new Set();
  const catSet = new Set(CATEGORIES);
  for (const cmd of COMMANDS) {
    if (!NAME_RE.test(cmd.name)) {
      issues.push({ code: 'gm_catalog_name', message: '命令名不合法：' + cmd.name });
    }
    if (!catSet.has(cmd.category)) {
      issues.push({ code: 'gm_catalog_category', message: '命令 ' + cmd.name + ' 使用了未知分类：' + cmd.category });
    }
    if (!cmd.usage || !String(cmd.usage).toLowerCase().startsWith('@' + cmd.name)) {
      issues.push({ code: 'gm_catalog_usage', message: '命令 ' + cmd.name + ' 缺少有效用法说明' });
    }
    if (cmd.src !== 'engine' && cmd.src !== 'ref') {
      issues.push({ code: 'gm_catalog_src', message: '命令 ' + cmd.name + ' 的用法来源标记不合法' });
    }
    if (cmd.note != null && typeof cmd.note !== 'string') {
      issues.push({ code: 'gm_catalog_note', message: '命令 ' + cmd.name + ' 的补充说明不合法' });
    }
    if (seen.has(cmd.name)) {
      issues.push({ code: 'gm_catalog_duplicate', message: '命令重复：' + cmd.name });
    }
    seen.add(cmd.name);
  }
  if (!COMMANDS.length) {
    issues.push({ code: 'gm_catalog_empty', message: '命令目录为空' });
  }
  return issues;
}

module.exports = { list, categories, byName, selfCheck, CATEGORIES, COMMANDS };

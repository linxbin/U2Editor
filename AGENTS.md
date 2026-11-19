# AGENTS.md — U2Editor

> 给接手本项目的 AI / 开发者：先读完本文再动代码。这是一个**直接改写真实游戏配置文件的本地工具**，数据安全约束优先于任何功能需求。

## 1. 项目是什么

U2Editor（原名「传世 DB 编辑器」）是一个 Node.js 本地 Web 应用，用图形界面浏览、检查、编辑《传奇世界》1.9.6 服务端的 `GameServer/Envir` 配置：数据库（`DB/*.db`）、NPC 列表与脚本、刷怪、爆率、地图、商城、任务、活动等。

- 纯本地、离线：只监听 `127.0.0.1`
- 零依赖：没有 `package.json` / `node_modules`，只用 Node 内置模块
- 无构建：前端是原生 HTML/CSS/JS，由 `server.js` 直接托管
- 本仓库：`D:\U2Server\Tools\DBEditor`；默认数据目录：`D:\U2Server\GameServer\Envir`

## 2. 数据安全红线（必须遵守）

1. **测试绝不碰真实 Envir**。任何写入、生成、删除的验证，都先复制一份临时 Envir（见 §8），用 `DBEDITOR_ENVIR_DIR` 指过去。
2. **每次写入前自动备份**。写文件的代码必须调用 `backupFile()`（`lib/dbe.js`）或 `writeFileLines()`（`lib/configs.js`，内部已备份）。备份放在被改文件同目录的 `备份/` 下，命名 `原名.YYYYMMDD-HHMMSS.bak`。内容没有变化时不应产生备份。
3. **保留原文件格式**：
   - 游戏文件一律 GBK/GB2312（`lib/gbk.js`），不要用 UTF-8 写；
   - 保留原换行符（CRLF/LF 自动探测）与末尾换行；
   - 注释、空行、未修改的行必须逐字节不变——按行号/token 打补丁，禁止“解析后整体重排再序列化”；
   - 写入内容必须能被 `gbk.encode` 无损编码，遇到无法编码的字直接报错；向导生成脚本还会额外做 `decode(encode) === 原文` 的往返校验。
4. **未经用户明确要求不要 commit / push**。历史上每次提交都由用户说「提交代码」触发。
5. 覆盖、删除、批量修改要保留一致性校验（`expected` / 内容签名），不一致返回 409，避免基于陈旧页面写错行。

## 3. 运行

要求 Node.js 18+（官方构建带完整 ICU，否则 `TextDecoder('gbk')` 不可用）。

```bat
启动编辑器.bat
```

或：

```bash
node server.js
```

- 默认端口 `8866`；被占用时自动 +1 重试，最多 10 次。
- Windows 下启动后自动打开浏览器；`DBEDITOR_NO_OPEN=1` 可禁止。
- 环境变量：

| 变量 | 作用 |
|---|---|
| `PORT` | 起始端口 |
| `DBEDITOR_ROOT` | 服务器根目录（默认 `Tools/DBEditor/../..`） |
| `DBEDITOR_ENVIR_DIR` | Envir 目录（默认 `<ROOT>/GameServer/Envir`） |
| `DBEDITOR_DB_DIR` | DB 目录（默认 `<ENVIR>/DB`） |
| `DBEDITOR_DROP_DIR` | 爆率目录（默认 `<ENVIR>/MonItems`） |
| `DBEDITOR_NO_OPEN` | 非空则启动时不打开浏览器 |

## 4. 目录与模块地图

```
server.js            唯一入口：路径解析、workbench 组装、HTTP 路由分发、静态文件托管
启动编辑器.bat        Windows 启动脚本（查找 Node>=18、启动、缺 Node 提示）
lib/                 后端：每类配置一个模块，负责解析、校验、写入
public/              前端：index.html + 每类配置一个视图脚本 + app.js 外壳
```

### 关键文件

| 文件 | 职责 |
|---|---|
| `server.js` | 全部 `/api/*` 路由手写分发；`STATIC` 表登记前端静态文件；组装各 workbench |
| `lib/gbk.js` | GBK 编解码（TextDecoder 解码 + 自建编码表） |
| `lib/dbe.js` | DB 二进制格式：2048 字节分页、6 字节页头、文件头字段名表、定宽记录；`loadDb` / `saveDb` / `deleteRows` / `backupFile` |
| `lib/configs.js` | 共享文本行 IO（`readFileLines` / `writeFileLines`）+ Mongen / MakeItem / appellation 解析保存 |
| `lib/npc.js` | `NPCList.txt` 解析保存；脚本商店 `parseShops` / `saveShops` |
| `lib/npccreator.js` | 「新建 NPC」向导后端：配置校验、脚本生成与编辑、元数据、NPCList 写入 |
| `lib/npctemplates.js` | 向导各模板的 Python 脚本生成器（纯字符串拼装） |
| `lib/pysyntax.js` | 生成脚本的轻量语法检查 |
| `lib/dbrefs.js` | 跨库引用检查（物品 / 怪物被谁引用） |
| `lib/extra.js` | 扩展配置总表 `FILES`：服务器 / 地图 / 活动 / 充值 / 系统文本等杂项文件 |
| 其他 `lib/*.js` | 对应各工作台；统一导出 `create(options)`，返回 list / detail / save / health / invalidate 等 |
| `public/app.js` | 前端外壳：全局 `S` 状态、`api()`、toast、页签与工作台导航（`WORK_GROUPS`）、脏标记、返回 |
| `public/index.html` | 所有视图的 DOM 骨架（`<section id="xxxView" class="view hidden">`）+ 按顺序加载全部脚本 |
| `public/labels.js` | 字段中文名映射 `FIELD_LABELS` |
| `public/dialog.js` | 通用弹窗 |
| `public/styles.css` | 全部样式（暗色主题，单文件） |

### 功能 ↔ 模块 ↔ 视图

| 功能 | 后端 | 前端视图 |
|---|---|---|
| 数据库浏览编辑 | `dbe.js` | `#dbView`（基础数据 → 数据库） |
| 怪物 | `monster.js` | `#monsterView` |
| 爆率 | `dropwork.js`（保存走 `monster.js`） | `#dropView` |
| 刷怪 | `spawnwork.js` | `#spawnWorkView` |
| 地图 | `mapwork.js` | `#mapWorkView` |
| NPC 工作台 / 向导 | `npcwork.js`、`npccreator.js`、`npctemplates.js`、`npc.js` | `#npcWorkView` + `public/npcwork.js`、`public/npcwizard.js` |
| 物品与掉落 | `itemwork.js` | `#itemDropView` |
| 合成 / 商城 | `shopwork.js` | `#shopWorkView` |
| 新手 / 充值 | `starterwork.js` | `#starterWorkView` |
| 任务 | `tasks.js` | `#taskView` |
| 活动 | `activity.js` | `#activityView` |
| 文案 / 对话 | `textwork.js` | `#textWorkView` |
| 沙城 / 攻城 | `castlework.js` | `#castleWorkView` |
| 职业与技能 | `growth.js` | `#growthView` |
| 脚本检索 | `scriptwork.js` | `#scriptWorkView` |
| 元神 | `yswork.js` | `#ysworkView` |
| 配置体检 | `healthwork.js`（聚合各工作台 health） | `#healthWorkView` |
| 备份与历史 | `backups.js`（扫描 `备份/`、文本/DB 差异、恢复） | `#backupView` |
| 玩法基础配置 | `configs.js`、`npc.js`、`extras.js`、`mall.js`、`mapinfo.js`、`ops.js`、`extra.js` | 「玩法」侧栏对应的 `#mongenView` 等 |

### 数据文件速查

根目录均指 `Envir/`（`GameServer.ini` 在上一级）。

| 文件 / 目录 | 内容 | 主要模块 |
|---|---|---|
| `DB/stditems.db` | 物品属性（定宽记录） | `dbe.js`、`itemwork.js` |
| `DB/Monster.DB` | 怪物属性 | `dbe.js`、`monster.js` |
| `DB/magic.db` | 技能 | `dbe.js`、`growth.js`、`npccreator.js` |
| `DB/Upgrade.DB` | 召唤兽/灵兽升级经验（怪物等级段或宠物类型 → 升级档位） | `growth.js` |
| `NPCList.txt` | NPC 分布，Tab 分隔；向导生成 10 列：`编号 脚本名(不含 .py) 地图 X Y 名称 0 形象编号 0 0`，其余内容按原样保留 | `npc.js` |
| `NPCScript/*.py` | NPC 脚本；`TaskConfig_*.py` 为任务定义 | `npc.js`、`npccreator.js`、`tasks.js` |
| `Mongen.txt` | 刷怪配置 | `configs.js`、`spawnwork.js` |
| `MonItems/*.txt` | 爆率文件（按怪物命名） | `monster.js`、`dropwork.js` |
| `MapInfo` | 地图规则（无扩展名：跳转 / 安全区 / 属性） | `mapinfo.js`、`mapwork.js` |
| `map/*` | 地图文件（测试复制 Envir 时可按需排除） | `spawnwork.js`、`mapwork.js` |
| `MakeItem.txt` | 合成配方 | `configs.js`、`shopwork.js` |
| `goodsconfig` | 商城商品 | `extras.js`、`shopwork.js` |
| `PTItems.xml` | 商城道具 | `mall.js` |
| `MonsterChain.ini` / `MonsterChild.ini` | 召唤 / 宝宝关系 | `extras.js` |
| `appellation.txt` | 称号配置 | `configs.js` |
| `itemdesc.txt` | 道具说明文本 | `textwork.js` |
| `GameServer.ini`（`Envir/../`） | 服务器启动、经验、出生点、账号 | `extra.js` |
| `Sabuk.txt` / `SabukPrizes.txt` / `WarDate.txt` / `Guildlist.txt`、`GuardList.txt`、`Herofightmappointlist.TXT` | 沙城、攻城、行会、守卫、英雄战场 | `castlework.js`、`extra.js` |
| `LineNotice.txt` / `FloatAD.txt` / `Bullitin.ini` / `bless.txt` / `qlib.TXT` / `宝盒设置.ini` / `newPlayerItem.ini` | 公告、题库、宝盒、新手礼包等运营配置 | `ops.js` |
| `MiniMap.txt` / `minmaplist.txt` / `globeparams.txt` / `MonsterDialog.txt` / `EmotionChat.txt` / `goaldelivery*.xml` / `rescueprincess*.xml` 等 | 其余杂项配置 | `extra.js` 的 `FILES` 表（以该表为准） |

## 5. 代码模式

### 后端

- 每个功能模块导出 `create(options)`，options 由 `server.js` 注入文件路径、共享缓存函数（如 `itemNames`）和 `invalidate` 回调；模块内部可缓存解析结果，写操作后必须 `invalidate()`。
- 路由在 `handle()` 中按 `method + pathname` 手写分发；错误用 `throw` 并带 `e.status`，外层统一转 JSON `{error}`。
- 请求体上限 8MB；POST 成功后 `finally` 会自动 `invalidateState()`，但**工作台内部缓存仍要自己失效**。
- 改 `stditems.db` 后要清 `cachedItemNames` / `cachedItemIndex`（见 `/api/db/save` 与 `invalidateItemConsumers()`），否则其他工作台继续用旧物品名。
- 写接口一般返回备份路径和 warnings，前端据此提示。
- 所有来自请求的文件名都要过 `safePath()` + 正则，禁止目录穿越。

### 前端

- 无框架、无模块系统：`index.html` 按顺序加载脚本，各文件用顶层全局变量/函数（如 `S`、`NPW`、`NPWZ`、`openNpcWizard`）。新增文件必须同时加入 `index.html` 的 `<script>` 和 `server.js` 的 `STATIC` 表，否则 404。
- 网络统一走 `app.js` 的 `api(url, opts)`；失败抛错，错误对象带 `.status` 与 `.data`。
- 提示用 `toast(message, 'err'|'warn'|'ok')`；弹窗用 `dialog.js`。
- 视图切换与侧栏入口由 `app.js` 的 `BASIC_TABS`、`WORK_GROUPS` 定义，每个入口对应一个 `#xxxView`，同一时间只显示一个 `.view`。
- 交互优先事件委托（容器上监听，`data-*` 标记动作），列表可整块重绘。

### 数据层

- DB 文件：2048 字节/页，页头 6 字节；定宽字段；整数大端存储且最高位为标志（读取时 `& 0x7fff` / `& 0x7fffffff`）；字符串定宽 GBK、NUL 填充。
- `/api/db/save` 请求体：`{file, changes:[{index, values}], added:[...]}`；只能修改/新增现有文件容量内的记录，不能扩容或改表结构。
- 文本文件：`readFileLines` 返回 `{buf, text, lines, eol, trailing}`；保存用 `writeFileLines`，只改目标行。
- `gbk.decode()` 会截断 NUL 并 `trimEnd`，适合定长字段/单行；整段文本用 `gbk.decodeText()`，否则会丢末尾空白。
- 修改前按内容做一致性校验，不一致返回 409 让用户刷新。

## 6. NPC 向导（最复杂的子系统）

入口：NPC 工作台 → 「新建 NPC」/「编辑配置」（`public/npcwork.js` → `window.openNpcWizard` → `public/npcwizard.js`）。

- 模板 key（10 个）：`purchase` 金币购买、`shop` 标准商店、`warehouse` 仓库、`repair` 修理、`recycle` 回收、`skill` 技能学习、`daily` 每日/限时福利、`craft` 合成、`teleport` 收费传送、`teleportlist` 多目标传送。
- 多选时生成 `combined` 综合 NPC：`splitModule()` 把每个模板的 `def main` 改为 `def <key>_main`、`@main` 改为 `@<key>_main`，并给 `MODULE_CONSTS` 登记的常量加 `<key>_` 前缀；`compose()` 合并 `initialize`、丢弃子 `exit`、在总菜单中按勾选顺序串联，函数重名会直接报错。
- 生成脚本为 GBK + CRLF + 末尾换行，首行是元数据注释：
  `# @npcwizard <ASCII JSON>`，结构 `{v:1, template, modules:[{key,config}], menu, dailyType?, hash}`；
  `hash` 为正文（去掉首行后、统一 LF）的 SHA1。
  例外：**复制模板（`copy`）不重新生成**，原样保留源脚本字节（编码、换行、内容都不变），只去除旧元数据首行。
- 「编辑配置」只在元数据存在且合法时可用；`hash` 不匹配视为手工改过，保存需二次确认（后端 409，`code:'handEdited'`）。无元数据的老脚本、共享脚本、复制模板只能跳到脚本编辑。
- 保存时脚本和 `NPCList.txt` 都会备份；编辑校验 `expectedId` / `expectedScript`（身份锁），防止列表变化后写错行；脚本用临时文件 + rename 原子替换，失败回滚。
- `dailyType` 由后端自动推算并写入元数据，编辑时保持不变。
- 生成脚本上限 5MB（`MAX_SCRIPT`）。
- 金币购买商品别名（`alias`）：只影响 NPC 菜单显示（`<别名/@buy1>`），`GOODS` 元组、扣金币、发放物品仍用真实物品名；别名 ≤20 字符，禁止控制字符与 `< > / @`；未配置时菜单显示物品名。前端货品行四列：物品名 / 别名 / 单价 / 删除。

### 生成脚本的 DSL 速查

生成的是游戏内嵌的 Python 风格 DSL，**不是标准 Python 库环境**：只 `import user`（合成模板额外 `import random`），不要引第三方模块。

| 写法 | 含义 |
|---|---|
| `def initialize(npc):` | NPC 初始化，可空（`pass`） |
| `def main(player, npc):` | 点击 NPC 的入口 |
| `def exit(player, npc):` | 离开，通常 `user.closeDialog(player, npc)` |
| `def buy1(player, npc):` 等 | 菜单函数名任意；模板惯用 `buyN` / `buyNn` / `craftN` / `goN` |
| `msg += '<显示文字/@函数名>' + NL` | 菜单项语法 `<文字/@函数>` |
| `NL` | 生成脚本定义 `NL = '\\'`（游戏内换行标记），不要用 `\n` |
| `user.tell(player, npc, msg)` | 显示对话/菜单 |
| `user.getPlayerAttribute(player, 'Level')` / `'Gold'` 等 | 读玩家属性 |
| `user.giveItemToPlayer / takeItemFromPlayer / getSpaceInBag` | 给物品、扣物品（金币也是物品名）、查背包空位 |
| `user.learnSkill / repair / storage / sell / buy` | 技能、修理、仓库、买卖 |
| `user.playerMapMove / sendSysMessage / addExp / addGoods / closeDialog` | 传送、系统消息、经验、商店货品、关闭对话 |

双列菜单由 `menuRows()` 把条目两两拼进同一个 `msg +=`；完整可用 API 以 `lib/npctemplates.js` 中实际生成代码为准。

## 7. API 速查（前缀分组）

- 基础：`/api/state/bootstrap`、`/api/state`、`/api/db`、`/api/db/save|references|delete`
- 爆率：`/api/drop`、`/api/drop/save|references|delete`
- 玩法基础：`/api/config/mongen|makeitem|appellation`（GET + `/save`）、`/api/npc|shops`、`/api/config/goods|summons|mall`（GET + `/save`）、`/api/config/mapinfo`（GET + `/save` + `/register`）
- 运营 / 扩展：`/api/config/ops`、`/api/config/ops/notices/save`、`/api/config/ops/quiz/save`、`/api/config/ops/boxes/save`、`/api/config/ops/starter/save`、`/api/config/extra`、`/api/config/extra/data`、`/api/config/extra/save`
- NPC 工作台：`/api/config/npcwork`、`/detail`、`/script`、`/create/options|preview|create`、`/edit|edit/preview`
- 任务：`/api/config/tasks`、`task`、`task/options`、`task/toggle`、`task/batch`、`task/cleanup-orphans`、`task/patch`
- 各工作台：`/api/config/itemdrop|spawns|maps|growth|shopwork|scriptwork|castlework|textwork|starterwork|healthwork|yswork|activity`
- 备份与历史：`/api/backups`（分组按最新备份时间倒序）、`/api/backups/diff?id=`、`/api/backups/restore`（恢复前自动备份当前文件；成功后 `invalidateAll()`）
- 怪物：`/api/monster/list|detail|drop|drop/save`

新增接口时：在 `server.js` 加分发分支 → 有新前端文件就补 `STATIC` 和 `index.html` → 前端用 `api()` 调用 → 写操作前备份、写后失效缓存。

## 8. 开发验证流程（无自动化测试）

仓库没有测试框架。验证靠：临时 Envir + 真实 HTTP + 无头浏览器。

```bash
cd /d/U2Server/Tools/DBEditor
mkdir -p .tmp-test/Envir
(cd /d/U2Server/GameServer/Envir && tar -cf - --exclude=map .) | (cd .tmp-test/Envir && tar -xf -)

PORT=8903 DBEDITOR_ENVIR_DIR="D:/U2Server/Tools/DBEditor/.tmp-test/Envir" DBEDITOR_NO_OPEN=1 node server.js
```

- 验证地图相关功能时不要排除 `map` 目录。
- 机器上装了多个 Node 时，用绝对路径指定 18+ 的版本启动测试服务。
- API 直接用 `curl` 打 `/api/...`；Node 18+ 也可以直接用内置 `fetch` 写临时测试脚本。
- UI 用无头 Chrome 或 CDP（Node 20 `--experimental-websocket` + `Runtime.evaluate` / `Page.captureScreenshot`）。快速截图示例（Chrome 路径按本机调整）：
  `chrome --headless=new --screenshot=D:/U2Server/Tools/DBEditor/.tmp-test/shot.png --window-size=1600,1200 http://127.0.0.1:8903/`
- 断言重点：生成文件为 GBK + 原换行 + 末尾换行；未改动行字节不变；备份数量/位置正确；元数据回填正确；非法输入返回 400；陈旧状态返回 409。
- **验证结束必须**：停测试服务、`rm -rf .tmp-test`、确认 `git status` 只有预期源码改动、确认真实 Envir 未被修改。

## 9. 扩展操作手册

### 新增一个工作台 / 视图

1. `lib/<name>.js`：导出 `create(options)`，实现读取/保存（写前 `backupFile` / `writeFileLines`，内部缓存 + `invalidate()`）。
2. `server.js`：顶部 `require`，在 workbench 组装区 `create({...})` 注入路径与共享函数（`itemNames` 等）。
3. `server.js` 的 `handle()`：增加 GET / POST 路由，错误带 `status`。
4. `public/index.html`：加 `<section id="xxxView" class="view hidden">`。
5. `public/index.html`：在 `app.js` 之后加 `<script src="<name>.js"></script>`。
6. `server.js` 的 `STATIC`：登记 `/<name>.js`。
7. `public/app.js`：在 `WORK_GROUPS` 加入口；有健康检查时再补 `NAV_HEALTH_SOURCE` 和 `lib/healthwork.js` 的 sources。
8. 需要首页统计数字时，在 `getState()` 里汇总。
9. 用临时 Envir + 无头 Chrome 验证读写、备份、编码与未改动行。

### 新增一个向导模板

1. `lib/npccreator.js`：`MODULE_KEYS` 加 key。
2. `lib/npccreator.js`：新增 `normalizeXxx` 校验，并接入 `toWizardConfig()`、`buildModule()`、单模板分支。
3. `lib/npctemplates.js`：新增生成函数；更新 `MODULE_LABELS`、`MODULE_CONSTS`、`module.exports`。
4. `splitModule()` 会自动处理综合模板的 `main` / `@main` / 常量重命名；**新模板的顶层常量必须登记到 `MODULE_CONSTS`**，否则多模块组合会重名。
5. `public/npcwizard.js`：加表单块、`collectPayload`、`validateTemplateKey`、`npwzApplyEditMeta` 回填。
6. 验证 `create → editInfo → preview → update` 全链路；确认旧元数据缺新字段时兼容。

## 10. 常见坑

- 新前端文件忘了加 `STATIC` 或 `<script>` → 404 / 全局未定义。
- 写文件没用 `writeFileLines` / `backupFile` → 丢备份；用 UTF-8 写 → 游戏乱码。
- 解析后整体重新 join 输出 → 注释、空行、间距被改写，违反“未改动行逐字节一致”。
- 只 `invalidateState()` 没清工作台缓存 → 页面仍显示旧数据。
- 向导编辑时漏回填 ID / 脚本名 → 被后端身份锁 409 拒绝。
- 前端脚本顺序敏感：视图脚本依赖 `app.js` 的 `api()` / `toast` / `S`，必须排在后面。
- 菜单文字必须过滤 `< > / @`，否则破坏 `<文字/@函数>` 菜单语法。
- 复制模板（`copy`）原样保留源字节，不要对它做 CRLF 或编码转换。
- 综合模板里模板常量若没登记到 `MODULE_CONSTS`，多模块组合会出现重名 / 串值。
- `.tmp-test/`、`备份/` 已在 `.gitignore`，不要提交；`.gitattributes` 的 `* -text` 防止 Git 改行尾，不要删。
- 改品牌名时涉及：向导生成脚本首行注释、`index.html` 标题与 logo、`server.js` 启动日志、`启动编辑器.bat` 标题。`public/growth.js` 里的「在 DB 编辑器中打开」指数据库页签，不是产品名。

## 11. 已知限制

- 只监听 `127.0.0.1`，无鉴权，不要暴露到公网或共享环境。
- 没有文件监听：`/api/state` 有约 2 秒缓存，外部直接改文件后需要刷新页面（本工具的写操作会主动失效缓存）。
- 没有自动化测试、没有 lint / 构建流程。
- 向导脚本上限 5MB，HTTP 请求体上限 8MB。
- DB 只能编辑、新增、删除现有容量内的记录，不能改表结构或扩容；删除会压缩记录并重排页。
- Windows 优先（bat 启动、自动打开浏览器）；其他平台需手动 `node server.js`。
- 工具只改磁盘文件，不会操作运行中的游戏进程。

## 12. 提交约定

- 只在用户明确说「提交代码」时提交；不要主动 push。
- 提交信息风格（Conventional Commits + 中文描述）：
  - `feat(npc): 向导脚本支持配置回填编辑与商品别名`
  - `fix: ...`
  - `chore: 项目更名为 U2Editor`
- 一次提交只包含本次需求的改动；测试脚本、截图、临时 Envir 不提交。

## 13. 改完配置如何在游戏里生效

本工具只负责改磁盘文件。要让 GameServer 读到新配置，需要在服务器侧重载/重启相应模块（NPC 脚本、NPCList 等通常重启 GameServer 或使用服务端提供的 GM 重载命令，具体以服务端版本为准）。工具不会、也不应直接操作正在运行的游戏进程。

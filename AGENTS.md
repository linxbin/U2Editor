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
2. **每次写入前自动备份**。写文件的代码必须调用 `backupFile()`（`lib/dbe.js`）或 `writeFileLines()`（`lib/configs.js`，内部已备份）。备份放在被改文件同目录的 `备份/` 下，命名 `原名.YYYYMMDD-HHMMSS.bak`。
3. **保留原文件格式**：
   - 游戏文件一律 GBK/GB2312（`lib/gbk.js`），不要用 UTF-8 写；
   - 保留原换行符（CRLF/LF 自动探测）与末尾换行；
   - 注释、空行、未修改的行必须逐字节不变——按行号/token 打补丁，禁止“解析后整体重排再序列化”；
   - 写入前做 GBK 往返校验，不能无损编码就报错，不要静默替换。
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
| 爆率 | `dropwork.js` | `#dropView` |
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
| 成长 | `growth.js` | `#growthView` |
| 脚本检索 | `scriptwork.js` | `#scriptWorkView` |
| 元神 | `yswork.js` | `#ysworkView` |
| 配置体检 | `healthwork.js`（聚合各工作台 health） | `#healthWorkView` |
| 玩法基础配置 | `configs.js`、`npc.js`、`extras.js`、`mall.js`、`mapinfo.js`、`ops.js`、`extra.js` | 「玩法」侧栏对应的 `#mongenView` 等 |

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
- 文本文件：`readFileLines` 返回 `{buf, text, lines, eol, trailing}`；保存用 `writeFileLines`，只改目标行。
- 修改前按内容做一致性校验，不一致返回 409 让用户刷新。

## 6. NPC 向导（最复杂的子系统）

入口：NPC 工作台 → 「新建 NPC」/「编辑配置」（`public/npcwork.js` → `window.openNpcWizard` → `public/npcwizard.js`）。

- 模板 key（10 个）：`purchase` 金币购买、`shop` 标准商店、`warehouse` 仓库、`repair` 修理、`recycle` 回收、`skill` 技能学习、`daily` 每日/限时福利、`craft` 合成、`teleport` 收费传送、`teleportlist` 多目标传送。多选时生成 `combined` 综合 NPC：`compose()` 把各模板 `main` 改名为 `<key>_main`，再在总菜单里串联。
- 生成脚本为 GBK + CRLF + 末尾换行，首行是元数据注释：
  `# @npcwizard <ASCII JSON>`，结构 `{v:1, template, modules:[{key,config}], menu, dailyType?, hash}`；
  `hash` 为正文（去掉首行后、统一 LF）的 SHA1。
- 「编辑配置」只在元数据存在且合法时可用；`hash` 不匹配视为手工改过，保存需二次确认（后端 409，`code:'handEdited'`）。无元数据的老脚本、共享脚本、复制模板只能跳到脚本编辑。
- 保存时脚本和 `NPCList.txt` 都会备份；编辑校验 `expectedId` / `expectedScript`（身份锁），防止列表变化后写错行；脚本用临时文件 + rename 原子替换，失败回滚。
- `dailyType` 由后端自动推算并写入元数据，编辑时保持不变。
- 金币购买商品别名（`alias`）：只影响 NPC 菜单显示（`<别名/@buy1>`），`GOODS` 元组、扣金币、发放物品仍用真实物品名；别名 ≤20 字符，禁止控制字符与 `< > / @`；未配置时菜单显示物品名。前端货品行四列：物品名 / 别名 / 单价 / 删除。

## 7. API 速查（前缀分组）

- 基础：`/api/state/bootstrap`、`/api/state`、`/api/db`、`/api/db/save|references|delete`
- 爆率：`/api/drop`、`/api/drop/save|references|delete`
- 玩法基础：`/api/config/mongen|makeitem|appellation`（GET + `/save`）、`/api/npc|shops`、`/api/config/goods|summons|mall|mapinfo|ops|extra`
- NPC 工作台：`/api/config/npcwork`、`/detail`、`/script`、`/create/options|preview|create`、`/edit|edit/preview`
- 各工作台：`/api/config/itemdrop|spawns|maps|growth|shopwork|scriptwork|castlework|textwork|starterwork|healthwork|yswork|activity|tasks|task|task/options`
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
- API 直接用 `curl` 打 `/api/...`。
- UI 用无头 Chrome 或 CDP（Node 20 `--experimental-websocket` + `Runtime.evaluate` / `Page.captureScreenshot`）。快速截图示例：
  `chrome --headless=new --screenshot=D:/U2Server/Tools/DBEditor/.tmp-test/shot.png --window-size=1600,1200 http://127.0.0.1:8903/`
- 断言重点：生成文件为 GBK + 原换行 + 末尾换行；未改动行字节不变；备份数量/位置正确；元数据回填正确；非法输入返回 400；陈旧状态返回 409。
- **验证结束必须**：停测试服务、删除 `.tmp-test`、确认 `git status` 只有预期源码改动、确认真实 Envir 未被修改。

## 9. 常见坑

- 新前端文件忘了加 `STATIC` 或 `<script>` → 404 / 全局未定义。
- 写文件没用 `writeFileLines` / `backupFile` → 丢备份；用 UTF-8 写 → 游戏乱码。
- 解析后整体重新 join 输出 → 注释、空行、间距被改写，违反“未改动行逐字节一致”。
- 只 `invalidateState()` 没清工作台缓存 → 页面仍显示旧数据。
- 向导编辑时漏回填 ID / 脚本名 → 被后端身份锁 409 拒绝。
- 前端脚本顺序敏感：视图脚本依赖 `app.js` 的 `api()` / `toast` / `S`，必须排在后面。
- 菜单文字必须过滤 `< > / @`，否则破坏 `<文字/@函数>` 菜单语法。
- `.tmp-test/`、`备份/` 已在 `.gitignore`，不要提交；`.gitattributes` 的 `* -text` 防止 Git 改行尾，不要删。
- 改品牌名时涉及：向导生成脚本首行注释、`index.html` 标题与 logo、`server.js` 启动日志、`启动编辑器.bat` 标题。`public/growth.js` 里的「在 DB 编辑器中打开」指数据库页签，不是产品名。

## 10. 提交约定

- 只在用户明确说「提交代码」时提交；不要主动 push。
- 提交信息风格（Conventional Commits + 中文描述）：
  - `feat(npc): 向导脚本支持配置回填编辑与商品别名`
  - `fix: ...`
  - `chore: 项目更名为 U2Editor`
- 一次提交只包含本次需求的改动；测试脚本、截图、临时 Envir 不提交。

## 11. 改完配置如何在游戏里生效

本工具只负责改磁盘文件。要让 GameServer 读到新配置，需要在服务器侧重载/重启相应模块（NPC 脚本、NPCList 等通常重启 GameServer 或使用服务端提供的 GM 重载命令，具体以服务端版本为准）。工具不会、也不应直接操作正在运行的游戏进程。

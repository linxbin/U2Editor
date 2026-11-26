# U2Editor（传世 DB 编辑器）

一个纯本地的 Node.js Web 工具，用图形界面浏览、检查、编辑《传奇世界》1.9.6 服务端的 `GameServer/Envir` 配置。

- **纯本地离线**：只监听 `127.0.0.1`，不联网、不上传
- **零依赖**：没有 `package.json` / `node_modules`，只用 Node 内置模块
- **无构建**：原生 HTML/CSS/JS，由 `server.js` 直接托管
- **数据安全**：写入前自动备份，保留 GBK/GB2312 编码、原换行符与未改动行

## 功能

| 分区 | 内容 |
|---|---|
| 基础数据 / 数据库 | 直接浏览、修改、新增、删除 `DB/*.db` 记录，字段中文名对照 |
| 怪物 / 爆率 | 怪物属性、掉落文件可视化编辑与引用检查 |
| 地图 / 刷怪 | `MapInfo`、`Mongen.txt`、地图点位与刷怪配置 |
| NPC | NPC 列表、脚本编辑、脚本检索；「新建 NPC」向导支持购买、商店、仓库、修理、回收、技能、每日福利、合成、收费传送、多目标传送等模板，可合并为综合 NPC |
| 物品与经济 | 物品与掉落、合成配方、商城商品、新手礼包与充值配置 |
| 角色与成长 | 职业与技能、灵兽骑乘、元神相关配置 |
| 任务 / 活动 | 任务定义与批量维护、活动配置 |
| 文案 / 沙城 | 道具说明、公告、对话文本；沙巴克、攻城、行会与守卫配置 |
| GM 工作台 | 225 条 GM 命令目录（用法、说明、引擎级参数标注）、`GMCmd.txt` 白名单勾选保存、GM 名单与入口检查 |
| 配置体检 | 聚合各工作台的健康检查，定位缺失文件、悬空引用、未收录行等问题 |
| 备份与历史 | 扫描 `备份/`，查看文本/DB 差异并一键恢复（恢复前再备份当前文件） |

## 环境要求

- 从源码运行需要 **Node.js 18+**，且为带完整 ICU 的官方构建（需要 `TextDecoder('gbk')`）
- Windows（双击启动脚本）；其他平台可用 `node server.js` 启动
- 发布版（`dist/`）已内置绿色版 Node，买家无需安装任何环境

## 快速开始

1. 将本项目放在游戏根目录的 `Tools/DBEditor` 下（默认数据目录为 `../../GameServer/Envir`）。
2. 启动：

   ```bat
   启动编辑器.bat
   ```

   或：

   ```bash
   node server.js
   ```

3. 浏览器打开 `http://127.0.0.1:8866/`。
   默认端口 `8866`，被占用时自动 +1 重试（最多 10 次）；Windows 下启动后会自动打开浏览器。

### 环境变量

| 变量 | 作用 |
|---|---|
| `PORT` | 起始端口（默认 `8866`） |
| `DBEDITOR_ROOT` | 服务器根目录（默认 `Tools/DBEditor/../..`） |
| `DBEDITOR_ENVIR_DIR` | Envir 目录（默认 `<ROOT>/GameServer/Envir`） |
| `DBEDITOR_DB_DIR` | DB 目录（默认 `<ENVIR>/DB`） |
| `DBEDITOR_DROP_DIR` | 爆率目录（默认 `<ENVIR>/MonItems`） |
| `DBEDITOR_NO_OPEN` | 非空则启动时不打开浏览器 |

例如把数据目录指向一份副本：

```bash
DBEDITOR_ENVIR_DIR="D:/U2Server/GameServer/Envir-copy" node server.js
```

## 数据安全

- 每次写入前自动备份到目标文件同目录的 `备份/`，命名 `原名.YYYYMMDD-HHMMSS.bak`；内容未变化时不产生备份。
- 游戏文件一律按 GBK/GB2312 读写，保留原 CRLF/LF 与末尾换行，注释和未修改的行逐字节不变。
- 保存接口带内容一致性校验：页面数据过期时返回 409，避免覆盖他人的修改。
- 建议首次使用前自行整份备份 `GameServer/Envir`。

## 目录结构

```
server.js             唯一入口：路由分发、静态文件托管、各工作台组装
启动编辑器.bat        Windows 启动脚本
lib/                  后端：每类配置一个模块，统一导出 create(options)
public/               前端：index.html + 各视图脚本 + app.js 外壳 + styles.css
```

## 发布打包（混淆，可选）

给客户分发前可以把源码混淆，防止买家直接阅读/篡改代码：

```bash
cd build
npm install          # 首次需要,安装构建依赖
node build-dist.js   # 或 npm run build;--fast 出快速测试版
```

产物在 `dist/`：自带绿色版 Node（`node/node.exe`），买家解压后双击 `启动编辑器.bat` 即可使用，**无需安装 Node.js**。

注意：混淆只防「读懂/篡改源码」，**不能防止复制转卖**（复制文件不需要看懂代码）。

## 开发

开发约定、模块地图、数据文件清单、NPC 向导与生成脚本 DSL、API 速查见 [AGENTS.md](AGENTS.md)。

本地验证建议复制一份临时 Envir，并用环境变量指过去，不要直接对真实游戏数据做写入测试。

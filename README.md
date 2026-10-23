# 品牌营销中枢 · 本地开发与模拟环境

供团队在自己电脑上运行、实操和继续开发。包含中枢、创意、一创、二创混剪、素材库与审核、直播、学习、经营看板、数据中心、调度及相关存储服务的代码和启动材料。

默认使用本地最高权限身份，无需 OA 登录。数据库、对象存储、身份、飞书和部分 AI 接口在本地运行或模拟；不会复制生产账号和真实业务数据库。

## 首次启动

安装并启动 Docker Desktop（Windows／macOS 使用 Linux 容器），或 Docker Engine 与 Compose v2（Linux）。首次构建需要联网；Node、Python、FFmpeg、OCR 和数据库由镜像提供，电脑上无需分别安装。

1. 下载仓库并进入项目目录：

```sh
git clone https://github.com/gsy-fddm/brand_market_center.git
cd brand_market_center
```

2. 将根目录 `.env.example` 复制为 `.env`，填写自己电脑上空闲的 `HUB_PORT`，例如 `9000`。文件名不能是 `.env.txt`。

3. 生成本机配置。该步骤在 Docker 内执行，生成的密码和配置保存在被 Git 忽略的 `.local/`：

```sh
docker compose run --rm setup
```

4. 构建并启动完整环境。限制同时处理的服务数量，降低首次构建的资源占用：

```sh
docker compose -f .local/compose.yaml --parallel 1 up --build -d
```

数据库首次初始化后，业务服务按依赖顺序启动。`bootstrap` 和 `hub-ui-init` 是一次性初始化服务，完成后显示 `Exited (0)` 属于正常状态。

5. 打开 `http://127.0.0.1:你填写的端口/`，从中枢菜单进入模块。所有模块共用同一个浏览器入口。例如 `HUB_PORT=9000` 时访问 http://127.0.0.1:9000/ 。

完整环境包含多个业务服务和数据库，比仅二创版本占用更多内存；可以让 AI 根据电脑资源按需启动模块及其依赖，不要同时启动旧环境占用相同端口。

## 已经拉取过仓库的同事

```sh
git pull
docker compose run --rm setup
docker compose -f .local/compose.yaml --parallel 1 up --build -d
```

此次完整环境默认使用独立项目名 `brand-market-full`。原来的二创版本数据卷继续保留，不会自动导入完整环境。保留自己的 `.env`；新增参数可参考 `.env.example` 补充。旧配置中素材接口若仍是 `http://bridge:3000/api/remix-workstation`，改为本版默认的 `http://cloud:3000/api/remix-workstation`。

修改端口或配置后也执行上述 `setup` 和 `up` 两步；仅执行 `restart` 不会更新环境变量。

## 让 AI 帮助安装、更新或开发

可把下面这段话连同仓库地址发给 AI：

> 请按仓库 README 帮我安装或更新完整的本地中枢开发环境。先确认 Docker 可用，保留现有 .env 和数据，选择空闲端口，然后执行配置准备和完整环境的构建启动，告诉我实际访问地址。出错时先看日志定位，阅读 DEVELOPMENT.md 后在 services/ 中修改对应源码。不要删除 .local、数据卷，不要执行 down -v，不要接入真实生产账号或向外部平台发送消息。

AI 没有电脑操作权限时，让它根据操作系统逐步提供命令，并把完整报错交给它定位。

## 代码与功能范围

- 中枢界面及菜单、组织看板、LibTV 积分消耗和估算金额。
- 学习中心的课程、学员、管理授权、学习记录及对应界面。
- 素材库、审核中心、批量选择及相关命名提审等已有改动。
- 二创混剪工作区、素材拆解与切片、框架、成片和自动混剪。
- 直播的课程、助理评分、贡献值等已有功能源码。
- 一创、创意、经营情况总览、数据中心和调度的现有工程及运行文件。

入口和源码位置见 [DEVELOPMENT.md](DEVELOPMENT.md)。部分模块保留了现有界面运行产物，原始前端工程的可用情况也在开发说明中列明。

素材上传、文件保存、数据库读写、视频裁剪与合成使用本地实现。示例经营数据、LibTV 流水和助理评分为合成数据；AI／OCR／文案拆解的模拟范围以对应适配器为准，不能作为真实生成或审核结论。

一创本地任务适配器可生成合成测试视频；依赖 LibTV／Kling 的部分账号、素材准备和工具重试入口仍需相应工具及测试账号。真实投流、OA、飞书通知、外部采集和付费 AI 服务不因上传源码而自动可用，默认不启用对外写入。

## 日常启停与日志

以下命令在项目根目录运行：

```sh
docker compose -f .local/compose.yaml ps -a
docker compose -f .local/compose.yaml logs --tail=100
docker compose -f .local/compose.yaml stop
docker compose -f .local/compose.yaml up -d
```

只看某模块日志时，在 `logs` 后加服务名，例如 `cloud`、`remix`、`hub`、`learning-main` 或 `course-candidate`。

需要移除容器但保留数据时：

```sh
docker compose -f .local/compose.yaml down
```

不要添加 `-v`，也不要随意删除 `.local/`：数据卷保存素材、业务数据和任务，`.local/config/` 保存与该环境配套的密码和数据库身份绑定。它们都应在更新代码时保留。

## 连接配置

端口及服务连接选项在 `.env.example`；数据库与内部存储配置结构在 `local/config-templates/`。实际本机配置由 `setup` 生成到 `.local/config/`，不会提交仓库。

后续需要连接外部素材库时，参照 [库与连接配置](config/libraries.md)。默认本地模式只绑定 `127.0.0.1`，并以最高权限运行，请勿开放到公网。

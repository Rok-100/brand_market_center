# 品牌营销中枢 · 二创混剪本地版

以现有本地 8095 运行版本为取源基础，只接入二创混剪：混剪工作区和自动混剪，以及它们必需的素材输入、拆解、切片、框架、成片预览下载与持久化。

保留 8095 当前使用的中枢前端界面，其余模块不接业务，不启动对应服务。本地固定最高权限 FD-999999，无需 OA 登录；自动混剪管理员权限同时开启。

## 启动

需要 Docker Engine／Docker Desktop 和 Docker Compose v2。首次构建联网获取公开 Node 镜像、npm 依赖、FFmpeg、OCR 等工具；不需要原服务器业务镜像、宿主机 Python、数据库或真实凭据。

```sh
git clone https://github.com/gsy-fddm/brand_market_center.git
cd brand_market_center
docker compose up --build -d
```

访问 http://127.0.0.1:8095/ ，从保留的中枢界面点击“二创混剪”。

- 工作台：http://127.0.0.1:8095/yxb/wis-marketing-hub/modules/material-workbench/
- 本地素材输入：http://127.0.0.1:8095/local-input/input

若电脑已有环境占用 8095，请先协调端口；本次取源没有停止或替换原 8095 容器。

## 使用流程

1. 在“导入本地混剪素材”上传视频并填写产品分类，单文件上限 128 MiB。
2. 在工作台素材列表选择对应分类、导入视频，进行拆解、校准、切片和框架准备。
3. 在混剪工作区选取片段、组合并生成成片，预览或下载。
4. 在自动混剪中按已有流程配置分类、框架、时长、数量和执行设置。输入或框架不足时沿用实际业务校验提示，不返回固定成功。
5. 成片回传只保存到本地依赖服务，核对实际字节数／SHA-256，按幂等编号复用记录。真实平台投递不在范围内。

视频处理沿用 8095 工作台源码，实际执行 FFmpeg／ffprobe／OCR、组合生成、队列与文件保存。识别协议和可选视觉模型由本地适配器模拟，文案与模型结果带本地模拟标记，不代表真实语音识别或模型审核；请按真实素材填写台词。

不包含素材中心独立业务、人工审核中心、千川／ADQ／视频号投递、学习、直播、调度、经营分析、一创等后端。

## 目录

```text
compose.yaml                 三个服务的启动编排（JSON 格式，Compose 可直接读取）
gateway/hub/                 当前 8095 中枢静态前端
gateway/server.mjs           静态界面、最高权限会话与二创路由
gateway/local-shell.js       未接入模块的界面边界
remix/render-worker/         从 8095 二创容器提取的源码及工作台前端
remix/shared/                混剪共用逻辑
remix/local-support.mjs      二创所需的本地素材与外部协议适配
remix/local-workbench.js     本地输入入口与无关投递入口限制
remix/provenance.json        取源记录及接线前文件哈希
```

中枢与工作台前端沿用当前运行版本的静态产物，不重新编译这些前端，也不将其说成原始 React 源码。后端源码、共用逻辑、npm 锁文件、Dockerfile 及本地接线在本仓库维护。

## 数据与运行

只使用本项目的 remix-data、input-data 数据卷，不引用原 8095 的数据卷、生产挂载或 MySQL，不导入历史素材、用户记录或私密配置。识别和模型适配不下载模型权重，视频处理并发限制为 1。

```sh
docker compose logs -f remix
docker compose ps
docker compose stop
docker compose start
docker compose down
```

`down` 保留数据卷；添加 `-v` 会删除本项目本地数据。入口仅绑定 127.0.0.1:8095，服务使用内部网络；最高权限模式仅用于本地模拟，不应发布到公网。

本次读取了现有 8095 二创容器及前端挂载，执行源码提取、范围裁剪和独立编排。按用户要求，没有在本机进行构建、启动或功能验收。

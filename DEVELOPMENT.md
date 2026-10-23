# 开发说明

业务源码集中维护在 `services/`，共用存储代码位于 `shared/`，本地模拟适配位于 `local/`。修改源码后重新执行 README 的配置准备和构建启动步骤；不要仅修改容器内文件。

| 模块 | 开发位置 | 构建配方 |
| --- | --- | --- |
| 中枢、组织看板、LibTV | `services/hub/app/`，前端 `src/` | `build/dockerfiles/hub/Dockerfile` |
| 学习中心 | `services/learning/app/training/` | `build/dockerfiles/learning/Dockerfile` |
| 云管家、素材与审核 | `services/cloud/app/backend/app/`、`frontend/src/` | `build/dockerfiles/cloud/Dockerfile` |
| 二创、切片、框架、自动混剪 | `services/remix/app/render-worker/` | `build/dockerfiles/remix/Dockerfile` |
| 直播、课程、助理、贡献值 | `services/live/app/` | `build/dockerfiles/live/Dockerfile` |
| 一创 | `services/onecreation/app/app/` 及相邻工具代码 | `build/dockerfiles/onecreation/Dockerfile` |
| 创意 | `services/creative/app/` | `build/dockerfiles/creative/Dockerfile` |
| 经营情况总览 | `services/dashboard/app/` | `build/dockerfiles/dashboard/Dockerfile` |
| 数据中心 | `services/data-center/app/` | `build/dockerfiles/data-center/Dockerfile` |
| 调度 | `services/dispatch/app/` | `build/dockerfiles/dispatch/Dockerfile` |
| 存储网关 | `shared/storage-gateway/` | `build/dockerfiles/storage/Dockerfile` |

`local/compose.template.json` 是完整环境编排源，`local/prepare.py` 生成本机私密配置和 `.local/compose.yaml`。不要将生成的私密配置提交 Git，也不要只修改生成的 Compose 后宣称模板已更新。

`local/gateway.mjs` 负责统一菜单路由和本地身份透传；`local/learning-main.mjs` 同时承载中枢静态界面和学习接口。`hub-ui-init` 将本次构建的中枢界面复制到共享卷，所以重新构建可以将中枢源码改动交给主入口。

`local/bootstrap.py` 只针对随包的本地数据库初始化结构登记、合成示例和应用目录权限。数据库结构位于 `local/schema/`，数据库密码在准备阶段随机生成。禁止将这些模拟初始化脚本用于生产数据库。

## 前端工程与运行文件

中枢、学习和云管家保留可修改的界面源码。中枢镜像从 `src/` 构建界面；云管家默认保留现有 `frontend/dist/` 以运行当前界面，修改 Vue 源码后需在 `frontend/` 安装其锁定依赖并执行 `npm run build`，再重建镜像。可让 AI 在单独的 Node 容器内完成构建，电脑不必安装 Node。

二创保留完整工作台后端及当前 `client-dist/` 界面，未包含与该界面完全对应的原始前端构建工程。经营情况总览主要保留 `dist/` 和锁定依赖。创意与数据中心的部分运行适配也位于 `dist/`。这些运行文件不能当缓存删除，也不能据此把原始工程缺失的模块称为前端源码完整。

一创配套的部分 `assets/*-runtime` 同样是业务运行模块，需要保留。默认本地构建使用模拟任务适配器，没有将专有工具二进制或个人工具凭据放进仓库；接入真实工具需要另外提供工具和测试凭据。

## 交付范围

本包纳入当前本地已接入模块的已有代码及新增功能，配置准备与构建均不依赖特定电脑的绝对路径或预先存在的私有业务镜像。`source-map.json` 为目录索引，`local/source-assembly.json` 为源码组装来源记录。

不同模块的自动任务、真实账号授权和第三方服务需按本地模拟边界开发；源码存在不等于外部服务已配置。保持真实业务实现与模拟适配分离，不在正式业务分支中写固定成功响应来替代实际处理。

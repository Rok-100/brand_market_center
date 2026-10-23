# 库与连接配置

完整环境默认在本地启动 MySQL、PostgreSQL、Redis 和存储网关，密码由配置准备步骤随机生成。无需填写生产库账号。

| 配置位置 | 用途 |
| --- | --- |
| 根目录 `.env` | 浏览器端口、素材库 API、拆解与视觉服务、资源并发 |
| `local/config-templates/data-connection.json` | 存储网关 MySQL／Redis 连接结构 |
| `local/config-templates/cloud-mysql.json` | 素材后端 MySQL 与实例身份校验结构 |
| `local/config-templates/remix-metadata.json` | 二创元数据存储网关连接和作用域 |
| `local/config-templates/onecreation-*.json`、`live-*.json` | 一创、直播的元数据与 SQLite 兼容连接 |
| `.local/config/` | 当前电脑生成的真实本地配置，必须保留，不提交仓库 |

原片、切片、框架、成片和自动任务沿用现有业务存储结构。二创的受管 JSON 元数据经存储网关保存至本地 MySQL，媒体文件保存在 `remix-data` 卷的 `/data/clip-remix/sources`、`clips` 和 `outputs`；本地素材对象保存在对象存储服务的数据卷。

`REMIX_DATA_VOLUME` 和 `INPUT_DATA_VOLUME` 可以指定相应数据卷名；更改名称仅会切换到另一个卷，不会迁移旧数据。数据库卷、媒体卷与配套的 `.local/config/` 应一起备份。

## 后续连接现有素材库

修改 `.env` 中的 `WIS_MATERIAL_CENTER_BASE_URL` 和 `WIS_MATERIAL_CENTER_TOKEN`。令牌至少 32 字符，服务需兼容工作台 API，并提供：

- `GET /assets`、`GET /assets/{id}`：素材列表与详情。
- `POST /returns/presign`、`POST /returns/complete`：上传票据与成片回传。
- `GET /returns/{idempotency_key}` 及 `/feedback`：回传状态与反馈。

以上路径追加在服务基础地址后，以 `X-WIS-Workstation-Token` 鉴权。兼容旧二创素材的读取还会使用同站点 `/api/workstation/assets/{id}`。请求字段以 `services/remix/app/render-worker/material-center-client.mjs` 为准。下载及上传 URL 必须能从容器内访问。

默认接口为本地 `http://cloud:3000/api/remix-workstation`。切换外部素材服务只改变工作台导入／回传目标，不会自动迁移切片、框架和任务。中枢中的本地素材库菜单仍指向本地 cloud 服务，两者不会自动同步。

需要访问 Docker 网络以外的素材或模型服务时：

```sh
docker compose run --rm setup
docker compose -f .local/compose.yaml -f compose.connected.yaml --parallel 1 up --build -d
```

之后的管理命令保持同样的两个 `-f` 参数。Docker Desktop 宿主机服务通常通过 `host.docker.internal` 访问；容器内的 `127.0.0.1` 指容器自身。

`WIS_CUTTER_BASE_URL` 默认使用本地拆解模拟。`JUMP_LLM_*` 默认使用本地视觉模拟，协议及可选模型设置见 `.env.example`。远程服务需要可读取的视频或图片地址，不能直接读取本项目内部的对象服务域名。

直接替换数据库连接和使用远程素材 API 是不同的接入工作。初始化脚本只允许随包本地数据库；接入其他数据库前应单独核对表结构、权限、迁移和媒体存储，不能把本地模拟初始化脚本指向生产库。

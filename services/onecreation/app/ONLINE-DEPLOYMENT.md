# 品牌营销部工作站线上部署说明（代码基线 v2.11.39）

> 本文件记录现有服务器环境的部署参数，不代表线上实例已经同步到 v2.11.39。部署、代码合并和线上版本必须分别核验；线上实例可用后，以 `/api/ready` 与 `/api/app-meta` 返回结果为准。

- 访问路径：`/fd-026222/brand-marketing-workbench/`
- 主服务端口：由服务器空闲端口检测后写入 `.env`
- 明星画面服务端口：由服务器空闲端口检测后写入 `.env`
- 运行数据：全部挂载到 `runtime-data/`，重新构建镜像不会清空任务、上传文件或成片
- 敏感配置：`secrets/auth-config.json` 与服务器 `.env` 不进入 Docker 镜像
- LibTV：Linux 官方 CLI；每个工作台账号必须使用本人手机号和短信验证码授权，凭据分别保存在 `runtime-data/libtv/users/<匿名账号标识>/`，账号之间不可互相读取或使用
- 可灵：中国区官方 CLI，凭据保存在 `runtime-data/home/.kling/`
- 千川：使用公网 HTTPS 回调，令牌由服务器专用密钥加密
- 公司模型：每位用户使用本人 FanDo `openclaw.json` 导入授权；工作台按飞书账号加密隔离并自动换取短期 token

部署后可直接在工作台首页完成 LibTV 账号绑定；可灵账号仍需在服务器完成绑定。千川开放平台回调地址改为：

`https://app.fandow.top/fd-026222/brand-marketing-workbench/api/oauth/qianchuan/callback`

需要把整站源码安装到其他平台时，请使用 [整站源码交付与目标平台安装说明（v2.11.37）](docs/整站源码交付与目标平台安装说明-v2.11.37.md)，不要直接照搬本文件中的域名、路径、端口或回调地址。

# 品牌营销中枢 · 二创混剪本地版

供同事在自己电脑上进行二创混剪模拟和实操，包含混剪工作区、自动混剪，以及素材输入、拆解、切片、框架和成片预览下载。

打开后默认使用最高权限，无需 OA 账号或登录。中枢中只有“二创混剪”接入功能，其余菜单仅展示界面。

## 启动

先安装并启动 Docker Desktop（Windows／macOS），或安装 Docker Engine 和 Docker Compose v2（Linux）。Windows 使用 Linux 容器模式。

首次启动需要联网下载镜像及依赖。电脑上无需另装 Node、Python、FFmpeg、OCR 或数据库，也无需填写生产账号和密钥。

```sh
git clone https://github.com/gsy-fddm/brand_market_center.git
cd brand_market_center
docker compose up --build -d
```

命令执行完成后，访问 http://127.0.0.1:8095/ ，点击“二创混剪”。

- 工作台：http://127.0.0.1:8095/yxb/wis-marketing-hub/modules/material-workbench/
- 本地素材输入：http://127.0.0.1:8095/local-input/input

如果提示端口被占用，请先关闭占用 8095 端口的程序，再重新执行启动命令。

## 使用流程

1. 在“导入本地混剪素材”上传视频并填写产品分类，单文件上限 128 MiB。
2. 在工作台素材列表选择对应分类、导入视频，进行拆解、校准、切片和框架准备。
3. 在混剪工作区选取片段、组合并生成成片，预览或下载。
4. 在自动混剪中配置分类、框架、时长、数量和执行设置。若提示缺少素材或框架，请先补齐对应内容。
5. 生成后查看成片、预览并下载。成片回传保存在当前电脑，不会投递到真实广告或视频平台。

视频裁剪、组合与成片生成会实际处理上传的文件。识别文案和视觉模型结果使用带有“本地模拟”标记的样例，实操时请根据真实素材修改台词，不能把模拟结果作为真实识别或审核结论。

## 日常启停

以下命令均在克隆后的 `brand_market_center` 目录执行。

暂停使用：

```sh
docker compose stop
```

再次使用：

```sh
docker compose start
```

查看服务状态和处理日志：

```sh
docker compose logs -f remix
docker compose ps
```

如果服务启动失败，先查看 `docker compose ps`，再使用 `docker compose logs --tail=100` 查看错误信息。

## 更新版本

```sh
git pull
docker compose up --build -d
```

## 数据保存

素材、任务记录和成片保存在当前电脑的 Docker 数据卷中，停止或重启服务后仍然保留。首次使用需要自行上传素材。

需要移除容器时可执行：

```sh
docker compose down
```

该命令保留数据。**不要随意添加 `-v`，它会删除本项目的素材、任务和成片数据。**

本工具默认只允许当前电脑访问，所有功能以最高权限运行，请勿将其开放到公网。

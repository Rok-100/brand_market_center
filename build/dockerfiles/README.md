# 可审查的 Dockerfile

每个镜像的文件位于 `<服务>/Dockerfile`，共 20 个。来源是 tools/prepare.py 的统一配方；修改配方后执行 `python tools/export-dockerfiles.py`，流水线用 `--check` 拒绝不一致版本。source-refresh 任务复用 hub 镜像。

这些文件的 COPY 路径针对准备好的独立构建上下文，不是仓库根目录。请使用 `python tools/build.py ...` 或 `ci/build-images.sh`，它们会准备 app、storage、requirements 和已校验制品，再调用 Docker。

仅准备示例：`python tools/prepare.py hub --output-dir /tmp/brand-market-build`。输出路径中已有 Dockerfile，可对该路径执行 `docker build -t registry.example/project/hub:COMMIT_SHA 输出路径`。不要直接对源码根目录执行这些 Dockerfile，也不要把源码外的旧构建上下文上传 Git。

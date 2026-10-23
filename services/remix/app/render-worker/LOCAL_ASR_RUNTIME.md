# 后台本地 ASR 供给（候选，未部署）

本模块将现有 `local-asr-producer.py` 接入后台执行队列。它只产出真实语音、词级时间、原生音视频帧和可验证证据；不判断真实商品版本，不批准内容，不启动渲染、回传或投放。

## 服务端接线

```js
import {localAsrRunnerOptions} from './local-asr-config.mjs';
import {createLocalAsrRunner} from './local-asr-runner.mjs';

const runner = createLocalAsrRunner(localAsrRunnerOptions(process.env, {
  dataDirectory: actualPrivateDataDirectory,
  sourceRoots: [actualUploadDirectory],
}));
const result = await runner.ensureSourceEvidence({
  sourceId, productCategory, sourcePath, sourceSha256,
  skuVersion, skuBindingRevision,
  assertSourceCurrent: async binding => {
    // 重新读取服务端源记录、访问权限、正式 SKU/版本及版本依据指纹；
    // 与 binding 精确一致才返回 true。不能仅检查产品名称。
    return compareWithCurrentAuthorizedSource(binding);
  },
});
// 只有 result.status === 'completed' 时将 result.evidence 交给现有
// analyzeSource/verifyAsrBundle 流程。result.bundle 已经经过真实 consumer。
// 所有完成结果仍为 requiresReview:true、autoApproved:false。
```

不要把上述任一配置路径、回调、`dependencies` 测试注入项开放为 HTTP 请求字段。`skuBindingRevision` 应是正式版本/资料/图片绑定的稳定指纹；资料变化后不能借用旧语义审核。即使给源绑定了版本，也仍需后续真实语义和视觉审核。

返回状态：`disabled` 未启用；`busy` 有界队列满或跨进程锁占用，可由调度器稍后重试；`completed` 已验证且需审核；`failed` 明确失败、保留证据；`uncertain` 中断或子进程终止状态不明，先读回、不得盲目重跑。非法路径、缺失版本、访问权/CAS 改变、证据篡改等直接抛出具体错误。

## 配置与资源约束

- 默认 `WIS_LOCAL_ASR_RUNNER_ENABLED` 未配置/`0`/`false`：禁用，不启动 Python。
- 启用：`WIS_LOCAL_ASR_RUNNER_ENABLED=1`。
- `WIS_LOCAL_ASR_MODEL_DIRECTORIES`：已批准模型目录的 JSON 数组；必须包含完整 `config.json`、`model.bin`、`tokenizer.json`、`vocabulary.txt`，不能是符号链接。
- `WIS_LOCAL_ASR_VAD_MODEL_FILES`：已批准 Silero ONNX 文件的 JSON 数组。必须指向该 Python 环境实际使用的 VAD 文件；consumer 会核对实际文件 SHA。
- 允许列表多项时，显式指定 `WIS_LOCAL_ASR_RUNNER_MODEL_DIRECTORY` 和 `WIS_LOCAL_ASR_RUNNER_VAD_MODEL_FILE`。只有一项时选唯一项。
- Linux 默认解释器 `/opt/local-asr-venv/bin/python3`，ffmpeg `/usr/bin/ffmpeg`，ffprobe `/usr/bin/ffprobe`，prlimit `/usr/bin/prlimit`。可分别配置 `WIS_LOCAL_ASR_PYTHON_PATH`、`WIS_LOCAL_ASR_FFMPEG_PATH`、`WIS_LOCAL_ASR_FFPROBE_PATH`、`WIS_LOCAL_ASR_PRLIMIT_PATH`。Windows 必须显式指定前三个完整路径，不能使用 WindowsApps 的 Python 占位符。
- `WIS_LOCAL_ASR_RUNTIME_DIR` 默认是服务器 dataDirectory 下的 `local-asr-runtime`，不能经静态文件服务暴露。持久化、限制其他用户写权限，模型以只读挂载。
- `WIS_LOCAL_ASR_CPU_THREADS` 默认 2，范围 1–4；子进程 CPU/BLAS 线程数一同受限。server 还按实际容器 CPU 容量下调，并将 ASR 接入渲染/OCR 共用的 cpuGovernor；实际获得槽位后再做一次源/任务 CAS。
- `WIS_LOCAL_ASR_TIMEOUT_MS` 默认 900000，范围 1000–1800000；超时杀掉本次创建的进程组，终止未确认时保留全局锁。
- `WIS_LOCAL_ASR_MAX_PENDING` 默认 32，范围 1–64；每个进程有界队列，运行目录 `active.lock` 保证共享该目录的多个 worker 只运行一个识别子进程。
- `WIS_LOCAL_ASR_MAX_SOURCE_BYTES` 默认 512 MiB、最大 2 GiB；producer 另限制媒体时长最多 1 小时。
- `WIS_LOCAL_ASR_MEMORY_LIMIT_BYTES` 默认 8 GiB、范围 512 MiB–16 GiB。Linux prlimit 限制地址空间、CPU 时间、单输出文件 256 MiB、文件描述符 128；部署容器另配置 cgroup 内存/CPU/PID 上限，并限制证据卷磁盘容量。Windows 没有等价硬内存 cgroup 保证，不能用 Windows 单元测试代替 Linux 上限验收。
- 子进程不继承业务 API 密钥/代理/PYTHONPATH；只继承必要操作系统路径/临时目录/locale。强制离线、禁遥测、禁止用户 Python site。producer 始终 `local_files_only`，不得运行时下载模型。

## 镜像准备（未执行构建/安装）

`Dockerfile` 增加可选构建参数 `LOCAL_ASR_RUNTIME=true`，在镜像构建阶段创建 Python venv 并按 `requirements-local-asr.txt` 安装 faster-whisper 1.2.1、ctranslate2 4.8.2，执行 pip check。默认参数 false 保留现有 renderer。

模型权重不打包、不自动下载；由发布者单独准备已批准的完整模型目录，记录文件/镜像 SHA，再只读挂载。不要把当前 Windows VAD 文件路径直接搬到 Linux 配置；从候选镜像内部确认实际安装位置和 SHA。Python 3.11（bookworm）与依赖的 Linux ABI、实际推理和资源占用仍必须实测。

2026-10-03 只读检查：本机 Docker CLI 29.6.2 存在，`dockerDesktopLinuxEngine` 管道不存在，Linux daemon 不可用。本子任务没有启动 Docker、安装 Python 包、下载模型、修改生产或启用旧任务；不能标注镜像/生产已验收。

## 幂等、保留与恢复

操作键精确包含源 ID、分类、源绝对路径、源 SHA、正式版本、版本绑定修订、模型/真实 VAD/producer SHA 和 CPU 参数。不同版本/绑定修订不复用旧证据。生产源被修改、权限变更或绑定发生变化，提交前阻断。

`operations/<operationKey>/` 保留：请求绑定 `request.json`、producer 原始输出、进程返回与有界日志 `process.json`、私有 evidence manifest，以及 `completed.json` 或 `failure.json`。完成后重新经过真实 resolver 和 consumer，再写完成记录；服务重启只读回已完成同键证据，不再次识别。

不按时间偷锁，不覆盖失败目录，不通过删坏回执或清空原始结果来变成“完成”。崩溃、超时、子进程终止不明要人工/运维先核对对应 PID、原文件 SHA 和回执；确认没有存活子进程及业务变化后，另做显式恢复流程。当前模块没有偷偷自动删除锁/失败记录的入口，也不会把 `receipt.status=completed` 但未通过 consumer 的半成品认作成功。

## 已测与未测

- runner 编排、锁、幂等、资源参数、路径/版本/CAS 防护及真实 Node 子进程超时/日志限制：24 项通过。
- reader/runner 配置解析：28 项通过。
- 真正 r4 ASR 原始产物不可变回放进新 runner，再经真实 resolver/consumer，以及既有真实样本检验：2 项通过。识别回执任务 `cd705b4a-e1a1-48d5-9af5-890943cc6910`；26 段、328 词、2185 原生视频帧；仍需审核。
- 新 runner 回放测试用显式“隔离测试版本”检查绑定机制，不代表真实原片已完成版本判定；没有新推理调用，没有修改原文件或 r4 回执。
- 实际 server 预览/迁移只读模式：2 项通过；即使继承 ASR_ENABLED=1 与无效运行路径，仍拒绝写请求且不创建数据目录。初次 Windows 测试清理因先删子进程 cwd 触发 EBUSY，已更正为先关闭隔离测试服务器，再删除其临时目录，不属于生产业务问题。
- 尚未验证：Linux 镜像/依赖、生产 worker 发布、真实 SKU 样本分类、线上连续 ASR→审核→混剪→云管家→千川。以上不得用本地 56 项测试替代。

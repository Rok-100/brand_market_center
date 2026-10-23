"use strict";

const DEFAULT_COMPLIANCE_RETRY_DELAYS_MS = Object.freeze([20_000, 40_000, 80_000]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));
}

function combinedResultText(result) {
  return `${String(result?.stdout || "")}\n${String(result?.stderr || "")}`.trim();
}

function isVariationCompliancePending(value) {
  const text = typeof value === "string" ? value : combinedResultText(value);
  return /(?:\b10026\b|当前素材检测提交较频繁|检测提交较频繁|合规(?:检测|审查|审核|复核).{0,16}(?:中|未完成|等待|排队|处理中)|素材.{0,12}(?:审核|检测).{0,12}(?:中|未完成|等待|排队|处理中)|(?:图片|视频|音频|素材).{0,18}未通过.{0,12}合规检测|完成合规资产录入|compliance.{0,20}(?:pending|review|processing)|review.{0,20}(?:pending|processing)|too many requests)/i.test(text);
}

function conciseVariationComplianceError(value, fallback = "LibTV生成暂未完成") {
  const text = typeof value === "string" ? value : combinedResultText(value);
  if (isVariationCompliancePending(text)) {
    return "素材已自动提交合规审查，系统会按安全频率继续检查，无需重新上传或重新创建任务。";
  }
  if (/未登录|unauthorized|\b401\b/i.test(text)) return "LibTV登录已失效，请重新登录后继续本条任务。";
  if (/余额|灵感值|insufficient|quota/i.test(text)) return "当前生成余额不足，请切换可用团队空间或补充余额后继续。";
  if (/图片.*(?:像素|上限)|image.*(?:pixel|limit)/i.test(text)) return "参考图片尺寸不符合模型要求，请重新处理图片后重试本条。";
  const lastUsefulLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:at\s|node:internal|Require stack:|ffmpeg version)/i.test(line))
    .at(-1);
  return String(lastUsefulLine || fallback).slice(0, 360);
}

class ComplianceRateLimiter {
  constructor(options = {}) {
    this.maxInWindow = Math.max(1, Number(options.maxInWindow || 12));
    this.windowMs = Math.max(1, Number(options.windowMs || 60_000));
    this.minIntervalMs = Math.max(0, Number(options.minIntervalMs ?? 5_000));
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.sleep = typeof options.sleep === "function" ? options.sleep : wait;
    this.timestamps = [];
    this.tail = Promise.resolve();
  }

  async reserve() {
    const execute = async () => {
      while (true) {
        const current = Number(this.now());
        this.timestamps = this.timestamps.filter((timestamp) => current - timestamp < this.windowMs);
        const sinceLast = this.timestamps.length ? current - this.timestamps.at(-1) : Infinity;
        const spacingWait = Math.max(0, this.minIntervalMs - sinceLast);
        const windowWait = this.timestamps.length >= this.maxInWindow
          ? Math.max(0, this.windowMs - (current - this.timestamps[0]))
          : 0;
        const delay = Math.max(spacingWait, windowWait);
        if (delay > 0) {
          await this.sleep(delay);
          continue;
        }
        const reservedAt = Number(this.now());
        this.timestamps = this.timestamps.filter((timestamp) => reservedAt - timestamp < this.windowMs);
        this.timestamps.push(reservedAt);
        return reservedAt;
      }
    };
    const reservation = this.tail.then(execute, execute);
    this.tail = reservation.then(() => undefined, () => undefined);
    return reservation;
  }

  async schedule(callback) {
    const reservedAt = await this.reserve();
    return callback(reservedAt);
  }
}

class SingleFlight {
  constructor() {
    this.inFlight = new Map();
  }

  has(key) {
    return this.inFlight.has(String(key));
  }

  run(key, callback) {
    const normalizedKey = String(key);
    const existing = this.inFlight.get(normalizedKey);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(callback)
      .finally(() => {
        if (this.inFlight.get(normalizedKey) === promise) this.inFlight.delete(normalizedKey);
      });
    this.inFlight.set(normalizedKey, promise);
    return promise;
  }
}

class VariationComplianceDeferredError extends Error {
  constructor(message, details = {}) {
    super(message || "素材合规审查仍在处理中");
    this.name = "VariationComplianceDeferredError";
    this.code = "VARIATION_COMPLIANCE_DEFERRED";
    this.details = details;
  }
}

function selectVariationComplianceRetry(tasks, taskId) {
  const task = (Array.isArray(tasks) ? tasks : []).find((item) => String(item?.id || "") === String(taskId || ""));
  if (!task) return { task: null, segments: [] };
  const segments = (Array.isArray(task.segments) ? task.segments : []).filter((segment) => {
    const status = String(segment?.status || "");
    return ["compliance_pending", "compliance_deferred"].includes(status)
      || (status === "failed" && isVariationCompliancePending(segment?.error || ""));
  });
  return { task, segments };
}

function findVariationComplianceNode(reference, nodes) {
  if (!reference || !Array.isArray(nodes)) return null;
  const expectedKey = String(reference.nodeKey || reference.id || "").trim();
  const expectedName = String(reference.nodeName || reference.name || "").trim();
  return nodes.find((node) => {
    const keys = [node?.id, node?.nodeKey, node?.key, node?.newNodeKey]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const names = [node?.name, node?.nodeName, node?.label]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return Boolean(
      (expectedKey && keys.includes(expectedKey))
      || (expectedName && names.includes(expectedName))
    );
  }) || null;
}

function recoverPersistedVariationCompliance(job, options = {}) {
  if (!job || String(job.workflow || "") !== "variation") {
    return { changed: false, deferredTasks: 0, interruptedTasks: 0 };
  }
  const recoveredAt = new Date(Number(options.now || Date.now())).toISOString();
  const wasActive = ["queued", "preparing", "running"].includes(String(job.status || ""));
  let changed = false;
  let deferredTasks = 0;
  let interruptedTasks = 0;

  for (const task of Array.isArray(job.tasks) ? job.tasks : []) {
    if (task.complianceResumeLease) {
      task.complianceResumeLease = null;
      changed = true;
    }
    let hasDeferredSegment = false;
    for (const segment of Array.isArray(task.segments) ? task.segments : []) {
      const compliance = segment.compliance && typeof segment.compliance === "object"
        ? segment.compliance
        : null;
      if (compliance?.lease) {
        compliance.lease = null;
        changed = true;
      }
      const segmentStatus = String(segment.status || "");
      const complianceState = String(compliance?.state || "");
      const wasAwaitingCompliance = [
        "compliance_queued",
        "compliance_pending",
        "compliance_deferred"
      ].includes(segmentStatus) || [
        "queued",
        "submitted",
        "pending",
        "deferred"
      ].includes(complianceState);
      if (!wasAwaitingCompliance) continue;
      segment.status = "compliance_deferred";
      segment.error = "本地服务重启前素材仍在合规审查；节点记录已保留，可继续同一节点审查。";
      segment.compliance = {
        ...(compliance || {}),
        state: "deferred",
        recoveredAt,
        lease: null
      };
      hasDeferredSegment = true;
      changed = true;
    }
    if (hasDeferredSegment) {
      task.status = "compliance_deferred";
      task.error = "本地服务重启前素材仍在合规审查；可点击“继续合规审查”。";
      deferredTasks += 1;
      changed = true;
    } else if (wasActive && ["queued", "running", "quality_checking", "preview_ready"].includes(String(task.status || ""))) {
      task.status = "interrupted";
      task.error = "本地服务上次运行时中断，请重新生成本条。";
      interruptedTasks += 1;
      changed = true;
    }
  }

  if (changed && wasActive) {
    const planned = (Array.isArray(job.tasks) ? job.tasks : []).filter((task) => task.selected !== false);
    const ready = planned.filter((task) => Boolean(task.localPath)).length;
    job.status = ready > 0
      ? "partial"
      : deferredTasks > 0
        ? "compliance_deferred"
        : "interrupted";
    job.error = "";
    job.actionRequired = deferredTasks > 0
      ? `服务已恢复${deferredTasks}条待审任务；可逐条点击“继续合规审查”，不会重复上传。`
      : "本地服务上次运行时中断，请重新生成未完成任务。";
  }

  return { changed, deferredTasks, interruptedTasks };
}

async function runComplianceReviewedNode(options = {}) {
  const {
    existingNode = null,
    createNode,
    runNode,
    extractOutput = () => "",
    limiter = new ComplianceRateLimiter(),
    sleep = wait,
    retryDelaysMs = DEFAULT_COMPLIANCE_RETRY_DELAYS_MS,
    onNodeCreated = async () => {},
    onAttempt = async () => {},
    onPending = async () => {}
  } = options;
  if (typeof createNode !== "function") throw new TypeError("createNode必须是函数");
  if (typeof runNode !== "function") throw new TypeError("runNode必须是函数");

  let node = existingNode;
  let created = false;
  if (!node?.nodeName && !node?.nodeKey) {
    node = await createNode();
    created = true;
    await onNodeCreated(node);
  }

  const delays = Array.isArray(retryDelaysMs) ? retryDelaysMs.map(Number).filter((value) => value >= 0) : [];
  for (let attemptIndex = 0; attemptIndex <= delays.length; attemptIndex += 1) {
    const result = await limiter.schedule(() => runNode(node, attemptIndex + 1));
    const output = extractOutput(result);
    const pending = isVariationCompliancePending(result);
    await onAttempt({
      attempt: attemptIndex + 1,
      created,
      node,
      result,
      output,
      pending
    });
    if (Number(result?.code) === 0 && output) {
      return { node, result, output, attempts: attemptIndex + 1, created };
    }
    if (!pending) {
      const error = new Error(conciseVariationComplianceError(result));
      error.code = "VARIATION_GENERATION_FAILED";
      error.result = result;
      error.node = node;
      throw error;
    }
    if (attemptIndex < delays.length) {
      const delayMs = delays[attemptIndex];
      await onPending({ attempt: attemptIndex + 1, delayMs, node, result });
      await sleep(delayMs);
    }
  }

  throw new VariationComplianceDeferredError(
    "素材合规审查仍在处理中，系统已保留当前节点；可稍后点击“继续合规审查”，不会重建节点或重复上传。",
    { node }
  );
}

module.exports = {
  DEFAULT_COMPLIANCE_RETRY_DELAYS_MS,
  ComplianceRateLimiter,
  SingleFlight,
  VariationComplianceDeferredError,
  combinedResultText,
  conciseVariationComplianceError,
  findVariationComplianceNode,
  isVariationCompliancePending,
  recoverPersistedVariationCompliance,
  runComplianceReviewedNode,
  selectVariationComplianceRetry
};

"use strict";

// Runtime copy lives under assets so v2.4.11 update clients also install it.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { spawn, spawnSync } = require("child_process");

const REMIX_SCHEMA_VERSION = 1;
const REMIX_SEGMENTATION_VERSION = 6;
const AUDIO_MODES = new Set(["voice_priority", "mute", "original"]);
const VALID_STAGES = new Set(["hook", "problem", "product", "proof", "cta", "ending"]);
const STAGE_LABELS = {
  hook: "开头钩子",
  problem: "人群/痛点",
  product: "产品/方案",
  proof: "使用/证据",
  cta: "行动引导",
  ending: "结尾落版"
};

const SOURCE_DOCS = {
  eye: {
    url: "https://jqx28l0j4lx.feishu.cn/wiki/AcrLwEig1iokfCk9P2gcbGg8nJh?from=from_copylink",
    title: "2026Q1-Q2眼膜有效素材top20",
    productId: "wis-crystal-firming-eye-mask",
    productName: "WIS晶润紧致眼膜",
    prefix: "eye-current"
  },
  hydra: {
    url: "https://jqx28l0j4lx.feishu.cn/wiki/RQsGwCWG0ioWmZk1G4Cc0iLGnVe?from=from_copylink",
    title: "水润面膜跑量素材TOP30(2026.04至今)",
    productId: "wis-hydra-peptide-mask",
    productName: "WIS隐形水润面膜（水光肽）",
    prefix: "hydra-top"
  }
};

const FRAMEWORKS = [
  {
    id: "pain-solution-proof",
    name: "痛点—方案—证据",
    description: "先建立目标人群与问题，再给产品方案、使用证据和行动引导。",
    stages: ["hook", "problem", "product", "proof", "cta"]
  },
  {
    id: "product-demo",
    name: "钩子—产品演示",
    description: "开头快速抓人，连续展示产品、使用动作和结果证据。",
    stages: ["hook", "product", "product", "proof", "cta"]
  },
  {
    id: "trust-story",
    name: "真实体验—信任收口",
    description: "用问题与体验建立信任，随后露出产品并自然收口。",
    stages: ["hook", "problem", "proof", "product", "cta"]
  }
];

const KNOWLEDGE_STAGE_MAP = {
  L1: ["hook", "problem", "proof", "product", "cta"],
  S1: ["hook", "problem", "product", "proof", "cta"],
  C1: ["hook", "problem", "product", "proof", "cta"],
  T1: ["hook", "proof", "product", "cta"],
  R1: ["hook", "product", "proof", "cta"],
  E1: ["problem", "product", "proof", "cta"],
  O1: ["hook", "product", "cta"],
  D1: ["hook", "problem", "product", "cta"],
  H1: ["hook", "proof", "product", "cta"],
  P1: ["hook", "product", "proof", "cta"],
  A1: ["hook", "problem", "product", "cta"]
};

function nowIso() {
  return new Date().toISOString();
}

function safeName(value, fallback = "素材") {
  const text = String(value || "").trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ");
  return (text || fallback).slice(0, 90);
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseAttrs(tag) {
  const attrs = {};
  for (const match of String(tag || "").matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1]] = match[2];
  return attrs;
}

function sourceFromXmlTag(tag) {
  const attrs = parseAttrs(tag);
  if (!String(attrs.mime || "").startsWith("video/") || !attrs.token) return null;
  return {
    token: attrs.token,
    mime: attrs.mime,
    size: Number(attrs.size || 0),
    width: Number(attrs["origin-width"] || attrs.width || 0),
    height: Number(attrs["origin-height"] || attrs.height || 0)
  };
}

function extractVideoSources(xml) {
  return Array.from(String(xml || "").matchAll(/<source\b[^>]*\/>/g))
    .map((match) => sourceFromXmlTag(match[0]))
    .filter(Boolean);
}

function buildSourceEntry(source, doc, rank, options = {}) {
  const id = `${doc.prefix}-${String(rank).padStart(2, "0")}`;
  return {
    id,
    token: source.token,
    mime: source.mime,
    declaredBytes: source.size,
    declaredWidth: source.width,
    declaredHeight: source.height,
    sourceDocTitle: doc.title,
    sourceDocUrl: doc.url,
    sourceSection: options.section || "",
    rank,
    productId: doc.productId,
    productName: doc.productName,
    effectiveLabel: "历史有效成片",
    approvalRisk: options.approvalRisk || "low",
    selectedForInitial: options.selectedForInitial !== false,
    status: "pending",
    error: "",
    clips: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function parseEyeDocument(xml) {
  const marker = "目前在投top20";
  const markerIndex = String(xml || "").indexOf(marker);
  if (markerIndex < 0) throw new Error("眼膜文档中没有找到“目前在投top20”分组");
  const historicalSources = extractVideoSources(String(xml).slice(0, markerIndex));
  const currentSources = extractVideoSources(String(xml).slice(markerIndex));
  if (currentSources.length < 20) throw new Error(`眼膜当前在投分组只识别到 ${currentSources.length} 条视频，预期至少20条`);
  return {
    selected: currentSources.slice(0, 20).map((source, index) => buildSourceEntry(source, SOURCE_DOCS.eye, index + 1, {
      section: "目前在投top20（卡审风险小）",
      approvalRisk: "low"
    })),
    excluded: historicalSources.slice(0, 20).map((source, index) => buildSourceEntry(source, {
      ...SOURCE_DOCS.eye,
      prefix: "eye-history"
    }, index + 1, {
      section: "历史过往top20（卡审风险较大）",
      approvalRisk: "high",
      selectedForInitial: false
    }))
  };
}

function parseHydraDocument(xml) {
  const rows = Array.from(String(xml || "").matchAll(/<tr>([\s\S]*?)<\/tr>/g));
  const entries = [];
  for (const row of rows) {
    const rankMatch = row[1].match(/<p[^>]*>(\d+)<\/p>/);
    const sourceTag = row[1].match(/<source\b[^>]*\/>/)?.[0] || "";
    const source = sourceFromXmlTag(sourceTag);
    if (!source) continue;
    const rank = Number(rankMatch?.[1] || entries.length + 1);
    entries.push(buildSourceEntry(source, SOURCE_DOCS.hydra, rank, {
      section: "跑量素材TOP30",
      approvalRisk: "low"
    }));
  }
  if (entries.length < 30) throw new Error(`水润面膜文档只识别到 ${entries.length} 条视频，预期30条`);
  return entries.slice(0, 30);
}

function parseFeishuLibrary(eyeXml, hydraXml) {
  const eye = parseEyeDocument(eyeXml);
  const hydra = parseHydraDocument(hydraXml);
  const selected = [...eye.selected, ...hydra];
  if (selected.length !== 50) throw new Error(`初版素材数为 ${selected.length}，不是预期的50条`);
  return { selected, excluded: eye.excluded };
}

function parseFfmpegOptionNames(output) {
  return new Set(Array.from(
    String(output || "").matchAll(/^\s*-([a-z0-9_]+)(?=$|\s|\[|:|=)/gim),
    (match) => match[1].toLowerCase()
  ));
}

function selectFrameSyncArgs(optionNames) {
  const names = optionNames instanceof Set
    ? optionNames
    : new Set(Array.from(optionNames || [], (name) => String(name || "").replace(/^-+/, "").toLowerCase()));
  if (names.has("fps_mode")) return ["-fps_mode", "cfr"];
  if (names.has("vsync")) return ["-vsync", "cfr"];
  return [];
}

function runProcess(binary, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) }
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      options.onStdout?.(chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      options.onStderr?.(chunk.toString("utf8"));
    });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() }));
    child.on("close", (code) => resolve({ code: Number(code ?? 1), stdout, stderr }));
  });
}

function downloadHttpFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("素材下载重定向次数过多"));
    const target = new URL(String(url || ""));
    const client = target.protocol === "http:" ? http : https;
    const request = client.get(target, {
      headers: { "User-Agent": "BrandMarketingWorkbench/2.7" }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, target).toString();
        downloadHttpFile(next, destination, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`素材下载失败：HTTP ${response.statusCode}`));
        return;
      }
      fsp.mkdir(path.dirname(destination), { recursive: true }).then(() => {
        const stream = fs.createWriteStream(destination);
        response.pipe(stream);
        stream.on("finish", () => stream.close(resolve));
        stream.on("error", reject);
      }, reject);
    });
    request.on("error", reject);
    request.setTimeout(60000, () => request.destroy(new Error("素材下载超时")));
  });
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fsp.rename(temporary, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code)) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(300, 40 + attempt * 20)));
    }
  }
  await fsp.unlink(temporary).catch(() => {});
  throw lastError || new Error("状态文件写入失败");
}

function parseCliJson(text) {
  const source = String(text || "").trim().replace(/^\uFEFF/, "");
  try {
    return JSON.parse(source);
  } catch {
    const first = source.indexOf("{");
    const last = source.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(source.slice(first, last + 1));
    throw new Error("命令没有返回可解析的JSON");
  }
}

function defaultState(rootDir) {
  return {
    schemaVersion: REMIX_SCHEMA_VERSION,
    rootDir,
    selectedRule: "眼膜当前在投20条 + 水润面膜TOP30",
    sourceDocuments: Object.values(SOURCE_DOCS).map(({ url, title, productId, productName }) => ({ url, title, productId, productName })),
    items: [],
    excludedItems: [],
    plans: [],
    importJob: { status: "idle", current: 0, total: 50, percent: 0, message: "尚未导入", error: "" },
    analysisJob: {
      status: "idle", current: 0, total: 0, percent: 0,
      succeeded: 0, failed: 0, phase: "idle", currentItem: "",
      message: "尚未运行AI理解", error: ""
    },
    composeJobs: [],
    outputVariants: [],
    deletedComposeJobs: [],
    updatedAt: nowIso()
  };
}

function durationStage(index, total, midpointRatio) {
  if (index === 0) return "hook";
  if (index === total - 1) return "ending";
  if (midpointRatio < 0.30) return "problem";
  if (midpointRatio < 0.58) return "product";
  if (midpointRatio < 0.82) return "proof";
  return "cta";
}

function buildIntervals(duration, sceneCuts, options = {}) {
  const minClip = Number(options.minClip || 3.5);
  const maxClip = Number(options.maxClip || 6);
  const requestedProtectedMax = Number(options.protectedMaxClip);
  const protectedMaxClip = Number.isFinite(requestedProtectedMax)
    ? Math.max(maxClip, requestedProtectedMax)
    : Number.POSITIVE_INFINITY;
  const targetClip = Number(options.targetClip || 5);
  const hardMin = Math.min(minClip, Number(options.hardMin || 3));
  const totalDuration = Number(duration);
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return [];
  if (totalDuration <= maxClip) {
    return [{ start: 0, end: Number(totalDuration.toFixed(3)), duration: Number(totalDuration.toFixed(3)) }]
      .filter((item) => item.duration >= 0.4);
  }
  const cleanCuts = Array.from(new Set((sceneCuts || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0 && value < totalDuration)
    .map((value) => Number(value.toFixed(3)))))
    .sort((a, b) => a - b);
  const preferredCuts = Array.from(new Set((options.preferredCuts || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0 && value < totalDuration)
    .map((value) => Number(value.toFixed(3)))))
    .sort((a, b) => a - b);
  const silenceCuts = Array.from(new Set((options.silenceCuts || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0 && value < totalDuration)
    .map((value) => Number(value.toFixed(3)))))
    .sort((a, b) => a - b);
  const protectedRanges = (options.protectedRanges || [])
    .map((range) => ({
      start: Number(Number(range?.start || 0).toFixed(3)),
      end: Number(Number(range?.end || 0).toFixed(3))
    }))
    .filter((range) => (
      Number.isFinite(range.start)
      && Number.isFinite(range.end)
      && range.start >= 0
      && range.end <= totalDuration + 0.001
      && range.end > range.start
      && range.end - range.start <= protectedMaxClip + 0.001
    ))
    .sort((a, b) => a.start - b.start);
  const points = [0];
  let cursor = 0;
  while (
    totalDuration - cursor > maxClip
    || preferredCuts.some((cut) => cut >= cursor + hardMin && totalDuration - cut >= hardMin)
  ) {
    const remaining = totalDuration - cursor;
    const protectedRange = protectedRanges.find((range) => (
      Math.abs(range.start - cursor) <= 0.12
      && range.end - cursor > maxClip
      && range.end - cursor <= protectedMaxClip + 0.001
    ));
    if (protectedRange) {
      const protectedEnd = Number(protectedRange.end.toFixed(3));
      points.push(protectedEnd);
      cursor = protectedEnd;
      continue;
    }
    const softLower = cursor + minClip;
    const hardLower = cursor + hardMin;
    const upper = Math.min(cursor + maxClip, totalDuration - hardMin);
    const lower = softLower <= upper ? softLower : hardLower;
    const desired = Math.min(cursor + targetClip, upper);
    const candidates = [
      ...preferredCuts.filter((cut) => cut >= lower && cut <= upper).map((cut) => ({ cut, priority: 0 })),
      ...silenceCuts.filter((cut) => cut >= lower && cut <= upper).map((cut) => ({ cut, priority: 1 })),
      ...cleanCuts.filter((cut) => cut >= lower && cut <= upper).map((cut) => ({ cut, priority: 2 }))
    ].sort((a, b) => a.priority - b.priority || Math.abs(a.cut - desired) - Math.abs(b.cut - desired));
    const next = candidates.length ? candidates[0].cut : Math.max(lower, desired);
    const rounded = Number(next.toFixed(3));
    if (rounded <= cursor || remaining - (rounded - cursor) < hardMin - 0.001) break;
    points.push(rounded);
    cursor = rounded;
  }
  const roundedTotal = Number(totalDuration.toFixed(3));
  if (Math.abs((points.at(-1) || 0) - roundedTotal) > 0.001) points.push(roundedTotal);
  return points.slice(0, -1).map((start, index) => ({
    start,
    end: points[index + 1],
    duration: Number((points[index + 1] - start).toFixed(3)),
    protectedSemantic: protectedRanges.some((range) => (
      Math.abs(range.start - start) <= 0.12
      && Math.abs(range.end - points[index + 1]) <= 0.12
    ))
  })).filter((item) => item.duration >= 0.4);
}

function inheritClipReview(previousClips, clip) {
  const previous = Array.isArray(previousClips) ? previousClips : [];
  const exact = previous.find((item) => (
    Math.abs(Number(item.start || 0) - Number(clip.start || 0)) <= 0.12
    && Math.abs(Number(item.end || 0) - Number(clip.end || 0)) <= 0.12
  ));
  if (exact) {
    clip.approved = exact.approved === true;
    clip.reviewRequired = clip.approved !== true;
    if (exact.labelSource === "human_review" || exact.approved === true) {
      if (VALID_STAGES.has(exact.stage)) {
        clip.stage = exact.stage;
        clip.stageLabel = STAGE_LABELS[exact.stage];
      }
      clip.visualType = String(exact.visualType || clip.visualType || "");
      clip.transcript = String(exact.transcript || clip.transcript || "");
      clip.notes = String(exact.notes || "");
      clip.labelSource = "human_review";
      clip.confidence = 1;
    }
    return clip;
  }
  const overlapping = previous.filter((item) => (
    Math.max(Number(item.start || 0), Number(clip.start || 0))
      < Math.min(Number(item.end || 0), Number(clip.end || 0)) - 0.05
  ));
  if (overlapping.length > 1 && overlapping.every((item) => item.approved === true)) {
    clip.approved = true;
    clip.reviewRequired = false;
    clip.labelSource = "human_review";
    clip.confidence = 1;
  }
  return clip;
}

function clipMatchesStage(clip, stage) {
  if (clip.stage === stage) return true;
  const fallback = {
    hook: ["problem"],
    problem: ["hook", "proof"],
    product: ["proof"],
    proof: ["product", "problem"],
    cta: ["ending", "proof"],
    ending: ["cta"]
  };
  return (fallback[stage] || []).includes(clip.stage);
}

function validatePlan(plan) {
  const clips = Array.isArray(plan?.clips) ? plan.clips : [];
  if (!clips.length) throw new Error("编排计划没有片段");
  const warnings = [];
  const products = new Set(clips.map((clip) => clip.productId));
  if (products.size !== 1) warnings.push("当前方案包含多个产品，请人工确认是否符合本条目标");
  if (clips[0].stage !== "hook") warnings.push("第一段不是开头钩子");
  if (!["cta", "ending"].includes(clips.at(-1).stage)) warnings.push("最后一段不是行动引导或结尾落版");
  const middleEnding = clips.slice(0, -1).find((clip) => clip.stage === "ending");
  if (middleEnding) warnings.push("视频中间包含结尾落版");
  const firstProduct = clips.findIndex((clip) => clip.stage === "product");
  const firstProblem = clips.findIndex((clip) => clip.stage === "problem");
  if (firstProduct >= 0 && firstProblem > firstProduct) warnings.push("痛点片段排在产品方案之后");
  const firstCta = clips.findIndex((clip) => ["cta", "ending"].includes(clip.stage));
  if (firstCta >= 0 && firstCta < Math.max(1, clips.length - 2)) warnings.push("行动引导出现在主体内容之前");
  return warnings;
}

function expandStageSequence(framework, targetDuration, averageDuration = 4) {
  const stages = [...framework.stages];
  const desiredCount = Math.max(stages.length, Math.min(16, Math.ceil(targetDuration / Math.max(2, averageDuration))));
  const repeatable = ["product", "proof"];
  let cursor = 0;
  while (stages.length < desiredCount) {
    const insertBefore = Math.max(2, stages.length - 1);
    stages.splice(insertBefore, 0, repeatable[cursor % repeatable.length]);
    cursor += 1;
  }
  return stages;
}

function createRemixEngine(options = {}) {
  const appRoot = path.resolve(options.appRoot || __dirname);
  const preferredRoot = process.platform === "win32" && fs.existsSync("H:\\")
    ? "H:\\codex输出\\AI智能混剪"
    : path.join(appRoot, "remix-data");
  const rootDir = path.resolve(process.env.AI_REMIX_DATA_DIR || options.rootDir || preferredRoot);
  const manifestPath = path.join(rootDir, "library.json");
  const sharedClipCachePath = path.join(appRoot, "assets", "remix-engine-runtime", "shared-clips-cache.json");
  let ffmpeg = options.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
  let ffprobe = options.ffprobe || process.env.FFPROBE_PATH || "ffprobe";
  let ffmpegFilterNames = null;
  let ffmpegOptionNames = null;
  const larkCliDisabled = options.larkCli === false;
  const larkCliCandidates = larkCliDisabled ? [] : [
    options.larkCli,
    process.env.LARK_CLI_PATH,
    path.join(appRoot, "..", "tools", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli"),
    process.platform === "win32" && process.env.APPDATA
      ? path.join(process.env.APPDATA, "npm", "lark-cli.cmd")
      : ""
  ].filter(Boolean);
  const installedLarkCli = larkCliCandidates.find((candidate) => (
    path.isAbsolute(candidate) && fs.existsSync(candidate)
  ));
  const pathLarkCli = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli";
  const pathLookup = larkCliDisabled ? null : spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [pathLarkCli],
    { windowsHide: true, stdio: "ignore" }
  );
  const larkCli = installedLarkCli || (pathLookup?.status === 0 ? pathLarkCli : "");
  let state = defaultState(rootDir);
  let importPromise = null;
  let analysisPromise = null;
  let saveQueue = Promise.resolve();

  function getImportCapability() {
    return larkCli
      ? {
          ready: true,
          mode: installedLarkCli ? "installed-path" : "system-path",
          message: "当前电脑可以直接读取飞书首批素材"
        }
      : {
          ready: false,
          mode: "department-library",
          message: "首批飞书素材由管理员统一维护；同事端请直接使用上方“部门素材中心”，无需重复导入。"
        };
  }

  function runLarkCli(args, runOptions = {}) {
    if (process.platform === "win32" && /\.cmd$/i.test(larkCli)) {
      return runProcess(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", larkCli, ...args], runOptions);
    }
    return runProcess(larkCli, args, runOptions);
  }

  function save() {
    state.updatedAt = nowIso();
    const snapshot = JSON.parse(JSON.stringify(state));
    saveQueue = saveQueue.catch(() => {}).then(() => atomicWriteJson(manifestPath, snapshot));
    return saveQueue;
  }

  function normalizeSharedClipRecord(record = {}) {
    const meta = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
    const clipId = String(meta.clipId || record.recordKey || "").replace(/^clip:/, "").trim();
    const sourceId = String(meta.sourceId || record.parentKey || "").replace(/^feishu-asset:/, "").trim();
    const storageUrl = String(record.storageUrl || meta.sharedStorageUrl || "").trim();
    if (!clipId || !sourceId || !/^https?:\/\//i.test(storageUrl)) return null;
    const stage = VALID_STAGES.has(String(meta.stage || "")) ? String(meta.stage) : "product";
    return {
      id: clipId,
      sourceId,
      sourceRank: Number(meta.sourceRank || meta.rank || 0),
      productId: String(meta.productId || ""),
      productName: String(record.productName || meta.productName || "待归类产品"),
      start: Number(meta.start || 0),
      end: Number(meta.end || 0),
      duration: Number(meta.duration || (Number(meta.end || 0) - Number(meta.start || 0)) || 0),
      segmentationVersion: Number(meta.segmentationVersion || REMIX_SEGMENTATION_VERSION),
      filePath: storageUrl,
      sharedStorageUrl: storageUrl,
      thumbnailPath: String(meta.thumbnailUrl || meta.sharedThumbnailUrl || ""),
      hasAudio: meta.hasAudio !== false,
      hasSpeechCandidate: meta.hasSpeechCandidate !== false,
      stage,
      stageLabel: String(meta.stageLabel || STAGE_LABELS[stage]),
      visualType: String(meta.visualType || "待AI识别"),
      transcript: String(meta.transcript || ""),
      visibleText: String(meta.visibleText || ""),
      preserveWhole: meta.preserveWhole === true,
      semanticLabel: meta.preserveWhole === true ? "完整语义段" : "",
      allowResplit: meta.allowResplit === true,
      labelSource: String(meta.labelSource || (record.approved === true ? "department_human_review" : "department_shared")),
      confidence: Number(meta.confidence || (record.approved === true ? 1 : 0.7)),
      cutBasis: String(meta.cutBasis || "department_shared"),
      approved: record.approved === true,
      reviewRequired: record.approved !== true,
      sharedRecordKey: String(record.recordKey || `clip:${clipId}`),
      remoteOnly: true,
      updatedAt: String(record.updatedAt || meta.updatedAt || nowIso())
    };
  }

  async function syncSharedClipIndex(records = [], options = {}) {
    const normalized = (Array.isArray(records) ? records : [])
      .map(normalizeSharedClipRecord)
      .filter(Boolean);
    if (!normalized.length) return { sources: 0, clips: 0, added: 0 };
    const grouped = new Map();
    for (const clip of normalized) {
      if (!grouped.has(clip.sourceId)) grouped.set(clip.sourceId, []);
      grouped.get(clip.sourceId).push(clip);
    }
    const existingItems = new Map((state.items || []).map((item) => [String(item.id), item]));
    let added = 0;
    for (const [sourceId, remoteClips] of grouped.entries()) {
      let entry = existingItems.get(sourceId);
      if (!entry) {
        const first = remoteClips[0];
        entry = {
          id: sourceId,
          token: "",
          sourceDocTitle: "部门共享片段库",
          sourceDocUrl: "",
          sourceSection: "云端共享切片",
          rank: first.sourceRank,
          productId: first.productId || "shared-material",
          productName: first.productName,
          effectiveLabel: "部门共享切片",
          approvalRisk: "",
          selectedForInitial: true,
          clips: [],
          status: "ready",
          sharedIndexOnly: true,
          segmentationVersion: REMIX_SEGMENTATION_VERSION,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        state.items.push(entry);
        existingItems.set(sourceId, entry);
      }
      const localById = new Map((entry.clips || []).map((clip) => [String(clip.id), clip]));
      for (const remoteClip of remoteClips) {
        const local = localById.get(remoteClip.id);
        if (local) {
          local.sharedStorageUrl = remoteClip.sharedStorageUrl;
          local.sharedRecordKey = remoteClip.sharedRecordKey;
          if (!local.filePath || (!/^https?:\/\//i.test(local.filePath) && !fs.existsSync(local.filePath))) {
            local.filePath = remoteClip.filePath;
            local.remoteOnly = true;
          }
          if (!local.thumbnailPath || (!/^https?:\/\//i.test(local.thumbnailPath) && !fs.existsSync(local.thumbnailPath))) {
            local.thumbnailPath = remoteClip.thumbnailPath;
          }
          if (local.approved !== true && remoteClip.approved === true) {
            local.approved = true;
            local.reviewRequired = false;
            local.labelSource = "department_human_review";
          }
          continue;
        }
        entry.clips.push(remoteClip);
        localById.set(remoteClip.id, remoteClip);
        added += 1;
      }
      entry.status = "ready";
      entry.segmentationVersion = REMIX_SEGMENTATION_VERSION;
      entry.updatedAt = nowIso();
    }
    if (options.persist !== false) await save();
    return { sources: grouped.size, clips: normalized.length, added };
  }

  async function hydrateBundledSharedClips() {
    try {
      const bundled = JSON.parse(await fsp.readFile(sharedClipCachePath, "utf8"));
      return await syncSharedClipIndex(bundled.records || bundled.clips || [], { persist: false });
    } catch {
      return { sources: 0, clips: 0, added: 0 };
    }
  }

  async function init() {
    await fsp.mkdir(rootDir, { recursive: true });
    try {
      const loaded = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
      state = { ...defaultState(rootDir), ...loaded, rootDir };
      if (["running", "preparing"].includes(state.importJob?.status)) {
        state.importJob = { ...state.importJob, status: "interrupted", message: "上次导入被中断，可点击继续导入" };
      }
      if (["running", "preparing"].includes(state.analysisJob?.status)) {
        state.analysisJob = { ...state.analysisJob, status: "interrupted", message: "上次AI理解被中断，可点击继续" };
      }
      state.composeJobs = (state.composeJobs || []).map((job) => ["running", "preparing"].includes(job.status)
        ? { ...job, status: "interrupted", message: "上次合成被中断，可重新合成" }
        : job);
      state.outputVariants = Array.isArray(state.outputVariants) ? state.outputVariants : [];
      const importCapability = getImportCapability();
      if (!importCapability.ready && state.importJob?.status !== "success") {
        state.importJob = {
          ...state.importJob,
          status: "unavailable",
          percent: 0,
          message: importCapability.message,
          error: ""
        };
        await save();
      }
    } catch {
      const importCapability = getImportCapability();
      if (!importCapability.ready) {
        state.importJob = {
          ...state.importJob,
          status: "unavailable",
          percent: 0,
          message: importCapability.message,
          error: ""
        };
      }
      await save();
    }
    const bundled = await hydrateBundledSharedClips();
    if (bundled.added > 0) await save();
    return getSnapshot();
  }

  async function fetchDoc(url) {
    const result = await runLarkCli([
      "docs", "+fetch", "--doc", url, "--detail", "with-ids", "--doc-format", "xml", "--as", "user", "--format", "json"
    ], {
      cwd: appRoot,
      env: {
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
      }
    });
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "飞书文档读取失败");
    const parsed = parseCliJson(result.stdout);
    if (parsed.ok !== true) throw new Error(parsed.error?.message || "飞书文档读取失败");
    return String(parsed.data?.document?.content || "");
  }

  async function downloadEntry(entry) {
    const productDir = path.join(rootDir, "sources", entry.productId);
    await fsp.mkdir(productDir, { recursive: true });
    const destination = path.join(productDir, `${String(entry.rank).padStart(2, "0")}_${entry.id}.mp4`);
    const existing = await fsp.stat(destination).catch(() => null);
    if (existing?.isFile() && existing.size > 32 * 1024) {
      entry.filePath = destination;
      entry.bytes = existing.size;
      entry.sha256 = entry.sha256 || await hashFile(destination);
      entry.status = entry.clips?.length ? "ready" : "downloaded";
      entry.error = "";
      return;
    }
    entry.status = "downloading";
    entry.error = "";
    await save();
    const result = await runLarkCli([
      "docs", "+media-download", "--token", entry.token, "--output", path.basename(destination), "--as", "user"
    ], {
      cwd: productDir,
      env: {
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
      }
    });
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "飞书视频下载失败");
    const stat = await fsp.stat(destination);
    if (!stat.isFile() || stat.size < 32 * 1024) throw new Error("下载文件不完整");
    entry.filePath = destination;
    entry.bytes = stat.size;
    entry.sha256 = await hashFile(destination);
    entry.status = "downloaded";
    entry.downloadedAt = nowIso();
  }

  async function probeVideo(filePath) {
    const result = await runProcess(ffprobe, [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", filePath
    ], { cwd: rootDir });
    if (result.code !== 0) throw new Error(result.stderr || "FFprobe读取失败");
    const parsed = parseCliJson(result.stdout);
    const video = (parsed.streams || []).find((stream) => stream.codec_type === "video") || {};
    const audio = (parsed.streams || []).find((stream) => stream.codec_type === "audio") || null;
    return {
      duration: Number(parsed.format?.duration || video.duration || 0),
      width: Number(video.width || 0),
      height: Number(video.height || 0),
      fps: String(video.avg_frame_rate || video.r_frame_rate || ""),
      videoCodec: String(video.codec_name || ""),
      audioCodec: String(audio?.codec_name || ""),
      hasAudio: Boolean(audio)
    };
  }

  async function detectSceneCuts(filePath) {
    const result = await runProcess(ffmpeg, [
      "-hide_banner", "-i", filePath,
      "-vf", "select=gt(scene\\,0.30),showinfo",
      "-an", "-f", "null", "-"
    ], { cwd: rootDir });
    const text = `${result.stderr}\n${result.stdout}`;
    return Array.from(text.matchAll(/pts_time:([0-9.]+)/g)).map((match) => Number(match[1])).filter(Number.isFinite);
  }

  async function detectSilenceCuts(filePath) {
    const result = await runProcess(ffmpeg, [
      "-hide_banner", "-i", filePath,
      "-af", "silencedetect=noise=-32dB:d=0.12",
      "-vn", "-f", "null", "-"
    ], { cwd: rootDir });
    const text = `${result.stderr}\n${result.stdout}`;
    const starts = Array.from(text.matchAll(/silence_start:\s*([0-9.]+)/g)).map((match) => Number(match[1]));
    const ends = Array.from(text.matchAll(/silence_end:\s*([0-9.]+)/g)).map((match) => Number(match[1]));
    const cuts = [];
    for (let index = 0; index < Math.min(starts.length, ends.length); index += 1) {
      if (!Number.isFinite(starts[index]) || !Number.isFinite(ends[index])) continue;
      cuts.push(Number(((starts[index] + ends[index]) / 2).toFixed(3)));
    }
    return cuts;
  }

  function validAnalysisSegments(analysis) {
    return Array.isArray(analysis?.segments)
      ? analysis.segments
        .map((segment) => ({
          ...segment,
          start: Number(segment.start || 0),
          end: Number(segment.end || 0)
        }))
        .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
        .sort((a, b) => a.start - b.start)
      : [];
  }

  function semanticIdentity(segment = {}) {
    return [
      String(segment.speakerId || segment.speaker || "").trim().toLowerCase(),
      String(segment.sceneId || "").trim().toLowerCase(),
      String(segment.topicId || segment.topic || "").trim().toLowerCase()
    ];
  }

  function mergeContinuousSemanticSegments(analysis, duration) {
    const segments = validAnalysisSegments(analysis);
    if (!segments.length) return [];
    const groups = [];
    for (const segment of segments) {
      const previousGroup = groups.at(-1);
      const previous = previousGroup?.segments?.at(-1);
      const currentIdentity = semanticIdentity(segment);
      const previousIdentity = semanticIdentity(previous);
      const explicitContinuity = segment.continuousWithPrevious === true;
      const matchingIdentity = Boolean(previous)
        && currentIdentity.some(Boolean)
        && currentIdentity.every((value, index) => !value || !previousIdentity[index] || value === previousIdentity[index]);
      const timeContinuous = Boolean(previous)
        && Math.abs(Number(segment.start || 0) - Number(previous.end || 0)) <= 0.35;
      if (previousGroup && timeContinuous && (explicitContinuity || matchingIdentity)) {
        previousGroup.segments.push(segment);
        previousGroup.end = Number(segment.cutSafeEnd ?? segment.end);
        previousGroup.preserveWhole = previousGroup.preserveWhole
          || segment.preserveWhole === true
          || explicitContinuity;
        continue;
      }
      groups.push({
        start: Number(segment.cutSafeStart ?? segment.start),
        end: Number(segment.cutSafeEnd ?? segment.end),
        preserveWhole: segment.preserveWhole === true,
        segments: [segment]
      });
    }
    return groups.map((group) => {
      const first = group.segments[0] || {};
      const last = group.segments.at(-1) || first;
      return {
        start: Math.max(0, group.start),
        end: Math.min(Number(duration || group.end), group.end),
        preserveWhole: Boolean(group.preserveWhole),
        stage: VALID_STAGES.has(first.stage) ? first.stage : last.stage,
        transcript: group.segments.map((segment) => String(segment.transcript || "").trim()).filter(Boolean).join(" "),
        visibleText: group.segments.map((segment) => String(segment.visibleText || "").trim()).filter(Boolean).join("\n"),
        speakerId: String(first.speakerId || first.speaker || ""),
        sceneId: String(first.sceneId || ""),
        topicId: String(first.topicId || first.topic || "")
      };
    }).filter((group) => Number.isFinite(group.start) && Number.isFinite(group.end) && group.end > group.start);
  }

  function analysisMatchForInterval(analysis, interval) {
    const midpoint = (Number(interval.start || 0) + Number(interval.end || 0)) / 2;
    const segments = validAnalysisSegments(analysis);
    const midpointMatch = segments.find((segment) => midpoint >= segment.start && midpoint <= segment.end);
    if (midpointMatch) return midpointMatch;
    return segments
      .map((segment) => ({
        segment,
        overlap: Math.max(0, Math.min(Number(interval.end || 0), segment.end) - Math.max(Number(interval.start || 0), segment.start))
      }))
      .filter((item) => item.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)[0]?.segment || null;
  }

  async function extractClip(entry, interval, index, total, metadata, analysis = null) {
    const clipDir = path.join(rootDir, `clips-v${REMIX_SEGMENTATION_VERSION}`, entry.id);
    await fsp.mkdir(clipDir, { recursive: true });
    const stem = `${String(index + 1).padStart(2, "0")}_${interval.start.toFixed(2)}-${interval.end.toFixed(2)}`;
    const clipPath = path.join(clipDir, `${stem}.mp4`);
    const thumbnailPath = path.join(clipDir, `${stem}.jpg`);
    const existing = await fsp.stat(clipPath).catch(() => null);
    if (!existing?.isFile() || existing.size < 8 * 1024) {
      const cut = await runProcess(ffmpeg, [
        "-y", "-ss", interval.start.toFixed(3), "-i", entry.filePath, "-t", interval.duration.toFixed(3),
        "-map", "0:v:0", "-map", "0:a?",
        "-vf", "fps=30,setpts=PTS-STARTPTS",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-af", "aresample=48000,asetpts=PTS-STARTPTS",
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k",
        "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", clipPath
      ], { cwd: rootDir });
      if (cut.code !== 0) throw new Error(cut.stderr || `第${index + 1}段切片失败`);
    }
    if (!fs.existsSync(thumbnailPath)) {
      const thumbnail = await runProcess(ffmpeg, [
        "-y", "-ss", (interval.start + interval.duration / 2).toFixed(3), "-i", entry.filePath,
        "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "3", thumbnailPath
      ], { cwd: rootDir });
      if (thumbnail.code !== 0) throw new Error(thumbnail.stderr || `第${index + 1}段缩略图失败`);
    }
    const midpointRatio = metadata.duration ? (interval.start + interval.duration / 2) / metadata.duration : 0;
    const matched = analysisMatchForInterval(analysis, interval);
    const stage = VALID_STAGES.has(matched?.stage)
      ? matched.stage
      : durationStage(index, total, midpointRatio);
    const transcript = String(matched?.transcript || "");
    const visibleText = String(matched?.visibleText || "");
    const visualType = String(matched?.visualType || (stage === "ending" ? "ending_plate_candidate" : "待AI识别"));
    const speechVisualTypes = new Set(["koc", "celebrity", "offer_card", "other"]);
    const hasSpeechCandidate = Boolean(transcript)
      || matched?.speech === true
      || speechVisualTypes.has(visualType)
      || ["hook", "problem", "cta"].includes(stage);
    return {
      id: `${entry.id}-clip-${String(index + 1).padStart(2, "0")}`,
      sourceId: entry.id,
      sourceRank: entry.rank,
      productId: entry.productId,
      productName: entry.productName,
      start: interval.start,
      end: interval.end,
      duration: interval.duration,
      segmentationVersion: REMIX_SEGMENTATION_VERSION,
      filePath: clipPath,
      thumbnailPath,
      hasAudio: metadata.hasAudio,
      hasSpeechCandidate,
      stage,
      stageLabel: STAGE_LABELS[stage],
      visualType,
      transcript,
      visibleText,
      preserveWhole: Boolean(interval.protectedSemantic || matched?.preserveWhole),
      semanticLabel: interval.protectedSemantic ? "完整语义段" : "",
      allowResplit: false,
      labelSource: matched ? (analysis?.provider || "ai") : "position_heuristic",
      confidence: matched ? Math.max(0, Math.min(1, Number(matched.confidence || 0.7))) : 0.25,
      cutBasis: interval.protectedSemantic
        ? "ai_semantic_preserved"
        : matched
          ? Number(analysis?.contractVersion || 0) >= 2 ? "ai_complete_utterance" : "ai_semantic_boundary"
          : "scene_or_duration",
      approved: false,
      reviewRequired: true,
      updatedAt: nowIso()
    };
  }

  async function segmentEntry(entry, analysis = entry.aiAnalysis || null) {
    const previousClips = Array.isArray(entry.clips) ? entry.clips : [];
    entry.status = "segmenting";
    entry.error = "";
    await save();
    const metadata = await probeVideo(entry.filePath);
    if (!metadata.duration || metadata.duration < 1) throw new Error("视频时长无效");
    const [sceneCuts, silenceCuts] = await Promise.all([
      detectSceneCuts(entry.filePath),
      detectSilenceCuts(entry.filePath)
    ]);
    const semanticSegments = validAnalysisSegments(analysis);
    const semanticGroups = mergeContinuousSemanticSegments(analysis, metadata.duration);
    const semanticCuts = semanticSegments
      .filter((segment) => Number(analysis?.contractVersion || 0) < 2
        || (segment.complete !== false && segment.sentenceComplete !== false))
      .map((segment) => segment.cutSafeEnd ?? segment.end);
    const protectedRanges = semanticGroups
      .map((segment) => ({ ...segment }))
      .filter((range) => (
        Number.isFinite(range.start)
        && Number.isFinite(range.end)
        && range.preserveWhole === true
        && VALID_STAGES.has(range.stage)
        && Boolean(range.transcript || range.visibleText)
      ));
    const intervals = buildIntervals(metadata.duration, sceneCuts, semanticCuts.length ? {
      minClip: 2.4,
      hardMin: 1.8,
      maxClip: 12,
      protectedMaxClip: metadata.duration,
      targetClip: 6,
      preferredCuts: semanticCuts,
      silenceCuts,
      protectedRanges
    } : { silenceCuts });
    const clips = [];
    for (let index = 0; index < intervals.length; index += 1) {
      const clip = await extractClip(entry, intervals[index], index, intervals.length, metadata, analysis);
      clips.push(inheritClipReview(previousClips, clip));
    }
    entry.metadata = metadata;
    entry.sceneCuts = sceneCuts;
    entry.silenceCuts = silenceCuts;
    entry.clips = clips;
    entry.segmentationVersion = REMIX_SEGMENTATION_VERSION;
    entry.status = "ready";
    entry.segmentedAt = nowIso();
    entry.updatedAt = nowIso();
  }

  function mergeEntries(parsed) {
    const existingByToken = new Map((state.items || []).map((item) => [item.token, item]));
    const excludedByToken = new Map((state.excludedItems || []).map((item) => [item.token, item]));
    state.items = parsed.selected.map((entry) => ({ ...entry, ...(existingByToken.get(entry.token) || {}), ...entry, clips: existingByToken.get(entry.token)?.clips || [] }));
    state.excludedItems = parsed.excluded.map((entry) => ({ ...entry, ...(excludedByToken.get(entry.token) || {}), ...entry, clips: excludedByToken.get(entry.token)?.clips || [] }));
  }

  async function runImport() {
    try {
      const importCapability = getImportCapability();
      if (!importCapability.ready) {
        state.importJob = {
          status: "unavailable",
          current: 0,
          total: 50,
          percent: 0,
          message: importCapability.message,
          error: "",
          finishedAt: nowIso()
        };
        await save();
        return;
      }
      state.importJob = {
        status: "preparing", current: 0, total: 50, percent: 0,
        message: "正在读取两个飞书有效素材库", error: "", startedAt: nowIso()
      };
      await save();
      const [eyeXml, hydraXml] = await Promise.all([fetchDoc(SOURCE_DOCS.eye.url), fetchDoc(SOURCE_DOCS.hydra.url)]);
      mergeEntries(parseFeishuLibrary(eyeXml, hydraXml));
      await save();
      for (let index = 0; index < state.items.length; index += 1) {
        const entry = state.items[index];
        state.importJob.current = index;
        state.importJob.percent = Math.floor(index / state.items.length * 100);
        state.importJob.message = `正在处理 ${entry.productName} 第${entry.rank}条：下载与切片`;
        await save();
        try {
          await downloadEntry(entry);
          if (!entry.clips?.length || entry.status !== "ready" || Number(entry.segmentationVersion || 0) !== REMIX_SEGMENTATION_VERSION) {
            await segmentEntry(entry);
          }
          entry.error = "";
        } catch (error) {
          entry.status = "failed";
          entry.error = String(error.message || error);
        }
        state.importJob.current = index + 1;
        state.importJob.percent = Math.floor((index + 1) / state.items.length * 100);
        await save();
      }
      const failed = state.items.filter((item) => item.status === "failed").length;
      state.importJob = {
        ...state.importJob,
        status: failed ? "partial" : "success",
        current: state.items.length,
        percent: 100,
        message: failed ? `已完成，${failed}条需要重试` : "50条有效成片已下载、去重并完成实体切片",
        error: "",
        finishedAt: nowIso()
      };
      await save();
    } catch (error) {
      state.importJob = {
        ...state.importJob,
        status: "failed",
        message: "飞书素材导入未完成",
        error: String(error.message || error),
        finishedAt: nowIso()
      };
      await save();
    } finally {
      importPromise = null;
    }
  }

  function startImport() {
    if (importPromise) return getSnapshot();
    importPromise = runImport();
    return getSnapshot();
  }

  function allClips() {
    return (state.items || []).flatMap((item) => item.clips || []);
  }

  async function updateClip(clipId, patch = {}) {
    const clip = allClips().find((item) => item.id === clipId);
    if (!clip) throw new Error("片段不存在");
    if (patch.stage && !VALID_STAGES.has(patch.stage)) throw new Error("片段角色不合法");
    if (patch.stage) {
      clip.stage = patch.stage;
      clip.stageLabel = STAGE_LABELS[patch.stage];
    }
    if (Object.prototype.hasOwnProperty.call(patch, "visualType")) clip.visualType = String(patch.visualType || "").slice(0, 80);
    if (Object.prototype.hasOwnProperty.call(patch, "transcript")) clip.transcript = String(patch.transcript || "").slice(0, 1200);
    if (Object.prototype.hasOwnProperty.call(patch, "notes")) clip.notes = String(patch.notes || "").slice(0, 500);
    if (Object.prototype.hasOwnProperty.call(patch, "preserveWhole")) {
      clip.preserveWhole = patch.preserveWhole === true;
      clip.semanticLabel = clip.preserveWhole ? "完整语义段" : "";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "allowResplit")) clip.allowResplit = patch.allowResplit === true;
    if (Object.prototype.hasOwnProperty.call(patch, "approved")) clip.approved = patch.approved === true;
    clip.reviewRequired = clip.approved !== true;
    clip.labelSource = "human_review";
    clip.confidence = 1;
    clip.updatedAt = nowIso();
    await save();
    return clip;
  }

  async function ingestExternalAsset(asset = {}) {
    const externalId = String(asset.id || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
    if (!externalId) throw new Error("素材编号无效");
    const entryId = `shared-${externalId}`;
    const existing = (state.items || []).find((item) => item.id === entryId);
    if (existing?.status === "ready" && existing.clips?.length) return existing;
    const sourceUrl = String(asset.filePath || asset.storageUrl || "");
    if (!/^https?:\/\//i.test(sourceUrl) && !fs.existsSync(sourceUrl)) {
      throw new Error("这个素材没有可访问的视频地址");
    }
    const sourceDir = path.join(rootDir, "sources", "shared");
    await fsp.mkdir(sourceDir, { recursive: true });
    const destination = path.join(sourceDir, `${entryId}.mp4`);
    if (!fs.existsSync(destination) || (await fsp.stat(destination)).size < 32 * 1024) {
      if (/^https?:\/\//i.test(sourceUrl)) {
        await downloadHttpFile(sourceUrl, destination);
      } else {
        await fsp.copyFile(sourceUrl, destination);
      }
    }
    const productText = `${asset.productName || ""} ${asset.title || ""}`;
    const productId = /眼膜/.test(productText)
      ? "wis-crystal-firming-eye-mask"
      : /水润|水光肽/.test(productText)
        ? "wis-hydra-peptide-mask"
        : String(asset.productId || "shared-material");
    const entry = existing || {
      id: entryId,
      token: "",
      sourceDocTitle: asset.sourceDocTitle || "部门素材中心",
      sourceDocUrl: asset.sourceDocUrl || asset.sourceUrl || "",
      sourceSection: "同事选入切片库",
      rank: Number(asset.sourceRank || 0),
      productId,
      productName: asset.productName || "待归类产品",
      effectiveLabel: asset.isEffective ? "历史有效成片" : "部门共享素材",
      approvalRisk: asset.approvalRisk || "",
      selectedForInitial: true,
      clips: [],
      createdAt: nowIso()
    };
    entry.filePath = destination;
    entry.sharedStorageUrl = /^https?:\/\//i.test(sourceUrl) ? sourceUrl : "";
    entry.bytes = (await fsp.stat(destination)).size;
    entry.sha256 = await hashFile(destination);
    entry.status = "downloaded";
    entry.error = "";
    entry.updatedAt = nowIso();
    if (!existing) state.items.push(entry);
    await save();
    await segmentEntry(entry, entry.aiAnalysis || null);
    await save();
    return entry;
  }

  async function ingestSharedBundle(sourceRecord = {}, clipRecords = []) {
    const safeSourceRecord = sourceRecord && typeof sourceRecord === "object" ? sourceRecord : {};
    const metadata = safeSourceRecord.metadata && typeof safeSourceRecord.metadata === "object"
      ? safeSourceRecord.metadata
      : {};
    const localSourceId = String(metadata.localSourceId || safeSourceRecord.recordKey || "")
      .replace(/^feishu-asset:/, "");
    const storageUrl = String(
      safeSourceRecord.storageUrl
      || metadata.sharedStorageUrl
      || metadata.storageUrl
      || ""
    ).trim();
    if (!localSourceId) throw new Error("共享素材记录已失效，请刷新部门素材中心后重试");
    if (!storageUrl) throw new Error("共享素材暂无可访问的云端视频，请重新上传后再加入切片库");
    const entry = await ingestExternalAsset({
      id: localSourceId,
      filePath: storageUrl,
      storageUrl,
      sourceUrl: safeSourceRecord.sourceUrl,
      sourceDocUrl: safeSourceRecord.sourceUrl,
      sourceDocTitle: metadata.sourceDocTitle || "部门共享素材库",
      sourceRank: metadata.rank,
      productName: safeSourceRecord.productName,
      title: safeSourceRecord.title,
      approvalRisk: metadata.approvalRisk,
      isEffective: true
    });
    const sourceMetadata = entry.metadata?.duration
      ? entry.metadata
      : await probeVideo(entry.filePath);
    const prepared = (Array.isArray(clipRecords) ? clipRecords : [])
      .map((record) => ({
        record,
        meta: record?.metadata && typeof record.metadata === "object" ? record.metadata : {}
      }))
      .filter(({ meta }) => (
        Number.isFinite(Number(meta.start))
        && Number.isFinite(Number(meta.end))
        && Number(meta.end) > Number(meta.start)
        && Number(meta.start) >= 0
        && Number(meta.end) <= Number(sourceMetadata.duration || 0) + 0.25
      ))
      .sort((left, right) => Number(left.meta.start) - Number(right.meta.start));
    if (!prepared.length) return entry;
    const sharedClips = [];
    for (let index = 0; index < prepared.length; index += 1) {
      const { record, meta } = prepared[index];
      const interval = {
        start: Number(meta.start),
        end: Number(meta.end),
        duration: Number(meta.end) - Number(meta.start),
        protectedSemantic: meta.preserveWhole === true
      };
      const analysis = {
        provider: "department_shared_review",
        contractVersion: 3,
        segments: [{
          start: interval.start,
          end: interval.end,
          stage: VALID_STAGES.has(meta.stage) ? meta.stage : "product",
          visualType: String(meta.visualType || ""),
          transcript: String(meta.transcript || ""),
          visibleText: String(meta.visibleText || ""),
          preserveWhole: meta.preserveWhole === true,
          confidence: 1
        }]
      };
      const clip = await extractClip(entry, interval, index, prepared.length, sourceMetadata, analysis);
      clip.id = String(meta.clipId || record.recordKey || clip.id).replace(/^clip:/, "");
      clip.approved = record.approved === true;
      clip.reviewRequired = record.approved !== true;
      clip.preserveWhole = meta.preserveWhole === true;
      clip.allowResplit = meta.allowResplit === true;
      clip.semanticLabel = clip.preserveWhole ? "完整语义段" : "";
      clip.labelSource = record.approved === true ? "department_human_review" : "department_shared";
      clip.sharedRecordKey = record.recordKey || "";
      sharedClips.push(clip);
    }
    entry.clips = sharedClips;
    entry.metadata = sourceMetadata;
    entry.segmentationVersion = REMIX_SEGMENTATION_VERSION;
    entry.sharedRecordKey = safeSourceRecord.recordKey || "";
    entry.status = "ready";
    entry.segmentedAt = nowIso();
    entry.updatedAt = nowIso();
    await save();
    return entry;
  }

  function generatePlan(config = {}) {
    const baseFramework = FRAMEWORKS.find((item) => item.id === config.frameworkId) || FRAMEWORKS[0];
    const selectedKnowledge = config.knowledgeFramework && typeof config.knowledgeFramework === "object"
      ? config.knowledgeFramework
      : null;
    const knowledgeId = String(selectedKnowledge?.id || "").toUpperCase();
    const mappedStages = KNOWLEDGE_STAGE_MAP[knowledgeId]
      || (/剧情|关系|故事|KOC/i.test(`${selectedKnowledge?.category || ""} ${selectedKnowledge?.name || ""}`)
        ? FRAMEWORKS.find((item) => item.id === "trust-story").stages
        : /机制|产品观察|演示/i.test(`${selectedKnowledge?.category || ""} ${selectedKnowledge?.name || ""}`)
          ? FRAMEWORKS.find((item) => item.id === "product-demo").stages
          : null);
    const framework = selectedKnowledge
      ? {
          ...baseFramework,
          id: knowledgeId && KNOWLEDGE_STAGE_MAP[knowledgeId] ? knowledgeId : baseFramework.id,
          name: selectedKnowledge.name || baseFramework.name,
          description: selectedKnowledge.skeleton || selectedKnowledge.description || baseFramework.description,
          stages: mappedStages || baseFramework.stages
        }
      : baseFramework;
    const productId = String(config.productId || "");
    const targetDuration = Math.max(15, Math.min(60, Number(config.targetDuration || 30)));
    const audioMode = AUDIO_MODES.has(String(config.audioMode || "voice_priority"))
      ? String(config.audioMode || "voice_priority")
      : "voice_priority";
    const pool = allClips().filter((clip) => (
      clip.productId === productId
      && Number(clip.segmentationVersion || 0) === REMIX_SEGMENTATION_VERSION
      && Number(clip.duration || 0) >= 1.8
      && clip.approved === true
      && (/^https?:\/\//i.test(String(clip.filePath || "")) || fs.existsSync(clip.filePath))
    ));
    if (!pool.length) throw new Error(`这个产品还没有已人工确认的v${REMIX_SEGMENTATION_VERSION}安全切片，请先到“已人工确认”素材库完成确认`);
    const missingStages = Array.from(new Set(framework.stages))
      .filter((stage) => !pool.some((clip) => clip.stage === stage));
    if (missingStages.length) {
      throw new Error(`已确认素材不足，请先补充：${missingStages.map((stage) => STAGE_LABELS[stage]).join("、")}`);
    }
    const averageDuration = pool.reduce((sum, clip) => sum + Number(clip.duration || 0), 0) / pool.length || 4;
    const stages = expandStageSequence(framework, targetDuration, averageDuration);
    const selected = [];
    let totalDuration = 0;
    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index];
      const isLast = index === stages.length - 1;
      const available = (clip) => {
        if (!isLast && clip.stage === "ending") return false;
        if (selected.at(-1)?.sourceId === clip.sourceId) return false;
        if (selected.some((item) => item.id === clip.id)) return false;
        return true;
      };
      const exact = pool.filter((clip) => clip.stage === stage && available(clip));
      const related = pool.filter((clip) => clip.stage !== stage && clipMatchesStage(clip, stage) && available(clip));
      const fallback = pool.filter((clip) => available(clip)
        && (isLast || !["cta", "ending"].includes(clip.stage)));
      const choices = exact.length ? exact : related.length ? related : fallback;
      if (!choices.length) break;
      const scored = choices.map((clip) => ({
        clip,
        score: (clip.approved ? 20 : 0)
          + (clip.cutBasis === "ai_complete_utterance" ? 12
            : clip.cutBasis === "ai_semantic_preserved" ? 10
              : clip.cutBasis === "ai_semantic_boundary" ? 7 : 0)
          + Math.max(0, Math.min(1, Number(clip.confidence || 0))) * 5
          + (/[。！？!?]$/.test(String(clip.transcript || "").trim()) ? 3 : 0)
      })).sort((a, b) => b.score - a.score);
      const top = scored.slice(0, Math.min(5, scored.length));
      const choice = top[(Date.now() + index * 17) % top.length].clip;
      selected.push({ ...choice, requestedStage: stage });
      totalDuration += Number(choice.duration || 0);
      if (totalDuration >= targetDuration && index >= framework.stages.length - 1) break;
    }
    const finalCandidate = pool.find((clip) => ["cta", "ending"].includes(clip.stage)
      && clip.sourceId !== selected.at(-1)?.sourceId
      && !selected.some((item) => item.id === clip.id));
    if (selected.length && !["cta", "ending"].includes(selected.at(-1)?.stage) && finalCandidate) selected.push({ ...finalCandidate, requestedStage: "cta" });
    const plan = {
      id: `remix-plan-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
      frameworkId: framework.id,
      frameworkName: framework.name,
      knowledgeFramework: selectedKnowledge ? {
        id: String(selectedKnowledge.id || "").slice(0, 120),
        name: String(selectedKnowledge.name || "").slice(0, 300),
        skeleton: String(selectedKnowledge.skeleton || "").slice(0, 2000),
        originalText: String(selectedKnowledge.originalText || selectedKnowledge.fullText || "").slice(0, 50000),
        source: String(selectedKnowledge.source || "").slice(0, 100),
        sourceUrl: String(selectedKnowledge.sourceUrl || "").slice(0, 4000)
      } : null,
      productId,
      productName: selected[0]?.productName || "",
      targetDuration,
      audioMode,
      audioModeLabel: audioMode === "mute" ? "全部静音（完全移除原BGM）"
        : audioMode === "original" ? "保留原声"
          : "人声优先（弱化原BGM）",
      actualDuration: Number(selected.reduce((sum, clip) => sum + Number(clip.duration || 0), 0).toFixed(2)),
      clips: selected,
      status: "planned",
      validationError: "",
      validationWarnings: [],
      logicChecks: { advisoryOnly: true, warnings: [] },
      createdAt: nowIso()
    };
    plan.validationWarnings = validatePlan(plan);
    plan.logicChecks.warnings = plan.validationWarnings;
    state.plans = [plan, ...(state.plans || [])].slice(0, 30);
    save().catch(() => {});
    return plan;
  }

  async function reorderPlan(planId, clipIds = []) {
    const plan = (state.plans || []).find((item) => item.id === planId);
    if (!plan) throw new Error("编排计划不存在");
    const requestedIds = Array.isArray(clipIds) ? clipIds.map(String) : [];
    const existingById = new Map((plan.clips || []).map((clip) => [String(clip.id), clip]));
    if (
      requestedIds.length !== existingById.size
      || new Set(requestedIds).size !== requestedIds.length
      || requestedIds.some((id) => !existingById.has(id))
    ) {
      throw new Error("编排顺序与当前方案不一致，请重新生成方案");
    }
    plan.clips = requestedIds.map((id) => {
      const clip = existingById.get(id);
      return { ...clip, requestedStage: clip.stage };
    });
    plan.actualDuration = Number(plan.clips.reduce((sum, clip) => sum + Number(clip.duration || 0), 0).toFixed(2));
    plan.updatedAt = nowIso();
    plan.status = "planned";
    plan.validationWarnings = validatePlan(plan);
    plan.validationError = "";
    plan.logicChecks = {
      advisoryOnly: true,
      warnings: plan.validationWarnings
    };
    await save();
    return plan;
  }

  function speechAudioFilter(duration) {
    const fadeOutStart = Math.max(0, Number(duration || 0) - 0.12).toFixed(3);
    return [
      "dialoguenhance=original=0:enhance=3:voice=6",
      "pan=stereo|c0=c2|c1=c2",
      "highpass=f=100",
      "lowpass=f=9000",
      "afftdn=nr=16:nf=-35:tn=1",
      "dynaudnorm=f=150:g=7:p=0.95",
      "afade=t=in:st=0:d=0.08",
      `afade=t=out:st=${fadeOutStart}:d=0.12`,
      "aresample=48000",
      "asetpts=PTS-STARTPTS"
    ].join(",");
  }

  function compatibleSpeechAudioFilter(duration) {
    const fadeOutStart = Math.max(0, Number(duration || 0) - 0.12).toFixed(3);
    return [
      "highpass=f=100",
      "lowpass=f=9000",
      "afftdn=nr=14:nf=-35:tn=1",
      "acompressor=threshold=-18dB:ratio=3:attack=8:release=120:makeup=2",
      "dynaudnorm=f=150:g=7:p=0.95",
      "afade=t=in:st=0:d=0.08",
      `afade=t=out:st=${fadeOutStart}:d=0.12`,
      "aresample=48000",
      "asetpts=PTS-STARTPTS"
    ].join(",");
  }

  async function ffmpegSupportsFilter(name) {
    if (!ffmpegFilterNames) {
      const result = await runProcess(ffmpeg, ["-hide_banner", "-filters"], { cwd: rootDir });
      const output = `${result.stdout || ""}\n${result.stderr || ""}`;
      ffmpegFilterNames = new Set(Array.from(output.matchAll(/^\s*[TSC.]{3}\s+([a-z0-9_]+)\s+/gim), (match) => match[1]));
    }
    return ffmpegFilterNames.has(String(name || ""));
  }

  async function ffmpegSupportsOption(name) {
    if (!ffmpegOptionNames) {
      const result = await runProcess(ffmpeg, ["-hide_banner", "-h", "full"], { cwd: rootDir });
      const output = `${result.stdout || ""}\n${result.stderr || ""}`;
      ffmpegOptionNames = parseFfmpegOptionNames(output);
    }
    return ffmpegOptionNames.has(String(name || "").replace(/^-+/, ""));
  }

  async function ffmpegFrameSyncArgs() {
    await ffmpegSupportsOption("fps_mode");
    return selectFrameSyncArgs(ffmpegOptionNames);
  }

  function originalAudioFilter(duration) {
    const fadeOutStart = Math.max(0, Number(duration || 0) - 0.10).toFixed(3);
    return [
      "aresample=48000",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      "afade=t=in:st=0:d=0.06",
      `afade=t=out:st=${fadeOutStart}:d=0.10`,
      "asetpts=PTS-STARTPTS"
    ].join(",");
  }

  async function normalizeClipForCompose(clip, destination, audioMode = "voice_priority") {
    const duration = Number(clip.duration || 0);
    const common = [
      "-map", "0:v:0",
      "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"
    ];
    let args;
    const keepSpeech = audioMode === "voice_priority" && clip.hasAudio && clip.hasSpeechCandidate !== false;
    const keepOriginal = audioMode === "original" && clip.hasAudio;
    if (keepSpeech || keepOriginal) {
      const speechFilter = keepSpeech && await ffmpegSupportsFilter("dialoguenhance")
        ? speechAudioFilter(duration)
        : compatibleSpeechAudioFilter(duration);
      args = [
        "-y", "-i", clip.filePath, ...common, "-map", "0:a:0?",
        "-af", keepSpeech ? speechFilter : originalAudioFilter(duration),
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k",
        "-t", duration.toFixed(3), "-shortest", "-movflags", "+faststart", destination
      ];
    } else {
      args = [
        "-y", "-i", clip.filePath, "-f", "lavfi", "-t", String(duration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        ...common, "-map", "1:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k",
        "-t", duration.toFixed(3), "-shortest", "-movflags", "+faststart", destination
      ];
    }
    const result = await runProcess(ffmpeg, args, { cwd: rootDir });
    if (result.code !== 0) throw new Error(result.stderr || `片段 ${clip.id} 标准化失败`);
  }

  async function runCompose(job, plan) {
    try {
      job.status = "running";
      job.message = "正在统一画幅、帧率和声音";
      await save();
      const workDir = path.join(rootDir, "compose-work", job.id);
      const outputDir = path.join(rootDir, "outputs", safeName(plan.productName));
      await fsp.mkdir(workDir, { recursive: true });
      await fsp.mkdir(outputDir, { recursive: true });
      const normalized = [];
      for (let index = 0; index < plan.clips.length; index += 1) {
        job.current = index;
        job.percent = Math.floor(index / plan.clips.length * 80);
        job.message = `正在处理第${index + 1}/${plan.clips.length}个片段`;
        await save();
        const destination = path.join(workDir, `${String(index + 1).padStart(2, "0")}.mp4`);
        await normalizeClipForCompose(plan.clips[index], destination, plan.audioMode || "voice_priority");
        normalized.push(destination);
      }
      const concatPath = path.join(workDir, "concat.txt");
      await fsp.writeFile(concatPath, normalized.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
      const outputPath = path.join(outputDir, `【AI智能混剪】_${safeName(plan.frameworkName)}_${Date.now()}.mp4`);
      job.percent = 88;
      job.message = "正在合成为完整视频";
      await save();
      const frameSyncArgs = await ffmpegFrameSyncArgs();
      const concat = await runProcess(ffmpeg, [
        "-y", "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", concatPath,
        "-vf", "fps=30,setpts=N/(30*TB)", "-r", "30", ...frameSyncArgs,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "128k",
        "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", outputPath
      ], { cwd: workDir });
      if (concat.code !== 0) throw new Error(concat.stderr || "视频合成失败");
      const metadata = await probeVideo(outputPath);
      job.status = "success";
      job.percent = 100;
      job.current = plan.clips.length;
      job.message = "混剪成片已生成，等待人工审核";
      job.outputPath = outputPath;
      job.outputDir = outputDir;
      job.metadata = metadata;
      job.finishedAt = nowIso();
      plan.status = "composed";
      plan.outputPath = outputPath;
      await save();
    } catch (error) {
      job.status = "failed";
      job.message = "混剪合成失败";
      job.error = String(error.message || error);
      job.finishedAt = nowIso();
      await save();
    }
  }

  function startCompose(planId) {
    const plan = (state.plans || []).find((item) => item.id === planId);
    if (!plan) throw new Error("编排计划不存在");
    validatePlan(plan);
    const job = {
      id: `remix-compose-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
      planId,
      productName: plan.productName,
      audioMode: plan.audioMode || "voice_priority",
      audioModeLabel: plan.audioModeLabel || "人声优先（弱化原BGM）",
      status: "queued",
      current: 0,
      total: plan.clips.length,
      percent: 0,
      message: "已进入本地合成队列",
      error: "",
      createdAt: nowIso()
    };
    state.composeJobs = [job, ...(state.composeJobs || [])].slice(0, 50);
    save().then(() => runCompose(job, plan));
    return job;
  }

  function listOutputVariants(outputId) {
    const id = String(outputId || "").trim();
    return (state.outputVariants || [])
      .filter((item) => String(item.outputId) === id)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .map((item) => ({ ...item }));
  }

  async function addOutputVariant(outputId, payload = {}) {
    const id = String(outputId || "").trim();
    const job = (state.composeJobs || []).find((item) => String(item.id) === id);
    if (!job || job.status !== "success" || !job.outputPath) throw new Error("主版成片尚未生成完成");
    const existing = listOutputVariants(id);
    if (existing.length >= 5) throw new Error("每条成片最多保留5个附加版本");
    const source = String(payload.source || "local_upload");
    const type = String(payload.type || "custom");
    if (!["local_upload", "oss_pull", "ai_generated"].includes(source)) throw new Error("附加版本来源不受支持");
    if (!["no_audio", "landscape", "digital_human", "custom"].includes(type)) throw new Error("附加版本类型不受支持");
    const variant = {
      id: `remix-variant-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      outputId: id,
      type,
      source,
      title: String(payload.title || "附加版本").trim().slice(0, 120) || "附加版本",
      filePath: String(payload.filePath || "").trim(),
      storageUrl: String(payload.storageUrl || "").trim(),
      assetId: String(payload.assetId || "").trim(),
      metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
      createdBy: String(payload.createdBy || "").trim(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    if (!variant.filePath && !variant.storageUrl) throw new Error("附加版本缺少可播放文件");
    state.outputVariants = [variant, ...(state.outputVariants || [])];
    await save();
    return { ...variant };
  }

  async function setPrimaryOutput(outputId, variantId = "") {
    const id = String(outputId || "").trim();
    const job = (state.composeJobs || []).find((item) => String(item.id) === id);
    if (!job) throw new Error("主版成片不存在");
    const nextVariantId = String(variantId || "").trim();
    if (nextVariantId && !listOutputVariants(id).some((item) => item.id === nextVariantId)) {
      throw new Error("要设为主版的附加版本不存在");
    }
    job.primaryVariantId = nextVariantId;
    job.updatedAt = nowIso();
    await save();
    return { outputId: id, primaryVariantId: nextVariantId };
  }

  async function deleteOutputVariant(variantId) {
    const id = String(variantId || "").trim();
    const variant = (state.outputVariants || []).find((item) => String(item.id) === id);
    if (!variant) throw new Error("附加版本不存在");
    const job = (state.composeJobs || []).find((item) => String(item.id) === String(variant.outputId));
    state.outputVariants = (state.outputVariants || []).filter((item) => String(item.id) !== id);
    if (job?.primaryVariantId === id) job.primaryVariantId = "";
    const ownedRoot = path.resolve(rootDir, "output-variants");
    const localPath = variant.filePath && !/^https?:\/\//i.test(variant.filePath) ? path.resolve(variant.filePath) : "";
    if (localPath && (localPath === ownedRoot || localPath.startsWith(`${ownedRoot}${path.sep}`))) {
      await fsp.rm(localPath, { force: true }).catch(() => {});
    }
    await save();
    return { ok: true, outputId: variant.outputId, variantId: id };
  }

  async function deleteComposeJob(jobId) {
    const job = (state.composeJobs || []).find((item) => item.id === jobId);
    if (!job) throw new Error("本地合成结果不存在");
    if (["queued", "running", "preparing"].includes(job.status)) {
      throw new Error("这条成片仍在处理中，暂时不能删除");
    }
    let trashedPath = "";
    if (job.outputPath && fs.existsSync(job.outputPath)) {
      const trashDir = path.join(rootDir, "trash", "compose-outputs");
      await fsp.mkdir(trashDir, { recursive: true });
      trashedPath = path.join(
        trashDir,
        `${Date.now()}_${safeName(path.basename(job.outputPath), "混剪成片.mp4")}`
      );
      try {
        await fsp.rename(job.outputPath, trashedPath);
      } catch (error) {
        if (error?.code !== "EXDEV") throw new Error(`成片正在被占用或无法移动：${error.message || error}`);
        await fsp.copyFile(job.outputPath, trashedPath);
        await fsp.unlink(job.outputPath);
      }
    }
    const variants = listOutputVariants(jobId);
    for (const variant of variants) {
      const ownedRoot = path.resolve(rootDir, "output-variants");
      const localPath = variant.filePath && !/^https?:\/\//i.test(variant.filePath) ? path.resolve(variant.filePath) : "";
      if (localPath && localPath.startsWith(`${ownedRoot}${path.sep}`)) {
        await fsp.rm(localPath, { force: true }).catch(() => {});
      }
    }
    state.outputVariants = (state.outputVariants || []).filter((item) => String(item.outputId) !== String(jobId));
    const deleted = {
      ...job,
      originalOutputPath: job.outputPath || "",
      trashedPath,
      deletedAt: nowIso()
    };
    state.composeJobs = (state.composeJobs || []).filter((item) => item.id !== jobId);
    state.deletedComposeJobs = [deleted, ...(state.deletedComposeJobs || [])].slice(0, 100);
    if (trashedPath) {
      await atomicWriteJson(`${trashedPath}.json`, deleted);
    }
    await save();
    return {
      ok: true,
      recoverable: Boolean(trashedPath),
      trashedPath,
      message: trashedPath ? "成片已移入工作台回收目录" : "无效结果已从列表移除"
    };
  }

  async function runAiAnalysis(config = {}) {
    try {
      if (typeof options.analyzeVideo !== "function") throw new Error("当前没有已配置的视频理解模型");
      const ready = state.items.filter((item) => item.status === "ready" && item.filePath);
      const retryFailedOnly = config.retryFailedOnly === true;
      const forceReanalyze = config.forceReanalyze === true;
      const pendingAnalysis = ready.filter((entry) => (
        forceReanalyze
          ? true
          : retryFailedOnly
          ? entry.aiStatus === "failed"
          : entry.aiStatus !== "success" || !validAnalysisSegments(entry.aiAnalysis).length
      ));
      const needsSentenceCut = ready.filter((entry) => (
        validAnalysisSegments(entry.aiAnalysis).length
        && Number(entry.segmentationVersion || 0) !== REMIX_SEGMENTATION_VERSION
      ));
      const workById = new Map([...pendingAnalysis, ...needsSentenceCut].map((entry) => [entry.id, entry]));
      const work = Array.from(workById.values());
      if (!work.length) {
        state.analysisJob = {
          status: "success", current: 0, total: 0, percent: 100,
          succeeded: ready.filter((entry) => entry.aiStatus === "success").length,
          failed: ready.filter((entry) => entry.aiStatus === "failed").length,
          phase: "complete", currentItem: "",
          message: "AI理解与完整语句切片均已完成", error: "",
          startedAt: nowIso(), finishedAt: nowIso(), lastUpdatedAt: nowIso()
        };
        await save();
        return;
      }
      state.analysisJob = {
        status: "running", current: 0, total: work.length, percent: 0,
        succeeded: 0, failed: 0, phase: "preparing", currentItem: "",
        message: "正在准备AI理解与完整语句切片", error: "",
        startedAt: nowIso(), lastUpdatedAt: nowIso()
      };
      await save();
      for (let index = 0; index < work.length; index += 1) {
        const entry = work[index];
        state.analysisJob.current = index;
        state.analysisJob.percent = Math.floor(index / Math.max(1, work.length) * 100);
        state.analysisJob.currentItem = `${entry.productName} 第${entry.rank}条`;
        state.analysisJob.phase = "analyzing";
        state.analysisJob.message = `正在理解 ${entry.productName} 第${entry.rank}条`;
        state.analysisJob.lastUpdatedAt = nowIso();
        await save();
        try {
          let analysis = entry.aiAnalysis;
          if (forceReanalyze || entry.aiStatus !== "success" || !validAnalysisSegments(analysis).length) {
            analysis = await options.analyzeVideo(entry, async (progress = {}) => {
              state.analysisJob.phase = String(progress.phase || "analyzing");
              state.analysisJob.message = String(progress.message || state.analysisJob.message);
              state.analysisJob.lastUpdatedAt = nowIso();
              await save();
            });
          }
          entry.aiAnalysis = analysis;
          state.analysisJob.phase = "segmenting";
          state.analysisJob.message = Number(analysis?.contractVersion || 0) >= 2
            ? `正在按完整语句重切 ${entry.productName} 第${entry.rank}条`
            : `正在按AI语义边界重切 ${entry.productName} 第${entry.rank}条`;
          state.analysisJob.lastUpdatedAt = nowIso();
          await save();
          await segmentEntry(entry, analysis);
          entry.aiStatus = "success";
          entry.aiError = "";
          state.analysisJob.succeeded += 1;
        } catch (error) {
          entry.aiStatus = "failed";
          entry.aiError = String(error.message || error);
          entry.status = entry.clips?.length ? "ready" : "failed";
          state.analysisJob.failed += 1;
        }
        state.analysisJob.current = index + 1;
        state.analysisJob.percent = Math.floor((index + 1) / Math.max(1, work.length) * 100);
        state.analysisJob.lastUpdatedAt = nowIso();
        await save();
      }
      const failed = work.filter((entry) => entry.aiStatus === "failed").length;
      const certified = ready.filter((entry) => Number(entry.aiAnalysis?.contractVersion || 0) >= 2).length;
      state.analysisJob = {
        ...state.analysisJob,
        status: failed ? "partial" : "success",
        current: work.length,
        percent: 100,
        phase: "complete",
        currentItem: "",
        message: failed
          ? `处理完成，${failed}条需要重试`
          : certified === ready.length
            ? "AI理解与完整语句切片已完成，等待人工抽检"
            : "AI语义边界重切已完成；可再次运行以升级为完整语句边界",
        lastUpdatedAt: nowIso(),
        finishedAt: nowIso()
      };
      await save();
    } catch (error) {
      state.analysisJob = {
        ...state.analysisJob,
        status: "failed",
        message: "AI视频理解未启动",
        error: String(error.message || error),
        finishedAt: nowIso()
      };
      await save();
    } finally {
      analysisPromise = null;
    }
  }

  function startAiAnalysis(config = {}) {
    if (analysisPromise) return getSnapshot();
    analysisPromise = runAiAnalysis(config);
    return getSnapshot();
  }

  function getProgressMode() {
    const composing = (state.composeJobs || []).find((job) => ["queued", "running"].includes(job.status));
    if (composing) {
      return {
        mode: "remix", label: "AI-智能混剪", status: composing.status,
        activeCount: 1, percent: composing.percent || 0, message: composing.message, href: "./remix.html"
      };
    }
    const activeImport = ["preparing", "running"].includes(state.importJob?.status);
    if (activeImport) {
      return {
        mode: "remix", label: "AI-智能混剪", status: "running",
        activeCount: 1, percent: state.importJob.percent || 0, message: state.importJob.message, href: "./remix.html"
      };
    }
    const activeAnalysis = ["preparing", "running"].includes(state.analysisJob?.status);
    if (activeAnalysis) {
      return {
        mode: "remix", label: "AI-智能混剪", status: "running",
        activeCount: 1, percent: state.analysisJob.percent || 0, message: state.analysisJob.message, href: "./remix.html"
      };
    }
    const readySources = (state.items || []).filter((item) => item.status === "ready" && Array.isArray(item.clips) && item.clips.length).length;
    const clipCount = allClips().length;
    if (clipCount > 0) {
      return {
        mode: "remix", label: "AI-智能混剪", status: "success",
        activeCount: 0, percent: 100,
        message: `共享片段库可用 · ${readySources}条素材 ${clipCount}个片段`, href: "./remix.html"
      };
    }
    const status = state.importJob?.status === "success" ? "success" : state.importJob?.status || "idle";
    return {
      mode: "remix", label: "AI-智能混剪", status,
      activeCount: 0, percent: state.importJob?.percent || 0,
      message: state.importJob?.message || "尚未导入", href: "./remix.html"
    };
  }

  function getSnapshot() {
    const clips = allClips();
    const readyItems = (state.items || []).filter((item) => item.status === "ready");
    const failedItems = (state.items || []).filter((item) => item.status === "failed");
    const stageCounts = Object.fromEntries(Array.from(VALID_STAGES).map((stage) => [stage, clips.filter((clip) => clip.stage === stage).length]));
    return {
      schemaVersion: state.schemaVersion,
      rootDir,
      selectedRule: state.selectedRule,
      sourceDocuments: state.sourceDocuments,
      counts: {
        selectedVideos: (state.items || []).length,
        readyVideos: readyItems.length,
        failedVideos: failedItems.length,
        excludedHighRiskVideos: (state.excludedItems || []).length,
        clips: clips.length,
        aiAnalyzedVideos: (state.items || []).filter((item) => item.aiStatus === "success").length,
        sentenceCutVideos: (state.items || []).filter((item) => (
          item.status === "ready" && Number(item.segmentationVersion || 0) === REMIX_SEGMENTATION_VERSION
        )).length,
        sentenceCertifiedVideos: (state.items || []).filter((item) => (
          item.aiStatus === "success" && Number(item.aiAnalysis?.contractVersion || 0) >= 2
        )).length,
        approvedClips: clips.filter((clip) => clip.approved).length
      },
      stageCounts,
      frameworks: FRAMEWORKS,
      importJob: state.importJob,
      importCapability: getImportCapability(),
      analysisJob: state.analysisJob,
      composeJobs: (state.composeJobs || []).slice(0, 50),
      outputVariants: (state.outputVariants || []).slice(0, 150),
      deletedComposeJobs: (state.deletedComposeJobs || []).slice(0, 10),
      plans: (state.plans || []).slice(0, 10),
      items: (state.items || []).map((item) => ({
        ...item,
        clips: undefined,
        clipCount: item.clips?.length || 0,
        previewClip: item.clips?.[0] || null
      })),
      updatedAt: state.updatedAt
    };
  }

  function listClips(filters = {}) {
    const productId = String(filters.productId || "");
    const stage = String(filters.stage || "");
    const sourceId = String(filters.sourceId || "");
    const approval = String(filters.approval || "");
    const query = String(filters.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(2000, Number(filters.limit || 120)));
    return allClips()
      .filter((clip) => !productId || clip.productId === productId)
      .filter((clip) => !stage || clip.stage === stage)
      .filter((clip) => !sourceId || clip.sourceId === sourceId)
      .filter((clip) => approval !== "approved" || clip.approved === true)
      .filter((clip) => approval !== "pending" || clip.approved !== true)
      .filter((clip) => !query || [
        clip.productName,
        clip.stageLabel,
        clip.visualType,
        clip.transcript,
        clip.visibleText,
        clip.notes,
        `来源第${clip.sourceRank}条`
      ].some((value) => String(value || "").toLowerCase().includes(query)))
      .slice(0, limit);
  }

  function getStateForTests() {
    return state;
  }

  function setMediaTools(tools = {}) {
    if (tools.ffmpeg) ffmpeg = String(tools.ffmpeg);
    if (tools.ffprobe) ffprobe = String(tools.ffprobe);
    ffmpegFilterNames = null;
    ffmpegOptionNames = null;
    return { ffmpeg, ffprobe };
  }

  return {
    init,
    save,
    startImport,
    startAiAnalysis,
    updateClip,
    syncSharedClipIndex,
    ingestExternalAsset,
    ingestSharedBundle,
    generatePlan,
    reorderPlan,
    startCompose,
    listOutputVariants,
    addOutputVariant,
    setPrimaryOutput,
    deleteOutputVariant,
    deleteComposeJob,
    getSnapshot,
    listClips,
    getProgressMode,
    getStateForTests,
    getImportCapability,
    setMediaTools,
    rootDir
  };
}

module.exports = {
  SOURCE_DOCS,
  FRAMEWORKS,
  STAGE_LABELS,
  VALID_STAGES,
  parseEyeDocument,
  parseHydraDocument,
  parseFeishuLibrary,
  parseFfmpegOptionNames,
  selectFrameSyncArgs,
  buildIntervals,
  inheritClipReview,
  validatePlan,
  expandStageSequence,
  createRemixEngine
};

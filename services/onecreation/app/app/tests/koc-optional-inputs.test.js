"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const Module = require("node:module");

// The source distribution omits mysql2. These tests never access its database.
const originalLoad = Module._load;
let server;
try {
  Module._load = function (id, ...args) {
    if (id === "mysql2/promise") return { createPool() { throw new Error("Unexpected database access"); } };
    return originalLoad.call(this, id, ...args);
  };
  server = require("../server.js");
} finally {
  Module._load = originalLoad;
}
const { normalizeKocConfig, buildKocClipPlan, buildKocScriptBrief, kocScriptMatchesLocked } = server;
const { validateGenerationTaskContract } = require("../prompt-rules.js");
const selectedScript = { id: "CS-TEST", title: "生活化分享", product: "眼膜", scriptType: "唠嗑KOC脚本", copy: "今天跟大家聊一聊我的日常护肤习惯。\n每天留一点时间照顾自己。" };

function plan(input) {
  const config = normalizeKocConfig(input);
  return { config, clips: buildKocClipPlan(config, buildKocScriptBrief(config)) };
}

test("script-only input has no implicit SKU, video or reference audio", () => {
  const { config, clips } = plan({ selectedScript });
  assert.equal(config.productId, "");
  assert.equal(config.referenceVideoPath, "");
  assert.equal(config.analysisMode, "script");
  assert.equal(config.declineAudioReference, true);
  assert.equal(config.useMotionReference, false);
  assert.equal(config.voiceoverScript, selectedScript.copy);
  assert.equal(clips.clips.map((clip) => clip.voiceover).join(""), selectedScript.copy.replace(/\n/g, ""));
  assert.equal(kocScriptMatchesLocked(clips.clips, clips.lockedScript), true);
  assert.ok(clips.clips.every((clip) => !clip.productVisible && !clip.requiredAssets.includes("reference_audio")));
});

test("new copy overrides the selected script, then selected script overrides old copy", () => {
  assert.equal(normalizeKocConfig({ selectedScript, referenceTranscript: "原片旧口播", voiceoverScript: "本次新口播" }).voiceoverScript, "本次新口播");
  assert.equal(normalizeKocConfig({ selectedScript, referenceTranscript: "原片旧口播" }).voiceoverScript, selectedScript.copy);
  assert.equal(normalizeKocConfig({ referenceTranscript: "原片旧口播" }).voiceoverScript, "原片旧口播");
  assert.equal(normalizeKocConfig({ selectedScript, voiceoverScript: "  \n " }).voiceoverScript, selectedScript.copy);
});

test("direct generation bypasses analysis even when a reference video is present", () => {
  const config = normalizeKocConfig({ referenceVideoPath: "reference.mp4", selectedScript, skipReferenceAnalysis: true });
  assert.equal(config.analysisMode, "script");
  assert.equal(config.skipReferenceAnalysis, true);
  assert.ok(buildKocScriptBrief(config).includes("跳过原片转写与深度拆解"));
  assert.equal(normalizeKocConfig({ referenceVideoPath: "reference.mp4", selectedScript }).analysisMode, "ai");
});

test("all optional fields can be empty and produce a valid silent clip", () => {
  const { config, clips } = plan({});
  assert.equal(config.silentVideo, true);
  assert.equal(clips.totalDuration, 8);
  assert.equal(clips.lockedScript, "");
  assert.equal(clips.clips.length, 1);
  assert.ok(clips.clips[0].finalLibtvPrompt.includes("禁止新增台词"));
  assert.equal(validateGenerationTaskContract({ workflow: "koc", config, task: clips.clips[0] }).ok, true);
  assert.equal(kocScriptMatchesLocked(clips.clips, ""), true);
  assert.equal(validateGenerationTaskContract({ workflow: "koc", config: {}, task: clips.clips[0] }).ok, false);
});

test("long selected scripts keep every character and legal per-clip duration", () => {
  const { clips } = plan({ selectedScript: { ...selectedScript, copy: selectedScript.copy.repeat(12) } });
  assert.ok(clips.clips.length > 1);
  assert.ok(clips.clips.every((clip) => clip.duration >= 4 && clip.duration <= 14));
  assert.equal(kocScriptMatchesLocked(clips.clips, clips.lockedScript), true);
  assert.equal(clips.clips.reduce((sum, clip) => sum + clip.duration, 0), clips.targetTotalDuration);
});

test("saved config keeps the selected script snapshot and optional product on restore", () => {
  const original = normalizeKocConfig({ selectedScript });
  const restored = normalizeKocConfig(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored.selectedScript, original.selectedScript);
  assert.equal(restored.productId, "");
  assert.equal(restored.voiceoverScript, selectedScript.copy);
  assert.equal(restored.analysisMode, "script");
  assert.equal(restored.voiceoverScriptInput, "");
  const changed = normalizeKocConfig({ ...restored, selectedScript: { ...selectedScript, copy: "这是重新选择的脚本。" } });
  assert.equal(changed.voiceoverScript, "这是重新选择的脚本。");
});

test("no-reference preparation builds the real plan without ASR, deep analysis or video tools", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "koc-optional-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("async function processKocPreparation(");
  const end = source.indexOf("\nasync function ensureKocRemoteAssets", start);
  const forbidden = () => { throw new Error("Unexpected original-video operation"); };
  const context = vm.createContext({
    normalizeKocConfig, buildKocClipPlan, buildKocScriptBrief,
    path, fsp, KOC_OUTPUT_DIR: root, safeName: () => "task", nowStamp: () => "test",
    log() {}, saveJob: async () => {},
    requireUploadedFile: forbidden, ensureRemixMediaTools: forbidden,
    probeKocReferenceVideo: forbidden, transcribeSourceVideo: forbidden,
    runKocAiDeepDive: forbidden, extractKocReferenceAudio: forbidden,
    writeKocDeepDiveDocument: async (job) => { assert.equal(job.kocAssets.referenceVideo, null); },
    extractKocReferenceFrames: async (job) => { assert.equal(job.kocAssets.referenceVideo, null); return []; },
    generateKocCharacterCandidates: async (job) => { job.status = "awaiting_character_selection"; }
  });
  vm.runInContext(source.slice(start, end), context);
  const job = { config: { selectedScript }, status: "queued" };
  await context.processKocPreparation(job);
  assert.equal(job.status, "awaiting_character_selection", job.error);
  assert.equal(job.kocAssets.referenceVideo, null);
  assert.equal(job.pendingClipPlan.scriptMatch, true);
  assert.equal(job.config.selectedScript.id, selectedScript.id);
});

test("no-reference tasks pass character confirmation and upload only the selected image", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "koc-assets-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const image = path.join(root, "character.png");
  await fsp.writeFile(image, "fixture image");
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  function extract(name) {
    const match = source.match(new RegExp(`\\n(?:async )?function ${name}\\(`));
    assert.ok(match, name);
    const start = match.index + 1;
    const next = source.slice(start + 1).match(/\n(?:async )?function /);
    return source.slice(start, start + 1 + next.index);
  }
  const uploaded = [];
  const context = vm.createContext({
    fsp, path, UPLOADS_DIR: root, IMAGE_FILE_PATTERN: /\.png$/i,
    isPathInside: (directory, file) => path.resolve(file).startsWith(path.resolve(directory) + path.sep),
    stageKocAsset: async (file, directory, name, role) => ({ path: file, name, role }),
    buildKocClipPlan, kocScriptMatchesLocked, validateGenerationTaskContract,
    validateKocGenerationSettings: server.validateKocGenerationSettings,
    kocGenerationSettings: server.kocGenerationSettings,
    writeKocBundle: async () => ({}), saveJob: async () => {}, log() {},
    createKocCanvas: async () => {},
    uploadKocNode: async (job, name, type, file) => { uploaded.push({ name, type, file }); return { nodeKey: "image-key" }; }
  });
  vm.runInContext(source.match(/^const SUBTITLE_HARD_FAIL_RULE = .*;$/m)[0], context);
  for (const name of ["finalizeKocCharacterSelection", "runKocAutomaticCompliance", "ensureKocRemoteAssets"]) {
    vm.runInContext(extract(name), context);
  }
  const { config, clips } = plan({ selectedScript, selectedCharacterPath: image });
  const job = { outputDir: root, config, deepDive: buildKocScriptBrief(config), pendingClipPlan: clips, kocAssets: { referenceVideo: null, productAssets: [], referenceAudioVariants: [] } };
  await context.finalizeKocCharacterSelection(job, image, "人物场景图");
  assert.equal(job.status, "awaiting_review");
  assert.equal(job.complianceAudit.blockingCount, 0);
  assert.ok(!job.complianceAudit.items.some((item) => item.key === "reference_video"));
  await context.ensureKocRemoteAssets(job);
  assert.deepEqual(uploaded.map((item) => item.name), ["人物场景图"]);
  assert.equal(job.kocRemoteUploads.referenceVideo, undefined);
});

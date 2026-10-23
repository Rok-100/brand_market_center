"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const load = Module._load;
let server;
try {
  Module._load = function(id, ...args) { if (id === "mysql2/promise") return { createPool() { throw Error("No production database in tests"); } }; return load.call(this, id, ...args); };
  server = require("../server.js");
} finally { Module._load = load; }
const { createKocFinalDelivery } = require("../assets/koc-audio-runtime/koc-final-delivery.js");
const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
function extract(name) {
  const match = source.match(new RegExp(`\\n(?:async )?function ${name}\\(`));
  const start = match.index + 1;
  const next = source.slice(start + 1).match(/\n(?:async )?function /);
  return source.slice(start, start + 1 + next.index);
}
function planned() {
  const config = server.normalizeKocConfig({ voiceoverScript: "我说的时长14秒只是口播内容，不能因为更改时长而替换这句话。" });
  const plan = server.buildKocClipPlan(config, server.buildKocScriptBrief(config));
  return { config, plan, task: plan.clips[0] };
}
test("4 and 15 seconds are accepted; invalid lengths are refused", () => {
  assert.equal(server.normalizeKocClipDuration(4), 4);
  assert.equal(server.normalizeKocClipDuration(15), 15);
  for (const value of [0, 3, 16, 4.5, NaN]) assert.throws(() => server.normalizeKocClipDuration(value));
});
test("duration changes the generation header and settings without changing voiceover", async () => {
  const { config, plan } = planned();
  const job = { id: "duration-fixture", workflow: "koc", status: "awaiting_review", config, tasks: plan.clips, clipPlan: plan, kocAssets: { productAssets: [] }, checkpoints: {} };
  const context = vm.createContext({
    updateKocReviewedPrompt: server.updateKocReviewedPrompt,
    validateGenerationTaskContract: server.validateGenerationTaskContract,
    validateKocGenerationSettings: server.validateKocGenerationSettings,
    kocScriptMatchesLocked: server.kocScriptMatchesLocked,
    writeKocBundle: async () => ({}), runKocAutomaticCompliance: async () => ({ blockingCount: 0 }), log() {}, saveJob: async () => {}
  });
  vm.runInContext(extract("saveKocReviewedClipPlan"), context);
  const reviewed = plan.clips.map(task => ({ index: task.index, duration: 15, storyboardFunction: task.storyboardFunction, productVisible: task.productVisible, finalLibtvPrompt: task.finalLibtvPrompt }));
  await context.saveKocReviewedClipPlan(job, reviewed);
  assert.ok(job.tasks.every(task => task.duration === 15 && task.libtv.settings.duration === 15));
  assert.equal(server.kocScriptMatchesLocked(job.tasks, plan.lockedScript), true);
  assert.ok(job.tasks[0].finalLibtvPrompt.includes("时长15秒。"));
  assert.ok(job.tasks[0].finalLibtvPrompt.includes("时长14秒只是口播内容"));
  assert.equal(job.clipPlan.totalDuration, 15 * job.tasks.length);
});
test("an incomplete task cannot create a final video or publish an upload", async () => {
  const job = { tasks: [{ index: 1, status: "success", localPath: "a.mp4" }, { index: 2, status: "failed" }] };
  const context = vm.createContext({ ensureRemixMediaTools() { throw Error("Must not merge partial videos"); } });
  vm.runInContext(extract("buildKocPreview"), context);
  assert.equal(await context.buildKocPreview(job), false);
  const client = createKocFinalDelivery({ saveJob: async () => {}, hashFile: async () => "a".repeat(64) });
  await assert.rejects(client.deliver(job), /全部分镜/);
});
test("all clips are merged in index order and validated before final publication", async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "koc-merge-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const calls = [];
  const media = { streams: [{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 540, height: 960 }, { codec_type: "audio" }], format: { duration: "5" } };
  let concatList = "";
  const job = { outputDir: root, taskName: "完整视频", config: { productName: "眼膜" }, tasks: [{ index: 2, status: "success", localPath: path.join(root, "2.mp4") }, { index: 1, status: "success", localPath: path.join(root, "1.mp4") }] };
  const context = vm.createContext({ path, fsp, FFMPEG: "ffmpeg", FFPROBE: "ffprobe", ensureRemixMediaTools: async () => {}, safeName: value => value, tryParseJson: JSON.parse, log() {},
    runProcess: async (tool, args) => {
      calls.push({ tool, args });
      if (tool === "ffmpeg") {
        if (args.includes("null")) return { code: 0 };
        if (args.includes("concat")) concatList = await fsp.readFile(args[args.indexOf("-i") + 1], "utf8");
        await fsp.writeFile(args.at(-1), "whole video"); return { code: 0 };
      }
      const final = args.at(-1).endsWith(".part");
      return { code: 0, stdout: JSON.stringify({ ...media, format: { duration: final ? "10" : "5" } }) };
    }
  });
  vm.runInContext(extract("buildKocPreview"), context);
  assert.equal(await context.buildKocPreview(job), true);
  assert.equal(job.finalVideoDuration, 10);
  assert.equal(job.finalVideoValidation.ok, true);
  assert.ok(concatList.indexOf("clip-1.mp4") < concatList.indexOf("clip-2.mp4"));
  assert.ok(calls.some(call => call.args.includes("-xerror")));
  assert.ok(fs.existsSync(job.finalVideoPath));
});
test("upload uses the whole video, keeps creator and source library semantics, and is idempotent", async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "koc-return-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "final.mp4");
  await fsp.writeFile(file, "final-video");
  const calls = [];
  let uploads = 0;
  const client = createKocFinalDelivery({ token: "x".repeat(32), apiBase: "http://fixture/api/workstation", saveJob: async () => {}, hashFile: async () => "a".repeat(64),
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => url.endsWith("presign") ? { upload_required: true, upload_url: "http://fixture/signed", headers: {} } : { status: "completed", asset_id: 123 } };
    }, upload: async (ticket, uploadedFile) => { assert.equal(uploadedFile, file); uploads++; }
  });
  const job = { id: "job-return", config: { productId: "", selectedScript: { id: "script", title: "脚本" } }, libtvOwner: { userId: "FD-TEST", name: "制作人" }, finalVideoPath: file, finalVideoValidation: { ok: true }, tasks: [{ index: 1, status: "success", localPath: "clip1.mp4" }] };
  await Promise.all([client.deliver(job), client.deliver(job)]);
  await client.deliver(job);
  assert.equal(uploads, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.workstation_type, "koc");
  assert.equal(calls[0].body.review_status, "pending");
  assert.equal(calls[0].body.maker_id, "FD-TEST");
  assert.equal(job.finalDelivery.assetId, 123);
  assert.ok(!JSON.stringify(job.finalDelivery).includes("signed"));
});
test("unknown completion result retries the same return without re-uploading", async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "koc-return-retry-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "final.mp4"); await fsp.writeFile(file, "final-video");
  const keys = []; let attempts = 0;
  const client = createKocFinalDelivery({ token: "x".repeat(32), apiBase: "http://fixture/api/workstation", saveJob: async () => {}, hashFile: async () => "a".repeat(64), upload: async () => { throw Error("Must not upload again"); },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); keys.push(body.idempotency_key);
      if (url.endsWith("presign")) return { ok: true, json: async () => ({ upload_required: false }) };
      if (++attempts === 1) throw Error("Connection lost after registration");
      return { ok: true, json: async () => ({ status: "completed", asset_id: 456 }) };
    }
  });
  const job = { id: "job-return-retry", config: {}, libtvOwner: { userId: "FD-TEST", name: "制作人" }, finalVideoPath: file, finalVideoValidation: { ok: true }, tasks: [{ index: 1, status: "success", localPath: "clip1.mp4" }] };
  await assert.rejects(client.deliver(job));
  assert.equal(job.finalDelivery.status, "failed");
  await client.deliver(job);
  assert.equal(new Set(keys).size, 1);
  assert.equal(job.finalDelivery.assetId, 456);
});

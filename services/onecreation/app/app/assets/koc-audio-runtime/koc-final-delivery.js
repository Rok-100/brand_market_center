"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

function createKocFinalDelivery(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const apiBase = String(options.apiBase || process.env.WIS_KOC_CLOUD_API_BASE || (process.env.HUB_INTEGRATED_MODE === "1" ? "http://cloud-media-review:3000/api/workstation" : "https://app.fandow.top/fd-026222/wis-video-center/api/workstation")).replace(/\/+$/, "");
  const token = options.token ?? process.env.WIS_WORKSTATION_API_TOKEN ?? "";
  const flights = new Map();
  const save = options.saveJob;
  const hashFile = options.hashFile;

  async function request(route, body) {
    if (String(token).length < 32) throw new Error("云管家回传尚未配置，完整视频已保留");
    let response;
    try {
      response = await fetchImpl(apiBase + route, { method: "POST", headers: { "X-WIS-Workstation-Token": token, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    } catch { throw new Error("无法连接WIS云管家，完整视频已保留，可稍后补传"); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`云管家回传失败（${response.status}）：${typeof result.detail === "string" ? result.detail : "请稍后重试"}`);
    return result;
  }

  const upload = options.upload || (async (ticket, file, size) => {
    let response;
    try {
      response = await fetchImpl(ticket.upload_url, { method: "PUT", headers: { ...ticket.headers, "Content-Length": String(size) }, body: fs.createReadStream(file), duplex: "half", signal: AbortSignal.timeout(20 * 60 * 1000) });
    } catch { throw new Error("完整视频上传中断，文件已保留，可继续补传"); }
    if (!response.ok) throw new Error(`完整视频上传失败（${response.status}），可继续补传`);
  });

  async function perform(job) {
    if (!job.tasks?.length || !job.tasks.every(task => task.status === "success" && task.localPath)) throw new Error("全部分镜完成后才能回传完整视频");
    const file = job.finalVideoPath;
    if (!file || !job.finalVideoValidation?.ok) throw new Error("完整视频尚未通过拼接验收");
    const stat = await fsp.stat(file);
    const sha256 = await hashFile(file);
    const previous = job.finalDelivery || {};
    const videoRevision = Number(job.finalVideoRevision || 1);
    if (previous.status === "completed" && previous.sha256 === sha256 && previous.videoRevision === videoRevision && previous.assetId) return previous;
    const idempotencyKey = `ai-koc:${job.id}:v${videoRevision}:${sha256}`;
    job.finalDelivery = { ...previous, requested: true, status: "uploading", idempotencyKey, sha256, videoRevision, attempts: Number(previous.attempts || 0) + 1, startedAt: new Date().toISOString(), error: "" };
    await save(job);
    try {
      const ticket = await request("/returns/presign", {
        idempotency_key: idempotencyKey, filename: path.basename(file), size: stat.size, sha256, mime_type: "video/mp4",
        workstation_type: "koc", supersedes_asset_id: Number(previous.assetId || 0), category: job.config.productId ? job.config.productName : "待分类", content_type: "KOC口播", asset_subtype: "AI-KOC成片",
        tags: ["AI KOC", "完整成片"], source_asset_ids: [], source_clip_ids: job.tasks.map(task => `${job.id}:clip-${task.index}`),
        framework_id: job.config.selectedScript?.id || "", framework_name: job.config.selectedScript?.title || "",
        render_id: job.id, variant_id: "final", maker_id: job.libtvOwner?.userId || "", maker_name: job.libtvOwner?.name || "",
        review_status: "pending", review_note: "完整分镜已拼接并通过文件验收；成片内容仍可在云管家审核", automatic_review_enabled: false,
        source_url: `https://hub.fandow.com${process.env.HUB_PUBLIC_BASE_PATH || "/yxb/wis-marketing-hub/"}modules/ai-first-creation/koc.html?task=${encodeURIComponent(job.id)}`
      });
      if (ticket.upload_required) {
        if (!ticket.upload_url) throw new Error("云管家没有返回成片上传地址");
        await upload(ticket, file, stat.size);
      }
      const receipt = ticket.status === "completed" ? ticket : await request("/returns/complete", { idempotency_key: idempotencyKey });
      const assetId = Number(receipt.asset_id || receipt.asset?.id || 0);
      if (receipt.status !== "completed" || !assetId) throw new Error("云管家尚未确认视频素材登记，请稍后补传");
      job.finalDelivery = { ...job.finalDelivery, status: "completed", assetId, objectKey: receipt.object_key || receipt.asset?.object_key || "", completedAt: new Date().toISOString(), error: "" };
      await save(job);
      return job.finalDelivery;
    } catch (error) {
      job.finalDelivery = { ...job.finalDelivery, status: "failed", error: error.message };
      await save(job);
      throw error;
    }
  }

  function deliver(job) {
    if (flights.has(job.id)) return flights.get(job.id);
    const flight = perform(job).finally(() => flights.delete(job.id));
    flights.set(job.id, flight);
    return flight;
  }
  return { deliver };
}

module.exports = { createKocFinalDelivery };

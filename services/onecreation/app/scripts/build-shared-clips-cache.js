const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const sourcePath = path.resolve(
  process.env.REMIX_LIBRARY_PATH
  || (process.platform === "win32"
    ? "H:\\codex输出\\AI智能混剪\\library.json"
    : path.join(packageRoot, "app", "remix-data", "library.json"))
);
const destination = path.join(
  packageRoot,
  "app",
  "assets",
  "remix-engine-runtime",
  "shared-clips-cache.json"
);

const library = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const records = [];
for (const item of library.items || []) {
  for (const clip of item.clips || []) {
    if (!/^https?:\/\//i.test(String(clip.sharedStorageUrl || ""))) continue;
    records.push({
      recordKey: `clip:${clip.id}`,
      recordType: "clip",
      title: `${item.productName || "历史有效成片"} · TOP${item.rank || "-"} · ${clip.stageLabel || "片段"}`,
      productName: item.productName || "",
      sourceType: "department_shared_cut",
      sourceUrl: item.sourceDocUrl || "",
      storageUrl: clip.sharedStorageUrl,
      parentKey: `feishu-asset:${item.id}`,
      status: "active",
      approved: clip.approved === true,
      metadata: {
        sourceId: item.id,
        clipId: clip.id,
        sourceRank: Number(item.rank || 0),
        productId: item.productId || "",
        productName: item.productName || "",
        start: Number(clip.start || 0),
        end: Number(clip.end || 0),
        duration: Number(clip.duration || 0),
        stage: clip.stage || "",
        stageLabel: clip.stageLabel || "",
        visualType: clip.visualType || "",
        transcript: clip.transcript || "",
        visibleText: clip.visibleText || "",
        cutBasis: clip.cutBasis || "",
        labelSource: clip.labelSource || "",
        confidence: Number(clip.confidence || 0),
        hasAudio: clip.hasAudio !== false,
        hasSpeechCandidate: clip.hasSpeechCandidate !== false,
        segmentationVersion: Number(clip.segmentationVersion || 0),
        preserveWhole: clip.preserveWhole === true,
        allowResplit: clip.allowResplit === true,
        thumbnailUrl: clip.sharedThumbnailUrl || "",
        sourceStorageUrl: item.sharedStorageUrl || ""
      }
    });
  }
}

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceLibraryUpdatedAt: library.updatedAt || "",
  segmentationVersion: Number(records[0]?.metadata?.segmentationVersion || 0),
  sourceCount: new Set(records.map((record) => record.metadata.sourceId)).size,
  clipCount: records.length,
  records
};
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(payload), "utf8");
process.stdout.write(JSON.stringify({
  ok: true,
  destination,
  sourceCount: payload.sourceCount,
  clipCount: payload.clipCount,
  bytes: fs.statSync(destination).size
}));

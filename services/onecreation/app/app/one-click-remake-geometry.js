const crypto = require("crypto");
const path = require("path");

const DEFAULT_GEOMETRY_TIMEOUT_MS = 30000;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBox(value) {
  const raw = Array.isArray(value)
    ? { x: value[0], y: value[1], width: value[2], height: value[3] }
    : value && typeof value === "object" ? value : {};
  const x = finiteNumber(raw.x ?? raw.left);
  const y = finiteNumber(raw.y ?? raw.top);
  const width = finiteNumber(raw.width ?? (finiteNumber(raw.right) != null && x != null ? Number(raw.right) - x : null));
  const height = finiteNumber(raw.height ?? (finiteNumber(raw.bottom) != null && y != null ? Number(raw.bottom) - y : null));
  if (x == null || y == null || !(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

function normalizePoint(value) {
  const raw = Array.isArray(value) ? { x: value[0], y: value[1] } : value && typeof value === "object" ? value : {};
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  return x == null || y == null ? null : { x, y };
}

function sourceInstancesFromAsset(sourceAsset = {}) {
  const facts = sourceAsset.productFacts || {};
  const rows = Array.isArray(facts.instances)
    ? facts.instances
    : Array.isArray(sourceAsset.productInstances) ? sourceAsset.productInstances : [];
  return rows.map((item, index) => {
    const bbox = normalizeBox(item?.bbox || item?.box || item?.boundingBox);
    if (!bbox) return null;
    return {
      id: String(item?.id || `source-instance-${index + 1}`),
      bbox,
      contactPoint: normalizePoint(item?.contactPoint || item?.contact || [bbox.x + bbox.width / 2, bbox.y + bbox.height]),
      occlusionOrder: finiteNumber(item?.occlusionOrder ?? item?.layerIndex) ?? index,
      visibleRatio: finiteNumber(item?.visibleRatio),
      confidence: finiteNumber(item?.confidence)
    };
  }).filter(Boolean);
}

function sourceGeometryReview(sourceAsset = {}) {
  const instances = sourceInstancesFromAsset(sourceAsset);
  const rawCount = Number(sourceAsset.productFacts?.productCount);
  const observedCount = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : null;
  const reliableInstanceCount = instances.length;
  let status = "ready";
  if (!reliableInstanceCount) status = "missing_instances";
  else if (observedCount != null && observedCount !== reliableInstanceCount) status = "count_conflict";
  return {
    status,
    observedCount,
    reliableInstanceCount,
    effectiveCount: observedCount ?? (reliableInstanceCount || null),
    requiresReview: status !== "ready"
  };
}

function buildGeometryManifest(input = {}) {
  const sourceAsset = input.sourceAsset || {};
  const instances = sourceInstancesFromAsset(sourceAsset);
  const observedCount = sourceGeometryReview(sourceAsset).effectiveCount;
  return {
    schemaVersion: "one-click-remake-geometry-v1",
    jobId: String(input.jobId || ""),
    targetId: String(input.targetId || ""),
    policy: "preserve_source_slots",
    quantityPolicy: "inherit_source_observation",
    sourceNodeKey: String(sourceAsset.nodeKey || ""),
    sourceImageUrl: String(sourceAsset.url || ""),
    sourceWidth: Math.max(0, Number(sourceAsset.width || 0)),
    sourceHeight: Math.max(0, Number(sourceAsset.height || 0)),
    observedCount,
    sourceInstances: instances,
    target: clone(input.target || {}),
    productReferenceUrls: (input.productReferenceUrls || []).map(String).filter(Boolean),
    invariants: [
      "one_source_instance_maps_to_one_target_instance",
      "preserve_source_center_contact_occlusion_and_order",
      "do_not_project_or_infer_global_quantity",
      "do_not_reuse_fixture_coordinates_or_counts"
    ]
  };
}

function sourceLayoutContract(sourceAsset = {}) {
  const manifest = buildGeometryManifest({ sourceAsset });
  const observed = manifest.observedCount
    ? `本节点审计观察到约 ${manifest.observedCount} 个可见实例；该数字只属于当前源图，不得迁移到其他节点。`
    : "本节点未得到可靠实例数；逐个按源图可见槽位替换，不猜测、不补造数量。";
  return [
    "【源画面实例与槽位继承】",
    "仅以当前源图为数量与布局依据：每个可辨识旧产品实例一对一替换为一个目标产品实例。",
    observed,
    "保留每个实例的中心位置、触地/承托面、遮挡层级、朝向、间距与整体画面占用区域；目标产品按自身包装比例适配槽位。",
    "禁止投影面积换算、全局目标数量、跨节点复用数量、固定个例数量、增生、漏换、融合、悬浮或穿模。"
  ].join("\n");
}

function geometryReferenceUrls(preparation = {}) {
  const artifacts = preparation.artifacts || {};
  return [
    artifacts.layoutGuideUrl || artifacts.geometryLayerUrl || artifacts.geometry_layer_url || artifacts.geometry_layer_uri,
    artifacts.productLayerUrl || artifacts.product_layer_url || artifacts.product_layer_uri
  ]
    .map((item) => item == null ? "" : String(item))
    .filter(Boolean);
}

function safeSegment(value, fallback = "source") {
  const raw = String(value || "");
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 100);
  return cleaned || `${fallback}-${crypto.createHash("sha1").update(raw || fallback).digest("hex").slice(0, 10)}`;
}

function imageExtension(url) {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? extension : ".png";
  } catch {
    return ".png";
  }
}

async function stageGeometryReferences(preparation = {}, options = {}) {
  const internalUrls = [...new Set(geometryReferenceUrls(preparation))];
  const sourceLabel = String(options.sourceLabel || options.sourceNodeKey || "当前源图");
  if (!internalUrls.length) throw new Error(`${sourceLabel} 的 OpenCV 几何服务没有返回可供生图使用的布局层`);
  if (typeof options.download !== "function" || typeof options.acquireToken !== "function" || typeof options.upload !== "function") {
    throw new Error("生图适配器不支持上传 OpenCV 几何参考图，无法把容器内网产物交给外部生图模型");
  }
  const credential = await options.acquireToken();
  const localDirectory = path.resolve(String(options.localDirectory || "."));
  const sourceNodeKey = safeSegment(options.sourceNodeKey, "source");
  const stagedArtifacts = [];
  for (let index = 0; index < internalUrls.length; index += 1) {
    const internalUrl = internalUrls[index];
    const localPath = path.join(localDirectory, `${sourceNodeKey}-${String(index + 1).padStart(2, "0")}${imageExtension(internalUrl)}`);
    await options.download(internalUrl, localPath);
    const providerUrl = await options.upload(localPath, credential?.token || "");
    if (!/^https?:\/\//i.test(String(providerUrl || ""))) throw new Error("OpenCV 几何参考图上传成功，但生图提供方没有返回可访问地址");
    stagedArtifacts.push({
      role: index === 0 ? "layout_guide" : "product_layer",
      internalUrl,
      localPath,
      providerUrl
    });
  }
  return {
    ...preparation,
    status: "ready",
    stagingStatus: "uploaded_to_generation_provider",
    stagedArtifacts,
    providerReferenceUrls: stagedArtifacts.map((item) => item.providerUrl)
  };
}

function createProductGeometryClient(options = {}) {
  const baseUrl = String(options.baseUrl || "").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_GEOMETRY_TIMEOUT_MS));
  if (!baseUrl || typeof fetchImpl !== "function") return null;
  return {
    status: () => ({ configured: true, baseUrl, timeoutMs, policy: "preserve_source_slots" }),
    async prepare(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/v1/product-geometry/prepare`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = body.detail && typeof body.detail === "object" ? body.detail : {};
          const error = new Error(body.message || detail.message || `OpenCV 几何服务响应 HTTP ${response.status}`);
          error.code = String(body.code || detail.code || "PRODUCT_GEOMETRY_FAILED");
          error.details = detail;
          throw error;
        }
        return { ...body, schemaVersion: body.schemaVersion || "one-click-remake-geometry-result-v1" };
      } catch (error) {
        if (error?.name === "AbortError") throw new Error(`OpenCV 几何服务 ${timeoutMs}ms 内未响应`);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

module.exports = {
  DEFAULT_GEOMETRY_TIMEOUT_MS,
  normalizeBox,
  sourceInstancesFromAsset,
  sourceGeometryReview,
  buildGeometryManifest,
  sourceLayoutContract,
  geometryReferenceUrls,
  stageGeometryReferences,
  createProductGeometryClient
};

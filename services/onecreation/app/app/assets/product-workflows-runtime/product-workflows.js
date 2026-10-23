"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const https = require("https");
const path = require("path");
const {
  DEFAULT_MODEL: DEFAULT_IMAGE_MODEL,
  imageModelLabel,
  normalizeImageModel
} = require("../gpt-image-runtime/gpt-image-client.js");
const {
  PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
  PRODUCT_PROFILES,
  activeReplacementLayers,
  filterReplacementAssets,
  formatProductQuantityStrategy,
  formatProductReplacementContract,
  formatProductScaleReference,
  productReplacementContract
} = require("./product-replacement-contracts.js");

const IMAGE_PATTERN = /\.(png|jpe?g)$/i;
const VIDEO_PATTERN = /\.(mp4|mov)$/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_REPLACEMENT_REFERENCE_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_REPLACEMENT_PRODUCT_IMAGES = 8;
const MAX_IMAGE_GENERATION_INPUTS = 9;
const REPLACEMENT_FIRST_FRAME_BATCH_SIZE = 2;
const REFERENCE_FIRST_FRAME_CANDIDATE_ID = "reference-first-frame";
const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 15 * 60 * 1000;
const REPLACEMENT_ANCHOR_INPUT_SCHEMA_VERSION = "one-click-replacement-shot-anchor-input-v3";
const REPLACEMENT_ANCHOR_DEPENDENCY_SCHEMA_VERSION = "one-click-replacement-anchor-dependency-v2";
const REPLACEMENT_CANONICAL_INVENTORY_QA_SCHEMA_VERSION = "one-click-replacement-canonical-inventory-qa-v1";
const AUTO_REPLACEMENT_QUANTITY_RULE = "原片明确只有一个产品对象时，一对一替换为一个目标产品；原片为多个、成组、堆叠、抱持或陈列时，保持原占用区域、量感、密度、重心、遮挡和可见库存，按目标产品真实尺寸、承托范围与人体可持握能力自动计算自然数量，不机械保持旧产品件数；只有原片明确发生拿出、放入、消耗或补充时才允许改变数量";

const IMAGE_GENERATION_STAGE_LABELS = Object.freeze({
  preparing_inputs: "准备生成素材",
  uploading_reference: "上传参考首帧",
  uploading_products: "上传目标产品图",
  creating_task: "提交生成任务",
  queued: "任务排队中",
  running: "模型生成中",
  recovering: "恢复生成任务",
  downloading: "下载生成结果",
  succeeded: "生成完成",
  failed: "生成失败"
});

const REFERENCE_FIRST_FRAME_CLEANUP_PROMPT = "将图片作为编辑底图，并对画面底部的所有字幕、说明文字、白色小字、右下角黑白标签及任何文字水印进行局部消除。根据文字周围原有画面内容进行无痕修复：自然补全文字周围的纹理、光影、颗粒与透视关系，以及被字幕遮挡的滑板边缘、迷彩纹理和人物衣物区域。严格保持人物身份、面部五官、发型、表情、肌肉线条、肤色、姿势、服装、道具、构图、镜头角度、景深、光线和画面尺寸完全不变。不得裁切画面，不得移动或新增物体，不得美化人物，不得改变背景，不得生成新的文字、符号、Logo 或模糊色块。消除区域必须与周围像素自然连续，无涂抹痕迹、重复纹理、边缘断裂及 AI 修补感，保持原图真实摄影质感和清晰度。";

const LEGACY_REPLACEMENT_FIRST_FRAME_EDIT_PROMPT = [
  "这是一次真实照片编辑任务，不是重新生成图片。",
  "【以第一张人物场景图作为主体原图】：",
  "保持人物、脸部、身体比例、姿势、手部动作、手指位置、衣服、背景环境、摄影角度、光线方向全部完全不变。",
  "使用第二张、第三张等白底产品图中的真实产品作为唯一产品来源，将人物手中原有产品精准替换为该产品。",
  "",
  "产品替换要求：",
  "产品外观一致性：",
  "必须100%保留白底产品图中的产品外观；",
  "保留真实包装尺寸比例、长宽高比例、颜色、材质、文字排版、LOGO位置；",
  "禁止重新设计产品；",
  "禁止改变包装结构；",
  "禁止增加、减少产品元素；",
  "产品上的文字必须保持真实清晰。",
  "产品尺寸比例控制：",
  "严格按照白底产品图中的真实产品比例进行缩放；",
  "不根据人物身体比例重新估算产品大小；",
  "不放大、不缩小、不拉伸、不压缩；",
  "产品在人物手中的视觉尺寸必须符合真实商品尺寸；",
  "保持产品长宽厚比例与白底参考图完全一致。",
  "产品透视匹配：",
  "根据原图人物手部握持方向调整产品角度：",
  "产品需要符合真实摄影透视；",
  "边缘线条与镜头角度一致；",
  "正面、侧面、顶部关系保持自然；",
  "不出现悬浮感；",
  "不出现错误透视。",
  "手部融合：",
  "保持原人物手指位置和握持姿势；",
  "让手指自然遮挡产品边缘；",
  "产品与手掌接触位置产生真实遮挡关系；",
  "添加符合现场光源方向的接触阴影。",
  "光影融合：",
  "产品必须匹配原图环境：",
  "使用原照片中的光线方向；",
  "保留真实反射、高光、阴影；",
  "产品材质表现与现场环境一致；",
  "不产生后期贴图感。",
  "最终效果：",
  "生成一张真实手机摄影效果图片，",
  "【看起来像原照片拍摄时人物本来拿的就是该产品。】",
  "",
  "禁止：",
  "改变人物；",
  "改变背景；",
  "改变构图；",
  "改变手势；",
  "重新生成包装；",
  "模糊产品文字；",
  "AI重绘产品。"
].join("\n");

const REPLACEMENT_FIRST_FRAME_EDIT_PROMPT = [
  "【这是一次真实照片编辑任务，以图1人物场景图作为主体原图】。",
  "以图1作为唯一编辑底图，仅将图1中的[旧产品]替换为图2、图3中的",
  "[新产品名称]，彻底清除旧包装，不改变图1中的其他内容。",
  "",
  "先识别旧产品在图1中的真实状态，包括位置、数量、朝向、透视、",
  "堆叠方式，以及它与手部、人物、桌面、地面、货架、抽屉、容器",
  "或其他物体之间的支撑、接触和遮挡关系。",
  "",
  "用新产品重建相同的空间和物理关系：",
  "被拿着时保持原手指和手臂遮挡；",
  "放在桌面或地面时准确接触平面并匹配阴影；",
  "在货架时与层板透视对齐；",
  "在抽屉、袋子或箱子内时保留容器边缘遮挡；",
  "堆叠或散落时保持原区域的密度、重心和占画面比例。",
  "",
  "新产品真实尺寸为[尺寸]。",
  "数量策略为[保持原数量 / 保持原区域体积自动调整数量 / 指定数量]。",
  "所有同款产品必须使用同一物理尺寸模板，不能通过缩小、拉伸",
  "或压扁产品制造数量感。",
  "",
  "严格参考图2、图3等，保持包装形状、材质、颜色、Logo、标签、",
  "产品名称和关键图案。匹配图1的光源、色温、透视、景深、",
  "环境反射和接触阴影，使产品自然融入原场景。",
  "",
  "只修改产品；人物、手部、家具、桌面、地面、货架、背景、",
  "构图、文字和水印全部保持不变。",
  "",
  "禁止旧产品残留、产品漂浮、穿模、尺寸错误、包装变形、",
  "Logo反向、参考图背景被复制、白边、光晕、额外文字和场景变化。"
].join("\n");

const REPLACEMENT_BACKGROUND_FIRST_FRAME_PROMPT = [
  "这是一次真实照片背景编辑任务，不是重新设计人物、产品或构图。",
  "以第一张参考视频关键帧作为唯一主体原图，只替换画面中的背景环境。",
  "人物身份、脸部、发型、身体比例、姿势、手部动作、服装、产品身份、产品数量、包装、文字、LOGO、产品与手部遮挡关系、摄影角度、构图和光线方向必须保持不变。",
  "新背景必须符合真实空间透视、景深、现场光线、接触阴影和反射关系，并与人物和产品自然融合。",
  "禁止新增、删除或替换人物、产品、手指、道具主体；禁止修改产品包装与固有文字；禁止字幕、标题、促销字、水印、边框、拼贴和无来源特效。",
  "最终效果应像在目标环境中真实拍摄的9:16竖屏手机照片。"
].join("\n");

const REPLACEMENT_TASK_VARIABLE_DEFAULTS = Object.freeze({
  originalProductName: "参考视频中的原产品",
  newProductName: "",
  productQuantityRule: "默认与参考视频一致",
  backgroundDescription: ""
});

function normalizeReplacementTaskVariables(input = {}, productName = "") {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const stringValue = (key, fallback, limit) => String(source[key] ?? fallback ?? "").trim().slice(0, limit);
  return {
    originalProductName: stringValue("originalProductName", REPLACEMENT_TASK_VARIABLE_DEFAULTS.originalProductName, 240),
    newProductName: String(productName || source.newProductName || "").trim().slice(0, 240),
    productQuantityRule: stringValue("productQuantityRule", REPLACEMENT_TASK_VARIABLE_DEFAULTS.productQuantityRule, 500),
    backgroundDescription: stringValue("backgroundDescription", REPLACEMENT_TASK_VARIABLE_DEFAULTS.backgroundDescription, 1200)
  };
}

function replacementBackgroundPrompt(basePrompt, backgroundDescription) {
  return [
    String(basePrompt || REPLACEMENT_BACKGROUND_FIRST_FRAME_PROMPT).trim(),
    `目标背景：${String(backgroundDescription || "").trim()}`,
    "只允许改变背景环境；人物、产品、产品数量、包装、文字、LOGO、动作、构图和镜头状态必须保持不变。"
  ].filter(Boolean).join("\n\n");
}

const SCENE_BLUEPRINT_FIELDS = Object.freeze([
  { key: "scene_type", label: "场景类型", fallback: "场景定位" },
  { key: "style_palette", label: "风格与配色", fallback: "色彩" },
  { key: "lighting", label: "固定光线", fallback: "光影" },
  { key: "materials", label: "固定材质", fallback: "材质" },
  { key: "props", label: "固定道具清单", fallback: "道具" },
  { key: "layout_lock", label: "空间与相对位置锁定", fallback: "构图" },
  { key: "placement_zone", label: "主体预留区", fallback: "场景定位" },
  { key: "negative_constraints", label: "真实感与禁止项", fallback: "真实感" }
]);

const ANGLES = Object.freeze([
  {
    id: "flat",
    label: "平拍",
    versionLabel: "平视角度版",
    prompt: [
      "摄影机高度与主体预留承托面接近，采用严格水平视角，向下俯角不超过10°。",
      "使用接近35-50mm等效焦段的自然透视和中等景深，重点呈现主体预留区与中景空间关系，并保留适度的前景、背景层次。",
      "画面核心必须落在中景预留区域；禁止明显俯视、高机位斜拍、超广角畸变或把预留承托面压缩成窄条。"
    ].join("\n")
  },
  {
    id: "overhead",
    label: "俯拍",
    versionLabel: "俯视角度版",
    prompt: [
      "摄影机位于主体预留承托面的正上方，以80°-90°俯视，镜头光轴近乎垂直向下。",
      "完整呈现展示面的边界、固定道具布局、相对位置和主体预留区，所有空间关系必须与共享场景蓝图一致。",
      "保持自然透视与清晰布局；禁止斜俯视、平视、侧拍、地平线入镜或为了填满画面而新增、删减、移动固定道具。"
    ].join("\n")
  },
  {
    id: "closeup",
    label: "特写",
    versionLabel: "特写角度版",
    prompt: [
      "摄影机必须从平拍母图机位向主体预留区真实推进，明确拉近至少一个完整景别，只呈现共享场景中的局部近景，不拍摄完整大场景。",
      "特写画面的可见空间宽度只能约为平拍母图的35%-55%，主体预留区在画面中的占比必须明显增大；至少一个平拍画面中完整可见的固定道具或场景边界应在特写中自然出画或只保留局部。",
      "使用接近50-85mm等效焦段、近距离重新对焦和自然浅景深，突出承托面纹理、材质光泽、接触区域及局部装饰，前后景虚化程度必须明显强于平拍。",
      "必须重新计算近距离机位的真实透视、遮挡和景深，不能把平拍母图直接裁切或数码放大。禁止与平拍母图保持相同取景范围、相同镜头距离、相同完整构图或近似画面；禁止切换为新布景、极端微距、抽象纹理或丢失场景身份。"
    ].join("\n")
  }
]);

const PENDING_PRODUCTS = Object.freeze([
  { id: "wis-microneedle-mask", name: "WIS微针面膜", shortName: "微针面膜", assetStatus: "pending" },
  { id: "wis-neck-mask", name: "WIS颈膜", shortName: "颈膜", assetStatus: "pending" },
  {
    id: "wis-whitening-ampoule",
    name: PRODUCT_PROFILES["wis-whitening-ampoule"].platformName,
    shortName: PRODUCT_PROFILES["wis-whitening-ampoule"].shortName,
    assetStatus: PRODUCT_PROFILES["wis-whitening-ampoule"].assetStatus
  }
]);

const AMPOULE_ASSET_ROLES = Object.freeze([
  { id: "package_box", label: "次抛外盒" },
  { id: "ampoule_strip", label: "次抛联排" },
  { id: "single_ampoule", label: "次抛单支" }
]);

function isoNow() {
  return new Date().toISOString();
}

function identifier(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

function text(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function findAngle(angleId) {
  const angle = ANGLES.find((item) => item.id === String(angleId || ""));
  if (!angle) throw new Error("不支持的产品图角度");
  return angle;
}

function extractMotherPrompt(value) {
  const source = text(value, 8000);
  const heading = /(?:^|\n)\s*二[、.．:\s]*可复用中文母提示词\s*[：:]?\s*/i;
  const match = heading.exec(source);
  return match ? source.slice(match.index + match[0].length).trim() : source;
}

function normalizedSceneBlueprint(analysis = {}, blueprint = {}) {
  return SCENE_BLUEPRINT_FIELDS.map((field) => ({
    ...field,
    value: String(blueprint?.[field.key] || blueprint?.[field.label] || analysis?.[field.fallback] || "").trim()
  }));
}

function buildEmptyScenePrompt(input = {}) {
  const angle = findAngle(input.angleId);
  const motherPrompt = extractMotherPrompt(input.prompt || input.confirmedPrompt);
  const selectedImageModelLabel = imageModelLabel(input.imageModel || DEFAULT_IMAGE_MODEL);
  const resolution = ["1K", "2K", "4K"].includes(input.resolution) ? input.resolution : "1K";
  const anchorCandidateId = text(input.anchorCandidateId, 160);
  return [
    `使用${selectedImageModelLabel}生成一张9:16竖版、${resolution}、真实摄影质感的无产品空场景图。`,
    "共享母提示词与场景一致性蓝图是唯一的场景身份定义。固定空间、布景、材质、道具种类与数量、道具相对位置、光线方向、色温和配色不得改变。",
    `本次只生成【${angle.versionLabel}】，页面角度为“${angle.label}”。不要同时输出其他机位。`,
    angle.prompt,
    anchorCandidateId
      ? angle.id === "closeup"
        ? "输入参考图是本任务刚生成的平拍空场景母图，只用于锁定同一空间身份、布景、道具、材质、配色和光线。当前特写必须让摄影机在真实三维空间中明显靠近主体预留区，输出比平拍更紧、更近、景深更浅的全新机位；绝不能复用平拍的取景范围或构图，也不能用裁切、旋转、拉伸、局部放大代替真实机位推进。"
        : "输入参考图是本任务刚生成的平拍空场景母图。只用它锁定同一空间身份、布景、道具、材质、配色和光线；必须按当前机位重新建立真实透视与遮挡关系，禁止直接裁切、旋转、拉伸或局部放大母图。"
      : "本次平拍母图必须从零生成全新的空间画面；上传的原始场景参考图只用于文字反推，不得作为像素或构图参考直接复刻。",
    motherPrompt ? `用户确认的场景母提示词与一致性蓝图：${motherPrompt}` : "场景母提示词：干净、克制、适合护肤品展示的真实生活场景与自然光。",
    "场景母提示词来自参考图的风格分析，但结果必须是全新的图片；禁止复制、重绘、裁切、放大、仅换角度或仅调色原始上传图，禁止复刻原图像素与精确构图。",
    "可以保留可复用的场景类型、材质关系、光影语言和色彩气质，但要在符合真实空间逻辑的前提下重新安排前景、中景、背景和非商品道具。",
    "不得把参考图中的任何产品、包装、瓶罐、盒子、品牌、Logo或可读文字带入结果。",
    "输出必须是完全不含产品的空场景，为后续加入真实产品白底图预留自然、合理且可接触的摆放区域。",
    "负面约束词：白底、纯白背景、影棚背景、棚拍感、摄影棚布光、道具错位、道具漂浮、比例错误、空间空洞、缺少生活细节、风格跑偏、场景逻辑冲突、构图失衡、过度商业广告感。",
    "同时不得出现护肤品容器、商品包装、人物手持产品、字幕、标题、水印、价格、功效文案或促销信息。",
    "材质、重力、接触阴影、反射和景深必须符合真实摄影，不做悬浮、畸变或过度广告特效。"
  ].join("\n");
}

const buildProductImagePrompt = buildEmptyScenePrompt;

function mimeForImage(filePath) {
  return path.extname(String(filePath || "")).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
}

function requestJson(target, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const transport = url.protocol === "http:" ? http : https;
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const request = transport.request(url, {
      method: options.method || "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        ...(body ? { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      },
      timeout: options.timeout || 120000
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes <= 4 * 1024 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let payload = {};
        try {
          if (/^\s*data:/m.test(raw)) {
            let content = "";
            let model = "";
            let lastPayload = {};
            for (const line of raw.split(/\r?\n/)) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              const chunkPayload = JSON.parse(data);
              lastPayload = chunkPayload;
              model ||= String(chunkPayload?.model || "");
              content += String(
                chunkPayload?.choices?.[0]?.delta?.content
                ?? chunkPayload?.choices?.[0]?.message?.content
                ?? ""
              );
            }
            payload = content
              ? { ...lastPayload, model, choices: [{ message: { content } }] }
              : lastPayload;
          } else {
            payload = JSON.parse(raw || "{}");
          }
        } catch {
          reject(new Error("Qwen图片理解接口返回了无法识别的内容"));
          return;
        }
        if (Number(response.statusCode || 500) >= 400) {
          reject(new Error(payload?.error?.message || payload?.message || `Qwen图片理解接口请求失败（${response.statusCode}）`));
          return;
        }
        if (payload?.error || (payload?.code && !payload?.choices && !payload?.output_text && !payload?.output)) {
          reject(new Error(payload?.error?.message || payload?.message || "Qwen图片理解接口返回业务错误"));
          return;
        }
        resolve(payload);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Qwen图片理解接口连接超时")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function assistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? payload?.output?.text ?? "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((item) => typeof item === "string" ? item : item?.text || item?.content || "").join("\n").trim();
  }
  return "";
}

function parseAssistantJson(payload) {
  const raw = assistantText(payload).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!raw) throw new Error("qwen3.7-plus没有返回可用的结构化结果");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    return parsed;
  } catch {
    throw new Error("qwen3.7-plus返回的视频分析结果不是合法JSON");
  }
}

function normalizeJsonLikeQuotes(value) {
  const source = String(value || "");
  let result = "";
  let quote = "";
  let escaping = false;
  for (const character of source) {
    if (!quote) {
      if (character === "\"" || character === "'") {
        quote = character;
        result += "\"";
      } else {
        result += character;
      }
      continue;
    }
    if (escaping) {
      if (quote === "'" && character === "'") result += "'";
      else result += `\\${character}`;
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      continue;
    }
    if (character === quote) {
      quote = "";
      result += "\"";
      continue;
    }
    result += quote === "'" && character === "\"" ? "\\\"" : character;
  }
  if (quote) return source;
  if (escaping) result += "\\\\";
  return result;
}

function parseStructuredSceneJson(value) {
  const source = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const candidates = new Set([source]);
  if (/^(?:["']?)(?:visual_analysis|视觉特征拆解)(?:["']?)\s*:/i.test(source)) {
    candidates.add(`{${source}}`);
  }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.add(source.slice(start, end + 1));
  const dimensions = ["场景定位", "构图", "光影", "色彩", "材质", "道具", "镜头语言", "真实感"];
  const hasStructuredFields = dimensions.every((key) => source.includes(key)) && /["']?mother_prompt["']?\s*:/i.test(source);
  if (start >= 0 && hasStructuredFields) {
    const analysisAndMotherPrompt = source.slice(start);
    candidates.add(`{"visual_analysis": ${analysisAndMotherPrompt}`);
    candidates.add(`{"visual_analysis": ${analysisAndMotherPrompt}}`);
  }
  for (const candidate of candidates) {
    for (const normalized of new Set([candidate, normalizeJsonLikeQuotes(candidate)])) {
      try {
        const parsed = JSON.parse(normalized);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {}
    }
  }
  return null;
}

function formatStructuredScenePrompt(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const dimensions = ["场景定位", "构图", "光影", "色彩", "材质", "道具", "镜头语言", "真实感"];
  const parsed = parseStructuredSceneJson(raw);
  if (parsed) {
    const analysis = parsed.visual_analysis || parsed["视觉特征拆解"] || {};
    const motherPrompt = String(parsed.mother_prompt || parsed["可复用中文母提示词"] || "").trim();
    if (motherPrompt && dimensions.every((key) => String(analysis[key] || "").trim())) {
      const blueprint = normalizedSceneBlueprint(
        analysis,
        parsed.scene_blueprint || parsed["场景一致性蓝图"] || {}
      );
      return [
        "一、视觉特征拆解",
        ...dimensions.map((key, index) => `${index + 1}. ${key}：${String(analysis[key]).trim()}`),
        "",
        "二、可复用中文母提示词",
        motherPrompt,
        "",
        "三、场景一致性蓝图",
        ...blueprint.map((field, index) => `${index + 1}. ${field.label}：${field.value}`)
      ].join("\n");
    }
  }
  const motherHeading = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:二[、.．:\s]*)?(?:可复用)?(?:中文)?母提示词\s*[：:]?\s*/im;
  const match = motherHeading.exec(raw);
  if (match && match.index > 0) {
    const analysis = raw.slice(0, match.index).replace(/^\s*(?:#{1,6}\s*)?(?:一[、.．:\s]*)?视觉特征拆解\s*[：:]?\s*/i, "").trim();
    const motherPrompt = raw.slice(match.index + match[0].length).trim();
    if (analysis && motherPrompt) return `一、视觉特征拆解\n${analysis}\n\n二、可复用中文母提示词\n${motherPrompt}`;
  }
  return raw;
}

function hasCompleteScenePrompt(value) {
  const prompt = String(value || "");
  return prompt.includes("视觉特征拆解")
    && prompt.includes("可复用中文母提示词")
    && prompt.includes("场景一致性蓝图");
}

function readQwenProviderConfig() {
  const appData = String(process.env.APPDATA || process.env.LOCALAPPDATA || process.env.HOME || "").trim();
  const configPath = appData ? path.join(appData, "FanDo", "fando-providers.json") : "";
  if (!configPath) return { apiKey: "", apiKeys: [], source: "" };
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const apiKeys = [
      parsed?.providerSecrets?.qwen?.apiKey || parsed?.apiKeys?.qwen,
      parsed?.providerSecrets?.jenvideo?.apiKey || parsed?.apiKeys?.jenvideo
    ].map((value) => String(value || "").trim()).filter((value, index, values) => value && values.indexOf(value) === index);
    return apiKeys.length
      ? { apiKey: apiKeys[0], apiKeys, source: "fando-provider" }
      : { apiKey: "", apiKeys: [], source: "" };
  } catch {
    return { apiKey: "", apiKeys: [], source: "" };
  }
}

function isQwenCredentialError(error) {
  return /token\s*(?:expired|replaced)|(?:expired|replaced)\s*token|unauthori[sz]ed|forbidden|invalid\s*(?:token|api\s*key)|(?:http\s*)?(?:401|403)|鉴权|认证失败|(?:登录)?凭(?:证|据).*(?:失效|过期)|密钥.*(?:失效|过期)|令牌.*(?:失效|过期)/i.test(String(error?.message || error || ""));
}

function isQwenQuotaError(error) {
  return /高阶模型额度.*(?:消耗完毕|用完|用尽|耗尽|不足)|额度.*(?:消耗完毕|用完|用尽|耗尽)|(?:quota|credit).*(?:exhausted|exceeded|depleted|insufficient)|insufficient.*(?:quota|credit)/i.test(String(error?.message || error || ""));
}

const QWEN_QUOTA_MESSAGE = "Qwen 高阶模型额度已用完，图片反推暂不可用；补充额度后再次调用即可恢复，其他功能不受影响。";

function qwenAuthorizationValue(apiKey) {
  const value = String(apiKey || "").trim();
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

function createQwenPromptClient(options = {}) {
  const providerConfig = readQwenProviderConfig();
  const fandoApiKey = String(process.env.fando || process.env.FANDO || "").trim();
  const staticApiKeys = (options.apiKey !== undefined
    ? [options.apiKey]
    : [
        ...(providerConfig.apiKeys || []),
        process.env.QWEN_IMAGE_PROMPT_API_KEY,
        process.env.QWEN_API_KEY,
        fandoApiKey,
        process.env.KOC_GPT_IMAGE_TOKEN,
        process.env.JENVIDEO_GEN_TOKEN,
        process.env.GEN_TOKEN
      ])
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const hasDynamicCredentials = typeof options.resolveApiKeys === "function";
  const apiKey = staticApiKeys[0] || "";
  const defaultBaseUrl = apiKey ? "https://cloud.fandow.com/gpt/company-system-jump"
    : (hasDynamicCredentials ? "https://cloud.fandow.com/gpt/company-system-jump" : "");
  const baseUrl = String(
    options.baseUrl !== undefined
      ? options.baseUrl
      : (process.env.QWEN_IMAGE_PROMPT_BASE_URL || defaultBaseUrl)
  ).trim().replace(/\/+$/, "");
  const endpoint = String(options.endpoint ?? process.env.QWEN_IMAGE_PROMPT_ENDPOINT ?? "/v1/chat/completions").trim();
  const model = String(options.model ?? process.env.QWEN_IMAGE_PROMPT_MODEL ?? "qwen3.7-plus").trim();
  const sysName = String(options.sysName ?? process.env.QWEN_IMAGE_PROMPT_SYS_NAME ?? "openclaw").trim();
  const quotaStatusFile = String(options.quotaStatusFile ?? process.env.QWEN_QUOTA_STATUS_FILE ?? "").trim();
  let endpointPath = endpoint.replace(/^\/+/, "");
  if (/\/v1$/i.test(baseUrl) && /^v1\//i.test(endpointPath)) endpointPath = endpointPath.slice(3);
  const target = /^https?:\/\//i.test(endpoint) ? endpoint : `${baseUrl}/${endpointPath}`;

  function status() {
    let quotaExhausted = false;
    if (quotaStatusFile) {
      try {
        quotaExhausted = JSON.parse(fs.readFileSync(quotaStatusFile, "utf8"))?.quotaExhausted === true;
      } catch {}
    }
    return {
      configured: Boolean(baseUrl && (apiKey || hasDynamicCredentials) && sysName),
      model,
      baseUrl: baseUrl || "",
      ...(quotaExhausted ? { quotaExhausted: true, quotaMessage: QWEN_QUOTA_MESSAGE } : {})
    };
  }

  async function persistQuotaStatus(error) {
    if (!quotaStatusFile) return;
    await fsp.mkdir(path.dirname(quotaStatusFile), { recursive: true });
    await fsp.writeFile(quotaStatusFile, JSON.stringify({
      quotaExhausted: true,
      message: String(error?.message || error || ""),
      updatedAt: new Date().toISOString()
    }), "utf8");
  }

  async function clearQuotaStatus() {
    if (!quotaStatusFile) return;
    await fsp.rm(quotaStatusFile, { force: true }).catch(() => {});
  }

  async function requestCredentialEntries() {
    const dynamicValues = hasDynamicCredentials
      ? await options.resolveApiKeys()
      : [];
    const dynamicApiKeys = (Array.isArray(dynamicValues) ? dynamicValues : [dynamicValues])
      .map((value) => String(value?.token || value?.apiKey || value || "").trim())
      .filter(Boolean);
    const seen = new Set();
    return [
      ...dynamicApiKeys.map((value) => ({ value, dynamic: true })),
      ...staticApiKeys.map((value) => ({ value, dynamic: false }))
    ].filter((entry) => {
      if (seen.has(entry.value)) return false;
      seen.add(entry.value);
      return true;
    });
  }

  async function reportCredentialError(error, entry) {
    if (!entry?.dynamic || typeof options.onCredentialError !== "function") return;
    await Promise.resolve().then(() => options.onCredentialError(error)).catch(() => {});
  }

  async function requestWithProviderKeys(body) {
    if (!baseUrl || !sysName) throw new Error("qwen3.7-plus多模态接口尚未配置");
    const credentialEntries = await requestCredentialEntries();
    if (!credentialEntries.length) throw new Error("请先导入本人 FanDo 模型授权");
    for (let index = 0; index < credentialEntries.length; index += 1) {
      const credential = credentialEntries[index];
      try {
        const payload = await requestJson(target, {
          headers: {
            Authorization: qwenAuthorizationValue(credential.value),
            sys_name: sysName,
            Accept: "text/event-stream"
          },
          body
        });
        await clearQuotaStatus();
        return payload;
      } catch (error) {
        if (isQwenQuotaError(error)) {
          await persistQuotaStatus(error).catch(() => {});
          throw error;
        }
        if (isQwenCredentialError(error)) await reportCredentialError(error, credential);
        if (!isQwenCredentialError(error) || index === credentialEntries.length - 1) throw error;
      }
    }
    throw new Error("qwen3.7-plus多模态接口没有可用凭证");
  }

  function replacementAnalysisMessages(mediaContent, context = {}) {
    const duration = Math.max(0, Number(context.duration || 0));
    const productName = text(context.productName, 240) || "目标产品";
    const targetProductSize = text(context.targetProductSize, 1000) || "未提供明确尺寸，只能判断原片库存证据，不得猜测目标产品是否能放入";
    const productQuantityRule = text(context.productQuantityRule, 500) || "保持原数量";
    return [
      {
        role: "system",
        content: [
          "你是视频工作台的一键换品视频语义分析器，负责把用户上传的参考视频拆成可执行ShotPlan。",
          "必须按时间顺序识别真实切点、镜头功能、人物和产品动作、手部接触几何、运镜、产品露出、字幕口播线索、前后镜头连续性与复刻风险。",
          "分镜边界只允许建立在真实硬切、人物身份变化、场景变化、明显时间跳跃或镜头任务改变处；同一人物、同一场景且前后动作属于同一连续动作链时，必须归为同一个sourceShot，并写入该分镜的actionPhases，禁止把动作阶段误拆成多个分镜。",
          "一个sourceShot只能覆盖同一段连续人物身份关系：多人在同一时刻共同入镜可以保留在同一sourceShot；不同人物先后出现、前一人物退场后另一人物出现，或关键帧人物身份不兼容时，必须在人物交界处拆成不同sourceShot，不能因为都是女性、场景相同或动作相似而放在同一镜头。",
          "人物身份必须逐人建立subjectProfiles和逐镜头personTracks：‘都是女性/男性’只能描述性别，绝不能作为同一人物证据；五官、发型、体型属于主要身份特征，服饰、鞋帽、首饰和其他配饰只属于辅助特征。",
          "换装不能直接判定换人；但五官、发型、体型不清晰或不足以确认身份时，只要服饰或配饰发生变化，就必须阻止自动合并并降低identityConfidence。",
          "每次硬切后的身份判断都必须仅依据硬切后当前镜头重新建立，不得只继承上一镜头的personId；无法确认是否同一人物时宁可拆成不同sourceShot，使用临时personId并把identityConfidence设为低值，同时写入identityRisks。",
          "复杂动作必须写清动作主体、左右手/身体部位、运动路径、接触对象、开始与结束状态；双人互动必须标注low_reaction、active_support或co_action。",
          "只能描述视频中明确可见或可听的证据；无法确认的内容必须写为“未确认”并放入risks，不得用产品常识、广告经验或目标产品名称补全画面。",
          "禁止虚构原片中未出现的液体拉丝、滴液、精华流动、皮肤弹性变化、功效结果、材质结构或使用效果。目标产品名称只代表后续替换方向，不是原片证据。",
          "不得把旧产品身份写成目标产品真值；你只分析原片结构，后续会把旧产品替换为用户选择的新产品。",
          "只返回合法JSON，不使用Markdown。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          ...mediaContent,
          {
            type: "text",
            text: [
              `请深度拆解这条${duration ? `${duration.toFixed(2)}秒` : ""}参考视频，并为“替换成${productName}”提供结构化分析。`,
              "证据约束：只能写画面明确可见或音频明确可听的事实；不确定时写“未确认”。不得根据目标产品名推断颜色、材质、纹理、液体状态、功效或动作，不得把未出现的液体拉丝、滴液、精华流动写进action、actionGeometry、productExposure或deepDive。",
              "risks也必须基于原片可见/可听证据：如果动作字段没有明确液体运动，不得在risks中推测目标产品的精华粘稠度、液体残留、滴液或拉丝。",
              "顶层固定字段：summary、originalShotCount、deepDive、subjectProfiles、sourceShots、identityRisks、risks。原片镜头、镜头内动作阶段和最终视频生成节点是三种不同层级；这里只输出分析结果，不决定视频节点数量。",
              "deepDive固定字段：camera、bodyPosture、gazeExpression、handActions、speakingRhythm、productExposureLogic、transitionLogic、replicablePoints、avoidMechanicalCopy。",
              "subjectProfiles必须逐人输出，固定字段：personId、label、gender、primaryFeatures、auxiliaryFeatures、identityConfidence、evidence、firstSeenShotId；primaryFeatures固定含face、hair、bodyType，auxiliaryFeatures固定含clothing、accessories。性别相同不得提高identityConfidence。",
              "sourceShots必须是数组，originalShotCount必须与sourceShots.length完全一致；每项固定字段：id、start、end、title、shotType、scene、camera、motion、subjects、personTracks、identityConfidence、identityRisks、action、actionGeometry、interactionMode、productVisible、productExposure、sourceProductRole、sourceProductEvidence、transportContainerVisible、productLocator、inventoryEvidence、continuity、continuityGroup、sameShotAsPrevious、hardCutFromPrevious、visibleText、riskLevel、riskDimensions、confidence、recommendedReferencePolicy、referenceReason、keyMoments、actionPhases、stitchCandidates、stitchability。productVisible必须是布尔值。",
              "sourceProductRole只能是transport_container、retail_outer_box、primary_container、single_sachet、content_unit、none、unknown；运输纸箱、快递外箱、封箱胶带、防震纸和填充物一律属于transport_container，是场景容器而不是产品。只看见运输纸箱时必须sourceProductRole=transport_container、productVisible=false；只有零售外盒、产品直接容器、单片包装或内容物实际露出后，productVisible才可为true。",
              "人物手持、佩戴、揭下、触摸或展示旧产品时必须productVisible=true；这里的旧产品仅指零售外盒、直接容器、单片包装或内容物，不包括运输纸箱和场景容器。",
              "productLocator固定字段：screenPosition、relativeSize、orientation、recognitionSurface、supportSurface、contactPoints、occlusion、evidence；产品可见时必须按原片证据记录中心与位置、画面占比、三维朝向、最明显识别面、承托面、手指/工具接触点、前后遮挡和可见轮廓。不得只给一个旧产品框，也不得把运输纸箱的范围作为产品定位。",
              "每个sourceShot的personTracks必须逐人输出，固定字段：personId、label、role、screenPosition、actionOwner、visibleStart、visibleEnd、primaryFeatures、auxiliaryFeatures、identityConfidence、identityEvidence、identityReestablished。visibleStart/visibleEnd必须准确覆盖该人物实际可见区间；不同人物仅先后出现而没有同时入镜时必须拆成不同sourceShot，只有确实同屏或共同完成同一连续动作时才允许多个personTracks共存。人物动作必须通过personId/actionOwner绑定到具体人物，不能只写‘女性’或‘人物’。",
              "scene写可用于判断是否同一真实空间的稳定场景描述；continuityGroup为连续动作链写相同短标识。只有人物、场景一致且动作强关联时sameShotAsPrevious才可为true，此时应优先直接合并为一个sourceShot；出现硬切、换人、换场景或时间跳跃时hardCutFromPrevious必须为true。",
              "identityConfidence为0-1。只有当前镜头的五官、发型或体型主要特征与前镜头存在明确一致证据时才能建议合并；服饰与配饰只能辅助。硬切后的personTracks必须令identityReestablished=true并写当前镜头证据，否则identityConfidence不得高于0.49。无法确认时sameShotAsPrevious必须为false。",
              "时间单位为秒，start/end必须递增且覆盖视频主内容。keyMoments必须覆盖每个actionPhase以及每名顺序出现的人物，每项固定字段time、role、description、personId、phaseId、primaryFeatures、auxiliaryFeatures、identityConfidence；role只能是entry、action、exit、product。每个有人物的关键时刻必须写当前画面动作主体personId以及当前帧可见的五官、发型、体型、服饰和配饰证据，用于校验同一sourceShot内是否误混不同人物；不得只取开头、中间、结尾三张而漏掉人物或动作阶段。",
              "actionPhases给出本镜头内部按时间递增且完整覆盖的真实语义动作阶段，每项固定字段phaseId、start、end、action、criticalTime、personId、productVisible、riskLevel、transitionType、revealState、inventoryMutation；criticalTime必须位于该阶段内部并选择动作主体与产品状态最清晰的时刻。人物变化、动作目标变化或产品状态变化都必须新建阶段，不要把完整动作只写成一句总述。",
              "开箱、拆箱、开盖等连续动作必须按物理状态而不是抽帧数量规划：transitionType只能是reveal_only、cover_only、pick_up_visible_item、remove_item、insert_item、rearrange、unknown；revealState只能是pre_reveal、initial_reveal、partial_reveal、full_reveal、not_applicable。人物从已经可见的堆叠或怀抱产品中拿起一件并继续展示时，必须写pick_up_visible_item且inventoryMutation=false；只有从箱、盒、袋、包装等容器内部实际取出、放入或重新排列产品时inventoryMutation才为true。相同物理状态的重复画面仍可作为候选证据，但不得伪造成新的产品数量、排数、层数或摆放状态。",
              `开箱类sourceShot必须额外输出inventoryEvidence，固定字段canonicalStateAvailable、visibleTotalCount、rows、columns、layers、layout、orientation、spacing、targetProductFit、confidence、evidence。只有完整全开画面清楚展示库存边界时canonicalStateAvailable才可为true，并按可见证据填写数量和行列；看不清写null或“未确认”，不得用局部露出推算隐藏库存。目标产品真实尺寸：${targetProductSize}；数量策略：${productQuantityRule}。targetProductFit只能是compatible、incompatible、unknown；只有画面空间、目标真实尺寸和数量策略共同构成明确物理矛盾时才写incompatible，不确定必须写unknown。非开箱镜头也输出该对象，但canonicalStateAvailable=false、targetProductFit=unknown。`,
              "stitchCandidates给出适合拆分生成和无痕拼接的时间，每项固定字段time、score、reason；手正在接触产品、液体正在流动、口播未停顿或快速运镜中不得作为高分切点。stitchability为0-1。",
              "riskDimensions固定字段：action、physics、productIdentity、camera、continuity、audio，值均为0-100。riskLevel必须与这些维度的综合风险一致。",
              "recommendedReferencePolicy只能是video、keyframes、none：复杂接触/挤压/开合/涂抹/双人协作优先video；构图姿态重要但动作简单优先keyframes；静态陈列、通用空镜或旧产品污染风险高且动作不重要可用none。",
              "riskLevel只能是low、medium、high；confidence为0-1。"
            ].join("\n")
          }
        ]
      }
    ];
  }

  async function analyzeVideo(videoUrl, context = {}) {
    const url = String(videoUrl || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Qwen视频分析需要可访问的video_url");
    const body = {
      model,
      temperature: 0,
      max_tokens: 8000,
      stream: true,
      extra_body: { enable_thinking: false },
      response_format: { type: "json_object" },
      messages: replacementAnalysisMessages([{ type: "video_url", video_url: { url } }], context)
    };
    const payload = await requestWithProviderKeys(body);
    return { analysis: parseAssistantJson(payload), model, inputMode: "video_url" };
  }

  async function analyzeVideoFrames(framePaths, context = {}) {
    const paths = (Array.isArray(framePaths) ? framePaths : []).map((item) => path.resolve(String(item || ""))).slice(0, 12);
    if (!paths.length) throw new Error("Qwen视频降级分析缺少关键帧");
    const mediaContent = [];
    for (const framePath of paths) {
      if (!IMAGE_PATTERN.test(framePath)) continue;
      const stat = await fsp.stat(framePath).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_IMAGE_BYTES) continue;
      const dataUrl = `data:${mimeForImage(framePath)};base64,${(await fsp.readFile(framePath)).toString("base64")}`;
      mediaContent.push({ type: "image_url", image_url: { url: dataUrl } });
    }
    if (!mediaContent.length) throw new Error("Qwen视频降级分析没有可用关键帧");
    const body = {
      model,
      temperature: 0,
      max_tokens: 8000,
      stream: true,
      extra_body: { enable_thinking: false },
      response_format: { type: "json_object" },
      messages: replacementAnalysisMessages(mediaContent, {
        ...context,
        fallbackNotice: "当前输入是按时间顺序抽取的关键帧序列，请结合时间标签推断镜头结构。"
      })
    };
    body.messages[1].content.push({
      type: "text",
      text: `以上${mediaContent.length}张图片按视频时间先后排列，时间点依次为：${(context.frameTimes || []).slice(0, mediaContent.length).join("、")}秒。`
    });
    const payload = await requestWithProviderKeys(body);
    return { analysis: parseAssistantJson(payload), model, inputMode: "keyframe_fallback" };
  }

  async function adaptReplacementVoiceover(context = {}) {
    const sourceText = text(context.sourceText, 12000);
    if (!sourceText) throw new Error("原片口播为空，无法生成新口播建议");
    const productName = text(context.productName, 240);
    const productContract = context.productContract && typeof context.productContract === "object"
      ? context.productContract
      : null;
    if (!productName || !productContract) {
      return { proposedText: sourceText, replacements: [], warnings: [], unresolvedMentions: [], model, mode: "copy_only" };
    }
    const payload = await requestWithProviderKeys({
      model,
      temperature: 0,
      max_tokens: 5000,
      stream: true,
      extra_body: { enable_thinking: false },
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是一键换品的新口播契约编辑器。只能根据给定原片口播和目标SKU契约做必要替换。",
            "保持原文语气、句序、营销结构和可听信息密度；不要擅自扩写、删减、夸张或创造契约外功效。",
            "产品名称、别名、规格、成分、卖点和使用方式只能来自契约；无法确认的旧产品信息必须保留到unresolvedMentions，不能猜测。",
            "只返回合法JSON：proposedText、replacements、warnings、unresolvedMentions。replacements每项固定source、target、type、reason。"
          ].join("\n")
        },
        {
          role: "user",
          content: [
            `目标SKU：${productName}`,
            `目标SKU契约：${JSON.stringify(productContract)}`,
            `原片口播：\n${sourceText}`
          ].join("\n\n")
        }
      ]
    });
    const result = parseAssistantJson(payload);
    const proposedText = text(result.proposedText, 12000);
    if (!proposedText) throw new Error("Qwen 3.7 Plus 没有返回可用的新口播建议");
    return {
      proposedText,
      replacements: Array.isArray(result.replacements) ? result.replacements.slice(0, 100).map((item) => ({
        source: text(item?.source, 1000),
        target: text(item?.target, 1000),
        type: text(item?.type, 120),
        reason: text(item?.reason, 1000)
      })).filter((item) => item.source || item.target) : [],
      warnings: Array.isArray(result.warnings) ? result.warnings.map((item) => text(item, 1000)).filter(Boolean).slice(0, 30) : [],
      unresolvedMentions: Array.isArray(result.unresolvedMentions) ? result.unresolvedMentions.map((item) => text(item, 1000)).filter(Boolean).slice(0, 30) : [],
      model,
      mode: "product_contract_adaptation"
    };
  }

  async function completeJson(messages, requestOptions = {}) {
    if (!Array.isArray(messages) || !messages.length) throw new Error(`${model} 文本请求缺少 messages`);
    const payload = await requestWithProviderKeys({
      model,
      temperature: Number.isFinite(Number(requestOptions.temperature)) ? Number(requestOptions.temperature) : 0,
      max_tokens: Math.max(256, Math.min(12000, Number(requestOptions.maxTokens || 5000))),
      stream: requestOptions.stream !== false,
      extra_body: { enable_thinking: requestOptions.enableThinking === true },
      response_format: { type: "json_object" },
      messages
    });
    return {
      result: parseAssistantJson(payload),
      rawText: assistantText(payload).trim(),
      model
    };
  }

  function kocDeepDiveMessages(mediaContent, context = {}) {
    const chatFormat = context.chatFormat === "double" ? "双人唠嗑" : "单人唠嗑";
    const duration = Math.max(0, Number(context.duration || 0));
    const productName = text(context.productName, 240) || "目标产品";
    const referenceTranscript = text(context.referenceTranscript, 12000);
    const referenceTranscriptDiarized = text(context.referenceTranscriptDiarized, 16000);
    const newVoiceoverScript = text(context.newVoiceoverScript, 12000);
    const targetTotalDuration = Math.max(0, Number(context.targetTotalDuration || 0));
    return [
      {
        role: "system",
        content: [
          "你是AI-KOC原片复刻的多模态深度拆解器。你的输出会直接驱动人物场景候选图、逐分镜动作设计、资产审计和Seedance提示词。",
          "只能依据视频画面、音频和用户提供的原片逐字稿写结论；无法确认的内容必须明确写为未确认，不得用商品常识或广告经验补全。",
          "必须输出中文Markdown，不能只给时长摘要、产品露出计数或泛泛建议。",
          "必须覆盖：机位与构图、手机/镜头质感、人物姿态、头肩动作、目光、微表情、手势与闲置手位置、停顿与说话节奏、情绪曲线、产品露出逻辑、转场逻辑、应复刻点、不应机械照搬点。",
          "必须识别原片真实镜头切点并记录每镜start、end、镜头功能、动作、转场和情绪；用户新口播输入中的换行只是排版，绝不能直接作为分镜边界。",
          "输出末尾必须附带schema=koc-source-structure-v2的严格JSON代码块，包含sourceShots和newStoryboard。sourceShots每镜必须包含index、start、end、function、action、transition、emotion、productVisible、productEvidence；productVisible必须按原片实际画面判断，productEvidence说明产品出现方式和动作。newStoryboard必须结合原片结构与新口播语义重新规划，每段包含index、sourceShotIndexes、function、voiceover、reason、productVisible，voiceover逐段拼接后必须与规范化新口播逐字、逐标点一致。",
          "双人内容还必须逐条记录因果互动，并把非说话者动作分类为low_reaction、active_support或co_action。active_support/co_action必须写出执行者、肢体、画面侧、运动路径、开始/结束时间、重叠遮挡、保持时长，以及它与主讲台词的因果关系。",
          "源片中承载视觉含义的active_support和co_action属于强制复刻点，不能弱化为被动反应。",
          "结尾必须给出：原片产品连续可见段落次数、对应时间、强制复刻动作清单、可迁移结构清单、禁止机械复制清单、风险与未确认项。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          ...mediaContent,
          {
            type: "text",
            text: [
              `请深度拆解这条${duration ? `${duration.toFixed(2)}秒` : ""}${chatFormat}KOC原片。`,
              `后续替换目标是“${productName}”，但本阶段只分析原片，不得编造目标产品的包装、功效、质地或使用效果。`,
              referenceTranscript ? `原片逐字稿（仅用于校准说话节奏与台词时间）：\n${referenceTranscript}` : "原片逐字稿未提供，请根据可听内容谨慎判断并标注不确定项。",
              referenceTranscriptDiarized ? `XingChenASR说话人分段（保留时间顺序，不得调换台词归属）：\n${referenceTranscriptDiarized}` : "",
              newVoiceoverScript ? `规范化新口播全文（换行不代表分镜）：\n${newVoiceoverScript}` : "新口播未提供，无法输出newStoryboard。",
              targetTotalDuration ? `新片目标总时长：${targetTotalDuration}秒；最终生成分镜优先按每段12-14秒编排，确有总时长或语义限制时才允许更短；深拆JSON应保留真实语义边界，平台会在不改动口播原文的前提下执行最终时长归并。` : "",
              text(context.instruction, 12000)
            ].filter(Boolean).join("\n\n")
          }
        ]
      }
    ];
  }

  async function analyzeKocVideo(videoUrl, context = {}) {
    const url = String(videoUrl || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Qwen KOC视频分析需要可访问的video_url");
    const payload = await requestWithProviderKeys({
      model,
      temperature: 0,
      max_tokens: 8000,
      stream: true,
      extra_body: { enable_thinking: false },
      messages: kocDeepDiveMessages([{ type: "video_url", video_url: { url } }], context)
    });
    const deepDive = assistantText(payload).trim();
    if (deepDive.length < 200) throw new Error("qwen3.7-plus没有返回完整的KOC原片深度拆解");
    return { deepDive, model, inputMode: "video_url" };
  }

  async function analyzeKocFrames(framePaths, context = {}) {
    const paths = (Array.isArray(framePaths) ? framePaths : []).map((item) => path.resolve(String(item || ""))).slice(0, 16);
    if (!paths.length) throw new Error("Qwen KOC降级分析缺少关键帧");
    const mediaContent = [];
    for (const framePath of paths) {
      if (!IMAGE_PATTERN.test(framePath)) continue;
      const stat = await fsp.stat(framePath).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_IMAGE_BYTES) continue;
      const dataUrl = `data:${mimeForImage(framePath)};base64,${(await fsp.readFile(framePath)).toString("base64")}`;
      mediaContent.push({ type: "image_url", image_url: { url: dataUrl } });
    }
    if (!mediaContent.length) throw new Error("Qwen KOC降级分析没有可用关键帧");
    const messages = kocDeepDiveMessages(mediaContent, context);
    messages[1].content.push({
      type: "text",
      text: `以上${mediaContent.length}张图片按原片时间先后排列，时间点依次为：${(context.frameTimes || []).slice(0, mediaContent.length).join("、")}秒。关键动作可能发生在相邻帧之间，无法确认时必须标注未确认。`
    });
    const payload = await requestWithProviderKeys({
      model,
      temperature: 0,
      max_tokens: 8000,
      stream: true,
      extra_body: { enable_thinking: false },
      messages
    });
    const deepDive = assistantText(payload).trim();
    if (deepDive.length < 200) throw new Error("qwen3.7-plus没有返回完整的KOC关键帧深度拆解");
    return { deepDive, model, inputMode: "keyframe_fallback" };
  }

  async function reversePrompt(filePath) {
    if (!baseUrl || !sysName) throw new Error("qwen3.7-plus图片反推接口尚未配置");
    const resolved = path.resolve(String(filePath || ""));
    if (!IMAGE_PATTERN.test(resolved)) throw new Error("参考图仅支持PNG或JPG");
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new Error("参考图不存在");
    if (stat.size > MAX_IMAGE_BYTES) throw new Error("参考图不能超过10MB");
    const dataUrl = `data:${mimeForImage(resolved)};base64,${(await fsp.readFile(resolved)).toString("base64")}`;
    const body = {
        model,
        temperature: 0,
        max_tokens: 3000,
        stream: true,
        extra_body: { enable_thinking: false },
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是专业的产品摄影场景分析师和中文图像提示词设计师。",
              "请根据用户上传的场景参考图，建立一套详细、可复用的中文提示词反推结果，不得只输出一句简单提示词。",
              "只分析场景本身，不描述、不识别也不保留参考图中的任何产品、商品包装、品牌、Logo、人物手持商品、可读文字、价格或促销信息。",
              "必须严格按照用户要求的三部分结构完成分析；使用中文，信息具体、客观、可执行，不输出额外寒暄或免责声明。",
              "最终只返回一个合法JSON对象，不使用Markdown代码块。固定格式为：{\"visual_analysis\":{\"场景定位\":\"...\",\"构图\":\"...\",\"光影\":\"...\",\"色彩\":\"...\",\"材质\":\"...\",\"道具\":\"...\",\"镜头语言\":\"...\",\"真实感\":\"...\"},\"mother_prompt\":\"...\",\"scene_blueprint\":{\"scene_type\":\"...\",\"style_palette\":\"...\",\"lighting\":\"...\",\"materials\":\"...\",\"props\":\"...\",\"layout_lock\":\"...\",\"placement_zone\":\"...\",\"negative_constraints\":\"...\"}}。所有字段都必须填写。"
            ].join("\n")
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              {
                type: "text",
                text: [
                  "请根据我上传的场景图，建立一套可复用的中文提示词反推结果，不要只输出一句简单提示词，而要严格按以下结构输出：",
                  "",
                  "一、视觉特征拆解",
                  "请分别以明确的小标题，详细拆解以下8个维度：",
                  "1. 场景定位：场景类型、空间用途、环境氛围、主体适合出现的位置；",
                  "2. 构图：画面比例、视觉中心、前中后景层次、留白、主体预留区域；",
                  "3. 光影：主光方向、光质、明暗关系、阴影、反射、高光和曝光感受；",
                  "4. 色彩：主色、辅助色、色温、饱和度、明度与整体配色关系；",
                  "5. 材质：台面、墙面、背景及主要表面的材质、纹理和反光特征；",
                  "6. 道具：只描述与场景氛围有关的非商品道具、摆放关系、数量和尺度；",
                  "7. 镜头语言：视角、景别、机位高度、焦段感、透视、景深与摄影风格；",
                  "8. 真实感：自然使用痕迹、空间尺度、重力、接触阴影、材质细节及需要避免的AI痕迹。",
                  "",
                  "二、可复用中文母提示词",
                  "将上述拆解抽象、整合成一套完整的中文母提示词。母提示词需要适用于后续换场景复用，保留可迁移的构图、光影、色彩、材质、镜头语言和真实感规则；对可替换的场景内容使用清晰的通用描述，不绑定参考图中的特定商品或品牌。",
                  "母提示词必须能直接用于后续生成9:16竖版、无产品空场景，并为平拍、俯拍、特写三个角度预留合理的主体摆放区域。",
                  "",
                  "三、场景一致性蓝图",
                  "请把跨机位不得改变的内容整理到scene_blueprint：场景类型、风格配色、光线、材质、固定道具清单、空间与相对位置锁定、主体预留区、真实感与禁止项。",
                  "道具位置使用真实空间关系描述，例如“主体预留区左后方约30厘米”，不要使用只对单张图片有效的像素坐标。",
                  "请只按系统指定的JSON字段返回；页面会自动排版为视觉特征拆解、可复用中文母提示词和场景一致性蓝图。"
                ].join("\n")
              }
            ]
          }
        ]
    };
    let prompt = "";
    const credentialEntries = await requestCredentialEntries();
    if (!credentialEntries.length) throw new Error("请先导入本人 FanDo 模型授权");
    for (let index = 0; index < credentialEntries.length; index += 1) {
      const credential = credentialEntries[index];
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const requestBody = attempt === 0
            ? body
            : {
                ...body,
                messages: [
                  ...body.messages,
                  {
                    role: "user",
                    content: "上一次输出未通过固定结构验收。请重新分析同一张图片，只返回包含 visual_analysis、mother_prompt、scene_blueprint 三个顶层字段的完整 JSON 对象；visual_analysis 必须包含场景定位、构图、光影、色彩、材质、道具、镜头语言、真实感八个中文字段。"
                  }
                ]
              };
          const payload = await requestJson(target, {
            headers: {
              Authorization: qwenAuthorizationValue(credential.value),
              sys_name: sysName,
              Accept: "text/event-stream"
            },
            body: requestBody
          });
          prompt = formatStructuredScenePrompt(assistantText(payload));
          if (hasCompleteScenePrompt(prompt)) {
            await clearQuotaStatus();
            return { prompt, model };
          }
        }
        break;
      } catch (error) {
        if (isQwenQuotaError(error)) {
          await persistQuotaStatus(error).catch(() => {});
          throw error;
        }
        if (isQwenCredentialError(error)) await reportCredentialError(error, credential);
        if (!isQwenCredentialError(error) || index === credentialEntries.length - 1) throw error;
      }
    }
    if (!prompt) throw new Error("qwen3.7-plus没有返回可用的图片提示词");
    throw new Error("qwen3.7-plus返回的场景提示词结构不完整，请重试");
  }

  return { status, reversePrompt, analyzeVideo, analyzeVideoFrames, analyzeKocVideo, analyzeKocFrames, adaptReplacementVoiceover, completeJson };
}

function clampNumber(value, minimum, maximum, fallback = minimum) {
  const numeric = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? numeric : fallback));
}

function replacementReferencePolicy(value, fallback = "keyframes") {
  return ["video", "keyframes", "none"].includes(String(value || "")) ? String(value) : fallback;
}

function replacementRiskLevel(value) {
  return ["low", "medium", "high"].includes(String(value || "")) ? String(value) : "medium";
}

function replacementSemanticLabel(value) {
  return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function replacementSemanticLabelMatches(left, right) {
  const a = replacementSemanticLabel(left);
  const b = replacementSemanticLabel(right);
  return Boolean(a && b && (a === b || (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a)))));
}

function replacementGenderOnlyLabel(value) {
  const normalized = replacementSemanticLabel(value)
    .replace(/同一|另一|一个|一名|两名|多名|几名|年轻|成年|中年|年长|老年|主要|次要|前景|后景|左侧|右侧|画面中|主体/gu, "");
  return /^(?:女性|女人|女生|女孩|女演员|男性|男人|男生|男孩|男演员|人物|人|female|woman|women|girl|male|man|men|boy|person|people|subject)+$/iu.test(normalized);
}

function normalizeReplacementIdentityFeatures(input = {}, fallback = {}) {
  const primaryInput = input?.primaryFeatures && typeof input.primaryFeatures === "object" ? input.primaryFeatures : {};
  const auxiliaryInput = input?.auxiliaryFeatures && typeof input.auxiliaryFeatures === "object" ? input.auxiliaryFeatures : {};
  const fallbackPrimary = fallback?.primaryFeatures && typeof fallback.primaryFeatures === "object" ? fallback.primaryFeatures : {};
  const fallbackAuxiliary = fallback?.auxiliaryFeatures && typeof fallback.auxiliaryFeatures === "object" ? fallback.auxiliaryFeatures : {};
  return {
    primaryFeatures: {
      face: text(primaryInput.face ?? input?.face ?? fallbackPrimary.face ?? fallback?.face, 800),
      hair: text(primaryInput.hair ?? input?.hair ?? fallbackPrimary.hair ?? fallback?.hair, 500),
      bodyType: text(primaryInput.bodyType ?? input?.bodyType ?? fallbackPrimary.bodyType ?? fallback?.bodyType, 500)
    },
    auxiliaryFeatures: {
      clothing: text(auxiliaryInput.clothing ?? input?.clothing ?? fallbackAuxiliary.clothing ?? fallback?.clothing, 800),
      accessories: text(auxiliaryInput.accessories ?? input?.accessories ?? fallbackAuxiliary.accessories ?? fallback?.accessories, 800)
    }
  };
}

function replacementHasPrimaryIdentityEvidence(value = {}) {
  const primary = value?.primaryFeatures || {};
  return [primary.face, primary.hair, primary.bodyType].some((item) => Boolean(text(item, 800)) && !/未确认|不可见|不清晰|无法判断|遮挡|unknown|unclear/i.test(String(item)));
}

function normalizeReplacementSubjectProfile(profile = {}, index = 0) {
  const features = normalizeReplacementIdentityFeatures(profile);
  const personId = text(profile?.personId || profile?.id, 120) || `person-${String(index + 1).padStart(2, "0")}`;
  const identityConfidence = Number(clampNumber(profile?.identityConfidence ?? profile?.confidence, 0, 1, 0.4).toFixed(2));
  return {
    personId,
    label: text(profile?.label || profile?.name, 240) || personId,
    gender: text(profile?.gender, 80),
    ...features,
    identityConfidence,
    evidence: text(profile?.evidence || profile?.identityEvidence, 1200),
    firstSeenShotId: text(profile?.firstSeenShotId, 120),
    provisional: profile?.provisional === true || identityConfidence < 0.65 || !replacementHasPrimaryIdentityEvidence(features)
  };
}

function normalizeReplacementPersonTrack(track = {}, index = 0, options = {}) {
  const profile = options.profile && typeof options.profile === "object" ? options.profile : {};
  // personTracks must carry evidence observed in the current shot. Reusing profile features here
  // would let an old identity leak across a hard cut or hide a low-evidence current frame.
  const features = normalizeReplacementIdentityFeatures(track);
  const hardCutFromPrevious = options.hardCutFromPrevious === true;
  const identityReestablished = hardCutFromPrevious ? track?.identityReestablished === true : track?.identityReestablished !== false;
  let identityConfidence = clampNumber(track?.identityConfidence ?? track?.confidence ?? profile?.identityConfidence, 0, 1, 0.4);
  if (!replacementHasPrimaryIdentityEvidence(features)) identityConfidence = Math.min(identityConfidence, 0.49);
  if (hardCutFromPrevious && !identityReestablished) identityConfidence = Math.min(identityConfidence, 0.49);
  const visibleStart = clampNumber(track?.visibleStart, options.shotStart, options.shotEnd, options.shotStart);
  const visibleEnd = clampNumber(track?.visibleEnd, visibleStart, options.shotEnd, options.shotEnd);
  const personId = text(track?.personId || track?.id || profile?.personId, 120)
    || `unconfirmed-${text(options.shotId, 80) || "shot"}-${String(index + 1).padStart(2, "0")}`;
  const label = text(track?.label || track?.name || profile?.label || options.fallbackLabel, 240) || personId;
  const normalizedConfidence = Number(identityConfidence.toFixed(2));
  return {
    personId,
    label,
    gender: text(track?.gender || profile?.gender, 80),
    role: text(track?.role, 240),
    screenPosition: text(track?.screenPosition, 240),
    actionOwner: text(track?.actionOwner, 500),
    visibleStart: Number(visibleStart.toFixed(3)),
    visibleEnd: Number(visibleEnd.toFixed(3)),
    ...features,
    identityConfidence: normalizedConfidence,
    identityEvidence: text(track?.identityEvidence || track?.evidence, 1200),
    identityReestablished,
    identityReviewRequired: normalizedConfidence < 0.65,
    appearanceStates: [{
      start: Number(visibleStart.toFixed(3)),
      end: Number(visibleEnd.toFixed(3)),
      primaryFeatures: features.primaryFeatures,
      auxiliaryFeatures: features.auxiliaryFeatures
    }]
  };
}

function replacementPrimaryIdentityMatch(previous = {}, current = {}) {
  const previousPrimary = previous?.primaryFeatures || {};
  const currentPrimary = current?.primaryFeatures || {};
  return ["face", "hair", "bodyType"].some((key) => {
    const left = text(previousPrimary[key], 800);
    const right = text(currentPrimary[key], 800);
    return left && right && replacementSemanticLabelMatches(left, right)
      && !/未确认|不可见|不清晰|无法判断|遮挡|unknown|unclear/i.test(`${left} ${right}`);
  });
}

function replacementAuxiliaryIdentityChanged(previous = {}, current = {}) {
  const previousAuxiliary = previous?.auxiliaryFeatures || {};
  const currentAuxiliary = current?.auxiliaryFeatures || {};
  return ["clothing", "accessories"].some((key) => {
    const left = text(previousAuxiliary[key], 800);
    const right = text(currentAuxiliary[key], 800);
    return Boolean(left && right && !replacementSemanticLabelMatches(left, right));
  });
}

function replacementPersonTracksMatch(previous = {}, current = {}) {
  const previousTracks = Array.isArray(previous?.personTracks) ? previous.personTracks : [];
  const currentTracks = Array.isArray(current?.personTracks) ? current.personTracks : [];
  if (!previousTracks.length && !currentTracks.length) return { same: true, structured: false, reason: "当前镜头未检测到人物" };
  if (!previousTracks.length || previousTracks.length !== currentTracks.length) return { same: false, structured: true, reason: "人物数量或轨迹数量变化" };
  for (const currentTrack of currentTracks) {
    const previousTrack = previousTracks.find((track) => track.personId && track.personId === currentTrack.personId);
    if (!previousTrack) return { same: false, structured: true, reason: "当前人物缺少上一镜头的稳定personId证据" };
    if (previousTrack.identityConfidence < 0.65 || currentTrack.identityConfidence < 0.65) {
      return { same: false, structured: true, reason: "人物身份置信度不足，保守拆分" };
    }
    if (!replacementPrimaryIdentityMatch(previousTrack, currentTrack)) {
      return {
        same: false,
        structured: true,
        reason: replacementAuxiliaryIdentityChanged(previousTrack, currentTrack)
          ? "主要身份特征不清晰且服饰或配饰变化，禁止自动合并"
          : "缺少五官、发型或体型主要身份特征的一致证据"
      };
    }
  }
  return { same: true, structured: true, reason: "personId与主要身份特征一致" };
}

function replacementActionFamilies(value) {
  const source = String(value || "");
  return [
    ["mask_peel", /揭|撕|取下|膜布|面膜|mask|peel/i],
    ["product_hold", /拿起|手持|握持|捏住|展示|hold|grasp|show/i],
    ["product_open", /开盖|旋拧|打开|拔出|open|twist/i],
    ["product_apply", /涂|抹|贴|敷|按压|apply|spread/i],
    ["product_dispense", /挤|滴|倒|泵|喷|液体|dispense|pour|spray/i],
    ["speech_pose", /口播|说话|看镜头|微笑|姿态|speech|speak|smile|pose/i]
  ].filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

function sameReplacementSemanticShot(previous, current) {
  if (!previous || !current) return false;
  if (Math.abs(Number(current.start || 0) - Number(previous.end || 0)) > 0.2) return false;
  const boundaryText = `${previous.continuity || ""} ${current.continuity || ""}`;
  if (current.hardCutFromPrevious === true || /硬切|跳切|换人|换场|时间跳跃|新场景|hard\s*cut|jump\s*cut/i.test(boundaryText)) return false;
  const identityDecision = replacementPersonTracksMatch(previous, current);
  const sameSubjects = identityDecision.structured
    ? identityDecision.same
    : !replacementGenderOnlyLabel(previous.subjects)
      && !replacementGenderOnlyLabel(current.subjects)
      && replacementSemanticLabelMatches(previous.subjects, current.subjects);
  const sameScene = replacementSemanticLabelMatches(previous.scene, current.scene);
  if (!sameSubjects || !sameScene) return false;
  const sameGroup = replacementSemanticLabelMatches(previous.continuityGroup, current.continuityGroup);
  const previousFamilies = replacementActionFamilies(`${previous.action || ""} ${previous.actionGeometry || ""}`);
  const currentFamilies = new Set(replacementActionFamilies(`${current.action || ""} ${current.actionGeometry || ""}`));
  const relatedAction = sameGroup
    || previousFamilies.some((family) => currentFamilies.has(family))
    || /继续|承接|保持|随后|同一动作|连续|continues?|same action/i.test(boundaryText);
  return relatedAction && (current.sameShotAsPrevious === true || sameGroup);
}

function joinReplacementShotText(...values) {
  return values.map((value) => text(value, 1600)).filter(Boolean).filter((value, index, rows) => rows.indexOf(value) === index).join("；");
}

function mergeReplacementPersonTracks(previousTracks = [], currentTracks = []) {
  const merged = previousTracks.map((track) => ({
    ...track,
    primaryFeatures: { ...(track.primaryFeatures || {}) },
    auxiliaryFeatures: { ...(track.auxiliaryFeatures || {}) },
    appearanceStates: [...(track.appearanceStates || [])]
  }));
  for (const current of currentTracks) {
    const target = merged.find((track) => track.personId === current.personId);
    if (!target) {
      merged.push({ ...current, appearanceStates: [...(current.appearanceStates || [])] });
      continue;
    }
    target.visibleStart = Math.min(Number(target.visibleStart || 0), Number(current.visibleStart || 0));
    target.visibleEnd = Math.max(Number(target.visibleEnd || 0), Number(current.visibleEnd || 0));
    target.identityConfidence = Number(Math.min(Number(target.identityConfidence || 0), Number(current.identityConfidence || 0)).toFixed(2));
    target.identityReviewRequired = target.identityConfidence < 0.65;
    target.identityEvidence = joinReplacementShotText(target.identityEvidence, current.identityEvidence);
    target.role = joinReplacementShotText(target.role, current.role);
    target.actionOwner = joinReplacementShotText(target.actionOwner, current.actionOwner);
    target.appearanceStates = [...(target.appearanceStates || []), ...(current.appearanceStates || [])];
  }
  return merged;
}

function mergeReplacementInventoryEvidence(previousValue = {}, currentValue = {}) {
  const previous = normalizeReplacementInventoryEvidence(previousValue);
  const current = normalizeReplacementInventoryEvidence(currentValue);
  const canonical = current.canonicalStateAvailable
    ? current
    : previous.canonicalStateAvailable
      ? previous
      : Number(current.confidence || 0) >= Number(previous.confidence || 0) ? current : previous;
  const targetProductFit = current.targetProductFit === "incompatible" || previous.targetProductFit === "incompatible"
    ? "incompatible"
    : current.targetProductFit === "compatible" || previous.targetProductFit === "compatible"
      ? "compatible"
      : "unknown";
  return {
    ...canonical,
    canonicalStateAvailable: previous.canonicalStateAvailable || current.canonicalStateAvailable,
    targetProductFit,
    confidence: Number(Math.max(Number(previous.confidence || 0), Number(current.confidence || 0)).toFixed(2)),
    evidence: joinReplacementShotText(previous.evidence, current.evidence)
  };
}

function mergeReplacementSemanticShots(shots = []) {
  const merged = [];
  const riskRank = { low: 0, medium: 1, high: 2 };
  const policyRank = { none: 0, keyframes: 1, video: 2 };
  for (const shot of shots) {
    const previous = merged.at(-1);
    if (!sameReplacementSemanticShot(previous, shot)) {
      merged.push({ ...shot, sourceShotIds: [shot.id] });
      continue;
    }
    previous.sourceShotIds.push(shot.id);
    previous.end = shot.end;
    previous.title = joinReplacementShotText(previous.title, shot.title);
    previous.camera = joinReplacementShotText(previous.camera, shot.camera);
    previous.motion = joinReplacementShotText(previous.motion, shot.motion);
    previous.action = joinReplacementShotText(previous.action, shot.action);
    previous.actionGeometry = joinReplacementShotText(previous.actionGeometry, shot.actionGeometry);
    previous.productExposure = joinReplacementShotText(previous.productExposure, shot.productExposure);
    previous.productVisible = previous.productVisible || shot.productVisible;
    previous.inventoryEvidence = mergeReplacementInventoryEvidence(previous.inventoryEvidence, shot.inventoryEvidence);
    previous.continuity = joinReplacementShotText(previous.continuity, shot.continuity);
    previous.personTracks = mergeReplacementPersonTracks(previous.personTracks, shot.personTracks);
    previous.identityConfidence = Number(Math.min(Number(previous.identityConfidence || 0), Number(shot.identityConfidence || 0)).toFixed(2));
    previous.identityReviewRequired = previous.identityConfidence < 0.65 || previous.personTracks.some((track) => track.identityReviewRequired);
    previous.identityRisks = [...new Set([...(previous.identityRisks || []), ...(shot.identityRisks || [])])];
    previous.visibleText = joinReplacementShotText(previous.visibleText, shot.visibleText);
    previous.keyMoments = [...(previous.keyMoments || []), ...(shot.keyMoments || [])]
      .sort((left, right) => left.time - right.time)
      .filter((moment, index, rows) => rows.findIndex((item) => item.time === moment.time) === index);
    previous.keyframeTimes = [...(previous.keyframeTimes || []), ...(shot.keyframeTimes || [])]
      .sort((left, right) => left - right)
      .filter((time, index, rows) => rows.indexOf(time) === index);
    previous.actionPhases = [...(previous.actionPhases || []), ...(shot.actionPhases || [])].sort((left, right) => left.start - right.start);
    previous.stitchCandidates = [...(previous.stitchCandidates || []), ...(shot.stitchCandidates || [])].sort((left, right) => left.time - right.time);
    previous.stitchability = Math.min(Number(previous.stitchability || 0.65), Number(shot.stitchability || 0.65));
    previous.confidence = Math.min(Number(previous.confidence || 0.65), Number(shot.confidence || 0.65));
    previous.riskLevel = riskRank[shot.riskLevel] > riskRank[previous.riskLevel] ? shot.riskLevel : previous.riskLevel;
    previous.riskDimensions = Object.fromEntries(Object.keys(previous.riskDimensions || {}).map((key) => [key, Math.max(Number(previous.riskDimensions?.[key] || 0), Number(shot.riskDimensions?.[key] || 0))]));
    previous.recommendedReferencePolicy = policyRank[shot.recommendedReferencePolicy] > policyRank[previous.recommendedReferencePolicy]
      ? shot.recommendedReferencePolicy
      : previous.recommendedReferencePolicy;
    previous.referenceReason = joinReplacementShotText(previous.referenceReason, shot.referenceReason, "同一人物、同一场景且动作连续，已合并为同一原片镜头");
  }
  return merged.map((shot, index) => ({ ...shot, id: `shot-${String(index + 1).padStart(2, "0")}` }));
}

function replacementIdentityTransition(previousTracks = [], currentTracks = []) {
  const decision = replacementPersonTracksMatch(
    { personTracks: previousTracks },
    { personTracks: currentTracks }
  );
  if (decision.same) return { split: false, uncertain: false, reason: decision.reason };
  const allTracks = [...previousTracks, ...currentTracks];
  const uncertain = allTracks.some((track) => (
    Number(track.identityConfidence || 0) < 0.65
    || !replacementHasPrimaryIdentityEvidence(track)
  ));
  return { split: true, uncertain, reason: decision.reason };
}

function replacementTemporalIdentityGroups(shot = {}) {
  const tracks = (Array.isArray(shot.personTracks) ? shot.personTracks : [])
    .filter((track) => Number(track.visibleEnd) > Number(track.visibleStart))
    .sort((left, right) => Number(left.visibleStart) - Number(right.visibleStart));
  const hasSpecificIntervals = tracks.some((track) => (
    Number(track.visibleStart) > Number(shot.start || 0) + 0.03
    || Number(track.visibleEnd) < Number(shot.end || 0) - 0.03
  ));
  if (tracks.length < 2 || !hasSpecificIntervals) return [];
  const groups = [];
  for (const track of tracks) {
    const start = Number(track.visibleStart || shot.start || 0);
    const end = Number(track.visibleEnd || shot.end || start);
    const previous = groups.at(-1);
    const meaningfulOverlap = previous ? Math.min(previous.end, end) - Math.max(previous.start, start) : 0;
    if (!previous || meaningfulOverlap <= 0.08) {
      groups.push({ start, end, tracks: [track] });
      continue;
    }
    previous.start = Math.min(previous.start, start);
    previous.end = Math.max(previous.end, end);
    previous.tracks.push(track);
  }
  return groups;
}

function replacementMomentIdentityGroups(shot = {}) {
  if (["low_reaction", "active_support", "co_action"].includes(String(shot.interactionMode || ""))) return [];
  const samples = (Array.isArray(shot.keyMoments) ? shot.keyMoments : [])
    .flatMap((moment) => {
      const personIds = (Array.isArray(moment.personIds) ? moment.personIds : [moment.personId])
        .map((personId) => text(personId, 120))
        .filter(Boolean);
      return personIds.map((personId) => {
        const shotTrack = (shot.personTracks || []).find((track) => track.personId === personId);
        const momentHasPrimaryEvidence = replacementHasPrimaryIdentityEvidence(moment);
        return {
          time: Number(moment.time || 0),
          track: {
            personId,
            label: text(moment.personLabel, 240) || shotTrack?.label || personId,
            primaryFeatures: momentHasPrimaryEvidence ? (moment.primaryFeatures || {}) : (shotTrack?.primaryFeatures || {}),
            auxiliaryFeatures: momentHasPrimaryEvidence ? (moment.auxiliaryFeatures || {}) : (shotTrack?.auxiliaryFeatures || moment.auxiliaryFeatures || {}),
            identityConfidence: momentHasPrimaryEvidence ? Number(moment.identityConfidence || 0) : Number(shotTrack?.identityConfidence || moment.identityConfidence || 0),
            identityReviewRequired: momentHasPrimaryEvidence ? moment.identityReviewRequired === true : shotTrack?.identityReviewRequired === true
          }
        };
      });
    })
    .sort((left, right) => left.time - right.time);
  const groups = [];
  for (const sample of samples) {
    const previous = groups.at(-1);
    if (!previous || Math.abs(sample.time - previous.time) > 0.08) {
      groups.push({ time: sample.time, tracks: [sample.track] });
      continue;
    }
    previous.tracks.push(sample.track);
  }
  return groups;
}

function replacementShotIdentityBoundaries(shot = {}) {
  const boundaries = [];
  const trackGroups = replacementTemporalIdentityGroups(shot);
  for (let index = 1; index < trackGroups.length; index += 1) {
    const previous = trackGroups[index - 1];
    const current = trackGroups[index];
    const transition = replacementIdentityTransition(previous.tracks, current.tracks);
    if (!transition.split) continue;
    boundaries.push({
      time: Number(((previous.end + current.start) / 2).toFixed(3)),
      ...transition,
      evidence: "personTracks"
    });
  }
  const momentGroups = replacementMomentIdentityGroups(shot);
  for (let index = 1; index < momentGroups.length; index += 1) {
    const previous = momentGroups[index - 1];
    const current = momentGroups[index];
    const transition = replacementIdentityTransition(previous.tracks, current.tracks);
    if (!transition.split) continue;
    if (boundaries.some((boundary) => boundary.evidence === "personTracks" && boundary.time >= previous.time && boundary.time <= current.time)) continue;
    boundaries.push({
      time: Number(((previous.time + current.time) / 2).toFixed(3)),
      ...transition,
      evidence: "keyMoments"
    });
  }
  return boundaries
    .filter((boundary) => boundary.time > Number(shot.start || 0) + 0.03 && boundary.time < Number(shot.end || 0) - 0.03)
    .sort((left, right) => left.time - right.time)
    .filter((boundary, index, values) => index === 0 || Math.abs(boundary.time - values[index - 1].time) > 0.08);
}

function splitReplacementShotOnIdentityBoundaries(shot = {}) {
  const boundaries = replacementShotIdentityBoundaries(shot);
  if (!boundaries.length) return [shot];
  const edges = [Number(shot.start || 0), ...boundaries.map((boundary) => boundary.time), Number(shot.end || 0)];
  return edges.slice(0, -1).map((start, index) => {
    const end = edges[index + 1];
    const last = index === edges.length - 2;
    const containsTime = (value) => Number(value) >= start - 0.001 && (last ? Number(value) <= end + 0.001 : Number(value) < end - 0.001);
    const keyMoments = (shot.keyMoments || []).filter((moment) => containsTime(moment.time));
    const momentPersonIds = new Set(keyMoments.flatMap((moment) => Array.isArray(moment.personIds) ? moment.personIds : [moment.personId]).filter(Boolean));
    let personTracks = (shot.personTracks || []).filter((track) => (
      Math.min(end, Number(track.visibleEnd || end)) - Math.max(start, Number(track.visibleStart || start)) > 0.01
    ));
    if (momentPersonIds.size && personTracks.some((track) => momentPersonIds.has(track.personId))) {
      personTracks = personTracks.filter((track) => momentPersonIds.has(track.personId));
    }
    personTracks = personTracks.map((track) => ({
      ...track,
      visibleStart: Number(Math.max(start, Number(track.visibleStart || start)).toFixed(3)),
      visibleEnd: Number(Math.min(end, Number(track.visibleEnd || end)).toFixed(3)),
      appearanceStates: (track.appearanceStates || []).filter((state) => (
        Math.min(end, Number(state.end || end)) - Math.max(start, Number(state.start || start)) > 0.01
      ))
    }));
    const touchesUncertainBoundary = [boundaries[index - 1], boundaries[index]].filter(Boolean).some((boundary) => boundary.uncertain);
    if (touchesUncertainBoundary) {
      personTracks = personTracks.map((track) => ({ ...track, identityConfidence: Math.min(Number(track.identityConfidence || 0), 0.49), identityReviewRequired: true }));
    }
    const identityConfidence = personTracks.length
      ? Number(Math.min(...personTracks.map((track) => Number(track.identityConfidence || 0))).toFixed(2))
      : Number(Math.min(Number(shot.identityConfidence || 0.35), touchesUncertainBoundary ? 0.49 : 1).toFixed(2));
    const boundaryReason = [boundaries[index - 1]?.reason, boundaries[index]?.reason].filter(Boolean).join("；");
    const identityRisks = [...new Set([
      ...(shot.identityRisks || []),
      `同一模型分镜内检测到顺序出现且身份不兼容的人物，已在${start.toFixed(1)}–${end.toFixed(1)}秒建立独立镜头`,
      ...(touchesUncertainBoundary ? ["人物主要身份特征不足，已按保守原则拆分并降低identityConfidence"] : [])
    ])];
    const actionPhases = (shot.actionPhases || []).map((phase) => ({
      ...phase,
      start: Number(Math.max(start, Number(phase.start || start)).toFixed(3)),
      end: Number(Math.min(end, Number(phase.end || end)).toFixed(3)),
      criticalTime: Number(clampNumber(phase.criticalTime, start, end, start).toFixed(3))
    })).filter((phase) => phase.end > phase.start);
    const segmentAction = actionPhases.map((phase) => phase.action).filter(Boolean).join("；")
      || keyMoments.map((moment) => moment.description).filter(Boolean).join("；")
      || shot.action;
    const phaseProductStates = actionPhases.map((phase) => phase.productVisible).filter((value) => typeof value === "boolean");
    return {
      ...shot,
      id: `${shot.id}-identity-${String(index + 1).padStart(2, "0")}`,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      title: `${shot.title || "原片镜头"} · 人物段${index + 1}`,
      subjects: personTracks.map((track) => track.label).filter(Boolean).join("、") || shot.subjects,
      personTracks,
      identityConfidence,
      identityReviewRequired: touchesUncertainBoundary || personTracks.some((track) => track.identityReviewRequired),
      identityRisks,
      identityBoundarySplit: true,
      identityBoundaryReason: boundaryReason || "人物身份变化，禁止放在同一原片镜头",
      sameShotAsPrevious: false,
      hardCutFromPrevious: index === 0 ? shot.hardCutFromPrevious : true,
      action: segmentAction,
      productVisible: phaseProductStates.includes(true) ? true : phaseProductStates.length ? false : shot.productVisible,
      keyMoments,
      keyframeTimes: (shot.keyframeTimes || []).filter(containsTime),
      actionPhases,
      stitchCandidates: (shot.stitchCandidates || []).filter((candidate) => containsTime(candidate.time))
    };
  }).filter((part) => part.end > part.start + 0.03);
}

function optionalReplacementInventoryInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function normalizeReplacementInventoryEvidence(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const targetProductFit = ["compatible", "incompatible", "unknown"].includes(String(source.targetProductFit || ""))
    ? String(source.targetProductFit)
    : "unknown";
  return {
    canonicalStateAvailable: source.canonicalStateAvailable === true,
    visibleTotalCount: optionalReplacementInventoryInteger(source.visibleTotalCount),
    rows: optionalReplacementInventoryInteger(source.rows),
    columns: optionalReplacementInventoryInteger(source.columns),
    layers: optionalReplacementInventoryInteger(source.layers),
    layout: text(source.layout, 800),
    orientation: text(source.orientation, 800),
    spacing: text(source.spacing, 800),
    targetProductFit,
    confidence: Number(clampNumber(source.confidence, 0, 1, 0).toFixed(2)),
    evidence: text(source.evidence, 1600)
  };
}

function normalizeReplacementSourceAnalysis(rawInput = {}, options = {}) {
  const raw = rawInput && typeof rawInput === "object" ? rawInput : {};
  const duration = clampNumber(options.duration, 0, 300, 0);
  const subjectProfiles = (Array.isArray(raw.subjectProfiles) ? raw.subjectProfiles : [])
    .map((profile, index) => normalizeReplacementSubjectProfile(profile, index));
  const subjectProfileById = new Map(subjectProfiles.map((profile) => [profile.personId, profile]));
  const normalizedSourceShots = (Array.isArray(raw.sourceShots) ? raw.sourceShots : [])
    .map((shot, index) => {
      const start = clampNumber(shot?.start, 0, duration || 300, 0);
      const end = clampNumber(shot?.end, start + 0.05, duration || 300, duration || start + 1);
      const shotId = text(shot?.id, 80) || `shot-${String(index + 1).padStart(2, "0")}`;
      const subjects = text(Array.isArray(shot?.subjects) ? shot.subjects.join("、") : shot?.subjects, 1000);
      const hardCutFromPrevious = shot?.hardCutFromPrevious === true;
      const humanEvidence = /人物|人像|女性|女人|女生|女孩|男性|男人|男生|男孩|person|woman|girl|man|boy/i.test(`${subjects} ${shot?.action || ""}`);
      const rawPersonTracks = Array.isArray(shot?.personTracks) && shot.personTracks.length
        ? shot.personTracks
        : humanEvidence
          ? [{ label: subjects || "未确认人物", identityConfidence: 0.35, identityEvidence: "历史或非结构化人物描述，缺少逐人主要身份证据" }]
          : [];
      const personTracks = rawPersonTracks.map((track, trackIndex) => normalizeReplacementPersonTrack(track, trackIndex, {
        profile: subjectProfileById.get(text(track?.personId || track?.id, 120)),
        shotId,
        shotStart: start,
        shotEnd: end,
        hardCutFromPrevious,
        fallbackLabel: subjects
      }));
      let identityConfidence = personTracks.length
        ? Math.min(...personTracks.map((track) => Number(track.identityConfidence || 0)))
        : humanEvidence ? 0.35 : 1;
      if (Number.isFinite(Number(shot?.identityConfidence))) identityConfidence = Math.min(identityConfidence, Number(shot.identityConfidence));
      identityConfidence = Number(clampNumber(identityConfidence, 0, 1, 0.35).toFixed(2));
      const identityRisks = (Array.isArray(shot?.identityRisks) ? shot.identityRisks : [])
        .map((item) => text(typeof item === "string" ? item : item?.message || item?.risk, 500))
        .filter(Boolean);
      if (personTracks.some((track) => track.identityReviewRequired)) identityRisks.push("人物主要身份特征不足，已禁止自动与相邻镜头合并");
      if (hardCutFromPrevious && personTracks.some((track) => !track.identityReestablished)) identityRisks.push("硬切后缺少当前镜头独立身份重建证据");
      const productEvidenceText = `${shot?.productExposure || ""} ${shot?.action || ""} ${shot?.actionGeometry || ""} ${(shot?.keyMoments || []).map((moment) => `${moment?.description || ""} ${moment?.productState || ""}`).join(" ")}`;
      const visibleProductEvidence = /(?:手持|拿起|握住|捏住|展示|佩戴|贴(?:上|在)|敷|揭|撕|取下|触摸|打开|开盖|挤压|涂抹).{0,60}(?:产品|商品|包装|面膜|膜布|瓶|罐|盒|袋)|(?:产品|商品|包装|面膜|膜布|瓶|罐|盒|袋).{0,60}(?:可见|露出|手持|拿起|握住|捏住|展示|佩戴|贴|敷|揭|撕|取下|触摸|打开|开盖|挤压|涂抹)|(?:hold|show|wear|apply|peel|remove|touch|open|squeeze).{0,60}(?:product|package|mask|bottle|jar|box)/i.test(productEvidenceText);
      const sourceProductRole = ["transport_container", "retail_outer_box", "primary_container", "single_sachet", "content_unit", "none", "unknown"]
        .includes(String(shot?.sourceProductRole || ""))
        ? String(shot.sourceProductRole)
        : "unknown";
      const productLocator = {
        screenPosition: text(shot?.productLocator?.screenPosition, 500),
        relativeSize: text(shot?.productLocator?.relativeSize, 500),
        orientation: text(shot?.productLocator?.orientation, 500),
        recognitionSurface: text(shot?.productLocator?.recognitionSurface, 500),
        supportSurface: text(shot?.productLocator?.supportSurface, 500),
        contactPoints: text(shot?.productLocator?.contactPoints, 800),
        occlusion: text(shot?.productLocator?.occlusion, 800),
        evidence: text(shot?.productLocator?.evidence, 1200)
      };
      const inventoryEvidence = normalizeReplacementInventoryEvidence(shot?.inventoryEvidence);
      const productVisible = ["transport_container", "none"].includes(sourceProductRole)
        ? false
        : sourceProductRole !== "unknown"
          ? true
          : shot?.productVisible === true || visibleProductEvidence
            ? true
            : shot?.productVisible === false
              ? false
              : !/(?:产品|商品|包装|膜布|面膜).{0,8}(?:不可见|未出现|未露出)|(?:不可见|未出现|未露出).{0,8}(?:产品|商品|包装|膜布|面膜)/i.test(productEvidenceText);
      return {
        id: shotId,
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        title: text(shot?.title, 240) || `镜头${index + 1}`,
        shotType: text(shot?.shotType, 120),
        scene: text(shot?.scene, 1000),
        camera: text(shot?.camera, 1000),
        motion: text(shot?.motion, 1000),
        subjects: subjects || personTracks.map((track) => track.label).filter(Boolean).join("、"),
        personTracks,
        identityConfidence,
        identityReviewRequired: personTracks.some((track) => track.identityReviewRequired) || identityConfidence < 0.65,
        identityRisks: [...new Set(identityRisks)],
        identityBoundarySplit: shot?.identityBoundarySplit === true,
        identityBoundaryReason: text(shot?.identityBoundaryReason, 1000),
        action: text(shot?.action, 1600),
        actionGeometry: text(shot?.actionGeometry, 1600),
        interactionMode: ["low_reaction", "active_support", "co_action"].includes(String(shot?.interactionMode || "")) ? String(shot.interactionMode) : "",
        productExposure: text(shot?.productExposure, 1200),
        productVisible,
        sourceProductRole,
        sourceProductEvidence: text(shot?.sourceProductEvidence, 1200),
        transportContainerVisible: shot?.transportContainerVisible === true || sourceProductRole === "transport_container",
        productLocator,
        inventoryEvidence,
        continuity: text(shot?.continuity, 1200),
        continuityGroup: text(shot?.continuityGroup, 160),
        sameShotAsPrevious: shot?.sameShotAsPrevious === true,
        hardCutFromPrevious,
        visibleText: text(shot?.visibleText, 1000),
        riskLevel: replacementRiskLevel(shot?.riskLevel),
        confidence: Number(clampNumber(shot?.confidence, 0, 1, 0.65).toFixed(2)),
        recommendedReferencePolicy: replacementReferencePolicy(shot?.recommendedReferencePolicy),
        referenceReason: text(shot?.referenceReason, 1000),
        keyMoments: (Array.isArray(shot?.keyMoments) ? shot.keyMoments : [])
          .map((moment, momentIndex) => {
            const identityFeatures = normalizeReplacementIdentityFeatures(moment);
            const hasIdentityEvidence = replacementHasPrimaryIdentityEvidence(identityFeatures);
            const identityConfidence = Number(Math.min(
              clampNumber(moment?.identityConfidence, 0, 1, 0.35),
              hasIdentityEvidence ? 1 : 0.49
            ).toFixed(2));
            const personIds = (Array.isArray(moment?.personIds) ? moment.personIds : [moment?.personId])
              .map((personId) => text(personId, 120))
              .filter(Boolean);
            return {
              time: Number(clampNumber(moment?.time, start, end, start).toFixed(3)),
              role: ["entry", "action", "exit", "product"].includes(String(moment?.role || "")) ? String(moment.role) : (momentIndex === 0 ? "entry" : "action"),
              description: text(moment?.description, 500),
              productState: text(moment?.productState, 500),
              personId: personIds[0] || "",
              personIds,
              personLabel: text(moment?.personLabel || moment?.label, 240),
              phaseId: text(moment?.phaseId, 120),
              ...identityFeatures,
              identityConfidence,
              identityReviewRequired: Boolean(personIds.length) && identityConfidence < 0.65,
              required: moment?.required === true
            };
          })
          .filter((moment, position, values) => values.findIndex((item) => item.time === moment.time) === position),
        keyframeTimes: (Array.isArray(shot?.keyMoments) ? shot.keyMoments.map((moment) => moment?.time) : Array.isArray(shot?.keyframeTimes) ? shot.keyframeTimes : [])
          .map((time) => Number(clampNumber(time, start, end, start).toFixed(3)))
          .filter((time, position, values) => values.indexOf(time) === position),
        actionPhases: (Array.isArray(shot?.actionPhases) ? shot.actionPhases : [])
          .map((phase, phaseIndex) => ({
            id: text(phase?.phaseId || phase?.id, 120) || `${shotId}-phase-${String(phaseIndex + 1).padStart(2, "0")}`,
            start: Number(clampNumber(phase?.start, start, end, start).toFixed(3)),
            end: Number(clampNumber(phase?.end, start, end, end).toFixed(3)),
            action: text(phase?.action, 800),
            criticalTime: Number(clampNumber(phase?.criticalTime, start, end, phase?.start ?? start).toFixed(3)),
            personId: text(phase?.personId, 120),
            productVisible: productVisible && (phase?.productVisible === true || (phase?.productVisible !== false && visibleProductEvidence)),
            riskLevel: replacementRiskLevel(phase?.riskLevel || shot?.riskLevel),
            transitionType: ["reveal_only", "cover_only", "pick_up_visible_item", "remove_item", "insert_item", "rearrange", "unknown"].includes(String(phase?.transitionType || ""))
              ? String(phase.transitionType)
              : "unknown",
            revealState: ["pre_reveal", "initial_reveal", "partial_reveal", "full_reveal", "not_applicable"].includes(String(phase?.revealState || ""))
              ? String(phase.revealState)
              : "not_applicable",
            inventoryMutation: phase?.inventoryMutation === true
          }))
          .filter((phase) => phase.end > phase.start && phase.action),
        stitchCandidates: (Array.isArray(shot?.stitchCandidates) ? shot.stitchCandidates : [])
          .map((candidate) => ({
            time: Number(clampNumber(candidate?.time, start, end, start).toFixed(3)),
            score: Number(clampNumber(candidate?.score, 0, 1, 0).toFixed(2)),
            reason: text(candidate?.reason, 500)
          }))
          .filter((candidate) => candidate.score > 0),
        stitchability: Number(clampNumber(shot?.stitchability, 0, 1, 0.65).toFixed(2)),
        riskDimensions: {
          action: Math.round(clampNumber(shot?.riskDimensions?.action, 0, 100, shot?.riskLevel === "high" ? 80 : 45)),
          physics: Math.round(clampNumber(shot?.riskDimensions?.physics, 0, 100, 35)),
          productIdentity: Math.round(clampNumber(shot?.riskDimensions?.productIdentity, 0, 100, 45)),
          camera: Math.round(clampNumber(shot?.riskDimensions?.camera, 0, 100, 35)),
          continuity: Math.round(clampNumber(shot?.riskDimensions?.continuity, 0, 100, 45)),
          audio: Math.round(clampNumber(shot?.riskDimensions?.audio, 0, 100, 25))
        }
      };
    })
    .sort((left, right) => left.start - right.start)
    .filter((shot) => shot.end > shot.start);
  const identityBoundedSourceShots = normalizedSourceShots.flatMap((shot) => splitReplacementShotOnIdentityBoundaries(shot));
  const sourceShots = mergeReplacementSemanticShots(identityBoundedSourceShots);
  if (!sourceShots.length && duration > 0) {
    sourceShots.push({
      id: "shot-01",
      start: 0,
      end: Number(duration.toFixed(3)),
      title: "完整参考片段",
      shotType: "continuous",
      scene: "原片连续场景",
      camera: "保持原片机位与构图",
      motion: "按原片动作节奏复刻",
      subjects: "原片主体",
      personTracks: [],
      identityConfidence: 0.2,
      identityReviewRequired: true,
      identityRisks: ["模型未返回可验证的人物轨迹，身份状态需要人工核对"],
      action: "按时间顺序复刻原片主要动作",
      actionGeometry: "以原片可见动作起点、过程和结果为准",
      interactionMode: "",
      productExposure: "按原片产品露出位置替换目标产品",
      productVisible: true,
      inventoryEvidence: normalizeReplacementInventoryEvidence(),
      continuity: "保持连续",
      continuityGroup: "fallback-continuous-shot",
      sameShotAsPrevious: false,
      hardCutFromPrevious: false,
      visibleText: "",
      riskLevel: "medium",
      confidence: 0.4,
      recommendedReferencePolicy: "video",
      referenceReason: "模型未返回可靠切点，保守使用完整视频参考",
      keyMoments: [{ time: 0.1, role: "entry", description: "参考视频首态" }],
      keyframeTimes: [0.1],
      actionPhases: [{ start: 0, end: Number(duration.toFixed(3)), action: "按时间顺序复刻原片主要动作", criticalTime: Number((duration / 2).toFixed(3)) }],
      stitchCandidates: [],
      stitchability: 0.2,
      riskDimensions: { action: 55, physics: 45, productIdentity: 55, camera: 45, continuity: 60, audio: 35 }
    });
  }
  for (const shot of sourceShots) {
    for (const track of shot.personTracks || []) {
      if (subjectProfileById.has(track.personId)) continue;
      const profile = normalizeReplacementSubjectProfile({
        personId: track.personId,
        label: track.label,
        gender: track.gender,
        primaryFeatures: track.primaryFeatures,
        auxiliaryFeatures: track.auxiliaryFeatures,
        identityConfidence: track.identityConfidence,
        evidence: track.identityEvidence,
        firstSeenShotId: shot.id,
        provisional: track.identityReviewRequired
      }, subjectProfiles.length);
      subjectProfiles.push(profile);
      subjectProfileById.set(profile.personId, profile);
    }
  }
  const keyframes = (Array.isArray(options.keyframes) ? options.keyframes : []).map((frame, index) => ({
    id: text(frame?.id, 80) || `keyframe-${String(index + 1).padStart(2, "0")}`,
    time: Number(clampNumber(frame?.time, 0, duration || 300, 0).toFixed(3)),
    localPath: text(frame?.localPath, 2000),
    previewUrl: text(frame?.previewUrl, 4000),
    label: text(frame?.label, 240) || `关键帧${index + 1}`,
    role: ["entry", "action", "exit", "product"].includes(String(frame?.role || "")) ? String(frame.role) : "action",
    description: text(frame?.description, 500),
    personId: text(frame?.personId, 120),
    personIds: (Array.isArray(frame?.personIds) ? frame.personIds : [frame?.personId]).map((personId) => text(personId, 120)).filter(Boolean),
    semanticPhaseId: text(frame?.semanticPhaseId || frame?.phaseId, 120),
    semanticPhaseIds: (Array.isArray(frame?.semanticPhaseIds) ? frame.semanticPhaseIds : [frame?.semanticPhaseId || frame?.phaseId]).map((phaseId) => text(phaseId, 120)).filter(Boolean),
    coverageTypes: (Array.isArray(frame?.coverageTypes) ? frame.coverageTypes : []).map((item) => text(item, 80)).filter(Boolean),
    riskLevel: replacementRiskLevel(frame?.riskLevel),
    requestedTime: Number(clampNumber(frame?.requestedTime ?? frame?.time, 0, duration || 300, 0).toFixed(3)),
    sourceShotId: text(frame?.sourceShotId, 80)
  })).sort((left, right) => left.time - right.time);
  for (const frame of keyframes) {
    if (frame.sourceShotId && sourceShots.some((shot) => shot.id === frame.sourceShotId)) continue;
    const owner = [...sourceShots]
      .reverse()
      .find((shot) => frame.time + 0.001 >= shot.start && frame.time <= shot.end + 0.001);
    frame.sourceShotId = owner?.id || "";
  }
  const semanticSegments = sourceShots.flatMap((shot) => {
    const phases = (shot.actionPhases || []).length
      ? shot.actionPhases
      : [{ start: shot.start, end: shot.end, action: shot.action, criticalTime: (shot.start + shot.end) / 2 }];
    return phases.map((phase, index) => ({
      id: text(phase.id, 120) || `semantic-segment-${String(index + 1).padStart(2, "0")}-${shot.id}`,
      sourceShotId: shot.id,
      start: phase.start,
      end: phase.end,
      action: phase.action,
      criticalTime: phase.criticalTime,
      personId: text(phase.personId, 120),
      productVisible: phase.productVisible === true || (phase.productVisible !== false && shot.productVisible),
      riskLevel: replacementRiskLevel(phase.riskLevel || shot.riskLevel)
    }));
  });
  const productExposureSegments = sourceShots
    .filter((shot) => shot.productVisible)
    .map((shot, index) => ({
      id: `product-exposure-${String(index + 1).padStart(2, "0")}`,
      sourceShotId: shot.id,
      start: shot.start,
      end: shot.end,
      description: shot.productExposure || shot.action || "产品在当前原始镜头中可见"
    }));
  for (const shot of sourceShots) {
    shot.actionPhaseIds = semanticSegments.filter((segment) => segment.sourceShotId === shot.id).map((segment) => segment.id);
    shot.candidateFrameIds = keyframes.filter((frame) => frame.sourceShotId === shot.id).map((frame) => frame.id);
  }
  const explicitActionEvidence = sourceShots.flatMap((shot) => [
    shot.action,
    shot.actionGeometry,
    shot.productExposure,
    ...(shot.keyMoments || []).map((moment) => moment.description),
    ...(shot.actionPhases || []).map((phase) => phase.action)
  ]).filter(Boolean).join(" ");
  const hasExplicitLiquidMotionEvidence = /液体.{0,12}(?:流动|滴落|拉丝|残留)|精华(?:液)?.{0,12}(?:流动|滴落|拉丝|残留)|(?:流动|滴落|拉丝).{0,12}(?:液体|精华)|liquid.{0,24}(?:flow|drip|string)|(?:flow|drip|string).{0,24}liquid/i.test(explicitActionEvidence);
  const risks = (Array.isArray(raw.risks) ? raw.risks : [])
    .map((item) => text(typeof item === "string" ? item : item?.message || item?.risk, 500))
    .filter(Boolean)
    .filter((item) => hasExplicitLiquidMotionEvidence || !/精华(?:液)?粘稠|液体残留|无来源滴液|精华(?:液)?流动|拉丝|viscosity|stringiness|liquid residue/i.test(item))
    .slice(0, 20);
  const identityRisks = [...new Set([
    ...(Array.isArray(raw.identityRisks) ? raw.identityRisks : []).map((item) => text(typeof item === "string" ? item : item?.message || item?.risk, 500)).filter(Boolean),
    ...sourceShots.flatMap((shot) => shot.identityRisks || [])
  ])].slice(0, 30);
  return {
    status: "completed",
    identityTrackingVersion: 1,
    provider: text(options.provider, 120) || "Qwen 3.7 Plus",
    inputMode: text(options.inputMode, 80) || "video_url",
    analyzedAt: options.analyzedAt || isoNow(),
    duration,
    summary: text(raw.summary, 2000) || "已完成参考视频语义拆解",
    originalShotCount: sourceShots.length,
    detectedRawShotCount: Math.max(normalizedSourceShots.length, Number(raw.originalShotCount || 0)),
    deepDive: {
      camera: text(raw.deepDive?.camera, 2000),
      bodyPosture: text(raw.deepDive?.bodyPosture, 2000),
      gazeExpression: text(raw.deepDive?.gazeExpression, 2000),
      handActions: text(raw.deepDive?.handActions, 2000),
      speakingRhythm: text(raw.deepDive?.speakingRhythm, 2000),
      productExposureLogic: text(raw.deepDive?.productExposureLogic, 2000),
      transitionLogic: text(raw.deepDive?.transitionLogic, 2000),
      replicablePoints: text(raw.deepDive?.replicablePoints, 2000),
      avoidMechanicalCopy: text(raw.deepDive?.avoidMechanicalCopy, 2000)
    },
    subjectProfiles,
    identityRisks,
    identityReviewShotCount: sourceShots.filter((shot) => shot.identityReviewRequired).length,
    sourceShots,
    semanticSegments,
    productExposureSegments,
    keyframes,
    risks
  };
}

function deterministicShotReferencePolicy(shot = {}) {
  const actionText = `${shot.action || ""} ${shot.actionGeometry || ""} ${shot.motion || ""} ${shot.interactionMode || ""}`;
  const staticText = `${shot.shotType || ""} ${shot.action || ""} ${shot.motion || ""}`;
  if (
    shot.interactionMode === "active_support"
    || shot.interactionMode === "co_action"
    || /挤|压|撕|揭|开盖|旋拧|倒|滴|涂|抹|贴|取出|放入|接触|交接|递|双手|多人|同步|形变|液体|凝胶|重叠|遮挡|绕行|快速运镜/.test(actionText)
  ) return { policy: "video", reason: "包含接触、形变、双人协作或复杂运动，视频动态约束优先" };
  if (/静态|陈列|定格|空镜|纯环境|无人物|无动作|慢推|轻微推近/.test(staticText) && shot.riskLevel !== "high") {
    return { policy: "none", reason: "动作通用且结构约束较弱，可减少旧产品污染" };
  }
  const recommended = replacementReferencePolicy(shot.recommendedReferencePolicy);
  if (recommended === "video" && shot.riskLevel === "high") return { policy: "video", reason: shot.referenceReason || "高风险动作保留视频参考" };
  if (recommended === "none" && shot.riskLevel === "low") return { policy: "none", reason: shot.referenceReason || "低风险通用镜头不需要参考资产" };
  return { policy: "keyframes", reason: shot.referenceReason || "构图与姿态重要，关键帧约束已足够" };
}

function nearestReplacementKeyframes(analysis, unitStart, unitEnd, requestedTimes = []) {
  const frames = (Array.isArray(analysis?.keyframes) ? analysis.keyframes : [])
    .filter((frame) => Number(frame.time) + 0.001 >= Number(unitStart) && Number(frame.time) <= Number(unitEnd) + 0.001);
  if (!frames.length) return [];
  const targetTimes = requestedTimes.length ? requestedTimes : [(unitStart + unitEnd) / 2];
  const selected = [];
  for (const target of targetTimes) {
    const nearest = [...frames].sort((left, right) => Math.abs(left.time - target) - Math.abs(right.time - target))[0];
    if (nearest && !selected.includes(nearest.id)) selected.push(nearest.id);
  }
  return selected;
}

function replacementShotRiskScore(shot = {}) {
  const values = shot.riskDimensions || {};
  const weighted = Number(values.action || 0) * 0.24
    + Number(values.physics || 0) * 0.2
    + Number(values.productIdentity || 0) * 0.18
    + Number(values.camera || 0) * 0.12
    + Number(values.continuity || 0) * 0.18
    + Number(values.audio || 0) * 0.08;
  if (weighted > 0) return Math.round(clampNumber(weighted, 0, 100, 50));
  return shot.riskLevel === "high" ? 80 : shot.riskLevel === "low" ? 25 : 50;
}

function splitReplacementShotForModel(shot = {}, minimumDuration = 4, maximumDuration = 15) {
  const duration = Number(shot.end || 0) - Number(shot.start || 0);
  if (duration <= maximumDuration + 0.05) return [{ ...shot, sourceShotId: shot.id, boundaryStitchability: Number(shot.stitchability || 0.65) }];
  const partCount = Math.max(2, Math.ceil(duration / maximumDuration));
  const idealDuration = duration / partCount;
  const semanticCandidates = [
    ...(shot.stitchCandidates || []).filter((item) => Number(item.score || 0) >= 0.5),
    ...(shot.actionPhases || []).slice(0, -1).map((phase) => ({ time: phase.end, score: 0.6, reason: "动作阶段完成" }))
  ].filter((item) => Number(item.time) > shot.start + minimumDuration * 0.75 && Number(item.time) < shot.end - minimumDuration * 0.75);
  const cuts = [];
  let cursor = Number(shot.start || 0);
  for (let part = 1; part < partCount; part += 1) {
    const ideal = Number(shot.start || 0) + idealDuration * part;
    const lower = cursor + minimumDuration * 0.75;
    const remainingParts = partCount - part;
    const upper = Number(shot.end || 0) - remainingParts * minimumDuration * 0.75;
    const candidates = semanticCandidates.filter((item) => Number(item.time) >= lower && Number(item.time) <= upper && !cuts.some((cut) => cut.time === Number(item.time)));
    const selected = candidates.sort((left, right) => (
      Math.abs(Number(left.time) - ideal) - Number(left.score || 0) * 1.5
      - (Math.abs(Number(right.time) - ideal) - Number(right.score || 0) * 1.5)
    ))[0] || { time: clampNumber(ideal, lower, upper, ideal), score: 0.2, reason: "模型时长上限强制拆分" };
    cuts.push({ time: Number(Number(selected.time).toFixed(3)), score: Number(selected.score || 0.2), reason: selected.reason || "模型时长上限强制拆分" });
    cursor = Number(selected.time);
  }
  const boundaries = [Number(shot.start || 0), ...cuts.map((item) => item.time), Number(shot.end || 0)];
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const keyMoments = (shot.keyMoments || []).filter((moment) => moment.time >= start && moment.time <= end);
    const phases = (shot.actionPhases || []).filter((phase) => phase.end > start && phase.start < end).map((phase) => ({
      ...phase,
      start: Math.max(start, phase.start),
      end: Math.min(end, phase.end),
      criticalTime: clampNumber(phase.criticalTime, start, end, start)
    }));
    return {
      ...shot,
      id: `${shot.id}-part-${index + 1}`,
      sourceShotId: shot.id,
      start,
      end,
      title: `${shot.title} · ${index + 1}/${boundaries.length - 1}`,
      keyMoments,
      keyframeTimes: keyMoments.length ? keyMoments.map((moment) => moment.time) : [start + Math.min(0.15, (end - start) / 4), (start + end) / 2, end - Math.min(0.15, (end - start) / 4)],
      actionPhases: phases.length ? phases : [{ start, end, action: shot.action, criticalTime: (start + end) / 2 }],
      boundaryStitchability: index < cuts.length ? cuts[index].score : Number(shot.stitchability || 0.4),
      splitReason: index < cuts.length ? cuts[index].reason : "承接下一镜头"
    };
  });
}

function replacementTimelineForUnit(shots, analysis, keyframeIds, unitStart, unitEnd, targetDuration) {
  const selectedFrames = (analysis.keyframes || []).filter((frame) => keyframeIds.includes(frame.id));
  const phases = shots.flatMap((shot) => (shot.actionPhases || []).length
    ? shot.actionPhases
    : [{ start: shot.start, end: shot.end, action: shot.action, criticalTime: (shot.start + shot.end) / 2 }]);
  return phases.map((phase, index) => {
    const criticalTime = clampNumber(phase.criticalTime, phase.start, phase.end, phase.start);
    const frame = [...selectedFrames].sort((left, right) => Math.abs(left.time - criticalTime) - Math.abs(right.time - criticalTime))[0];
    const scale = targetDuration / Math.max(0.1, unitEnd - unitStart);
    return {
      order: index + 1,
      sourceStart: Number(phase.start.toFixed(3)),
      sourceEnd: Number(phase.end.toFixed(3)),
      targetStart: Number(((phase.start - unitStart) * scale).toFixed(3)),
      targetEnd: Number(((phase.end - unitStart) * scale).toFixed(3)),
      action: phase.action,
      criticalTime: Number(criticalTime.toFixed(3)),
      sourceKeyframeId: frame?.id || "",
      sourceKeyframeTime: frame ? frame.time : null,
      anchorSourceKeyframeId: frame?.id || "",
      anchorSourceKeyframeTime: frame ? frame.time : null
    };
  });
}

function requiredReplacementKeyframeIds(analysis, shot, candidateFrameIds = [], options = {}) {
  if (!shot?.productVisible || !candidateFrameIds.length) return [];
  const frames = (analysis.keyframes || []).filter((frame) => candidateFrameIds.includes(frame.id));
  const explicitlyRequiredTimes = (shot.keyMoments || [])
    .filter((moment) => moment.required === true)
    .map((moment) => Number(moment.time));
  const productMomentTimes = (shot.keyMoments || [])
    .filter((moment) => moment.role === "product")
    .map((moment) => Number(moment.time));
  const stateText = [
    shot.action,
    shot.actionGeometry,
    shot.productExposure,
    ...(shot.keyMoments || []).map((moment) => `${moment.productState || ""} ${moment.description || ""}`),
    ...(shot.actionPhases || []).map((phase) => phase.action)
  ].filter(Boolean).join(" ");
  const hasDistinctProductStates = /(?:→|->|⇒|从.{0,20}(?:到|变为)|关闭.{0,16}(?:打开|开盖)|(?:打开|开盖).{0,16}关闭|贴(?:在|合).{0,16}(?:揭|撕|取下)|(?:揭|撕|取下).{0,16}(?:持有|手持|离开)|完整包装.{0,16}(?:拆开|取出)|(?:挤出前|挤出后|使用前|使用后))/i.test(stateText);
  const riskFrameCount = shot.riskLevel === "high" ? 3 : shot.riskLevel === "medium" ? 2 : 1;
  const phaseTargets = (shot.actionPhases || []).map((phase, index) => ({
    time: Number(phase.criticalTime ?? ((phase.start + phase.end) / 2)),
    priority: ({ high: 3, medium: 2, low: 1 }[phase.riskLevel] || ({ high: 3, medium: 2, low: 1 }[shot.riskLevel] || 2)) * 100 - index,
    type: "semantic_phase"
  }));
  const personTargets = (shot.personTracks || []).map((track, index) => ({
    time: Number((Number(track.visibleStart || shot.start) + Number(track.visibleEnd || shot.end)) / 2),
    priority: 180 - index,
    type: "person_identity"
  }));
  const requiredCount = Math.min(
    candidateFrameIds.length,
    Math.max(1, explicitlyRequiredTimes.length, hasDistinctProductStates ? 2 : 1, riskFrameCount)
  );
  const targetTimes = [
    ...explicitlyRequiredTimes.map((time, index) => ({ time, priority: 1000 - index, type: "explicit_required" })),
    ...personTargets,
    ...phaseTargets,
    ...productMomentTimes.map((time, index) => ({ time, priority: 350 - index, type: "product_moment" }))
  ].sort((left, right) => right.priority - left.priority);
  if (!targetTimes.length) {
    targetTimes.push(...Array.from({ length: requiredCount }, (_, index) => ({
      time: requiredCount === 1 ? Number((shot.start + shot.end) / 2) : shot.start + ((index + 1) / (requiredCount + 1)) * (shot.end - shot.start),
      priority: 100 - index,
      type: "fallback"
    })));
  }
  const selected = [];
  for (const target of targetTimes) {
    const frame = [...frames]
      .filter((item) => !selected.includes(item.id))
      .sort((left, right) => Math.abs(Number(left.time) - target.time) - Math.abs(Number(right.time) - target.time))[0];
    if (frame) selected.push(frame.id);
    if (selected.length >= requiredCount) break;
  }
  for (const frame of frames) {
    if (selected.length >= requiredCount) break;
    if (!selected.includes(frame.id)) selected.push(frame.id);
  }
  return selected;
}

const REPLACEMENT_PHYSICAL_STATE_LABELS = {
  pre_reveal: "未开箱",
  initial_reveal: "初次露出",
  partial_reveal: "半开箱",
  full_reveal: "全开箱",
  cover_only: "遮挡变化",
  pick_up_visible_item: "拿起可见产品",
  remove_item: "取出产品",
  insert_item: "放入产品",
  rearrange: "重新排列",
  unknown: "关键状态"
};

function replacementPhysicalTransition(value = "", fallback = "unknown") {
  const source = String(value || "");
  if (/(?:取出|拿出|抽出|移出|掏出|remove|take\s*out|pull\s*out)/i.test(source)) return "remove_item";
  if (/(?:拿起|拿取|拾起|手持|握持|捏住|pick\s*up|hold|grasp)/i.test(source)) return "pick_up_visible_item";
  if (/(?:放入|放回|装入|塞入|insert|put\s*(?:in|back)|place\s*in)/i.test(source)) return "insert_item";
  if (/(?:重新排列|重新摆放|整理产品|调整排列|rearrang|reorder)/i.test(source)) return "rearrange";
  if (/(?:合上|盖回|关闭箱|关箱|遮住|close|cover)/i.test(source)) return "cover_only";
  if (/(?:开箱|拆箱|打开|掀开|揭开|箱盖|纸箱|包装箱|快递箱|unbox|open\s*(?:the\s*)?(?:box|carton|lid)|reveal)/i.test(source)) return "reveal_only";
  return fallback;
}

function replacementRevealState(value = "", productVisible = false) {
  const source = String(value || "");
  if (/(?:未开箱|未打开|尚未打开|封箱|完整纸箱|箱盖闭合|切割胶带|sealed|unopened|closed\s*box)/i.test(source)) return "pre_reveal";
  if (/(?:全开箱|完全打开|完全敞开|全部露出|完整露出|箱内全景|fully\s*open|full\s*reveal)/i.test(source)) return "full_reveal";
  if (/(?:半开箱|半开|部分打开|继续打开|再开一点|部分露出|partly\s*open|half\s*open|partial\s*reveal)/i.test(source)) return "partial_reveal";
  if (/(?:露出一点|露出少量|打开一点|稍微打开|刚(?:刚)?露出|初次露出|缝隙|slightly\s*open|initial\s*reveal)/i.test(source)) return "initial_reveal";
  return productVisible ? "not_applicable" : "pre_reveal";
}

function replacementPhysicalFrameEvidence(shot = {}, frame = {}) {
  const frameTime = Number(frame.time || 0);
  const containingPhase = (shot.actionPhases || []).find((phase) => frameTime + 0.001 >= Number(phase.start || 0) && frameTime <= Number(phase.end || 0) + 0.001);
  const phase = containingPhase || [...(shot.actionPhases || [])]
    .sort((left, right) => Math.abs(Number(left.criticalTime || left.start || 0) - frameTime) - Math.abs(Number(right.criticalTime || right.start || 0) - frameTime))[0];
  const moment = [...(shot.keyMoments || [])]
    .sort((left, right) => Math.abs(Number(left.time || 0) - frameTime) - Math.abs(Number(right.time || 0) - frameTime))[0];
  const evidenceText = [
    frame.description,
    phase?.action,
    moment?.description,
    moment?.productState,
    shot.action,
    shot.actionGeometry,
    shot.productExposure,
    shot.sourceProductEvidence
  ].filter(Boolean).join(" ");
  const declaredTransitionType = phase?.transitionType && phase.transitionType !== "unknown"
    ? phase.transitionType
    : "";
  let transitionType = declaredTransitionType || replacementPhysicalTransition(evidenceText);
  if (["remove_item", "pick_up_visible_item"].includes(transitionType)) {
    const plannedTransition = replacementPlanningTransition({
      transitionType,
      action: evidenceText,
      inventoryMutation: phase?.inventoryMutation
    });
    if (plannedTransition.type === "pick_up_visible_item") transitionType = plannedTransition.type;
  }
  const productVisible = typeof phase?.productVisible === "boolean" ? phase.productVisible : shot.productVisible === true;
  const revealState = phase?.revealState && phase.revealState !== "not_applicable"
    ? phase.revealState
    : replacementRevealState(evidenceText, productVisible);
  return {
    frameId: frame.id,
    time: frameTime,
    phaseId: phase?.id || frame.semanticPhaseId || "",
    transitionType,
    revealState,
    productVisible,
    inventoryMutation: transitionType === "pick_up_visible_item"
      ? false
      : phase?.inventoryMutation === true || ["remove_item", "insert_item", "rearrange"].includes(transitionType),
    evidence: text(evidenceText, 1200)
  };
}

function buildReplacementTransitionContract(state = {}) {
  const evidenceText = `${state.evidence || ""} ${state.action || ""}`;
  const plannedTransition = replacementPlanningTransition({ ...state, action: evidenceText });
  let type = ["reveal_only", "cover_only", "pick_up_visible_item", "remove_item", "insert_item", "rearrange"].includes(state.transitionType)
    ? state.transitionType
    : "preserve_state";
  if (["remove_item", "pick_up_visible_item"].includes(type) && plannedTransition.type === "pick_up_visible_item") {
    type = "pick_up_visible_item";
  }
  if (type === "preserve_state" && /展开|摊开|unfold/i.test(evidenceText)) type = "unfold_product";
  else if (type === "preserve_state" && /涂抹|贴敷|佩戴|使用|apply|wear|use/i.test(evidenceText)) type = "use_product";
  else if (type === "preserve_state" && /拿起|手持|握持|捏住|展示|hold|grasp|show/i.test(evidenceText)) type = "hold_or_display";
  const allowedChangesByType = {
    reveal_only: ["container_cover_angle", "hand_contact", "product_occlusion"],
    cover_only: ["container_cover_angle", "hand_contact", "product_occlusion"],
    pick_up_visible_item: ["picked_instance_position", "picked_instance_orientation", "hand_contact", "picked_instance_occlusion", "support_vacancy"],
    remove_item: ["held_product_position", "hand_contact", "product_occlusion", "visible_inventory_delta:-1"],
    insert_item: ["held_product_position", "hand_contact", "product_occlusion", "visible_inventory_delta:+1"],
    rearrange: ["product_position", "product_orientation", "hand_contact", "remaining_inventory_layout"],
    hold_or_display: ["held_product_position", "product_orientation", "hand_contact", "product_occlusion"],
    unfold_product: ["content_shape", "held_product_position", "hand_contact", "product_occlusion"],
    use_product: ["product_application_state", "held_product_position", "hand_contact", "product_occlusion"],
    preserve_state: ["hand_contact", "product_occlusion"]
  };
  const mustInherit = [
    "product_scale",
    "packaging_identity",
    "product_color_material",
    "scene",
    "person_identity"
  ];
  if (!["remove_item", "insert_item", "rearrange"].includes(type)) {
    mustInherit.push("visible_inventory_count", "remaining_inventory_layout");
  }
  if (type === "pick_up_visible_item") {
    mustInherit.push("unaffected_product_instance_trajectories", "remaining_support_graph");
  }
  return {
    schemaVersion: "one-click-replacement-transition-contract-v2",
    type,
    allowedChanges: allowedChangesByType[type],
    mustInherit,
    conservation: type === "pick_up_visible_item" ? {
      visibleProductCount: "constant",
      movingInstanceCount: 1,
      unaffectedInstances: "locked",
      supportGraphChange: "minimal_physics_only"
    } : null
  };
}

function buildMinimumSufficientAnchorSelection(analysis = {}, shot = {}, candidateFrameIds = []) {
  const frames = (analysis.keyframes || [])
    .filter((frame) => candidateFrameIds.includes(frame.id))
    .sort((left, right) => Number(left.time || 0) - Number(right.time || 0));
  if (!frames.length) return null;
  const shotEvidence = [
    shot.action,
    shot.actionGeometry,
    shot.productExposure,
    shot.sourceProductEvidence,
    shot.sourceProductRole,
    ...(shot.keyMoments || []).map((moment) => `${moment.description || ""} ${moment.productState || ""}`),
    ...(shot.actionPhases || []).map((phase) => phase.action)
  ].filter(Boolean).join(" ");
  const isContainerInteraction = shot.transportContainerVisible === true
    || shot.sourceProductRole === "transport_container"
    || /(?:开箱|拆箱|纸箱|包装箱|快递箱|箱盖|unbox|carton|shipping\s*box|open\s*(?:the\s*)?box)/i.test(shotEvidence);
  if (!isContainerInteraction) return null;

  const candidates = frames.map((frame) => replacementPhysicalFrameEvidence(shot, frame));
  const visibleUnclassified = candidates.filter((item) => item.transitionType === "reveal_only" && item.productVisible && item.revealState === "not_applicable");
  visibleUnclassified.forEach((item, index) => {
    item.revealState = index === 0 ? "initial_reveal" : "partial_reveal";
  });
  for (const item of candidates) {
    if (item.transitionType === "unknown" && ["pre_reveal", "initial_reveal", "partial_reveal", "full_reveal"].includes(item.revealState)) item.transitionType = "reveal_only";
    item.stateKey = item.inventoryMutation
      ? `${item.transitionType}:${item.phaseId || item.time}`
      : item.transitionType === "cover_only"
        ? `cover_only:${item.revealState}`
        : item.revealState !== "not_applicable"
          ? item.revealState
          : item.transitionType;
    item.stateLabel = REPLACEMENT_PHYSICAL_STATE_LABELS[item.revealState]
      || REPLACEMENT_PHYSICAL_STATE_LABELS[item.transitionType]
      || REPLACEMENT_PHYSICAL_STATE_LABELS.unknown;
  }

  const groups = new Map();
  for (const item of candidates) {
    if (!groups.has(item.stateKey)) groups.set(item.stateKey, []);
    groups.get(item.stateKey).push(item);
  }
  const stateAnchors = [...groups.values()].map((items) => {
    let representative = items[0];
    if (items[0].revealState === "full_reveal") representative = items.at(-1);
    else if (items[0].revealState === "partial_reveal") representative = items[Math.floor((items.length - 1) / 2)];
    const reuseSource = representative.revealState === "pre_reveal" && representative.productVisible !== true;
    return {
      ...representative,
      mode: reuseSource ? "reuse_source" : "generate",
      supportFrameIds: items.map((item) => item.frameId).filter((id) => id !== representative.frameId)
    };
  }).sort((left, right) => left.time - right.time);
  const fullRevealAnchor = [...stateAnchors].reverse().find((item) => item.revealState === "full_reveal" && item.mode === "generate");
  const generatedAnchors = stateAnchors.filter((item) => item.mode === "generate");
  const hasStructuredInventoryChain = shot.transportContainerVisible === true
    || shot.sourceProductRole === "transport_container"
    || (shot.actionPhases || []).some((phase) => (
      ["pre_reveal", "initial_reveal", "partial_reveal", "full_reveal"].includes(phase.revealState)
      || ["reveal_only", "remove_item", "insert_item", "rearrange"].includes(phase.transitionType)
    ));
  const requiresCanonicalInventoryAnchor = hasStructuredInventoryChain && candidates.some((item) => item.productVisible && (
    ["initial_reveal", "partial_reveal", "full_reveal"].includes(item.revealState)
    || ["reveal_only", "remove_item", "insert_item", "rearrange"].includes(item.transitionType)
  ));
  const inventoryEvidence = normalizeReplacementInventoryEvidence(shot.inventoryEvidence);
  const canonicalAnchor = fullRevealAnchor || null;
  const canonicalSourceKeyframeId = canonicalAnchor?.frameId || "";
  const blockingReasons = [];
  if (requiresCanonicalInventoryAnchor && !canonicalAnchor) {
    blockingReasons.push({
      code: "CANONICAL_INVENTORY_EVIDENCE_MISSING",
      sourceShotId: shot.id,
      message: `${shot.id}包含开箱或库存连续动作，但原片没有可确认完整数量与排列的全开库存画面；已按T4停止自动生成`
    });
  }
  if (inventoryEvidence.targetProductFit === "incompatible") {
    blockingReasons.push({
      code: "TARGET_PRODUCT_PHYSICAL_FIT_CONFLICT",
      sourceShotId: shot.id,
      message: `${shot.id}的容器空间、目标产品真实尺寸与数量策略存在明确物理冲突${inventoryEvidence.evidence ? `：${inventoryEvidence.evidence}` : ""}；已按T4停止自动生成`
    });
  }
  for (const item of stateAnchors) item.canonicalInventoryAnchor = item.frameId === canonicalSourceKeyframeId;
  for (const item of candidates) item.canonicalInventoryAnchor = item.frameId === canonicalSourceKeyframeId;
  const selectedStateFrameIds = stateAnchors.map((item) => item.frameId);
  const requiredGeneratedFrameIds = generatedAnchors.map((item) => item.frameId);
  return {
    policy: "minimum_sufficient_physical_states_v1",
    kind: "container_reveal",
    continuityGroupId: text(shot.continuityGroup, 160) || `container-${shot.id}`,
    stateAnchorCount: stateAnchors.length,
    requiredGeneratedAnchorCount: requiredGeneratedFrameIds.length,
    selectedStateFrameIds,
    requiredGeneratedFrameIds,
    supportFrameIds: candidates.map((item) => item.frameId).filter((id) => !selectedStateFrameIds.includes(id)),
    canonicalSourceKeyframeId,
    canonicalState: canonicalAnchor?.revealState || canonicalAnchor?.transitionType || "unknown",
    requiresCanonicalInventoryAnchor,
    canonicalEvidenceStatus: canonicalAnchor ? "available" : requiresCanonicalInventoryAnchor ? "missing" : "not_required",
    inventoryEvidence,
    blockingReasons,
    generationOrder: [canonicalSourceKeyframeId, ...requiredGeneratedFrameIds].filter((id, index, values) => id && values.indexOf(id) === index),
    lockedInventoryFields: ["product_count", "rows", "layers", "order", "orientation", "spacing", "packaging_level"],
    mutationPolicy: "只有remove_item、insert_item或rearrange阶段允许改变库存与排列；reveal_only和cover_only只能改变遮挡。",
    stateAnchors,
    candidates
  };
}

function replacementAnchorSelectionForManualFrames(selection = null, keyframeIds = []) {
  if (!selection || selection.policy !== "minimum_sufficient_physical_states_v1") return selection;
  const requestedIds = [...new Set((keyframeIds || []).map(String).filter(Boolean))];
  const candidateById = new Map((selection.candidates || []).map((item) => [item.frameId, item]));
  const reusedAnchors = (selection.stateAnchors || []).filter((item) => item.mode === "reuse_source");
  const generatedAnchors = requestedIds.map((frameId) => {
    const candidate = candidateById.get(frameId) || { frameId, time: 0, transitionType: "unknown", revealState: "not_applicable" };
    return { ...candidate, mode: "generate", supportFrameIds: [] };
  });
  const stateAnchors = [...reusedAnchors, ...generatedAnchors].sort((left, right) => Number(left.time || 0) - Number(right.time || 0));
  const canonicalAnchor = [...generatedAnchors].reverse().find((item) => item.revealState === "full_reveal") || null;
  const canonicalSourceKeyframeId = canonicalAnchor?.frameId || "";
  const blockingReasons = (selection.blockingReasons || [])
    .filter((item) => item.code !== "CANONICAL_INVENTORY_EVIDENCE_MISSING");
  if (selection.requiresCanonicalInventoryAnchor && !canonicalAnchor) {
    blockingReasons.push({
      code: "CANONICAL_INVENTORY_EVIDENCE_MISSING",
      sourceShotId: selection.blockingReasons?.find((item) => item.sourceShotId)?.sourceShotId || "",
      message: "当前开箱连续动作没有选中完整全开库存关键帧；已按T4停止自动生成"
    });
  }
  for (const item of stateAnchors) item.canonicalInventoryAnchor = item.frameId === canonicalSourceKeyframeId;
  const selectedStateFrameIds = stateAnchors.map((item) => item.frameId);
  return {
    ...selection,
    stateAnchorCount: stateAnchors.length,
    requiredGeneratedAnchorCount: requestedIds.length,
    selectedStateFrameIds,
    requiredGeneratedFrameIds: requestedIds,
    supportFrameIds: (selection.candidates || []).map((item) => item.frameId).filter((id) => !selectedStateFrameIds.includes(id)),
    canonicalSourceKeyframeId,
    canonicalState: canonicalAnchor?.revealState || canonicalAnchor?.transitionType || "unknown",
    canonicalEvidenceStatus: canonicalAnchor ? "available" : selection.requiresCanonicalInventoryAnchor ? "missing" : "not_required",
    blockingReasons,
    generationOrder: [canonicalSourceKeyframeId, ...requestedIds].filter((id, index, values) => id && values.indexOf(id) === index),
    stateAnchors
  };
}

function reconcileReplacementCanonicalInventoryGroups(units = []) {
  const groupIds = [...new Set(units.map((unit) => unit.physicalContinuityGroupId).filter(Boolean))];
  for (const groupId of groupIds) {
    const groupUnits = units.filter((unit) => unit.physicalContinuityGroupId === groupId && unit.anchorSelection);
    const canonicalOwner = groupUnits.find((unit) => unit.anchorSelection?.canonicalSourceKeyframeId);
    const canonicalSourceKeyframeId = canonicalOwner?.anchorSelection?.canonicalSourceKeyframeId || "";
    if (!canonicalSourceKeyframeId) continue;
    for (const unit of groupUnits) {
      const selection = unit.anchorSelection;
      if (!selection.requiresCanonicalInventoryAnchor) continue;
      selection.canonicalSourceKeyframeId = canonicalSourceKeyframeId;
      selection.canonicalState = "full_reveal";
      selection.canonicalEvidenceStatus = "available";
      selection.inventoryEvidence = mergeReplacementInventoryEvidence(selection.inventoryEvidence, canonicalOwner.anchorSelection.inventoryEvidence);
      selection.blockingReasons = (selection.blockingReasons || []).filter((reason) => reason.code !== "CANONICAL_INVENTORY_EVIDENCE_MISSING");
      selection.generationOrder = [canonicalSourceKeyframeId, ...(selection.requiredGeneratedFrameIds || [])]
        .filter((id, index, values) => id && values.indexOf(id) === index);
      for (const state of selection.stateAnchors || []) state.canonicalInventoryAnchor = state.frameId === canonicalSourceKeyframeId;
      for (const state of selection.candidates || []) state.canonicalInventoryAnchor = state.frameId === canonicalSourceKeyframeId;
    }
  }
  return units;
}

function applyReplacementRecommendedImageBudget(units = [], maximumAnchorImages = 0) {
  const requiredUnits = units.filter((unit) => unit.requiresReplacementAnchor && unit.requiredKeyframeIds.length);
  if (requiredUnits.length > maximumAnchorImages || maximumAnchorImages <= 0) return units;
  const minimumRequiredCount = requiredUnits.reduce((total, unit) => total + Math.max(1, (unit.minimumSufficientKeyframeIds || []).length), 0);
  if (minimumRequiredCount > maximumAnchorImages) return units;
  const selectedByUnit = new Map(requiredUnits.map((unit) => {
    const minimumIds = (unit.minimumSufficientKeyframeIds || []).filter((id) => unit.requiredKeyframeIds.includes(id));
    return [unit.id, minimumIds.length ? minimumIds : [unit.requiredKeyframeIds[0]]];
  }));
  const extras = requiredUnits.flatMap((unit) => unit.requiredKeyframeIds.filter((frameId) => !selectedByUnit.get(unit.id).includes(frameId)).map((frameId, index) => ({
    unit,
    frameId,
    frameIndex: index + 1
  }))).sort((left, right) => Number(right.unit.riskScore || 0) - Number(left.unit.riskScore || 0) || left.unit.order - right.unit.order || left.frameIndex - right.frameIndex);
  let remaining = maximumAnchorImages - minimumRequiredCount;
  for (const extra of extras) {
    if (remaining <= 0) break;
    selectedByUnit.get(extra.unit.id).push(extra.frameId);
    remaining -= 1;
  }
  return units.map((unit) => {
    if (!selectedByUnit.has(unit.id)) return unit;
    const requiredKeyframeIds = selectedByUnit.get(unit.id);
    return {
      ...unit,
      requiredKeyframeIds,
      keyframeIds: [...requiredKeyframeIds],
      requiredAnchorCount: requiredKeyframeIds.length,
      budgetSelectionReason: requiredKeyframeIds.length < unit.recommendedKeyframeIds.length
        ? "已按风险等级压缩推荐帧，确保换品关键帧与产品白底图不超过模型图片上限"
        : "已覆盖当前风险等级建议的关键帧"
    };
  });
}

function buildReplacementGenerationUnits(analysis, analysisUnits, options = {}) {
  const minimumDuration = clampNumber(options.minimumDuration, 3, 15, 4);
  const maximumDuration = clampNumber(options.maximumDuration, minimumDuration, 30, 15);
  const maxReferenceImages = Math.max(1, Math.floor(Number(options.maxReferenceImages) || 9));
  const productReferenceCount = Math.max(0, Math.floor(Number(options.productReferenceCount) || 0));
  const requiredAnchorCount = analysisUnits.reduce((total, unit) => total + Number(unit.requiredAnchorCount || 0), 0);
  const assetBudget = {
    multimodalMaximum: 12,
    imageMaximum: maxReferenceImages,
    videoMaximum: 3,
    audioMaximum: 3,
    maximum: maxReferenceImages,
    productTruth: productReferenceCount,
    anchorMaximum: Math.max(0, maxReferenceImages - productReferenceCount),
    requiredAnchors: requiredAnchorCount,
    required: productReferenceCount + requiredAnchorCount
  };
  const durationExceeded = Number(analysis.duration || 0) > maximumDuration + 0.05;
  const assetCapacityExceeded = productReferenceCount + requiredAnchorCount > maxReferenceImages;
  const splitReasonCodes = [
    ...(durationExceeded ? ["DURATION_EXCEEDS_MODEL"] : []),
    ...(assetCapacityExceeded ? ["ASSET_CAPACITY_EXCEEDED"] : [])
  ];
  const items = analysis.sourceShots.map((shot) => ({
    shot,
    analysisUnit: analysisUnits.find((unit) => unit.sourceShotIds.includes(shot.id)),
    requiredAnchorCount: Number(analysisUnits.find((unit) => unit.sourceShotIds.includes(shot.id))?.requiredAnchorCount || 0)
  }));
  const blockingReasons = [];
  if (!items.length) blockingReasons.push({ code: "MODEL_HARD_LIMIT", message: "原片没有可用于生成的原始镜头" });
  for (const item of items) {
    for (const reason of item.analysisUnit?.anchorSelection?.blockingReasons || []) {
      blockingReasons.push({
        ...reason,
        sourceShotId: reason.sourceShotId || item.shot.id
      });
    }
    const shotDuration = Number(item.shot.end || 0) - Number(item.shot.start || 0);
    if (shotDuration > maximumDuration + 0.05) {
      blockingReasons.push({
        code: "MODEL_HARD_LIMIT",
        sourceShotId: item.shot.id,
        message: `${item.shot.id}连续动作时长${shotDuration.toFixed(1)}秒超过模型${maximumDuration}秒上限，且镜头内部没有允许使用的原片硬切点`
      });
    }
    if (productReferenceCount + item.requiredAnchorCount > maxReferenceImages) {
      blockingReasons.push({
        code: "ASSET_CAPACITY_EXCEEDED",
        sourceShotId: item.shot.id,
        message: `${item.shot.id}最小必需参考图${productReferenceCount + item.requiredAnchorCount}张超过模型${maxReferenceImages}张上限`
      });
    }
  }
  const uniqueBlockingReasons = blockingReasons.filter((reason, index, values) => values.findIndex((item) => (
    item.code === reason.code && item.sourceShotId === reason.sourceShotId && item.message === reason.message
  )) === index);
  if (uniqueBlockingReasons.length) {
    return {
      generationUnits: [],
      blockingReasons: uniqueBlockingReasons,
      splitReasonCodes,
      assetBudget
    };
  }
  const groups = [];
  if (!durationExceeded && !assetCapacityExceeded) {
    groups.push(items);
  } else {
    let current = [];
    let currentStart = 0;
    let currentAnchorCount = 0;
    for (const item of items) {
      const projectedStart = current.length ? currentStart : Number(item.shot.start || 0);
      const projectedDuration = Number(item.shot.end || 0) - projectedStart;
      const projectedAssetCount = productReferenceCount + currentAnchorCount + item.requiredAnchorCount;
      if (current.length && (projectedDuration > maximumDuration + 0.05 || projectedAssetCount > maxReferenceImages)) {
        groups.push(current);
        current = [];
        currentAnchorCount = 0;
      }
      if (!current.length) currentStart = Number(item.shot.start || 0);
      current.push(item);
      currentAnchorCount += item.requiredAnchorCount;
    }
    if (current.length) groups.push(current);
  }
  const generationUnits = groups.map((group, index) => {
    const sourceStart = Number(group[0].shot.start || 0);
    const sourceEnd = Number(group.at(-1).shot.end || analysis.duration || 0);
    const sourceDuration = sourceEnd - sourceStart;
    const sourceShotIds = group.map((item) => item.shot.id);
    const requiredCandidateFrameIds = group.flatMap((item) => item.analysisUnit?.requiredKeyframeIds || []);
    const generationAnchorCount = group.reduce((total, item) => total + item.requiredAnchorCount, 0);
    return {
      id: groups.length === 1 ? "full-reference-video-unit-01" : `hard-limit-video-unit-${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      sourceRange: [Number(sourceStart.toFixed(3)), Number(sourceEnd.toFixed(3))],
      sourceStart: Number(sourceStart.toFixed(3)),
      sourceEnd: Number(sourceEnd.toFixed(3)),
      sourceDuration: Number(sourceDuration.toFixed(3)),
      targetDuration: Math.round(clampNumber(sourceDuration, minimumDuration, maximumDuration, minimumDuration)),
      sourceShotIds,
      requiredCandidateFrameIds,
      requiredAnchorIds: [],
      referenceAssetBudget: {
        multimodalMaximum: 12,
        imageMaximum: maxReferenceImages,
        videoMaximum: 3,
        audioMaximum: 3,
        productImages: productReferenceCount,
        anchorImages: generationAnchorCount,
        imageTotal: productReferenceCount + generationAnchorCount,
        videoTotal: 1
      },
      referencePolicy: "full_video_with_replacement_anchors",
      splitReason: groups.length === 1 ? "" : splitReasonCodes.join("+")
    };
  });
  return {
    generationUnits,
    blockingReasons: uniqueBlockingReasons,
    splitReasonCodes,
    assetBudget
  };
}

const REPLACEMENT_EXECUTION_CLASSIFICATION_SCHEMA_VERSION = "replacement-t1-t4-v2";
const REPLACEMENT_GENERATION_PLANNING_SCHEMA_VERSION = "one-click-replacement-generation-planning-v2";
const REPLACEMENT_GENERATION_COMPILER_VERSION = "one-click-replacement-generation-compiler-v2.1";
const REPLACEMENT_QA_CONTRACT_SCHEMA_VERSION = "one-click-replacement-qa-contract-v3";

const REPLACEMENT_EXECUTION_TYPES = Object.freeze({
  T1: Object.freeze({
    label: "单镜头连续换品",
    sourceStructureType: "single_continuous_action",
    qaProfile: "single_scene_continuity",
    anchorStrategy: "single_source_shot_anchor"
  }),
  T2: Object.freeze({
    label: "多人物／多场景硬切复刻",
    sourceStructureType: "hard_cut_montage",
    qaProfile: "source_hard_cut_preservation",
    anchorStrategy: "one_anchor_set_per_product_visible_source_shot"
  }),
  T3: Object.freeze({
    label: "跨状态物理连续换品",
    sourceStructureType: "physical_state_chain",
    qaProfile: "global_inventory_continuity",
    anchorStrategy: "minimum_sufficient_physical_states"
  }),
  T4: Object.freeze({
    label: "复杂或证据不足，人工处理",
    sourceStructureType: "complex_or_manual",
    qaProfile: "manual_review",
    anchorStrategy: "manual_case_design"
  })
});

function classifyReplacementExecution(analysisInput = {}, context = {}) {
  const analysis = analysisInput && typeof analysisInput === "object" ? analysisInput : {};
  const sourceShots = Array.isArray(analysis.sourceShots) ? analysis.sourceShots : [];
  const units = Array.isArray(context.units) ? context.units : [];
  const generationPlan = context.generationPlan && typeof context.generationPlan === "object" ? context.generationPlan : {};
  const physicalContinuityGroups = Array.isArray(context.physicalContinuityGroups) ? context.physicalContinuityGroups : [];
  const blockingReasons = Array.isArray(generationPlan.blockingReasons)
    ? generationPlan.blockingReasons
    : Array.isArray(context.blockingReasons) ? context.blockingReasons : [];
  const personTracks = sourceShots.flatMap((shot) => Array.isArray(shot.personTracks) ? shot.personTracks : []);
  const distinctPersonIds = [...new Set(personTracks.map((track) => text(track?.personId, 120)).filter(Boolean))];
  const hardCutCount = sourceShots.filter((shot, index) => index > 0 && shot.hardCutFromPrevious === true).length;
  const identityBoundaryCount = sourceShots.filter((shot) => shot.identityBoundarySplit === true).length;
  const identityReviewShotIds = sourceShots
    .filter((shot) => shot.identityReviewRequired === true || Number(shot.identityConfidence ?? 1) < 0.65)
    .map((shot) => shot.id);
  const transitionTypes = sourceShots.flatMap((shot) => (
    Array.isArray(shot.actionPhases) ? shot.actionPhases.map((phase) => phase.transitionType) : []
  )).filter(Boolean);
  const inventoryMutationCount = sourceShots.reduce((total, shot) => total + (
    Array.isArray(shot.actionPhases)
      ? shot.actionPhases.filter((phase) => phase.inventoryMutation === true || ["remove_item", "insert_item", "rearrange"].includes(phase.transitionType)).length
      : 0
  ), 0);
  const physicalStateAnchorCount = physicalContinuityGroups.reduce((total, group) => total + Number(group?.stateAnchorCount || 0), 0);
  const hasPhysicalStateChain = inventoryMutationCount > 0
    || physicalContinuityGroups.some((group) => Number(group?.stateAnchorCount || 0) >= 2 || Number(group?.unitIds?.length || 0) >= 2);
  const riskText = [
    ...(Array.isArray(analysis.risks) ? analysis.risks : []),
    ...(Array.isArray(analysis.identityRisks) ? analysis.identityRisks : []),
    ...sourceShots.flatMap((shot) => [shot.camera, shot.motion, shot.action, shot.actionGeometry, ...(shot.identityRisks || [])])
  ].filter(Boolean).join("；");
  const multiViewComplexity = /双机位|多机位|双视角|多视角|画中画|分屏|镜面.{0,12}(?:同步|同时)|dual[- ]?camera|multi[- ]?(?:camera|view)|split[- ]?screen/i.test(riskText);
  const handPerspectiveConflict = /(?:单手|一只手).{0,20}(?:双手|两只手)|(?:双手|两只手).{0,20}(?:单手|一只手)|手数变化|手部数量.{0,12}(?:变化|冲突)|hand count|one hand.{0,20}two hands/i.test(riskText);
  const unresolvedCrossShotConflict = /跨镜头.{0,24}(?:无法|冲突|失配)|(?:身份|人物|状态|透视).{0,20}(?:无法对应|无法消解|严重冲突)|unresolved.{0,20}(?:identity|continuity|perspective)/i.test(riskText);

  const reasonCodes = [];
  const reasons = [];
  let type = "T1";
  if (!sourceShots.length) {
    type = "T4";
    reasonCodes.push("NO_SOURCE_SHOTS");
    reasons.push("没有可验证的原片sourceShot，禁止自动生成与自动质检");
  }
  if (blockingReasons.length) {
    type = "T4";
    reasonCodes.push(...blockingReasons.map((item) => text(item?.code, 120) || "MODEL_HARD_LIMIT"));
    reasons.push(...blockingReasons.map((item) => text(item?.message, 500)).filter(Boolean));
  }
  if (multiViewComplexity) {
    type = "T4";
    reasonCodes.push("MULTI_VIEW_COMPLEXITY");
    reasons.push("检测到双机位、多视角或分屏等复杂结构，需要人工确定对应关系");
  }
  if (handPerspectiveConflict) {
    type = "T4";
    reasonCodes.push("HAND_PERSPECTIVE_CONFLICT");
    reasons.push("检测到手部数量或视角关系冲突，需要人工确定动作与产品透视");
  }
  if (unresolvedCrossShotConflict) {
    type = "T4";
    reasonCodes.push("UNRESOLVED_CROSS_SHOT_CONFLICT");
    reasons.push("检测到无法自动消解的跨镜头人物、状态或透视冲突");
  }
  if (type !== "T4" && hasPhysicalStateChain) {
    type = "T3";
    if (inventoryMutationCount > 0) {
      reasonCodes.push("INVENTORY_MUTATION");
      reasons.push("原片包含取出、放入或重新排列，必须锁定跨状态库存变化");
    }
    if (physicalContinuityGroups.length) {
      reasonCodes.push("PHYSICAL_STATE_CHAIN");
      reasons.push("原片包含需要最小充分状态锚点覆盖的开合、露出或容器连续链");
    }
  }
  if (type !== "T4" && type !== "T3" && (sourceShots.length > 1 || hardCutCount > 0 || identityBoundaryCount > 0)) {
    type = "T2";
    if (sourceShots.length > 1) reasonCodes.push("MULTIPLE_SOURCE_SHOTS");
    if (hardCutCount > 0) reasonCodes.push("SOURCE_HARD_CUT");
    if (identityBoundaryCount > 0) reasonCodes.push("PERSON_IDENTITY_BOUNDARY");
    reasons.push("原片由多个独立sourceShot组成；跨镜头人物、服装、发型、背景变化应按原片保留");
  }
  if (type === "T1") {
    reasonCodes.push("SINGLE_CONTINUOUS_SOURCE_SHOT");
    reasons.push("原片只有一个连续sourceShot，且没有跨状态库存依赖或复杂阻断项");
  }
  if (type !== "T4" && identityReviewShotIds.length) {
    reasonCodes.push("IDENTITY_EVIDENCE_SCOPED_TO_SOURCE_SHOTS");
    reasons.push(`人物主要身份证据不足的镜头已按原片边界独立保留：${identityReviewShotIds.join("、")}；不据此跨镜头合并人物，也不单独阻断生成`);
  }

  const descriptor = REPLACEMENT_EXECUTION_TYPES[type];
  const shotConfidence = sourceShots.length
    ? Math.min(...sourceShots.map((shot) => Number.isFinite(Number(shot.confidence)) ? Number(shot.confidence) : 0.85))
    : 0;
  const identityConfidence = personTracks.length
    ? Math.min(...personTracks.map((track) => Number(track.identityConfidence || 0)))
    : 1;
  const baseConfidence = type === "T4" ? 0.35 : type === "T3" ? 0.94 : type === "T2" ? 0.95 : 0.93;
  const confidence = Number(Math.max(0, Math.min(
    baseConfidence,
    type === "T4" ? 0.49 : 0.7 + Math.max(0, Math.min(1, shotConfidence)) * 0.3
  )).toFixed(2));
  const decision = type === "T4" || confidence < 0.6
    ? "manual_review"
    : confidence < 0.85 ? "user_confirmation" : "auto";
  const generationStrategy = type === "T4"
    ? "manual_review_before_generation"
    : Array.isArray(generationPlan.generationUnits) && generationPlan.generationUnits.length > 1
      ? "hard_limit_split"
      : "single_full_video_node";
  return {
    schemaVersion: REPLACEMENT_EXECUTION_CLASSIFICATION_SCHEMA_VERSION,
    type,
    label: descriptor.label,
    sourceStructureType: descriptor.sourceStructureType,
    qaProfile: descriptor.qaProfile,
    anchorStrategy: descriptor.anchorStrategy,
    generationStrategy,
    confidence,
    decision,
    reasonCodes: [...new Set(reasonCodes.filter(Boolean))],
    reasons: [...new Set(reasons.filter(Boolean))],
    evidence: {
      sourceShotCount: sourceShots.length,
      selectedUnitCount: units.length,
      hardCutCount,
      identityBoundaryCount,
      distinctPersonCount: distinctPersonIds.length,
      identityReviewShotIds,
      identityReviewScope: type === "T4" ? "manual_conflict_review" : "per_source_shot_only",
      minimumIdentityConfidence: Number(identityConfidence.toFixed(2)),
      physicalContinuityGroupCount: physicalContinuityGroups.length,
      physicalStateAnchorCount,
      inventoryMutationCount,
      transitionTypes: [...new Set(transitionTypes)],
      blockingReasonCodes: [...new Set(blockingReasons.map((item) => text(item?.code, 120)).filter(Boolean))]
    }
  };
}

function replacementPlanningPersonIds(unit = {}) {
  return [...new Set((Array.isArray(unit.personTracks) ? unit.personTracks : [])
    .filter((track) => Number(track?.identityConfidence ?? unit.identityConfidence ?? 0) >= 0.65)
    .map((track) => text(track?.personId, 120))
    .filter((personId) => personId && !/^(?:unknown|unidentified|未确认|未知)/i.test(personId)))];
}

function evaluateReplacementSemanticMerge(previousUnit = null, currentUnit = null, context = {}) {
  const executionClassification = context.executionClassification && typeof context.executionClassification === "object"
    ? context.executionClassification
    : {};
  const reasonCodes = [];
  const reasons = [];
  if (!previousUnit || !currentUnit) {
    return { allowed: false, reasonCodes: ["NON_ADJACENT_SOURCE_UNITS"], reasons: ["只有相邻原片镜头可以建立连续生成组"] };
  }
  const sourceGap = Number(currentUnit.sourceStart || 0) - Number(previousUnit.sourceEnd || 0);
  if (Math.abs(sourceGap) > 0.2) {
    reasonCodes.push("NON_ADJACENT_SOURCE_TIME");
    reasons.push(`两个镜头原片时间不相邻（间隔${Math.abs(sourceGap).toFixed(3)}秒）`);
  } else {
    reasonCodes.push("ADJACENT_SOURCE_TIME");
  }
  if (executionClassification.type === "T4" || executionClassification.decision === "manual_review") {
    reasonCodes.push("T4_MANUAL_REVIEW_REQUIRED");
    reasons.push("当前任务为T4，需要人工设计生成方案，不能自动建立语义合并组");
  }
  const previousPersonIds = replacementPlanningPersonIds(previousUnit);
  const currentPersonIds = replacementPlanningPersonIds(currentUnit);
  if (previousPersonIds.length && currentPersonIds.length && !previousPersonIds.some((personId) => currentPersonIds.includes(personId))) {
    reasonCodes.push("PERSON_IDENTITY_CONFLICT");
    reasons.push(`两个镜头人物身份明确不同（${previousPersonIds.join("、")} → ${currentPersonIds.join("、")}）`);
  } else if (previousPersonIds.length && currentPersonIds.length) {
    reasonCodes.push("PERSON_IDENTITY_CONTINUOUS");
  } else {
    reasonCodes.push("PERSON_IDENTITY_SCOPED_TO_SOURCE_SHOT");
  }
  const productConflictText = [
    previousUnit.sourceProductEvidence,
    currentUnit.sourceProductEvidence,
    previousUnit.productExposure,
    currentUnit.productExposure,
    previousUnit.continuity,
    currentUnit.continuity,
    ...(previousUnit.identityRisks || []),
    ...(currentUnit.identityRisks || [])
  ].filter(Boolean).join("；");
  if (/不同(?:产品|包装|SKU|版本)|包装版本(?:变化|冲突)|产品身份(?:变化|冲突)|product\s+(?:identity|version)\s+conflict/i.test(productConflictText)) {
    reasonCodes.push("PRODUCT_IDENTITY_CONFLICT");
    reasons.push("两个镜头存在明确的产品身份或包装版本冲突");
  } else {
    reasonCodes.push("PRODUCT_CONTINUITY_NOT_CONFLICTED");
  }
  const allowed = !reasonCodes.some((code) => [
    "NON_ADJACENT_SOURCE_UNITS",
    "NON_ADJACENT_SOURCE_TIME",
    "T4_MANUAL_REVIEW_REQUIRED",
    "PERSON_IDENTITY_CONFLICT",
    "PRODUCT_IDENTITY_CONFLICT"
  ].includes(code));
  if (allowed) reasonCodes.push("USER_CONFIRMED_CONTINUOUS_ACTION");
  return {
    allowed,
    sourceGap: Number(sourceGap.toFixed(3)),
    executionType: executionClassification.type || "",
    reasonCodes: [...new Set(reasonCodes)],
    reasons: [...new Set(reasons)]
  };
}

function replacementPlanningTransition(phase = {}) {
  const source = `${phase.transitionType || ""} ${phase.revealState || ""} ${phase.action || ""}`;
  const actionSource = String(phase.action || "");
  const explicit = text(phase.transitionType, 120);
  const visiblePickup = /(?:拿起|拿取|拾起|手持|握持|捏住|pick\s*up|hold|grasp)/i.test(actionSource);
  const containerExtraction = /(?:取出|拿出|抽出|移出|掏出|remove|take\s*out|pull\s*out|从.{0,16}(?:纸箱|箱|盒|罐|袋|包装|容器)(?:中|内|里))/i.test(actionSource);
  if (explicit === "pick_up_visible_item" || (visiblePickup && !containerExtraction)) {
    return { type: "pick_up_visible_item", label: "拿起可见产品", inventoryMutation: false };
  }
  if (explicit === "remove_item" || /取出|拿出|抽出|移出|remove|take\s*out/i.test(source)) return { type: "remove_item", label: "取出", inventoryMutation: true };
  if (explicit === "insert_item" || /放入|装入|塞入|insert|put\s*in/i.test(source)) return { type: "insert_item", label: "放入", inventoryMutation: true };
  if (explicit === "rearrange" || /重排|排列|码放|rearrange/i.test(source)) return { type: "rearrange", label: "重新排列", inventoryMutation: true };
  if (/展开|摊开|unfold|spread\s*out/i.test(source)) return { type: "unfold", label: "展开", inventoryMutation: false };
  if (/折叠|折起|fold/i.test(source)) return { type: "fold", label: "折叠", inventoryMutation: false };
  if (/关闭|合上|盖回|拧紧|close|seal/i.test(source)) return { type: "close", label: "关闭", inventoryMutation: false };
  if (/打开|开盖|揭开|撕开|拆开|旋开|open|unseal/i.test(source)) return { type: "open", label: "打开", inventoryMutation: false };
  if (/挤出|泵出|滴出|倒出|喷出|dispense|pour|spray/i.test(source)) return { type: "dispense", label: "倒出/挤出", inventoryMutation: true };
  if (/贴向|贴到|贴在|敷|涂抹|使用|apply|wear/i.test(source)) return { type: "apply", label: "使用", inventoryMutation: false };
  if (/拿起|拿取|拾起|手持|握持|hold|pick\s*up/i.test(source)) return { type: "pick_up_visible_item", label: "拿起可见产品", inventoryMutation: false };
  if (/展示|呈现|show|display/i.test(source)) return { type: "display", label: "展示", inventoryMutation: false };
  return { type: explicit || "preserve", label: text(phase.action, 28) || "保持", inventoryMutation: phase.inventoryMutation === true };
}

function replacementPlanningSourceShots(analysis = {}, sourceUnits = []) {
  const sourceShotIds = new Set(sourceUnits.flatMap((unit) => Array.isArray(unit.sourceShotIds) ? unit.sourceShotIds.map(String) : []));
  return (Array.isArray(analysis.sourceShots) ? analysis.sourceShots : []).filter((shot) => (
    sourceShotIds.has(String(shot?.id || ""))
    || (Array.isArray(shot?.sourceShotIds) && shot.sourceShotIds.some((id) => sourceShotIds.has(String(id))))
  ));
}

function replacementPlanningSourceRange(analysis = {}, sourceUnits = []) {
  const sourceShots = replacementPlanningSourceShots(analysis, sourceUnits);
  const unitRanges = sourceUnits.map((unit) => ({ start: Number(unit?.sourceStart), end: Number(unit?.sourceEnd) }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start);
  const ranges = sourceShots.length
    ? sourceShots.map((shot) => ({ start: Number(shot?.start), end: Number(shot?.end) }))
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    : unitRanges;
  const start = ranges.length ? Math.min(...ranges.map((range) => range.start)) : 0;
  const end = ranges.length ? Math.max(...ranges.map((range) => range.end)) : Math.max(start + 0.1, start);
  return { start, end, sourceShots };
}

function replacementPlanningHydratedUnit(analysis = {}, unit = {}) {
  const range = replacementPlanningSourceRange(analysis, [unit]);
  const sourceShots = range.sourceShots;
  const personTracks = Array.isArray(unit.personTracks) && unit.personTracks.length
    ? unit.personTracks
    : sourceShots.flatMap((shot) => Array.isArray(shot.personTracks) ? shot.personTracks : []);
  const identityConfidences = [
    Number(unit.identityConfidence),
    ...sourceShots.map((shot) => Number(shot.identityConfidence)),
    ...personTracks.map((track) => Number(track?.identityConfidence))
  ].filter(Number.isFinite);
  return {
    ...unit,
    sourceStart: range.start,
    sourceEnd: range.end,
    personTracks,
    identityConfidence: Number.isFinite(Number(unit.identityConfidence))
      ? Number(unit.identityConfidence)
      : identityConfidences.length ? Math.min(...identityConfidences) : 1,
    hardCutFromPrevious: unit.hardCutFromPrevious === true || sourceShots.some((shot) => shot.hardCutFromPrevious === true),
    identityBoundarySplit: unit.identityBoundarySplit === true || sourceShots.some((shot) => shot.identityBoundarySplit === true),
    sourceProductEvidence: unit.sourceProductEvidence || sourceShots.map((shot) => shot.sourceProductEvidence || shot.productLocator?.evidence).filter(Boolean).join("；"),
    productExposure: unit.productExposure || sourceShots.map((shot) => shot.productExposure).filter(Boolean).join("；"),
    continuity: unit.continuity || sourceShots.map((shot) => shot.continuity).filter(Boolean).join("；")
  };
}

function buildReplacementNormalizedActionTimeline(analysis = {}, sourceUnits = [], options = {}) {
  if (!sourceUnits.length) return [];
  const sourceRange = replacementPlanningSourceRange(analysis, sourceUnits);
  const unitStart = sourceRange.start;
  const unitEnd = sourceRange.end;
  const sourceDuration = Math.max(0.1, unitEnd - unitStart);
  const targetDuration = Math.max(0.1, Number(options.targetDuration || sourceDuration));
  const frames = Array.isArray(analysis.keyframes) ? analysis.keyframes : [];
  const sourceShots = sourceRange.sourceShots;
  const timelineRows = sourceUnits.flatMap((unit) => Array.isArray(unit.timeline) ? unit.timeline.map((item) => ({ unit, item })) : []);
  let phases = sourceShots.flatMap((shot) => {
    const rows = Array.isArray(shot.actionPhases) && shot.actionPhases.length
      ? shot.actionPhases
      : [{ start: shot.start, end: shot.end, action: shot.action, criticalTime: (Number(shot.start || 0) + Number(shot.end || 0)) / 2 }];
    return rows.map((phase) => ({ ...phase, sourceShotId: shot.id }));
  });
  if (!phases.length) {
    phases = timelineRows.map(({ unit, item }) => ({
      ...item,
      start: item.sourceStart,
      end: item.sourceEnd,
      sourceShotId: unit.sourceShotIds?.[0] || ""
    }));
  }
  if (!phases.length) {
    phases = sourceUnits.map((unit) => ({
      start: unit.sourceStart,
      end: unit.sourceEnd,
      action: unit.action || "按原片连续执行动作",
      criticalTime: (Number(unit.sourceStart || 0) + Number(unit.sourceEnd || 0)) / 2,
      sourceShotId: unit.sourceShotIds?.[0] || "",
      fallback: true
    }));
  }
  const sorted = phases.map((phase) => {
    const start = clampNumber(phase.start ?? phase.sourceStart, unitStart, unitEnd, unitStart);
    const end = clampNumber(phase.end ?? phase.sourceEnd, start, unitEnd, Math.max(start, unitEnd));
    return { ...phase, start, end };
  }).filter((phase) => phase.end > phase.start).sort((left, right) => left.start - right.start || left.end - right.end);
  if (!sorted.length) return [];
  sorted[0].start = unitStart;
  sorted[sorted.length - 1].end = unitEnd;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) sorted[index].start = sorted[index - 1].end;
  }
  const compacted = [];
  for (const phase of sorted.filter((item) => item.end > item.start)) {
    const previous = compacted.at(-1);
    if (previous && text(previous.action, 1000) === text(phase.action, 1000) && Math.abs(previous.end - phase.start) <= 0.05) {
      previous.end = phase.end;
      previous.inventoryMutation = previous.inventoryMutation === true || phase.inventoryMutation === true;
      continue;
    }
    compacted.push({ ...phase });
  }
  return compacted.map((phase, index) => {
    const criticalTime = clampNumber(phase.criticalTime, phase.start, phase.end, (phase.start + phase.end) / 2);
    const matchingTimeline = [...timelineRows]
      .sort((left, right) => Math.abs(Number(left.item.criticalTime ?? left.item.sourceStart ?? 0) - criticalTime) - Math.abs(Number(right.item.criticalTime ?? right.item.sourceStart ?? 0) - criticalTime))[0]?.item;
    const semanticFrame = [...frames]
      .filter((frame) => Number(frame.time) + 0.001 >= phase.start && Number(frame.time) <= phase.end + 0.001)
      .sort((left, right) => Math.abs(Number(left.time || 0) - criticalTime) - Math.abs(Number(right.time || 0) - criticalTime))[0]
      || frames.find((frame) => String(frame.id || "") === String(matchingTimeline?.sourceKeyframeId || ""));
    const transition = replacementPlanningTransition(phase);
    const normalizedStart = clampNumber((phase.start - unitStart) / sourceDuration, 0, 1, 0);
    const normalizedEnd = clampNumber((phase.end - unitStart) / sourceDuration, normalizedStart, 1, 1);
    return {
      actionId: `action-${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      action: text(phase.action, 1200) || "按原片连续执行动作",
      actionLabel: transition.label,
      sourceRange: { start: Number(phase.start.toFixed(3)), end: Number(phase.end.toFixed(3)) },
      normalizedRange: { start: Number(normalizedStart.toFixed(6)), end: Number(normalizedEnd.toFixed(6)) },
      targetRange: { start: Number((normalizedStart * targetDuration).toFixed(3)), end: Number((normalizedEnd * targetDuration).toFixed(3)) },
      criticalTime: Number(criticalTime.toFixed(3)),
      sourceShotId: text(phase.sourceShotId, 120),
      semanticFrameId: text(semanticFrame?.id || matchingTimeline?.sourceKeyframeId, 120),
      anchorSourceKeyframeId: text(matchingTimeline?.anchorSourceKeyframeId, 120),
      transitionType: transition.type,
      revealState: text(phase.revealState, 120) || "unknown",
      productVisible: phase.productVisible === true,
      inventoryMutation: transition.type === "pick_up_visible_item" ? false : phase.inventoryMutation === true || transition.inventoryMutation,
      fallback: phase.fallback === true
    };
  });
}

function buildReplacementProductStateChain(timeline = []) {
  if (!timeline.length) return [];
  const state = {
    packageState: "unknown",
    contentLocation: "unknown",
    contentShape: "unknown"
  };
  const chain = [];
  const pushState = (at, evidenceActionId, transitionType, label, inventoryMutation = false) => {
    const snapshot = {
      stateId: `product-state-${String(chain.length).padStart(2, "0")}`,
      order: chain.length,
      at: Number(clampNumber(at, 0, 1, 0).toFixed(6)),
      packageState: state.packageState,
      contentLocation: state.contentLocation,
      contentShape: state.contentShape,
      transitionType,
      label,
      inventoryMutation: inventoryMutation === true,
      evidenceActionId
    };
    const previous = chain.at(-1);
    if (previous && previous.packageState === snapshot.packageState && previous.contentLocation === snapshot.contentLocation && previous.contentShape === snapshot.contentShape && previous.transitionType === snapshot.transitionType) return;
    chain.push(snapshot);
  };
  for (const item of timeline) {
    const at = Number(item.normalizedRange?.start || 0);
    if (!chain.length) {
      if (item.transitionType === "open") state.packageState = "closed";
      if (item.transitionType === "remove_item") state.contentLocation = "inside_package";
      if (item.transitionType === "unfold") state.contentShape = "folded";
      pushState(at, item.actionId, "initial", "初始状态", false);
    }
    if (item.transitionType === "open") state.packageState = "open";
    if (item.transitionType === "close") state.packageState = "closed";
    if (item.transitionType === "remove_item") {
      if (state.packageState === "unknown") state.packageState = "open";
      state.contentLocation = "in_hand";
    }
    if (item.transitionType === "insert_item") state.contentLocation = "inside_package";
    if (item.transitionType === "unfold") state.contentShape = "unfolded";
    if (item.transitionType === "fold") state.contentShape = "folded";
    if (item.transitionType === "dispense") state.contentLocation = "dispensed";
    if (item.transitionType === "apply") state.contentLocation = "applied";
    if (item.transitionType === "pick_up_visible_item") state.contentLocation = "in_hand";
    if (item.transitionType === "hold" && state.contentLocation === "unknown") state.contentLocation = "in_hand";
    pushState(item.normalizedRange?.end ?? at, item.actionId, item.transitionType, item.actionLabel || item.action, item.inventoryMutation);
  }
  return chain.map((item, index) => ({ ...item, stateId: `product-state-${String(index).padStart(2, "0")}`, order: index }));
}

function buildReplacementPersonContinuityProfile(sourceUnits = [], executionClassification = {}) {
  const scopes = sourceUnits.map((unit) => ({
    sourceUnitId: unit.id,
    sourceShotIds: Array.isArray(unit.sourceShotIds) ? [...unit.sourceShotIds] : [],
    personIds: [...new Set((Array.isArray(unit.personTracks) ? unit.personTracks : []).map((track) => text(track?.personId, 120)).filter(Boolean))],
    hardCutFromPrevious: unit.hardCutFromPrevious === true,
    identityBoundary: unit.identityBoundarySplit === true
  }));
  const stableIds = [...new Set(sourceUnits.flatMap(replacementPlanningPersonIds))];
  const confidences = sourceUnits.flatMap((unit) => [
    Number(unit.identityConfidence),
    ...(Array.isArray(unit.personTracks) ? unit.personTracks.map((track) => Number(track?.identityConfidence)) : [])
  ]).filter(Number.isFinite);
  const locked = stableIds.length === 1 && sourceUnits.every((unit) => !replacementPlanningPersonIds(unit).length || replacementPlanningPersonIds(unit).includes(stableIds[0]));
  const reviewRequired = executionClassification.type === "T4";
  return {
    mode: reviewRequired ? "review_required" : locked ? "locked" : "scoped_by_source_shot",
    primaryPersonIds: stableIds,
    lockedFeatures: locked ? ["face", "hair", "bodyType"] : [],
    softFeatures: ["clothing", "accessories"],
    allowedCameraChanges: scopes.some((scope) => scope.hardCutFromPrevious) ? ["source_hard_cut", "camera_scale_change"] : ["camera_scale_change"],
    sourceShotScopes: scopes,
    confidence: Number((confidences.length ? Math.min(...confidences) : 0).toFixed(2)),
    reviewRequired,
    rule: locked
      ? "机位或景别变化不能解释为换人；保持同一人物主要身份特征。"
      : "人物身份只在各sourceShot证据范围内保持，不得用性别相同强行跨镜头统一。"
  };
}

function replacementGenerationUnitLabel(index) {
  return index < 26 ? `连续生成组 ${String.fromCharCode(65 + index)}` : `连续生成组 ${index + 1}`;
}

function replacementPlanningAnchorFrameIds(unit = {}) {
  if (unit.anchorStrategy === "inherit_previous") return [];
  const frameIds = Array.isArray(unit.requiredKeyframeIds)
    ? unit.requiredKeyframeIds
    : Array.isArray(unit.keyframeIds) ? unit.keyframeIds : [];
  return frameIds.map(String).filter(Boolean);
}

function buildReplacementGenerationPlanning(analysis = {}, unitsInput = [], options = {}) {
  const units = (Array.isArray(unitsInput) ? unitsInput : [])
    .filter((unit) => unit?.included !== false)
    .map((unit) => replacementPlanningHydratedUnit(analysis, unit));
  const executionClassification = options.executionClassification && typeof options.executionClassification === "object"
    ? options.executionClassification
    : classifyReplacementExecution(analysis, { units });
  const groups = [];
  const warnings = [];
  const decisionsByUnitId = new Map();
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const shareRequested = index > 0 && (unit.mergeWithPrevious === true || unit.anchorStrategy === "inherit_previous");
    const previousUnit = units[index - 1] || null;
    const decision = shareRequested
      ? evaluateReplacementSemanticMerge(previousUnit, unit, { executionClassification })
      : { allowed: false, reasonCodes: ["INDEPENDENT_SOURCE_UNIT"], reasons: [] };
    decisionsByUnitId.set(unit.id, { ...decision, requestedByUser: shareRequested });
    if (shareRequested && decision.allowed && groups.length) {
      groups.at(-1).push(unit);
      continue;
    }
    if (shareRequested && !decision.allowed) {
      warnings.push({
        code: "SEMANTIC_MERGE_SKIPPED",
        sourceUnitId: unit.id,
        reasonCodes: decision.reasonCodes,
        message: decision.reasons.join("；") || "当前共用关系不能升级为语义合并"
      });
    }
    groups.push([unit]);
  }
  const planningUnits = groups.map((sourceUnits, groupIndex) => {
    const sourceRange = replacementPlanningSourceRange(analysis, sourceUnits);
    const sourceStart = sourceRange.start;
    const sourceEnd = sourceRange.end;
    const normalizedActionTimeline = buildReplacementNormalizedActionTimeline(analysis, sourceUnits, { targetDuration: sourceEnd - sourceStart });
    const productStateChain = buildReplacementProductStateChain(normalizedActionTimeline);
    const personContinuityProfile = buildReplacementPersonContinuityProfile(sourceUnits, executionClassification);
    const sourceFrameIds = [...new Set(sourceUnits.flatMap(replacementPlanningAnchorFrameIds))].sort((leftId, rightId) => (
      Number((analysis.keyframes || []).find((frame) => frame.id === leftId)?.time || 0)
      - Number((analysis.keyframes || []).find((frame) => frame.id === rightId)?.time || 0)
    ));
    const semanticFrameIds = [...new Set(normalizedActionTimeline.map((item) => item.semanticFrameId).filter(Boolean))];
    const kind = sourceUnits.length > 1 ? "merged_generation_unit" : "single_generation_unit";
    const generationUnitId = `${kind === "merged_generation_unit" ? "merged" : "single"}-generation-unit-${String(groupIndex + 1).padStart(2, "0")}`;
    const anchorGroupId = `anchor-group-${String(groupIndex + 1).padStart(2, "0")}`;
    const actionLabels = normalizedActionTimeline.map((item) => item.actionLabel || item.action).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
    const productLabels = productStateChain.map((item) => item.label).filter((value) => value && value !== "初始状态").filter((value, index, values) => values.indexOf(value) === index);
    const mergeDecisions = sourceUnits.slice(1).map((unit) => decisionsByUnitId.get(unit.id)).filter(Boolean);
    const qaContract = {
      id: `qa-contract-${String(groupIndex + 1).padStart(2, "0")}`,
      schemaVersion: REPLACEMENT_QA_CONTRACT_SCHEMA_VERSION,
      executionType: executionClassification.type || "",
      qaProfile: executionClassification.qaProfile || "",
      sourceShotChecks: ["hard_cut_preserved", "per_source_shot_identity_preserved"],
      generationUnitChecks: ["merged_action_order_match", "person_continuity_match", "product_state_chain_match", "anchor_group_coverage_match"],
      retryPolicy: executionClassification.type === "T4" ? "manual_review_only" : "profile_controlled"
    };
    return {
      id: generationUnitId,
      kind,
      label: replacementGenerationUnitLabel(groupIndex),
      sourceUnitIds: sourceUnits.map((unit) => unit.id),
      sourceShotIds: [...new Set(sourceUnits.flatMap((unit) => unit.sourceShotIds || []))],
      sourceRange: { start: Number(sourceStart.toFixed(3)), end: Number(sourceEnd.toFixed(3)) },
      sourceBoundaries: sourceUnits.slice(1).map((unit) => ({
        at: Number(unit.sourceStart || 0),
        hardCut: unit.hardCutFromPrevious === true,
        identityBoundary: unit.identityBoundarySplit === true,
        sourceShotId: unit.sourceShotIds?.[0] || "",
        sourceUnitId: unit.id
      })),
      mergeDecision: {
        requestedByUser: sourceUnits.length > 1,
        allowed: sourceUnits.length > 1,
        executionType: executionClassification.type || "",
        reasonCodes: [...new Set(mergeDecisions.flatMap((decision) => decision.reasonCodes || []))],
        reasons: [...new Set(mergeDecisions.flatMap((decision) => decision.reasons || []))]
      },
      continuousActionSummary: actionLabels.join(" → ") || "按原片连续执行动作",
      normalizedActionTimeline,
      productStateChain,
      productStateSummary: productLabels.join(" → ") || "保持原片产品状态",
      personContinuityProfile,
      personContinuitySummary: personContinuityProfile.mode === "locked"
        ? `同一人物锁定${personContinuityProfile.primaryPersonIds.length ? `（${personContinuityProfile.primaryPersonIds.join("、")}）` : ""}`
        : personContinuityProfile.mode === "review_required" ? "人物连续性待人工复核" : "按原片sourceShot边界分别保持",
      anchorGroupId,
      qaContractId: qaContract.id,
      qaContract,
      anchorSummary: `身份锚点${sourceFrameIds.length ? 1 : 0}个 · 状态锚点${sourceFrameIds.length}个`,
      fallback: normalizedActionTimeline.some((item) => item.fallback) ? "legacy_action_summary" : null
    };
  });
  const anchorGroups = planningUnits.map((planningUnit, index) => {
    const sourceUnits = units.filter((unit) => planningUnit.sourceUnitIds.includes(unit.id));
    const stateAnchorIds = [...new Set(sourceUnits.flatMap(replacementPlanningAnchorFrameIds))].sort((leftId, rightId) => (
      Number((analysis.keyframes || []).find((frame) => frame.id === leftId)?.time || 0)
      - Number((analysis.keyframes || []).find((frame) => frame.id === rightId)?.time || 0)
    ));
    return {
      id: planningUnit.anchorGroupId,
      generationUnitId: planningUnit.id,
      identityAnchorId: stateAnchorIds[0] || "",
      stateAnchorIds,
      semanticFrameIds: [...new Set(planningUnit.normalizedActionTimeline.map((item) => item.semanticFrameId).filter(Boolean))],
      inheritance: {
        sourceUnitIds: [...planningUnit.sourceUnitIds],
        ownerSourceUnitId: sourceUnits.find((unit) => unit.anchorStrategy !== "inherit_previous")?.id || sourceUnits[0]?.id || ""
      },
      connectToVideoNode: [...stateAnchorIds],
      label: `关键帧组 ${index < 26 ? String.fromCharCode(65 + index) : index + 1}`
    };
  });
  for (const planningUnit of planningUnits) {
    const group = anchorGroups.find((item) => item.id === planningUnit.anchorGroupId);
    planningUnit.anchorSummary = `身份锚点${group?.identityAnchorId ? 1 : 0}个 · 状态锚点${group?.stateAnchorIds?.length || 0}个`;
  }
  return {
    schemaVersion: REPLACEMENT_GENERATION_PLANNING_SCHEMA_VERSION,
    compilerVersion: REPLACEMENT_GENERATION_COMPILER_VERSION,
    compiledAt: isoNow(),
    units: planningUnits,
    mergedUnits: planningUnits.filter((unit) => unit.kind === "merged_generation_unit"),
    anchorGroups,
    qaContracts: planningUnits.map((unit) => unit.qaContract),
    warnings,
    fallback: planningUnits.some((unit) => unit.fallback) ? "legacy_action_summary" : null
  };
}

function applyReplacementGenerationPlanning(plan = {}, analysis = {}, options = {}) {
  if (!plan || !Array.isArray(plan.units)) return plan;
  const executionClassification = options.executionClassification || plan.executionClassification || classifyReplacementExecution(analysis, { units: plan.units });
  const generationPlanning = buildReplacementGenerationPlanning(analysis, plan.units, { executionClassification });
  plan.version = Math.max(5, Number(plan.version || 0));
  plan.generationPlanningVersion = 2;
  plan.generationPlanning = generationPlanning;
  plan.mergedUnits = generationPlanning.mergedUnits;
  plan.anchorGroups = generationPlanning.anchorGroups;
  plan.qaContracts = generationPlanning.qaContracts;
  return plan;
}

function buildReplacementShotPlan(analysisInput = {}, options = {}) {
  const analysis = normalizeReplacementSourceAnalysis(analysisInput, {
    duration: analysisInput.duration || options.duration,
    keyframes: analysisInput.keyframes || options.keyframes,
    provider: analysisInput.provider || options.provider,
    inputMode: analysisInput.inputMode || options.inputMode,
    analyzedAt: analysisInput.analyzedAt
  });
  const minimumDuration = clampNumber(options.minimumDuration, 3, 15, 4);
  const maximumDuration = clampNumber(options.maximumDuration, minimumDuration, 30, 15);
  const comfortableDuration = clampNumber(options.comfortableDuration, minimumDuration, maximumDuration, maximumDuration <= 10 ? 7 : 8);
  const preserveShortMontage = true;
  const requiresVisualAnchors = options.requireReplacementAnchors !== false;
  const mode = options.generationMode === "smart" ? "smart" : "manual";
  const productReferenceCount = Math.max(0, Math.floor(Number(options.productReferenceCount) || 0));
  const maximumReferenceImages = Math.max(1, Math.floor(Number(options.maxReferenceImages) || 9));
  let units = analysis.sourceShots.map((shot, index) => {
    const policy = deterministicShotReferencePolicy(shot);
    const requestedTimes = [
      ...(shot.keyMoments || []).map((moment) => moment.time),
      ...(shot.actionPhases || []).map((phase) => phase.criticalTime),
      ...(shot.personTracks || []).map((track) => (Number(track.visibleStart || shot.start) + Number(track.visibleEnd || shot.end)) / 2),
      ...(shot.keyframeTimes || [])
    ].filter(Number.isFinite);
    const requestedCandidateFrameIds = nearestReplacementKeyframes(analysis, shot.start, shot.end, requestedTimes);
    const allShotFrameIds = (analysis.keyframes || [])
      .filter((frame) => frame.sourceShotId === shot.id || (!frame.sourceShotId && Number(frame.time) + 0.001 >= shot.start && Number(frame.time) <= shot.end + 0.001))
      .map((frame) => frame.id);
    const requiresReplacementAnchor = requiresVisualAnchors && shot.productVisible;
    const anchorSelection = buildMinimumSufficientAnchorSelection(analysis, shot, allShotFrameIds.length ? allShotFrameIds : requestedCandidateFrameIds);
    const candidateFrameIds = anchorSelection ? (allShotFrameIds.length ? allShotFrameIds : requestedCandidateFrameIds) : requestedCandidateFrameIds;
    const requiredKeyframeIds = requiresReplacementAnchor
      ? (anchorSelection?.requiredGeneratedFrameIds?.length
          ? anchorSelection.requiredGeneratedFrameIds
          : requiredReplacementKeyframeIds(analysis, shot, candidateFrameIds, { generationMode: mode }))
      : [];
    const sourceDuration = shot.end - shot.start;
    return {
      id: `source-shot-unit-${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      included: true,
      immutableStructure: true,
      title: shot.title || `原片镜头${index + 1}`,
      sourceShotIds: [shot.id],
      sourceStart: Number(shot.start.toFixed(3)),
      sourceEnd: Number(shot.end.toFixed(3)),
      sourceDuration: Number(sourceDuration.toFixed(3)),
      targetDuration: Math.round(clampNumber(sourceDuration, minimumDuration, maximumDuration, minimumDuration)),
      productVisible: shot.productVisible,
      subjects: shot.subjects,
      personTracks: Array.isArray(shot.personTracks) ? shot.personTracks : [],
      identityConfidence: Number(shot.identityConfidence ?? 1),
      identityReviewRequired: shot.identityReviewRequired === true,
      identityRisks: Array.isArray(shot.identityRisks) ? shot.identityRisks : [],
      identityBoundarySplit: shot.identityBoundarySplit === true,
      identityBoundaryReason: text(shot.identityBoundaryReason, 1000),
      hardCutFromPrevious: shot.hardCutFromPrevious === true,
      requiresReplacementAnchor,
      mergeWithPrevious: false,
      anchorStrategy: "generate",
      mergeGroupRootUnitId: "",
      inheritsAnchorFromUnitId: "",
      action: shot.action,
      actionGeometry: shot.actionGeometry,
      productExposure: shot.productExposure,
      sourceProductRole: shot.sourceProductRole || "unknown",
      sourceProductEvidence: shot.sourceProductEvidence || "",
      transportContainerVisible: shot.transportContainerVisible === true,
      productLocator: shot.productLocator || {},
      continuity: shot.continuity,
      continuityGroup: shot.continuityGroup || anchorSelection?.continuityGroupId || "",
      physicalContinuityGroupId: anchorSelection?.continuityGroupId || "",
      anchorSelection,
      minimumSufficientKeyframeIds: anchorSelection?.requiredGeneratedFrameIds || [],
      riskLevel: shot.riskLevel,
      riskScore: replacementShotRiskScore(shot),
      riskDimensions: shot.riskDimensions,
      recommendedReferencePolicy: policy.policy,
      referencePolicy: policy.policy,
      referenceReason: policy.reason,
      candidateFrameIds,
      recommendedKeyframeIds: requiredKeyframeIds,
      requiredKeyframeIds,
      keyframeIds: requiredKeyframeIds,
      requiredAnchorCount: requiresReplacementAnchor ? requiredKeyframeIds.length : 0,
      timeline: replacementTimelineForUnit([shot], analysis, requiredKeyframeIds, shot.start, shot.end, sourceDuration),
      splitReason: shot.identityBoundarySplit
        ? (shot.identityBoundaryReason || "检测到人物身份变化，已建立独立原片镜头")
        : shot.hardCutFromPrevious
          ? "原片硬切后形成的独立原始镜头"
          : "同一原始镜头内保留连续动作阶段",
      modelMinimumDuration: minimumDuration,
      modelMaximumDuration: maximumDuration,
      selectedAnchorCandidateIds: []
    };
  });
  units = reconcileReplacementCanonicalInventoryGroups(units);
  units = applyReplacementRecommendedImageBudget(units, Math.max(0, maximumReferenceImages - productReferenceCount));
  units = units.map((unit) => {
    const shot = analysis.sourceShots.find((item) => unit.sourceShotIds.includes(item.id));
    const requiredKeyframeIds = [...unit.requiredKeyframeIds].sort((leftId, rightId) => (
      Number(analysis.keyframes.find((frame) => frame.id === leftId)?.time || 0)
      - Number(analysis.keyframes.find((frame) => frame.id === rightId)?.time || 0)
    ));
    return {
      ...unit,
      requiredKeyframeIds,
      keyframeIds: [...requiredKeyframeIds],
      timeline: replacementTimelineForUnit(shot ? [shot] : [], analysis, requiredKeyframeIds, unit.sourceStart, unit.sourceEnd, unit.sourceDuration)
    };
  });
  const generationPlan = buildReplacementGenerationUnits(analysis, units, options);
  const requiredAnchorCount = units.reduce((total, unit) => total + Number(unit.requiredAnchorCount || 0), 0);
  const physicalContinuityGroups = [...new Set(units.map((unit) => unit.physicalContinuityGroupId).filter(Boolean))].map((groupId) => {
    const groupUnits = units.filter((unit) => unit.physicalContinuityGroupId === groupId);
    const stateAnchors = groupUnits.flatMap((unit) => unit.anchorSelection?.stateAnchors || []);
    const canonicalUnit = groupUnits.find((unit) => unit.anchorSelection?.canonicalSourceKeyframeId);
    return {
      id: groupId,
      kind: "container_reveal",
      unitIds: groupUnits.map((unit) => unit.id),
      stateAnchorCount: stateAnchors.length,
      requiredGeneratedAnchorCount: groupUnits.reduce((total, unit) => total + Number(unit.requiredAnchorCount || 0), 0),
      canonicalSourceKeyframeId: canonicalUnit?.anchorSelection?.canonicalSourceKeyframeId || "",
      canonicalEvidenceStatus: canonicalUnit?.anchorSelection?.canonicalEvidenceStatus || "not_required",
      inventoryEvidence: canonicalUnit?.anchorSelection?.inventoryEvidence || normalizeReplacementInventoryEvidence(),
      blockingReasons: groupUnits.flatMap((unit) => unit.anchorSelection?.blockingReasons || []),
      lockedInventoryFields: ["product_count", "rows", "layers", "order", "orientation", "spacing", "packaging_level"],
      mutationPolicy: "只有取出、放入或重新排列产品时允许改变库存与排列。"
    };
  });
  const coverageMatrix = units.map((unit) => ({
    sourceShotId: unit.sourceShotIds[0],
    sourceRange: [unit.sourceStart, unit.sourceEnd],
    productVisible: unit.productVisible,
    anchorRequired: unit.requiresReplacementAnchor !== false && unit.productVisible,
    requiredAnchorCount: unit.requiredAnchorCount,
    requiredKeyframeIds: [...unit.requiredKeyframeIds],
    selectedAnchorIds: [],
    connectedNodeKeys: [],
    promptBound: false,
    covered: !(unit.requiresReplacementAnchor !== false && unit.productVisible),
    reason: unit.requiresReplacementAnchor !== false && unit.productVisible
      ? (unit.requiredKeyframeIds.length ? "等待生成并选用换品锚点" : "未提取到该产品可见镜头的候选关键帧")
      : "产品不可见，免除换品锚点"
  }));
  const executionClassification = classifyReplacementExecution(analysis, {
    units,
    generationPlan,
    physicalContinuityGroups
  });
  const plan = {
    version: 4,
    physicalStatePlanningVersion: 2,
    identityTrackingVersion: 1,
    executionClassificationVersion: 2,
    executionClassification,
    status: mode === "smart" ? "confirmed" : "awaiting_confirmation",
    generationMode: mode,
    generatedAt: isoNow(),
    confirmed: mode === "smart",
    confirmedAt: mode === "smart" ? isoNow() : "",
    confirmationMode: mode === "smart" ? "auto" : "",
    originalShotCount: analysis.originalShotCount,
    sourceShotCount: analysis.sourceShots.length,
    semanticSegmentCount: analysis.semanticSegments.length,
    subjectProfileCount: analysis.subjectProfiles.length,
    identityReviewShotCount: analysis.identityReviewShotCount,
    productVisibleShotCount: units.filter((unit) => unit.productVisible).length,
    requiredAnchorShotCount: units.filter((unit) => unit.requiresReplacementAnchor).length,
    requiredAnchorCount,
    physicalStateAnchorCount: units.reduce((total, unit) => total + Number(unit.anchorSelection?.stateAnchorCount || 0), 0),
    physicalContinuityGroups,
    coveredAnchorCount: 0,
    replacementAnchors: [],
    coverageMatrix,
    generationUnits: generationPlan.generationUnits,
    generationUnitCount: generationPlan.generationUnits.length,
    videoNodeCount: generationPlan.generationUnits.length,
    generationStrategy: generationPlan.generationUnits.length === 1 ? "single_full_video_node" : "hard_limit_split",
    splitReasonCodes: generationPlan.splitReasonCodes,
    blockingReasons: generationPlan.blockingReasons,
    assetBudget: generationPlan.assetBudget,
    preflightStatus: generationPlan.blockingReasons.length ? "blocked" : "pending_anchors",
    planner: {
      strategy: "source-analysis-single-node-execution-v1",
      generationStrategyVersion: "one-click-replacement-single-node-v1",
      modelId: text(options.modelId, 120),
      modelLabel: text(options.modelLabel, 240),
      minimumDuration,
      maximumDuration,
      comfortableDuration,
      preserveShortMontage,
      sourceShotAligned: true,
      analysisUnitsDoNotCreateVideoNodes: true
    },
    units,
    systemRecommendedUnits: JSON.parse(JSON.stringify(units))
  };
  return applyReplacementGenerationPlanning(plan, analysis, { executionClassification });
}

function refreshReplacementCoverage(job = {}) {
  const plan = job.shotPlan;
  if (!plan || !Array.isArray(plan.units)) return plan || null;
  const successfulCandidates = new Map((job.shotAnchorCandidates || [])
    .filter((candidate) => candidate?.status === "success" && candidate.localPath)
    .map((candidate) => [candidate.id, candidate]));
  const replacementAnchors = [];
  const coverageMatrix = plan.units.map((unit) => {
    const requiredKeyframeIds = Array.isArray(unit.requiredKeyframeIds) ? unit.requiredKeyframeIds : (unit.keyframeIds || []);
    const productVisible = unit.productVisible !== false && (
      unit.productVisible === true
      || Number(unit.requiredAnchorCount || 0) > 0
      || requiredKeyframeIds.length > 0
      || Boolean(String(unit.productExposure || "").trim())
    );
    const anchorRequired = unit.requiresReplacementAnchor !== false && productVisible;
    const selectedCandidates = (unit.selectedAnchorCandidateIds || []).map((id) => successfulCandidates.get(id)).filter(Boolean);
    const sourceShotId = unit.sourceShotIds?.[0] || "";
    const anchors = selectedCandidates.map((candidate) => ({
      id: candidate.id,
      sourceShotId,
      sourceKeyframeId: candidate.sourceKeyframeId,
      sourceTime: Number(candidate.sourceKeyframeTime || 0),
      sourceRange: [unit.sourceStart, unit.sourceEnd],
      localPath: candidate.localPath,
      assetNodeKey: text(candidate.assetNodeKey, 240),
      selected: true,
      productValidation: candidate.productValidation || "manual_selected"
    }));
    const deduplicatedAnchors = anchors.filter((anchor, index, values) => (
      values.findIndex((item) => item.sourceKeyframeId === anchor.sourceKeyframeId) === index
    ));
    replacementAnchors.push(...deduplicatedAnchors);
    const coveredKeyframeIds = new Set(deduplicatedAnchors.map((anchor) => anchor.sourceKeyframeId));
    const requiredAnchorCount = anchorRequired
      ? Math.max(1, Number(unit.requiredAnchorCount || requiredKeyframeIds.length || 0))
      : 0;
    const hasCandidateFrames = requiredKeyframeIds.length >= requiredAnchorCount;
    const covered = !anchorRequired || (hasCandidateFrames && requiredKeyframeIds.every((id) => coveredKeyframeIds.has(id)));
    return {
      sourceShotId,
      sourceRange: [unit.sourceStart, unit.sourceEnd],
      productVisible,
      anchorRequired,
      requiredAnchorCount,
      requiredKeyframeIds: [...requiredKeyframeIds],
      coveredAnchorCount: requiredKeyframeIds.filter((id) => coveredKeyframeIds.has(id)).length,
      selectedAnchorIds: deduplicatedAnchors.map((anchor) => anchor.id),
      connectedNodeKeys: deduplicatedAnchors.map((anchor) => anchor.assetNodeKey).filter(Boolean),
      promptBound: deduplicatedAnchors.length > 0 && deduplicatedAnchors.every((anchor) => Boolean(anchor.assetNodeKey && anchor.promptBound)),
      covered,
      reason: covered
        ? (anchorRequired ? "必需换品锚点已选齐" : productVisible ? "当前任务不替换画面产品，免除换品锚点" : "产品不可见，免除换品锚点")
        : !hasCandidateFrames
          ? "产品可见镜头缺少候选关键帧"
          : "等待生成并选用全部必需换品锚点"
    };
  });
  for (let unitIndex = 0; unitIndex < plan.units.length; unitIndex += 1) {
    const unit = plan.units[unitIndex];
    if (unit.anchorStrategy !== "inherit_previous" || !unit.inheritsAnchorFromUnitId) continue;
    const ownerIndex = plan.units.findIndex((candidate) => candidate.id === unit.inheritsAnchorFromUnitId);
    const ownerUnit = ownerIndex >= 0 ? plan.units[ownerIndex] : null;
    const ownerCoverage = ownerIndex >= 0 ? coverageMatrix[ownerIndex] : null;
    const row = coverageMatrix[unitIndex];
    row.anchorRequired = false;
    row.requiredAnchorCount = 0;
    row.requiredKeyframeIds = [];
    // An inherited shot is covered by the owner's anchor, but it does not add
    // another anchor to the aggregate numerator. Keeping the owner's count here
    // made the UI report impossible values such as 7/6 after a manual merge.
    row.coveredAnchorCount = 0;
    row.selectedAnchorIds = [...(ownerCoverage?.selectedAnchorIds || [])];
    row.connectedNodeKeys = [...(ownerCoverage?.connectedNodeKeys || [])];
    row.promptBound = ownerCoverage?.promptBound === true;
    row.covered = ownerCoverage?.covered === true;
    row.anchorStrategy = "inherit_previous";
    row.inheritsAnchorFromUnitId = unit.inheritsAnchorFromUnitId;
    row.reason = row.covered
      ? `沿用${ownerUnit ? `镜头${String(ownerUnit.order).padStart(2, "0")}` : "上一镜头"}换品锚点，当前镜头无需重复生成关键帧`
      : `等待${ownerUnit ? `镜头${String(ownerUnit.order).padStart(2, "0")}` : "上一镜头"}换品锚点完成`;
  }
  const uniqueReplacementAnchors = replacementAnchors.filter((anchor, index, values) => (
    values.findIndex((item) => item.id === anchor.id) === index
  ));
  plan.replacementAnchors = uniqueReplacementAnchors;
  plan.coverageMatrix = coverageMatrix;
  plan.requiredAnchorCount = coverageMatrix.reduce((total, row) => total + Number(row.requiredAnchorCount || 0), 0);
  plan.coveredAnchorCount = coverageMatrix.reduce((total, row) => total + Number(row.coveredAnchorCount || 0), 0);
  plan.generationUnits = (plan.generationUnits || []).map((generationUnit) => ({
    ...generationUnit,
    requiredAnchorIds: uniqueReplacementAnchors
      .filter((anchor) => generationUnit.sourceShotIds?.includes(anchor.sourceShotId))
      .map((anchor) => anchor.id)
  }));
  plan.preflightStatus = (plan.blockingReasons || []).length
    ? "blocked"
    : coverageMatrix.every((row) => row.covered)
      ? "ready_for_upload"
      : "ANCHOR_COVERAGE_INCOMPLETE";
  return plan;
}

function validateReplacementAnchorDependencySnapshot(allCandidates = [], selectedCandidates = []) {
  const candidatesById = new Map((allCandidates || []).map((candidate) => [candidate.id, candidate]));
  const mismatches = [];
  for (const candidate of selectedCandidates || []) {
    if (candidate.anchorDependencySchemaVersion !== REPLACEMENT_ANCHOR_DEPENDENCY_SCHEMA_VERSION) continue;
    const dependencies = Array.isArray(candidate.anchorDependencies) ? candidate.anchorDependencies : [];
    const sourceDependency = dependencies.find((dependency) => dependency.role === "source_semantic_keyframe");
    if (!sourceDependency?.assetId || !sourceDependency?.sha256) {
      mismatches.push({ candidateId: candidate.id, code: "SOURCE_DEPENDENCY_MISSING" });
    }
    if (candidate.canonicalInventoryAnchor === true) {
      if (candidate.canonicalInventoryQa?.status !== "passed") {
        mismatches.push({ candidateId: candidate.id, code: "CANONICAL_INVENTORY_QA_NOT_PASSED" });
      }
      if (!["auto_adopted", "user_selected"].includes(candidate.adoption?.status)) {
        mismatches.push({ candidateId: candidate.id, code: "CANONICAL_INVENTORY_NOT_ADOPTED" });
      }
    }
    for (const dependency of dependencies.filter((item) => item.role === "canonical_inventory_anchor")) {
      const upstream = candidatesById.get(dependency.assetId);
      if (!upstream || upstream.status !== "success" || !upstream.localPath) {
        mismatches.push({ candidateId: candidate.id, code: "CANONICAL_INVENTORY_DEPENDENCY_MISSING", dependency });
        continue;
      }
      if (!dependency.sha256 || dependency.sha256 !== upstream.sha256) {
        mismatches.push({ candidateId: candidate.id, code: "CANONICAL_INVENTORY_SHA_MISMATCH", dependency, actualSha256: upstream.sha256 || "" });
      }
      if (upstream.canonicalInventoryQa?.status !== "passed") {
        mismatches.push({ candidateId: candidate.id, code: "CANONICAL_INVENTORY_QA_NOT_PASSED", dependency });
      }
    }
  }
  return {
    passed: mismatches.length === 0,
    schemaVersion: REPLACEMENT_ANCHOR_DEPENDENCY_SCHEMA_VERSION,
    checkedCandidateCount: (selectedCandidates || []).filter((candidate) => candidate.anchorDependencySchemaVersion === REPLACEMENT_ANCHOR_DEPENDENCY_SCHEMA_VERSION).length,
    mismatches
  };
}

function segmentLockedScript(lockedScript, maxVisibleChars = 42) {
  const source = String(lockedScript ?? "");
  if (!source.trim()) throw new Error("新口播文案不能为空");
  const limit = Math.max(8, Math.min(120, Number(maxVisibleChars) || 42));
  const chars = Array.from(source);
  const segments = [];
  let start = 0;
  while (start < chars.length) {
    let visible = 0;
    let cursor = start;
    let boundary = -1;
    while (cursor < chars.length && visible < limit) {
      const char = chars[cursor];
      cursor += 1;
      if (!/\s/u.test(char)) visible += 1;
      if (/[。！？!?；;，,、\n]/u.test(char)) boundary = cursor;
    }
    if (cursor < chars.length && boundary > start) cursor = boundary;
    if (cursor <= start) cursor = start + 1;
    segments.push(chars.slice(start, cursor).join(""));
    start = cursor;
  }
  if (segments.join("") !== source) throw new Error("口播分段后与锁定原文不一致");
  return segments;
}

function createLockedScript(value, version = 1) {
  const lockedScript = String(value ?? "").replace(/\r\n/g, "\n");
  if (!lockedScript.trim()) throw new Error("新口播文案不能为空");
  const segments = segmentLockedScript(lockedScript);
  return {
    lockedScript,
    version: Math.max(1, Number(version) || 1),
    sha256: sha256Text(lockedScript),
    segments,
    immutable: true,
    policy: "verbatim_only"
  };
}

function countTimingChars(value) {
  return Array.from(String(value || "").replace(/\s/g, "")).length;
}

function assertLockedScriptIntegrity(lockedInput) {
  if (!lockedInput || typeof lockedInput !== "object") throw new Error("新口播锁定记录不存在，请重新创建任务");
  const lockedScript = String(lockedInput.lockedScript ?? "");
  if (!lockedScript.trim()) throw new Error("新口播锁定原文不存在，请重新创建任务");
  const expectedSha256 = String(lockedInput.sha256 || "").trim().toLowerCase();
  const actualSha256 = sha256Text(lockedScript);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || expectedSha256 !== actualSha256) {
    throw new Error("新口播锁定校验失败：原文与 SHA-256 不一致，已停止任务");
  }
  if (lockedInput.immutable !== true || String(lockedInput.policy || "") !== "verbatim_only") {
    throw new Error("新口播锁定策略无效，已停止任务");
  }
  const segments = Array.isArray(lockedInput.segments)
    ? lockedInput.segments.map((item) => String(item ?? ""))
    : [];
  if (!segments.length || segments.join("") !== lockedScript) {
    throw new Error("新口播锁定校验失败：分段与锁定原文不一致，已停止任务");
  }
  return {
    lockedScript,
    version: Math.max(1, Number(lockedInput.version) || 1),
    sha256: actualSha256,
    segments,
    immutable: true,
    policy: "verbatim_only"
  };
}

function createReplacementVoiceoverPlan(lockedInput, options = {}) {
  const locked = typeof lockedInput === "string"
    ? createLockedScript(lockedInput)
    : assertLockedScriptIntegrity(lockedInput);
  const source = String(locked?.lockedScript ?? "");
  const segments = Array.isArray(locked?.segments) && locked.segments.length
    ? locked.segments.map((item) => String(item ?? ""))
    : segmentLockedScript(source);
  if (!source.trim() || segments.join("") !== source) throw new Error("新口播分段与锁定原文不一致");
  const requestedDensity = Number(options.speechDensity);
  const density = Number.isFinite(requestedDensity) ? Math.max(1.8, Math.min(5.2, requestedDensity)) : 3.5;
  const requestedSourceDuration = Number(options.sourceDuration);
  const sourceDuration = Number.isFinite(requestedSourceDuration) ? Math.max(0, requestedSourceDuration) : 0;
  let targetStart = 0;
  const clips = segments.map((voiceover, index) => {
    const speechChars = countTimingChars(voiceover);
    const duration = Math.max(4, Math.min(15, Math.ceil(speechChars / density + 0.8)));
    const clip = {
      index: index + 1,
      voiceover,
      speechChars,
      duration,
      targetStart: Number(targetStart.toFixed(3))
    };
    targetStart += duration;
    return clip;
  });
  return {
    lockedScript: source,
    sha256: locked.sha256 || sha256Text(source),
    speechDensity: density,
    sourceDuration,
    targetDuration: Number(targetStart.toFixed(3)),
    clips
  };
}

const CHINESE_DIGITS = new Map([
  ["零", "0"], ["〇", "0"], ["一", "1"], ["二", "2"], ["两", "2"], ["三", "3"],
  ["四", "4"], ["五", "5"], ["六", "6"], ["七", "7"], ["八", "8"], ["九", "9"]
]);

function canonicalSpeechText(value) {
  return Array.from(String(value ?? "").toLowerCase())
    .map((char) => CHINESE_DIGITS.get(char) || char)
    .join("")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function compileReplacementVoiceoverSpeechPlan(value) {
  const sourceScript = String(value ?? "");
  const cuePattern = /[（(【\[]\s*(画外音|旁白|场外音|off[\s-]?screen)\s*[:：]\s*([^）)\]】]*?)\s*[）)】\]]/giu;
  const speakerSegments = [];
  const cues = [];
  let cursor = 0;
  let match;
  while ((match = cuePattern.exec(sourceScript)) !== null) {
    const onscreenText = sourceScript.slice(cursor, match.index);
    if (canonicalSpeechText(onscreenText)) {
      speakerSegments.push({ role: "onscreen_speaker", text: onscreenText });
    }
    const cueText = String(match[1] || "画外音").trim();
    const spokenText = String(match[2] || "");
    cues.push({ role: "offscreen_speaker", cue: cueText, text: spokenText });
    if (canonicalSpeechText(spokenText)) {
      speakerSegments.push({ role: "offscreen_speaker", cue: cueText, text: spokenText });
    }
    cursor = match.index + match[0].length;
  }
  const tail = sourceScript.slice(cursor);
  if (canonicalSpeechText(tail)) {
    speakerSegments.push({ role: "onscreen_speaker", text: tail });
  }
  const audibleScript = speakerSegments.map((segment) => segment.text).join("");
  return {
    schemaVersion: "one-click-replacement-voiceover-speech-plan-v1",
    sourceScript,
    sourceSha256: sha256Text(sourceScript),
    audibleScript,
    audibleSha256: sha256Text(canonicalSpeechText(audibleScript)),
    cues,
    speakerSegments
  };
}

function validateLockedScriptAsr(lockedScript, transcript) {
  const speechPlan = compileReplacementVoiceoverSpeechPlan(lockedScript);
  const expected = canonicalSpeechText(speechPlan.audibleScript);
  const actual = canonicalSpeechText(transcript);
  let mismatchIndex = -1;
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== actual[index]) {
      mismatchIndex = index;
      break;
    }
  }
  return {
    passed: expected === actual,
    expected,
    actual,
    mismatchIndex,
    expectedSha256: sha256Text(expected),
    actualSha256: sha256Text(actual),
    speechPlan
  };
}

function defaultState() {
  return { schemaVersion: 4, updatedAt: isoNow(), assets: [], candidateJobs: [], replacementJobs: [], productOverrides: [], workspaceAssetTombstones: [] };
}

function createProductWorkflows(options = {}) {
  const appRoot = path.resolve(options.appRoot || process.cwd());
  const outputRoot = path.resolve(options.outputRoot || path.join(appRoot, "outputs", "产品工作流"));
  const statePath = path.resolve(options.statePath || path.join(appRoot, "cache", "product-workflows", "state.json"));
  const sharedStorage = options.sharedStorage || null;
  const gptImageClient = options.gptImageClient || null;
  const candidateRetryDelays = Array.isArray(options.candidateRetryDelays)
    ? options.candidateRetryDelays.map(Number).filter((delay) => Number.isFinite(delay) && delay >= 0)
    : [5000, 15000];
  const configuredImageTimeout = Number(options.imageGenerationTimeoutMs);
  const imageGenerationTimeoutMs = Number.isFinite(configuredImageTimeout) && configuredImageTimeout > 0
    ? configuredImageTimeout
    : DEFAULT_IMAGE_GENERATION_TIMEOUT_MS;
  const getProducts = typeof options.getProducts === "function" ? options.getProducts : () => [];
  const isProductVisible = typeof options.isProductVisible === "function" ? options.isProductVisible : () => true;
  const extractReferenceMedia = typeof options.extractReferenceMedia === "function" ? options.extractReferenceMedia : null;
  const analyzeReplacementVideo = typeof options.analyzeReplacementVideo === "function" ? options.analyzeReplacementVideo : null;
  const transcribeReferenceVideo = typeof options.transcribeReferenceVideo === "function" ? options.transcribeReferenceVideo : null;
  const adaptReplacementVoiceover = typeof options.adaptReplacementVoiceover === "function" ? options.adaptReplacementVoiceover : null;
  const workspaceHashCache = new Map();
  let state = defaultState();
  let saveQueue = Promise.resolve();

  function replacementProductForJob(job = {}) {
    const catalogProduct = (getProducts() || []).find((product) => String(product?.id || "") === String(job.productId || ""));
    return catalogProduct || {
      id: text(job.productId, 120),
      name: text(job.productName, 240),
      replacementContract: job.replacementContract || null
    };
  }

  async function init() {
    await fsp.mkdir(path.dirname(statePath), { recursive: true });
    await fsp.mkdir(outputRoot, { recursive: true });
    try {
      const parsed = JSON.parse(await fsp.readFile(statePath, "utf8"));
      state = { ...defaultState(), ...parsed };
      state.assets = Array.isArray(parsed.assets) ? parsed.assets : [];
      state.candidateJobs = Array.isArray(parsed.candidateJobs) ? parsed.candidateJobs : [];
      state.replacementJobs = Array.isArray(parsed.replacementJobs) ? parsed.replacementJobs : [];
      state.productOverrides = Array.isArray(parsed.productOverrides) ? parsed.productOverrides : [];
      state.workspaceAssetTombstones = Array.isArray(parsed.workspaceAssetTombstones) ? parsed.workspaceAssetTombstones : [];
      state.schemaVersion = 4;
    } catch {
      state = defaultState();
      await save();
    }
    const candidateMetadataChanged = ensureCandidateTaskMetadata();
    const replacementMetadataChanged = ensureReplacementTaskMetadata();
    const replacementIdentityChanged = ensureReplacementIdentityTrackingMetadata();
    const replacementExecutionClassificationChanged = ensureReplacementExecutionClassificationMetadata();
    const replacementGenerationPlanningChanged = ensureReplacementGenerationPlanningMetadata();
    const replacementVoiceoverAsrChanged = ensureReplacementVoiceoverAsrMetadata();
    const recovery = reconcileInterruptedReplacementJobs();
    if (candidateMetadataChanged || replacementMetadataChanged || replacementIdentityChanged || replacementExecutionClassificationChanged || replacementGenerationPlanningChanged || replacementVoiceoverAsrChanged || recovery.changed) await save();
    for (const item of recovery.items) {
      Promise.resolve().then(() => item.kind === "shot-anchor"
        ? resumeReplacementShotAnchor(item.jobId, item.candidateId)
        : resumeReplacementFirstFrame(item.jobId, item.candidateId)).catch(() => {});
    }
    return status();
  }

  function save() {
    state.updatedAt = isoNow();
    const snapshot = JSON.stringify(state, null, 2);
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      await fsp.mkdir(path.dirname(statePath), { recursive: true });
      const temporary = `${statePath}.${process.pid}.tmp`;
      await fsp.writeFile(temporary, snapshot, "utf8");
      await fsp.rename(temporary, statePath);
    });
    return saveQueue;
  }

  function baseProductCatalog() {
    const merged = new Map();
    for (const product of getProducts() || []) {
      if (!product?.id || !product?.name) continue;
      merged.set(String(product.id), {
        id: String(product.id),
        name: String(product.name),
        shortName: String(product.shortName || product.name),
        category: String(product.category || ""),
        assetStatus: "ready",
        status: "active",
        source: String(product.source || "built-in")
      });
    }
    for (const product of PENDING_PRODUCTS) {
      if (!merged.has(product.id)) merged.set(product.id, { ...product, category: "pending", status: "active", source: "pending" });
    }
    return merged;
  }

  function managedProducts() {
    const merged = baseProductCatalog();
    for (const override of state.productOverrides) {
      if (!override?.id) continue;
      if (override.status === "deleted") {
        merged.delete(override.id);
        continue;
      }
      const existing = merged.get(override.id) || {};
      merged.set(override.id, { ...existing, ...override });
    }
    const counts = new Map();
    for (const asset of allAssetRecords()) {
      if (!asset.productId) continue;
      const current = counts.get(asset.productId) || { imageCount: 0, videoCount: 0 };
      if (asset.assetType === "video") current.videoCount += 1;
      else current.imageCount += 1;
      counts.set(asset.productId, current);
    }
    return [...merged.values()].filter(isProductVisible).map((product) => {
      const assetCounts = counts.get(product.id) || { imageCount: 0, videoCount: 0 };
      const nameHistory = Array.isArray(product.nameHistory) ? product.nameHistory : [];
      return {
        ...product,
        status: product.status === "inactive" ? "inactive" : "active",
        assetStatus: assetCounts.imageCount > 0 ? "ready" : (product.assetStatus === "pending" ? "pending" : "ready"),
        previousName: text(nameHistory[nameHistory.length - 1]?.name, 240),
        ...assetCounts
      };
    });
  }

  function catalogProducts() {
    return managedProducts().filter((product) => product.status === "active");
  }

  function listManagedProducts() {
    return managedProducts().sort((left, right) => String(left.name).localeCompare(String(right.name), "zh-CN"));
  }

  function normalizeProductInput(input = {}, fallback = {}) {
    const name = text(input.name, 240) || text(fallback.name, 240);
    if (!name) throw new Error("请输入产品SKU名称");
    const supportedStates = new Set(["retail_outer_box", "primary_container", "single_unit", "content", "open_state", "usage_state", "product_combination"]);
    const defaultProductState = text(input.defaultProductState, 80) || text(fallback.defaultProductState, 80);
    if (defaultProductState && !supportedStates.has(defaultProductState)) throw new Error("请选择有效的产品默认形态");
    const rawDimensions = input.dimensionsCm && typeof input.dimensionsCm === "object"
      ? input.dimensionsCm
      : (fallback.dimensionsCm && typeof fallback.dimensionsCm === "object" ? fallback.dimensionsCm : {});
    const dimensionsCm = Object.fromEntries(["length", "width", "height", "diameter"]
      .map((key) => [key, Number(rawDimensions[key] || 0)])
      .filter(([, value]) => Number.isFinite(value) && value > 0));
    return {
      name,
      shortName: text(input.shortName, 120) || text(fallback.shortName, 120) || name,
      category: text(input.category, 120) || text(fallback.category, 120),
      defaultProductState,
      dimensionsCm,
      assetStatus: (input.assetStatus ?? fallback.assetStatus) === "pending" ? "pending" : "ready",
      status: (input.status ?? fallback.status) === "inactive" ? "inactive" : "active"
    };
  }

  async function createProduct(input = {}) {
    const id = text(input.id, 120) || `custom-sku-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
    if (!/^[a-z0-9][a-z0-9_-]{2,119}$/i.test(id)) throw new Error("SKU编码仅支持字母、数字、短横线和下划线");
    if (baseProductCatalog().has(id) || state.productOverrides.some((item) => item.id === id)) throw new Error("该SKU编码已存在");
    const record = { id, ...normalizeProductInput(input), nameHistory: [], source: "custom", metadataSyncStatus: "local_pending", createdAt: isoNow(), updatedAt: isoNow() };
    state.productOverrides.push(record);
    await save();
    return listManagedProducts().find((item) => item.id === id);
  }

  async function updateProduct(productId, input = {}) {
    const id = String(productId || "");
    const current = managedProducts().find((item) => item.id === id);
    if (!current) throw new Error("产品SKU不存在");
    const existing = state.productOverrides.find((item) => item.id === id);
    const normalized = normalizeProductInput(input, current);
    const nameHistory = Array.isArray(existing?.nameHistory) ? [...existing.nameHistory] : [];
    if (current.name && normalized.name !== current.name) {
      nameHistory.push({ name: current.name, changedAt: isoNow() });
      if (nameHistory.length > 10) nameHistory.splice(0, nameHistory.length - 10);
    }
    const record = {
      ...(existing || {}),
      id,
      ...normalized,
      nameHistory,
      source: existing?.source || current.source || "custom",
      metadataSyncStatus: current.source === "custom" ? "local_pending" : (existing?.metadataSyncStatus || "local_only"),
      createdAt: existing?.createdAt || isoNow(),
      updatedAt: isoNow()
    };
    if (existing) Object.assign(existing, record);
    else state.productOverrides.push(record);
    for (const asset of state.assets) {
      if (asset.productId !== id) continue;
      asset.productName = record.name;
      asset.category = record.category;
      asset.updatedAt = isoNow();
    }
    await save();
    return listManagedProducts().find((item) => item.id === id);
  }

  async function deleteProduct(productId) {
    const id = String(productId || "");
    const current = managedProducts().find((item) => item.id === id);
    if (!current) throw new Error("产品SKU不存在或已经删除");
    if (state.assets.some((asset) => asset.productId === id)) throw new Error("请先删除该SKU关联的图片和碎镜头资产");
    const existing = state.productOverrides.find((item) => item.id === id);
    const tombstone = { id, status: "deleted", source: existing?.source || current.source, deletedAt: isoNow(), updatedAt: isoNow() };
    if (existing) Object.assign(existing, tombstone);
    else state.productOverrides.push(tombstone);
    await save();
    return { id, deleted: true };
  }

  async function syncSharedProducts(items = [], options = {}) {
    let changed = false;
    const incomingIds = new Set();
    for (const input of Array.isArray(items) ? items : []) {
      const id = text(input.id, 120);
      if (!id || input.source !== "custom") continue;
      incomingIds.add(id);
      const existing = state.productOverrides.find((item) => item.id === id);
      const record = {
        ...(existing || {}),
        id,
        ...normalizeProductInput(input, existing || {}),
        nameHistory: Array.isArray(input.nameHistory) ? input.nameHistory.slice(-10) : (existing?.nameHistory || []),
        source: "custom",
        metadataSyncStatus: "shared",
        owner: text(input.owner, 160) || existing?.owner || "",
        createdAt: text(input.createdAt, 80) || existing?.createdAt || isoNow(),
        updatedAt: text(input.updatedAt, 80) || isoNow()
      };
      if (existing) Object.assign(existing, record);
      else state.productOverrides.push(record);
      changed = true;
    }
    if (options.pruneMissing === true) {
      const before = state.productOverrides.length;
      state.productOverrides = state.productOverrides.filter((item) => (
        item.source !== "custom" || item.metadataSyncStatus !== "shared" || incomingIds.has(item.id)
      ));
      changed = changed || before !== state.productOverrides.length;
    }
    if (changed) await save();
    return listManagedProducts();
  }

  function status() {
    const assets = allAssetRecords();
    return {
      ok: true,
      schemaVersion: state.schemaVersion,
      assets: assets.length,
      workspaceAssets: assets.filter((asset) => asset.source === "workspace_product_catalog").length,
      candidateJobs: state.candidateJobs.length,
      replacementJobs: state.replacementJobs.length,
      sharedStorageEnabled: Boolean(sharedStorage?.enabled),
      outputRoot
    };
  }

  function ossThumbnailUrl(sourceUrl, assetType) {
    const value = String(sourceUrl || "").trim();
    if (!/^https?:\/\//i.test(value) || assetType === "video") return "";
    try {
      const target = new URL(value);
      target.searchParams.set(
        "x-oss-process",
        "image/resize,m_pad,w_360,h_360,color_FFFFFF/format,jpg/quality,q_78"
      );
      return target.toString();
    } catch {
      return "";
    }
  }

  function publicAsset(asset) {
    const previewUrl = asset.storageUrl || (asset.localPath
      ? `${asset.assetType === "video" ? "./api/file" : "./api/image"}?path=${encodeURIComponent(asset.localPath)}`
      : "");
    return {
      ...asset,
      previewUrl,
      originalUrl: previewUrl,
      thumbnailUrl: ossThumbnailUrl(asset.storageUrl, asset.assetType)
        || `./api/product-workflows/assets/${encodeURIComponent(asset.id)}/thumbnail`
    };
  }

  function localPathKey(filePath) {
    if (!filePath) return "";
    const resolved = path.resolve(String(filePath));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  function workspaceImageRank(product, fileName) {
    const priority = Array.isArray(product?.imagePriority) ? product.imagePriority.map(String) : [];
    const rank = priority.findIndex((part) => part && String(fileName).includes(part));
    return rank < 0 ? 1000 : rank;
  }

  function workspaceImageSha256(localPath, stat) {
    const pathKey = localPathKey(localPath);
    const signature = `${Number(stat?.size || 0)}:${Number(stat?.mtimeMs || 0)}`;
    const cached = workspaceHashCache.get(pathKey);
    if (cached?.signature === signature) return cached.sha256;
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(localPath)).digest("hex");
    workspaceHashCache.set(pathKey, { signature, sha256 });
    return sha256;
  }

  function exactAssetIdentity(asset = {}) {
    const productId = text(asset.productId, 120);
    const assetType = asset.assetType === "video" ? "video" : "image";
    const sha256 = text(asset.sha256, 80).toLowerCase();
    return productId && /^[a-f0-9]{64}$/.test(sha256)
      ? `${productId}\0${assetType}\0${sha256}`
      : "";
  }

  function assetCanonicalScore(asset = {}) {
    let score = 0;
    if (asset.readOnly !== true) score += 100;
    if (asset.storageUrl && asset.storageStatus === "stored") score += 50;
    if (asset.metadataSyncStatus === "shared") score += 20;
    if (asset.source === "built-in" && (asset.workspaceSourceId || asset.workspaceSourceIds?.length)) score += 10;
    if (asset.localPath) score += 1;
    return score;
  }

  function preferCanonicalAsset(left, right) {
    const scoreDifference = assetCanonicalScore(right) - assetCanonicalScore(left);
    if (scoreDifference) return scoreDifference;
    return String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
  }

  function workspaceProductAssets() {
    const assets = [];
    const seenPaths = new Set();
    const tombstones = new Set((state.workspaceAssetTombstones || []).map(String));
    for (const product of getProducts() || []) {
      if (!product?.id || !product?.name || !product.imageDir) continue;
      const imageDir = path.resolve(String(product.imageDir));
      let entries = [];
      try {
        entries = fs.readdirSync(imageDir, { withFileTypes: true });
      } catch {
        continue;
      }
      const files = entries
        .filter((entry) => entry.isFile() && IMAGE_PATTERN.test(entry.name))
        .map((entry) => path.join(imageDir, entry.name))
        .sort((left, right) => (
          workspaceImageRank(product, path.basename(left)) - workspaceImageRank(product, path.basename(right))
          || path.basename(left).localeCompare(path.basename(right), "zh-CN")
        ));
      for (let index = 0; index < files.length; index += 1) {
        const localPath = files[index];
        const pathKey = localPathKey(localPath);
        if (!pathKey || seenPaths.has(pathKey)) continue;
        let stat;
        try {
          stat = fs.statSync(localPath);
        } catch {
          continue;
        }
        if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) continue;
        seenPaths.add(pathKey);
        const fileName = path.basename(localPath);
        const stableKey = crypto.createHash("sha1").update(`${product.id}\0${fileName}`).digest("hex").slice(0, 24);
        const workspaceAssetId = `workspace-image-${stableKey}`;
        if (tombstones.has(workspaceAssetId)) continue;
        const timestamp = (stat.birthtimeMs || stat.mtimeMs) ? new Date(stat.birthtimeMs || stat.mtimeMs).toISOString() : "";
        assets.push({
          id: workspaceAssetId,
          assetType: "image",
          title: path.basename(fileName, path.extname(fileName)),
          productId: String(product.id),
          productName: String(product.name),
          category: String(product.category || ""),
          assetRole: "white_background",
          angle: "",
          angleLabel: "",
          style: "",
          source: "workspace_product_catalog",
          scope: "workbench",
          readOnly: true,
          approvalStatus: "approved",
          localPath,
          size: stat.size,
          sha256: workspaceImageSha256(localPath, stat),
          owner: "AI产品镜",
          fileName,
          duration: 0,
          workspaceOrder: index,
          createdAt: timestamp,
          updatedAt: timestamp,
          metadataSyncStatus: "workspace_shared",
          storageUrl: "",
          storageKey: "",
          storageBackend: "workspace",
          storageStatus: "workspace_shared"
        });
      }
    }
    return assets;
  }

  function rawAssetRecords() {
    const registeredPaths = new Set(state.assets.map((asset) => localPathKey(asset.localPath)).filter(Boolean));
    const workspaceAssets = workspaceProductAssets().filter((asset) => !registeredPaths.has(localPathKey(asset.localPath)));
    return [...workspaceAssets, ...state.assets];
  }

  function allAssetRecords() {
    const groups = new Map();
    const standalone = [];
    for (const asset of rawAssetRecords()) {
      const identity = exactAssetIdentity(asset);
      if (!identity) {
        standalone.push(asset);
        continue;
      }
      const group = groups.get(identity) || [];
      group.push(asset);
      groups.set(identity, group);
    }
    const canonical = [...groups.values()].map((group) => {
      const ordered = [...group].sort(preferCanonicalAsset);
      const selected = ordered[0];
      const duplicateIds = [...new Set(ordered.slice(1).map((asset) => asset.id).filter((id) => id && id !== selected.id))];
      return {
        ...selected,
        exactDuplicateCount: Math.max(0, ordered.length - 1),
        exactDuplicateIds: duplicateIds,
        duplicatesConsolidated: ordered.length > 1
      };
    });
    return [...standalone, ...canonical];
  }

  function findExactDuplicateAsset(input = {}) {
    const identity = exactAssetIdentity(input);
    if (!identity) return null;
    return rawAssetRecords()
      .filter((asset) => exactAssetIdentity(asset) === identity)
      .sort(preferCanonicalAsset)[0] || null;
  }

  function getAssetGroup(assetId) {
    const asset = findAssetRecord(assetId);
    if (!asset) return [];
    const identity = exactAssetIdentity(asset);
    const group = identity
      ? rawAssetRecords().filter((item) => exactAssetIdentity(item) === identity)
      : [asset];
    const unique = new Map();
    for (const item of group) {
      const current = unique.get(item.id);
      if (!current || preferCanonicalAsset(current, item) > 0) unique.set(item.id, item);
    }
    return [...unique.values()].map(publicAsset);
  }

  function findAssetRecord(assetId) {
    const id = String(assetId || "");
    return state.assets.find((item) => item.id === id)
      || workspaceProductAssets().find((item) => item.id === id)
      || null;
  }

  function normalizeReplacementAssetIds(value) {
    return [...new Set((Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean))];
  }

  function replacementSourceEvidenceText(job) {
    const analysis = job?.sourceAnalysis || {};
    return [
      analysis.summary,
      analysis.deepDive?.handActions,
      analysis.deepDive?.productExposureLogic,
      ...(analysis.sourceShots || []).flatMap((shot) => [shot.title, shot.action, shot.actionGeometry, shot.productExposure])
    ].filter(Boolean).join(" ");
  }

  function isBlackCrystalMembraneReplacement(job) {
    if (String(job?.productId || "") !== "wis-black-crystal-mask") return false;
    return /膜布|面膜纸|片状面膜|贴片面膜|(?:揭|撕|敷|贴|手持|捏持|取下|展开).{0,8}面膜|面膜.{0,8}(?:揭|撕|敷|贴|手持|捏持|取下|展开)|sheet\s*mask|mask\s*sheet|peel(?:ing)?\s*(?:off\s*)?mask/i.test(replacementSourceEvidenceText(job));
  }

  function isBlackCrystalMembraneAsset(asset) {
    const descriptor = [asset?.title, asset?.fileName, asset?.localPath, asset?.angleLabel].filter(Boolean).join(" ");
    return /膜布|sheet\s*mask|mask\s*(?:sheet|fabric|material)/i.test(descriptor);
  }

  function replacementProductTruthPrompt(job, source = {}, targetAssets = []) {
    return formatProductReplacementContract(replacementProductForJob(job), source, { phase: "anchor", targetAssets });
  }

  function pendingSourceTranscript() {
    return {
      schemaVersion: "one-click-replacement-source-transcript-v1",
      status: "pending",
      provider: "SiliconFlow",
      model: "XingChenAGI/XingChenASR-Diarize-V3.0",
      text: "",
      charCount: 0,
      duration: 0,
      segments: [],
      speakers: [],
      speakerCount: 0,
      source: "asr",
      error: "",
      updatedAt: isoNow()
    };
  }

  function transcriptFromResult(result = {}, source = "asr") {
    const transcriptText = String(result.text || "").replace(/\r\n?/g, "\n").trim();
    return {
      ...pendingSourceTranscript(),
      ...result,
      status: result.status === "no_audio" ? "no_audio" : "success",
      text: transcriptText,
      charCount: countTimingChars(transcriptText),
      segments: Array.isArray(result.segments) ? result.segments : [],
      speakers: Array.isArray(result.speakers) ? result.speakers : [],
      speakerCount: Math.max(0, Number(result.speakerCount || result.speakers?.length || 0)),
      source,
      error: "",
      updatedAt: isoNow()
    };
  }

  async function prepareReplacementTranscript(job) {
    if (!job.referenceAssets?.hasAudio) {
      job.sourceTranscript = transcriptFromResult({ status: "no_audio", text: "", duration: Number(job.referenceAssets?.duration || 0) });
      return job.sourceTranscript;
    }
    if (!transcribeReferenceVideo) {
      job.sourceTranscript = {
        ...pendingSourceTranscript(),
        status: "failed",
        error: "XingChenASR 转写组件尚未接入",
        updatedAt: isoNow()
      };
      await save();
      return job.sourceTranscript;
    }
    job.sourceTranscript = { ...pendingSourceTranscript(), status: "transcribing", updatedAt: isoNow() };
    await save();
    try {
      const result = await transcribeReferenceVideo({
        jobId: job.id,
        referenceVideoPath: job.referenceVideoPath,
        referenceVideoName: job.referenceVideoName,
        duration: Number(job.referenceAssets?.duration || 0)
      });
      job.sourceTranscript = transcriptFromResult(result);
    } catch (error) {
      job.sourceTranscript = {
        ...pendingSourceTranscript(),
        status: "failed",
        error: text(error?.message || error, 1000),
        updatedAt: isoNow()
      };
    }
    await save();
    return job.sourceTranscript;
  }

  async function prepareReplacementVoiceoverDraft(job) {
    if (!['voiceover', 'both'].includes(String(job.replacementMode || ""))) {
      job.voiceoverDraft = null;
      return null;
    }
    const sourceText = String(job.sourceTranscript?.text || "");
    let adaptation = { proposedText: sourceText, replacements: [], warnings: [], unresolvedMentions: [], model: "", mode: "copy_only" };
    if (job.replacementMode === "both" && sourceText && adaptReplacementVoiceover) {
      try {
        adaptation = await adaptReplacementVoiceover({
          sourceText,
          productId: job.productId,
          productName: job.productName,
          productContract: job.replacementContract
        });
      } catch (error) {
        adaptation.warnings = [`Qwen 预修改暂未完成：${text(error?.message || error, 500)}`];
      }
    }
    const draftText = String(adaptation.proposedText || sourceText).replace(/\r\n?/g, "\n");
    job.voiceoverDraft = {
      schemaVersion: "one-click-replacement-voiceover-draft-v1",
      status: "ready",
      sourceText,
      proposedText: draftText,
      text: draftText,
      charCount: countTimingChars(draftText),
      replacements: Array.isArray(adaptation.replacements) ? adaptation.replacements : [],
      warnings: Array.isArray(adaptation.warnings) ? adaptation.warnings : [],
      unresolvedMentions: Array.isArray(adaptation.unresolvedMentions) ? adaptation.unresolvedMentions : [],
      model: text(adaptation.model, 120),
      mode: text(adaptation.mode, 120) || "copy_only",
      version: Math.max(1, Number(job.voiceoverDraft?.version || 0) + 1),
      confirmed: false,
      confirmedAt: "",
      updatedAt: isoNow()
    };
    job.lockedScript = null;
    return job.voiceoverDraft;
  }

  function createShotPlanForReplacementJob(job) {
    return buildReplacementShotPlan(job.sourceAnalysis, {
      duration: Number(job.referenceAssets?.duration || 0),
      keyframes: job.sourceAnalysis?.keyframes,
      generationMode: job.generationMode,
      modelId: job.videoModelId,
      modelLabel: job.videoModelLabel,
      minimumDuration: job.videoModelMinimumDuration,
      maximumDuration: job.videoModelMaximumDuration,
      maxReferenceImages: job.videoModelMaxReferenceImages,
      productReferenceCount: job.productAssetIds.length + job.temporaryProductAssets.length,
      requireReplacementAnchors: job.replacementMode !== "voiceover"
    });
  }

  function applyReplacementVoiceoverTimingToShotPlan(job) {
    if (job.voiceoverMode !== "new" || !job.shotPlan || !job.voiceoverTiming) return;
    const minimumDuration = Math.max(1, Number(job.videoModelMinimumDuration || 4));
    const maximumDuration = Math.max(minimumDuration, Number(job.videoModelMaximumDuration || 15));
    const targetTotalDuration = Math.max(1, Math.round(Number(job.voiceoverTiming.targetDuration || 0)));
    let units = Array.isArray(job.shotPlan.generationUnits) ? job.shotPlan.generationUnits.map((unit) => ({ ...unit })) : [];
    if (!units.length) throw new Error("ShotPlan没有可用于新口播时长编排的视频单元");
    const requiredCount = Math.max(units.length, Math.ceil(targetTotalDuration / maximumDuration));
    if (requiredCount > units.length) {
      const sourceDuration = Math.max(0.1, Number(job.referenceAssets?.duration || job.sourceAnalysis?.duration || 0));
      const sourceShots = Array.isArray(job.sourceAnalysis?.sourceShots) ? job.sourceAnalysis.sourceShots : [];
      const frames = Array.isArray(job.sourceAnalysis?.keyframes) ? job.sourceAnalysis.keyframes : [];
      const baseBudget = units[0]?.referenceAssetBudget || {};
      units = Array.from({ length: requiredCount }, (_item, index) => {
        const sourceStart = sourceDuration * index / requiredCount;
        const sourceEnd = sourceDuration * (index + 1) / requiredCount;
        const sourceShotIds = sourceShots
          .filter((shot) => Number(shot.end || 0) > sourceStart && Number(shot.start || 0) < sourceEnd)
          .map((shot) => shot.id);
        const requiredCandidateFrameIds = frames
          .filter((frame) => Number(frame.time || 0) + 0.001 >= sourceStart && Number(frame.time || 0) <= sourceEnd + 0.001)
          .map((frame) => frame.id);
        return {
          id: `voiceover-duration-unit-${String(index + 1).padStart(2, "0")}`,
          order: index + 1,
          sourceRange: [Number(sourceStart.toFixed(3)), Number(sourceEnd.toFixed(3))],
          sourceStart: Number(sourceStart.toFixed(3)),
          sourceEnd: Number(sourceEnd.toFixed(3)),
          sourceDuration: Number((sourceEnd - sourceStart).toFixed(3)),
          targetDuration: minimumDuration,
          sourceShotIds: sourceShotIds.length ? sourceShotIds : sourceShots.map((shot) => shot.id),
          requiredCandidateFrameIds,
          requiredAnchorIds: [],
          referenceAssetBudget: { ...baseBudget },
          referencePolicy: "full_video_with_replacement_anchors",
          splitReason: "VOICEOVER_DURATION_RATIO"
        };
      });
    }
    if (targetTotalDuration < units.length * minimumDuration) {
      throw new Error(`按新旧口播比例计算的目标时长为${targetTotalDuration}秒，但${units.length}个视频单元至少需要${units.length * minimumDuration}秒；请适当增加新口播内容`);
    }
    const weights = units.map((unit) => Math.max(0.1, Number(unit.sourceDuration || 0.1)));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const ideals = weights.map((weight) => targetTotalDuration * weight / weightTotal);
    const durations = units.map(() => minimumDuration);
    let remaining = targetTotalDuration - durations.reduce((sum, value) => sum + value, 0);
    while (remaining > 0) {
      let selected = -1;
      let need = -Infinity;
      durations.forEach((duration, index) => {
        if (duration >= maximumDuration) return;
        const currentNeed = ideals[index] - duration;
        if (currentNeed > need) {
          selected = index;
          need = currentNeed;
        }
      });
      if (selected < 0) throw new Error("无法在当前视频模型的单段时长上限内严格分配新口播时长");
      durations[selected] += 1;
      remaining -= 1;
    }
    job.shotPlan.generationUnits = units.map((unit, index) => ({ ...unit, targetDuration: durations[index] }));
    job.shotPlan.voiceoverTiming = { ...job.voiceoverTiming, clipDurations: durations };
    job.voiceoverTiming.clipDurations = durations;
  }

  function replacementSourceHasNoProduct(source = {}) {
    const nested = [
      ...(Array.isArray(source?.sourceShots) ? source.sourceShots : []),
      ...(Array.isArray(source?.units) ? source.units : []),
      ...(Array.isArray(source?.sourceUnits) ? source.sourceUnits : [])
    ];
    const roles = [source?.sourceProductRole, ...nested.map((item) => item?.sourceProductRole)]
      .map((role) => String(role || "").trim())
      .filter(Boolean);
    return roles.length > 0 && roles.every((role) => ["transport_container", "none"].includes(role));
  }

  function replacementProductSizeText(job, source = {}, targetAssets = []) {
    if (replacementSourceHasNoProduct(source)) return "本镜头无可替换产品，不应用目标产品尺寸或人体比例";
    const product = replacementProductForJob(job);
    const layers = activeReplacementLayers(product, source, targetAssets);
    const sizes = layers.map((layer) => {
      const dimensions = layer?.dimensionsCm || {};
      if (Number.isFinite(dimensions.diameter)) return `${layer.label || "产品"}直径${dimensions.diameter}cm、高${dimensions.height}cm`;
      if (Number.isFinite(dimensions.width)) {
        return `${layer.label || "产品"}宽${dimensions.width}cm、高${dimensions.height}cm${Number.isFinite(dimensions.depth) ? `、深${dimensions.depth}cm` : ""}`;
      }
      return layer?.physicalSize ? `${layer.label || "产品"}${layer.physicalSize}` : "";
    }).filter(Boolean);
    const scaleReference = formatProductScaleReference(product);
    return [...sizes, scaleReference].filter(Boolean).join("；") || "服从图2、图3等目标产品参考图的真实尺寸与比例";
  }

  function compileReplacementFirstFramePrompt(basePrompt, job, source = {}, targetAssets = []) {
    const taskVariables = job?.taskVariables || {};
    const originalProductName = text(taskVariables.originalProductName, 240) || "参考视频中的原产品";
    const newProductName = text(taskVariables.newProductName, 240) || text(job?.productName, 240) || text(job?.productId, 120) || "目标产品";
    const requestedQuantityRule = text(taskVariables.productQuantityRule, 500);
    const productQuantityRule = replacementSourceHasNoProduct(source)
      ? "本镜头无可替换产品，不新增目标产品，数量保持为零"
      : formatProductQuantityStrategy(replacementProductForJob(job)) || AUTO_REPLACEMENT_QUANTITY_RULE;
    const quantityRule = !requestedQuantityRule || /默认|一致/.test(requestedQuantityRule)
      ? productQuantityRule
      : requestedQuantityRule;
    return String(basePrompt || REPLACEMENT_FIRST_FRAME_EDIT_PROMPT)
      .replaceAll("[旧产品]", originalProductName)
      .replaceAll("[新产品名称]", newProductName)
      .replaceAll("[尺寸]", replacementProductSizeText(job, source, targetAssets))
      .replaceAll("[保持原数量 / 保持原区域体积自动调整数量 / 指定数量]", quantityRule);
  }

  function selectedReplacementInitialStateCandidate(job = {}) {
    return (job.firstFrameCandidates || []).find((candidate) => (
      candidate.id === job.selectedFirstFrameId
      && candidate.status === "success"
      && candidate.localPath
    )) || null;
  }

  function replacementInitialStateDependency(candidate) {
    if (!candidate || candidate.source === "reference_frame") return null;
    return {
      candidateId: candidate.id,
      sha256: text(candidate.sha256, 128),
      role: "initial_state_continuity_reference",
      inputIndex: 2,
      targetTime: 0
    };
  }

  function invalidateReplacementAnchorsForInitialState(job, nextCandidate) {
    if ((job.shotAnchorCandidates || []).some((candidate) => candidate.status === "generating")) {
      throw new Error("ShotPlan关键帧正在生成，请完成后再切换首帧");
    }
    const dependency = replacementInitialStateDependency(nextCandidate);
    const invalidatedIds = new Set();
    job.shotAnchorCandidates = (job.shotAnchorCandidates || []).filter((candidate) => {
      const existing = candidate.initialStateDependency || null;
      const keep = dependency
        ? Boolean(existing && existing.candidateId === dependency.candidateId && (!dependency.sha256 || existing.sha256 === dependency.sha256))
        : !existing;
      if (!keep) invalidatedIds.add(candidate.id);
      return keep;
    });
    for (const unit of job.shotPlan?.units || []) {
      unit.selectedAnchorCandidateIds = (unit.selectedAnchorCandidateIds || []).filter((id) => !invalidatedIds.has(id));
    }
    job.initialStateRevision = Number(job.initialStateRevision || 0) + 1;
    job.initialStateAnchorInvalidation = {
      candidateId: nextCandidate?.id || "",
      sha256: text(nextCandidate?.sha256, 128),
      invalidatedAnchorCount: invalidatedIds.size,
      changedAt: isoNow()
    };
    return invalidatedIds.size;
  }

  function resolveReplacementFirstFrameAssets(job, source = null, options = {}) {
    const hasDedicatedAvailableAssets = Array.isArray(job.firstFrameAvailableAssetIds);
    const availableAssetIds = normalizeReplacementAssetIds(hasDedicatedAvailableAssets
      ? job.firstFrameAvailableAssetIds
      : job.productAssetIds);
    const hasDedicatedSelection = Array.isArray(job.firstFrameAssetIds);
    const assetIds = normalizeReplacementAssetIds(hasDedicatedSelection ? job.firstFrameAssetIds : availableAssetIds);
    if (availableAssetIds.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
      throw new Error(`首帧图素材最多同步${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
    }
    if (assetIds.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
      throw new Error(`首帧图素材最多选择${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
    }
    if (hasDedicatedAvailableAssets) {
      const videoUpstreamAssetIds = new Set(normalizeReplacementAssetIds(job.productAssetIds));
      const invalidAvailableAssetId = availableAssetIds.find((assetId) => !videoUpstreamAssetIds.has(assetId));
      if (invalidAvailableAssetId) throw new Error(`首帧图素材必须来自本次任务的视频上游产品参考图：${invalidAvailableAssetId}`);
      const availableAssetIdSet = new Set(availableAssetIds);
      const invalidSelectedAssetId = assetIds.find((assetId) => !availableAssetIdSet.has(assetId));
      if (invalidSelectedAssetId) throw new Error(`选用的首帧图素材不在当前可用素材中：${invalidSelectedAssetId}`);
    }
    let productAssets = assetIds.map((assetId) => {
      const asset = findAssetRecord(assetId);
      if (!asset || asset.assetType !== "image") throw new Error(`首帧图素材不存在或不是图片：${assetId}`);
      if (job.productId && asset.productId && asset.productId !== job.productId) {
        throw new Error(`首帧图素材不属于当前目标产品：${asset.title || assetId}`);
      }
      return asset;
    });
    if (!hasDedicatedSelection) {
      productAssets.push(...(job.temporaryProductAssets || []).map((asset) => ({ ...asset, assetType: "image" })));
    }
    const product = replacementProductForJob(job);
    const filtered = filterReplacementAssets(product, source || job.sourceAnalysis || {}, productAssets);
    productAssets = filtered.assets;
    if (filtered.requiredMissing && options.allowEmpty !== true) {
      throw new Error(`${filtered.layers.map((layer) => layer.label).join("、")}任务缺少对应内容物参考图，不能使用包装图代替`);
    }
    if (!productAssets.length && !filtered.noReplaceableProduct && options.allowEmpty !== true) throw new Error("首帧图素材不存在，请重新选择并核对");
    return productAssets.slice(0, MAX_REPLACEMENT_PRODUCT_IMAGES);
  }

  function resolveReplacementShotAnchorAssets(job, source = null) {
    if (!Array.isArray(job.firstFrameAssetIds) || job.firstFrameAssetIds.length > 0) {
      return resolveReplacementFirstFrameAssets(job, source);
    }
    return resolveReplacementFirstFrameAssets({
      ...job,
      firstFrameAssetIds: normalizeReplacementAssetIds(job.productAssetIds),
      firstFrameAvailableAssetIds: normalizeReplacementAssetIds(job.productAssetIds)
    }, source);
  }

  function listAssets(filters = {}) {
    const assetType = text(filters.assetType, 20);
    const productId = text(filters.productId, 120);
    const role = text(filters.assetRole, 80);
    const keyword = text(filters.keyword, 200).toLowerCase();
    return allAssetRecords()
      .filter((item) => !assetType || item.assetType === assetType)
      .filter((item) => !productId || item.productId === productId)
      .filter((item) => !role || item.assetRole === role)
      .filter((item) => !keyword || [item.title, item.productName, item.category, item.angleLabel, item.style]
        .join(" ").toLowerCase().includes(keyword))
      .sort((left, right) => {
        const leftWorkspace = left.source === "workspace_product_catalog";
        const rightWorkspace = right.source === "workspace_product_catalog";
        if (leftWorkspace !== rightWorkspace) return leftWorkspace ? -1 : 1;
        if (leftWorkspace && rightWorkspace) return Number(left.workspaceOrder || 0) - Number(right.workspaceOrder || 0);
        return String(right.createdAt).localeCompare(String(left.createdAt));
      })
      .map(publicAsset);
  }

  function getAsset(assetId) {
    const asset = findAssetRecord(assetId);
    return asset ? publicAsset(asset) : null;
  }

  function isManagedLocalPath(filePath) {
    if (!filePath) return false;
    const resolved = path.resolve(filePath);
    return [appRoot, outputRoot].some((root) => {
      const relative = path.relative(root, resolved);
      return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
  }

  async function deleteAsset(assetId) {
    const id = String(assetId || "");
    const selected = state.assets.find((item) => item.id === id);
    if (!selected) {
      const workspaceAsset = findAssetRecord(id);
      if (workspaceAsset?.readOnly) throw new Error("AI产品镜共用资产不能在资产库中删除，请维护对应SKU的产品图目录");
      throw new Error("要删除的资产不存在");
    }
    const identity = exactAssetIdentity(selected);
    const records = identity
      ? state.assets.filter((item) => exactAssetIdentity(item) === identity)
      : [selected];
    const recordSet = new Set(records);
    const workspaceMatches = identity
      ? workspaceProductAssets().filter((item) => exactAssetIdentity(item) === identity)
      : [];
    const tombstones = new Set(state.workspaceAssetTombstones || []);
    for (const item of [...records, ...workspaceMatches]) {
      for (const sourceId of [item.id, item.workspaceSourceId, ...(Array.isArray(item.workspaceSourceIds) ? item.workspaceSourceIds : [])].filter(Boolean)) {
        if (item.source === "workspace_product_catalog" || item.workspaceSourceId || item.workspaceSourceIds?.length) tombstones.add(String(sourceId));
      }
    }
    state.workspaceAssetTombstones = [...tombstones];
    const storageKeys = [...new Set(records.map((item) => item.storageKey).filter(Boolean))];
    const deletedStorageKeys = [];
    for (const storageKey of storageKeys) {
      const usedOutsideGroup = state.assets.some((item) => !recordSet.has(item) && item.storageKey === storageKey);
      if (usedOutsideGroup) continue;
      if (!sharedStorage?.enabled || typeof sharedStorage.deleteObject !== "function") {
        throw new Error("共享存储暂不支持删除，请稍后重试");
      }
      const result = await sharedStorage.deleteObject(storageKey);
      if (result?.deleted !== false) deletedStorageKeys.push(storageKey);
    }
    state.assets = state.assets.filter((item) => !recordSet.has(item));
    await save();
    const deletedLocalPaths = [];
    const localFileErrors = [];
    for (const item of records) {
      if (!item.localPath || item.workspaceSourceId || item.workspaceSourceIds?.length || !isManagedLocalPath(item.localPath)) continue;
      const usedOutsideGroup = state.assets.some((candidate) => candidate.localPath === item.localPath);
      if (usedOutsideGroup || deletedLocalPaths.includes(item.localPath)) continue;
      try {
        await fsp.unlink(item.localPath);
        deletedLocalPaths.push(item.localPath);
      } catch (error) {
        if (error?.code !== "ENOENT") localFileErrors.push(String(error.message || error));
      }
    }
    return {
      asset: publicAsset(selected),
      deletedAssets: records.map(publicAsset),
      duplicateRecordsDeleted: Math.max(0, records.length + workspaceMatches.length - 1),
      sharedObjectDeleted: deletedStorageKeys.length > 0,
      deletedStorageKeys,
      localFileDeleted: deletedLocalPaths.length > 0,
      deletedLocalPaths,
      localFileError: localFileErrors.join("；")
    };
  }

  async function updateAsset(assetId, input = {}) {
    const id = String(assetId || "");
    const asset = state.assets.find((item) => item.id === id);
    if (!asset) {
      const workspaceAsset = findAssetRecord(id);
      if (workspaceAsset?.readOnly) throw new Error("该内置资产尚未迁移到OSS，请刷新资产库后重试");
      throw new Error("要修改的资产不存在");
    }
    const productId = text(input.productId, 120) || asset.productId;
    const product = managedProducts().find((item) => item.id === productId);
    if (!product) throw new Error("目标产品SKU不存在");
    asset.title = text(input.title, 240) || asset.title;
    asset.productId = product.id;
    asset.productName = product.name;
    asset.category = text(input.category, 120) || product.category || asset.category;
    asset.assetRole = text(input.assetRole, 80) || asset.assetRole || (asset.assetType === "video" ? "product_broll" : "white_background");
    asset.productState = text(input.productState, 80) || asset.productState || "";
    asset.view = text(input.view, 80) || asset.view || "unknown";
    asset.style = text(input.style, 120);
    asset.updatedAt = isoNow();
    await save();
    return publicAsset(asset);
  }

  async function migrateWorkspaceAssets(options = {}) {
    if (!sharedStorage?.enabled || typeof sharedStorage.uploadFile !== "function") {
      return { ok: false, migrated: [], failed: [], message: "OSS共享存储未连接" };
    }
    const migratedIds = new Set(state.assets.flatMap((asset) => [asset.id, asset.workspaceSourceId, ...(Array.isArray(asset.workspaceSourceIds) ? asset.workspaceSourceIds : [])]).filter(Boolean).map(String));
    const migratedIdentities = new Set(state.assets.map(exactAssetIdentity).filter(Boolean));
    const pendingGroups = new Map();
    for (const asset of workspaceProductAssets()) {
      if (migratedIds.has(asset.id)) continue;
      const identity = exactAssetIdentity(asset) || `id:${asset.id}`;
      if (migratedIdentities.has(identity)) continue;
      const group = pendingGroups.get(identity) || [];
      group.push(asset);
      pendingGroups.set(identity, group);
    }
    const pending = [...pendingGroups.values()].map((group) => ({
      ...group[0],
      workspaceSourceIds: [...new Set(group.map((asset) => asset.id))]
    }));
    const migrated = [];
    const failed = [];
    const concurrency = Math.max(1, Math.min(4, Number(options.concurrency || 3)));
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const workspaceAsset = pending[cursor++];
        try {
          const storage = await uploadToSharedStorage(
            workspaceAsset.localPath,
            "product-assets/images",
            workspaceAsset.id,
            path.extname(workspaceAsset.localPath).toLowerCase() === ".png" ? "image/png" : "image/jpeg"
          );
          if (!storage.storageUrl) throw new Error(storage.storageError || "OSS上传失败");
          const record = {
            ...workspaceAsset,
            source: "built-in",
            scope: "shared",
            readOnly: false,
            workspaceSourceId: workspaceAsset.id,
            owner: "资产库迁移",
            metadataSyncStatus: "local_pending",
            updatedAt: isoNow(),
            ...storage
          };
          const existing = state.assets.find((item) => item.id === record.id);
          if (existing) Object.assign(existing, record);
          else state.assets.push(record);
          migrated.push(publicAsset(record));
        } catch (error) {
          failed.push({ id: workspaceAsset.id, title: workspaceAsset.title, error: String(error.message || error) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, pending.length)) }, () => worker()));
    if (migrated.length) await save();
    return { ok: failed.length === 0, migrated, failed };
  }

  async function syncSharedAssets(items = [], options = {}) {
    let changed = false;
    const inputs = Array.isArray(items) ? items : [];
    const incomingIds = new Set();
    for (const input of inputs) {
      const id = text(input.id, 160);
      const assetType = input.assetType === "video" ? "video" : "image";
      if (!id || !input.storageUrl) continue;
      incomingIds.add(id);
      const existing = state.assets.find((item) => item.id === id);
      const shared = {
        id,
        assetType,
        title: text(input.title, 240) || id,
        productId: text(input.productId, 120),
        productName: text(input.productName, 240),
        category: text(input.category, 120),
        assetRole: text(input.assetRole, 80) || (assetType === "video" ? "product_broll" : "white_background"),
        angle: text(input.angle, 40),
        angleLabel: text(input.angleLabel, 80),
        style: text(input.style, 120),
        source: text(input.source, 80) || "team_library",
        approvalStatus: input.approvalStatus === "draft" ? "draft" : "approved",
        localPath: existing?.localPath || "",
        fileName: text(input.fileName, 240),
        size: Number(input.size || 0),
        duration: Number(input.duration || 0),
        sha256: text(input.sha256, 80),
        owner: text(input.owner, 160),
        createdAt: text(input.createdAt, 80) || existing?.createdAt || isoNow(),
        updatedAt: text(input.updatedAt, 80) || isoNow(),
        storageUrl: text(input.storageUrl, 4000),
        storageKey: text(input.storageKey, 4000),
        workspaceSourceId: text(input.workspaceSourceId, 160) || existing?.workspaceSourceId || "",
        workspaceSourceIds: [...new Set([
          ...(Array.isArray(input.workspaceSourceIds) ? input.workspaceSourceIds : []),
          ...(Array.isArray(existing?.workspaceSourceIds) ? existing.workspaceSourceIds : [])
        ].map((item) => text(item, 160)).filter(Boolean))],
        storageBackend: "aliyun-oss-yxb",
        storageStatus: "stored",
        metadataSyncStatus: "shared"
      };
      if (existing) Object.assign(existing, shared);
      else state.assets.push(shared);
      changed = true;
    }
    if (options.pruneMissing === true) {
      const before = state.assets.length;
      state.assets = state.assets.filter((item) => (
        item.metadataSyncStatus !== "shared" || incomingIds.has(item.id)
      ));
      changed = changed || state.assets.length !== before;
    }
    if (changed) await save();
    return listAssets();
  }

  function downloadAssetFile(sourceUrl, destination) {
    return new Promise((resolve, reject) => {
      const visit = (target, redirects = 0) => {
        if (redirects > 5) return reject(new Error("共享资产下载重定向次数过多"));
        const parsed = new URL(target);
        const transport = parsed.protocol === "http:" ? http : https;
        transport.get(parsed, { headers: { "User-Agent": "BrandMarketingWorkbench/2.9.7" } }, (response) => {
          if ([301, 302, 307, 308].includes(Number(response.statusCode)) && response.headers.location) {
            response.resume();
            visit(new URL(response.headers.location, parsed).toString(), redirects + 1);
            return;
          }
          if (Number(response.statusCode) !== 200) {
            response.resume();
            reject(new Error(`共享资产下载失败（HTTP ${response.statusCode}）`));
            return;
          }
          fsp.mkdir(path.dirname(destination), { recursive: true }).then(() => {
            const temporary = `${destination}.${process.pid}.tmp`;
            const stream = fs.createWriteStream(temporary);
            response.pipe(stream);
            stream.on("finish", () => stream.close(async () => {
              try {
                await fsp.rename(temporary, destination);
                resolve(destination);
              } catch (error) {
                reject(error);
              }
            }));
            stream.on("error", reject);
          }).catch(reject);
        }).on("error", reject);
      };
      visit(sourceUrl);
    });
  }

  async function ensureLocalAsset(assetId) {
    const asset = findAssetRecord(assetId);
    if (!asset) throw new Error("选择的资产不存在");
    if (asset.localPath && await fsp.stat(asset.localPath).then((stat) => stat.isFile()).catch(() => false)) return publicAsset(asset);
    if (asset.readOnly) throw new Error(`${asset.title || "AI产品镜共用资产"}对应的产品图文件不存在`);
    if (!asset.storageUrl) throw new Error(`${asset.title || "资产"}没有可下载的OSS地址`);
    const sourceExt = path.extname(asset.fileName || new URL(asset.storageUrl).pathname).toLowerCase();
    const allowed = asset.assetType === "video" ? new Set([".mp4", ".mov"]) : new Set([".png", ".jpg", ".jpeg"]);
    const ext = allowed.has(sourceExt) ? sourceExt : asset.assetType === "video" ? ".mp4" : ".jpg";
    const destination = path.join(outputRoot, "_asset-cache", `${asset.id.replace(/[^a-zA-Z0-9_-]/g, "_")}${ext}`);
    await downloadAssetFile(asset.storageUrl, destination);
    asset.localPath = destination;
    asset.updatedAt = isoNow();
    await save();
    return publicAsset(asset);
  }

  async function uploadToSharedStorage(filePath, category, identity, mime) {
    if (!sharedStorage?.enabled || typeof sharedStorage.uploadFile !== "function") {
      return { storageUrl: "", storageKey: "", storageBackend: "local", storageStatus: "local_only" };
    }
    try {
      const uploaded = await sharedStorage.uploadFile(filePath, { category, identity, mime });
      return {
        storageUrl: String(uploaded.url || ""),
        storageKey: String(uploaded.key || ""),
        storageBackend: "aliyun-oss-yxb",
        storageStatus: "stored"
      };
    } catch (error) {
      return {
        storageUrl: "",
        storageKey: "",
        storageBackend: "local",
        storageStatus: "upload_failed",
        storageError: error.message
      };
    }
  }

  function isTransientImageGenerationError(error) {
    return /connectionpool|read timed out|timed?\s*out|etimedout|econnreset|eai_again|socket hang up|fetch failed|network|temporar|upstream|gateway|http\s*(?:429|5\d\d)/i
      .test(String(error?.message || error || ""));
  }

  async function generateImageWithRetry(input, candidate) {
    const totalAttempts = candidateRetryDelays.length + 1;
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      candidate.attempts = attempt;
      try {
        return await gptImageClient.generate(input);
      } catch (error) {
        if (attempt >= totalAttempts || !isTransientImageGenerationError(error)) throw error;
        candidate.lastTransientError = String(error.message || error).slice(0, 500);
        candidate.updatedAt = isoNow();
        await new Promise((resolve) => setTimeout(resolve, candidateRetryDelays[attempt - 1]));
      }
    }
    throw new Error(`${candidate.imageModelLabel || "图片模型"} 生成失败`);
  }

  async function ensureCandidateInputUrl(candidate) {
    if (!candidate) return "";
    if (candidate.inputReferenceUrl) return candidate.inputReferenceUrl;
    if (candidate.localPath
      && typeof gptImageClient?.acquireToken === "function"
      && typeof gptImageClient?.upload === "function") {
      try {
        const credential = await gptImageClient.acquireToken();
        candidate.inputReferenceUrl = await gptImageClient.upload(candidate.localPath, credential.token);
        candidate.updatedAt = isoNow();
        await save();
        return candidate.inputReferenceUrl;
      } catch {
        // The freshly returned generation URL is a safe fallback during the same job.
      }
    }
    return String(candidate.remoteUrl || "").trim();
  }

  async function registerAsset(filePath, metadata = {}) {
    const resolved = path.resolve(String(filePath || ""));
    const assetType = metadata.assetType === "video" ? "video" : "image";
    const pattern = assetType === "video" ? VIDEO_PATTERN : IMAGE_PATTERN;
    const maxBytes = assetType === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!pattern.test(resolved)) throw new Error(assetType === "video" ? "视频仅支持MP4或MOV" : "图片仅支持PNG或JPG");
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new Error("待登记的资产文件不存在");
    if (stat.size > maxBytes) throw new Error(assetType === "video" ? "视频不能超过500MB" : "图片不能超过10MB");
    const sha256 = await sha256File(resolved);
    const duplicate = findExactDuplicateAsset({
      productId: metadata.productId,
      assetType,
      sha256
    });
    if (duplicate) {
      return {
        ...publicAsset(duplicate),
        duplicate: true,
        duplicateReason: "sku_asset_type_sha256",
        duplicateMatch: {
          id: duplicate.id,
          title: duplicate.title || duplicate.fileName || duplicate.id,
          source: duplicate.source || "",
          readOnly: duplicate.readOnly === true
        }
      };
    }
    const id = identifier(assetType === "video" ? "video" : "image");
    const storage = await uploadToSharedStorage(
      resolved,
      assetType === "video" ? "product-assets/videos" : "product-assets/images",
      id,
      assetType === "video" ? (path.extname(resolved).toLowerCase() === ".mov" ? "video/quicktime" : "video/mp4") : (path.extname(resolved).toLowerCase() === ".png" ? "image/png" : "image/jpeg")
    );
    const angle = ANGLES.find((item) => item.id === metadata.angle) || null;
    const record = {
      id,
      assetType,
      title: text(metadata.title, 240) || path.basename(resolved),
      productId: text(metadata.productId, 120),
      productName: text(metadata.productName, 240),
      category: text(metadata.category, 120),
      assetRole: text(metadata.assetRole, 80) || (assetType === "video" ? "product_broll" : "white_background"),
      productState: text(metadata.productState, 80),
      view: text(metadata.view, 80) || angle?.id || "unknown",
      angle: angle?.id || "",
      angleLabel: angle?.label || "",
      style: text(metadata.style, 120),
      source: text(metadata.source, 80) || "upload",
      approvalStatus: metadata.approvalStatus === "draft" ? "draft" : "approved",
      localPath: resolved,
      size: stat.size,
      sha256,
      owner: text(metadata.owner, 160),
      fileName: path.basename(resolved),
      duration: Number(metadata.duration || 0),
      createdAt: isoNow(),
      updatedAt: isoNow(),
      metadataSyncStatus: text(metadata.metadataSyncStatus, 40) || "local_pending",
      ...storage
    };
    state.assets.push(record);
    await save();
    return publicAsset(record);
  }

  function generationDeadline(candidate) {
    const parsed = Date.parse(String(candidate?.generationDeadlineAt || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function ensureGenerationTime(candidate) {
    const deadline = generationDeadline(candidate);
    if (!deadline || deadline <= Date.now()) {
      throw new Error(`${candidate?.imageModelLabel || "图片模型"} 图片生成全流程等待超过15分钟，请点击“+ 新首帧”重试。`);
    }
    return deadline;
  }

  function stageForRemoteStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (["queued", "pending", "created", "submitted"].includes(normalized)) return "queued";
    if (["succeeded", "success", "completed", "done"].includes(normalized)) return "downloading";
    return "running";
  }

  async function updateGenerationStage(job, candidate, stage, remoteStatus = "") {
    const normalizedRemoteStatus = String(remoteStatus || "").trim().toLowerCase();
    if (candidate.stage === stage && (!normalizedRemoteStatus || candidate.remoteStatus === normalizedRemoteStatus)) return;
    candidate.stage = stage;
    candidate.stageLabel = IMAGE_GENERATION_STAGE_LABELS[stage] || "生成中";
    if (normalizedRemoteStatus) candidate.remoteStatus = normalizedRemoteStatus;
    candidate.updatedAt = isoNow();
    job.updatedAt = isoNow();
    await save();
  }

  function failReplacementCandidate(job, candidate, error) {
    const rawMessage = String(error?.message || error || "新首帧生成失败");
    const expired = generationDeadline(candidate) > 0 && generationDeadline(candidate) <= Date.now();
    candidate.status = "failed";
    candidate.stage = "failed";
    candidate.stageLabel = IMAGE_GENERATION_STAGE_LABELS.failed;
    candidate.error = expired || /全流程等待超过15分钟|waiting.*15.*minute/i.test(rawMessage)
      ? `${candidate.imageModelLabel || "图片模型"} 图片生成全流程等待超过15分钟，任务已停止，请点击“+ 新首帧”重试。`
      : rawMessage;
    candidate.completedAt = isoNow();
    candidate.updatedAt = isoNow();
    const selectedCandidate = job.firstFrameCandidates?.find((item) => item.id === job.selectedFirstFrameId && item.status === "success");
    const anotherCandidateGenerating = job.firstFrameCandidates?.some((item) => item.id !== candidate.id && item.status === "generating");
    job.status = anotherCandidateGenerating ? "generating_first_frame" : selectedCandidate ? "ready_to_generate" : "first_frame_failed";
    job.updatedAt = isoNow();
  }

  function failReplacementShotAnchor(job, candidate, error) {
    const rawMessage = String(error?.message || error || "换品关键帧生成失败");
    const expired = generationDeadline(candidate) > 0 && generationDeadline(candidate) <= Date.now();
    candidate.status = "failed";
    candidate.stage = "failed";
    candidate.stageLabel = IMAGE_GENERATION_STAGE_LABELS.failed;
    candidate.error = expired || /全流程等待超过15分钟|waiting.*15.*minute/i.test(rawMessage)
      ? `${candidate.imageModelLabel || "图片模型"} 换品关键帧生成超过15分钟，任务已停止，请在对应分镜重新生成。`
      : rawMessage;
    candidate.completedAt = isoNow();
    candidate.updatedAt = isoNow();
    job.updatedAt = isoNow();
  }

  function reconcileInterruptedReplacementJobs() {
    const items = [];
    let changed = false;
    for (const job of state.replacementJobs) {
      for (const candidate of job.firstFrameCandidates || []) {
        if (candidate.status !== "generating") continue;
        const started = Date.parse(String(candidate.generationStartedAt || candidate.createdAt || ""));
        const startedAt = Number.isFinite(started) ? started : Date.now();
        if (!candidate.generationStartedAt) candidate.generationStartedAt = new Date(startedAt).toISOString();
        if (!candidate.generationDeadlineAt) {
          candidate.generationDeadlineAt = new Date(startedAt + imageGenerationTimeoutMs).toISOString();
        }
        const deadline = generationDeadline(candidate);
        if (!candidate.taskId) {
          failReplacementCandidate(job, candidate, new Error(
            deadline && deadline <= Date.now()
              ? `${candidate.imageModelLabel || "图片模型"} 图片生成全流程等待超过15分钟`
              : "服务重启前尚未保存上游图片任务编号，本次任务已停止，请重新生成首帧。"
          ));
          changed = true;
          continue;
        }
        if (!deadline || deadline <= Date.now()) {
          failReplacementCandidate(job, candidate, new Error(`${candidate.imageModelLabel || "图片模型"} 图片生成全流程等待超过15分钟`));
          changed = true;
          continue;
        }
        if (typeof gptImageClient?.waitForTask !== "function") {
          failReplacementCandidate(job, candidate, new Error("图片任务恢复组件不可用，本次任务已停止，请重新生成首帧。"));
          changed = true;
          continue;
        }
        candidate.stage = "recovering";
        candidate.stageLabel = IMAGE_GENERATION_STAGE_LABELS.recovering;
        candidate.updatedAt = isoNow();
        job.status = "generating_first_frame";
        job.updatedAt = isoNow();
        items.push({ jobId: job.id, candidateId: candidate.id });
        changed = true;
      }
      for (const candidate of job.shotAnchorCandidates || []) {
        if (candidate.status !== "generating") continue;
        const started = Date.parse(String(candidate.generationStartedAt || candidate.createdAt || ""));
        const startedAt = Number.isFinite(started) ? started : Date.now();
        if (!candidate.generationStartedAt) candidate.generationStartedAt = new Date(startedAt).toISOString();
        if (!candidate.generationDeadlineAt) candidate.generationDeadlineAt = new Date(startedAt + imageGenerationTimeoutMs).toISOString();
        const deadline = generationDeadline(candidate);
        if (!candidate.taskId || !deadline || deadline <= Date.now() || typeof gptImageClient?.waitForTask !== "function") {
          failReplacementShotAnchor(job, candidate, new Error(
            !candidate.taskId
              ? "服务重启前尚未保存换品关键帧任务编号，请在对应分镜重新生成。"
              : deadline && deadline <= Date.now()
                ? `${candidate.imageModelLabel || "图片模型"} 图片生成全流程等待超过15分钟`
                : "换品关键帧恢复组件不可用，请在对应分镜重新生成。"
          ));
          changed = true;
          continue;
        }
        candidate.stage = "recovering";
        candidate.stageLabel = IMAGE_GENERATION_STAGE_LABELS.recovering;
        candidate.updatedAt = isoNow();
        job.updatedAt = isoNow();
        items.push({ kind: "shot-anchor", jobId: job.id, candidateId: candidate.id });
        changed = true;
      }
    }
    return { changed, items };
  }

  function candidatePreview(candidate) {
    const startedAt = Date.parse(String(candidate.generationStartedAt || candidate.createdAt || ""));
    const completedAt = Date.parse(String(candidate.completedAt || candidate.updatedAt || candidate.createdAt || ""));
    const endAt = candidate.status === "generating"
      ? Date.now()
      : (Number.isFinite(completedAt) ? completedAt : startedAt);
    const deadline = generationDeadline(candidate);
    const previewUrl = candidate.localPath ? `./api/image?path=${encodeURIComponent(candidate.localPath)}` : candidate.remoteUrl || "";
    return {
      ...candidate,
      stageLabel: candidate.stageLabel || IMAGE_GENERATION_STAGE_LABELS[candidate.stage] || (candidate.status === "generating" ? "生成中" : ""),
      elapsedSeconds: Number.isFinite(startedAt) ? Math.max(0, Math.floor((endAt - startedAt) / 1000)) : 0,
      remainingSeconds: candidate.status === "generating" && deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0,
      previewUrl,
      thumbnailUrl: candidate.localPath ? `${previewUrl}&thumbnail=1` : previewUrl
    };
  }

  function publicCandidateJob(job) {
    const taskChannel = inferCandidateTaskChannel(job);
    return {
      ...job,
      taskChannel,
      taskChannelLabel: candidateTaskChannelLabel(taskChannel),
      referencePreviewUrl: job.referenceImagePath ? `./api/image?path=${encodeURIComponent(job.referenceImagePath)}` : "",
      candidates: (job.candidates || []).map(candidatePreview)
    };
  }

  function taskMatchesOwner(job, ownerKey) {
    const requestedOwner = text(ownerKey, 240);
    return Boolean(requestedOwner) && job?.ownerKey === requestedOwner;
  }

  function candidateTaskDateKey(value) {
    const parsed = new Date(value || isoNow());
    const date = Number.isFinite(parsed.getTime()) ? parsed : new Date();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function chineseTaskOrdinal(value) {
    const number = Math.max(1, Math.floor(Number(value) || 1));
    const numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (number < 10) return numerals[number];
    if (number === 10) return "十";
    if (number < 20) return `十${numerals[number % 10]}`;
    if (number < 100) return `${numerals[Math.floor(number / 10)]}十${number % 10 ? numerals[number % 10] : ""}`;
    return String(number);
  }

  const CANDIDATE_TASK_CHANNEL_LABELS = Object.freeze({
    standard: "三路制作",
    "semi-auto": "备用半自动",
    "creative-instruction": "备用创意"
  });
  const CANDIDATE_TASK_NAMING_VERSION = 2;

  function normalizeCandidateTaskChannel(value, fallback = "standard") {
    const channel = text(value, 80);
    return Object.prototype.hasOwnProperty.call(CANDIDATE_TASK_CHANNEL_LABELS, channel) ? channel : fallback;
  }

  function generatedCandidateTaskChannel(records = []) {
    const angles = new Set((Array.isArray(records) ? records : []).map((item) => text(item?.angle, 80)));
    if (angles.has("creativeInstruction")) return "creative-instruction";
    if (angles.has("customCreative")) return "semi-auto";
    return angles.size ? "standard" : "";
  }

  function inferCandidateTaskChannel(job = {}) {
    return normalizeCandidateTaskChannel(job.taskChannel, "")
      || generatedCandidateTaskChannel(job.generatedVideoJobs)
      || normalizeCandidateTaskChannel(job.draftData?.activeProductChannel, "")
      || "standard";
  }

  function candidateTaskChannelLabel(channel) {
    return CANDIDATE_TASK_CHANNEL_LABELS[normalizeCandidateTaskChannel(channel)] || CANDIDATE_TASK_CHANNEL_LABELS.standard;
  }

  function defaultCandidateTaskName(dateKey, sequence, channel = "standard") {
    const compactDate = String(dateKey || "").slice(5).replace("-", "");
    const sequenceToken = String(Math.max(1, Math.floor(Number(sequence) || 1))).padStart(2, "0");
    return `${compactDate || "任务"} ${candidateTaskChannelLabel(channel)}任务${sequenceToken}`;
  }

  function defaultReplacementTaskName(dateKey, sequence) {
    const compactDate = String(dateKey || "").slice(5).replace("-", "");
    return `${compactDate || "任务"}任务${chineseTaskOrdinal(sequence)}`;
  }

  function generatedCandidateTaskName(value) {
    const name = String(value || "").trim();
    return /^\d{4}任务(?:[零一二三四五六七八九十百]+|\d+)$/u.test(name)
      || /^\d{4} (?:三路制作|备用半自动|备用创意)任务\d{2,}$/u.test(name);
  }

  function candidateTaskGroupKey(job, dateKey = candidateTaskDateKey(job?.createdAt), channel = inferCandidateTaskChannel(job)) {
    return `${text(job?.ownerKey, 240)}\n${dateKey}\n${normalizeCandidateTaskChannel(channel)}`;
  }

  function nextCandidateTaskSequence(ownerKey, dateKey, channel = "standard", excludedJobId = "") {
    const groupKey = `${text(ownerKey, 240)}\n${dateKey}\n${normalizeCandidateTaskChannel(channel)}`;
    return state.candidateJobs.reduce((maximum, job) => {
      if (excludedJobId && job.id === excludedJobId) return maximum;
      const jobDateKey = job.taskDateKey || candidateTaskDateKey(job.createdAt);
      if (candidateTaskGroupKey(job, jobDateKey, inferCandidateTaskChannel(job)) !== groupKey) return maximum;
      return Math.max(maximum, Number(job.taskSequence) || 0);
    }, 0) + 1;
  }

  function nextCandidateTaskSortOrder() {
    return state.candidateJobs.reduce((maximum, job) => Math.max(maximum, Number(job.taskSortOrder) || 0), Date.now() - 1) + 1;
  }

  function nextReplacementTaskSortOrder() {
    return state.replacementJobs.reduce((maximum, job) => Math.max(maximum, Number(job.taskSortOrder) || 0), Date.now() - 1) + 1;
  }

  function replacementTaskGroupKey(job, dateKey = candidateTaskDateKey(job?.createdAt)) {
    return `${text(job?.ownerKey, 240)}\n${dateKey}`;
  }

  function nextReplacementTaskSequence(ownerKey, dateKey) {
    const groupKey = `${text(ownerKey, 240)}\n${dateKey}`;
    return state.replacementJobs.reduce((maximum, job) => {
      const jobDateKey = job.taskDateKey || candidateTaskDateKey(job.createdAt);
      if (replacementTaskGroupKey(job, jobDateKey) !== groupKey) return maximum;
      return Math.max(maximum, Number(job.taskSequence) || 0);
    }, 0) + 1;
  }

  function ensureReplacementTaskMetadata() {
    let changed = false;
    const maximumSequenceByGroup = new Map();
    for (const job of state.replacementJobs) {
      const dateKey = job.taskDateKey || candidateTaskDateKey(job.createdAt);
      const groupKey = replacementTaskGroupKey(job, dateKey);
      maximumSequenceByGroup.set(groupKey, Math.max(maximumSequenceByGroup.get(groupKey) || 0, Number(job.taskSequence) || 0));
    }
    const usedSortOrders = new Set();
    const ordered = [...state.replacementJobs].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
    for (let index = 0; index < ordered.length; index += 1) {
      const job = ordered[index];
      const dateKey = job.taskDateKey || candidateTaskDateKey(job.createdAt);
      const groupKey = replacementTaskGroupKey(job, dateKey);
      if (!job.taskDateKey) {
        job.taskDateKey = dateKey;
        changed = true;
      }
      if (!(Number(job.taskSequence) > 0)) {
        job.taskSequence = (maximumSequenceByGroup.get(groupKey) || 0) + 1;
        maximumSequenceByGroup.set(groupKey, job.taskSequence);
        changed = true;
      }
      if (!String(job.taskName || "").trim()) {
        job.taskName = defaultReplacementTaskName(dateKey, job.taskSequence);
        changed = true;
      }
      let sortOrder = Number(job.taskSortOrder);
      if (!(sortOrder > 0)) sortOrder = (Date.parse(job.createdAt || "") || Date.now()) + index;
      while (usedSortOrders.has(sortOrder)) sortOrder += 1;
      usedSortOrders.add(sortOrder);
      if (job.taskSortOrder !== sortOrder) {
        job.taskSortOrder = sortOrder;
        changed = true;
      }
    }
    return changed;
  }

  function ensureReplacementIdentityTrackingMetadata() {
    let changed = false;
    for (const job of state.replacementJobs) {
      if (!job.sourceAnalysis || Number(job.sourceAnalysis.identityTrackingVersion || 0) >= 1) continue;
      job.sourceAnalysis = normalizeReplacementSourceAnalysis(job.sourceAnalysis, {
        duration: Number(job.sourceAnalysis.duration || job.referenceAssets?.duration || 0),
        keyframes: job.sourceAnalysis.keyframes || [],
        provider: job.sourceAnalysis.provider,
        inputMode: job.sourceAnalysis.inputMode,
        analyzedAt: job.sourceAnalysis.analyzedAt
      });
      const shots = job.sourceAnalysis.sourceShots || [];
      if (job.shotPlan && Array.isArray(job.shotPlan.units)) {
        for (const unit of job.shotPlan.units) {
          const shot = shots.find((candidate) => (unit.sourceShotIds || []).includes(candidate.id)
            || (candidate.sourceShotIds || []).some((id) => (unit.sourceShotIds || []).includes(id)));
          if (!shot) continue;
          unit.subjects = shot.subjects;
          unit.personTracks = shot.personTracks;
          unit.identityConfidence = shot.identityConfidence;
          unit.identityReviewRequired = shot.identityReviewRequired;
          unit.identityRisks = shot.identityRisks;
        }
        job.shotPlan.identityTrackingVersion = 1;
        job.shotPlan.subjectProfileCount = job.sourceAnalysis.subjectProfiles.length;
        job.shotPlan.identityReviewShotCount = job.sourceAnalysis.identityReviewShotCount;
      }
      changed = true;
    }
    return changed;
  }

  function ensureReplacementExecutionClassificationMetadata() {
    let changed = false;
    for (const job of state.replacementJobs) {
      if (!job.sourceAnalysis || !job.shotPlan || !Array.isArray(job.shotPlan.units)) continue;
      if (job.shotPlan.executionClassification?.schemaVersion === REPLACEMENT_EXECUTION_CLASSIFICATION_SCHEMA_VERSION) continue;
      job.shotPlan.executionClassificationVersion = 2;
      job.shotPlan.executionClassification = classifyReplacementExecution(job.sourceAnalysis, {
        units: job.shotPlan.units,
        generationPlan: {
          generationUnits: Array.isArray(job.shotPlan.generationUnits) ? job.shotPlan.generationUnits : [],
          blockingReasons: Array.isArray(job.shotPlan.blockingReasons) ? job.shotPlan.blockingReasons : []
        },
        physicalContinuityGroups: Array.isArray(job.shotPlan.physicalContinuityGroups) ? job.shotPlan.physicalContinuityGroups : []
      });
      changed = true;
    }
    return changed;
  }

  function ensureReplacementGenerationPlanningMetadata() {
    let changed = false;
    for (const job of state.replacementJobs) {
      if (!job.sourceAnalysis || !job.shotPlan || !Array.isArray(job.shotPlan.units)) continue;
      if (
        job.shotPlan.generationPlanning?.schemaVersion === REPLACEMENT_GENERATION_PLANNING_SCHEMA_VERSION
        && job.shotPlan.generationPlanning?.compilerVersion === REPLACEMENT_GENERATION_COMPILER_VERSION
      ) continue;
      applyReplacementGenerationPlanning(job.shotPlan, job.sourceAnalysis, {
        executionClassification: job.shotPlan.executionClassification
      });
      changed = true;
    }
    return changed;
  }

  function ensureCandidateTaskMetadata() {
    let changed = false;
    const nextSequenceByGroup = new Map();
    const usedSortOrders = new Set();
    const ordered = [...state.candidateJobs].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
    for (const job of ordered) {
      if (Number(job.taskNamingVersion) < CANDIDATE_TASK_NAMING_VERSION || !(Number(job.taskSequence) > 0)) continue;
      const dateKey = job.taskDateKey || candidateTaskDateKey(job.createdAt);
      const channel = inferCandidateTaskChannel(job);
      const groupKey = candidateTaskGroupKey(job, dateKey, channel);
      nextSequenceByGroup.set(groupKey, Math.max(nextSequenceByGroup.get(groupKey) || 0, Number(job.taskSequence)));
    }
    for (let index = 0; index < ordered.length; index += 1) {
      const job = ordered[index];
      const dateKey = job.taskDateKey || candidateTaskDateKey(job.createdAt);
      const channel = inferCandidateTaskChannel(job);
      const groupKey = candidateTaskGroupKey(job, dateKey, channel);
      if (!job.taskDateKey) {
        job.taskDateKey = dateKey;
        changed = true;
      }
      if (job.taskChannel !== channel) {
        job.taskChannel = channel;
        changed = true;
      }
      if (typeof job.taskNameCustomized !== "boolean") {
        job.taskNameCustomized = Boolean(String(job.taskName || "").trim()) && !generatedCandidateTaskName(job.taskName);
        changed = true;
      }
      let sequence = Number(job.taskSequence);
      if (Number(job.taskNamingVersion) < CANDIDATE_TASK_NAMING_VERSION || !(sequence > 0)) {
        sequence = (nextSequenceByGroup.get(groupKey) || 0) + 1;
        job.taskSequence = sequence;
        job.taskNamingVersion = CANDIDATE_TASK_NAMING_VERSION;
        nextSequenceByGroup.set(groupKey, sequence);
        changed = true;
      }
      const generatedName = defaultCandidateTaskName(dateKey, sequence, channel);
      if (!job.taskNameCustomized && job.taskName !== generatedName) {
        job.taskName = generatedName;
        changed = true;
      }
      let sortOrder = Number(job.taskSortOrder);
      if (!(sortOrder > 0)) sortOrder = (Date.parse(job.createdAt || "") || Date.now()) + index;
      while (usedSortOrders.has(sortOrder)) sortOrder += 1;
      usedSortOrders.add(sortOrder);
      if (job.taskSortOrder !== sortOrder) {
        job.taskSortOrder = sortOrder;
        changed = true;
      }
      if (!Array.isArray(job.generatedVideoJobs)) {
        job.generatedVideoJobs = [];
        changed = true;
      }
    }
    return changed;
  }

  function taskDraftData(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    return JSON.parse(JSON.stringify(input));
  }

  function assertDraftOwner(job, ownerKey) {
    const requestedOwner = text(ownerKey, 240);
    if (requestedOwner && job?.ownerKey !== requestedOwner) throw new Error("任务草稿不存在");
  }

  function candidateDraftHasContent(job) {
    const draft = job?.draftData || {};
    return Boolean(
      job?.referenceImagePath
      || draft.reference?.path
      || String(draft.prompt || "").trim()
      || draft.customCreative?.scene?.path
      || draft.customCreative?.jobId
    );
  }

  async function createCandidateDraft(input = {}) {
    const reusable = state.candidateJobs.find((item) => item.id === text(input.reuseDraftId, 160));
    if (reusable?.status === "draft" && input.forceNew !== true) {
      assertDraftOwner(reusable, input.ownerKey);
      if (!candidateDraftHasContent(reusable)) {
        const currentChannel = inferCandidateTaskChannel(reusable);
        const requestedChannel = normalizeCandidateTaskChannel(input.taskChannel, currentChannel);
        if (requestedChannel !== currentChannel && !(reusable.generatedVideoJobs || []).length) {
          reusable.taskChannel = requestedChannel;
          reusable.taskSequence = nextCandidateTaskSequence(reusable.ownerKey, reusable.taskDateKey || candidateTaskDateKey(reusable.createdAt), requestedChannel, reusable.id);
          reusable.taskNamingVersion = CANDIDATE_TASK_NAMING_VERSION;
          if (!reusable.taskNameCustomized) reusable.taskName = defaultCandidateTaskName(reusable.taskDateKey, reusable.taskSequence, requestedChannel);
          reusable.updatedAt = isoNow();
          await save();
        }
        return publicCandidateJob(reusable);
      }
    }
    const now = isoNow();
    const taskDateKey = candidateTaskDateKey(now);
    const taskChannel = normalizeCandidateTaskChannel(input.taskChannel);
    const taskSequence = nextCandidateTaskSequence(input.ownerKey, taskDateKey, taskChannel);
    const job = {
      id: identifier("image-job"),
      workflow: "empty_scene_candidates",
      status: "draft",
      generationMode: "manual",
      referenceImagePath: "",
      referenceImageName: "",
      referenceImageUrl: "",
      prompt: "",
      promptConfirmed: false,
      promptModel: "qwen3.7-plus",
      imageModel: DEFAULT_IMAGE_MODEL,
      imageModelLabel: imageModelLabel(DEFAULT_IMAGE_MODEL),
      ownerKey: text(input.ownerKey, 240),
      ownerName: text(input.ownerName, 240),
      resolution: "1K",
      generationStage: "draft",
      candidates: [],
      taskName: defaultCandidateTaskName(taskDateKey, taskSequence, taskChannel),
      taskNameCustomized: false,
      taskChannel,
      taskNamingVersion: CANDIDATE_TASK_NAMING_VERSION,
      taskDateKey,
      taskSequence,
      taskSortOrder: nextCandidateTaskSortOrder(),
      generatedVideoJobs: [],
      draftData: {},
      createdAt: now,
      updatedAt: now
    };
    state.candidateJobs.push(job);
    await save();
    return publicCandidateJob(job);
  }

  async function updateCandidateDraft(jobId, input = {}) {
    const job = state.candidateJobs.find((item) => item.id === String(jobId || ""));
    if (!job || job.status !== "draft") throw new Error("AI产品镜草稿不存在或已经开始生成");
    assertDraftOwner(job, input.ownerKey);
    const draftData = taskDraftData(input.draftData);
    const currentChannel = inferCandidateTaskChannel(job);
    const requestedChannel = normalizeCandidateTaskChannel(input.taskChannel || draftData.activeProductChannel, currentChannel);
    const channelCanChange = job.status === "draft" && !(Array.isArray(job.generatedVideoJobs) && job.generatedVideoJobs.length);
    if (channelCanChange && requestedChannel !== currentChannel) {
      job.taskChannel = requestedChannel;
      job.taskSequence = nextCandidateTaskSequence(job.ownerKey, job.taskDateKey || candidateTaskDateKey(job.createdAt), requestedChannel, job.id);
      job.taskNamingVersion = CANDIDATE_TASK_NAMING_VERSION;
      if (!job.taskNameCustomized) job.taskName = defaultCandidateTaskName(job.taskDateKey, job.taskSequence, requestedChannel);
    }
    job.draftData = draftData;
    job.referenceImagePath = text(draftData.reference?.path, 1000);
    job.referenceImageName = text(draftData.reference?.name, 240);
    job.prompt = text(draftData.prompt, 8000);
    job.promptConfirmed = Boolean(draftData.promptConfirmed);
    job.imageModel = normalizeImageModel(draftData.imageModel || job.imageModel || DEFAULT_IMAGE_MODEL);
    job.imageModelLabel = imageModelLabel(job.imageModel);
    job.updatedAt = isoNow();
    await save();
    return publicCandidateJob(job);
  }

  function listCandidateJobs(options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 50));
    return state.candidateJobs
      .filter((job) => taskMatchesOwner(job, options.ownerKey))
      .sort((left, right) => (Number(right.taskSortOrder) || 0) - (Number(left.taskSortOrder) || 0)
        || String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, limit)
      .map(publicCandidateJob);
  }

  function getCandidateJob(jobId) {
    const job = state.candidateJobs.find((item) => item.id === String(jobId || ""));
    return job ? publicCandidateJob(job) : null;
  }

  async function updateCandidateTask(jobId, input = {}) {
    const job = state.candidateJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("AI产品镜任务不存在");
    assertDraftOwner(job, input.ownerKey);
    const taskName = String(input.taskName || "").trim();
    if (!taskName) throw new Error("任务名称不能为空");
    if (Array.from(taskName).length > 40) throw new Error("任务名称不能超过40个字符");
    job.taskName = taskName;
    job.taskNameCustomized = true;
    job.updatedAt = isoNow();
    await save();
    return publicCandidateJob(job);
  }

  async function reorderCandidateJobs(jobIds = [], input = {}) {
    const orderedIds = [...new Set((Array.isArray(jobIds) ? jobIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!orderedIds.length) throw new Error("请提供任务排序结果");
    const orderedJobs = orderedIds.map((id) => state.candidateJobs.find((job) => job.id === id));
    if (orderedJobs.some((job) => !job || !taskMatchesOwner(job, input.ownerKey))) throw new Error("任务排序中包含无权访问的任务");
    const maximum = state.candidateJobs.reduce((value, job) => Math.max(value, Number(job.taskSortOrder) || 0), Date.now());
    const topOrder = maximum + orderedJobs.length;
    orderedJobs.forEach((job, index) => { job.taskSortOrder = topOrder - index; });
    await save();
    return orderedJobs.map(publicCandidateJob);
  }

  async function recordCandidateVideoJobs(jobId, inputs = [], options = {}) {
    const job = state.candidateJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("AI产品镜任务不存在");
    assertDraftOwner(job, options.ownerKey);
    const existing = Array.isArray(job.generatedVideoJobs) ? job.generatedVideoJobs : [];
    const hadGeneratedVideoJobs = existing.length > 0;
    for (const input of Array.isArray(inputs) ? inputs : []) {
      const generatedJobId = text(input.id || input.jobId, 160);
      const angle = text(input.angle, 80);
      if (!generatedJobId || !angle) continue;
      const record = {
        jobId: generatedJobId,
        angle,
        angleLabel: text(input.angleLabel, 120),
        videoModelId: text(input.videoModelId, 120),
        model: text(input.model, 240),
        videoGenerationMode: text(input.videoGenerationMode, 120),
        videoGenerationModeLabel: text(input.videoGenerationModeLabel, 120),
        duration: Number(input.duration) || 0,
        createdAt: isoNow()
      };
      const prior = existing.find((item) => item.angle === angle);
      if (prior?.jobId && prior.jobId !== generatedJobId) {
        job.generatedVideoJobHistory = [...new Set([...(job.generatedVideoJobHistory || []), prior.jobId])].slice(-30);
      }
      const index = existing.findIndex((item) => item.angle === angle);
      if (index >= 0) existing[index] = record;
      else existing.push(record);
    }
    job.generatedVideoJobs = existing;
    if (!hadGeneratedVideoJobs) {
      const generatedChannel = generatedCandidateTaskChannel(existing);
      const currentChannel = inferCandidateTaskChannel(job);
      if (generatedChannel && generatedChannel !== currentChannel) {
        job.taskChannel = generatedChannel;
        job.taskSequence = nextCandidateTaskSequence(job.ownerKey, job.taskDateKey || candidateTaskDateKey(job.createdAt), generatedChannel, job.id);
        job.taskNamingVersion = CANDIDATE_TASK_NAMING_VERSION;
        if (!job.taskNameCustomized) job.taskName = defaultCandidateTaskName(job.taskDateKey, job.taskSequence, generatedChannel);
      }
    }
    job.updatedAt = isoNow();
    await save();
    return publicCandidateJob(job);
  }

  async function deleteCandidateJob(jobId) {
    const index = state.candidateJobs.findIndex((item) => item.id === String(jobId || ""));
    if (index < 0) throw new Error("候选图任务不存在");
    const [job] = state.candidateJobs.splice(index, 1);
    await save();
    return publicCandidateJob(job);
  }

  async function generateCandidate(job, angleId, options = {}) {
    const angle = findAngle(angleId);
    const version = job.candidates.filter((item) => item.angle === angle.id).length + 1;
    const selectedImageModel = normalizeImageModel(options.imageModel || job.imageModel || DEFAULT_IMAGE_MODEL);
    const selectedImageModelLabel = imageModelLabel(selectedImageModel);
    const anchorCandidate = options.anchorCandidate?.status === "success" ? options.anchorCandidate : null;
    const candidate = {
      id: identifier("candidate"),
      angle: angle.id,
      angleLabel: angle.label,
      version,
      label: `${angle.label} V${version}`,
      status: "generating",
      imageModel: selectedImageModel,
      imageModelLabel: selectedImageModelLabel,
      referenceCandidateId: anchorCandidate?.id || "",
      prompt: buildEmptyScenePrompt({
        ...job,
        imageModel: selectedImageModel,
        angleId: angle.id,
        anchorCandidateId: anchorCandidate?.id || ""
      }),
      createdAt: isoNow(),
      localPath: "",
      remoteUrl: "",
      taskId: "",
      attempts: 0,
      lastTransientError: "",
      error: ""
    };
    job.candidates.push(candidate);
    job.status = "generating";
    job.updatedAt = isoNow();
    await save();
    try {
      if (!gptImageClient) throw new Error(`${selectedImageModelLabel} 尚未接入`);
      const inputReferenceUrl = anchorCandidate ? await ensureCandidateInputUrl(anchorCandidate) : "";
      const generated = await generateImageWithRetry({
        model: selectedImageModel,
        prompt: candidate.prompt,
        aspectRatio: "9:16",
        resolution: job.resolution || "1K",
        ...(inputReferenceUrl ? { inputUrls: [inputReferenceUrl] } : {})
      }, candidate);
      const dir = path.join(outputRoot, "AI产展", "无产品场景图", job.id);
      const destination = path.join(dir, `${angle.id}-v${version}.png`);
      await gptImageClient.downloadFile(generated.url, destination);
      candidate.status = "success";
      candidate.remoteUrl = generated.url;
      candidate.taskId = generated.taskId || "";
      candidate.localPath = destination;
      candidate.sha256 = await sha256File(destination);
      candidate.size = (await fsp.stat(destination)).size;
    } catch (error) {
      candidate.status = "failed";
      candidate.error = isTransientImageGenerationError(error)
        ? `${selectedImageModelLabel} 上游连接超时，已自动重试${candidate.attempts || 1}次，请点击“追加场景”继续重试。`
        : `${selectedImageModelLabel} 生图失败：${String(error?.message || error || "生图服务异常")}`;
    }
    const active = job.candidates.some((item) => item.status === "generating");
    const successfulAngles = new Set(job.candidates.filter((item) => item.status === "success").map((item) => item.angle));
    job.status = active ? "generating" : successfulAngles.size === ANGLES.length ? "ready" : "partial_failure";
    job.updatedAt = isoNow();
    await save();
    return candidatePreview(candidate);
  }

  async function createCandidateJob(input = {}) {
    const referenceImagePath = path.resolve(String(input.referenceImagePath || ""));
    if (!IMAGE_PATTERN.test(referenceImagePath)) throw new Error("请上传PNG或JPG参考图");
    const referenceStat = await fsp.stat(referenceImagePath).catch(() => null);
    if (!referenceStat?.isFile()) throw new Error("参考图不存在");
    if (referenceStat.size > MAX_IMAGE_BYTES) throw new Error("参考图不能超过10MB");
    const confirmedPrompt = text(input.prompt || input.confirmedPrompt, 8000);
    if (!confirmedPrompt) throw new Error("请先确认图片反推提示词");
    const selectedImageModel = normalizeImageModel(input.imageModel || DEFAULT_IMAGE_MODEL);
    const draftJobId = text(input.draftJobId, 160);
    const draftJob = draftJobId ? state.candidateJobs.find((item) => item.id === draftJobId) : null;
    if (draftJobId && (!draftJob || draftJob.status !== "draft")) throw new Error("AI产品镜草稿不存在或已经开始生成");
    if (draftJob) assertDraftOwner(draftJob, input.ownerKey);
    const createdAt = draftJob?.createdAt || isoNow();
    const taskDateKey = draftJob?.taskDateKey || candidateTaskDateKey(createdAt);
    const taskChannel = draftJob ? inferCandidateTaskChannel(draftJob) : normalizeCandidateTaskChannel(input.taskChannel);
    const taskSequence = draftJob?.taskSequence || nextCandidateTaskSequence(input.ownerKey, taskDateKey, taskChannel);
    const jobData = {
      id: draftJob?.id || identifier("image-job"),
      workflow: "empty_scene_candidates",
      status: "queued",
      referenceImagePath,
      referenceImageName: text(input.referenceImageName, 240) || path.basename(referenceImagePath),
      referenceImageUrl: "",
      prompt: confirmedPrompt,
      promptConfirmed: true,
      promptModel: text(input.promptModel, 120) || "qwen3.7-plus",
      imageModel: selectedImageModel,
      imageModelLabel: imageModelLabel(selectedImageModel),
      ownerKey: text(input.ownerKey, 240),
      ownerName: text(input.ownerName, 240),
      resolution: ["1K", "2K", "4K"].includes(input.resolution) ? input.resolution : "1K",
      generationStage: "flat_anchor",
      candidates: [],
      taskName: draftJob?.taskName || defaultCandidateTaskName(taskDateKey, taskSequence, taskChannel),
      taskNameCustomized: Boolean(draftJob?.taskNameCustomized),
      taskChannel,
      taskNamingVersion: CANDIDATE_TASK_NAMING_VERSION,
      taskDateKey,
      taskSequence,
      taskSortOrder: draftJob?.taskSortOrder || nextCandidateTaskSortOrder(),
      generatedVideoJobs: Array.isArray(draftJob?.generatedVideoJobs) ? draftJob.generatedVideoJobs : [],
      draftData: null,
      createdAt,
      updatedAt: isoNow()
    };
    const job = draftJob ? Object.assign(draftJob, jobData) : jobData;
    if (!draftJob) state.candidateJobs.push(job);
    await save();
    (async () => {
      const flatCandidate = await generateCandidate(job, "flat");
      const flatAnchor = job.candidates.find((candidate) => candidate.id === flatCandidate.id && candidate.status === "success") || null;
      if (flatAnchor) await ensureCandidateInputUrl(flatAnchor);
      job.generationStage = "sibling_angles";
      job.updatedAt = isoNow();
      await save();
      await Promise.all(
        ANGLES
          .filter((angle) => angle.id !== "flat")
          .map((angle) => generateCandidate(job, angle.id, { anchorCandidate: flatAnchor }))
      );
      job.generationStage = "completed";
      job.updatedAt = isoNow();
      await save();
    })().catch(async (error) => {
      job.generationStage = "completed";
      job.orchestrationError = String(error?.message || error || "场景生成调度失败").slice(0, 500);
      job.updatedAt = isoNow();
      await save().catch(() => {});
    });
    return publicCandidateJob(job);
  }

  async function appendCandidate(jobId, input = {}) {
    const job = state.candidateJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("候选图任务不存在");
    const angle = findAngle(input.angle);
    if (job.candidates.some((item) => item.angle === angle.id && item.status === "generating")) {
      throw new Error(`${angle.label}正在生成，请完成后再追加`);
    }
    if (text(input.prompt, 8000)) job.prompt = text(input.prompt, 8000);
    const requestedImageModel = normalizeImageModel(input.imageModel || job.imageModel || DEFAULT_IMAGE_MODEL);
    job.imageModel = requestedImageModel;
    job.imageModelLabel = imageModelLabel(requestedImageModel);
    const requestedAnchor = text(input.anchorCandidateId, 160);
    const anchorCandidate = angle.id === "flat" ? null : (
      job.candidates.find((candidate) => candidate.id === requestedAnchor && candidate.angle === "flat" && candidate.status === "success")
      || [...job.candidates].reverse().find((candidate) => candidate.angle === "flat" && candidate.status === "success")
      || null
    );
    generateCandidate(job, angle.id, { anchorCandidate, imageModel: requestedImageModel }).catch(() => {});
    await save();
    return publicCandidateJob(job);
  }

  function replacementDraftHasContent(job) {
    const draft = job?.draftData || {};
    return Boolean(
      job?.referenceVideoPath
      || draft.referenceUpload?.path
      || (draft.selectedAssetIds || []).length
      || (draft.temporaryAssets || []).length
      || String(draft.taskVariables?.backgroundDescription || "").trim()
      || String(draft.lockedScript || "").trim()
    );
  }

  async function createReplacementDraft(input = {}) {
    const reusable = state.replacementJobs.find((item) => item.id === text(input.reuseDraftId, 160));
    if (reusable?.status === "draft" && input.forceNew !== true) {
      assertDraftOwner(reusable, input.ownerKey);
      if (!replacementDraftHasContent(reusable)) return publicReplacementJob(reusable);
    }
    const now = isoNow();
    const taskDateKey = candidateTaskDateKey(now);
    const taskSequence = nextReplacementTaskSequence(input.ownerKey, taskDateKey);
    const job = {
      id: identifier("replace-job"),
      workflow: "one_click_product_replacement",
      status: "draft",
      replacementMode: "product",
      productId: "",
      productName: "",
      replacementContractVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
      replacementContract: null,
      ownerKey: text(input.ownerKey, 240),
      ownerName: text(input.ownerName, 240),
      productAssetIds: [],
      firstFrameAvailableAssetIds: [],
      firstFrameAssetIds: [],
      temporaryProductAssets: [],
      imageModel: DEFAULT_IMAGE_MODEL,
      imageModelLabel: imageModelLabel(DEFAULT_IMAGE_MODEL),
      videoModelId: "",
      videoModelLabel: "",
      videoModelMinimumDuration: 4,
      videoModelMaximumDuration: 15,
      videoModelMaxReferenceImages: 9,
      referenceVideoPath: "",
      referenceVideoName: "",
      referenceVideoSize: 0,
      voiceoverMode: "old",
      lockedScript: null,
      voiceoverDecision: {
        schemaVersion: "one-click-replacement-voiceover-decision-v1",
        mode: "old",
        version: 0,
        editableUntil: "video_generation_submission",
        updatedAt: now,
        lockedAt: ""
      },
      taskVariables: normalizeReplacementTaskVariables(),
      referenceAssets: { firstFramePath: "", audioPath: "", duration: 0, hasAudio: false },
      sourceTranscript: pendingSourceTranscript(),
      voiceoverDraft: null,
      sourceAnalysis: null,
      shotPlan: null,
      firstFrameOutdated: false,
      firstFramePrompt: REPLACEMENT_FIRST_FRAME_EDIT_PROMPT,
      firstFrameCandidates: [],
      firstFrameVersionCounter: 0,
      selectedFirstFrameId: "",
      shotAnchorCandidates: [],
      validation: { productExposurePassCount: 0, productExposureRequiredCount: 0, status: "pending", checks: [] },
      voiceoverValidation: { status: "not_required", passed: true, attempts: 0 },
      taskName: defaultReplacementTaskName(taskDateKey, taskSequence),
      taskDateKey,
      taskSequence,
      taskSortOrder: nextReplacementTaskSortOrder(),
      draftData: {},
      createdAt: now,
      updatedAt: now,
      error: ""
    };
    state.replacementJobs.push(job);
    await save();
    return publicReplacementJob(job);
  }

  async function updateReplacementDraft(jobId, input = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job || job.status !== "draft") throw new Error("一键换品草稿不存在或已经开始生成");
    assertDraftOwner(job, input.ownerKey);
    const draftData = taskDraftData(input.draftData);
    job.draftData = draftData;
    job.referenceVideoPath = text(draftData.referenceUpload?.path, 1000);
    job.referenceVideoName = text(draftData.referenceUpload?.name, 240);
    job.referenceVideoSize = Number(draftData.referenceUpload?.size || 0);
    job.productId = text(draftData.productId, 120);
    job.productName = text(draftData.productName, 240);
    job.replacementContractVersion = PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION;
    job.replacementContract = productReplacementContract(job.productId);
    job.replacementMode = ["product", "voiceover", "both", "background"].includes(draftData.replacementMode) ? draftData.replacementMode : "product";
    job.generationMode = draftData.generationMode === "smart" ? "smart" : "manual";
    job.voiceoverMode = draftData.voiceoverMode === "new" ? "new" : "old";
    job.productAssetIds = normalizeReplacementAssetIds(draftData.selectedAssetIds);
    job.firstFrameAvailableAssetIds = normalizeReplacementAssetIds(draftData.firstFrameAvailableAssetIds);
    job.firstFrameAssetIds = normalizeReplacementAssetIds(draftData.firstFrameAssetIds);
    job.imageModel = normalizeImageModel(draftData.imageModel || job.imageModel || DEFAULT_IMAGE_MODEL);
    job.imageModelLabel = imageModelLabel(job.imageModel);
    job.videoModelId = text(draftData.videoModelId, 120);
    job.taskVariables = normalizeReplacementTaskVariables(draftData.taskVariables, job.productName);
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function createReplacementJob(input = {}) {
    const referenceVideoPath = path.resolve(String(input.referenceVideoPath || ""));
    if (!VIDEO_PATTERN.test(referenceVideoPath)) throw new Error("参考视频仅支持MP4或MOV");
    const stat = await fsp.stat(referenceVideoPath).catch(() => null);
    if (!stat?.isFile()) throw new Error("参考视频不存在");
    if (stat.size > MAX_REPLACEMENT_REFERENCE_VIDEO_BYTES) throw new Error("参考视频不能超过200MB");
    const replacementMode = ["product", "voiceover", "both", "background"].includes(input.replacementMode) ? input.replacementMode : "product";
    const replacesProduct = ["product", "both"].includes(replacementMode);
    const firstFrameStrategy = replacesProduct && input.firstFrameStrategy === "reference" ? "reference" : "generate";
    const generationMode = input.generationMode === "smart" ? "smart" : "manual";
    const replacesVoiceover = ["voiceover", "both"].includes(replacementMode);
    const voiceoverMode = replacesVoiceover && input.voiceoverMode !== "old" ? "new" : "old";
    const submittedVoiceoverScript = String(input.voiceoverScript || "").replace(/\r\n?/g, "\n");
    const locked = voiceoverMode === "new" && submittedVoiceoverScript.trim() ? createLockedScript(submittedVoiceoverScript, 1) : null;
    const selectedImageModel = normalizeImageModel(input.imageModel || DEFAULT_IMAGE_MODEL);
    const draftJobId = text(input.draftJobId, 160);
    const draftJob = draftJobId ? state.replacementJobs.find((item) => item.id === draftJobId) : null;
    if (draftJobId && (!draftJob || draftJob.status !== "draft")) throw new Error("一键换品草稿不存在或已经开始生成");
    if (draftJob) assertDraftOwner(draftJob, input.ownerKey);
    const jobId = draftJob?.id || identifier("replace-job");
    const productAssetIds = normalizeReplacementAssetIds(input.productAssetIds);
    if (replacesProduct && productAssetIds.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
      throw new Error(`视频上游产品参考图最多选择${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
    }
    const hasDedicatedFirstFrameAvailableAssets = Object.prototype.hasOwnProperty.call(input || {}, "firstFrameAvailableAssetIds");
    const firstFrameAvailableAssetIds = hasDedicatedFirstFrameAvailableAssets
      ? normalizeReplacementAssetIds(input.firstFrameAvailableAssetIds)
      : productAssetIds.slice();
    const hasDedicatedFirstFrameAssets = Object.prototype.hasOwnProperty.call(input || {}, "firstFrameAssetIds");
    const firstFrameAssetIds = hasDedicatedFirstFrameAssets
      ? normalizeReplacementAssetIds(input.firstFrameAssetIds)
      : [];
    const usesReferenceFirstFrameCleanup = replacesProduct
      && firstFrameStrategy === "generate"
      && hasDedicatedFirstFrameAssets
      && firstFrameAssetIds.length === 0;
    if (firstFrameAvailableAssetIds.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
      throw new Error(`首帧图素材最多同步${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
    }
    if (firstFrameAssetIds.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
      throw new Error(`首帧图素材最多选择${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
    }
    const temporaryProductAssets = [];
    if (replacesProduct) {
      const requested = Array.isArray(input.temporaryProductAssets) ? input.temporaryProductAssets : [];
      if (productAssetIds.length + requested.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
        throw new Error(`视频上游产品参考图最多选择${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
      }
      const destinationDir = path.join(outputRoot, "一键换品", jobId, "temporary-products");
      for (let index = 0; index < requested.length; index += 1) {
        const item = requested[index] || {};
        const sourcePath = path.resolve(String(item.localPath || item.path || ""));
        if (!IMAGE_PATTERN.test(sourcePath)) throw new Error(`临时产品图${index + 1}仅支持PNG或JPG`);
        const sourceStat = await fsp.stat(sourcePath).catch(() => null);
        if (!sourceStat?.isFile()) throw new Error(`临时产品图${index + 1}不存在`);
        if (sourceStat.size > MAX_IMAGE_BYTES) throw new Error(`临时产品图${index + 1}不能超过10MB`);
        await fsp.mkdir(destinationDir, { recursive: true });
        const extension = path.extname(sourcePath).toLowerCase();
        const localPath = path.join(destinationDir, `temporary-product-${String(index + 1).padStart(2, "0")}${extension}`);
        await fsp.copyFile(sourcePath, localPath);
        temporaryProductAssets.push({
          id: `temporary-product-${index + 1}`,
          name: text(item.name, 240) || path.basename(sourcePath),
          localPath,
          size: sourceStat.size,
          sha256: await sha256File(localPath),
          source: "temporary_task_upload"
        });
      }
    }
    const createdAt = draftJob?.createdAt || isoNow();
    const taskDateKey = draftJob?.taskDateKey || candidateTaskDateKey(createdAt);
    const taskSequence = draftJob?.taskSequence || nextReplacementTaskSequence(input.ownerKey, taskDateKey);
    const taskVariables = normalizeReplacementTaskVariables(input.taskVariables, replacesProduct ? input.productName : "");
    if (replacementMode === "background" && !taskVariables.backgroundDescription) {
      throw new Error("只换背景任务必须填写目标背景描述");
    }
    const jobData = {
      id: jobId,
      workflow: "one_click_product_replacement",
      status: "preparing",
      generationMode,
      replacementMode,
      firstFrameStrategy,
      productId: replacesProduct ? text(input.productId, 120) : "",
      productName: replacesProduct ? text(input.productName, 240) : "",
      replacementContractVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
      replacementContract: replacesProduct ? productReplacementContract(text(input.productId, 120)) : null,
      ownerKey: text(input.ownerKey, 240),
      ownerName: text(input.ownerName, 240),
      productAssetIds: replacesProduct ? productAssetIds.slice(0, MAX_REPLACEMENT_PRODUCT_IMAGES) : [],
      ...(hasDedicatedFirstFrameAvailableAssets ? { firstFrameAvailableAssetIds: replacesProduct ? firstFrameAvailableAssetIds.slice(0, MAX_REPLACEMENT_PRODUCT_IMAGES) : [] } : {}),
      ...(hasDedicatedFirstFrameAssets ? { firstFrameAssetIds: replacesProduct ? firstFrameAssetIds.slice(0, MAX_REPLACEMENT_PRODUCT_IMAGES) : [] } : {}),
      temporaryProductAssets,
      imageModel: selectedImageModel,
      imageModelLabel: imageModelLabel(selectedImageModel),
      videoModelId: text(input.videoModelId, 120),
      videoModelLabel: text(input.videoModelLabel, 240),
      videoModelMinimumDuration: clampNumber(input.videoModelMinimumDuration, 3, 15, 4),
      videoModelMaximumDuration: clampNumber(input.videoModelMaximumDuration, 3, 30, 15),
      videoModelMaxReferenceImages: Math.max(1, Math.floor(Number(input.videoModelMaxReferenceImages) || 9)),
      videoDuration: Number(input.videoDuration || 0),
      videoClarity: text(input.videoClarity, 40),
      videoClarityLabel: text(input.videoClarityLabel, 80),
      referenceVideoPath,
      referenceVideoName: text(input.referenceVideoName, 240) || path.basename(referenceVideoPath),
      referenceVideoSize: stat.size,
      voiceoverMode,
      lockedScript: locked,
      voiceoverDecision: {
        schemaVersion: "one-click-replacement-voiceover-decision-v1",
        mode: voiceoverMode,
        version: locked?.version || 0,
        editableUntil: "shot_plan_compilation",
        confirmed: Boolean(locked),
        updatedAt: createdAt,
        lockedAt: ""
      },
      taskVariables,
      referenceAssets: input.referenceAssets?.firstFramePath
        ? {
            firstFramePath: path.resolve(String(input.referenceAssets.firstFramePath)),
            audioPath: "",
            duration: Number(input.referenceAssets.duration || 0),
            hasAudio: Boolean(input.referenceAssets.hasAudio),
            audioExtraction: "deferred_generation_mp3",
            extractedAt: input.referenceAssets.extractedAt || input.referenceAssets.preparedAt || isoNow()
          }
        : { firstFramePath: "", audioPath: "", duration: 0, hasAudio: false },
      sourceTranscript: pendingSourceTranscript(),
      voiceoverDraft: locked ? {
        schemaVersion: "one-click-replacement-voiceover-draft-v1",
        status: "ready",
        sourceText: "",
        proposedText: locked.lockedScript,
        text: locked.lockedScript,
        charCount: countTimingChars(locked.lockedScript),
        replacements: [],
        warnings: [],
        unresolvedMentions: [],
        model: "",
        mode: "manual_input",
        version: locked.version,
        confirmed: true,
        confirmedAt: createdAt,
        updatedAt: createdAt
      } : null,
      sourceAnalysis: null,
      shotPlan: null,
      firstFrameOutdated: false,
      firstFramePrompt: replacementMode === "background"
        ? REPLACEMENT_BACKGROUND_FIRST_FRAME_PROMPT
        : usesReferenceFirstFrameCleanup
          ? REFERENCE_FIRST_FRAME_CLEANUP_PROMPT
          : REPLACEMENT_FIRST_FRAME_EDIT_PROMPT,
      firstFrameCandidates: [],
      firstFrameVersionCounter: 0,
      selectedFirstFrameId: "",
      shotAnchorCandidates: [],
      validation: { productExposurePassCount: 0, productExposureRequiredCount: 0, status: "pending", checks: [] },
      voiceoverValidation: voiceoverMode === "new" ? { status: "pending_generation", passed: false, attempts: 0 } : { status: "not_required", passed: true, attempts: 0 },
      taskName: draftJob?.taskName || defaultReplacementTaskName(taskDateKey, taskSequence),
      taskDateKey,
      taskSequence,
      taskSortOrder: draftJob?.taskSortOrder || nextReplacementTaskSortOrder(),
      draftData: null,
      createdAt,
      updatedAt: isoNow(),
      error: ""
    };
    const job = draftJob ? Object.assign(draftJob, jobData) : jobData;
    if (replacesProduct && !job.productAssetIds.length && !job.temporaryProductAssets.length) {
      throw new Error("换产品任务至少需要一张视频上游产品参考图");
    }
    if (replacesProduct && firstFrameStrategy !== "reference" && (hasDedicatedFirstFrameAvailableAssets || hasDedicatedFirstFrameAssets)) {
      resolveReplacementFirstFrameAssets(job, null, { allowEmpty: usesReferenceFirstFrameCleanup });
    }
    if (!draftJob) state.replacementJobs.push(job);
    await save();
    (async () => {
      try {
        if (!extractReferenceMedia) throw new Error("参考视频解析组件尚未接入");
        if (!job.referenceAssets.firstFramePath || !fs.existsSync(job.referenceAssets.firstFramePath)) {
          const dir = path.join(outputRoot, "一键换品", job.id, "reference");
          job.referenceAssets = await extractReferenceMedia(referenceVideoPath, dir, { extractAudio: false });
          job.referenceAssets.audioPath = "";
          job.referenceAssets.audioExtraction = "deferred_generation_mp3";
        }
        const duration = Number(job.referenceAssets.duration || 0);
        if (duration < 1 || duration > 30) throw new Error(`参考视频时长需为1-30秒，当前${duration.toFixed(1)}秒`);
        if (!job.referenceAssets.firstFramePath) throw new Error("未能提取参考视频首帧");
        if (["voiceover", "both"].includes(job.replacementMode) && !job.referenceAssets.hasAudio) {
          throw new Error(voiceoverMode === "new" ? "参考视频没有可用音轨，无法提取音色参考" : "参考视频没有可用音轨，无法沿用旧口播");
        }
        job.status = "analyzing_video";
        job.updatedAt = isoNow();
        await save();
        const analysisPromise = analyzeReplacementVideo
          ? analyzeReplacementVideo({
              jobId: job.id,
              referenceVideoPath,
              referenceVideoName: job.referenceVideoName,
              duration,
              productId: job.productId,
              productName: job.productName,
              replacementMode: job.replacementMode,
              targetProductSize: replacementProductSizeText(job),
              productQuantityRule: job.taskVariables?.productQuantityRule
            })
          : Promise.resolve({
              analysis: { summary: "兼容模式：按完整参考视频生成", originalShotCount: 1, sourceShots: [] },
              keyframes: [{ id: "keyframe-01", time: 0.1, localPath: job.referenceAssets.firstFramePath, label: "参考视频首帧" }],
              provider: "compatibility_fallback",
              inputMode: "legacy"
            });
        const [analyzed] = await Promise.all([
          analysisPromise,
          prepareReplacementTranscript(job)
        ]);
        job.sourceAnalysis = normalizeReplacementSourceAnalysis(analyzed?.analysis, {
          duration,
          keyframes: analyzed?.keyframes,
          provider: analyzed?.provider || "Qwen 3.7 Plus",
          inputMode: analyzed?.inputMode || "video_url",
          analyzedAt: analyzed?.analyzedAt || isoNow()
        });
        if (["voiceover", "both"].includes(job.replacementMode) && job.voiceoverMode === "new" && !job.lockedScript) {
          await prepareReplacementVoiceoverDraft(job);
          job.shotPlan = null;
        } else {
          job.shotPlan = createShotPlanForReplacementJob(job);
        }
        job.validation = {
          productExposurePassCount: 0,
          productExposureRequiredCount: job.shotPlan?.productVisibleShotCount || 0,
          status: "pending",
          checks: []
        };
        job.status = job.shotPlan
          ? (job.shotPlan.confirmed ? "awaiting_first_frame" : "awaiting_shot_plan_confirmation")
          : "awaiting_voiceover_confirmation";
        job.updatedAt = isoNow();
        await save();
        if (job.firstFrameStrategy === "reference" && ["product", "both"].includes(job.replacementMode)) {
          await useReplacementReferenceFirstFrame(job.id, { confirmedBy: "task_creation" });
        } else if (["product", "both", "background"].includes(job.replacementMode)) {
          await generateReplacementFirstFrame(job.id);
        } else {
          job.status = job.shotPlan ? "ready_to_generate" : "awaiting_voiceover_confirmation";
          await save();
        }
      } catch (error) {
        job.status = "failed";
        job.error = error.message;
        job.updatedAt = isoNow();
        await save();
      }
    })().catch(() => {});
    return publicReplacementJob(job);
  }

  function replacementPostFirstFrameStatus(job) {
    if (["voiceover", "both"].includes(job.replacementMode) && job.voiceoverMode === "new" && job.voiceoverDraft?.confirmed !== true) {
      return "awaiting_voiceover_confirmation";
    }
    return "ready_to_generate";
  }

  function ensureReplacementVoiceoverAsrMetadata() {
    let changed = false;
    for (const job of state.replacementJobs) {
      if (!job.sourceTranscript) {
        job.sourceTranscript = pendingSourceTranscript();
        changed = true;
      }
      if (job.voiceoverMode === "new" && job.lockedScript && !job.voiceoverDraft) {
        const lockedText = String(job.lockedScript.lockedScript || "");
        job.voiceoverDraft = {
          schemaVersion: "one-click-replacement-voiceover-draft-v1",
          status: "confirmed",
          sourceText: "",
          proposedText: lockedText,
          text: lockedText,
          charCount: countTimingChars(lockedText),
          replacements: [],
          warnings: ["该任务创建于ASR口播升级前，原片口播可按需重新识别。"],
          unresolvedMentions: [],
          model: "",
          mode: "legacy_locked_script",
          version: Math.max(1, Number(job.lockedScript.version || 1)),
          confirmed: true,
          confirmedAt: job.voiceoverDecision?.updatedAt || job.updatedAt || job.createdAt || isoNow(),
          updatedAt: job.voiceoverDecision?.updatedAt || job.updatedAt || isoNow()
        };
        job.voiceoverDecision = { ...(job.voiceoverDecision || {}), confirmed: true };
        changed = true;
      }
    }
    return changed;
  }

  function adoptReplacementFirstFrame(job, candidate, adoptedBy = "manual") {
    if (!candidate || candidate.status !== "success" || !candidate.localPath) {
      throw new Error("只能采用生成成功的新首帧候选");
    }
    const previousSelected = selectedReplacementInitialStateCandidate(job);
    if (!previousSelected || previousSelected.id !== candidate.id || previousSelected.sha256 !== candidate.sha256) {
      invalidateReplacementAnchorsForInitialState(job, candidate);
    }
    const adoptedAt = isoNow();
    job.selectedFirstFrameId = candidate.id;
    job.firstFrameStrategy = candidate.source === "reference_frame" ? "reference" : "generate";
    job.firstFrameOutdated = false;
    job.firstFrameSelection = {
      policy: adoptedBy === "manual" ? "manual_override" : "latest_successful_candidate",
      candidateId: candidate.id,
      candidateSha256: candidate.sha256 || "",
      adoptedBy,
      adoptedAt
    };
    candidate.adoption = { status: "selected", adoptedBy, adoptedAt };
    job.status = job.firstFrameCandidates.some((item) => item.status === "generating") ? "generating_first_frame" : replacementPostFirstFrameStatus(job);
    job.updatedAt = adoptedAt;
    return candidate;
  }

  async function completeReplacementFirstFrame(job, candidate, generated) {
    const deadline = ensureGenerationTime(candidate);
    candidate.taskId = String(generated.taskId || candidate.taskId || "");
    candidate.remoteUrl = String(generated.url || "");
    await updateGenerationStage(job, candidate, "downloading", "succeeded");
    const dir = path.join(outputRoot, "一键换品", job.id, "first-frame-candidates");
    const destination = path.join(dir, `first-frame-v${candidate.version}.png`);
    await gptImageClient.downloadFile(generated.url, destination, { deadlineAt: deadline });
    ensureGenerationTime(candidate);
    const [generatedSha256, referenceSha256] = await Promise.all([
      sha256File(destination),
      sha256File(candidate.sourceFramePath || job.referenceAssets.firstFramePath)
    ]);
    if (generatedSha256 === referenceSha256) {
      await fsp.rm(destination, { force: true }).catch(() => {});
      candidate.remoteUrl = "";
      throw new Error(`生成结果与参考视频首帧完全相同，未完成${job.replacementMode === "background" ? "背景" : "产品"}替换，请点击“+ 新首帧”重试。`);
    }
    const duplicate = (job.firstFrameCandidates || []).find((item) => (
      item.id !== candidate.id
      && item.status === "success"
      && String(item.sha256 || "") === generatedSha256
    ));
    if (duplicate) {
      await fsp.rm(destination, { force: true }).catch(() => {});
      candidate.remoteUrl = "";
      throw new Error(`生成结果与${duplicate.label || "已有新首帧"}完全相同，已自动剔除；请点击“+ 新首帧”再试。`);
    }
    candidate.status = "success";
    candidate.stage = "succeeded";
    candidate.stageLabel = IMAGE_GENERATION_STAGE_LABELS.succeeded;
    candidate.localPath = destination;
    candidate.sha256 = generatedSha256;
    candidate.size = (await fsp.stat(destination)).size;
    candidate.completedAt = isoNow();
    candidate.updatedAt = isoNow();
    adoptReplacementFirstFrame(job, candidate, "generation_completed");
    await save();
  }

  async function resumeReplacementFirstFrame(jobId, candidateId) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    const candidate = job?.firstFrameCandidates?.find((item) => item.id === String(candidateId || ""));
    if (!job || !candidate || candidate.status !== "generating") return null;
    try {
      const deadline = ensureGenerationTime(candidate);
      await updateGenerationStage(job, candidate, "recovering", candidate.remoteStatus || "running");
      const generated = await gptImageClient.waitForTask(candidate.taskId, {
        model: candidate.imageModel || job.imageModel || DEFAULT_IMAGE_MODEL,
        deadlineAt: deadline,
        onStatus: async ({ status }) => {
          await updateGenerationStage(job, candidate, stageForRemoteStatus(status), status);
        }
      });
      await completeReplacementFirstFrame(job, candidate, generated);
    } catch (error) {
      failReplacementCandidate(job, candidate, error);
      await save();
    }
    return publicReplacementJob(job);
  }

  async function generateReplacementFirstFrame(jobId, input = {}, options = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (!job.referenceAssets?.firstFramePath) throw new Error("参考视频首帧尚未提取完成");
    if (job.firstFrameCandidates.some((item) => item.status === "generating")) throw new Error("首帧候选正在生成");
    const videoSubmitted = Boolean(job.generatedJobId) || job.status === "generation_started";
    if (videoSubmitted && options.allowAfterFailedGeneration !== true) {
      throw new Error("视频任务已经提交，不能再生成新首帧");
    }
    const switchingFromReference = job.firstFrameStrategy === "reference"
      || job.firstFrameCandidates.some((item) => item.id === job.selectedFirstFrameId && item.source === "reference_frame");
    job.firstFrameStrategy = "generate";
    if (switchingFromReference) {
      job.selectedFirstFrameId = "";
      job.referenceFirstFrameReview = null;
    }
    const replacesProduct = ["product", "both"].includes(job.replacementMode);
    if (Object.prototype.hasOwnProperty.call(input || {}, "productAssetIds") && replacesProduct) {
      const productAssetIds = normalizeReplacementAssetIds(input.productAssetIds);
      if (!productAssetIds.length) throw new Error("换产品任务至少需要一张视频上游产品参考图");
      if (productAssetIds.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
        throw new Error(`视频上游产品参考图最多选择${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
      }
      job.productAssetIds = productAssetIds;
    }
    let firstFrameAssetsChanged = false;
    if (Object.prototype.hasOwnProperty.call(input || {}, "firstFrameAvailableAssetIds")) {
      const firstFrameAvailableAssetIds = normalizeReplacementAssetIds(input.firstFrameAvailableAssetIds);
      if (firstFrameAvailableAssetIds.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
        throw new Error(`首帧图素材最多同步${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
      }
      job.firstFrameAvailableAssetIds = firstFrameAvailableAssetIds;
      firstFrameAssetsChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, "firstFrameAssetIds")) {
      const firstFrameAssetIds = normalizeReplacementAssetIds(input.firstFrameAssetIds);
      if (firstFrameAssetIds.length > MAX_REPLACEMENT_PRODUCT_IMAGES) {
        throw new Error(`首帧图素材最多选择${MAX_REPLACEMENT_PRODUCT_IMAGES}张`);
      }
      job.firstFrameAssetIds = firstFrameAssetIds;
      firstFrameAssetsChanged = true;
    }
    if (firstFrameAssetsChanged && replacesProduct) resolveReplacementFirstFrameAssets(job, null, { allowEmpty: true });
    const hasCustomPrompt = Object.prototype.hasOwnProperty.call(input || {}, "prompt");
    const storedFirstFramePrompt = text(job.firstFramePrompt, 8000);
    const migratedDefaultPrompt = job.replacementMode !== "background" && storedFirstFramePrompt === LEGACY_REPLACEMENT_FIRST_FRAME_EDIT_PROMPT
      ? REPLACEMENT_FIRST_FRAME_EDIT_PROMPT
      : storedFirstFramePrompt;
    const requestedPrompt = hasCustomPrompt
      ? text(input.prompt, 8000)
      : migratedDefaultPrompt || (job.replacementMode === "background" ? REPLACEMENT_BACKGROUND_FIRST_FRAME_PROMPT : REPLACEMENT_FIRST_FRAME_EDIT_PROMPT);
    if (!requestedPrompt) throw new Error("图片生成提示词不能为空");
    const firstUnit = job.shotPlan?.units?.find((unit) => unit.included !== false) || job.sourceAnalysis || {};
    const firstFrameProductAssets = replacesProduct ? resolveReplacementFirstFrameAssets(job, firstUnit, { allowEmpty: true }) : [];
    const usesReferenceFirstFrameCleanup = replacesProduct && firstFrameProductAssets.length === 0;
    const effectivePrompt = job.replacementMode === "background"
      ? replacementBackgroundPrompt(requestedPrompt, job.taskVariables?.backgroundDescription)
      : usesReferenceFirstFrameCleanup
        ? REFERENCE_FIRST_FRAME_CLEANUP_PROMPT
      : [
          compileReplacementFirstFramePrompt(requestedPrompt, job, firstUnit, firstFrameProductAssets),
          replacementProductTruthPrompt(job, firstUnit, firstFrameProductAssets)
        ].filter(Boolean).join("\n\n");
    job.firstFramePrompt = usesReferenceFirstFrameCleanup ? REFERENCE_FIRST_FRAME_CLEANUP_PROMPT : requestedPrompt;
    const selectedImageModel = normalizeImageModel(input.imageModel || job.imageModel || DEFAULT_IMAGE_MODEL);
    job.imageModel = selectedImageModel;
    job.imageModelLabel = imageModelLabel(selectedImageModel);
    const previousVersion = Math.max(
      Number(job.firstFrameVersionCounter || 0),
      ...job.firstFrameCandidates.map((item) => Number(item.version || 0))
    );
    const selectedImageModelLabel = imageModelLabel(selectedImageModel);
    const batchCreatedAt = Date.now();
    const candidates = Array.from({ length: REPLACEMENT_FIRST_FRAME_BATCH_SIZE }, (_item, index) => {
      const version = previousVersion + index + 1;
      return {
        id: identifier("first-frame"),
        angle: "reference",
        angleLabel: "新首帧",
        version,
        label: `新首帧 V${version}`,
        status: "generating",
        stage: "preparing_inputs",
        stageLabel: IMAGE_GENERATION_STAGE_LABELS.preparing_inputs,
        imageModel: selectedImageModel,
        imageModelLabel: selectedImageModelLabel,
        source: "platform_generated",
        editMode: usesReferenceFirstFrameCleanup ? "reference_first_frame_cleanup" : "product_replacement",
        assetRole: "initial_state_anchor",
        targetTime: 0,
        productAssetIds: replacesProduct ? [...job.productAssetIds] : [],
        firstFrameAssetIds: replacesProduct ? [...(job.firstFrameAssetIds || [])] : [],
        prompt: effectivePrompt,
        sourceKeyframeId: "",
        sourceKeyframeTime: 0,
        sourceFramePath: job.referenceAssets.firstFramePath,
        inputAssetManifest: {
          schemaVersion: "one-click-replacement-first-frame-input-v2",
          assets: [{
            inputIndex: 1,
            assetId: "reference-first-frame",
            role: "source_edit_base",
            authority: "person_scene_composition_contact_occlusion"
          }]
        },
        batchSize: REPLACEMENT_FIRST_FRAME_BATCH_SIZE,
        batchIndex: index + 1,
        createdAt: new Date(batchCreatedAt).toISOString(),
        generationStartedAt: "",
        generationDeadlineAt: "",
        updatedAt: new Date(batchCreatedAt).toISOString(),
        completedAt: "",
        localPath: "",
        remoteUrl: "",
        taskId: "",
        remoteStatus: "",
        error: ""
      };
    });
    job.firstFrameVersionCounter = previousVersion + REPLACEMENT_FIRST_FRAME_BATCH_SIZE;
    job.firstFrameCandidates.push(...candidates);
    job.status = "generating_first_frame";
    job.updatedAt = isoNow();
    await save();
    const runGeneration = async (candidate) => {
      try {
        if (!gptImageClient) throw new Error(`${selectedImageModelLabel} 尚未接入`);
        const generationStartedAt = Date.now();
        candidate.generationStartedAt = new Date(generationStartedAt).toISOString();
        candidate.generationDeadlineAt = new Date(generationStartedAt + imageGenerationTimeoutMs).toISOString();
        candidate.updatedAt = candidate.generationStartedAt;
        await save();
        const deadline = ensureGenerationTime(candidate);
        const productAssets = firstFrameProductAssets;
        if (1 + productAssets.length > MAX_IMAGE_GENERATION_INPUTS) {
          throw new Error(`新首帧输入共${1 + productAssets.length}张，超过模型最多${MAX_IMAGE_GENERATION_INPUTS}张图片；请减少新首帧图产品素材`);
        }
        candidate.firstFrameAssetIds = productAssets.map((asset) => asset.id).filter(Boolean);
        candidate.inputAssetManifest.assets.push(...productAssets.map((asset, assetIndex) => ({
          inputIndex: assetIndex + 2,
          assetId: asset.id || `product-reference-${assetIndex + 1}`,
          role: "product_identity_truth",
          authority: "product_geometry_material_color_logo_label"
        })));
        const credential = await gptImageClient.acquireToken({ deadlineAt: deadline });
        ensureGenerationTime(candidate);
        await updateGenerationStage(job, candidate, "uploading_reference");
        const sourceFramePath = job.referenceAssets.firstFramePath;
        candidate.sourceFramePath = sourceFramePath;
        const inputUrls = [await gptImageClient.upload(sourceFramePath, credential.token, { deadlineAt: deadline })];
        if (productAssets.length) {
          await updateGenerationStage(job, candidate, "uploading_products");
          for (const asset of productAssets) {
            ensureGenerationTime(candidate);
            inputUrls.push(asset.storageUrl || await gptImageClient.upload(asset.localPath, credential.token, { deadlineAt: deadline }));
          }
        }
        await updateGenerationStage(job, candidate, "creating_task");
        const generated = await gptImageClient.generate({
          model: selectedImageModel,
          prompt: candidate.prompt,
          inputUrls,
          aspectRatio: "9:16",
          resolution: "1K",
          deadlineAt: deadline,
          onTaskCreated: async ({ taskId: createdTaskId, status }) => {
            candidate.taskId = String(createdTaskId || "");
            await updateGenerationStage(job, candidate, stageForRemoteStatus(status), status || "queued");
          },
          onStatus: async ({ status }) => {
            await updateGenerationStage(job, candidate, stageForRemoteStatus(status), status);
          }
        });
        candidate.taskId = String(generated.taskId || candidate.taskId || "");
        await completeReplacementFirstFrame(job, candidate, generated);
      } catch (error) {
        failReplacementCandidate(job, candidate, error);
        await save();
      }
    };
    const runBatch = async () => {
      for (const candidate of candidates) await runGeneration(candidate);
    };
    if (options.returnImmediately === true) {
      void runBatch().catch(() => {});
      return publicReplacementJob(job);
    }
    await runBatch();
    return publicReplacementJob(job);
  }

  async function uploadReplacementFirstFrame(jobId, input = {}, options = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (job.status === "draft") throw new Error("请先创建任务，再上传自定义新首帧");
    if ((job.generatedJobId || job.status === "generation_started") && options.allowAfterFailedGeneration !== true) {
      throw new Error("视频任务已经提交，不能再上传新首帧");
    }
    const sourcePath = path.resolve(String(input.path || input.localPath || ""));
    if (!IMAGE_PATTERN.test(sourcePath)) throw new Error("自定义新首帧仅支持PNG或JPG");
    const sourceStat = await fsp.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) throw new Error("自定义新首帧文件不存在");
    if (sourceStat.size > MAX_IMAGE_BYTES) throw new Error("自定义新首帧不能超过10MB");
    const customCount = (job.firstFrameCandidates || []).filter((item) => item.source === "custom_upload").length + 1;
    const id = identifier("first-frame-custom");
    const destinationDir = path.join(outputRoot, "一键换品", job.id, "first-frame-candidates");
    await fsp.mkdir(destinationDir, { recursive: true });
    const extension = path.extname(sourcePath).toLowerCase();
    const localPath = path.join(destinationDir, `${id}${extension}`);
    await fsp.copyFile(sourcePath, localPath);
    const now = isoNow();
    const candidate = {
      id,
      angle: "reference",
      angleLabel: "自定义新首帧",
      version: customCount,
      label: `自定义首帧 U${customCount}`,
      source: "custom_upload",
      sourceName: text(input.name, 240) || path.basename(sourcePath),
      status: "success",
      stage: "succeeded",
      stageLabel: IMAGE_GENERATION_STAGE_LABELS.succeeded,
      imageModel: "custom-upload",
      imageModelLabel: "自定义上传",
      assetRole: "initial_state_anchor",
      targetTime: 0,
      prompt: "",
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      localPath,
      sha256: await sha256File(localPath),
      size: sourceStat.size,
      remoteUrl: "",
      taskId: "",
      error: ""
    };
    job.firstFrameCandidates.push(candidate);
    adoptReplacementFirstFrame(job, candidate, "custom_upload_completed");
    await save();
    return publicReplacementJob(job);
  }

  function replacementShotAnchorContinuityPrompt(unit = {}, frame = {}) {
    const selection = unit.anchorSelection;
    if (!selection || selection.policy !== "minimum_sufficient_physical_states_v1") return "";
    const state = (selection.candidates || []).find((item) => item.frameId === frame.id)
      || (selection.stateAnchors || []).find((item) => item.frameId === frame.id);
    const canonical = frame.id === selection.canonicalSourceKeyframeId;
    const stateLabel = state?.stateLabel || REPLACEMENT_PHYSICAL_STATE_LABELS[state?.revealState] || REPLACEMENT_PHYSICAL_STATE_LABELS[state?.transitionType] || "关键状态";
    const mutationAllowed = state?.inventoryMutation === true || ["remove_item", "insert_item", "rearrange"].includes(state?.transitionType);
    const transitionContract = buildReplacementTransitionContract(state || {});
    const inventoryEvidence = selection.inventoryEvidence || {};
    const inventorySnapshot = [
      Number.isInteger(inventoryEvidence.visibleTotalCount) ? `可见总数=${inventoryEvidence.visibleTotalCount}` : "",
      Number.isInteger(inventoryEvidence.rows) ? `行=${inventoryEvidence.rows}` : "",
      Number.isInteger(inventoryEvidence.columns) ? `列=${inventoryEvidence.columns}` : "",
      Number.isInteger(inventoryEvidence.layers) ? `层=${inventoryEvidence.layers}` : "",
      inventoryEvidence.layout ? `排列=${inventoryEvidence.layout}` : "",
      inventoryEvidence.orientation ? `朝向=${inventoryEvidence.orientation}` : "",
      inventoryEvidence.spacing ? `间距=${inventoryEvidence.spacing}` : ""
    ].filter(Boolean).join("；");
    return [
      `【同组开箱连续性】组=${selection.continuityGroupId}；当前状态=${stateLabel}；转换=${state?.transitionType || "unknown"}。`,
      canonical
        ? `本图是全开箱库存基准：一次确定箱内目标产品的数量、排数、层数、顺序、朝向、间距和包装层级，后续同组关键帧必须继承。${inventorySnapshot ? `原片库存证据：${inventorySnapshot}。` : "不得凭局部露出猜测隐藏库存。"}`
        : `本图必须继承同组全开箱基准（原片关键帧${selection.canonicalSourceKeyframeId || "未确认"}）的产品数量、排数、层数、顺序、朝向、间距和包装层级。`,
      mutationAllowed
        ? "原片此阶段明确发生取出、放入或重新排列，只允许按原片动作造成的实际变化更新库存状态。"
        : "原片此阶段没有库存变更：只能改变箱盖角度、手部动作和遮挡范围，不得新增、减少、复制、换排或重排产品。",
      `【字段变化契约】只允许变化：${transitionContract.allowedChanges.join("、")}；必须继承：${transitionContract.mustInherit.join("、")}。`,
      "产品在被遮挡处仍须按同一空间位置连续存在；不得为了适应当前可见区域而重新设计箱内布局。"
    ].join("\n");
  }

  function replacementInitialStateContinuityPrompt(job = {}) {
    const candidate = selectedReplacementInitialStateCandidate(job);
    if (!candidate || candidate.source === "reference_frame") return "";
    return [
      `【新视频0秒起始状态连续性】图2是用户已选用的新首帧（候选=${candidate.id}），不是产品白底真值图。`,
      "后续ShotPlan关键帧必须继承图2已经确定的目标产品数量、尺寸模板、摆放方向、堆叠/散落布局、人物接触点、遮挡和空间关系。",
      "只有原片动作明确发生拿取、放下、打开、取出或重排时，才允许按动作因果改变状态；产品身份、结构、Logo和标签仍以随后输入的目标产品参考图为最高真值。"
    ].join("\n");
  }

  function replacementCanonicalAnchorCandidate(job = {}, unit = {}, frame = {}) {
    const selection = unit.anchorSelection;
    const canonicalFrameId = selection?.canonicalSourceKeyframeId || "";
    if (!canonicalFrameId || canonicalFrameId === frame.id) return null;
    const groupId = unit.physicalContinuityGroupId || selection?.continuityGroupId || "";
    const groupUnitIds = (job.shotPlan?.units || [])
      .filter((candidateUnit) => groupId && (candidateUnit.physicalContinuityGroupId || candidateUnit.anchorSelection?.continuityGroupId) === groupId)
      .map((candidateUnit) => candidateUnit.id);
    const selectedIds = new Set((job.shotPlan?.units || [])
      .filter((candidateUnit) => !groupUnitIds.length || groupUnitIds.includes(candidateUnit.id))
      .flatMap((candidateUnit) => candidateUnit.selectedAnchorCandidateIds || []));
    return [...(job.shotAnchorCandidates || [])]
      .filter((candidate) => (
        candidate.status === "success"
        && candidate.localPath
        && candidate.sourceKeyframeId === canonicalFrameId
        && (!groupUnitIds.length || groupUnitIds.includes(candidate.shotPlanUnitId))
        && (candidate.anchorDependencySchemaVersion !== REPLACEMENT_ANCHOR_DEPENDENCY_SCHEMA_VERSION || candidate.canonicalInventoryQa?.status === "passed")
      ))
      .sort((left, right) => Number(selectedIds.has(right.id)) - Number(selectedIds.has(left.id)) || Number(right.version || 0) - Number(left.version || 0))[0] || null;
  }

  function invalidateReplacementAnchorDependents(job = {}, rootCandidates = [], reason = "连续性母版已变化") {
    const invalidatedIds = new Set();
    const invalidatedAssets = new Set(rootCandidates.flatMap((candidate) => [candidate?.id, candidate?.sha256]).filter(Boolean));
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of job.shotAnchorCandidates || []) {
        if (candidate.status !== "success" || invalidatedIds.has(candidate.id)) continue;
        const dependsOnInvalidatedAsset = (candidate.anchorDependencies || []).some((dependency) => (
          ["canonical_inventory_anchor", "upstream_state_anchor"].includes(dependency.role)
          && (invalidatedAssets.has(dependency.assetId) || invalidatedAssets.has(dependency.sha256))
        ));
        if (!dependsOnInvalidatedAsset) continue;
        candidate.status = "stale";
        candidate.stage = "stale";
        candidate.stageLabel = "连续性母版已变化";
        candidate.invalidatedAt = isoNow();
        candidate.invalidationReason = reason;
        candidate.updatedAt = isoNow();
        invalidatedIds.add(candidate.id);
        invalidatedAssets.add(candidate.id);
        if (candidate.sha256) invalidatedAssets.add(candidate.sha256);
        changed = true;
      }
    }
    if (invalidatedIds.size) {
      for (const planUnit of job.shotPlan?.units || []) {
        planUnit.selectedAnchorCandidateIds = (planUnit.selectedAnchorCandidateIds || []).filter((id) => !invalidatedIds.has(id));
      }
      job.anchorDependencyRevision = Number(job.anchorDependencyRevision || 0) + 1;
      job.anchorDependencyInvalidation = {
        rootCandidateIds: rootCandidates.map((candidate) => candidate.id).filter(Boolean),
        invalidatedCandidateIds: [...invalidatedIds],
        reason,
        changedAt: isoNow()
      };
    }
    return invalidatedIds;
  }

  function replacementShotAnchorPrompt(job, unit, frame, customPrompt = "", targetAssets = []) {
    if (job.replacementMode === "background") {
      const timeline = (unit.timeline || []).filter((item) => item.sourceKeyframeId === frame.id || Math.abs(Number(item.criticalTime || 0) - Number(frame.time || 0)) < 0.5);
      const stateDescription = timeline.map((item) => item.action).filter(Boolean).join("；") || frame.description || unit.action || "保持原片当前动作状态";
      const basePrompt = customPrompt ? text(customPrompt, 8000) : [
        "这是一键换背景ShotPlan的分镜锚点编辑任务，不是重新设计人物、产品或动作。",
        `以输入的原片语义关键帧（原片${Number(frame.time || 0).toFixed(2)}秒）为人物身份、产品身份、产品数量、包装、文字、LOGO、动作状态、手部位置、机位和构图基准。`,
        `当前动作状态：${stateDescription}。必须保持人物、产品、遮挡层级、动作阶段和镜头状态不变。`,
        "只替换背景环境，并让新背景的透视、景深、光线、阴影和反射与前景自然融合；禁止字幕、标题、促销文字、水印、边框、拼贴和无来源特效。"
      ].join("\n");
      return replacementBackgroundPrompt(basePrompt, job.taskVariables?.backgroundDescription);
    }
    const hardLockPrompt = replacementProductTruthPrompt(job, unit, targetAssets);
    const continuityPrompt = replacementShotAnchorContinuityPrompt(unit, frame);
    const initialStatePrompt = replacementInitialStateContinuityPrompt(job);
    const timeline = (unit.timeline || []).filter((item) => item.sourceKeyframeId === frame.id || Math.abs(Number(item.criticalTime || 0) - Number(frame.time || 0)) < 0.5);
    const stateDescription = timeline.map((item) => item.action).filter(Boolean).join("；") || frame.description || unit.action || "保持原片当前动作状态";
    const transitionContract = buildReplacementTransitionContract({
      ...((unit.anchorSelection?.candidates || []).find((item) => item.frameId === frame.id) || {}),
      evidence: stateDescription
    });
    const fieldContractPrompt = continuityPrompt ? "" : `【字段变化契约】动作类型=${transitionContract.type}；只允许变化：${transitionContract.allowedChanges.join("、")}；必须继承：${transitionContract.mustInherit.join("、")}。`;
    if (customPrompt) return [text(customPrompt, 8000), initialStatePrompt, continuityPrompt, fieldContractPrompt, hardLockPrompt].filter(Boolean).join("\n\n");
    return [[
      "这是一键换品ShotPlan的分镜锚点编辑任务，不是重新设计广告画面。",
      `以输入的原片语义关键帧（原片${Number(frame.time || 0).toFixed(2)}秒）为构图、人物身份、服装、姿态、手部位置、机位、背景、光线和动作状态基准。`,
      `把画面中的原产品完整替换为目标产品“${job.productName || job.productId || "当前目标产品"}”；目标产品外观、包装结构、颜色、比例、品牌位置、标签区域和内容物只服从同时输入的产品参考图。`,
      `当前动作状态：${stateDescription}。必须保持手与产品的接触位置、遮挡层级、受力方向和动作阶段一致，只改变产品身份；不得把动作退回起点或提前到结束状态。`,
      `本锚点属于原片${Number(unit.sourceStart || 0).toFixed(1)}-${Number(unit.sourceEnd || 0).toFixed(1)}秒分镜，角色=${frame.role || "action"}。`,
      "保持9:16竖屏真实拍摄质感。禁止新增人物、手指、产品、字幕、标题、促销文字、水印、边框、拼贴或无来源特效；禁止旧产品残留、包装变形、LOGO漂移、手部穿模和液体逆物理。"
    ].join("\n"), initialStatePrompt, continuityPrompt, fieldContractPrompt, hardLockPrompt].filter(Boolean).join("\n\n");
  }

  async function completeReplacementShotAnchor(job, candidate, generated) {
    const deadline = ensureGenerationTime(candidate);
    candidate.taskId = String(generated.taskId || candidate.taskId || "");
    candidate.remoteUrl = String(generated.url || "");
    await updateGenerationStage(job, candidate, "downloading", "succeeded");
    const dir = path.join(outputRoot, "一键换品", job.id, "shot-anchor-candidates", candidate.shotPlanUnitId);
    await fsp.mkdir(dir, { recursive: true });
    const destination = path.join(dir, `${candidate.sourceKeyframeId}-${candidate.id}.png`);
    await gptImageClient.downloadFile(generated.url, destination, { deadlineAt: deadline });
    ensureGenerationTime(candidate);
    const [generatedSha256, sourceSha256] = await Promise.all([sha256File(destination), sha256File(candidate.sourceFramePath)]);
    if (generatedSha256 === sourceSha256) {
      await fsp.rm(destination, { force: true }).catch(() => {});
      candidate.remoteUrl = "";
      throw new Error(`生成结果与原片关键帧完全相同，未完成${job.replacementMode === "background" ? "背景" : "产品"}替换`);
    }
    const dependencyChecks = [
      {
        code: "SOURCE_SEMANTIC_FRAME_BOUND",
        passed: (candidate.anchorDependencies || []).some((dependency) => dependency.role === "source_semantic_keyframe" && dependency.assetId === candidate.sourceKeyframeId && Boolean(dependency.sha256))
      },
      {
        code: "INITIAL_STATE_SNAPSHOT_BOUND",
        passed: !candidate.initialStateDependency || (candidate.anchorDependencies || []).some((dependency) => (
          dependency.role === "initial_state_continuity_reference"
          && dependency.assetId === candidate.initialStateDependency.candidateId
          && (!candidate.initialStateDependency.sha256 || dependency.sha256 === candidate.initialStateDependency.sha256)
        ))
      },
      {
        code: "PRODUCT_TRUTH_BOUND",
        passed: !["product", "both"].includes(job.replacementMode) || (candidate.anchorDependencies || []).some((dependency) => dependency.role === "product_identity_truth" && Boolean(dependency.assetId) && Boolean(dependency.sha256))
      }
    ];
    if (candidate.canonicalInventoryAnchor) {
      dependencyChecks.push({ code: "FULL_REVEAL_STATE_BOUND", passed: candidate.physicalState === "full_reveal" });
      const failedCheck = dependencyChecks.find((check) => !check.passed);
      candidate.canonicalInventoryQa = {
        schemaVersion: REPLACEMENT_CANONICAL_INVENTORY_QA_SCHEMA_VERSION,
        status: failedCheck ? "failed" : "passed",
        checks: dependencyChecks,
        checkedAt: isoNow()
      };
      if (failedCheck) {
        await fsp.rm(destination, { force: true }).catch(() => {});
        candidate.remoteUrl = "";
        const error = new Error(`全开库存母版结构校验失败：${failedCheck.code}`);
        error.code = "CANONICAL_INVENTORY_AUTO_QA_FAILED";
        throw error;
      }
      const previousCanonicalCandidates = (job.shotAnchorCandidates || []).filter((item) => (
        item.id !== candidate.id
        && item.status === "success"
        && item.canonicalInventoryAnchor === true
        && item.physicalContinuityGroupId === candidate.physicalContinuityGroupId
      ));
      invalidateReplacementAnchorDependents(job, previousCanonicalCandidates, "全开库存母版已重新生成，后续状态关键帧需要按新母版自动重构");
      candidate.adoption = {
        status: "auto_adopted",
        adoptedBy: "shotplan_compiler",
        ruleVersion: "canonical-inventory-auto-adoption-v1",
        adoptedAt: isoNow()
      };
    }
    candidate.status = "success";
    candidate.stage = "succeeded";
    candidate.stageLabel = IMAGE_GENERATION_STAGE_LABELS.succeeded;
    candidate.localPath = destination;
    candidate.sha256 = generatedSha256;
    candidate.size = (await fsp.stat(destination)).size;
    candidate.completedAt = isoNow();
    candidate.updatedAt = isoNow();
    candidate.anchorQa = {
      status: "passed",
      kind: "deterministic_dependency_contract",
      checks: dependencyChecks,
      checkedAt: isoNow()
    };
    candidate.productValidation = "auto_qa_passed";
    const ownerUnit = job.shotPlan?.units?.find((unit) => unit.id === candidate.shotPlanUnitId);
    if (ownerUnit) {
      const current = (ownerUnit.selectedAnchorCandidateIds || []).filter((id) => {
        const item = (job.shotAnchorCandidates || []).find((anchor) => anchor.id === id);
        return item && item.sourceKeyframeId !== candidate.sourceKeyframeId;
      });
      ownerUnit.selectedAnchorCandidateIds = [...current, candidate.id];
    }
    job.updatedAt = isoNow();
    await save();
  }

  async function resumeReplacementShotAnchor(jobId, candidateId) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    const candidate = job?.shotAnchorCandidates?.find((item) => item.id === String(candidateId || ""));
    if (!job || !candidate || candidate.status !== "generating" || !candidate.taskId) return;
    try {
      const deadline = ensureGenerationTime(candidate);
      const generated = await gptImageClient.waitForTask(candidate.taskId, {
        model: candidate.imageModel || job.imageModel || DEFAULT_IMAGE_MODEL,
        deadlineAt: deadline,
        onStatus: async ({ status }) => updateGenerationStage(job, candidate, stageForRemoteStatus(status), status)
      });
      await completeReplacementShotAnchor(job, candidate, generated);
    } catch (error) {
      failReplacementShotAnchor(job, candidate, error);
      await save();
    }
  }

  async function generateReplacementShotAnchors(jobId, unitId, input = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (job.generatedJobId || job.status === "generation_started") throw new Error("视频任务已经提交，不能再生成换品关键帧");
    const unit = job.shotPlan?.units?.find((item) => item.id === String(unitId || "") && item.included !== false);
    if (!unit) throw new Error("ShotPlan原片镜头不存在或未保留");
    if (!job.shotPlan?.confirmed) throw new Error("请先确认ShotPlan，再生成换品关键帧");
    if ((job.shotAnchorCandidates || []).some((item) => item.shotPlanUnitId === unit.id && item.status === "generating")) throw new Error("本原片镜头的换品关键帧正在生成");
    const requestedIds = normalizeReplacementAssetIds(Array.isArray(input.sourceKeyframeIds) ? input.sourceKeyframeIds : unit.requiredKeyframeIds || unit.keyframeIds);
    if (!requestedIds.length) throw new Error("本原片镜头没有选定候选关键帧");
    const generationOrder = unit.anchorSelection?.generationOrder || [];
    const sourceFrames = requestedIds.map((id) => (job.sourceAnalysis?.keyframes || []).find((frame) => frame.id === id && frame.localPath)).filter(Boolean)
      .sort((left, right) => {
        const leftIndex = generationOrder.indexOf(left.id);
        const rightIndex = generationOrder.indexOf(right.id);
        return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
          || Number(left.time || 0) - Number(right.time || 0);
      });
    if (!sourceFrames.length) throw new Error("选定的原片语义关键帧不可用");
    const selectedImageModel = normalizeImageModel(input.imageModel || job.imageModel || DEFAULT_IMAGE_MODEL);
    job.imageModel = selectedImageModel;
    job.imageModelLabel = imageModelLabel(selectedImageModel);
    const replacesProduct = ["product", "both"].includes(job.replacementMode);
    const productAssets = replacesProduct ? resolveReplacementShotAnchorAssets(job, unit) : [];
    const selectedInitialState = replacesProduct ? selectedReplacementInitialStateCandidate(job) : null;
    const initialStateDependency = replacementInitialStateDependency(selectedInitialState);
    const credential = await gptImageClient.acquireToken();
    for (const frame of sourceFrames) {
      const physicalState = (unit.anchorSelection?.candidates || []).find((item) => item.frameId === frame.id)
        || (unit.anchorSelection?.stateAnchors || []).find((item) => item.frameId === frame.id);
      const canonicalCandidate = replacementCanonicalAnchorCandidate(job, unit, frame);
      if (unit.anchorSelection?.requiresCanonicalInventoryAnchor === true
        && frame.id !== unit.anchorSelection?.canonicalSourceKeyframeId
        && !canonicalCandidate) {
        const error = new Error("同组全开库存母版尚未通过结构校验，已停止生成后续状态关键帧");
        error.code = "CANONICAL_INVENTORY_ANCHOR_NOT_READY";
        throw error;
      }
      const plannedInputCount = 1 + (initialStateDependency ? 1 : 0) + (canonicalCandidate?.localPath ? 1 : 0) + productAssets.length;
      if (plannedInputCount > MAX_IMAGE_GENERATION_INPUTS) {
        throw new Error(`ShotPlan关键帧输入共${plannedInputCount}张（原片关键帧1张、新首帧${initialStateDependency ? "1" : "0"}张、连续状态基准${canonicalCandidate?.localPath ? "1" : "0"}张、产品素材${productAssets.length}张），超过模型最多${MAX_IMAGE_GENERATION_INPUTS}张图片`);
      }
      const sourceFrameSha256 = await sha256File(frame.localPath);
      const productDependencies = await Promise.all(productAssets.map(async (asset, assetIndex) => ({
        asset,
        assetId: asset.id || `product-reference-${assetIndex + 1}`,
        sha256: text(asset.sha256, 128) || (asset.localPath ? await sha256File(asset.localPath) : "")
      })));
      const canonicalDependency = canonicalCandidate?.localPath ? {
        role: "canonical_inventory_anchor",
        assetId: canonicalCandidate.id,
        sha256: canonicalCandidate.sha256 || await sha256File(canonicalCandidate.localPath),
        sourceKeyframeId: canonicalCandidate.sourceKeyframeId,
        physicalContinuityGroupId: canonicalCandidate.physicalContinuityGroupId
      } : null;
      const anchorDependencies = [
        {
          role: "source_semantic_keyframe",
          assetId: frame.id,
          sha256: sourceFrameSha256
        },
        ...(initialStateDependency ? [{
          role: "initial_state_continuity_reference",
          assetId: initialStateDependency.candidateId,
          sha256: initialStateDependency.sha256,
          targetTime: 0
        }] : []),
        ...(canonicalDependency ? [canonicalDependency] : []),
        ...productDependencies.map((dependency) => ({
          role: "product_identity_truth",
          assetId: dependency.assetId,
          sha256: dependency.sha256
        }))
      ];
      const generationStartedAt = Date.now();
      const version = 1 + Math.max(0, ...(job.shotAnchorCandidates || []).filter((item) => item.shotPlanUnitId === unit.id && item.sourceKeyframeId === frame.id).map((item) => Number(item.version || 0)));
      const candidate = {
        id: identifier("shot-anchor"),
        shotPlanUnitId: unit.id,
        sourceKeyframeId: frame.id,
        sourceKeyframeTime: frame.time,
        sourceFramePath: frame.localPath,
        physicalContinuityGroupId: unit.physicalContinuityGroupId || unit.anchorSelection?.continuityGroupId || "",
        physicalState: physicalState?.revealState || physicalState?.transitionType || "unknown",
        canonicalInventoryAnchor: frame.id === unit.anchorSelection?.canonicalSourceKeyframeId,
        canonicalSourceKeyframeId: unit.anchorSelection?.canonicalSourceKeyframeId || "",
        role: frame.role || "action",
        version,
        label: `分镜${unit.order}${job.replacementMode === "background" ? "换景" : "换品"}关键帧 · ${Number(frame.time || 0).toFixed(1)}秒 V${version}`,
        status: "generating",
        stage: "preparing_inputs",
        stageLabel: IMAGE_GENERATION_STAGE_LABELS.preparing_inputs,
        imageModel: selectedImageModel,
        imageModelLabel: imageModelLabel(selectedImageModel),
        source: "platform_generated_shot_anchor",
        initialStateDependency,
        anchorDependencySchemaVersion: REPLACEMENT_ANCHOR_DEPENDENCY_SCHEMA_VERSION,
        anchorDependencies,
        transitionContract: buildReplacementTransitionContract(physicalState || { evidence: `${unit.action || ""} ${frame.description || ""}` }),
        inputAssetManifest: {
          schemaVersion: REPLACEMENT_ANCHOR_INPUT_SCHEMA_VERSION,
          assets: [
            {
              inputIndex: 1,
              assetId: frame.id,
              sha256: sourceFrameSha256,
              role: "source_semantic_keyframe",
              authority: "person_scene_action_contact_occlusion"
            },
            ...(initialStateDependency ? [{
              inputIndex: 2,
              assetId: selectedInitialState.id,
              sha256: selectedInitialState.sha256 || "",
              role: "initial_state_continuity_reference",
              authority: "product_count_layout_orientation_contact"
            }] : []),
            ...(canonicalCandidate?.localPath ? [{
              inputIndex: 2 + (initialStateDependency ? 1 : 0),
              assetId: canonicalCandidate.id,
              sha256: canonicalDependency.sha256,
              role: "physical_state_continuity_reference",
              authority: "inventory_state_chain"
            }] : []),
            ...productDependencies.map((dependency, assetIndex) => ({
              inputIndex: 2 + (initialStateDependency ? 1 : 0) + (canonicalCandidate?.localPath ? 1 : 0) + assetIndex,
              assetId: dependency.assetId,
              sha256: dependency.sha256,
              role: "product_identity_truth",
              authority: "product_geometry_material_color_logo_label"
            }))
          ]
        },
        prompt: replacementShotAnchorPrompt(job, unit, frame, input.prompt, productAssets),
        createdAt: new Date(generationStartedAt).toISOString(),
        generationStartedAt: new Date(generationStartedAt).toISOString(),
        generationDeadlineAt: new Date(generationStartedAt + imageGenerationTimeoutMs).toISOString(),
        updatedAt: new Date(generationStartedAt).toISOString(),
        completedAt: "",
        localPath: "",
        remoteUrl: "",
        taskId: "",
        remoteStatus: "",
        error: ""
      };
      job.shotAnchorCandidates = Array.isArray(job.shotAnchorCandidates) ? job.shotAnchorCandidates : [];
      job.shotAnchorCandidates.push(candidate);
      await save();
      try {
        const deadline = ensureGenerationTime(candidate);
        await updateGenerationStage(job, candidate, "uploading_reference");
        const inputUrls = [await gptImageClient.upload(frame.localPath, credential.token, { deadlineAt: deadline })];
        if (initialStateDependency) inputUrls.push(await gptImageClient.upload(selectedInitialState.localPath, credential.token, { deadlineAt: deadline }));
        if (canonicalCandidate?.localPath) inputUrls.push(await gptImageClient.upload(canonicalCandidate.localPath, credential.token, { deadlineAt: deadline }));
        if (productAssets.length) {
          await updateGenerationStage(job, candidate, "uploading_products");
          for (const asset of productAssets) inputUrls.push(asset.storageUrl || await gptImageClient.upload(asset.localPath, credential.token, { deadlineAt: deadline }));
        }
        await updateGenerationStage(job, candidate, "creating_task");
        const generated = await gptImageClient.generate({
          model: selectedImageModel,
          prompt: candidate.prompt,
          inputUrls,
          aspectRatio: "9:16",
          resolution: "1K",
          deadlineAt: deadline,
          onTaskCreated: async ({ taskId: createdTaskId, status }) => {
            candidate.taskId = String(createdTaskId || "");
            await updateGenerationStage(job, candidate, stageForRemoteStatus(status), status || "queued");
          },
          onStatus: async ({ status }) => updateGenerationStage(job, candidate, stageForRemoteStatus(status), status)
        });
        await completeReplacementShotAnchor(job, candidate, generated);
      } catch (error) {
        failReplacementShotAnchor(job, candidate, error);
        await save();
      }
    }
    return publicReplacementJob(job);
  }

  async function selectReplacementShotAnchor(jobId, unitId, candidateId) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    const unit = job.shotPlan?.units?.find((item) => item.id === String(unitId || ""));
    if (!unit) throw new Error("ShotPlan原片镜头不存在");
    const candidate = (job.shotAnchorCandidates || []).find((item) => item.id === String(candidateId || "") && item.shotPlanUnitId === unit.id && item.status === "success");
    if (!candidate) throw new Error("换品关键帧候选不存在或尚未生成成功");
    if (candidate.canonicalInventoryAnchor === true
      && candidate.anchorDependencySchemaVersion === REPLACEMENT_ANCHOR_DEPENDENCY_SCHEMA_VERSION
      && candidate.canonicalInventoryQa?.status !== "passed") {
      throw new Error("该全开库存母版没有通过结构校验，不能选用");
    }
    if (candidate.canonicalInventoryAnchor === true) {
      const groupId = candidate.physicalContinuityGroupId;
      const selectedIds = new Set((job.shotPlan?.units || []).flatMap((planUnit) => planUnit.selectedAnchorCandidateIds || []));
      const previousCanonicalCandidates = (job.shotAnchorCandidates || []).filter((item) => (
        item.id !== candidate.id
        && item.status === "success"
        && item.canonicalInventoryAnchor === true
        && item.physicalContinuityGroupId === groupId
        && selectedIds.has(item.id)
      ));
      invalidateReplacementAnchorDependents(job, previousCanonicalCandidates, "用户切换了全开库存母版，后续状态关键帧需要按新母版自动重构");
      candidate.adoption = {
        status: "user_selected",
        adoptedBy: "user",
        ruleVersion: "canonical-inventory-auto-adoption-v1",
        adoptedAt: isoNow()
      };
    }
    const current = (unit.selectedAnchorCandidateIds || []).filter((id) => {
      const item = (job.shotAnchorCandidates || []).find((anchor) => anchor.id === id);
      return item && item.sourceKeyframeId !== candidate.sourceKeyframeId;
    });
    unit.selectedAnchorCandidateIds = [...current, candidate.id];
    if (candidate.productValidation !== "auto_qa_passed") candidate.productValidation = "manual_selected";
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function deleteReplacementShotAnchor(jobId, unitId, candidateId) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    const unit = job.shotPlan?.units?.find((item) => item.id === String(unitId || ""));
    if (!unit) throw new Error("ShotPlan原片镜头不存在");
    const index = (job.shotAnchorCandidates || []).findIndex((item) => item.id === String(candidateId || "") && item.shotPlanUnitId === unit.id);
    if (index < 0) throw new Error("换品关键帧候选不存在");
    const candidate = job.shotAnchorCandidates[index];
    if (candidate.status === "generating") throw new Error("换品关键帧正在生成，暂时不能删除");
    if ((unit.selectedAnchorCandidateIds || []).includes(candidate.id)) {
      const alternatives = (unit.selectedAnchorCandidateIds || [])
        .map((id) => (job.shotAnchorCandidates || []).find((item) => item.id === id && item.status === "success"))
        .filter((item) => item && item.id !== candidate.id && item.sourceKeyframeId === candidate.sourceKeyframeId);
      if (!alternatives.length && (unit.requiredKeyframeIds || unit.keyframeIds || []).includes(candidate.sourceKeyframeId)) {
        throw new Error("不能删除产品可见镜头最后一个必需换品锚点；请先为该时间点生成并选用替代图");
      }
    }
    job.shotAnchorCandidates.splice(index, 1);
    unit.selectedAnchorCandidateIds = (unit.selectedAnchorCandidateIds || []).filter((id) => id !== candidate.id);
    if (candidate.localPath) await fsp.rm(candidate.localPath, { force: true }).catch(() => {});
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function replanReplacementShotPlan(jobId, input = {}, options = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (!job.sourceAnalysis) throw new Error("原片分析尚未完成");
    const videoSubmitted = Boolean(job.generatedJobId) || job.status === "generation_started";
    if (videoSubmitted && options.allowAfterFailedGeneration !== true) {
      throw new Error("视频任务已经提交，不能重新规划ShotPlan");
    }
    const videoModelId = text(input.videoModelId, 120) || job.videoModelId || "";
    const videoModelLabel = text(input.videoModelLabel, 240) || job.videoModelLabel || "";
    const videoModelMinimumDuration = clampNumber(input.minimumDuration, 3, 15, job.videoModelMinimumDuration || 4);
    const videoModelMaximumDuration = clampNumber(input.maximumDuration, videoModelMinimumDuration, 30, job.videoModelMaximumDuration || 15);
    const videoModelMaxReferenceImages = Math.max(1, Math.floor(Number(input.maxReferenceImages) || job.videoModelMaxReferenceImages || 9));
    const shotPlan = buildReplacementShotPlan(job.sourceAnalysis, {
      generationMode: job.generationMode,
      modelId: videoModelId,
      modelLabel: videoModelLabel,
      minimumDuration: videoModelMinimumDuration,
      maximumDuration: videoModelMaximumDuration,
      maxReferenceImages: videoModelMaxReferenceImages,
      productReferenceCount: job.productAssetIds.length + job.temporaryProductAssets.length,
      requireReplacementAnchors: job.replacementMode !== "voiceover"
    });
    if (videoSubmitted && job.generatedJobId) {
      job.generatedJobHistory = [...new Set([
        ...(Array.isArray(job.generatedJobHistory) ? job.generatedJobHistory : []),
        job.generatedJobId
      ])].slice(-10);
      job.generatedJobId = "";
    }
    job.videoModelId = videoModelId;
    job.videoModelLabel = videoModelLabel;
    job.videoModelMinimumDuration = videoModelMinimumDuration;
    job.videoModelMaximumDuration = videoModelMaximumDuration;
    job.videoModelMaxReferenceImages = videoModelMaxReferenceImages;
    job.shotPlan = shotPlan;
    applyReplacementVoiceoverTimingToShotPlan(job);
    job.validation = {
      productExposurePassCount: 0,
      productExposureRequiredCount: job.shotPlan.productVisibleShotCount,
      status: "pending",
      checks: []
    };
    job.shotAnchorCandidates = [];
    job.status = job.shotPlan.confirmed
      ? (job.selectedFirstFrameId ? "ready_to_generate" : "awaiting_first_frame_selection")
      : "awaiting_shot_plan_confirmation";
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function updateReplacementShotPlan(jobId, input = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (!job.shotPlan || !Array.isArray(job.shotPlan.units)) throw new Error("ShotPlan尚未生成完成");
    if (job.generatedJobId || job.status === "generation_started") throw new Error("视频任务已经提交，不能再修改ShotPlan");
    const requestedMode = input.generationMode === "smart" ? "smart" : input.generationMode === "manual" ? "manual" : job.generationMode;
    const unitSignature = (unit) => JSON.stringify({
      included: unit.included !== false,
      keyframeIds: unit.keyframeIds || [],
      referencePolicy: unit.referencePolicy,
      mergeWithPrevious: unit.mergeWithPrevious === true,
      anchorStrategy: unit.anchorStrategy || "generate",
      inheritsAnchorFromUnitId: unit.inheritsAnchorFromUnitId || ""
    });
    const previousUnitSignatures = new Map(job.shotPlan.units.map((unit) => [unit.id, unitSignature(unit)]));
    if (requestedMode === "smart" && Array.isArray(job.shotPlan.systemRecommendedUnits)) {
      job.shotPlan.units = JSON.parse(JSON.stringify(job.shotPlan.systemRecommendedUnits));
    } else if (Array.isArray(input.units)) {
      const requestedById = new Map(input.units.map((unit) => [String(unit?.id || ""), unit || {}]));
      const nextUnits = [];
      job.shotPlan.units.forEach((unit, unitIndex) => {
        const requested = requestedById.get(unit.id);
        if (!requested) {
          nextUnits.push(unit);
          return;
        }
        const previousUnit = nextUnits[unitIndex - 1] || null;
        const previouslyShared = unitIndex > 0 && (unit.mergeWithPrevious === true || unit.anchorStrategy === "inherit_previous");
        const mergeRequested = unitIndex > 0 && (requested.mergeWithPrevious === true || requested.anchorStrategy === "inherit_previous");
        const mergeWithPrevious = Boolean(previousUnit && mergeRequested);
        if (mergeWithPrevious) {
          const mergeDecision = evaluateReplacementSemanticMerge(
            replacementPlanningHydratedUnit(job.sourceAnalysis, previousUnit),
            replacementPlanningHydratedUnit(job.sourceAnalysis, unit),
            {
              executionClassification: job.shotPlan.executionClassification
            }
          );
          if (!mergeDecision.allowed && !previouslyShared) {
            const error = new Error(mergeDecision.reasons.join("；") || "当前镜头不能与上一个镜头建立连续生成组");
            error.code = mergeDecision.reasonCodes.includes("T4_MANUAL_REVIEW_REQUIRED")
              ? "REPLACEMENT_SEMANTIC_MERGE_MANUAL_REVIEW_REQUIRED"
              : "REPLACEMENT_SEMANTIC_MERGE_NOT_ALLOWED";
            error.details = mergeDecision;
            throw error;
          }
        }
        const anchorStrategy = previousUnit && (mergeWithPrevious || requested.anchorStrategy === "inherit_previous")
          ? "inherit_previous"
          : "generate";
        const availableKeyframeIds = new Set((job.sourceAnalysis?.keyframes || [])
          .filter((frame) => (unit.requiredKeyframeIds || unit.keyframeIds || []).includes(frame.id) || (frame.sourceShotId
            ? (unit.sourceShotIds || []).includes(frame.sourceShotId)
            : Number(frame.time) + 0.001 >= Number(unit.sourceStart) && Number(frame.time) <= Number(unit.sourceEnd) + 0.001))
          .map((frame) => frame.id));
        const requestedFrameInput = Array.isArray(requested.keyframeIds) && requested.keyframeIds.length
          ? requested.keyframeIds
          : unit.anchorStrategy === "inherit_previous" && anchorStrategy === "generate"
            ? (unit.recommendedKeyframeIds || unit.minimumSufficientKeyframeIds || unit.anchorSelection?.requiredGeneratedFrameIds || [])
            : unit.keyframeIds;
        const requestedKeyframeIds = (Array.isArray(requestedFrameInput) ? requestedFrameInput : [])
          .map((id) => text(id, 80))
          .filter((id, index, values) => id && availableKeyframeIds.has(id) && values.indexOf(id) === index);
        const keyframeIds = anchorStrategy === "inherit_previous" ? [] : requestedKeyframeIds;
        const inheritedOwnerId = anchorStrategy === "inherit_previous"
          ? (previousUnit.inheritsAnchorFromUnitId || previousUnit.id)
          : "";
        const inheritedOwner = anchorStrategy === "inherit_previous"
          ? (nextUnits.find((candidate) => candidate.id === inheritedOwnerId) || previousUnit)
          : null;
        const inheritedAnchorFrame = inheritedOwner
          ? (job.sourceAnalysis?.keyframes || [])
              .filter((frame) => (inheritedOwner.requiredKeyframeIds || inheritedOwner.keyframeIds || []).includes(frame.id))
              .sort((left, right) => Number(right.time || 0) - Number(left.time || 0))[0]
          : null;
        const timeline = (unit.timeline || []).map((item) => ({
          ...item,
          anchorSourceKeyframeId: anchorStrategy === "inherit_previous"
            ? (inheritedAnchorFrame?.id || "")
            : (item.sourceKeyframeId || ""),
          anchorSourceKeyframeTime: anchorStrategy === "inherit_previous"
            ? (inheritedAnchorFrame ? Number(inheritedAnchorFrame.time || 0) : null)
            : (item.sourceKeyframeTime ?? null),
          inheritedAnchorFromUnitId: anchorStrategy === "inherit_previous" ? inheritedOwnerId : ""
        }));
        const anchorSelection = anchorStrategy === "inherit_previous"
          ? unit.anchorSelection
          : replacementAnchorSelectionForManualFrames(unit.anchorSelection, keyframeIds);
        nextUnits.push({
          ...unit,
          included: true,
          targetDuration: Math.round(clampNumber(requested.targetDuration, unit.modelMinimumDuration || 3, unit.modelMaximumDuration || 30, unit.targetDuration || 5)),
          referencePolicy: replacementReferencePolicy(requested.referencePolicy, unit.recommendedReferencePolicy || "keyframes"),
          mergeWithPrevious,
          manualMergeIdentityOverride: mergeWithPrevious && unit.identityBoundarySplit === true,
          manualMergeWarning: mergeWithPrevious && unit.identityBoundarySplit === true
            ? "人工确认本段与上一镜头属于同一连续动作；原片身份边界仍保留并独立参与成片验收"
            : "",
          anchorStrategy,
          mergeGroupRootUnitId: mergeWithPrevious ? (previousUnit.mergeGroupRootUnitId || previousUnit.id) : "",
          inheritsAnchorFromUnitId: inheritedOwnerId,
          requiresReplacementAnchor: unit.productVisible && anchorStrategy === "generate",
          keyframeIds,
          requiredKeyframeIds: keyframeIds,
          requiredAnchorCount: unit.productVisible && anchorStrategy === "generate" ? keyframeIds.length : 0,
          anchorSelection,
          minimumSufficientKeyframeIds: anchorStrategy === "generate" && anchorSelection?.policy === "minimum_sufficient_physical_states_v1" ? [...keyframeIds] : (unit.minimumSufficientKeyframeIds || []),
          timeline,
          selectedAnchorCandidateIds: anchorStrategy === "inherit_previous" ? [] : (unit.selectedAnchorCandidateIds || [])
        });
      });
      job.shotPlan.units = nextUnits;
    }
    job.shotPlan.units = reconcileReplacementCanonicalInventoryGroups(job.shotPlan.units);
    job.generationMode = requestedMode;
    job.shotPlan.generationMode = requestedMode;
    const confirm = input.confirm === true || requestedMode === "smart";
    job.shotPlan.confirmed = confirm;
    job.shotPlan.status = confirm ? "confirmed" : "awaiting_confirmation";
    job.shotPlan.confirmedAt = confirm ? isoNow() : "";
    job.shotPlan.confirmationMode = confirm ? (requestedMode === "smart" ? "auto" : "manual") : "";
    const regenerated = buildReplacementGenerationUnits(job.sourceAnalysis, job.shotPlan.units, {
      minimumDuration: job.videoModelMinimumDuration,
      maximumDuration: job.videoModelMaximumDuration,
      maxReferenceImages: Number(job.shotPlan.assetBudget?.maximum || 9),
      productReferenceCount: job.productAssetIds.length + job.temporaryProductAssets.length
    });
    job.validation = {
      productExposurePassCount: 0,
      productExposureRequiredCount: job.shotPlan.productVisibleShotCount,
      status: "pending",
      checks: []
    };
    job.shotPlan.generationUnits = regenerated.generationUnits;
    job.shotPlan.generationUnitCount = regenerated.generationUnits.length;
    job.shotPlan.videoNodeCount = regenerated.generationUnits.length;
    job.shotPlan.generationStrategy = regenerated.generationUnits.length === 1 ? "single_full_video_node" : "hard_limit_split";
    job.shotPlan.splitReasonCodes = regenerated.splitReasonCodes;
    job.shotPlan.blockingReasons = regenerated.blockingReasons;
    job.shotPlan.assetBudget = regenerated.assetBudget;
    job.shotPlan.productVisibleShotCount = job.shotPlan.units.filter((unit) => unit.productVisible).length;
    job.shotPlan.requiredAnchorShotCount = job.shotPlan.units.filter((unit) => unit.productVisible && unit.requiresReplacementAnchor !== false).length;
    job.shotPlan.requiredAnchorCount = job.shotPlan.units.reduce((total, unit) => total + Number(unit.requiredAnchorCount || 0), 0);
    job.shotPlan.physicalStateAnchorCount = job.shotPlan.units.reduce((total, unit) => total + Number(unit.anchorSelection?.stateAnchorCount || 0), 0);
    job.shotPlan.physicalContinuityGroups = [...new Set(job.shotPlan.units.map((unit) => unit.physicalContinuityGroupId).filter(Boolean))].map((groupId) => {
      const groupUnits = job.shotPlan.units.filter((unit) => unit.physicalContinuityGroupId === groupId);
      const canonicalUnit = groupUnits.find((unit) => unit.anchorSelection?.canonicalSourceKeyframeId);
      return {
        id: groupId,
        kind: "container_reveal",
        unitIds: groupUnits.map((unit) => unit.id),
        stateAnchorCount: groupUnits.reduce((total, unit) => total + Number(unit.anchorSelection?.stateAnchorCount || 0), 0),
        requiredGeneratedAnchorCount: groupUnits.reduce((total, unit) => total + Number(unit.requiredAnchorCount || 0), 0),
        canonicalSourceKeyframeId: canonicalUnit?.anchorSelection?.canonicalSourceKeyframeId || "",
        canonicalEvidenceStatus: canonicalUnit?.anchorSelection?.canonicalEvidenceStatus || "not_required",
        inventoryEvidence: canonicalUnit?.anchorSelection?.inventoryEvidence || normalizeReplacementInventoryEvidence(),
        blockingReasons: groupUnits.flatMap((unit) => unit.anchorSelection?.blockingReasons || []),
        lockedInventoryFields: ["product_count", "rows", "layers", "order", "orientation", "spacing", "packaging_level"],
        mutationPolicy: "只有取出、放入或重新排列产品时允许改变库存与排列。"
      };
    });
    job.shotPlan.executionClassificationVersion = 2;
    job.shotPlan.executionClassification = classifyReplacementExecution(job.sourceAnalysis, {
      units: job.shotPlan.units,
      generationPlan: regenerated,
      physicalContinuityGroups: job.shotPlan.physicalContinuityGroups
    });
    applyReplacementGenerationPlanning(job.shotPlan, job.sourceAnalysis, {
      executionClassification: job.shotPlan.executionClassification
    });
    if (confirm) {
      const missingCandidateUnit = job.shotPlan.units.find((unit) => unit.productVisible && unit.requiresReplacementAnchor !== false && !(unit.requiredKeyframeIds || []).length);
      if (missingCandidateUnit) throw new Error(`原片镜头${missingCandidateUnit.order}产品可见但没有候选关键帧，不能确认ShotPlan`);
      if (regenerated.blockingReasons.length) throw new Error(regenerated.blockingReasons.map((item) => item.message).join("；"));
    }
    const changedUnitIds = new Set(job.shotPlan.units.filter((unit) => previousUnitSignatures.get(unit.id) !== unitSignature(unit)).map((unit) => unit.id));
    if (changedUnitIds.size) {
      job.shotAnchorCandidates = (job.shotAnchorCandidates || []).filter((candidate) => !changedUnitIds.has(candidate.shotPlanUnitId));
      for (const unit of job.shotPlan.units) if (changedUnitIds.has(unit.id)) unit.selectedAnchorCandidateIds = [];
    }
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function useReplacementReferenceFirstFrame(jobId, options = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (!["product", "both"].includes(job.replacementMode)) throw new Error("当前任务模式不支持沿用原片首帧");
    if (!job.referenceAssets?.firstFramePath || !await fsp.stat(job.referenceAssets.firstFramePath).then((stat) => stat.isFile()).catch(() => false)) {
      throw new Error("原片首帧尚未提取完成");
    }
    if (job.firstFrameCandidates.some((item) => item.status === "generating")) throw new Error("首帧候选正在生成，请完成后再沿用原片首帧");
    const videoSubmitted = Boolean(job.generatedJobId) || job.status === "generation_started";
    if (videoSubmitted && options.allowAfterFailedGeneration !== true) {
      throw new Error("视频任务已经提交，不能再更换首帧");
    }
    const now = isoNow();
    let candidate = (job.firstFrameCandidates || []).find((item) => item.source === "reference_frame");
    if (!candidate) {
      const stat = await fsp.stat(job.referenceAssets.firstFramePath);
      candidate = {
        id: REFERENCE_FIRST_FRAME_CANDIDATE_ID,
        angle: "reference",
        angleLabel: "原片首帧",
        version: 0,
        label: "原片首帧",
        source: "reference_frame",
        sourceName: job.referenceVideoName,
        status: "success",
        stage: "succeeded",
        stageLabel: IMAGE_GENERATION_STAGE_LABELS.succeeded,
        imageModel: "reference-frame",
        imageModelLabel: "原片提取",
        assetRole: "initial_state_anchor",
        targetTime: 0,
        productIdentityAuthority: 0,
        prompt: "",
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        localPath: job.referenceAssets.firstFramePath,
        sourceFramePath: job.referenceAssets.firstFramePath,
        sourceKeyframeId: "",
        sourceKeyframeTime: 0,
        sha256: await sha256File(job.referenceAssets.firstFramePath),
        size: stat.size,
        remoteUrl: "",
        taskId: "",
        productValidation: "manual_reference_frame_confirmation",
        error: ""
      };
      job.firstFrameCandidates.unshift(candidate);
    } else {
      candidate.localPath = job.referenceAssets.firstFramePath;
      candidate.sourceFramePath = job.referenceAssets.firstFramePath;
      candidate.sourceKeyframeId = "";
      candidate.sourceKeyframeTime = 0;
      candidate.assetRole = "initial_state_anchor";
      candidate.targetTime = 0;
      candidate.productIdentityAuthority = 0;
      candidate.updatedAt = now;
    }
    const previousSelected = selectedReplacementInitialStateCandidate(job);
    if (!previousSelected || previousSelected.id !== candidate.id || previousSelected.sha256 !== candidate.sha256) {
      invalidateReplacementAnchorsForInitialState(job, candidate);
    }
    job.firstFrameStrategy = "reference";
    job.referenceFirstFrameReview = {
      noSubtitle: true,
      productIdentityAuthority: 0,
      confirmedAsInitialState: true,
      confirmedBy: text(options.confirmedBy, 80) || "manual",
      confirmedAt: now
    };
    job.selectedFirstFrameId = candidate.id;
    job.firstFrameOutdated = false;
    job.status = job.firstFrameCandidates.some((item) => item.status === "generating") ? "generating_first_frame" : "ready_to_generate";
    job.updatedAt = now;
    await save();
    return publicReplacementJob(job);
  }

  async function selectReplacementFirstFrame(jobId, candidateId) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    const candidate = job.firstFrameCandidates.find((item) => item.id === String(candidateId || "") && item.status === "success");
    if (!candidate) throw new Error("请选择生成成功的首帧候选");
    adoptReplacementFirstFrame(job, candidate, "manual");
    await save();
    return publicReplacementJob(job);
  }

  async function deleteReplacementFirstFrame(jobId, candidateId) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (job.generatedJobId || job.status === "generation_started") {
      throw new Error("视频任务已经提交，不能删除已用于本次任务的新首帧候选");
    }
    const index = job.firstFrameCandidates.findIndex((item) => item.id === String(candidateId || ""));
    if (index < 0) throw new Error("新首帧候选不存在或已经删除");
    const candidate = job.firstFrameCandidates[index];
    if (candidate.status === "generating") throw new Error("新首帧仍在生成，暂时不能删除");
    if (candidate.source === "reference_frame") throw new Error("原片首帧是任务参考资产，不能删除；可改选其他候选图");

    job.firstFrameCandidates.splice(index, 1);
    if (job.selectedFirstFrameId === candidate.id) {
      const fallback = [...job.firstFrameCandidates].reverse().find((item) => (
        item.status === "success"
        && item.source !== "reference_frame"
        && item.localPath
      ));
      if (fallback) {
        adoptReplacementFirstFrame(job, fallback, "selected_candidate_deleted");
      } else {
        invalidateReplacementAnchorsForInitialState(job, null);
        job.selectedFirstFrameId = "";
        job.firstFrameSelection = null;
        job.status = job.firstFrameCandidates.some((item) => item.status === "generating") ? "generating_first_frame" : "awaiting_first_frame_selection";
      }
    }
    job.updatedAt = isoNow();

    const localPath = path.resolve(String(candidate.localPath || ""));
    const candidateRoot = path.resolve(outputRoot, "一键换品", job.id, "first-frame-candidates");
    if (candidate.localPath && localPath.startsWith(`${candidateRoot}${path.sep}`)) {
      await fsp.rm(localPath, { force: true }).catch(() => {});
    }
    await save();
    return publicReplacementJob(job);
  }

  function publicReplacementJob(job) {
    if (
      job.sourceAnalysis
      && job.shotPlan
      && Array.isArray(job.shotPlan.units)
      && (
        job.shotPlan.generationPlanning?.schemaVersion !== REPLACEMENT_GENERATION_PLANNING_SCHEMA_VERSION
        || job.shotPlan.generationPlanning?.compilerVersion !== REPLACEMENT_GENERATION_COMPILER_VERSION
      )
    ) {
      applyReplacementGenerationPlanning(job.shotPlan, job.sourceAnalysis, {
        executionClassification: job.shotPlan.executionClassification
      });
    }
    refreshReplacementCoverage(job);
    return {
      ...job,
      lockedScript: job.lockedScript ? {
        ...job.lockedScript,
        segments: Array.isArray(job.lockedScript.segments) ? [...job.lockedScript.segments] : []
      } : null,
      temporaryProductAssets: (job.temporaryProductAssets || []).map((asset) => ({
        ...asset,
        previewUrl: asset.localPath ? `./api/image?path=${encodeURIComponent(asset.localPath)}` : ""
      })),
      referenceAssets: {
        ...job.referenceAssets,
        firstFramePreviewUrl: job.referenceAssets?.firstFramePath ? `./api/image?path=${encodeURIComponent(job.referenceAssets.firstFramePath)}` : "",
        audioPreviewUrl: job.referenceAssets?.audioPath ? `./api/file?path=${encodeURIComponent(job.referenceAssets.audioPath)}` : ""
      },
      firstFrameCandidates: (job.firstFrameCandidates || []).map(candidatePreview),
      shotAnchorCandidates: (job.shotAnchorCandidates || []).map(candidatePreview)
    };
  }

  function getReplacementJob(jobId) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    return job ? publicReplacementJob(job) : null;
  }

  async function updateReplacementTask(jobId, input = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    assertDraftOwner(job, input.ownerKey);
    const taskName = String(input.taskName || "").trim();
    if (!taskName) throw new Error("任务名称不能为空");
    if (Array.from(taskName).length > 40) throw new Error("任务名称不能超过40个字符");
    job.taskName = taskName;
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function setReplacementReferenceAssets(jobId, referenceAssets = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    const firstFramePath = path.resolve(String(referenceAssets.firstFramePath || ""));
    if (!IMAGE_PATTERN.test(firstFramePath) || !await fsp.stat(firstFramePath).then((stat) => stat.isFile()).catch(() => false)) {
      throw new Error("参考视频首帧准备结果不可用");
    }
    job.referenceAssets = {
      firstFramePath,
      audioPath: "",
      duration: Number(referenceAssets.duration || job.referenceAssets?.duration || 0),
      hasAudio: Boolean(referenceAssets.hasAudio),
      audioExtraction: "deferred_generation_mp3",
      extractedAt: referenceAssets.extractedAt || referenceAssets.preparedAt || isoNow()
    };
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  function listReplacementJobs(options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 50));
    return state.replacementJobs
      .filter((job) => taskMatchesOwner(job, options.ownerKey))
      .sort((left, right) => (Number(right.taskSortOrder) || 0) - (Number(left.taskSortOrder) || 0)
        || String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, limit)
      .map(publicReplacementJob);
  }

  async function reorderReplacementJobs(jobIds = [], input = {}) {
    const orderedIds = [...new Set((Array.isArray(jobIds) ? jobIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!orderedIds.length) throw new Error("请提供任务排序结果");
    const orderedJobs = orderedIds.map((id) => state.replacementJobs.find((job) => job.id === id));
    if (orderedJobs.some((job) => !job || !taskMatchesOwner(job, input.ownerKey))) throw new Error("任务排序中包含无权访问的任务");
    const maximum = state.replacementJobs.reduce((value, job) => Math.max(value, Number(job.taskSortOrder) || 0), Date.now());
    const topOrder = maximum + orderedJobs.length;
    orderedJobs.forEach((job, index) => { job.taskSortOrder = topOrder - index; });
    await save();
    return orderedJobs.map(publicReplacementJob);
  }

  async function deleteReplacementJob(jobId) {
    const index = state.replacementJobs.findIndex((item) => item.id === String(jobId || ""));
    if (index < 0) throw new Error("一键换品任务不存在");
    const [job] = state.replacementJobs.splice(index, 1);
    await save();
    return publicReplacementJob(job);
  }

  function invalidateReplacementVoiceoverCompilation(job) {
    job.shotPlan = null;
    job.shotAnchorCandidates = [];
    job.validation = { productExposurePassCount: 0, productExposureRequiredCount: 0, status: "pending", checks: [] };
    if (job.voiceoverMode === "new") job.status = "awaiting_voiceover_confirmation";
  }

  async function retryReplacementSourceTranscript(jobId) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (job.generatedJobId || job.status === "generation_started") throw new Error("视频任务已经提交，不能重新识别原片口播");
    await prepareReplacementTranscript(job);
    if (["voiceover", "both"].includes(job.replacementMode) && job.voiceoverMode === "new") {
      await prepareReplacementVoiceoverDraft(job);
      invalidateReplacementVoiceoverCompilation(job);
    }
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function updateReplacementSourceTranscript(jobId, input = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (job.generatedJobId || job.status === "generation_started") throw new Error("视频任务已经提交，不能校正原片口播");
    const transcriptText = String(input.text ?? "").replace(/\r\n?/g, "\n").trim();
    job.sourceTranscript = transcriptFromResult({
      ...(job.sourceTranscript || {}),
      status: "success",
      text: transcriptText,
      segments: Array.isArray(job.sourceTranscript?.segments) ? job.sourceTranscript.segments : []
    }, "manual_correction");
    if (["voiceover", "both"].includes(job.replacementMode) && job.voiceoverMode === "new") {
      await prepareReplacementVoiceoverDraft(job);
      invalidateReplacementVoiceoverCompilation(job);
    }
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function updateReplacementVoiceoverDraft(jobId, input = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (!["voiceover", "both"].includes(job.replacementMode) || job.voiceoverMode !== "new") throw new Error("当前任务不使用新口播");
    if (job.generatedJobId || job.status === "generation_started") throw new Error("视频任务已经提交，新口播已经锁定");
    const draftText = String(input.text ?? "").replace(/\r\n?/g, "\n");
    if (!draftText.trim()) throw new Error("新口播文案不能为空");
    const previous = job.voiceoverDraft || {};
    const changed = String(previous.text || "") !== draftText;
    job.voiceoverDraft = {
      ...previous,
      schemaVersion: "one-click-replacement-voiceover-draft-v1",
      status: "ready",
      text: draftText,
      charCount: countTimingChars(draftText),
      version: Math.max(1, Number(previous.version || 0) + (changed ? 1 : 0)),
      confirmed: changed ? false : previous.confirmed === true,
      confirmedAt: changed ? "" : String(previous.confirmedAt || ""),
      updatedAt: isoNow()
    };
    if (changed) {
      job.lockedScript = null;
      invalidateReplacementVoiceoverCompilation(job);
    }
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function confirmReplacementVoiceover(jobId, input = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (!["voiceover", "both"].includes(job.replacementMode) || job.voiceoverMode !== "new") throw new Error("当前任务不需要确认新口播");
    if (job.generatedJobId || job.status === "generation_started") throw new Error("视频任务已经提交，新口播已经锁定");
    if (!job.sourceAnalysis) throw new Error("原片画面分析尚未完成");
    const draftText = String(input.text ?? job.voiceoverDraft?.text ?? "").replace(/\r\n?/g, "\n");
    if (!draftText.trim()) throw new Error("新口播文案不能为空");
    const nextVersion = Math.max(1, Number(job.lockedScript?.version || job.voiceoverDraft?.version || 0) + 1);
    job.lockedScript = createLockedScript(draftText, nextVersion);
    const confirmedAt = isoNow();
    job.voiceoverDraft = {
      ...(job.voiceoverDraft || {}),
      schemaVersion: "one-click-replacement-voiceover-draft-v1",
      status: "confirmed",
      text: draftText,
      charCount: countTimingChars(draftText),
      version: nextVersion,
      confirmed: true,
      confirmedAt,
      updatedAt: confirmedAt
    };
    const referenceChars = countTimingChars(job.sourceTranscript?.text);
    const newChars = countTimingChars(draftText);
    const sourceDuration = Math.max(0, Number(job.referenceAssets?.duration || 0));
    const targetDuration = referenceChars > 0 && sourceDuration > 0
      ? Math.max(1, Math.round(sourceDuration * newChars / referenceChars))
      : Math.max(1, Math.round(sourceDuration || newChars / 3.5));
    job.voiceoverTiming = {
      schemaVersion: "shared-voiceover-timing-v1",
      algorithm: "source_duration_x_new_chars_div_source_chars",
      sourceDuration,
      sourceChars: referenceChars,
      targetChars: newChars,
      targetDuration,
      confirmedVoiceoverSha256: job.lockedScript.sha256,
      updatedAt: confirmedAt
    };
    job.voiceoverDecision = {
      schemaVersion: "one-click-replacement-voiceover-decision-v2",
      mode: "new",
      version: nextVersion,
      editableUntil: "shot_plan_compilation",
      confirmed: true,
      updatedAt: confirmedAt,
      lockedAt: confirmedAt
    };
    job.shotPlan = createShotPlanForReplacementJob(job);
    applyReplacementVoiceoverTimingToShotPlan(job);
    job.validation = {
      productExposurePassCount: 0,
      productExposureRequiredCount: job.shotPlan.productVisibleShotCount,
      status: "pending",
      checks: []
    };
    job.shotAnchorCandidates = [];
    job.status = job.shotPlan.confirmed ? replacementPostFirstFrameStatus(job) : "awaiting_shot_plan_confirmation";
    job.updatedAt = confirmedAt;
    await save();
    return publicReplacementJob(job);
  }

  async function updateReplacementVoiceoverDecision(jobId, input = {}, options = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (!["voiceover", "both"].includes(String(job.replacementMode || ""))) {
      throw new Error("当前替换内容不包含口播，不能修改口播安排");
    }
    const videoSubmitted = Boolean(job.generatedJobId) || job.status === "generation_started";
    if (videoSubmitted && options.allowAfterFailedGeneration !== true) {
      throw new Error("视频任务已经提交，口播安排已用于制作，不能再修改");
    }
    const voiceoverMode = input.voiceoverMode === "new" ? "new" : "old";
    const modeChanged = job.voiceoverMode !== voiceoverMode;
    if (!modeChanged) return publicReplacementJob(job);
    job.voiceoverMode = voiceoverMode;
    if (voiceoverMode === "new") {
      if (!job.voiceoverDraft) await prepareReplacementVoiceoverDraft(job);
      job.lockedScript = null;
      if (job.voiceoverDraft) {
        job.voiceoverDraft.confirmed = false;
        job.voiceoverDraft.confirmedAt = "";
      }
      invalidateReplacementVoiceoverCompilation(job);
    } else if (job.sourceAnalysis) {
      job.lockedScript = null;
      job.shotPlan = createShotPlanForReplacementJob(job);
      job.shotAnchorCandidates = [];
      job.status = job.shotPlan.confirmed ? replacementPostFirstFrameStatus(job) : "awaiting_shot_plan_confirmation";
    }
    job.voiceoverValidation = voiceoverMode === "new"
      ? { status: "pending_generation", passed: false, attempts: 0 }
      : { status: "not_required", passed: true, attempts: 0 };
    const updatedAt = isoNow();
    job.voiceoverDecision = {
      schemaVersion: "one-click-replacement-voiceover-decision-v2",
      mode: voiceoverMode,
      version: Math.max(0, Number(job.voiceoverDecision?.version || 0)) + 1,
      editableUntil: voiceoverMode === "new" ? "shot_plan_compilation" : "video_generation_submission",
      confirmed: voiceoverMode === "old",
      updatedAt,
      lockedAt: ""
    };
    job.updatedAt = updatedAt;
    await save();
    return publicReplacementJob(job);
  }

  async function recordVoiceoverValidation(jobId, transcript, options = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (job.voiceoverMode !== "new" || !job.lockedScript) throw new Error("当前任务不需要新口播校验");
    const locked = assertLockedScriptIntegrity(job.lockedScript);
    const result = validateLockedScriptAsr(locked.lockedScript, transcript);
    job.voiceoverValidation = {
      status: result.passed ? "passed" : "review_required",
      passed: result.passed,
      attempts: Number(job.voiceoverValidation?.attempts || 0) + 1,
      checkedAt: isoNow(),
      transcript: String(transcript || ""),
      ...result
    };
    job.generatedJobId = text(options.generatedJobId, 160) || job.generatedJobId || "";
    job.status = options.generatedVideo === true
      ? (result.passed ? "voiceover_verified" : "review_required")
      : (result.passed ? "ready_to_generate" : "review_required");
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function markReplacementStarted(jobId, generatedJobId, options = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (job.voiceoverMode === "new") {
      if (job.voiceoverDraft?.confirmed !== true) throw new Error("请先确认新口播文案，再编译ShotPlan和生成视频");
      assertLockedScriptIntegrity(job.lockedScript);
    }
    if (job.generatedJobId && job.generatedJobId !== String(generatedJobId || "")) {
      job.generatedJobHistory = [...new Set([
        ...(Array.isArray(job.generatedJobHistory) ? job.generatedJobHistory : []),
        job.generatedJobId
      ])].slice(-10);
    }
    job.generatedJobId = text(generatedJobId, 160);
    job.videoModelId = text(options.videoModelId, 120) || job.videoModelId || "";
    job.videoModelLabel = text(options.videoModelLabel, 240) || job.videoModelLabel || "";
    job.videoDuration = Number(options.videoDuration || job.videoDuration || 0);
    job.videoClarity = text(options.videoClarity, 40) || job.videoClarity || "";
    job.videoClarityLabel = text(options.videoClarityLabel, 80) || job.videoClarityLabel || "";
    job.validation = {
      productExposurePassCount: 0,
      productExposureRequiredCount: Number(job.shotPlan?.productVisibleShotCount || 0),
      status: "pending",
      checks: [],
      generatedJobId: text(generatedJobId, 160)
    };
    job.voiceoverDecision = {
      schemaVersion: "one-click-replacement-voiceover-decision-v1",
      mode: job.voiceoverMode === "new" ? "new" : "old",
      version: Math.max(0, Number(job.voiceoverDecision?.version || job.lockedScript?.version || 0)),
      editableUntil: "video_generation_submission",
      updatedAt: job.voiceoverDecision?.updatedAt || job.updatedAt || isoNow(),
      lockedAt: isoNow()
    };
    job.status = "generation_started";
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  async function recordReplacementVisualValidation(jobId, input = {}) {
    const job = state.replacementJobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("一键换品任务不存在");
    if (!job.generatedJobId) throw new Error("视频尚未生成，不能记录成片画面验收");
    const requiredShotIds = (job.shotPlan?.coverageMatrix || [])
      .filter((row) => row?.productVisible === true)
      .map((row) => String(row.sourceShotId || ""))
      .filter(Boolean);
    const suppliedChecks = Array.isArray(input.checks) ? input.checks : [];
    const checksByShot = new Map(suppliedChecks.map((check) => [String(check?.sourceShotId || ""), check || {}]));
    const checks = requiredShotIds.map((sourceShotId) => {
      const check = checksByShot.get(sourceShotId) || {};
      const passed = check.passed === true
        && check.oldProductResidual === false
        && check.productIdentityPassed === true
        && check.actionStructurePassed === true;
      return {
        sourceShotId,
        representativeTime: Number(check.representativeTime || 0),
        neighborFrameChecked: check.neighborFrameChecked === true,
        oldProductResidual: check.oldProductResidual !== false,
        productIdentityPassed: check.productIdentityPassed === true,
        actionStructurePassed: check.actionStructurePassed === true,
        evidence: text(check.evidence, 2000),
        passed
      };
    });
    const passCount = checks.filter((check) => check.passed).length;
    const passed = requiredShotIds.length === passCount && checks.every((check) => check.neighborFrameChecked);
    job.validation = {
      productExposurePassCount: passCount,
      productExposureRequiredCount: requiredShotIds.length,
      status: passed ? "passed" : "review_required",
      passed,
      checks,
      reviewer: text(input.reviewer, 240),
      checkedAt: isoNow(),
      generatedJobId: job.generatedJobId
    };
    job.status = passed ? "visual_verified" : "review_required";
    job.updatedAt = isoNow();
    await save();
    return publicReplacementJob(job);
  }

  return {
    init,
    status,
    catalogProducts,
    listManagedProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    syncSharedProducts,
    listAssets,
    getAsset,
    getAssetGroup,
    deleteAsset,
    updateAsset,
    migrateWorkspaceAssets,
    syncSharedAssets,
    ensureLocalAsset,
    registerAsset,
    createCandidateDraft,
    updateCandidateDraft,
    updateCandidateTask,
    reorderCandidateJobs,
    recordCandidateVideoJobs,
    createCandidateJob,
    listCandidateJobs,
    getCandidateJob,
    deleteCandidateJob,
    appendCandidate,
    createReplacementDraft,
    updateReplacementDraft,
    updateReplacementTask,
    reorderReplacementJobs,
    createReplacementJob,
    listReplacementJobs,
    getReplacementJob,
    setReplacementReferenceAssets,
    deleteReplacementJob,
    generateReplacementFirstFrame,
    generateReplacementShotAnchors,
    selectReplacementShotAnchor,
    deleteReplacementShotAnchor,
    replanReplacementShotPlan,
    updateReplacementShotPlan,
    uploadReplacementFirstFrame,
    useReplacementReferenceFirstFrame,
    selectReplacementFirstFrame,
    deleteReplacementFirstFrame,
    retryReplacementSourceTranscript,
    updateReplacementSourceTranscript,
    updateReplacementVoiceoverDraft,
    confirmReplacementVoiceover,
    updateReplacementVoiceoverDecision,
    recordVoiceoverValidation,
    recordReplacementVisualValidation,
    markReplacementStarted,
    flush: () => saveQueue
  };
}

module.exports = {
  ANGLES,
  PENDING_PRODUCTS,
  AMPOULE_ASSET_ROLES,
  AUTO_REPLACEMENT_QUANTITY_RULE,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  buildEmptyScenePrompt,
  buildProductImagePrompt,
  canonicalSpeechText,
  compileReplacementVoiceoverSpeechPlan,
  countTimingChars,
  assertLockedScriptIntegrity,
  createLockedScript,
  createReplacementVoiceoverPlan,
  createProductWorkflows,
  createQwenPromptClient,
  classifyReplacementExecution,
  evaluateReplacementSemanticMerge,
  buildReplacementGenerationPlanning,
  applyReplacementGenerationPlanning,
  buildReplacementGenerationUnits,
  buildReplacementShotPlan,
  formatStructuredScenePrompt,
  isQwenQuotaError,
  normalizeReplacementSourceAnalysis,
  normalizeReplacementTaskVariables,
  refreshReplacementCoverage,
  validateReplacementAnchorDependencySnapshot,
  REPLACEMENT_EXECUTION_CLASSIFICATION_SCHEMA_VERSION,
  REPLACEMENT_EXECUTION_TYPES,
  REPLACEMENT_GENERATION_PLANNING_SCHEMA_VERSION,
  REPLACEMENT_GENERATION_COMPILER_VERSION,
  REPLACEMENT_QA_CONTRACT_SCHEMA_VERSION,
  REPLACEMENT_BACKGROUND_FIRST_FRAME_PROMPT,
  REPLACEMENT_FIRST_FRAME_EDIT_PROMPT,
  REFERENCE_FIRST_FRAME_CLEANUP_PROMPT,
  REPLACEMENT_TASK_VARIABLE_DEFAULTS,
  segmentLockedScript,
  validateLockedScriptAsr
};

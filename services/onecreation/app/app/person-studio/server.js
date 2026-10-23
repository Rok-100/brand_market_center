const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { AsyncLocalStorage } = require("async_hooks");
const { URL } = require("url");
const crypto = require("crypto");
const { collectImageUrls } = require(path.join(__dirname, "..", "assets", "gpt-image-runtime", "gpt-image-client.js"));

const APP_ROOT = __dirname;
const DIRECT_HOST_APP_ROOT = path.resolve(APP_ROOT, "..");
const HOST_APP_ROOT = fs.existsSync(path.join(DIRECT_HOST_APP_ROOT, "package.json"))
  ? DIRECT_HOST_APP_ROOT
  : path.resolve(APP_ROOT, "..", "..");
const PRODUCT_GOVERNANCE_PATH = path.join(HOST_APP_ROOT, "one-click-remake-governance.js");
const { isVisibleProduct } = fs.existsSync(PRODUCT_GOVERNANCE_PATH)
  ? require(PRODUCT_GOVERNANCE_PATH)
  : { isVisibleProduct: (product) => product?.id !== "wis-ningyan-anti-aging-set" && !String(product?.name || "").includes("凝颜") };
const PRODUCT_PROFILES = require(path.join(HOST_APP_ROOT, "assets", "product-workflows-runtime", "product-profiles.json")).products;
const LIBTV_WORKSPACE_RUNTIME_ROOT = fs.existsSync(path.join(HOST_APP_ROOT, "libtv-workspace-manager.js"))
  ? HOST_APP_ROOT
  : path.join(HOST_APP_ROOT, "assets", "workbench-auth");
const {
  WORKBENCH_MODULES,
  createWorkbenchLibtvManager,
  shanghaiDate
} = require(path.join(LIBTV_WORKSPACE_RUNTIME_ROOT, "libtv-workspace-manager.js"));
const PROMPT_RULE_RUNTIME_ROOT = fs.existsSync(path.join(HOST_APP_ROOT, "prompt-rules.js"))
  ? HOST_APP_ROOT
  : path.join(HOST_APP_ROOT, "assets", "prompt-rules-runtime");
const {
  assertLibtvArgsPromptRulesDisabled,
  validateGenerationTaskContract
} = require(path.join(PROMPT_RULE_RUNTIME_ROOT, "prompt-rules.js"));
const AUTH_RUNTIME_ROOT = fs.existsSync(path.join(HOST_APP_ROOT, "auth.js"))
  ? HOST_APP_ROOT
  : path.join(HOST_APP_ROOT, "assets", "workbench-auth");
const { createAuthManager } = require(path.join(AUTH_RUNTIME_ROOT, "auth.js"));
const { createProviderCredentialStore } = require(path.join(HOST_APP_ROOT, "assets", "workbench-auth", "provider-credentials.js"));
const PACKAGE_ROOT = path.resolve(HOST_APP_ROOT, "..");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const JOBS_DIR = path.join(APP_ROOT, "jobs");
const PORT = Number(process.env.PERSON_STUDIO_PORT || 3767);
const HOST = process.env.PERSON_STUDIO_HOST || process.env.HOST || "127.0.0.1";
const LIBTV_BINARY = process.platform === "win32" ? "libtv.exe" : "libtv";
const PACKAGED_LIBTV = path.join(PACKAGE_ROOT, "tools", LIBTV_BINARY);
const USER_LIBTV = path.join(process.env.USERPROFILE || process.env.HOME || "", ".libtv", LIBTV_BINARY);
const LIBTV = process.env.LIBTV_PATH || (fs.existsSync(PACKAGED_LIBTV) ? PACKAGED_LIBTV : USER_LIBTV);
const LIBTV_CONFIG_ROOT = path.resolve(String(
  process.env.LIBTV_CONFIG_DIR
  || path.join(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.USERPROFILE || process.env.HOME || HOST_APP_ROOT, "Fandao", "AI视频工作台", "libtv")
));
const LIBTV_USER_CONFIG_ROOT = path.join(LIBTV_CONFIG_ROOT, "users");
const PROVIDER_CREDENTIAL_ROOT = path.resolve(String(
  process.env.AI_WORKBENCH_PROVIDER_CREDENTIAL_DIR
  || path.join(path.dirname(LIBTV_CONFIG_ROOT), "provider-credentials")
));
const libtvUserContext = new AsyncLocalStorage();
const DEFAULT_IMAGE_DIR = process.env.PRODUCT_SHOT_DEFAULT_IMAGES || path.join(HOST_APP_ROOT, "assets", "WIS隐形水润面膜（水光肽）", "四张图");
const DEFAULT_OUTPUT_DIR = process.env.PERSON_STUDIO_OUTPUT_DIR || path.join(HOST_APP_ROOT, "outputs", "AI-明星画面生成");
const PERSON_UPLOAD_DIR = path.join(APP_ROOT, "person-uploads");
const PERSON_JOBS_DIR = path.join(APP_ROOT, "person-jobs");
const IDENTITY_UPLOAD_DIR = path.join(APP_ROOT, "identity-uploads");
const IDENTITY_JOBS_DIR = path.join(APP_ROOT, "identity-jobs");
const DEFAULT_JENVIDEO_BASE_URL = "https://jenvideo-jump.fandow.com";
const LEGACY_JENVIDEO_BASE_URLS = new Set([
  "https://cloud.fandow.com/gpt/jenvideo-jump"
]);
const AUTO_GEN_TOKEN_CACHE_MS = 6 * 60 * 60 * 1000;
const PACKAGE_JSON_PATH = path.join(HOST_APP_ROOT, "package.json");
const UPDATE_CONFIG_PATH = path.join(APP_ROOT, "update-config.json");
const UPDATE_WORK_DIR = path.join(APP_ROOT, "updates");
const DEFAULT_UPDATE_MANIFEST = process.env.PRODUCT_SHOT_UPDATE_MANIFEST || path.resolve(APP_ROOT, "..", "updates", "manifest.json");
const APP_PACKAGE = readLocalPackage();
const APP_VERSION = APP_PACKAGE.version || "1.0.0";
const authManager = createAuthManager({
  appRoot: AUTH_RUNTIME_ROOT,
  appVersion: APP_VERSION
});
const providerCredentialStore = createProviderCredentialStore({
  rootDir: PROVIDER_CREDENTIAL_ROOT,
  secret: authManager.internalToken
});
const WORKBENCH_PRODUCTS_URL = process.env.AI_WORKBENCH_PRODUCTS_URL || "http://127.0.0.1:3766/api/products";
const WORKBENCH_PUBLIC_URL = String(
  process.env.WIS_WORKBENCH_PUBLIC_URL
  || process.env.AI_WORKBENCH_PUBLIC_URL
  || "http://127.0.0.1:3766"
).trim().replace(/\/+$/, "");
const PERSON_STUDIO_PUBLIC_URL = String(
  process.env.AI_PERSON_STUDIO_PUBLIC_URL || `http://127.0.0.1:${PORT}`
).trim().replace(/\/+$/, "");
const PRODUCT_CATALOG_CACHE_MS = 15 * 1000;
const REFERENCE_AUDIO_DIR = path.join(APP_ROOT, "assets", "reference-audio");
const REFERENCE_AUDIO_MANIFEST = path.join(REFERENCE_AUDIO_DIR, "manifest.json");
const ACTIVE_JOB_STATUSES = new Set(["queued", "preparing", "running", "quality_checking"]);
const KLING_CLI = process.platform === "win32" ? "kling.cmd" : "kling";
const KLING_SKILL_NAME = "kling-cli";
const KLING_SKILL_VERSION = "0.1.3";
const KLING_CAPABILITY_CACHE_MS = 2 * 60 * 1000;
const KLING_CN_PACKAGE = "@klingai/cli-cn";
const KLING_CN_REGISTRY = "https://registry.npmjs.org";
const KLING_INSTALL_ROOT = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || process.env.HOME || "", "AppData", "Roaming"), "AI视频工作台", "kling-cli");
const LOCAL_KLING_CLI = path.join(KLING_INSTALL_ROOT, KLING_CLI);
const BUNDLED_NODE = path.join(PACKAGE_ROOT, "runtime", process.platform === "win32" ? "node.exe" : "node");
const BUNDLED_NPM_CLI = path.join(HOST_APP_ROOT, "assets", "npm-runtime", "bin", "npm-cli.js");
let klingCapabilityCache = { at: 0, data: null };
let klingCliPathCache = { at: 0, path: null };
let klingInstallInFlight = null;
const LIBTV_CAPABILITY_CACHE_MS = 2 * 60 * 1000;
const libtvCapabilityCaches = new Map();

function libtvUserScope(authUser = {}) {
  const userId = String(authUser.lark_user_id || authUser.larkUserId || authUser.sub || authUser.id || "").trim();
  if (!userId || userId === "internal-service") throw new Error("请使用个人飞书账号绑定LibTV");
  const key = crypto.createHash("sha256").update(`workbench-libtv:${userId}`).digest("hex").slice(0, 32);
  return { key, userId, name: String(authUser.name || "工作台用户"), configDir: path.join(LIBTV_USER_CONFIG_ROOT, key) };
}

function withLibtvUser(authUser, handler) {
  const scope = libtvUserScope(authUser);
  fs.mkdirSync(scope.configDir, { recursive: true, mode: 0o700 });
  return libtvUserContext.run(scope, handler);
}

function currentProviderScope() {
  return libtvUserContext.getStore() || null;
}

function currentMultimodalSessionKey() {
  return currentProviderScope()?.key || "internal-service";
}

function currentMultimodalSession() {
  const key = currentMultimodalSessionKey();
  if (!multimodalAuthSessions.has(key)) {
    multimodalAuthSessions.set(key, { token: "", source: "", userInfo: null, expiresAt: 0 });
  }
  return multimodalAuthSessions.get(key);
}

function resetCurrentMultimodalSession() {
  multimodalAuthSessions.delete(currentMultimodalSessionKey());
}

function clearCurrentAutomaticGenTokenCache() {
  const ownerKey = currentMultimodalSessionKey();
  for (const key of automaticGenTokenCache.keys()) {
    if (key.includes(`|${ownerKey}|`)) automaticGenTokenCache.delete(key);
  }
}

function libtvJobOwner() {
  const scope = libtvUserContext.getStore();
  return scope ? { key: scope.key, userId: scope.userId, name: scope.name } : null;
}

function jobOwnedByCurrentUser(job) {
  const scope = libtvUserContext.getStore();
  return Boolean(scope && job?.libtvOwner?.key && job.libtvOwner.key === scope.key);
}

function readLocalPackage() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  } catch {
    return {};
  }
}

const PRODUCTS = [
  {
    id: "wis-hydra-peptide-mask",
    name: PRODUCT_PROFILES["wis-hydra-peptide-mask"].platformName,
    shortName: PRODUCT_PROFILES["wis-hydra-peptide-mask"].shortName,
    spokenName: "WIS水润面膜",
    imageDir: DEFAULT_IMAGE_DIR,
    defaultScene: "海边沙滩",
    defaultPurpose: "生活种草",
    visualIdentity: "白色与水蓝色面膜盒/面膜片包装，蓝色品牌区，干净清透的补水护肤视觉",
    benefitCues: "水润补水、清透光泽、轻薄膜布、日常保湿护理氛围",
    maskDetail: "面膜片质地很好、轻薄柔软、水润有光泽，整体清爽、湿润、服帖",
    compliance: "避免医美治疗暗示、夸张前后对比、额外文字和功效绝对化表达",
    negativeExtra: "人物脸部特写，医美治疗暗示，夸张前后对比",
    imagePriority: ["盒正面", "盒右侧", "盒左侧", "盒顶部", "片正面"]
  },
  {
    id: "wis-black-crystal-mask",
    name: PRODUCT_PROFILES["wis-black-crystal-mask"].platformName,
    shortName: PRODUCT_PROFILES["wis-black-crystal-mask"].shortName,
    spokenName: "WIS黑晶面膜",
    imageDir: path.join(HOST_APP_ROOT, "assets", "WIS黑晶光蕴蓄能面膜", "产品图"),
    defaultScene: "高端浴室梳妆台",
    defaultPurpose: "高级感",
    visualIdentity: "黑色高光方盒包装，金色 +WIS+ 标识，银色晶格线条，蓝色底部色带，黑色石墨烯膜布带蜂窝纹理",
    benefitCues: "石墨烯膜布科技感，电解质蓄能光感，富勒烯抗氧光泽，肽类紧致淡纹氛围，M6P能量感，泛醇、玻尿酸、三重神经酰胺的水润锁水感，龙胆与甘草酸二钾的温和舒缓感",
    maskDetail: "黑色石墨烯膜布必须平整服帖、湿润有精华光泽，蜂窝纹理清晰但不夸张，不能干皱、不能破损、不能像纸片",
    compliance: "只做保湿、抗皱、紧致、控油方向的视觉表达；不要出现微针、针头、注射、破皮、美容院治疗、医美、院线级、修复、纳米、百分百、完全、永久、前后对比和医学承诺",
    negativeExtra: "针头，注射器，破皮，血液，伤口，医疗器械，美容院治疗，医美项目，院线级，修复文字，纳米文字，百分百，完全，永久，夸张前后对比，膜布干皱，包装破损，logo反向",
    imagePriority: ["盒正面.png", "盒正面+左侧", "盒正面+右侧", "单片正面", "单片背面", "膜布（展开）", "膜布（材质）", "膜布（局部材质）", "盒背面"]
  },
  {
    id: "wis-crystal-firming-eye-mask",
    name: PRODUCT_PROFILES["wis-crystal-firming-eye-mask"].platformName,
    shortName: PRODUCT_PROFILES["wis-crystal-firming-eye-mask"].shortName,
    spokenName: "WIS眼膜",
    imageDir: path.join(HOST_APP_ROOT, "assets", "WIS晶润紧致眼膜", "产品图"),
    defaultScene: "高端浴室梳妆台",
    defaultPurpose: "高级感",
    visualIdentity: "白色圆罐眼膜包装，蓝色 +WIS+ 标签区，罐身带 CRYSTAL FIRMING EYE MASK / 晶润紧致眼膜 固有包装文字，开盖后可见蓝色水润凝胶眼贴，整体清透、精致、眼周护理感",
    benefitCues: "玻尿酸水润保湿，抗皱紧致眼周护理氛围，咖啡因清爽熬夜护理感，多重肽与玻色因的弹润支撑感，烟酰胺光泽感，龙胆植萃与 CalmYang 植萃的温和舒缓感",
    maskDetail: "蓝色水润凝胶眼贴必须呈月牙形/眼贴形，质地透明清透、柔软弹润、精华充盈、有细腻水光，不能变成整片脸部面膜，不能干皱、破损或像纸片",
    compliance: "只做保湿、抗皱、紧致、温和舒缓方向的视觉表达；不要出现医疗治疗、眼科器械、针头注射、夸张前后对比、百分百、永久、治愈、消除黑眼圈等绝对化或医学承诺",
    negativeExtra: "整片脸部面膜，方盒面膜包装，黑色膜布，石墨烯膜布，眼球特写，眼部手术，针头，注射器，医疗器械，眼科治疗，破皮，血液，伤口，医美项目，院线级，百分百，永久，消除黑眼圈文字，夸张前后对比，凝胶眼贴干皱，包装破损，logo反向",
    imagePriority: ["眼膜纯正面", "眼膜新包装", "晶润紧致眼膜透明底", "眼膜.png", "眼膜仰视", "头图", "晶润眼膜", "替换装-平视", "替换装-仰视", "晶润紧致眼膜替换装"]
  },
  {
    id: "wis-birds-nest-peptide-revitalizing-mask",
    name: PRODUCT_PROFILES["wis-birds-nest-peptide-revitalizing-mask"].platformName,
    shortName: PRODUCT_PROFILES["wis-birds-nest-peptide-revitalizing-mask"].shortName,
    spokenName: "WIS燕窝面膜",
    imageDir: path.join(HOST_APP_ROOT, "assets", "WIS燕窝胜肽焕润面膜", "产品图"),
    defaultScene: "高端浴室梳妆台",
    defaultPurpose: "高级感",
    visualIdentity: "深海蓝与香槟金高端包装体系，包含深蓝金边方盒和透明圆罐，圆罐为透明玻璃质感罐身、香槟金盖、深蓝标签区，正面有金色 +WIS+ 标识、燕窝图形和 BIRD'S NEST PEPTIDE REVITALIZING MASK 固有包装文字；质地为淡米白半透明燕窝凝胶，晶莹、拉丝、Q弹、水润",
    benefitCues: "燕窝酸与水解小雨燕窝的焕润滋养感，双重胜肽与胶原的弹润紧致氛围，透明质酸钠锁水膜感，柑橘、番红花、龙胆植萃的温和舒缓感，涂抹式凝胶面膜的一拌一敷一擦仪式感",
    maskDetail: "这是涂抹式罐装凝胶面膜，不是贴片面膜；必须呈现淡米白、半透明、晶莹拉丝、燕窝冻/果冻般的凝胶质地，质地水润饱满、柔滑、有包裹感，避免变成纸质膜布、泥膜、膏霜块或普通面霜",
    compliance: "只做保湿、抗皱、紧致、温和舒缓方向的视觉表达；避免医疗治疗、皮肤疾病治疗、注射针头、医美仪器、绝对化功效、具体检测数据、夸张前后对比、逆龄治愈等承诺；除产品包装本身文字外不要新增字幕、标题、角标、漂浮文字或说明文字",
    negativeExtra: "贴片面膜，纸质膜布，黑色膜布，整张脸部面膜，泥膜，厚重膏霜块，产品变成水乳瓶，蓝色包装变黑或变白，金盖丢失，罐身不透明，燕窝凝胶变干，质地像鼻涕或胶水，logo反向，标签乱码，额外文字，字幕，标题字，角标文字，医美项目，针头，注射器，医疗器械，皮肤病治疗，逆龄文字，百分百，永久，夸张前后对比",
    imagePriority: ["罐正面", "盒正面", "罐侧面", "罐背面", "盒立体图", "瓶口质地", "燕窝凝胶质地", "标签细节", "金色瓶盖", "盒侧面", "盒背面", "上脸涂抹场景", "浴室毛巾场景", "旅行便携场景"]
  },
  {
    id: "wis-ningyan-anti-aging-set",
    name: "WIS凝颜抗老套装",
    shortName: "凝颜套装",
    spokenName: "WIS凝颜套装",
    imageDir: path.join(HOST_APP_ROOT, "assets", "WIS凝颜抗老套装", "产品图"),
    defaultScene: "高端浴室梳妆台",
    defaultPurpose: "高级感",
    visualIdentity: "高饱和电光蓝凝颜系列套组包装，白色 +WIS+ 标签区，包含四件套：两支圆柱高瓶精粹水/精粹乳、一支蓝色洁面软管、一只蓝色面霜罐；玻璃瓶身通透高光、银色金属圈和蓝色瓶盖清晰，套组数量、瓶型比例和相对位置稳定",
    benefitCues: "8D/7重玻尿酸与 GAGS 的层层水润感，SYN-HYCAN 玻尿酸胜肽紧塑科技感，三种重组胶原蛋白的弹润支撑感，玻色因与多重胜肽的抗皱紧致氛围，β-葡聚糖、专利龙胆和墨角藻的温和修护舒缓感，氨基酸洁面的温和清洁泡沫感",
    maskDetail: "套组质地需对应产品本身：精粹水呈清透水光，精粹乳呈轻盈乳液光泽，面霜呈丰盈柔润白色膏体，洁面乳呈细腻绵密泡沫；质地只作为前景点缀，不遮挡任何 +WIS+ 标签和瓶身文字区",
    compliance: "只做保湿、修护、抗皱、紧致、温和清洁、敏感肌适用方向的视觉表达；不要出现医美治疗、皮肤疾病治疗、逆龄、祛皱百分百、永久年轻、细胞再生承诺、夸张前后对比或具体功效数据文字",
    negativeExtra: "套组缺件，四件套变成单品，瓶型混乱，洁面软管变成瓶子，面霜罐变成面膜盒，蓝色包装变黑或变白，logo反向，标签被泡沫遮挡，产品数量错误，随机新增第五件产品，医美项目，针头，注射器，医疗器械，皮肤病治疗，逆龄文字，百分百祛皱，永久年轻，夸张前后对比",
    imagePriority: ["凝颜四件套", "凝颜水", "凝颜乳液", "凝颜洁面乳", "凝颜面霜"]
  }
];

const NO_PRODUCT = {
  id: "no-product",
  name: "不出现产品",
  shortName: "无产品",
  spokenName: "无产品",
  category: "none",
  imageDir: "",
  defaultScene: "真实人物场景",
  defaultPurpose: "人物展示",
  noProduct: true,
  visualIdentity: "仅生成人物与合理场景，不出现任何商品、包装、品牌logo或商品道具",
  benefitCues: "突出人物身份、表情、动作、服装与场景氛围",
  maskDetail: "",
  compliance: "不虚构商品、品牌、价格、功效或购买引导；口播只以声音呈现，不生成口播字幕",
  negativeExtra: "任何护肤品、商品包装、品牌logo、价格、规格、功效文案、购买按钮、口播字幕、自动字幕",
  imagePriority: []
};

let activeProducts = PRODUCTS.filter(isVisibleProduct);
let productCatalogFetchedAt = 0;

function normalizeSharedProduct(product) {
  if (!product?.id || !product?.name || !product?.imageDir) return null;
  return {
    ...product,
    shortName: String(product.shortName || product.name),
    spokenName: String(product.spokenName || product.shortName || product.name),
    category: String(product.category || ""),
    defaultScene: String(product.defaultScene || "真实人物场景"),
    defaultPurpose: String(product.defaultPurpose || "人物展示"),
    visualIdentity: String(product.visualIdentity || "严格保持产品参考图中的包装、颜色、结构和固有文字区域"),
    benefitCues: String(product.benefitCues || "真实展示产品与人物互动"),
    maskDetail: String(product.maskDetail || "产品形态与质地严格遵循参考图"),
    compliance: String(product.compliance || "不生成医疗治疗暗示、绝对化功效或未经审核的商品信息"),
    negativeExtra: String(product.negativeExtra || "包装变形，logo反向，标签乱码，错误商品信息"),
    controlPrompt: String(product.controlPrompt || ""),
    imagePriority: Array.isArray(product.imagePriority) ? product.imagePriority.map(String) : []
  };
}

async function refreshProductsFromWorkbench(force = false) {
  if (!force && Date.now() - productCatalogFetchedAt < PRODUCT_CATALOG_CACHE_MS) return activeProducts;
  try {
    const response = await fetch(WORKBENCH_PRODUCTS_URL, {
      signal: AbortSignal.timeout(3000),
      headers: {
        "X-AI-Workbench-Internal": authManager.internalToken
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const products = (Array.isArray(data) ? data : [])
      .map(normalizeSharedProduct)
      .filter((product) => product && isVisibleProduct(product));
    if (products.length) {
      activeProducts = products;
      productCatalogFetchedAt = Date.now();
    }
  } catch {
    if (!activeProducts.length) activeProducts = PRODUCTS.filter(isVisibleProduct);
  }
  return activeProducts;
}

const DEFAULTS = {
  productId: PRODUCTS[0].id,
  productType: PRODUCTS[0].name,
  videoCount: 5,
  purpose: PRODUCTS[0].defaultPurpose,
  scene: PRODUCTS[0].defaultScene,
  specialRequest: "",
  libtvUrl: "https://www.liblib.tv/canvas?spaceId=1491134&projectId=07f7eee4760b4f338bea1646d0971552",
  imageDir: PRODUCTS[0].imageDir,
  outputDir: DEFAULT_OUTPUT_DIR,
  frameCheck: false,
  fallbackModels: true,
  modelMode: "auto",
  concurrentVideos: 20
};

const MODEL_PRESETS = {
  auto: [
    {
      key: "seedance-vip",
      label: "Seedance 2.0 VIP",
      nodeSuffix: "VIP",
      multi: true,
      args: ["model=Seedance 2.0 VIP", "modeType=image2video", "ratio=9:16", "resolution=720p", "duration=5", "enableSound=off", "searchEnabled=0", "autoCompliance=0", "count=1"]
    },
    {
      key: "seedance-mini",
      label: "Seedance 2.0 Mini",
      nodeSuffix: "Mini",
      multi: true,
      args: ["model=Seedance 2.0 Mini", "modeType=image2video", "ratio=9:16", "resolution=720p", "duration=5", "enableSound=off", "searchEnabled=0", "autoCompliance=0", "count=1"]
    },
    {
      key: "wan27",
      label: "Wan 2.7",
      nodeSuffix: "Wan27",
      multi: true,
      args: ["model=Wan 2.7", "modeType=mixed2video", "ratio=9:16", "resolution=720P", "duration=5", "count=1"]
    },
    {
      key: "seedance-lite",
      label: "Seedance 1.0 Lite",
      nodeSuffix: "Lite",
      multi: false,
      args: ["model=Seedance 1.0 Lite", "modeType=singleImage2video", "ratio=9:16", "resolution=720P", "duration=5", "count=1"]
    }
  ],
  vip: [
    {
      key: "seedance-vip",
      label: "Seedance 2.0 VIP",
      nodeSuffix: "VIP",
      multi: true,
      args: ["model=Seedance 2.0 VIP", "modeType=image2video", "ratio=9:16", "resolution=720p", "duration=5", "enableSound=off", "searchEnabled=0", "autoCompliance=0", "count=1"]
    }
  ],
  mini: [
    {
      key: "seedance-mini",
      label: "Seedance 2.0 Mini",
      nodeSuffix: "Mini",
      multi: true,
      args: ["model=Seedance 2.0 Mini", "modeType=image2video", "ratio=9:16", "resolution=720p", "duration=5", "enableSound=off", "searchEnabled=0", "autoCompliance=0", "count=1"]
    }
  ],
  lite: [
    {
      key: "seedance-lite",
      label: "Seedance 1.0 Lite",
      nodeSuffix: "Lite",
      multi: false,
      args: ["model=Seedance 1.0 Lite", "modeType=singleImage2video", "ratio=9:16", "resolution=720P", "duration=5", "count=1"]
    }
  ]
};

const jobs = new Map();
const personJobs = new Map();
const personSecrets = new Map();
const identityJobs = new Map();
const identitySecrets = new Map();
const automaticGenTokenCache = new Map();
const persistedJobSaveQueues = new Map();
const multimodalAuthSessions = new Map();
const workbenchLibtvManager = createWorkbenchLibtvManager({
  runLibtv: (args, options) => runLibtv(args, options),
  getScope: () => currentProviderScope(),
  parseJson: tryParseJson
});

function referenceAudioCatalog() {
  try {
    const rows = JSON.parse(fs.readFileSync(REFERENCE_AUDIO_MANIFEST, "utf8"));
    if (!Array.isArray(rows)) return [];
    return rows
      .map((item) => {
        const id = String(item?.id || "").trim();
        const file = path.basename(String(item?.file || ""));
        const filePath = path.join(REFERENCE_AUDIO_DIR, file);
        if (!id || !/\.mp3$/i.test(file) || !fs.existsSync(filePath)) return null;
        return {
          id,
          name: String(item.name || id),
          file,
          filePath,
          durationSeconds: Number(item.durationSeconds || 0) || 0,
          style: String(item.style || "自然表达")
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function publicReferenceAudio(item) {
  return {
    id: item.id,
    name: item.name,
    durationSeconds: item.durationSeconds,
    style: item.style,
    previewUrl: `/api/reference-audio/${encodeURIComponent(item.id)}`
  };
}

function resolveReferenceAudio(id) {
  const value = String(id || "").trim();
  if (!value) return null;
  return referenceAudioCatalog().find((item) => item.id === value) || null;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeName(value, fallback = "未命名") {
  const text = String(value || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "").trim();
  return (text || fallback).slice(0, 80);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveProduct(config = {}) {
  const productId = String(config.productId || "");
  const productType = String(config.productType || "");
  if (productId === NO_PRODUCT.id || productType === NO_PRODUCT.name) return NO_PRODUCT;
  return activeProducts.find((product) => product.id === productId || product.name === productType) || activeProducts[0] || PRODUCTS[0];
}

function productNameByStyle(product, style = "short") {
  if (!product || product.noProduct) return "不出现产品";
  return style === "full"
    ? String(product.name || "").trim()
    : String(product.spokenName || product.shortName || product.name || "").trim();
}

function normalizeDialogueProductName(dialogue, product, productName) {
  let text = String(dialogue || "").trim();
  if (!text || !product || product.noProduct || !productName) return text;
  const aliases = Array.from(new Set([
    product.name,
    product.shortName,
    product.spokenName
  ].map((item) => String(item || "").trim()).filter(Boolean))).sort((left, right) => right.length - left.length);
  for (const alias of aliases) {
    if (alias === productName) continue;
    text = text.replace(new RegExp(escapeRegExp(alias), "g"), productName);
  }
  return text;
}

function isKnownProductImageDir(imageDir) {
  if (!imageDir) return false;
  const normalized = path.resolve(String(imageDir)).toLowerCase();
  return activeProducts.some((product) => product.imageDir && path.resolve(product.imageDir).toLowerCase() === normalized);
}

function productForImageDir(imageDir) {
  if (!imageDir) return null;
  const normalized = path.resolve(String(imageDir)).toLowerCase();
  return activeProducts.find((product) => product.imageDir && path.resolve(product.imageDir).toLowerCase() === normalized) || null;
}

function normalizeJobConfig(config = {}) {
  const product = resolveProduct(config);
  const imageDir = String(config.imageDir || "");
  return {
    ...DEFAULTS,
    ...config,
    productId: product.id,
    productType: product.name,
    purpose: config.purpose || product.defaultPurpose || DEFAULTS.purpose,
    scene: config.scene || product.defaultScene || DEFAULTS.scene,
    imageDir: (!imageDir || isKnownProductImageDir(imageDir)) ? product.imageDir : imageDir
  };
}

function publicProducts() {
  return [...activeProducts.filter(isVisibleProduct), NO_PRODUCT].map((product) => ({
    id: product.id,
    name: product.name,
    shortName: product.shortName,
    spokenName: String(product.spokenName || product.shortName || product.name),
    category: product.category || "",
    imageDir: product.imageDir,
    defaultScene: product.defaultScene,
    defaultPurpose: product.defaultPurpose,
    visualIdentity: product.visualIdentity,
    benefitCues: product.benefitCues,
    maskDetail: product.maskDetail,
    compliance: product.compliance,
    negativeExtra: product.negativeExtra,
    controlPrompt: product.controlPrompt || "",
    imagePriority: product.imagePriority || [],
    noProduct: Boolean(product.noProduct),
    usageRule: faceApplicationRule(product)
  }));
}

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function textResponse(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(text);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readRequestBuffer(req, maxBytes = 260 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("上传素材超过 260MB 限制");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readMultipart(req) {
  const contentType = String(req.headers["content-type"] || "");
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
  if (!boundary) throw new Error("缺少 multipart boundary");
  const body = await readRequestBuffer(req);
  const marker = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let cursor = body.indexOf(marker) + marker.length;
  while (cursor >= marker.length) {
    if (body.subarray(cursor, cursor + 2).toString() === "--") break;
    if (body.subarray(cursor, cursor + 2).toString() === "\r\n") cursor += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd < 0) break;
    const headers = body.subarray(cursor, headerEnd).toString("utf8");
    const next = body.indexOf(marker, headerEnd + 4);
    if (next < 0) break;
    let dataEnd = next;
    if (body.subarray(dataEnd - 2, dataEnd).toString() === "\r\n") dataEnd -= 2;
    const data = body.subarray(headerEnd + 4, dataEnd);
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    if (name) {
      if (filename !== undefined) {
        files[name] = {
          filename: path.basename(filename || "material.bin"),
          contentType: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "application/octet-stream",
          data
        };
      } else {
        fields[name] = data.toString("utf8");
      }
    }
    cursor = next + marker.length;
  }
  return { fields, files };
}

function parseSpaceId(libtvUrl) {
  const text = String(libtvUrl || "").trim();
  if (/^\d+$/.test(text)) return text;
  const url = new URL(text);
  const spaceId = url.searchParams.get("spaceId");
  if (!spaceId) throw new Error("LibTV 链接里没有 spaceId");
  return spaceId;
}

function runLibtv(args, options = {}) {
  assertLibtvArgsPromptRulesDisabled(args, { workflow: options.workflow || "人物工作台 LibTV 视频任务" });
  return new Promise((resolve) => {
    const scope = libtvUserContext.getStore();
    if (!scope) {
      resolve({ code: 1, stdout: "", stderr: "LibTV must be used from an authenticated workbench user context" });
      return;
    }
    fs.mkdirSync(scope.configDir, { recursive: true, mode: 0o700 });
    const child = spawn(LIBTV, args, {
      cwd: options.cwd || APP_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        LIBTV_CONFIG_DIR: scope.configDir,
        HOME: scope.configDir,
        USERPROFILE: scope.configDir
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (options.onStdout) options.onStdout(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (options.onStderr) options.onStderr(chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: stderr + "\n" + error.message });
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function libtvCapabilities(force = false) {
  const scope = libtvUserContext.getStore();
  const cache = scope ? libtvCapabilityCaches.get(scope.key) : null;
  if (!force && cache?.data && Date.now() - cache.at < LIBTV_CAPABILITY_CACHE_MS) {
    return cache.data;
  }
  const [imageResult, videoResult] = await Promise.all([
    runLibtv(["model", "search", "-t", "image"]),
    runLibtv(["model", "search", "-t", "video"])
  ]);
  if (imageResult.code !== 0) throw new Error(explainLibtvFailure(imageResult, "读取 LibTV 图片模型失败"));
  if (videoResult.code !== 0) throw new Error(explainLibtvFailure(videoResult, "读取 LibTV 视频模型失败"));
  const mapModels = (payload) => (tryParseJson(payload)?.matches || []).map((item) => ({
    key: String(item.modelKey || ""),
    name: String(item.modelName || item.modelKey || ""),
    description: String(item.description || "")
  })).filter((item) => item.key && item.name);
  const allImages = mapModels(imageResult.stdout);
  const allVideos = mapModels(videoResult.stdout);
  const imageOrder = ["nebula-ultra", "lib-image-2", "jimeng-4.6", "seedream-4.5"];
  const videoOrder = ["star-video2", "star-video2-mini", "wanx2.7-video"];
  const choose = (all, order) => order.map((key) => all.find((item) => item.key === key)).filter(Boolean);
  const data = {
    available: true,
    checkedAt: new Date().toISOString(),
    models: {
      image: choose(allImages, imageOrder).length ? choose(allImages, imageOrder) : allImages.slice(0, 8),
      video: choose(allVideos, videoOrder).length ? choose(allVideos, videoOrder) : allVideos.slice(0, 8)
    }
  };
  if (scope) libtvCapabilityCaches.set(scope.key, { at: Date.now(), data });
  return data;
}

function findLibtvModel(models, value, kind) {
  const model = (models || []).find((item) => item.key === String(value || "") || item.name === String(value || ""));
  if (!model) throw new Error(`所选 LibTV ${kind || ""}模型当前不可用，请刷新模型列表后重新选择`);
  return model;
}

async function libtvStatus() {
  const account = await runLibtv(["account", "info"]);
  return {
    available: account.code === 0,
    installed: fs.existsSync(LIBTV),
    provider: "libtv-cli",
    loginStatus: account.code === 0 ? "connected" : "idle",
    message: account.code === 0
      ? `LibTV 已连接${tryParseJson(account.stdout)?.activeAccount?.accountName ? ` · ${tryParseJson(account.stdout).activeAccount.accountName}` : ""}`
      : compactProviderError(explainLibtvFailure(account, "LibTV 未登录"), "libtv")
  };
}

function startLibtvWebLogin() {
  return {
    ok: false,
    status: "phone_required",
    message: "请返回工作台首页，用当前工作台账号本人的手机号和短信验证码绑定 LibTV。",
    workbenchUrl: WORKBENCH_PUBLIC_URL
  };
}

function quoteKlingCliArgument(value) {
  // The CLI is a Windows .cmd launcher. Keep user-provided prompts as one harmless argument.
  const safe = String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "”")
    .replace(/%/g, "%%")
    .replace(/[&|<>()^!]/g, "^$&");
  return `"${safe}"`;
}

function runNativeProcess(file, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || 30 * 1000;
  return new Promise((resolve) => {
    let child;
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timer = null;
    const done = (payload) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    };
    try {
      child = spawn(file, args, { cwd: options.cwd || APP_ROOT, windowsHide: true });
    } catch (error) {
      return done({ code: 1, stdout, stderr: error.message });
    }
    timer = setTimeout(() => {
      child.kill();
      done({ code: 1, stdout, stderr: `${stderr}\n命令响应超时` });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => done({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code) => done({ code: Number(code || 0), stdout, stderr }));
  });
}

async function resolveKlingCli(force = false) {
  if (!force && Date.now() - klingCliPathCache.at < 10 * 1000) return klingCliPathCache.path;
  const configured = String(process.env.KLING_CLI_PATH || "").trim();
  if (configured && (!/[\\/]/.test(configured) || fs.existsSync(configured))) {
    klingCliPathCache = { at: Date.now(), path: configured };
    return configured;
  }
  if (fs.existsSync(LOCAL_KLING_CLI)) {
    klingCliPathCache = { at: Date.now(), path: LOCAL_KLING_CLI };
    return LOCAL_KLING_CLI;
  }
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const found = await runNativeProcess(finder, [KLING_CLI], { timeoutMs: 5 * 1000 });
  const candidate = found.code === 0
    ? String(found.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null
    : null;
  klingCliPathCache = { at: Date.now(), path: candidate };
  return candidate;
}

function klingInstallSupport() {
  return fs.existsSync(BUNDLED_NODE) && fs.existsSync(BUNDLED_NPM_CLI);
}

function klingProcessEnvironment(baseEnv = process.env) {
  const env = { ...baseEnv };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
  const currentPath = String(env[pathKey] || "");
  const bundledRuntimeDir = path.dirname(BUNDLED_NODE);
  env[pathKey] = [bundledRuntimeDir, currentPath].filter(Boolean).join(path.delimiter);
  return env;
}

async function klingInstallStatus(force = false) {
  const cliPath = await resolveKlingCli(force);
  return {
    installed: Boolean(cliPath),
    canInstall: klingInstallSupport(),
    provider: "kling-cli-cn"
  };
}

async function installKlingCli() {
  const current = await klingInstallStatus(true);
  if (current.installed) return { ...current, changed: false, message: "可灵 CLI 已安装，正在打开官方登录" };
  if (!current.canInstall) throw new Error("工作台缺少可灵安装组件，请通过在线更新安装最新版本后重试");
  if (klingInstallInFlight) return klingInstallInFlight;
  klingInstallInFlight = (async () => {
    await fsp.mkdir(KLING_INSTALL_ROOT, { recursive: true });
    const result = await runNativeProcess(BUNDLED_NODE, [
      BUNDLED_NPM_CLI,
      "install",
      "--global",
      "--prefix", KLING_INSTALL_ROOT,
      KLING_CN_PACKAGE,
      "--registry", KLING_CN_REGISTRY
    ], { cwd: PACKAGE_ROOT, timeoutMs: 4 * 60 * 1000 });
    if (result.code !== 0) {
      const detail = String(result.stderr || result.stdout || "安装命令未完成").trim();
      throw new Error(`可灵 CLI 安装失败：${detail}`);
    }
    const installed = await klingInstallStatus(true);
    if (!installed.installed) throw new Error("可灵 CLI 安装结束，但未检测到启动文件");
    return { ...installed, changed: true, message: "官方中国区可灵 CLI 已安装，正在打开登录页面" };
  })();
  try {
    return await klingInstallInFlight;
  } finally {
    klingInstallInFlight = null;
  }
}

async function runKlingCli(command, args = [], options = {}) {
  const fullArgs = [command, "--quiet", "--skill-name", KLING_SKILL_NAME, "--skill-version", KLING_SKILL_VERSION, ...args];
  const timeoutMs = options.timeoutMs || 90 * 1000;
  const executable = await resolveKlingCli();
  if (!executable) {
    return { code: 1, stdout: "", stderr: "可灵 CLI 尚未安装，请点击“安装并连接可灵”完成官方中国区 CLI 安装" };
  }
  return new Promise((resolve) => {
    const commandLine = [executable, ...fullArgs].map(quoteKlingCliArgument).join(" ");
    const processOptions = {
      cwd: APP_ROOT,
      windowsHide: true,
      env: klingProcessEnvironment()
    };
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${commandLine}"`], { ...processOptions, windowsVerbatimArguments: true })
      : spawn(executable, fullArgs, processOptions);
    let stdout = "";
    let stderr = "";
    let finished = false;
    const done = (payload) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      child.kill();
      done({ code: 1, stdout, stderr: `${stderr}\n可灵 CLI 响应超时` });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => done({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code) => done({ code: Number(code || 0), stdout, stderr }));
  });
}

function parseJsonFromMixedOutput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const direct = tryParseJson(raw);
  if (direct !== null) return direct;
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJson(lines[index]);
    if (parsed !== null) return parsed;
  }
  const bounded = raw.slice(-256 * 1024);
  const closingPositions = [];
  for (let index = bounded.length - 1; index >= 0 && closingPositions.length < 24; index -= 1) {
    if (bounded[index] === "}" || bounded[index] === "]") closingPositions.push(index + 1);
  }
  for (const end of closingPositions) {
    for (let start = bounded.lastIndexOf("{", end - 1), attempts = 0; start >= 0 && attempts < 80; start = bounded.lastIndexOf("{", start - 1), attempts += 1) {
      const parsed = tryParseJson(bounded.slice(start, end));
      if (parsed !== null) return parsed;
    }
    for (let start = bounded.lastIndexOf("[", end - 1), attempts = 0; start >= 0 && attempts < 40; start = bounded.lastIndexOf("[", start - 1), attempts += 1) {
      const parsed = tryParseJson(bounded.slice(start, end));
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function unwrapKlingBody(value) {
  let current = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current === "string") {
      const parsed = parseJsonFromMixedOutput(current);
      if (parsed === null) return current;
      current = parsed;
      continue;
    }
    if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, "body")) {
      current = current.body;
      continue;
    }
    break;
  }
  return current;
}

function sanitizeProviderDiagnostic(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/((?:set-cookie|cookie)\s*:\s*)[^\n]+/gi, "$1[redacted]")
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|token|signature|credential|authorization|cookie)["']?\s*[:=]\s*["']?)[^"',;\s}\\]+/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
      const trailing = rawUrl.match(/[),.;]+$/)?.[0] || "";
      const cleanUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
      try {
        const parsed = new URL(cleanUrl);
        const safeUrl = `${parsed.origin}${parsed.pathname}${parsed.search ? "?[query-redacted]" : ""}${parsed.hash || ""}`;
        return `${safeUrl}${trailing}`;
      } catch {
        return rawUrl;
      }
    })
    .replace(/([?&](?:[a-z0-9_-]*(?:token|signature|credential|authorization)|access[_-]?token|refresh[_-]?token)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .trim()
    .slice(0, 64 * 1024);
}

function createProviderError(message, diagnostic) {
  const error = new Error(String(message || "生成服务调用失败"));
  error.providerDiagnostic = sanitizeProviderDiagnostic(diagnostic || message);
  return error;
}

function providerErrorDiagnostic(value) {
  return sanitizeProviderDiagnostic(
    value?.providerDiagnostic
    || value?.diagnostic
    || value?.stack
    || value?.message
    || value
    || ""
  );
}

function parseKlingResult(result) {
  const stdout = String(result?.stdout || "").trim();
  const stderr = String(result?.stderr || "").trim();
  const payload = parseJsonFromMixedOutput(stdout) || parseJsonFromMixedOutput(stderr);
  const body = unwrapKlingBody(payload);
  const explicitFailure = payload && typeof payload === "object" && payload.ok === false;
  if (result?.code !== 0 || explicitFailure || !payload) {
    const bodyObject = body && typeof body === "object" ? body : null;
    const message = bodyObject?.message
      || bodyObject?.error
      || payload?.error
      || (typeof body === "string" ? body : "")
      || stderr
      || stdout
      || "可灵 CLI 调用失败";
    throw createProviderError(message, [stderr, stdout].filter(Boolean).join("\n"));
  }
  return body;
}

function compactKlingModels(capabilities, tool) {
  const entry = capabilities?.availableModels?.[tool] ?? capabilities?.available_models?.[tool] ?? [];
  const raw = Array.isArray(entry) ? entry : Array.isArray(entry?.models) ? entry.models : [];
  return Array.isArray(raw) ? raw.map((item) => ({
    model: String(item.model || ""),
    alias: String(item.alias || item.model || ""),
    description: String(item.description || ""),
    arguments: Array.isArray(item.arguments) ? item.arguments : [],
    inputs: Array.isArray(item.inputs) ? item.inputs : []
  })).filter((item) => item.model).map((item) => ({
    ...item,
    singleImageReference: tool === "image_to_image" ? supportsSingleIdentityReference(item) : undefined
  })) : [];
}

function supportsSingleIdentityReference(model) {
  if (!model) return false;
  const shape = klingReferenceInputShape(model);
  const realReferenceNames = shape.inputNames.filter((name) => /image/i.test(name)
    && !/^raw_/i.test(name)
    && !/(?:tail|last|end)_?image/i.test(name));
  const allowedSingleInput = realReferenceNames.length === 1
    && /^(?:image_?1|subject_image_1|first_image|image)$/i.test(realReferenceNames[0]);
  return allowedSingleInput && shape.max === 1 && shape.required <= 1;
}

function assertSingleIdentityReferenceModel(model) {
  if (!supportsSingleIdentityReference(model)) {
    throw new Error("所选可灵图片模型需要多张主体或场景参考图，不适合单张正面照生成三视图；请刷新模型并选择支持“图片1”的模型");
  }
  return model;
}

async function klingCapabilities(force = false) {
  if (!force && klingCapabilityCache.data && Date.now() - klingCapabilityCache.at < KLING_CAPABILITY_CACHE_MS) {
    return klingCapabilityCache.data;
  }
  const result = await runKlingCli("who_am_i", [], { timeoutMs: 30 * 1000 });
  const body = parseKlingResult(result);
  const data = {
    available: true,
    checkedAt: new Date().toISOString(),
    models: {
      imageToVideo: compactKlingModels(body, "image_to_video"),
      imageToImage: compactKlingModels(body, "image_to_image").filter(supportsSingleIdentityReference)
    }
  };
  klingCapabilityCache = { at: Date.now(), data };
  return data;
}

async function klingAccountStatus() {
  return parseKlingResult(await runKlingCli("account", [], { timeoutMs: 30 * 1000 }));
}

function summarizeKlingAccount(account) {
  const credits = Number(account?.availableRemainCredits ?? account?.available_remain_credits);
  const rawUserId = account?.userId
    ?? account?.user_id
    ?? account?.user?.userId
    ?? account?.user?.user_id
    ?? "";
  return {
    userId: rawUserId === null || rawUserId === undefined ? "" : String(rawUserId),
    availableRemainCredits: Number.isFinite(credits) ? credits : null,
    membershipTypeDescription: String(
      account?.membershipTypeDescription
      || account?.membership_type_description
      || account?.membershipType
      || account?.membership_type
      || ""
    ),
    creditScope: "personal"
  };
}

function safeKlingAuthMessage(prefix, error) {
  if (!error) return prefix;
  const safeDetail = compactProviderError(error, "kling");
  return safeDetail ? `${prefix}：${safeDetail}` : prefix;
}

function buildKlingConnectedAuthStatus(capabilities, account, accountError = null, canInstall = false) {
  const accountSummary = summarizeKlingAccount(account);
  const base = {
    available: true,
    installed: true,
    canInstall,
    provider: "kling-cli",
    requiredTeamSpace: "WIS品牌营销部",
    teamSpaceControlAvailable: false,
    teamSpaceVerification: "manual",
    ...accountSummary
  };
  if (accountError || !accountSummary.userId) {
    return {
      ...base,
      identityAvailable: false,
      message: safeKlingAuthMessage(
        "可灵 CLI 功能已连接，但暂时无法读取当前登录账号；请点击“重新连接可灵”后重试，模型功能仍可使用",
        accountError
      )
    };
  }
  const accountLabel = `，当前登录账号 ID ${accountSummary.userId}`;
  const membershipLabel = accountSummary.membershipTypeDescription ? `（${accountSummary.membershipTypeDescription}）` : "";
  return {
    ...base,
    identityAvailable: true,
    message: accountSummary.availableRemainCredits === 0
      ? `可灵 CLI 已连接${accountLabel}${membershipLabel}；官方接口当前显示个人空间余额为0，团队空间余额请以可灵空间页为准，工作站不会提前拦截生成`
      : Number.isFinite(accountSummary.availableRemainCredits)
        ? `可灵 CLI 已连接${accountLabel}${membershipLabel}，个人空间可用灵感值 ${accountSummary.availableRemainCredits}；团队空间余额以可灵空间页为准`
        : `可灵 CLI 已连接${accountLabel}${membershipLabel}，可用视频模型 ${capabilities?.models?.imageToVideo?.length || 0} 个、图片模型 ${capabilities?.models?.imageToImage?.length || 0} 个；团队空间余额以可灵空间页为准`
  };
}

function assertKlingCredits(account) {
  // 官方 account 当前只返回个人空间余额，不包含团队空间余额。
  // 团队成员可能个人余额为 0、团队空间仍有额度，因此不能在提交前误拦截。
  return summarizeKlingAccount(account).availableRemainCredits;
}

function assertKlingTeamSpaceConfirmation(value) {
  if (!(value === true || String(value).toLowerCase() === "true")) {
    throw new Error("请先在可灵网页切换到“WIS品牌营销部”空间，并在工作台勾选团队空间确认");
  }
}

function findKlingModel(models, value) {
  const model = (models || []).find((item) => item.model === String(value || ""));
  if (!model) throw new Error("所选可灵模型当前不可用，请刷新模型列表后重新选择");
  return model;
}

function klingArgument(model, name) {
  return (model?.arguments || []).find((item) => item.name === name) || null;
}

function klingReferenceInputShape(model) {
  const inputs = Array.isArray(model?.inputs) ? model.inputs : [];
  const realImageInputs = inputs.filter((input) => {
    const name = String(input?.name || "");
    return /image/i.test(name)
      && !/^raw_/i.test(name)
      && !/(?:tail|last|end)_?image/i.test(name);
  });
  const numbered = realImageInputs.map((input) => {
    const name = String(input?.name || "");
    const match = name.match(/(?:^|_)(?:subject_)?image_(\d+)$/i) || name.match(/^image(\d+)$/i);
    return match ? Number(match[1]) : 0;
  }).filter((value) => Number.isFinite(value) && value > 0);
  const max = !realImageInputs.length
    ? 0
    : numbered.length
      ? Math.max(...numbered)
      : realImageInputs.some((input) => /first_image|^image$/i.test(String(input?.name || "")))
        ? 1
        : realImageInputs.length;
  const required = Math.min(max, realImageInputs.filter((input) => input?.required === true).length);
  return {
    max,
    required,
    imageInputCount: realImageInputs.length,
    numbered: numbered.length > 0,
    pairedRaw: inputs.some((input) => /^raw_(?:subject_)?image_\d+$/i.test(String(input?.name || ""))),
    inputNames: inputs.map((input) => String(input?.name || "")).filter(Boolean)
  };
}

function maxKlingReferenceImages(model) {
  return klingReferenceInputShape(model).max;
}

function selectKlingReferences(model, identityReferences, productReferences = []) {
  const identity = [...new Set((identityReferences || []).filter(Boolean))];
  const products = [...new Set((productReferences || []).filter(Boolean))];
  const shape = klingReferenceInputShape(model);
  if (!identity.length) throw new Error("人物参考图尚未准备完成");
  if (shape.max < 1) throw new Error("所选可灵模型没有声明可用的图片参考输入，请刷新模型能力后重新选择");
  if (products.length && shape.max < 2) {
    throw new Error("所选可灵模型仅支持单张参考图，不能同时锁定人物与产品。请改选支持多参考图的可灵模型后重试。");
  }
  const ordered = products.length
    ? [identity[0], products[0], ...identity.slice(1), ...products.slice(1)]
    : identity;
  const selected = [...new Set(ordered)].slice(0, shape.max);
  if (selected.length < shape.required) {
    throw new Error(`所选可灵模型至少需要 ${shape.required} 张不同的参考图，当前只有 ${selected.length} 张可用`);
  }
  return selected;
}

function preferredKlingValue(model, name, preferred) {
  const argument = klingArgument(model, name);
  if (!argument) return "";
  const allowed = argument.allowedValues || argument.allowed_values || [];
  if (allowed.includes(preferred)) return preferred;
  return String(argument.default || "");
}

function klingGenerationId(payload) {
  const data = payload?.data || payload || {};
  return String(data.generationId || data.generation_id || data.id || "");
}

function klingStatus(payload) {
  const data = payload?.data || payload || {};
  return String(data.status || data.taskStatus || data.task_status || "").toLowerCase();
}

function klingResultUrl(payload, contentType = "video") {
  const data = payload?.data || payload || {};
  const works = data.works || payload?.works || [];
  const work = Array.isArray(works) ? works.find((item) => !contentType || item.contentType === contentType) || works[0] : null;
  return String(work?.urlWithoutWatermark || work?.url || work?.resourceUrl || "");
}

function klingUploadedUrl(payload) {
  const data = payload?.data || payload || {};
  return String(data.url || data.fileUrl || data.file_url || payload?.url || "");
}

function klingTaskIsDone(status) {
  return ["completed", "partial_completed", "succeed", "succeeded", "success"].includes(String(status || "").toLowerCase());
}

function klingTaskFailed(status) {
  return ["failed", "cancelled", "canceled", "expired"].includes(String(status || "").toLowerCase());
}

async function waitForKlingTask(job, task, generationId, contentType, saveFn) {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const body = parseKlingResult(await runKlingCli("query_tasks", [generationId], { timeoutMs: 30 * 1000 }));
    const status = klingStatus(body) || "queued";
    task.remoteStatus = status;
    task.progress = klingTaskIsDone(status) ? 100 : status.includes("running") || status.includes("processing") ? 55 : 15;
    await saveFn(job);
    if (klingTaskIsDone(status)) {
      const url = klingResultUrl(body, contentType);
      if (!url) throw new Error("可灵任务已完成，但未返回可播放结果");
      return { body, url };
    }
    if (klingTaskFailed(status)) {
      const data = body?.data || body || {};
      throw new Error(String(data.error || data.message || `可灵任务${status}`));
    }
    await wait(2500);
  }
  throw new Error("可灵任务等待超过15分钟，请在任务列表中查看最终状态后决定是否重新生成");
}

function openFolder(folder) {
  return new Promise((resolve, reject) => {
    const opener = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(opener, [folder], {
      windowsHide: true,
      detached: true,
      stdio: "ignore"
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractMp4(text) {
  const matches = String(text || "").match(/https:\/\/[^"\s]+\.mp4/g);
  if (!matches?.length) return "";
  const generated = matches.filter((url) => /\/sd-gen-save-img\/|\/generated?\//i.test(url));
  const nonUpload = matches.filter((url) => !/\/upload-images\//i.test(url));
  return generated[generated.length - 1] || nonUpload[nonUpload.length - 1] || matches[matches.length - 1];
}

function extractImageUrl(text) {
  const matches = String(text || "").match(/https?:\/\/[^"'\s]+\.(?:png|jpe?g|webp)(?:\?[^"'\s]*)?/gi);
  return matches && matches.length ? matches[matches.length - 1] : "";
}

function compactProviderError(value, provider = "") {
  const text = sanitizeProviderDiagnostic(value?.message || value || "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[素材地址已隐藏]")
    .replace(/\r/g, "")
    .trim();
  if (/insufficient credits|灵感值不足|余额不足/i.test(text)) {
    return provider === "libtv"
      ? "LibTV 账户积分不足，请切换可灵或补充积分后重试"
      : "可灵灵感值不足，请切换 LibTV 或充值后重试";
  }
  if (/剩余灵感值为0/i.test(text)) {
    return "可灵剩余灵感值为0，请切换 LibTV，或充值后再生成";
  }
  if (/write 图片X|reference an input image|prompt\(必填\)/i.test(text)) {
    return "可灵未识别人物参考图，请刷新模型并选择支持单张“图片1”参考的可灵图片模型，或切换 LibTV。";
  }
  if (/too many requests|slow down|请求过多|频繁/i.test(text)) {
    return provider === "libtv"
      ? "LibTV 当前请求较多，请稍后重试"
      : "可灵当前请求繁忙，请稍后重试，或切换 LibTV";
  }
  if (/未登录|unauthorized|401/i.test(text)) {
    return provider === "libtv" ? "LibTV 尚未登录，请先连接 LibTV" : "可灵尚未登录，请先连接可灵";
  }
  if (/subject_image_\d+|raw_subject_image_\d+|different reference images|参考图数量|reference images?/i.test(text)) {
    return "所选可灵模型的参考图数量或输入形态不匹配，请刷新模型能力后重新生成本条";
  }
  const meaningful = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !/^\[kling\]/i.test(line)
      && !/^arguments?:/i.test(line)
      && !/^inputs?:/i.test(line)
      && !/^https?:\/\//i.test(line)
      && line.length <= 600);
  return (meaningful || text || "生成失败").slice(0, 280);
}

function isKlingImageReferenceValidationError(value) {
  const text = String(value?.message || value || "");
  return /write 图片X|reference an input image|prompt\(必填\)|没有正确引用人物图片|未识别人物参考图/i.test(text);
}

function explainLibtvFailure(result, fallback) {
  const text = `${result?.stderr || ""}\n${result?.stdout || ""}`;
  const apiCode = text.match(/code:\s*(\d+)/)?.[1] || text.match(/接口错误\s*\[(\d+)\]/)?.[1] || "";
  const apiMessage = text.match(/msg:\s*'([^']+)'/)?.[1] || text.match(/接口错误\s*\[\d+\]:\s*(.+)/)?.[1]?.trim() || "";

  if (apiCode === "401" || /未登录/.test(text)) {
    return "LibTV CLI 未登录。";
  }

  if (apiCode === "10001" || /用户未授权/.test(text)) {
    return "LibTV 用户未授权。当前 CLI 登录账号没有这个 LibTV 空间的操作权限，或登录的团队账号不对；请重新登录/切换账号，并确认能打开当前 LibTV 链接里的空间。";
  }

  return `${fallback}：${apiMessage || text.trim() || "未知错误"}`;
}

function imageRank(file, product) {
  const name = path.basename(file);
  const priority = product?.imagePriority || [];
  const index = priority.findIndex((part) => name.includes(part));
  return index === -1 ? 1000 : index;
}

async function listImageFiles(imageDir, product = null) {
  const currentProduct = product || productForImageDir(imageDir);
  const entries = await fsp.readdir(imageDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(imageDir, entry.name))
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .sort((a, b) => imageRank(a, currentProduct) - imageRank(b, currentProduct) || a.localeCompare(b, "zh-Hans-CN"));
}

function buildVariants(config) {
  const count = Math.max(1, Math.min(20, Number(config.videoCount || 1)));
  const product = resolveProduct(config);
  const productType = String(config.productType || "护肤产品");
  const purpose = String(config.purpose || "生活种草");
  const scene = String(config.scene || "日常护肤");
  const specialRequest = String(config.specialRequest || "").trim();
  const isBeach = /海|沙滩|海边|beach/i.test(scene);
  const beachCores = [
    ["清晨海边护肤托盘", "清晨海边露台小桌，浅色陶瓷托盘承载产品，前景透明水杯和少量贝壳柔焦，后景海面、白色纱帘和晨光虚化。"],
    ["沙滩包随身补水", "浅米色沙滩边的藤编托特包半开，沙滩垫上放置产品，前景太阳镜和无字白色防晒帽虚化，后景海浪和蓝白遮阳伞柔焦。"],
    ["海边酒店浴室护理", "海边酒店浴室洗手台，浅米色石材台面、白毛巾、透明玻璃杯水珠，后景窗外海景和镜柜灯虚化。"],
    ["日落沙滩晚间修护", "日落海边浅色木质小桌，产品、干净白毛巾、透明水杯同框，后景海平线和暖色天空虚化。"],
    ["海边露营桌清爽补水", "海边露营折叠桌，浅木色桌板、透明冷饮杯、无字帆布小包，后景海岸线、浅色帐篷边和蓝天柔焦。"],
    ["泳池边清透补水", "海景泳池边浅色石材台，前景水面高光和透明水珠，后景蓝白泳池线条与远处海面虚化。"],
    ["海风窗边梳妆台", "海景房窗边梳妆台，自然光穿过白纱帘，产品置于镜前，前景化妆棉和发夹轻微虚化。"],
    ["沙滩毛巾桌拍", "浅色沙滩毛巾上整齐摆放产品，前景贝壳和水珠细节，后景海浪高光柔和虚化。"]
  ];
  const genericCores = [
    [`${scene}产品正面展示`, `${scene}里的干净台面，产品居中正面露出，前景有少量生活道具柔焦，后景保持明亮有层次。`],
    [`${scene}质地细节`, `${scene}里的浅色承载面，微距展示产品和质地细节，水珠与柔光增强护肤感。`],
    [`${scene}日常随手可用`, `${scene}里的真实生活台面，产品像日常护肤流程中的随手用品，画面清爽自然。`],
    [`${scene}清爽收纳`, `${scene}里的透明收纳或托盘，产品和参考图整齐排列，背景干净。`],
    [`${scene}结束定格`, `${scene}里的产品最终正面定格，包装清晰、背景克制、无额外文字。`]
  ];
  const blackCrystalCores = [
    [`${scene}黑晶包装正面展示`, `${scene}中的深色石材或暖白石材台面，黑晶面膜盒正面居中站立，金色logo和蓝色底部色带清晰，前景有克制水珠与黑色膜布边缘柔焦，后景为镜面、壁灯或磨砂玻璃柔和虚化，灯光微暖且自然。`],
    [`${scene}石墨烯膜布质地`, `${scene}里的浅深对比台面，黑色石墨烯膜布平整展开，蜂窝纹理清晰可见且带湿润精华高光，包装盒在中景保持正面可辨识，前景少量透明精华液和水珠，后景干净有层次。`],
    [`${scene}蓄能科技光感`, `${scene}里的透明亚克力或黑色玻璃展台，包装与单片面膜错落摆放，蓝色克制光带沿台面反射，暗示蓄能科技感但不出现文字说明，前景晶格纹理柔焦，后景简洁。`],
    [`${scene}紧致淡纹护理氛围`, `${scene}里的高端浴室梳妆台或私享水疗台，产品与黑色膜布、柔软白毛巾同框，镜头强调包装质感和膜布湿润服帖，背景暖白壁灯与石材纹理虚化，整体高级、安静、可信。`],
    [`${scene}保湿锁水定格`, `${scene}里的石材承载面有一层很薄的水膜反射，黑晶包装、单片包装和湿润黑色膜布形成三角构图，产品标签区域清晰，后景留白干净，最终画面稳定定格。`]
  ];
  const eyeMaskCores = [
    [`${scene}圆罐正面展示`, `${scene}里的浅米色石材梳妆台，白色圆罐眼膜正面居中放置，蓝色 +WIS+ 标签和 CRYSTAL FIRMING EYE MASK 包装区域清晰可辨，前景有透明水珠和干净银色小勺柔焦，后景为镜面边缘、柔软白毛巾和磨砂窗光虚化，整体清透高级。`],
    [`${scene}开盖凝胶眼贴`, `${scene}里的白色圆罐轻微开盖，罐内蓝色凝胶眼贴整齐叠放，眼贴呈月牙形、透明水润、精华充盈，罐身蓝色品牌标签在中景保持可辨识，前景有少量精华水光，后景浅色浴室墙面和毛巾柔焦。`],
    [`${scene}弹润凝胶质地`, `${scene}里的透明亚克力托盘上，一片蓝色凝胶眼贴轻放在罐盖旁，边缘柔软服帖、带细腻水光和微微弹润反光，白色圆罐在后方正面露出，前景水珠滑过，后景干净留白。`],
    [`${scene}眼周精致护理氛围`, `${scene}里的高端梳妆台或私享水疗台，白色圆罐眼膜与银色小勺、折叠白毛巾、透明水杯同框，镜头强调眼周护理的精致感与温和舒缓氛围，蓝色凝胶眼贴局部可见但不出现人物眼球特写，背景暖白壁灯和镜面虚化。`],
    [`${scene}水润紧致定格`, `${scene}里的浅色石材承载面有一层很薄的水膜反射，白色眼膜圆罐、开盖蓝色凝胶眼贴和小勺形成三角构图，产品标签区域清晰，后景留白干净，最终画面稳定定格，表达保湿、抗皱、紧致的清爽护肤质感。`]
  ];
  const ningyanCores = [
    [`${scene}四件套正面陈列`, `${scene}里的浅米色石材台面，凝颜四件套完整同框：两支电光蓝高瓶站在中景左侧和中央，蓝色洁面软管站在右侧，蓝色面霜罐开盖置于前景偏右，四件产品标签都朝向镜头，前景少量透明水珠与柔焦玻璃反光，后景镜面边缘和磨砂窗光虚化，整体高级干净。`],
    [`${scene}蓝色玻璃套组光感`, `${scene}里的透明亚克力阶梯展台，四件蓝色包装按高低层次排列，瓶身通透蓝光和银色金属圈有柔和高光，洁面软管不被遮挡，面霜罐在前景形成稳定三角构图，后景为蓝白渐变墙和冷白轮廓光，强调套组科技抗老感但不出现额外文字。`],
    [`${scene}水乳霜质地层次`, `${scene}里的白色陶瓷托盘和透明玻璃片上，有清透精粹水水珠、轻盈乳液光泽、丰盈白色面霜膏体三种质地做前景点缀，四件套在中景完整可辨，标签区域清晰，镜头从质地高光转焦到 +WIS+ 套组包装，后景柔和留白。`],
    [`${scene}温和洁面护理`, `${scene}里的高端浴室洗漱台，蓝色洁面软管在右侧正面清晰，前景有细腻绵密泡沫但不遮挡标签，左侧两支高瓶和前景面霜罐作为同系列套组背景出现，白毛巾和玻璃杯在后景虚化，表达温和清洁后接续抗老护理流程。`],
    [`${scene}抗老套装定格`, `${scene}里的精品专柜或私享水疗台，凝颜四件套按“水、乳、洁面、霜”的完整组合稳稳陈列，电光蓝包装与白色标签形成统一视觉，前景薄水膜倒影和少量透明玻璃块增强高级感，后景暖白壁龛和灯带柔焦，最终正面中景定格，四件产品都不缺失、不变形。`]
  ];
  const source = product.id === "wis-black-crystal-mask"
    ? blackCrystalCores
    : product.id === "wis-crystal-firming-eye-mask"
      ? eyeMaskCores
      : product.id === "wis-ningyan-anti-aging-set"
        ? ningyanCores
      : isBeach
        ? beachCores
        : genericCores;

  return Array.from({ length: count }, (_, idx) => {
    const [coreElement, sceneDetail] = source[idx % source.length];
    const index = idx + 1;
    const positivePrompt = [
      `5秒竖屏9:16，三镜头产品展示短视频，基于输入的${productType}产品参考图，严格保持${product.visualIdentity}，保持产品包装外观、颜色、瓶型/罐型/管型/盒型/袋型比例、套组数量、logo位置和产品本身固有标签区域一致，不新增任何非产品文字。整体为${purpose}类${scene}场景，真实商业护肤品广告质感，画面干净、有层次，低速稳定运镜，产品始终清晰不变形。视觉重点：${product.benefitCues}。合规边界：${product.compliance}。`,
      specialRequest ? `本次特殊要求：${specialRequest}。该要求优先体现在画面质感、产品数量、陈列方式、道具氛围、质地水润度、原生感或精致感上；不得改变产品本身包装、logo、标签、瓶型、套组组成和合规边界。` : "",
      `镜头1，0-1.6秒：${sceneDetail}镜头缓慢推近，建立真实生活场景和产品使用氛围。`,
      `镜头2，1.6-3.3秒：微距低速平移扫过产品包装边缘、套组结构、膜片或质地细节；如果画面出现膜片、膏体、乳液、泡沫或精华质地，${product.maskDetail}；前景水珠或精华高光轻微滑动，中景包装保持可辨识，焦点自然转到产品标签区域。`,
      "镜头3，3.3-5秒：正面中景定格，产品位于画面中央，生活道具围绕但不遮挡包装，后景柔和虚化，镜头小幅环绕后稳定收尾，结尾保持纯净产品画面，只保留产品包装固有文字。"
    ].join("\n");
    return {
      index,
      productPurpose: purpose,
      coreElement,
      positivePrompt,
      negativePrompt: `包装变形，标签乱码，文字错误，logo漂移，产品变形，主体丢失，镜头晃动，快速闪烁，过度粒子，背景杂乱，低清晰度，水印，字幕，标题字，角标文字，漂浮文字，贴纸文字，说明文字，解析性文字，结尾字幕，非产品包装文字，${product.negativeExtra}`
    };
  });
}

function createJob(config) {
  const id = `job-${nowStamp()}-${Math.random().toString(16).slice(2, 8)}`;
  const job = {
    id,
    libtvOwner: libtvJobOwner(),
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    promptRules: null,
    config,
    outputDir: "",
    logs: [],
    tasks: [],
    summary: {
      success: 0,
      failed: 0,
      total: Number(config.videoCount || 1)
    }
  };
  jobs.set(id, job);
  return job;
}

function log(job, message, level = "info") {
  const row = { at: new Date().toISOString(), level, message };
  job.logs.push(row);
  if (job.logs.length > 800) job.logs.shift();
  job.updatedAt = row.at;
}

async function saveJob(job) {
  await fsp.mkdir(JOBS_DIR, { recursive: true });
  await fsp.writeFile(path.join(JOBS_DIR, `${job.id}.json`), JSON.stringify(job, null, 2), "utf8");
  if (job.outputDir) {
    await fsp.mkdir(job.outputDir, { recursive: true });
    await fsp.writeFile(path.join(job.outputDir, "job.json"), JSON.stringify(job, null, 2), "utf8");
  }
}

async function loadPersistedJobs() {
  await fsp.mkdir(JOBS_DIR, { recursive: true });
  const files = await fsp.readdir(JOBS_DIR);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const job = JSON.parse(await fsp.readFile(path.join(JOBS_DIR, file), "utf8"));
      if (!job || !job.id) continue;
      if (!Array.isArray(job.logs)) job.logs = [];
      if (!Array.isArray(job.tasks)) job.tasks = [];
      if (!job.summary) {
        job.summary = {
          success: job.tasks.filter((task) => task.status === "success").length,
          failed: job.tasks.filter((task) => task.status === "failed").length,
          total: job.tasks.length
        };
      }
      jobs.set(job.id, job);
      if (["queued", "running"].includes(job.status)) {
        job.status = "interrupted";
        job.error = "本地服务上次运行时中断，请重新点击开始生成。";
        for (const task of job.tasks) {
          if (["queued", "running"].includes(task.status)) task.status = "interrupted";
        }
        log(job, "本地服务上次运行时中断，旧任务已停止。请重新开始生成。", "warn");
        await saveJob(job);
      }
    } catch (error) {
      console.warn(`跳过异常任务记录：${file} ${error.message}`);
    }
  }
}

function jobTime(job) {
  const value = Date.parse(job.updatedAt || job.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function summarizeJob(job) {
  const config = job.config || {};
  const firstCanvasTask = Array.isArray(job.tasks) ? job.tasks.find((task) => task.canvasUrl) : null;
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    summary: job.summary,
    outputDir: job.outputDir,
    productId: config.productId,
    productType: config.productType,
    purpose: config.purpose,
    scene: config.scene,
    specialRequest: config.specialRequest || "",
    videoCount: config.videoCount,
    canvasUrl: job.canvasUrl || firstCanvasTask?.canvasUrl || ""
  };
}

function listJobs(limit = 0) {
  const rows = Array.from(jobs.values())
    .filter(jobOwnedByCurrentUser)
    .sort((a, b) => jobTime(b) - jobTime(a))
    .map(summarizeJob);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

async function createCanvas(job, task, spaceId) {
  const canvasName = `凡岛AI项目组_${safeName(job.config.productType)}_${safeName(task.productPurpose)}_${safeName(task.coreElement)}_${nowStamp()}`;
  task.canvasName = canvasName;
  log(job, `创建画布：${task.coreElement}`);
  const result = await runLibtv(["project", "create", canvasName, "-w", String(spaceId)]);
  task.createCanvasRaw = { stdout: result.stdout, stderr: result.stderr, code: result.code };
  if (result.code !== 0) {
    throw new Error(explainLibtvFailure(result, `创建画布失败（spaceId=${spaceId}）`));
  }
  const parsed = tryParseJson(result.stdout);
  let projectId = parsed?.uuid || parsed?.projectUuid || parsed?.data?.uuid || parsed?.data?.projectUuid || "";
  if (!projectId) {
    const list = await runLibtv(["project", "list", "--name", canvasName, "-w", String(spaceId), "-s", "10"]);
    const meta = tryParseJson(list.stdout);
    projectId = meta?.projectMetaList?.find((item) => item.name === canvasName)?.uuid || "";
  }
  if (!projectId) throw new Error(`画布创建成功但没有取到 projectId：${canvasName}`);
  task.projectId = projectId;
  task.canvasUrl = `https://www.liblib.tv/canvas?spaceId=${spaceId}&projectId=${projectId}`;
}

async function createBatchCanvas(job, spaceId) {
  const canvasName = `凡岛AI项目组_${safeName(job.config.productType)}_${safeName(job.config.purpose)}_${safeName(job.config.scene)}_${nowStamp()}`;
  job.canvasName = canvasName;
  log(job, `创建批次画布：${canvasName}`);
  const result = await runLibtv(["project", "create", canvasName, "-w", String(spaceId)]);
  job.createCanvasRaw = { stdout: result.stdout, stderr: result.stderr, code: result.code };
  if (result.code !== 0) {
    throw new Error(explainLibtvFailure(result, `创建批次画布失败（spaceId=${spaceId}）`));
  }
  const parsed = tryParseJson(result.stdout);
  let projectId = parsed?.uuid || parsed?.projectUuid || parsed?.data?.uuid || parsed?.data?.projectUuid || "";
  if (!projectId) {
    const list = await runLibtv(["project", "list", "--name", canvasName, "-w", String(spaceId), "-s", "10"]);
    const meta = tryParseJson(list.stdout);
    projectId = meta?.projectMetaList?.find((item) => item.name === canvasName)?.uuid || "";
  }
  if (!projectId) throw new Error(`批次画布创建成功但没有取到 projectId：${canvasName}`);
  job.projectId = projectId;
  job.canvasUrl = `https://www.liblib.tv/canvas?spaceId=${spaceId}&projectId=${projectId}`;
  log(job, `批次画布已创建：${job.canvasUrl}`);
  return { canvasName, projectId, canvasUrl: job.canvasUrl };
}

async function uploadImages(job, task, imageFiles) {
  task.uploads = [];
  for (let i = 0; i < imageFiles.length; i += 1) {
    const nodeName = `产品图-${i + 1}`;
    const x = 80 + i * 280;
    const y = 80;
    log(job, `上传参考图 ${i + 1}/${imageFiles.length}：${task.coreElement}`);
    const result = await runLibtv(["upload", nodeName, "-p", task.projectId, "-f", imageFiles[i], "--x", String(x), "--y", String(y)]);
    const parsed = tryParseJson(result.stdout);
    if (result.code !== 0) throw new Error(`上传失败：${path.basename(imageFiles[i])}\n${result.stderr || result.stdout}`);
    task.uploads.push({ nodeName, path: imageFiles[i], nodeKey: parsed?.nodeKey || "" });
  }
}

async function uploadBatchImages(job, imageFiles, projectId) {
  const uploads = [];
  for (let i = 0; i < imageFiles.length; i += 1) {
    const nodeName = `产品图-${i + 1}`;
    const x = 80 + (i % 10) * 260;
    const y = 80 + Math.floor(i / 10) * 300;
    log(job, `上传批次参考图 ${i + 1}/${imageFiles.length}`);
    const result = await runLibtv(["upload", nodeName, "-p", projectId, "-f", imageFiles[i], "--x", String(x), "--y", String(y)]);
    const parsed = tryParseJson(result.stdout);
    if (result.code !== 0) throw new Error(`上传失败：${path.basename(imageFiles[i])}\n${result.stderr || result.stdout}`);
    uploads.push({ nodeName, path: imageFiles[i], nodeKey: parsed?.nodeKey || "" });
  }
  job.uploads = uploads;
  log(job, `批次参考图上传完成：${uploads.length} 张`);
  return uploads;
}

async function runVideo(job, task, imageFiles) {
  const configured = MODEL_PRESETS[job.config.modelMode] || MODEL_PRESETS.auto;
  const models = job.config.fallbackModels === false ? configured.slice(0, 1) : configured;
  const prompt = `${task.positivePrompt}\n负面提示词：${task.negativePrompt}\n严格保持输入产品参考图中的${job.config.productType}包装、产品形态与膜片外观一致，只允许保留产品包装、盒身、标签、logo等产品本身固有文字，不生成任何额外文字。`;
  task.attempts = [];
  for (const model of models) {
    const leftNodes = model.multi ? imageFiles.map((_, idx) => `产品图-${idx + 1}`) : ["产品图-1"];
    const nodeName = `视频-${String(task.index).padStart(2, "0")}-${safeName(task.coreElement)}-${model.nodeSuffix}`;
    const col = (task.index - 1) % 5;
    const row = Math.floor((task.index - 1) / 5);
    const x = 520 + col * 680;
    const y = 520 + row * 560;
    const args = ["node", "--x", String(x), "--y", String(y), "create", nodeName, "-p", task.projectId, "-t", "video"];
    for (const node of leftNodes) args.push("--left", node);
    for (const setting of model.args) args.push("-s", setting);
    args.push("--prompt", prompt, "-r");

    task.videoNodeName = nodeName;
    task.nodePosition = { x, y };
    log(job, `生成视频：${task.coreElement}（${model.label}）`);
    const result = await runLibtv(args, {
      onStderr: (chunk) => {
        const progress = chunk.match(/progress=\d+%/g);
        if (progress) log(job, `${task.coreElement} ${progress[progress.length - 1]}`, "progress");
      }
    });
    const rawPath = path.join(job.outputDir, `run_${String(task.index).padStart(2, "0")}_${model.key}.txt`);
    await fsp.writeFile(rawPath, `${result.stdout}\n${result.stderr}`, "utf8");
    const url = extractMp4(`${result.stdout}\n${result.stderr}`);
    const attempt = { model: model.label, code: result.code, rawPath, url, error: "" };
    task.attempts.push(attempt);
    if (result.code === 0 && url) {
      task.videoNodeName = nodeName;
      task.model = model.label;
      task.url = url;
      return;
    }
    attempt.error = result.stderr || result.stdout || "生成失败";
    log(job, `${task.coreElement} 生成未成功：${model.label}`, "warn");
  }
  throw new Error("所有模型都未生成成功，最后错误：" + (task.attempts.at(-1)?.error || "未知错误"));
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = (target) => {
      const parsed = new URL(target);
      const transport = parsed.protocol === "http:" ? http : https;
      transport
        .get(parsed, { headers: { "User-Agent": "WISPersonStudio/4.0" } }, (response) => {
          if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
            response.resume();
            request(response.headers.location);
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`下载失败：HTTP ${response.statusCode}`));
            return;
          }
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          const file = fs.createWriteStream(destination);
          response.pipe(file);
          file.on("finish", () => file.close(resolve));
          file.on("error", reject);
        })
        .on("error", reject);
    };
    request(url);
  });
}

async function downloadGeneratedVideo(job, task, context, endpoint, completed, destination) {
  const candidates = [];
  if (completed?.oss_video_url) candidates.push({ label: "OSS结果地址", url: completed.oss_video_url });
  if (completed?.upstream_video_url && completed.upstream_video_url !== completed?.oss_video_url) {
    candidates.push({ label: "上游结果地址", url: completed.upstream_video_url });
  }
  candidates.push({
    label: "JenVideo鉴权代理",
    url: `${context.baseUrl}${endpoint}/${task.remoteTaskId}/video?token=${encodeURIComponent(context.token)}`
  });

  let lastError;
  for (const candidate of candidates) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await downloadFile(candidate.url, destination);
        if (candidate.label !== "OSS结果地址") {
          jobLog(job, `${task.label}已通过${candidate.label}下载`, "success");
          await savePersonJob(job);
        }
        return;
      } catch (error) {
        lastError = error;
        const retryable = /HTTP (408|429|5\d\d)|超时|ECONN|socket/i.test(String(error.message || ""));
        if (!retryable || attempt === 2) break;
        jobLog(job, `${candidate.label}下载暂时失败，正在重试：${error.message}`, "warn");
        await savePersonJob(job);
        await wait(1500 * attempt);
      }
    }
    jobLog(job, `${candidate.label}下载失败，自动切换下一种下载方式：${lastError.message}`, "warn");
    await savePersonJob(job);
  }
  throw new Error(`成片已生成，但所有下载方式均失败：${lastError?.message || "未知错误"}`);
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav"
  }[ext] || "application/octet-stream";
}

function requestBuffer(target, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const transport = url.protocol === "http:" ? http : https;
    const req = transport.request(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeout || 120000
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("上游接口请求超时")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function normalizeBaseUrl(value) {
  let base = String(value || DEFAULT_JENVIDEO_BASE_URL).trim().replace(/\/+$/, "");
  if (LEGACY_JENVIDEO_BASE_URLS.has(base.toLowerCase())) {
    base = DEFAULT_JENVIDEO_BASE_URL;
  }
  const parsed = new URL(base);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Base URL 必须是 http 或 https 地址");
  return base;
}

async function jenRequest(baseUrl, endpoint, token, options = {}) {
  const body = options.json === undefined ? options.body : Buffer.from(JSON.stringify(options.json), "utf8");
  const headers = {
    "X-Access-Token": token,
    "User-Agent": "WISPersonStudio/4.0",
    ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {})
  };
  if (body) headers["Content-Length"] = Buffer.byteLength(body);
  let response;
  try {
    response = await requestBuffer(`${normalizeBaseUrl(baseUrl)}${endpoint}`, {
      method: options.method || "GET",
      headers,
      body,
      timeout: options.timeout || 120000
    });
  } catch (cause) {
    const error = new Error(cause?.message || "无法连接上游接口");
    error.endpoint = endpoint;
    error.code = cause?.code || "NETWORK_ERROR";
    throw error;
  }
  const text = response.body.toString("utf8");
  const payload = tryParseJson(text);
  if (response.statusCode < 200 || response.statusCode >= 300 || (typeof payload?.code === "number" && payload.code !== 0) || payload?.error) {
    const error = new Error(payload?.error || payload?.message || payload?.detail || `上游接口失败（HTTP ${response.statusCode}）`);
    error.endpoint = endpoint;
    error.statusCode = response.statusCode;
    error.upstreamCode = payload?.code;
    throw error;
  }
  return payload || { data: text };
}

function fanDoSessionPath() {
  const appData = String(process.env.APPDATA || "").trim();
  return appData ? path.join(appData, "FanDo", "auth", "session.json") : "";
}

function openClawConfigPaths() {
  const appData = String(process.env.APPDATA || "").trim();
  const userProfile = String(process.env.USERPROFILE || process.env.HOME || "").trim();
  return [
    appData ? path.join(appData, "FanDo", "openclaw", "openclaw.json") : "",
    userProfile ? path.join(userProfile, ".openclaw", "openclaw.json") : ""
  ].filter(Boolean);
}

function findUacAccessToken(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return "";
  for (const [key, nested] of Object.entries(value)) {
    if (["accesstoken", "access_token", "uactoken", "uac_token"].includes(String(key).toLowerCase())) {
      const token = String(nested || "").trim();
      if (token.length >= 20) return token;
    }
  }
  for (const nested of Object.values(value)) {
    const token = findUacAccessToken(nested, depth + 1);
    if (token) return token;
  }
  return "";
}

async function readJsonCredential(filePath, source) {
  if (!filePath) return null;
  try {
    const config = JSON.parse(await fsp.readFile(filePath, "utf8"));
    const uacToken = source === "openclaw"
      ? findUacAccessToken(config)
      : String(config?.accessToken || config?.access_token || "").trim();
    return uacToken ? { configPath: filePath, uacToken, source } : null;
  } catch {
    return null;
  }
}

async function readLocalUacAuth() {
  const scope = currentProviderScope();
  if (scope) {
    const imported = await providerCredentialStore.getCredential(scope);
    if (imported?.token) {
      return {
        configPath: "",
        uacToken: imported.token,
        source: imported.source || "fando-openclaw",
        cacheKey: imported.cacheKey || scope.key
      };
    }
    const error = new Error("请先回到工作台登录页，导入本人 FanDo 模型授权");
    error.authKind = "local-uac";
    throw error;
  }
  for (const configPath of openClawConfigPaths()) {
    const credential = await readJsonCredential(configPath, "openclaw");
    if (credential) return credential;
  }
  const sessionCredential = await readJsonCredential(fanDoSessionPath(), "fando-session");
  if (sessionCredential) return sessionCredential;
  const error = new Error("没有找到可用的 FanDo/UAC 本机登录凭证");
  error.authKind = "local-uac";
  throw error;
}

async function acquireAutomaticGenToken(baseUrl, forceRefresh = false) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const credential = await readLocalUacAuth();
  const ownerKey = currentMultimodalSessionKey();
  const cacheKey = `${normalizedBaseUrl}|${ownerKey}|${credential.cacheKey || ownerKey}`;
  const cached = automaticGenTokenCache.get(cacheKey);
  if (!forceRefresh && cached?.token && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  const response = await requestBuffer(`${normalizedBaseUrl}/v1/agent-token`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credential.uacToken}`,
      "User-Agent": "WISPersonStudio/4.0",
      "Content-Length": "0"
    },
    timeout: 30000
  });
  const payload = tryParseJson(response.body.toString("utf8"));
  if (response.statusCode < 200 || response.statusCode >= 300 || (typeof payload?.code === "number" && payload.code !== 0)) {
    const error = new Error(payload?.error || payload?.message || payload?.detail || `自动签发 gen_token 失败（HTTP ${response.statusCode}）`);
    error.statusCode = response.statusCode;
    error.authKind = "uac";
    if (currentProviderScope() && [401, 403].includes(response.statusCode)) {
      await providerCredentialStore.markInvalid(currentProviderScope(), error.message).catch(() => {});
    }
    throw error;
  }
  const genToken = String(payload?.data?.token || "").trim();
  if (!genToken) {
    const error = new Error("agent-token 接口没有返回 data.token");
    error.authKind = "uac";
    throw error;
  }
  automaticGenTokenCache.set(cacheKey, {
    token: genToken,
    expiresAt: Date.now() + AUTO_GEN_TOKEN_CACHE_MS
  });
  return genToken;
}

function normalizedMultimodalUserInfo(value = {}) {
  const source = value?.user_info || value?.userInfo || value?.data?.user_info || value?.data?.userInfo || value || {};
  return {
    workNo: String(source.work_no || source.workNo || "").trim(),
    realName: String(source.real_name || source.realName || source.name || "").trim(),
    groupName: String(source.group_name || source.groupName || "").trim(),
    deptJobName: String(source.dept_job_name || source.deptJobName || "").trim(),
    parentDept: String(source.parent_dept || source.parentDept || "").trim()
  };
}

function hasMultimodalUserInfo(value) {
  return Boolean(value?.workNo || value?.realName || value?.groupName || value?.parentDept);
}

function rememberMultimodalSession(token, source, userInfo) {
  const value = String(token || "").trim();
  if (!value) return;
  multimodalAuthSessions.set(currentMultimodalSessionKey(), {
    token: value,
    source: String(source || "multimodal"),
    userInfo: normalizedMultimodalUserInfo(userInfo),
    expiresAt: Date.now() + AUTO_GEN_TOKEN_CACHE_MS
  });
}

async function multimodalLogin(baseUrl, credentials = {}) {
  const username = String(credentials.username || "").trim();
  const password = String(credentials.password || "");
  const captcha = String(credentials.captcha || "").trim();
  if (!username || !password) throw new Error("请输入工号和密码");
  const body = Buffer.from(JSON.stringify({ username, password, ...(captcha ? { captcha } : {}) }), "utf8");
  const response = await requestBuffer(`${normalizeBaseUrl(baseUrl)}/v1/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "User-Agent": "WISPersonStudio/4.0"
    },
    body,
    timeout: 30000
  });
  const payload = tryParseJson(response.body.toString("utf8")) || {};
  if (response.statusCode < 200 || response.statusCode >= 300 || (typeof payload?.code === "number" && payload.code !== 0)) {
    const error = new Error(payload?.error || payload?.message || payload?.detail || `多模态登录失败（HTTP ${response.statusCode}）`);
    error.statusCode = response.statusCode;
    error.upstreamCode = payload?.code;
    error.captchaRequired = Number(payload?.code) === 4004;
    throw error;
  }
  const data = payload?.data || payload;
  const token = String(data?.gen_token || data?.token || "").trim();
  if (!token) throw new Error("登录成功，但接口没有返回可用会话");
  rememberMultimodalSession(token, "oa-login", data);
  const session = currentMultimodalSession();
  return {
    available: true,
    source: "oa-login",
    userInfo: session.userInfo
  };
}

async function resolveJenToken(baseUrl) {
  const session = currentMultimodalSession();
  if (session.token && session.expiresAt > Date.now()) {
    return {
      token: session.token,
      source: session.source || "oa-login",
      userInfo: session.userInfo
    };
  }
  const credential = await readLocalUacAuth();
  const token = await acquireAutomaticGenToken(baseUrl);
  rememberMultimodalSession(token, credential.source, null);
  return { token, source: credential.source, userInfo: null };
}

async function multimodalAuthStatus(baseUrl = DEFAULT_JENVIDEO_BASE_URL) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const resolved = await resolveJenToken(normalizedBaseUrl);
  const payload = await jenRequest(normalizedBaseUrl, "/v1/session", resolved.token, { timeout: 30000 });
  const sessionInfo = normalizedMultimodalUserInfo(payload?.data || payload);
  const userInfo = hasMultimodalUserInfo(sessionInfo) ? sessionInfo : normalizedMultimodalUserInfo(resolved.userInfo);
  if (hasMultimodalUserInfo(userInfo)) {
    rememberMultimodalSession(resolved.token, resolved.source, userInfo);
  }
  return {
    available: true,
    provider: "multimodal",
    source: resolved.source,
    baseUrl: normalizedBaseUrl,
    userInfo,
    message: resolved.source === "oa-login"
      ? "公司多模态账号已登录，可直接使用 Kling Omni 与 GPT Image 2"
      : "已通过本机 FanDo 登录自动连接公司多模态服务"
  };
}

function makeMultipart(parts) {
  const boundary = `----ProductShot${crypto.randomBytes(12).toString("hex")}`;
  const buffers = [];
  for (const part of parts) {
    buffers.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      buffers.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`));
      buffers.push(Buffer.from(`Content-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`));
      buffers.push(part.data);
      buffers.push(Buffer.from("\r\n"));
    } else {
      buffers.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value || ""}\r\n`));
    }
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(buffers) };
}

async function jenUpload(baseUrl, token, endpoint, filePath) {
  const data = await fsp.readFile(filePath);
  const contentType = mimeForFile(filePath);
  const multipart = makeMultipart([
    { name: "file", filename: path.basename(filePath), contentType, data },
    { name: "content_type", value: contentType }
  ]);
  const payload = await jenRequest(baseUrl, endpoint, token, {
    method: "POST",
    body: multipart.body,
    headers: { "Content-Type": `multipart/form-data; boundary=${multipart.boundary}` },
    timeout: 240000
  });
  const url = payload?.data?.url || payload?.url;
  if (!url) throw new Error("上传成功但接口未返回素材 URL");
  return url;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUpstreamError(error) {
  const message = String(error?.message || "").toLowerCase();
  const status = Number(error?.statusCode || 0);
  return message.includes("ring-balancer") || message.includes("timeout") || message.includes("超时") ||
    message.includes("socket") || message.includes("econn") || status === 408 || status === 429 || status >= 500;
}

function explainUpstreamError(error, stageLabel = "上游请求") {
  const raw = String(error?.message || "未知错误");
  const lower = raw.toLowerCase();
  const status = Number(error?.statusCode || 0);
  if (error?.authKind === "local-uac" || error?.authKind === "fando-session") {
    return {
      title: `${stageLabel}失败：尚未登录公司多模态服务`,
      hint: "请在页面点击“自动连接”；若本机未登录 FanDo，可直接使用公司工号和密码登录。",
      technical: raw,
      retryable: false
    };
  }
  if (error?.authKind === "uac") {
    return {
      title: `${stageLabel}失败：公司账号登录已过期或无权限`,
      hint: "请在页面重新自动连接或使用公司工号登录；如果仍失败，请让管理员确认当前账号已开通多模态生成权限。",
      technical: raw,
      retryable: false
    };
  }
  if (lower.includes("ring-balancer")) {
    return {
      title: `${stageLabel}失败：上游暂无可用服务节点`,
      hint: "这不是提示词或视频模型错误。请稍后重试；若持续出现，请联系接口服务方检查账号通道、额度和服务节点。",
      technical: raw,
      retryable: true
    };
  }
  if (status === 401 || status === 403 || lower.includes("unauthorized") || lower.includes("token") && lower.includes("invalid")) {
    return {
      title: `${stageLabel}失败：公司账号登录已过期`,
      hint: "请在页面点击“自动连接”或使用公司工号重新登录，无需复制或粘贴任何令牌。",
      technical: raw,
      retryable: false
    };
  }
  if (status === 404) {
    return {
      title: `${stageLabel}失败：接口地址不正确`,
      hint: `请检查 Base URL，默认应为 ${DEFAULT_JENVIDEO_BASE_URL}，末尾不要重复填写 /v1。`,
      technical: raw,
      retryable: false
    };
  }
  if (status === 429) {
    return {
      title: `${stageLabel}失败：调用过于频繁或额度不足`,
      hint: "请稍后重试，并让接口服务方确认当前账号额度。",
      technical: raw,
      retryable: true
    };
  }
  return {
    title: `${stageLabel}失败`,
    hint: isRetryableUpstreamError(error) ? "服务暂时不可用，软件已自动重试；请稍后再次生成。" : "请根据技术信息检查接口配置，必要时联系接口服务方。",
    technical: raw,
    retryable: isRetryableUpstreamError(error)
  };
}

async function uploadWithRetry(job, filePath, endpoint, label, token, saveFn = savePersonJob) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      jobLog(job, `${label}：正在上传${attempt > 1 ? `（第${attempt}次尝试）` : ""}`);
      await saveFn(job);
      const url = await jenUpload(job.config.baseUrl, token, endpoint, filePath);
      jobLog(job, `${label}：上传完成`, "success");
      await saveFn(job);
      return url;
    } catch (error) {
      if (!isRetryableUpstreamError(error) || attempt === maxAttempts) {
        error.uploadLabel = label;
        throw error;
      }
      const delay = attempt * 1500;
      jobLog(job, `${label}上传暂时失败，${Math.round(delay / 1000)}秒后自动重试：${error.message}`, "warn");
      await saveFn(job);
      await wait(delay);
    }
  }
  throw new Error(`${label}上传失败`);
}

function faceApplicationRule(product) {
  if (product.noProduct) {
    return "本次不使用产品：画面只保留人物、服装与真实场景，不拿、不用、不摆放任何商品，不出现包装、品牌logo、价格或购买引导";
  }
  if (product.category === "ampoule") {
    return product.controlPrompt
      ? `${product.controlPrompt}；人物只做拿起外盒、扶稳开盒、托住正立连排、手持闭合单支或展示正立开口结构，不倒置挤液、不贴脸`
      : "人物只展示正立次抛外盒、连排或单支结构，不倒置挤液、不贴脸，产品形态与参考图完全一致";
  }
  if (product.id === "wis-crystal-firming-eye-mask") {
    return "两片蓝色月牙形凝胶眼贴分别贴于左右眼下方，方向对称、边缘服帖，不覆盖眼球，不变成整脸面膜";
  }
  if (product.id === "wis-birds-nest-peptide-revitalizing-mask") {
    return "淡米白半透明凝胶均匀薄涂于脸颊与额头，避开眼周和嘴唇，呈水润燕窝凝胶质地，不变成贴片或泥膜";
  }
  if (product.id === "wis-ningyan-anti-aging-set") {
    return "从套组选择正确单品完成真实动作：水乳轻拍、面霜点涂、洁面乳形成细腻泡沫；四件套产品结构保持完整";
  }
  if (product.id === "wis-black-crystal-mask") {
    return "黑色石墨烯膜布完整贴合面部，蜂窝纹理细腻、湿润服帖，眼鼻口开孔准确，禁止变成普通黑布";
  }
  return "面膜完整贴合面部轮廓，眼鼻口开孔准确，膜布薄、湿润、服帖，不遮挡眼睛和嘴唇";
}

function identityPrompt(angle, adjustment = "") {
  const angleText = {
    front: "正面平视镜头，头部不倾斜",
    left: "人物向左转约45度，五官结构与正面人物完全一致",
    right: "人物向右转约45度，五官结构与正面人物完全一致"
  }[angle];
  return [
    "以图片1作为唯一人物身份基准，基于图片1生成身份参考图。",
    angleText,
    "严格保持同一人物的五官、脸型、发型、发色、肤色、年龄感、体型、服装和妆容一致。",
    "自然皮肤纹理，真实摄影，柔和均匀光线，肩部以上构图，干净中性背景，3:4竖图。",
    adjustment ? `本次调整要求：${adjustment}。不得改变人物身份。` : "",
    "识别并移除参考图片中的字幕、标题、角标、贴纸文字、水印和乱码，不在三视图中新增任何画面文字。",
    "禁止：换脸、年龄变化、发型变化、服装变化、夸张磨皮、五官漂移、额外人物、文字、水印。"
  ].filter(Boolean).join("\n");
}

function personPrompt(product, kind, sourceType, dialogue, adjustments = {}, variantIndex = 1) {
  const clothing = String(adjustments.clothing || "").trim();
  const styling = String(adjustments.styling || "").trim();
  const background = String(adjustments.background || "").trim();
  const other = String(adjustments.other || "").trim();
  const referenceAudioName = String(adjustments.referenceAudioName || "").trim();
  const referenceAudioStyle = String(adjustments.referenceAudioStyle || "").trim();
  const cleanSourceText = adjustments.cleanSourceText !== false;
  const spokenProductName = productNameByStyle(product, adjustments.productNameStyle || "short");
  const identity = sourceType === "video"
    ? "保持参考视频中同一人物的身份、五官、肤色、年龄感、体型、主要动作节奏与镜头连续性；服装、妆造和背景只按本次明确要求调整"
    : "综合正面、左45度、右45度三张身份图，保持同一人物的五官、脸型、肤色、年龄感和体型绝对一致；服装、妆造和背景只按本次明确要求调整";
  let action;
  if (kind === "host") {
    action = "人物面向镜头完成自然主持或口播表达，眼神有交流感，手势克制，动作与场景连续，不凭空拿取任何商品";
  } else if (kind === "performance") {
    action = "人物在当前场景中完成自然走位、转身、互动或情绪表演，动作有起承转合，保持真实物理逻辑，不出现商品相关动作";
  } else if (kind === "handheld") {
    action = "人物自然单手或双手持握产品，产品位于胸前或脸侧，包装正面朝向镜头；手指姿态自然，不遮挡logo、固有文字和产品结构，产品比例符合真实尺寸";
  } else if (kind === "face-use") {
    action = product.category === "ampoule"
      ? `人物完成安全、正确的产品结构与使用准备展示。具体规则：${faceApplicationRule(product)}。动作自然可信，不执行规则禁止的倒置挤液或贴脸动作`
      : `人物正在正确使用产品并完成上脸展示。具体规则：${faceApplicationRule(product)}。动作自然可信，展示使用过程和完成状态`;
  }
  const speech = dialogue
    ? `人物使用自然清晰的普通话口播，完整且准确地说：“${dialogue}”。${product.noProduct ? "" : `本条产品名称只能读作“${spokenProductName}”，不得读全称、旧称或其他别名。`}嘴型、停顿和表情与台词同步，语速适合15秒视频；${referenceAudioName ? `声音节奏、情绪强度和表达质感参考“${referenceAudioName}”（${referenceAudioStyle || "自然表达"}），保持自然连贯，不照搬参考音频原句` : "声音情绪与台词、人物表情和画面情境一致"}；不添加自动字幕、口播字幕或逐字字幕，产品包装固有文字和场景必要文字如出现必须逐字准确`
    : "人物不说话，不生成旁白或对话，保持自然表情";
  const adjustmentRules = [
    clothing
      ? `服装改造：${clothing}。只更改服装及合理配饰，不改变人物身份、体型和动作连续性`
      : "服装未指定改造：沿用参考素材中的服装与合理配饰",
    styling
      ? `妆造改造：${styling}。只调整妆容、发型和造型细节，不改变人物五官、年龄感和身份`
      : "妆造未指定改造：沿用参考素材中的妆容与发型",
    background
      ? `背景改造：${background}。新背景需与人物光线、透视、接触关系和动作逻辑一致`
      : "背景未指定改造：沿用参考素材的主要场景与空间逻辑",
    other ? `其他改造：${other}。必须服从人物身份、产品正确性与动作连续性` : "",
    `本条为候选版本 ${variantIndex}：在不破坏上述约束的前提下，镜头细节、动作节奏或表演状态与同批其他版本形成可辨识差异`
  ].filter(Boolean);
  const textCleanup = cleanSourceText
    ? "先识别并清除参考视频或参考图片里原有的口播字幕、逐字字幕、标题条、角标、水印、贴纸文字、错误品牌字和乱码，不得照搬到新画面。正确且能由产品参考图核验的包装固有品牌文字可以保留，必须逐字准确；禁止生成新的口播字幕"
    : "不得新增自动字幕、口播字幕、逐字字幕、乱码或未经确认的画面文字；正确的产品包装固有文字可以保留";
  if (product.noProduct) {
    return [
      identity,
      action,
      speech,
      ...adjustmentRules,
      textCleanup,
      "本次明确选择“不出现产品”。画面只能出现人物、服装、家具和符合场景逻辑的普通环境物件。",
      "不得出现任何护肤品、化妆品、商品包装、产品瓶罐、品牌logo、商品标签、价格规格、功效卖点、购买按钮或带货手势；不得因为人物口播而自行补画产品。",
      "真实手机摄影或品牌人物短片质感，自然皮肤纹理，稳定运镜，9:16竖屏。",
      "口播只能以声音呈现；禁止自动字幕、口播字幕、逐字字幕、水印、乱码或未经确认的屏幕文字；场景固有文字如出现必须逐字准确。",
      "禁止：人物身份变化，多余手指，畸形手部，商品道具，品牌露出，广告价格，购买引导，强磨皮，额外字幕，医美治疗暗示，夸张前后对比。"
    ].join("\n");
  }
  return [
    identity,
    action,
    speech,
    ...adjustmentRules,
    textCleanup,
    `展示产品：${product.name}。本条口播产品名称固定为“${spokenProductName}”。严格复用产品参考图，保持${product.visualIdentity}。`,
    `视觉重点：${product.benefitCues}。产品质地要求：${product.maskDetail}。`,
    product.controlPrompt ? `产品专属结构与动作规则：${product.controlPrompt}。` : "",
    "产品包装颜色、瓶型/罐型/盒型/袋型比例、套组数量、logo方向、固有文字区域必须准确，不新增任何非产品文字。",
    "真实手机摄影与达人种草质感，自然皮肤纹理，稳定运镜，9:16竖屏。",
    `合规边界：${product.compliance}。`,
    `禁止：人物身份变化，多余手指，畸形手部，产品漂浮，包装变形，logo反向，标签乱码，错误贴敷，强磨皮，额外字幕，水印，医美治疗暗示，夸张前后对比，${product.negativeExtra}`
  ].filter(Boolean).join("\n");
}

function upstreamStatus(data) {
  return String(data?.status || data?.data?.status || "").toLowerCase();
}

function imageResultUrl(data) {
  return collectImageUrls(data)[0]
    || String(data?.url || data?.image_url || "").trim();
}

function publicJob(job) {
  return { ...job, config: { ...job.config, genToken: undefined } };
}

async function saveJobRecord(job, directory) {
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(path.join(directory, `${job.id}.json`), JSON.stringify(publicJob(job), null, 2), "utf8");
  if (job.outputDir) {
    await fsp.mkdir(job.outputDir, { recursive: true });
    await fsp.writeFile(path.join(job.outputDir, "job.json"), JSON.stringify(publicJob(job), null, 2), "utf8");
  }
}

function queuedSaveJobRecord(job, directory) {
  const key = `${directory}:${job.id}`;
  const previous = persistedJobSaveQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => saveJobRecord(job, directory));
  persistedJobSaveQueues.set(key, next);
  next.finally(() => {
    if (persistedJobSaveQueues.get(key) === next) persistedJobSaveQueues.delete(key);
  }).catch(() => {});
  return next;
}

const savePersonJob = (job) => queuedSaveJobRecord(job, PERSON_JOBS_DIR);
const saveIdentityJob = (job) => queuedSaveJobRecord(job, IDENTITY_JOBS_DIR);

async function loadSavedJobMap(directory, targetMap, label, saveFn) {
  await fsp.mkdir(directory, { recursive: true });
  const files = await fsp.readdir(directory);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const job = JSON.parse(await fsp.readFile(path.join(directory, file), "utf8"));
      if (!job?.id) continue;
      if (!Array.isArray(job.logs)) job.logs = [];
      if (!Array.isArray(job.tasks)) job.tasks = [];
      targetMap.set(job.id, job);
      if (ACTIVE_JOB_STATUSES.has(String(job.status))) {
        job.status = "interrupted";
        job.error = "本地服务上次运行时中断，请重新发起该任务。";
        for (const task of job.tasks) {
          if (ACTIVE_JOB_STATUSES.has(String(task.status))) task.status = "interrupted";
        }
        job.logs.push({
          at: new Date().toISOString(),
          level: "warn",
          message: `${label}在本地服务上次退出时中断，已保留历史结果。`
        });
        job.updatedAt = new Date().toISOString();
        await saveFn(job);
      }
    } catch (error) {
      console.warn(`跳过异常${label}记录：${file} ${error.message}`);
    }
  }
}

async function loadPersistedPersonJobs() {
  await loadSavedJobMap(PERSON_JOBS_DIR, personJobs, "明星画面任务", savePersonJob);
  await loadSavedJobMap(IDENTITY_JOBS_DIR, identityJobs, "人物三视图任务", saveIdentityJob);
}

function personJobTime(job) {
  const value = Date.parse(job?.updatedAt || job?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function personJobPercent(job) {
  const tasks = Array.isArray(job?.tasks) ? job.tasks : [];
  if (!tasks.length) return ACTIVE_JOB_STATUSES.has(String(job?.status)) ? 5 : 0;
  const total = tasks.reduce((sum, task) => {
    if (task.localPath || ["success", "partial", "review_required"].includes(String(task.status))) return sum + 100;
    if (["failed", "blocked", "skipped", "interrupted"].includes(String(task.status))) return sum + 100;
    return sum + Math.max(0, Math.min(99, Number(task.progress || 0)));
  }, 0);
  return Math.round(total / tasks.length);
}

function latestPersonWorkbenchJob() {
  const rows = [...personJobs.values(), ...identityJobs.values()];
  return rows.sort((left, right) => {
    const activeDelta = Number(ACTIVE_JOB_STATUSES.has(String(right.status))) - Number(ACTIVE_JOB_STATUSES.has(String(left.status)));
    return activeDelta || personJobTime(right) - personJobTime(left);
  })[0] || null;
}

function personWorkbenchProgress() {
  const job = latestPersonWorkbenchJob();
  const active = [...personJobs.values(), ...identityJobs.values()].filter((item) => ACTIVE_JOB_STATUSES.has(String(item.status))).length;
  if (!job) {
    return {
      mode: "person",
      label: "AI-明星画面生成",
      status: "idle",
      activeCount: 0,
      percent: 0,
      message: "暂无任务",
      href: `${PERSON_STUDIO_PUBLIC_URL}/`
    };
  }
  const identity = job.type === "identity-views";
  const completed = Number(job.summary?.success || 0);
  const total = Number(job.summary?.total || job.tasks?.length || 0);
  return {
    mode: "person",
    label: "AI-明星画面生成",
    status: job.status,
    activeCount: active,
    percent: personJobPercent(job),
    jobId: job.id,
    message: identity
      ? `人物三视图 ${completed}/${total || 3}`
      : `${job.config?.productType || "人物视频"} ${completed}/${total || 0}`,
    updatedAt: job.updatedAt || job.createdAt,
    href: `${PERSON_STUDIO_PUBLIC_URL}/?job=${encodeURIComponent(job.id)}`
  };
}

function jobLog(job, message, level = "info") {
  job.logs.push({ at: new Date().toISOString(), level, message });
  job.updatedAt = new Date().toISOString();
}

async function waitForRemoteTask(job, task, endpoint, token, baseUrl, saveFn) {
  const deadline = Date.now() + 45 * 60 * 1000;
  while (Date.now() < deadline) {
    const payload = await jenRequest(baseUrl, `${endpoint}/${task.remoteTaskId}`, token);
    const data = payload?.data || payload;
    const status = upstreamStatus(data);
    task.remoteStatus = status || task.remoteStatus;
    const succeeded = ["succeeded", "success", "completed", "done"].includes(status);
    task.progress = succeeded ? 100 : status === "running" ? 55 : 15;
    await saveFn(job);
    if (succeeded) return data;
    if (["failed", "error", "expired", "cancelled", "canceled"].includes(status)) {
      throw new Error(data?.error_message || data?.error || `上游任务${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("生成等待超过45分钟");
}

function upstreamTaskId(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  return String(data?.task_id || data?.taskId || data?.id || "").trim();
}

async function processMultimodalIdentityAngle(job, task, sourceUrl, token) {
  task.status = "running";
  task.engine = "gpt-image-2";
  task.model = "openai/gpt-image-2";
  task.prompt = identityPrompt(task.angle, job.adjustment);
  await saveIdentityJob(job);
  const createdPayload = await jenRequest(job.config.baseUrl, "/v1/image/generations", token, {
    method: "POST",
    json: {
      model: "openai/gpt-image-2",
      prompt: task.prompt,
      aspect_ratio: "3:4",
      resolution: "2K",
      input_urls: [sourceUrl],
      n: 1
    }
  });
  const immediateUrl = imageResultUrl(createdPayload);
  task.remoteTaskId = upstreamTaskId(createdPayload);
  task.remoteStatus = immediateUrl && !task.remoteTaskId ? "success" : "queued";
  let resultUrl = immediateUrl;
  if (!resultUrl) {
    if (!task.remoteTaskId) throw new Error("GPT Image 2 三视图任务未返回任务编号");
    const completed = await waitForRemoteTask(
      job,
      task,
      "/v1/image/generations",
      token,
      job.config.baseUrl,
      saveIdentityJob
    );
    resultUrl = imageResultUrl(completed);
  }
  if (!resultUrl) throw new Error("GPT Image 2 已完成，但没有返回人物图片");
  task.resultUrl = resultUrl;
  await fsp.mkdir(job.outputDir, { recursive: true });
  let extension = ".png";
  try {
    const candidate = path.extname(new URL(resultUrl).pathname).toLowerCase();
    if (/^\.(png|jpe?g|webp)$/.test(candidate)) extension = candidate;
  } catch {}
  task.localPath = path.join(job.outputDir, `${task.angle}${extension}`);
  await downloadFile(resultUrl, task.localPath);
  task.status = "success";
  task.progress = 100;
  job.summary.success += 1;
  jobLog(job, `${task.label}已完成（GPT Image 2）`, "success");
  await saveIdentityJob(job);
}

async function processMultimodalIdentityJob(job) {
  job.status = "running";
  await saveIdentityJob(job);
  try {
    const resolved = identitySecrets.get(job.id)
      ? { token: identitySecrets.get(job.id), source: "job-session" }
      : await resolveJenToken(job.config.baseUrl);
    const token = resolved.token;
    identitySecrets.set(job.id, token);
    await jenRequest(job.config.baseUrl, "/v1/session", token, { timeout: 30000 });
    jobLog(job, `开始生成第${job.version}版人物三视图（GPT Image 2）`);
    const sourceUrl = await uploadWithRetry(
      job,
      job.sourcePath,
      "/v1/image/upload",
      "人物正面参考图",
      token,
      saveIdentityJob
    );
    jobLog(job, "人物参考图已上传，三个角度正在并发生成", "success");
    await Promise.all(job.tasks.map(async (task) => {
      try {
        await processMultimodalIdentityAngle(job, task, sourceUrl, token);
      } catch (error) {
        task.status = "failed";
        task.error = String(error?.message || error);
        task.diagnostic = providerErrorDiagnostic(error);
        job.summary.failed += 1;
        jobLog(job, `${task.label}失败：${task.error}`, "error");
        await saveIdentityJob(job);
      }
    }));
    job.status = job.summary.success === 3 ? "success" : job.summary.success ? "partial" : "failed";
  } catch (error) {
    job.status = "failed";
    job.error = String(error?.message || error);
    job.failure = explainUpstreamError(error, "GPT Image 2 三视图生成");
    for (const task of job.tasks) {
      if (["queued", "running"].includes(String(task.status))) {
        task.status = "failed";
        task.error = job.failure.title;
      }
    }
    job.summary.failed = job.tasks.filter((task) => task.status === "failed").length;
    jobLog(job, `${job.failure.title}。${job.failure.hint}`, "error");
  } finally {
    identitySecrets.delete(job.id);
    await saveIdentityJob(job);
  }
}

async function processKlingIdentityAngle(job, task, model, sourceReference) {
  task.status = "running";
  await saveIdentityJob(job);
  const prompt = identityPrompt(task.angle, job.adjustment);
  task.prompt = prompt;
  const createIdentityTask = async (imageReference) => parseKlingResult(await runKlingCli("image_to_image", [
    "--model", model.model,
    "--image", imageReference,
    prompt
  ], { timeoutMs: 90 * 1000 }));
  let created;
  try {
    created = await createIdentityTask(sourceReference);
  } catch (error) {
    if (!isKlingImageReferenceValidationError(error) || sourceReference === job.sourcePath) throw error;
    jobLog(job, `${task.label}未识别已上传参考图，正在改用本地原图自动重试`, "warning");
    await saveIdentityJob(job);
    created = await createIdentityTask(job.sourcePath);
  }
  task.remoteTaskId = klingGenerationId(created);
  task.remoteStatus = klingStatus(created) || "queued";
  task.engine = "kling-cli";
  task.model = model.model;
  if (!task.remoteTaskId) throw new Error("可灵三视图任务未返回 generationId");
  const completed = await waitForKlingTask(job, task, task.remoteTaskId, "image", saveIdentityJob);
  task.resultUrl = completed.url;
  await fsp.mkdir(job.outputDir, { recursive: true });
  const extension = (() => {
    try {
      const value = path.extname(new URL(completed.url).pathname).toLowerCase();
      return /^\.(png|jpe?g|webp)$/.test(value) ? value : ".png";
    } catch {
      return ".png";
    }
  })();
  task.localPath = path.join(job.outputDir, `${task.angle}${extension}`);
  await downloadFile(completed.url, task.localPath);
  task.status = "success";
  task.progress = 100;
  job.summary.success += 1;
  jobLog(job, `${task.label}已完成`, "success");
  await saveIdentityJob(job);
}

async function processKlingIdentityJob(job) {
  job.status = "running";
  await saveIdentityJob(job);
  try {
    const capabilities = await klingCapabilities();
    const model = assertSingleIdentityReferenceModel(findKlingModel(capabilities.models.imageToImage, job.config.identityModel));
    jobLog(job, `开始生成第${job.version}版人物三视图（可灵 CLI）`);
    jobLog(job, "正在上传人物参考图（本批仅上传一次）");
    const uploaded = parseKlingResult(await runKlingCli("file_upload", [job.sourcePath], { timeoutMs: 90 * 1000 }));
    const sourceReference = klingUploadedUrl(uploaded);
    if (!sourceReference) throw new Error("可灵人物参考图上传完成，但未返回可用 URL");
    jobLog(job, "人物参考图上传完成，开始并发生成三个角度", "success");
    await Promise.all(job.tasks.map(async (task) => {
      try {
        await processKlingIdentityAngle(job, task, model, sourceReference);
      } catch (error) {
        task.status = "failed";
        task.error = compactProviderError(error, "kling");
        task.diagnostic = providerErrorDiagnostic(error);
        job.summary.failed += 1;
        jobLog(job, `${task.label}失败：${task.error}`, "error");
        await saveIdentityJob(job);
      }
    }));
    job.status = job.summary.success === 3 ? "success" : job.summary.success ? "partial" : "failed";
  } catch (error) {
    job.status = "failed";
    job.error = compactProviderError(error, "kling");
    job.failure = {
      title: "可灵人物三视图未完成",
      hint: job.error,
      technical: providerErrorDiagnostic(error)
    };
    job.summary.failed = 3 - job.summary.success;
    jobLog(job, job.error, "error");
  } finally {
    await saveIdentityJob(job);
  }
}

async function createPersonLibtvCanvas(job, label) {
  if (job.projectId) {
    return { projectId: job.projectId, canvasName: job.canvasName, canvasUrl: job.canvasUrl };
  }
  if (job.config?.canvasMode === "workbench-task-v2") {
    const accountResult = await runLibtv(["account", "info"]);
    if (accountResult.code !== 0) throw new Error(explainLibtvFailure(accountResult, "LibTV 未登录"));
    const account = tryParseJson(accountResult.stdout) || {};
    const active = account.activeAccount || {};
    const rawIdentity = [active.accountId, active.ownerUuid, active.accountName, account?.user?.uuid, account?.user?.id]
      .filter((value) => value !== undefined && value !== null && String(value).trim())
      .join("|") || "active-account";
    const accountKey = crypto.createHash("sha1").update(rawIdentity).digest("hex").slice(0, 16);
    const teamId = Math.max(0, Math.trunc(Number(account.teamId || 0) || 0));
    const binding = await workbenchLibtvManager.ensureTaskCanvas({
      module: WORKBENCH_MODULES["ai-person"],
      ownerKey: job.libtvOwner?.key,
      accountKey,
      teamId,
      workstation: job.config,
      taskId: job.config.workbenchTaskId || job.id,
      taskName: job.config.workbenchTaskName || job.taskName || label,
      taskCreatedAt: job.config.workbenchTaskCreatedAt || job.createdAt,
      runId: job.id
    });
    job.workbenchBindingVersion = binding.version;
    job.workbenchWorkspaceId = binding.workspaceId;
    job.workbenchWorkspaceName = binding.workspaceName;
    job.projectId = binding.projectId;
    job.canvasName = binding.canvasName;
    job.canvasUrl = binding.canvasUrl;
    job.canvasTaskSlot = binding.runSlot;
    jobLog(job, binding.workspaceReused ? `复用视频项目：${binding.workspaceName}` : `已创建视频项目：${binding.workspaceName}`);
    jobLog(job, binding.canvasReused ? `复用任务画布：${binding.canvasName}` : `已创建任务画布：${binding.canvasName}`);
    await savePersonJob(job);
    return binding;
  }
  const workspaceId = parseSpaceId(DEFAULTS.libtvUrl);
  const canvasName = `AI视频工作台_${safeName(label)}_${nowStamp()}_${crypto.randomBytes(2).toString("hex")}`;
  const result = await runLibtv(["project", "create", canvasName, "-w", String(workspaceId)]);
  job.createCanvasRaw = { stdout: result.stdout, stderr: result.stderr, code: result.code };
  if (result.code !== 0) throw new Error(explainLibtvFailure(result, "创建 LibTV 画布失败"));
  const parsed = tryParseJson(result.stdout);
  let projectId = parsed?.projectMeta?.uuid
    || parsed?.uuid
    || parsed?.projectUuid
    || parsed?.data?.projectMeta?.uuid
    || parsed?.data?.uuid
    || parsed?.data?.projectUuid
    || "";
  if (!projectId) {
    const list = await runLibtv(["project", "list", "--name", canvasName, "-w", String(workspaceId), "-s", "10"]);
    const meta = tryParseJson(list.stdout);
    projectId = meta?.projectMetaList?.find((item) => item.name === canvasName)?.uuid
      || meta?.data?.projectMetaList?.find((item) => item.name === canvasName)?.uuid
      || "";
  }
  if (!projectId) throw new Error("LibTV 画布已创建，但没有返回画布 ID");
  job.projectId = projectId;
  job.canvasUrl = `https://www.liblib.tv/canvas?spaceId=${workspaceId}&projectId=${projectId}`;
  return { projectId, canvasName, canvasUrl: job.canvasUrl };
}

async function processLibtvIdentityAngle(job, task, model, projectId, sourceNodeName, index) {
  task.status = "running";
  task.engine = "libtv-cli";
  task.model = model.name;
  task.prompt = identityPrompt(task.angle, job.adjustment);
  await saveIdentityJob(job);
  const nodeName = `人物三视图-${task.label}-${job.version}`;
  const args = [
    "node", "--x", String(520 + index * 520), "--y", "420", "create", nodeName,
    "-p", projectId, "-t", "image", "--left", sourceNodeName,
    "-s", `model=${model.name}`, "-s", "modeType=image2image", "-s", "ratio=3:4"
  ];
  if (model.key === "lib-image-2") {
    args.push("-s", "quality=high", "-s", "resolution=2K");
  } else {
    args.push("-s", "quality=2K");
  }
  args.push("--prompt", task.prompt, "-r");
  const result = await runLibtv(args);
  const rawPath = path.join(job.outputDir, `libtv_${task.angle}.txt`);
  await fsp.mkdir(job.outputDir, { recursive: true });
  await fsp.writeFile(rawPath, `${result.stdout}\n${result.stderr}`, "utf8");
  let resultUrl = extractImageUrl(`${result.stdout}\n${result.stderr}`);
  if (!resultUrl && result.code === 0) {
    const query = await runLibtv(["node", nodeName, "-p", projectId]);
    resultUrl = extractImageUrl(`${query.stdout}\n${query.stderr}`);
  }
  if (result.code !== 0 || !resultUrl) {
    throw new Error(explainLibtvFailure(result, `${task.label}生成失败`));
  }
  task.resultUrl = resultUrl;
  const extension = (() => {
    try {
      const value = path.extname(new URL(resultUrl).pathname).toLowerCase();
      return /^\.(png|jpe?g|webp)$/.test(value) ? value : ".png";
    } catch {
      return ".png";
    }
  })();
  task.localPath = path.join(job.outputDir, `${task.angle}${extension}`);
  await downloadFile(resultUrl, task.localPath);
  task.status = "success";
  task.progress = 100;
  job.summary.success += 1;
  jobLog(job, `${task.label}已完成（LibTV · ${model.name}）`, "success");
  await saveIdentityJob(job);
}

async function processLibtvIdentityJob(job) {
  job.status = "running";
  await saveIdentityJob(job);
  try {
    const account = await runLibtv(["account", "info"]);
    if (account.code !== 0) throw new Error(explainLibtvFailure(account, "LibTV 未登录"));
    const capabilities = await libtvCapabilities();
    const model = findLibtvModel(capabilities.models.image, job.config.identityModel, "图片");
    jobLog(job, `开始生成第${job.version}版人物三视图（LibTV · ${model.name}）`);
    const canvas = await createPersonLibtvCanvas(job, "人物三视图");
    const sourceNodeName = `人物正面参考图-${job.id}`;
    const upload = await runLibtv([
      "upload", sourceNodeName, "-p", canvas.projectId, "-t", "image", "-f", job.sourcePath, "--x", "80", "--y", "80"
    ]);
    if (upload.code !== 0) throw new Error(explainLibtvFailure(upload, "人物参考图上传失败"));
    jobLog(job, "人物参考图上传完成，开始并发生成三个角度", "success");
    await Promise.all(job.tasks.map(async (task, index) => {
      try {
        await processLibtvIdentityAngle(job, task, model, canvas.projectId, sourceNodeName, index);
      } catch (error) {
        task.status = "failed";
        task.error = compactProviderError(error, "libtv");
        job.summary.failed += 1;
        jobLog(job, `${task.label}失败：${task.error}`, "error");
        await saveIdentityJob(job);
      }
    }));
    job.status = job.summary.success === 3 ? "success" : job.summary.success ? "partial" : "failed";
  } catch (error) {
    job.status = "failed";
    job.error = compactProviderError(error, "libtv");
    job.summary.failed = 3 - job.summary.success;
    jobLog(job, job.error, "error");
  } finally {
    await saveIdentityJob(job);
  }
}

async function processIdentityJob(job) {
  if (job?.config?.provider === "libtv-cli") return processLibtvIdentityJob(job);
  if (job?.config?.provider === "kling-cli") return processKlingIdentityJob(job);
  return processMultimodalIdentityJob(job);
}

function klingVideoArgs(model, references, prompt, hasDialogue) {
  const args = ["--model", model.model];
  const uniqueReferences = [...new Set((references || []).filter(Boolean))];
  const shape = klingReferenceInputShape(model);
  if (uniqueReferences.length > shape.max) {
    throw new Error(`所选可灵模型最多支持 ${shape.max} 张参考图，当前准备了 ${uniqueReferences.length} 张`);
  }
  if (uniqueReferences.length < shape.required) {
    throw new Error(`所选可灵模型至少需要 ${shape.required} 张不同的参考图，当前准备了 ${uniqueReferences.length} 张`);
  }
  for (const reference of uniqueReferences) args.push("--image", reference);
  const duration = preferredKlingValue(model, "duration", "15");
  const aspectRatio = preferredKlingValue(model, "aspect_ratio", "9:16");
  const multiShot = preferredKlingValue(model, "prefer_multi_shots", "true");
  if (duration) args.push("--duration", duration);
  if (aspectRatio) args.push("--aspectRatio", aspectRatio);
  if (multiShot) args.push("--preferMultiShots", multiShot);
  if (hasDialogue && klingArgument(model, "enable_audio")) args.push("--enableAudio", "true");
  args.push(prompt);
  return args;
}

function personTaskKey(task) {
  return `${String(task?.kind || "")}:${Number(task?.variantIndex || 0)}`;
}

function selectKlingPersonTasks(tasks, retryKeys = []) {
  const allowlist = new Set(Array.isArray(retryKeys) ? retryKeys : []);
  return (tasks || []).filter((task) => {
    if (task.status === "success") return false;
    return !allowlist.size || allowlist.has(personTaskKey(task));
  });
}

function recalculatePersonJobSummary(job) {
  const tasks = Array.isArray(job?.tasks) ? job.tasks : [];
  const success = tasks.filter((task) => task.status === "success").length;
  const failed = tasks.filter((task) => ["failed", "blocked", "interrupted"].includes(String(task.status))).length;
  const notStarted = tasks.filter((task) => ["queued", "pending"].includes(String(task.status))).length;
  job.summary = { success, failed, notStarted, total: tasks.length };
  return job.summary;
}

async function processKlingPersonTask(job, task, context) {
  task.status = "running";
  task.attempts = [];
  await savePersonJob(job);
  const basePrompt = personPrompt(
    context.product,
    task.kind,
    context.sourceType,
    context.dialogue,
    context.adjustments,
    task.variantIndex
  );
  const referenceGuide = context.references.map((_, index) => `图片${index + 1}`).join("、");
  task.prompt = `${basePrompt}\n参考图规则：${referenceGuide}均为本次生成的真实参考素材。图片1固定为人物身份基准；其余图片用于保持产品包装、使用动作或人物角度一致。不得出现额外字幕、口播字幕、水印或乱码。`;
  task.preflight = validateGenerationTaskContract({
    workflow: "person",
    config: job.config,
    task: { ...task, prompt: task.prompt }
  });
  if (!task.preflight.ok) throw new Error(`生成前规则校验失败：${task.preflight.errors.join("；")}`);
  const created = parseKlingResult(await runKlingCli(
    "image_to_video",
    klingVideoArgs(context.model, context.references, task.prompt, Boolean(context.dialogue)),
    { timeoutMs: 90 * 1000 }
  ));
  task.remoteTaskId = klingGenerationId(created);
  task.remoteStatus = klingStatus(created) || "queued";
  task.engine = "kling-cli";
  task.model = context.model.model;
  task.attempts.push({ engine: "kling-cli", model: context.model.model, status: "submitted" });
  if (!task.remoteTaskId) throw new Error("可灵视频任务未返回 generationId");
  const completed = await waitForKlingTask(job, task, task.remoteTaskId, "video", savePersonJob);
  task.resultUrl = completed.url;
  task.status = "success";
  task.progress = 100;
  job.summary.success += 1;
  jobLog(job, `${task.label}已完成（可灵 CLI · ${context.model.alias}）`, "success");
  await savePersonJob(job);
}

async function processKlingPersonJob(job) {
  const retryTaskKeys = new Set(Array.isArray(job.retryTaskKeys) ? job.retryTaskKeys : []);
  job.status = "running";
  job.error = "";
  job.failure = null;
  recalculatePersonJobSummary(job);
  await savePersonJob(job);
  try {
    if (job.sourceType !== "views") {
      throw new Error("可灵 CLI 当前只接受图片参考。请先使用“正面照·生成三视图”建立人物基准，再开始生成。视频原片保留给 LibTV 的视频理解工作流。");
    }
    job.stage = "connection";
    job.preparation.connection.status = "running";
    jobLog(job, "正在校验可灵 CLI 登录与模型权限");
    await savePersonJob(job);
    const capabilities = await klingCapabilities(true);
    const model = findKlingModel(capabilities.models.imageToVideo, job.config.klingModel);
    job.preparation.connection.status = "success";
    job.preparation.connection.label = "可灵 CLI 已连接";

    const product = resolveProduct(job.config);
    const productFiles = product.noProduct ? [] : (await listImageFiles(product.imageDir, product)).slice(0, 3);
    if (!product.noProduct && !productFiles.length) throw new Error("所选产品没有可用的产品参考图");
    const identityRefs = (job.identityImagePaths || []).filter(Boolean);
    if (!identityRefs.length) throw new Error("人物三视图未就绪，请重新生成三视图后再开始视频生成");
    const references = selectKlingReferences(model, identityRefs, productFiles);
    job.preparation.product.status = product.noProduct ? "skipped" : "success";
    job.preparation.product.label = product.noProduct ? "不出现产品" : `已准备 ${productFiles.length} 张产品参考图`;
    job.preparation.product.total = productFiles.length;
    job.preparation.product.done = productFiles.length;
    job.preparation.person.status = "success";
    job.preparation.person.label = `已准备 ${identityRefs.length} 张人物基准图`;
    job.preparation.person.total = identityRefs.length;
    job.preparation.person.done = identityRefs.length;
    if (job.preparation.audio) {
      job.preparation.audio.status = "skipped";
      job.preparation.audio.label = "可灵 CLI 不使用音色参考文件";
    }
    job.stage = "generation";
    jobLog(job, `参考素材已准备完成，正在并发提交 ${job.tasks.length} 个可灵视频任务`, "success");
    await savePersonJob(job);
    const context = {
      product,
      sourceType: job.sourceType,
      model,
      references,
      dialogue: job.config.dialogue,
      adjustments: {
        clothing: job.config.clothingPrompt,
        styling: job.config.stylingPrompt,
        background: job.config.backgroundPrompt,
        other: job.config.otherPrompt,
        productNameStyle: job.config.productNameStyle,
        productName: job.config.spokenProductName,
        cleanSourceText: job.config.cleanSourceText
      }
    };
    const pendingTasks = selectKlingPersonTasks(job.tasks, [...retryTaskKeys]);
    if (!pendingTasks.length) throw new Error("没有符合本次重试范围的失败任务");
    await Promise.all(pendingTasks.map(async (task) => {
      try {
        await processKlingPersonTask(job, task, context);
      } catch (error) {
        task.status = "failed";
        task.error = compactProviderError(error, "kling");
        task.diagnostic = providerErrorDiagnostic(error);
        task.attempts.push({ engine: "kling-cli", model: model.model, status: "failed", error: task.error });
        job.summary.failed += 1;
        jobLog(job, `${task.label}失败：${task.error}`, "error");
        await savePersonJob(job);
      }
    }));
    const summary = recalculatePersonJobSummary(job);
    job.status = summary.success === summary.total ? "success" : summary.success ? "partial" : "failed";
  } catch (error) {
    job.status = "failed";
    job.error = compactProviderError(error, "kling");
    job.failure = {
      title: "可灵 CLI 任务未完成",
      hint: job.error,
      technical: providerErrorDiagnostic(error)
    };
    for (const task of job.tasks) {
      if (task.status === "success") continue;
      if (retryTaskKeys.size && !retryTaskKeys.has(personTaskKey(task))) continue;
      if (!["queued", "pending", "running"].includes(String(task.status))) continue;
      task.status = "failed";
      task.error = job.error;
      task.diagnostic = job.failure.technical;
    }
    jobLog(job, job.error, "error");
  } finally {
    recalculatePersonJobSummary(job);
    job.retryTaskKeys = [];
    await savePersonJob(job);
  }
}

function engineSequence(requested, context) {
  if (Array.isArray(context.referenceAudioUrls) && context.referenceAudioUrls.length) return ["seedance"];
  if (context.sourceVideoUrl && context.dialogue) return ["seedance"];
  if (requested === "kling") return ["kling"];
  if (requested === "seedance") return ["seedance"];
  return ["kling", "seedance"];
}

function klingPayload(job, task, context, prompt) {
  const imageUrls = [...context.personUrls, ...context.productUrls];
  const base = {
    mode: "std",
    prompt,
    aspect_ratio: "9:16",
    duration: "15",
    sound: context.sourceVideoUrl ? "off" : context.dialogue ? "on" : "off",
    image_list: imageUrls.map((imageUrl) => ({ image_url: imageUrl, type: "refer" })),
    external_task_id: `${job.id}-${task.kind}-${task.variantIndex}`
  };
  if (context.sourceVideoUrl) {
    base.video_list = [{ video_url: context.sourceVideoUrl, refer_type: "base", keep_original_sound: "no" }];
  }
  return base;
}

function seedancePayload(task, context, prompt) {
  const payload = {
    mode: context.sourceVideoUrl ? "video_edit" : "image_to_video",
    model: "doubao-seedance-2-0-260128",
    prompt,
    ratio: "9:16",
    duration: 15,
    resolution: "720p",
    generate_audio: Boolean(context.dialogue || context.referenceAudioUrls?.length),
    web_search: false,
    reference_images: [...context.personUrls, ...context.productUrls]
  };
  if (context.referenceAudioUrls?.length) {
    payload.reference_audios = context.referenceAudioUrls.slice(0, 3);
  }
  if (context.sourceVideoUrl) {
    payload.reference_videos = [context.sourceVideoUrl];
    payload.edit_source_video_url = context.sourceVideoUrl;
  }
  return payload;
}

async function runPersonEngine(job, task, context, engine) {
  const prompt = personPrompt(
    context.product,
    task.kind,
    context.sourceType,
    context.dialogue,
    context.adjustments,
    task.variantIndex
  );
  task.prompt = prompt;
  task.preflight = validateGenerationTaskContract({
    workflow: "person",
    config: job.config,
    task: { ...task, prompt }
  });
  if (!task.preflight.ok) throw new Error(`生成前规则校验失败：${task.preflight.errors.join("；")}`);
  const endpoint = engine === "kling" ? "/v1/kling/video/generations" : "/v1/video/generations";
  const json = engine === "kling" ? klingPayload(job, task, context, prompt) : seedancePayload(task, context, prompt);
  const createdPayload = await jenRequest(context.baseUrl, endpoint, context.token, { method: "POST", json });
  const created = createdPayload?.data || createdPayload;
  task.remoteTaskId = created?.task_id;
  task.remoteStatus = upstreamStatus(created) || "queued";
  task.engine = engine;
  if (!task.remoteTaskId) throw new Error(`${engine}任务未返回task_id`);
  const completed = await waitForRemoteTask(job, task, endpoint, context.token, context.baseUrl, savePersonJob);
  const fileName = `${task.kind}-${String(task.variantIndex).padStart(2, "0")}.mp4`;
  task.localPath = path.join(job.outputDir, fileName);
  await downloadGeneratedVideo(job, task, context, endpoint, completed, task.localPath);
}

async function processPersonTask(job, task, context) {
  task.status = "running";
  task.attempts = [];
  jobLog(job, `开始生成：${task.label}`);
  await savePersonJob(job);
  let lastError;
  for (const engine of engineSequence(job.config.engine, context)) {
    try {
      await runPersonEngine(job, task, context, engine);
      task.attempts.push({ engine, status: "success" });
      task.status = "success";
      task.progress = 100;
      job.summary.success += 1;
      jobLog(job, `${task.label}已完成（${engine === "kling" ? "Kling Omni" : "Seedance 2.0"}）`, "success");
      await savePersonJob(job);
      return;
    } catch (error) {
      lastError = error;
      task.attempts.push({ engine, status: "failed", error: error.message });
      jobLog(job, `${task.label}使用${engine}失败：${error.message}`, "warn");
    }
  }
  throw lastError || new Error("没有可用的视频模型");
}

async function materializeReference(reference, destinationDir, index) {
  const value = String(reference || "");
  if (!/^https?:\/\//i.test(value)) return value;
  let extension = ".png";
  try {
    const parsed = path.extname(new URL(value).pathname).toLowerCase();
    if (/^\.(png|jpe?g|webp)$/.test(parsed)) extension = parsed;
  } catch {}
  const destination = path.join(destinationDir, `人物参考图-${index + 1}${extension}`);
  await downloadFile(value, destination);
  return destination;
}

function libtvVideoSettings(model, sourceType, hasDialogue) {
  const isWan = model.key === "wanx2.7-video";
  const settings = [
    `model=${model.name}`,
    `modeType=${isWan || sourceType === "video" ? "mixed2video" : "image2video"}`,
    "ratio=9:16",
    `resolution=${isWan ? "720P" : "720p"}`,
    `duration=${isWan ? "10" : "15"}`,
    `enableSound=${hasDialogue ? "on" : "off"}`,
    "count=1"
  ];
  if (!isWan) settings.push("searchEnabled=0", "autoCompliance=0");
  return settings;
}

async function processLibtvPersonTask(job, task, context, index) {
  task.status = "running";
  task.engine = "libtv-cli";
  task.model = context.model.name;
  task.attempts = [];
  const basePrompt = personPrompt(
    context.product,
    task.kind,
    context.sourceType,
    context.dialogue,
    context.adjustments,
    task.variantIndex
  );
  task.prompt = `${basePrompt}\nLibTV 参考素材规则：严格继承已连接的参考图片或参考视频中的人物身份、镜头逻辑和动作关系；产品画面严格继承产品参考图。禁止新增口播字幕、错误品牌字、水印或乱码。`;
  task.preflight = validateGenerationTaskContract({ workflow: "person", config: job.config, task: { ...task, prompt: task.prompt } });
  if (!task.preflight.ok) throw new Error(`生成前规则校验失败：${task.preflight.errors.join("；")}`);
  const nodeName = `明星视频-${String(index + 1).padStart(2, "0")}-${safeName(task.label)}`;
  const args = [
    "node", "--x", String(650 + (index % 4) * 650), "--y", String(520 + Math.floor(index / 4) * 560),
    "create", nodeName, "-p", context.projectId, "-t", "video"
  ];
  const compatibleLeftNodes = context.model.key === "wanx2.7-video"
    ? context.leftNodes.slice(0, 5)
    : context.leftNodes.slice(0, 9);
  for (const node of compatibleLeftNodes) args.push("--left", node);
  for (const setting of libtvVideoSettings(context.model, context.sourceType, Boolean(context.dialogue))) args.push("-s", setting);
  args.push("--prompt", task.prompt, "-r");
  await savePersonJob(job);
  const result = await runLibtv(args, {
    onStderr: (chunk) => {
      const progress = chunk.match(/progress=\d+%/g);
      if (progress) {
        task.remoteStatus = progress[progress.length - 1];
        task.progress = Number.parseInt(task.remoteStatus.match(/\d+/)?.[0], 10) || task.progress;
      }
    }
  });
  const rawPath = path.join(job.outputDir, `libtv_video_${String(index + 1).padStart(2, "0")}.txt`);
  await fsp.writeFile(rawPath, `${result.stdout}\n${result.stderr}`, "utf8");
  let resultUrl = extractMp4(`${result.stdout}\n${result.stderr}`);
  if (!resultUrl && result.code === 0) {
    const query = await runLibtv(["node", nodeName, "-p", context.projectId]);
    resultUrl = extractMp4(`${query.stdout}\n${query.stderr}`);
  }
  if (result.code !== 0 || !resultUrl) throw new Error(explainLibtvFailure(result, `${task.label}生成失败`));
  task.resultUrl = resultUrl;
  task.remoteStatus = "completed";
  task.localPath = path.join(job.outputDir, `${String(index + 1).padStart(2, "0")}-${safeName(task.label)}.mp4`);
  await downloadFile(resultUrl, task.localPath);
  task.status = "success";
  task.progress = 100;
  task.attempts.push({ engine: "libtv-cli", model: context.model.name, status: "success" });
  job.summary.success += 1;
  jobLog(job, `${task.label}已完成（LibTV · ${context.model.name}）`, "success");
  await savePersonJob(job);
}

async function processLibtvPersonJob(job) {
  job.status = "running";
  await savePersonJob(job);
  try {
    job.stage = "connection";
    job.preparation.connection.status = "running";
    jobLog(job, "正在校验 LibTV 登录与模型权限");
    const account = await runLibtv(["account", "info"]);
    if (account.code !== 0) throw new Error(explainLibtvFailure(account, "LibTV 未登录"));
    const capabilities = await libtvCapabilities(true);
    const model = findLibtvModel(capabilities.models.video, job.config.libtvVideoModel, "视频");
    job.preparation.connection.status = "success";
    job.preparation.connection.label = "LibTV 已连接";
    const canvas = await createPersonLibtvCanvas(job, "明星画面");

    await fsp.mkdir(job.outputDir, { recursive: true });
    const leftNodes = [];
    job.stage = "person-upload";
    job.preparation.person.status = "running";
    if (job.sourceType === "video") {
      const nodeName = "人物参考视频";
      const upload = await runLibtv(["upload", nodeName, "-p", canvas.projectId, "-t", "video", "-f", job.sourcePath, "--x", "80", "--y", "80"]);
      if (upload.code !== 0) throw new Error(explainLibtvFailure(upload, "人物参考视频上传失败"));
      leftNodes.push(nodeName);
      job.preparation.person.total = 1;
      job.preparation.person.done = 1;
      job.preparation.person.label = "人物参考视频已上传";
    } else {
      const referenceDir = path.join(job.outputDir, "_references");
      await fsp.mkdir(referenceDir, { recursive: true });
      const references = [];
      for (let index = 0; index < (job.identityImagePaths || []).length; index += 1) {
        references.push(await materializeReference(job.identityImagePaths[index], referenceDir, index));
      }
      if (!references.length) throw new Error("人物参考图片尚未准备完成");
      job.preparation.person.total = references.length;
      for (let index = 0; index < references.length; index += 1) {
        const nodeName = `人物参考图-${index + 1}`;
        const upload = await runLibtv(["upload", nodeName, "-p", canvas.projectId, "-t", "image", "-f", references[index], "--x", String(80 + index * 260), "--y", "80"]);
        if (upload.code !== 0) throw new Error(explainLibtvFailure(upload, `人物参考图 ${index + 1} 上传失败`));
        leftNodes.push(nodeName);
        job.preparation.person.done = index + 1;
      }
      job.preparation.person.label = `已上传 ${references.length} 张人物参考图`;
    }
    job.preparation.person.status = "success";

    const product = resolveProduct(job.config);
    const productFiles = product.noProduct ? [] : (await listImageFiles(product.imageDir, product)).slice(0, job.sourceType === "video" ? 3 : 5);
    if (!product.noProduct && !productFiles.length) throw new Error("所选产品没有可用的产品参考图");
    job.preparation.product.status = product.noProduct ? "skipped" : "running";
    job.preparation.product.total = productFiles.length;
    for (let index = 0; index < productFiles.length; index += 1) {
      const nodeName = `产品参考图-${index + 1}`;
      const upload = await runLibtv(["upload", nodeName, "-p", canvas.projectId, "-t", "image", "-f", productFiles[index], "--x", String(80 + index * 260), "--y", "320"]);
      if (upload.code !== 0) throw new Error(explainLibtvFailure(upload, `产品参考图 ${index + 1} 上传失败`));
      leftNodes.push(nodeName);
      job.preparation.product.done = index + 1;
    }
    job.preparation.product.status = product.noProduct ? "skipped" : "success";
    job.preparation.product.label = product.noProduct ? "不出现产品" : `已上传 ${productFiles.length} 张产品参考图`;
    if (job.preparation.audio) {
      job.preparation.audio.status = "skipped";
      job.preparation.audio.label = "本次未使用参考音频";
    }

    job.stage = "generation";
    jobLog(job, `参考素材已准备完成，正在并发提交 ${job.tasks.length} 个 LibTV 视频任务`, "success");
    await savePersonJob(job);
    const context = {
      projectId: canvas.projectId,
      model,
      product,
      sourceType: job.sourceType,
      leftNodes,
      dialogue: job.config.dialogue,
      adjustments: {
        clothing: job.config.clothingPrompt,
        styling: job.config.stylingPrompt,
        background: job.config.backgroundPrompt,
        other: job.config.otherPrompt,
        productNameStyle: job.config.productNameStyle,
        productName: job.config.spokenProductName,
        cleanSourceText: job.config.cleanSourceText
      }
    };
    await runConcurrent(job.tasks, Math.min(4, job.tasks.length), async (task) => {
      const index = job.tasks.indexOf(task);
      try {
        await processLibtvPersonTask(job, task, context, index);
      } catch (error) {
        task.status = "failed";
        task.error = compactProviderError(error, "libtv");
        task.attempts = [...(task.attempts || []), { engine: "libtv-cli", model: model.name, status: "failed", error: task.error }];
        job.summary.failed += 1;
        jobLog(job, `${task.label}失败：${task.error}`, "error");
        await savePersonJob(job);
      }
    });
    job.status = job.summary.success === job.summary.total ? "success" : job.summary.success ? "partial" : "failed";
  } catch (error) {
    job.status = "failed";
    job.error = compactProviderError(error, "libtv");
    job.failure = { title: "LibTV 任务未完成", hint: job.error, technical: job.error };
    jobLog(job, job.error, "error");
  } finally {
    await savePersonJob(job);
  }
}

async function processPersonJob(job) {
  if (job?.config?.provider === "libtv-cli") return processLibtvPersonJob(job);
  if (job?.config?.provider === "kling-cli") return processKlingPersonJob(job);
  job.status = "running";
  await savePersonJob(job);
  try {
    let token = personSecrets.get(job.id);
    if (!token) {
      const resolved = await resolveJenToken(job.config.baseUrl);
      token = resolved.token;
      personSecrets.set(job.id, token);
    }
    job.stage = "connection";
    job.preparation.connection.status = "running";
    jobLog(job, "正在校验公司多模态服务连接");
    await savePersonJob(job);
    await jenRequest(job.config.baseUrl, "/v1/session", token, { timeout: 30000 });
    job.preparation.connection.status = "success";
    jobLog(job, "公司多模态服务连接校验通过", "success");
    await savePersonJob(job);

    const productUrls = [];
    const product = resolveProduct(job.config);
    if (product.noProduct) {
      job.preparation.product.status = "skipped";
      job.preparation.product.label = "不出现产品";
      job.preparation.product.total = 0;
      job.preparation.product.done = 0;
      jobLog(job, "已选择“不出现产品”，跳过产品图上传并锁定无产品生成规则", "success");
      await savePersonJob(job);
    } else {
      const productFiles = (await listImageFiles(product.imageDir, product)).slice(0, 3);
      if (!productFiles.length) throw new Error("所选产品没有可用产品参考图");
      job.stage = "product-upload";
      job.preparation.product.status = "running";
      job.preparation.product.total = productFiles.length;
      jobLog(job, `准备上传 ${productFiles.length} 张产品参考图`);
      await savePersonJob(job);
      for (let index = 0; index < productFiles.length; index += 1) {
        const file = productFiles[index];
        const label = `产品参考图 ${index + 1}/${productFiles.length}（${path.basename(file)}）`;
        productUrls.push(await uploadWithRetry(job, file, "/v1/image/upload", label, token));
        job.preparation.product.done = index + 1;
        await savePersonJob(job);
      }
      job.preparation.product.status = "success";
      await savePersonJob(job);
    }

    job.stage = "person-upload";
    job.preparation.person.status = "running";
    const personUrls = [];
    let sourceVideoUrl = "";
    if (job.sourceType === "video") {
      job.preparation.person.total = 1;
      sourceVideoUrl = await uploadWithRetry(job, job.sourcePath, "/v1/video/upload", `人物视频（${job.sourceName || path.basename(job.sourcePath)}）`, token);
      job.preparation.person.done = 1;
    } else {
      job.preparation.person.total = job.identityImagePaths.length;
      for (let index = 0; index < job.identityImagePaths.length; index += 1) {
        const file = job.identityImagePaths[index];
        personUrls.push(await uploadWithRetry(job, file, "/v1/image/upload", `人物三视图 ${index + 1}/${job.identityImagePaths.length}`, token));
        job.preparation.person.done = index + 1;
      }
    }
    job.preparation.person.status = "success";

    const referenceAudioUrls = [];
    if (job.referenceAudio?.filePath) {
      job.stage = "audio-upload";
      job.preparation.audio.status = "running";
      job.preparation.audio.total = 1;
      jobLog(job, `正在上传内置参考音频：${job.referenceAudio.name}`);
      await savePersonJob(job);
      referenceAudioUrls.push(await uploadWithRetry(
        job,
        job.referenceAudio.filePath,
        "/v1/video/upload",
        `参考音频（${job.referenceAudio.name}）`,
        token
      ));
      job.preparation.audio.done = 1;
      job.preparation.audio.status = "success";
      jobLog(job, "参考音频上传完成；本批视频将统一使用 Seedance 参考音色能力", "success");
    } else if (job.preparation.audio) {
      job.preparation.audio.status = "skipped";
    }

    job.stage = "generation";
    jobLog(job, `全部参考素材上传完成，开始创建 ${job.tasks.length} 个视频任务`, "success");
    await savePersonJob(job);
    const context = {
      product,
      sourceType: job.sourceType,
      personUrls,
      sourceVideoUrl,
      productUrls,
      referenceAudioUrls,
      dialogue: job.config.dialogue,
      adjustments: {
        clothing: job.config.clothingPrompt,
        styling: job.config.stylingPrompt,
        background: job.config.backgroundPrompt,
        other: job.config.otherPrompt,
        productNameStyle: job.config.productNameStyle,
        productName: job.config.spokenProductName,
        cleanSourceText: job.config.cleanSourceText,
        referenceAudioName: job.referenceAudio?.name || "",
        referenceAudioStyle: job.referenceAudio?.style || ""
      },
      token,
      baseUrl: job.config.baseUrl
    };
    if (sourceVideoUrl && job.config.dialogue) {
      jobLog(job, "视频原片模式包含新口播台词：根据 Kling 接口限制，本次自动使用 Seedance 生成新声音", "info");
    }
    if (referenceAudioUrls.length) {
      jobLog(job, `已选择参考音频“${job.referenceAudio.name}”，本批任务自动固定使用 Seedance，确保音色参考参数生效`, "info");
    }
    const retryTaskKeys = new Set(Array.isArray(job.retryTaskKeys) ? job.retryTaskKeys : []);
    const runnableTasks = job.tasks.filter((task) => {
      if (task.status === "success") return false;
      return !retryTaskKeys.size || retryTaskKeys.has(personTaskKey(task));
    });
    for (let index = 0; index < runnableTasks.length; index += 2) {
      const batch = runnableTasks.slice(index, index + 2);
      await Promise.all(batch.map(async (task) => {
        try {
          await processPersonTask(job, task, context);
        } catch (error) {
          task.status = "failed";
          task.error = error.message;
          job.summary.failed += 1;
          jobLog(job, `${task.label}失败：${error.message}`, "error");
          await savePersonJob(job);
        }
      }));
    }
    recalculatePersonJobSummary(job);
    job.status = job.summary.success === job.summary.total ? "success" : job.summary.success ? "partial" : "failed";
  } catch (error) {
    job.status = "failed";
    job.error = error.message;
    const stageLabels = {
      connection: "接口连接检查",
      "product-upload": error.uploadLabel || "产品参考图上传",
      "person-upload": error.uploadLabel || "人物素材上传",
      "audio-upload": error.uploadLabel || "参考音频上传",
      generation: "视频任务创建"
    };
    job.failure = explainUpstreamError(error, stageLabels[job.stage] || "任务准备");
    const activePreparation = job.stage === "connection" ? job.preparation.connection :
      job.stage === "product-upload" ? job.preparation.product :
      job.stage === "person-upload" ? job.preparation.person :
      job.stage === "audio-upload" ? job.preparation.audio : null;
    if (activePreparation) {
      activePreparation.status = "failed";
      activePreparation.error = job.failure.title;
    }
    for (const task of job.tasks) {
      if (["queued", "running"].includes(task.status)) {
        task.status = "blocked";
        task.error = `未开始：${job.failure.title}`;
      }
    }
    job.summary.failed = job.tasks.filter((task) => task.status === "failed").length;
    job.summary.notStarted = job.tasks.filter((task) => task.status === "blocked").length;
    jobLog(job, `${job.failure.title}。${job.failure.hint}（技术信息：${job.failure.technical}）`, "error");
  } finally {
    job.retryTaskKeys = [];
    personSecrets.delete(job.id);
    await savePersonJob(job);
  }
}

function readUpdateConfig() {
  try {
    if (fs.existsSync(UPDATE_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(UPDATE_CONFIG_PATH, "utf8"));
    }
  } catch {
    // Keep the updater usable even if the config file is edited incorrectly.
  }
  return {};
}

function isHttpReference(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function normalizeConfigReference(reference) {
  const value = String(reference || DEFAULT_UPDATE_MANIFEST).trim();
  if (isHttpReference(value)) return value;
  return path.isAbsolute(value) ? value : path.resolve(APP_ROOT, value);
}

function resolvePackageReference(reference, manifestReference) {
  const value = String(reference || "").trim();
  if (!value) return "";
  if (isHttpReference(value)) return value;
  if (isHttpReference(manifestReference)) return new URL(value, manifestReference).toString();
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(manifestReference), value);
}

function compareVersions(left, right) {
  const a = String(left || "0.0.0").split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0);
  const b = String(right || "0.0.0").split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0);
  for (let i = 0; i < Math.max(a.length, b.length, 3); i += 1) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta) return delta;
  }
  return 0;
}

function httpGetBuffer(target, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects"));
      return;
    }
    let parsed;
    try {
      parsed = new URL(target);
    } catch (error) {
      reject(error);
      return;
    }
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(parsed, { headers: { "User-Agent": `ProductShotGenerator/${APP_VERSION}` } }, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        resolve(httpGetBuffer(new URL(response.headers.location, target).toString(), redirectCount + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
}

async function readTextSource(reference) {
  if (isHttpReference(reference)) {
    return (await httpGetBuffer(reference)).toString("utf8");
  }
  return fsp.readFile(reference, "utf8");
}

async function copySourceToFile(reference, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  if (isHttpReference(reference)) {
    await fsp.writeFile(destination, await httpGetBuffer(reference));
    return;
  }
  await fsp.copyFile(reference, destination);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `PowerShell exited with ${code}`));
    });
  });
}

async function extractZip(zipPath, destination) {
  await fsp.mkdir(destination, { recursive: true });
  await runPowerShell(`Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destination)} -Force`);
}

async function findUpdateAppDir(rootDir) {
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const item = queue.shift();
    const serverPath = path.join(item.dir, "server.js");
    const packagePath = path.join(item.dir, "package.json");
    const publicPath = path.join(item.dir, "public", "app.js");
    if (fs.existsSync(serverPath) && fs.existsSync(packagePath) && fs.existsSync(publicPath)) {
      return item.dir;
    }
    if (item.depth >= 4) continue;
    let entries = [];
    try {
      entries = await fsp.readdir(item.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push({ dir: path.join(item.dir, entry.name), depth: item.depth + 1 });
    }
  }
  return "";
}

async function copyUpdateIntoApp(sourceAppDir) {
  const files = [
    "server.js",
    "package.json",
    "README.md",
    "start-product-shot-generator.ps1",
    "start-product-shot-generator.cmd",
    "启动产品镜生成器.ps1",
    "启动产品镜生成器.cmd"
  ];
  const dirs = ["public", "assets"];

  for (const file of files) {
    const source = path.join(sourceAppDir, file);
    if (fs.existsSync(source)) {
      await fsp.copyFile(source, path.join(APP_ROOT, file));
    }
  }
  for (const dir of dirs) {
    const source = path.join(sourceAppDir, dir);
    if (fs.existsSync(source)) {
      await fsp.cp(source, path.join(APP_ROOT, dir), { recursive: true, force: true });
    }
  }
}

async function loadUpdateManifest() {
  const config = readUpdateConfig();
  const manifestReference = normalizeConfigReference(config.manifest || config.manifestUrl || DEFAULT_UPDATE_MANIFEST);
  const result = {
    configured: true,
    manifestReference,
    currentVersion: APP_VERSION,
    latestVersion: "",
    updateAvailable: false,
    notes: [],
    error: ""
  };

  try {
    if (!isHttpReference(manifestReference) && !fs.existsSync(manifestReference)) {
      result.configured = false;
      result.error = "未找到更新清单";
      return result;
    }
    const manifest = JSON.parse((await readTextSource(manifestReference)).replace(/^\uFEFF/, ""));
    result.manifest = manifest;
    result.latestVersion = String(manifest.version || "");
    result.notes = Array.isArray(manifest.notes) ? manifest.notes : [];
    result.packageSize = manifest.package?.size || 0;
    result.updateAvailable = result.latestVersion ? compareVersions(result.latestVersion, APP_VERSION) > 0 : false;
    return result;
  } catch (error) {
    result.configured = false;
    result.error = `读取更新清单失败：${error.message}`;
    return result;
  }
}

function publicUpdateStatus(status) {
  return {
    configured: status.configured,
    currentVersion: status.currentVersion,
    latestVersion: status.latestVersion,
    updateAvailable: status.updateAvailable,
    notes: status.notes || [],
    packageSize: status.packageSize || 0,
    manifest: status.manifestReference,
    message: status.error || (status.updateAvailable ? "发现新版本" : "当前已是最新版本")
  };
}

function hasActiveJobs() {
  return [...jobs.values(), ...personJobs.values(), ...identityJobs.values()]
    .some((job) => job && ACTIVE_JOB_STATUSES.has(String(job.status)));
}

async function applyUpdatePackage() {
  const status = await loadUpdateManifest();
  if (!status.configured || !status.manifest) {
    throw new Error(status.error || "更新清单不可用");
  }
  if (!status.updateAvailable) {
    return { ok: true, skipped: true, restartRequired: false, ...publicUpdateStatus(status) };
  }

  const manifest = status.manifest;
  const packageInfo = manifest.package || {};
  const packageReference = resolvePackageReference(packageInfo.url || packageInfo.path, status.manifestReference);
  if (!packageReference) throw new Error("更新清单里缺少更新包地址");

  const downloadDir = path.join(UPDATE_WORK_DIR, "downloads");
  const stagingDir = path.join(UPDATE_WORK_DIR, "staging", `update-${safeName(manifest.version || nowStamp())}-${Date.now()}`);
  const packagePath = path.join(downloadDir, `product-shot-generator-update-${safeName(manifest.version || "latest")}.zip`);

  await copySourceToFile(packageReference, packagePath);
  if (packageInfo.sha256) {
    const actualHash = await hashFile(packagePath);
    if (actualHash.toLowerCase() !== String(packageInfo.sha256).toLowerCase()) {
      throw new Error("更新包校验失败，请重新获取更新包");
    }
  }

  await extractZip(packagePath, stagingDir);
  const sourceAppDir = await findUpdateAppDir(stagingDir);
  if (!sourceAppDir) throw new Error("更新包格式不正确，未找到 app 程序目录");

  await copyUpdateIntoApp(sourceAppDir);
  const applied = {
    version: manifest.version,
    appliedAt: new Date().toISOString(),
    manifest: status.manifestReference,
    package: packageReference
  };
  await fsp.mkdir(UPDATE_WORK_DIR, { recursive: true });
  await fsp.writeFile(path.join(UPDATE_WORK_DIR, "last-applied.json"), JSON.stringify(applied, null, 2), "utf8");

  return {
    ok: true,
    skipped: false,
    restartRequired: true,
    installedVersion: manifest.version,
    message: "更新已安装，重启产品镜生成器后生效"
  };
}

async function downloadVideo(job, task) {
  const filename = `【${safeName(task.productPurpose)}】_【${safeName(task.coreElement)}】_${String(task.index).padStart(2, "0")}.mp4`;
  const destination = path.join(job.outputDir, filename);
  log(job, `下载视频：${filename}`);
  await downloadFile(task.url, destination);
  task.localPath = destination;
}

async function runTask(job, task, imageFiles) {
  try {
    await runVideo(job, task, imageFiles);
    await downloadVideo(job, task);
    task.status = "success";
    job.summary.success += 1;
    log(job, `完成：${task.coreElement}`, "success");
  } catch (error) {
    task.status = "failed";
    task.error = error.message;
    job.summary.failed += 1;
    log(job, `${task.coreElement} 失败：${error.message}`, "error");
  } finally {
    await saveJob(job);
  }
}

async function runConcurrent(items, limit, handler) {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await handler(item);
    }
  });
  await Promise.all(workers);
}

async function processJob(job) {
  job.status = "running";
  await saveJob(job);
  try {
    const config = normalizeJobConfig(job.config);
    job.config = config;
    const product = resolveProduct(config);
    const spaceId = parseSpaceId(config.libtvUrl);
    const imageFiles = await listImageFiles(config.imageDir, product);
    if (!imageFiles.length) throw new Error("产品图文件夹里没有找到 png/jpg/webp 图片");

    const batchDir = path.join(config.outputDir || DEFAULTS.outputDir, safeName(config.productType), `${safeName(config.purpose)}-${safeName(config.scene)}`, nowStamp());
    await fsp.mkdir(batchDir, { recursive: true });
    job.outputDir = batchDir;
    log(job, `输出目录：${batchDir}`);
    log(job, `识别到 ${imageFiles.length} 张产品图`);

    const variants = buildVariants(config);
    job.tasks = variants.map((variant) => ({
      ...variant,
      status: "queued",
      projectId: "",
      canvasName: "",
      canvasUrl: "",
      localPath: "",
      url: ""
    }));
    for (const task of job.tasks) {
      task.preflight = validateGenerationTaskContract({ workflow: "product", config, task });
      if (!task.preflight.ok) throw new Error(`产品镜生成前校验失败：${task.preflight.errors.join("；")}`);
    }
    await fsp.writeFile(path.join(batchDir, "prompts.json"), JSON.stringify(job.tasks, null, 2), "utf8");

    const canvas = await createBatchCanvas(job, spaceId);
    await uploadBatchImages(job, imageFiles, canvas.projectId);
    for (const task of job.tasks) {
      task.projectId = canvas.projectId;
      task.canvasName = canvas.canvasName;
      task.canvasUrl = canvas.canvasUrl;
      task.status = "running";
    }
    const requestedConcurrency = Number(config.concurrentVideos || job.tasks.length);
    const concurrency = Number.isFinite(requestedConcurrency) ? Math.max(1, Math.min(job.tasks.length, requestedConcurrency)) : job.tasks.length;
    log(job, `开始并发生成：${job.tasks.length} 条视频，并发 ${concurrency}`);
    await saveJob(job);
    await runConcurrent(job.tasks, concurrency, (task) => runTask(job, task, imageFiles));

    job.status = job.summary.success === job.summary.total ? "success" : job.summary.success > 0 ? "partial" : "failed";
    log(job, `任务结束：成功 ${job.summary.success}/${job.summary.total}`);
    if (job.summary.success > 0) {
      log(job, `成片已保存到：${batchDir}`, "success");
    }
    await fsp.writeFile(path.join(batchDir, "result.json"), JSON.stringify(job, null, 2), "utf8");
  } catch (error) {
    job.status = "failed";
    job.error = error.message;
    log(job, error.message, "error");
  } finally {
    await saveJob(job);
  }
}

function startJob(job) {
  processJob(job).catch(async (error) => {
    job.status = "failed";
    job.error = error.message;
    log(job, `任务异常中断：${error.message}`, "error");
    try {
      await saveJob(job);
    } catch (saveError) {
      console.error(`保存任务失败：${saveError.message}`);
    }
  });
}

async function serveStatic(req, res, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(requestPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR)) return textResponse(res, 403, "Forbidden");
  try {
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    textResponse(res, 404, "Not found");
  }
}

async function handleApi(req, res, url) {
  const ownedJobMatch = url.pathname.match(/^\/api\/(jobs|identity-jobs|person-jobs)\/([^/]+)/);
  if (ownedJobMatch) {
    const jobMap = ownedJobMatch[1] === "identity-jobs"
      ? identityJobs
      : ownedJobMatch[1] === "person-jobs"
        ? personJobs
        : jobs;
    const ownedJob = jobMap.get(ownedJobMatch[2]);
    if (ownedJob && !jobOwnedByCurrentUser(ownedJob)) {
      return jsonResponse(res, 404, { error: "任务不存在" });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/defaults") {
    await refreshProductsFromWorkbench();
    return jsonResponse(res, 200, {
      ...DEFAULTS,
      products: publicProducts(),
      referenceAudios: referenceAudioCatalog().map(publicReferenceAudio),
      personDefaults: {
        outputDir: DEFAULT_OUTPUT_DIR
      }
    });
  }

  if (req.method === "GET" && url.pathname === "/api/kling-capabilities") {
    try {
      return jsonResponse(res, 200, await klingCapabilities(true));
    } catch (error) {
      return jsonResponse(res, 502, { error: safeKlingAuthMessage("可灵 CLI 不可用", error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/libtv-capabilities") {
    try {
      return jsonResponse(res, 200, await libtvCapabilities(true));
    } catch (error) {
      return jsonResponse(res, 502, { error: compactProviderError(error, "libtv") });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/libtv-status") {
    return jsonResponse(res, 200, await libtvStatus());
  }

  if (req.method === "GET" && ["/api/multimodal-auth-status", "/api/person-auth-status"].includes(url.pathname)) {
    try {
      return jsonResponse(res, 200, await multimodalAuthStatus());
    } catch (error) {
      const failure = explainUpstreamError(error, "多模态登录检查");
      return jsonResponse(res, 200, {
        available: false,
        provider: "multimodal",
        loginRequired: true,
        captchaRequired: Boolean(error?.captchaRequired),
        message: failure.title,
        hint: "可使用公司工号和密码登录；若本机已登录 FanDo，也可点击自动连接。"
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/multimodal-login") {
    const body = await readJson(req);
    try {
      const result = await multimodalLogin(body.baseUrl || DEFAULT_JENVIDEO_BASE_URL, body);
      return jsonResponse(res, 200, result);
    } catch (error) {
      return jsonResponse(res, error?.captchaRequired ? 409 : 401, {
        error: error.message,
        captchaRequired: Boolean(error?.captchaRequired),
        code: error?.upstreamCode
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/multimodal-auto-login") {
    try {
      clearCurrentAutomaticGenTokenCache();
      if (currentMultimodalSession().source !== "oa-login") {
        resetCurrentMultimodalSession();
      }
      return jsonResponse(res, 200, await multimodalAuthStatus());
    } catch (error) {
      const failure = explainUpstreamError(error, "自动连接多模态服务");
      return jsonResponse(res, 401, { error: failure.title, failure });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/multimodal-logout") {
    resetCurrentMultimodalSession();
    clearCurrentAutomaticGenTokenCache();
    return jsonResponse(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/libtv-login") {
    try {
      return jsonResponse(res, 202, startLibtvWebLogin());
    } catch (error) {
      return jsonResponse(res, 502, { error: compactProviderError(error, "libtv") });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/kling-install-status") {
    return jsonResponse(res, 200, await klingInstallStatus(true));
  }

  if (req.method === "POST" && url.pathname === "/api/kling-install") {
    try {
      return jsonResponse(res, 200, await installKlingCli());
    } catch (error) {
      return jsonResponse(res, 502, { error: safeKlingAuthMessage("可灵 CLI 安装失败", error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/kling-login") {
    const install = await klingInstallStatus(true);
    if (!install.installed) {
      return jsonResponse(res, 409, { error: "可灵 CLI 尚未安装，请先点击“安装并连接可灵”" });
    }
    const result = await runKlingCli("login", [], { timeoutMs: 5 * 60 * 1000 });
    try {
      parseKlingResult(result);
      klingCapabilityCache = { at: 0, data: null };
      return jsonResponse(res, 200, { ok: true, message: "可灵 CLI 登录完成" });
    } catch (error) {
      return jsonResponse(res, 502, { error: safeKlingAuthMessage("可灵登录未完成", error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/legacy-person-auth-status") {
    const install = await klingInstallStatus(true);
    if (!install.installed) {
      return jsonResponse(res, 200, {
        available: false,
        installed: false,
        canInstall: install.canInstall,
        provider: "kling-cli-cn",
        message: install.canInstall
          ? "尚未安装官方中国区可灵 CLI；点击“安装并连接可灵”即可完成安装与登录"
          : "本版本缺少可灵安装组件，请先在线更新工作台"
      });
    }
    try {
      const capabilities = await klingCapabilities(true);
      let account = null;
      let accountError = null;
      try {
        account = await klingAccountStatus();
      } catch (error) {
        accountError = error;
      }
      return jsonResponse(
        res,
        200,
        buildKlingConnectedAuthStatus(capabilities, account, accountError, install.canInstall)
      );
    } catch (error) {
      return jsonResponse(res, 200, {
        available: false,
        installed: true,
        canInstall: install.canInstall,
        provider: "kling-cli",
        requiredTeamSpace: "WIS品牌营销部",
        teamSpaceControlAvailable: false,
        teamSpaceVerification: "manual",
        identityAvailable: false,
        message: safeKlingAuthMessage(
          "可灵 CLI 已安装，但状态检查失败；请点击“重新连接可灵”后重试",
          error
        )
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/workbench/progress") {
    return jsonResponse(res, 200, personWorkbenchProgress());
  }

  if (req.method === "GET" && url.pathname === "/api/reference-audio") {
    return jsonResponse(res, 200, referenceAudioCatalog().map(publicReferenceAudio));
  }

  const referenceAudioMatch = url.pathname.match(/^\/api\/reference-audio\/([^/]+)$/);
  if (req.method === "GET" && referenceAudioMatch) {
    const item = resolveReferenceAudio(decodeURIComponent(referenceAudioMatch[1]));
    if (!item) return textResponse(res, 404, "Reference audio not found");
    const data = await fsp.readFile(item.filePath);
    res.writeHead(200, {
      "Content-Type": mimeForFile(item.filePath),
      "Content-Length": data.length,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes"
    });
    return res.end(data);
  }

  if (req.method === "GET" && url.pathname === "/api/products") {
    await refreshProductsFromWorkbench(true);
    return jsonResponse(res, 200, publicProducts());
  }

  if (req.method === "GET" && url.pathname === "/api/update/check") {
    const status = await loadUpdateManifest();
    return jsonResponse(res, 200, publicUpdateStatus(status));
  }

  if (req.method === "POST" && url.pathname === "/api/update/apply") {
    if (hasActiveJobs()) {
      return jsonResponse(res, 409, { error: "有任务正在生成，完成后再更新" });
    }
    const result = await applyUpdatePackage();
    return jsonResponse(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const result = await runLibtv(["account", "info"]);
    return jsonResponse(res, result.code === 0 ? 200 : 401, {
      ok: result.code === 0,
      libtvPath: LIBTV,
      account: tryParseJson(result.stdout),
      message: result.code === 0 ? "LibTV 已登录" : explainLibtvFailure(result, "LibTV 未登录")
    });
  }

  if (req.method === "POST" && url.pathname === "/api/images") {
    const body = await readJson(req);
    await refreshProductsFromWorkbench();
    const product = body.productId ? resolveProduct(body) : null;
    if (product?.noProduct) return jsonResponse(res, 200, { files: [] });
    const files = await listImageFiles(product?.imageDir || body.imageDir || DEFAULTS.imageDir, product);
    return jsonResponse(res, 200, { files });
  }

  if (req.method === "GET" && url.pathname === "/api/image") {
    const filePath = url.searchParams.get("path") || "";
    if (!/\.(png|jpe?g|webp)$/i.test(filePath)) return textResponse(res, 400, "Unsupported image");
    try {
      const data = await fsp.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": ext === ".webp" ? "image/webp" : ext === ".png" ? "image/png" : "image/jpeg" });
      return res.end(data);
    } catch {
      return textResponse(res, 404, "Image not found");
    }
  }

  if (req.method === "GET" && url.pathname === "/api/file") {
    const filePath = url.searchParams.get("path") || "";
    if (!/\.(mp4|png|jpe?g|webp|json|txt|log)$/i.test(filePath)) return textResponse(res, 400, "Unsupported file");
    try {
      const data = await fsp.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type = ext === ".mp4" ? "video/mp4" : /^\.(png|jpe?g|webp)$/.test(ext) ? mimeForFile(filePath) : "text/plain; charset=utf-8";
      res.writeHead(200, { "Content-Type": type });
      return res.end(data);
    } catch {
      return textResponse(res, 404, "File not found");
    }
  }

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    const body = await readJson(req);
    const account = await runLibtv(["account", "info"]);
    if (account.code !== 0) {
      return jsonResponse(res, 401, { error: explainLibtvFailure(account, "LibTV 未登录") });
    }
    const job = createJob(normalizeJobConfig(body));
    startJob(job);
    return jsonResponse(res, 202, { id: job.id });
  }

  if (req.method === "POST" && url.pathname === "/api/legacy-identity-jobs") {
    const { fields, files } = await readMultipart(req);
    const material = files.material;
    if (!material?.data?.length || !/^image\//i.test(material.contentType)) {
      return jsonResponse(res, 400, { error: "请选择一张清晰的人物正面照片" });
    }
    try {
      const provider = fields.provider === "libtv" ? "libtv-cli" : "kling-cli";
      const identityModel = String(fields.identityModel || "").trim();
      if (provider === "libtv-cli") {
        const account = await runLibtv(["account", "info"]);
        if (account.code !== 0) throw new Error(explainLibtvFailure(account, "LibTV 未登录"));
        const capabilities = await libtvCapabilities(true);
        findLibtvModel(capabilities.models.image, identityModel, "图片");
      } else {
        assertKlingTeamSpaceConfirmation(fields.klingTeamSpaceConfirmed);
        const capabilities = await klingCapabilities(true);
        findKlingModel(capabilities.models.imageToImage, identityModel);
        assertKlingCredits(await klingAccountStatus());
      }
      const id = `identity-${nowStamp()}-${crypto.randomBytes(3).toString("hex")}`;
      const ext = path.extname(material.filename) || ".png";
      await fsp.mkdir(IDENTITY_UPLOAD_DIR, { recursive: true });
      const sourcePath = path.join(IDENTITY_UPLOAD_DIR, `${id}${ext}`);
      await fsp.writeFile(sourcePath, material.data);
      const outputRoot = path.resolve(String(fields.outputDir || DEFAULT_OUTPUT_DIR));
      const job = {
        id,
        libtvOwner: libtvJobOwner(),
        type: "identity-views",
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        promptRules: null,
        config: { provider, identityModel, outputRoot },
        version: 1,
        adjustment: String(fields.adjustment || "").trim(),
        sourceName: material.filename,
        sourcePath,
        outputDir: path.join(outputRoot, "人物素材", id, "version-1"),
        logs: [],
        summary: { success: 0, failed: 0, total: 3 },
        tasks: [
          { angle: "front", label: "正面基准图", status: "queued", progress: 0 },
          { angle: "left", label: "左侧45°", status: "queued", progress: 0 },
          { angle: "right", label: "右侧45°", status: "queued", progress: 0 }
        ]
      };
      identityJobs.set(id, job);
      await saveIdentityJob(job);
      processIdentityJob(job);
      return jsonResponse(res, 202, { id });
    } catch (error) {
      return jsonResponse(res, 400, { error: `无法创建三视图任务：${compactProviderError(error, fields.provider === "libtv" ? "libtv" : "kling")}` });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/identity-jobs") {
    const { fields, files } = await readMultipart(req);
    const material = files.material;
    if (!material?.data?.length || !/^image\//i.test(material.contentType)) {
      return jsonResponse(res, 400, { error: "请选择一张清晰人物正面图片" });
    }
    let normalizedBaseUrl;
    let token;
    try {
      normalizedBaseUrl = normalizeBaseUrl(fields.baseUrl);
      ({ token } = await resolveJenToken(normalizedBaseUrl));
    } catch (error) {
      const failure = explainUpstreamError(error, "公司多模态登录");
      return jsonResponse(res, 401, { error: failure.title, failure, loginRequired: true });
    }
    const id = `identity-${nowStamp()}-${crypto.randomBytes(3).toString("hex")}`;
    const ext = path.extname(material.filename) || ".png";
    await fsp.mkdir(IDENTITY_UPLOAD_DIR, { recursive: true });
    const sourcePath = path.join(IDENTITY_UPLOAD_DIR, `${id}${ext}`);
    await fsp.writeFile(sourcePath, material.data);
    const outputRoot = path.resolve(String(fields.outputDir || DEFAULT_OUTPUT_DIR));
    const outputDir = path.join(outputRoot, "人物素材", id, "version-1");
    const job = {
      id,
      libtvOwner: libtvJobOwner(),
      type: "identity-views",
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      promptRules: null,
      config: {
        provider: "multimodal",
        identityModel: "openai/gpt-image-2",
        baseUrl: normalizedBaseUrl,
        outputRoot
      },
      version: 1,
      adjustment: String(fields.adjustment || "").trim(),
      sourceName: material.filename,
      sourcePath,
      outputDir,
      logs: [],
      summary: { success: 0, failed: 0, total: 3 },
      tasks: [
        { angle: "front", label: "正面基准图", status: "queued", progress: 0 },
        { angle: "left", label: "左侧45°", status: "queued", progress: 0 },
        { angle: "right", label: "右侧45°", status: "queued", progress: 0 }
      ]
    };
    identityJobs.set(id, job);
    identitySecrets.set(id, token);
    await saveIdentityJob(job);
    processIdentityJob(job);
    return jsonResponse(res, 202, { id });
  }

  const identityJobMatch = url.pathname.match(/^\/api\/identity-jobs\/([^/]+)$/);
  if (req.method === "GET" && identityJobMatch) {
    const job = identityJobs.get(identityJobMatch[1]);
    if (job) return jsonResponse(res, 200, publicJob(job));
    try {
      const saved = JSON.parse(await fsp.readFile(path.join(IDENTITY_JOBS_DIR, `${identityJobMatch[1]}.json`), "utf8"));
      if (!jobOwnedByCurrentUser(saved)) return jsonResponse(res, 404, { error: "任务不存在" });
      return jsonResponse(res, 200, saved);
    } catch {
      return jsonResponse(res, 404, { error: "人物三视图任务不存在" });
    }
  }

  const identityRegenerateMatch = url.pathname.match(/^\/api\/identity-jobs\/([^/]+)\/regenerate$/);
  if (req.method === "POST" && identityRegenerateMatch) {
    const job = identityJobs.get(identityRegenerateMatch[1]);
    if (!job) return jsonResponse(res, 404, { error: "人物三视图任务不存在，请重新上传正面照" });
    if (["queued", "running"].includes(job.status)) return jsonResponse(res, 409, { error: "三视图仍在生成中" });
    if (["kling-cli", "libtv-cli"].includes(job.config?.provider)) {
      const body = await readJson(req);
      try {
        const provider = body.provider === "libtv" ? "libtv-cli" : "kling-cli";
        const identityModel = String(body.identityModel || job.config.identityModel || "").trim();
        if (provider === "libtv-cli") {
          const capabilities = await libtvCapabilities(true);
          findLibtvModel(capabilities.models.image, identityModel, "图片");
        } else {
          assertKlingTeamSpaceConfirmation(body.klingTeamSpaceConfirmed);
          const capabilities = await klingCapabilities(true);
          findKlingModel(capabilities.models.imageToImage, identityModel);
          assertKlingCredits(await klingAccountStatus());
        }
        job.version += 1;
        job.adjustment = String(body.adjustment || "").trim();
        job.config.provider = provider;
        job.config.identityModel = identityModel;
        job.outputDir = path.join(job.config.outputRoot, "人物素材", job.id, `version-${job.version}`);
        job.status = "queued";
        job.error = "";
        job.summary = { success: 0, failed: 0, total: 3 };
        job.tasks = [
          { angle: "front", label: "正面基准图", status: "queued", progress: 0 },
          { angle: "left", label: "左侧45°", status: "queued", progress: 0 },
          { angle: "right", label: "右侧45°", status: "queued", progress: 0 }
        ];
        await saveIdentityJob(job);
        processIdentityJob(job);
        return jsonResponse(res, 202, { id: job.id, version: job.version });
      } catch (error) {
        return jsonResponse(res, 400, { error: `无法重新生成三视图：${error.message}` });
      }
    }
    const body = await readJson(req);
    const normalizedBaseUrl = normalizeBaseUrl(body.baseUrl || job.config.baseUrl);
    const { token } = await resolveJenToken(normalizedBaseUrl);
    job.version += 1;
    job.adjustment = String(body.adjustment || "").trim();
    job.config.baseUrl = normalizedBaseUrl;
    job.outputDir = path.join(job.config.outputRoot, "人物素材", job.id, `version-${job.version}`);
    job.status = "queued";
    job.error = "";
    job.summary = { success: 0, failed: 0, total: 3 };
    job.tasks = [
      { angle: "front", label: "正面基准图", status: "queued", progress: 0 },
      { angle: "left", label: "左侧45°", status: "queued", progress: 0 },
      { angle: "right", label: "右侧45°", status: "queued", progress: 0 }
    ];
    identitySecrets.set(job.id, token);
    await saveIdentityJob(job);
    processIdentityJob(job);
    return jsonResponse(res, 202, { id: job.id, version: job.version });
  }

  if (req.method === "POST" && url.pathname === "/api/legacy-person-connection-test") {
    const body = await readJson(req);
    try {
      if (body.provider === "libtv") {
        const account = await runLibtv(["account", "info"]);
        if (account.code !== 0) throw new Error(explainLibtvFailure(account, "LibTV 未登录"));
        const capabilities = await libtvCapabilities(true);
        return jsonResponse(res, 200, {
          ok: true,
          provider: "libtv-cli",
          message: `LibTV 已连接，可选择 ${capabilities.models.video.length} 个视频模型`
        });
      }
      assertKlingTeamSpaceConfirmation(body.klingTeamSpaceConfirmed);
      const capabilities = await klingCapabilities(true);
      return jsonResponse(res, 200, {
        ok: true,
        provider: "kling-cli",
        message: `可灵 CLI 已连接，可选择 ${capabilities.models.imageToVideo.length} 个视频模型`
      });
    } catch (error) {
      const provider = body.provider === "libtv" ? "libtv" : "kling";
      return jsonResponse(res, 502, { error: compactProviderError(error, provider) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/person-connection-test") {
    const body = await readJson(req);
    try {
      const normalizedBaseUrl = normalizeBaseUrl(body.baseUrl);
      const resolvedAuth = await resolveJenToken(normalizedBaseUrl);
      const token = resolvedAuth.token;
      await jenRequest(normalizedBaseUrl, "/v1/session", token, { timeout: 30000 });
      return jsonResponse(res, 200, {
        ok: true,
        message: resolvedAuth.source === "oa-login"
          ? "公司多模态账号已连接，GPT Image 2、Kling Omni 与 Seedance 可用"
          : "已通过本机 FanDo 登录自动连接公司多模态服务",
        authSource: resolvedAuth.source,
        userInfo: normalizedMultimodalUserInfo(resolvedAuth.userInfo),
        normalizedBaseUrl
      });
    } catch (error) {
      const failure = explainUpstreamError(error, "接口连接检查");
      return jsonResponse(res, 502, { error: failure.title, failure });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/legacy-person-jobs") {
    const { fields, files } = await readMultipart(req);
    try {
      const provider = fields.provider === "libtv" ? "libtv-cli" : "kling-cli";
      const sourceType = fields.sourceMode === "video" ? "video" : "views";
      if (sourceType === "video" && provider === "kling-cli") {
        return jsonResponse(res, 400, { error: "可灵官方 CLI 暂不支持参考视频输入；请选择 LibTV 平台后继续，参考视频不会丢失。" });
      }
      const klingModel = String(fields.klingModel || "").trim();
      const libtvVideoModel = String(fields.libtvVideoModel || "").trim();
      if (provider === "libtv-cli") {
        const account = await runLibtv(["account", "info"]);
        if (account.code !== 0) throw new Error(explainLibtvFailure(account, "LibTV 未登录"));
        const capabilities = await libtvCapabilities(true);
        findLibtvModel(capabilities.models.video, libtvVideoModel, "视频");
      } else {
        assertKlingTeamSpaceConfirmation(fields.klingTeamSpaceConfirmed);
        const capabilities = await klingCapabilities(true);
        findKlingModel(capabilities.models.imageToVideo, klingModel);
      }
      await refreshProductsFromWorkbench(true);
      const product = resolveProduct({ productId: fields.productId });
      const productNameStyle = fields.productNameStyle === "full" ? "full" : "short";
      const spokenProductName = productNameByStyle(product, productNameStyle);
      let identityJobId = "";
      let identityImagePaths = [];
      let sourcePath = "";
      let sourceName = "";
      if (sourceType === "video") {
        const material = files.material;
        if (!material?.data?.length || !/^video\//i.test(material.contentType)) {
          return jsonResponse(res, 400, { error: "请选择人物参考视频" });
        }
        const ext = path.extname(material.filename) || ".mp4";
        await fsp.mkdir(PERSON_UPLOAD_DIR, { recursive: true });
        const provisionalId = `person-${nowStamp()}-${crypto.randomBytes(3).toString("hex")}`;
        sourcePath = path.join(PERSON_UPLOAD_DIR, `${provisionalId}${ext}`);
        sourceName = material.filename;
        await fsp.writeFile(sourcePath, material.data);
      } else {
        identityJobId = String(fields.identityJobId || "");
        let identityJob = identityJobs.get(identityJobId);
        if (!identityJob) {
          try {
            identityJob = JSON.parse(await fsp.readFile(path.join(IDENTITY_JOBS_DIR, `${identityJobId}.json`), "utf8"));
          } catch {
            return jsonResponse(res, 400, { error: "请先生成完整的人物三视图" });
          }
        }
        if (!jobOwnedByCurrentUser(identityJob)) return jsonResponse(res, 400, { error: "请先生成完整的人物三视图" });
        identityImagePaths = (identityJob.tasks || [])
          .filter((task) => task.status === "success" && (task.localPath || task.resultUrl))
          .map((task) => task.localPath || task.resultUrl);
        if (identityImagePaths.length !== 3) return jsonResponse(res, 400, { error: "人物三视图尚未全部完成" });
      }
      if (fields.referenceAudioId) return jsonResponse(res, 400, { error: "可灵 CLI 当前不支持上传音色参考文件。可保留口播台词，使用可灵原生音频；如需音色复刻请暂不提交。" });
      const id = `person-${nowStamp()}-${crypto.randomBytes(3).toString("hex")}`;
      const createdAt = new Date().toISOString();
      const taskDate = shanghaiDate(createdAt);
      const ownerKey = String(currentProviderScope()?.key || "");
      const dailySequence = [...personJobs.values()].filter((item) => (
        String(item.libtvOwner?.key || "") === ownerKey
        && shanghaiDate(item.config?.workbenchTaskCreatedAt || item.createdAt) === taskDate
      )).length + 1;
      const taskName = String(fields.taskName || `${taskDate.slice(5).replace("-", "")}任务${dailySequence}`).trim();
      const requestedWorkstationId = String(fields.workstationId || "").trim();
      const legacyWorkstationId = crypto.createHash("sha256").update(`legacy-workstation:${ownerKey}`).digest("hex").slice(0, 32);
      const workstationId = requestedWorkstationId || legacyWorkstationId;
      const workstationShortId = workstationId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase();
      const workstationLabel = String(fields.workstationLabel || `电脑-${workstationShortId}`).trim();
      const outputRoot = path.resolve(String(fields.outputDir || DEFAULT_OUTPUT_DIR));
      const outputDir = path.join(outputRoot, "人物营销视频", safeName(product.shortName || product.name), id);
      const dialogue = normalizeDialogueProductName(fields.dialogue, product, spokenProductName).slice(0, 500);
      const candidateCount = Math.min(5, Math.max(1, Number.parseInt(fields.candidateCount, 10) || 1));
      const promptField = (name) => String(fields[name] || "").trim().slice(0, 600);
      const tasks = [];
      for (let variantIndex = 1; variantIndex <= candidateCount; variantIndex += 1) {
        tasks.push({
          kind: product.noProduct ? "host" : "handheld",
          variantIndex,
          label: product.noProduct ? `人物主持口播视频 ${variantIndex}/${candidateCount}` : `人物手持产品视频 ${variantIndex}/${candidateCount}`,
          status: "queued",
          progress: 0
        });
        tasks.push({
          kind: product.noProduct ? "performance" : "face-use",
          variantIndex,
          label: product.noProduct ? `人物场景表演视频 ${variantIndex}/${candidateCount}` : `人物正确使用产品视频 ${variantIndex}/${candidateCount}`,
          status: "queued",
          progress: 0
        });
      }
      const job = {
        id,
        taskName,
        libtvOwner: libtvJobOwner(),
        type: "person-marketing-video",
        status: "queued",
        createdAt,
        updatedAt: createdAt,
        promptRules: null,
        config: {
          provider,
          canvasMode: provider === "libtv-cli" ? "workbench-task-v2" : "",
          workbenchModule: "ai-person",
          workbenchTaskId: id,
          workbenchTaskName: taskName,
          workbenchTaskCreatedAt: createdAt,
          workstationId,
          workstationLabel,
          klingTeamSpaceConfirmed: provider === "kling-cli",
          requestedBillingSpace: provider === "kling-cli" ? "WIS品牌营销部" : "",
          billingSpaceVerification: provider === "kling-cli" ? "manual-confirmation" : "",
          klingModel,
          libtvVideoModel,
          productId: product.id,
          productType: product.name,
          productNameStyle,
          spokenProductName,
          dialogue,
          candidateCount,
          clothingPrompt: promptField("clothingPrompt"),
          stylingPrompt: promptField("stylingPrompt"),
          backgroundPrompt: promptField("backgroundPrompt"),
          otherPrompt: promptField("otherPrompt"),
          cleanSourceText: String(fields.cleanSourceText || "true").toLowerCase() !== "false",
          outputRoot
        },
        sourceType,
        sourceName: sourceType === "video" ? sourceName : "人物三视图",
        sourcePath,
        identityJobId,
        identityImagePaths,
        referenceAudio: null,
        outputDir,
        stage: "queued",
        preparation: {
          connection: { label: provider === "libtv-cli" ? "LibTV 连接" : "可灵 CLI 连接", status: "queued", done: 0, total: 1 },
          product: { label: product.noProduct ? "不出现产品" : "产品参考图", status: product.noProduct ? "skipped" : "queued", done: 0, total: 0 },
          person: { label: sourceType === "video" ? "人物参考视频" : "人物三视图", status: "queued", done: 0, total: 0 },
          audio: { label: "音色参考", status: "skipped", done: 0, total: 0 }
        },
        logs: [],
        summary: { success: 0, failed: 0, notStarted: 0, total: tasks.length },
        tasks
      };
      personJobs.set(id, job);
      await savePersonJob(job);
      processPersonJob(job);
      return jsonResponse(res, 202, { id });
    } catch (error) {
      return jsonResponse(res, 400, { error: `无法创建视频任务：${compactProviderError(error, fields.provider === "libtv" ? "libtv" : "kling")}` });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/person-jobs") {
    const { fields, files } = await readMultipart(req);
    let normalizedBaseUrl;
    let token;
    try {
      normalizedBaseUrl = normalizeBaseUrl(fields.baseUrl);
      ({ token } = await resolveJenToken(normalizedBaseUrl));
    } catch (error) {
      const failure = explainUpstreamError(error, "公司多模态登录");
      return jsonResponse(res, 401, { error: failure.title, failure, loginRequired: true });
    }
    const sourceType = fields.sourceMode === "video" ? "video" : "views";
    await refreshProductsFromWorkbench(true);
    const product = resolveProduct({ productId: fields.productId });
    const productNameStyle = fields.productNameStyle === "full" ? "full" : "short";
    const spokenProductName = productNameByStyle(product, productNameStyle);
    const id = `person-${nowStamp()}-${crypto.randomBytes(3).toString("hex")}`;
    let sourcePath = "";
    let sourceName = "";
    let identityImagePaths = [];
    let identityJobId = "";
    if (sourceType === "video") {
      const material = files.material;
      if (!material?.data?.length || !/^video\//i.test(material.contentType)) {
        return jsonResponse(res, 400, { error: "请选择人物视频原片" });
      }
      const ext = path.extname(material.filename) || ".mp4";
      await fsp.mkdir(PERSON_UPLOAD_DIR, { recursive: true });
      sourcePath = path.join(PERSON_UPLOAD_DIR, `${id}${ext}`);
      sourceName = material.filename;
      await fsp.writeFile(sourcePath, material.data);
    } else {
      identityJobId = String(fields.identityJobId || "");
      let identityJob = identityJobs.get(identityJobId);
      if (!identityJob) {
        try {
          identityJob = JSON.parse(await fsp.readFile(path.join(IDENTITY_JOBS_DIR, `${identityJobId}.json`), "utf8"));
        } catch {
          return jsonResponse(res, 400, { error: "请先生成人物三视图" });
        }
      }
      if (!jobOwnedByCurrentUser(identityJob)) return jsonResponse(res, 400, { error: "请先生成完整的人物三视图" });
      identityImagePaths = identityJob.tasks.filter((task) => task.status === "success" && task.localPath).map((task) => task.localPath);
      if (identityImagePaths.length !== 3) return jsonResponse(res, 400, { error: "人物三视图尚未全部生成完成" });
    }
    const outputRoot = path.resolve(String(fields.outputDir || DEFAULT_OUTPUT_DIR));
    const outputDir = path.join(outputRoot, "人物营销视频", safeName(product.shortName || product.name), id);
    const referenceAudio = resolveReferenceAudio(fields.referenceAudioId);
    if (fields.referenceAudioId && !referenceAudio) {
      return jsonResponse(res, 400, { error: "所选内置参考音频不存在，请刷新页面后重选" });
    }
    const requestedEngineValue = ["kling", "seedance", "auto"].includes(fields.engine) ? fields.engine : "auto";
    const requestedEngine = referenceAudio ? "seedance" : requestedEngineValue;
    const dialogue = normalizeDialogueProductName(fields.dialogue, product, spokenProductName).slice(0, 500);
    const candidateCount = Math.min(5, Math.max(1, Number.parseInt(fields.candidateCount, 10) || 1));
    const promptField = (name) => String(fields[name] || "").trim().slice(0, 600);
    const cleanSourceText = String(fields.cleanSourceText || "true").toLowerCase() !== "false";
    const tasks = [];
    for (let variantIndex = 1; variantIndex <= candidateCount; variantIndex += 1) {
      tasks.push({
        kind: product.noProduct ? "host" : "handheld",
        variantIndex,
        label: product.noProduct
          ? `人物主持口播视频 ${variantIndex}/${candidateCount}`
          : `人物手持产品视频 ${variantIndex}/${candidateCount}`,
        status: "queued",
        progress: 0
      });
      tasks.push({
        kind: product.noProduct ? "performance" : "face-use",
        variantIndex,
        label: product.noProduct
          ? `人物场景表演视频 ${variantIndex}/${candidateCount}`
          : `人物正确使用产品视频 ${variantIndex}/${candidateCount}`,
        status: "queued",
        progress: 0
      });
    }
    const job = {
      id,
      libtvOwner: libtvJobOwner(),
      type: "person-marketing-video",
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      promptRules: null,
      config: {
        provider: "multimodal",
        productId: product.id,
        productType: product.name,
        productNameStyle,
        spokenProductName,
        engine: requestedEngine,
        requestedEngine: requestedEngineValue,
        referenceAudioId: referenceAudio?.id || "",
        referenceAudioName: referenceAudio?.name || "",
        dialogue,
        candidateCount,
        clothingPrompt: promptField("clothingPrompt"),
        stylingPrompt: promptField("stylingPrompt"),
        backgroundPrompt: promptField("backgroundPrompt"),
        otherPrompt: promptField("otherPrompt"),
        cleanSourceText,
        baseUrl: normalizedBaseUrl,
        outputRoot
      },
      sourceType,
      sourceName,
      sourcePath,
      identityJobId,
      identityImagePaths,
      referenceAudio: referenceAudio ? {
        id: referenceAudio.id,
        name: referenceAudio.name,
        style: referenceAudio.style,
        durationSeconds: referenceAudio.durationSeconds,
        filePath: referenceAudio.filePath
      } : null,
      outputDir,
      stage: "queued",
      preparation: {
        connection: { label: "公司多模态服务连接", status: "queued", done: 0, total: 1 },
        product: {
          label: product.noProduct ? "不出现产品" : "产品参考图上传",
          status: product.noProduct ? "skipped" : "queued",
          done: 0,
          total: 0
        },
        person: { label: sourceType === "video" ? "人物视频上传" : "人物三视图上传", status: "queued", done: 0, total: 0 },
        audio: {
          label: referenceAudio ? `参考音频：${referenceAudio.name}` : "参考音频",
          status: referenceAudio ? "queued" : "skipped",
          done: 0,
          total: referenceAudio ? 1 : 0
        }
      },
      logs: [],
      summary: { success: 0, failed: 0, notStarted: 0, total: tasks.length },
      tasks
    };
    personJobs.set(id, job);
    personSecrets.set(id, token);
    await savePersonJob(job);
    processPersonJob(job);
    return jsonResponse(res, 202, { id });
  }

  const personJobMatch = url.pathname.match(/^\/api\/person-jobs\/([^/]+)$/);
  const personRetryMatch = url.pathname.match(/^\/api\/person-jobs\/([^/]+)\/retry$/);
  if (req.method === "POST" && personRetryMatch) {
    const job = personJobs.get(personRetryMatch[1]);
    if (!job) return jsonResponse(res, 404, { error: "人物展示任务不存在" });
    if (!["kling-cli", "multimodal"].includes(job.config?.provider)) {
      return jsonResponse(res, 400, { error: "当前任务需要在原平台重新创建" });
    }
    if (ACTIVE_JOB_STATUSES.has(String(job.status))) {
      return jsonResponse(res, 409, { error: "任务仍在运行，请等待当前任务结束后再重试" });
    }
    const requestedKind = String(url.searchParams.get("kind") || "");
    const requestedVariant = Number.parseInt(url.searchParams.get("variantIndex") || "", 10);
    const retryAll = url.searchParams.get("all") === "true";
    if (!retryAll && (!requestedKind || !Number.isFinite(requestedVariant))) {
      return jsonResponse(res, 400, { error: "请选择要重新生成的具体失败任务；重新生成全部失败项时请明确选择“全部”" });
    }
    const failedTasks = job.tasks.filter((task) => {
      if (!["failed", "interrupted", "blocked"].includes(String(task.status))) return false;
      if (!retryAll && task.kind !== requestedKind) return false;
      if (!retryAll && task.variantIndex !== requestedVariant) return false;
      return true;
    });
    if (!failedTasks.length) return jsonResponse(res, 400, { error: "当前没有可重新生成的失败任务" });
    for (const task of failedTasks) {
      task.status = "queued";
      task.progress = 0;
      task.error = "";
      task.diagnostic = "";
      task.remoteStatus = "";
      task.remoteTaskId = "";
    }
    job.status = "queued";
    job.stage = "queued";
    job.error = "";
    job.failure = null;
    job.retryTaskKeys = failedTasks.map(personTaskKey);
    recalculatePersonJobSummary(job);
    job.updatedAt = new Date().toISOString();
    jobLog(job, `已重新提交 ${failedTasks.length} 条失败任务`);
    if (job.config?.provider === "multimodal") {
      const resolved = await resolveJenToken(job.config.baseUrl);
      personSecrets.set(job.id, resolved.token);
    }
    await savePersonJob(job);
    processPersonJob(job);
    return jsonResponse(res, 202, { ok: true, id: job.id, retried: failedTasks.length });
  }
  if (req.method === "GET" && url.pathname === "/api/person-jobs") {
    const limit = Math.max(0, Number(url.searchParams.get("limit") || 0) || 0);
    const rows = Array.from(personJobs.values())
      .filter(jobOwnedByCurrentUser)
      .sort((left, right) => personJobTime(right) - personJobTime(left))
      .map(publicJob);
    return jsonResponse(res, 200, limit ? rows.slice(0, limit) : rows);
  }

  if (req.method === "GET" && personJobMatch) {
    const job = personJobs.get(personJobMatch[1]);
    if (!job) {
      try {
        const saved = JSON.parse(await fsp.readFile(path.join(PERSON_JOBS_DIR, `${personJobMatch[1]}.json`), "utf8"));
        if (!jobOwnedByCurrentUser(saved)) return jsonResponse(res, 404, { error: "任务不存在" });
        return jsonResponse(res, 200, saved);
      } catch {
        return jsonResponse(res, 404, { error: "人物展示任务不存在" });
      }
    }
    return jsonResponse(res, 200, publicJob(job));
  }

  const personOutputMatch = url.pathname.match(/^\/api\/person-jobs\/([^/]+)\/open-output$/);
  if (req.method === "POST" && personOutputMatch) {
    const job = personJobs.get(personOutputMatch[1]);
    if (!job?.outputDir) return jsonResponse(res, 404, { error: "人物展示任务不存在" });
    await openFolder(job.outputDir);
    return jsonResponse(res, 200, { ok: true, outputDir: job.outputDir });
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    const limit = Number(url.searchParams.get("limit") || 0);
    return jsonResponse(res, 200, listJobs(Number.isFinite(limit) ? limit : 0));
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (req.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return jsonResponse(res, 404, { error: "Job not found" });
    return jsonResponse(res, 200, job);
  }

  const outputMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/open-output$/);
  if (req.method === "POST" && outputMatch) {
    const job = jobs.get(outputMatch[1]);
    if (!job) return jsonResponse(res, 404, { error: "任务记录不存在" });
    if (!job.outputDir) return jsonResponse(res, 400, { error: "这个任务还没有输出目录" });
    try {
      const stat = await fsp.stat(job.outputDir);
      if (!stat.isDirectory()) return jsonResponse(res, 400, { error: "输出路径不是文件夹" });
    } catch {
      return jsonResponse(res, 404, { error: "输出文件夹不存在" });
    }
    await openFolder(job.outputDir);
    return jsonResponse(res, 200, { ok: true, outputDir: job.outputDir });
  }

  return jsonResponse(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      });
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const auth = authManager.authenticateRequest(req);
    if (!auth.ok) {
      if (url.pathname.startsWith("/api/")) {
        return jsonResponse(res, auth.status || 401, {
          error: auth.error || "请先使用飞书账号登录",
          loginRequired: true
        });
      }
      res.writeHead(302, {
        "Cache-Control": "no-store",
        Location: `${WORKBENCH_PUBLIC_URL}/login.html`
      });
      res.end();
      return;
    }
    req.authUser = auth.user;
    req.authInternal = Boolean(auth.internal);
    if (url.pathname.startsWith("/api/")) {
      if (req.authInternal) {
        await handleApi(req, res, url);
      } else {
        await withLibtvUser(req.authUser, () => handleApi(req, res, url));
      }
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    jsonResponse(res, 500, {
      error: sanitizeProviderDiagnostic(error?.message || error) || "本地服务处理失败"
    });
  }
});

server.on("error", (error) => {
  console.error(`本地服务启动失败：${error.message}`);
});

process.on("unhandledRejection", (error) => {
  console.error(`未处理的任务异常：${error?.message || error}`);
});

process.on("uncaughtException", (error) => {
  console.error(`未捕获的服务异常：${error?.message || error}`);
});

async function startServer() {
  await loadPersistedJobs();
  await loadPersistedPersonJobs();
  if (server.listening) {
    return { port: PORT, url: `http://127.0.0.1:${PORT}` };
  }
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(PORT, HOST);
  });
  console.log(`AI-明星画面生成已启动：http://${HOST}:${PORT}`);
  return { port: PORT, url: `http://127.0.0.1:${PORT}` };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`本地服务启动失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  startServer,
  server,
  port: PORT,
  personPrompt,
  identityPrompt,
  klingCapabilities,
  klingProcessEnvironment,
  supportsSingleIdentityReference,
  isKlingImageReferenceValidationError,
  summarizeKlingAccount,
  safeKlingAuthMessage,
  buildKlingConnectedAuthStatus,
  assertKlingCredits,
  parseJsonFromMixedOutput,
  parseKlingResult,
  compactKlingModels,
  compactProviderError,
  providerErrorDiagnostic,
  klingReferenceInputShape,
  maxKlingReferenceImages,
  selectKlingReferences,
  personTaskKey,
  selectKlingPersonTasks,
  recalculatePersonJobSummary,
  normalizedMultimodalUserInfo,
  engineSequence,
  klingPayload,
  seedancePayload,
  upstreamTaskId,
  upstreamStatus,
  resolveJenToken,
  jenRequest,
  jenUpload,
  downloadFile
};

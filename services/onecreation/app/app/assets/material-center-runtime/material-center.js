const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const mysql = require("mysql2/promise");
const { createSharedStorage } = require("./shared-storage");

const TABLES = Object.freeze({
  assets: "ai_material_assets",
  clips: "ai_material_clips",
  tags: "ai_material_tags",
  assetTags: "ai_material_asset_tags",
  publishTasks: "ai_material_publish_tasks",
  performance: "ai_material_performance_daily",
  audit: "ai_material_audit_logs",
  remakePromptRecipes: "ai_remake_prompt_recipes"
});

function jsonValue(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function boolValue(value) {
  return value ? 1 : 0;
}

function safeText(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeId(value, fallbackPrefix = "asset") {
  const normalized = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 60);
  return normalized || `${fallbackPrefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function parseDurationSeconds(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(":").map(Number);
  if (parts.some((item) => !Number.isFinite(item))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function urlFileName(value, fallback = "素材.mp4") {
  try {
    const parsed = new URL(String(value || ""));
    return decodeURIComponent(path.basename(parsed.pathname)) || fallback;
  } catch (_) {
    return path.basename(String(value || "")) || fallback;
  }
}

function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,，\n]/);
  return [...new Set(raw.map((item) => safeText(item, 80)).filter(Boolean))].slice(0, 30);
}

function parseJsonValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value;
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value));
  } catch (_) {
    return fallback;
  }
}

function remakeRecipeTags(recipe = {}) {
  if (Array.isArray(recipe.tags)) return normalizeTags(recipe.tags);
  return normalizeTags([
    recipe.targetProduct?.name,
    recipe.audit?.videoType,
    recipe.changeType?.label,
    recipe.changeType?.id,
    recipe.caseStage === "source_ready" ? "成功拆解模板" : "正式成片案例",
    recipe.source?.model,
    recipe.source?.videoNodeName,
    ...(recipe.productAssets || []).map((item) => item.title || item.angleLabel),
    ...(recipe.imagePrompts || []).map((item) => item.sourceLabel)
  ]);
}

function remakeRecipeSearchText(recipe = {}) {
  return safeText([
    recipe.title,
    recipe.targetProduct?.id,
    recipe.targetProduct?.name,
    recipe.audit?.videoType,
    recipe.audit?.summary,
    recipe.changeType?.id,
    recipe.changeType?.label,
    recipe.source?.taskId,
    recipe.source?.canvasUrl,
    recipe.source?.spaceId,
    recipe.source?.projectId,
    recipe.source?.videoNodeName,
    recipe.source?.model,
    recipe.videoPrompt?.source,
    recipe.videoPrompt?.compiled,
    JSON.stringify(recipe.videoPrompt?.replacements || []),
    JSON.stringify(recipe.sourceSnapshot || {}),
    JSON.stringify(recipe.targetProduct?.profile || {}),
    ...(recipe.productAssets || []).flatMap((item) => [item.title, item.angleLabel, item.fileName]),
    ...(recipe.imagePrompts || []).flatMap((item) => [
      item.sourceLabel,
      item.compiler?.imagePrompt,
      item.compiler?.negativePrompt,
      JSON.stringify(item.compiler?.scalePlan || {})
    ]),
    ...remakeRecipeTags(recipe)
  ].filter(Boolean).join("\n"), 250000);
}

function toPublicRemakePromptRecipe(row = {}) {
  const recipe = parseJsonValue(row.recipe_json, {});
  const tags = parseJsonValue(row.tags_json, remakeRecipeTags(recipe));
  return {
    ...recipe,
    id: row.id || recipe.id,
    ownerKey: row.owner_key || recipe.ownerKey,
    title: row.title || recipe.title,
    tags: Array.isArray(tags) ? tags : remakeRecipeTags(recipe),
    storage: {
      ...(recipe.storage || {}),
      snapshotKey: row.snapshot_oss_key || recipe.storage?.snapshotKey || "",
      snapshotUrl: row.snapshot_oss_url || recipe.storage?.snapshotUrl || "",
      snapshotSha256: row.snapshot_sha256 || recipe.storage?.snapshotSha256 || "",
      ossSynced: Boolean(row.snapshot_oss_url || recipe.storage?.ossSynced),
      databaseSynced: true,
      syncState: row.snapshot_oss_url ? "synchronized" : "database_only",
      indexedAt: row.updated_at || recipe.storage?.indexedAt || ""
    }
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function decryptWindowsSecret(cipherText) {
  if (process.platform !== "win32") throw new Error("当前加密配置只能在Windows当前用户下解密");
  const script = [
    "$ErrorActionPreference='Stop'",
    "$cipher=$env:AI_MATERIAL_DB_SECRET",
    "$secure=ConvertTo-SecureString $cipher",
    "$plain=[System.Net.NetworkCredential]::new('', $secure).Password",
    "[Console]::Out.Write($plain)"
  ].join(";");
  const result = await runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, AI_MATERIAL_DB_SECRET: cipherText }
  });
  if (result.code !== 0 || !result.stdout) throw new Error("数据库密码解密失败，请由当前Windows账号重新保存连接");
  return result.stdout;
}

async function readConfig(configPath) {
  const envConfig = {
    host: process.env.AI_MATERIAL_DB_HOST,
    port: process.env.AI_MATERIAL_DB_PORT,
    user: process.env.AI_MATERIAL_DB_USER,
    password: process.env.AI_MATERIAL_DB_PASSWORD,
    database: process.env.AI_MATERIAL_DB_NAME
  };
  if (envConfig.host && envConfig.user && envConfig.password && envConfig.database) {
    return {
      host: envConfig.host,
      port: Number(envConfig.port || 3306),
      user: envConfig.user,
      password: envConfig.password,
      database: envConfig.database,
      source: "environment"
    };
  }
  const raw = JSON.parse(await fsp.readFile(configPath, "utf8"));
  const password = raw.passwordProtected
    ? await decryptWindowsSecret(String(raw.passwordProtected))
    : "";
  if (!raw.host || !raw.user || !password || !raw.database) {
    throw new Error("素材中心数据库配置不完整");
  }
  return {
    host: safeText(raw.host, 255),
    port: Number(raw.port || 3306),
    user: safeText(raw.user, 128),
    password,
    database: safeText(raw.database, 128),
    source: "windows-dpapi-current-user"
  };
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function probeVideo(ffprobe, filePath) {
  const result = await runProcess(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration,size",
    "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
    "-of", "json",
    filePath
  ]);
  if (result.code !== 0) throw new Error(result.stderr || "无法读取视频信息");
  const data = JSON.parse(result.stdout || "{}");
  const video = (data.streams || []).find((item) => item.codec_type === "video") || {};
  const audio = (data.streams || []).find((item) => item.codec_type === "audio") || {};
  return {
    duration: Number(data.format?.duration || 0),
    size: Number(data.format?.size || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: safeText(video.r_frame_rate || "", 32),
    videoCodec: safeText(video.codec_name || "", 32),
    audioCodec: safeText(audio.codec_name || "", 32),
    hasAudio: Boolean(audio.codec_name)
  };
}

function toPublicAsset(row) {
  const tags = safeText(row.tags || "", 2000).split(",").map((item) => item.trim()).filter(Boolean);
  return {
    id: row.id,
    externalId: row.external_id || "",
    title: row.title,
    productId: row.product_id || "",
    productName: row.product_name || "",
    sourceType: row.source_type,
    sourceDocTitle: row.source_doc_title || "",
    sourceDocUrl: row.source_doc_url || "",
    sourceRank: row.source_rank,
    effectiveLabel: row.effective_label || "",
    approvalRisk: row.approval_risk || "",
    isEffective: Boolean(row.is_effective),
    storageBackend: row.storage_backend,
    filePath: row.storage_path,
    fileName: row.file_name,
    fileSize: Number(row.file_size || 0),
    duration: Number(row.duration_ms || 0) / 1000,
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    fps: row.fps || "",
    videoCodec: row.video_codec || "",
    audioCodec: row.audio_codec || "",
    hasAudio: Boolean(row.has_audio),
    status: row.status,
    aiStatus: row.ai_status,
    clipCount: Number(row.clip_count || 0),
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toPublicIndexedAsset(row) {
  const source = safeText(row.source || "qianchuan", 32);
  const grade = safeText(row.grade || "", 80);
  const tags = [safeText(row.brand || "", 80), source, grade].filter(Boolean);
  const spendText = safeText(row.spend || "", 80);
  const hasPerformance = Boolean(spendText && spendText !== "0") || Number(row.roi || 0) > 0;
  return {
    id: `oss-${row.id}`,
    externalId: `scraped:${row.id}`,
    title: safeText(row.title || row.ad_name || `OSS素材 ${row.id}`, 255),
    productId: "",
    productName: safeText(row.brand || "", 255),
    sourceType: source,
    sourceDocTitle: safeText(row.account_name || "", 255),
    sourceDocUrl: safeText(row.original_url || "", 2000),
    sourceRank: null,
    effectiveLabel: "",
    approvalRisk: "",
    isEffective: false,
    hasPerformance,
    performance: {
      spend: spendText,
      roi: Number(row.roi || 0),
      grade
    },
    storageBackend: "aliyun-oss-index",
    filePath: safeText(row.video_url || "", 4000),
    coverUrl: safeText(row.cover_url || "", 4000),
    fileName: urlFileName(row.video_url, `oss-${row.id}.mp4`),
    fileSize: 0,
    duration: parseDurationSeconds(row.duration),
    width: 0,
    height: 0,
    fps: "",
    videoCodec: "",
    audioCodec: "",
    hasAudio: true,
    status: "ready",
    aiStatus: Number(row.clip_count || 0) > 0 ? "ready" : "pending",
    clipCount: Number(row.clip_count || 0),
    tags,
    createdAt: row.collected_at || row.publish_time || null,
    updatedAt: row.updated_at || row.interaction_updated_at || row.collected_at || null
  };
}

function createMaterialCenter(options = {}) {
  const appRoot = path.resolve(options.appRoot || process.cwd());
  const packageRoot = path.resolve(options.packageRoot || appRoot);
  const ffprobe = options.ffprobe || "ffprobe";
  const schemaPath = options.schemaPath || path.join(__dirname, "schema.sql");
  const configPath = options.configPath || path.join(packageRoot, "config", "material-center-db.json");
  const catalogCachePath = options.catalogCachePath || path.join(__dirname, "catalog-cache.json");
  const fallbackRoot = fs.existsSync("H:\\")
    ? "H:\\codex输出\\AI素材中心"
    : path.join(packageRoot, "data", "material-center");
  const storageRoot = path.resolve(options.storageRoot || process.env.AI_MATERIAL_STORAGE_ROOT || fallbackRoot);
  const sharedStorage = options.sharedStorage || createSharedStorage(options.sharedStorageOptions || {});
  let pool = options.pool || null;
  let externalCatalogAvailable = false;
  let catalogCache = null;
  let initialized = false;
  let status = {
    configured: Boolean(options.pool),
    connected: Boolean(options.pool),
    catalogReady: Boolean(options.pool),
    cacheReady: false,
    cacheGeneratedAt: "",
    cacheScope: "",
    schemaReady: false,
    storageBackend: "local",
    storageRoot,
    objectStorageReady: false,
    objectStorageWriteReady: false,
    objectStorageDomain: "",
    qianchuanReady: false,
    message: options.pool ? "测试数据库已连接" : "尚未检查数据库",
    error: "",
    checkedAt: ""
  };

  async function loadCatalogCache() {
    try {
      const parsed = JSON.parse(await fsp.readFile(catalogCachePath, "utf8"));
      if (!Array.isArray(parsed.items) || !parsed.items.length) return null;
      catalogCache = {
        schemaVersion: Number(parsed.schemaVersion || 1),
        generatedAt: safeText(parsed.generatedAt, 80),
        scope: safeText(parsed.scope?.label || parsed.scope || "WIS素材", 120),
        items: parsed.items.map((item) => ({
          ...item,
          id: safeText(item.id, 80),
          filePath: safeText(item.filePath, 4000),
          coverUrl: safeText(item.coverUrl, 4000),
          tags: normalizeTags(item.tags)
        })).filter((item) => item.id && /^https:\/\//i.test(item.filePath))
      };
      return catalogCache.items.length ? catalogCache : null;
    } catch (_) {
      catalogCache = null;
      return null;
    }
  }

  function cachedSummary() {
    const items = catalogCache?.items || [];
    return {
      assets: items.length,
      externalAssets: items.length,
      managedAssets: 0,
      wisAssets: items.filter((item) => (
        String(item.productName || "").toUpperCase() === "WIS"
        || String(item.title || "").toUpperCase().includes("WIS")
      )).length,
      performanceAssets: items.filter((item) => item.hasPerformance).length,
      effectiveAssets: 0,
      clips: items.reduce((total, item) => total + Number(item.clipCount || 0), 0),
      managedClips: 0,
      externalClips: items.reduce((total, item) => total + Number(item.clipCount || 0), 0),
      storageBytes: 0,
      pendingPublish: 0,
      published: 0
    };
  }

  function listCachedAssets(filters = {}) {
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.max(1, Math.min(50, Number(filters.pageSize || 12)));
    const keyword = safeText(filters.keyword, 200).toLowerCase();
    let items = [...(catalogCache?.items || [])];
    if (keyword) {
      items = items.filter((item) => [
        item.title,
        item.productName,
        item.sourceType,
        item.sourceDocTitle,
        item.fileName,
        ...(item.tags || [])
      ].some((value) => String(value || "").toLowerCase().includes(keyword)));
    }
    if (filters.brand) {
      const brand = safeText(filters.brand, 128).toLowerCase();
      items = items.filter((item) => String(item.productName || "").toLowerCase() === brand);
    }
    if (filters.sourceType) {
      const sourceType = safeText(filters.sourceType, 32);
      items = items.filter((item) => item.sourceType === sourceType);
    }
    if (String(filters.hasPerformance) === "true" || String(filters.hasPerformance) === "1") {
      items = items.filter((item) => item.hasPerformance);
    }
    if (String(filters.hasPerformance) === "false" || String(filters.hasPerformance) === "0") {
      items = items.filter((item) => !item.hasPerformance);
    }
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pages);
    return {
      items: items.slice((safePage - 1) * pageSize, safePage * pageSize),
      library: "oss",
      sourceMode: "release-cache",
      page: safePage,
      pageSize,
      total,
      pages
    };
  }

  function getCachedAsset(assetId) {
    const asset = (catalogCache?.items || []).find((item) => item.id === String(assetId || ""));
    return asset ? { ...asset, clips: [] } : null;
  }

  async function getPool() {
    if (pool) return pool;
    const config = await readConfig(configPath);
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 6,
      queueLimit: 30,
      connectTimeout: 12000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      charset: "utf8mb4",
      decimalNumbers: true,
      namedPlaceholders: false,
      multipleStatements: true
    });
    status.configured = true;
    return pool;
  }

  async function ensureSchema() {
    const db = await getPool();
    const schema = await fsp.readFile(schemaPath, "utf8");
    await db.query(schema);
    status.schemaReady = true;
  }

  async function detectExternalCatalog() {
    const db = await getPool();
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS tableCount
       FROM information_schema.tables
       WHERE table_schema=DATABASE() AND table_name='scraped_videos'`
    );
    externalCatalogAvailable = Number(row?.tableCount || 0) > 0;
    if (!externalCatalogAvailable) return false;
    const [[hostRow]] = await db.query(
      `SELECT video_url AS videoUrl
       FROM scraped_videos
       WHERE deleted_at IS NULL
         AND video_url LIKE 'https://oss.fandow.com/%'
       LIMIT 1`
    );
    const readable = Boolean(hostRow?.videoUrl);
    status.storageBackend = readable ? "aliyun-oss-index" : "external-index";
    status.objectStorageReady = readable;
    status.objectStorageWriteReady = readable && sharedStorage.enabled;
    status.objectStorageDomain = readable ? "oss.fandow.com" : "";
    return readable;
  }

  async function init() {
    await Promise.all([
      fsp.mkdir(path.join(storageRoot, "incoming"), { recursive: true }),
      fsp.mkdir(path.join(storageRoot, "originals"), { recursive: true }),
      fsp.mkdir(path.join(storageRoot, "thumbnails"), { recursive: true })
    ]);
    await loadCatalogCache();
    try {
      const db = await getPool();
      await db.query("SELECT 1 AS ok");
      await ensureSchema();
      const objectStorageReady = await detectExternalCatalog();
      status = {
        ...status,
        configured: true,
        connected: true,
        catalogReady: true,
        cacheReady: Boolean(catalogCache),
        cacheGeneratedAt: catalogCache?.generatedAt || "",
        cacheScope: catalogCache?.scope || "",
        schemaReady: true,
        storageBackend: objectStorageReady ? "aliyun-oss-index" : status.storageBackend,
        objectStorageReady,
        objectStorageWriteReady: objectStorageReady && sharedStorage.enabled,
        message: objectStorageReady
          ? "公司阿里云OSS素材索引与共享上传已连接"
          : "公司素材数据库已连接",
        error: "",
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      status = {
        ...status,
        configured: false,
        connected: false,
        catalogReady: Boolean(catalogCache),
        cacheReady: Boolean(catalogCache),
        cacheGeneratedAt: catalogCache?.generatedAt || "",
        cacheScope: catalogCache?.scope || "",
        schemaReady: false,
        storageBackend: catalogCache ? "aliyun-oss-cache" : "local",
        objectStorageReady: Boolean(catalogCache),
        objectStorageWriteReady: false,
        objectStorageDomain: catalogCache ? "oss.fandow.com" : "",
        message: catalogCache
          ? "部门WIS素材只读缓存已连接"
          : "当前电脑尚未配置部门素材连接",
        error: catalogCache
          ? ""
          : "请更新到最新版本；如仍无法使用，请联系管理员检查网络或素材中心权限。",
        checkedAt: new Date().toISOString()
      };
    }
    initialized = true;
    return { ...status };
  }

  async function audit(action, entityType, entityId, detail, actor) {
    const db = await getPool();
    await db.execute(
      `INSERT INTO ${TABLES.audit} (actor, action, entity_type, entity_id, detail_json) VALUES (?, ?, ?, ?, ?)`,
      [safeText(actor, 128) || null, safeText(action, 64), safeText(entityType, 40), safeText(entityId, 128) || null, jsonValue(detail)]
    );
  }

  async function upsertAssetTags(connection, assetId, tags, category = "custom") {
    for (const name of normalizeTags(tags)) {
      await connection.execute(
        `INSERT INTO ${TABLES.tags} (name, category) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [name, safeText(category, 40) || "custom"]
      );
      const [[tag]] = await connection.execute(
        `SELECT id FROM ${TABLES.tags} WHERE name=? AND category=? LIMIT 1`,
        [name, safeText(category, 40) || "custom"]
      );
      if (tag?.id) {
        await connection.execute(
          `INSERT IGNORE INTO ${TABLES.assetTags} (asset_id, tag_id) VALUES (?, ?)`,
          [assetId, tag.id]
        );
      }
    }
  }

  async function syncRemixLibrary(libraryState, actor = "") {
    const items = Array.isArray(libraryState?.items) ? libraryState.items : [];
    if (!items.length) throw new Error("当前本地混剪素材库没有可同步素材");
    const db = await getPool();
    await ensureSchema();
    const connection = await db.getConnection();
    let assetCount = 0;
    let clipCount = 0;
    try {
      await connection.beginTransaction();
      for (const item of items) {
        const assetId = safeId(item.id, "asset");
        const metadata = item.metadata || {};
        const itemStoragePath = safeText(item.sharedStorageUrl || item.filePath, 4000);
        const itemStorageBackend = /^https?:\/\//i.test(itemStoragePath)
          ? "aliyun-oss-yxb"
          : "local";
        const title = `${safeText(item.productName, 180) || "历史有效成片"} · 第${Number(item.rank || 0) || "-"}条`;
        const searchText = [
          title, item.productName, item.sourceDocTitle, item.sourceSection,
          item.effectiveLabel, item.aiAnalysis?.coreFramework, item.aiAnalysis?.hook,
          ...(item.clips || []).flatMap((clip) => [clip.transcript, clip.visibleText, clip.visualType, clip.stageLabel])
        ].filter(Boolean).join(" ").slice(0, 60000);
        await connection.execute(
          `INSERT INTO ${TABLES.assets} (
            id, external_id, title, product_id, product_name, source_type,
            source_doc_title, source_doc_url, source_section, source_rank,
            effective_label, approval_risk, is_effective, storage_backend, storage_path,
            file_name, mime, file_size, sha256, duration_ms, width, height, fps,
            video_codec, audio_codec, has_audio, status, ai_status, ai_summary_json,
            search_text, created_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, 'feishu', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            external_id=VALUES(external_id), title=VALUES(title),
            product_id=VALUES(product_id), product_name=VALUES(product_name),
            source_doc_title=VALUES(source_doc_title), source_doc_url=VALUES(source_doc_url),
            source_section=VALUES(source_section), source_rank=VALUES(source_rank),
            effective_label=VALUES(effective_label), approval_risk=VALUES(approval_risk),
            is_effective=VALUES(is_effective), storage_backend=VALUES(storage_backend),
            storage_path=VALUES(storage_path),
            file_name=VALUES(file_name), mime=VALUES(mime), file_size=VALUES(file_size),
            sha256=VALUES(sha256), duration_ms=VALUES(duration_ms), width=VALUES(width),
            height=VALUES(height), fps=VALUES(fps), video_codec=VALUES(video_codec),
            audio_codec=VALUES(audio_codec), has_audio=VALUES(has_audio), status=VALUES(status),
            ai_status=VALUES(ai_status), ai_summary_json=VALUES(ai_summary_json),
            search_text=VALUES(search_text), updated_by=VALUES(updated_by), deleted_at=NULL`,
          [
            assetId, safeText(`remix:${item.id}`, 128), title,
            safeText(item.productId, 128) || null, safeText(item.productName, 255) || null,
            safeText(item.sourceDocTitle, 255) || null, safeText(item.sourceDocUrl, 2000) || null,
            safeText(item.sourceSection, 255) || null, Number(item.rank || 0) || null,
            safeText(item.effectiveLabel, 64) || null, safeText(item.approvalRisk, 32) || null,
            boolValue(Boolean(item.selectedForInitial || item.effectiveLabel)),
            itemStorageBackend, itemStoragePath,
            path.basename(item.filePath || `${assetId}.mp4`),
            safeText(item.mime || "video/mp4", 100), Number(item.bytes || item.declaredBytes || 0),
            safeText(item.sha256, 64) || null, Math.round(Number(metadata.duration || 0) * 1000),
            Number(metadata.width || item.declaredWidth || 0), Number(metadata.height || item.declaredHeight || 0),
            safeText(metadata.fps, 32) || null, safeText(metadata.videoCodec, 32) || null,
            safeText(metadata.audioCodec, 32) || null, boolValue(metadata.hasAudio),
            safeText(item.status || "ready", 32), safeText(item.aiStatus || "pending", 32),
            jsonValue(item.aiAnalysis || null), searchText,
            safeText(actor, 128) || null, safeText(actor, 128) || null
          ]
        );
        assetCount += 1;
        await connection.execute(
          `DELETE FROM ${TABLES.clips} WHERE asset_id=?`,
          [assetId]
        );
        await upsertAssetTags(connection, assetId, [
          item.productName,
          item.effectiveLabel || "历史有效成片",
          item.sourceDocTitle,
          item.approvalRisk ? `卡审风险:${item.approvalRisk}` : ""
        ], "system");
        for (const clip of item.clips || []) {
          const clipStoragePath = safeText(clip.sharedStorageUrl || clip.filePath, 4000);
          const clipDatabaseId = `clip-${crypto
            .createHash("sha256")
            .update(`${assetId}:${clip.id || ""}`)
            .digest("hex")
            .slice(0, 56)}`;
          await connection.execute(
            `INSERT INTO ${TABLES.clips} (
              id, asset_id, start_ms, end_ms, duration_ms, stage, stage_label, visual_type,
              transcript, visible_text, file_path, thumbnail_path, has_audio,
              has_speech_candidate, label_source, confidence, cut_basis,
              segmentation_version, approved, review_required
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              start_ms=VALUES(start_ms), end_ms=VALUES(end_ms), duration_ms=VALUES(duration_ms),
              stage=VALUES(stage), stage_label=VALUES(stage_label), visual_type=VALUES(visual_type),
              transcript=VALUES(transcript), visible_text=VALUES(visible_text),
              file_path=VALUES(file_path), thumbnail_path=VALUES(thumbnail_path),
              has_audio=VALUES(has_audio), has_speech_candidate=VALUES(has_speech_candidate),
              label_source=VALUES(label_source), confidence=VALUES(confidence),
              cut_basis=VALUES(cut_basis), segmentation_version=VALUES(segmentation_version),
              approved=VALUES(approved), review_required=VALUES(review_required)`,
            [
              clipDatabaseId, assetId,
              Math.round(Number(clip.start || 0) * 1000), Math.round(Number(clip.end || 0) * 1000),
              Math.round(Number(clip.duration || 0) * 1000), safeText(clip.stage, 32) || null,
              safeText(clip.stageLabel, 64) || null, safeText(clip.visualType, 64) || null,
              safeText(clip.transcript, 20000) || null, safeText(clip.visibleText, 20000) || null,
              clipStoragePath, safeText(clip.thumbnailPath, 4000) || null,
              boolValue(clip.hasAudio), boolValue(clip.hasSpeechCandidate),
              safeText(clip.labelSource, 128) || null, Number(clip.confidence || 0),
              safeText(clip.cutBasis, 64) || null, Number(clip.segmentationVersion || 0),
              boolValue(clip.approved), boolValue(clip.reviewRequired !== false)
            ]
          );
          clipCount += 1;
        }
      }
      await connection.commit();
      await audit("sync_remix_library", "library", "remix", { assetCount, clipCount }, actor);
      return { ok: true, assetCount, clipCount };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function getSummary() {
    if (!status.connected && catalogCache) return cachedSummary();
    const db = await getPool();
    const [[counts]] = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM ${TABLES.assets} WHERE deleted_at IS NULL) AS managed_assets,
        (SELECT COUNT(*) FROM ${TABLES.assets} WHERE deleted_at IS NULL AND is_effective=1) AS effective_assets,
        (SELECT COALESCE(SUM(file_size),0) FROM ${TABLES.assets} WHERE deleted_at IS NULL) AS storage_bytes,
        (SELECT COUNT(*) FROM ${TABLES.clips}) AS clips,
        (SELECT COUNT(*) FROM ${TABLES.publishTasks} WHERE status IN ('waiting_auth','queued','pushing','partial')) AS pending_publish,
        (SELECT COUNT(*) FROM ${TABLES.publishTasks} WHERE status='success') AS published`
    );
    let external = {
      assets: 0,
      wisAssets: 0,
      performanceAssets: 0,
      clips: 0
    };
    if (externalCatalogAvailable) {
      const [[externalCounts]] = await db.query(
        `SELECT
          (SELECT COUNT(*) FROM scraped_videos
            WHERE deleted_at IS NULL AND video_url IS NOT NULL AND video_url <> '') AS assets,
          (SELECT COUNT(*) FROM scraped_videos
            WHERE deleted_at IS NULL AND video_url IS NOT NULL AND video_url <> ''
              AND (UPPER(COALESCE(brand, ''))='WIS' OR UPPER(COALESCE(title, '')) LIKE '%WIS%')) AS wis_assets,
          (SELECT COUNT(*) FROM scraped_videos
            WHERE deleted_at IS NULL AND video_url IS NOT NULL AND video_url <> ''
              AND ((spend IS NOT NULL AND spend <> '' AND spend <> '0') OR roi > 0)) AS performance_assets,
          (SELECT COUNT(*) FROM video_dissection WHERE is_deleted=0) AS clips`
      );
      external = {
        assets: Number(externalCounts.assets || 0),
        wisAssets: Number(externalCounts.wis_assets || 0),
        performanceAssets: Number(externalCounts.performance_assets || 0),
        clips: Number(externalCounts.clips || 0)
      };
    }
    const managedAssets = Number(counts.managed_assets || 0);
    return {
      assets: external.assets + managedAssets,
      externalAssets: external.assets,
      managedAssets,
      wisAssets: external.wisAssets,
      performanceAssets: external.performanceAssets,
      effectiveAssets: Number(counts.effective_assets || 0),
      clips: Number(counts.clips || 0) + external.clips,
      managedClips: Number(counts.clips || 0),
      externalClips: external.clips,
      storageBytes: Number(counts.storage_bytes || 0),
      pendingPublish: Number(counts.pending_publish || 0),
      published: Number(counts.published || 0)
    };
  }

  async function listManagedAssets(filters = {}) {
    const db = await getPool();
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.max(1, Math.min(50, Number(filters.pageSize || 12)));
    const where = ["a.deleted_at IS NULL"];
    const params = [];
    const keyword = safeText(filters.keyword, 200);
    if (keyword) {
      where.push("(a.title LIKE ? OR a.product_name LIKE ? OR a.search_text LIKE ? OR EXISTS (SELECT 1 FROM ai_material_asset_tags at2 JOIN ai_material_tags t2 ON t2.id=at2.tag_id WHERE at2.asset_id=a.id AND t2.name LIKE ?))");
      const like = `%${keyword}%`;
      params.push(like, like, like, like);
    }
    if (filters.productId) {
      where.push("a.product_id=?");
      params.push(safeText(filters.productId, 128));
    }
    if (filters.sourceType) {
      where.push("a.source_type=?");
      params.push(safeText(filters.sourceType, 32));
    }
    if (String(filters.isEffective) === "true" || String(filters.isEffective) === "1") {
      where.push("a.is_effective=1");
    }
    if (String(filters.isEffective) === "false" || String(filters.isEffective) === "0") {
      where.push("a.is_effective=0");
    }
    if (filters.status) {
      where.push("a.status=?");
      params.push(safeText(filters.status, 32));
    }
    const whereSql = where.join(" AND ");
    const [[totalRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM ${TABLES.assets} a WHERE ${whereSql}`,
      params
    );
    const [rows] = await db.execute(
      `SELECT a.*,
        (SELECT COUNT(*) FROM ${TABLES.clips} c WHERE c.asset_id=a.id) AS clip_count,
        (SELECT GROUP_CONCAT(t.name ORDER BY t.category, t.name SEPARATOR ',')
          FROM ${TABLES.assetTags} atg JOIN ${TABLES.tags} t ON t.id=atg.tag_id
          WHERE atg.asset_id=a.id) AS tags
       FROM ${TABLES.assets} a
       WHERE ${whereSql}
       ORDER BY a.is_effective DESC, a.updated_at DESC, a.created_at DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    return {
      items: rows.map(toPublicAsset),
      library: "managed",
      page,
      pageSize,
      total: Number(totalRow.total || 0),
      pages: Math.max(1, Math.ceil(Number(totalRow.total || 0) / pageSize))
    };
  }

  async function listIndexedAssets(filters = {}) {
    const db = await getPool();
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.max(1, Math.min(50, Number(filters.pageSize || 12)));
    const where = ["v.deleted_at IS NULL", "v.video_url IS NOT NULL", "v.video_url <> ''"];
    const params = [];
    const keyword = safeText(filters.keyword, 200);
    if (keyword) {
      where.push(`(
        v.title LIKE ? OR v.brand LIKE ? OR v.account_name LIKE ? OR
        v.hashtags LIKE ? OR v.ad_name LIKE ? OR v.aweme_id LIKE ?
      )`);
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like, like);
    }
    if (filters.brand) {
      where.push("v.brand=?");
      params.push(safeText(filters.brand, 128));
    }
    if (filters.sourceType) {
      where.push("v.source=?");
      params.push(safeText(filters.sourceType, 32));
    }
    if (String(filters.hasPerformance) === "true" || String(filters.hasPerformance) === "1") {
      where.push("((v.spend IS NOT NULL AND v.spend <> '' AND v.spend <> '0') OR v.roi > 0)");
    }
    if (String(filters.hasPerformance) === "false" || String(filters.hasPerformance) === "0") {
      where.push("((v.spend IS NULL OR v.spend = '' OR v.spend = '0') AND (v.roi IS NULL OR v.roi <= 0))");
    }
    const whereSql = where.join(" AND ");
    const [[totalRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM scraped_videos v WHERE ${whereSql}`,
      params
    );
    const [rows] = await db.execute(
      `SELECT v.id, v.title, v.brand, v.source, v.account_name, v.original_url,
        v.cover_url, v.video_url, v.duration, v.spend, v.roi, v.grade,
        v.platform, v.ad_name, v.publish_time, v.collected_at,
        v.interaction_updated_at, v.updated_at,
        (SELECT COUNT(*) FROM video_dissection vd
          WHERE BINARY TRIM(vd.original_video)=BINARY v.video_url AND vd.is_deleted=0) AS clip_count
       FROM scraped_videos v
       WHERE ${whereSql}
       ORDER BY v.updated_at DESC, v.interaction_updated_at DESC, v.id DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    return {
      items: rows.map(toPublicIndexedAsset),
      library: "oss",
      page,
      pageSize,
      total: Number(totalRow.total || 0),
      pages: Math.max(1, Math.ceil(Number(totalRow.total || 0) / pageSize))
    };
  }

  async function listAssets(filters = {}) {
    if (!initialized) await init();
    const library = safeText(filters.library || (externalCatalogAvailable ? "oss" : "managed"), 20);
    if (library === "oss" && !status.connected && catalogCache) return listCachedAssets(filters);
    if (library === "managed" && !status.connected && catalogCache) {
      return { items: [], library: "managed", sourceMode: "release-cache", page: 1, pageSize: Number(filters.pageSize || 12), total: 0, pages: 1 };
    }
    if (library === "oss" && externalCatalogAvailable) return listIndexedAssets(filters);
    return listManagedAssets(filters);
  }

  async function getManagedAsset(assetId) {
    const db = await getPool();
    const [rows] = await db.execute(
      `SELECT a.*,
        (SELECT COUNT(*) FROM ${TABLES.clips} c WHERE c.asset_id=a.id) AS clip_count,
        (SELECT GROUP_CONCAT(t.name ORDER BY t.category, t.name SEPARATOR ',')
          FROM ${TABLES.assetTags} atg JOIN ${TABLES.tags} t ON t.id=atg.tag_id
          WHERE atg.asset_id=a.id) AS tags
       FROM ${TABLES.assets} a WHERE a.id=? AND a.deleted_at IS NULL LIMIT 1`,
      [safeText(assetId, 64)]
    );
    if (!rows[0]) return null;
    const [clips] = await db.execute(
      `SELECT id, asset_id AS assetId, start_ms/1000 AS start, end_ms/1000 AS end,
        duration_ms/1000 AS duration, stage, stage_label AS stageLabel,
        visual_type AS visualType, transcript, visible_text AS visibleText,
        file_path AS filePath, thumbnail_path AS thumbnailPath, approved, review_required AS reviewRequired
       FROM ${TABLES.clips} WHERE asset_id=? ORDER BY start_ms`,
      [safeText(assetId, 64)]
    );
    return { ...toPublicAsset(rows[0]), clips };
  }

  async function getIndexedAsset(assetId) {
    const match = String(assetId || "").match(/^oss-(\d+)$/);
    if (!match || !externalCatalogAvailable) return null;
    const db = await getPool();
    const [rows] = await db.execute(
      `SELECT v.id, v.title, v.brand, v.source, v.account_name, v.original_url,
        v.cover_url, v.video_url, v.duration, v.spend, v.roi, v.grade,
        v.platform, v.ad_name, v.publish_time, v.collected_at,
        v.interaction_updated_at, v.updated_at,
        (SELECT COUNT(*) FROM video_dissection vd
          WHERE BINARY TRIM(vd.original_video)=BINARY v.video_url AND vd.is_deleted=0) AS clip_count
       FROM scraped_videos v
       WHERE v.id=? AND v.deleted_at IS NULL
         AND v.video_url IS NOT NULL AND v.video_url <> ''
       LIMIT 1`,
      [Number(match[1])]
    );
    if (!rows[0]) return null;
    const asset = toPublicIndexedAsset(rows[0]);
    const [clips] = await db.execute(
      `SELECT CONCAT('existing-', id) AS id,
        ? AS assetId,
        video_segment_id AS segmentId,
        time_range AS timeRange,
        scene_description AS visualType,
        script_text AS transcript,
        scene_text AS visibleText,
        camera_angle AS cameraAngle,
        shot_size AS shotSize,
        camera_movement AS cameraMovement,
        expression_style AS expressionStyle,
        original_video AS filePath
       FROM video_dissection
       WHERE original_video=? AND is_deleted=0
       ORDER BY video_segment_id, id`,
      [asset.id, asset.filePath]
    );
    return { ...asset, clips };
  }

  async function getAsset(assetId) {
    if (!initialized) await init();
    if (!status.connected && catalogCache) return getCachedAsset(assetId);
    if (/^oss-\d+$/.test(String(assetId || ""))) {
      const indexed = await getIndexedAsset(assetId);
      if (indexed) return indexed;
    }
    return getManagedAsset(assetId);
  }

  async function saveRemakePromptRecipe(recipe = {}, options = {}) {
    if (!initialized) await init();
    const id = safeText(recipe.id, 64);
    const ownerKey = safeText(recipe.ownerKey || options.ownerKey, 128);
    if (!id || !ownerKey) throw new Error("提示词案例缺少有效的案例ID或所属账号");
    const snapshotPath = path.resolve(String(options.snapshotPath || ""));
    const snapshotStat = options.snapshotPath ? await fsp.stat(snapshotPath).catch(() => null) : null;
    const previousSnapshotKey = safeText(recipe.storage?.snapshotKey, 4000);
    let storage = {
      ...(recipe.storage || {}),
      backend: "aliyun-oss+mysql",
      snapshotKey: safeText(recipe.storage?.snapshotKey, 4000),
      snapshotUrl: safeText(recipe.storage?.snapshotUrl, 4000),
      snapshotSha256: safeText(recipe.storage?.snapshotSha256, 64),
      ossSynced: Boolean(recipe.storage?.snapshotUrl),
      databaseSynced: false,
      syncState: "pending",
      lastError: ""
    };
    const errors = [];
    if (snapshotStat?.isFile() && sharedStorage.enabled && (!storage.ossSynced || options.forceSnapshotUpload === true)) {
      try {
        const snapshotSha256 = await hashFile(snapshotPath);
        const month = new Date().toISOString().slice(0, 7);
        const collection = recipe.caseStage === "source_ready" ? "source-audits" : "prompt-recipes";
        const objectKey = `${sharedStorage.prefix}/one-click-remake/${collection}/${month}/${safeId(ownerKey, "owner")}/${safeId(id, "recipe")}-${snapshotSha256.slice(0, 12)}.json`;
        const uploaded = await sharedStorage.uploadFile(snapshotPath, {
          key: objectKey,
          category: recipe.caseStage === "source_ready" ? "one-click-remake-source-audits" : "one-click-remake-prompt-recipes",
          identity: id,
          mime: "application/json; charset=utf-8"
        });
        storage = {
          ...storage,
          snapshotKey: uploaded.key,
          snapshotUrl: uploaded.url,
          snapshotSha256,
          snapshotBytes: Number(uploaded.bytes || snapshotStat.size || 0),
          snapshotEtag: safeText(uploaded.etag, 255),
          ossSynced: true,
          ossSyncedAt: new Date().toISOString()
        };
      } catch (error) {
        errors.push(`OSS快照：${safeText(error?.message || error, 500)}`);
      }
    } else if (!snapshotStat?.isFile()) {
      errors.push("OSS快照：本地案例快照不存在");
    }

    let storedRecipe = { ...recipe, storage };
    if (status.connected) {
      try {
        const db = await getPool();
        await ensureSchema();
        storage = {
          ...storage,
          databaseSynced: true,
          syncState: storage.ossSynced ? "synchronized" : "database_only",
          indexedAt: new Date().toISOString()
        };
        const tags = remakeRecipeTags(storedRecipe);
        storedRecipe = { ...recipe, tags, storage };
        await db.execute(
          `INSERT INTO ${TABLES.remakePromptRecipes} (
            id, schema_version, owner_key, title, product_id, product_name,
            change_type, video_type, source_task_id, source_canvas_url, source_model,
            cover_url, result_video_url, snapshot_oss_key, snapshot_oss_url,
            snapshot_sha256, tags_json, search_text, recipe_json, created_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            schema_version=VALUES(schema_version), owner_key=VALUES(owner_key), title=VALUES(title),
            product_id=VALUES(product_id), product_name=VALUES(product_name),
            change_type=VALUES(change_type), video_type=VALUES(video_type),
            source_task_id=VALUES(source_task_id), source_canvas_url=VALUES(source_canvas_url),
            source_model=VALUES(source_model), cover_url=VALUES(cover_url),
            result_video_url=VALUES(result_video_url), snapshot_oss_key=VALUES(snapshot_oss_key),
            snapshot_oss_url=VALUES(snapshot_oss_url), snapshot_sha256=VALUES(snapshot_sha256),
            tags_json=VALUES(tags_json), search_text=VALUES(search_text),
            recipe_json=VALUES(recipe_json), updated_by=VALUES(updated_by)`,
          [
            id,
            safeText(storedRecipe.schemaVersion || "one-click-remake-recipe-v2", 64),
            ownerKey,
            safeText(storedRecipe.title || "一键做同款正式案例", 255),
            safeText(storedRecipe.targetProduct?.id, 128) || null,
            safeText(storedRecipe.targetProduct?.name, 255) || null,
            safeText(storedRecipe.changeType?.id, 40) || null,
            safeText(storedRecipe.audit?.videoType, 80) || null,
            safeText(storedRecipe.source?.taskId, 128) || null,
            safeText(storedRecipe.source?.canvasUrl, 4000) || null,
            safeText(storedRecipe.source?.model, 128) || null,
            safeText(storedRecipe.coverUrl, 4000) || null,
            safeText(storedRecipe.result?.videoUrl, 4000) || null,
            safeText(storage.snapshotKey, 4000) || null,
            safeText(storage.snapshotUrl, 4000) || null,
            safeText(storage.snapshotSha256, 64) || null,
            jsonValue(tags),
            remakeRecipeSearchText(storedRecipe),
            jsonValue(storedRecipe),
            safeText(options.actor || recipe.createdBy || ownerKey, 128) || null,
            safeText(options.actor || recipe.createdBy || ownerKey, 128) || null
          ]
        );
      } catch (error) {
        storage = { ...storage, databaseSynced: false };
        errors.push(`数据库索引：${safeText(error?.message || error, 500)}`);
      }
    } else {
      errors.push(`数据库索引：${safeText(status.error || status.message || "数据库当前不可用", 500)}`);
    }
    storage.syncState = storage.databaseSynced
      ? (storage.ossSynced ? "synchronized" : "database_only")
      : (storage.ossSynced ? "oss_only" : "local_fallback");
    storage.lastError = errors.join("；");
    if (
      storage.databaseSynced
      && previousSnapshotKey
      && previousSnapshotKey !== storage.snapshotKey
      && sharedStorage.enabled
      && typeof sharedStorage.deleteObject === "function"
    ) {
      await sharedStorage.deleteObject(previousSnapshotKey).catch(() => {});
    }
    return { recipe: { ...storedRecipe, storage }, storage };
  }

  async function searchRemakePromptRecipes(filters = {}) {
    if (!initialized) await init();
    if (!status.connected) {
      const error = new Error(status.error || status.message || "提示词案例数据库当前不可用");
      error.code = "PROMPT_LIBRARY_DATABASE_UNAVAILABLE";
      throw error;
    }
    const allOwners = filters.allOwners === true;
    const ownerKey = safeText(filters.ownerKey, 128);
    if (!allOwners && !ownerKey) throw new Error("提示词案例检索缺少所属账号");
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.max(1, Math.min(50, Number(filters.pageSize || 12)));
    const where = allOwners ? [] : ["owner_key=?"];
    const params = allOwners ? [] : [ownerKey];
    if (!(filters.includeSourceAudits === true || String(filters.includeSourceAudits || "").toLowerCase() === "true")) {
      where.push("(JSON_UNQUOTE(JSON_EXTRACT(recipe_json, '$.caseStage')) IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(recipe_json, '$.caseStage')) <> 'source_ready')");
    }
    const keywordTokens = safeText(filters.keyword, 240).split(/\s+/).filter(Boolean).slice(0, 8);
    for (const token of keywordTokens) {
      where.push("(search_text LIKE ? OR source_canvas_url LIKE ? OR source_task_id LIKE ? OR title LIKE ?)");
      const like = `%${token}%`;
      params.push(like, like, like, like);
    }
    const exactFilters = [
      ["product_id", filters.productId, 128],
      ["change_type", filters.changeType, 40],
      ["video_type", filters.videoType, 80],
      ["source_model", filters.model, 128],
      ["source_task_id", filters.taskId, 128]
    ];
    for (const [column, value, limit] of exactFilters) {
      const normalized = safeText(value, limit);
      if (!normalized) continue;
      where.push(`${column}=?`);
      params.push(normalized);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom || ""))) {
      where.push("created_at>=?");
      params.push(`${filters.dateFrom} 00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo || ""))) {
      where.push("created_at<?");
      const exclusive = new Date(`${filters.dateTo}T00:00:00Z`);
      exclusive.setUTCDate(exclusive.getUTCDate() + 1);
      params.push(exclusive.toISOString().slice(0, 10) + " 00:00:00");
    }
    const whereSql = where.length ? where.join(" AND ") : "1=1";
    const db = await getPool();
    const [[totalRow]] = await db.execute(
      `SELECT COUNT(*) AS total FROM ${TABLES.remakePromptRecipes} WHERE ${whereSql}`,
      params
    );
    const total = Number(totalRow?.total || 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pages);
    const [rows] = await db.execute(
      `SELECT * FROM ${TABLES.remakePromptRecipes}
       WHERE ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ${pageSize} OFFSET ${(safePage - 1) * pageSize}`,
      params
    );
    return {
      items: rows.map(toPublicRemakePromptRecipe),
      page: safePage,
      pageSize,
      total,
      pages,
      sourceMode: "database-oss"
    };
  }

  async function getRemakePromptRecipe(recipeId, ownerKey) {
    if (!initialized) await init();
    if (!status.connected) return null;
    const db = await getPool();
    const [rows] = await db.execute(
      `SELECT * FROM ${TABLES.remakePromptRecipes} WHERE id=? AND owner_key=? LIMIT 1`,
      [safeText(recipeId, 64), safeText(ownerKey, 128)]
    );
    return rows[0] ? toPublicRemakePromptRecipe(rows[0]) : null;
  }

  async function getAnyRemakePromptRecipe(recipeId) {
    if (!initialized) await init();
    if (!status.connected) return null;
    const db = await getPool();
    const [rows] = await db.execute(
      `SELECT * FROM ${TABLES.remakePromptRecipes} WHERE id=? LIMIT 1`,
      [safeText(recipeId, 64)]
    );
    return rows[0] ? toPublicRemakePromptRecipe(rows[0]) : null;
  }

  async function deleteRemakePromptRecipe(recipeId, options = {}) {
    if (!initialized) await init();
    if (!status.connected) throw new Error(status.error || status.message || "提示词案例数据库当前不可用");
    const id = safeText(recipeId, 64);
    const ownerKey = safeText(options.ownerKey, 128);
    const db = await getPool();
    const where = ownerKey ? "id=? AND owner_key=?" : "id=?";
    const params = ownerKey ? [id, ownerKey] : [id];
    const [rows] = await db.execute(
      `SELECT * FROM ${TABLES.remakePromptRecipes} WHERE ${where} LIMIT 1`,
      params
    );
    if (!rows[0]) return { id, deleted: false, storageDeleted: false, warning: "案例不存在" };
    await db.execute(`DELETE FROM ${TABLES.remakePromptRecipes} WHERE ${where}`, params);
    const snapshotKey = safeText(rows[0].snapshot_oss_key, 4000);
    let storageDeleted = !snapshotKey;
    let warning = "";
    if (snapshotKey && sharedStorage.enabled && typeof sharedStorage.deleteObject === "function") {
      try {
        await sharedStorage.deleteObject(snapshotKey);
        storageDeleted = true;
      } catch (error) {
        warning = `数据库记录已删除，OSS快照清理失败：${safeText(error?.message || error, 500)}`;
      }
    } else if (snapshotKey) {
      warning = "数据库记录已删除，但OSS当前不可用，快照对象尚未清理";
    }
    return { id, deleted: true, storageDeleted, warning };
  }

  async function materializeIndexedAsset(assetId, actor = "") {
    const indexed = await getIndexedAsset(assetId);
    if (!indexed) return null;
    const db = await getPool();
    const searchText = [
      indexed.title,
      indexed.productName,
      indexed.sourceType,
      ...(indexed.tags || [])
    ].filter(Boolean).join(" ");
    await db.execute(
      `INSERT INTO ${TABLES.assets} (
        id, external_id, title, product_name, source_type, source_doc_title,
        source_doc_url, effective_label, is_effective, storage_backend,
        storage_path, file_name, mime, duration_ms, has_audio, status,
        ai_status, search_text, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 'aliyun-oss-index', ?, ?, 'video/mp4', ?, 1,
        'ready', ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title=VALUES(title), product_name=VALUES(product_name),
        source_type=VALUES(source_type), source_doc_title=VALUES(source_doc_title),
        source_doc_url=VALUES(source_doc_url), storage_backend=VALUES(storage_backend),
        storage_path=VALUES(storage_path), file_name=VALUES(file_name),
        duration_ms=VALUES(duration_ms), ai_status=VALUES(ai_status),
        search_text=VALUES(search_text), updated_by=VALUES(updated_by)`,
      [
        indexed.id, indexed.externalId, indexed.title,
        indexed.productName || null, indexed.sourceType || "qianchuan",
        indexed.sourceDocTitle || null, indexed.sourceDocUrl || null,
        indexed.filePath, indexed.fileName,
        Math.max(0, Math.round(Number(indexed.duration || 0) * 1000)),
        indexed.clipCount > 0 ? "ready" : "pending",
        searchText, safeText(actor, 128) || null, safeText(actor, 128) || null
      ]
    );
    await upsertAssetTags(db, indexed.id, indexed.tags || [], "source");
    await audit("register_oss_asset", "asset", indexed.id, {
      externalId: indexed.externalId,
      storageBackend: indexed.storageBackend
    }, actor);
    return indexed;
  }

  async function registerLocalFile(filePath, metadata = {}, actor = "") {
    const resolved = path.resolve(filePath);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error("上传结果不是有效文件");
    const [sha256, video] = await Promise.all([hashFile(resolved), probeVideo(ffprobe, resolved)]);
    const db = await getPool();
    await ensureSchema();
    const [duplicateRows] = await db.execute(
      `SELECT id FROM ${TABLES.assets} WHERE sha256=? AND deleted_at IS NULL LIMIT 1`,
      [sha256]
    );
    if (duplicateRows[0]) {
      return { duplicate: true, asset: await getManagedAsset(duplicateRows[0].id) };
    }
    const assetId = safeId(metadata.id, "material");
    const ext = path.extname(resolved).toLowerCase() || ".mp4";
    const datedDir = path.join(storageRoot, "originals", new Date().toISOString().slice(0, 7));
    await fsp.mkdir(datedDir, { recursive: true });
    const finalPath = path.join(datedDir, `${assetId}${ext}`);
    if (path.resolve(finalPath) !== resolved) {
      if (metadata.preserveSource === true) await fsp.copyFile(resolved, finalPath);
      else await fsp.rename(resolved, finalPath);
    }
    const title = safeText(metadata.title || path.basename(filePath, ext), 255) || "未命名素材";
    const searchText = [title, metadata.productName, metadata.tags].filter(Boolean).join(" ");
    const sharedObject = await sharedStorage.uploadFile(finalPath, {
      category: "material-center",
      identity: `${assetId}-${sha256.slice(0, 12)}`,
      mime: safeText(metadata.mime || "video/mp4", 100)
    });
    await db.execute(
      `INSERT INTO ${TABLES.assets} (
        id, external_id, title, product_id, product_name, source_type, effective_label,
        approval_risk, is_effective, storage_backend, storage_path, file_name, mime,
        file_size, sha256, duration_ms, width, height, fps, video_codec, audio_codec,
        has_audio, status, ai_status, search_text, created_by, updated_by
      ) VALUES (?, NULL, ?, ?, ?, 'upload', ?, ?, ?, 'aliyun-oss-yxb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 'pending', ?, ?, ?)`,
      [
        assetId, title, safeText(metadata.productId, 128) || null,
        safeText(metadata.productName, 255) || null,
        safeText(metadata.effectiveLabel, 64) || null,
        safeText(metadata.approvalRisk, 32) || null,
        boolValue(metadata.isEffective), sharedObject.url, path.basename(finalPath),
        safeText(metadata.mime || "video/mp4", 100),
        Number(stat.size || video.size || 0), sha256, Math.round(video.duration * 1000),
        video.width, video.height, video.fps || null, video.videoCodec || null,
        video.audioCodec || null, boolValue(video.hasAudio), searchText,
        safeText(actor, 128) || null, safeText(actor, 128) || null
      ]
    );
    await upsertAssetTags(db, assetId, metadata.tags || [], "custom");
    if (metadata.productName) await upsertAssetTags(db, assetId, [metadata.productName], "system");
    await audit("upload_asset", "asset", assetId, {
      fileName: path.basename(finalPath),
      size: stat.size,
      storageBackend: "aliyun-oss-yxb",
      storagePath: sharedObject.url,
      localCachePath: finalPath
    }, actor);
    return { duplicate: false, asset: await getManagedAsset(assetId) };
  }

  async function updateAsset(assetId, changes = {}, actor = "") {
    if (/^oss-\d+$/.test(String(assetId || ""))) {
      await materializeIndexedAsset(assetId, actor);
    }
    const db = await getPool();
    const fields = [];
    const params = [];
    const mappings = {
      title: ["title", 255],
      productId: ["product_id", 128],
      productName: ["product_name", 255],
      effectiveLabel: ["effective_label", 64],
      approvalRisk: ["approval_risk", 32],
      status: ["status", 32]
    };
    for (const [key, [column, max]] of Object.entries(mappings)) {
      if (changes[key] === undefined) continue;
      fields.push(`${column}=?`);
      params.push(safeText(changes[key], max) || null);
    }
    if (changes.isEffective !== undefined) {
      fields.push("is_effective=?");
      params.push(boolValue(changes.isEffective));
    }
    fields.push("updated_by=?");
    params.push(safeText(actor, 128) || null);
    params.push(safeText(assetId, 64));
    await db.execute(
      `UPDATE ${TABLES.assets} SET ${fields.join(", ")} WHERE id=? AND deleted_at IS NULL`,
      params
    );
    if (changes.tags !== undefined) {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(`DELETE FROM ${TABLES.assetTags} WHERE asset_id=?`, [safeText(assetId, 64)]);
        await upsertAssetTags(connection, safeText(assetId, 64), changes.tags, "custom");
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    }
    await audit("update_asset", "asset", assetId, changes, actor);
    return getManagedAsset(assetId);
  }

  async function createPublishTask(input = {}, actor = "") {
    if (!status.connected) {
      throw new Error("当前为部门素材只读缓存；加入千川队列需要管理员主机连接公司数据库。");
    }
    const db = await getPool();
    const requestedAssetId = safeText(input.assetId, 64);
    if (/^oss-\d+$/.test(requestedAssetId)) {
      await materializeIndexedAsset(requestedAssetId, actor);
    }
    const asset = await getManagedAsset(requestedAssetId);
    if (!asset) throw new Error("素材不存在或已停用");
    const id = `publish-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const platform = safeText(input.platform || "qianchuan", 32);
    const statusValue = platform === "qianchuan" ? "waiting_auth" : "draft";
    const payload = {
      title: asset.title,
      filePath: asset.filePath,
      note: safeText(input.note, 1000),
      planId: safeText(input.planId, 128),
      planName: safeText(input.planName, 255),
      planType: safeText(input.planType, 64),
      planTypeLabel: safeText(input.planTypeLabel, 64),
      marketingGoal: safeText(input.marketingGoal, 64),
      marketingGoalLabel: safeText(input.marketingGoalLabel, 64)
    };
    await db.execute(
      `INSERT INTO ${TABLES.publishTasks}
       (id, asset_id, clip_id, platform, advertiser_id, status, payload_json, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, asset.id, safeText(input.clipId, 96) || null, platform,
        safeText(input.advertiserId, 128) || null, statusValue,
        jsonValue(payload),
        safeText(actor, 128) || null
      ]
    );
    await audit("queue_publish", "publish_task", id, {
      assetId: asset.id,
      platform,
      status: statusValue,
      advertiserId: safeText(input.advertiserId, 128),
      planId: payload.planId,
      planType: payload.planType
    }, actor);
    return {
      id,
      assetId: asset.id,
      platform,
      status: statusValue,
      advertiserId: safeText(input.advertiserId, 128),
      payload,
      message: "已加入千川待推送队列"
    };
  }

  async function listPublishTasks(filters = {}) {
    if (!status.connected && catalogCache) return [];
    const db = await getPool();
    const params = [];
    const where = [];
    if (filters.status) {
      where.push("p.status=?");
      params.push(safeText(filters.status, 32));
    }
    if (filters.requestedBy) {
      where.push("p.requested_by=?");
      params.push(safeText(filters.requestedBy, 128));
    }
    const [rows] = await db.execute(
      `SELECT p.id, p.asset_id AS assetId, p.clip_id AS clipId, p.platform,
        p.advertiser_id AS advertiserId, p.status, p.external_material_id AS externalMaterialId,
        p.error_message AS errorMessage, p.requested_by AS requestedBy,
        p.requested_at AS requestedAt, p.updated_at AS updatedAt, p.payload_json AS payloadJson,
        a.title, a.product_name AS productName, a.storage_path AS filePath
       FROM ${TABLES.publishTasks} p
       JOIN ${TABLES.assets} a ON a.id=p.asset_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY p.requested_at DESC LIMIT 100`,
      params
    );
    return rows.map((row) => {
      let payload = {};
      try {
        payload = typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson || "{}") : (row.payloadJson || {});
      } catch {}
      return {
        ...row,
        payload,
        planId: payload.planId || "",
        planName: payload.planName || "",
        planType: payload.planType || "",
        planTypeLabel: payload.planTypeLabel || ""
      };
    });
  }

  async function getPublishTask(taskId) {
    if (!status.connected) return null;
    const db = await getPool();
    const [rows] = await db.execute(
      `SELECT p.id, p.asset_id AS assetId, p.clip_id AS clipId, p.platform,
        p.advertiser_id AS advertiserId, p.status, p.external_material_id AS externalMaterialId,
        p.error_message AS errorMessage, p.payload_json AS payloadJson,
        p.requested_by AS requestedBy, p.requested_at AS requestedAt, p.updated_at AS updatedAt,
        a.title, a.product_name AS productName, a.storage_path AS filePath
       FROM ${TABLES.publishTasks} p
       JOIN ${TABLES.assets} a ON a.id=p.asset_id
       WHERE p.id=? LIMIT 1`,
      [safeText(taskId, 96)]
    );
    const row = rows[0] || null;
    if (!row) return null;
    let payload = {};
    try {
      payload = typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson || "{}") : (row.payloadJson || {});
    } catch {}
    return {
      ...row,
      payload,
      planId: payload.planId || "",
      planName: payload.planName || "",
      planType: payload.planType || "",
      planTypeLabel: payload.planTypeLabel || ""
    };
  }

  async function updatePublishTask(taskId, changes = {}, actor = "") {
    if (!status.connected) {
      throw new Error("千川推送状态需要连接公司数据库后更新");
    }
    const current = await getPublishTask(taskId);
    if (!current) throw new Error("待推送任务不存在");
    const allowedStatuses = new Set(["waiting_auth", "queued", "pushing", "partial", "success", "failed"]);
    const nextStatus = safeText(changes.status || current.status, 32);
    if (!allowedStatuses.has(nextStatus)) throw new Error("千川推送状态不合法");
    const advertiserId = safeText(changes.advertiserId ?? current.advertiserId, 128) || null;
    const externalMaterialId = safeText(changes.externalMaterialId ?? current.externalMaterialId, 128) || null;
    const errorMessage = safeText(changes.errorMessage, 2000) || null;
    let payload = {};
    try {
      payload = current.payload && typeof current.payload === "object"
        ? current.payload
        : typeof current.payloadJson === "string"
          ? JSON.parse(current.payloadJson || "{}")
          : (current.payloadJson || {});
    } catch {}
    payload = { ...payload, ...(changes.payload || {}) };
    const db = await getPool();
    await db.execute(
      `UPDATE ${TABLES.publishTasks}
       SET advertiser_id=?, status=?, external_material_id=?, error_message=?, payload_json=?
       WHERE id=?`,
      [advertiserId, nextStatus, externalMaterialId, errorMessage, jsonValue(payload), current.id]
    );
    await audit("update_publish_task", "publish_task", current.id, {
      status: nextStatus,
      advertiserId,
      externalMaterialId,
      hasError: Boolean(errorMessage)
    }, actor);
    return getPublishTask(current.id);
  }

  async function getStatus() {
    if (!initialized) await init();
    let summary = {
      assets: 0, effectiveAssets: 0, clips: 0, storageBytes: 0, pendingPublish: 0, published: 0
    };
    if (status.connected || catalogCache) {
      try {
        summary = await getSummary();
      } catch (error) {
        status.connected = false;
        status.catalogReady = Boolean(catalogCache);
        status.cacheReady = Boolean(catalogCache);
        status.objectStorageReady = Boolean(catalogCache);
        status.error = catalogCache ? "" : "素材中心连接已中断，请稍后重试。";
        status.message = catalogCache
          ? "实时数据库连接已中断，已自动切换部门WIS素材只读缓存"
          : "素材中心连接已中断";
      }
    }
    return { ...status, summary };
  }

  function incomingPath(originalName) {
    const ext = path.extname(String(originalName || "")).toLowerCase();
    const stem = path.basename(String(originalName || "素材"), ext)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 120) || "素材";
    return path.join(storageRoot, "incoming", `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${stem}${ext}`);
  }

  return {
    init,
    ensureSchema,
    getStatus,
    getSummary,
    listAssets,
    getAsset,
    saveRemakePromptRecipe,
    searchRemakePromptRecipes,
    getRemakePromptRecipe,
    getAnyRemakePromptRecipe,
    deleteRemakePromptRecipe,
    syncRemixLibrary,
    registerLocalFile,
    updateAsset,
    createPublishTask,
    getPublishTask,
    listPublishTasks,
    updatePublishTask,
    incomingPath,
    storageRoot,
    sharedStorage,
    configPath,
    catalogCachePath,
    tables: TABLES
  };
}

module.exports = {
  TABLES,
  createMaterialCenter,
  readConfig,
  normalizeTags,
  parseDurationSeconds,
  safeId,
  toPublicAsset,
  toPublicIndexedAsset,
  remakeRecipeTags,
  remakeRecipeSearchText,
  toPublicRemakePromptRecipe
};

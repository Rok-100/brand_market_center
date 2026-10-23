const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const VIDEO_PATTERN = /\.(mp4|mov|m4v|webm)$/i;

function safePart(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await fsp.rename(tempPath, filePath);
}

async function walk(directory, files) {
  let entries = [];
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target, files);
    else if (entry.isFile() && VIDEO_PATTERN.test(entry.name)) files.push(target);
  }
}

function createSharedOutputSync(options = {}) {
  const appRoot = path.resolve(options.appRoot || process.cwd());
  const sharedStorage = options.sharedStorage;
  if (!sharedStorage) throw new Error("共享存储未配置");
  const remixRoot =
    process.env.AI_REMIX_DATA_DIR ||
    (fs.existsSync("H:\\")
      ? "H:\\codex输出\\AI智能混剪"
      : path.join(appRoot, "data", "remix"));
  const roots = [
    {
      label: "generated",
      directory: path.join(appRoot, "outputs"),
      prefix: "yxb/workbench/generated"
    },
    {
      label: "uploads",
      directory: path.join(appRoot, "uploads"),
      prefix: "yxb/workbench/uploads"
    },
    {
      label: "remix-sources",
      directory: path.join(remixRoot, "sources"),
      prefix: "yxb/workbench/remix/sources"
    },
    {
      label: "remix-clips",
      directory: path.join(remixRoot, "clips-v6"),
      prefix: "yxb/workbench/remix/clips-v6"
    },
    {
      label: "remix-outputs",
      directory: path.join(remixRoot, "outputs"),
      prefix: "yxb/workbench/remix/outputs"
    }
  ];
  const manifestPath =
    options.manifestPath ||
    path.join(appRoot, "cache", "shared-storage-sync.json");
  const intervalMs = Math.max(
    60_000,
    Number(options.intervalMs || process.env.AI_SHARED_SYNC_INTERVAL_MS || 300_000)
  );
  const configuredClientId = safePart(
    options.clientId || process.env.AI_SHARED_STORAGE_CLIENT_ID || ""
  );
  const clientId = configuredClientId || crypto
    .createHash("sha256")
    .update(`${os.hostname()}|${os.userInfo().username}`)
    .digest("hex")
    .slice(0, 16);
  let running = false;
  let timer = null;
  let state = {
    enabled: sharedStorage.enabled,
    running: false,
    lastStartedAt: "",
    lastFinishedAt: "",
    discovered: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    pending: 0,
    lastError: ""
  };

  function destinationKey(root, filePath) {
    const relative = path.relative(root.directory, filePath);
    return `${root.prefix}/${clientId}/${relative
      .split(path.sep)
      .map((part) => safePart(part))
      .filter(Boolean)
      .join("/")}`;
  }

  async function runOnce() {
    if (running || !sharedStorage.enabled) return { ...state };
    running = true;
    state = {
      ...state,
      running: true,
      lastStartedAt: new Date().toISOString(),
      uploaded: 0,
      skipped: 0,
      failed: 0,
      lastError: ""
    };
    try {
      const manifest = await readJson(manifestPath, { version: 1, files: {} });
      const items = [];
      for (const root of roots) {
        const files = [];
        await walk(root.directory, files);
        for (const filePath of files) {
          // KOC has its own verified whole-video return; do not publish its
          // intermediate clips or a second copy through the generic OSS scan.
          if (root.label === "generated" && path.relative(root.directory, filePath).split(path.sep)[0] === "AI-KOC生成") continue;
          const stat = await fsp.stat(filePath);
          if (!stat.isFile() || Date.now() - stat.mtimeMs < 5000) continue;
          const signature = crypto
            .createHash("sha256")
            .update(`${filePath}\t${stat.size}\t${Math.round(stat.mtimeMs)}`)
            .digest("hex");
          items.push({
            root,
            filePath,
            bytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            signature,
            destinationKey: destinationKey(root, filePath)
          });
        }
      }
      state.discovered = items.length;
      const pending = items.filter(
        (item) => manifest.files[item.filePath]?.signature !== item.signature
      );
      state.pending = pending.length;
      for (const item of pending) {
        try {
          const uploaded = await sharedStorage.uploadFile(item.filePath, {
            key: item.destinationKey,
            category: item.root.label
          });
          manifest.files[item.filePath] = {
            signature: item.signature,
            bytes: item.bytes,
            modifiedAt: item.modifiedAt,
            key: uploaded.key,
            url: uploaded.url,
            syncedAt: new Date().toISOString()
          };
          state.uploaded += 1;
        } catch (error) {
          state.failed += 1;
          state.lastError = String(error?.message || error || "共享同步失败").slice(
            0,
            240
          );
        }
      }
      state.skipped = items.length - pending.length;
      state.pending = Math.max(0, pending.length - state.uploaded);
      manifest.updatedAt = new Date().toISOString();
      await writeJsonAtomic(manifestPath, manifest);
    } finally {
      running = false;
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
    }
    return { ...state };
  }

  function start() {
    if (!sharedStorage.enabled || timer) return;
    setTimeout(() => {
      runOnce().catch((error) => {
        state.lastError = String(error?.message || error || "共享同步失败").slice(
          0,
          240
        );
      });
    }, 15_000).unref();
    timer = setInterval(() => {
      runOnce().catch((error) => {
        state.lastError = String(error?.message || error || "共享同步失败").slice(
          0,
          240
        );
      });
    }, intervalMs);
    timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    roots,
    clientId,
    manifestPath,
    runOnce,
    start,
    stop,
    getState: () => ({ ...state })
  };
}

module.exports = {
  createSharedOutputSync
};

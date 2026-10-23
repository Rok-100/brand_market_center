const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const DEFAULT_ORIGIN = "https://oss.fandow.com";
const DEFAULT_BUCKET = "marketing-video-dashboard";
const DEFAULT_PREFIX = "yxb/workbench";

function normalizeSegment(value, fallback = "asset") {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function encodeObjectKey(key) {
  return String(key || "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function contentTypeFor(filePath, fallback = "video/mp4") {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".m4v") return "video/x-m4v";
  if (ext === ".webm") return "video/webm";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return fallback;
}

function createSharedStorage(options = {}) {
  const origin = String(
    options.origin || process.env.AI_MATERIAL_OSS_ORIGIN || DEFAULT_ORIGIN
  ).replace(/\/+$/, "");
  const bucket = normalizeSegment(
    options.bucket || process.env.AI_MATERIAL_OSS_BUCKET || DEFAULT_BUCKET,
    DEFAULT_BUCKET
  );
  const prefix = String(
    options.prefix || process.env.AI_MATERIAL_OSS_PREFIX || DEFAULT_PREFIX
  )
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((part) => normalizeSegment(part))
    .join("/");
  const enabled =
    options.enabled !== undefined
      ? options.enabled === true
      : !/^(0|false|off)$/i.test(
          String(process.env.AI_MATERIAL_OSS_WRITE_ENABLED || "true")
        );

  function objectUrl(key) {
    return `${origin}/${encodeURIComponent(bucket)}/${encodeObjectKey(key)}`;
  }

  function createObjectKey(category, filePath, identity = "") {
    const ext = path.extname(String(filePath || "")).toLowerCase() || ".mp4";
    const stamp = new Date().toISOString().slice(0, 7);
    const id = normalizeSegment(
      identity ||
        `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      "asset"
    );
    const base = normalizeSegment(path.basename(String(filePath || ""), ext), "video");
    return `${prefix}/${normalizeSegment(category, "uploads")}/${stamp}/${id}-${base}${ext}`;
  }

  async function headObject(key) {
    const response = await fetch(objectUrl(key), {
      method: "HEAD",
      signal: AbortSignal.timeout(30000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`共享存储检查失败（HTTP ${response.status}）`);
    return {
      bytes: Number(response.headers.get("content-length") || 0),
      etag: String(response.headers.get("etag") || "").replaceAll('"', ""),
      contentType: String(response.headers.get("content-type") || "")
    };
  }

  function putFile(filePath, key, mime) {
    return new Promise(async (resolve, reject) => {
      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch (error) {
        reject(error);
        return;
      }
      if (!stat.isFile()) {
        reject(new Error("待上传内容不是有效文件"));
        return;
      }
      const target = new URL(objectUrl(key));
      const request = https.request(
        target,
        {
          method: "PUT",
          headers: {
            "Content-Type": mime || contentTypeFor(filePath),
            "Content-Length": stat.size,
            "X-Amz-Meta-Workbench": "brand-marketing"
          },
          timeout: Math.max(
            180000,
            Math.ceil(stat.size / (256 * 1024)) * 1000
          )
        },
        (response) => {
          const chunks = [];
          let bytes = 0;
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes <= 256 * 1024) chunks.push(chunk);
          });
          response.on("end", () => {
            if (Number(response.statusCode || 500) >= 400) {
              const body = Buffer.concat(chunks).toString("utf8");
              const code = body.match(/<Code>([^<]+)<\/Code>/i)?.[1] || "";
              reject(
                new Error(
                  `共享存储上传失败（HTTP ${response.statusCode}${
                    code ? `，${code}` : ""
                  }）`
                )
              );
              return;
            }
            resolve({ bytes: stat.size });
          });
        }
      );
      request.on("timeout", () => request.destroy(new Error("共享存储上传超时")));
      request.on("error", reject);
      fs.createReadStream(filePath).on("error", reject).pipe(request);
    });
  }

  async function uploadFile(filePath, options = {}) {
    if (!enabled) throw new Error("共享存储上传已停用");
    const resolved = path.resolve(filePath);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error("待上传内容不是有效文件");
    const key =
      String(options.key || "").replace(/^\/+/, "") ||
      createObjectKey(options.category || "uploads", resolved, options.identity);
    const existing = await headObject(key).catch((error) => {
      if (/HTTP 404/.test(String(error?.message || ""))) return null;
      throw error;
    });
    if (!existing || existing.bytes !== stat.size) {
      await putFile(resolved, key, options.mime);
    }
    const verified = await headObject(key);
    if (!verified || verified.bytes !== stat.size) {
      throw new Error("共享存储上传后校验失败");
    }
    return {
      key,
      url: objectUrl(key),
      bytes: verified.bytes,
      etag: verified.etag,
      contentType: verified.contentType || options.mime || contentTypeFor(resolved)
    };
  }

  async function deleteObject(key) {
    if (!enabled) throw new Error("共享存储删除已停用");
    const normalizedKey = String(key || "").replace(/^\/+/, "");
    if (!normalizedKey || (normalizedKey !== prefix && !normalizedKey.startsWith(`${prefix}/`))) {
      throw new Error("共享存储对象路径不在工作台目录内");
    }
    const response = await fetch(objectUrl(normalizedKey), {
      method: "DELETE",
      signal: AbortSignal.timeout(30000)
    });
    if (![200, 202, 204, 404].includes(response.status)) {
      throw new Error(`共享存储删除失败（HTTP ${response.status}）`);
    }
    const remaining = await headObject(normalizedKey);
    if (remaining) throw new Error("共享存储删除后校验失败");
    return { key: normalizedKey, deleted: response.status !== 404 };
  }

  return {
    enabled,
    origin,
    bucket,
    prefix,
    objectUrl,
    createObjectKey,
    headObject,
    uploadFile,
    deleteObject
  };
}

module.exports = {
  createSharedStorage,
  normalizeSegment,
  contentTypeFor
};

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const RECORD_VERSION = 1;

function credentialUserId(user = {}) {
  return String(
    user.lark_user_id
    || user.larkUserId
    || user.userId
    || user.sub
    || user.id
    || ""
  ).trim();
}

function credentialUserKey(user = {}) {
  const userId = credentialUserId(user);
  if (!userId || userId === "internal-service") {
    throw new Error("当前账号不能保存个人模型授权");
  }
  return crypto.createHash("sha256").update(`workbench-provider:${userId}`).digest("hex").slice(0, 40);
}

function tokenExpiry(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return "";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const expiresAt = Number(payload.exp || 0) * 1000;
    return expiresAt > 0 ? new Date(expiresAt).toISOString() : "";
  } catch {
    return "";
  }
}

function maskWorkNo(value) {
  const text = String(value || "").trim();
  if (text.length <= 4) return text ? `${text.slice(0, 1)}***` : "";
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function publicStatus(record) {
  if (!record) {
    return {
      configured: false,
      valid: false,
      requiresReauthorization: true,
      state: "missing"
    };
  }
  const expiresAtMs = Date.parse(String(record.tokenExpiresAt || ""));
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
  const invalid = Boolean(record.invalidAt || expired);
  return {
    configured: true,
    valid: !invalid,
    requiresReauthorization: invalid,
    state: expired ? "expired" : (record.invalidAt ? "invalid" : "ready"),
    source: String(record.source || "fando-openclaw"),
    fileName: String(record.fileName || "openclaw.json"),
    workNo: maskWorkNo(record.workNo),
    validatedAt: String(record.validatedAt || record.updatedAt || ""),
    tokenExpiresAt: String(record.tokenExpiresAt || ""),
    invalidAt: String(record.invalidAt || ""),
    invalidReason: record.invalidAt ? String(record.invalidReason || "模型授权已失效") : "",
    lastProbe: record.probeAt ? {
      ok: true,
      kind: String(record.probeKind || "jenvideo-session"),
      checkedAt: String(record.probeAt)
    } : null
  };
}

function createProviderCredentialStore(options = {}) {
  const rootDir = path.resolve(String(options.rootDir || ""));
  const secret = String(options.secret || "").trim();
  if (!rootDir) throw new Error("个人模型凭证目录不能为空");
  if (secret.length < 24) throw new Error("个人模型凭证加密密钥无效");
  const encryptionKey = crypto.scryptSync(secret, "fandao-workbench-provider-credentials-v1", 32);

  function recordPath(user) {
    return path.join(rootDir, `${credentialUserKey(user)}.json`);
  }

  function seal(record) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(record), "utf8"),
      cipher.final()
    ]);
    return {
      version: RECORD_VERSION,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
  }

  function unseal(payload) {
    if (Number(payload?.version) !== RECORD_VERSION || payload?.algorithm !== "aes-256-gcm") {
      throw new Error("个人模型授权记录版本不受支持");
    }
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(String(payload.iv || ""), "base64")
    );
    decipher.setAuthTag(Buffer.from(String(payload.tag || ""), "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(String(payload.ciphertext || ""), "base64")),
      decipher.final()
    ]).toString("utf8"));
  }

  async function read(user) {
    const userId = credentialUserId(user);
    if (!userId) return null;
    try {
      const payload = JSON.parse(await fsp.readFile(recordPath(user), "utf8"));
      const record = unseal(payload);
      if (record.userId !== userId) throw new Error("个人模型授权绑定关系无效");
      return record;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function write(user, record) {
    const target = recordPath(user);
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await fsp.mkdir(rootDir, { recursive: true, mode: 0o700 });
    await fsp.writeFile(temporary, JSON.stringify(seal(record)), { encoding: "utf8", mode: 0o600 });
    await fsp.rename(temporary, target);
    await fsp.chmod(target, 0o600).catch(() => {});
  }

  async function save(user, input = {}) {
    const token = String(input.token || "").trim();
    if (token.length < 20 || token.length > 8192) throw new Error("FanDo API Key 格式无效");
    const now = new Date().toISOString();
    const userId = credentialUserId(user);
    const record = {
      userId,
      userName: String(user.name || "").trim().slice(0, 80),
      token,
      tokenFingerprint: crypto.createHmac("sha256", encryptionKey).update(token).digest("hex").slice(0, 24),
      tokenExpiresAt: tokenExpiry(token),
      source: String(input.source || "fando-openclaw").trim().slice(0, 80),
      fileName: path.basename(String(input.fileName || "openclaw.json")).slice(0, 160),
      workNo: String(input.workNo || "").trim().slice(0, 80),
      validatedAt: String(input.validatedAt || now),
      probeKind: String(input.probeKind || "").trim().slice(0, 80),
      probeAt: String(input.probeAt || ""),
      createdAt: now,
      updatedAt: now,
      invalidAt: "",
      invalidReason: ""
    };
    await write(user, record);
    return publicStatus(record);
  }

  async function getCredential(user) {
    const record = await read(user);
    if (!record) return null;
    const status = publicStatus(record);
    if (!status.valid) return null;
    return {
      token: record.token,
      source: record.source || "fando-openclaw",
      cacheKey: record.tokenFingerprint,
      workNo: record.workNo || "",
      validatedAt: record.validatedAt || ""
    };
  }

  async function status(user) {
    try {
      return publicStatus(await read(user));
    } catch {
      return {
        configured: true,
        valid: false,
        requiresReauthorization: true,
        state: "unreadable",
        invalidReason: "本机授权记录无法解密，请重新导入"
      };
    }
  }

  async function markInvalid(user, reason = "模型授权已失效") {
    const record = await read(user).catch(() => null);
    if (!record) return publicStatus(null);
    record.invalidAt = new Date().toISOString();
    record.invalidReason = String(reason || "模型授权已失效").slice(0, 240);
    record.updatedAt = record.invalidAt;
    await write(user, record);
    return publicStatus(record);
  }

  async function remove(user) {
    await fsp.rm(recordPath(user), { force: true });
    return publicStatus(null);
  }

  return {
    getCredential,
    markInvalid,
    remove,
    save,
    status
  };
}

module.exports = {
  createProviderCredentialStore,
  credentialUserId,
  credentialUserKey
};

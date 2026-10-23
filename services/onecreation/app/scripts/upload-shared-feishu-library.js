const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const APP_ID = "app_17aq7v0j96v";
const MANIFEST_PATH = "H:\\codex输出\\AI智能混剪\\library.json";
const MAPPING_PATH = "H:\\codex输出\\AI智能混剪\\shared-feishu-storage.json";
const LARK_CLI = process.env.LARK_CLI || "C:\\Users\\202606\\AppData\\Roaming\\npm\\lark-cli.cmd";
const MAX_CONCURRENCY = 3;
const SIGNED_URL_TTL = 2_592_000;

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "cmd.exe",
      ["/d", "/s", "/c", LARK_CLI, ...args],
      { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const text = Buffer.concat(stdout).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || text || `lark-cli exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error(`无法解析 lark-cli 返回：${text.slice(0, 500)}`));
      }
    });
  });
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tempPath, filePath);
}

async function findExistingRemotePath(fileName) {
  const result = await runCli([
    "apps", "+file-list",
    "--app-id", APP_ID,
    "--as", "user",
    "--name", fileName,
    "--page-size", "20"
  ], process.cwd());
  const match = result?.data?.items?.find((item) => item.file_name === fileName || item.name === fileName);
  return match?.path || "";
}

async function uploadOne(item, ordinal, total) {
  const filePath = String(item.filePath || "");
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`本地原片不存在：${filePath}`);
  const cwd = path.dirname(filePath);
  const fileName = path.basename(filePath);
  let remotePath = String(item.sharedStoragePath || "");
  if (!remotePath) remotePath = await findExistingRemotePath(fileName);
  if (!remotePath) {
    const uploaded = await runCli([
      "apps", "+file-upload",
      "--app-id", APP_ID,
      "--as", "user",
      "--file", `.${path.sep}${fileName}`
    ], cwd);
    remotePath = String(uploaded?.data?.path || "");
  }
  if (!remotePath) throw new Error(`上传成功但未返回远端路径：${fileName}`);
  const signed = await runCli([
    "apps", "+file-sign",
    "--app-id", APP_ID,
    "--as", "user",
    "--path", remotePath,
    "--expires-in", String(SIGNED_URL_TTL)
  ], process.cwd());
  const signedUrl = String(signed?.data?.signed_url || signed?.data?.signedUrl || "");
  if (!signedUrl) throw new Error(`未取得共享播放地址：${fileName}`);
  console.log(`[${ordinal}/${total}] ${fileName} -> ${remotePath}`);
  return {
    remotePath,
    signedUrl,
    signedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString()
  };
}

async function main() {
  const manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8"));
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const mapping = fs.existsSync(MAPPING_PATH)
    ? JSON.parse(await fsp.readFile(MAPPING_PATH, "utf8"))
    : { appId: APP_ID, items: {} };
  let cursor = 0;
  let completed = 0;
  const failures = [];

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        const result = await uploadOne(item, index + 1, items.length);
        item.sharedStoragePath = result.remotePath;
        item.sharedStorageUrl = result.signedUrl;
        item.sharedStorageSignedAt = result.signedAt;
        item.sharedStorageExpiresAt = result.expiresAt;
        mapping.items[item.id] = {
          fileName: path.basename(String(item.filePath || "")),
          ...result
        };
        completed += 1;
      } catch (error) {
        failures.push({ id: item.id, filePath: item.filePath, error: error.message || String(error) });
        console.error(`[失败] ${item.id}: ${error.message || error}`);
      }
      await writeJsonAtomic(MANIFEST_PATH, manifest);
      await writeJsonAtomic(MAPPING_PATH, {
        ...mapping,
        updatedAt: new Date().toISOString(),
        completed,
        total: items.length,
        failures
      });
    }
  }

  await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => worker()));
  console.log(JSON.stringify({ ok: failures.length === 0, completed, total: items.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

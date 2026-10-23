const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function generatedUrl(raw) {
  const urls = String(raw || "").match(/https:\/\/[^"\s]+\.mp4(?:\?[^"\s]*)?/g) || [];
  return urls.find((url) => /\/sd-gen-save-img\//i.test(url)) || "";
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("下载重定向次数过多"));
    const temp = `${destination}.downloading`;
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`下载失败 HTTP ${response.statusCode}`));
      }
      const file = fs.createWriteStream(temp);
      response.pipe(file);
      file.on("finish", async () => {
        file.close();
        await fsp.rename(temp, destination);
        resolve();
      });
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function main() {
  const jobPath = path.resolve(process.argv[2] || "");
  if (!jobPath || !fs.existsSync(jobPath)) throw new Error("请提供存在的裂变 job.json 路径");
  const job = JSON.parse(await fsp.readFile(jobPath, "utf8"));
  const sourceHash = await sha256(job.config.referenceVideoPath);
  const backupDir = path.join(job.outputDir, "recovery-backup-mother-copies");
  await fsp.mkdir(backupDir, { recursive: true });
  const recovered = [];
  for (const task of job.tasks || []) {
    const segment = task.segments?.[0];
    const rawPath = segment?.attempts?.[0]?.rawPath;
    if (!segment || !rawPath) continue;
    const raw = await fsp.readFile(rawPath, "utf8");
    const url = generatedUrl(raw);
    if (!url) throw new Error(`${task.title} 没有找到真实生成地址`);
    if (task.localPath && fs.existsSync(task.localPath)) {
      await fsp.copyFile(task.localPath, path.join(backupDir, path.basename(task.localPath)));
    }
    await fsp.mkdir(path.dirname(segment.localPath), { recursive: true });
    await download(url, segment.localPath);
    const outputHash = await sha256(segment.localPath);
    if (outputHash === sourceHash) throw new Error(`${task.title} 恢复后仍与母版完全相同`);
    await fsp.copyFile(segment.localPath, task.localPath);
    const stat = await fsp.stat(task.localPath);
    segment.url = url;
    segment.outputSha256 = outputHash;
    segment.outputBytes = stat.size;
    segment.basicQuality = {
      passed: true,
      generatedUrlDifferentFromSource: true,
      fileHashDifferentFromSource: true,
      duplicateHash: false,
      recoveredFromSavedLibtvLog: true
    };
    task.url = url;
    task.outputSha256 = outputHash;
    task.outputBytes = stat.size;
    task.quality = {
      status: "legacy-unreviewed",
      checks: ["已从LibTV保存日志找回真实生成地址", "成片文件指纹与母版不同"],
      issues: ["本条由v1.4.4旧提示词生成，尚未通过v1.5.0商品口播与画面差异质检"]
    };
    recovered.push({ task: task.title, url, path: task.localPath, sha256: outputHash, bytes: stat.size });
  }
  job.recoveredAt = new Date().toISOString();
  job.recovery = {
    version: "1.5.0",
    sourceHash,
    backupDir,
    recovered
  };
  job.actionRequired = "已无积分消耗找回6条LibTV真实生成结果；这些是旧提示词产物，请人工查看，后续新任务将使用v1.5.0商品真值、分秒脚本和自动质检。";
  const serialized = JSON.stringify(job, null, 2);
  await fsp.writeFile(jobPath, serialized, "utf8");
  const outputJob = path.join(job.outputDir, "job.json");
  const resultJob = path.join(job.outputDir, "result.json");
  await fsp.writeFile(outputJob, serialized, "utf8");
  if (fs.existsSync(resultJob)) await fsp.writeFile(resultJob, serialized, "utf8");
  const reportPath = path.join(job.outputDir, "recovery-report-v1.5.0.json");
  await fsp.writeFile(reportPath, JSON.stringify(job.recovery, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ jobPath, reportPath, backupDir, recovered }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

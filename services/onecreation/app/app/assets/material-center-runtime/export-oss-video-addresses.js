const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { readConfig } = require("./material-center.js");

const packageRoot = path.resolve(__dirname, "..", "..", "..");
const configPath = path.join(packageRoot, "config", "material-center-db.json");
const cachePath = path.join(__dirname, "catalog-cache.json");
const outputRoot = path.resolve(
  process.argv[2]
  || (fs && process.platform === "win32" ? "H:\\codex输出\\OSS存储视频地址" : path.join(packageRoot, "outputs", "oss-addresses"))
);

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function stableAddress(value) {
  const text = String(value || "").trim();
  if (!/^https:\/\//i.test(text)) return null;
  try {
    const parsed = new URL(text);
    parsed.search = "";
    parsed.hash = "";
    return {
      url: parsed.toString(),
      domain: parsed.hostname,
      objectPath: decodeURIComponent(parsed.pathname.replace(/^\/+/, ""))
    };
  } catch {
    return null;
  }
}

async function loadFromDatabase() {
  const config = await readConfig(configPath);
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: 15000,
    charset: "utf8mb4"
  });
  try {
    const [rows] = await connection.query(
      `SELECT id, title, brand, source, account_name, original_url,
        cover_url, video_url, duration, spend, roi, grade, updated_at
       FROM scraped_videos
       WHERE deleted_at IS NULL AND video_url IS NOT NULL AND video_url <> ''
       ORDER BY updated_at DESC, id DESC`
    );
    return { source: "live-rds", rows };
  } finally {
    await connection.end();
  }
}

async function loadFromCache() {
  const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
  return {
    source: "release-cache",
    rows: (cache.items || []).map((item) => ({
      id: item.externalId || item.id,
      title: item.title,
      brand: item.productName,
      source: item.sourceType,
      account_name: item.sourceDocTitle,
      original_url: item.sourceDocUrl,
      cover_url: item.coverUrl,
      video_url: item.filePath,
      duration: item.duration,
      spend: item.performance?.spend,
      roi: item.performance?.roi,
      grade: item.performance?.grade,
      updated_at: item.updatedAt
    }))
  };
}

async function main() {
  let data;
  let liveError = "";
  try {
    data = await loadFromDatabase();
  } catch (error) {
    liveError = error.message;
    data = await loadFromCache();
  }

  const seen = new Set();
  const indexedRows = [];
  for (const item of data.rows) {
    const address = stableAddress(item.video_url);
    if (!address || seen.has(address.url)) continue;
    seen.add(address.url);
    indexedRows.push({
      id: item.id,
      title: item.title,
      brand: item.brand,
      source: item.source,
      accountName: item.account_name,
      ossDomain: address.domain,
      ossObjectPath: address.objectPath,
      videoUrl: address.url,
      coverUrl: stableAddress(item.cover_url)?.url || "",
      originalSourceUrl: item.original_url,
      durationSeconds: item.duration,
      spend: item.spend,
      roi: item.roi,
      grade: item.grade,
      updatedAt: item.updated_at
    });
  }
  const rows = indexedRows.filter((row) => (
    row.ossDomain === "oss.fandow.com"
    || /\.aliyuncs\.com$/i.test(row.ossDomain)
  ));

  await fs.mkdir(outputRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(outputRoot, `OSS视频地址清单-${stamp}.csv`);
  const summaryPath = path.join(outputRoot, `OSS视频地址说明-${stamp}.md`);
  const columns = [
    "id", "title", "brand", "source", "accountName", "ossDomain", "ossObjectPath",
    "videoUrl", "coverUrl", "originalSourceUrl", "durationSeconds", "spend", "roi",
    "grade", "updatedAt"
  ];
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\r\n");
  await fs.writeFile(csvPath, `\uFEFF${csv}`, "utf8");

  const domains = [...new Set(rows.map((row) => row.ossDomain).filter(Boolean))].sort();
  const summary = [
    "# OSS 存储视频地址说明",
    "",
    `- 导出时间：${new Date().toISOString()}`,
    `- 数据来源：${data.source}`,
    `- OSS 实际存储视频数量（去重）：${rows.length}`,
    `- 已排除外部平台临时视频地址：${indexedRows.length - rows.length}`,
    `- OSS 访问域名：${domains.join("、") || "未识别"}`,
    `- 地址清单：${csvPath}`,
    "",
    "清单中的 videoUrl 是去掉临时查询参数后的 HTTPS 视频地址；ossObjectPath 是同一对象在域名下的对象路径。",
    "本文件不包含数据库口令、OSS AccessKey、Cookie 或任何登录密钥。",
    liveError ? `实时库连接失败，已回退发布缓存：${liveError}` : "实时素材索引读取成功。"
  ].join("\r\n");
  await fs.writeFile(summaryPath, summary, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    source: data.source,
    rawCount: data.rows.length,
    uniqueIndexedVideoCount: indexedRows.length,
    uniqueOssVideoCount: rows.length,
    excludedExternalVideoCount: indexedRows.length - rows.length,
    domains,
    csvPath,
    summaryPath,
    liveError
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

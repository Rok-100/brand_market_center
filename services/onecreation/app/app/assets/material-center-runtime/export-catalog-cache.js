"use strict";

const fs = require("fs/promises");
const path = require("path");
const mysql = require("mysql2/promise");
const { readConfig, toPublicIndexedAsset } = require("./material-center.js");

async function main() {
  const packageRoot = path.resolve(__dirname, "..", "..", "..");
  const configPath = path.join(packageRoot, "config", "material-center-db.json");
  const outputPath = path.join(__dirname, "catalog-cache.json");
  const config = await readConfig(configPath);
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: 12000,
    charset: "utf8mb4",
    decimalNumbers: true
  });
  try {
    const [rows] = await connection.query(
      `SELECT v.id, v.title, v.brand, v.source, v.account_name, v.original_url,
        v.cover_url, v.video_url, v.duration, v.spend, v.roi, v.grade,
        v.platform, v.ad_name, v.publish_time, v.collected_at,
        v.interaction_updated_at, v.updated_at,
        (SELECT COUNT(*) FROM video_dissection vd
          WHERE BINARY TRIM(vd.original_video)=BINARY v.video_url AND vd.is_deleted=0) AS clip_count
       FROM scraped_videos v
       WHERE v.deleted_at IS NULL
         AND v.video_url IS NOT NULL AND v.video_url <> ''
         AND (UPPER(COALESCE(v.brand, ''))='WIS' OR UPPER(COALESCE(v.title, '')) LIKE '%WIS%')
       ORDER BY v.updated_at DESC, v.interaction_updated_at DESC, v.id DESC`
    );
    const items = rows.map(toPublicIndexedAsset);
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scope: {
        brand: "WIS",
        label: "WIS部门素材",
        note: "不含数据库账号、密码或其他连接密钥"
      },
      summary: {
        assets: items.length,
        performanceAssets: items.filter((item) => item.hasPerformance).length,
        clips: items.reduce((total, item) => total + Number(item.clipCount || 0), 0)
      },
      items
    };
    await fs.writeFile(outputPath, JSON.stringify(payload), "utf8");
    process.stdout.write(JSON.stringify({
      ok: true,
      outputPath,
      assets: payload.summary.assets,
      performanceAssets: payload.summary.performanceAssets,
      clips: payload.summary.clips,
      bytes: Buffer.byteLength(JSON.stringify(payload))
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});

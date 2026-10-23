const path = require("path");
const mysql = require("mysql2/promise");
const { readConfig } = require("./material-center");

const packageRoot = path.resolve(__dirname, "..", "..", "..");
const configPath = path.join(packageRoot, "config", "material-center-db.json");

async function main() {
  const config = await readConfig(configPath);
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectTimeout: 12000,
    charset: "utf8mb4"
  });
  try {
    const [summaryRows] = await connection.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN video_url IS NOT NULL AND video_url <> '' THEN 1 ELSE 0 END) AS withVideo,
         SUM(CASE WHEN cover_url IS NOT NULL AND cover_url <> '' THEN 1 ELSE 0 END) AS withCover,
         SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN advertiser_id IS NOT NULL AND advertiser_id <> '' THEN 1 ELSE 0 END) AS withAdvertiser,
         SUM(CASE WHEN material_id IS NOT NULL AND material_id <> '' THEN 1 ELSE 0 END) AS withMaterialId
       FROM scraped_videos`
    );
    const [sourceRows] = await connection.query(
      `SELECT COALESCE(NULLIF(source, ''), '(空)') AS name, COUNT(*) AS count
       FROM scraped_videos
       WHERE deleted_at IS NULL
       GROUP BY COALESCE(NULLIF(source, ''), '(空)')
       ORDER BY count DESC
       LIMIT 20`
    );
    const [brandRows] = await connection.query(
      `SELECT COALESCE(NULLIF(brand, ''), '(空)') AS name, COUNT(*) AS count
       FROM scraped_videos
       WHERE deleted_at IS NULL
       GROUP BY COALESCE(NULLIF(brand, ''), '(空)')
       ORDER BY count DESC
       LIMIT 30`
    );
    const [platformRows] = await connection.query(
      `SELECT COALESCE(NULLIF(platform, ''), '(空)') AS name, COUNT(*) AS count
       FROM scraped_videos
       WHERE deleted_at IS NULL
       GROUP BY COALESCE(NULLIF(platform, ''), '(空)')
       ORDER BY count DESC`
    );
    const [campaignRows] = await connection.query(
      `SELECT COALESCE(NULLIF(campaign_type, ''), '(空)') AS name, COUNT(*) AS count
       FROM scraped_videos
       WHERE deleted_at IS NULL
       GROUP BY COALESCE(NULLIF(campaign_type, ''), '(空)')
       ORDER BY count DESC
       LIMIT 20`
    );
    const [wisRows] = await connection.execute(
      `SELECT COUNT(*) AS count
       FROM scraped_videos
       WHERE deleted_at IS NULL
         AND (LOWER(COALESCE(brand, '')) LIKE ? OR LOWER(COALESCE(title, '')) LIKE ?)`,
      ["%wis%", "%wis%"]
    );
    const [performanceRows] = await connection.query(
      `SELECT
         SUM(CASE WHEN spend IS NOT NULL AND spend <> '' AND spend <> '0' THEN 1 ELSE 0 END) AS withSpend,
         SUM(CASE WHEN roi IS NOT NULL AND roi > 0 THEN 1 ELSE 0 END) AS withRoi,
         SUM(CASE WHEN grade IS NOT NULL AND grade <> '' THEN 1 ELSE 0 END) AS withGrade,
         SUM(CASE WHEN pay_order_count IS NOT NULL AND pay_order_count > 0 THEN 1 ELSE 0 END) AS withOrders
       FROM scraped_videos
       WHERE deleted_at IS NULL`
    );
    const [sampleRows] = await connection.query(
      `SELECT id, video_url AS videoUrl, cover_url AS coverUrl
       FROM scraped_videos
       WHERE deleted_at IS NULL
         AND video_url LIKE 'https://oss.fandow.com/%'
       ORDER BY updated_at DESC, id DESC
       LIMIT 3`
    );

    process.stdout.write(`${JSON.stringify({
      summary: summaryRows[0],
      activeBySource: sourceRows,
      activeByBrand: brandRows,
      activeByPlatform: platformRows,
      activeByCampaignType: campaignRows,
      performanceCoverage: performanceRows[0],
      wisMatches: Number(wisRows[0]?.count || 0),
      samples: sampleRows
    }, null, 2)}\n`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  process.stderr.write(`目录核对失败：${error.message}\n`);
  process.exit(1);
});

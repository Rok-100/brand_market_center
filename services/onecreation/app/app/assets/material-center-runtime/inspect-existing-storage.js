const path = require("path");
const mysql = require("mysql2/promise");
const { readConfig, TABLES } = require("./material-center");

const packageRoot = path.resolve(__dirname, "..", "..", "..");
const configPath = path.join(packageRoot, "config", "material-center-db.json");
const managedTables = new Set(Object.values(TABLES));

function isCandidateName(value) {
  return /(oss|object|bucket|video|media|material|asset|file|url|path|素材|视频)/i.test(String(value || ""));
}

function sanitizeHostSample(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      pathnamePrefix: parsed.pathname.split("/").slice(0, 3).join("/")
    };
  } catch (_) {
    const match = text.match(/([a-z0-9][a-z0-9.-]*\.oss-[a-z0-9-]+\.aliyuncs\.com)/i);
    return match ? { hostname: match[1], pathnamePrefix: null } : null;
  }
}

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
    const [tables] = await connection.execute(
      `SELECT table_name AS tableName, table_rows AS estimatedRows
       FROM information_schema.tables
       WHERE table_schema=?
       ORDER BY table_name`,
      [config.database]
    );
    const [columns] = await connection.execute(
      `SELECT table_name AS tableName, column_name AS columnName, data_type AS dataType
       FROM information_schema.columns
       WHERE table_schema=?
       ORDER BY table_name, ordinal_position`,
      [config.database]
    );

    const candidateColumns = columns.filter((item) =>
      !managedTables.has(item.tableName) &&
      (isCandidateName(item.tableName) || isCandidateName(item.columnName))
    );
    const candidateTables = [...new Set(candidateColumns.map((item) => item.tableName))];
    const samples = [];

    for (const tableName of candidateTables.slice(0, 30)) {
      const urlColumns = candidateColumns
        .filter((item) => item.tableName === tableName && /(oss|object|bucket|video|media|file|url|path)/i.test(item.columnName))
        .map((item) => item.columnName)
        .slice(0, 8);
      if (!urlColumns.length) continue;

      for (const columnName of urlColumns) {
        const safeTable = `\`${tableName.replace(/`/g, "``")}\``;
        const safeColumn = `\`${columnName.replace(/`/g, "``")}\``;
        const [rows] = await connection.query(
          `SELECT ${safeColumn} AS sampleValue
           FROM ${safeTable}
           WHERE ${safeColumn} IS NOT NULL AND ${safeColumn} <> ''
           LIMIT 10`
        );
        const hostSamples = rows.map((row) => sanitizeHostSample(row.sampleValue)).filter(Boolean);
        if (hostSamples.length) {
          samples.push({ tableName, columnName, samples: hostSamples.slice(0, 3) });
        }
      }
    }

    const output = {
      database: config.database,
      tableCount: tables.length,
      tables: tables.map((item) => ({
        tableName: item.tableName,
        estimatedRows: Number(item.estimatedRows || 0),
        managedByWorkbench: managedTables.has(item.tableName)
      })),
      candidateColumns,
      ossHostSamples: samples
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  process.stderr.write(`只读检查失败：${error.message}\n`);
  process.exit(1);
});

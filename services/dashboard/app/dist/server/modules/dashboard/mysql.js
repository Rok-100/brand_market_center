"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDirectMysqlConfigured = isDirectMysqlConfigured;
exports.assertReadOnlySql = assertReadOnlySql;
exports.directMysqlQueryTimeoutMs = directMysqlQueryTimeoutMs;
exports.buildDirectMysqlQueryOptions = buildDirectMysqlQueryOptions;
exports.executeDirectSql = executeDirectSql;
exports.closeDirectMysqlPool = closeDirectMysqlPool;
const promise_1 = require("mysql2/promise");
const runtime = globalThis;
const mysqlRuntime = runtime.__wisDashboardDirectMysqlRuntime ?? {};
runtime.__wisDashboardDirectMysqlRuntime = mysqlRuntime;
function parseJdbcAddress(jdbcUrl) {
    const value = jdbcUrl?.trim();
    if (!value)
        return null;
    try {
        const parsed = new URL(value.replace(/^jdbc:/i, ""));
        if (parsed.protocol !== "mysql:" || !parsed.hostname)
            return null;
        return {
            host: parsed.hostname,
            port: Number(parsed.port || 3306),
        };
    }
    catch {
        return null;
    }
}
function resolveDirectMysqlConfig() {
    const jdbcAddress = parseJdbcAddress(process.env.ROOT_MYSQL_JDBC_URL);
    const host = process.env.ROOT_MYSQL_HOST?.trim() || jdbcAddress?.host;
    const port = Number(process.env.ROOT_MYSQL_PORT || jdbcAddress?.port || 3306);
    const user = process.env.ROOT_MYSQL_USER?.trim();
    const password = process.env.ROOT_MYSQL_PASSWORD;
    if (!host || !user || password === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
    }
    return { host, port, user, password };
}
function isDirectMysqlConfigured() {
    return resolveDirectMysqlConfig() !== null;
}
function assertReadOnlySql(sql) {
    const normalized = sql
        .replace(/^\uFEFF/, "")
        .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|#[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/, "")
        .trimStart();
    // 看板查询只允许 SELECT/CTE/EXPLAIN，数据库账号本身也保持只读权限。
    if (!/^(?:SELECT|WITH|EXPLAIN)\b/i.test(normalized)) {
        throw new Error("数据库直连仅允许执行只读 SELECT、WITH 或 EXPLAIN 查询");
    }
}
function directMysqlQueryTimeoutMs() {
    const configured = Number(process.env.ROOT_MYSQL_QUERY_TIMEOUT_MS || 55_000);
    return Number.isFinite(configured)
        ? Math.min(80_000, Math.max(5_000, Math.floor(configured)))
        : 55_000;
}
function buildDirectMysqlQueryOptions(sql) {
    return { sql, timeout: directMysqlQueryTimeoutMs() };
}
function getDirectMysqlPool() {
    if (mysqlRuntime.pool)
        return mysqlRuntime.pool;
    const config = resolveDirectMysqlConfig();
    if (!config) {
        throw new Error("数据库直连环境变量未完整配置");
    }
    const configuredPoolSize = Number(process.env.ROOT_MYSQL_POOL_SIZE || 8);
    const connectionLimit = Number.isFinite(configuredPoolSize)
        ? Math.min(16, Math.max(1, Math.floor(configuredPoolSize)))
        : 8;
    mysqlRuntime.pool = (0, promise_1.createPool)({
        ...config,
        waitForConnections: true,
        connectionLimit,
        queueLimit: 0,
        connectTimeout: 10_000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        multipleStatements: false,
        timezone: "+08:00",
    });
    return mysqlRuntime.pool;
}
async function executeDirectSql(sql, limit = 500) {
    assertReadOnlySql(sql);
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 500;
    const pool = getDirectMysqlPool();
    const [rawRows] = await pool.query(buildDirectMysqlQueryOptions(sql));
    const allRows = rawRows;
    const rows = allRows.slice(0, normalizedLimit);
    return {
        rows,
        row_count: rows.length,
        truncated: allRows.length > rows.length,
    };
}
async function closeDirectMysqlPool() {
    const pool = mysqlRuntime.pool;
    mysqlRuntime.pool = undefined;
    if (pool)
        await pool.end();
}

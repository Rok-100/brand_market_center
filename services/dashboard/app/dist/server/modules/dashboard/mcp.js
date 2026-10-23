"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callMcpTool = callMcpTool;
exports.resetMcpSessionPoolForTest = resetMcpSessionPoolForTest;
exports.validateSql = validateSql;
exports.executeSql = executeSql;
exports.executeCockpitSql = executeCockpitSql;
const qianchuan_sql_1 = require("./qianchuan-sql");
const mysql_1 = require("./mysql");
const runtime = globalThis;
const wisRuntime = runtime.__wisDashboardMcpRuntime ?? {};
runtime.__wisDashboardMcpRuntime = wisRuntime;
const WIS_ACCOUNT_CACHE_MS = 60 * 60 * 1000;
const configuredPoolSize = Number(process.env.FANDOW_MCP_POOL_SIZE || 4);
const MCP_SESSION_POOL_SIZE = Number.isFinite(configuredPoolSize)
    ? Math.min(8, Math.max(1, Math.floor(configuredPoolSize)))
    : 4;
const mcpSessionPool = Array.from({ length: MCP_SESSION_POOL_SIZE }, (_, index) => ({ index, busy: false, initialized: false, sessionId: null }));
const mcpSessionWaiters = [];
let rpcId = 0;
function runtimeMcpUrl() {
    return process.env.FANDOW_MCP_URL || "https://cloud.fandow.com/gpt/ai-platform/mcp/data/";
}
function runtimeMcpToken() {
    const token = (process.env.FANDOM_DATA_MCP_TOKEN
        || process.env.FANDOW_DATA_MCP_TOKEN)?.trim();
    if (!token) {
        throw new Error("FANDOM_DATA_MCP_TOKEN 未配置，无法访问根数据服务");
    }
    return token;
}
function parseRpcBody(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return {};
    if (trimmed.startsWith("{"))
        return JSON.parse(trimmed);
    const dataLines = trimmed
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
    if (!dataLines.length)
        throw new Error("MCP 返回了无法识别的响应格式");
    return JSON.parse(dataLines.join("\n"));
}
async function rpcPost(payload, sessionId, timeoutMs = 35_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = {
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${runtimeMcpToken()}`,
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2025-03-26",
        };
        if (sessionId)
            headers["Mcp-Session-Id"] = sessionId;
        const response = await fetch(runtimeMcpUrl(), {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        const raw = await response.text();
        if (!response.ok)
            throw new Error(`MCP 请求失败（HTTP ${response.status}）：${raw.slice(0, 240)}`);
        return {
            envelope: parseRpcBody(raw),
            sessionId: response.headers.get("mcp-session-id") || sessionId,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
function isRetryableMcpFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    return error instanceof Error && error.name === "AbortError"
        || /公司身份服务请求超时|请求超时|timeout|timed out|ECONNRESET|ECONNREFUSED|HTTP 401|HTTP 404|HTTP 5\d\d|invalid session|session.*not found|temporarily unavailable/i.test(message);
}
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function nextRpcId() {
    rpcId += 1;
    return rpcId;
}
function acquireMcpSession() {
    const available = mcpSessionPool.find((slot) => !slot.busy);
    if (available) {
        available.busy = true;
        return Promise.resolve(available);
    }
    return new Promise((resolve) => mcpSessionWaiters.push(resolve));
}
function releaseMcpSession(slot) {
    const next = mcpSessionWaiters.shift();
    if (next) {
        next(slot);
        return;
    }
    slot.busy = false;
}
function invalidatesMcpSession(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /HTTP 401|HTTP 404|invalid session|session.*not found/i.test(message);
}
async function ensureMcpSession(slot, timeoutMs = 35_000) {
    if (slot.initialized)
        return slot.sessionId || undefined;
    const initialized = await rpcPost({
        jsonrpc: "2.0",
        id: nextRpcId(),
        method: "initialize",
        params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "wis-bi-dashboard", version: "1.0.0" },
        },
    }, undefined, timeoutMs);
    if (initialized.envelope.error) {
        throw new Error(`MCP 初始化错误：${initialized.envelope.error.message}`);
    }
    // 部分根数据网关以无状态模式工作，不返回 Mcp-Session-Id。
    // 此时仍允许后续 tools/call 不带会话头，保持与原有稳定调用方式兼容。
    slot.initialized = true;
    slot.sessionId = initialized.sessionId || null;
    return slot.sessionId || undefined;
}
async function callMcpTool(name, args, options = {}) {
    const maxAttempts = Math.min(3, Math.max(1, Math.floor(options.maxAttempts || 3)));
    const timeoutMs = Math.min(35_000, Math.max(5_000, Math.floor(options.timeoutMs || 35_000)));
    const slot = await acquireMcpSession();
    try {
        // 每个池槽同一时间只执行一个工具调用；会话失效时仅重建该槽，避免重复身份校验。
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                const sessionId = await ensureMcpSession(slot, timeoutMs);
                const called = await rpcPost({
                    jsonrpc: "2.0",
                    id: nextRpcId(),
                    method: "tools/call",
                    params: { name, arguments: args },
                }, sessionId, timeoutMs);
                if (called.envelope.error)
                    throw new Error(`MCP 工具错误：${called.envelope.error.message}`);
                const text = called.envelope.result?.content?.find((item) => item.type === "text")?.text;
                if (!text)
                    throw new Error(`MCP 工具 ${name} 未返回文本结果`);
                const parsed = JSON.parse(text);
                if (!parsed.ok)
                    throw new Error(parsed.error?.message || `MCP 工具 ${name} 执行失败`);
                return parsed.data;
            }
            catch (error) {
                if (invalidatesMcpSession(error)) {
                    slot.initialized = false;
                    slot.sessionId = null;
                }
                if (!isRetryableMcpFailure(error) || attempt === maxAttempts - 1) {
                    throw error;
                }
                const delayMs = 500 * 2 ** attempt;
                console.warn(`[MCP pool:${slot.index}] ${name} failed on attempt ${attempt + 1}; retrying in ${delayMs}ms`, error);
                await wait(delayMs);
            }
        }
        throw new Error(`MCP 工具 ${name} 执行失败`);
    }
    finally {
        releaseMcpSession(slot);
    }
}
function resetMcpSessionPoolForTest() {
    if (process.env.NODE_ENV !== "test")
        return;
    mcpSessionPool.forEach((slot) => {
        slot.busy = false;
        slot.initialized = false;
        slot.sessionId = null;
    });
    mcpSessionWaiters.splice(0);
    rpcId = 0;
    wisRuntime.wisAdvertiserIds = undefined;
    wisRuntime.wisAdvertiserIdsPromise = undefined;
}
function configuredWisAdvertiserIds() {
    const configured = process.env.WIS_QIANCHUAN_ADVERTISER_IDS;
    if (!configured)
        return [];
    return [...new Set(configured.split(",").map((value) => value.trim()).filter((value) => /^\d+$/.test(value)))];
}
async function resolveWisAdvertiserIds() {
    const configured = configuredWisAdvertiserIds();
    if (configured.length)
        return configured;
    const now = Date.now();
    if (wisRuntime.wisAdvertiserIds && wisRuntime.wisAdvertiserIds.expiresAt > now) {
        return wisRuntime.wisAdvertiserIds.ids;
    }
    if (wisRuntime.wisAdvertiserIdsPromise)
        return wisRuntime.wisAdvertiserIdsPromise;
    const queryAccounts = (sql) => (0, mysql_1.isDirectMysqlConfigured)()
        ? (0, mysql_1.executeDirectSql)(sql, 1000)
        : callMcpTool("execute_sql", { sql, limit: 1000 });
    // 部门库仅同步品牌营销账户，最近两天可直接利用时间索引取账户 ID，避免名称模糊匹配。
    // 历史回退仅排除迁移初期的空名称占位记录，不再执行 LIKE '%WIS%'。
    const recentAccountSql = `SELECT DISTINCT advertiser_id
FROM ${qianchuan_sql_1.ACCOUNT_HOURLY_TABLE} FORCE INDEX (idx_qc_account_hourly_time)
WHERE stat_time >= DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 2 DAY)`;
    const historicalAccountSql = `SELECT DISTINCT advertiser_id
FROM ${qianchuan_sql_1.ACCOUNT_HOURLY_TABLE}
WHERE advertiser_name IS NOT NULL`;
    wisRuntime.wisAdvertiserIdsPromise = queryAccounts(recentAccountSql).then(async (result) => {
        const resolved = result.rows.length ? result : await queryAccounts(historicalAccountSql);
        const ids = [...new Set(resolved.rows.map((row) => String(row.advertiser_id)).filter((value) => /^\d+$/.test(value)))];
        if (!ids.length)
            throw new Error("未解析到 WIS 千川账户，已停止执行广告查询");
        wisRuntime.wisAdvertiserIds = { ids, expiresAt: Date.now() + WIS_ACCOUNT_CACHE_MS };
        return ids;
    }).finally(() => {
        wisRuntime.wisAdvertiserIdsPromise = undefined;
    });
    return wisRuntime.wisAdvertiserIdsPromise;
}
async function prepareSql(sql) {
    if (!sql.includes(qianchuan_sql_1.WIS_ADVERTISER_IDS_SQL_TOKEN))
        return sql;
    const ids = await resolveWisAdvertiserIds();
    const idList = ids.map((id) => `'${id}'`).join(",");
    return sql.replaceAll(qianchuan_sql_1.WIS_ADVERTISER_IDS_SQL_TOKEN, idList);
}
async function validateSql(sql) {
    const preparedSql = await prepareSql(sql);
    return callMcpTool("validate_sql", {
        sql: preparedSql,
        check_syntax: true,
    });
}
async function executeSql(sql, limit = 500) {
    const preparedSql = await prepareSql(sql);
    return callMcpTool("execute_sql", { sql: preparedSql, limit });
}
/** 仅经营驾驶舱使用直连，避免数据库账号权限范围影响其他 MCP 数据模块。 */
async function executeCockpitSql(sql, limit = 500) {
    const preparedSql = await prepareSql(sql);
    if ((0, mysql_1.isDirectMysqlConfigured)()) {
        return (0, mysql_1.executeDirectSql)(preparedSql, limit);
    }
    return callMcpTool("execute_sql", { sql: preparedSql, limit }, { maxAttempts: 2, timeoutMs: 25_000 });
}

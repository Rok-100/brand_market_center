"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readCache = readCache;
exports.readCacheAllowStale = readCacheAllowStale;
exports.writeCache = writeCache;
exports.readApprovedSql = readApprovedSql;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const runtime = globalThis;
const values = runtime.__wisDashboardCache ?? new Map();
runtime.__wisDashboardCache = values;
function persistentCachePath(key) {
    const directory = process.env.DASHBOARD_CACHE_DIR?.trim();
    if (!directory)
        return null;
    const name = (0, crypto_1.createHash)('sha256').update(key).digest('hex');
    return { directory, path: (0, path_1.join)(directory, `${name}.json`) };
}
function validEntry(value) {
    if (!value || typeof value !== 'object')
        return false;
    const entry = value;
    return typeof entry.source === 'string'
        && typeof entry.expiresAt === 'number'
        && Number.isFinite(entry.expiresAt)
        && 'payload' in entry;
}
async function readCache(key) {
    const entry = values.get(key);
    if (entry?.expiresAt && entry.expiresAt > Date.now()) {
        return { payload: entry.payload, source: entry.source };
    }
    if (entry) {
        values.delete(key);
    }
    const persistent = persistentCachePath(key);
    if (!persistent)
        return null;
    try {
        const diskEntry = JSON.parse(await (0, promises_1.readFile)(persistent.path, 'utf8'));
        if (!validEntry(diskEntry) || diskEntry.expiresAt <= Date.now())
            return null;
        values.set(key, diskEntry);
        return { payload: diskEntry.payload, source: diskEntry.source };
    }
    catch {
        return null;
    }
}
async function readCacheAllowStale(key, staleWindowMs) {
    const now = Date.now();
    const staleUntil = (expiresAt) => expiresAt + Math.max(0, staleWindowMs);
    const entry = values.get(key);
    if (entry?.expiresAt && staleUntil(entry.expiresAt) > now) {
        return {
            payload: entry.payload,
            source: entry.source,
            stale: entry.expiresAt <= now,
            expiresAt: entry.expiresAt,
        };
    }
    if (entry)
        values.delete(key);
    const persistent = persistentCachePath(key);
    if (!persistent)
        return null;
    try {
        const diskEntry = JSON.parse(await (0, promises_1.readFile)(persistent.path, 'utf8'));
        if (!validEntry(diskEntry) || staleUntil(diskEntry.expiresAt) <= now)
            return null;
        values.set(key, diskEntry);
        return {
            payload: diskEntry.payload,
            source: diskEntry.source,
            stale: diskEntry.expiresAt <= now,
            expiresAt: diskEntry.expiresAt,
        };
    }
    catch {
        return null;
    }
}
async function writeCache(key, payload, expiresAt, source = 'mcp') {
    const entry = { payload, source, expiresAt: new Date(expiresAt).getTime() };
    values.set(key, entry);
    const persistent = persistentCachePath(key);
    if (!persistent || !Number.isFinite(entry.expiresAt))
        return;
    try {
        await (0, promises_1.mkdir)(persistent.directory, { recursive: true });
        const temporaryPath = `${persistent.path}.${process.pid}.${Date.now()}.tmp`;
        await (0, promises_1.writeFile)(temporaryPath, JSON.stringify(entry), 'utf8');
        await (0, promises_1.rename)(temporaryPath, persistent.path);
    }
    catch {
        // 持久缓存不可用时只影响跨容器复用；内存缓存仍保持可用，不能中断业务请求。
    }
}
async function readApprovedSql(_metricKey) {
    return null;
}

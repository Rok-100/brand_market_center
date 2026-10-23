"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OmnichannelController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const omnichannel_service_1 = require("./omnichannel.service");
const cache_1 = require("../dashboard/cache");
const OVERVIEW_FRESH_TTL_MS = 60_000;
const OVERVIEW_STALE_TTL_MS = 10 * 60_000;
const OVERVIEW_PERSIST_TTL_MS = 24 * 60 * 60_000;
const OVERVIEW_CACHE_VERSION = "v1";
const REALTIME_PERSIST_KEY = "omnichannel:realtime-comparison:v1";
const REALTIME_FRESH_TTL_MS = 60_000;
const REALTIME_STALE_WINDOW_MS = 24 * 60 * 60_000;
let OmnichannelController = class OmnichannelController {
    omnichannelService;
    overviewCache = new Map();
    overviewInFlight = new Map();
    realtimeCache = null;
    realtimeInFlight = null;
    constructor(omnichannelService) {
        this.omnichannelService = omnichannelService;
    }
    deliver(value, deliveryState) {
        return { ...value, deliveryState };
    }
    persistentKey(cacheKey) {
        return `omnichannel:overview:${OVERVIEW_CACHE_VERSION}:${cacheKey}`;
    }
    async persistOverview(cacheKey, value) {
        if (!process.env.DASHBOARD_CACHE_DIR?.trim())
            return;
        await (0, cache_1.writeCache)(this.persistentKey(cacheKey), value, new Date(Date.now() + OVERVIEW_PERSIST_TTL_MS).toISOString(), "verified-root-data");
    }
    refreshOverview(cacheKey, startDate, endDate) {
        const running = this.overviewInFlight.get(cacheKey);
        if (running)
            return running;
        const request = this.omnichannelService.getOverview(startDate, endDate)
            .then(async (value) => {
            if (this.overviewCache.size >= 30) {
                const oldestKey = this.overviewCache.keys().next().value;
                if (oldestKey)
                    this.overviewCache.delete(oldestKey);
            }
            const now = Date.now();
            this.overviewCache.set(cacheKey, {
                freshUntil: now + OVERVIEW_FRESH_TTL_MS,
                staleUntil: now + OVERVIEW_STALE_TTL_MS,
                value,
            });
            await this.persistOverview(cacheKey, value);
            return value;
        })
            .finally(() => {
            if (this.overviewInFlight.get(cacheKey) === request) {
                this.overviewInFlight.delete(cacheKey);
            }
        });
        this.overviewInFlight.set(cacheKey, request);
        return request;
    }
    refreshRealtime() {
        if (this.realtimeInFlight)
            return this.realtimeInFlight;
        const request = this.omnichannelService.getRealtimeComparison()
            .then(async (value) => {
            const expiresAt = Date.now() + REALTIME_FRESH_TTL_MS;
            this.realtimeCache = { expiresAt, value };
            await (0, cache_1.writeCache)(REALTIME_PERSIST_KEY, value, new Date(expiresAt).toISOString(), "verified-root-data");
            return value;
        })
            .finally(() => {
            if (this.realtimeInFlight === request)
                this.realtimeInFlight = null;
        });
        this.realtimeInFlight = request;
        return request;
    }
    async overview(startDate, endDate, force) {
        const cacheKey = `${startDate || "default"}:${endDate || "default"}`;
        const now = Date.now();
        let cached = this.overviewCache.get(cacheKey);
        if (force !== "1" && !cached && process.env.DASHBOARD_CACHE_DIR?.trim()) {
            const persisted = await (0, cache_1.readCache)(this.persistentKey(cacheKey));
            if (persisted) {
                cached = {
                    freshUntil: 0,
                    staleUntil: now + OVERVIEW_STALE_TTL_MS,
                    value: persisted.payload,
                };
                this.overviewCache.set(cacheKey, cached);
            }
        }
        if (force !== "1" && cached?.freshUntil && cached.freshUntil > now) {
            return this.deliver(cached.value, "fresh-cache");
        }
        if (force !== "1" && cached?.staleUntil && cached.staleUntil > now) {
            // 先返回最近一次成功值；同一区间只启动一个后台校准，避免用户等待根数据慢查询。
            void this.refreshOverview(cacheKey, startDate, endDate).catch(() => undefined);
            return this.deliver(cached.value, "stale-cache");
        }
        if (cached)
            this.overviewCache.delete(cacheKey);
        if (force === "1") {
            const value = await this.omnichannelService.getOverview(startDate, endDate);
            const refreshedAt = Date.now();
            this.overviewCache.set(cacheKey, {
                freshUntil: refreshedAt + OVERVIEW_FRESH_TTL_MS,
                staleUntil: refreshedAt + OVERVIEW_STALE_TTL_MS,
                value,
            });
            await this.persistOverview(cacheKey, value);
            return this.deliver(value, "live");
        }
        const value = await this.refreshOverview(cacheKey, startDate, endDate);
        return this.deliver(value, "live");
    }
    async trend(startDate, endDate, granularity) {
        return this.omnichannelService.getTrend(startDate, endDate, granularity);
    }
    async realtimeComparison(force) {
        const now = Date.now();
        if (force === "1")
            return this.refreshRealtime();
        if (this.realtimeCache) {
            if (this.realtimeCache.expiresAt <= now) {
                void this.refreshRealtime().catch(() => undefined);
            }
            return this.realtimeCache.value;
        }
        const persisted = await (0, cache_1.readCacheAllowStale)(REALTIME_PERSIST_KEY, REALTIME_STALE_WINDOW_MS);
        if (persisted) {
            this.realtimeCache = {
                expiresAt: persisted.stale ? 0 : persisted.expiresAt,
                value: persisted.payload,
            };
            if (persisted.stale)
                void this.refreshRealtime().catch(() => undefined);
            return persisted.payload;
        }
        return this.refreshRealtime();
    }
};
exports.OmnichannelController = OmnichannelController;
tslib_1.__decorate([
    (0, common_1.Get)("overview"),
    (0, common_1.Header)("Cache-Control", "no-store"),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)("startDate")),
    tslib_1.__param(1, (0, common_1.Query)("endDate")),
    tslib_1.__param(2, (0, common_1.Query)("force")),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], OmnichannelController.prototype, "overview", null);
tslib_1.__decorate([
    (0, common_1.Get)("trend"),
    (0, common_1.Header)("Cache-Control", "no-store"),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)("startDate")),
    tslib_1.__param(1, (0, common_1.Query)("endDate")),
    tslib_1.__param(2, (0, common_1.Query)("granularity")),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], OmnichannelController.prototype, "trend", null);
tslib_1.__decorate([
    (0, common_1.Get)("realtime-comparison"),
    (0, common_1.Header)("Cache-Control", "no-store"),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)("force")),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], OmnichannelController.prototype, "realtimeComparison", null);
exports.OmnichannelController = OmnichannelController = tslib_1.__decorate([
    (0, common_1.Controller)("api/omnichannel"),
    tslib_1.__metadata("design:paramtypes", [omnichannel_service_1.OmnichannelService])
], OmnichannelController);

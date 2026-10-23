"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatDashboardController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const dashboard_service_1 = require("./dashboard.service");
const cache_1 = require("../dashboard/cache");
const OVERVIEW_FRESH_MS = 60_000;
const OVERVIEW_STALE_MS = 10 * 60_000;
const OVERVIEW_PERSIST_MS = 24 * 60 * 60_000;
const OVERVIEW_PERSIST_KEY = 'wechat:dashboard:overview:v1';
let overviewCache = null;
let overviewInFlight = null;
const productTrendCache = new Map();
const productTrendInFlight = new Map();
let WechatDashboardController = class WechatDashboardController {
    dashboardService;
    constructor(dashboardService) {
        this.dashboardService = dashboardService;
    }
    refreshOverview() {
        if (overviewInFlight)
            return overviewInFlight;
        overviewInFlight = this.dashboardService.getOverview()
            .then(async (value) => {
            overviewCache = { value, refreshedAt: Date.now() };
            if (process.env.DASHBOARD_CACHE_DIR?.trim()) {
                await (0, cache_1.writeCache)(OVERVIEW_PERSIST_KEY, value, new Date(Date.now() + OVERVIEW_PERSIST_MS).toISOString(), 'verified-root-data');
            }
            return value;
        })
            .finally(() => {
            overviewInFlight = null;
        });
        return overviewInFlight;
    }
    async getOverview(force) {
        if (force !== '1' && !overviewCache && process.env.DASHBOARD_CACHE_DIR?.trim()) {
            const persisted = await (0, cache_1.readCache)(OVERVIEW_PERSIST_KEY);
            if (persisted) {
                overviewCache = {
                    value: persisted.payload,
                    refreshedAt: Date.now() - OVERVIEW_FRESH_MS,
                };
                // 首屏立即使用最近一次完整快照，同时在后台校准根数据。
                void this.refreshOverview().catch(() => undefined);
                return overviewCache.value;
            }
        }
        const age = overviewCache ? Date.now() - overviewCache.refreshedAt : Number.POSITIVE_INFINITY;
        if (force !== '1' && overviewCache && age < OVERVIEW_FRESH_MS)
            return overviewCache.value;
        if (force !== '1' && overviewCache && age < OVERVIEW_STALE_MS) {
            void this.refreshOverview().catch(() => undefined);
            return overviewCache.value;
        }
        return this.refreshOverview();
    }
    async getMetrics() {
        return this.dashboardService.getMetrics();
    }
    async getHeadlineMetrics() {
        return this.dashboardService.getHeadlineMetrics();
    }
    async getPerformanceMetrics() {
        return this.dashboardService.getPerformanceMetrics();
    }
    async getDailyGsv(startDate, endDate) {
        return this.dashboardService.getDailyGsv(startDate, endDate);
    }
    async getDailyAdq(startDate, endDate) {
        return this.dashboardService.getDailyAdq(startDate, endDate);
    }
    async getAdqMetrics() {
        return this.dashboardService.getAdqMetrics();
    }
    async getProductTrends(startDate, endDate, force) {
        const key = `${startDate || ''}:${endDate || ''}`;
        const cached = productTrendCache.get(key);
        if (force !== '1' && cached && Date.now() - cached.refreshedAt < 2 * 60_000) {
            return cached.value;
        }
        const running = productTrendInFlight.get(key);
        if (force !== '1' && running)
            return running;
        const request = this.dashboardService.getProductTrends(startDate, endDate)
            .then((value) => {
            productTrendCache.set(key, { value, refreshedAt: Date.now() });
            return value;
        })
            .finally(() => productTrendInFlight.delete(key));
        productTrendInFlight.set(key, request);
        return request;
    }
};
exports.WechatDashboardController = WechatDashboardController;
tslib_1.__decorate([
    (0, common_1.Get)('overview'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('force')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], WechatDashboardController.prototype, "getOverview", null);
tslib_1.__decorate([
    (0, common_1.Get)('metrics'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], WechatDashboardController.prototype, "getMetrics", null);
tslib_1.__decorate([
    (0, common_1.Get)('headline-metrics'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], WechatDashboardController.prototype, "getHeadlineMetrics", null);
tslib_1.__decorate([
    (0, common_1.Get)('performance-metrics'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], WechatDashboardController.prototype, "getPerformanceMetrics", null);
tslib_1.__decorate([
    (0, common_1.Get)('daily-gsv'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], WechatDashboardController.prototype, "getDailyGsv", null);
tslib_1.__decorate([
    (0, common_1.Get)('daily-adq'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], WechatDashboardController.prototype, "getDailyAdq", null);
tslib_1.__decorate([
    (0, common_1.Get)('adq-metrics'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], WechatDashboardController.prototype, "getAdqMetrics", null);
tslib_1.__decorate([
    (0, common_1.Get)('product-trends'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__param(2, (0, common_1.Query)('force')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], WechatDashboardController.prototype, "getProductTrends", null);
exports.WechatDashboardController = WechatDashboardController = tslib_1.__decorate([
    (0, common_1.Controller)('api/wechat/dashboard'),
    tslib_1.__metadata("design:paramtypes", [dashboard_service_1.WechatDashboardService])
], WechatDashboardController);

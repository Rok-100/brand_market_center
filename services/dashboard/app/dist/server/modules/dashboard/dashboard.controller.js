"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const dashboard_service_1 = require("./dashboard.service");
const cockpit_service_1 = require("./cockpit.service");
function sessionIdentity(req) {
    const context = (req.userContext || {});
    const profile = context.userProfile && typeof context.userProfile === 'object'
        ? context.userProfile
        : {};
    const title = context.jobTitle || context.job_title || context.title || profile.jobTitle || profile.job_title || profile.title;
    const name = context.userName || context.user_name || context.name || profile.name || profile.displayName || profile.display_name;
    return {
        userId: context.userId ? String(context.userId) : undefined,
        authority: context.userType,
        highestBusinessAccess: context.highestBusinessAccess === true,
        userName: typeof name === 'string' ? name : null,
        jobTitle: typeof title === 'string' ? title : null,
        roles: Array.isArray(context.roles) ? context.roles : [],
    };
}
function isCandidatePrewarm(req) {
    return process.env.DASHBOARD_PREWARM_MODE === 'true'
        && process.env.COMPANY_OA_AUTH_ENABLED !== 'true'
        && req.header('x-dashboard-prewarm') === '1';
}
let DashboardController = class DashboardController {
    async get(force) {
        return (0, dashboard_service_1.getDashboard)(force === '1');
    }
    async cockpit(req, force, prewarmProfile) {
        const candidatePrewarm = isCandidatePrewarm(req);
        const identity = candidatePrewarm
            ? prewarmProfile === 'basic'
                ? { userId: 'candidate-prewarm-basic', userName: '发布预热', jobTitle: '专员', roles: [] }
                : { userId: 'candidate-prewarm-director', userName: '发布预热', jobTitle: '总监', roles: [] }
            : sessionIdentity(req);
        if (!identity.userId)
            throw new common_1.UnauthorizedException('请使用企业飞书账号登录');
        return (0, cockpit_service_1.getCockpit)(identity, force === '1');
    }
    session(req) {
        const identity = sessionIdentity(req);
        if (!identity.userId)
            throw new common_1.UnauthorizedException('请使用企业飞书账号登录');
        // 身份接口只负责快速返回页面壳，避免冷启动时提前触发整套经营查询并与趋势图争抢连接。
        return (0, cockpit_service_1.resolveSession)(identity);
    }
    async operatingTrend(startDate, endDate, force) {
        return (0, cockpit_service_1.getOperatingTrend)(startDate, endDate, force === '1');
    }
    async productTrend(startDate, endDate, force) {
        return (0, cockpit_service_1.getProductTrend)(startDate, endDate, force === '1');
    }
    async productEconomics(startDate, endDate, force) {
        return (0, cockpit_service_1.getProductEconomics)(startDate, endDate, force === '1');
    }
    async promotionSceneTrend(scene, startDate, endDate, force) {
        return (0, cockpit_service_1.getPromotionSceneTrend)(scene, startDate, endDate, force === '1');
    }
    async materialOnlineTrend(startDate, endDate) {
        return (0, cockpit_service_1.getMaterialOnlineTrend)(startDate, endDate);
    }
    async materials(req, startDate, endDate, force) {
        const identity = sessionIdentity(req);
        if (!identity.userId && !isCandidatePrewarm(req)) {
            throw new common_1.UnauthorizedException('请使用企业飞书账号登录');
        }
        return (0, cockpit_service_1.getMaterialSnapshot)(startDate, endDate, force === '1');
    }
};
exports.DashboardController = DashboardController;
tslib_1.__decorate([
    (0, common_1.Get)(),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('force')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], DashboardController.prototype, "get", null);
tslib_1.__decorate([
    (0, common_1.Get)('cockpit'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('force')),
    tslib_1.__param(2, (0, common_1.Query)('prewarmProfile')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DashboardController.prototype, "cockpit", null);
tslib_1.__decorate([
    (0, common_1.Get)('session'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", void 0)
], DashboardController.prototype, "session", null);
tslib_1.__decorate([
    (0, common_1.Get)('operating-trend'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__param(2, (0, common_1.Query)('force')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DashboardController.prototype, "operatingTrend", null);
tslib_1.__decorate([
    (0, common_1.Get)('product-trend'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__param(2, (0, common_1.Query)('force')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DashboardController.prototype, "productTrend", null);
tslib_1.__decorate([
    (0, common_1.Get)('product-economics'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__param(2, (0, common_1.Query)('force')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DashboardController.prototype, "productEconomics", null);
tslib_1.__decorate([
    (0, common_1.Get)('promotion-scene-trend'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('scene')),
    tslib_1.__param(1, (0, common_1.Query)('startDate')),
    tslib_1.__param(2, (0, common_1.Query)('endDate')),
    tslib_1.__param(3, (0, common_1.Query)('force')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DashboardController.prototype, "promotionSceneTrend", null);
tslib_1.__decorate([
    (0, common_1.Get)('material-online-trend'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DashboardController.prototype, "materialOnlineTrend", null);
tslib_1.__decorate([
    (0, common_1.Get)('materials'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('startDate')),
    tslib_1.__param(2, (0, common_1.Query)('endDate')),
    tslib_1.__param(3, (0, common_1.Query)('force')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DashboardController.prototype, "materials", null);
exports.DashboardController = DashboardController = tslib_1.__decorate([
    (0, common_1.Controller)('api/dashboard')
], DashboardController);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatAuthGuard = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const cockpit_service_1 = require("../dashboard/cockpit.service");
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
let WechatAuthGuard = class WechatAuthGuard {
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const requestPath = request.originalUrl || request.path;
        if (!requestPath.includes('/api/wechat'))
            return true;
        const prewarmHeader = request.headers['x-dashboard-prewarm'];
        const prewarmValue = Array.isArray(prewarmHeader) ? prewarmHeader[0] : prewarmHeader;
        const isCandidatePrewarm = /^(1|true|yes|on)$/i.test(process.env.DASHBOARD_PREWARM_MODE || '')
            && !/^(1|true|yes|on)$/i.test(process.env.COMPANY_OA_AUTH_ENABLED || '')
            && prewarmValue === '1';
        if (request.method.toUpperCase() === 'GET' && isCandidatePrewarm)
            return true;
        const identity = sessionIdentity(request);
        if (!identity.userId)
            throw new common_1.UnauthorizedException('请使用企业飞书账号登录');
        const method = request.method.toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')
            return true;
        const session = (0, cockpit_service_1.resolveSession)(identity);
        if (session.role !== 'senior_manager' && session.role !== 'director') {
            throw new common_1.ForbiddenException('仅高级经理及总监可维护视频号数据');
        }
        return true;
    }
};
exports.WechatAuthGuard = WechatAuthGuard;
exports.WechatAuthGuard = WechatAuthGuard = tslib_1.__decorate([
    (0, common_1.Injectable)()
], WechatAuthGuard);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectorBriefingController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const cockpit_service_1 = require("../dashboard/cockpit.service");
const director_briefing_service_1 = require("./director-briefing.service");
function identityFromRequest(req) {
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
function validateDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new common_1.BadRequestException('日期格式必须为 YYYY-MM-DD');
    return value;
}
function validateImageType(value) {
    if (!/^[a-z0-9_-]{1,64}$/i.test(value))
        throw new common_1.BadRequestException('图片类型参数无效');
    return value;
}
function validateSummaryType(value) {
    if (value !== 'morning_report' && value !== 'transcript') {
        throw new common_1.BadRequestException('总结类型参数无效');
    }
    return value;
}
let DirectorBriefingController = class DirectorBriefingController {
    directorBriefingService;
    constructor(directorBriefingService) {
        this.directorBriefingService = directorBriefingService;
    }
    authorizeView(req) {
        const identity = identityFromRequest(req);
        if (!identity.userId)
            throw new common_1.UnauthorizedException('请使用企业飞书账号登录');
        if (!(0, cockpit_service_1.resolveSession)(identity).canViewDirectorBriefing) {
            throw new common_1.ForbiddenException('该页面仅向赵佳乐及已授权成员开放');
        }
        return identity;
    }
    authorizeEdit(req) {
        const identity = this.authorizeView(req);
        if (!(0, cockpit_service_1.resolveSession)(identity).canEditDirectorBriefing) {
            throw new common_1.ForbiddenException('仅赵佳乐总监可编辑手写内容');
        }
        return identity;
    }
    async getDailyKeyWork(req, date) {
        this.authorizeView(req);
        return this.directorBriefingService.getDailyKeyWork(validateDate(date));
    }
    async getOperatingImages(req, date) {
        this.authorizeView(req);
        return this.directorBriefingService.getOperatingImages(date ? validateDate(date) : undefined);
    }
    async getCalendarDay(req, date) {
        this.authorizeView(req);
        return this.directorBriefingService.getCalendarDay(validateDate(date));
    }
    async getInsights(req, date) {
        this.authorizeView(req);
        return this.directorBriefingService.getInsights(validateDate(date));
    }
    async getOperatingImageMedia(req, res, date, imageType) {
        this.authorizeView(req);
        const media = await this.directorBriefingService.getOperatingImageMedia(validateDate(String(date || '')), validateImageType(String(imageType || '')));
        if (!media)
            throw new common_1.NotFoundException('日报图片尚未同步');
        res.setHeader('Content-Type', media.contentType);
        res.setHeader('Content-Length', String(media.buffer.length));
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(media.buffer);
    }
    async saveDailyKeyWork(req, body) {
        const identity = this.authorizeEdit(req);
        const date = validateDate(String(body?.date || ''));
        const content = String(body?.content || '').trim();
        if (content.length > 5000)
            throw new common_1.BadRequestException('关键工作最多5000字');
        return this.directorBriefingService.saveDailyKeyWork(date, content, identity.userId);
    }
    async getDailySummaries(req, date) {
        this.authorizeView(req);
        return this.directorBriefingService.getDailySummaries(validateDate(date));
    }
    async saveDailySummary(req, body) {
        const identity = this.authorizeEdit(req);
        const date = validateDate(String(body?.date || ''));
        const summaryType = validateSummaryType(String(body?.summaryType || ''));
        const content = String(body?.content || '').trim();
        if (content.length > 500)
            throw new common_1.BadRequestException('总结最多500字');
        return this.directorBriefingService.saveDailySummary(date, summaryType, content, identity.userId);
    }
};
exports.DirectorBriefingController = DirectorBriefingController;
tslib_1.__decorate([
    (0, common_1.Get)('daily-key-work'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('date')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DirectorBriefingController.prototype, "getDailyKeyWork", null);
tslib_1.__decorate([
    (0, common_1.Get)('operating-images'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('date')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DirectorBriefingController.prototype, "getOperatingImages", null);
tslib_1.__decorate([
    (0, common_1.Get)('calendar'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('date')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DirectorBriefingController.prototype, "getCalendarDay", null);
tslib_1.__decorate([
    (0, common_1.Get)('insights'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('date')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DirectorBriefingController.prototype, "getInsights", null);
tslib_1.__decorate([
    (0, common_1.Get)('operating-images/media'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Res)()),
    tslib_1.__param(2, (0, common_1.Query)('date')),
    tslib_1.__param(3, (0, common_1.Query)('type')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DirectorBriefingController.prototype, "getOperatingImageMedia", null);
tslib_1.__decorate([
    (0, common_1.Put)('daily-key-work'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], DirectorBriefingController.prototype, "saveDailyKeyWork", null);
tslib_1.__decorate([
    (0, common_1.Get)('daily-summaries'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('date')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DirectorBriefingController.prototype, "getDailySummaries", null);
tslib_1.__decorate([
    (0, common_1.Put)('daily-summary'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], DirectorBriefingController.prototype, "saveDailySummary", null);
exports.DirectorBriefingController = DirectorBriefingController = tslib_1.__decorate([
    (0, common_1.Controller)('api/director/briefing'),
    tslib_1.__metadata("design:paramtypes", [director_briefing_service_1.DirectorBriefingService])
], DirectorBriefingController);

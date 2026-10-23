"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiVideoCreditsController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const ai_video_credits_service_1 = require("./ai-video-credits.service");
let AiVideoCreditsController = class AiVideoCreditsController {
    aiVideoCreditsService;
    constructor(aiVideoCreditsService) {
        this.aiVideoCreditsService = aiVideoCreditsService;
    }
    async overview(refresh) {
        return this.aiVideoCreditsService.getOverview(refresh === '1');
    }
};
exports.AiVideoCreditsController = AiVideoCreditsController;
tslib_1.__decorate([
    (0, common_1.Get)('overview'),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('refresh')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], AiVideoCreditsController.prototype, "overview", null);
exports.AiVideoCreditsController = AiVideoCreditsController = tslib_1.__decorate([
    (0, common_1.Controller)('api/ai-video-credits'),
    tslib_1.__metadata("design:paramtypes", [ai_video_credits_service_1.AiVideoCreditsService])
], AiVideoCreditsController);

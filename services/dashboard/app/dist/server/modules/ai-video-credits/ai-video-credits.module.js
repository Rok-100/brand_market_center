"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiVideoCreditsModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const ai_video_credits_controller_1 = require("./ai-video-credits.controller");
const ai_video_credits_service_1 = require("./ai-video-credits.service");
const ai_video_credits_store_1 = require("./ai-video-credits.store");
let AiVideoCreditsModule = class AiVideoCreditsModule {
};
exports.AiVideoCreditsModule = AiVideoCreditsModule;
exports.AiVideoCreditsModule = AiVideoCreditsModule = tslib_1.__decorate([
    (0, common_1.Module)({
        controllers: [ai_video_credits_controller_1.AiVideoCreditsController],
        providers: [ai_video_credits_service_1.AiVideoCreditsService, ai_video_credits_store_1.AiVideoCreditsStore],
    })
], AiVideoCreditsModule);

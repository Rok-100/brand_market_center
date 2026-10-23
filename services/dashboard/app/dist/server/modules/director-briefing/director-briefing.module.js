"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectorBriefingModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const director_briefing_controller_1 = require("./director-briefing.controller");
const director_briefing_service_1 = require("./director-briefing.service");
let DirectorBriefingModule = class DirectorBriefingModule {
};
exports.DirectorBriefingModule = DirectorBriefingModule;
exports.DirectorBriefingModule = DirectorBriefingModule = tslib_1.__decorate([
    (0, common_1.Module)({
        controllers: [director_briefing_controller_1.DirectorBriefingController],
        providers: [director_briefing_service_1.DirectorBriefingService],
        exports: [director_briefing_service_1.DirectorBriefingService],
    })
], DirectorBriefingModule);

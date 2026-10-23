"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceReasonModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const director_briefing_module_1 = require("../director-briefing/director-briefing.module");
const performance_reason_controller_1 = require("./performance-reason.controller");
const performance_reason_service_1 = require("./performance-reason.service");
let PerformanceReasonModule = class PerformanceReasonModule {
};
exports.PerformanceReasonModule = PerformanceReasonModule;
exports.PerformanceReasonModule = PerformanceReasonModule = tslib_1.__decorate([
    (0, common_1.Module)({
        imports: [director_briefing_module_1.DirectorBriefingModule],
        controllers: [performance_reason_controller_1.PerformanceReasonController],
        providers: [performance_reason_service_1.PerformanceReasonService],
        exports: [performance_reason_service_1.PerformanceReasonService],
    })
], PerformanceReasonModule);

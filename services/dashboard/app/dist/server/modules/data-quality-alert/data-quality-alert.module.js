"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataQualityAlertModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const director_briefing_module_1 = require("../director-briefing/director-briefing.module");
const data_quality_alert_service_1 = require("./data-quality-alert.service");
let DataQualityAlertModule = class DataQualityAlertModule {
};
exports.DataQualityAlertModule = DataQualityAlertModule;
exports.DataQualityAlertModule = DataQualityAlertModule = tslib_1.__decorate([
    (0, common_1.Module)({
        imports: [director_briefing_module_1.DirectorBriefingModule],
        providers: [data_quality_alert_service_1.DataQualityAlertService],
        exports: [data_quality_alert_service_1.DataQualityAlertService],
    })
], DataQualityAlertModule);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailyAdqModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const daily_adq_controller_1 = require("./daily-adq.controller");
const daily_adq_service_1 = require("./daily-adq.service");
let DailyAdqModule = class DailyAdqModule {
};
exports.DailyAdqModule = DailyAdqModule;
exports.DailyAdqModule = DailyAdqModule = tslib_1.__decorate([
    (0, common_1.Module)({
        controllers: [daily_adq_controller_1.DailyAdqController],
        providers: [daily_adq_service_1.DailyAdqService],
    })
], DailyAdqModule);

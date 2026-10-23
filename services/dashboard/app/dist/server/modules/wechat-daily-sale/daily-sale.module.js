"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailySaleModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const daily_sale_controller_1 = require("./daily-sale.controller");
const daily_sale_service_1 = require("./daily-sale.service");
let DailySaleModule = class DailySaleModule {
};
exports.DailySaleModule = DailySaleModule;
exports.DailySaleModule = DailySaleModule = tslib_1.__decorate([
    (0, common_1.Module)({
        controllers: [daily_sale_controller_1.DailySaleController],
        providers: [daily_sale_service_1.DailySaleService],
    })
], DailySaleModule);

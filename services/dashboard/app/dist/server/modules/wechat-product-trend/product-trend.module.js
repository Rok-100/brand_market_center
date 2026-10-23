"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductTrendModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const product_trend_controller_1 = require("./product-trend.controller");
const product_trend_service_1 = require("./product-trend.service");
let ProductTrendModule = class ProductTrendModule {
};
exports.ProductTrendModule = ProductTrendModule;
exports.ProductTrendModule = ProductTrendModule = tslib_1.__decorate([
    (0, common_1.Module)({
        controllers: [product_trend_controller_1.ProductTrendController],
        providers: [product_trend_service_1.ProductTrendService],
    })
], ProductTrendModule);

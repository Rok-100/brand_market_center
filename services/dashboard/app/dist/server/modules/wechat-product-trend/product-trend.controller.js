"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductTrendController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const product_trend_service_1 = require("./product-trend.service");
let ProductTrendController = class ProductTrendController {
    productTrendService;
    constructor(productTrendService) {
        this.productTrendService = productTrendService;
    }
    async getMetrics(id, range = '15d') {
        return this.productTrendService.getMetrics(id, range);
    }
    async getDaily(id, range = '15d') {
        return this.productTrendService.getDaily(id, range);
    }
};
exports.ProductTrendController = ProductTrendController;
tslib_1.__decorate([
    (0, common_1.Get)(':id/metrics'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Query)('range')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductTrendController.prototype, "getMetrics", null);
tslib_1.__decorate([
    (0, common_1.Get)(':id/daily'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Query)('range')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], ProductTrendController.prototype, "getDaily", null);
exports.ProductTrendController = ProductTrendController = tslib_1.__decorate([
    (0, common_1.Controller)('api/wechat/product-trend'),
    tslib_1.__metadata("design:paramtypes", [product_trend_service_1.ProductTrendService])
], ProductTrendController);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailySaleController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const daily_sale_service_1 = require("./daily-sale.service");
let DailySaleController = class DailySaleController {
    dailySaleService;
    constructor(dailySaleService) {
        this.dailySaleService = dailySaleService;
    }
    async getList(startDate, endDate, page, pageSize) {
        return this.dailySaleService.getList({
            startDate,
            endDate,
            page: page ? parseInt(page, 10) : 1,
            pageSize: pageSize ? parseInt(pageSize, 10) : 20,
        });
    }
    async create(dto) {
        return this.dailySaleService.create(dto);
    }
    async update(id, dto) {
        return this.dailySaleService.update(id, dto);
    }
    async delete(id) {
        return this.dailySaleService.delete(id);
    }
};
exports.DailySaleController = DailySaleController;
tslib_1.__decorate([
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__param(2, (0, common_1.Query)('page')),
    tslib_1.__param(3, (0, common_1.Query)('pageSize')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], DailySaleController.prototype, "getList", null);
tslib_1.__decorate([
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: 201 }),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], DailySaleController.prototype, "create", null);
tslib_1.__decorate([
    (0, common_1.Put)(':id'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], DailySaleController.prototype, "update", null);
tslib_1.__decorate([
    (0, common_1.Delete)(':id'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], DailySaleController.prototype, "delete", null);
exports.DailySaleController = DailySaleController = tslib_1.__decorate([
    (0, common_1.Controller)('api/wechat/daily-sales'),
    tslib_1.__metadata("design:paramtypes", [daily_sale_service_1.DailySaleService])
], DailySaleController);

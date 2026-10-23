"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceReasonController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const performance_reason_service_1 = require("./performance-reason.service");
function validateDate(value, label) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new common_1.BadRequestException(`${label}格式必须为 YYYY-MM-DD`);
    }
    return value;
}
let PerformanceReasonController = class PerformanceReasonController {
    performanceReasonService;
    constructor(performanceReasonService) {
        this.performanceReasonService = performanceReasonService;
    }
    async getRange(startDateValue, endDateValue) {
        const startDate = validateDate(startDateValue, '开始日期');
        const endDate = validateDate(endDateValue, '结束日期');
        const days = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
        if (days < 0 || days > 62)
            throw new common_1.BadRequestException('查询日期范围须为 0 至 62 天');
        return this.performanceReasonService.getRange(startDate, endDate);
    }
};
exports.PerformanceReasonController = PerformanceReasonController;
tslib_1.__decorate([
    (0, common_1.Get)(),
    (0, common_1.Header)('Cache-Control', 'private, max-age=300'),
    openapi.ApiResponse({ status: 200, type: Object }),
    tslib_1.__param(0, (0, common_1.Query)('startDate')),
    tslib_1.__param(1, (0, common_1.Query)('endDate')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], PerformanceReasonController.prototype, "getRange", null);
exports.PerformanceReasonController = PerformanceReasonController = tslib_1.__decorate([
    (0, common_1.Controller)('api/performance-reasons'),
    tslib_1.__metadata("design:paramtypes", [performance_reason_service_1.PerformanceReasonService])
], PerformanceReasonController);

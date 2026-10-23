"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const tslib_1 = require("tslib");
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
let HealthController = class HealthController {
    getHealth() {
        return {
            status: 'ok',
            service: 'wis-data-dashboard',
            releaseId: process.env.RELEASE_ID || null,
            checkedAt: new Date().toISOString(),
        };
    }
};
exports.HealthController = HealthController;
tslib_1.__decorate([
    (0, common_1.Get)(),
    (0, common_1.Header)('Cache-Control', 'no-store'),
    openapi.ApiResponse({ status: 200 }),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], HealthController.prototype, "getHealth", null);
exports.HealthController = HealthController = tslib_1.__decorate([
    (0, common_1.Controller)('api/health')
], HealthController);

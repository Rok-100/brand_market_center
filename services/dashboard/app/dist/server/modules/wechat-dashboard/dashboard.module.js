"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatDashboardModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const dashboard_controller_1 = require("./dashboard.controller");
const dashboard_service_1 = require("./dashboard.service");
let WechatDashboardModule = class WechatDashboardModule {
};
exports.WechatDashboardModule = WechatDashboardModule;
exports.WechatDashboardModule = WechatDashboardModule = tslib_1.__decorate([
    (0, common_1.Module)({
        controllers: [dashboard_controller_1.WechatDashboardController],
        providers: [dashboard_service_1.WechatDashboardService],
        exports: [dashboard_service_1.WechatDashboardService],
    })
], WechatDashboardModule);

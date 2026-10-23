"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const dashboard_controller_1 = require("./dashboard.controller");
let DashboardModule = class DashboardModule {
};
exports.DashboardModule = DashboardModule;
exports.DashboardModule = DashboardModule = tslib_1.__decorate([
    (0, common_1.Module)({ controllers: [dashboard_controller_1.DashboardController] })
], DashboardModule);

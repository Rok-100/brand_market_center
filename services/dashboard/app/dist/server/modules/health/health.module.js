"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const health_controller_1 = require("./health.controller");
let HealthModule = class HealthModule {
};
exports.HealthModule = HealthModule;
exports.HealthModule = HealthModule = tslib_1.__decorate([
    (0, common_1.Module)({ controllers: [health_controller_1.HealthController] })
], HealthModule);

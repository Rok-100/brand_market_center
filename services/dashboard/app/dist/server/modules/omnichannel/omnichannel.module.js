"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OmnichannelModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const omnichannel_controller_1 = require("./omnichannel.controller");
const omnichannel_service_1 = require("./omnichannel.service");
const sources_adapter_1 = require("./sources.adapter");
const dashboard_module_1 = require("../wechat-dashboard/dashboard.module");
let OmnichannelModule = class OmnichannelModule {
};
exports.OmnichannelModule = OmnichannelModule;
exports.OmnichannelModule = OmnichannelModule = tslib_1.__decorate([
    (0, common_1.Module)({
        imports: [dashboard_module_1.WechatDashboardModule],
        controllers: [omnichannel_controller_1.OmnichannelController],
        providers: [omnichannel_service_1.OmnichannelService, sources_adapter_1.WechatPostgresAdapter],
    })
], OmnichannelModule);

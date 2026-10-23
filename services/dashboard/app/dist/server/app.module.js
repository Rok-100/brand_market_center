"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const tslib_1 = require("tslib");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const exception_filter_1 = require("./common/filters/exception.filter");
const view_module_1 = require("./modules/view/view.module");
const dashboard_module_1 = require("./modules/dashboard/dashboard.module");
const dashboard_module_2 = require("./modules/wechat-dashboard/dashboard.module");
const daily_sale_module_1 = require("./modules/wechat-daily-sale/daily-sale.module");
const daily_adq_module_1 = require("./modules/wechat-daily-adq/daily-adq.module");
const product_module_1 = require("./modules/wechat-product/product.module");
const product_trend_module_1 = require("./modules/wechat-product-trend/product-trend.module");
const omnichannel_module_1 = require("./modules/omnichannel/omnichannel.module");
const ai_video_credits_module_1 = require("./modules/ai-video-credits/ai-video-credits.module");
const wechat_auth_guard_1 = require("./modules/wechat-auth/wechat-auth.guard");
const director_briefing_module_1 = require("./modules/director-briefing/director-briefing.module");
const performance_reason_module_1 = require("./modules/performance-reason/performance-reason.module");
const health_module_1 = require("./modules/health/health.module");
const company_oa_identity_guard_1 = require("./common/guards/company-oa-identity.guard");
const data_quality_alert_module_1 = require("./modules/data-quality-alert/data-quality-alert.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = tslib_1.__decorate([
    (0, common_1.Module)({
        imports: [
            // 平台 Module，提供平台能力
            fullstack_nestjs_core_1.PlatformModule.forRoot({
                // 公司服务器由统一 OA 网关保护；妙搭环境继续使用原有 CSRF 机制。
                enableCsrf: !/^(1|true|yes|on)$/i.test(process.env.COMPANY_OA_AUTH_ENABLED || ''),
            }),
            // ====== @route-section: business-modules START ======
            dashboard_module_1.DashboardModule,
            dashboard_module_2.WechatDashboardModule,
            daily_sale_module_1.DailySaleModule,
            daily_adq_module_1.DailyAdqModule,
            product_module_1.ProductModule,
            product_trend_module_1.ProductTrendModule,
            director_briefing_module_1.DirectorBriefingModule,
            performance_reason_module_1.PerformanceReasonModule,
            omnichannel_module_1.OmnichannelModule,
            ai_video_credits_module_1.AiVideoCreditsModule,
            data_quality_alert_module_1.DataQualityAlertModule,
            health_module_1.HealthModule,
            // ====== @route-section: business-modules END ======
            // ⚠️ @route-order: last
            // ViewModule is the fallback route module, must be registered last.
            view_module_1.ViewModule,
        ],
        providers: [
            {
                provide: core_1.APP_FILTER,
                useClass: exception_filter_1.GlobalExceptionFilter,
            },
            {
                provide: core_1.APP_GUARD,
                useClass: company_oa_identity_guard_1.CompanyOaIdentityGuard,
            },
            {
                provide: core_1.APP_GUARD,
                useClass: wechat_auth_guard_1.WechatAuthGuard,
            },
        ],
    })
], AppModule);

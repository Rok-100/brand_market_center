"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformDataForRender = platformDataForRender;
function platformDataForRender(platformData) {
    const companyOaEnabled = /^(1|true|yes|on)$/i.test(process.env.COMPANY_OA_AUTH_ENABLED || '');
    if (!companyOaEnabled)
        return platformData;
    return {
        ...platformData,
        appName: 'WIS数据看板',
        showBadge: false,
    };
}

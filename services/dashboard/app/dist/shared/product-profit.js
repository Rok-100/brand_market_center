"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT_PROFIT_COSTS = void 0;
exports.productProfitCategory = productProfitCategory;
exports.getProductProfitCost = getProductProfitCost;
exports.productLaborAndSharedPct = productLaborAndSharedPct;
exports.productFixedCostPct = productFixedCostPct;
exports.productProfitMarginPct = productProfitMarginPct;
exports.productProfitAmountYuan = productProfitAmountYuan;
exports.PRODUCT_PROFIT_COSTS = {
    水润: {
        revenueTargetWan: 1100,
        profitMarginTargetPct: -9,
        channelFeeTargetPct: 52.6,
        otherCostPct: 46.3,
        laborAndSharedWan: 111,
    },
    眼膜: {
        revenueTargetWan: 920,
        profitMarginTargetPct: -9,
        channelFeeTargetPct: 52.6,
        otherCostPct: 46.3,
        laborAndSharedWan: 92.8,
    },
    微针: {
        revenueTargetWan: 1200,
        profitMarginTargetPct: -18,
        channelFeeTargetPct: 61.6,
        otherCostPct: 46.3,
        laborAndSharedWan: 121.1,
    },
    次抛: {
        revenueTargetWan: 100,
        profitMarginTargetPct: -21,
        channelFeeTargetPct: 66.6,
        otherCostPct: 44.3,
        laborAndSharedWan: 10.1,
    },
    其他: {
        revenueTargetWan: 80,
        profitMarginTargetPct: -20,
        channelFeeTargetPct: 47.6,
        otherCostPct: 62.3,
        laborAndSharedWan: 8.1,
    },
};
function productProfitCategory(name) {
    const normalized = name.trim();
    if (!normalized)
        return null;
    if (normalized.includes("水润"))
        return "水润";
    if (normalized.includes("眼膜"))
        return "眼膜";
    if (normalized.includes("黑晶") || normalized.includes("微针"))
        return "微针";
    if (normalized.includes("次抛"))
        return "次抛";
    return "其他";
}
function getProductProfitCost(name) {
    const category = productProfitCategory(name);
    if (!category)
        return null;
    return {
        category,
        ...exports.PRODUCT_PROFIT_COSTS[category],
    };
}
function productLaborAndSharedPct(name) {
    const cost = getProductProfitCost(name);
    if (!cost || cost.revenueTargetWan <= 0)
        return null;
    return cost.laborAndSharedWan / cost.revenueTargetWan * 100;
}
function productFixedCostPct(name) {
    const cost = getProductProfitCost(name);
    const laborAndSharedPct = productLaborAndSharedPct(name);
    if (!cost || laborAndSharedPct === null)
        return null;
    return cost.otherCostPct + laborAndSharedPct;
}
function productProfitMarginPct(name, gsvYuan, qianchuanCostYuan) {
    const fixedCostPct = productFixedCostPct(name);
    if (fixedCostPct === null || !Number.isFinite(gsvYuan) || gsvYuan <= 0 || qianchuanCostYuan === null || !Number.isFinite(qianchuanCostYuan) || qianchuanCostYuan < 0) {
        return null;
    }
    // 渠道费比只取当天真实单品千川消耗 / 当天单品GSV；表内目标渠道费比不参与实际利润率计算。
    const actualChannelFeePct = qianchuanCostYuan / gsvYuan * 100;
    return 100 - actualChannelFeePct - fixedCostPct;
}
function productProfitAmountYuan(name, gsvYuan, qianchuanCostYuan) {
    const profitMarginPct = productProfitMarginPct(name, gsvYuan, qianchuanCostYuan);
    if (profitMarginPct === null)
        return null;
    return gsvYuan * profitMarginPct / 100;
}

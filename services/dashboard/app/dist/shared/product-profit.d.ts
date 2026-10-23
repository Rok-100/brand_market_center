export declare const PRODUCT_PROFIT_COSTS: {
    readonly 水润: {
        readonly revenueTargetWan: 1100;
        readonly profitMarginTargetPct: -9;
        readonly channelFeeTargetPct: 52.6;
        readonly otherCostPct: 46.3;
        readonly laborAndSharedWan: 111;
    };
    readonly 眼膜: {
        readonly revenueTargetWan: 920;
        readonly profitMarginTargetPct: -9;
        readonly channelFeeTargetPct: 52.6;
        readonly otherCostPct: 46.3;
        readonly laborAndSharedWan: 92.8;
    };
    readonly 微针: {
        readonly revenueTargetWan: 1200;
        readonly profitMarginTargetPct: -18;
        readonly channelFeeTargetPct: 61.6;
        readonly otherCostPct: 46.3;
        readonly laborAndSharedWan: 121.1;
    };
    readonly 次抛: {
        readonly revenueTargetWan: 100;
        readonly profitMarginTargetPct: -21;
        readonly channelFeeTargetPct: 66.6;
        readonly otherCostPct: 44.3;
        readonly laborAndSharedWan: 10.1;
    };
    readonly 其他: {
        readonly revenueTargetWan: 80;
        readonly profitMarginTargetPct: -20;
        readonly channelFeeTargetPct: 47.6;
        readonly otherCostPct: 62.3;
        readonly laborAndSharedWan: 8.1;
    };
};
export type ProductProfitCategory = keyof typeof PRODUCT_PROFIT_COSTS;
export declare function productProfitCategory(name: string): ProductProfitCategory | null;
export declare function getProductProfitCost(name: string): {
    revenueTargetWan: 1100;
    profitMarginTargetPct: -9;
    channelFeeTargetPct: 52.6;
    otherCostPct: 46.3;
    laborAndSharedWan: 111;
    category: "眼膜" | "次抛" | "水润" | "微针" | "其他";
} | {
    revenueTargetWan: 920;
    profitMarginTargetPct: -9;
    channelFeeTargetPct: 52.6;
    otherCostPct: 46.3;
    laborAndSharedWan: 92.8;
    category: "眼膜" | "次抛" | "水润" | "微针" | "其他";
} | {
    revenueTargetWan: 1200;
    profitMarginTargetPct: -18;
    channelFeeTargetPct: 61.6;
    otherCostPct: 46.3;
    laborAndSharedWan: 121.1;
    category: "眼膜" | "次抛" | "水润" | "微针" | "其他";
} | {
    revenueTargetWan: 100;
    profitMarginTargetPct: -21;
    channelFeeTargetPct: 66.6;
    otherCostPct: 44.3;
    laborAndSharedWan: 10.1;
    category: "眼膜" | "次抛" | "水润" | "微针" | "其他";
} | {
    revenueTargetWan: 80;
    profitMarginTargetPct: -20;
    channelFeeTargetPct: 47.6;
    otherCostPct: 62.3;
    laborAndSharedWan: 8.1;
    category: "眼膜" | "次抛" | "水润" | "微针" | "其他";
};
export declare function productLaborAndSharedPct(name: string): number;
export declare function productFixedCostPct(name: string): number;
export declare function productProfitMarginPct(name: string, gsvYuan: number, qianchuanCostYuan: number | null): number;
export declare function productProfitAmountYuan(name: string, gsvYuan: number, qianchuanCostYuan: number | null): number;

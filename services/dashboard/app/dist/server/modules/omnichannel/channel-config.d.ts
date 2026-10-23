import type { ChannelMeta, OmniChannelKey } from "@shared/omnichannel.types";
export declare const BRAND_MARKETING_FINANCE_TREND_2026: readonly [{
    readonly month: "2026-01";
    readonly label: "1月";
    readonly incomeWan: 2217;
    readonly profitMarginPct: -24.2;
}, {
    readonly month: "2026-02";
    readonly label: "2月";
    readonly incomeWan: 2576;
    readonly profitMarginPct: -24.5;
}, {
    readonly month: "2026-03";
    readonly label: "3月";
    readonly incomeWan: 5290;
    readonly profitMarginPct: -5.7;
}, {
    readonly month: "2026-04";
    readonly label: "4月";
    readonly incomeWan: 3272;
    readonly profitMarginPct: -16.4;
}, {
    readonly month: "2026-05";
    readonly label: "5月";
    readonly incomeWan: 3697;
    readonly profitMarginPct: -14.7;
}, {
    readonly month: "2026-06";
    readonly label: "6月";
    readonly incomeWan: 5508;
    readonly profitMarginPct: -8.3;
}, {
    readonly month: "2026-07";
    readonly label: "7月";
    readonly incomeWan: 5756;
    readonly profitMarginPct: -7.3;
}];
export declare const CHANNEL_METADATA: ChannelMeta[];
export declare const OMNICHANNEL_TARGET_GSV_WAN: Record<string, number>;
export declare function getChannelMeta(key: OmniChannelKey): ChannelMeta | undefined;
export declare function getOnlineChannels(): ChannelMeta[];
export declare function getChannelsWithData(): ChannelMeta[];
export declare function getMissingChannels(): ChannelMeta[];

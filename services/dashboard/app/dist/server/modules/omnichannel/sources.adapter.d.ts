import { type PostgresJsDatabase } from "@lark-apaas/fullstack-nestjs-core";
import type { OmniChannelDailyPoint, OmniChannelKey } from "@shared/omnichannel.types";
interface ChannelSourceAdapter {
    fetchDaily(startDate: string, endDate: string): Promise<OmniChannelDailyPoint[]>;
}
export declare class WechatPostgresAdapter implements ChannelSourceAdapter {
    private readonly db;
    constructor(db: PostgresJsDatabase);
    fetchDaily(startDate: string, endDate: string): Promise<OmniChannelDailyPoint[]>;
}
export declare function createAdapter(channel: OmniChannelKey, db?: PostgresJsDatabase): ChannelSourceAdapter;
/**
 * 总览与趋势可能同时请求完全相同的渠道区间；这里合并并发查询并短暂复用结果。
 * 返回副本，避免总览对“今日部分数据”的补充修改污染缓存或其他请求。
 */
export declare function fetchChannelDaily(channel: OmniChannelKey, db: PostgresJsDatabase, startDate: string, endDate: string): Promise<OmniChannelDailyPoint[]>;
export declare function fetchTodayHourlyDouyin(): Promise<{
    costYuan: number;
    gsvYuan: number;
    gmvYuan: number;
    orderCount: number;
    hasData: boolean;
}>;
export interface HourlyGsvSourcePoint {
    date: string;
    hour: number;
    gsvYuan: number;
    sourceUpdatedAt: string | null;
}
export interface HourlySpendSourcePoint {
    date: string;
    hour: number;
    spendYuan: number;
    sourceUpdatedAt: string | null;
}
export declare function fetchHourlyDouyinGsv(startDate: string, endDate: string): Promise<HourlyGsvSourcePoint[]>;
export declare function fetchHourlyDouyinSpend(startDate: string, endDate: string): Promise<HourlySpendSourcePoint[]>;
export {};

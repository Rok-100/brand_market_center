export type PerformanceReasonChannel = 'douyin' | 'wechat';
export type PerformanceReasonStatus = 'available' | 'not_mentioned' | 'pending' | 'unavailable';
export interface PerformanceReasonItem {
    date: string;
    channel: PerformanceReasonChannel;
    status: PerformanceReasonStatus;
    summary: string | null;
    sourceName: 'WIS项目数据群';
    sourceMessageIds: string[];
    sourceLatestAt: string | null;
    aggregatedAt: string | null;
}
export interface PerformanceReasonResponse {
    items: PerformanceReasonItem[];
    startDate: string;
    endDate: string;
    scheduledAt: '08:55';
    timezone: 'Asia/Shanghai';
    storage: {
        ready: boolean;
        database: string | null;
        schema: string | null;
        rowCount: number | null;
        writeAttempts: number;
        writeSuccesses: number;
        lastWriteError: string | null;
    };
}

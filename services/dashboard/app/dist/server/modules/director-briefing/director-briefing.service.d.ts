import { type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { DirectorCalendarDay, DirectorDailyKeyWork, DirectorDailySummary, DirectorDailySummaryDay, DirectorDailySummaryType, DirectorInsightDay, DirectorOperatingImageList } from '@shared/director';
export type FeishuBriefingMessage = {
    message_id?: string;
    parent_id?: string;
    root_id?: string;
    msg_type?: string;
    create_time?: string;
    deleted?: boolean;
    body?: {
        content?: string;
    };
};
export declare class DirectorBriefingService {
    private readonly db;
    private readonly logger;
    private tenantToken;
    private readonly insightCache;
    constructor(db: PostgresJsDatabase);
    private dateText;
    private timeText;
    private missingTable;
    private shanghaiDayBounds;
    private getTenantToken;
    readBriefingMessages(startIso: string, endIso: string, onlyThreadRootMessages?: boolean, chatIdOverride?: string): Promise<FeishuBriefingMessage[]>;
    sendBriefingText(text: string, chatIdOverride?: string, idempotencyKey?: string): Promise<string>;
    private readInsightMessages;
    private flattenMessageContent;
    briefingMessageText(message: FeishuBriefingMessage): string;
    private sanitizeInsight;
    private insightCategory;
    private insightFromMessage;
    private readOperatingImagePayload;
    private readCalendarPayload;
    getCalendarDay(date: string): Promise<DirectorCalendarDay>;
    getInsights(date: string): Promise<DirectorInsightDay>;
    getOperatingImages(date?: string): Promise<DirectorOperatingImageList>;
    getOperatingImageMedia(date: string, imageType: string): Promise<{
        buffer: Buffer;
        contentType: string;
    } | null>;
    getDailyKeyWork(date: string): Promise<DirectorDailyKeyWork>;
    saveDailyKeyWork(date: string, content: string, userId: string): Promise<DirectorDailyKeyWork>;
    getDailySummaries(date: string): Promise<DirectorDailySummaryDay>;
    saveDailySummary(date: string, summaryType: DirectorDailySummaryType, content: string, userId: string): Promise<DirectorDailySummary>;
}

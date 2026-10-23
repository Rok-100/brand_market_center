export interface DirectorDailyKeyWork {
    date: string;
    content: string;
    updatedAt: string | null;
}
export interface SaveDirectorDailyKeyWorkRequest {
    date: string;
    content: string;
}
export type DirectorDailySummaryType = 'morning_report' | 'transcript';
export interface DirectorDailySummary {
    date: string;
    summaryType: DirectorDailySummaryType;
    content: string;
    updatedAt: string | null;
}
export interface DirectorDailySummaryDay {
    date: string;
    items: Record<DirectorDailySummaryType, DirectorDailySummary>;
}
export interface SaveDirectorDailySummaryRequest {
    date: string;
    summaryType: DirectorDailySummaryType;
    content: string;
}
export interface DirectorOperatingImage {
    date: string;
    imageType: string;
    imageUrl: string;
    altText: string;
    sourceBlockId: string;
}
export interface DirectorOperatingImageList {
    date: string | null;
    sourceDocUrl: string;
    items: DirectorOperatingImage[];
}
export interface DirectorCalendarEvent {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    location: string | null;
    organizer: string | null;
    appLink: string | null;
}
export interface DirectorCalendarDay {
    date: string;
    sourceName: string;
    updatedAt: string | null;
    items: DirectorCalendarEvent[];
}
export type DirectorInsightCategory = '业绩信号' | '风险提醒' | '执行进展' | '机会发现';
export interface DirectorInsightItem {
    id: string;
    category: DirectorInsightCategory;
    content: string;
    createdAt: string;
}
export interface DirectorInsightDay {
    date: string;
    sourceName: string;
    updatedAt: string | null;
    status: 'live' | 'empty' | 'unavailable';
    messageCount: number;
    items: DirectorInsightItem[];
    reason: string | null;
}

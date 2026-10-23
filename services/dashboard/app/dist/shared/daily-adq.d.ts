export interface DailyAdqItem {
    id: string;
    adqDate: string;
    spend: number;
    revenue: number;
    spendRatio: number;
    isPartial: boolean;
    remark: string;
}
export interface DailyAdqListParams {
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
}
export interface DailyAdqListResponse {
    items: DailyAdqItem[];
    total: number;
}
export interface CreateDailyAdqRequest {
    adqDate: string;
    spend: number;
    revenue: number;
    spendRatio: number;
    isPartial?: boolean;
    remark?: string;
}
export interface UpdateDailyAdqRequest extends CreateDailyAdqRequest {
    id: string;
}

export interface DailySaleItem {
    id: string;
    saleDate: string;
    gsvAmount: number;
    orderCount: number;
    avgOrderValue: number;
    isPartial: boolean;
    remark: string;
}
export interface DailySaleListResponse {
    items: DailySaleItem[];
    total: number;
}
export interface CreateDailySaleRequest {
    saleDate: string;
    gsvAmount: number;
    orderCount: number;
    isPartial?: boolean;
    remark?: string;
}
export interface UpdateDailySaleRequest extends CreateDailySaleRequest {
}

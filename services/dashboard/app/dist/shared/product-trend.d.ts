export interface ProductTrendMetrics {
    totalSales: number;
    avgDailySales: number;
    peakDay: string;
    peakValue: number;
    momChangeRate: number;
    totalQuantity: number;
    avgPrice: number;
}
export interface ProductDailySaleItem {
    date: string;
    salesAmount: number;
    salesQuantity: number;
    avgPrice: number;
}
export interface ProductDailySaleResponse {
    items: ProductDailySaleItem[];
    total: number;
}
export type TrendRange = '7d' | '15d' | '30d' | 'month';

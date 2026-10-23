import { type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { ProductTrendMetrics, ProductDailySaleResponse, TrendRange } from '@shared/product-trend';
export declare class ProductTrendService {
    private readonly db;
    private readonly logger;
    constructor(db: PostgresJsDatabase);
    getMetrics(id: string, range: TrendRange): Promise<ProductTrendMetrics>;
    getDaily(id: string, range: TrendRange): Promise<ProductDailySaleResponse>;
    private getReferenceDate;
    private queryPeriodData;
    private calculateDateRange;
    private calculatePreviousRange;
    private formatDate;
}

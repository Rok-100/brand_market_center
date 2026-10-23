import { ProductTrendService } from './product-trend.service';
import type { TrendRange } from '@shared/product-trend';
export declare class ProductTrendController {
    private readonly productTrendService;
    constructor(productTrendService: ProductTrendService);
    getMetrics(id: string, range?: TrendRange): Promise<import("@shared/product-trend").ProductTrendMetrics>;
    getDaily(id: string, range?: TrendRange): Promise<import("@shared/product-trend").ProductDailySaleResponse>;
}

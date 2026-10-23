import { DailySaleService } from './daily-sale.service';
import type { CreateDailySaleRequest, UpdateDailySaleRequest } from '@shared/daily-sale';
export declare class DailySaleController {
    private readonly dailySaleService;
    constructor(dailySaleService: DailySaleService);
    getList(startDate?: string, endDate?: string, page?: string, pageSize?: string): Promise<import("@shared/daily-sale").DailySaleListResponse>;
    create(dto: CreateDailySaleRequest): Promise<{
        id: string;
    }>;
    update(id: string, dto: UpdateDailySaleRequest): Promise<{
        success: boolean;
    }>;
    delete(id: string): Promise<{
        success: boolean;
    }>;
}

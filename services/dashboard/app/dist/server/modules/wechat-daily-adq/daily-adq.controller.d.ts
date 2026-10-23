import { DailyAdqService } from './daily-adq.service';
import type { CreateDailyAdqRequest, UpdateDailyAdqRequest } from '@shared/daily-adq';
export declare class DailyAdqController {
    private readonly dailyAdqService;
    constructor(dailyAdqService: DailyAdqService);
    getList(startDate?: string, endDate?: string, page?: string, pageSize?: string): Promise<import("@shared/daily-adq").DailyAdqListResponse>;
    create(dto: CreateDailyAdqRequest): Promise<{
        id: string;
    }>;
    update(id: string, dto: UpdateDailyAdqRequest): Promise<{
        success: boolean;
    }>;
    delete(id: string): Promise<{
        success: boolean;
    }>;
}

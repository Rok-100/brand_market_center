import type { Request, Response } from 'express';
import type { SaveDirectorDailyKeyWorkRequest, SaveDirectorDailySummaryRequest } from '@shared/director';
import { DirectorBriefingService } from './director-briefing.service';
export declare class DirectorBriefingController {
    private readonly directorBriefingService;
    constructor(directorBriefingService: DirectorBriefingService);
    private authorizeView;
    private authorizeEdit;
    getDailyKeyWork(req: Request, date: string): Promise<import("@shared/director").DirectorDailyKeyWork>;
    getOperatingImages(req: Request, date?: string): Promise<import("@shared/director").DirectorOperatingImageList>;
    getCalendarDay(req: Request, date: string): Promise<import("@shared/director").DirectorCalendarDay>;
    getInsights(req: Request, date: string): Promise<import("@shared/director").DirectorInsightDay>;
    getOperatingImageMedia(req: Request, res: Response, date: string, imageType: string): Promise<void>;
    saveDailyKeyWork(req: Request, body: SaveDirectorDailyKeyWorkRequest): Promise<import("@shared/director").DirectorDailyKeyWork>;
    getDailySummaries(req: Request, date: string): Promise<import("@shared/director").DirectorDailySummaryDay>;
    saveDailySummary(req: Request, body: SaveDirectorDailySummaryRequest): Promise<import("@shared/director").DirectorDailySummary>;
}

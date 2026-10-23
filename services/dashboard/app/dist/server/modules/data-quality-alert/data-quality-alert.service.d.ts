import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DirectorBriefingService } from '../director-briefing/director-briefing.service';
export declare class DataQualityAlertService implements OnModuleInit, OnModuleDestroy {
    private readonly directorBriefingService;
    private readonly logger;
    private timer;
    private checking;
    private readonly sentInProcess;
    constructor(directorBriefingService: DirectorBriefingService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    private scheduleNext;
    private configuredShopIds;
    private targetChatId;
    private enabled;
    private buildQuery;
    private fingerprint;
    private idempotencyKey;
    private alreadySent;
    private message;
    checkNow(now?: number): Promise<void>;
}

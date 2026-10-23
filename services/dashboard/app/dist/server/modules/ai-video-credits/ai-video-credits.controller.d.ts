import type { AiVideoCreditsResponse } from '@shared/api.interface';
import { AiVideoCreditsService } from './ai-video-credits.service';
export declare class AiVideoCreditsController {
    private readonly aiVideoCreditsService;
    constructor(aiVideoCreditsService: AiVideoCreditsService);
    overview(refresh?: string): Promise<AiVideoCreditsResponse>;
}

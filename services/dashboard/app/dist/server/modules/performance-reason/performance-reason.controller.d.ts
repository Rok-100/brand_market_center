import { PerformanceReasonService } from './performance-reason.service';
export declare class PerformanceReasonController {
    private readonly performanceReasonService;
    constructor(performanceReasonService: PerformanceReasonService);
    getRange(startDateValue?: string, endDateValue?: string): Promise<import("../../../shared/performance-reason").PerformanceReasonResponse>;
}

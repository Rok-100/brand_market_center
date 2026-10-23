import { OmnichannelService } from "./omnichannel.service";
export declare class OmnichannelController {
    private readonly omnichannelService;
    private readonly overviewCache;
    private readonly overviewInFlight;
    private realtimeCache;
    private realtimeInFlight;
    constructor(omnichannelService: OmnichannelService);
    private deliver;
    private persistentKey;
    private persistOverview;
    private refreshOverview;
    private refreshRealtime;
    overview(startDate?: string, endDate?: string, force?: string): Promise<import("../../../shared/omnichannel.types").OmniChannelOverviewResponse>;
    trend(startDate?: string, endDate?: string, granularity?: "day" | "week" | "month"): Promise<import("../../../shared/omnichannel.types").OmniChannelTrendResponse>;
    realtimeComparison(force?: string): Promise<import("../../../shared/omnichannel.types").OmniChannelRealtimeComparisonResponse>;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotsFromResponse = snapshotsFromResponse;
exports.mergeDailySnapshots = mergeDailySnapshots;
exports.millisecondsUntilNextShanghaiRun = millisecondsUntilNextShanghaiRun;
function validNumber(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}
function statusForCoverage(coverage) {
    if (coverage.credits === null)
        return 'unavailable';
    return coverage.reportedAccounts >= coverage.trackedAccounts
        ? 'available'
        : 'partial';
}
function snapshotsFromResponse(response) {
    return response.trends.flatMap((point) => ['kling', 'libtv'].map((platform) => {
        const coverage = point[platform];
        return {
            date: point.date,
            platform,
            dailyCredits: coverage.credits,
            cumulativeCredits: null,
            balanceCredits: null,
            reportedAccounts: coverage.reportedAccounts,
            trackedAccounts: coverage.trackedAccounts,
            status: statusForCoverage(coverage),
            source: 'feishu_sheet',
            sourceRevision: response.source.revision,
            sourceNote: response.source.notice,
            collectedAt: response.source.fetchedAt,
        };
    }));
}
function mergeDailySnapshots(response, stored) {
    const byDate = new Map(response.trends.map((point) => [
        point.date,
        {
            ...point,
            kling: { ...point.kling },
            libtv: { ...point.libtv },
        },
    ]));
    let usedDatabaseValue = false;
    let latestStoredCollectedAt = null;
    for (const item of stored) {
        const dailyCredits = validNumber(item.dailyCredits);
        const point = byDate.get(item.date) ?? {
            date: item.date,
            kling: { credits: null, reportedAccounts: 0, trackedAccounts: 0 },
            libtv: { credits: null, reportedAccounts: 0, trackedAccounts: 0 },
        };
        const currentCoverage = point[item.platform];
        const shouldUseStored = response.source.mode === 'snapshot' ||
            item.source !== 'feishu_sheet' ||
            currentCoverage.credits === null;
        if (!shouldUseStored)
            continue;
        point[item.platform] = {
            credits: dailyCredits,
            reportedAccounts: item.reportedAccounts,
            trackedAccounts: item.trackedAccounts,
            status: item.status,
            balanceCredits: item.balanceCredits,
            collectedAt: item.collectedAt,
            source: item.source,
        };
        byDate.set(item.date, point);
        if (dailyCredits !== null) {
            usedDatabaseValue = true;
            if (latestStoredCollectedAt === null ||
                Date.parse(item.collectedAt) > Date.parse(latestStoredCollectedAt)) {
                latestStoredCollectedAt = item.collectedAt;
            }
        }
    }
    const trends = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    const dataThroughDate = trends
        .filter((point) => point.kling.credits !== null || point.libtv.credits !== null)
        .at(-1)?.date ?? null;
    const databaseFallback = usedDatabaseValue && response.source.mode === 'snapshot';
    const mixedSource = usedDatabaseValue && response.source.mode === 'live';
    const hasStoredRows = stored.length > 0;
    return {
        ...response,
        trends,
        source: {
            ...response.source,
            mode: databaseFallback
                ? 'database'
                : mixedSource
                    ? 'mixed'
                    : response.source.mode,
            fetchedAt: databaseFallback && latestStoredCollectedAt
                ? latestStoredCollectedAt
                : response.source.fetchedAt,
            dataThroughDate,
            notice: databaseFallback
                ? '飞书实时读取暂不可用，当前展示后台保存的最近成功日快照；可灵与 LibTV 分开记录，缺失值不补 0。'
                : mixedSource
                    ? '当前展示飞书实时数据及后台最近成功日快照；可灵与 LibTV 分开记录，快照只补实时缺失的平台日值，不补 0。'
                    : hasStoredRows
                        ? `${response.source.notice} 后台按日期与平台保存日快照，可灵与 LibTV 分开记录。`
                        : response.source.notice,
        },
    };
}
function offsetDate(value, days) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days))
        .toISOString()
        .slice(0, 10);
}
function shanghaiDate(now) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(now));
}
function millisecondsUntilNextShanghaiRun(now, hour = 8, minute = 0) {
    const today = shanghaiDate(now);
    let target = Date.parse(`${today}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);
    if (target <= now) {
        target = Date.parse(`${offsetDate(today, 1)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);
    }
    return Math.max(1000, target - now);
}

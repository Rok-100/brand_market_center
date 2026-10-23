const channelLabels = { douyin: '抖店', wechat: '视频号' };
const usableStates = new Set(['ready', 'partial', 'stale']);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const businessDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value ? value : null;
const validAmount = channel => !!channel && usableStates.has(channel.state) && !channel.unavailableReason
  && Number.isFinite(channel.todayTotalYuan) && !!businessDate(channel.todayDate);
const sourceStamp = (channel, payload) => Date.parse(channel?.sourceUpdatedAt || payload?.generatedAt || '');

// Keep the two business channels stable even when a source is missing. A partial
// channel may have verified GSV but incomplete advertising costs; that GSV is usable.
export function normalizePublicRealtime(payload, { now = Date.now(), ttlMs = 300_000 } = {}) {
  if (!payload || !Array.isArray(payload.channels)) return null;
  const known = payload.channels.filter(channel => Object.hasOwn(channelLabels, channel?.key));
  if (!known.length || new Set(known.map(channel => channel.key)).size !== known.length) return null;
  const generatedAt = timestamp(payload.generatedAt);
  const generatedMs = Date.parse(generatedAt || '');
  const today = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  const channels = Object.entries(channelLabels).map(([key, label]) => {
    const source = known.find(channel => channel.key === key);
    const valid = validAmount(source);
    const date = businessDate(source?.todayDate);
    const updatedAt = timestamp(source?.sourceUpdatedAt);
    const age = now - sourceStamp(source, payload);
    const stale = valid && (source.state === 'stale' || source.hubRetained === true || date !== today
      || !Number.isFinite(age) || age < -60_000 || age >= ttlMs
      || payload.cacheState === 'stale-while-refresh' || payload.status === 'stale');
    return { ...source, key, label: source?.label || label, todayDate: date, sourceUpdatedAt: updatedAt,
      todayTotalYuan: valid ? source.todayTotalYuan : null,
      state: valid ? stale ? 'stale' : source.state : 'pending',
      unavailableReason: valid ? null : source?.unavailableReason || '本渠道有效 GSV 或业务日期待回补',
      refreshError: source?.hubRefreshError || null, stale,
      spendBreakdown: Array.isArray(source?.spendBreakdown) ? source.spendBreakdown : [],
      points: Array.isArray(source?.points) ? source.points : [] };
  });
  const complete = channels.every(channel => channel.todayTotalYuan !== null);
  const sameDate = complete && channels[0].todayDate === channels[1].todayDate;
  const anyValue = channels.some(channel => channel.todayTotalYuan !== null);
  const stale = channels.some(channel => channel.stale) || !Number.isFinite(generatedMs)
    || now - generatedMs >= ttlMs || generatedMs - now > 60_000;
  return {
    schemaVersion: 2, generatedAt, timezone: payload.timezone || 'Asia/Shanghai',
    status: !anyValue ? 'pending' : !sameDate ? 'partial' : stale ? 'stale'
      : channels.every(channel => channel.state === 'ready') && payload.status === 'ready' ? 'ready' : 'partial',
    summary: { departmentTodayGsvYuan: sameDate
      ? Math.round(channels.reduce((sum, channel) => sum + channel.todayTotalYuan, 0) * 100) / 100 : null,
      includedChannels: channels.filter(channel => channel.todayTotalYuan !== null).map(channel => channel.key) },
    channels,
  };
}

// An older/failed channel must not replace its last verified fact. Retained facts
// keep their source business dates and are explicitly stale, including after restart.
export function mergeRealtimeSnapshot(previous, incoming, receivedAt = new Date().toISOString()) {
  const normalized = normalizePublicRealtime(incoming);
  if (!normalized || !incoming.channels.some(validAmount)) return null;
  const channels = Object.keys(channelLabels).map(key => {
    const next = incoming.channels.find(channel => channel?.key === key);
    const prior = previous?.channels?.find(channel => channel?.key === key);
    const older = validAmount(next) && validAmount(prior) && (next.todayDate < prior.todayDate
      || next.todayDate === prior.todayDate && Number.isFinite(sourceStamp(prior, previous))
        && (!Number.isFinite(sourceStamp(next, incoming)) || sourceStamp(next, incoming) < sourceStamp(prior, previous)));
    if (validAmount(next) && !older) return { ...next, hubRetained: next.hubRetained === true,
      hubRefreshError: next.hubRetained === true ? next.hubRefreshError || null : null };
    if (validAmount(prior)) return { ...prior, state: 'stale', hubRetained: true,
      hubRefreshError: older ? '本次来源时间早于已保存快照，保留最近成功记录' : next?.unavailableReason || '本次未返回可核验金额，保留最近成功记录' };
    return { ...(next || {}), key, label: next?.label || channelLabels[key], state: 'pending', todayTotalYuan: null,
      unavailableReason: next?.unavailableReason || '本次未返回可核验金额或业务日期' };
  });
  const sourceTimes = [timestamp(previous?.generatedAt), timestamp(incoming.generatedAt)].filter(Boolean);
  const generatedAt = sourceTimes.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
  return { ...incoming, generatedAt, channels, hubRetrievedAt: receivedAt };
}

export function createWorkspaceSummaryReader({ readSnapshot, writeSnapshot, fetchSnapshot, keyFor,
  clock = Date.now, ttlMs = 300_000, retryMs = 30_000, maxRetryMs = 300_000 }) {
  let inflight = null, epoch = 0, lastAttemptAt = null, lastSuccessAt = null, lastError = null;
  let nextRetryAt = 0, failures = 0;
  const denied = new Map();
  const iso = () => new Date(clock()).toISOString();
  function start(request, force) {
    const key = keyFor(request), now = clock();
    if (!key || inflight || nextRetryAt > now || (denied.get(key)?.retryAt || 0) > now) return;
    const prior = readSnapshot();
    const checked = Date.parse(lastSuccessAt || prior?.hubRetrievedAt || '');
    // Source time describes business freshness, not how often we should re-fetch.
    if (!force && Number.isFinite(checked) && now >= checked && now - checked < ttlMs) return;
    const version = epoch;
    lastAttemptAt = iso();
    const promise = Promise.resolve().then(() => fetchSnapshot(request)).then(result => {
      if (version !== epoch) return;
      const merged = result.status === 200 ? mergeRealtimeSnapshot(readSnapshot(), result.payload, iso()) : null;
      if (merged) {
        if (writeSnapshot(merged) === false) throw new Error('经营摘要快照暂时无法保存');
        lastSuccessAt = iso(); failures = 0; nextRetryAt = 0; lastError = null; denied.delete(key);
        return;
      }
      const status = result.status === 200 ? 502 : result.status;
      const error = { status, at: iso(), message: status === 401 || status === 403
        ? '根数据读取身份失效或无权限，保留已授权公开快照；请核验根数据登录状态。'
        : status === 502 ? '根数据未返回可核验的渠道数据，保留最近成功快照。'
          : '根数据暂时不可用，保留最近成功快照并稍后重试。' };
      if ([401, 403].includes(status)) {
        if (denied.size >= 500 && !denied.has(key)) denied.delete(denied.keys().next().value);
        denied.set(key, { error, retryAt: clock() + maxRetryMs });
      } else { failures += 1; lastError = error; nextRetryAt = clock() + Math.min(maxRetryMs, retryMs * 2 ** Math.min(failures - 1, 8)); }
    }).catch(() => {
      if (version !== epoch) return;
      failures += 1; lastError = { status: 503, at: iso(), message: '经营摘要读取或保存未完成，保留最近成功快照。' };
      nextRetryAt = clock() + Math.min(maxRetryMs, retryMs * 2 ** Math.min(failures - 1, 8));
    }).finally(() => { if (inflight?.promise === promise) inflight = null; });
    inflight = { promise, key };
  }
  return {
    read(request, force = false) {
      start(request, force);
      const snapshot = readSnapshot(), normalized = normalizePublicRealtime(snapshot, { now: clock(), ttlMs });
      const failure = denied.get(keyFor(request));
      const error = failure?.error || lastError;
      const retryAt = Math.max(failure?.retryAt || 0, nextRetryAt);
      const refreshing = !!inflight;
      const channels = (normalized?.channels || Object.entries(channelLabels).map(([key, label]) => ({ key, label,
        todayDate: null, sourceUpdatedAt: null, todayTotalYuan: null, state: 'pending', stale: false,
        unavailableReason: '本渠道尚无可核验快照', refreshError: null }))).map(channel => ({
        key: channel.key, label: channel.label, todayDate: channel.todayDate, sourceUpdatedAt: channel.sourceUpdatedAt,
        todayTotalYuan: channel.todayTotalYuan, state: channel.todayTotalYuan === null ? 'pending' : 'ready',
        sourceState: channel.state, stale: channel.stale, unavailableReason: channel.unavailableReason,
        refreshError: channel.refreshError || null }));
      return { status: error && normalized && normalized.summary.departmentTodayGsvYuan !== null ? 'stale' : normalized?.status || 'pending',
        refreshing, generatedAt: normalized?.generatedAt || null,
        totalGsvYuan: normalized?.summary.departmentTodayGsvYuan ?? null, channels,
        lastAttemptAt, lastSuccessAt: lastSuccessAt || timestamp(snapshot?.hubRetrievedAt), lastError: error || null,
        nextRetryAt: retryAt > clock() ? new Date(retryAt).toISOString() : null,
        note: error ? error.message : refreshing ? '正在更新经营摘要；已有金额保留来源日期，缺失项待回补。'
          : normalized?.status === 'stale' ? '当前为最近成功快照，来源日期与更新时间以下方为准。'
            : normalized?.summary.departmentTodayGsvYuan === null ? '渠道数据或业务日期尚未齐全；未核验前不合计、不补 0。'
              : '公开经营摘要来自根数据；每 5 分钟检查更新，缺失项不补 0。' };
    },
    // Permission changes invalidate queued credentials without resetting an active
    // task's single-flight guard or allowing its late response to overwrite data.
    invalidate() { epoch += 1; denied.clear(); lastError = null; nextRetryAt = 0; failures = 0; },
    async settled() { await inflight?.promise; },
  };
}

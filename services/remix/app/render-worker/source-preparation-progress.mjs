// Display-only accounting. Never changes selection, approval, retry or effects.
export function sourcePreparationDisplayOutcome(source, error, versionManaged = false) {
  if (error) return ['SOURCE_ASR_UNAVAILABLE', 'SOURCE_BOUNDARY_UNAVAILABLE'].includes(error.code)
    ? 'review_required' : 'failed';
  if (versionManaged) {
    const review = source?.sourceSemanticReview;
    return review?.status === 'passed' && !review.recoverable && review.passedCount > 0 &&
      review.passedCount === review.totalCount ? 'passed' : 'review_required';
  }
  return source?.analysisStatus === 'ready' && source.speechSegments?.length ? 'passed' : 'review_required';
}

export function createSourcePreparationProgress({assetIds = [], sourceIds = [], localSourceIds = [], sources = []} = {}) {
  const entries = new Map();
  let revision = 0;
  const sourceLabel = id => sources.find(source => source.id === id)?.originalName || id;
  const set = (key, changes) => {
    const entry = entries.get(key);
    if (entry) Object.assign(entry, changes, {revision: ++revision});
  };
  for (const id of new Set(assetIds)) {
    const source = sources.find(item => item.materialCenterAssetId === id);
    entries.set(`asset:${id}`, {key: `asset:${id}`, kind: 'cloud', sourceId: source?.id || null,
      label: `云素材 #${id}`, status: 'queued', revision: 0});
  }
  for (const id of new Set(sourceIds)) entries.set(`source:${id}`, {key: `source:${id}`,
    kind: 'historical', sourceId: id, label: `历史来源 ${sourceLabel(id)}`, status: 'queued', revision: 0});
  for (const id of new Set(localSourceIds)) entries.set(`local:${id}`, {key:`local:${id}`,
    kind:'local',sourceId:id,label:`本地上传 ${sourceLabel(id)}`,status:'queued',revision:0});
  return {
    beginAsset(id) {set(`asset:${id}`, {status: 'running'});},
    bindAsset(id, source) {set(`asset:${id}`, {sourceId: source.id, label: `云素材 #${id} · ${source.originalName || source.id}`});},
    settleAsset(id, status) {set(`asset:${id}`, {status});},
    beginSource(id) {set(`source:${id}`, {status: 'running'});},
    settleSource(id, status) {set(`source:${id}`, {status});},
    beginLocalSource(id) {set(`local:${id}`, {status:'running'});},
    settleLocalSource(id,status) {set(`local:${id}`, {status});},
    report({finished = false, now, evidence = []} = {}) {
      const groups = new Map();
      for (const entry of entries.values()) {
        const key = entry.sourceId ? `source:${entry.sourceId}` : entry.key;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
      }
      const items = [...groups].map(([key, rows]) => {
        // A prepared cloud source is reused by the subsequent historical loop.
        // Its unstarted alias must not turn a real completion back into queued.
        const latest = [...rows].sort((a, b) => b.revision - a.revision)[0];
        return {key, sourceId: latest.sourceId, label: latest.label, status: latest.status,
          origins: [...new Set(rows.map(row => row.kind))]};
      });
      const totalCount = items.length;
      const count = status => items.filter(item => item.status === status).length;
      const passedCount = count('passed'), failedCount = count('failed'), reviewRequiredCount = count('review_required');
      const processedCount = passedCount + failedCount + reviewRequiredCount;
      const cloudCount = items.filter(item => item.origins.includes('cloud')).length;
      const historicalCount = items.filter(item => item.origins.includes('historical')).length;
      const localCount = items.filter(item => item.origins.includes('local')).length;
      const sharedCount = items.filter(item => item.origins.length > 1).length;
      const status = !totalCount ? 'completed' : !finished ? 'running' : passedCount === totalCount ? 'completed' : 'partial';
      return {status, totalCount, processedCount, passedCount, failedCount, reviewRequiredCount,
        currentItem: finished ? '' : items.filter(item => item.status === 'running').map(item => `${item.label}：准备中`).join('；'),
        summary: totalCount ? `已准备 ${passedCount}/${totalCount} 条来源；待复核 ${reviewRequiredCount} 条，失败 ${failedCount} 条`
          : '本轮没有来源准备操作；已有切片与来源记录保留',
        evidence: [`本轮去重来源 ${totalCount} 条：云素材 ${cloudCount} 条，历史准备 ${historicalCount} 条${localCount?`，本地上传 ${localCount} 条`:''}，同源复用 ${sharedCount} 条。`,
          ...evidence],
        sourcePreparationItems: items,
        completedAt: finished || !totalCount ? now : null};
    },
  };
}

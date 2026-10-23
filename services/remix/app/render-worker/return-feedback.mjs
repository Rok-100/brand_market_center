// Cloud-origin receipts are deliberately separate from automatic delivery state.
// Reading this cache must never enroll a manual cloud task into automatic retries.
export const hasPlatformQuarantine = (variant) =>
  variant?.platformReview?.status === 'needs_localization';

export function assertNoPlatformQuarantine(variant) {
  if (hasPlatformQuarantine(variant)) {
    const error = new Error('此成片有千川明确拒绝记录，需完成问题定位并生成修正版；不能直接审核通过、回传或继续推送。');
    error.statusCode = 409;
    throw error;
  }
}

export async function refreshReturnFeedback({
  readLibrary,
  updateLibrary,
  materialCenter,
  now = Date.now(),
  canSaveFeedback = () => true,
  priorityFeedback = () => 0,
  onCompanyReview,
  pollDelayMs = () => 15 * 60_000,
}) {
  if (!materialCenter.configured || !materialCenter.getReturnFeedback) return;
  const library = await readLibrary();
  const eligible = (currentLibrary, render, variant) =>
    canSaveFeedback(currentLibrary,render,variant) && render.createdById &&
    render.visibility !== 'private' && variant.materialCenterReturn?.status === 'completed' &&
    variant.materialCenterReturn.idempotencyKey &&
    (!variant.cloudDeliveryFeedback?.nextPollAt || Date.parse(variant.cloudDeliveryFeedback.nextPollAt) <= now);
  const identity = (render, variant) => JSON.stringify([render.createdById,render.automation,
    variant.contentSha256,variant.materialCenterReturn?.idempotencyKey,Number(variant.materialCenterReturn?.assetId)]);
  const due = library.renders
    .flatMap((render) =>
      (render.variants || []).map((variant) => ({ render, variant })),
    )
    .filter(
      ({ render, variant }) => eligible(library,render,variant),
    )
    .sort((a, b) =>
      String(a.variant.cloudDeliveryFeedback?.nextPollAt || '').localeCompare(
        String(b.variant.cloudDeliveryFeedback?.nextPollAt || ''),
      ),
    );
  // Reserve half the existing six reads for authorized active automation. The
  // other half remains oldest-due-first for historical/manual feedback; either
  // lane can use unused seats. No task, native request or retry is created here.
  const prioritySet = new Set(due.filter(({render,variant})=>priorityFeedback(library,render,variant)>0));
  const reserved = [...due.filter(item=>prioritySet.has(item)).slice(0,3),...due.filter(item=>!prioritySet.has(item)).slice(0,3)];
  const reservedSet=new Set(reserved);
  const selected = [...reserved,...due.filter(item=>!reservedSet.has(item)).slice(0,6-reserved.length)]
    .map(item=>({...item,expectedIdentity:identity(item.render,item.variant),wasPriority:prioritySet.has(item)}));
  for (const selectedItem of selected) {
    const latestBeforeRead=await readLibrary();
    const render=latestBeforeRead.renders.find(item=>item.id===selectedItem.render.id);
    const variant=render?.variants.find(item=>item.id===selectedItem.variant.id);
    if(!variant||!eligible(latestBeforeRead,render,variant)
      ||identity(render,variant)!==selectedItem.expectedIdentity
      ||selectedItem.wasPriority&&!(priorityFeedback(latestBeforeRead,render,variant)>0))continue;
    const expectedFeedback=JSON.stringify(variant.cloudDeliveryFeedback??null);
    let result;
    let errorMessage = '';
    try {
      result = await materialCenter.getReturnFeedback({
        idempotencyKey: variant.materialCenterReturn.idempotencyKey,
        actorNumber: render.createdById,
        renderId: render.id,
        variantId: variant.id,
      });
      if (result.assetId !== Number(variant.materialCenterReturn.assetId))
        throw new Error('回传素材关联不匹配，已拒绝更新');
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : '云管家回执读取失败';
      result = undefined;
    }
    let saved=false;
    await updateLibrary((latest) => {
      const currentRender = latest.renders.find(
        (item) => item.id === render.id,
      );
      const current = currentRender?.variants.find(
        (item) => item.id === variant.id,
      );
      if (
        !current ||
        !eligible(latest,currentRender,current) ||
        identity(currentRender,current)!==selectedItem.expectedIdentity ||
        JSON.stringify(current.cloudDeliveryFeedback??null)!==expectedFeedback ||
        selectedItem.wasPriority&&!(priorityFeedback(latest,currentRender,current)>0)
      )
        return;
      const previous = current.cloudDeliveryFeedback || {};
      current.cloudDeliveryFeedback = {
        ...previous,
        ...(result
          ? {
              items: result.items.map((task) => ({
                ...task,
                taskId: task.id,
                attemptedAt: task.createdAt,
              })),
              assetAvailable: result.assetAvailable,
              complete: result.complete,
              checkedAt: new Date(now).toISOString(),
              ...(onCompanyReview?{companyReview:result.companyReview??null}:{}),
              ...(result.basicReview ? {basicReview:result.basicReview} : {}),
            }
          : {}),
        errorMessage: errorMessage.slice(0, 240),
        nextPollAt: new Date(now + pollDelayMs(latest,currentRender,current)).toISOString(),
      };
      saved=true;
      // Only an exact native REJECT receipt quarantines the output. Network
      // failures, no conversion, unknown enums and pending audit are not bans.
      const rejected = result?.items.find(task => task.platformAudit?.status === 'REJECT'
        && task.platformAudit.video_id === task.platformAssetId
        && task.platformAudit.source === 'qianchuan/uni_promotion/ad/material/get');
      if (rejected) {
        current.reviewStatus = 'changes_requested';
        current.platformReview = { ...rejected.platformAudit, taskId: rejected.id, status: 'needs_localization' };
        current.reviewNote = `千川明确卡审，已隔离此成片并停止继续回传/推送；平台未提供问题时间点，暂不删除来源切片。${(rejected.platformAudit.reasons || []).join('；')}`;
      }
    });
    // Consumer performs actual-file/current owner CAS. This hook never grants
    // approval from a missing, stale, pending or malformed company response.
    if(saved&&result?.companyReview&&onCompanyReview)await onCompanyReview({render,variant,review:result.companyReview});
  }
}

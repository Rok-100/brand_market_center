import type { Asset } from '../types'
import { ApiError } from '../api'

export type AssetLibrary = 'source' | 'remix'
export const assetLibrary = (asset: Pick<Asset, 'asset_library'>): AssetLibrary => asset.asset_library === 'remix' ? 'remix' : 'source'
export const assetKey = (asset: Pick<Asset, 'id' | 'asset_library'>) => `${assetLibrary(asset)}:${asset.id}`

// Retain completed groups while the modal stays open, so retrying a failed
// group does not resubmit tasks already accepted by the other library.
export function createBatchDelivery() {
  const completed = new Map<AssetLibrary, string[]>()
  return async (assets: Asset[], deliver: (assets: Asset[], library: AssetLibrary) => Promise<{ task_ids: string[]; message?: string }>) => {
    const messages: string[] = []
    const failures: string[] = []
    const failedTaskIds: string[] = []
    let failureStatus = 0
    for (const library of ['source', 'remix'] as const) {
      const group = assets.filter(asset => assetLibrary(asset) === library)
      if (!group.length || completed.has(library)) continue
      try {
        const result = await deliver(group, library)
        completed.set(library, result.task_ids)
        if (result.message) messages.push(result.message)
      } catch (cause) {
        if (cause instanceof ApiError) {
          failedTaskIds.push(...cause.taskIds)
          failureStatus = cause.status
        }
        failures.push(`${library === 'source' ? '原片' : '混剪'}：${cause instanceof Error ? cause.message : '推送失败'}`)
      }
    }
    const task_ids = [...completed.values()].flat()
    if (failures.length) throw new ApiError(`${failures.join('；')}${task_ids.length ? `；已有 ${task_ids.length} 个任务受理，再次确认只补交未受理部分` : ''}`, failureStatus, 1, failedTaskIds)
    return { task_ids, message: messages.join('；') }
  }
}

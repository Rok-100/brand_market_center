export type WorkspacePollReason = 'interval' | 'resume' | 'initial'

export const workspaceIsVisible = (target: Pick<Document, 'hidden' | 'documentElement'> = document) =>
  !target.hidden && target.documentElement.dataset.wisWorkspaceActive !== 'false'

// Only observation is paused. This never aborts uploads, mutations, or server jobs.
export function createWorkspacePoller(options: {
  run: (reason: WorkspacePollReason) => void | Promise<void>
  intervalMs: number
  immediate?: boolean
  target?: Pick<Document, 'hidden' | 'documentElement' | 'addEventListener' | 'removeEventListener'>
  clock?: Pick<Window, 'setTimeout' | 'clearTimeout'>
}) {
  const target = options.target || document
  const clock = options.clock || window
  let stopped = true
  let visible = false
  let inFlight = false
  let resumePending = false
  let timer: number | undefined
  const clear = () => { if (timer !== undefined) clock.clearTimeout(timer); timer = undefined }
  const schedule = (reason: WorkspacePollReason, delay: number) => {
    clear()
    if (!stopped && visible) timer = clock.setTimeout(() => { timer = undefined; void refresh(reason) }, delay)
  }
  const refresh = async (reason: WorkspacePollReason) => {
    if (stopped || !visible) return
    if (inFlight) { if (reason === 'resume') resumePending = true; return }
    inFlight = true
    try { await options.run(reason) }
    catch { /* The owning component retains and displays its own read error. */ }
    finally {
      inFlight = false
      const nextReason = resumePending ? 'resume' : 'interval'
      resumePending = false
      schedule(nextReason, nextReason === 'resume' ? 0 : options.intervalMs)
    }
  }
  const visibilityChanged = () => {
    const next = workspaceIsVisible(target)
    if (next === visible) return
    visible = next
    clear()
    if (visible) {
      if (inFlight) resumePending = true
      else schedule('resume', 0)
    }
  }
  return {
    start() {
      if (!stopped) return
      stopped = false
      visible = workspaceIsVisible(target)
      target.addEventListener('visibilitychange', visibilityChanged)
      target.addEventListener('wis:workspace-visibility', visibilityChanged)
      schedule(options.immediate ? 'initial' : 'interval', options.immediate ? 0 : options.intervalMs)
    },
    stop() {
      stopped = true
      resumePending = false
      clear()
      target.removeEventListener('visibilitychange', visibilityChanged)
      target.removeEventListener('wis:workspace-visibility', visibilityChanged)
    },
  }
}

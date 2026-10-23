import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'
import { createWorkspacePoller, type WorkspacePollReason } from './workspacePolling'

export function useWorkspacePolling(run: (reason: WorkspacePollReason) => void | Promise<void>, intervalMs: number, immediate = false) {
  const poller = createWorkspacePoller({ run, intervalMs, immediate })
  onMounted(poller.start)
  onActivated(poller.start)
  onDeactivated(poller.stop)
  onBeforeUnmount(poller.stop)
  return poller
}

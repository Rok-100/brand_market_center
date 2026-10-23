export function isPushRecovering(task: { binding_evidence: Record<string, unknown> }) {
  const state = task.binding_evidence?._recovery as { state?: string } | undefined
  return state?.state === 'waiting' || state?.state === 'running'
}

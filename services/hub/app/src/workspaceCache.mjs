// Oldest ordinary inactive pages can be reclaimed; drafts and running jobs
// stay mounted until the child explicitly reports that they are safe.
export function trimWorkspaces(entries, activeId, maxInactive = 3) {
  let remaining = entries.filter(entry => entry.id !== activeId && !entry.protected).length;
  return entries.filter(entry => {
    if (entry.id === activeId || entry.protected || remaining <= maxInactive) return true;
    remaining -= 1;
    return false;
  });
}
export function visitWorkspace(entries, id, request = '') {
  if (!id) return entries;
  const current = entries.find(entry => entry.id === id);
  const next = current ? { ...current, request, lastVisited: Date.now() } : { id, request, protected: true, lastVisited: Date.now() };
  return trimWorkspaces([...entries.filter(entry => entry.id !== id), next], id);
}
// Clean pages get an idle lifetime as well as a count limit. Unknown/busy/draft
// states are protected; they never expire merely because their tab is hidden.
export function expireWorkspaces(entries, activeId, now = Date.now(), ttlMs = 600_000) {
  const next = entries.filter(entry => entry.id === activeId || entry.protected || now - (entry.lastVisited ?? now) < ttlMs);
  return next.length === entries.length ? entries : next;
}
export function protectWorkspace(entries, id, protectedValue, activeId) {
  if (!entries.some(entry => entry.id === id && entry.protected !== protectedValue)) return entries;
  return trimWorkspaces(entries.map(entry => entry.id === id ? { ...entry, protected: protectedValue } : entry), activeId);
}

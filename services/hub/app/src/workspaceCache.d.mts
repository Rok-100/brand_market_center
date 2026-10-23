export type WorkspaceEntry = { id: string; request: string; protected: boolean; lastVisited?: number };
export function expireWorkspaces(entries: WorkspaceEntry[], activeId: string | null, now?: number, ttlMs?: number): WorkspaceEntry[];
export function trimWorkspaces(entries: WorkspaceEntry[], activeId: string | null, maxInactive?: number): WorkspaceEntry[];
export function visitWorkspace(entries: WorkspaceEntry[], id: string | null, request?: string): WorkspaceEntry[];
export function protectWorkspace(entries: WorkspaceEntry[], id: string, protectedValue: boolean, activeId: string | null): WorkspaceEntry[];

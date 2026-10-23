import { canReadSource } from './asset-access.mjs';

export function frameworkReadable(library, framework, identity, presets = [], seen = new Set()) {
  if (!framework || seen.has(framework.id)) return false;
  seen.add(framework.id);
  if (framework.visibility === 'private' && (!identity?.id || framework.createdById !== identity.id)) return false;
  if (framework.sourceId && !canReadSource(library.sources.find(s => s.id === framework.sourceId), identity)) return false;
  const parentId = framework.promotedFromId || framework.derivedFromFrameworkId;
  if (parentId) {
    const parent = library.frameworks.find(f => f.id === parentId) || presets.find(f => f.id === parentId);
    if (!frameworkReadable(library, parent, identity, presets, seen)) return false;
  }
  return true;
}

export function effectiveClipVisibility(clip, source) {
  // Missing provenance must never be described as safe to share.
  return !source || clip.visibility === 'private' || source.visibility === 'private' ? 'private' : 'team';
}

export function compositionVisibility(library, baseFramework, clips, presets = []) {
  // Inspect the persisted base, not a draft which temporarily has the same ID
  // as its parent. Otherwise every edited framework looks like a cycle.
  if (!frameworkReadable(library, baseFramework, null, presets)) return 'private';
  return clips.some(c => effectiveClipVisibility(c, library.sources.find(s => s.id === c.sourceId)) === 'private') ? 'private' : 'team';
}

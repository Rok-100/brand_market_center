import { Button } from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { AppModule } from './types';
import { embeddedCloudAsset } from './moduleLocation';
import { expireWorkspaces, protectWorkspace, visitWorkspace } from './workspaceCache.mjs';
import type { WorkspaceEntry } from './workspaceCache.mjs';

const release = '20261010-r7';
const base = String(import.meta.env.VITE_HUB_PUBLIC_BASE_PATH || '/yxb/wis-marketing-hub/').replace(/\/+$/u, '');
const sharedAsset = (name: string) => `${base}/ui/${name}?v=${release}`;

function isEmptyInitialDocument(frame: HTMLIFrameElement | null) {
  try {
    const body = frame?.contentDocument?.body;
    return Boolean(frame?.isConnected && frame.contentWindow?.location.href === 'about:blank'
      && body && body.childElementCount === 0 && !body.textContent?.trim());
  } catch { return false; } // An unreadable or real document is never safe to replace.
}

function attachExperience(frame: HTMLIFrameElement, module: AppModule) {
  try {
    const doc = frame.contentDocument;
    const current = frame.contentWindow?.location;
    if (!doc?.head || !current || current.origin !== window.location.origin) return;
    const target = new URL(module.url || '', window.location.href);
    const moduleRoot = `${target.pathname.split('/modules/')[0]}/modules/${target.pathname.split('/modules/')[1]?.split('/')[0]}/`;
    if (!current.pathname.startsWith(moduleRoot)) return;
    // This page hydrates the entire HTML document. The shared shell waits for
    // its client-loaded identity before touching HTML attributes or the head.
    // Until then its original SSR layout stays fully usable.
    if (module.id === 'creative-hub') {
      const identity = doc.querySelector('.profile small')?.textContent?.trim();
      if (!identity || identity === 'OA IDENTITY') return;
    }
    doc.documentElement.dataset.wisEmbedded = "true";
    doc.documentElement.dataset.wisUiModule = module.id;
    doc.documentElement.dataset.wisUiBase = `${base}/ui/`;
    if (doc.documentElement.dataset.wisUiRelease === release) return;
    if (!doc.querySelector('link[data-wis-experience]')) {
      const style = doc.createElement('link');
      style.rel = 'stylesheet'; style.href = sharedAsset('wis-experience.css');
      style.dataset.wisExperience = release; doc.head.appendChild(style);
    }
    if (!doc.querySelector('script[data-wis-experience]')) {
      const script = doc.createElement('script');
      script.src = sharedAsset('wis-experience.js'); script.dataset.module = module.id;
      script.dataset.wisExperience = release; doc.head.appendChild(script);
    }
  } catch { /* Authentication and external pages never receive the UI layer. */ }
}

function ModulePage({ module, active, request, register, onProtection }: {
  module: AppModule; active: boolean; request: string;
  register: (id: string, frame: HTMLIFrameElement | null) => void;
  onProtection: (id: string, protectedValue: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [recovery, setRecovery] = useState({ generation: 0, nonce: '' });
  const automaticallyRecovered = useRef(false);
  const reloadTimer = useRef(0);
  const [documentMs, setDocumentMs] = useState<number | null>(null);
  const startedAt = useRef(performance.now());
  const initialRequest = useRef(request);
  const lastAssetRequest = useRef(initialRequest.current);
  const url = useMemo(() => {
    const target = new URL(module.url || 'about:blank', window.location.href);
    target.searchParams.set('hub_embed_release', release);
    target.searchParams.set('hub_session_attempt', String(attempt));
    if (recovery.nonce) target.searchParams.set('hub_recovery_nonce', recovery.nonce);
    const asset = module.id === 'cloud-manager' ? embeddedCloudAsset(initialRequest.current) : null;
    if (asset) {
      target.searchParams.set('asset_id', asset.id);
      if (asset.etag) target.searchParams.set('asset_etag', asset.etag);
    }
    return `${target.pathname}${target.search}${target.hash}`;
  }, [module.url, attempt, module.id, recovery.nonce]);
  const standaloneUrl = useMemo(() => {
    try {
      const target = new URL(module.url || '', window.location.href);
      return module.url && target.origin === window.location.origin ? target.href : null;
    } catch { return null; }
  }, [module.url]);
  const reconnectBlank = (automatic = false) => {
    if (loaded || !isEmptyInitialDocument(frame.current) || automatic && automaticallyRecovered.current) return false;
    if (automatic) automaticallyRecovered.current = true;
    window.clearTimeout(reloadTimer.current);
    setDocumentMs(null); setFailed(false); setSlow(false);
    // Replace only the untouched initial document. A distinct URL prevents a
    // previous blank navigation's cache result from carrying into recovery.
    setRecovery(value => ({ generation: value.generation + 1, nonce: `${Date.now().toString(36)}-${value.generation + 1}-${Math.random().toString(36).slice(2)}` }));
    setAttempt(value => value + 1);
    return true;
  };
  useLayoutEffect(() => {
    register(module.id, frame.current);
    return () => { register(module.id, null); window.clearTimeout(reloadTimer.current); };
  }, [module.id, register, recovery.generation]);
  useEffect(() => {
    if (loaded || failed) return;
    startedAt.current = performance.now();
    const slowTimer = window.setTimeout(() => {
      if (!reconnectBlank(true)) setSlow(true);
    }, 12_000);
    // iframe load waits for images and third-party resources. Release the cover
    // when the same-origin application document is already usable, while keeping
    // the child's own data and authentication states intact.
    let timer = 0, stopped = false;
    const probe = () => {
      if (stopped) return;
      const node = frame.current;
      try {
        const doc = node?.contentDocument, current = node?.contentWindow?.location;
        const expected = new URL(module.url || '', window.location.href);
        const moduleRoot = expected.pathname.split('/modules/')[0] + '/modules/' + expected.pathname.split('/modules/')[1]?.split('/')[0] + '/';
        if (doc && current?.origin === location.origin && current.pathname.startsWith(moduleRoot) && doc.readyState !== 'loading' && (doc.body?.textContent?.trim().length || 0) > 24) {
          attachExperience(node!, module);
          setDocumentMs(Math.round(performance.now() - startedAt.current));
          setLoaded(true); setSlow(false); return;
        }
      } catch { /* The authentication page owns its own display. */ }
      if (!stopped && performance.now() - startedAt.current < 60_000) timer = window.setTimeout(probe, 200);
    };
    probe();
    return () => { stopped = true; window.clearTimeout(timer); window.clearTimeout(slowTimer); };
  }, [loaded, failed, attempt, module, recovery.generation]);
  const sendVisibility = () => frame.current?.contentWindow?.postMessage({ type: 'wis:workspace-visibility', active }, window.location.origin);
  useEffect(() => { sendVisibility(); }, [active, loaded, recovery.generation]);
  useEffect(() => {
    if (!active || !loaded || request === lastAssetRequest.current || module.id !== 'cloud-manager') return;
    const asset = embeddedCloudAsset(request);
    if (!asset) return;
    frame.current?.contentWindow?.postMessage({ type: 'wis:workspace-open-asset', id: asset.id, etag: asset.etag }, window.location.origin);
    lastAssetRequest.current = request;
  }, [active, loaded, request, module.id]);
  const handleLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    if (event.currentTarget !== frame.current) return;
    try {
      if (event.currentTarget.contentWindow?.location.href === 'about:blank') return;
    } catch { /* A real external/authentication document keeps its own UI. */ }
    setLoaded(true); setFailed(false); setSlow(false);
    setDocumentMs(value => value ?? Math.round(performance.now() - startedAt.current));
    try {
      const current = new URL(event.currentTarget.contentWindow?.location.href || '');
      if (current.pathname.endsWith('/access-denied.html') && current.searchParams.get('reason') === 'service' && attempt < 1) {
        setLoaded(false);
        reloadTimer.current = window.setTimeout(() => setAttempt(value => value + 1), 250);
        return;
      }
    } catch { /* Leave the external/authentication page's own result intact. */ }
    attachExperience(event.currentTarget, module);
    sendVisibility();
  };
  const retry = () => {
    // Never replace an existing application, even if its load event is late.
    reconnectBlank();
  };
  const canReconnect = !loaded && isEmptyInitialDocument(frame.current);
  return <main hidden={!active} className={`embedded-module-page${active ? ' workspace-visible' : ''}`} aria-label={`${module.purpose}工作区`} data-workspace={module.id} data-document-ready-ms={documentMs ?? undefined}>
    {!loaded && !failed && <div className="workspace-loading" role="status" aria-live="polite">
      <span className="workspace-loading-progress" aria-hidden="true"/><strong>正在打开{module.purpose}</strong>
      <p>{slow ? "应用响应较慢，可继续等待或重新连接；服务器上已有任务会保留。" : "正在连接应用，内容准备好后即可操作。"}</p><small>你可以先切换到其他工作区。</small>
      {slow && canReconnect && <Button appearance="secondary" icon={<ArrowClockwiseRegular />} onClick={retry}>重新打开</Button>}
      {slow && standaloneUrl && <a href={standaloneUrl} target="_blank" rel="noopener">在新窗口打开</a>}
    </div>}
    {failed && <div className="workspace-loading" role="alert"><p>页面连接未完成，请重新打开。已有服务器任务仍保留。</p>{canReconnect && <Button icon={<ArrowClockwiseRegular />} onClick={retry}>重新打开</Button>}{standaloneUrl && <a href={standaloneUrl} target="_blank" rel="noopener">在新窗口打开</a>}</div>}
    <iframe key={recovery.generation} ref={frame} className="embedded-module-frame" title={module.purpose} src={url} onLoad={handleLoad} onError={(event) => { if (event.currentTarget !== frame.current) return; setFailed(true); onProtection(module.id, false); }} allowFullScreen />
  </main>;
}

export function ModuleWorkspaceCache({ modules, activeId, request }: {
  modules: AppModule[]; activeId: string | null; request: string;
}) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>(() => visitWorkspace([], activeId, request));
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const register = useMemo(() => (id: string, node: HTMLIFrameElement | null) => {
    if (node) frames.current.set(id, node); else frames.current.delete(id);
  }, []);
  const protection = useMemo(() => (id: string, value: boolean) => {
    setEntries(current => protectWorkspace(current, id, value, activeId));
  }, [activeId]);
  useLayoutEffect(() => {
    if (activeId) setEntries(current => visitWorkspace(current, activeId, request));
  }, [activeId, request]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
      const entry = [...frames.current].find(([, frame]) => frame.contentWindow === event.source);
      if (!entry) return;
      const [id, frame] = entry;
      if (event.data.type === 'wis:workspace-state' && typeof event.data.busy === 'boolean' && typeof event.data.dirty === 'boolean') protection(id, event.data.busy || event.data.dirty);
      if (event.data.type === 'wis:workspace-ready') frame.contentWindow?.postMessage({ type: 'wis:workspace-visibility', active: id === activeId }, window.location.origin);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [activeId, protection]);
  const visited = new Map(entries.map(entry => [entry.id, entry]));
  useEffect(() => {
    const timer = window.setInterval(() => setEntries(current => expireWorkspaces(current, activeId)), 60_000);
    return () => window.clearInterval(timer);
  }, [activeId]);
  return <div className="module-workspace-cache" hidden={!activeId}>
    {/* Keep DOM order stable. Moving an existing iframe for LRU order can
        reload its document even when React preserves the component key. */}
    {modules.filter(module => visited.has(module.id)).map(module => <ModulePage key={module.id} module={module} active={module.id === activeId} request={visited.get(module.id)!.request} register={register} onProtection={protection} />)}
  </div>;
}

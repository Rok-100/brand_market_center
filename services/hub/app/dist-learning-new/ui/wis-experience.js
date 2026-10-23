/* WIS interaction layer. UI-only: no API requests, task writes or auth changes. */
(() => {
  'use strict';
  const version = '20261010-r7';
  const previousVersion = window.__wisUiExperienceVersion;
  if (previousVersion === version) return;
  window.__wisUiExperienceVersion = version;
  const root = document.documentElement;
  root.dataset.wisUiRelease = version;
  root.dataset.wisUiModule = document.currentScript?.dataset.module || root.dataset.wisUiModule || (location.pathname.includes('/modules/cloud-manager/') ? 'cloud-manager' : 'central-hub');
  // Only the same-origin WIS shell can opt a document into compact chrome.
  if (window.parent !== window) {
    try {
      const parentLocation = window.parent.location;
      const scope = location.pathname.split('/modules/')[0] + '/';
      if (parentLocation.origin === location.origin && parentLocation.pathname.startsWith(scope)) root.dataset.wisEmbedded = 'true';
    } catch { /* A standalone or external embed keeps the complete module shell. */ }
  }
  // An open r1 workspace already owns focus, inert and draft handlers. Reuse
  // those handlers during a UI-only rollout instead of stacking a second set.
  if (previousVersion) {
    const upgradeLayout = () => {
      prepareEmbeddedLayout();
      new MutationObserver(prepareEmbeddedLayout).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', upgradeLayout, { once: true }); else upgradeLayout();
    return;
  }
  let active = window.parent === window;
  let raf = 0;
  let visibilityReceived = false;
  const childVisibility = new WeakMap();
  let lastState = '';
  let topDialog = null;
  let scrollState = null;
  const dialogs = new Map();
  const drafts = new Set();
  const closeConfirmed = new WeakSet();
  const refusedBackdrop = new WeakMap();
  const inertState = new Map();
  const childFrames = new Map();
  const pendingChildLayouts = new Map();
  const moduleNames = new Set(['data-center','dispatch-center','live-room-management','live-calendar','live-data','live-dispatch','creative-hub','ai-first-creation','material-workbench','cloud-manager','data-dashboard']);
  const sharedBase = root.dataset.wisUiBase || location.pathname.split('/modules/')[0].replace(/\/+$/u, '') + '/ui/';
  const dialogSelector = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"],dialog[open]';
  const closeSelector = 'button[aria-label^="关闭"],button[title="关闭"],[data-ui-close]';
  const controls = 'a[href],button,input,textarea,select,[tabindex]';

  function visible(node) {
    if (!node.isConnected || node.closest('[hidden],[aria-hidden="true"]')) return false;
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }
  function focusable(dialog) {
    return [...dialog.querySelectorAll(controls)].filter(el => !el.disabled && el.tabIndex >= 0 && visible(el) && !el.closest('[inert]'));
  }
  function focusDialog(dialog) {
    if (!active || dialog.contains(document.activeElement)) return;
    const fields = focusable(dialog);
    const target = fields.find(el => el.matches('[autofocus],input:not([type="file"]):not([type="checkbox"]),textarea,select')) || fields[0] || dialog;
    target.focus({ preventScroll: true });
  }
  function resetBackground() {
    for (const [el, prior] of inertState) {
      if (prior === null) el.removeAttribute('inert'); else el.setAttribute('inert', prior);
    }
    inertState.clear();
    if (scrollState && document.body) {
      document.body.style.overflow = scrollState.overflow;
      document.body.style.paddingRight = scrollState.paddingRight;
      scrollState = null;
    }
  }
  function protectBackground(dialog) {
    if (!scrollState) {
      scrollState = { overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight };
      const gutter = Math.max(0, window.innerWidth - root.clientWidth);
      if (gutter > 0 && root.clientWidth > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + gutter}px`;
      document.body.style.overflow = 'hidden';
    }
    for (let branch = dialog; branch?.parentElement; branch = branch.parentElement) {
      for (const el of [...branch.parentElement.children]) {
        if (el === branch || el.matches('script,style,link')) continue;
        if (!inertState.has(el)) inertState.set(el, el.getAttribute('inert'));
        el.setAttribute('inert', '');
      }
      if (branch.parentElement === document.body) break;
    }
  }
  function layerZ(dialog) {
    let value = 0;
    for (let el = dialog; el && el !== document.body; el = el.parentElement) {
      const n = Number.parseInt(getComputedStyle(el).zIndex, 10);
      if (Number.isFinite(n)) value = Math.max(value, n);
    }
    return value;
  }
  function sendChildVisibility(frame, force = false) {
    const shown = active && visible(frame);
    if (!force && childVisibility.get(frame) === shown) return;
    childVisibility.set(frame, shown);
    frame.contentWindow?.postMessage({type: 'wis:workspace-visibility', active: shown}, location.origin);
  }
  function publishState() {
    for (const field of drafts) if (!field.isConnected) drafts.delete(field);
    for (const frame of childFrames.keys()) if (!frame.isConnected) childFrames.delete(frame);
    const busy = Boolean(document.querySelector('[data-workspace-busy="true"],.upload-stage')) || [...childFrames.values()].some(state => state.busy);
    const dirty = Boolean(document.querySelector('[data-workspace-dirty="true"]')) || drafts.size > 0 || [...childFrames.values()].some(state => state.dirty);
    const state = JSON.stringify({ busy, dirty });
    if (state === lastState) return;
    lastState = state;
    if (window.parent !== window) window.parent.postMessage({ type: 'wis:workspace-state', version, busy, dirty }, window.location.origin);
  }
  function refresh() {
    raf = 0;
    syncChildren();
    if (active) prepareEmbeddedLayout();
    if (!active) { resetBackground(); topDialog = null; publishState(); return; }
    const found = active ? [...document.querySelectorAll(dialogSelector)].filter(visible) : [];
    const lastTop = topDialog;
    let returnFocus = null;
    for (const [dialog, prior] of dialogs) {
      if (found.includes(dialog)) continue;
      dialog.removeAttribute('data-wis-dialog');
      if (prior.tabindex === null) dialog.removeAttribute('tabindex'); else dialog.setAttribute('tabindex', prior.tabindex);
      dialogs.delete(dialog);
      if (active && dialog === lastTop && prior.focus?.isConnected && visible(prior.focus)) returnFocus = prior.focus;
      for (const field of drafts) if (dialog.contains(field)) drafts.delete(field);
    }
    for (const dialog of found) {
      if (dialogs.has(dialog)) continue;
      dialogs.set(dialog, { focus: document.activeElement, tabindex: dialog.getAttribute('tabindex') });
      if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
      dialog.setAttribute('data-wis-dialog', '');
    }
    topDialog = found.sort((a, b) => layerZ(a) - layerZ(b)).at(-1) || null;
    resetBackground();
    if (returnFocus && (!topDialog || topDialog.contains(returnFocus))) returnFocus.focus({ preventScroll: true });
    if (topDialog) {
      protectBackground(topDialog);
      if (topDialog !== lastTop) focusDialog(topDialog);
    }
    publishState();
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(refresh);
  }
  function attachChild(frame) {
    try {
      const current = frame.contentWindow.location;
      const name = current.pathname.split('/modules/')[1]?.split('/')[0];
      const scope = sharedBase.replace(/\/ui\/$/, '/modules/');
      if (current.origin !== location.origin || !current.pathname.startsWith(scope) || !moduleNames.has(name)) return;
      const doc = frame.contentDocument;
      if (!doc?.head) return;
      if (name === 'creative-hub') {
        const identity = doc.querySelector('.profile small')?.textContent?.trim();
        if (!identity || identity === 'OA IDENTITY') {
          if (doc.body && !pendingChildLayouts.has(frame)) {
            const observer = new MutationObserver(() => {
              if (!frame.isConnected || frame.contentDocument !== doc) { stop(); return; }
              const ready = doc.querySelector('.profile small')?.textContent?.trim();
              if (ready && ready !== 'OA IDENTITY') { stop(); attachChild(frame); }
            });
            const stop = () => { observer.disconnect(); window.clearTimeout(timer); pendingChildLayouts.delete(frame); };
            const timer = window.setTimeout(stop, 30000);
            pendingChildLayouts.set(frame, stop);
            // The SSR hydration root can replace body/html. Observe the
            // document so the client identity remains a reliable readiness signal.
            observer.observe(doc, { childList: true, subtree: true, characterData: true });
          }
          return;
        }
        pendingChildLayouts.get(frame)?.();
      }
      doc.documentElement.dataset.wisEmbedded = "true";
      doc.documentElement.dataset.wisUiBase = sharedBase;
      doc.documentElement.dataset.wisUiModule = name === 'live-calendar' ? 'live-room-management' : name;
      if (doc.documentElement.dataset.wisUiRelease !== version && !doc.querySelector('script[data-wis-experience]')) {
        const style = doc.createElement('link'); style.rel = 'stylesheet'; style.href = sharedBase + 'wis-experience.css?v=' + version; style.dataset.wisExperience = version; doc.head.appendChild(style);
        const script = doc.createElement('script'); script.src = sharedBase + 'wis-experience.js?v=' + version; script.dataset.wisExperience = version; doc.head.appendChild(script);
      }
      sendChildVisibility(frame, true);
    } catch { /* Never inspect external or authentication frames. */ }
  }
  function syncChildren() {
    for (const [frame, stop] of pendingChildLayouts) if (!frame.isConnected) stop();
    for (const frame of document.querySelectorAll('iframe')) {
      const target = new URL(frame.getAttribute('src') || 'about:blank', location.href);
      if (target.origin !== location.origin || !target.pathname.startsWith(sharedBase.replace(/\/ui\/$/, '/modules/')) || !moduleNames.has(target.pathname.split('/modules/')[1]?.split('/')[0])) continue;
      if (!childFrames.has(frame)) {
        childFrames.set(frame, {busy: true, dirty: false});
        frame.addEventListener('load', () => { childFrames.set(frame, {busy: true, dirty: false}); attachChild(frame); });
        attachChild(frame);
      }
      sendChildVisibility(frame);
    }
  }
  function dirtyDialog(dialog) {
    return dialog.matches('[data-workspace-dirty="true"]') || Boolean(dialog.querySelector('[data-workspace-dirty="true"]')) ||
      [...dialog.querySelectorAll('input[type="file"]')].some(input => input.files?.length) ||
      [...drafts].some(field => dialog.contains(field));
  }
  function mayClose(dialog) {
    if (dialog.matches('[data-workspace-busy="true"]') || dialog.querySelector('[data-workspace-busy="true"]')) return false;
    if (!dirtyDialog(dialog) || closeConfirmed.has(dialog)) return true;
    if (!window.confirm('关闭窗口会丢弃尚未提交的内容。确认关闭？')) return false;
    closeConfirmed.add(dialog);
    return true;
  }
  document.addEventListener('keydown', event => {
    if (!active || !topDialog) return;
    if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
      const close = topDialog.querySelector(closeSelector);
      if (close && !close.disabled && mayClose(topDialog)) {
        event.preventDefault(); event.stopPropagation(); close.click();
      }
    } else if (event.key === 'Tab') {
      const fields = focusable(topDialog);
      const first = fields[0], last = fields.at(-1);
      if (!first) { event.preventDefault(); topDialog.focus({ preventScroll: true }); }
      else if (!topDialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    }
  }, true);
  document.addEventListener('focusin', event => {
    if (!active || !topDialog || topDialog.contains(event.target) || event.target.closest?.('[role="listbox"],[role="menu"]')) return;
    focusDialog(topDialog);
  });
  document.addEventListener('click', event => {
    if (!active || !topDialog) return;
    const button = event.target.closest?.('button,[data-ui-close]');
    const isClose = button && topDialog.contains(button) && (button.matches(closeSelector) || /^(取消|关闭)$/.test(button.textContent.trim()));
    const isBackdrop = !topDialog.contains(event.target) && event.target.contains?.(topDialog);
    if (!isClose && !isBackdrop) return;
    if (isBackdrop && performance.now() - (refusedBackdrop.get(event.target) ?? -1000) < 500) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (!mayClose(topDialog)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('mousedown', event => {
    if (!active || !topDialog || topDialog.contains(event.target) || !event.target.contains?.(topDialog)) return;
    if (!mayClose(topDialog)) { refusedBackdrop.set(event.target, performance.now()); event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('input', event => {
    const field = event.target;
    if (!field.matches?.('textarea,[data-preserve-draft] input:not([type="search"]),[data-preserve-draft] select')) return;
    if (String(field.value || '').trim()) drafts.add(field); else drafts.delete(field);
    const dialog = field.closest(dialogSelector);
    if (dialog) closeConfirmed.delete(dialog);
    publishState();
  }, true);
  document.addEventListener('reset', event => { for (const field of drafts) if (event.target.contains(field)) drafts.delete(field); publishState(); });
  document.addEventListener('wis:workspace-draft-saved', event => {
    const scope = event.target;
    for (const field of drafts) if (scope === document || scope.contains?.(field)) drafts.delete(field);
    publishState();
  });
  window.addEventListener('message', event => {
    if (event.origin === location.origin) {
      const child = [...childFrames.keys()].find(frame => frame.contentWindow === event.source);
      if (child && event.data?.type === 'wis:workspace-state' && typeof event.data.busy === 'boolean' && typeof event.data.dirty === 'boolean') { childFrames.set(child, {busy: event.data.busy, dirty: event.data.dirty}); publishState(); return; }
      if (child && event.data?.type === 'wis:workspace-ready') { sendChildVisibility(child, true); return; }
    }
    if (window.parent === window || event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== 'wis:workspace-visibility' || typeof event.data.active !== 'boolean') return;
    // A parent's load event can follow our earlier ready/state messages.
    // Repeat the state handshake without restarting business polling.
    if (visibilityReceived && active === event.data.active) { lastState = ''; publishState(); return; }
    visibilityReceived = true;
    const wasActive = active;
    active = event.data.active;
    lastState = '';
    root.dataset.wisWorkspaceActive = String(active);
    if (!active) for (const video of document.querySelectorAll('video,audio')) { if (!video.paused) video.pause(); }
    document.dispatchEvent(new CustomEvent('wis:workspace-visibility', { detail: { active } }));
    schedule();
    if (active && !wasActive) requestAnimationFrame(() => { if (topDialog) focusDialog(topDialog); });
  });
  function layoutToggle(header, sidebar, label) {
    if (!header || !sidebar || header.querySelector('[data-wis-layout-toggle]')) return;
    if (root.dataset.wisUiModule === 'creative-hub' && !root.hasAttribute('data-wis-module-nav-collapsed') && window.matchMedia('(max-width: 760px)').matches) root.dataset.wisModuleNavCollapsed = 'true';
    if (!sidebar.id) sidebar.id = 'wis-module-navigation';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'wis-module-toggle';
    button.dataset.wisLayoutToggle = ''; button.setAttribute('aria-label', label);
    button.title = label; button.setAttribute('aria-controls', sidebar.id);
    button.setAttribute('aria-expanded', root.dataset.wisModuleNavCollapsed !== 'true' ? 'true' : 'false');
    button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    button.addEventListener('click', () => {
      const collapsed = root.dataset.wisModuleNavCollapsed !== 'true';
      root.dataset.wisModuleNavCollapsed = String(collapsed);
      button.setAttribute('aria-expanded', String(!collapsed));
    });
    if (root.dataset.wisUiModule === 'creative-hub') {
      const closeOnSmallScreen = () => { root.dataset.wisModuleNavCollapsed = 'true'; button.setAttribute('aria-expanded', 'false'); };
      sidebar.addEventListener('click', event => { if (window.matchMedia('(max-width: 760px)').matches && event.target.closest('nav button')) closeOnSmallScreen(); });
      sidebar.addEventListener('keydown', event => { if (event.key === 'Escape' && window.matchMedia('(max-width: 760px)').matches) { closeOnSmallScreen(); button.focus(); } });
    }
    header.prepend(button);
  }
  function prepareEmbeddedLayout() {
    if (root.dataset.wisEmbedded !== 'true') return;
    if (root.dataset.wisUiModule === 'creative-hub') {
      layoutToggle(document.querySelector('.command-topbar'), document.querySelector('.command-sidebar'), '切换创意工作台导航');
    }
    if (root.dataset.wisUiModule !== 'material-workbench') return;
    // Mark the verified application shell; never change editor/dialog structures.
    const sidebar = [...document.querySelectorAll('main.w-full > div > div > aside')].find(el => el.parentElement.className.includes('lg:grid-cols-[208px_minmax(0,1fr)]'));
    if (sidebar) {
      sidebar.dataset.wisModuleNavigation = '';
      sidebar.parentElement.dataset.wisRemixShell = '';
      sidebar.parentElement.parentElement.dataset.wisRemixSurface = '';
      const scroller = sidebar.firstElementChild;
      if (scroller) scroller.dataset.wisRemixNavScroller = '';
      const column = scroller?.firstElementChild;
      if (column?.firstElementChild?.textContent.includes('二创混剪工作台')) column.firstElementChild.dataset.wisDuplicateBrand = '';
      const footer = column?.lastElementChild;
      if (footer && footer !== column.firstElementChild) {
        footer.dataset.wisRemixNavFooter = '';
        const identity = footer.querySelector('div.border');
        if (identity) identity.dataset.wisDuplicateIdentity = '';
      }
      const body = sidebar.nextElementSibling;
      const header = body?.querySelector(':scope > header');
      if (header) {
        header.dataset.wisRemixHeader = '';
        layoutToggle(header.firstElementChild, sidebar, '切换二创导航');
      }
      const content = body?.querySelector(':scope > div');
      if (content) content.dataset.wisRemixContent = '';
    }
    for (const folder of document.querySelectorAll('aside')) {
      if (!folder.parentElement.className.includes('xl:grid-cols-[220px_minmax(0,1fr)]')) continue;
      folder.dataset.wisFolderPanel = '';
      folder.parentElement.dataset.wisFolderGrid = '';
      if (folder.nextElementSibling) folder.nextElementSibling.dataset.wisFolderResults = '';
    }
  }
  function start() {
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal','aria-hidden','hidden','open','data-workspace-busy','data-workspace-dirty'] });
    refresh();
    if (window.parent !== window) window.parent.postMessage({ type: 'wis:workspace-ready', version, phase: 'document' }, window.location.origin);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();

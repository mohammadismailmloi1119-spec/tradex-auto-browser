// Auto TradeX Pro — Unblocker
// Runs at document_start in every frame. Forcibly breaks any site-side
// mechanism used to hide, remove, cover, or detect the extension panel.
(function () {
  'use strict';
  if (window.__wabUnblockerLoaded) return;
  window.__wabUnblockerLoaded = true;

  const OUR_IDS = ['wingo-ab-panel', 'wab-ball', 'wab-gate-overlay', 'wab-autostop-overlay', 'wab-log-lock', 'wab-armor', 'wab-armor-core'];
  const OUR_ID_PREFIX = ['wingo-ab-', 'wab-'];

  function isOurs(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      if (node.id && (OUR_IDS.includes(node.id) || OUR_ID_PREFIX.some(p => node.id.startsWith(p)))) return true;
      if (typeof node.closest === 'function') {
        if (node.closest('#wingo-ab-panel, #wab-ball, #wab-gate-overlay, #wab-autostop-overlay, #wab-log-lock')) return true;
      }
    } catch (_) {}
    return false;
  }

  // ── 1. Node-removal protection ─────────────────────────────────────────
  const origRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (isOurs(child)) return child;
    return origRemoveChild.call(this, child);
  };
  const origRemove = Element.prototype.remove;
  Element.prototype.remove = function () {
    if (isOurs(this)) return;
    return origRemove.apply(this, arguments);
  };
  const origReplaceWith = Element.prototype.replaceWith;
  if (origReplaceWith) {
    Element.prototype.replaceWith = function () {
      if (isOurs(this)) return;
      return origReplaceWith.apply(this, arguments);
    };
  }
  const origReplaceChildren = Element.prototype.replaceChildren;
  if (origReplaceChildren) {
    Element.prototype.replaceChildren = function () {
      // If this element contains any of ours, refuse
      try {
        if (this.querySelector && this.querySelector('#wingo-ab-panel, #wab-ball, #wab-gate-overlay')) return;
      } catch (_) {}
      return origReplaceChildren.apply(this, arguments);
    };
  }
  const origInnerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (origInnerHTMLDesc && origInnerHTMLDesc.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      enumerable: true,
      get: origInnerHTMLDesc.get,
      set: function (v) {
        try {
          if (this === document.body || this === document.documentElement) {
            if (this.querySelector && this.querySelector('#wingo-ab-panel, #wab-ball, #wab-gate-overlay')) {
              // Preserve our nodes
              const saved = [];
              this.querySelectorAll('#wingo-ab-panel, #wab-ball, #wab-gate-overlay, #wab-autostop-overlay, #wab-log-lock, #wab-armor, #wab-armor-core').forEach(n => saved.push(n));
              origInnerHTMLDesc.set.call(this, v);
              saved.forEach(n => { try { this.appendChild(n); } catch (_) {} });
              return;
            }
          }
        } catch (_) {}
        return origInnerHTMLDesc.set.call(this, v);
      }
    });
  }

  // ── 2. Style-lock protection on our nodes ──────────────────────────────
  const origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      if (isOurs(this) && typeof name === 'string') {
        const n = name.toLowerCase();
        if (n === 'style' && typeof value === 'string') {
          if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|pointer-events\s*:\s*none/i.test(value)) {
            // Silently strip hostile bits
            value = value
              .replace(/display\s*:\s*none[^;]*;?/gi, '')
              .replace(/visibility\s*:\s*hidden[^;]*;?/gi, '')
              .replace(/opacity\s*:\s*0[^;]*;?/gi, '')
              .replace(/pointer-events\s*:\s*none[^;]*;?/gi, '');
          }
        }
        if (n === 'hidden') return;
      }
    } catch (_) {}
    return origSetAttr.call(this, name, value);
  };
  const origSetProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (prop, value, priority) {
    try {
      const owner = this.parentRule ? null : (this.ownerNode || null);
      // Best-effort: check the element via a WeakMap set below in armor
      if (owner && isOurs(owner)) {
        const p = String(prop || '').toLowerCase();
        const v = String(value || '').toLowerCase();
        if ((p === 'display' && v === 'none') ||
            (p === 'visibility' && v === 'hidden') ||
            (p === 'opacity' && v === '0') ||
            (p === 'pointer-events' && v === 'none')) {
          return;
        }
      }
    } catch (_) {}
    return origSetProperty.call(this, prop, value, priority);
  };

  // ── 3. Armor CSS (injected as early as possible) ───────────────────────
  function injectArmor() {
    if (document.getElementById('wab-armor-core')) return;
    const target = document.head || document.documentElement;
    if (!target) return;
    const s = document.createElement('style');
    s.id = 'wab-armor-core';
    s.textContent = `
      #wingo-ab-panel, #wab-gate-overlay, #wab-autostop-overlay, #wab-log-lock, #wab-uid-gate {
        z-index: 2147483647 !important;
        pointer-events: auto !important;
        visibility: visible !important;
        opacity: 1 !important;
        filter: none !important;
        clip: auto !important;
        clip-path: none !important;
      }
      #wingo-ab-panel { position: fixed !important; }
      #wingo-ab-panel.hidden { display: none !important; }
      html, body { pointer-events: auto !important; }
      html, body { pointer-events: auto !important; }
    `;
    target.appendChild(s);
  }
  injectArmor();
  // Re-inject if the site removes it
  new MutationObserver(() => {
    if (!document.getElementById('wab-armor-core')) injectArmor();
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ── 4. Overlay killer + body-lock revert ───────────────────────────────
  function sweep() {
    try {
      // Revert hostile body/html locks
      [document.documentElement, document.body].forEach(el => {
        if (!el) return;
        const st = el.style;
        if (st.pointerEvents === 'none') st.pointerEvents = 'auto';
        if (st.userSelect === 'none') st.userSelect = '';
        // Only revert overflow lock if our panel is present
        if ((st.overflow === 'hidden' || st.overflowY === 'hidden') && document.getElementById('wingo-ab-panel')) {
          // leave scrollbars alone but keep interactivity
          st.pointerEvents = 'auto';
        }
      });

      // Neutralize sky-high overlays that aren't ours
      const nodes = document.querySelectorAll('body *');
      for (const el of nodes) {
        if (isOurs(el)) continue;
        const cs = getComputedStyle(el);
        const z = parseInt(cs.zIndex, 10);
        if (!isFinite(z)) continue;
        if (z >= 2147483000) {
          // Full-viewport or covers our panel: disable
          const r = el.getBoundingClientRect();
          const covers = r.width >= innerWidth * 0.6 && r.height >= innerHeight * 0.6;
          if (covers) {
            el.style.setProperty('pointer-events', 'none', 'important');
            el.style.setProperty('z-index', '0', 'important');
          }
        }
      }
    } catch (_) {}
  }
  setInterval(sweep, 1000);

  // ── 5. Hide extension presence from the page (chrome.runtime sniffing) ─
  try {
    const pageScript = document.createElement('script');
    pageScript.textContent = `
      (function(){
        try {
          if (window.chrome && window.chrome.runtime) {
            try { delete window.chrome.runtime; } catch(_){}
            try { Object.defineProperty(window.chrome, 'runtime', { get(){ return undefined; } }); } catch(_){}
          }
        } catch(_){}
      })();
    `;
    (document.documentElement || document.head).appendChild(pageScript);
    pageScript.remove();
  } catch (_) {}

  // ── 6. Anti-devtools / redirect guard ──────────────────────────────────
  const origSetInterval = window.setInterval;
  window.setInterval = function (fn, delay) {
    try {
      const src = typeof fn === 'function' ? fn.toString() : String(fn);
      if (/debugger/.test(src) && delay && delay < 500) {
        return 0; // no-op
      }
    } catch (_) {}
    return origSetInterval.apply(this, arguments);
  };

  const loadTime = Date.now();
  const origClose = window.close;
  window.close = function () {
    if (Date.now() - loadTime < 3000) return;
    return origClose.apply(this, arguments);
  };

  // Redirect guard: if site tries location.replace within 2s of our panel
  // mounting and no user gesture happened, cancel it.
  let userGestured = false;
  ['pointerdown', 'keydown', 'touchstart'].forEach(t =>
    window.addEventListener(t, () => { userGestured = true; }, { capture: true, passive: true })
  );
  const origReplace = Location.prototype.replace;
  Location.prototype.replace = function (url) {
    try {
      if (!userGestured && document.getElementById('wingo-ab-panel')) return;
    } catch (_) {}
    return origReplace.call(this, url);
  };

  // ── 7. Watchdog: re-append our nodes if they somehow get detached ──────
  const keep = new Set();
  function watchIfOurs(n) {
    if (isOurs(n)) keep.add(n);
  }
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes && m.addedNodes.forEach(watchIfOurs);
      m.removedNodes && m.removedNodes.forEach(n => {
        if (isOurs(n) && n.id !== 'wab-armor-core') {
          // Re-attach
          try {
            (document.body || document.documentElement).appendChild(n);
          } catch (_) {}
        }
      });
    }
  });
  const startObserve = () => {
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}
  };
  startObserve();
})();

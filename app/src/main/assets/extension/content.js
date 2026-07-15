(function () {
  'use strict';
  // Initialization guard: only block if the panel already exists in the DOM.
  // This allows the script to re-run or recover if the SPA wipes the DOM.
  if (window.__wingoAutobet && document.getElementById('wingo-ab-panel')) return;
  window.__wingoAutobet = true;

  // ─── KEY GATE CONFIGURATION ────────────────────────────────────────────────
  // ⚠️ UPDATE THIS URL AFTER DEPLOYING YOUR SERVER TO RENDER.COM
  const API_BASE_URL = 'https://auto-tradex-admin-2.onrender.com';
  const TELEGRAM_CONTACT = '@riyaz_ali_saifi';

  // ─── DEVICE FINGERPRINT ────────────────────────────────────────────────────
  function getDeviceId() {
    try {
      let id = localStorage.getItem('tradex_device_id');
      if (!id) {
        id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
        localStorage.setItem('tradex_device_id', id);
      }
      return id;
    } catch (_) { return 'dev_unknown'; }
  }

  // ─── KEY STORAGE ───────────────────────────────────────────────────────────
  function getStoredKey() {
    try { return localStorage.getItem('tradex_active_key') || ''; } catch (_) { return ''; }
  }
  function setStoredKey(key) {
    try { localStorage.setItem('tradex_active_key', key); } catch (_) {}
  }
  function getStoredKeyUID() {
    try { return localStorage.getItem('tradex_key_uid') || ''; } catch (_) { return ''; }
  }
  function setStoredKeyUID(uid) {
    try { localStorage.setItem('tradex_key_uid', uid); } catch (_) {}
  }
  function getKeyExpiry() {
    try { return localStorage.getItem('tradex_key_expiry') || ''; } catch (_) { return ''; }
  }
  function setKeyExpiry(expiry) {
    try { localStorage.setItem('tradex_key_expiry', expiry); } catch (_) {}
  }
  function clearKeyData() {
    try {
      localStorage.removeItem('tradex_active_key');
      localStorage.removeItem('tradex_key_uid');
      localStorage.removeItem('tradex_key_expiry');
    } catch (_) {}
  }

  // ─── KEY VALIDATION API ────────────────────────────────────────────────────
  async function validateKeyOnServer(key, uid, deviceId) {
    try {
      const res = await fetch(API_BASE_URL + '/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.toUpperCase().replace(/\s+/g, ''), uid: uid, deviceId: deviceId })
      });
      return await res.json();
    } catch (e) {
      return { success: false, status: 'connection_error', message: 'Could not reach server.' };
    }
  }

  async function checkDeviceOnServer(deviceId) {
    try {
      const res = await fetch(API_BASE_URL + '/api/check-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId })
      });
      return await res.json();
    } catch (e) {
      return { success: false, hasKey: false };
    }
  }

  // ─── STRATEGY: FIXED 8-STEP SEQUENCE ─────────────────────────────────────────
  // Single strategy. The bot bets EVERY period following this fixed pattern,
  // regardless of win or loss. After bet #8 it loops back to bet #1.
  // S = Small, B = Big.
  const STRATEGY_SEQUENCE = ['S', 'S', 'B', 'S', 'B', 'B', 'S', 'B'];
  const SEQ_LEN = STRATEGY_SEQUENCE.length;

  function stepNumber() {
    // 1-based bet number (1..8) for display / logs
    return (((state.stepIndex % SEQ_LEN) + SEQ_LEN) % SEQ_LEN) + 1;
  }

  function currentStepPrediction() {
    const idx = ((state.stepIndex % SEQ_LEN) + SEQ_LEN) % SEQ_LEN;
    return STRATEGY_SEQUENCE[idx];
  }

  // Kept the same name/shape so the rest of the code keeps working.
  // With the new strategy there is always a prediction and never a SKIP.
  function getCombinedPrediction() {
    const combined = currentStepPrediction();
    return { s1: combined, s2: combined, combined };
  }

  // ─── STATE ───────────────────────────────────────────────────────────────────
  const state = {
    running: false,
    // Martingale level system
    baseBet: 1,           // Level-1 bet amount (₹)
    martingaleMul: 2,     // Multiplier per loss level
    maxLevels: 5,         // Total martingale levels
    currentLevel: 1,      // Current active level (1 = base)
    pendingResult: false,          // Waiting for this bet's result?
    balanceBeforeBet: 0,           // Balance snapped just before placing
    lastHistoryPeriodNum: null,    // Period number of the most recent history row
    historyPeriodBeforeBet: null,  // Snapshot of lastHistoryPeriodNum taken at bet time
    // Session
    stopLoss: 999999,     // Default: Infinity (high value)
    target: 999999,       // Default: Infinity (high value)
    maxBets: 999999,      // Default: Infinity (high value)
    betsPlaced: 0,
    startBalance: 0,
    sessionProfit: 0,
    // Game data
    lastResults: [],
    lastNumbers: [],
    currentPrediction: null,
    s1Prediction: null,
    s2Prediction: null,
    // New fixed-sequence strategy position (0-based). NOT persisted → resets on refresh.
    stepIndex: 0,
    seqInitialized: false,
    betStep: 1,        // bet number (1..8) snapped at bet time, for win/loss logs
    monitorStep: 1,    // same, for watch (auto-bet OFF) mode
    gameType: '30s',
    log: [],
    lastBetPeriod: '',
    lastActivePeriod: '',
    betFired: false,
    lastBetAmount: 0,
    // Logs page lock
    logsUnlocked: false,
    // Monitoring mode martingale mirror (no real bets)
    monitorLevel: 1,
    monitorPendingResult: false,
    monitorPrediction: null,
    monitorHistoryPeriod: null,
    // UI state
    strategiesUnlocked: false,
    pwInputVisible: false,
    // Statistics tracking
    totalWins: 0,
    totalLosses: 0,
    totalSkipped: 0,
    maxWinStreak: 0,
    maxLossStreak: 0,
    currentWinStreak: 0,
    currentLossStreak: 0,
    // Auto-stop lock
    autoStopLocked: false,
    autoStopReason: '',
    loggedApiPeriods: new Set(),
  };

  function saveAppState() {
    const toSave = {
      baseBet: state.baseBet,
      martingaleMul: state.martingaleMul,
      maxLevels: state.maxLevels,
      stopLoss: state.stopLoss,
      target: state.target,
      maxBets: state.maxBets,
      betsPlaced: state.betsPlaced,
      sessionProfit: state.sessionProfit,
      startBalance: state.startBalance,
      totalWins: state.totalWins,
      totalLosses: state.totalLosses,
      totalSkipped: state.totalSkipped,
      maxWinStreak: state.maxWinStreak,
      maxLossStreak: state.maxLossStreak,
      log: state.log,
      currentLevel: state.currentLevel,
      monitorLevel: state.monitorLevel,
      lastBetAmount: state.lastBetAmount
    };
    trySave('wab_app_state', toSave);
  }

  function loadAppState() {
    const saved = tryLoad('wab_app_state');
    if (!saved) return;
    state.baseBet = saved.baseBet ?? state.baseBet;
    state.martingaleMul = saved.martingaleMul ?? state.martingaleMul;
    state.maxLevels = saved.maxLevels ?? state.maxLevels;
    state.stopLoss = saved.stopLoss ?? state.stopLoss;
    state.target = saved.target ?? state.target;
    state.maxBets = saved.maxBets ?? state.maxBets;
    state.betsPlaced = saved.betsPlaced ?? 0;
    state.sessionProfit = saved.sessionProfit ?? 0;
    state.startBalance = saved.startBalance ?? 0;
    state.totalWins = saved.totalWins ?? 0;
    state.totalLosses = saved.totalLosses ?? 0;
    state.totalSkipped = saved.totalSkipped ?? 0;
    state.maxWinStreak = saved.maxWinStreak ?? 0;
    state.maxLossStreak = saved.maxLossStreak ?? 0;
    state.log = saved.log ?? [];
    state.currentLevel = saved.currentLevel ?? 1;
    state.monitorLevel = saved.monitorLevel ?? 1;
    state.lastBetAmount = saved.lastBetAmount ?? 0;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function simulateClick(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy }));
    });
    return true;
  }

  // ─── HISTORY READER ──────────────────────────────────────────────────────────
  let apiResultsCache = [];
  
  async function updateHistoryFromApi() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_API_RESULTS' }, (response) => {
        if (response && response.results) {
          apiResultsCache = response.results;
          const results = [], numbers = [];
          apiResultsCache.forEach(item => {
            results.push(item.result);
            numbers.push(item.number);
          });
          state.lastResults = results;
          state.lastNumbers = numbers;
          state.fullApiResults = apiResultsCache; // Store full data for logging
          state.lastHistoryPeriodNum = apiResultsCache.length > 0 ? apiResultsCache[0].period : null;
          resolve(results);
        } else {
          resolve([]);
        }
      });
    });
  }

  function readHistory() {
    // Now returns the cached results from API
    return state.lastResults || [];
  }

  function detect30SecTap() {
    // Watch for the WinGo 30-sec tap label. Mirror skins render this in many
    // ways ("30sec", "30 sec", "30s", "30秒", or "WinGo" + "30" split into
    // separate spans), so match liberally on both leaf and parent nodes.
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const raw = (el.textContent || '').toLowerCase();
      const t = raw.replace(/\s+/g, '');
      if (t.includes('30sec') || t.includes('30秒') || /(^|[^0-9])30s($|[^a-z0-9])/.test(t)) {
        return true;
      }
    }
    // Fallback: any element whose text contains both "wingo" and "30".
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 2) continue;
      const t = (el.textContent || '').toLowerCase();
      if (t.includes('wingo') && /\b30\b/.test(t)) return true;
    }
    return false;
  }

  // Generic "this tab is a WinGo skin" signal, used ONLY to decide whether
  // to show the UID gate on tabs where the strict period/30sec detection
  // fails (e.g. ok-win.ai uses a 9-digit period, or splits the tap label).
  function detectWinGoSkin() {
    const body = (document.body && document.body.innerText) || '';
    if (!body) return false;
    const lc = body.toLowerCase();
    if (lc.includes('wingo')) return true;
    // Green / Violet / Red trio is a WinGo-specific betting row.
    if (/\bgreen\b/i.test(body) && /\bviolet\b/i.test(body) && /\bred\b/i.test(body)) return true;
    // Wallet+Deposit+Withdraw header is present on every WinGo skin.
    if (lc.includes('wallet') && lc.includes('deposit') && lc.includes('withdraw')) return true;
    // Big/Small betting row.
    if (/\bbig\b/i.test(body) && /\bsmall\b/i.test(body) && lc.includes('wallet')) return true;
    return false;
  }

  // ─── UID READER (Account page) ─────────────────────────────────────────
  // Session-scoped: persists until the browser tab is closed. sessionStorage
  // clears automatically on tab close, matching the "until browser is closed"
  // requirement. Re-shows the UID gate on next visit.
  // Per-tab UID key: sessionStorage is already per-tab, but Chrome copies it
  // into duplicated tabs. A random per-tab id ensures a duplicated tab is
  // treated as a fresh tab and re-prompts for UID.
  function getTabId() {
    try {
      let id = sessionStorage.getItem('wab_tab_id');
      if (!id) {
        id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        sessionStorage.setItem('wab_tab_id', id);
        // Mark as fresh so a duplicated-tab copy (which inherits the old id
        // via sessionStorage clone) is distinguishable from the original.
        sessionStorage.setItem('wab_tab_owner', id);
      } else {
        const owner = sessionStorage.getItem('wab_tab_owner');
        if (owner !== id) {
          // Duplicated tab — rotate id so we don't reuse the original's UID.
          id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
          sessionStorage.setItem('wab_tab_id', id);
          sessionStorage.setItem('wab_tab_owner', id);
        }
      }
      return id;
    } catch (_) { return 'default'; }
  }
  function uidKey() { return 'wab_captured_uid_' + getTabId(); }
  function getCapturedUID() {
    try { return sessionStorage.getItem(uidKey()) || ''; } catch (_) { return ''; }
  }
  function setCapturedUID(uid) {
    try { sessionStorage.setItem(uidKey(), uid); } catch (_) {}
  }

  // ─── UID AUTO-RESET ────────────────────────────────────────────────────
  // Clears the captured UID so the "OPEN YOUR ACCOUNT" gate re-appears the
  // next time the user enters the 30-sec game. Triggered by the always-on
  // observer on three events: leaving the game, switching browser tabs,
  // and confirming a logout in the Account section.
  function resetCapturedUID(reason) {
    let had = '';
    try { had = sessionStorage.getItem(uidKey()) || ''; } catch (_) {}
    if (!had) return false;
    try { sessionStorage.removeItem(uidKey()); } catch (_) {}
    
    // Clear UI elements
    const disp = document.getElementById('wab-uid-display');
    const val  = document.getElementById('wab-uid-value');
    if (val) val.textContent = '—';
    if (disp) disp.style.display = 'none';
    
    // Clear Gate UID
    const gateUID = document.getElementById('wab-gate-uid-value');
    if (gateUID) {
      gateUID.textContent = '';
      gateUID.parentElement.style.display = 'none';
    }
    
    try { addLog && addLog(`🔄 UID reset (${reason})`, 'log-info'); } catch (_) {}
    return true;
  }

  function animateUID(uid, targetEl) {
    if (!targetEl) return;
    targetEl.textContent = '';
    let i = 0;
    const interval = setInterval(() => {
      if (i < uid.length) {
        targetEl.textContent += uid[i];
        i++;
      } else {
        clearInterval(interval);
      }
    }, 100); // 100ms per digit
  }

  // Detect that we are on the Account page by looking for MULTIPLE distinct
  // markers from the screenshot (Total balance, Enter wallet, Last login,
  // Game History, Transaction, My deposit history, Service center, VIP,
  // ARWallet, Beginner's Guide). Requiring ≥2 co-occurring markers prevents
  // the panel from confusing a random number that happens to have "UID"
  // near it with the real account UID.
  const ACCOUNT_MARKERS = [
    'Last login', 'Total balance', 'Enter wallet',
    'Game History', 'My game history', 'Transaction', 'My transaction',
    'My deposit history', 'My withdraw history', 'Service center',
    'Customer Service', "Beginner's Guide", 'Announcement',
    'ARWallet', 'Notification', 'Game statistics'
  ];

  function isAccountPage() {
    const bodyText = (document.body && document.body.innerText) || '';
    let hits = 0;
    for (const m of ACCOUNT_MARKERS) {
      if (bodyText.indexOf(m) !== -1) { hits++; if (hits >= 2) return true; }
    }
    return false;
  }

  function readUID() {
    // Only trust the UID if we're clearly on the account page (≥2 markers).
    if (!isAccountPage()) return null;
    
    // SURGICAL FIX: Scan for the real UID while strictly ignoring the extension's own UI.
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      // 1. Skip if it's our panel or inside it
      if (el.closest && el.closest('#wingo-ab-panel')) continue;
      // 2. Skip if it's a large container
      if (el.children.length > 5) continue;

      const text = (el.textContent || '').trim();
      // Look for the UID pattern specifically in small, original site elements
      if (/UID/i.test(text)) {
        // Look for the number in the same element or its immediate parent
        const m = text.match(/UID\s*[|｜:：\s]{0,3}\s*(\d{6,12})/i) || 
                  (el.parentElement && el.parentElement.innerText.match(/UID\s*[|｜:：\s]{0,3}\s*(\d{6,12})/i));
        
        if (m && m[1]) {
          // Verify it's not a self-detection from a ghost element or hidden panel
          return m[1];
        }
      }
    }

    return null;
  }

  function tryCaptureUID() {
    const currentUID = getCapturedUID();
    const onPageUID = readUID();

    // If we are on the account page and see a DIFFERENT UID, update it immediately.
    if (onPageUID && onPageUID !== currentUID) {
      setCapturedUID(onPageUID);
      
      // Update Main Display
      const disp = document.getElementById('wab-uid-display');
      const val = document.getElementById('wab-uid-value');
      if (disp && val) {
        disp.style.display = 'flex';
        animateUID(onPageUID, val);
      }
      
      // Update Gate Display
      const gateUIDVal = document.getElementById('wab-gate-uid-value');
      const gateUIDBox = document.getElementById('wab-gate-uid-box');
      if (gateUIDVal && gateUIDBox) {
        gateUIDBox.style.display = 'block';
        animateUID(onPageUID, gateUIDVal);
      }
      
      addLog && addLog(`🔄 UID updated: ${onPageUID}`, 'log-win');
      return true;
    }

    if (currentUID) return true;
    const uid = onPageUID;
    if (uid) {
      setCapturedUID(uid);
      
      // Update Main Display
      const disp = document.getElementById('wab-uid-display');
      const val = document.getElementById('wab-uid-value');
      if (disp && val) {
        disp.style.display = 'flex';
        animateUID(uid, val);
      }
      
      // Update Gate Display
      const gateUIDVal = document.getElementById('wab-gate-uid-value');
      const gateUIDBox = document.getElementById('wab-gate-uid-box');
      if (gateUIDVal && gateUIDBox) {
        gateUIDBox.style.display = 'block';
        animateUID(uid, gateUIDVal);
      }
      
      addLog && addLog(`✅ UID captured: ${uid}`, 'log-win');
      return true;
    }
    return false;
  }

  function readBalance() {
    const PANEL = '#wingo-ab-panel';
    const balRx = /wallet|balance|avail/i;

    // ── Pass 1: Look for elements with "₹" and numbers ──────
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0 || el.closest(PANEL)) continue;
      const t = (el.textContent || '').trim();
      // Match "₹0.94", "₹ 0.94", "0.94"
      const m = t.match(/₹?\s*([\d,]+\.\d{2})/);
      if (!m) continue;
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (isNaN(v) || v < 0 || v >= 10_000_000) continue;
      
      // Check if "Wallet" or "Balance" is nearby
      let anc = el.parentElement;
      for (let d = 0; d < 5 && anc; d++, anc = anc.parentElement) {
        if (balRx.test(anc.textContent || '')) return v;
      }
    }

    // ── Pass 2: Just look for any ₹0.94 like pattern ──────
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0 || el.closest(PANEL)) continue;
      const t = (el.textContent || '').trim();
      const m = t.match(/₹\s*([\d,]+\.\d{2})/);
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(v)) return v;
      }
    }
    
    return 0;
  }

  // ── Gate overlay: blur panel when not on the 30s game page ──────────────
  // Detection: scan live DOM for a 15-20 digit period number every second.
  // We intentionally do NOT use state.lastResults — that persists across
  // page navigations in a SPA and would keep the gate hidden after leaving.
  // Debounce: require 3 consecutive misses (~3 s) before showing the gate,
  // to avoid a flash during normal in-game DOM rebuilds.
  if (!state._noGameTicks) state._noGameTicks = 0;

  // ─── KEY GATE LOGIC ────────────────────────────────────────────────────
  function showKeyGate() {
    const keyGate = document.getElementById('wab-key-gate');
    const uidGate = document.getElementById('wab-uid-gate');
    const mainGate = document.getElementById('wab-gate-overlay');
    const loadingGate = document.getElementById('wab-key-loading-gate');
    const expiredGate = document.getElementById('wab-key-expired-gate');
    
    // Hide all other gates
    if (uidGate) uidGate.style.display = 'none';
    if (mainGate) mainGate.style.display = 'none';
    if (loadingGate) loadingGate.style.display = 'none';
    if (expiredGate) expiredGate.style.display = 'none';
    
    if (keyGate) {
      keyGate.style.display = 'flex';
      // Update UID display in key gate
      const uid = getCapturedUID();
      const uidDisplay = document.getElementById('wab-key-gate-uid-display');
      if (uidDisplay) uidDisplay.textContent = uid || '—';
      // Reset all states
      document.getElementById('wab-key-error').style.display = 'none';
      document.getElementById('wab-key-already-used').style.display = 'none';
      document.getElementById('wab-key-uid-mismatch').style.display = 'none';
      document.getElementById('wab-key-connection-error').style.display = 'none';
      document.getElementById('wab-key-activate-btn').style.display = '';
      const keyInput = document.getElementById('wab-key-input');
      if (keyInput) { keyInput.value = ''; keyInput.parentElement.style.display = ''; }
      setTimeout(() => { if (keyInput) keyInput.focus(); }, 200);
    }
  }

  function resetKeyGateToInput() {
    document.getElementById('wab-key-error').style.display = 'none';
    document.getElementById('wab-key-already-used').style.display = 'none';
    document.getElementById('wab-key-uid-mismatch').style.display = 'none';
    document.getElementById('wab-key-connection-error').style.display = 'none';
    document.getElementById('wab-key-activate-btn').style.display = '';
    const keyInput = document.getElementById('wab-key-input');
    if (keyInput) { keyInput.value = ''; keyInput.parentElement.style.display = ''; keyInput.focus(); }
  }

  function showKeyError(msg) {
    const el = document.getElementById('wab-key-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function showKeyAlreadyUsed() {
    document.getElementById('wab-key-activate-btn').style.display = 'none';
    document.getElementById('wab-key-input').parentElement.style.display = 'none';
    document.getElementById('wab-key-error').style.display = 'none';
    document.getElementById('wab-key-already-used').style.display = 'flex';
  }

  function showUIDMismatch() {
    document.getElementById('wab-key-activate-btn').style.display = 'none';
    document.getElementById('wab-key-input').parentElement.style.display = 'none';
    document.getElementById('wab-key-error').style.display = 'none';
    document.getElementById('wab-key-uid-mismatch').style.display = 'flex';
  }

  function showConnectionError() {
    document.getElementById('wab-key-activate-btn').style.display = 'none';
    document.getElementById('wab-key-input').parentElement.style.display = 'none';
    document.getElementById('wab-key-error').style.display = 'none';
    document.getElementById('wab-key-connection-error').style.display = 'flex';
  }

  async function showLoadingGate() {
    const keyGate = document.getElementById('wab-key-gate');
    const loadingGate = document.getElementById('wab-key-loading-gate');
    if (keyGate) keyGate.style.display = 'none';
    if (loadingGate) {
      loadingGate.style.display = 'flex';
      const timerEl = document.getElementById('wab-key-loading-timer');
      let remaining = 30;
      if (timerEl) timerEl.textContent = remaining;
      const interval = setInterval(() => {
        remaining--;
        if (timerEl) timerEl.textContent = remaining;
        if (remaining <= 0) {
          clearInterval(interval);
          if (loadingGate) loadingGate.style.display = 'none';
          // Unlock the panel
          state._keyActivated = true;
          try { addLog && addLog('🔑 Key activated — panel unlocked', 'log-win'); } catch (_) {}
        }
      }, 1000);
      await new Promise(r => setTimeout(r, 30000));
      clearInterval(interval);
      if (loadingGate) loadingGate.style.display = 'none';
    }
    state._keyActivated = true;
  }

  async function activateKeyFromGate() {
    const keyInput = document.getElementById('wab-key-input');
    const key = (keyInput ? keyInput.value : '').trim();
    if (!key || key.length < 14) {
      showKeyError('Please enter a valid key (XXXX-XXXX-XXXX).');
      return;
    }
    const uid = getCapturedUID();
    const deviceId = getDeviceId();
    
    const result = await validateKeyOnServer(key, uid, deviceId);
    
    if (result.success) {
      // Save key data locally
      setStoredKey(key.toUpperCase().replace(/\s+/g, ''));
      setStoredKeyUID(uid);
      if (result.expiryDate) setKeyExpiry(result.expiryDate);
      showToast && showToast('Key activated!', 'success');
      showLoadingGate();
    } else {
      switch (result.status) {
        case 'invalid_key':
          showKeyError('Invalid key. Please check and try again.');
          break;
        case 'expired':
          document.getElementById('wab-key-gate').style.display = 'none';
          document.getElementById('wab-key-expired-gate').style.display = 'flex';
          break;
        case 'deactivated':
          showKeyError('This key has been deactivated.');
          break;
        case 'already_used':
          showKeyAlreadyUsed();
          break;
        case 'uid_mismatch':
          showUIDMismatch();
          break;
        case 'connection_error':
          showConnectionError();
          break;
        default:
          showKeyError(result.message || 'Activation failed.');
      }
    }
  }

  // Check if key has expired (client-side)
  function isKeyExpiredLocally() {
    const expiry = getKeyExpiry();
    if (!expiry) return false;
    return new Date(expiry) < new Date();
  }

  // Full key gate check — returns true if key gate is satisfied
  function isKeyGateSatisfied() {
    // If loading gate is active, block access
    const loadingGate = document.getElementById('wab-key-loading-gate');
    if (loadingGate && loadingGate.style.display === 'flex') return false;
    
    // If already activated this session
    if (state._keyActivated) return true;
    
    const storedKey = getStoredKey();
    const storedUID = getStoredKeyUID();
    const currentUID = getCapturedUID();
    
    if (!storedKey) return false;
    
    // Check expiry
    if (isKeyExpiredLocally()) {
      clearKeyData();
      return false;
    }
    
    // UID must match
    if (storedUID && currentUID && storedUID !== currentUID) {
      // UID changed — clear stored key
      clearKeyData();
      return false;
    }
    
    // If key is stored and UID matches (or no UID yet), consider it valid
    // This avoids showing key gate on every return visit
    state._keyActivated = true;
    return true;
  }

  // Async version that also checks with server
  async function isKeyGateSatisfiedAsync() {
    if (isKeyGateSatisfied()) return true;
    
    // If no stored key, check device binding with server
    const storedKey = getStoredKey();
    if (!storedKey) {
      const deviceId = getDeviceId();
      const result = await checkDeviceOnServer(deviceId);
      if (result.success && result.hasKey && result.linked_uid) {
        const currentUID = getCapturedUID();
        if (currentUID && result.linked_uid === currentUID) {
          setStoredKey(result.key);
          setStoredKeyUID(result.linked_uid);
          state._keyActivated = true;
          return true;
        }
      }
    }
    return false;
  }

  // Periodic server check: verify key is still valid (not expired, not deactivated)
  // Runs every 60 seconds while panel is unlocked
  async function periodicKeyCheck() {
    if (!state._keyActivated) return;
    const storedKey = getStoredKey();
    const currentUID = getCapturedUID();
    if (!storedKey || !currentUID) return;
    
    const deviceId = getDeviceId();
    const result = await validateKeyOnServer(storedKey, currentUID, deviceId);
    
    if (!result.success) {
      if (result.status === 'expired' || result.status === 'deactivated') {
        // Key is no longer valid — lock the panel
        clearKeyData();
        state._keyActivated = false;
        state._keyGateAsyncCheckStarted = false;
        
        // Show expired gate
        const keyGate = document.getElementById('wab-key-gate');
        const expiredGate = document.getElementById('wab-key-expired-gate');
        const loadingGate = document.getElementById('wab-key-loading-gate');
        const panelContent = document.getElementById('wab-panel-content');
        
        if (keyGate) keyGate.style.display = 'none';
        if (loadingGate) loadingGate.style.display = 'none';
        if (panelContent) panelContent.style.display = 'none';
        if (expiredGate) expiredGate.style.display = 'flex';
        
        try { addLog && addLog(`🔒 Key ${result.status} — panel locked`, 'log-loss'); } catch (_) {}
      }
    } else if (result.expiryDate) {
      // Update local expiry from server
      setKeyExpiry(result.expiryDate);
    }
  }

  // Start periodic key check every 60 seconds
  setInterval(periodicKeyCheck, 60000);

  function updateGateOverlay() {
    const overlay = document.getElementById('wab-gate-overlay');
    const uidGate = document.getElementById('wab-uid-gate');
    const keyGate = document.getElementById('wab-key-gate');
    const expiredGate = document.getElementById('wab-key-expired-gate');
    const loadingGate = document.getElementById('wab-key-loading-gate');
    if (!overlay) return;

    const hasPeriod = readActivePeriod().length > 0;
    const has30Sec = detect30SecTap();
    const timer = readTimer();
    // Timer detection is fragile (digits are often split into separate spans),
    // so it's a bonus signal only. Period + 30sec label is enough to confirm
    // we are on the WinGo 30-sec game screen.
    const inGame = hasPeriod && has30Sec;

    // Track in-game → not-in-game transition for auto-reset (Trigger #1).
    if (state._wasInGame && !inGame) {
      resetCapturedUID('left-game');
    }
    state._wasInGame = inGame;

    // While the user is on the Account page, always try to capture the UID.
    tryCaptureUID();
    const uid = getCapturedUID();

    // Keep header UID display in sync
    const disp = document.getElementById('wab-uid-display');
    const val = document.getElementById('wab-uid-value');
    if (disp && val) {
      if (uid) { disp.style.display = 'flex'; val.textContent = uid; }
      else     { disp.style.display = 'none'; }
    }

    // Stage 1: no game signal at all → show the "waiting for game" gate.
    // If EITHER hasPeriod or has30Sec is true we treat the tab as a WinGo
    // skin and skip straight to the UID gate below, so a 2nd tab whose DOM
    // doesn't yet match both signals still prompts for the UID.
    // We also honor a generic "WinGo skin" signal (WinGo text, Green/Violet/Red
    // trio, Wallet+Deposit+Withdraw header) so mirror skins that don't match
    // the strict period/30sec detection still advance to the UID gate.
    const anySignal = hasPeriod || has30Sec || detectWinGoSkin();
    if (!inGame && !anySignal) {
      state._noGameTicks++;
      if (state._noGameTicks >= 3) {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
      }
      // Hide the UID gate while we're not in-game, the main gate takes over.
      if (uidGate) uidGate.style.display = 'none';
      return;
    }

    // Partial signal (only one of hasPeriod / has30Sec, or a generic WinGo
    // skin match): we're on the platform but not confirmed inside the 30-sec
    // game. If UID is missing, show the UID gate first. If UID is already
    // captured, keep the "waiting for 30-sec game" gate visible until the
    // user actually opens WinGo 30s — the panel only fully unlocks in-game.
    if (!inGame && anySignal) {
      state._noGameTicks = 0;
      if (!uid) {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        if (uidGate) {
          uidGate.classList.remove('hidden');
          uidGate.style.display = 'flex';
        }
        return;
      }
      // UID captured but not in 30s game → re-show the waiting gate.
      if (uidGate) uidGate.style.display = 'none';
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
      return;
    }

    // In-game: hide the main gate.
    state._noGameTicks = 0;
    overlay.classList.add('hidden');
    overlay.style.display = 'none';

    // Stage 2: in the 30s game but UID not yet captured → show UID gate.
    if (!uid) {
      if (uidGate) {
        uidGate.classList.remove('hidden');
        uidGate.style.display = 'flex';
      }
      // Hide key gate while UID is not captured
      if (keyGate) keyGate.style.display = 'none';
      if (expiredGate) expiredGate.style.display = 'none';
      if (loadingGate) loadingGate.style.display = 'none';
      return;
    }

    // Stage 3: UID captured → check key gate
    if (uidGate) uidGate.style.display = 'none';

    // Check if key has expired
    if (getStoredKey() && isKeyExpiredLocally()) {
      clearKeyData();
      state._keyActivated = false;
      state._keyGateAsyncCheckStarted = false;
      // Hide all panel content, show only expired gate
      const panelContent = document.getElementById('wab-panel-content');
      const ball = document.getElementById('wab-ball');
      if (ball) ball.style.display = 'none';
      if (panelContent) panelContent.style.display = 'none';
      if (keyGate) keyGate.style.display = 'none';
      if (loadingGate) loadingGate.style.display = 'none';
      if (expiredGate) expiredGate.style.display = 'flex';
      return;
    }

    // If key is already satisfied (from previous session), skip key gate
    if (isKeyGateSatisfied()) {
      if (keyGate) keyGate.style.display = 'none';
      if (expiredGate) expiredGate.style.display = 'none';
      if (loadingGate) loadingGate.style.display = 'none';
      return;
    }

    // If key is not satisfied yet, try async server check for device binding
    if (!state._keyGateAsyncCheckStarted) {
      state._keyGateAsyncCheckStarted = true;
      isKeyGateSatisfiedAsync().then(satisfied => {
        if (satisfied) {
          if (keyGate) keyGate.style.display = 'none';
          if (expiredGate) expiredGate.style.display = 'none';
          if (loadingGate) loadingGate.style.display = 'none';
        }
      });
    }

    // If loading gate is showing, don't show key gate
    if (loadingGate && loadingGate.style.display === 'flex') return;

    // Show key gate for activation
    if (keyGate && keyGate.style.display !== 'flex' && expiredGate && expiredGate.style.display !== 'flex') {
      showKeyGate();
    }
  }

  // ─── ALWAYS-ON OBSERVER ────────────────────────────────────────────────
  // Watches for tab-change and logout confirmation on EVERY page (in-game or
  // not) and resets the captured UID. The in-game → out-of-game transition
  // is handled inside updateGateOverlay above; this block adds the other two
  // triggers. Installed once per page via a window-level guard.
  if (!window.__wabUidObserverInstalled) {
    window.__wabUidObserverInstalled = true;

    // Trigger #2: tab / window visibility change.
    // Only reset when the tab stays hidden for a sustained period — brief
    // blur events (URL bar tap, notification shade, in-app navigation, focus
    // shifts to iframes) must NOT wipe the captured UID. We require the tab
    // to be hidden for >= 5 seconds continuously before resetting.
    const HIDE_RESET_MS = 5000;
    let hideTimer = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (document.hidden) resetCapturedUID('tab-change');
        }, HIDE_RESET_MS);
      } else {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
        // Tab just became active — force a fresh UID scan on this tab so
        // switching between two game tabs always re-asks for the account UID.
        resetCapturedUID('tab-activated');
        // Immediately re-evaluate gates so the UID prompt appears on the
        // newly focused tab without waiting for the next interval tick.
        try { state._noGameTicks = 0; } catch (_) {}
        try { updateGateOverlay(); } catch (_) {}
      }
    }, true);

    // Trigger #3: Logout → Confirm flow. Text-based so re-skinned mirror
    // sites (different colors / layouts) still trigger. Capture-phase click
    // listener so we see the tap even if the site stops propagation.
    const LOGOUT_RX  = /(log\s*out|logout|sign\s*out|退出|注销|退出登录)/i;
    const CONFIRM_RX = /^(confirm|ok|yes|sure|proceed|submit|确定|确认|确定|好的|是|确定退出|知道了|OK)$/i;
    const CANCEL_RX  = /^(cancel|back|exit|close|no|dismiss|取消|返回|退出|关闭|否)$/i;
    const LOGOUT_DIALOG_RX = /do\s*you\s*want\s*to\s*log\s*out|confirm\s*to\s*logout|确定要退出吗|确定退出|是否退出|退出确认/i;

    let pendingLogout = 0; // ms timestamp of last "Logout" tap; 0 = none
    const LOGOUT_WINDOW_MS = 30000; // 30s window

    const getElText = (el) => {
      if (!el) return '';
      return (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
    };

    // Function to check for logout dialog and reset UID immediately
    const checkForLogoutDialog = () => {
      if (LOGOUT_DIALOG_RX.test(document.body.innerText)) {
        // RESET IMMEDIATELY when the dialog text is seen anywhere on the page
        if (resetCapturedUID('logout-dialog-detected')) {
          // addLog && addLog(`🚨 Logout dialog detected! UID reset instantly.`, 'log-info');
        }
        pendingLogout = Date.now();
        return true;
      }
      return false;
    };

    const handleLogoutInteraction = (ev) => {
      const el = ev.target;
      if (!el || !(el instanceof Element)) return;
      if (el.closest && el.closest('#wingo-ab-panel, #wab-ball, #wab-uid-gate, #wab-gate-overlay')) return;
      
      const text = getElText(el);
      if (!text) return;

      // 1. Detect Logout button click (immediate reset)
      if (LOGOUT_RX.test(text) && text.length < 20) {
        pendingLogout = Date.now();
        resetCapturedUID('logout-button-clicked');
        return;
      }

      // 2. Fallback: Detect Confirmation click
      if (pendingLogout && (Date.now() - pendingLogout) <= LOGOUT_WINDOW_MS) {
        if (CONFIRM_RX.test(text) || (text.length < 15 && CONFIRM_RX.test(text))) {
          pendingLogout = 0;
          resetCapturedUID('logout-confirmed');
        }
      }
    };

    // Listeners for maximum speed
    ['mousedown', 'touchstart', 'click'].forEach(evt => {
      document.addEventListener(evt, handleLogoutInteraction, true);
    });

    // Real-time observer: Resets UID the MILLISECOND the dialog appears
    const logoutObserver = new MutationObserver(() => {
      checkForLogoutDialog();
    });
    logoutObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Initial check in case it's already there
    checkForLogoutDialog();

    // Secondary high-speed interval check (fallback for observer)
    setInterval(checkForLogoutDialog, 500);
  }

  function showAutoStopOverlay() {
    const overlay = document.getElementById('wab-autostop-overlay');
    const reasonEl = document.getElementById('wab-autostop-reason');
    if (!overlay) return;
    if (reasonEl) reasonEl.textContent = state.autoStopReason || 'Auto-bet stopped';
    overlay.style.display = 'flex';
  }

  function hideAutoStopOverlay() {
    const overlay = document.getElementById('wab-autostop-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
  }

  // Force-refresh the balance display and cache it in state
  function updateBalanceNow() {
    const bal = readBalance();
    if (bal > 0) {
      state.lastKnownBalance = bal;
      const balEl = document.getElementById('wab-balance');
      if (balEl) balEl.textContent = '₹' + bal.toFixed(2);
    }
    return bal;
  }

  function readTimer() {
    // We need to find the game timer, not the system clock (which is usually at the top)
    // The game timer is typically near the "Time remaining" text.
    const timerRx = /(\d)\s*(\d)\s*:\s*(\d)\s*(\d)/;
    const simpleTimerRx = /(\d{1,2}):(\d{2})/;
    
    // Pass 1: Look for timer near "Time remaining"
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').trim().toLowerCase();
      if (t.includes('time remaining')) {
        let parent = el.parentElement;
        for (let d = 0; d < 5 && parent; d++) {
          const content = parent.textContent || '';
          const m = content.match(timerRx) || content.match(simpleTimerRx);
          if (m) {
            // Found it near the label!
            if (m[3] !== undefined) { // Split digit match
              const mins = parseInt(m[1]) * 10 + parseInt(m[2]);
              const secs = parseInt(m[3]) * 10 + parseInt(m[4]);
              return { secs: mins * 60 + secs, text: `${m[1]}${m[2]}:${m[3]}${m[4]}` };
            } else { // Simple colon match
              return { secs: parseInt(m[1]) * 60 + parseInt(m[2]), text: m[0] };
            }
          }
          parent = parent.parentElement;
        }
      }
    }

    // Pass 2: Fallback to scanning all elements, but ignore those at the top of the screen (system clock)
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < 100) continue; // Skip top 100px where system clock usually is

      const t = (el.textContent || '').trim();
      const m = t.match(timerRx);
      if (m) {
        const mins = parseInt(m[1]) * 10 + parseInt(m[2]);
        const secs = parseInt(m[3]) * 10 + parseInt(m[4]);
        // Game timer is usually 00:XX for 30s game
        if (mins === 0 && mins * 60 + secs <= 60) {
           return { secs: mins * 60 + secs, text: `${m[1]}${m[2]}:${m[3]}${m[4]}` };
        }
      }
      
      const m2 = t.match(simpleTimerRx);
      if (m2) {
        const totalSecs = parseInt(m2[1]) * 60 + parseInt(m2[2]);
        if (parseInt(m2[1]) === 0 && totalSecs <= 60) {
          return { secs: totalSecs, text: m2[0] };
        }
      }
    }
    
    return null;
  }

  function readActivePeriod() {
    // Accept 9–20 digit period numbers. Some mirror skins (e.g. ok-win.ai)
    // show a 9-digit period like "100050198" instead of the standard
    // 17-digit format used by the reference site.
    const periodRx = /^\d{9,20}$/;
    let maxNum = 0n, maxId = '';
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').trim();
      if (periodRx.test(t)) { const n = BigInt(t); if (n > maxNum) { maxNum = n; maxId = t; } }
    }
    return maxId;
  }

  // ─── LEVEL HELPERS ───────────────────────────────────────────────────────────
  // New progression: L1 = baseBet, L(n+1) = Math.ceil(L(n) * 2.1)
  function computeLevelAmounts(levels) {
    const n = Math.max(1, levels | 0);
    const base = Math.max(1, Math.ceil(state.baseBet));
    const arr = [base];
    for (let i = 1; i < n; i++) arr.push(Math.ceil(arr[i - 1] * 2.1));
    return arr;
  }

  function currentBetAmount() {
    const lvl = Math.max(1, state.currentLevel);
    return computeLevelAmounts(lvl)[lvl - 1];
  }

  function buildLevelPreview() {
    const amts = computeLevelAmounts(state.maxLevels);
    const total = amts.reduce((a, b) => a + b, 0);
    return amts.map((a, i) => `L${i + 1}=₹${a}`).join('  ') + `  |  Total=₹${total}`;
  }

  // ─── BET EXECUTION ───────────────────────────────────────────────────────────
  function findBetButton(label) {
    for (const el of document.querySelectorAll('button, [role="button"], div, span')) {
      const t = (el.textContent || '').trim();
      if (t !== label) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 20 && rect.top > 0 && rect.top < window.innerHeight) return el;
    }
    return null;
  }

  function setInputValue(inp, val) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(inp, String(val)); else inp.value = String(val);
    inp.dispatchEvent(new Event('input',  { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Returns true if el is rendered and visible on screen (no position-percentage assumptions)
  function elVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    // Must be within the viewport
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right  < 0 || rect.left > window.innerWidth)  return false;
    return true;
  }

  // Returns true if el belongs to our own panel (must not be clicked as game button)
  function inOurPanel(el) {
    return !!(el && el.closest('#wingo-ab-panel'));
  }

  async function setPopupQuantity(amount) {
    // Find any visible number/text input that is NOT inside our panel
    for (const inp of document.querySelectorAll('input[type="number"], input[type="text"], input:not([type])')) {
      if (inOurPanel(inp)) continue;
      if (!elVisible(inp)) continue;
      simulateClick(inp); await sleep(150);
      setInputValue(inp, amount);
      addLog(`📝 Qty set to ${amount}`, 'log-skip');
      return true;
    }
    addLog('⚠ Qty input not found', 'log-skip');
    return false;
  }

  async function ensureAgreed() {
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      if (inOurPanel(el)) continue;
      const t = (el.textContent || '').trim().toLowerCase();
      if (!t.includes('agree')) continue;
      if (!elVisible(el)) continue;
      let target = el;
      for (let i = 0; i < 5; i++) {
        const r = target.getBoundingClientRect();
        if (r.width > 50 && r.height > 10) { simulateClick(target); break; }
        if (target.parentElement) target = target.parentElement; else break;
      }
      await sleep(150); return;
    }
  }

  async function clickTotalAmountBtn() {
    await sleep(300);

    // Real confirm buttons (e.g. "Total amount ₹1.00") are LEAF elements — no child elements.
    // Wrapper divs that concatenate children (e.g. "CancelTotal amount ₹1.00" or
    // "WinGo 30sSelect SmallBalance") have child elements and must be skipped.
    function isLeaf(el) { return el.children.length === 0; }

    // ── Heuristic 1: LEAF element whose text matches a confirm-style phrase ──
    const confirmPhrases = [
      /total\s*amount/i, /confirm.{0,5}bet/i, /place.{0,5}bet/i,
      /bet\s*now/i, /submit.{0,5}bet/i, /^confirm$/i, /^ok$/i, /^proceed$/i,
    ];
    for (const rx of confirmPhrases) {
      for (const el of document.querySelectorAll('button, [role="button"], div, span, a')) {
        if (inOurPanel(el)) continue;
        if (!isLeaf(el)) continue;             // ← must be leaf, not a wrapper
        const t = (el.textContent || '').trim();
        if (!rx.test(t)) continue;
        if (t.length > 45) continue;
        if (!elVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 14) continue;
        simulateClick(el);
        addLog(`✅ Confirm tapped: "${t.slice(0,30)}"`, 'log-win');
        return true;
      }
    }

    // ── Heuristic 2: LEAF element with ₹ symbol (catches "Total amount ₹1.00") ──
    for (const el of document.querySelectorAll('button, [role="button"], div, span, a')) {
      if (inOurPanel(el)) continue;
      if (!isLeaf(el)) continue;               // ← must be leaf
      const t = (el.textContent || '').trim();
      if (!t.includes('₹')) continue;
      if (t.length > 45) continue;
      if (!elVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 14) continue;
      simulateClick(el);
      addLog(`✅ ₹-confirm tapped: "${t.slice(0,30)}"`, 'log-win');
      return true;
    }

    // ── Heuristic 3: largest visible non-cancel LEAF button NOT in our panel ──
    const cancelWords = /^(cancel|close|x|×|back|no|dismiss)$/i;
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll('button, [role="button"], div, span, a')) {
      if (inOurPanel(el)) continue;
      if (!isLeaf(el)) continue;               // ← must be leaf
      const t = (el.textContent || '').trim();
      if (!t || cancelWords.test(t) || t.length > 60) continue;
      if (!elVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 14) continue;
      const boost = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? 1.5 : 1;
      const score = rect.width * rect.height * boost;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    if (best) {
      simulateClick(best);
      addLog(`✅ Confirm (size): "${(best.textContent||'').trim().slice(0,25)}"`, 'log-win');
      return true;
    }

    addLog('⚠ Confirm button not found — check popup', 'log-stop');
    return false;
  }

  // ─── AUTO-SCROLL SEARCH ────────────────────────────────────────────────────
  // Scans for an element on the page and auto-scrolls until it is found.
  // Returns the element if found within the search limit, null otherwise.
  async function autoScrollSearchForElement(label, maxScrolls = 30, scrollStep = 200) {
    // Quick check: is it already visible in the viewport?
    for (let attempt = 0; attempt < 3; attempt++) {
      const el = findBetButton(label);
      if (el) return el;
      await sleep(200);
    }

    // Element not in viewport — try scrolling to find it
    // First, scroll to top to start fresh
    window.scrollTo({ top: 0, behavior: 'auto' });
    await sleep(500);

    // Quick check after scrolling to top
    for (let attempt = 0; attempt < 3; attempt++) {
      const el = findBetButton(label);
      if (el) return el;
      await sleep(200);
    }

    // Progressive scroll search — scroll down incrementally
    let scrollCount = 0;
    while (scrollCount < maxScrolls) {
      scrollCount++;
      window.scrollBy({ top: scrollStep, behavior: 'auto' });
      await sleep(350);

      // Check if button is now visible
      const el = findBetButton(label);
      if (el) {
        // Found it! Scroll it nicely into view center
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(400);
        addLog(`🔍 Auto-scrolled ${scrollCount} steps — found "${label}" button`, 'log-skip');
        return el;
      }

      // Check if we've reached the bottom of the page
      const atBottom = (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 10;
      if (atBottom) break;
    }

    // We scrolled to bottom and didn't find it — try scrolling back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await sleep(600);

    // Final check after returning to top
    for (let attempt = 0; attempt < 5; attempt++) {
      const el = findBetButton(label);
      if (el) return el;
      await sleep(200);
    }

    return null;
  }

  async function placeBet(prediction) {
    const label = prediction === 'B' ? 'Big' : 'Small';
    const amountFinal = currentBetAmount();
    state.betStep = stepNumber();
    addLog(`🎯 Bet #${state.betStep}/${SEQ_LEN} → press ${label} (L${state.currentLevel} ₹${amountFinal})`, 'log-bet');

    // Snap balance before bet
    state.balanceBeforeBet = readBalance();
    // Snap current history period number + prediction for win/loss detection.
    // We compare period numbers (always unique) rather than B/S values, so
    // consecutive identical results (S→S or B→B) are never missed.
    state.betPrediction = prediction;
    state.historyPeriodBeforeBet = state.lastHistoryPeriodNum;

    // Try to find the button — auto-scroll if not immediately visible
    const btn = await autoScrollSearchForElement(label, 30, 200);
    if (!btn) { addLog(`⚠ "${label}" btn not found after auto-scroll`, 'log-stop'); return false; }
    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    simulateClick(btn);
    await sleep(900);

    await setPopupQuantity(amountFinal);
    await sleep(350);
    await ensureAgreed();
    await sleep(300);
    const confirmed = await clickTotalAmountBtn();
    if (confirmed) {
      state.betsPlaced++;
      state.pendingResult = true;
      state.lastBetAmount = amountFinal;
      addLog(`✅ ${label} ₹${amountFinal} placed (bet #${state.betsPlaced}, L${state.currentLevel})`, 'log-win');
    }
    return confirmed;
  }

  // ─── STOP CONDITIONS ─────────────────────────────────────────────────────────
  function checkStops() {
    // Session profit is now updated mathematically after each bet result
    
    // Stop Loss
    if (state.stopLoss < 999999 && state.sessionProfit <= -Math.abs(state.stopLoss)) {
      const msg = `🛑 STOP LOSS HIT: ₹${Math.abs(state.sessionProfit).toFixed(2)} lost (Limit: ₹${state.stopLoss})`;
      console.log(msg);
      addLog(`[STOP] ${msg}`, 'log-stop');
      stopAutobetWithReason('🛑 STOP LOSS HIT\n₹' + Math.abs(state.sessionProfit).toFixed(2) + ' lost');
      return true;
    }
    // Target
    if (state.target < 999999 && state.sessionProfit >= Math.abs(state.target)) {
      const msg = `🎉 TARGET REACHED: ₹${state.sessionProfit.toFixed(2)} profit (Limit: ₹${state.target})`;
      console.log(msg);
      addLog(`[STOP] ${msg}`, 'log-win');
      stopAutobetWithReason('🎉 TARGET REACHED\n₹' + state.sessionProfit.toFixed(2) + ' profit');
      return true;
    }
    // Max Bets
    if (state.maxBets < 999999 && state.betsPlaced >= state.maxBets) {
      const msg = `🛑 MAX BETS REACHED: ${state.betsPlaced} bets placed (Limit: ${state.maxBets})`;
      console.log(msg);
      addLog(`[STOP] ${msg}`, 'log-stop');
      stopAutobetWithReason('🛑 MAX BETS REACHED\n' + state.betsPlaced + ' bets placed');
      return true;
    }
    // Max Level
    if (state.currentLevel > state.maxLevels) {
      const msg = `🛑 MAX LEVEL EXCEEDED: Level ${state.currentLevel} (Limit: ${state.maxLevels})`;
      console.log(msg);
      addLog(`[STOP] ${msg}`, 'log-stop');
      stopAutobetWithReason('🛑 MAX LEVEL EXCEEDED\nLevel ' + state.currentLevel + ' > ' + state.maxLevels);
      return true;
    }
    return false;
  }

  function stopAutobet() {
    state.running = false;
    const btn = document.getElementById('wab-start-btn');
    const dot = document.getElementById('wab-dot');
    if (btn) { btn.className = 'wab-main-btn start'; btn.textContent = '▶ Start Auto Bet'; }
    if (dot) dot.classList.remove('active');
  }

  function stopAutobetWithReason(reason) {
    stopAutobet();
    state.autoStopLocked = true;
    state.autoStopReason = reason;
    showAutoStopOverlay();
  }

  // ─── LOG ─────────────────────────────────────────────────────────────────────
  function addLog(msg, cls = '') {
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    state.log.unshift({ msg, cls, time: t });
    if (state.log.length > 100) state.log.length = 100;
    renderLogs();
  }

  function calculateStats() {
    // Calculate statistics from log entries
    let wins = 0, losses = 0, skipped = 0;
    let winStreak = 0, lossStreak = 0;
    let maxWinStreak = 0, maxLossStreak = 0;

    for (const entry of state.log) {
      if (entry.cls === 'log-win') {
        wins++;
        winStreak++;
        lossStreak = 0;
        if (winStreak > maxWinStreak) maxWinStreak = winStreak;
      } else if (entry.cls === 'log-stop') {
        losses++;
        lossStreak++;
        winStreak = 0;
        if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
      } else if (entry.cls === 'log-skip') {
        skipped++;
        winStreak = 0;
        lossStreak = 0;
      }
    }

    state.totalWins = wins;
    state.totalLosses = losses;
    state.totalSkipped = skipped;
    state.maxWinStreak = maxWinStreak;
    state.maxLossStreak = maxLossStreak;

    // Update UI elements
    const winsEl = document.getElementById('wab-stat-wins');
    const lossesEl = document.getElementById('wab-stat-losses');
    const maxWinStreakEl = document.getElementById('wab-stat-max-win-streak');
    const maxLossStreakEl = document.getElementById('wab-stat-max-loss-streak');
    const skippedEl = document.getElementById('wab-stat-skipped');

    if (winsEl) winsEl.textContent = wins;
    if (lossesEl) lossesEl.textContent = losses;
    if (maxWinStreakEl) maxWinStreakEl.textContent = maxWinStreak;
    if (maxLossStreakEl) maxLossStreakEl.textContent = maxLossStreak;
    if (skippedEl) skippedEl.textContent = skipped;
  }

  function renderLogs() {
    // Always update the log content in background — regardless of lock state
    const el = document.getElementById('wab-log-page');
    if (el) el.innerHTML = state.log.slice(0, 60).map(l =>
      `<div class="wab-log-line ${l.cls}">[${l.time}] ${l.msg}</div>`
    ).join('');
    // Calculate and update statistics
    calculateStats();
  }

  // ─── RENDER UI ───────────────────────────────────────────────────────────────
  function renderUI() {
    const { s1, s2, combined } = getCombinedPrediction();
    state.s1Prediction = s1;
    state.s2Prediction = s2;
    state.currentPrediction = combined;

    // Balance — use cached value from last updateBalanceNow() call
    const bal = state.lastKnownBalance || readBalance();
    const balEl = document.getElementById('wab-balance');
    if (balEl && bal > 0) balEl.textContent = '₹' + bal.toFixed(2);

    // P/L
    const plEl = document.getElementById('wab-pl');
    if (plEl) {
      const pl = state.sessionProfit;
      plEl.textContent = (pl >= 0 ? '+' : '') + '₹' + pl.toFixed(2);
      plEl.className = 'wab-status-val ' + (pl > 0 ? 'green' : pl < 0 ? 'red' : '');
    }

    // Bets/State
    const bsEl = document.getElementById('wab-bets-status');
    if (bsEl) {
      bsEl.textContent = `${state.betsPlaced} / ${state.running ? 'RUNNING' : 'IDLE'}`;
      bsEl.className = 'wab-status-val ' + (state.running ? 'green' : '');
    }

    // Level indicator
    const lvlEl = document.getElementById('wab-level-badge');
    if (lvlEl) {
      lvlEl.textContent = `Level ${state.currentLevel} / ${state.maxLevels}  ₹${currentBetAmount()}`;
      lvlEl.className = 'wab-level-badge ' + (state.currentLevel > 1 ? 'hot' : '');
    }
    const lvlPreview = document.getElementById('wab-level-preview');
    if (lvlPreview) lvlPreview.textContent = buildLevelPreview();

    // Fixed sequence display (only rendered if unlocked) — highlights/blinks the
    // step that is currently ongoing.
    if (state.strategiesUnlocked) {
      const curStep = stepNumber(); // 1..8
      for (let i = 0; i < SEQ_LEN; i++) {
        const cell = document.getElementById('wab-seq-' + i);
        if (!cell) continue;
        const val = STRATEGY_SEQUENCE[i];
        const isActive = (i + 1) === curStep;
        cell.className = 'wab-seq-cell ' + (val === 'B' ? 'big' : 'small') + (isActive ? ' active' : '');
      }
    }

    // Current prediction bubble + step label (always shows a bet, never SKIP)
    const predEl = document.getElementById('wab-predict');
    if (predEl) { predEl.className = 'wab-predict-bubble lg ' + (combined || 'wait'); predEl.textContent = combined || '—'; }
    const matchLbl = document.getElementById('wab-match-label');
    if (matchLbl) {
      const lbl = combined === 'B' ? 'BIG' : combined === 'S' ? 'SMALL' : '';
      if (combined) {
        matchLbl.textContent = `BET #${stepNumber()} of ${SEQ_LEN} — ${lbl}`;
        matchLbl.className = 'wab-match-label match';
      } else {
        matchLbl.textContent = 'Waiting for data…';
        matchLbl.className = 'wab-match-label';
      }
    }

    // Risk Summary
    const slEl = document.getElementById('wab-main-sl');
    const tgEl = document.getElementById('wab-main-tg');
    const mbEl = document.getElementById('wab-main-mb');
    if (slEl) slEl.textContent = (state.stopLoss >= 999999) ? '∞' : '₹' + state.stopLoss;
    if (tgEl) tgEl.textContent = (state.target >= 999999) ? '∞' : '₹' + state.target;
    if (mbEl) mbEl.textContent = (state.maxBets >= 999999) ? '∞' : state.maxBets;

    renderLogs();
    saveAppState();
  }

  // ─── MAIN LOOP ───────────────────────────────────────────────────────────────
  let betInProgress = false;

  let lastApiFetchTime = 0;
  async function mainLoop() {
    // Update history from API every 3 seconds instead of every loop to prevent UI lag
    const now = Date.now();
    if (now - lastApiFetchTime > 3000) {
      lastApiFetchTime = now;
      updateHistoryFromApi().then(() => {
        // Sync all new API results to logs
        if (state.fullApiResults && state.fullApiResults.length > 0) {
          const toLog = [...state.fullApiResults].reverse();
          toLog.forEach(item => {
            if (!state.loggedApiPeriods.has(item.period)) {
              const label = item.result === 'B' ? 'Big' : 'Small';
              const color = item.color || 'unknown';
              addLog(`📊 API Result: …${item.period.slice(-4)} = ${item.number} (${label}) [${color}]`, 'log-skip');
              state.loggedApiPeriods.add(item.period);
              if (state.loggedApiPeriods.size > 100) {
                const first = state.loggedApiPeriods.values().next().value;
                state.loggedApiPeriods.delete(first);
              }
            }
          });
        }
      });
    }
    
    const autoResults = readHistory();
    if (autoResults.length > 0) state.lastResults = autoResults;

    // Watchdog: Ensure the panel exists in the DOM (SPA recovery)
    if (!document.getElementById('wingo-ab-panel')) {
      createPanel();
      addLog('Watchdog: Panel restored', 'log-skip');
    }

    // Ensure the panel/ball stays within screen boundaries (Snap back)
    ensureInBounds();

    // Show/hide gate overlay based on whether game page is active
    updateGateOverlay();

    const timer = readTimer();
    const timerEl = document.getElementById('wab-timer');
    if (timerEl) {
      if (timer) {
        timerEl.textContent = timer.text;
        timerEl.className = 'wab-status-val ' + (timer.secs <= 10 ? 'red' : timer.secs <= 20 ? 'yellow' : 'green');
      } else {
        timerEl.textContent = '—';
        timerEl.className = 'wab-status-val yellow';
      }
    }

    // ── Always-on: period tracking, prediction logging, and timer window ────────
    // These run regardless of whether auto-bet is started, so the Logs tab
    // fills up with live game data at all times.
    const windows = { '30s': 20, '1m': 20, '3m': 30, '5m': 40 };
    const winSecs = windows[state.gameType] || 20;
    if (timer && timer.secs > winSecs + 5) state.betFired = false;

    // Period change — always track; win/loss detection only when running
    const activePeriod = readActivePeriod();
    if (activePeriod && activePeriod !== state.lastActivePeriod) {
      state.lastActivePeriod = activePeriod;
      state.betFired = false;
      // Advance the fixed strategy sequence by one step each new period.
      // The very first period after load/refresh stays at step 1 (Small).
      if (state.seqInitialized) {
        state.stepIndex = (state.stepIndex + 1) % SEQ_LEN;
      } else {
        state.seqInitialized = true;
      }
      updateBalanceNow(); // ← refresh balance on every new period
      // (New results are now handled by the top-level sync logic)
      addLog(`▶ New period …${activePeriod.slice(-4)}`, 'log-skip');

      // Win/loss detection — auto-bet result (manages martingale levels)
      if (state.running && state.pendingResult) {
        state.pendingResult = false;

        // Poll API for up to ~8s until the most-recent period number
        // in the API results changes.
        let resultTop = null;
        const prevPeriod = state.historyPeriodBeforeBet;
        for (let i = 0; i < 16; i++) {
          await sleep(500);
          await updateHistoryFromApi();
          const newPeriod = state.lastHistoryPeriodNum;
          const isNew = newPeriod !== null && newPeriod !== prevPeriod;
          const isFirst = prevPeriod === null && state.lastResults.length > 0;
          if (isNew || isFirst) {
            resultTop = state.lastResults[0];
            break;
          }
        }

        const won = resultTop && state.betPrediction && resultTop === state.betPrediction;
        const betLbl = state.betPrediction === 'B' ? 'Big' : 'Small';

        // Calculate mathematical P/L immediately (Win = +96%, Loss = -100%)
        const betAmt = state.lastBetAmount || 0;
        if (won) {
          const winAmt = betAmt * 0.96;
          state.sessionProfit += winAmt;
          const last = state.fullApiResults && state.fullApiResults[0];
          const detail = last ? `${last.number} ${last.result === 'B' ? 'Big' : 'Small'}` : resultTop;
          addLog(`🏆 WIN Bet #${state.betStep}/${SEQ_LEN} (${betLbl}) — result ${detail} +₹${winAmt.toFixed(2)} | L${state.currentLevel} → reset to L1`, 'log-win');
          state.currentLevel = 1;
        } else {
          const lossAmt = betAmt;
          state.sessionProfit -= lossAmt;
          const last = state.fullApiResults && state.fullApiResults[0];
          const detail = last ? `${last.number} ${last.result === 'B' ? 'Big' : 'Small'}` : (resultTop || '?');
          if (state.currentLevel < state.maxLevels) {
            state.currentLevel++;
            addLog(`💔 LOSS Bet #${state.betStep}/${SEQ_LEN} (${betLbl}) — result ${detail} -₹${lossAmt.toFixed(2)} → L${state.currentLevel} (₹${currentBetAmount()})`, 'log-stop');
          } else {
            addLog(`💔 LOSS Bet #${state.betStep}/${SEQ_LEN} (${betLbl}) — result ${detail} -₹${lossAmt.toFixed(2)} at max L${state.maxLevels} → 🛑 PANEL LOCKED`, 'log-stop');
            stopAutobetWithReason('🛑 MAX LEVEL LOSS\nLost at Level ' + state.maxLevels);
            renderUI();
            return;
          }
        }

        // Refresh balance after result is confirmed (for display)
        await sleep(400);
        updateBalanceNow();

        // After win/loss, check if we hit any risk limits
        if (state.running) checkStops();

        state.historyTopBeforeBet = null;
        state.betPrediction = null;
      }

      // Win/loss detection — monitoring mode (auto-bet OFF, mirrors martingale levels)
      if (state.monitorPendingResult) {
        state.monitorPendingResult = false;
        let monitorResultTop = null;
        const monitorPrevPeriod = state.monitorHistoryPeriod;
        for (let i = 0; i < 16; i++) {
          await sleep(500);
          await updateHistoryFromApi();
          const newPeriod = state.lastHistoryPeriodNum;
          const isNew = newPeriod !== null && newPeriod !== monitorPrevPeriod;
          const isFirst = monitorPrevPeriod === null && state.lastResults.length > 0;
          if (isNew || isFirst) { monitorResultTop = state.lastResults[0]; break; }
        }
        const monitorWon = monitorResultTop && state.monitorPrediction && monitorResultTop === state.monitorPrediction;
        const monLbl = state.monitorPrediction === 'B' ? 'Big' : 'Small';
        const last = state.fullApiResults && state.fullApiResults[0];
        const detail = last ? `${last.number} ${last.result === 'B' ? 'Big' : 'Small'}` : (monitorResultTop || '?');
        if (monitorWon) {
          addLog(`🏆 WIN Bet #${state.monitorStep}/${SEQ_LEN} (${monLbl}) — result ${detail} | L${state.monitorLevel} → reset to L1`, 'log-win');
          state.monitorLevel = 1;
        } else {
          if (state.monitorLevel < state.maxLevels) {
            state.monitorLevel++;
            const nextAmt = Math.max(1, Math.round(state.baseBet * Math.pow(Math.max(1, state.martingaleMul), state.monitorLevel - 1)));
            addLog(`💔 LOSS Bet #${state.monitorStep}/${SEQ_LEN} (${monLbl}) — result ${detail} → L${state.monitorLevel} (₹${nextAmt})`, 'log-stop');
          } else {
            addLog(`💔 LOSS Bet #${state.monitorStep}/${SEQ_LEN} (${monLbl}) — result ${detail} at max L${state.maxLevels} → reset to L1`, 'log-stop');
            state.monitorLevel = 1;
          }
        }
        state.monitorPrediction = null;
        state.monitorHistoryPeriod = null;
      }
    }

    const { s1, s2, combined } = getCombinedPrediction();
    const inTimerWindow = timer && timer.secs > 0 && timer.secs <= winSecs;
    const timerUnknown  = !timer;

    // Refresh balance whenever the combined prediction changes
    const newPred = getCombinedPrediction().combined;
    if (newPred !== state._lastRenderedPred) {
      state._lastRenderedPred = newPred;
      updateBalanceNow();
    }

    if ((inTimerWindow || timerUnknown) && !state.betFired && state.lastResults.filter(Boolean).length >= 2) {
      state.betFired = true;

      if (state.running && !betInProgress) {
        // ── Auto-bet ON: bet EVERY period following the fixed sequence ────────
        if (checkStops()) { renderUI(); return; }
        if (combined) {
          betInProgress = true;
          try { await placeBet(combined); } finally { betInProgress = false; }
          const nb = updateBalanceNow(); // refresh + cache after bet
          if (nb > 0 && state.startBalance > 0) state.sessionProfit = nb - state.startBalance;
          checkStops();
        }
      } else if (!state.running) {
        // ── Auto-bet OFF (watch mode): log the bet to place this period ───────
        if (combined) {
          const monAmt = Math.max(1, Math.round(state.baseBet * Math.pow(Math.max(1, state.martingaleMul), state.monitorLevel - 1)));
          const monLabel = combined === 'B' ? 'Big' : 'Small';
          state.monitorStep = stepNumber();
          addLog(`🎯 Bet #${state.monitorStep}/${SEQ_LEN} → press ${monLabel} (L${state.monitorLevel} ₹${monAmt}) [watch]`, 'log-bet');
          // Mark pending so next period checks win/loss
          state.monitorPendingResult = true;
          state.monitorPrediction = combined;
          state.monitorHistoryPeriod = state.lastHistoryPeriodNum;
        }
      }
    }

    renderUI();
  }

  // ─── CREATE PANEL ────────────────────────────────────────────────────────────
  function createPanel() {
    let panel = document.getElementById('wingo-ab-panel');
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'wingo-ab-panel';
    panel.innerHTML = `
<!-- Minimized ball -->
<div id="wab-ball" title="Open Auto TradeX Pro">⚡</div>

<!-- Full panel -->
<div id="wab-panel-content">
  <!-- Header -->
  <div id="wab-header">
    <div class="wab-title">
      <div class="wab-dot" id="wab-dot"></div>
      <span>Auto TradeX Pro</span>
    </div>
    <div id="wab-header-btns">
      <button id="wab-reload-btn" title="Reload page">↺</button>
      <button id="wab-min-btn" title="Minimize">─</button>
    </div>
  </div>

  <!-- Navigation -->
  <div id="wab-nav">
    <div class="wab-nav-btn active" data-page="main">Main</div>
    <div class="wab-nav-btn" data-page="settings">⚙ Settings</div>
    <div class="wab-nav-btn" data-page="logs">📋 Logs</div>
  </div>

  <!-- ══ PAGE: MAIN ══ -->
  <div id="wab-page-main" class="wab-page">
    <!-- Captured UID (shown after Account page scan; hidden until captured) -->
    <div id="wab-uid-display" data-wab-ignore="true" style="display:none;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;margin-bottom:6px;background:linear-gradient(135deg,rgba(255,107,53,0.18),rgba(255,107,53,0.06));border:1px solid rgba(255,107,53,0.45);border-radius:8px">
      <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:#ff9060" data-wab-ignore="true">GAME UID</span>
      <span id="wab-uid-value" data-wab-ignore="true" style="font-size:14px;font-weight:900;color:#fff;letter-spacing:0.5px;font-family:monospace">—</span>
    </div>
    <!-- Status grid -->
    <div class="wab-status-grid">

      <div class="wab-stat-cell"><span class="wab-stat-lbl">Balance</span><span class="wab-status-val" id="wab-balance">—</span></div>
      <div class="wab-stat-cell"><span class="wab-stat-lbl">Timer</span><span class="wab-status-val yellow" id="wab-timer">—</span></div>
      <div class="wab-stat-cell"><span class="wab-stat-lbl">P/L</span><span class="wab-status-val" id="wab-pl">₹0.00</span></div>
      <div class="wab-stat-cell"><span class="wab-stat-lbl">Bets</span><span class="wab-status-val" id="wab-bets-status">0/IDLE</span></div>
    </div>

    <!-- Level badge -->
    <div id="wab-level-badge" class="wab-level-badge">Level 1 / 5  ₹1</div>
    <div id="wab-level-preview" class="wab-level-preview">L1=₹1  L2=₹2  L3=₹4  L4=₹8  L5=₹16</div>

    <!-- Risk Summary Card -->
    <div class="wab-combined-card" style="margin-top:4px">
      <div class="wab-section-title">ACTIVE RISK SETTINGS</div>
      <div class="wab-risk-summary">
        <div class="wab-risk-item">SL: <span id="wab-main-sl">∞</span></div>
        <div class="wab-risk-item">TG: <span id="wab-main-tg">∞</span></div>
        <div class="wab-risk-item">MB: <span id="wab-main-mb">∞</span></div>
      </div>
    </div>

    <!-- Strategy lock section -->
    <div id="wab-strat-section">
      <div class="wab-strat-header">
        <span class="wab-section-title">STRATEGIES</span>
        <button id="wab-lock-btn" class="wab-lock-btn">🔒 Unlock</button>
      </div>

      <!-- Password prompt (hidden by default) -->
      <div id="wab-pw-row" style="display:none" class="wab-pw-row">
        <input id="wab-pw-input" class="wab-input" type="password" placeholder="Password" maxlength="10" />
        <button id="wab-pw-submit" class="wab-pw-btn">OK</button>
        <button id="wab-pw-cancel" class="wab-pw-btn cancel">✕</button>
      </div>
      <div id="wab-pw-error" style="display:none" class="wab-pw-error">Wrong password</div>

      <!-- Fixed 8-step sequence (hidden until unlocked) -->
      <div id="wab-strategies-body" style="display:none">
        <div class="wab-section-label">FIXED SEQUENCE — BETS EVERY PERIOD</div>
        <div class="wab-seq-grid">
          <div class="wab-seq-cell small" id="wab-seq-0"><span class="wab-seq-num">1</span><span class="wab-seq-val">Small</span></div>
          <div class="wab-seq-cell small" id="wab-seq-1"><span class="wab-seq-num">2</span><span class="wab-seq-val">Small</span></div>
          <div class="wab-seq-cell big"   id="wab-seq-2"><span class="wab-seq-num">3</span><span class="wab-seq-val">Big</span></div>
          <div class="wab-seq-cell small" id="wab-seq-3"><span class="wab-seq-num">4</span><span class="wab-seq-val">Small</span></div>
          <div class="wab-seq-cell big"   id="wab-seq-4"><span class="wab-seq-num">5</span><span class="wab-seq-val">Big</span></div>
          <div class="wab-seq-cell big"   id="wab-seq-5"><span class="wab-seq-num">6</span><span class="wab-seq-val">Big</span></div>
          <div class="wab-seq-cell small" id="wab-seq-6"><span class="wab-seq-num">7</span><span class="wab-seq-val">Small</span></div>
          <div class="wab-seq-cell big"   id="wab-seq-7"><span class="wab-seq-num">8</span><span class="wab-seq-val">Big</span></div>
        </div>
        <div class="wab-seq-note">↻ After bet #8 it loops back to #1 · resets on refresh</div>
      </div>
    </div>

    <!-- Combined prediction (always visible) -->
    <div class="wab-combined-card">
      <div class="wab-section-title">COMBINED PREDICTION</div>
      <div class="wab-combined-inner">
        <div class="wab-predict-bubble lg wait" id="wab-predict">—</div>
        <span class="wab-match-label" id="wab-match-label">Waiting for data…</span>
      </div>
    </div>

    <!-- Start/Stop -->
    <button class="wab-main-btn start" id="wab-start-btn">▶ Start Auto Bet</button>
  </div><!-- /page-main -->

  <!-- ══ PAGE: SETTINGS ══ -->
  <div id="wab-page-settings" class="wab-page" style="display:none">
    <div class="wab-settings-title">⚙ Settings</div>

    <div class="wab-settings-group">
      <div class="wab-sg-label">MARTINGALE</div>
      <div class="wab-input-row">
        <span class="wab-input-label">Base Bet ₹</span>
        <input class="wab-input" type="number" id="wab-bet-input" value="1" min="1" />
      </div>
      <div class="wab-input-row">
        <span class="wab-input-label">Multiplier ×</span>
        <input class="wab-input" type="number" id="wab-mul-input" value="2" min="1" step="0.1" />
      </div>
      <div class="wab-input-row">
        <span class="wab-input-label">Levels</span>
        <input class="wab-input" type="number" id="wab-lvl-input" value="5" min="1" max="30" />
      </div>
      <div class="wab-preview-box" id="wab-settings-preview">L1=₹1  L2=₹2  L3=₹4  L4=₹8  L5=₹16</div>
    </div>

    <div class="wab-settings-group">
      <div class="wab-sg-label">RISK MANAGEMENT</div>
      <div class="wab-input-row">
        <span class="wab-input-label">Stop Loss ₹</span>
        <input class="wab-input" type="number" id="wab-sl-input" value="0" min="0" placeholder="0=off" />
      </div>
      <div class="wab-input-row">
        <span class="wab-input-label">Target ₹</span>
        <input class="wab-input" type="number" id="wab-tg-input" value="0" min="0" placeholder="0=off" />
      </div>
      <div class="wab-input-row">
        <span class="wab-input-label">Max Bets</span>
        <input class="wab-input" type="number" id="wab-mb-input" value="0" min="0" placeholder="0=∞" />
      </div>
    </div>

    <div class="wab-action-row">
      <div class="wab-action-btn" id="wab-reset-btn">Reset Stats</div>
      <div class="wab-action-btn" id="wab-reload-page-btn">⟳ Reload</div>
    </div>
    <div class="wab-action-row">
      <div class="wab-action-btn" id="wab-apply-btn" style="flex:1;background:rgba(255,107,53,.18);border-color:rgba(255,107,53,.4);color:#ff6b35">✓ Apply Settings</div>
    </div>
    <div id="wab-save-success" class="wab-save-success" style="display:none">✓ Settings saved successfully</div>
  </div><!-- /page-settings -->

  <!-- ══ PAGE: LOGS ══ -->
  <div id="wab-page-logs" class="wab-page" style="display:none">

    <!-- Log content (shown when unlocked, always rendered in background) -->
    <div id="wab-log-content">
      <div class="wab-settings-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>📋 Logs</span>
        <span id="wab-log-relock" style="cursor:pointer;font-size:18px;opacity:0.7" title="Lock logs">🔒</span>
      </div>

      <!-- Statistics Boxes -->
      <!-- Line 1: Total Wins & Total Losses -->
      <div class="wab-stats-row">
        <div class="wab-stats-box wab-stats-win">
          <div class="wab-stats-label">Total Wins</div>
          <div class="wab-stats-value" id="wab-stat-wins">0</div>
        </div>
        <div class="wab-stats-box wab-stats-loss">
          <div class="wab-stats-label">Total Losses</div>
          <div class="wab-stats-value" id="wab-stat-losses">0</div>
        </div>
      </div>

      <!-- Line 2: Max Win Streak & Max Loss Streak (Level) -->
      <div class="wab-stats-row">
        <div class="wab-stats-box wab-stats-win">
          <div class="wab-stats-label">Level</div>
          <div class="wab-stats-value" id="wab-stat-max-win-streak">0</div>
        </div>
        <div class="wab-stats-box wab-stats-loss">
          <div class="wab-stats-label">Level</div>
          <div class="wab-stats-value" id="wab-stat-max-loss-streak">0</div>
        </div>
      </div>

      <!-- Line 3: Total Skipped Bets -->
      <div class="wab-stats-row">
        <div class="wab-stats-box wab-stats-skip" style="flex:1">
          <div class="wab-stats-label">Total Skipped Bets</div>
          <div class="wab-stats-value" id="wab-stat-skipped">0</div>
        </div>
      </div>

      <div class="wab-action-row" style="margin-bottom:6px">
        <div class="wab-action-btn" id="wab-clear-log-btn">Clear Logs</div>
      </div>
      <div class="wab-log-full" id="wab-log-page"></div>
    </div>

  </div><!-- /page-logs -->

</div><!-- /wab-panel-content -->

  <!-- ══ GATE OVERLAY — shown when not on the 30s game page ══ -->
  <div id="wab-gate-overlay">
    <button class="wab-overlay-min-btn" title="Minimize">_</button>
    <div class="wab-gate-icon">🎯</div>
    <div class="wab-gate-title">WAITING FOR GAME SCAN</div>
    
    <!-- Captured UID Display on 30s Game Gate -->
    <div id="wab-gate-uid-box" data-wab-ignore="true" style="display:none;margin:10px 0;padding:8px 15px;background:rgba(255,107,53,0.2);border:1px solid rgba(255,107,53,0.5);border-radius:8px;animation:wab-pulse 2s infinite">
      <div style="font-size:10px;color:#ff9060;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px" data-wab-ignore="true">Locked UID</div>
      <div id="wab-gate-uid-value" data-wab-ignore="true" style="font-size:18px;font-weight:900;color:#fff;font-family:monospace;letter-spacing:2px"></div>
    </div>

    <div class="wab-gate-sub">Scan balance, timer and 30sec tap<br>to activate Auto TradeX Pro</div>
    <div class="wab-gate-arrow">↓</div>
  </div>



  <!-- ══ UID GATE — shown when in 30s game but UID not captured yet ══ -->
  <div id="wab-uid-gate" class="wab-gate-overlay" style="display:none">
    <button class="wab-overlay-min-btn" title="Minimize">_</button>
    <div class="wab-gate-icon" style="font-size:38px">👤</div>
    <div class="wab-gate-title" style="font-size:19px;letter-spacing:2px;line-height:1.2">OPEN YOUR<br>ACCOUNT</div>
    <div class="wab-gate-sub" style="font-size:12px;max-width:200px;color:#ffd0b8">
      Go to the <b style="color:#fff">Account</b> tab so Auto TradeX Pro can read and lock your <b style="color:#ff9060">Game UID</b>.
    </div>
    <div class="wab-gate-sub" style="font-size:10px;color:#888;margin-top:4px">
      UID stays locked until the browser is closed.
    </div>
    <div class="wab-gate-arrow">↓</div>
  </div>

  <!-- ══ KEY ACTIVATION GATE — shown after UID capture, requires key entry ══ -->
  <div id="wab-key-gate" class="wab-gate-overlay" style="display:none">
    <button class="wab-overlay-min-btn" title="Minimize" data-no-drag>_</button>
    <div class="wab-gate-icon" style="font-size:32px">🔑</div>
    <div class="wab-gate-title" style="font-size:16px;letter-spacing:1px">ACTIVATE KEY</div>
    <div id="wab-key-gate-uid-box" data-wab-ignore="true" style="margin:8px 0;padding:8px 14px;background:rgba(255,107,53,0.15);border:1px solid rgba(255,107,53,0.4);border-radius:8px">
      <span style="font-size:10px;color:#ff9060;display:block;margin-bottom:2px" data-wab-ignore="true">GAME UID</span>
      <span id="wab-key-gate-uid-display" data-wab-ignore="true" style="font-size:16px;font-weight:900;color:#fff;font-family:monospace;letter-spacing:2px">—</span>
    </div>
    <div class="wab-gate-sub" style="font-size:11px;max-width:220px;color:#aaa">Enter your activation key to unlock</div>
    <div style="display:flex;flex-direction:column;gap:6px;width:100%;max-width:220px;margin-top:6px" data-wab-ignore="true">
      <input id="wab-key-input" class="wab-input" type="text" placeholder="XXXX-XXXX-XXXX" maxlength="14" autocomplete="off" data-wab-ignore="true" style="text-align:center;font-family:monospace;font-size:15px;letter-spacing:2px;text-transform:uppercase">
      <button id="wab-key-activate-btn" class="wab-key-btn" data-wab-ignore="true" style="padding:10px;background:linear-gradient(135deg,#ff6b35,#ff9500);border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">Activate →</button>
    </div>
    <div id="wab-key-error" data-wab-ignore="true" style="display:none;color:#f87171;font-size:11px;margin-top:6px;max-width:220px;text-align:center"></div>
    <div id="wab-key-already-used" data-wab-ignore="true" style="display:none;flex-direction:column;align-items:center;gap:8px;margin-top:10px;max-width:240px">
      <div style="font-size:16px;font-weight:800;color:#f87171;text-align:center">⚠ KEY ALREADY USED</div>
      <div style="font-size:11px;color:#aaa;text-align:center">This key is already activated on another device.<br>Contact support for assistance.</div>
      <a id="wab-key-telegram-btn" data-wab-ignore="true" target="_blank" style="display:inline-block;padding:10px 20px;background:#0088cc;color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer">📱 Contact on Telegram</a>
      <button id="wab-key-back-btn" class="wab-key-back-btn" data-wab-ignore="true" style="padding:8px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#ccc;font-size:12px;font-weight:600;cursor:pointer">← Try Another Key</button>
    </div>
    <div id="wab-key-uid-mismatch" data-wab-ignore="true" style="display:none;flex-direction:column;align-items:center;gap:8px;margin-top:10px;max-width:240px">
      <div style="font-size:16px;font-weight:800;color:#facc15;text-align:center">⚠ UID MISMATCH</div>
      <div style="font-size:11px;color:#aaa;text-align:center">This key is not for this UID.<br>Please login with the correct ID.</div>
      <a id="wab-key-telegram-btn2" data-wab-ignore="true" target="_blank" style="display:inline-block;padding:10px 20px;background:#0088cc;color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer">📱 Contact on Telegram</a>
      <button id="wab-key-another-btn" class="wab-key-back-btn" data-wab-ignore="true" style="padding:8px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#ccc;font-size:12px;font-weight:600;cursor:pointer">+ Add Another Key</button>
    </div>
    <div id="wab-key-connection-error" data-wab-ignore="true" style="display:none;flex-direction:column;align-items:center;gap:8px;margin-top:10px">
      <div style="font-size:14px;font-weight:800;color:#f87171;text-align:center">📡 CONNECTION ERROR</div>
      <div style="font-size:11px;color:#aaa;text-align:center">Could not reach the license server.</div>
      <button id="wab-key-retry-btn" class="wab-key-btn" data-wab-ignore="true" style="padding:10px 24px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">🔄 Retry</button>
    </div>
  </div>

  <!-- ══ KEY EXPIRED OVERLAY ══ -->
  <div id="wab-key-expired-gate" class="wab-gate-overlay" style="display:none">
    <button class="wab-overlay-min-btn" title="Minimize" data-no-drag>_</button>
    <div class="wab-gate-icon" style="font-size:36px">⏰</div>
    <div class="wab-gate-title" style="font-size:16px">KEY EXPIRED</div>
    <div class="wab-gate-sub" style="font-size:11px;max-width:200px;color:#f87171">Your activation key has expired.</div>
    <button id="wab-key-expired-new-btn" class="wab-key-btn" data-wab-ignore="true" style="padding:10px 20px;background:linear-gradient(135deg,#ff6b35,#ff9500);border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin-top:10px">Enter New Key →</button>
    <a id="wab-key-expired-telegram" data-wab-ignore="true" target="_blank" style="display:inline-block;padding:8px 16px;background:#0088cc;color:#fff;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;cursor:pointer;margin-top:6px">📱 Contact Support</a>
  </div>

  <!-- ══ 30-SEC LOADING GATE ══ -->
  <div id="wab-key-loading-gate" class="wab-gate-overlay" style="display:none">
    <div class="wab-gate-icon" style="font-size:38px">✅</div>
    <div class="wab-gate-title" style="font-size:18px;letter-spacing:1px">ACTIVATED!</div>
    <div class="wab-gate-sub" style="font-size:12px;max-width:200px;color:#4ade80">Key verified successfully.</div>
    <div id="wab-key-loading-timer" style="font-size:36px;font-weight:900;color:#ff6b35;margin:10px 0">30</div>
    <div class="wab-gate-sub" style="font-size:10px;color:#888">Loading… please wait</div>
  </div>

<div id="wab-autostop-overlay" class="wab-gate-overlay" style="display:none">
  <button class="wab-overlay-min-btn" title="Minimize">_</button>
  <div class="wab-gate-icon">🛑</div>
  <div class="wab-gate-title">AUTO BET STOPPED</div>
  <div class="wab-gate-sub" id="wab-autostop-reason">Reason will appear here</div>
  <button id="wab-autostop-refresh" class="wab-autostop-btn">🔄 Refresh & Restart</button>
</div>

<!-- ══ LOGS LOCK OVERLAY — shown when logs are locked ══ -->
<div id="wab-log-lock" class="wab-gate-overlay" style="display:none">
  <button class="wab-overlay-min-btn" title="Minimize">_</button>
  <div class="wab-gate-icon">🔒</div>
  <div class="wab-gate-title">LOGS LOCKED</div>
  <div class="wab-gate-sub">Enter password to view logs</div>
  <div style="display:flex;gap:8px;margin-bottom:8px;width:100%;max-width:200px">
    <input id="wab-log-pw" class="wab-input" type="password" placeholder="Password" maxlength="10" style="flex:1"/>
    <button id="wab-log-pw-submit" class="wab-pw-btn">OK</button>
  </div>
  <div id="wab-log-pw-error" style="display:none;color:#f87171;font-size:11px;margin-top:4px">Wrong password</div>
  <button id="wab-log-return-main" data-no-drag
    style="margin-top:10px;padding:6px 12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:#ccc;font-size:11px;font-weight:600;cursor:pointer">
    ← Return to Main
  </button>
</div>

<!-- Resize handles -->
<div class="wab-resize wab-resize-se" id="wab-resize-se"></div>
<div class="wab-resize wab-resize-sw"></div>
<div class="wab-resize wab-resize-ne"></div>
<div class="wab-resize wab-resize-nw"></div>
<div class="wab-resize wab-resize-e"></div>
<div class="wab-resize wab-resize-w"></div>
<div class="wab-resize wab-resize-s"></div>
<div class="wab-resize wab-resize-n"></div>
    `;

    document.body.appendChild(panel);

    // Armor styles — force our nodes to stay visible/interactive even if the
    // host site injects hostile CSS. !important beats inline overrides.
    if (!document.getElementById('wab-armor')) {
      const armor = document.createElement('style');
      armor.id = 'wab-armor';
      armor.textContent = `
        #wingo-ab-panel {
          position: fixed !important;
          z-index: 2147483647 !important;
          pointer-events: auto !important;
          visibility: visible !important;
          opacity: 1 !important;
          filter: none !important;
          clip: auto !important;
          clip-path: none !important;
        }
        #wab-gate-overlay, #wab-autostop-overlay, #wab-log-lock, #wab-uid-gate {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: auto !important;
          height: auto !important;
          z-index: 9999 !important;
          pointer-events: auto !important;
          visibility: visible !important;
          opacity: 1 !important;
          filter: none !important;
          clip: auto !important;
          clip-path: none !important;
        }
        #wingo-ab-panel.hidden { display: none !important; }
        #wab-key-gate, #wab-key-expired-gate, #wab-key-loading-gate {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: auto !important;
          height: auto !important;
          z-index: 10000 !important;
          pointer-events: auto !important;
          visibility: visible !important;
          opacity: 1 !important;
          filter: none !important;
          clip: auto !important;
          clip-path: none !important;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(160deg,rgba(10,10,20,0.96),rgba(17,24,39,0.96));
          border-radius: 20px;
          border: 2px solid rgba(255,107,53,0.4);
        }
        #wab-key-input {
          width: 100%;
          background: rgba(255,255,255,0.08) !important;
          border: 1px solid rgba(255,107,53,0.3) !important;
          border-radius: 8px !important;
          color: #fff !important;
          padding: 10px 14px !important;
          outline: none !important;
          transition: border-color 0.2s;
        }
        #wab-key-input:focus {
          border-color: #ff6b35 !important;
          box-shadow: 0 0 12px rgba(255,107,53,0.3);
        }
        #wab-key-input::placeholder { color: #555; }
        .wab-key-btn:active { opacity: 0.85; transform: scale(0.97); }
        .wab-key-back-btn:active { opacity: 0.7; }
        #wingo-ab-panel #wab-ball {
          position: relative !important;
          inset: auto !important;
          width: 100% !important;
          height: 100% !important;
          max-width: 100% !important;
          max-height: 100% !important;
        }
        @keyframes wab-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.02); opacity: 0.8; }
          100% { transform: scale(1); opacity: 1; }
        }
      `;
      (document.head || document.documentElement).appendChild(armor);
    }


    // Set ball logo image — must use chrome.runtime.getURL so the extension
    // asset URL is valid from within a content script context.
    try {
      const ballEl = document.getElementById('wab-ball');
      if (ballEl) {
        const logoUrl = chrome.runtime.getURL('ball_logo.jpg');
        ballEl.style.backgroundImage = `url('${logoUrl}')`;
      }
    } catch (e) { /* non-extension context — ignore */ }

    const saved = tryLoad('wab_pos');
    if (saved) { panel.style.left = saved.x + 'px'; panel.style.top = saved.y + 'px'; panel.style.right = 'auto'; }
    const savedSize = tryLoad('wab_size');
    if (savedSize) { panel.style.width = savedSize.w + 'px'; panel.style.height = savedSize.h + 'px'; }

    makeDraggable(panel);
    makeResizable(panel);
    bindEvents(panel);
    makeOverlayDraggable(document.getElementById('wab-gate-overlay'));
    makeOverlayDraggable(document.getElementById('wab-uid-gate'));
    makeOverlayDraggable(document.getElementById('wab-log-lock'));

    // Restore captured UID display on panel (re)create
    const _uid = getCapturedUID();
    if (_uid) {
      const _disp = document.getElementById('wab-uid-display');
      const _val = document.getElementById('wab-uid-value');
      if (_disp && _val) { 
        _disp.style.display = 'flex'; 
        _val.textContent = _uid; 
      }
      
      const _gateUIDVal = document.getElementById('wab-gate-uid-value');
      const _gateUIDBox = document.getElementById('wab-gate-uid-box');
      if (_gateUIDVal && _gateUIDBox) {
        _gateUIDBox.style.display = 'block';
        _gateUIDVal.textContent = _uid;
      }
    }
    updateSettingsPreview();
    ensureInBounds();
  }

  function ensureInBounds() {
    const panel = document.getElementById('wingo-ab-panel');
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let newL = parseInt(panel.style.left) || 0;
    let newT = parseInt(panel.style.top) || 0;

    // If completely off-screen or extreme momentum pushed it out
    if (newL + rect.width < 0 || newL > winW || newT + rect.height < 0 || newT > winH) {
      newL = Math.max(10, Math.min(winW - rect.width - 10, newL));
      newT = Math.max(10, Math.min(winH - rect.height - 10, newT));
      panel.style.left = newL + 'px';
      panel.style.top = newT + 'px';
      panel.style.right = 'auto';
    }
  }

  function tryLoad(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function trySave(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  // ─── DRAG ────────────────────────────────────────────────────────────────────
  function makeDraggable(panel) {
    const header = document.getElementById('wab-header');
    const ball   = document.getElementById('wab-ball');
    let sx, sy, ox, oy, active = false, moved = false;
    // Velocity tracking for dragMomentum (like motion/react dragMomentum=true)
    let vx = 0, vy = 0, lastX = 0, lastY = 0, lastT = 0;
    let momentumRAF = null;

    function getXY(e) { return e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY }; }

    function onStart(e) {
      if (['BUTTON','INPUT'].includes(e.target.tagName)) return;
      // Cancel any ongoing momentum slide when user grabs again
      if (momentumRAF) { cancelAnimationFrame(momentumRAF); momentumRAF = null; }
      active = true; moved = false;
      vx = 0; vy = 0;
      const p = getXY(e);
      const r = panel.getBoundingClientRect();
      sx = p.x; sy = p.y; ox = r.left; oy = r.top;
      lastX = p.x; lastY = p.y; lastT = performance.now();
      panel.style.transition = 'none'; e.preventDefault();
    }

    function onMove(e) {
      if (!active) return;
      const p = getXY(e);
      // Track instantaneous velocity (px/ms) for momentum on release
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) { vx = (p.x - lastX) / dt; vy = (p.y - lastY) / dt; }
      lastX = p.x; lastY = p.y; lastT = now;
      let nx = ox + p.x - sx, ny = oy + p.y - sy;
      if (Math.abs(p.x - sx) > 4 || Math.abs(p.y - sy) > 4) moved = true;
      nx = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  nx));
      ny = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ny));
      panel.style.left = nx + 'px'; panel.style.top = ny + 'px'; panel.style.right = 'auto';
      e.preventDefault();
    }

    function onEnd() {
      if (!active) return;
      active = false;
      // dragMomentum — only applied when ball is minimized (like the React FAB)
      // dragElastic=0.15 → walls bounce back with 40% restitution
      if (panel.classList.contains('minimized') && (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05)) {
        const FRICTION = 0.993; // near-zero friction = extremely long glide
        let curX = parseFloat(panel.style.left) || 0;
        let curY = parseFloat(panel.style.top)  || 0;
        let velX = vx * 900; // very high launch speed
        let velY = vy * 900;
        function slide() {
          velX *= FRICTION;
          velY *= FRICTION;
          curX += velX;
          curY += velY;
          const maxX = window.innerWidth  - panel.offsetWidth;
          const maxY = window.innerHeight - panel.offsetHeight;
          // Elastic wall bounce (dragElastic effect)
          if (curX < 0)    { curX = 0;    velX =  Math.abs(velX) * 0.5; }
          if (curX > maxX) { curX = maxX; velX = -Math.abs(velX) * 0.5; }
          if (curY < 0)    { curY = 0;    velY =  Math.abs(velY) * 0.5; }
          if (curY > maxY) { curY = maxY; velY = -Math.abs(velY) * 0.5; }
          panel.style.left = curX + 'px';
          panel.style.top  = curY + 'px';
          panel.style.right = 'auto';
          if (Math.abs(velX) > 0.15 || Math.abs(velY) > 0.15) {
            momentumRAF = requestAnimationFrame(slide);
          } else {
            momentumRAF = null;
            trySave('wab_pos', { x: Math.round(curX), y: Math.round(curY) });
          }
        }
        momentumRAF = requestAnimationFrame(slide);
      } else {
        trySave('wab_pos', { x: parseInt(panel.style.left)||0, y: parseInt(panel.style.top)||0 });
      }
    }

    // Ball click (tap without drag → restore)
    ball.addEventListener('click', () => { if (!moved) setMinimized(false); });
    ball.addEventListener('touchend', () => { if (!moved) setMinimized(false); });

    [header, ball].forEach(el => {
      el.addEventListener('mousedown',  onStart);
      el.addEventListener('touchstart', onStart, { passive: false });
    });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchend',  onEnd);
  }

  // ─── OVERLAY DRAG (lock overlays: gate + logs) ───────────────────────────────
  function makeOverlayDraggable(el) {
    if (!el) return;
    // The overlay covers the whole panel, so dragging the overlay drags the panel itself.
    const panel = document.getElementById('wingo-ab-panel');
    if (!panel) return;
    let sx, sy, ox, oy, active = false;
    function pt(e) { return e.touches ? e.touches[0] : e; }
    function onStart(e) {
      const t = e.target;
      if (t.closest('input, button, [data-no-drag]')) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = rect.left + 'px';
      panel.style.top  = rect.top  + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      const p = pt(e);
      sx = p.clientX; sy = p.clientY;
      ox = rect.left; oy = rect.top;
      active = true;
      if (e.cancelable) e.preventDefault();
    }
    function onMove(e) {
      if (!active) return;
      const p = pt(e);
      let nl = ox + (p.clientX - sx);
      let nt = oy + (p.clientY - sy);
      nl = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  nl));
      nt = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, nt));
      panel.style.left = nl + 'px';
      panel.style.top  = nt + 'px';
      if (e.cancelable) e.preventDefault();
    }
    function onEnd() { active = false; }
    el.addEventListener('mousedown',  onStart);
    el.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchend',  onEnd);
  }

  // ─── RESIZE ──────────────────────────────────────────────────────────────────
  function makeResizable(panel) {
    const MIN_W = 200, MIN_H = 280;
    document.querySelectorAll('.wab-resize').forEach(handle => {
      let startX, startY, startW, startH, startL, startT;
      const dir = [...handle.classList].find(c => c.startsWith('wab-resize-') && c !== 'wab-resize').replace('wab-resize-','');
      function onStart(e) {
        e.preventDefault(); e.stopPropagation();
        const ev = e.touches ? e.touches[0] : e;
        startX = ev.clientX; startY = ev.clientY;
        startW = panel.offsetWidth; startH = panel.offsetHeight;
        startL = parseInt(panel.style.left)||panel.getBoundingClientRect().left;
        startT = parseInt(panel.style.top) ||panel.getBoundingClientRect().top;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup',   onEnd);
        document.addEventListener('touchend',  onEnd);
      }
      function onMove(e) {
        e.preventDefault();
        const ev = e.touches ? e.touches[0] : e;
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        let newW = startW, newH = startH, newL = startL, newT = startT;
        if (dir.includes('e'))  newW = Math.max(MIN_W, startW + dx);
        if (dir.includes('s'))  newH = Math.max(MIN_H, startH + dy);
        if (dir.includes('w'))  { newW = Math.max(MIN_W, startW - dx); newL = startL + (startW - newW); }
        if (dir.includes('n'))  { newH = Math.max(MIN_H, startH - dy); newT = startT + (startH - newH); }
        panel.style.width = newW + 'px'; panel.style.height = newH + 'px';
        panel.style.left  = newL + 'px'; panel.style.top   = newT + 'px'; panel.style.right = 'auto';
      }
      function onEnd() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup',   onEnd);
        document.removeEventListener('touchend',  onEnd);
        trySave('wab_size', { w: panel.offsetWidth, h: panel.offsetHeight });
        trySave('wab_pos',  { x: parseInt(panel.style.left)||0, y: parseInt(panel.style.top)||0 });
      }
      handle.addEventListener('mousedown',  onStart);
      handle.addEventListener('touchstart', onStart, { passive: false });
    });
  }

  // ─── MINIMIZE / RESTORE ──────────────────────────────────────────────────────
  function setMinimized(minimize) {
    // If key expired, don't allow minimizing — keep expired gate visible
    if (getStoredKey() && isKeyExpiredLocally()) {
      const expiredGate = document.getElementById('wab-key-expired-gate');
      if (expiredGate) expiredGate.style.display = 'flex';
      const ball = document.getElementById('wab-ball');
      if (ball) ball.style.display = 'none';
      return;
    }
    const panel = document.getElementById('wingo-ab-panel');
    const content = document.getElementById('wab-panel-content');
    const ball    = document.getElementById('wab-ball');
    if (minimize) {
      // Save current size before minimizing
      trySave('wab_size_pre_min', { w: panel.offsetWidth, h: panel.offsetHeight });
      panel.classList.add('minimized');
      content.style.display = 'none';
      ball.style.display = 'flex';
    } else {
      panel.classList.remove('minimized');
      content.style.display = '';
      ball.style.display = 'none';
      // Restore saved size
      const saved = tryLoad('wab_size_pre_min') || tryLoad('wab_size');
      if (saved) { panel.style.width = saved.w + 'px'; panel.style.height = saved.h + 'px'; }
    }
  }

  // ─── PAGE NAVIGATION ─────────────────────────────────────────────────────────
  function showPage(name) {
    ['main','settings','logs'].forEach(p => {
      const pg = document.getElementById('wab-page-' + p);
      const btn = document.querySelector(`.wab-nav-btn[data-page="${p}"]`);
      if (pg)  pg.style.display  = (p === name) ? '' : 'none';
      if (btn) btn.classList.toggle('active', p === name);
    });
  }

  // ─── SETTINGS PREVIEW ────────────────────────────────────────────────────────
  function updateSettingsPreview() {
    const prev = document.getElementById('wab-settings-preview');
    const lvlPrev = document.getElementById('wab-level-preview');
    const txt = buildLevelPreview();
    if (prev) prev.textContent = txt;
    if (lvlPrev) lvlPrev.textContent = txt;
  }

  // ─── LOG LOCK HELPERS ────────────────────────────────────────────────────────
  function showLogLock() {
    const lock = document.getElementById('wab-log-lock');
    const content = document.getElementById('wab-log-content');
    if (lock) lock.style.display = 'flex';
    if (content) content.style.display = 'none';
    const pw = document.getElementById('wab-log-pw');
    if (pw) { pw.value = ''; }
    document.getElementById('wab-log-pw-error').style.display = 'none';
  }

  function showLogContent() {
    const lock = document.getElementById('wab-log-lock');
    const content = document.getElementById('wab-log-content');
    if (lock) lock.style.display = 'none';
    if (content) content.style.display = '';
    showPage('logs');
    renderLogs();
  }

  function checkLogPassword() {
    const val = (document.getElementById('wab-log-pw')?.value || '').trim();
    if (val === '5299') {
      state.logsUnlocked = true;
      showLogContent();
    } else {
      document.getElementById('wab-log-pw-error').style.display = 'block';
      document.getElementById('wab-log-pw').value = '';
    }
  }

  // ─── BIND EVENTS ─────────────────────────────────────────────────────────────
  function bindEvents(panel) {
    // Navigation — logs tab shows lock screen if not unlocked
    panel.querySelectorAll('.wab-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.page === 'logs') {
          if (state.logsUnlocked) {
            showPage('logs');
            showLogContent();
          } else {
            // Do not switch page if locked, just show the lock overlay over current page
            showLogLock();
            setTimeout(() => document.getElementById('wab-log-pw')?.focus(), 100);
          }
        } else {
          showPage(btn.dataset.page);
        }
      });
    });

    // Minimize to ball
    document.getElementById('wab-min-btn').addEventListener('click', () => setMinimized(true));
    panel.querySelectorAll('.wab-overlay-min-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMinimized(true);
      });
    });

    // Reload
    document.getElementById('wab-reload-btn').addEventListener('click', () => location.reload());
    document.getElementById('wab-reload-page-btn').addEventListener('click', () => location.reload());

    // Game type is fixed to 30s — no buttons to bind

    // Start/stop
    document.getElementById('wab-start-btn').addEventListener('click', toggleAutobet);

    // Apply settings — with debounce and visual feedback
    let applySaving = false;
    document.getElementById('wab-apply-btn').addEventListener('click', async function(e) {
      if (applySaving) return; // Prevent multiple rapid clicks
      applySaving = true;
      
      const btn = this;
      const originalText = btn.textContent;
      const successMsg = document.getElementById('wab-save-success');
      
      // Visual feedback: button state change
      btn.style.opacity = '0.6';
      btn.textContent = '⏳ Saving...';
      
      try {
        // Small delay to ensure DOM updates are processed
        await new Promise(r => setTimeout(r, 100));
        
        // Apply settings
        syncInputs();
        updateSettingsPreview();
        addLog(`Settings applied: base=₹${state.baseBet} ×${state.martingaleMul} L${state.maxLevels}`, 'log-skip');
        
        // Show success message
        btn.textContent = '✓ Saved!';
        btn.style.opacity = '1';
        btn.style.background = 'rgba(74, 222, 128, 0.18)';
        btn.style.borderColor = 'rgba(74, 222, 128, 0.4)';
        btn.style.color = '#4ade80';
        
        if (successMsg) {
          successMsg.style.display = '';
          successMsg.classList.add('wab-save-success-show');
        }
        
        // Wait before navigating to show success state
        await new Promise(r => setTimeout(r, 1200));
        
        // Reset button and navigate
        btn.textContent = originalText;
        btn.style.opacity = '1';
        btn.style.background = 'rgba(255,107,53,.18)';
        btn.style.borderColor = 'rgba(255,107,53,.4)';
        btn.style.color = '#ff6b35';
        
        if (successMsg) {
          successMsg.classList.remove('wab-save-success-show');
          setTimeout(() => { successMsg.style.display = 'none'; }, 300);
        }
        
        showPage('main');
      } finally {
        applySaving = false;
      }
    });

    // Live preview update as user types
    ['wab-bet-input','wab-mul-input','wab-lvl-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        syncInputs();
        updateSettingsPreview();
      });
    });

    // Reset stats
    document.getElementById('wab-reset-btn').addEventListener('click', () => {
      state.betsPlaced = 0; state.sessionProfit = 0;
      state.lastBetPeriod = ''; state.betFired = false;
      state.currentLevel = 1; state.pendingResult = false;
      state.monitorLevel = 1; state.monitorPendingResult = false;
      state.totalWins = 0; state.totalLosses = 0; state.totalSkipped = 0;
      state.maxWinStreak = 0; state.maxLossStreak = 0;
      state.currentWinStreak = 0; state.currentLossStreak = 0;
      addLog('Stats reset', 'log-skip'); renderUI();
    });

    // Clear logs
    document.getElementById('wab-clear-log-btn').addEventListener('click', () => {
      state.log = [];
      state.totalWins = 0; state.totalLosses = 0; state.totalSkipped = 0;
      state.maxWinStreak = 0; state.maxLossStreak = 0;
      state.currentWinStreak = 0; state.currentLossStreak = 0;
      renderLogs();
    });

    // Logs password submit
    document.getElementById('wab-log-pw-submit').addEventListener('click', checkLogPassword);
    document.getElementById('wab-log-pw').addEventListener('keydown', e => {
      if (e.key === 'Enter') checkLogPassword();
    });

    // Return-to-main from logs lock overlay (does NOT unlock logs)
    const returnMainBtn = document.getElementById('wab-log-return-main');
    if (returnMainBtn) {
      returnMainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lock = document.getElementById('wab-log-lock');
        if (lock) lock.style.display = 'none';
        showPage('main');
      });
    }

    // Re-lock logs
    document.getElementById('wab-log-relock').addEventListener('click', () => {
      state.logsUnlocked = false;
      showLogLock();
    });

    // Strategy lock / unlock
    document.getElementById('wab-lock-btn').addEventListener('click', () => {
      if (state.strategiesUnlocked) {
        // Re-lock
        state.strategiesUnlocked = false;
        state.pwInputVisible = false;
        document.getElementById('wab-strategies-body').style.display = 'none';
        document.getElementById('wab-pw-row').style.display = 'none';
        document.getElementById('wab-pw-error').style.display = 'none';
        document.getElementById('wab-lock-btn').textContent = '🔒 Unlock';
      } else {
        // Toggle password input
        state.pwInputVisible = !state.pwInputVisible;
        document.getElementById('wab-pw-row').style.display = state.pwInputVisible ? 'flex' : 'none';
        document.getElementById('wab-pw-error').style.display = 'none';
        if (state.pwInputVisible) {
          const inp = document.getElementById('wab-pw-input');
          inp.value = '';
          setTimeout(() => inp.focus(), 100);
        }
      }
    });

    document.getElementById('wab-pw-submit').addEventListener('click', checkPassword);
    document.getElementById('wab-pw-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') checkPassword();
    });
    document.getElementById('wab-pw-cancel').addEventListener('click', () => {
      state.pwInputVisible = false;
      document.getElementById('wab-pw-row').style.display = 'none';
      document.getElementById('wab-pw-error').style.display = 'none';
    });

    // Auto-stop refresh button
    document.getElementById('wab-autostop-refresh').addEventListener('click', () => {
      state.autoStopLocked = false;
      state.autoStopReason = '';
      location.reload();
    });

    // ═══ KEY GATE EVENT BINDINGS ═══

    // Key input auto-formatting XXXX-XXXX-XXXX
    const keyInput = document.getElementById('wab-key-input');
    if (keyInput) {
      keyInput.addEventListener('input', function(e) {
        let val = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (val.length > 12) val = val.slice(0, 12);
        // Auto-insert dashes
        if (val.length > 8) {
          val = val.slice(0, 4) + '-' + val.slice(4, 8) + '-' + val.slice(8);
        } else if (val.length > 4) {
          val = val.slice(0, 4) + '-' + val.slice(4);
        }
        this.value = val;
        // Hide errors on new input
        document.getElementById('wab-key-error').style.display = 'none';
        document.getElementById('wab-key-already-used').style.display = 'none';
        document.getElementById('wab-key-uid-mismatch').style.display = 'none';
        document.getElementById('wab-key-connection-error').style.display = 'none';
        document.getElementById('wab-key-activate-btn').style.display = '';
        const inputRow = document.getElementById('wab-key-input');
        if (inputRow && inputRow.parentElement) inputRow.parentElement.style.display = '';
      });
      keyInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') activateKeyFromGate();
      });
    }

    // Activate button
    const activateBtn = document.getElementById('wab-key-activate-btn');
    if (activateBtn) {
      activateBtn.addEventListener('click', activateKeyFromGate);
    }

    // Telegram contact buttons
    const setupTelegram = (btnId, msg) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        const deviceId = getDeviceId();
        btn.href = 'https://t.me/riyaz_ali_saifi?text=' + encodeURIComponent(msg + ' Device: ' + deviceId);
      }
    };
    setupTelegram('wab-key-telegram-btn', 'KEY ALREADY USED - Need support. Device ID: ');
    setupTelegram('wab-key-telegram-btn2', 'UID MISMATCH - Need support. Device ID: ');
    setupTelegram('wab-key-expired-telegram', 'KEY EXPIRED - Need new key. Device ID: ');

    // Back / Try Another Key
    const backBtn = document.getElementById('wab-key-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', resetKeyGateToInput);
    }
    const anotherBtn = document.getElementById('wab-key-another-btn');
    if (anotherBtn) {
      anotherBtn.addEventListener('click', resetKeyGateToInput);
    }

    // Retry button
    const retryBtn = document.getElementById('wab-key-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', activateKeyFromGate);
    }

    // Expired overlay - enter new key
    const expiredNewBtn = document.getElementById('wab-key-expired-new-btn');
    if (expiredNewBtn) {
      expiredNewBtn.addEventListener('click', () => {
        clearKeyData();
        document.getElementById('wab-key-expired-gate').style.display = 'none';
        showKeyGate();
      });
    }

    // Make key gate draggable
    makeOverlayDraggable(document.getElementById('wab-key-gate'));
    makeOverlayDraggable(document.getElementById('wab-key-expired-gate'));
    makeOverlayDraggable(document.getElementById('wab-key-loading-gate'));

    // Minimize buttons on key gates
    document.querySelectorAll('#wab-key-gate .wab-overlay-min-btn, #wab-key-expired-gate .wab-overlay-min-btn, #wab-key-loading-gate .wab-overlay-min-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMinimized(true);
      });
    });
  }

  function checkPassword() {
    const val = (document.getElementById('wab-pw-input')?.value || '').trim();
    if (val === '5299') {
      state.strategiesUnlocked = true;
      state.pwInputVisible = false;
      document.getElementById('wab-strategies-body').style.display = '';
      document.getElementById('wab-pw-row').style.display = 'none';
      document.getElementById('wab-pw-error').style.display = 'none';
      document.getElementById('wab-lock-btn').textContent = '🔓 Lock';
      renderUI();
    } else {
      document.getElementById('wab-pw-error').style.display = 'block';
      document.getElementById('wab-pw-input').value = '';
    }
  }

  function syncInputs() {
    state.baseBet     = Math.max(1,  parseFloat(document.getElementById('wab-bet-input')?.value) || 1);
    state.martingaleMul = Math.max(1, parseFloat(document.getElementById('wab-mul-input')?.value) || 2);
    state.maxLevels   = Math.max(1,  parseInt(document.getElementById('wab-lvl-input')?.value)   || 5);
    
    const slVal = parseFloat(document.getElementById('wab-sl-input')?.value);
    state.stopLoss = (isNaN(slVal) || slVal <= 0) ? 999999 : slVal;
    
    const tgVal = parseFloat(document.getElementById('wab-tg-input')?.value);
    state.target = (isNaN(tgVal) || tgVal <= 0) ? 999999 : tgVal;
    
    const mbVal = parseInt(document.getElementById('wab-mb-input')?.value);
    state.maxBets = (isNaN(mbVal) || mbVal <= 0) ? 999999 : mbVal;
    
    // Clamp current level to new max
    if (state.currentLevel > state.maxLevels) state.currentLevel = 1;
    saveAppState();
  }

  function hydrateInputs() {
    const betInp = document.getElementById('wab-bet-input');
    const mulInp = document.getElementById('wab-mul-input');
    const lvlInp = document.getElementById('wab-lvl-input');
    const slInp  = document.getElementById('wab-sl-input');
    const tgInp  = document.getElementById('wab-tg-input');
    const mbInp  = document.getElementById('wab-mb-input');

    if (betInp) betInp.value = state.baseBet;
    if (mulInp) mulInp.value = state.martingaleMul;
    if (lvlInp) lvlInp.value = state.maxLevels;
    if (slInp)  slInp.value  = (state.stopLoss >= 999999) ? '' : state.stopLoss;
    if (tgInp)  tgInp.value  = (state.target >= 999999) ? '' : state.target;
    if (mbInp)  mbInp.value  = (state.maxBets >= 999999) ? '' : state.maxBets;
  }

  function toggleAutobet() {
    syncInputs();
    if (state.running) {
      stopAutobet();
      addLog('Auto-bet STOPPED', 'log-stop');
    } else {
      state.running = true;
      state.startBalance = readBalance();
      state.sessionProfit = 0;
      state.betsPlaced = 0;
      state.betFired = false;
      state.currentLevel = 1;
      state.pendingResult = false;
      state.monitorLevel = 1;
      state.monitorPendingResult = false;
      const btn = document.getElementById('wab-start-btn');
      const dot = document.getElementById('wab-dot');
      if (btn) { btn.className = 'wab-main-btn stop'; btn.textContent = '■ Stop Auto Bet'; }
      if (dot) dot.classList.add('active');
      addLog(`STARTED | Sequence strategy (bet every period) | Base ₹${state.baseBet} ×${state.martingaleMul} L${state.maxLevels} | Bal ₹${state.startBalance.toFixed(2)}`, 'log-win');
    }
    renderUI();
  }

  // ─── MUTATION OBSERVER ───────────────────────────────────────────────────────
  let mutTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutTimer);
    mutTimer = setTimeout(() => {
      const r = readHistory();
      if (r.length > 0) { state.lastResults = r; renderUI(); }
      updateBalanceNow(); // also refresh balance on any DOM mutation
    }, 300);
  });

  // ─── INIT ────────────────────────────────────────────────────────────────────
  function init() {
    loadAppState();
    createPanel();
    hydrateInputs();
    updateSettingsPreview();
    renderUI();
    setMinimized(true); // start as ball — tap to expand
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(mainLoop, 1000);
    // Dedicated balance poller — runs every 500ms independently of main loop
    setInterval(updateBalanceNow, 500);
    addLog('Auto TradeX Pro ready', 'log-skip');
    addLog('📋 STRATEGY CHANGED: bet EVERY period → 1·Small 2·Small 3·Big 4·Small 5·Big 6·Big 7·Small 8·Big, then loop. Watch each period and press the shown button; win/loss no longer skips.', 'log-skip');
  }

  // Watchdog: some sites are SPAs and wipe our panel from the DOM on route
  // changes. Re-inject if the panel disappears.
  setInterval(() => {
    if (!document.getElementById('wingo-ab-panel')) {
      try { init(); } catch (e) { /* noop */ }
    }
  }, 1500);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TOGGLE_PANEL') {
      const p = document.getElementById('wingo-ab-panel');
      p ? p.classList.toggle('hidden') : init();
      sendResponse({ ok: true });
    }
    if (msg.type === 'GET_STATUS') sendResponse({ running: state.running, ok: true });
    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }
})();

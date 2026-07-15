// When the extension icon is tapped, open the launcher as a full-screen tab.
// If a launcher tab is already open, switch to it instead of opening a duplicate.
const LAUNCHER = chrome.runtime.getURL('launcher.html');

chrome.action.onClicked.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find(t => t.url && t.url.startsWith(LAUNCHER));
    if (existing) {
      chrome.tabs.update(existing.id, { active: true });
      chrome.windows.update(existing.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: LAUNCHER });
    }
  });
});

let lastApiResults = [];

async function fetchWingoResults() {
  try {
    // The API uses GET instead of POST for this endpoint
    const response = await fetch('https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?t=' + Date.now(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data.data && data.data.list) {
      lastApiResults = data.data.list.map(item => ({
        period: item.issueNumber,
        number: parseInt(item.number),
        result: parseInt(item.number) >= 5 ? 'B' : 'S',
        color: item.color
      }));
    }
  } catch (error) {
    // More descriptive error for the user to see in extension console
    console.error('Wingo Bot API Error:', error.message);
  }
}

// Fetch results every 5 seconds
setInterval(fetchWingoResults, 5000);
fetchWingoResults();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_GAME') {
    chrome.tabs.create({ url: msg.url });
  }
  if (msg.type === 'GET_STORAGE') {
    chrome.storage.local.get(msg.keys, (result) => sendResponse(result));
    return true;
  }
  if (msg.type === 'SET_STORAGE') {
    chrome.storage.local.set(msg.data, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'GET_API_RESULTS') {
    sendResponse({ results: lastApiResults });
    return true;
  }
});

// ── Anti-block: re-inject content.js if a site prevented it from loading ──
// Some hostile sites stall or block script injection during initial load.
// After the page commits, wait ~2s and check whether our panel/ball exists;
// if not, force-inject content.js and content.css via chrome.scripting.
if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    if (!details.url || details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) return;
    setTimeout(() => {
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        func: () => !!(document.getElementById('wingo-ab-panel') || document.getElementById('wab-ball') || window.__wingoAutobet)
      }, (results) => {
        if (chrome.runtime.lastError) return;
        const present = results && results[0] && results[0].result;
        if (present) return;
        chrome.scripting.insertCSS({
          target: { tabId: details.tabId },
          files: ['content.css']
        }, () => { void chrome.runtime.lastError; });
        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          files: ['content.js']
        }, () => { void chrome.runtime.lastError; });
      });
    }, 2000);
  });
}


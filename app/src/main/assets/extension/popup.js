document.querySelectorAll('.game-link').forEach(link => {
  link.addEventListener('click', () => {
    const url = link.dataset.url;
    chrome.tabs.create({ url });
  });
});

document.getElementById('togglePanel').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PANEL' }, (resp) => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['content.js']
          });
        }
      });
    }
  });
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (resp) => {
      const el = document.getElementById('panelStatus');
      if (chrome.runtime.lastError || !resp) {
        el.textContent = 'Not on game page';
        el.style.color = '#888';
      } else {
        el.textContent = resp.running ? 'Auto-bet ACTIVE' : 'Panel Ready';
        el.style.color = resp.running ? '#4ade80' : '#facc15';
      }
    });
  }
});

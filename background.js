// ── YouTube tab management ────────────────────────────────────────────────────
//
// We keep a single background YouTube tab. The side panel sends commands here;
// we forward them to the content script in that tab. State updates flow back
// the other way: content script → background → side panel.

let ytTabId = null; // the managed YouTube tab

// Open side panel on icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.error('[BG] Could not open side panel:', e);
  }
});

// ── Tab helpers ───────────────────────────────────────────────────────────────

async function getOrCreateYouTubeTab(url) {
  // If we have a tracked tab, check it's still alive
  if (ytTabId !== null) {
    try {
      const tab = await chrome.tabs.get(ytTabId);
      // Navigate it to the new URL
      await chrome.tabs.update(ytTabId, { url });
      return ytTabId;
    } catch (_) {
      // Tab was closed — create a new one
      ytTabId = null;
    }
  }

  // Create a new tab, not active (stays in background)
  const tab = await chrome.tabs.create({ url, active: false });
  ytTabId = tab.id;
  return ytTabId;
}

// Wait for content script to be ready in a tab
function waitForContentScript(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function ping() {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Content script timeout'));
          } else {
            setTimeout(ping, 300);
          }
        } else {
          resolve(response);
        }
      });
    }

    ping();
  });
}

// ── Message routing ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── From side panel → forward to content script ──
  if (message.target === 'contentScript') {
    if (ytTabId === null) {
      sendResponse({ success: false, error: 'No YouTube tab' });
      return false;
    }
    chrome.tabs.sendMessage(ytTabId, message, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response || { success: true });
      }
    });
    return true; // async
  }

  // ── From side panel: load a URL in the YouTube tab ──
  if (message.action === 'loadUrl') {
    (async () => {
      try {
        const tabId = await getOrCreateYouTubeTab(message.url);
        // Wait for page + content script to be ready
        await waitForContentScript(tabId);
        sendResponse({ success: true, tabId });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // async
  }

  // ── From content script → forward to side panel ──
  if (message.target === 'sidePanel') {
    // Broadcast to all extension pages — side panel will receive it
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
    return false;
  }

  // ── Side panel asking for current tab status ──
  if (message.action === 'getTabStatus') {
    sendResponse({ tabId: ytTabId });
    return false;
  }
});

// Clean up if the managed tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === ytTabId) {
    ytTabId = null;
    // Notify side panel the tab is gone
    chrome.runtime.sendMessage({
      target: 'sidePanel',
      type: 'tabClosed'
    }, () => { void chrome.runtime.lastError; });
  }
});

// If the YouTube tab navigates away from youtube.com, clear our reference
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === ytTabId && changeInfo.url && !changeInfo.url.includes('youtube.com')) {
    ytTabId = null;
  }
});

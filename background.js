// Track which tab the side panel was opened for
let activePanelTabId = null;

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    activePanelTabId = tab.id;
    await chrome.sidePanel.open({ tabId: tab.id });
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sidepanel.html',
      enabled: true
    });
  } catch (error) {
    console.error('Error opening side panel:', error);
  }
});

// Helper: forward a message to the tracked YouTube tab
function forwardToContentScript(message, sendResponse) {
  const tabId = activePanelTabId;
  if (!tabId) {
    sendResponse({ success: false, error: 'No YouTube tab tracked' });
    return;
  }
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url || !tab.url.includes('youtube.com')) {
      sendResponse({ success: false, error: 'No YouTube tab found' });
      return;
    }
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse(response || { success: true });
    });
  });
}

// Listen for messages from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'controlVideo') {
    const contentMessage = { action: message.command };
    // Pass through seek percentage if present
    if (message.percentage !== undefined) {
      contentMessage.percentage = message.percentage;
    }
    forwardToContentScript(contentMessage, sendResponse);
    return true; // Keep message channel open for async response
  }

  if (message.action === 'getVideoInfo') {
    forwardToContentScript({ action: 'getInfo' }, sendResponse);
    return true;
  }
});

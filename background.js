// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
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

// Listen for messages from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'controlVideo') {
    // Forward control messages to the content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url.includes('youtube.com')) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: message.command
        }, (response) => {
          sendResponse({ success: true, ...response });
        });
      } else {
        sendResponse({ success: false, error: 'No YouTube tab found' });
      }
    });
    return true; // Keep message channel open for async response
  }
  
  if (message.action === 'getVideoInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url.includes('youtube.com')) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'getInfo'
        }, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ success: false, error: 'No YouTube tab found' });
      }
    });
    return true;
  }
});
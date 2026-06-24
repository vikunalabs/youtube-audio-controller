// YouTube player interaction
let player = null;
let isPlaying = false;
let currentVideoData = {
  title: '',
  channel: '',
  duration: 0,
  currentTime: 0
};

// Find the YouTube player
function getPlayer() {
  try {
    // Try to find the video player
    const video = document.querySelector('video');
    if (video) return video;
    
    // Alternative: find the player iframe
    const iframe = document.querySelector('iframe[src*="youtube.com"]');
    if (iframe && iframe.contentDocument) {
      return iframe.contentDocument.querySelector('video');
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Get video metadata
function getVideoInfo() {
  try {
    // Get title
    const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    const title = titleElement ? titleElement.textContent.trim() : '';
    
    // Get channel name
    const channelElement = document.querySelector('ytd-channel-name a');
    const channel = channelElement ? channelElement.textContent.trim() : '';
    
    // Get player
    const video = getPlayer();
    if (video) {
      return {
        title: title || 'Untitled Video',
        channel: channel || 'Unknown Channel',
        duration: video.duration || 0,
        currentTime: video.currentTime || 0,
        isPlaying: !video.paused,
        success: true
      };
    }
  } catch (e) {
    console.error('Error getting video info:', e);
  }
  return { success: false, error: 'Could not fetch video info' };
}

// Control functions
function togglePlay() {
  const video = getPlayer();
  if (video) {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
    return { success: true };
  }
  return { success: false, error: 'No video player found' };
}

function nextVideo() {
  // Try to click the next button
  try {
    const nextButton = document.querySelector('ytd-watch-next-secondary-button');
    if (nextButton) {
      nextButton.click();
      return { success: true };
    }
  } catch (e) {}
  
  // Alternative: find by data attributes
  try {
    const buttons = document.querySelectorAll('ytd-button-renderer');
    for (const button of buttons) {
      if (button.querySelector('yt-icon[icon*="next"]') || 
          button.getAttribute('aria-label') === 'Next') {
        button.click();
        return { success: true };
      }
    }
  } catch (e) {}
  
  return { success: false, error: 'Could not find next button' };
}

function prevVideo() {
  // Try to click the previous button
  try {
    const prevButton = document.querySelector('ytd-watch-previous-secondary-button');
    if (prevButton) {
      prevButton.click();
      return { success: true };
    }
  } catch (e) {}
  
  // Alternative: find by data attributes
  try {
    const buttons = document.querySelectorAll('ytd-button-renderer');
    for (const button of buttons) {
      if (button.querySelector('yt-icon[icon*="previous"]') || 
          button.getAttribute('aria-label') === 'Previous') {
        button.click();
        return { success: true };
      }
    }
  } catch (e) {}
  
  return { success: false, error: 'Could not find previous button' };
}

function seekTo(percentage) {
  const video = getPlayer();
  if (video && video.duration) {
    video.currentTime = percentage * video.duration;
    return { success: true };
  }
  return { success: false, error: 'Could not seek' };
}

// Send updates to side panel
function sendUpdate() {
  const info = getVideoInfo();
  if (info.success) {
    chrome.runtime.sendMessage({
      action: 'videoUpdate',
      ...info
    });
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let result;
  
  switch (message.action) {
    case 'togglePlay':
      result = togglePlay();
      break;
    case 'prev':
      result = prevVideo();
      break;
    case 'next':
      result = nextVideo();
      break;
    case 'seek':
      result = seekTo(message.percentage);
      break;
    case 'getInfo':
      result = getVideoInfo();
      break;
    default:
      result = { success: false, error: 'Unknown action' };
  }
  
  sendResponse(result);
});

// Listen for video events
document.addEventListener('play', (e) => {
  if (e.target.tagName === 'VIDEO') {
    setTimeout(sendUpdate, 100);
  }
}, true);

document.addEventListener('pause', (e) => {
  if (e.target.tagName === 'VIDEO') {
    setTimeout(sendUpdate, 100);
  }
}, true);

document.addEventListener('timeupdate', (e) => {
  if (e.target.tagName === 'VIDEO') {
    // Debounce updates
    if (!e.target._lastUpdate || Date.now() - e.target._lastUpdate > 500) {
      e.target._lastUpdate = Date.now();
      sendUpdate();
    }
  }
}, true);

// Initial update after page loads
setTimeout(sendUpdate, 1000);
setInterval(sendUpdate, 3000); // Periodic updates

// Listen for navigation (SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(sendUpdate, 1000);
  }
}).observe(document, { subtree: true, childList: true });

console.log('YouTube Audio Controller: Content script loaded');
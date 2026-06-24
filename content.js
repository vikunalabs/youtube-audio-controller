// YouTube player interaction

// Find the YouTube player video element
function getPlayer() {
  return document.querySelector('video') || null;
}

// Get video metadata
function getVideoInfo() {
  try {
    const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    const title = titleElement ? titleElement.textContent.trim() : '';

    const channelElement = document.querySelector('ytd-channel-name a');
    const channel = channelElement ? channelElement.textContent.trim() : '';

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
  try {
    const nextButton = document.querySelector('.ytp-next-button');
    if (nextButton) {
      nextButton.click();
      return { success: true };
    }
  } catch (e) {}

  try {
    const buttons = document.querySelectorAll('ytd-button-renderer');
    for (const button of buttons) {
      if (button.getAttribute('aria-label') === 'Next') {
        button.click();
        return { success: true };
      }
    }
  } catch (e) {}

  return { success: false, error: 'Could not find next button' };
}

function prevVideo() {
  try {
    const prevButton = document.querySelector('.ytp-prev-button');
    if (prevButton) {
      prevButton.click();
      return { success: true };
    }
  } catch (e) {}

  try {
    const buttons = document.querySelectorAll('ytd-button-renderer');
    for (const button of buttons) {
      if (button.getAttribute('aria-label') === 'Previous') {
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

function setVolume(level) {
  const video = getPlayer();
  if (video) {
    video.volume = Math.max(0, Math.min(1, level));
    return { success: true, volume: video.volume };
  }
  return { success: false, error: 'No video player found' };
}

function getVolume() {
  const video = getPlayer();
  if (video) {
    return { success: true, volume: video.volume, muted: video.muted };
  }
  return { success: false, error: 'No video player found' };
}

// Send updates to side panel; suppress error when panel is not open
function sendUpdate() {
  const info = getVideoInfo();
  if (info.success) {
    chrome.runtime.sendMessage({ action: 'videoUpdate', ...info }, () => {
      // Suppress "receiving end does not exist" when side panel is closed
      void chrome.runtime.lastError;
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
    case 'setVolume':
      result = setVolume(message.level);
      break;
    case 'getInfo':
      result = getVideoInfo();
      // Include volume in getInfo response
      const volInfo = getVolume();
      if (volInfo.success) {
        result.volume = volInfo.volume;
        result.muted = volInfo.muted;
      }
      break;
    default:
      result = { success: false, error: 'Unknown action' };
  }

  sendResponse(result);
});

// Push updates to side panel on player events
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

document.addEventListener('volumechange', (e) => {
  if (e.target.tagName === 'VIDEO') {
    setTimeout(sendUpdate, 100);
  }
}, true);

document.addEventListener('timeupdate', (e) => {
  if (e.target.tagName === 'VIDEO') {
    if (!e.target._lastUpdate || Date.now() - e.target._lastUpdate > 500) {
      e.target._lastUpdate = Date.now();
      sendUpdate();
    }
  }
}, true);

// Initial update after page loads
setTimeout(sendUpdate, 1000);

// Fallback periodic update (low frequency — push events handle the rest)
setInterval(sendUpdate, 5000);

// Detect YouTube SPA navigation by observing the title element only
const titleObserver = new MutationObserver(() => {
  setTimeout(sendUpdate, 1000);
});

const titleEl = document.querySelector('title');
if (titleEl) {
  titleObserver.observe(titleEl, { childList: true });
} else {
  // Fallback: observe head until title is available
  const headObserver = new MutationObserver(() => {
    const t = document.querySelector('title');
    if (t) {
      headObserver.disconnect();
      titleObserver.observe(t, { childList: true });
    }
  });
  headObserver.observe(document.head || document.documentElement, { childList: true });
}

console.log('YouTube Audio Controller: Content script loaded');

// ── YouTube Audio Controller — Content Script ────────────────────────────────
//
// Runs inside the YouTube tab. Controls the video element directly.
// Pushes state updates to the side panel via background service worker.

(function () {
  // Guard against double-injection on SPA navigations
  if (window.__ytAudioControllerLoaded) return;
  window.__ytAudioControllerLoaded = true;

  const LOG = '[YT-Content]';

  // ── Video element access ──────────────────────────────────────────────────

  function getVideo() {
    return document.querySelector('video');
  }

  // ── State push ────────────────────────────────────────────────────────────

  let pushTimer = null;

  function pushState() {
    const video = getVideo();
    if (!video) return;

    const urlParams  = new URLSearchParams(window.location.search);
    const videoId    = urlParams.get('v') || '';
    const titleEl    = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                       document.querySelector('#title h1');
    const channelEl  = document.querySelector('ytd-channel-name a') ||
                       document.querySelector('#channel-name a');

    chrome.runtime.sendMessage({
      target:      'sidePanel',
      type:        'stateUpdate',
      videoId,
      title:       titleEl  ? titleEl.textContent.trim()  : document.title.replace(' - YouTube', ''),
      channel:     channelEl ? channelEl.textContent.trim() : '',
      paused:      video.paused,
      currentTime: video.currentTime,
      duration:    video.duration || 0,
      volume:      video.volume,
      muted:       video.muted,
      ended:       video.ended,
    }, () => { void chrome.runtime.lastError; });
  }

  // Debounced push — coalesces rapid events
  function schedulePush(delay = 150) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushState, delay);
  }

  // ── Video event listeners ─────────────────────────────────────────────────

  function attachVideoListeners(video) {
    if (video.__ytAudioBound) return;
    video.__ytAudioBound = true;

    video.addEventListener('play',         () => schedulePush());
    video.addEventListener('pause',        () => schedulePush());
    video.addEventListener('ended',        () => schedulePush());
    video.addEventListener('volumechange', () => schedulePush());
    video.addEventListener('seeking',      () => schedulePush());
    video.addEventListener('seeked',       () => schedulePush());
    video.addEventListener('durationchange', () => schedulePush());
    video.addEventListener('loadedmetadata', () => {
      schedulePush(500); // give metadata a moment to settle
    });

    // Push progress every second while playing
    video.addEventListener('timeupdate', () => {
      if (!video.paused && !video.__progressInterval) {
        video.__progressInterval = setInterval(() => {
          if (video.paused || video.ended) {
            clearInterval(video.__progressInterval);
            video.__progressInterval = null;
          } else {
            pushState();
          }
        }, 1000);
      }
    });
  }

  // Watch for video element appearing (YouTube is SPA — video may load late)
  function watchForVideo() {
    const video = getVideo();
    if (video) {
      attachVideoListeners(video);
      schedulePush(500);
      return;
    }
    // Poll until video appears
    const poll = setInterval(() => {
      const v = getVideo();
      if (v) {
        clearInterval(poll);
        attachVideoListeners(v);
        schedulePush(500);
      }
    }, 500);
  }

  watchForVideo();

  // Re-attach on YouTube SPA navigation
  document.addEventListener('yt-navigate-finish', () => {
    window.__ytAudioControllerLoaded = false; // allow re-init on navigation
    setTimeout(() => {
      window.__ytAudioControllerLoaded = true;
      watchForVideo();
      schedulePush(1000);
    }, 500);
  });

  // ── Command handler ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Respond to ping (used by background to check if script is ready)
    if (message.action === 'ping') {
      sendResponse({ ready: true });
      return false;
    }

    if (message.target !== 'contentScript') return false;

    const video = getVideo();

    switch (message.action) {
      case 'play':
        if (video) video.play().catch(() => {});
        sendResponse({ success: true });
        break;

      case 'pause':
        if (video) video.pause();
        sendResponse({ success: true });
        break;

      case 'seekTo':
        if (video && message.seconds !== undefined) {
          video.currentTime = message.seconds;
        }
        sendResponse({ success: true });
        break;

      case 'setVolume':
        if (video && message.volume !== undefined) {
          video.volume = Math.max(0, Math.min(1, message.volume / 100));
        }
        sendResponse({ success: true });
        break;

      case 'mute':
        if (video) video.muted = true;
        sendResponse({ success: true });
        break;

      case 'unMute':
        if (video) { video.muted = false; }
        sendResponse({ success: true });
        break;

      case 'getState':
        if (!video) {
          sendResponse({ success: false, error: 'No video element' });
        } else {
          sendResponse({
            success: true,
            paused: video.paused,
            currentTime: video.currentTime,
            duration: video.duration || 0,
            volume: video.volume,
            muted: video.muted,
            ended: video.ended,
          });
        }
        break;

      default:
        sendResponse({ success: false, error: `Unknown action: ${message.action}` });
    }

    return false;
  });

  console.log(LOG, 'Content script loaded on', window.location.href);
})();

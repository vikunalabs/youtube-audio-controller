// State
let isPlaying = false;
let currentVideoInfo = null;
let currentVolume = 1.0;
let isMuted = false;

// DOM Elements
const playPauseButton = document.getElementById('playPauseButton');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const prevButton = document.getElementById('prevButton');
const nextButton = document.getElementById('nextButton');
const videoTitle = document.getElementById('videoTitle');
const channelName = document.getElementById('channelName');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progressContainer');
const currentTimeSpan = document.getElementById('currentTime');
const totalTimeSpan = document.getElementById('totalTime');
const volumeIndicator = document.getElementById('volumeIndicator');
const volumeSlider = document.getElementById('volumeSlider');

// Helper: send a control message to background, with optional extra fields
function sendControl(command, extras = {}) {
  chrome.runtime.sendMessage(
    { action: 'controlVideo', command, ...extras },
    (response) => {
      if (chrome.runtime.lastError) {
        updateStatus('Error: ' + chrome.runtime.lastError.message, true);
        return;
      }
      if (response && response.success === false) {
        updateStatus('Error: ' + response.error, true);
      }
    }
  );
}

// Update track info display
function updateTrackInfo(info) {
  if (info && info.title) {
    videoTitle.textContent = info.title;
    channelName.textContent = info.channel || '';
    currentVideoInfo = info;
    updateStatus(info.isPlaying ? 'Playing' : 'Paused', false);
  } else {
    videoTitle.textContent = 'No video playing';
    channelName.textContent = '';
    currentVideoInfo = null;
    updateStatus('Not connected', false);
  }
}

// Update play/pause button icon
function updatePlayState(playing) {
  isPlaying = playing;
  playIcon.style.display = playing ? 'none' : 'block';
  pauseIcon.style.display = playing ? 'block' : 'none';
}

// Update progress bar and time display
function updateProgress(info) {
  if (info && info.currentTime !== undefined && info.duration) {
    const progress = (info.currentTime / info.duration) * 100;
    progressBar.style.width = Math.min(progress, 100) + '%';
    currentTimeSpan.textContent = formatTime(info.currentTime);
    totalTimeSpan.textContent = formatTime(info.duration);
  }
}

// Update volume UI
function updateVolumeUI(volume, muted) {
  currentVolume = volume !== undefined ? volume : currentVolume;
  isMuted = muted !== undefined ? muted : isMuted;

  if (volumeSlider) {
    volumeSlider.value = isMuted ? 0 : Math.round(currentVolume * 100);
  }
  if (volumeIndicator) {
    if (isMuted || currentVolume === 0) {
      volumeIndicator.textContent = '🔇';
    } else if (currentVolume < 0.5) {
      volumeIndicator.textContent = '🔉';
    } else {
      volumeIndicator.textContent = '🔊';
    }
  }
}

// Format seconds as M:SS
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update status text
function updateStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? '#ff6b6b' : 'rgba(255, 255, 255, 0.7)';
}

// Fetch current video info from content script (via background)
function fetchVideoInfo() {
  chrome.runtime.sendMessage({ action: 'getVideoInfo' }, (response) => {
    if (chrome.runtime.lastError) {
      // Background not ready yet — suppress silently
      return;
    }
    if (response && response.success) {
      updateTrackInfo(response);
      updatePlayState(response.isPlaying || false);
      updateProgress(response);
      updateVolumeUI(response.volume, response.muted);
    } else if (response && response.error) {
      updateStatus('Not connected', false);
    }
  });
}

// Single polling interval as a fallback; push events from content script
// handle real-time updates so this can be infrequent
function startPolling() {
  fetchVideoInfo(); // Initial fetch
  setInterval(fetchVideoInfo, 3000);
}

// --- Event Listeners ---

playPauseButton.addEventListener('click', () => {
  sendControl('togglePlay');
  updatePlayState(!isPlaying); // Optimistic UI
});

prevButton.addEventListener('click', () => {
  sendControl('prev');
});

nextButton.addEventListener('click', () => {
  sendControl('next');
});

// Progress bar: click to seek
progressContainer.addEventListener('click', (e) => {
  const rect = progressContainer.getBoundingClientRect();
  const percentage = (e.clientX - rect.left) / rect.width;
  sendControl('seek', { percentage: Math.max(0, Math.min(1, percentage)) });
});

// Volume indicator: click to toggle mute
volumeIndicator.addEventListener('click', () => {
  isMuted = !isMuted;
  sendControl('setVolume', { level: isMuted ? 0 : currentVolume });
  updateVolumeUI(currentVolume, isMuted);
});

// Volume slider: drag to set volume
if (volumeSlider) {
  volumeSlider.addEventListener('input', () => {
    const level = volumeSlider.value / 100;
    currentVolume = level;
    isMuted = level === 0;
    sendControl('setVolume', { level });
    updateVolumeUI(level, isMuted);
  });
}

// Listen for push updates from content script (via background)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'videoUpdate') {
    updateTrackInfo(message);
    updatePlayState(message.isPlaying);
    updateProgress(message);
    updateVolumeUI(message.volume, message.muted);
  }
  sendResponse({ success: true });
});

// Init
startPolling();

// State
let isPlaying = false;
let currentVideoInfo = null;
let progressInterval = null;

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
const currentTimeSpan = document.getElementById('currentTime');
const totalTimeSpan = document.getElementById('totalTime');

// Helper function to send control messages
function sendControl(command) {
  chrome.runtime.sendMessage({
    action: 'controlVideo',
    command: command
  }, (response) => {
    if (response && response.success === false) {
      console.error('Error:', response.error);
      updateStatus('Error: ' + response.error, true);
    }
  });
}

// Update track info
function updateTrackInfo(info) {
  if (info && info.title) {
    videoTitle.textContent = info.title;
    channelName.textContent = info.channel || '';
    currentVideoInfo = info;
    updateStatus('Playing', false);
  } else {
    videoTitle.textContent = 'No video playing';
    channelName.textContent = '';
    currentVideoInfo = null;
    updateStatus('Not connected', false);
  }
}

// Update play/pause state
function updatePlayState(playing) {
  isPlaying = playing;
  if (playing) {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
  } else {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  }
}

// Update progress
function updateProgress(info) {
  if (info && info.currentTime !== undefined && info.duration !== undefined) {
    const progress = (info.currentTime / info.duration) * 100;
    progressBar.style.width = Math.min(progress, 100) + '%';
    currentTimeSpan.textContent = formatTime(info.currentTime);
    totalTimeSpan.textContent = formatTime(info.duration);
  }
}

// Format time (seconds to MM:SS)
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

// Fetch current video info
function fetchVideoInfo() {
  chrome.runtime.sendMessage({
    action: 'getVideoInfo'
  }, (response) => {
    if (response && response.success) {
      updateTrackInfo(response);
      updatePlayState(response.isPlaying || false);
      updateProgress(response);
    } else if (response && response.error) {
      updateStatus('Error: ' + response.error, true);
    }
  });
}

// Poll for updates
function startPolling() {
  fetchVideoInfo(); // Initial fetch
  
  // Poll every 2 seconds for updates
  setInterval(() => {
    fetchVideoInfo();
  }, 2000);
  
  // Update progress more frequently
  setInterval(() => {
    if (currentVideoInfo && isPlaying) {
      // This will be handled by the content script updates
      fetchVideoInfo();
    }
  }, 500);
}

// Event Listeners
playPauseButton.addEventListener('click', () => {
  sendControl('togglePlay');
  // Optimistic UI update
  updatePlayState(!isPlaying);
});

prevButton.addEventListener('click', () => {
  sendControl('prev');
});

nextButton.addEventListener('click', () => {
  sendControl('next');
});

// Click on progress bar to seek
document.getElementById('progressContainer').addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const percentage = x / rect.width;
  sendControl('seek', percentage);
});

// Initialize
startPolling();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'videoUpdate') {
    updateTrackInfo(message);
    updatePlayState(message.isPlaying);
    updateProgress(message);
  }
  sendResponse({ success: true });
});
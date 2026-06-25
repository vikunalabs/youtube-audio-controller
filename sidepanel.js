// ── Helpers ───────────────────────────────────────────────────────────────────

function sendToContent(action, extras) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { target: 'contentScript', action, ...extras },
      (response) => {
        void chrome.runtime.lastError;
        resolve(response);
      }
    );
  });
}

function sendToBg(action, extras) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action, ...extras },
      (response) => {
        void chrome.runtime.lastError;
        resolve(response);
      }
    );
  });
}

// ── State ─────────────────────────────────────────────────────────────────────

let isPlaying         = false;
let isMuted           = false;
let currentVolume     = 80;
let currentQueueIndex = -1;
let shuffleOn         = false;
let repeatOn          = false;
let shuffleOrder      = [];
let cachedDuration    = 0;
let cachedCurrentTime = 0;
let queue             = [];
let isLoading         = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const urlInput      = document.getElementById('urlInput');
const loadBtn       = document.getElementById('loadBtn');
const urlError      = document.getElementById('urlError');
const statusDot     = document.getElementById('statusDot');
const statusLabel   = document.getElementById('statusLabel');
const albumArt      = document.getElementById('albumArt');
const artOverlay    = document.getElementById('artOverlay');
const trackTitle    = document.getElementById('trackTitle');
const trackChannel  = document.getElementById('trackChannel');
const progressFill  = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const progressTrack = document.getElementById('progressTrack');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl   = document.getElementById('totalTime');
const playPauseBtn  = document.getElementById('playPauseBtn');
const playIcon      = document.getElementById('playIcon');
const pauseIcon     = document.getElementById('pauseIcon');
const prevBtn       = document.getElementById('prevBtn');
const nextBtn       = document.getElementById('nextBtn');
const shuffleBtn    = document.getElementById('shuffleBtn');
const repeatBtn     = document.getElementById('repeatBtn');
const muteBtn       = document.getElementById('muteBtn');
const volIcon       = document.getElementById('volIcon');
const volumeSlider  = document.getElementById('volumeSlider');
const volumeLabel   = document.getElementById('volumeLabel');
const queueList     = document.getElementById('queueList');
const clearQueueBtn = document.getElementById('clearQueueBtn');

albumArt.addEventListener('error', () => { albumArt.src = 'icons/placeholder.png'; });

// ── Incoming state updates from content script ────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'stateUpdate') {
    applyStateUpdate(message);
  }
  if (message.type === 'tabClosed') {
    setStatus('stopped', 'Stopped');
    setPlayingUI(false);
  }
});

function applyStateUpdate(state) {
  // Update play/pause UI
  setPlayingUI(!state.paused);

  // Update progress
  if (state.duration > 0) {
    cachedDuration    = state.duration;
    cachedCurrentTime = state.currentTime;
    const pct = (state.currentTime / state.duration) * 100;
    progressFill.style.width  = Math.min(pct, 100) + '%';
    progressThumb.style.left  = Math.min(pct, 100) + '%';
    currentTimeEl.textContent = formatTime(state.currentTime);
    totalTimeEl.textContent   = formatTime(state.duration);
  }

  // Update title/channel if they've arrived (YouTube loads them async)
  if (state.title && state.title !== document.title) {
    const item = queue[currentQueueIndex];
    if (item) {
      if (state.title && state.title !== item.title && !state.title.includes('YouTube')) {
        item.title = state.title;
        trackTitle.textContent = state.title;
        renderQueue();
      }
      if (state.channel && state.channel !== item.channel) {
        item.channel = state.channel;
        trackChannel.textContent = state.channel;
      }
    }
  }

  // Update album art if we have a videoId
  if (state.videoId && albumArt.dataset.videoId !== state.videoId) {
    albumArt.dataset.videoId = state.videoId;
    albumArt.src = `https://img.youtube.com/vi/${state.videoId}/mqdefault.jpg`;
  }

  // Sync volume
  if (!isMuted && state.volume !== undefined) {
    const vol = Math.round(state.volume * 100);
    if (Math.abs(vol - currentVolume) > 2) {
      currentVolume = vol;
      volumeSlider.value = vol;
      volumeLabel.textContent = vol;
      updateVolIcon();
    }
  }

  // Handle track end
  if (state.ended) {
    handleTrackEnd();
  }
}

// ── URL parsing ───────────────────────────────────────────────────────────────

function extractVideoId(input) {
  if (!input) return null;
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input.startsWith('http') ? input : 'https://' + input);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split(/[?&]/)[0];
      if (id.length === 11) return id;
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && v.length === 11) return v;
      const m = url.pathname.match(/\/(shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch (_) {}
  return null;
}

// ── Load flow ─────────────────────────────────────────────────────────────────

async function loadFromInput() {
  const raw = urlInput.value.trim();
  if (!raw || isLoading) return;
  clearError();

  const videoId = extractVideoId(raw);
  if (!videoId) { showError('Could not find a video ID in that URL.'); return; }

  urlInput.value = '';
  await addToQueueAndPlay(videoId);
}

async function fetchMeta(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!res.ok) return {};
    const data = await res.json();
    return { title: data.title, channel: data.author_name };
  } catch (_) { return {}; }
}

async function addToQueueAndPlay(videoId) {
  // If already in queue, just jump to it
  const existing = queue.findIndex(q => q.videoId === videoId);
  if (existing !== -1) { playQueueItem(existing); return; }

  setStatus('loading', 'Loading…');
  isLoading = true;
  loadBtn.disabled = true;

  try {
    const meta = await fetchMeta(videoId);
    const item = {
      videoId,
      title:   meta.title   || 'Unknown Title',
      channel: meta.channel || 'Unknown Channel',
      thumb:   `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    };
    queue.push(item);
    currentQueueIndex = queue.length - 1;
    rebuildShuffleOrder();
    renderQueue();
    persistState();
    await playQueueItem(currentQueueIndex);
  } finally {
    isLoading = false;
    loadBtn.disabled = false;
  }
}

async function playQueueItem(index) {
  if (index < 0 || index >= queue.length) return;
  currentQueueIndex = index;
  const item = queue[index];

  // Update UI immediately
  trackTitle.textContent   = item.title;
  trackChannel.textContent = item.channel;
  albumArt.src             = item.thumb;
  albumArt.dataset.videoId = item.videoId;
  cachedDuration           = 0;
  cachedCurrentTime        = 0;
  progressFill.style.width = '0%';
  progressThumb.style.left = '0%';
  currentTimeEl.textContent = '0:00';
  totalTimeEl.textContent   = '0:00';
  clearError();
  renderQueue();
  persistState();

  setStatus('loading', 'Opening tab…');

  // Ask background to open/navigate the YouTube tab
  const ytUrl = `https://www.youtube.com/watch?v=${item.videoId}`;
  const result = await sendToBg('loadUrl', { url: ytUrl });

  if (!result || !result.success) {
    showError('Could not open YouTube tab: ' + (result?.error || 'unknown error'));
    setStatus('stopped', 'Error');
    return;
  }

  setStatus('loading', 'Waiting for video…');

  // Give the page a moment to load the video element, then play
  setTimeout(async () => {
    await sendToContent('setVolume', { volume: currentVolume });
    await sendToContent('play');
    setStatus('playing', 'Playing');
  }, 2000);
}

// ── Playback controls ─────────────────────────────────────────────────────────

async function togglePlayPause() {
  if (queue.length === 0) return;
  if (isPlaying) {
    await sendToContent('pause');
  } else {
    await sendToContent('play');
  }
}

async function playPrev() {
  if (queue.length === 0) return;
  if (cachedCurrentTime > 3) {
    await sendToContent('seekTo', { seconds: 0 });
    return;
  }
  const prev = getAdjacentIndex(-1);
  if (prev !== null) await playQueueItem(prev);
}

async function playNext() {
  if (queue.length === 0) return;
  const next = getAdjacentIndex(1);
  if (next !== null) await playQueueItem(next);
}

async function handleTrackEnd() {
  if (repeatOn) {
    await sendToContent('seekTo', { seconds: 0 });
    await sendToContent('play');
    return;
  }
  const next = getAdjacentIndex(1);
  if (next !== null) {
    await playQueueItem(next);
  } else {
    setPlayingUI(false);
    setStatus('stopped', 'Stopped');
  }
}

function getAdjacentIndex(direction) {
  if (queue.length <= 1) return null;
  if (shuffleOn) {
    const pos    = shuffleOrder.indexOf(currentQueueIndex);
    const newPos = pos + direction;
    if (newPos < 0 || newPos >= shuffleOrder.length) return null;
    return shuffleOrder[newPos];
  }
  const next = currentQueueIndex + direction;
  if (next < 0 || next >= queue.length) return null;
  return next;
}

function rebuildShuffleOrder() {
  shuffleOrder = queue.map((_, i) => i);
  for (let i = shuffleOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
  }
}

// ── Volume ────────────────────────────────────────────────────────────────────

function setVolume(val) {
  currentVolume           = Math.max(0, Math.min(100, val));
  volumeSlider.value      = currentVolume;
  volumeLabel.textContent = currentVolume;
  sendToContent('setVolume', { volume: currentVolume });
  updateVolIcon();
  persistState();
}

function toggleMute() {
  isMuted = !isMuted;
  sendToContent(isMuted ? 'mute' : 'unMute');
  if (!isMuted) sendToContent('setVolume', { volume: currentVolume });
  updateVolIcon();
}

function updateVolIcon() {
  const v = isMuted ? 0 : currentVolume;
  let path;
  if (v === 0)     path = 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';
  else if (v < 50) path = 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z';
  else             path = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';
  volIcon.innerHTML = `<path d="${path}" fill="currentColor"/>`;
}

// ── Progress ──────────────────────────────────────────────────────────────────

function seekFromClick(e) {
  if (cachedDuration <= 0) return;
  const rect = progressTrack.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  sendToContent('seekTo', { seconds: pct * cachedDuration });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setPlayingUI(playing) {
  isPlaying = playing;
  playIcon.style.display  = playing ? 'none'  : 'block';
  pauseIcon.style.display = playing ? 'block' : 'none';
  if (playing) {
    artOverlay.classList.add('spinning');
    setStatus('playing', 'Playing');
  } else {
    artOverlay.classList.remove('spinning');
    if (cachedCurrentTime > 0) setStatus('paused', 'Paused');
  }
}

function setStatus(type, label) {
  statusDot.className     = 'status-dot ' + type;
  statusLabel.textContent = label;
}

function showError(msg) {
  urlError.textContent   = msg;
  urlError.style.display = 'block';
}

function clearError() {
  urlError.textContent   = '';
  urlError.style.display = 'none';
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// ── Queue UI ──────────────────────────────────────────────────────────────────

function renderQueue() {
  if (queue.length === 0) {
    queueList.innerHTML = '<div class="queue-empty">Queue is empty</div>';
    return;
  }
  queueList.innerHTML = queue.map((item, i) => `
    <div class="queue-item ${i === currentQueueIndex ? 'active' : ''}" data-index="${i}">
      <span class="queue-item-num">${i === currentQueueIndex ? '▶' : i + 1}</span>
      <img class="queue-item-thumb" src="${item.thumb}" alt="" loading="lazy"/>
      <div class="queue-item-info">
        <div class="queue-item-title">${escapeHtml(item.title)}</div>
        <div class="queue-item-channel">${escapeHtml(item.channel)}</div>
      </div>
      <button class="queue-item-remove" data-remove="${i}" title="Remove">×</button>
    </div>
  `).join('');

  queueList.querySelectorAll('.queue-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.queue-item-remove')) return;
      playQueueItem(Number(el.dataset.index));
    });
  });
  queueList.querySelectorAll('.queue-item-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(Number(btn.dataset.remove));
    });
  });
}

function removeFromQueue(index) {
  const wasActive = index === currentQueueIndex;
  queue.splice(index, 1);
  if (wasActive) {
    if (queue.length === 0) {
      currentQueueIndex        = -1;
      trackTitle.textContent   = 'No track loaded';
      trackChannel.textContent = '—';
      albumArt.src             = 'icons/placeholder.png';
      sendToContent('pause');
      setPlayingUI(false);
      setStatus('stopped', 'Stopped');
    } else {
      currentQueueIndex = Math.min(index, queue.length - 1);
      playQueueItem(currentQueueIndex);
    }
  } else if (index < currentQueueIndex) {
    currentQueueIndex--;
  }
  rebuildShuffleOrder();
  renderQueue();
  persistState();
}

function clearQueue() {
  queue             = [];
  currentQueueIndex = -1;
  shuffleOrder      = [];
  sendToContent('pause');
  setPlayingUI(false);
  setStatus('stopped', 'Stopped');
  trackTitle.textContent    = 'No track loaded';
  trackChannel.textContent  = '—';
  albumArt.src              = 'icons/placeholder.png';
  progressFill.style.width  = '0%';
  progressThumb.style.left  = '0%';
  currentTimeEl.textContent = '0:00';
  totalTimeEl.textContent   = '0:00';
  cachedDuration            = 0;
  cachedCurrentTime         = 0;
  renderQueue();
  persistState();
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Persistence ───────────────────────────────────────────────────────────────

function persistState() {
  chrome.storage.local.set({
    queue, currentQueueIndex, volume: currentVolume, shuffleOn, repeatOn
  });
}

function loadPersistedState() {
  chrome.storage.local.get(
    ['queue', 'currentQueueIndex', 'volume', 'shuffleOn', 'repeatOn'],
    (data) => {
      if (data.queue && data.queue.length > 0) {
        queue             = data.queue;
        currentQueueIndex = data.currentQueueIndex ?? 0;
        rebuildShuffleOrder();
        renderQueue();
        const item = queue[currentQueueIndex];
        if (item) {
          trackTitle.textContent   = item.title;
          trackChannel.textContent = item.channel;
          albumArt.src             = item.thumb;
          setStatus('paused', 'Ready — press play to resume');
        }
      }
      if (data.volume !== undefined) {
        currentVolume           = data.volume;
        volumeSlider.value      = data.volume;
        volumeLabel.textContent = data.volume;
        updateVolIcon();
      }
      if (data.shuffleOn) { shuffleOn = true; shuffleBtn.dataset.active = 'true'; }
      if (data.repeatOn)  { repeatOn  = true; repeatBtn.dataset.active  = 'true'; }
    }
  );
}

// ── Event listeners ───────────────────────────────────────────────────────────

loadBtn.addEventListener('click', loadFromInput);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromInput(); });
playPauseBtn.addEventListener('click', togglePlayPause);
prevBtn.addEventListener('click', playPrev);
nextBtn.addEventListener('click', playNext);

shuffleBtn.addEventListener('click', () => {
  shuffleOn = !shuffleOn;
  shuffleBtn.dataset.active = String(shuffleOn);
  if (shuffleOn) rebuildShuffleOrder();
  persistState();
});

repeatBtn.addEventListener('click', () => {
  repeatOn = !repeatOn;
  repeatBtn.dataset.active = String(repeatOn);
  persistState();
});

muteBtn.addEventListener('click', toggleMute);
volumeSlider.addEventListener('input', () => {
  isMuted = false;
  setVolume(Number(volumeSlider.value));
});
progressTrack.addEventListener('click', seekFromClick);
clearQueueBtn.addEventListener('click', clearQueue);

document.addEventListener('keydown', (e) => {
  if (e.target === urlInput) return;
  switch (e.code) {
    case 'Space':      e.preventDefault(); togglePlayPause(); break;
    case 'ArrowRight': sendToContent('seekTo', { seconds: cachedCurrentTime + 10 }); break;
    case 'ArrowLeft':  sendToContent('seekTo', { seconds: Math.max(0, cachedCurrentTime - 10) }); break;
    case 'ArrowUp':    setVolume(Math.min(100, currentVolume + 5)); break;
    case 'ArrowDown':  setVolume(Math.max(0,   currentVolume - 5)); break;
    case 'KeyN':       playNext(); break;
    case 'KeyP':       playPrev(); break;
    case 'KeyM':       toggleMute(); break;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadPersistedState();

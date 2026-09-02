/**
 * app.js — ASCILINE Showcase (index.html) UI Layer
 * =================================================
 * All WebSocket/render/codec logic is encapsulated in the AsciiPlayer SDK (src/asciline-player.js).
 * This file solely binds DOM UI controls to the SDK events and methods.
 */

import { AsciiPlayer } from './src/asciline-player.js';

// ── DOM References ──────────────────────────────────────────────────────────
const canvas        = document.getElementById('ascii-canvas');
const statusEl      = document.getElementById('status');
const container     = document.getElementById('player-container');
const overlay       = document.getElementById('play-overlay');
const audioEl       = document.getElementById('ascii-audio');
const volumeSlider  = document.getElementById('volume-slider');

const playPauseBtn  = document.getElementById('play-pause-btn');
const seekBar       = document.getElementById('seek-slider');
const timeCurrent   = document.getElementById('time-current');
const timeTotal     = document.getElementById('time-total');

const btnBack       = document.getElementById('btn-back');
const btnFwd        = document.getElementById('btn-fwd');
const seekPlayed    = document.getElementById('seek-played');
const seekWrap      = document.querySelector('.seek-wrap');
const seekPreview   = document.getElementById('seek-preview');
const seekPreviewImg  = document.getElementById('seek-preview-img');
const seekPreviewTime = document.getElementById('seek-preview-time');

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

let toastHideTimer = null;
function showToast(msg) {
    let el = document.getElementById('connection-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'connection-toast';
        el.className = 'toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        container.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// ── SDK Player ───────────────────────────────────────────────────────────────
const player = new AsciiPlayer('#ascii-canvas', {
    url: 'auto',                // ws://localhost:PORT/ws?codec=adaptive
    audio: audioEl || true,     // Use existing <audio> element or create a new one
    container: '#player-container',
    selectionLayer: '#ascii-player',
    autoplay: false,
});

// ── Seek / Scrub State ───────────────────────────────────────────────────────
let isSeeking = false;
let scrubMeta = null;

// Lazy load hover thumbnail sprite
function setupScrub(v) {
    scrubMeta = null;
    if (seekPreviewImg) seekPreviewImg.style.backgroundImage = '';
    fetch('/scrub?v=' + (v || 0) + '&t=' + Date.now())
        .then(r => r.json())
        .then(m => {
            if (!m || !m.available || !seekPreviewImg) return;
            scrubMeta = m;
            seekPreviewImg.style.width  = m.cellW + 'px';
            seekPreviewImg.style.height = m.cellH + 'px';
            seekPreviewImg.style.backgroundImage = `url(${m.sprite})`;
            seekPreviewImg.style.backgroundSize = `${m.gridCols * m.cellW}px ${m.gridRows * m.cellH}px`;
        })
        .catch(() => {});
}

function onSeekHover(e) {
    if (!scrubMeta || !player.duration || !seekWrap) return;
    const rect = seekWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const time = (x / rect.width) * player.duration;
    const idx = Math.max(0, Math.min(Math.floor(time / scrubMeta.interval), scrubMeta.count - 1));
    const col = idx % scrubMeta.gridCols;
    const row = Math.floor(idx / scrubMeta.gridCols);
    seekPreviewImg.style.backgroundPosition = `-${col * scrubMeta.cellW}px -${row * scrubMeta.cellH}px`;
    seekPreviewTime.textContent = formatTime(time);
    const half = scrubMeta.cellW / 2;
    seekPreview.style.left = Math.max(half, Math.min(x, rect.width - half)) + 'px';
    seekPreview.classList.add('show');
}

// ── SDK Event Listeners ──────────────────────────────────────────────────

player.on('buffering', () => {
    statusEl.textContent = 'Buffering...';
    statusEl.style.color = 'var(--accent-color)';
});

player.on('playing', () => {
    overlay.classList.add('hidden');
    container.classList.remove('paused');
    if (playPauseBtn) playPauseBtn.textContent = '❚❚';
});

player.on('paused', () => {
    container.classList.add('paused');
    if (playPauseBtn) playPauseBtn.textContent = '▶';
    statusEl.textContent = '❚❚ PAUSED';
    statusEl.style.color = '#888';
});

player.on('ended', () => {
    overlay.classList.remove('hidden');
    container.classList.remove('paused');
    if (playPauseBtn) playPauseBtn.textContent = '▶';
    statusEl.textContent = 'Stream Ended.';
    statusEl.style.color = '#888';
    if (seekBar) { seekBar.value = 0; }
    if (seekPlayed) seekPlayed.style.transform = 'scaleX(0)';
    if (timeCurrent) timeCurrent.textContent = '00:00';
});

player.on('error', (msg) => {
    statusEl.textContent = msg || 'Connection Error!';
    statusEl.style.color = '#ff0000';
    showToast('Connection lost.');
    overlay.classList.remove('hidden');
    if (playPauseBtn) playPauseBtn.textContent = '▶';
});

// INIT signal: new video starting
player.on('init', (info) => {
    // info: { fps, renderMode, pixelMode, cols, rows, duration, startOffset, queueIdx, isWebcam }
    if (seekBar) {
        seekBar.max   = info.duration || 0;
        seekBar.value = 0;
    }
    if (timeTotal)   timeTotal.textContent   = formatTime(info.duration || 0);
    if (timeCurrent) timeCurrent.textContent = '00:00';
    if (seekPlayed)  seekPlayed.style.transform = 'scaleX(0)';

    // Pixel toggle button
    const filterPixelBtn = document.getElementById('filter-pixel');
    if (filterPixelBtn) {
        filterPixelBtn.dataset.active = info.pixelMode ? 'true' : 'false';
        filterPixelBtn.textContent    = info.pixelMode ? 'ON' : 'OFF';
        if (info.isWebcam) {
            filterPixelBtn.disabled = true;
            filterPixelBtn.style.opacity = '0.5';
            filterPixelBtn.style.cursor  = 'not-allowed';
            filterPixelBtn.title = 'Pixel mode toggle is disabled during live webcam feed';
        } else {
            filterPixelBtn.disabled = false;
            filterPixelBtn.style.opacity = '1';
            filterPixelBtn.style.cursor  = 'pointer';
            filterPixelBtn.title = '';
        }
    }

    // Thumbnail scrub — lazy-load on first hover
    scrubMeta = null;
    if (seekWrap) {
        seekWrap.addEventListener('mouseenter', () => {
            if (!scrubMeta) setupScrub(info.queueIdx);
        }, { once: true });
    }
});

// FPS / buffer status
player.on('fps', ({ fps, targetFps, buffered, mode, pixel }) => {
    const modes = { 2: '64 Color', 3: '512 Color', 4: '32K Color', 5: '262K Color', 6: '16M Ultra' };
    const label = (modes[mode] || 'B&W') + (pixel ? ' PIXEL' : '');
    statusEl.textContent = `FPS: ${fps}/${Math.round(targetFps)} | Buf: ${buffered} | ${label}`;
});

// Time update (throttled to 100ms from SDK)
player.on('timeupdate', (currentTime) => {
    if (isSeeking) return;
    if (seekBar && player.duration) {
        seekBar.value = currentTime;
        if (seekPlayed) seekPlayed.style.transform = `scaleX(${Math.min(1, currentTime / player.duration)})`;
    }
    if (timeCurrent) timeCurrent.textContent = formatTime(currentTime);
});

// ── UI Controls → SDK Methods ────────────────────────────────────────────

// Play/Pause button
if (playPauseBtn) {
    playPauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = player.getState();
        if (s === 'IDLE' || s === 'ENDED' || s === 'ERROR') player.play();
        else player.togglePlay();
    });
}

// Overlay (large ▶ icon) click
overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    player.play();
});

// Container click → pause toggle
container.addEventListener('click', (e) => {
    if (e.target.closest('#play-overlay')) return;
    if (window.getSelection().toString().length > 0) return;
    const s = player.getState();
    if (s === 'PLAYING' || s === 'PAUSED') player.togglePlay();
});

// Seek slider
if (seekBar) {
    seekBar.addEventListener('input', () => {
        isSeeking = true;
        if (timeCurrent) timeCurrent.textContent = formatTime(seekBar.value);
    });
    seekBar.addEventListener('change', () => {
        player.seek(parseFloat(seekBar.value));
        isSeeking = false;
    });
}

// ±10s skip buttons
if (btnBack) btnBack.addEventListener('click', (e) => { e.stopPropagation(); player.skip(-10); });
if (btnFwd)  btnFwd.addEventListener('click',  (e) => { e.stopPropagation(); player.skip(10); });

// Hover scrub preview
if (seekWrap) {
    seekWrap.addEventListener('mousemove', onSeekHover);
    seekWrap.addEventListener('mouseleave', () => { if (seekPreview) seekPreview.classList.remove('show'); });
}

// Restore volume from localStorage
const PREF_VOLUME  = 'asciline_volume';
const PREF_FILTERS = 'asciline_filters';

if (volumeSlider) {
    const savedVol = localStorage.getItem(PREF_VOLUME);
    if (savedVol !== null) {
        const vol = Math.min(1, Math.max(0, parseFloat(savedVol)));
        if (!Number.isNaN(vol)) {
            volumeSlider.value = vol;
            player.setVolume(vol);
        }
    }
    volumeSlider.addEventListener('input', () => {
        player.setVolume(parseFloat(volumeSlider.value));
        localStorage.setItem(PREF_VOLUME, volumeSlider.value);
    });
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    const s = player.getState();
    if (s !== 'PLAYING' && s !== 'PAUSED') return;
    if (e.code === 'Space') {
        e.preventDefault();
        player.togglePlay();
    } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        player.skip(10);
    } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        player.skip(-10);
    } else if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleFilterMenu();
    }
});

// ── Filter Menu ─────────────────────────────────────────────────────────────
const filterMenu       = document.getElementById('filter-menu');
const btnFilters       = document.getElementById('btn-filters');
const filterClose      = document.getElementById('filter-close');
const filterContrast   = document.getElementById('filter-contrast');
const filterGamma      = document.getElementById('filter-gamma');
const filterBrightness = document.getElementById('filter-brightness');
const filterSharpness  = document.getElementById('filter-sharpness');
const filterInvertBtn  = document.getElementById('filter-invert');
const filterPixelBtn   = document.getElementById('filter-pixel');
const contrastVal      = document.getElementById('filter-contrast-val');
const gammaVal         = document.getElementById('filter-gamma-val');
const brightnessVal    = document.getElementById('filter-brightness-val');
const sharpnessVal     = document.getElementById('filter-sharpness-val');
const filterReset      = document.getElementById('filter-reset');
const paletteRadios    = document.querySelectorAll('input[name="palette"]');

let currentFilters = { contrast: 1.0, gamma: 1.0, brightness: 0, invert: false, sharpness: 0, palette: 'default' };

function syncFilterUI() {
    if (filterContrast)   filterContrast.value = currentFilters.contrast;
    if (filterGamma)      filterGamma.value = currentFilters.gamma;
    if (filterBrightness) filterBrightness.value = currentFilters.brightness;
    if (filterSharpness)  filterSharpness.value = currentFilters.sharpness;
    if (contrastVal)      contrastVal.textContent = Number(currentFilters.contrast).toFixed(2);
    if (gammaVal)         gammaVal.textContent = Number(currentFilters.gamma).toFixed(2);
    if (brightnessVal) {
        const v = currentFilters.brightness;
        brightnessVal.textContent = (v > 0 ? '+' : '') + v;
    }
    if (sharpnessVal) sharpnessVal.textContent = String(currentFilters.sharpness);
    if (filterInvertBtn) {
        filterInvertBtn.dataset.active = currentFilters.invert ? 'true' : 'false';
        filterInvertBtn.textContent = currentFilters.invert ? 'ON' : 'OFF';
    }
    paletteRadios.forEach(r => { r.checked = (r.value === currentFilters.palette); });
}

// Restore filter preferences from localStorage
(() => {
    const raw = localStorage.getItem(PREF_FILTERS);
    if (!raw) return;
    try {
        const f = JSON.parse(raw);
        const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
        const contrast   = clamp(parseFloat(f.contrast), 0.1, 3.0);
        const gamma      = clamp(parseFloat(f.gamma), 0.1, 3.0);
        const brightness = clamp(parseInt(f.brightness, 10), -100, 100);
        const sharpness  = clamp(parseInt(f.sharpness, 10), 0, 10);
        const palette    = ['default', 'flat', 'block'].includes(f.palette) ? f.palette : 'default';
        if ([contrast, gamma, brightness, sharpness].some(Number.isNaN)) return;
        currentFilters = { contrast, gamma, brightness, sharpness, palette, invert: Boolean(f.invert) };
        syncFilterUI();
        player.setFilters(currentFilters); // Restore prefs into SDK state
    } catch (_) { /* ignore corrupt prefs */ }
})();

function applyFilter(patch) {
    Object.assign(currentFilters, patch);
    syncFilterUI();
    localStorage.setItem(PREF_FILTERS, JSON.stringify(currentFilters));
    player.setFilters(currentFilters);
}

function toggleFilterMenu() {
    if (filterMenu) filterMenu.classList.toggle('open');
}

if (btnFilters)  btnFilters.addEventListener('click',  (e) => { e.stopPropagation(); toggleFilterMenu(); });
if (filterClose) filterClose.addEventListener('click', (e) => { e.stopPropagation(); toggleFilterMenu(); });
if (filterMenu)  filterMenu.addEventListener('click',  (e) => e.stopPropagation());

if (filterContrast) {
    filterContrast.addEventListener('input', () => {
        applyFilter({ contrast: parseFloat(filterContrast.value) });
    });
}
if (filterGamma) {
    filterGamma.addEventListener('input', () => {
        applyFilter({ gamma: parseFloat(filterGamma.value) });
    });
}
if (filterBrightness) {
    filterBrightness.addEventListener('input', () => {
        applyFilter({ brightness: parseInt(filterBrightness.value, 10) });
    });
}
if (filterSharpness) {
    filterSharpness.addEventListener('input', () => {
        applyFilter({ sharpness: parseInt(filterSharpness.value, 10) });
    });
}
if (filterInvertBtn) {
    filterInvertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyFilter({ invert: !currentFilters.invert });
    });
}
if (filterPixelBtn) {
    filterPixelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = filterPixelBtn.dataset.active !== 'true';
        filterPixelBtn.dataset.active = next ? 'true' : 'false';
        filterPixelBtn.textContent    = next ? 'ON' : 'OFF';
        player.setPixelMode(next);
    });
}
if (filterReset) {
    filterReset.addEventListener('click', (e) => {
        e.stopPropagation();
        currentFilters = { contrast: 1.0, gamma: 1.0, brightness: 0, invert: false, sharpness: 0, palette: 'default' };
        syncFilterUI();
        localStorage.setItem(PREF_FILTERS, JSON.stringify(currentFilters));
        player.setFilters(currentFilters);
    });
}
paletteRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        applyFilter({ palette: radio.value });
    });
});

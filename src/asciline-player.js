/**
 * ASCILINE Player SDK (asciline-player.js)
 * ========================================
 * High-performance, zero-dependency ASCII Video Player and WebSocket Stream Client.
 *
 * Usage:
 *   import { AsciiPlayer } from './src/asciline-player.js';
 *   const player = new AsciiPlayer('#my-canvas', { url: 'ws://localhost:8000/ws' });
 *   player.play();
 */

// Embed or import AscilineCodec
let AscilineCodecApi = (typeof AscilineCodec !== 'undefined') ? AscilineCodec : null;

// Fallback inlined codec if not already in window/global scope
if (!AscilineCodecApi) {
    const TAG_RAW = 0, TAG_ZLIB = 1, TAG_DELTA = 2, TAG_RLE_FULL = 3, TAG_PROFILE = 4;

    async function inflate(bytes) {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        writer.write(bytes);
        writer.close();
        const chunks = [];
        let totalLen = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLen += value.length;
        }
        if (chunks.length === 1) return chunks[0];
        const out = new Uint8Array(totalLen);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
    }

    const _P_MI = Int32Array.from([23,23,23,23,23,23,23,23,31,27,18,6,-6,-18,-27,-31,30,12,-12,-30,-30,-12,12,30,
      27,-6,-31,-18,18,31,6,-27,23,-23,-23,23,23,-23,-23,23,18,-31,6,27,-27,-6,31,-18,
      12,-30,30,-12,-12,30,-30,12,6,-18,27,-31,31,-27,18,-6]);
    const _P_ZZ = Int32Array.from([0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,
      21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]);

    function _idct8x8(block) {
        const tmp = new Int32Array(64), out = new Int32Array(64);
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                let sum = 0;
                for (let k = 0; k < 8; k++) sum += _P_MI[k * 8 + j] * block[i * 8 + k];
                tmp[i * 8 + j] = sum >> 6;
            }
        }
        for (let j = 0; j < 8; j++) {
            for (let i = 0; i < 8; i++) {
                let sum = 0;
                for (let k = 0; k < 8; k++) sum += _P_MI[k * 8 + i] * tmp[k * 8 + j];
                out[i * 8 + j] = sum >> 6;
            }
        }
        return out;
    }

    function _decodeProfile(payload) {
        const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const w = dv.getUint16(0, false), h = dv.getUint16(2, false);
        const yBlocks = (w >> 3) * (h >> 3), cBlocks = (w >> 4) * (h >> 4);
        let off = 4;
        function readPlanes(count) {
            const blks = new Array(count);
            for (let b = 0; b < count; b++) {
                const nz = payload[off++];
                const blk = new Int32Array(64);
                if (nz === 0) { blks[b] = blk; continue; }
                blk[0] = dv.getInt16(off, false); off += 2;
                for (let k = 1; k < nz; k++) {
                    const pos = payload[off++];
                    blk[_P_ZZ[pos]] = dv.getInt16(off, false); off += 2;
                }
                blks[b] = blk;
            }
            return blks;
        }
        const yB = readPlanes(yBlocks), uB = readPlanes(cBlocks), vB = readPlanes(cBlocks);
        const Y = new Uint8Array(w * h), U = new Uint8Array((w >> 1) * (h >> 1)), V = new Uint8Array((w >> 1) * (h >> 1));
        const bw = w >> 3, cbw = w >> 4;
        for (let by = 0; by < (h >> 3); by++) {
            for (let bx = 0; bx < bw; bx++) {
                const spat = _idct8x8(yB[by * bw + bx]);
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        Y[(by * 8 + r) * w + (bx * 8 + c)] = Math.max(0, Math.min(255, spat[r * 8 + c]));
                    }
                }
            }
        }
        for (let by = 0; by < (h >> 4); by++) {
            for (let bx = 0; bx < cbw; bx++) {
                const uS = _idct8x8(uB[by * cbw + bx]), vS = _idct8x8(vB[by * cbw + bx]);
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        const idx = (by * 8 + r) * (w >> 1) + (bx * 8 + c);
                        U[idx] = Math.max(0, Math.min(255, uS[r * 8 + c]));
                        V[idx] = Math.max(0, Math.min(255, vS[r * 8 + c]));
                    }
                }
            }
        }
        const bgr = new Uint8Array(w * h * 3);
        let dst = 0;
        for (let y = 0; y < h; y++) {
            const yOff = y * w, cOff = (y >> 1) * (w >> 1);
            for (let x = 0; x < w; x++) {
                const yVal = Y[yOff + x], uVal = U[cOff + (x >> 1)] - 128, vVal = V[cOff + (x >> 1)] - 128;
                const b = yVal + ((uVal * 454) >> 8);
                const g = yVal - ((uVal * 88 + vVal * 183) >> 8);
                const r = yVal + ((vVal * 359) >> 8);
                bgr[dst++] = Math.max(0, Math.min(255, b));
                bgr[dst++] = Math.max(0, Math.min(255, g));
                bgr[dst++] = Math.max(0, Math.min(255, r));
            }
        }
        return bgr;
    }

    AscilineCodecApi = {
        makeDecoder(cellBytes = 4) {
            let prevFrame = null;
            return {
                async decode(arrayBuffer) {
                    const view = new DataView(arrayBuffer);
                    const frameIndex = view.getUint32(0, false);
                    const tag = new Uint8Array(arrayBuffer, 4, 1)[0];
                    const payload = new Uint8Array(arrayBuffer, 5);
                    let frame;
                    if (tag === TAG_RAW) {
                        frame = payload;
                    } else if (tag === TAG_ZLIB) {
                        frame = await inflate(payload);
                    } else if (tag === TAG_DELTA) {
                        const inflated = await inflate(payload);
                        if (!prevFrame) throw new Error('delta frame arrived before any keyframe');
                        const dv = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
                        const count = dv.getUint32(0, true);
                        const idxOff = 4, valOff = 4 + count * 4;
                        frame = new Uint8Array(prevFrame);
                        for (let i = 0; i < count; i++) {
                            const cellIdx = dv.getUint32(idxOff + i * 4, true);
                            const dst = cellIdx * cellBytes, src = valOff + i * cellBytes;
                            for (let b = 0; b < cellBytes; b++) frame[dst + b] = inflated[src + b];
                        }
                    } else if (tag === TAG_RLE_FULL) {
                        const inflated = await inflate(payload);
                        const dv = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
                        const chunks = [];
                        let totalLen = 0, p = 0;
                        while (p < inflated.length) {
                            const count = dv.getUint16(p, true); p += 2;
                            const cell = inflated.subarray(p, p + cellBytes); p += cellBytes;
                            const out = new Uint8Array(count * cellBytes);
                            for (let c = 0; c < count; c++) out.set(cell, c * cellBytes);
                            chunks.push(out);
                            totalLen += out.length;
                        }
                        frame = new Uint8Array(totalLen);
                        let off = 0;
                        for (const ch of chunks) { frame.set(ch, off); off += ch.length; }
                    } else if (tag === TAG_PROFILE) {
                        const inflated = await inflate(payload);
                        frame = _decodeProfile(inflated);
                    } else {
                        throw new Error(`unknown tag ${tag}`);
                    }
                    prevFrame = frame;
                    return { frameIndex, frame };
                }
            };
        }
    };
}

const CHAR_LUT = new Array(128);
for (let i = 0; i < 128; i++) CHAR_LUT[i] = String.fromCharCode(i);

/**
 * AsciiPlayer Class
 */
export class AsciiPlayer {
    /**
     * @param {HTMLCanvasElement|string} canvas - Canvas element or CSS selector
     * @param {Object} options - Configuration options
     */
    constructor(canvas, options = {}) {
        this.canvas = typeof canvas === 'string' ? document.querySelector(canvas) : canvas;
        if (!this.canvas) throw new Error(`AsciiPlayer: Canvas element '${canvas}' not found.`);
        this.ctx = this.canvas.getContext('2d');

        // Options & Defaults
        this.options = Object.assign({
            url: null,                  // WebSocket URL or auto-derived
            audio: true,                // Audio element / selector / boolean
            selectionLayer: null,       // Text element for copyable selection
            container: null,            // Sizing container (defaults to canvas parent)
            renderMode: 1,              // 1: Text, 2: 64 Color, 3: 512 Color, etc.
            pixelMode: false,           // Raw pixel mode
            autoplay: false,
            bufferSize: 4,
            filters: {
                contrast: 1.0,
                gamma: 1.0,
                brightness: 0,
                sharpness: 0,
                invert: false,
                palette: 'default'
            }
        }, options);

        // Container setup
        this.container = typeof this.options.container === 'string'
            ? document.querySelector(this.options.container)
            : (this.options.container || this.canvas.parentElement || document.body);

        // Selection Layer setup (Invisible Text Selection Overlay)
        this.selectionEnabled = this.options.selectionLayer !== false;
        if (typeof this.options.selectionLayer === 'string') {
            this.selectionLayer = document.querySelector(this.options.selectionLayer);
        } else if (this.options.selectionLayer instanceof HTMLElement) {
            this.selectionLayer = this.options.selectionLayer;
        } else if (this.selectionEnabled) {
            // Auto-create invisible selection overlay on top of canvas
            this.selectionLayer = document.createElement('pre');
            this.selectionLayer.className = 'ascii-selection-layer';
            this.selectionLayer.style.position = 'absolute';
            this.selectionLayer.style.top = '0';
            this.selectionLayer.style.left = '0';
            this.selectionLayer.style.margin = '0';
            this.selectionLayer.style.padding = '0';
            this.selectionLayer.style.fontFamily = 'Courier New, monospace';
            this.selectionLayer.style.fontWeight = 'bold';
            this.selectionLayer.style.fontSize = '8px';
            this.selectionLayer.style.lineHeight = '8px';
            this.selectionLayer.style.whiteSpace = 'pre';
            this.selectionLayer.style.overflow = 'hidden';
            this.selectionLayer.style.userSelect = 'text';
            this.selectionLayer.style.webkitUserSelect = 'text';
            this.selectionLayer.style.color = 'transparent';
            this.selectionLayer.style.pointerEvents = 'auto';
            this.selectionLayer.style.zIndex = '2';
            this.selectionLayer.style.display = 'none';

            if (this.canvas.parentElement) {
                if (getComputedStyle(this.canvas.parentElement).position === 'static') {
                    this.canvas.parentElement.style.position = 'relative';
                }
                this.canvas.parentElement.appendChild(this.selectionLayer);
            }
        } else {
            this.selectionLayer = null;
        }

        // Audio element setup
        if (typeof this.options.audio === 'string') {
            this.audioEl = document.querySelector(this.options.audio);
        } else if (this.options.audio instanceof HTMLAudioElement) {
            this.audioEl = this.options.audio;
        } else if (this.options.audio === true) {
            this.audioEl = document.createElement('audio');
            this.audioEl.preload = 'none';
        } else {
            this.audioEl = null;
        }

        // Internal State
        this.state = 'IDLE'; // IDLE | CONNECTING | PLAYING | PAUSED | ENDED | ERROR
        this.ws = null;
        this.frameBuffer = [];
        this.codecDecoder = null;
        this.decodeQueue = Promise.resolve();
        this.framesInFlight = 0;
        this.bufferReportTimer = null;

        // Playback Metrics
        this.targetFps = 24;
        this.frameInterval = 1000 / this.targetFps;
        this.renderMode = this.options.renderMode;
        this.pixelMode = this.options.pixelMode;
        this.readyToRender = false;
        this.pauseStartTime = 0;
        this.duration = 0;
        this.audioOffset = 0;
        this.isWebcamStream = false;
        this.currentQueueIdx = 0;

        // Canvas & Dimensions
        this.gridCols = 0;
        this.gridRows = 0;
        this.charWidth = 0;
        this.charHeight = 8;
        this.xPos = null;
        this.yPos = null;
        this.dotImageData = null;
        this.textDecoder = new TextDecoder();
        this.selectionBuffer = null;

        // Timing
        this.lastRenderTime = 0;
        this.frameCount = 0;
        this.currentFps = 0;
        this.lastFpsUpdate = 0;
        this.streamStartTime = 0;
        this.streamEpoch = 0;
        this._lastUiUpdate = 0;

        // Filters
        this.currentFilters = Object.assign({}, this.options.filters);
        this.filterSendTimer = null;

        // Event Emitter
        this._listeners = {};

        // Bound loops
        this._renderBound = this._renderFrame.bind(this);
        this._resizeBound = this.resize.bind(this);

        window.addEventListener('resize', this._resizeBound);

        if (this.options.autoplay) {
            this.play();
        }
    }

    // ── EVENT EMITTER ──
    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
        return this;
    }

    off(event, callback) {
        if (!this._listeners[event]) return this;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
        return this;
    }

    emit(event, ...args) {
        if (this._listeners[event]) {
            for (const cb of this._listeners[event]) {
                try { cb(...args); } catch (e) { console.error(`AsciiPlayer event error [${event}]`, e); }
            }
        }
    }

    _setState(newState) {
        if (this.state !== newState) {
            this.state = newState;
            this.emit('statechange', newState);
            this.emit(newState.toLowerCase());
        }
    }

    getState() {
        return this.state;
    }

    // ── PUBLIC PLAYBACK CONTROL ──

    play() {
        if (this.state === 'PAUSED') {
            this.resume();
            return;
        }
        if (this.state !== 'IDLE' && this.state !== 'ENDED' && this.state !== 'ERROR') return;
        this._setState('CONNECTING');
        this._connectWebSocket();
    }

    pause() {
        if (this.state !== 'PLAYING' || this.isWebcamStream) return;
        this._setState('PAUSED');
        this.pauseStartTime = performance.now();

        if (this.audioEl && !this.audioEl.paused) {
            this.audioEl.pause();
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'pause', paused: true }));
        }
    }

    resume() {
        if (this.state !== 'PAUSED') return;
        this._setState('PLAYING');
        this.readyToRender = true;

        const pauseDuration = performance.now() - this.pauseStartTime;
        this.streamStartTime += pauseDuration;
        this.pauseStartTime = 0;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'pause', paused: false }));
        }

        if (this.audioEl && this.audioEl.paused) {
            this.audioEl.play().catch(() => {});
        }

        this.frameBuffer.length = 0;
        this.lastRenderTime = performance.now();
        this.lastFpsUpdate = performance.now();
        this.frameCount = 0;
        requestAnimationFrame(this._renderBound);
    }

    togglePlay() {
        if (this.state === 'PLAYING') this.pause();
        else if (this.state === 'PAUSED') this.resume();
        else if (this.state === 'IDLE' || this.state === 'ENDED' || this.state === 'ERROR') this.play();
    }

    seek(targetSec) {
        if (this.isWebcamStream) return;
        if (this.duration) targetSec = Math.max(0, Math.min(targetSec, this.duration));

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'seek', time: targetSec }));
        }

        this.frameBuffer.length = 0;
        this.audioOffset = targetSec;

        if (this.audioEl) {
            this.audioEl.pause();
            this.streamEpoch++;
            const myEpoch = this.streamEpoch;
            this.audioEl.src = `/audio?v=${this.currentQueueIdx}&start=${targetSec}&t=${Date.now()}`;
            this.audioEl.load();

            if (this.state === 'PLAYING') {
                this.readyToRender = false;
                this.audioEl.play().catch(() => {});
                const onAudioStart = () => {
                    if (!this.readyToRender) {
                        this.readyToRender = true;
                        this.streamStartTime = performance.now() - (targetSec * 1000.0);
                        this.lastRenderTime = performance.now();
                        this.lastFpsUpdate = performance.now();
                        this.frameCount = 0;
                        requestAnimationFrame(this._renderBound);
                    }
                };
                if (this.audioEl.readyState >= 3) onAudioStart();
                else {
                    this.audioEl.addEventListener('playing', () => {
                        if (myEpoch !== this.streamEpoch) return;
                        onAudioStart();
                    }, { once: true });
                    setTimeout(() => {
                        if (myEpoch !== this.streamEpoch) return;
                        onAudioStart();
                    }, 500);
                }
            } else {
                this.streamStartTime = performance.now() - (targetSec * 1000.0);
                if (this.state === 'PAUSED') this.pauseStartTime = performance.now();
            }
        } else {
            this.streamStartTime = performance.now() - (targetSec * 1000.0);
            if (this.state === 'PAUSED') this.pauseStartTime = performance.now();
        }

        this.emit('seek', targetSec);
    }

    skip(deltaSec) {
        this.seek(this.getMasterClock() + deltaSec);
    }

    setVolume(volume) {
        const vol = Math.max(0, Math.min(1, volume));
        if (this.audioEl) this.audioEl.volume = vol;
    }

    getMasterClock() {
        if (this.audioEl && this.audioEl.readyState >= 1) {
            return this.audioEl.currentTime + this.audioOffset;
        }
        return (performance.now() - this.streamStartTime) / 1000.0;
    }

    setFilters(filters) {
        Object.assign(this.currentFilters, filters);
        if (this.filterSendTimer) clearTimeout(this.filterSendTimer);
        this.filterSendTimer = setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(Object.assign({ type: 'filter' }, this.currentFilters)));
            }
            this.filterSendTimer = null;
        }, 60);
    }

    setPixelMode(enable) {
        this.pixelMode = Boolean(enable);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'reinit',
                pixel: this.pixelMode,
                time: this.getMasterClock()
            }));
        }
    }

    setRenderMode(mode) {
        this.renderMode = mode;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'reinit',
                mode: this.renderMode,
                time: this.getMasterClock()
            }));
        }
    }

    setSelectionLayer(enable) {
        this.selectionEnabled = Boolean(enable);
        if (this.selectionLayer) {
            this.selectionLayer.style.display = (this.selectionEnabled && !this.pixelMode) ? 'block' : 'none';
        }
    }

    toggleSelectionLayer() {
        this.setSelectionLayer(!this.selectionEnabled);
        return this.selectionEnabled;
    }

    destroy() {
        this._stopBufferReports();
        window.removeEventListener('resize', this._resizeBound);
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.src = '';
        }
        this._setState('IDLE');
        this._listeners = {};
    }

    // ── INTERNAL WEBSOCKET & RENDER ──

    _connectWebSocket() {
        this.frameBuffer.length = 0;
        this.frameCount = 0;
        this.currentFps = 0;

        let wsUrl = this.options.url;
        if (!wsUrl || wsUrl === 'auto') {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${protocol}//${location.host}/ws?codec=adaptive`;
        }

        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            this.emit('buffering');
        };

        this.ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                if (event.data.startsWith('Error:')) {
                    this.emit('error', event.data);
                    if (this.ws) this.ws.close();
                    this._finishStream('ERROR');
                    return;
                }

                if (event.data.startsWith('INIT:')) {
                    const p = event.data.split(':');
                    this.targetFps = parseFloat(p[1]);
                    this.frameInterval = 1000 / this.targetFps;
                    this.renderMode = parseInt(p[2]);
                    this.pixelMode = (p.length > 5 && parseInt(p[5]) === 1);
                    this.currentQueueIdx = (p.length > 6) ? parseInt(p[6]) : 0;
                    this.duration = (p.length > 7) ? parseFloat(p[7]) : 0;
                    const startOffset = (p.length > 8) ? parseFloat(p[8]) : 0;
                    this.isWebcamStream = (p.length > 9 && parseInt(p[9]) === 1);

                    this.audioOffset = startOffset;
                    this.frameBuffer.length = 0;
                    this.framesInFlight = 0;
                    this.streamEpoch++;

                    this._buildCanvas(parseInt(p[3]), parseInt(p[4]));

                    if (this.renderMode > 1 && !this.pixelMode) {
                        this.codecDecoder = AscilineCodecApi.makeDecoder(4);
                    } else {
                        this.codecDecoder = null;
                    }

                    this.decodeQueue = Promise.resolve();
                    const wasPaused = (this.state === 'PAUSED');
                    this.readyToRender = false;
                    if (!wasPaused) this._setState('PLAYING');

                    if (this.audioEl && !this.isWebcamStream) {
                        this.audioEl.pause();
                        const qs = `v=${this.currentQueueIdx}&`;
                        const st = startOffset > 0 ? `start=${startOffset}&` : '';
                        this.audioEl.src = `/audio?${qs}${st}t=${Date.now()}`;
                        this.audioEl.load();
                    }

                    this.setFilters(this.currentFilters);
                    this.emit('init', {
                        fps: this.targetFps,
                        cols: parseInt(p[3]),
                        rows: parseInt(p[4]),
                        duration: this.duration,
                        pixelMode: this.pixelMode,
                        renderMode: this.renderMode,
                        queueIdx: this.currentQueueIdx,
                        isWebcam: this.isWebcamStream
                    });
                    return;
                }

                // Text Frame (Mode 1)
                const text = event.data;
                const newlineIdx = text.indexOf('\n');
                const frameIndex = parseInt(text.substring(0, newlineIdx));
                const frameTime = frameIndex / this.targetFps;
                const frameData = text.substring(newlineIdx + 1);
                this.frameBuffer.push({ data: frameData, time: frameTime });
                this._triggerPlaybackStart(this.streamEpoch);
            } else {
                // Binary Frame
                if (this.codecDecoder) {
                    this.framesInFlight++;
                    this.decodeQueue = this.decodeQueue.then(() =>
                        this.codecDecoder.decode(event.data).then(({ frameIndex, frame }) => {
                            this.framesInFlight--;
                            const frameTime = frameIndex / this.targetFps;
                            this.frameBuffer.push({ data: frame, time: frameTime });
                            this._triggerPlaybackStart(this.streamEpoch);
                        }).catch(e => {
                            this.framesInFlight--;
                            console.error("Decode error", e);
                        })
                    );
                } else {
                    const buffer = event.data;
                    const view = new DataView(buffer);
                    const frameIndex = view.getUint32(0, false);
                    const frameTime = frameIndex / this.targetFps;
                    const frameData = new Uint8Array(buffer, 4);
                    this.frameBuffer.push({ data: frameData, time: frameTime });
                    this._triggerPlaybackStart(this.streamEpoch);
                }
            }

            while (this.frameBuffer.length > this.options.bufferSize * 5) {
                this.frameBuffer.shift();
            }
        };

        this.ws.onclose = (event) => {
            const endedCleanly = event.code === 1000;
            this._finishStream(endedCleanly ? 'ENDED' : 'ERROR');
        };

        this.ws.onerror = (e) => {
            this.emit('error', e);
            this._finishStream('ERROR');
        };
    }

    _triggerPlaybackStart(epochToMatch) {
        if (this.readyToRender || this.state !== 'PLAYING') return;
        if (this.isWebcamStream || !this.audioEl) {
            this._beginRendering();
            return;
        }

        this.audioEl.play().catch(() => {});
        if (this.audioEl.readyState >= 3) {
            this._beginRendering();
        } else {
            this.audioEl.addEventListener('playing', () => {
                if (epochToMatch !== this.streamEpoch) return;
                this._beginRendering();
            }, { once: true });
            setTimeout(() => {
                if (epochToMatch !== this.streamEpoch) return;
                if (!this.readyToRender) this._beginRendering();
            }, 500);
        }
    }

    _beginRendering() {
        if (this.readyToRender) return;
        this.readyToRender = true;
        this.streamStartTime = performance.now() - (this.audioOffset * 1000.0);
        this.lastRenderTime = performance.now();
        this.lastFpsUpdate = this.lastRenderTime;
        requestAnimationFrame(this._renderBound);
        this._startBufferReports();
    }

    _startBufferReports() {
        this._stopBufferReports();
        this.bufferReportTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state === 'PLAYING') {
                this.ws.send(JSON.stringify({ type: 'buffer', depth: this.framesInFlight }));
            }
        }, 250);
    }

    _stopBufferReports() {
        if (this.bufferReportTimer) {
            clearInterval(this.bufferReportTimer);
            this.bufferReportTimer = null;
        }
    }

    _buildCanvas(cols, rows) {
        this.gridCols = cols;
        this.gridRows = rows;
        this.canvas.style.display = 'block';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';

        if (this.pixelMode) {
            this.canvas.width = cols;
            this.canvas.height = rows;
            this.canvas.style.imageRendering = 'pixelated';
            this.dotImageData = this.ctx.createImageData(cols, rows);
            const d = this.dotImageData.data;
            for (let i = 3; i < d.length; i += 4) d[i] = 255;
            if (this.selectionLayer) this.selectionLayer.style.display = 'none';
        } else {
            this.canvas.style.imageRendering = '';
            this.dotImageData = null;
            this.ctx.font = 'bold 8px Courier New';
            this.charWidth = this.ctx.measureText('M').width;
            this.charHeight = 8;
            this.canvas.width = cols * this.charWidth;
            this.canvas.height = rows * this.charHeight;

            if (this.selectionLayer) {
                this.selectionBuffer = new Uint8Array((cols + 1) * rows);
                for (let r = 0; r < rows; r++) this.selectionBuffer[r * (cols + 1) + cols] = 10;
            }

            this.ctx.font = 'bold 8px Courier New';
            this.ctx.textBaseline = 'top';
            this.xPos = new Float32Array(cols);
            this.yPos = new Float32Array(rows);
            for (let c = 0; c < cols; c++) this.xPos[c] = c * this.charWidth;
            for (let r = 0; r < rows; r++) this.yPos[r] = r * this.charHeight;
        }

        this.resize();
    }

    resize() {
        const containerW = this.container.clientWidth || window.innerWidth;
        const containerH = this.container.clientHeight || window.innerHeight;

        this.canvas.style.width = containerW + 'px';
        this.canvas.style.height = containerH + 'px';
        this.canvas.style.objectFit = 'contain';

        if (this.selectionLayer && !this.pixelMode && this.canvas.width > 0) {
            const fitScaleX = containerW / this.canvas.width;
            const fitScaleY = containerH / this.canvas.height;
            const fitScale = Math.min(fitScaleX, fitScaleY);
            const renderedW = this.canvas.width * fitScale;
            const renderedH = this.canvas.height * fitScale;
            const offsetX = (containerW - renderedW) / 2;
            const offsetY = (containerH - renderedH) / 2;

            this.selectionLayer.style.width = this.canvas.width + 'px';
            this.selectionLayer.style.height = this.canvas.height + 'px';
            this.selectionLayer.style.position = 'absolute';
            this.selectionLayer.style.top = '0';
            this.selectionLayer.style.left = '0';
            this.selectionLayer.style.transformOrigin = 'top left';
            this.selectionLayer.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${fitScale})`;
            this.selectionLayer.style.fontSize = '8px';
            this.selectionLayer.style.lineHeight = '8px';
        }
    }

    _renderFrame(now) {
        if (this.state !== 'PLAYING' || !this.readyToRender) return;
        requestAnimationFrame(this._renderBound);

        const masterClock = this.getMasterClock();

        // Throttle timeupdate to ~100ms to avoid flooding UI listeners
        if (now - this._lastUiUpdate >= 100) {
            this._lastUiUpdate = now;
            this.emit('timeupdate', masterClock);
        }

        if (this.frameBuffer.length === 0) return;

        let frameObj;
        if (this.isWebcamStream) {
            frameObj = this.frameBuffer.pop();
            this.frameBuffer.length = 0;
        } else {
            while (this.frameBuffer.length > 0 && this.frameBuffer[0].time < masterClock - 0.1) {
                this.frameBuffer.shift();
            }
            if (this.frameBuffer.length === 0) return;
            if (this.frameBuffer[0].time > masterClock + 0.05) return;
            frameObj = this.frameBuffer.shift();
        }

        const frame = frameObj.data;

        this.frameCount++;
        if (now - this.lastFpsUpdate >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            this.emit('fps', {
                fps: this.currentFps,
                targetFps: this.targetFps,
                buffered: this.frameBuffer.length,
                mode: this.renderMode,
                pixel: this.pixelMode
            });
        }

        this.lastRenderTime = now;

        if (this.pixelMode) {
            const view = frame;
            const data = this.dotImageData.data;
            for (let src = 0, dst = 0; src < view.length; src += 3, dst += 4) {
                data[dst] = view[src + 2];     // R (from BGR)
                data[dst + 1] = view[src + 1]; // G
                data[dst + 2] = view[src];     // B
            }
            this.ctx.putImageData(this.dotImageData, 0, 0);
        } else if (this.renderMode === 1) {
            // Mode 1: Black & White Plain ASCII Text
            this.ctx.fillStyle = '#050505';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 8px Courier New';
            this.ctx.textBaseline = 'top';

            if (typeof frame === 'string') {
                const lines = frame.split('\n');
                for (let r = 0; r < lines.length && r < this.gridRows; r++) {
                    const y = (this.yPos && this.yPos[r] !== undefined) ? this.yPos[r] : r * this.charHeight;
                    this.ctx.fillText(lines[r], 0, y);
                }
            }

            if (this.selectionLayer) {
                if (this.selectionEnabled) {
                    this.selectionLayer.style.display = 'block';
                    this.selectionLayer.style.color = 'transparent';
                    this.selectionLayer.textContent = frame;
                } else {
                    this.selectionLayer.style.display = 'none';
                }
            }
        } else {
            const view = frame;
            this.ctx.fillStyle = '#050505';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.font = 'bold 8px Courier New';
            this.ctx.textBaseline = 'top';

            let col = 0, row = 0, prevPacked = -1;
            for (let idx = 0; idx < view.length; idx += 4) {
                const packed = (view[idx+1] << 16) | (view[idx+2] << 8) | view[idx+3];
                if (packed !== prevPacked) {
                    this.ctx.fillStyle = `rgb(${view[idx+1]},${view[idx+2]},${view[idx+3]})`;
                    prevPacked = packed;
                }
                this.ctx.fillText(CHAR_LUT[view[idx]], this.xPos[col], this.yPos[row]);

                if (this.selectionBuffer) {
                    this.selectionBuffer[row * (this.gridCols + 1) + col] = view[idx];
                }

                col++;
                if (col >= this.gridCols) { col = 0; row++; }
            }

            if (this.selectionLayer && this.selectionBuffer) {
                if (this.selectionEnabled) {
                    this.selectionLayer.style.display = 'block';
                    this.selectionLayer.style.color = 'transparent';
                    this.selectionLayer.textContent = this.textDecoder.decode(this.selectionBuffer);
                } else {
                    this.selectionLayer.style.display = 'none';
                }
            }
        }
    }

    _finishStream(finalState = 'IDLE') {
        this._setState(finalState);
        this._stopBufferReports();
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.src = '';
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.style.display = 'none';
        if (this.selectionLayer) {
            this.selectionLayer.textContent = '';
            this.selectionLayer.style.display = 'none';
        }
        this.readyToRender = false;
        this.pauseStartTime = 0;
        this.frameBuffer.length = 0;
    }
}

// Support CommonJS and window global
if (typeof window !== 'undefined') {
    window.AsciiPlayer = AsciiPlayer;
}

export default AsciiPlayer;

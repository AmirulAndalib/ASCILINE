import React, { useEffect, useRef, useState } from 'react';
// Note: Once published to NPM, change this to: import { AsciiPlayer } from 'asciline-player';
import { AsciiPlayer } from '../src/asciline-player.js';

/**
 * AsciiCanvas React Component
 * 
 * Usage:
 *   <AsciiCanvas url="ws://localhost:8000/ws" />
 */
export function AsciiCanvas({ url = 'ws://localhost:8000/ws', autoplay = true, className = '' }) {
  const canvasRef = useRef(null);
  const playerRef = useRef(null);
  const [fps, setFps] = useState(0);
  const [state, setState] = useState('IDLE');

  useEffect(() => {
    if (!canvasRef.current) return;

    // 1. Initialize player
    const player = new AsciiPlayer(canvasRef.current, {
      url,
      autoplay
    });
    playerRef.current = player;

    // 2. Listen to events
    player.on('fps', (info) => setFps(info.fps));
    player.on('statechange', (s) => setState(s));

    // 3. Cleanup on unmount
    return () => {
      player.destroy();
    };
  }, [url, autoplay]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }} className={className}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div style={{ position: 'absolute', top: 10, right: 10, color: '#0f0', fontFamily: 'monospace' }}>
        FPS: {fps} | State: {state}
      </div>
    </div>
  );
}

export default AsciiCanvas;

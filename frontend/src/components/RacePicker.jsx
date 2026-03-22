import React, { useState } from 'react';

export function RacePicker() {
  const [playbackState, setPlaybackState] = useState('paused');
  const [status, setStatus] = useState('');
  const renderUrl = import.meta.env.VITE_RENDER_URL;

  const handlePlayback = async (action) => {
    if (!renderUrl) return;
    try {
      await fetch(`${renderUrl}/playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      setPlaybackState(action);
      setStatus(action === 'play' ? '▶ Přehrávání spuštěno' : '⏸ Pozastaveno');
      setTimeout(() => setStatus(''), 3000);
    } catch {
      setStatus('⚠ Chyba při komunikaci s backendem');
    }
  };

  return (
    <div className="glass-panel" style={{ 
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '12px 16px', borderRadius: '24px', border: '1px solid rgba(255, 255, 255, 0.1)',
      position: 'relative', minWidth: '200px', justifyContent: 'center'
    }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => handlePlayback('play')}
          disabled={playbackState === 'play'}
          style={{
            ...styles.button,
            background: playbackState === 'play' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.1)',
            color: playbackState === 'play' ? '#4ade80' : '#22c55e',
            border: `1px solid ${playbackState === 'play' ? 'rgba(74, 222, 128, 0.5)' : 'rgba(34, 197, 94, 0.3)'}`,
            opacity: playbackState === 'play' ? 0.5 : 1
          }}
        >
          <span style={{ fontSize: '0.8rem' }}>▶</span> PLAY
        </button>
        <button
          onClick={() => handlePlayback('pause')}
          disabled={playbackState === 'pause'}
          style={{
            ...styles.button,
            background: playbackState === 'pause' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(239, 68, 68, 0.1)',
            color: playbackState === 'pause' ? '#f87171' : '#ef4444',
            border: `1px solid ${playbackState === 'pause' ? 'rgba(248, 113, 113, 0.5)' : 'rgba(239, 68, 68, 0.3)'}`,
            opacity: playbackState === 'pause' ? 0.5 : 1
          }}
        >
          <span style={{ fontSize: '0.8rem' }}>⏸</span> PAUSE
        </button>
      </div>
      {status && <span style={styles.status}>{status}</span>}
    </div>
  );
}

const styles = {
  button: {
    borderRadius: '16px', padding: '8px 16px', fontWeight: '600', fontSize: '0.85rem',
    cursor: 'pointer', letterSpacing: '0.5px', transition: 'all 0.2s', display: 'flex',
    alignItems: 'center', gap: '6px'
  },
  status: {
    color: 'var(--color-text-dim)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)',
    position: 'absolute', bottom: '-24px', right: '16px', whiteSpace: 'nowrap'
  }
};

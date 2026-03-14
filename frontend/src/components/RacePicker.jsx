import React, { useState, useEffect } from 'react';
import { useF1Store } from '../store/useF1Store';

const YEARS = [2026, 2025, 2024, 2023, 2022, 2021];

export function RacePicker() {
  const [year, setYear] = useState(2023);
  const [races, setRaces] = useState([]);
  const [selectedRound, setSelectedRound] = useState('');
  const [startLap, setStartLap] = useState(1);
  const [playbackState, setPlaybackState] = useState('paused');
  const [loading, setLoading] = useState(false);
  const [loadingRaces, setLoadingRaces] = useState(false);
  const [status, setStatus] = useState('');

  const renderUrl = import.meta.env.VITE_RENDER_URL;

  // Načti kalendář pro vybraný rok
  useEffect(() => {
    if (!renderUrl) return;
    setLoadingRaces(true);
    setRaces([]);
    setSelectedRound('');
    fetch(`${renderUrl}/schedule?year=${year}`)
      .then(r => r.json())
      .then(data => {
        setRaces(data.races || []);
        if (data.races && data.races.length > 0) {
          setSelectedRound(data.races[data.races.length - 1].name);
        }
      })
      .catch(() => setRaces([]))
      .finally(() => setLoadingRaces(false));
  }, [year, renderUrl]);

  const handleApply = async () => {
    if (!renderUrl || !selectedRound) return;
    setLoading(true);
    setStatus('Načítám a připravuji replay...');
    
    // Okamžitý reset frontendu
    useF1Store.getState().setSession(year, selectedRound);
    
    try {
      await fetch(`${renderUrl}/set-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, round: selectedRound, start_lap: startLap })
      });
      setPlaybackState('paused');
      setStatus(`✓ Replay připraven: ${year} – ${selectedRound} (Pauza)`);
    } catch {
      setStatus('⚠ Chyba při komunikaci s backendem');
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(''), 6000);
    }
  };

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
      ...styles.wrapper,
      padding: '12px 16px',
      borderRadius: '24px',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      gap: '16px'
    }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {/* Rok */}
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          style={styles.select}
        >
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {/* Závod */}
        <select
          value={selectedRound}
          onChange={e => setSelectedRound(e.target.value)}
          style={styles.select}
          disabled={loadingRaces || races.length === 0}
        >
          {loadingRaces
            ? <option>Načítám...</option>
            : races.length === 0
            ? <option>Žádné závody</option>
            : races.map(r => <option key={r.round} value={r.name}>{r.name}</option>)
          }
        </select>
      </div>

      <div style={{ width: '1px', height: '24px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>

      {/* Od kola */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label style={{ color: 'var(--color-text-dim)', fontSize: '0.8rem', fontWeight: 600 }}>KOLO</label>
        <input
          type="number"
          min="1"
          value={startLap}
          onChange={e => setStartLap(Number(e.target.value))}
          style={{ ...styles.select, width: '60px', textAlign: 'center' }}
        />
      </div>

      {/* Tlačítko Načíst */}
      <button
        onClick={handleApply}
        disabled={loading || !selectedRound}
        style={{
          ...styles.button,
          background: 'rgba(255, 255, 255, 0.1)',
          color: 'var(--color-text)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          opacity: (loading || !selectedRound) ? 0.5 : 1
        }}
      >
        {loading ? '⏳' : 'NAČÍST'}
      </button>

      {/* Ovládání přehrávání */}
      <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
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

      {/* Status */}
      {status && <span style={styles.status}>{status}</span>}
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  select: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'var(--color-text)',
    padding: '8px 12px',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    outline: 'none',
    transition: 'all 0.2s',
    backdropFilter: 'blur(10px)',
  },
  button: {
    borderRadius: '16px', // More pill-like
    padding: '8px 16px',
    fontWeight: '600',
    fontSize: '0.85rem',
    cursor: 'pointer',
    letterSpacing: '0.5px',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  status: {
    color: 'var(--color-text-dim)',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-mono)',
    position: 'absolute',
    bottom: '-24px',
    right: '16px'
  }
};

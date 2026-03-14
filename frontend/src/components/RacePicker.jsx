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
    <div style={styles.wrapper}>
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

      {/* Od kola */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <label style={{ color: '#e2e8f0', fontSize: '12px' }}>Kolo:</label>
        <input
          type="number"
          min="1"
          value={startLap}
          onChange={e => setStartLap(Number(e.target.value))}
          style={{ ...styles.select, width: '60px' }}
        />
      </div>

      {/* Tlačítko Načíst */}
      <button
        onClick={handleApply}
        disabled={loading || !selectedRound}
        style={{
          ...styles.button,
          opacity: (loading || !selectedRound) ? 0.5 : 1
        }}
      >
        {loading ? '⏳' : '📥 NAČÍST'}
      </button>

      {/* Ovládání přehrávání */}
      <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
        <button
          onClick={() => handlePlayback('play')}
          disabled={playbackState === 'play'}
          style={{
            ...styles.button,
            background: playbackState === 'play' ? '#22c55e' : 'linear-gradient(135deg, #22c55e, #16a34a)',
            opacity: playbackState === 'play' ? 0.3 : 1
          }}
        >
          ▶ PLAY
        </button>
        <button
          onClick={() => handlePlayback('pause')}
          disabled={playbackState === 'pause'}
          style={{
            ...styles.button,
            background: playbackState === 'pause' ? '#ef4444' : 'linear-gradient(135deg, #ef4444, #dc2626)',
            opacity: playbackState === 'pause' ? 0.3 : 1
          }}
        >
          ⏸ PAUSE
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
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#e2e8f0',
    padding: '6px 10px',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
  },
  button: {
    background: 'linear-gradient(135deg, #00d4ff, #0080ff)',
    border: 'none',
    borderRadius: '6px',
    color: '#000',
    padding: '6px 16px',
    fontWeight: '700',
    fontSize: '12px',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    transition: 'opacity 0.2s',
  },
  status: {
    color: '#22d3ee',
    fontSize: '12px',
    fontFamily: 'monospace',
  }
};

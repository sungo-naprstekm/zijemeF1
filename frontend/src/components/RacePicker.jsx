import React, { useState, useEffect } from 'react';

const YEARS = [2026, 2025, 2024, 2023, 2022, 2021];

export function RacePicker() {
  const [year, setYear] = useState(2023);
  const [races, setRaces] = useState([]);
  const [selectedRound, setSelectedRound] = useState('');
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
    setStatus('Spouštím nový replay...');
    try {
      await fetch(`${renderUrl}/set-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, round: selectedRound })
      });
      setStatus(`✓ Replay: ${year} – ${selectedRound}`);
    } catch {
      setStatus('⚠ Chyba při komunikaci s backendem');
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(''), 6000);
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

      {/* Tlačítko */}
      <button
        onClick={handleApply}
        disabled={loading || !selectedRound}
        style={{
          ...styles.button,
          opacity: (loading || !selectedRound) ? 0.5 : 1
        }}
      >
        {loading ? '⏳' : '▶ SPUSTIT'}
      </button>

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

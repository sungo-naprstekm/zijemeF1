import React, { useState, useEffect } from 'react';
import { useF1Store } from '../store/useF1Store';

const YEARS = [2026, 2025, 2024, 2023, 2022, 2021];

export function StartupModal({ onStartSimulation, onShowStats }) {
  const [year, setYear] = useState(Number(localStorage.getItem('f1_year')) || 2023);
  const [races, setRaces] = useState([]);
  const [selectedRound, setSelectedRound] = useState(localStorage.getItem('f1_round') || '');
  const [startLap, setStartLap] = useState(Number(localStorage.getItem('f1_lap')) || 1);
  const [loadingRaces, setLoadingRaces] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [liveSession, setLiveSession] = useState(null);

  const renderUrl = import.meta.env.VITE_RENDER_URL;

  useEffect(() => {
    if (!renderUrl) return;
    const checkLiveStatus = async () => {
      try {
        const response = await fetch(`${renderUrl}/status/live`);
        const data = await response.json();
        if (data.is_live_active) {
          setLiveSession(data.session_info);
        }
      } catch (err) {
        console.error("Live status check failed", err);
      }
    };
    checkLiveStatus();
  }, [renderUrl]);

  useEffect(() => {
    if (!renderUrl) return;
    setLoadingRaces(true);
    
    // We fetch the races when the year changes. We also update the race list.
    fetch(`${renderUrl}/schedule?year=${year}`)
      .then(r => r.json())
      .then(data => {
        setRaces(data.races || []);
        if (data.races && data.races.length > 0) {
          // If the previously selected round is not in this year, default to the latest race
          const exists = data.races.find(r => r.name === selectedRound);
          if (!exists) {
              setSelectedRound(data.races[data.races.length - 1].name);
          }
        } else {
          setSelectedRound('');
        }
      })
      .catch(() => setRaces([]))
      .finally(() => setLoadingRaces(false));
  }, [year, renderUrl]);

  const saveToStorage = () => {
    localStorage.setItem('f1_year', year);
    localStorage.setItem('f1_round', selectedRound);
    localStorage.setItem('f1_lap', startLap);
  };

  const handleStartSimulation = async () => {
    if (!renderUrl || !selectedRound) return;
    setLoading(true);
    setStatus('Nahrávám konfiguraci do backendu...');
    saveToStorage();

    useF1Store.getState().setSession(year, selectedRound);

    try {
      await fetch(`${renderUrl}/set-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, round: selectedRound, start_lap: startLap })
      });
      // The worker pauses the playback automatically inside set-session until play is pressed on dashboard
      useF1Store.getState().setLiveMode?.(false);
      onStartSimulation();
    } catch {
      setStatus('⚠ Chyba při komunikaci s backendem. Nelze spustit simulaci.');
      setLoading(false);
    }
  };

  const handleStartLive = async () => {
    if (!liveSession || !renderUrl) return;
    setLoading(true);
    setStatus('Připojuji se na F1 Live Stream...');
    saveToStorage();

    try {
      await fetch(`${renderUrl}/start-live`, { method: 'POST' });
      const store = useF1Store.getState();
      if (store.setLiveMode) store.setLiveMode(true);
      store.setSession(liveSession.year, liveSession.event_name);
      onStartSimulation();
    } catch {
      setStatus('⚠ Chyba při spuštění Live pipeline.');
      setLoading(false);
    }
  };

  const handleShowStats = () => {
    saveToStorage();
    onShowStats();
  };

  return (
    <div style={styles.overlay}>
      <div className="glass-panel" style={styles.modal}>
        <div style={styles.headerBox}>
           <h2 style={styles.title}>
             🏎 F1 LIVE PULSE <span style={styles.proBadge}>PRO</span>
           </h2>
        </div>
        
        <p style={styles.description}>
          Vítejte v analytickém a simulačním modulu pro Formuli 1. 
          Zvolte ročník a samotný závod (trénink/kvalifikaci nezobrazujeme) pro získání historického datasetu trati.
        </p>

        <div style={styles.formGroup}>
          <label style={styles.label}>ROČNÍK</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={styles.select}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>ZÁVODNÍ VÍKEND (LOKACE)</label>
          <select value={selectedRound} onChange={e => setSelectedRound(e.target.value)} style={styles.select} disabled={loadingRaces || races.length === 0}>
            {loadingRaces ? <option>Načítám závody přes FastF1 API...</option> : races.length === 0 ? <option>Žádné závody v tomto roce</option> : races.map(r => <option key={r.round} value={r.name}>{r.name}</option>)}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>VŠECHNA DATA OD KOLA (START: 1)</label>
          <input type="number" min="1" value={startLap} onChange={e => setStartLap(Number(e.target.value))} style={styles.input} />
        </div>

        <div style={styles.buttonGroup}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {liveSession ? (
              <button 
                onClick={handleStartLive}
                style={{...styles.button, backgroundColor: '#dc2626', color: 'white', border: '2px solid #ef4444', animation: 'pulse 2s infinite', fontWeight: 'bold'}}
              >
                🔴 SLEDOVAT LIVE: {liveSession.event_name} ({liveSession.session_type})
              </button>
            ) : (
              <button disabled style={{...styles.button, backgroundColor: '#1f2937', color: '#6b7280', cursor: 'not-allowed'}}>
                Live session není momentálně k dispozici
              </button>
            )}
          </div>

          <button onClick={handleStartSimulation} disabled={loading || !selectedRound || loadingRaces} style={{...styles.button, ...styles.btnPrimary}}>
            {loading ? '⏳ Načítám Cloud Backend...' : '🏁 SLEDOVAT ZE ZÁZNAMU (HISTORIE)'}
          </button>
          
          <button onClick={handleShowStats} disabled={loading || !selectedRound || loadingRaces} style={{...styles.button, ...styles.btnSecondary}}>
            📊 ZOBRAZIT HISTORICKÉ STATISTIKY
          </button>
        </div>

        {status && <div style={styles.status}>{status}</div>}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(5, 7, 10, 0.90)',
    backdropFilter: 'blur(20px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, fontFamily: 'var(--font-sans)', color: 'white'
  },
  modal: {
    width: '460px',
    backgroundColor: 'rgba(20, 25, 40, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '24px', padding: '40px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255,255,255,0.05) inset'
  },
  headerBox: {
    borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '16px', marginBottom: '24px'
  },
  title: { margin: 0, fontSize: '26px', fontStyle: 'italic', letterSpacing: '-0.05em', color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.5)' },
  proBadge: { fontSize: '11px', fontWeight: 'bold', color: '#ff2a2a', backgroundColor: 'rgba(255, 42, 42, 0.15)', padding: '2px 6px', borderRadius: '4px', verticalAlign: 'middle', marginLeft: '6px' },
  description: { color: 'rgba(255,255,255,0.6)', fontSize: '13px', marginBottom: '32px', lineHeight: 1.6 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' },
  label: { fontSize: '11px', fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' },
  select: {
    padding: '12px 16px', borderRadius: '12px',
    backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
    color: 'white', fontSize: '15px', outline: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, transition: 'all 0.2s', appearance: 'none'
  },
  input: {
    padding: '12px 16px', borderRadius: '12px',
    backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)',
    color: 'white', fontSize: '15px', outline: 'none', fontFamily: 'inherit', fontWeight: 500, transition: 'all 0.2s', textAlign: 'center'
  },
  buttonGroup: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '36px' },
  button: {
    padding: '16px', borderRadius: '14px', border: 'none', fontSize: '13px', letterSpacing: '0.05em',
    fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  btnPrimary: { backgroundColor: '#dc2626', color: 'white', boxShadow: '0 4px 15px rgba(220, 38, 38, 0.3)', textShadow: '0 1px 2px rgba(0,0,0,0.3)' },
  btnSecondary: { backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.15)' },
  status: { marginTop: '20px', fontSize: '12px', color: '#fbbf24', textAlign: 'center', fontWeight: 'bold' }
};

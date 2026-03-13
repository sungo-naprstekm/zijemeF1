import React, { useEffect } from 'react';
import { useF1Store } from './store/useF1Store';
import { SessionStatus } from './components/SessionStatus';
import { Leaderboard } from './components/Leaderboard';
import { TelemetryDashboard } from './components/TelemetryDashboard';
import { RacePicker } from './components/RacePicker';
import TrackMap from './components/TrackMap';

function App() {
  const initSupabase = useF1Store((state) => state.initSupabase);
  const isLoading = useF1Store((state) => state.isLoading);

  useEffect(() => {
    // Navážeme WebSocket spojení se Supabase při prvním načtení aplikace
    const cleanup = initSupabase();

    // Automatické probuzení Render backendu (cesta 1 - Free Tier)
    const renderUrl = import.meta.env.VITE_RENDER_URL;
    if (renderUrl) {
      console.log('Budím Render backend...');
      fetch(renderUrl).catch(() => {
        // Ignorujeme chybu (CORS atd.), hlavně že požadavek odešel a Render se probudí
      });
    }

    return () => {
      cleanup.then(unsub => unsub && unsub());
    };
  }, [initSupabase]);

  return (
    <div style={styles.appContainer}>
      {/* Loading overlay při přepnutí závodu */}
      {isLoading && (
        <div style={styles.loadingOverlay}>
          <span style={styles.loadingText}>⏳ Načítám nová data závodu...</span>
        </div>
      )}

      {/* Horní lišta */}
      <nav style={styles.topNav}>
        <SessionStatus />
        <RacePicker />
      </nav>

      {/* Hlavní rozložení */}
      <main style={styles.mainGrid}>
        <aside style={styles.leftColumn}>
          <TrackMap />
          <Leaderboard />
        </aside>
        <section style={styles.centerArea}>
          <TelemetryDashboard driverNumber={"1"} name="VER" teamColor="#3671C6" />
          <TelemetryDashboard driverNumber={"16"} name="LEC" teamColor="#E80020" />
        </section>
      </main>
    </div>
  )
}

const styles = {
  appContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    padding: '24px',
    gap: '24px',
    boxSizing: 'border-box',
    backgroundImage: 'radial-gradient(circle at top right, #0f172a, #000000 70%)'
  },
  topNav: {
    height: 'auto',
    minHeight: '80px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  mainGrid: {
    display: 'flex',
    flex: 1,
    gap: '24px',
    overflow: 'hidden',
  },
  leftColumn: {
    width: '350px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  centerArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    overflowY: 'auto',
    paddingRight: '8px'
  },
  loadingOverlay: {
    position: 'fixed',
    top: '16px',
    right: '16px',
    background: 'rgba(0, 212, 255, 0.15)',
    border: '1px solid #00d4ff',
    borderRadius: '8px',
    padding: '10px 18px',
    zIndex: 1000,
  },
  loadingText: {
    color: '#00d4ff',
    fontFamily: 'monospace',
    fontSize: '13px',
  }
}

export default App;

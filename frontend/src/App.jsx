import React, { useEffect } from 'react';
import { useF1Store } from './store/useF1Store';
import { SessionStatus } from './components/SessionStatus';
import { Leaderboard } from './components/Leaderboard';
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

      <div style={styles.mapLayer}>
        <TrackMap />
      </div>

      <div style={styles.uiLayer}>
        <div style={styles.topNavContainer}>
          <SessionStatus />
          <RacePicker />
        </div>

        <div style={styles.leaderboardContainer}>
          <Leaderboard />
        </div>
      </div>
    </div>
  )
}

const styles = {
  appContainer: {
    position: 'relative',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: 'var(--color-bg)',
    fontFamily: 'var(--font-sans)',
  },
  mapLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  uiLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    pointerEvents: 'none', // Let clicks pass through to map where there's no UI
  },
  topNavContainer: {
    position: 'absolute',
    top: '32px',
    left: '32px',
    right: '32px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    pointerEvents: 'auto',
  },
  leaderboardContainer: {
    position: 'absolute',
    top: '110px', // Below topNav
    left: '32px',
    bottom: '32px',
    width: '360px',
    display: 'flex',
    flexDirection: 'column',
    pointerEvents: 'auto',
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

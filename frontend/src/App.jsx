import React, { useEffect } from 'react';
import { useF1Store } from './store/useF1Store';
import { SessionStatus } from './components/SessionStatus';
import { Leaderboard } from './components/Leaderboard';
import { RacePicker } from './components/RacePicker';
import TrackMap from './components/TrackMap';
import { LiveDirectStream } from './components/LiveDirectStream';
import LiveVisualizer from './components/LiveVisualizer';

function App() {
  const isLiveDebug = window.location.pathname === '/live-debug';

  const initSupabase = useF1Store((state) => state.initSupabase);
  const isLoading = useF1Store((state) => state.isLoading);
  const [debugView, setDebugView] = React.useState('visual'); // 'visual' nebo 'raw'

  useEffect(() => {
    if (isLiveDebug) return;

    // Navážeme WebSocket spojení se Supabase při prvním načtení aplikace
    const cleanup = initSupabase();

    // Automatické probuzení Render backendu (cesta 1 - Free Tier)
    const renderUrl = import.meta.env.VITE_RENDER_URL;
    if (renderUrl) {
      console.log('Synchronizuji backend...');
      fetch(renderUrl).catch(() => {
        // Ignorujeme chybu (CORS atd.), hlavně že požadavek odešel a Render se probudí
      });
      // Zajistíme, že se při startu aplikace přehrávání zastaví (čeká na akci uživatele)
      fetch(`${renderUrl}/playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' })
      }).catch(() => {});
    }

    return () => {
      cleanup.then(unsub => unsub && unsub());
    };
  }, [initSupabase, isLiveDebug]);

  if (isLiveDebug) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px', background: '#111', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'center', gap: '8px' }}>
          <button 
            onClick={() => setDebugView('visual')}
            style={{ 
              padding: '4px 12px', 
              background: debugView === 'visual' ? '#e10600' : '#333',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            VISUAL MAP
          </button>
          <button 
            onClick={() => setDebugView('raw')}
            style={{ 
              padding: '4px 12px', 
              background: debugView === 'raw' ? '#e10600' : '#333',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            RAW JSON LOG
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {debugView === 'visual' ? <LiveVisualizer /> : <LiveDirectStream />}
        </div>
      </div>
    );
  }

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

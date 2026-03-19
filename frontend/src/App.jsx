import React, { useEffect } from 'react';
import { useF1Store } from './store/useF1Store';
import { SessionStatus } from './components/SessionStatus';
import { Leaderboard } from './components/Leaderboard';
import { RacePicker } from './components/RacePicker';
import TrackMap from './components/TrackMap';
import { LiveDirectStream } from './components/LiveDirectStream';
import LiveVisualizer from './components/LiveVisualizer';
import { StartupModal } from './components/StartupModal';
import { StatisticsView } from './components/StatisticsView';

function App() {
  const isLiveDebug = window.location.pathname === '/live-debug';

  const initSupabase = useF1Store((state) => state.initSupabase);
  const isLoading = useF1Store((state) => state.isLoading);
  const [debugView, setDebugView] = React.useState('visual'); // 'visual' nebo 'raw'
  const [appMode, setAppMode] = React.useState('menu'); // 'menu', 'simulation', 'statistics'

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
    }

    return () => {
      cleanup.then(unsub => unsub && unsub());
    };
  }, [initSupabase, isLiveDebug]);

  if (isLiveDebug) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#0a0f18', fontFamily: 'var(--font-sans)', overflow: 'hidden' }}>
        <div style={{ padding: '12px', background: '#0d131f', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', gap: '12px', zIndex: 20 }}>
          <button 
            onClick={() => setDebugView('visual')}
            style={{ 
              padding: '8px 16px', 
              background: debugView === 'visual' ? '#dc2626' : 'rgba(255,255,255,0.05)',
              color: debugView === 'visual' ? 'white' : '#94a3b8',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              boxShadow: debugView === 'visual' ? '0 0 15px rgba(220, 38, 38, 0.5)' : 'none',
              transition: 'all 0.2s'
            }}
          >
            VISUAL MAP
          </button>
          <button 
            onClick={() => setDebugView('raw')}
            style={{ 
              padding: '8px 16px', 
              background: debugView === 'raw' ? '#0284c7' : 'rgba(255,255,255,0.05)',
              color: debugView === 'raw' ? 'white' : '#94a3b8',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              boxShadow: debugView === 'raw' ? '0 0 15px rgba(2, 132, 199, 0.5)' : 'none',
              transition: 'all 0.2s'
            }}
          >
            RAW JSON LOG
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {debugView === 'visual' ? <LiveVisualizer /> : <LiveDirectStream />}
        </div>
      </div>
    );
  }

  if (appMode === 'menu') {
    return (
      <StartupModal 
        onStartSimulation={() => setAppMode('simulation')} 
        onShowStats={() => setAppMode('statistics')} 
      />
    );
  }

  if (appMode === 'statistics') {
    return <StatisticsView onBack={() => setAppMode('menu')} />;
  }

  return (
    <div style={styles.appContainer}>
      {/* Loading overlay při přepnutí závodu */}
      {isLoading && (
        <div style={styles.loadingOverlay}>
          <span style={styles.loadingText}>⏳ Načítám nová data závodu...</span>
        </div>
      )}

      {/* Levý sloupec pro UI Prvky */}
      <div style={styles.leftPanel}>
        <div style={styles.topNavContainer}>
          <SessionStatus />
          <RacePicker />
        </div>

        <div style={styles.leaderboardContainer}>
          <Leaderboard />
        </div>
      </div>

      {/* Pravý flexibilní sloupec pro mapu */}
      <div style={styles.mapLayer}>
        <TrackMap />
      </div>
    </div>
  )
}

const styles = {
  appContainer: {
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: 'var(--color-bg)',
    fontFamily: 'var(--font-sans)',
    display: 'flex',
    padding: '24px',
    gap: '24px',
    boxSizing: 'border-box'
  },
  leftPanel: {
    width: '400px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    flexShrink: 0,
    zIndex: 10
  },
  mapLayer: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '24px',
    backgroundColor: 'rgba(15, 20, 35, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    overflow: 'hidden',
    boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5)'
  },
  topNavContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  leaderboardContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  loadingOverlay: {
    position: 'fixed',
    top: '24px',
    right: '24px',
    background: 'rgba(0, 212, 255, 0.15)',
    border: '1px solid #00d4ff',
    borderRadius: '8px',
    padding: '10px 18px',
    zIndex: 1000,
    backdropFilter: 'blur(4px)'
  },
  loadingText: {
    color: '#00d4ff',
    fontFamily: 'monospace',
    fontSize: '13px',
    fontWeight: 'bold'
  }
}

export default App;

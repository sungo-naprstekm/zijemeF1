import React, { useEffect } from 'react';
import { useF1Store } from './store/useF1Store';
import { SessionStatus } from './components/SessionStatus';
import { Leaderboard } from './components/Leaderboard';
import { TelemetryDashboard } from './components/TelemetryDashboard';

function App() {
  const initSupabase = useF1Store((state) => state.initSupabase);

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
      {/* Horní lišta pro status závodu */}
      <nav style={styles.topNav}>
        <SessionStatus />
      </nav>

      {/* Hlavní rozložení */}
      <main style={styles.mainGrid}>
        
        {/* Levý sloupec - Leaderboard */}
        <aside style={styles.leftColumn}>
          <Leaderboard />
        </aside>

        {/* Prostřední / Pravá část - Telemetrie detail vybraných jezdců */}
        <section style={styles.centerArea}>
          {/* Zde budeme sledovat např. jezdce č. 1 (Max Verstappen) a 16 (Charles Leclerc) */}
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
    height: '80px',
    flexShrink: 0,
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
  }
}

export default App;

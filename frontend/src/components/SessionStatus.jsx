import React from 'react';
import { useF1Store } from '../store/useF1Store';
import { Flag, Clock, ThermometerSun, Wind } from 'lucide-react';

export const SessionStatus = () => {
  const { flag, remaining_time, remaining_laps, track_temp, air_temp } = useF1Store((state) => state.sessionState);

  // Colors based on flag status
  const getFlagColor = (status) => {
    switch (status) {
      case 'Red': return 'var(--color-neon-red)';
      case 'Yellow': return 'var(--color-neon-yellow)';
      case 'Green': return 'var(--color-neon-green)';
      case 'VSC': return 'var(--color-neon-yellow)';
      case 'SC': return 'var(--color-neon-yellow)';
      case 'Chequered': return '#ffffff';
      default: return 'var(--color-text-dim)';
    }
  };

  return (
    <div className="glass-panel" style={{ 
      flexDirection: 'row', 
      alignItems: 'center', 
      padding: '8px 24px',
      gap: '24px',
      borderRadius: '30px', // Pill shape
      border: '1px solid rgba(255, 255, 255, 0.1)'
    }}>
      
        <div style={{ 
          color: getFlagColor(flag),
          fontWeight: 700,
          fontSize: '0.9rem',
          letterSpacing: '1px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          textTransform: 'uppercase'
        }}>
          <Flag size={16} color={getFlagColor(flag)} />
          {flag}
        </div>

      <div style={{ width: '1px', height: '24px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>

      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={styles.metric}>
          <Clock size={16} color="var(--color-text-dim)" />
          <span>{remaining_laps} LAPS</span>
        </div>
        
        <div style={styles.metric}>
          <ThermometerSun size={16} color="var(--color-text-dim)" />
          <span>TRACK: <span style={{ color: 'var(--color-text)' }}>{track_temp}°C</span></span>
        </div>

        <div style={styles.metric}>
          <Wind size={16} color="var(--color-text-dim)" />
          <span>AIR: <span style={{ color: 'var(--color-text)' }}>{air_temp}°C</span></span>
        </div>
      </div>

    </div>
  );
};

const styles = {
  metric: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--color-text-dim)',
    letterSpacing: '0.5px'
  }
};

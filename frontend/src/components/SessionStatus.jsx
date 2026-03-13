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
    <div className="glass-panel" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ 
          backgroundColor: getFlagColor(flag), 
          color: flag === 'Yellow' || flag === 'VSC' || flag === 'SC' || flag === 'Chequered' ? '#000' : '#fff',
          padding: '8px 24px', 
          borderRadius: '4px',
          fontWeight: 700,
          fontSize: '1.2rem',
          letterSpacing: '1px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          textTransform: 'uppercase'
        }}>
          <Flag size={20} />
          {flag} FLAG
        </div>
      </div>

      <div style={{ display: 'flex', gap: '32px' }}>
        <div style={styles.metric}>
          <Clock size={18} color="var(--color-text-dim)" />
          <span>{remaining_laps} LAPS REMAINING</span>
        </div>
        
        <div style={styles.metric}>
          <ThermometerSun size={18} color="var(--color-text-dim)" />
          <span>TRACK: <span className="glow-red">{track_temp}°C</span></span>
        </div>

        <div style={styles.metric}>
          <Wind size={18} color="var(--color-text-dim)" />
          <span>AIR: {air_temp}°C</span>
        </div>
      </div>

    </div>
  );
};

const styles = {
  metric: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: 'var(--font-mono)',
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--color-text)'
  }
};

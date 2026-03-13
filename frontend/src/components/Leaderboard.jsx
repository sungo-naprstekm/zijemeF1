import React from 'react';
import { useF1Store } from '../store/useF1Store';

export const Leaderboard = () => {
  const leaderboard = useF1Store((state) => state.leaderboard);

  return (
    <div className="glass-panel" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)', backgroundColor: 'rgba(0,0,0,0.4)', position: 'sticky', top: 0, zIndex: 10 }}>
        <h3 style={{ margin: 0, color: 'var(--color-text-dim)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Live Leaderboard
        </h3>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '8px' }}>
        {leaderboard.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.9rem' }}>
            Čekání na data závodu...
          </div>
        ) : (
          leaderboard.map((driver) => (
            <div key={driver.driver_number} style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '4px',
              background: 'rgba(255, 255, 255, 0.03)',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Levé barevné ohraničení týmu */}
              <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '4px',
                backgroundColor: driver.team_color
              }} />

              {/* Pozice */}
              <div className="mono-text" style={{ width: '30px', fontWeight: 700, fontSize: '1.1rem', paddingLeft: '8px' }}>
                {driver.position}
              </div>

              {/* JMÉNO */}
              <div style={{ flex: 1, fontWeight: 700, fontSize: '1.2rem', letterSpacing: '-0.5px' }}>
                {driver.broadcast_name}
              </div>

              {/* Gapy */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                <div className="mono-text" style={{ fontSize: '0.85rem', color: 'var(--color-neon-blue)' }}>
                  {driver.gap_to_leader ? `+${driver.gap_to_leader}` : ''}
                </div>
                <div className="mono-text" style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)' }}>
                  {driver.interval ? `+${driver.interval}` : ''}
                </div>
              </div>

              {/* Pneumatiky vizualizace (volitelně) - např. červená S, žlutá M, bílá H */}
              {driver.compound && (
                <div style={{
                  marginLeft: '12px',
                  width: '24px',
                  height: '24px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  color: '#000',
                  backgroundColor: driver.compound === 'S' ? 'var(--color-neon-red)' : driver.compound === 'M' ? '#ffea00' : '#fff'
                }}>
                  {driver.compound}
                </div>
              )}

            </div>
          ))
        )}
      </div>
    </div>
  );
};

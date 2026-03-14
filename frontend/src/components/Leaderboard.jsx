import React from 'react';
import { useF1Store } from '../store/useF1Store';

export const Leaderboard = () => {
  const leaderboard = useF1Store((state) => state.leaderboard);

  return (
    <div className="glass-panel" style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)', backgroundColor: 'rgba(0,0,0,0.4)', position: 'sticky', top: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: 'var(--color-text-dim)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Live Leaderboard
        </h3>
        {/* Hlavičky sloupečků telemetrie pro vizuální přehled */}
        <div style={{ display: 'flex', gap: '44px', color: 'var(--color-text-dim)', fontSize: '0.65rem', paddingRight: '115px', fontWeight: 600 }}>
             <span>LAP TIME</span>
             <span>S1</span>
             <span>S2</span>
             <span>S3</span>
        </div>
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
              padding: '8px 12px',
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

              {/* Pozice a Jméno */}
              <div style={{ display: 'flex', alignItems: 'center', width: '130px' }}>
                <div className="mono-text" style={{ width: '30px', fontWeight: 700, fontSize: '1.1rem', paddingLeft: '8px' }}>
                  {driver.position}
                </div>
                <div style={{ fontWeight: 700, fontSize: '1.2rem', letterSpacing: '-0.5px' }}>
                  {driver.broadcast_name}
                </div>
              </div>

              {/* Střední sekce - Telemetrie, Sektory a časy */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '16px', gap: '16px' }}>
                
                {/* Last Lap a PB */}
                <div style={{ display: 'flex', flexDirection: 'column', width: '75px' }}>
                  <div className="mono-text" style={{ color: driver.is_personal_best ? '#c155f0' : '#fff', fontWeight: driver.is_personal_best ? 'bold' : 'normal', fontSize: '0.90rem' }}>
                    {driver.last_lap_time || '-'}
                  </div>
                  <div className="mono-text" style={{ color: 'var(--color-text-dim)', fontSize: '0.70rem' }}>
                    {driver.fastest_lap_time ? `PB: ${driver.fastest_lap_time}` : ''}
                  </div>
                </div>

                {/* Sektory */}
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <div className="mono-text" style={{ color: 'var(--color-neon-yellow)', width: '45px', textAlign: 'right', fontSize: '0.85rem' }}>{driver.sector1 || '-'}</div>
                    <div className="mono-text" style={{ color: 'var(--color-neon-yellow)', width: '45px', textAlign: 'right', fontSize: '0.85rem' }}>{driver.sector2 || '-'}</div>
                    <div className="mono-text" style={{ color: 'var(--color-neon-yellow)', width: '45px', textAlign: 'right', fontSize: '0.85rem' }}>{driver.sector3 || '-'}</div>
                </div>

                {/* Gapy a Interval */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', width: '65px' }}>
                  <div className="mono-text" style={{ fontSize: '0.80rem', color: 'var(--color-neon-blue)' }}>
                    {driver.gap_to_leader ? `+${driver.gap_to_leader}` : ''}
                  </div>
                  <div className="mono-text" style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)' }}>
                    {driver.interval ? `+${driver.interval}` : ''}
                  </div>
                </div>

              </div>

              {/* Pneumatiky vizualizace */}
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
                  backgroundColor: driver.compound === 'S' ? 'var(--color-neon-red)' : driver.compound === 'M' ? '#ffea00' : driver.compound === 'H' ? '#fff' : 'var(--color-neon-green)'
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

import React from 'react';
import { useF1Store } from '../store/useF1Store';

export const Leaderboard = () => {
  const leaderboard = useF1Store((state) => state.leaderboard);

  return (
    <div className="glass-panel" style={{ 
      flex: 1, 
      padding: 0, 
      overflow: 'hidden', 
      display: 'flex', 
      flexDirection: 'column',
      borderRadius: '24px',
      border: '1px solid rgba(255, 255, 255, 0.08)'
    }}>
      <div style={{ 
        padding: '16px 20px', 
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
        backgroundColor: 'rgba(255, 255, 255, 0.02)', 
        position: 'sticky', 
        top: 0, 
        zIndex: 10, 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center' 
      }}>
        <h3 style={{ margin: 0, color: 'var(--color-text)', fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.5px' }}>
          Leaderboard
        </h3>
        {/* Hlavičky sloupečků telemetrie pro vizuální přehled */}
        <div style={{ display: 'grid', gridTemplateColumns: '80px 40px 40px 40px 40px', gap: '8px', color: 'var(--color-text-dim)', fontSize: '0.65rem', paddingRight: '12px', fontWeight: 600, letterSpacing: '0.5px' }}>
             <span style={{ textAlign: 'center' }}>LAP TIME</span>
             <span style={{ textAlign: 'center' }}>S1</span>
             <span style={{ textAlign: 'center' }}>S2</span>
             <span style={{ textAlign: 'center' }}>S3</span>
             <span style={{ textAlign: 'center' }}>GAP</span>
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
              padding: '10px 12px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
              background: 'transparent',
              position: 'relative',
              transition: 'background-color 0.2s',
            }}>
              {/* Levé barevné ohraničení týmu */}
              <div style={{
                position: 'absolute',
                left: 0,
                top: '10%',
                bottom: '10%',
                width: '3px',
                borderRadius: '0 4px 4px 0',
                backgroundColor: driver.team_color
              }} />

              {/* Pozice a Jméno */}
              <div style={{ display: 'flex', alignItems: 'center', width: '90px', shrink: 0 }}>
                <div className="mono-text" style={{ width: '22px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-dim)', paddingLeft: '6px' }}>
                  {driver.position}
                </div>
                <div style={{ fontWeight: 600, fontSize: '1.05rem', letterSpacing: '-0.3px', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '55px' }}>
                  {driver.broadcast_name}
                </div>
              </div>

              {/* Střední sekce - Telemetrie, Sektory a časy - grid struktura */}
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(60px, 1fr) 40px 40px 40px', gap: '8px', alignItems: 'center' }}>
                
                {/* Last Lap a PB */}
                <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'center' }}>
                  <div className="mono-text" style={{ color: driver.is_personal_best ? 'var(--color-neon-purple)' : 'var(--color-text)', fontWeight: driver.is_personal_best ? '600' : '500', fontSize: '0.85rem' }}>
                    {driver.last_lap_time || '-'}
                  </div>
                  <div className="mono-text" style={{ color: 'var(--color-text-dim)', fontSize: '0.65rem' }}>
                    {driver.fastest_lap_time ? `PB: ${driver.fastest_lap_time}` : ''}
                  </div>
                </div>

                {/* Sektory */}
                <div className="mono-text" style={{ color: 'var(--color-neon-yellow)', textAlign: 'right', fontSize: '0.8rem' }}>{driver.sector1 || '-'}</div>
                <div className="mono-text" style={{ color: 'var(--color-neon-yellow)', textAlign: 'right', fontSize: '0.8rem' }}>{driver.sector2 || '-'}</div>
                <div className="mono-text" style={{ color: 'var(--color-neon-yellow)', textAlign: 'right', fontSize: '0.8rem' }}>{driver.sector3 || '-'}</div>

              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', width: '50px', marginLeft: 'auto' }}>
                  <div className="mono-text" style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)', fontWeight: 600 }}>
                    {driver.gap_to_leader ? `+${driver.gap_to_leader}` : ''}
                  </div>
                  <div className="mono-text" style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)' }}>
                    {driver.interval ? `+${driver.interval}` : ''}
                  </div>
              </div>

              {/* Pneumatiky vizualizace */}
              {driver.compound && (
                <div style={{
                  marginLeft: '8px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  fontFamily: 'var(--font-mono)',
                  color: '#000',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                  backgroundColor: driver.compound === 'S' ? 'var(--color-neon-red)' : driver.compound === 'M' ? 'var(--color-neon-yellow)' : driver.compound === 'H' ? '#fff' : 'var(--color-neon-green)'
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

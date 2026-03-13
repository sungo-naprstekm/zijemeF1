import React, { useMemo } from 'react';
import { useF1Store } from '../store/useF1Store';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';

// Udržujeme historii posledních 30 bodů (cca 30s) pro sparkline graf
const historyCache = {};

export const TelemetryDashboard = ({ driverNumber, name, teamColor }) => {
  const telemetryObj = useF1Store((state) => state.telemetry);
  const t = telemetryObj[driverNumber];

  // Přidáme příchozí bod do historie pro sparkline
  const dataHistory = useMemo(() => {
    if (!historyCache[driverNumber]) {
      historyCache[driverNumber] = [];
    }
    
    if (t) {
      const newPoint = { 
        time: t.session_time, 
        speed: t.speed,
        rpm: t.rpm 
      };
      // Přidáme jen pokud se čas posunul (zabrání duplicitám při stejném payloadu)
      const last = historyCache[driverNumber][historyCache[driverNumber].length - 1];
      if (!last || last.time !== newPoint.time) {
        historyCache[driverNumber].push(newPoint);
      }
      
      // Keep jen posledních 60 záznamů
      if (historyCache[driverNumber].length > 60) {
        historyCache[driverNumber].shift();
      }
    }
    return [...(historyCache[driverNumber] || [])];
  }, [t, driverNumber]);

  if (!t) {
    return (
      <div className="glass-panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--color-text-dim)' }}>Čekání na telemetrii pro {name}...</p>
      </div>
    );
  }

  // Barvy pedálů
  const throttleColor = 'var(--color-neon-green)';
  const brakeColor = 'var(--color-neon-red)';
  const speedColor = 'var(--color-neon-blue)';

  return (
    <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', position: 'relative', overflow: 'hidden' }}>
      
      {/* Hlavička s jezdcem a rychlostí */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '6px',
            height: '40px',
            backgroundColor: teamColor,
            borderRadius: '3px'
          }} />
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0, lineHeight: 1 }}>{name}</h2>
          <span style={{ fontSize: '1.2rem', color: 'var(--color-text-dim)', alignSelf: 'flex-end', paddingBottom: '4px' }}>TELEMETRY</span>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div className="mono-text" style={{ fontSize: '4rem', fontWeight: 800, lineHeight: 1, color: speedColor, textShadow: `0 0 20px rgba(0, 243, 255, 0.4)` }}>
            {t.speed}
          </div>
          <div style={{ fontSize: '1.2rem', color: 'var(--color-text-dim)', letterSpacing: '2px' }}>KM/H</div>
        </div>
      </div>

      {/* Sparkline graf rychlosti (pokud máme delší historii) */}
      <div style={{ height: '80px', marginTop: '16px', opacity: 0.8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dataHistory} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`colorSpeed${driverNumber}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={speedColor} stopOpacity={0.8}/>
                <stop offset="95%" stopColor={speedColor} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <YAxis domain={['auto', 'auto']} hide />
            <Area 
              type="monotone" 
              dataKey="speed" 
              stroke={speedColor} 
              strokeWidth={3}
              fillOpacity={1} 
              fill={`url(#colorSpeed${driverNumber})`} 
              isAnimationActive={false} // Vypneme kvůli 60 FPS re-renderům
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Spodní metrika: Otáčky, Gear a Pedály */}
      <div style={{ display: 'flex', gap: '32px', marginTop: 'auto', paddingTop: '24px' }}>
        
        {/* RPM Rev Bar */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: 'var(--color-text-dim)', letterSpacing: '1px' }}>RPM</span>
            <span className="mono-text" style={{ fontWeight: 700 }}>{t.rpm}</span>
          </div>
          <div style={{ height: '12px', background: 'rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden' }}>
            <div style={{ 
              height: '100%', 
              width: `${Math.min(100, (t.rpm / 12000) * 100)}%`, 
              background: t.rpm > 10500 ? 'var(--color-neon-purple)' : 'var(--color-neon-blue)',
              transition: 'width 0.1s linear, background-color 0.2s',
              boxShadow: t.rpm > 10500 ? '0 0 10px var(--color-neon-purple)' : 'none'
            }} />
          </div>
        </div>

        {/* GEAR */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', minWidth: '80px' }}>
          <span style={{ color: 'var(--color-text-dim)', letterSpacing: '1px' }}>GEAR</span>
          <div className="mono-text" style={{ 
            fontSize: '3rem', 
            fontWeight: 800, 
            lineHeight: 1,
            color: t.gear === 0 ? 'var(--color-neon-yellow)' : '#fff',
            textShadow: t.gear === 0 ? '0 0 10px rgba(255, 251, 0, 0.5)' : 'none'
          }}>
            {t.gear === 0 ? 'N' : t.gear}
          </div>
        </div>

        {/* PEDÁLY THROTTLE A BRAKE */}
        <div style={{ display: 'flex', gap: '16px', height: '100px' }}>
          {/* Plyn */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ 
              width: '24px', 
              flex: 1, 
              background: 'rgba(255,255,255,0.05)', 
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'flex-end',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: '100%', 
                height: `${t.throttle}%`, 
                backgroundColor: throttleColor,
                transition: 'height 0.1s linear',
                boxShadow: t.throttle > 90 ? '0 0 15px var(--color-neon-green)' : 'none'
              }} />
            </div>
            <span style={{ fontSize: '0.7rem', color: throttleColor, letterSpacing: '1px' }}>THR</span>
          </div>

          {/* Brzda */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ 
              width: '24px', 
              flex: 1, 
              background: 'rgba(255,255,255,0.05)', 
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'flex-end',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: '100%', 
                height: `${t.brake}%`, 
                backgroundColor: brakeColor,
                transition: 'height 0.1s linear',
                boxShadow: t.brake > 50 ? '0 0 15px var(--color-neon-red)' : 'none'
              }} />
            </div>
            <span style={{ fontSize: '0.7rem', color: brakeColor, letterSpacing: '1px' }}>BRK</span>
          </div>
        </div>

      </div>

    </div>
  );
};

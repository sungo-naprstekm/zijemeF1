import React, { useState, useEffect, useRef } from 'react';
import { Map, List, Activity, Wifi, WifiOff, Users } from 'lucide-react';

const LiveVisualizer = () => {
  const [drivers, setDrivers] = useState({});
  const [sessionInfo, setSessionInfo] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [rcmMessages, setRcmMessages] = useState([]);
  const [audioStreams, setAudioStreams] = useState([]);
  const wsRef = useRef(null);
  const rcmRef = useRef(null);

  useEffect(() => {
    const wsUrl = import.meta.env.VITE_LIVE_WS_URL || 'ws://localhost:8081';
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => setStatus('connected');
    wsRef.current.onclose = () => setStatus('disconnected');
    
    wsRef.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { category, data } = msg;

        if (category === 'Position.z' || category === 'Position') {
          processPositions(data);
        } else if (category === 'TimingData') {
          processTiming(data);
        } else if (category === 'DriverList') {
          processDriverList(data);
        } else if (category === 'SessionInfo') {
          setSessionInfo(data);
        } else if (category === 'RaceControlMessages') {
          processRCM(data);
        } else if (category === 'AudioStreams') {
          setAudioStreams(prev => {
              const items = data?.Items || (Array.isArray(data) ? data : []);
              const next = [...items, ...prev].slice(0, 10);
              return next;
          });
        }
        
        setLastUpdate(new Date());
      } catch (e) {
        console.error('Error parsing live data:', e);
      }
    };

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const processPositions = (data) => {
    const posArray = data?.Position || (Array.isArray(data) ? data : null);
    if (!posArray) return;
    
    setDrivers(prev => {
      const next = { ...prev };
      posArray.forEach(entry => {
        if (!entry.Entries) return;
        
        entry.Entries.forEach(subEntry => {
          if (!subEntry.Cars) return;
          
          // Cars může být objekt { "44": {...} } nebo pole [{DriverNumber: 44, ...}]
          const cars = subEntry.Cars;
          
          Object.keys(cars).forEach(key => {
            const carData = cars[key];
            const driverNum = carData.DriverNumber || key; // Klíč je často číslo jezdce
            const pos = carData.Channels;
            
            if (!pos) return;
            if (!next[driverNum]) next[driverNum] = { number: driverNum };
            
            // Kanály: 0 = X, 1 = Y, 2 = Z (vše v mm)
            if (pos['0'] !== undefined) next[driverNum].x = pos['0'];
            if (pos['1'] !== undefined) next[driverNum].y = pos['1'];
            if (pos['2'] !== undefined) next[driverNum].z = pos['2'];
          });
        });
      });
      return next;
    });
  };

  const processTiming = (data) => {
    if (!data?.Lines) return;
    
    setDrivers(prev => {
      const next = { ...prev };
      Object.keys(data.Lines).forEach(num => {
        const line = data.Lines[num];
        if (!next[num]) next[num] = { number: num };
        
        if (line.Sectors) {
          next[num].sectors = { ...next[num].sectors, ...line.Sectors };
        }
        if (line.LastLapTime) next[num].lastLap = line.LastLapTime.Value;
        if (line.GapToLeader) next[num].gap = line.GapToLeader;
        if (line.IntervalToPositionAhead) next[num].interval = line.IntervalToPositionAhead;
      });
      return next;
    });
  };

  const processDriverList = (data) => {
    setDrivers(prev => {
      const next = { ...prev };
      Object.keys(data).forEach(num => {
        if (!next[num]) next[num] = { number: num };
        next[num].name = data[num].Abbreviation;
        next[num].team = data[num].TeamName;
        next[num].color = `#${data[num].TeamColor}`;
      });
      return next;
    });
  };

  const processRCM = (data) => {
    if (!data?.Messages) return;
    setRcmMessages(prev => {
        const newMsgs = [...prev];
        data.Messages.forEach(m => {
            if (!newMsgs.find(existing => existing.Utc === m.Utc && existing.Message === m.Message)) {
                newMsgs.push(m);
            }
        });
        return newMsgs.sort((a, b) => new Date(b.Utc) - new Date(a.Utc)).slice(0, 50);
    });
  };

  useEffect(() => {
    if (rcmRef.current) {
        rcmRef.current.scrollTop = 0;
    }
  }, [rcmMessages]);

  // Výpočet bounding boxu pro mapu
  const getBounds = () => {
    const vals = Object.values(drivers).filter(d => d.x !== undefined);
    if (vals.length === 0) return { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 };
    
    return vals.reduce((acc, d) => ({
      minX: Math.min(acc.minX, d.x),
      maxX: Math.max(acc.maxX, d.x),
      minY: Math.min(acc.minY, d.y),
      maxY: Math.max(acc.maxY, d.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  };

  const bounds = getBounds();
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const padding = Math.max(width, height) * 0.1;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white p-4 font-mono">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-3">
          <Activity className="text-red-500 animate-pulse" />
          <h1 className="text-xl font-bold uppercase tracking-tighter">
            {sessionInfo?.Name || 'F1 LIVE VISUALIZER'}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className={`flex items-center gap-1 ${status === 'connected' ? 'text-emerald-400' : 'text-red-400'}`}>
            {status === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
            {status.toUpperCase()}
          </div>
          <div className="text-slate-500">
            DRIVERS ON MAP: {Object.values(drivers).filter(d => d.x !== undefined).length}
          </div>
          <div className="text-slate-500">
            LAST: {lastUpdate ? lastUpdate.toLocaleTimeString() : '--:--:--'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
        {/* Map View */}
        <div className="lg:col-span-2 bg-slate-900/50 rounded-xl border border-slate-800 relative overflow-hidden flex items-center justify-center p-8">
          <div className="absolute top-4 left-4 flex items-center gap-2 text-slate-500 text-xs uppercase">
            <Map size={14} /> Track Map (Live Point Cloud)
          </div>
          
          {Object.values(drivers).filter(d => d.x !== undefined).length === 0 ? (
            <div className="text-slate-600 text-center">
              <div className="text-4xl mb-2">📡</div>
              <p className="text-sm">Čekám na data o pozicích...</p>
              <p className="text-[10px] mt-1 text-slate-700">(Časy v tabulce by se však měly sypat)</p>
            </div>
          ) : (
            <svg 
              viewBox={`${bounds.minX - padding} ${bounds.minY - padding} ${width + padding*2} ${height + padding*2}`}
              className="w-full h-full max-h-[60vh] drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]"
            >
              {Object.values(drivers).map(driver => (
                driver.x !== undefined && (
                  <g key={driver.number}>
                    <circle
                      cx={driver.x}
                      cy={driver.y}
                      r={Math.max(width, height) * 0.008} 
                      fill={driver.color || '#fff'}
                      className="transition-all duration-300 ease-out"
                    />
                    <text
                      x={driver.x}
                      y={driver.y - Math.max(width, height) * 0.012}
                      textAnchor="middle"
                      fill="white"
                      fontSize={Math.max(width, height) * 0.015}
                      fontWeight="bold"
                      className="pointer-events-none select-none drop-shadow-md"
                    >
                      {driver.name || driver.number}
                    </text>
                  </g>
                )
              ))}
            </svg>
          )}
        </div>

        {/* Timing Table */}
        <div className="bg-slate-900/40 backdrop-blur-md rounded-xl border border-white/5 flex flex-col overflow-hidden shadow-2xl">
          <div className="p-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-400 text-[10px] uppercase font-bold tracking-widest">
              <List size={14} className="text-red-500" /> Live Timing Tower
            </div>
            <div className="text-[10px] text-slate-500 font-bold uppercase">
              Gap to Leader
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-slate-950/80 backdrop-blur-sm text-[10px] text-slate-500 uppercase font-black tracking-tighter">
                <tr>
                  <th className="p-3 w-10 text-center">POS</th>
                  <th className="p-3">DRIVER</th>
                  <th className="p-3 text-center">S1</th>
                  <th className="p-3 text-center">S2</th>
                  <th className="p-3 text-center">S3</th>
                  <th className="p-3 text-right">GAP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {Object.values(drivers)
                  .sort((a, b) => (a.gap || '99:99').localeCompare(b.gap || '99:99'))
                  .map((driver, idx) => (
                  <tr key={driver.number} className="group hover:bg-white/[0.03] transition-colors border-l-4" style={{ borderLeftColor: driver.color || '#333' }}>
                    <td className="p-3 text-center font-black text-slate-500 group-hover:text-white transition-colors">
                      {idx + 1}
                    </td>
                    <td className="p-3">
                       <div className="flex items-center gap-2">
                         <span className="font-black text-sm tracking-tighter">{driver.name || driver.number}</span>
                         <span className="text-[9px] px-1 bg-white/10 rounded-sm text-slate-400 font-bold">{driver.number}</span>
                       </div>
                       <div className="text-[9px] text-slate-600 font-bold uppercase leading-none mt-0.5">{driver.team || '---'}</div>
                    </td>
                    <td className="p-3 text-center font-mono text-[11px]">
                      <span className={driver.sectors?.['0']?.PersonalFastest ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                        {driver.sectors?.['0']?.Value || '--.--'}
                      </span>
                    </td>
                    <td className="p-3 text-center font-mono text-[11px]">
                      <span className={driver.sectors?.['1']?.PersonalFastest ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                        {driver.sectors?.['1']?.Value || '--.--'}
                      </span>
                    </td>
                    <td className="p-3 text-center font-mono text-[11px]">
                      <span className={driver.sectors?.['2']?.PersonalFastest ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                        {driver.sectors?.['2']?.Value || '--.--'}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono text-[11px] text-red-500 font-black">
                      {driver.gap || '---'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {Object.values(drivers).length === 0 && (
              <div className="p-20 text-center text-slate-700 italic text-xs">
                No timing data yet...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Panel: Race Control & Audio */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 h-32">
          {/* Race Control Logs */}
          <div className="bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
              <div className="p-2 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                  <div className="flex items-center gap-2 text-amber-500 text-[10px] uppercase font-bold">
                      <Activity size={12} /> Race Control Messages
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar" ref={rcmRef}>
                  {rcmMessages.length === 0 ? (
                      <div className="text-slate-700 text-[10px] italic text-center py-4">Žádné zprávy od ředitelství...</div>
                  ) : (
                      rcmMessages.map((m, i) => (
                        <div key={i} className="text-[10px] flex gap-2 border-b border-slate-800/30 pb-1 last:border-0">
                            <span className="text-slate-500 shrink-0">{new Date(m.Utc).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            <span className={m.Category === 'Flag' ? 'text-yellow-400' : 'text-slate-300'}>{m.Message}</span>
                        </div>
                      ))
                  )}
              </div>
          </div>

          {/* Audio Streams / Team Radio Notifications */}
          <div className="bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
              <div className="p-2 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                  <div className="flex items-center gap-2 text-sky-400 text-[10px] uppercase font-bold">
                    <Activity size={12} className="rotate-90" /> Team Radio (Last 10)
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                  {audioStreams.length === 0 ? (
                      <div className="text-slate-700 text-[10px] italic text-center py-4">Ticho v éteru...</div>
                  ) : (
                      <div className="grid grid-cols-2 gap-1">
                          {audioStreams.map((audio, i) => (
                              <div key={i} className="bg-slate-800/50 p-1.5 rounded flex items-center gap-2 border border-slate-700/50">
                                  <div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                                  <div className="flex flex-col">
                                      <span className="text-[10px] font-bold text-white leading-none">Driver #{audio.DriverNumber}</span>
                                      <span className="text-[8px] text-slate-500">{new Date(audio.Utc).toLocaleTimeString()}</span>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
      </div>
    </div>
  );
};

export default LiveVisualizer;

import React, { useState, useEffect, useRef } from 'react';
import { Map, List, Activity, Wifi, WifiOff, Users } from 'lucide-react';
import { useF1Store } from '../store/useF1Store';

const LiveVisualizer = () => {
  const [drivers, setDrivers] = useState({});
  const [sessionInfo, setSessionInfo] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [rcmMessages, setRcmMessages] = useState([]);
  const [audioStreams, setAudioStreams] = useState([]);
  
  const trackOutline = useF1Store(state => state.trackOutline);
  const leaderboard = useF1Store(state => state.leaderboard);
  const trackData = trackOutline?.points || [];
  const wsRef = useRef(null);
  const rcmRef = useRef(null);
  // React refs for animations (render storm fix)
  const posCount = useRef(0);
  const timingCount = useRef(0);

  const [trackTime, setTrackTime] = useState("");
  const driversRef = useRef({});

  useEffect(() => {
    const wsUrl = import.meta.env.VITE_LIVE_WS_URL || 'ws://localhost:8081';
    console.log("Connecting WebSocket directly to Backend:", wsUrl);
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => setStatus('connected');
    wsRef.current.onclose = () => setStatus('disconnected');
    
    wsRef.current.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { category, data } = payload;

        if (category === 'Position.z' || category === 'Position') {
          if (payload.track_time) setTrackTime(payload.track_time);
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
    posCount.current++;

    setDrivers(prev => {
      let hasNewDriver = false;
      let next = null;

      const processCar = (driverNum, x, y, z) => {
        if (x === undefined || y === undefined || x === null || y === null) return;

        if (!prev[driverNum] && !(next && next[driverNum])) {
            if (!next) next = { ...prev };
            next[driverNum] = { number: driverNum };
            hasNewDriver = true;
        }
        
        if (!driversRef.current[driverNum]) {
            driversRef.current[driverNum] = { number: driverNum };
        }
        
        driversRef.current[driverNum].x = x;
        driversRef.current[driverNum].y = y;
        driversRef.current[driverNum].z = z;

        const groupEl = document.getElementById(`driver-group-${driverNum}`);
        if (groupEl) {
            groupEl.setAttribute("transform", `translate(${x}, ${y})`);
            groupEl.setAttribute("visibility", "visible");
        }
      };

      // 1. Zpracování array formátu z FastAPI backendu
      if (Array.isArray(data) && data.length > 0 && data[0].driver_number !== undefined) {
         data.forEach(t => processCar(t.driver_number, t.x_pos, t.y_pos, 0));
         return hasNewDriver ? next : prev;
      }

      // 2. F1 SignalR Position.z formát: { Position: [{ Timestamp, Entries: { driverNum: {X,Y,Z} } }] }
      if (data?.Position && Array.isArray(data.Position)) {
          data.Position.forEach(entry => {
              if (entry.Entries && typeof entry.Entries === 'object') {
                  Object.keys(entry.Entries).forEach(driverNum => {
                      const car = entry.Entries[driverNum];
                      processCar(driverNum, car.X, car.Y, car.Z);
                  });
              }
          });
          return hasNewDriver ? next : prev;
      }

      // 3. Fallback: { Cars: { driverNum: {X,Y,Z} } }
      const carsData = data?.Cars || null;
      if (carsData) {
          Object.keys(carsData).forEach(key => {
            const car = carsData[key];
            const driverNum = car.DriverNumber || key;
            const x = car.X !== undefined ? car.X : car.Channels?.['0'];
            const y = car.Y !== undefined ? car.Y : car.Channels?.['1'];
            const z = car.Z !== undefined ? car.Z : car.Channels?.['2'];
            processCar(driverNum, x, y, z);
          });
      }
      return hasNewDriver ? next : prev;
    });
  };

  const processTiming = (data) => {
    timingCount.current++;
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

  // Výpočet bounding boxu pro mapu - Memoizováno, aby se to nepočítalo každý render frame a neskákalo
  const bounds = React.useMemo(() => {
    const trackVals = trackData || [];
    
    if (trackVals.length === 0) {
        return { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 };
    }
    
    const initial = { 
        minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity 
    };

    const fullBounds = trackVals.reduce((acc, p) => ({
        minX: Math.min(acc.minX, p.x),
        maxX: Math.max(acc.maxX, p.x),
        minY: Math.min(acc.minY, p.y),
        maxY: Math.max(acc.maxY, p.y),
    }), initial);

    return fullBounds;
  }, [trackData]);

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const padding = Math.max(width, height) * 0.1;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitleGroup}>
          <div style={styles.iconBox}>
            <Activity color="#ef4444" size={16} />
          </div>
          <h1 style={styles.title}>
            {sessionInfo?.Name || 'F1 LIVE PULSE'}
          </h1>
        </div>
        
        <div style={styles.statusBox}>
          {trackTime && (
            <div className="absolute top-4 left-4 z-10 pointer-events-none text-white opacity-80 backdrop-blur-sm bg-black/40 px-3 py-1.5 rounded-lg text-sm font-mono tracking-widest border border-white/10 shadow-lg flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              {trackTime}
            </div>
          )}
          <div style={status === 'connected' ? styles.statusConnected : styles.statusDisconnected}>
            {status === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
            {status.toUpperCase()}
          </div>
          <div style={styles.divider}></div>
          <div style={styles.trackedInfo}>
            <Users size={14}/> {Object.values(drivers).length} TRACKED
          </div>
          <div style={styles.divider}></div>
          <div style={styles.timeInfo}>
            {lastUpdate ? lastUpdate.toLocaleTimeString() : '--:--:--'}
          </div>
        </div>
      </div>

      <div style={styles.mainGrid}>
        {/* Map View */}
        <div style={styles.mapContainer}>
          <div style={styles.mapLabel}>
            <Map size={12} color="#60a5fa" /> Live Track Radar
          </div>
          
          {Object.values(drivers).length === 0 ? (
            <div style={{...styles.loadingContainer, zIndex: 9999}}>
              <div style={styles.spinner}>
                <div style={styles.spinnerInner}></div>
              </div>
              <p style={styles.loadingText}>Awaiting Telemetry...</p>
            </div>
          ) : (
            <svg 
              viewBox={`${bounds.minX - padding} ${bounds.minY - padding} ${width + padding*2} ${height + padding*2}`}
              style={styles.mapSvg}
            >
              {/* Track Outline */}
              {trackData.length > 0 && (
                <polyline
                  points={trackData.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth={Math.max(width, height) * 0.006}
                  strokeLinejoin="round"
                  style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.1))', transition: 'all 1s' }}
                />
              )}

              {Object.values(drivers).map(driver => {
                const initX = driversRef.current[driver.number]?.x || bounds.minX;
                const initY = driversRef.current[driver.number]?.y || bounds.minY;
                const isVisible = driversRef.current[driver.number]?.x !== undefined;
                
                const lbEntry = leaderboard?.find(l => l.driver_number === driver.number);
                const dotColor = lbEntry?.team_color || driver.color || '#fff';
                const labelName = lbEntry?.broadcast_name || driver.name || driver.number;
                
                return (
                  <g 
                    key={driver.number} 
                    id={`driver-group-${driver.number}`}
                    style={{ transition: 'transform 0.1s linear' }}
                    transform={`translate(${initX}, ${initY})`}
                    visibility={isVisible ? 'visible' : 'hidden'}
                  >
                    <circle
                      cx={0}
                      cy={0}
                      r={Math.max(width, height) * 0.015} 
                      fill={dotColor}
                      opacity="0.3"
                    />
                    <circle
                      cx={0}
                      cy={0}
                      r={Math.max(width, height) * 0.007} 
                      fill={dotColor}
                      stroke="#0a0f18"
                      strokeWidth={Math.max(width, height) * 0.002}
                    />
                    {/* Label Badge */}
                    <g transform={`translate(0, ${-Math.max(width, height) * 0.018})`}>
                       <rect 
                         x={-(Math.max(width, height) * 0.025)}
                         y={-(Math.max(width, height) * 0.014)}
                         width={Math.max(width, height) * 0.05}
                         height={Math.max(width, height) * 0.016}
                         rx={Math.max(width, height) * 0.003}
                         fill="rgba(10, 15, 24, 0.85)"
                         stroke={dotColor}
                         strokeWidth={Math.max(width, height) * 0.0008}
                       />
                       <text
                         x="0"
                         y="0"
                         textAnchor="middle"
                         fill="white"
                         fontSize={Math.max(width, height) * 0.01}
                         fontFamily="system-ui, sans-serif"
                         fontWeight="900"
                         style={{ pointerEvents: 'none', userSelect: 'none', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                       >
                         {labelName}
                       </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Bottom Panel */}
      <div style={styles.bottomGrid}>
          {/* Race Control */}
          <div style={styles.bottomPanel}>
              <div style={styles.bottomPanelHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b', fontSize: '12px', textTransform: 'uppercase', fontWeight: 900, letterSpacing: '0.1em' }}>
                      <Activity size={14} /> Race Control Messages
                  </div>
              </div>
              <div style={styles.bottomPanelContent} ref={rcmRef}>
                  {rcmMessages.length === 0 ? (
                      <div style={styles.emptyBottomPanel}>No messages yet</div>
                  ) : (
                      rcmMessages.map((m, i) => (
                        <div key={i} style={styles.rcmRow}>
                            <span style={styles.rcmTime}>
                              {new Date(m.Utc).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                            <span style={{
                                fontWeight: 600, 
                                color: m.Category === 'Flag' ? '#fbbf24' : '#e2e8f0',
                                textShadow: m.Category === 'Flag' ? '0 0 4px rgba(251,191,36,0.3)' : 'none'
                             }}>
                               {m.Message}
                            </span>
                        </div>
                      ))
                  )}
              </div>
          </div>

          {/* Audio Streams */}
          <div style={styles.bottomPanel}>
              <div style={styles.bottomPanelHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', fontSize: '12px', textTransform: 'uppercase', fontWeight: 900, letterSpacing: '0.1em' }}>
                    <Activity size={14} style={{ transform: 'rotate(90deg)' }} /> Team Radio Snippets
                  </div>
              </div>
              <div style={styles.bottomPanelContent}>
                  {audioStreams.length === 0 ? (
                      <div style={styles.emptyBottomPanel}>Silence on the radio</div>
                  ) : (
                      <div style={styles.audioGrid}>
                          {audioStreams.map((audio, i) => (
                              <div key={i} style={styles.audioCard}>
                                  <div style={{ width:'10px', height:'10px', borderRadius:'50%', backgroundColor:'#38bdf8', boxShadow:'0 0 8px rgba(56,189,248,0.8)' }} />
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      <span style={{ fontSize: '12px', fontWeight: 900, color: '#fff' }}>CAR {audio.DriverNumber}</span>
                                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{new Date(audio.Utc).toLocaleTimeString()}</span>
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

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#0a0f18',
        color: '#e2e8f0',
        padding: '16px',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
        boxSizing: 'border-box'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0
    },
    headerTitleGroup: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
    },
    iconBox: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.3)'
    },
    title: {
        margin: 0,
        fontSize: '24px',
        fontWeight: 900,
        fontStyle: 'italic',
        letterSpacing: '-0.05em',
        color: '#fff',
        textShadow: '0 2px 4px rgba(0,0,0,0.5)'
    },
    statusBox: {
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        fontSize: '12px',
        fontWeight: 'bold',
        backgroundColor: 'rgba(255,255,255,0.05)',
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.05)'
    },
    statusConnected: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: '#34d399',
        textShadow: '0 0 5px rgba(52,211,153,0.5)'
    },
    statusDisconnected: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: '#f87171'
    },
    divider: {
        width: '1px',
        height: '16px',
        backgroundColor: 'rgba(255,255,255,0.1)'
    },
    trackedInfo: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: '#94a3b8'
    },
    timeInfo: {
        color: '#34d399',
        fontFamily: 'monospace',
        fontSize: '11px',
        textShadow: '0 0 5px rgba(52,211,153,0.3)'
    },
    mainGrid: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
    },
    mapContainer: {
        backgroundColor: '#0d131f',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.1)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5), 0 20px 25px -5px rgba(0,0,0,0.5)'
    },
    mapLabel: {
        position: 'absolute',
        top: '16px',
        left: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: 'rgba(255,255,255,0.4)',
        fontSize: '10px',
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        backgroundColor: 'rgba(0,0,0,0.4)',
        padding: '6px 12px',
        borderRadius: '9999px',
        border: '1px solid rgba(255,255,255,0.1)',
        zIndex: 10
    },
    loadingContainer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10
    },
    loadingSpinnerBase: {
        position: 'relative',
        width: '96px',
        height: '96px',
        marginBottom: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '2px dashed rgba(255,255,255,0.1)',
        borderRadius: '50%'
    },
    loadingTitle: {
        margin: '0 0 4px 0',
        fontSize: '12px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: '#94a3b8'
    },
    loadingSubtitle: {
        margin: 0,
        fontSize: '10px',
        color: '#475569',
        textTransform: 'uppercase',
        letterSpacing: '0.1em'
    },
    mapSvg: {
        width: '100%',
        height: '100%',
        maxHeight: '70vh',
        filter: 'drop-shadow(0 0 15px rgba(255,255,255,0.05))',
        zIndex: 10
    },
    tableContainer: {
        backgroundColor: 'rgba(15, 20, 35, 0.8)',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
    },
    tableHeaderBar: {
        padding: '16px',
        backgroundColor: 'rgba(0,0,0,0.3)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
    },
    tableTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: 'white',
        fontSize: '12px',
        textTransform: 'uppercase',
        fontWeight: 900,
        letterSpacing: '0.1em',
        textShadow: '0 2px 4px rgba(0,0,0,0.5)'
    },
    tableBadge: {
        fontSize: '9px',
        color: '#34d399',
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        border: '1px solid rgba(16, 185, 129, 0.2)',
        padding: '4px 8px',
        borderRadius: '4px'
    },
    tableScrollArea: {
        flex: 1,
        overflowY: 'auto',
        position: 'relative'
    },
    table: {
        width: '100%',
        textAlign: 'left',
        borderCollapse: 'collapse'
    },
    tableHead: {
        position: 'sticky',
        top: 0,
        backgroundColor: '#0f1423',
        zIndex: 20,
        fontSize: '9px',
        color: 'rgba(255,255,255,0.4)',
        textTransform: 'uppercase',
        fontWeight: 900,
        letterSpacing: '0.1em',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
    },
    th: {
        padding: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        whiteSpace: 'nowrap'
    },
    tr: {
        transition: 'background-color 0.2s',
        borderBottom: '1px solid rgba(255,255,255,0.02)'
    },
    td: {
        padding: '12px',
        position: 'relative',
        zIndex: 10
    },
    gapBadge: {
        display: 'inline-block',
        padding: '2px 6px',
        backgroundColor: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '11px',
        fontWeight: 'bold',
        minWidth: '50px',
        textAlign: 'center',
        color: 'rgba(255,255,255,0.9)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
    },
    tableLoadingOverlay: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 20, 35, 0.5)'
    },
    bottomGrid: {
        marginTop: '24px',
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: '24px',
        height: '192px'
    },
    bottomPanel: {
        backgroundColor: 'rgba(15, 20, 35, 0.9)',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
    },
    bottomPanelHeader: {
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        backgroundColor: 'rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
    },
    bottomPanelContent: {
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
    },
    emptyBottomPanel: {
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.2)',
        fontSize: '10px',
        textTransform: 'uppercase',
        fontWeight: 900,
        letterSpacing: '0.1em'
    },
    rcmRow: {
        fontSize: '11px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '16px',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '8px',
        borderRadius: '4px'
    },
    rcmTime: {
        color: 'rgba(255,255,255,0.4)',
        flexShrink: 0,
        fontFamily: 'monospace',
        backgroundColor: 'rgba(255,255,255,0.05)',
        padding: '2px 8px',
        borderRadius: '4px',
        border: '1px solid rgba(255,255,255,0.05)',
        fontSize: '10px'
    },
    audioGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px'
    },
    audioCard: {
        backgroundColor: 'rgba(0,0,0,0.4)',
        padding: '12px',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        border: '1px solid rgba(255,255,255,0.1)'
    }
};

export default LiveVisualizer;

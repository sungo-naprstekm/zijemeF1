import React, { useEffect, useState, useRef } from 'react';
import { PlaySquare, AlertCircle, WifiOff } from 'lucide-react';

export function LiveDirectStream() {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('connecting'); // connecting, connected, disconnected
  const listRef = useRef(null);

  useEffect(() => {
    const wsUrl = import.meta.env.VITE_LIVE_WS_URL || 'ws://localhost:8081';
    console.log('Connecting to Live WebSocket:', wsUrl);
    let ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        setStatus('connected');
    };

    ws.onmessage = (event) => {
        // limit arrays to avoid memory blow-up
        setMessages(prev => {
            const newArr = [...prev, event.data];
            return newArr.length > 500 ? newArr.slice(newArr.length - 500) : newArr;
        });
    };

    ws.onclose = () => {
        setStatus('disconnected');
    };

    ws.onerror = (err) => {
        setStatus('disconnected');
    };

    return () => {
        ws.close();
    };
  }, []);

  // auto-scroll
  useEffect(() => {
    if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitleGroup}>
          <div style={styles.iconBox}>
            <PlaySquare size={20} color="#0ea5e9" />
          </div>
          <div>
            <h1 style={styles.title}>
              LIVE DIRECT STREAM
            </h1>
            <p style={styles.subtitle}>Raw telemetry feed</p>
          </div>
        </div>

        <div style={styles.statusBox}>
          <div style={styles.statusState(status)}>
            {status === 'connected' && <div style={{...styles.dot, backgroundColor: '#34d399', animation: 'pulse 2s infinite'}} />}
            {status === 'connecting' && <div style={{...styles.dot, backgroundColor: '#fbbf24'}} />}
            {status === 'disconnected' && <WifiOff size={14} />}
            {status.toUpperCase()}
          </div>
          <div style={styles.divider}></div>
          <div style={styles.msgCounter}>
             MSGS: <span style={{color: '#fff'}}>{messages.length}</span>
          </div>
        </div>
      </div>
      
      {status === 'disconnected' && (
          <div style={styles.alert}>
              <AlertCircle size={18} /> Spojení se serverem bylo ztraceno. (Ujistěte se, že běží live_worker.py na portu 8081)
          </div>
      )}

      {/* Log Terminal */}
      <div style={styles.terminalWrapper}>
        <div style={styles.terminalHeader}>
          <div style={styles.terminalTitle}>
            TERMINAL // STDOUT
          </div>
        </div>

        <div style={styles.logContainer} ref={listRef}>
          {messages.length === 0 ? (
              <div style={styles.empty}>
                <PlaySquare size={32} style={{opacity: 0.5, marginBottom: '16px'}} />
                <span>WAITING FOR SOCKET STREAM...</span>
              </div>
          ) : (
              <div style={styles.msgList}>
                  {messages.map((msg, i) => (
                      <div key={i} style={styles.messageRow}>
                        <span style={styles.msgIndex}>[{String(i).padStart(4, '0')}]</span>
                        {msg}
                      </div>
                  ))}
              </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
    container: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-bg)',
        color: '#e2e8f0',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
        padding: '24px'
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
        paddingBottom: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0
    },
    headerTitleGroup: {
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
    },
    iconBox: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '40px',
        height: '40px',
        borderRadius: '12px',
        backgroundColor: 'rgba(14, 165, 233, 0.1)',
        border: '1px solid rgba(14, 165, 233, 0.3)',
        boxShadow: '0 0 15px rgba(14, 165, 233, 0.2)'
    },
    title: {
        margin: 0,
        fontSize: '24px',
        fontWeight: 900,
        fontStyle: 'italic',
        letterSpacing: '-0.05em',
        color: '#fff',
        lineHeight: 1
    },
    subtitle: {
        margin: '4px 0 0 0',
        fontSize: '10px',
        color: '#38bdf8',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.1em'
    },
    statusBox: {
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        fontSize: '12px',
        fontWeight: 'bold',
        backgroundColor: '#0d131f',
        padding: '8px 16px',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
    },
    statusState: (state) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 12px',
        borderRadius: '8px',
        border: '1px solid',
        backgroundColor: state === 'connected' ? 'rgba(16, 185, 129, 0.2)' : state === 'connecting' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)',
        borderColor: state === 'connected' ? 'rgba(16, 185, 129, 0.3)' : state === 'connecting' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        color: state === 'connected' ? '#34d399' : state === 'connecting' ? '#fbbf24' : '#f87171',
        boxShadow: state === 'connected' ? '0 0 8px rgba(52, 211, 153, 0.4)' : 'none'
    }),
    dot: {
        width: '8px',
        height: '8px',
        borderRadius: '50%'
    },
    divider: {
        width: '1px',
        height: '20px',
        backgroundColor: 'rgba(255,255,255,0.1)'
    },
    msgCounter: {
        color: '#94a3b8',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px'
    },
    alert: {
        marginBottom: '16px',
        padding: '16px',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        color: '#f87171',
        fontWeight: 600,
        fontSize: '14px',
        boxShadow: '0 0 20px rgba(239, 68, 68, 0.1)'
    },
    terminalWrapper: {
        flex: 1,
        backgroundColor: '#0d131f',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.1)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'inset 0 0 30px rgba(0,0,0,0.5), 0 20px 25px -5px rgba(0,0,0,0.5)',
        overflow: 'hidden'
    },
    terminalHeader: {
        padding: '12px 24px',
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
    },
    terminalTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: 'rgba(255,255,255,0.5)',
        fontSize: '10px',
        textTransform: 'uppercase',
        fontWeight: 900,
        letterSpacing: '0.1em'
    },
    logContainer: {
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px'
    },
    msgList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
    },
    messageRow: {
        padding: '4px 8px',
        borderBottom: '1px solid rgba(255,255,255,0.02)',
        color: 'rgba(186, 230, 253, 0.7)',
        borderRadius: '4px',
        transition: 'all 0.2s',
        wordBreak: 'break-all',
        lineHeight: 1.6
    },
    msgIndex: {
        color: 'rgba(16, 185, 129, 0.5)',
        marginRight: '12px',
        userSelect: 'none'
    },
    empty: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'rgba(255,255,255,0.2)',
        textTransform: 'uppercase',
        fontWeight: 900,
        letterSpacing: '0.1em'
    }
};

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
      <div style={styles.header}>
        <h2 style={styles.title}><PlaySquare size={20} /> Live Direct Stream MVP</h2>
        <div style={styles.status(status)}>
            {status === 'connected' ? '🔴 Live Connected' : status === 'connecting' ? '⏳ Connecting...' : '❌ Disconnected'}
        </div>
      </div>
      
      {status === 'disconnected' && (
          <div style={styles.alert}>
              <WifiOff size={16} /> Spojení se serverem bylo ztraceno. (Ujistěte se, že běží live_worker.py na portu 8081)
          </div>
      )}

      <div style={styles.logContainer} ref={listRef}>
        {messages.length === 0 ? (
            <div style={styles.empty}>Žádná data. Čekám na stream...</div>
        ) : (
            <pre style={styles.pre}>
                {messages.map((msg, i) => (
                    <div key={i} style={styles.messageRow}>{msg}</div>
                ))}
            </pre>
        )}
      </div>
    </div>
  );
}

const styles = {
    container: {
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0a0a0a',
        color: '#e5e5e5',
        fontFamily: 'system-ui, sans-serif'
    },
    header: {
        padding: '16px 24px',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#111'
    },
    title: {
        margin: 0,
        fontSize: '18px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: '#fff'
    },
    status: (state) => ({
        padding: '6px 12px',
        borderRadius: '16px',
        fontSize: '12px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        backgroundColor: state === 'connected' ? '#1a4d2e' : state === 'connecting' ? '#4a3f00' : '#4d1a1a',
        color: state === 'connected' ? '#4ade80' : state === 'connecting' ? '#facc15' : '#f87171'
    }),
    alert: {
        padding: '12px 24px',
        backgroundColor: '#4d1a1a',
        color: '#f87171',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '14px',
    },
    logContainer: {
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        fontFamily: 'monospace',
    },
    pre: {
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all'
    },
    messageRow: {
        padding: '4px 0',
        borderBottom: '1px solid #1a1a1a',
        color: '#a3a3a3'
    },
    empty: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#555',
        fontStyle: 'italic'
    }
};

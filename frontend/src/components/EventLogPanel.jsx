import React from 'react';
import { useF1Store } from '../store/useF1Store';
import { Terminal } from 'lucide-react';

export function EventLogPanel() {
  const eventLogs = useF1Store(state => state.eventLogs);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.titleWrapper}>
           <Terminal size={14} color="#0ea5e9" /> 
           <span>SYSTEM EVENT LOG</span>
        </div>
      </div>
      <div style={styles.logBox}>
        {eventLogs.length === 0 ? (
          <div style={styles.empty}>Čekání na data...</div>
        ) : (
          eventLogs.map(log => (
            <div key={log.id} style={styles.logRow}>
              <span style={styles.logTime}>[{log.time}]</span>
              <span style={styles.logText}>{log.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '320px',
    backgroundColor: 'rgba(15, 20, 35, 0.4)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '24px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0
  },
  header: {
    padding: '16px',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderBottom: '1px solid rgba(255,255,255,0.05)'
  },
  titleWrapper: {
    display: 'flex', alignItems: 'center', gap: '8px', 
    color: 'white', fontSize: '11px', fontWeight: 900, 
    letterSpacing: '0.1em'
  },
  logBox: {
    flex: 1, padding: '12px', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: '6px',
    fontFamily: 'monospace'
  },
  logRow: {
    display: 'flex', alignItems: 'flex-start', gap: '8px',
    fontSize: '11px', borderBottom: '1px dashed rgba(255,255,255,0.02)',
    paddingBottom: '6px'
  },
  logTime: {
    color: '#0ea5e9', flexShrink: 0, fontWeight: 'bold'
  },
  logText: {
    color: '#cbd5e1', wordBreak: 'break-word'
  },
  empty: {
    fontSize: '11px', color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: '20px'
  }
};

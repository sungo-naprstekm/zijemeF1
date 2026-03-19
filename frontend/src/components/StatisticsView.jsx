import React from 'react';

export function StatisticsView({ onBack }) {
  const year = localStorage.getItem('f1_year') || 'N/A';
  const round = localStorage.getItem('f1_round') || 'N/A';

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn}>← Zpět do výběru trati</button>
        <h2 style={styles.title}>Statistiky závodu: {year} {round}</h2>
      </div>

      <div style={styles.content}>
         <div style={styles.placeholderBox}>
            <span style={{ fontSize: '48px', marginBottom: '16px', display: 'block' }}>📊</span>
            <h3 style={{ margin: '0 0 8px 0', color: 'white' }}>Modul pro detailní statistiky se teprve připravuje.</h3>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', margin: 0, maxWidth: '400px', lineHeight: 1.5 }}>
              Tady vznikne speciální tabulka ukazující detailní sektory napříč závodem, průměrnou rychlost, vývoj teplot a analýzu pneumatik na základě historických dat F1 pro událost <strong>{year} {round}</strong>.
            </p>
         </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: '100vh', width: '100vw', backgroundColor: '#0a0f18', color: 'white',
    display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-sans)', padding: '24px', boxSizing: 'border-box'
  },
  header: {
    display: 'flex', alignItems: 'center', gap: '24px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '24px', marginBottom: '24px'
  },
  title: { margin: 0, fontStyle: 'italic', letterSpacing: '-0.02em', fontSize: '24px' },
  backBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', 
    color: '#94a3b8', padding: '10px 18px', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 600, fontSize: '13px'
  },
  content: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  placeholderBox: {
    backgroundColor: 'rgba(20, 25, 40, 0.4)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '24px',
    padding: '48px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center'
  }
};

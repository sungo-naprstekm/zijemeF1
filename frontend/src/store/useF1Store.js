import { create } from 'zustand';
import { supabase } from '../supabaseClient';

export const useF1Store = create((set, get) => ({
  sessionState: {
    flag: 'Green',
    remaining_time: '',
    remaining_laps: 0,
    track_temp: 0,
    air_temp: 0
  },
  leaderboard: [],
  positions: {}, // { driver_number: { x, y } }
  trackOutline: null, // { points: [{x, y}], circuit_name: string }
  isLoading: false,
  currentSession: null,
  eventLogs: [],
  addEventLog: (msg) => {
    const time = new Date().toLocaleTimeString('cs-CZ', { hour12: false });
    set((state) => ({ eventLogs: [{ id: Date.now() + Math.random(), time, msg }, ...state.eventLogs].slice(0, 50) }));
  },

  fetchBackendLogs: async () => {
    const renderUrl = import.meta.env.VITE_RENDER_URL;
    if (!renderUrl) return;
    try {
      const res = await fetch(`${renderUrl}/logs`);
      const data = await res.json();
      if (data.logs && Array.isArray(data.logs)) {
        set((state) => {
          const existingIds = new Set(state.eventLogs.map(log => log.id));
          const newLogs = data.logs.filter(log => !existingIds.has(log.id));
          if (newLogs.length > 0) {
             const combined = [...newLogs, ...state.eventLogs];
             combined.sort((a,b) => b.id - a.id); // descending order
             return { eventLogs: combined.slice(0, 100) };
          }
          return state;
        });
      }
    } catch(e) {}
  },

  // Vymazání lokálního stavu při přepnutí závodu
  resetForNewSession: () => {
    set({
      leaderboard: [],
      positions: {},
      trackOutline: null,
      isLoading: true,
      sessionState: { flag: 'Loading...', remaining_time: '', remaining_laps: 0, track_temp: 0, air_temp: 0 }
    });
    setTimeout(() => set({ isLoading: false }), 15000); // Sníženo na 15s
  },

  setSession: (year, round) => {
    set({ currentSession: { year, round } });
    get().resetForNewSession();
  },

  fetchTrackOutline: async () => {
    console.log("[F1Store] Manuální stažení databáze track_outline (fallback)...");
    const { data: trackData } = await supabase.from('track_outline').select('*').limit(1).single();
    if (trackData) set({ trackOutline: trackData });
  },

  pollSupabaseState: async () => {
    try {
        const { data: sessionData } = await supabase.from('session_state').select('*').limit(1).single();
        if (sessionData) set({ sessionState: sessionData, isLoading: false });

        const { data: lbData } = await supabase.from('leaderboard').select('*').order('position', { ascending: true });
        if (lbData && lbData.length > 0) set({ leaderboard: lbData });

        if (!get().trackOutline) {
            get().fetchTrackOutline();
        }
    } catch(e) {
        console.error("Poling error", e);
    }
  },

  initSupabase: async () => {
    get().pollSupabaseState();
    
    // Z důvodu přečerpání Supabase Realtime free quotas (WebSocket limits) přecházíme na poll přes REST.
    const intervalId = setInterval(() => {
        get().pollSupabaseState();
        get().fetchBackendLogs();
    }, 2500);

    return () => clearInterval(intervalId);
  }
}));

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

  initSupabase: async () => {
    const { data: sessionData } = await supabase.from('session_state').select('*').limit(1).single();
    if (sessionData) set({ sessionState: sessionData });

    const { data: lbData } = await supabase.from('leaderboard').select('*').order('position', { ascending: true });
    if (lbData) set({ leaderboard: lbData });

    get().fetchTrackOutline();

    const channels = supabase.channel('custom-all-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_state' },
        (payload) => {
          console.log("[Supabase Realtime] Event přijat:", payload);
          if (payload.eventType === 'DELETE') return;
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            get().addEventLog(`🚦 Závod: Vlajka ${payload.new.flag} (Kolo ${payload.new.current_lap})`);
            set({ sessionState: payload.new, isLoading: false });
          }
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            // Smažeme jezdce z lokálního stavu
            set((state) => ({
              leaderboard: state.leaderboard.filter(l => l.driver_number !== payload.old?.driver_number)
            }));
            return;
          }
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            get().addEventLog(`⏱️ Změna pořadí: Vůz #${payload.new.driver_number} -> P${payload.new.position}`);
            set((state) => {
              const exists = state.leaderboard.find(l => l.driver_number === payload.new.driver_number);
              const newList = exists
                ? state.leaderboard.map(l => l.driver_number === payload.new.driver_number ? payload.new : l)
                : [...state.leaderboard, payload.new];
              newList.sort((a, b) => a.position - b.position);
              return { leaderboard: newList, isLoading: false };
            });
          }
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'track_outline' },
        (payload) => {
          console.log("[Supabase Realtime] Track_outline update:", payload);
          if (payload.eventType === 'DELETE') return;
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            get().addEventLog(`🗺️ Obrys trati z DB aktualizován.`);
            if (payload.new) {
               // PostgreSQL neodesílá TOAST (velké JSON objekty) u Realtime updatů, pokud nejsou izolovány
               if (!payload.new.points || payload.new.points.length === 0 || typeof payload.new.points === 'string') {
                  get().fetchTrackOutline();
               } else {
                  set({ trackOutline: payload.new });
               }
            }
          }
        }
      )
      .subscribe();

    const intervalId = setInterval(() => get().fetchBackendLogs(), 3000);

    return () => {
       clearInterval(intervalId);
       supabase.removeChannel(channels);
    };
  }
}));

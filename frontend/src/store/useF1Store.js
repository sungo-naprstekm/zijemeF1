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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'telemetry' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            set((state) => {
              const newPositions = { ...state.positions };
              delete newPositions[payload.old?.driver_number];
              return { positions: newPositions };
            });
            return;
          }
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const t = payload.new;
            if (!t) return;
            set((state) => {
              const newPosts = { ...state.positions };
              if (t.x_pos !== null && t.y_pos !== null) {
                newPosts[t.driver_number] = { x: t.x_pos, y: t.y_pos };
              }
              return {
                positions: newPosts,
                isLoading: false
              };
            });
          }
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'track_outline' },
        (payload) => {
          console.log("[Supabase Realtime] Track_outline update:", payload);
          if (payload.eventType === 'DELETE') return;
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
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

    return () => supabase.removeChannel(channels);
  }
}));

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
  telemetry: {},
  positions: {}, // { driver_number: { x, y } }
  trackOutline: null, // { points: [{x, y}], circuit_name: string }
  isLoading: false,
  currentSession: { year: 2024, round: 'British Grand Prix' },

  // Vymazání lokálního stavu při přepnutí závodu
  resetForNewSession: () => {
    set({
      leaderboard: [],
      telemetry: {},
      positions: {},
      isLoading: true,
      sessionState: { flag: 'Loading...', remaining_time: '', remaining_laps: 0, track_temp: 0, air_temp: 0 }
    });
    setTimeout(() => set({ isLoading: false }), 15000); // Sníženo na 15s
  },

  setSession: (year, round) => {
    set({ currentSession: { year, round } });
    get().resetForNewSession();
  },

  initSupabase: async () => {
    const { data: sessionData } = await supabase.from('session_state').select('*').limit(1).single();
    if (sessionData) set({ sessionState: sessionData });

    const { data: lbData } = await supabase.from('leaderboard').select('*').order('position', { ascending: true });
    if (lbData) set({ leaderboard: lbData });

    const { data: trackData } = await supabase.from('track_outline').select('*').limit(1).single();
    if (trackData) set({ trackOutline: trackData });

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
          console.log("[Supabase Realtime] Event přijat:", payload);
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
          console.log("[Supabase Realtime] Event přijat:", payload);
          if (payload.eventType === 'DELETE') {
            set((state) => {
              const newTelemetry = { ...state.telemetry };
              const newPositions = { ...state.positions };
              delete newTelemetry[payload.old?.driver_number];
              delete newPositions[payload.old?.driver_number];
              return { telemetry: newTelemetry, positions: newPositions };
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
                telemetry: { ...state.telemetry, [t.driver_number]: t },
                positions: newPosts,
                isLoading: false
              };
            });
          }
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'track_outline' },
        (payload) => {
          console.log("[Supabase Realtime] Event přijat:", payload);
          if (payload.eventType === 'DELETE') return;
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            if (payload.new) set({ trackOutline: payload.new });
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channels);
  }
}));

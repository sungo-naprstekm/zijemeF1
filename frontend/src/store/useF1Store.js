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
  isLoading: false,
  currentSession: { year: 2023, round: 'Monza' },

  // Vymazání lokálního stavu při přepnutí závodu
  resetForNewSession: () => {
    set({
      leaderboard: [],
      telemetry: {},
      isLoading: true,
      sessionState: { flag: 'Loading...', remaining_time: '', remaining_laps: 0, track_temp: 0, air_temp: 0 }
    });
    setTimeout(() => set({ isLoading: false }), 45000);
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

    const channels = supabase.channel('custom-all-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_state' },
        (payload) => {
          if (payload.eventType === 'DELETE') return;
          set({ sessionState: payload.new, isLoading: false });
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
          set((state) => {
            const exists = state.leaderboard.find(l => l.driver_number === payload.new.driver_number);
            const newList = exists
              ? state.leaderboard.map(l => l.driver_number === payload.new.driver_number ? payload.new : l)
              : [...state.leaderboard, payload.new];
            newList.sort((a, b) => a.position - b.position);
            return { leaderboard: newList, isLoading: false };
          });
        }
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' },
        (payload) => {
          const t = payload.new;
          set((state) => ({
            telemetry: { ...state.telemetry, [t.driver_number]: t },
            isLoading: false
          }));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channels);
  }
}));

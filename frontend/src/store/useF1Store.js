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
  telemetry: {}, // např. { "1": { speed, rpm, gear, throttle, brake }, "16": ... }

  initSupabase: async () => {
    // 1. Initial Fetch
    const { data: sessionData } = await supabase.from('session_state').select('*').limit(1).single();
    if (sessionData) {
      set({ sessionState: sessionData });
    }

    const { data: lbData } = await supabase.from('leaderboard').select('*').order('position', { ascending: true });
    if (lbData) {
      set({ leaderboard: lbData });
    }

    // 2. Realtime Subscriptions
    const channels = supabase.channel('custom-all-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_state' },
        (payload) => {
          set({ sessionState: payload.new });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leaderboard' },
        (payload) => {
          // U Leaderboardu chceme updatnout konkrétního jezdce nebo ho přidat
          set((state) => {
            const exists = state.leaderboard.find(l => l.driver_number === payload.new.driver_number);
            let newList = [];
            if (exists) {
                newList = state.leaderboard.map(l => l.driver_number === payload.new.driver_number ? payload.new : l);
            } else {
                newList = [...state.leaderboard, payload.new];
            }
            // Znovu seřadit podle pozice
            newList.sort((a,b) => a.position - b.position);
            return { leaderboard: newList };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'telemetry' },
        (payload) => {
          const t = payload.new;
          set((state) => ({
            telemetry: {
              ...state.telemetry,
              [t.driver_number]: t
            }
          }));
        }
      )
      .subscribe();

      // Můžeme vrátit unsubscribe funkci
      return () => {
        supabase.removeChannel(channels);
      };
  }
}));

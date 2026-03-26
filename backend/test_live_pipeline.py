"""
test_live_pipeline.py
Testuje live_worker parsery přímo – bez nutnosti živého F1 závodu.
Simuluje SignalR zprávy a ověří, že data dorazí do Supabase.

Spuštění:
  cd backend && source venv/bin/activate && python test_live_pipeline.py
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

# Import parserů z live_worker
from live_worker import (
    _parse_position, _parse_timing_data, _parse_driver_list,
    _parse_session_info, _parse_track_status, _parse_weather,
    _parse_lap_count, supabase_live
)

if not supabase_live:
    print("❌ Supabase není nakonfigurovaný – zkontroluj .env soubor")
    sys.exit(1)

print("✅ Supabase spojení OK\n")
print("=== Testování Live Pipeline Parserů ===\n")


# --- Test 1: LapCount ---
print("1. LapCount → session_state")
_parse_lap_count({"CurrentLap": 42, "TotalLaps": 53})
time.sleep(0.5)
r = supabase_live.table("session_state").select("current_lap,total_laps").eq("id", 1).execute()
if r.data:
    lap = r.data[0]
    ok = lap["current_lap"] == 42 and lap["total_laps"] == 53
    print(f"   {'✅' if ok else '❌'} current_lap={lap['current_lap']}, total_laps={lap['total_laps']}")
else:
    print("   ⚠ Žádná data v session_state (řádek id=1 neexistuje?)")

# --- Test 2: TrackStatus ---
print("\n2. TrackStatus → session_state flag")
_parse_track_status({"Status": "4"})  # 4 = SC
time.sleep(0.5)
r = supabase_live.table("session_state").select("flag").eq("id", 1).execute()
if r.data:
    flag = r.data[0]["flag"]
    print(f"   {'✅' if flag == 'SC' else '❌'} flag={flag} (očekáváno: SC)")

# --- Test 3: WeatherData ---
print("\n3. WeatherData → session_state temps")
_parse_weather({"TrackTemp": "38.5", "AirTemp": "24.1"})
time.sleep(0.5)
r = supabase_live.table("session_state").select("track_temp,air_temp").eq("id", 1).execute()
if r.data:
    d = r.data[0]
    print(f"   ✅ track_temp={d['track_temp']}, air_temp={d['air_temp']}")

# --- Test 4: SessionInfo ---
print("\n4. SessionInfo → session_state session_type")
_parse_session_info({"Meeting": {"Name": "Japanese Grand Prix"}, "Name": "Qualifying"})
time.sleep(0.5)
r = supabase_live.table("session_state").select("session_type").eq("id", 1).execute()
if r.data:
    st = r.data[0].get("session_type")
    ok = st == "Qualifying"
    print(f"   {'✅' if ok else '❌'} session_type={st}")

# --- Test 5: DriverList ---
print("\n5. DriverList → leaderboard (broadcast_name, team_color)")
_parse_driver_list({
    "1":  {"Tla": "VER", "TeamColour": "3671C6"},
    "44": {"Tla": "HAM", "TeamColour": "27F4D2"},
    "16": {"Tla": "LEC", "TeamColour": "E80020"},
})
time.sleep(1.0)
r = supabase_live.table("leaderboard").select("driver_number,broadcast_name,team_color").in_("driver_number", ["1","44","16"]).execute()
for row in (r.data or []):
    print(f"   ✅ #{row['driver_number']} {row['broadcast_name']} {row['team_color']}")

# --- Test 6: TimingData ---
print("\n6. TimingData → leaderboard (position, gap)")
_parse_timing_data({"Lines": {
    "1":  {"Position": "1", "GapToLeader": "+0.000", "LastLapTime": {"Value": "1:28.456"}},
    "44": {"Position": "2", "GapToLeader": "+1.234", "LastLapTime": {"Value": "1:28.890"}},
    "16": {"Position": "3", "GapToLeader": "+2.567", "IntervalToPositionAhead": {"Value": "+1.333"}},
}})
time.sleep(1.0)
r = supabase_live.table("leaderboard").select("driver_number,position,gap_to_leader").in_("driver_number", ["1","44","16"]).order("position").execute()
for row in (r.data or []):
    print(f"   ✅ P{row['position']} #{row['driver_number']} gap={row['gap_to_leader']}")

# --- Test 7: Position ---
print("\n7. Position → telemetry (x_pos, y_pos)")
_parse_position({"Entries": {
    "1":  {"X": 1234.5, "Y": 567.8, "Speed": 295},
    "44": {"X": 1100.0, "Y": 600.0, "Speed": 280},
}})
time.sleep(1.0)
r = supabase_live.table("telemetry").select("driver_number,x_pos,y_pos,speed").in_("driver_number", ["1","44"]).execute()
for row in (r.data or []):
    print(f"   ✅ #{row['driver_number']} x={row['x_pos']} y={row['y_pos']} speed={row['speed']}")

print("\n=== Hotovo! ===")
print("Zkontroluj výsledky výše. ✅ = data dorazila do Supabase, ❌ = chyba.")
print("Resetuj session_state zpět zavoláním: curl -X POST http://localhost:8000/reset-state")

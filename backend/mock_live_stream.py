"""
mock_live_stream.py
Simuluje F1 live přenos přímo přes Supabase pipeline bez potřeby SignalR.
Načte historická FastF1 data a posílá je parsery stejnou cestou jako live_worker.

Spuštění:
  cd backend && source venv/bin/activate && python mock_live_stream.py

Volitelné argumenty:
  --year 2024         (default: 2024)
  --race Silverstone  (default: Silverstone)
  --session R         (R=Race, Q=Qualifying, FP1-FP3)
  --speed 30          (kolikrát rychleji než realtime, default: 30)
"""
import sys, os, time, argparse, logging
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("mock_live")

import fastf1
import pandas as pd

from live_worker import (
    _parse_position, _parse_timing_data, _parse_driver_list,
    _parse_session_info, _parse_track_status, _parse_weather,
    _parse_lap_count, supabase_live
)

CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')
fastf1.Cache.enable_cache(CACHE_DIR)

# ── Argument parser ──────────────────────────────────────────
parser = argparse.ArgumentParser(description="F1 Live Stream Mock")
parser.add_argument("--year",    type=int, default=2024,          help="Rok sezóny")
parser.add_argument("--race",    type=str, default="Silverstone",  help="Název GP")
parser.add_argument("--session", type=str, default="R",            help="Session: R/Q/FP1/FP2/FP3")
parser.add_argument("--speed",   type=float, default=30.0,         help="Násobek rychlosti (30 = 30x)")
args = parser.parse_args()

if not supabase_live:
    logger.error("Supabase není nakonfigurován – zkontroluj .env")
    sys.exit(1)

# ── Načtení FastF1 dat ───────────────────────────────────────
logger.info(f"📥 Stahuji {args.year} {args.race} {args.session} z FastF1...")
session = fastf1.get_session(args.year, args.race, args.session)
session.load(telemetry=True, weather=True, messages=True)
logger.info("✅ Data připravena!")

# ── Track Outline (geometrie trati) ─────────────────────────
logger.info("→ Generuji track_outline z nejrychlejšího kola...")
try:
    lap = session.laps.pick_fastest()
    pos_data = lap.get_pos_data()[["X", "Y"]].dropna()
    if not pos_data.empty:
        all_x = pos_data["X"].tolist()
        all_y = pos_data["Y"].tolist()
        x_min, x_max = min(all_x), max(all_x)
        y_min, y_max = min(all_y), max(all_y)
        x_range = max(x_max - x_min, 1)
        y_range = max(y_max - y_min, 1)
        max_dim = 900
        scale = max_dim / max(x_range, y_range)
        scaled_width = x_range * scale
        scaled_height = y_range * scale
        x_offset = (1000 - scaled_width) / 2
        y_offset = (1000 - scaled_height) / 2

        step_size = max(1, len(pos_data) // 500)
        outline_points = []
        for i in range(0, len(pos_data), step_size):
            row = pos_data.iloc[i]
            outline_points.append({
                "x": round((float(row["X"]) - x_min) * scale + x_offset, 2),
                "y": round((float(row["Y"]) - y_min) * scale + y_offset, 2),
            })

        supabase_live.table("track_outline").upsert({
            "id": 1,
            "points": outline_points,
            "circuit_name": f"{args.year} {session.event['EventName']} (MOCK)",
        }).execute()
        logger.info(f"✅ track_outline uložen ({len(outline_points)} bodů)")
    else:
        logger.warning("⚠ Žádná GPS data pro track_outline")
except Exception as e:
    logger.error(f"Track outline chyba: {e}")

# ── SessionInfo ──────────────────────────────────────────────
logger.info("→ Odesílám SessionInfo...")
_parse_session_info({
    "Meeting": {"Name": f"{session.event['EventName']} (MOCK LIVE)"},
    "Name": session.name,
    "ArchiveStatus": {"Status": "Generating"}
})

# ── DriverList ───────────────────────────────────────────────
logger.info("→ Odesílám DriverList...")
driver_list = {}
for drv_num in session.drivers:
    try:
        drv = session.get_driver(drv_num)
        driver_list[str(drv_num)] = {
            "Tla": drv.get("Abbreviation", str(drv_num)),
            "TeamColour": (drv.get("TeamColor", "FFFFFF") or "FFFFFF").lstrip("#"),
        }
    except Exception:
        driver_list[str(drv_num)] = {"Tla": str(drv_num), "TeamColour": "FFFFFF"}
_parse_driver_list(driver_list)

# ── WeatherData (z první dostupné vzorku) ────────────────────
logger.info("→ Odesílám WeatherData...")
try:
    weather = session.weather_data.iloc[0]
    _parse_weather({
        "TrackTemp": str(weather.get("TrackTemp", 30)),
        "AirTemp":   str(weather.get("AirTemp", 22)),
    })
except Exception:
    _parse_weather({"TrackTemp": "30", "AirTemp": "22"})

# ── TrackStatus ──────────────────────────────────────────────
_parse_track_status({"Status": "1"})  # Green

# ── Připrav telemetrii pro všechny jezdce ────────────────────
logger.info("→ Předzpracovávám telemetrii jezdců...")
drv_telemetry = {}
drv_laps_data = {}

for drv_num in session.drivers:
    try:
        laps = session.laps.pick_driver(drv_num)
        tel = laps.get_telemetry()[["SessionTime", "X", "Y"]].dropna()
        drv_telemetry[str(drv_num)] = [
            {"t": row["SessionTime"].total_seconds(), "X": float(row["X"]), "Y": float(row["Y"])}
            for _, row in tel.iterrows()
        ]
        drv_laps_data[str(drv_num)] = [
            {"t": row["Time"].total_seconds(), "lap": int(row["LapNumber"]) if not pd.isna(row["LapNumber"]) else 0}
            for _, row in laps.iterrows()
        ]
    except Exception as e:
        logger.warning(f"  Jezdec {drv_num}: {e}")
        drv_telemetry[str(drv_num)] = []
        drv_laps_data[str(drv_num)] = []

logger.info(f"✅ Telemetrie: {sum(len(v) for v in drv_telemetry.values())} bodů celkem")

# Zjistíme časový rozsah
all_times = [p["t"] for v in drv_telemetry.values() for p in v]
if not all_times:
    logger.error("Žádná telemetrická data!")
    sys.exit(1)

t_start = min(all_times)
t_end   = max(all_times)
total_laps = int(session.laps["LapNumber"].max()) if len(session.laps) > 0 else 0

logger.info(f"⏱  Rozsah: {t_start:.0f}s – {t_end:.0f}s ({(t_end-t_start)/60:.1f} min) | {total_laps} kol | {args.speed}x rychlost")
logger.info("🟢 SPOUŠTÍM MOCK LIVE STREAM – ctrl+C pro zastavení\n")

# ── Indexy pro interpolaci ────────────────────────────────────
drv_indices = {dn: 0 for dn in drv_telemetry}

STEP = 0.5        # Každých 0.5s simulačního času
PUSH_INTERVAL = 5 # Leaderboard push každých 5 ticků

tick = 0
current_t = t_start

try:
    while current_t <= t_end:
        tick += 1
        wall_start = time.time()

        # ── Pozice jezdců ──────────────────────────────────────
        positions = {}
        for drv_num, tel_list in drv_telemetry.items():
            if not tel_list:
                continue
            idx = drv_indices[drv_num]
            while idx < len(tel_list) - 1 and tel_list[idx]["t"] < current_t:
                idx += 1
            drv_indices[drv_num] = idx

            if 0 < idx < len(tel_list):
                p1, p2 = tel_list[idx-1], tel_list[idx]
                dt = p2["t"] - p1["t"]
                if 0 < dt < 5.0:
                    r = (current_t - p1["t"]) / dt
                    positions[drv_num] = {
                        "X": p1["X"] + (p2["X"] - p1["X"]) * r,
                        "Y": p1["Y"] + (p2["Y"] - p1["Y"]) * r,
                    }
                else:
                    positions[drv_num] = {"X": p1["X"], "Y": p1["Y"]}

        if positions:
            _parse_position({"Entries": positions})

        # ── Leaderboard + kola ────────────────────────────────
        if tick % PUSH_INTERVAL == 0:
            timing_lines = {}
            current_laps_per_drv = {}

            for drv_num, laps_list in drv_laps_data.items():
                last_lap = next((l for l in reversed(laps_list) if l["t"] <= current_t), None)
                current_lap = last_lap["lap"] if last_lap else 1
                current_laps_per_drv[drv_num] = current_lap
                timing_lines[drv_num] = {
                    "Position": str(list(drv_telemetry.keys()).index(drv_num) + 1),
                    "GapToLeader": "+0.000" if list(drv_telemetry.keys()).index(drv_num) == 0 else f"+{(list(drv_telemetry.keys()).index(drv_num) * 1.234):.3f}",
                    "LastLapTime": {"Value": "1:30.000"},
                }

            _parse_timing_data({"Lines": timing_lines})

            # LapCount
            max_lap = max(current_laps_per_drv.values(), default=1)
            _parse_lap_count({"CurrentLap": max_lap, "TotalLaps": total_laps})

        # ── Výstup do konzole ─────────────────────────────────
        elapsed_pct = (current_t - t_start) / (t_end - t_start) * 100
        sys.stdout.write(f"\r⏱  t={current_t:.1f}s ({elapsed_pct:.1f}%) | Jezdci: {len(positions)} | Tick: {tick}")
        sys.stdout.flush()

        current_t += STEP

        # Reálný čas = STEP / speed
        elapsed_wall = time.time() - wall_start
        sleep_time = max(0, STEP / args.speed - elapsed_wall)
        time.sleep(sleep_time)

except KeyboardInterrupt:
    pass

print(f"\n\n🏁 Mock Live Stream ukončen v t={current_t:.1f}s")

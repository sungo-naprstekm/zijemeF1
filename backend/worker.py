import os
import time
import json
import asyncio
import threading
import gc
import psutil
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import date
from dotenv import load_dotenv
import pandas as pd
import numpy as np
import fastf1
from fastf1 import plotting
from supabase import create_client, Client

# ──────────────────────────────────────────────
# Memory helper
# ──────────────────────────────────────────────
def print_memory_usage(tag=""):
    process = psutil.Process(os.getpid())
    mem = process.memory_info().rss / (1024 * 1024)
    print(f"[MEMORY] {tag} - RAM: {mem:.2f} MB")

# ──────────────────────────────────────────────
# Globální stav (sdílený mezi HTTP serverem a asyncio smyčkou)
# ──────────────────────────────────────────────
current_config = {
    "year": 2023, 
    "round": "Monza",
    "start_lap": 1,
    "playback_state": "paused"
}
restart_event = threading.Event()   # HTTP handler nastaví → main_loop restartuje replay

# ──────────────────────────────────────────────
# HTTP API server pro Render.com (Free Web Service)
# ──────────────────────────────────────────────
class ApiHandler(BaseHTTPRequestHandler):
    def _send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/':
            self._send_json(200, {"status": "ALIVE", "config": current_config})

        elif parsed.path == '/current-session':
            self._send_json(200, current_config)

        elif parsed.path == '/schedule':
            params = parse_qs(parsed.query)
            year = int(params.get('year', [2023])[0])
            try:
                schedule = fastf1.get_event_schedule(year, include_testing=False)
                today = date.today()
                # Vrátit pouze odjeté závody (EventDate < dnes)
                past = schedule[pd.to_datetime(schedule['EventDate']).dt.date < today]
                races = [
                    {"round": int(row['RoundNumber']), "name": row['EventName'], "country": row['Country']}
                    for _, row in past.iterrows()
                    if row.get('EventFormat', '') != 'testing'
                ]
                self._send_json(200, {"year": year, "races": races})
            except Exception as e:
                self._send_json(500, {"error": str(e)})

        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == '/set-session':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length) or b'{}')
            year = int(body.get('year', current_config['year']))
            round_name = body.get('round', current_config['round'])
            start_lap = int(body.get('start_lap', 1))

            current_config['year'] = year
            current_config['round'] = round_name
            current_config['start_lap'] = start_lap
            current_config['playback_state'] = "paused"
            
            restart_event.set()   # Signál pro main_loop
            print(f"[API] Nová konfigurace: {year} – {round_name} (Od kola: {start_lap})")
            self._send_json(200, {"status": "ok", "config": current_config})
        
        elif self.path == '/playback':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length) or b'{}')
            action = body.get('action')
            if action in ['play', 'pause']:
                current_config['playback_state'] = action
                print(f"[API] Playback state: {action}")
                self._send_json(200, {"status": "ok", "state": action})
            else:
                self._send_json(400, {"error": "Invalid action"})
                
        else:
            self._send_json(404, {"error": "Not found"})

    def log_message(self, format, *args):
        return  # Ticho v logu

def run_api_server():
    port = int(os.environ.get('PORT', 8080))
    server = HTTPServer(('0.0.0.0', port), ApiHandler)
    print(f"API server běží na portu {port}")
    server.serve_forever()


# ──────────────────────────────────────────────
# Příprava Supabase
# ──────────────────────────────────────────────
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Zadej SUPABASE_URL a SUPABASE_KEY do .env souboru!")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Konfigurace FastF1 cache
if not os.path.exists("cache"):
    os.makedirs("cache")
fastf1.Cache.enable_cache('cache')

TEAM_COLORS = {
    "RBR": "#3671C6", "FER": "#E80020", "MER": "#27F4D2",
    "MCL": "#FF8000", "AST": "#229971", "ALN": "#0093CC",
    "WIL": "#64C4FF", "VRB": "#6692FF", "SAU": "#52E252", "HAA": "#B6BABD"
}

def get_team_color(team_name):
    mapping = {
        "Red Bull Racing": "RBR", "Ferrari": "FER", "Mercedes": "MER",
        "McLaren": "MCL", "Aston Martin": "AST", "Alpine": "ALN",
        "Williams": "WIL", "RB": "VRB", "Kick Sauber": "SAU",
        "Sauber": "SAU", "Alfa Romeo": "SAU", "Haas F1 Team": "HAA",
        "AlphaTauri": "VRB"
    }
    return TEAM_COLORS.get(mapping.get(team_name, "HAA"), "#FFFFFF")


# ──────────────────────────────────────────────
# Pomocné funkce pro bezpečné parsování (LL.md)
# ──────────────────────────────────────────────
def safe_timedelta_str(val):
    """Převede Timedelta / float / NaT na string sekund, nebo ''."""
    if val is None or (isinstance(val, float) and (pd.isna(val) or np.isnan(val))):
        return ""
    if isinstance(val, pd.Timedelta):
        if pd.isna(val):
            return ""
        return f"{val.total_seconds():.3f}"
    if isinstance(val, (int, float)):
        return f"{val:.3f}"
    return str(val)

def format_lap_time(val):
    """Naformátuje Timedelta na MM:SS.mmm nebo SS.mmm"""
    if pd.isna(val) or not isinstance(val, pd.Timedelta):
        return ""
    total_seconds = val.total_seconds()
    if total_seconds < 0:
        return ""
    minutes = int(total_seconds // 60)
    seconds = total_seconds % 60
    if minutes > 0:
        return f"{minutes}:{seconds:06.3f}"
    else:
        return f"{seconds:.3f}"


def parse_flag_from_messages(race_control_msgs, current_lap):
    """
    Zjistí aktuální vlajku ze zpráv Race Control pro dané kolo.
    Vrací posledně platný flag (Green/SC/VSC/Red/Chequered).
    """
    if race_control_msgs is None or race_control_msgs.empty:
        return "Green"

    # Filtrujeme zprávy relevantní do aktuálního kola (včetně)
    # RaceControlMessages mají sloupec 'Lap' (int) a 'Category' + 'Message'
    relevant = race_control_msgs[race_control_msgs.get('Lap', pd.Series(dtype=int)) <= current_lap]
    if relevant.empty:
        return "Green"

    # Procházíme zprávy od nejnovější
    flag = "Green"
    for _, msg in relevant.iterrows():
        category = str(msg.get('Category', '')).lower()
        message = str(msg.get('Message', '')).lower()

        if 'red flag' in message or category == 'red':
            flag = "Red"
        elif 'safety car' in message and 'virtual' not in message:
            if 'in this lap' in message or 'deployed' in message or 'safety car' in category:
                flag = "SC"
        elif 'virtual safety car' in message or 'vsc' in message.lower():
            flag = "VSC"
        elif 'green' in message and ('light' in message or 'flag' in message or 'clear' in message):
            flag = "Green"
        elif 'chequered' in message or 'finish' in message:
            flag = "Chequered"

    return flag


# ──────────────────────────────────────────────
# Replay engine
# ──────────────────────────────────────────────
async def run_replay(year: int, round_name: str):
    print_memory_usage("Start run_replay")
    
    # Explicit garbage collection before loading new massive data
    gc.collect()
    print_memory_usage("Po uvolnění paměti pro nový replay")

    print(f"Stahuji data: {year} – {round_name}...")
    session = fastf1.get_session(year, round_name, 'R')
    # messages=True pro vlajky (RE-3)
    session.load(telemetry=True, weather=True, laps=True, messages=True)
    print("Data načtena. Připravuji vysílání...")
    print_memory_usage("Po načtení dat do FastF1 Session")

    results = session.results
    if results.empty:
        print("Žádná data výsledků. Přeskakuji replay.")
        return

    drivers_abbr = list(results['Abbreviation']) if not results.empty else []

    # ──── Zjistit celkový počet kol ────
    all_laps = session.laps
    if all_laps.empty:
        print("Žádná data kol. Přeskakuji replay.")
        return

    total_laps = int(all_laps['LapNumber'].max())
    print(f"Celkem kol: {total_laps}")

    # ──── Race Control Messages (pro vlajky) ────
    race_control_msgs = None
    try:
        rcm = session.race_control_messages
        if rcm is not None and not rcm.empty:
            race_control_msgs = rcm
            print(f"Race Control Messages: {len(rcm)} zpráv načteno.")
        else:
            print("Žádné Race Control Messages – vlajky budou vždy Green.")
    except Exception as e:
        print(f"Chyba načítání Race Control Messages: {e}")

    # ──── Weather data (pro teploty) ────
    weather_data = None
    try:
        wd = session.weather_data
        if wd is not None and not wd.empty:
            weather_data = wd
            print(f"Weather data: {len(wd)} záznamů.")
    except Exception as e:
        print(f"Chyba načítání weather dat: {e}")

    # ──── Obrys trati z pos_data (nejrychlejší kolo) ────
    pos_norm_bounds = None
    try:
        lap = session.laps.pick_fastest()
        pos_data = lap.get_pos_data()

        if not pos_data.empty:
            all_x = pos_data['X'].tolist()
            all_y = pos_data['Y'].tolist()

            x_min, x_max = min(all_x), max(all_x)
            y_min, y_max = min(all_y), max(all_y)
            
            x_range = max(x_max - x_min, 1)
            y_range = max(y_max - y_min, 1)
            
            # Map dimensions
            max_dim = 900
            scale = max_dim / max(x_range, y_range)
            
            # Calculate offsets to center the map
            scaled_width = x_range * scale
            scaled_height = y_range * scale
            x_offset = (1000 - scaled_width) / 2
            y_offset = (1000 - scaled_height) / 2

            outline_points = []
            step_size = max(1, len(pos_data) // 500)
            for i in range(0, len(pos_data), step_size):
                row = pos_data.iloc[i]
                outline_points.append({
                    "x": round((float(row['X']) - x_min) * scale + x_offset, 2),
                    "y": round((float(row['Y']) - y_min) * scale + y_offset, 2)
                })

            pos_norm_bounds = {
                "x_min": x_min, 
                "y_min": y_min, 
                "scale": scale,
                "x_offset": x_offset,
                "y_offset": y_offset
            }

            supabase.table("track_outline").upsert({
                "id": 1,
                "points": outline_points,
                "circuit_name": f"{year} {round_name}"
            }).execute()
            print(f"Obrys tratě uložen ({len(outline_points)} bodů).")
        else:
            print("Žádná poziční data pro obrys.")
    except Exception as e:
        print(f"Track outline chyba: {e}")

    # ──── Smazat starý leaderboard a telemetrii ────
    try:
        supabase.table("leaderboard").delete().neq("driver_number", "0").execute()
        supabase.table("telemetry").delete().neq("id", 0).execute()
    except Exception as e:
        print("Chyba mazání:", e)

    # ──── Zapsat počáteční leaderboard (startovní rošt = pozice z kola 1) ────
    leaderboard_inserts = []
    for _, row in results.iterrows():
        driver_num = str(row['DriverNumber'])
        position = int(row.get('GridPosition', 99)) if pd.notna(row.get('GridPosition')) else 99
        leaderboard_inserts.append({
            "driver_number": driver_num,
            "position": position,
            "broadcast_name": str(row['Abbreviation']),
            "team_color": get_team_color(str(row.get('TeamName', ''))),
            "gap_to_leader": "",
            "interval": "",
            "compound": "S",
            "tyre_age": 1,
            "in_pit": False
        })
    if leaderboard_inserts:
        supabase.table("leaderboard").insert(leaderboard_inserts).execute()
        print(f"Počáteční leaderboard uložen ({len(leaderboard_inserts)} jezdců).")

    # ──── Počáteční session state ────
    initial_track_temp = 0.0
    initial_air_temp = 0.0
    if weather_data is not None and not weather_data.empty:
        initial_track_temp = float(weather_data.iloc[0].get('TrackTemp', 0))
        initial_air_temp = float(weather_data.iloc[0].get('AirTemp', 0))

    supabase.table("session_state").upsert({
        "id": 1,
        "flag": "Green",
        "remaining_laps": total_laps,
        "track_temp": initial_track_temp,
        "air_temp": initial_air_temp
    }).execute()

    # ──── Pre-load pozičních dat pro všech 20 jezdců (RE-2) ────
    print("Načítám poziční data pro všechny jezdce...")
    driver_pos_data = {}   # { abbr: DataFrame s X, Y, SessionTime }
    for abbr in drivers_abbr:
        try:
            driver_laps = all_laps.pick_drivers(abbr)
            if driver_laps.empty:
                continue
            pos = driver_laps.get_pos_data()
            if pos is not None and not pos.empty and 'X' in pos.columns and 'Y' in pos.columns:
                driver_pos_data[abbr] = pos
        except Exception as e:
            print(f"  Pozice pro {abbr}: přeskočeno ({e})")
    print(f"Poziční data načtena pro {len(driver_pos_data)} jezdců.")

    # ──── Pre-load telemetrie pro všechny jezdce (speed, RPM atd.) ────
    print("Načítám telemetrii pro všechny jezdce...")
    driver_telem_data = {}   # { abbr: DataFrame }
    for abbr in drivers_abbr:
        try:
            driver_laps = all_laps.pick_drivers(abbr)
            if driver_laps.empty:
                continue
            telem = driver_laps.get_telemetry()
            if telem is not None and not telem.empty:
                driver_telem_data[abbr] = telem
        except Exception as e:
            print(f"  Telemetrie pro {abbr}: přeskočeno ({e})")
    print(f"Telemetrická data načtena pro {len(driver_telem_data)} jezdců.")

    # Mapování abbr → driver_number
    abbr_to_num = {}
    for _, row in results.iterrows():
        abbr_to_num[str(row['Abbreviation'])] = str(row['DriverNumber'])

    # ──── Spočítat průměrnou dobu kola pro timing simulace ────
    # Vezmeme mediánový čas kola pro realistický interval
    median_lap_secs = all_laps['LapTime'].dropna().apply(lambda x: x.total_seconds()).median()
    if pd.isna(median_lap_secs) or median_lap_secs <= 0:
        median_lap_secs = 90.0  # fallback
    # Budeme simulovat každé kolo se sub-kroky (position stream uvnitř kola)
    # Pro LIVE playback (1:1) nastavíme fixní rychlost (např. 2 updaty za vteřinu)
    STEPS_PER_SECOND = 2.0
    sim_step_sleep = 1.0 / STEPS_PER_SECOND

    print(f"Začíná LIVE STREAM Replay: {year} {round_name} ({total_laps} kol, 1:1 playback, {STEPS_PER_SECOND} fps)...")

    # ══════════════════════════════════════════════
    # HLAVNÍ SMYČKA: kolo po kole
    # ══════════════════════════════════════════════
    start_lap = current_config.get("start_lap", 1)
    
    current_track_temp = initial_track_temp
    current_air_temp = initial_air_temp
    driver_fastest_lap = {}
    driver_fastest_lap_secs = {}

    for current_lap in range(start_lap, total_laps + 1):
        if restart_event.is_set():
            print("Zastaven replay – nová konfigurace požadována.")
            break

        # Zastavení dokud není "playing"
        while current_config.get("playback_state") == "paused":
            if restart_event.is_set():
                print("Zastaven replay během pauzy.")
                break
            time.sleep(0.5)

        if restart_event.is_set():
            break

        lap_start = time.time()

        # ──── RE-1: Leaderboard UPSERT ────
        lap_data = all_laps[all_laps['LapNumber'] == current_lap]
        if not lap_data.empty:
            lb_upserts = []
            for _, lap_row in lap_data.iterrows():
                abbr = str(lap_row.get('Driver', ''))
                driver_num = abbr_to_num.get(abbr)
                if not driver_num:
                    continue

                position = int(lap_row.get('Position', 99)) if pd.notna(lap_row.get('Position')) else 99
                gap_to_leader = safe_timedelta_str(lap_row.get('GapToLeader'))
                interval = safe_timedelta_str(lap_row.get('IntervalToPositionAhead'))
                compound = str(lap_row.get('Compound', 'S')) if pd.notna(lap_row.get('Compound')) else 'S'
                tyre_life = int(lap_row.get('TyreLife', 1)) if pd.notna(lap_row.get('TyreLife')) else 1

                # Pit detection: PitInTime / PitOutTime
                is_in_pit = False
                pit_in = lap_row.get('PitInTime')
                pit_out = lap_row.get('PitOutTime')
                if pd.notna(pit_in) or pd.notna(pit_out):
                    is_in_pit = True

                last_lap_td = lap_row.get('LapTime')
                last_lap_str = format_lap_time(last_lap_td)
                sector1 = safe_timedelta_str(lap_row.get('Sector1Time'))
                sector2 = safe_timedelta_str(lap_row.get('Sector2Time'))
                sector3 = safe_timedelta_str(lap_row.get('Sector3Time'))

                is_pb = False
                fastest_lap_str = driver_fastest_lap.get(driver_num, "")
                if pd.notna(last_lap_td) and hasattr(last_lap_td, 'total_seconds'):
                    lap_secs = last_lap_td.total_seconds()
                    if lap_secs > 0:
                        prev_best = driver_fastest_lap_secs.get(driver_num, 999999)
                        if lap_secs <= prev_best: # Update if faster or equal
                            driver_fastest_lap_secs[driver_num] = lap_secs
                            fastest_lap_str = last_lap_str
                            driver_fastest_lap[driver_num] = last_lap_str
                            is_pb = True

                lb_upserts.append({
                    "driver_number": driver_num,
                    "position": position,
                    "broadcast_name": abbr,
                    "team_color": get_team_color(str(lap_row.get('Team', ''))),
                    "gap_to_leader": gap_to_leader,
                    "interval": interval,
                    "compound": compound,
                    "tyre_age": tyre_life,
                    "in_pit": is_in_pit,
                    "last_lap_time": last_lap_str,
                    "fastest_lap_time": fastest_lap_str,
                    "sector1": sector1,
                    "sector2": sector2,
                    "sector3": sector3,
                    "is_personal_best": is_pb
                })

            if lb_upserts:
                try:
                    supabase.table("leaderboard").upsert(lb_upserts).execute()
                except Exception as e:
                    print(f"  [Kolo {current_lap}] Leaderboard UPSERT chyba: {e}")

        # ──── RE-3: Session State Update ────
        remaining = max(0, total_laps - current_lap)
        flag = parse_flag_from_messages(race_control_msgs, current_lap)

        # Teploty: nejbližší weather záznam k aktuálnímu kolu
        if weather_data is not None and not weather_data.empty:
            try:
                # Vezmeme čas half-way přes kolo lídra pro lookup
                leader_laps = lap_data[lap_data.get('Position', pd.Series()) == 1] if not lap_data.empty else pd.DataFrame()
                if not leader_laps.empty:
                    leader_lap = leader_laps.iloc[0]
                    lap_session_time = leader_lap.get('LapStartTime')
                    if pd.notna(lap_session_time) and 'Time' in weather_data.columns:
                        # Najít nejbližší weather záznam
                        time_diffs = (weather_data['Time'] - lap_session_time).abs()
                        nearest_idx = time_diffs.idxmin()
                        nearest_weather = weather_data.loc[nearest_idx]
                        current_track_temp = float(nearest_weather.get('TrackTemp', current_track_temp))
                        current_air_temp = float(nearest_weather.get('AirTemp', current_air_temp))
            except Exception as e:
                pass  # Fallback na poslední známé teploty

        try:
            supabase.table("session_state").upsert({
                "id": 1,
                "flag": flag,
                "remaining_laps": remaining,
                "track_temp": round(current_track_temp, 1),
                "air_temp": round(current_air_temp, 1)
            }).execute()
        except Exception as e:
            print(f"  [Kolo {current_lap}] Session state chyba: {e}")

        print(f"[Kolo {current_lap}/{total_laps}] Flag={flag}, Zbývá={remaining}, Trať={current_track_temp}°C, Jezdců={len(lap_data)}")

        # ──── RE-2: Streamování X/Y pozic pro VŠECHNY jezdce ────
        # Spočítáme session time range pro toto kolo
        lap_start_time = None
        lap_end_time = None
        if not lap_data.empty:
            starts = lap_data['LapStartTime'].dropna()
            ends = (lap_data['LapStartTime'] + lap_data['LapTime']).dropna()
            if not starts.empty:
                lap_start_time = starts.min()
            if not ends.empty:
                lap_end_time = ends.max()
            elif not starts.empty:
                # Fallback: přidáme mediánový čas kola
                lap_end_time = starts.max() + pd.Timedelta(seconds=median_lap_secs)

        if lap_start_time is not None and lap_end_time is not None:
            time_span = lap_end_time - lap_start_time
            lap_seconds = time_span.total_seconds()
            if lap_seconds > 0:
                current_lap_steps = int(lap_seconds * STEPS_PER_SECOND)
                for step_i in range(current_lap_steps):
                    # --- CHYBĚJÍCÍ KONTROLA PAUZY ---
                    while current_config.get("playback_state") == "paused":
                        if restart_event.is_set():
                            break
                        time.sleep(0.1)
                    # --------------------------------
                    
                    if restart_event.is_set():
                        break

                    # Interpolovaný session time v rámci kola
                    frac = step_i / current_lap_steps if current_lap_steps > 0 else 0
                    current_session_time = lap_start_time + frac * time_span
                    current_secs = current_session_time.total_seconds()

                    payloads = []
                    for abbr, pos_df in driver_pos_data.items():
                        # Omezíme v tomto MVP telemetrii jen na VER a LEC (optimalizace DB a realtime fronty)
                        if abbr not in ['VER', 'LEC']:
                            continue

                        driver_num = abbr_to_num.get(abbr)
                        if not driver_num:
                            continue

                        try:
                            # Najít nejbližší pozici v čase
                            time_col = pos_df['SessionTime'] if 'SessionTime' in pos_df.columns else pos_df.get('Time')
                            if time_col is None:
                                continue
                            diffs = (time_col - current_session_time).abs()
                            nearest_idx = diffs.idxmin()
                            r = pos_df.loc[nearest_idx]

                            x_val = r.get('X')
                            y_val = r.get('Y')
                            if pd.isna(x_val) or pd.isna(y_val):
                                continue

                            payload = {
                                "id": int(driver_num),
                                "driver_number": driver_num,
                                "session_time": round(current_secs, 3),
                                "speed": 0,
                                "rpm": 0,
                                "gear": 0,
                                "throttle": 0,
                                "brake": 0,
                            }

                            # Normalizace X/Y telemetrického bodu stejnou rovnicí jako obrys
                            if pos_norm_bounds:
                                bounds = pos_norm_bounds
                                payload["x_pos"] = round((float(x_val) - bounds['x_min']) * bounds['scale'] + bounds['x_offset'], 2)
                                payload["y_pos"] = round((float(y_val) - bounds['y_min']) * bounds['scale'] + bounds['y_offset'], 2)

                            # Doplnit telemetrii (speed, RPM, ...) pokud máme
                            telem_df = driver_telem_data.get(abbr)
                            if telem_df is not None and 'SessionTime' in telem_df.columns:
                                t_diffs = (telem_df['SessionTime'] - current_session_time).abs()
                                # Hledáme jen pokud je blízko (max 2s)
                                nearest_t_idx = t_diffs.idxmin()
                                if t_diffs.loc[nearest_t_idx].total_seconds() < 2.0:
                                    tr = telem_df.loc[nearest_t_idx]
                                    payload["speed"] = int(tr.get('Speed', 0)) if pd.notna(tr.get('Speed')) else 0
                                    payload["rpm"] = int(tr.get('RPM', 0)) if pd.notna(tr.get('RPM')) else 0
                                    payload["gear"] = int(tr.get('nGear', 0)) if pd.notna(tr.get('nGear')) else 0
                                    payload["throttle"] = int(tr.get('Throttle', 0)) if pd.notna(tr.get('Throttle')) else 0
                                    payload["brake"] = int(tr.get('Brake', 0)) if pd.notna(tr.get('Brake')) else 0

                            payloads.append(payload)

                        except Exception:
                            continue

                    if payloads:
                        try:
                            supabase.table("telemetry").upsert(payloads).execute()
                        except Exception as e:
                            print(f"  Telemetry upsert chyba: {e}")

                    time.sleep(sim_step_sleep)
        else:
            # Nemáme timing data pro toto kolo – jen počkáme
            time.sleep(SIM_LAP_DURATION)

    # ──── Konec závodu ────
    if not restart_event.is_set():
        supabase.table("session_state").upsert({
            "id": 1,
            "flag": "Chequered",
            "remaining_laps": 0,
            "track_temp": round(current_track_temp if 'current_track_temp' in locals() else 0, 1),
            "air_temp": round(current_air_temp if 'current_air_temp' in locals() else 0, 1)
        }).execute()
        print(f"Replay dokončen: {year} {round_name}")

    # ──── Explicitní uvolnění paměti (Garbage Collection & Deletion) ────
    print_memory_usage("Před uvolňováním obřích dat")
    # Smažeme obří slovníky explicitně
    del driver_pos_data
    del driver_telem_data
    del all_laps
    del session
    gc.collect()
    print_memory_usage("Po uvolnění obřích dat a session")


# ──────────────────────────────────────────────
# Hlavní smyčka
# ──────────────────────────────────────────────
async def main_loop():
    while True:
        # Vymaž restart flag před novým spuštěním
        restart_event.clear()
        year = current_config["year"]
        round_name = current_config["round"]
        try:
            await asyncio.to_thread(lambda: None)   # yield smyčce
            await asyncio.get_event_loop().run_in_executor(None, lambda: None)
            await run_replay(year, round_name)
        except Exception as e:
            print(f"Kritická chyba v replay: {e}")

        if not restart_event.is_set():
            print("Replay skončil. Čekám 10s před novým puštěním...")
            for _ in range(100):   # 10s s kontrolou každých 100ms
                if restart_event.is_set():
                    break
                await asyncio.sleep(0.1)


if __name__ == "__main__":
    threading.Thread(target=run_api_server, daemon=True).start()
    asyncio.run(main_loop())

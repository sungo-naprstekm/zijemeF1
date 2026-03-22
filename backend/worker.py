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
    "year": None, 
    "round": "",
    "start_lap": 1,
    "playback_state": "idle"
}
restart_event = threading.Event()   # HTTP handler nastaví → main_loop restartuje replay
state_lock = threading.Lock()

app_logs = []

def add_log(msg):
    t = time.strftime("%H:%M:%S")
    log_obj = {"id": time.time(), "time": t, "msg": msg}
    with state_lock:
        app_logs.insert(0, log_obj)
        if len(app_logs) > 500:
            app_logs.pop()
    print(f"LOG: {msg}")

def fire_and_forget_upsert(table, payload):
    try:
        supabase.table(table).upsert(payload).execute()
    except Exception as e:
        print(f"Chyba asynchronniho upsertu ({table}): {e}")

# ──────────────────────────────────────────────
# Helper functions for API
# ──────────────────────────────────────────────
def get_races_for_year(year):
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
        return {"year": year, "races": races}
    except Exception as e:
        return {"error": str(e)}

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
            with state_lock:
                config_copy = current_config.copy()
            self._send_json(200, config_copy)

        elif parsed.path == '/logs':
            with state_lock:
                logs_copy = list(app_logs)
            self._send_json(200, {"logs": logs_copy})

        elif parsed.path == '/schedule':
            params = parse_qs(parsed.query)
            year = int(params.get('year', [2023])[0])
            races = get_races_for_year(year)
            self._send_json(200, races)

        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == '/set-session':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            req = json.loads(post_data.decode('utf-8'))
            
            year = req.get('year')
            round_name = req.get('round')
            start_lap = req.get('start_lap', 1)
            
            with state_lock:
                current_config['year'] = year
                current_config['round'] = round_name
                current_config['start_lap'] = start_lap
                current_config['playback_state'] = "paused"
            
            restart_event.set()   # Signál pro main_loop
            print(f"[API] Nová konfigurace: {year} – {round_name} (Od kola: {start_lap})")
            add_log(f"Přijat požadavek na spuštění {year} - {round_name}.")
            self._send_json(200, {"status": "ok", "config": current_config})
        
        elif self.path == '/playback':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            req = json.loads(post_data.decode('utf-8'))
            action = req.get('action')
            
            if action in ['play', 'pause']:
                with state_lock:
                    current_config['playback_state'] = action
                print(f"[API] Playback state změněn na: {action}")
                add_log(f"Uživatel změnil simulaci na {action}.")
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
    if pd.isna(val):
        return ""
    if isinstance(val, pd.Timedelta):
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


def prepare_leaderboard_data(lap_row, prev_best_secs=999999):
    """
    Vyextrahuje logiku pro přípravu dat leaderboardu, zejména výpočty gapů, 
    intervalů a bezpečnou konverzi chybějících (NaN, NaT, atd.) hodnot z Pandas
    do standardních Python typů (None, "", int, str), aby je přijal Supabase.
    """
    update_data = {}
    
    update_data['gap_to_leader'] = safe_timedelta_str(lap_row.get('GapToLeader'))
    update_data['interval'] = safe_timedelta_str(lap_row.get('IntervalToPositionAhead'))
    
    compound = lap_row.get('Compound')
    update_data['compound'] = str(compound) if pd.notna(compound) else 'S'
    
    tyre_life = lap_row.get('TyreLife')
    update_data['tyre_age'] = int(tyre_life) if pd.notna(tyre_life) else 1
    
    pit_in = lap_row.get('PitInTime')
    pit_out = lap_row.get('PitOutTime')
    update_data['in_pit'] = True if (pd.notna(pit_in) or pd.notna(pit_out)) else False
    
    last_lap_td = lap_row.get('LapTime')
    last_lap_str = format_lap_time(last_lap_td)
    update_data['last_lap_time'] = last_lap_str
    
    update_data['sector1'] = safe_timedelta_str(lap_row.get('Sector1Time'))
    update_data['sector2'] = safe_timedelta_str(lap_row.get('Sector2Time'))
    update_data['sector3'] = safe_timedelta_str(lap_row.get('Sector3Time'))
    
    update_data['is_personal_best'] = False
    update_data['new_best_lap_secs'] = prev_best_secs
    update_data['fastest_lap_time'] = ""

    if pd.notna(last_lap_td) and hasattr(last_lap_td, 'total_seconds'):
        lap_secs = last_lap_td.total_seconds()
        if lap_secs > 0:
            if lap_secs <= prev_best_secs:
                update_data['is_personal_best'] = True
                update_data['new_best_lap_secs'] = lap_secs
                update_data['fastest_lap_time'] = last_lap_str

    return update_data


def parse_flag_from_messages(race_control_msgs, current_lap):
    """
    Zjistí aktuální vlajku ze zpráv Race Control pro dané kolo.
    Vrací posledně platný flag (Green/SC/VSC/Red/Chequered).
    """
    if race_control_msgs is None or race_control_msgs.empty:
        return "Green"

    # Filtrujeme zprávy relevantní do aktuálního kola (včetně)
    # RaceControlMessages mají sloupec 'Lap' (int) a 'Category' + 'Message'
    if 'Lap' in race_control_msgs.columns:
        relevant = race_control_msgs[race_control_msgs['Lap'] <= current_lap]
    else:
        relevant = pd.DataFrame()
        
    flag_val = "Green"
    if not relevant.empty:
        # Procházíme zprávy od nejnovější
        for _, msg in relevant.iterrows():
            category = str(msg.get('Category', '')).lower()
            message = str(msg.get('Message', '')).lower()

            if 'red flag' in message or category == 'red':
                flag_val = "Red"
            elif 'safety car' in message and 'virtual' not in message:
                if 'in this lap' in message or 'deployed' in message or 'safety car' in category:
                    flag_val = "SC"
            elif 'virtual safety car' in message or 'vsc' in message.lower():
                flag_val = "VSC"
            elif 'green' in message and ('light' in message or 'flag' in message or 'clear' in message):
                flag_val = "Green"
            elif 'chequered' in message or 'finish' in message:
                flag_val = "Chequered"

    return flag_val


# ──────────────────────────────────────────────
# Replay engine
# ──────────────────────────────────────────────
async def run_replay(year: int, round_name: str):
    print_memory_usage("Start run_replay")
    
    # Explicit garbage collection before loading new massive data
    gc.collect()
    print_memory_usage("Po uvolnění paměti pro nový replay")

    print(f"Stahuji data: {year} – {round_name}...")
    add_log(f"Inicializuji stažení dat FastF1 pro {year} {round_name}... (Bude trvat 10-60s) ⏳")
    
    try:
        session = fastf1.get_session(year, round_name, 'R')
        # messages=True pro vlajky (RE-3)
        # telemetry=True je nutné pro načtení pozičních dat (X, Y) obrysu trati a jezdců
        session.load(telemetry=True, weather=True, laps=True, messages=True)
    except Exception as e:
        add_log(f"Chyba parsování FastF1: {e}")
        return

    print("Data načtena. Připravuji vysílání...")
    add_log(f"Konverze FastF1 balíčku {year} {round_name} je hotova ✅")
    print_memory_usage("Po načtení dat do FastF1 Session")

    results = session.results
    if results.empty:
        print("Žádná data výsledků. Přeskakuji replay.")
        add_log("Dataset závodu nemá žádné výsledky. Nebylo odjeto? Zastavuji.")
        return

    drivers_abbr = list(results['Abbreviation']) if not results.empty else []

    # ──── Zjistit celkový počet kol ────
    all_laps = session.laps
    if all_laps.empty:
        print("Žádná data kol. Přeskakuji replay.")
        return

    total_laps = int(all_laps['LapNumber'].max())
    print(f"Celkem kol: {total_laps}")
    laps_list = sorted(all_laps['LapNumber'].unique())

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
            add_log(f"Mapový SVG polygon okruhu sestaven a odeslán do databáze ({len(outline_points)} bodů). 🗺️")
        else:
            print("Žádná poziční data pro obrys.")
            add_log("Závod neobsahuje žádná GPS data pro obrys tratě. F1 stream selhal nebo není k dispozici.")
            supabase.table("track_outline").delete().neq("id", 0).execute()
    except Exception as e:
        print(f"Track outline chyba: {e}")
        add_log(f"Kritická chyba při generování SVG polygonu (GPS data nejsou k dispozici): {e}")
        supabase.table("track_outline").delete().neq("id", 0).execute()

    # ──── Smazat starý leaderboard a telemetrii ────
    try:
        add_log("Čištění zbytků staré Supabase relace...")
        supabase.table("leaderboard").delete().neq("driver_number", "0").execute()
        supabase.table("telemetry").delete().neq("id", 0).execute()
    except Exception as e:
        print("Chyba mazání:", e)
        add_log(f"Chyba při mazání starých DB dat: {e}")

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
        asyncio.create_task(asyncio.to_thread(
            fire_and_forget_upsert, "leaderboard", leaderboard_inserts
        ))
        print(f"Počáteční leaderboard uložen ({len(leaderboard_inserts)} jezdců).")

    # ──── Počáteční session state ────
    initial_track_temp = 0.0
    initial_air_temp = 0.0
    if weather_data is not None and not weather_data.empty:
        initial_track_temp = float(weather_data.iloc[0].get('TrackTemp', 0))
        initial_air_temp = float(weather_data.iloc[0].get('AirTemp', 0))

    asyncio.create_task(asyncio.to_thread(
        fire_and_forget_upsert, "session_state", {
            "id": 1,
            "flag": "Green",
            "remaining_laps": total_laps,
            "current_lap": 1,
            "track_temp": initial_track_temp,
            "air_temp": initial_air_temp,
            "total_laps": total_laps
        }
    ))

    # ──── Pre-load pozičních dat pro všech 20 jezdců (RE-2) ────
    print("Načítám poziční data pro všechny jezdce...")
    driver_pos_data = {}   # { abbr: DataFrame s X, Y, SessionTime }
    has_telemetry_error = False

    for abbr in drivers_abbr:
        try:
            driver_laps = all_laps.pick_drivers(abbr)
            if driver_laps.empty:
                continue
            pos = driver_laps.get_telemetry()
            if pos is not None and not pos.empty and 'X' in pos.columns and 'Y' in pos.columns:
                driver_pos_data[abbr] = pos
        except Exception as e:
            has_telemetry_error = True

    if has_telemetry_error:
        add_log("Chybí detailní 2D telemetrická data pro formulky. Pohyb na mapě bude prázdný.")
    else:
        add_log("Transformuji telemetrii pro stream (150+ tisíc bodů). To může přidat 5s... ⏳")
        add_log(f"Stream-ready: Extrahována telemetrie pro {len(driver_pos_data)} aktivních jezdců! 🏎️💨")
        
    print(f"Poziční data načtena pro {len(driver_pos_data)} jezdců.")



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

    # ──── RE-1: Init Leaderboard State (Dynamic) ────
    valid_laps = all_laps.dropna(subset=['LapStartTime', 'LapTime']).copy()
    if not valid_laps.empty:
        valid_laps['LapEndTime'] = valid_laps['LapStartTime'] + valid_laps['LapTime']
    else:
        valid_laps['LapEndTime'] = pd.Series(dtype='timedelta64[ns]')

    driver_state = {}
    for _, row in results.iterrows():
        driver_num = str(row['DriverNumber'])
        grid_pos = int(row.get('GridPosition', 99)) if pd.notna(row.get('GridPosition')) else 99
        driver_state[driver_num] = {
            "driver_number": driver_num,
            "position": grid_pos,
            "broadcast_name": str(row['Abbreviation']),
            "team_color": get_team_color(str(row.get('TeamName', ''))),
            "gap_to_leader": "",
            "interval": "",
            "compound": str(row.get('Compound', 'S')) if pd.notna(row.get('Compound')) else 'S',
            "tyre_age": 1,
            "in_pit": False,
            "last_lap_time": "",
            "fastest_lap_time": "",
            "sector1": "",
            "sector2": "",
            "sector3": "",
            "is_personal_best": False,
            "laps_completed": 0,
            "last_lap_end_time": pd.Timedelta(seconds=0)
        }

    # ══════════════════════════════════════════════
    # HLAVNÍ SMYČKA: kolo po kole
    # ══════════════════════════════════════════════
    start_lap = current_config.get("start_lap", 1)
    
    current_track_temp = initial_track_temp
    current_air_temp = initial_air_temp
    driver_fastest_lap = {}
    driver_fastest_lap_secs = {}

    add_log(f"Stream povolen od kola {start_lap} ze {len(laps_list)} okruhů celkem.")
    
    current_track_temp = None
    current_air_temp = None
    simulated_time = pd.Timedelta(seconds=0) # Track simulated time for weather lookup

    for current_lap in laps_list:
        if current_lap < start_lap:
            continue
            
        # ──── Blokování pauzou z frontendu ────
        with state_lock:
            state = current_config.get("playback_state")
        while state == "paused":
            await asyncio.sleep(0.5)
            if restart_event.is_set():
                print("Replay přerušen během pauzy.")
                return
            with state_lock:
                state = current_config.get("playback_state")

        if restart_event.is_set():
            break

        lap_start = time.time()

        lap_data = all_laps[all_laps['LapNumber'] == current_lap]

        # ──── RE-3: Session State Update ────
        remaining = max(0, total_laps - current_lap)
        flag_val = parse_flag_from_messages(race_control_msgs, current_lap)

        # Teploty: nejbližší weather záznam k aktuálnímu kolu
        if weather_data is not None and not weather_data.empty:
            try:
                # Find the closest weather data point to the current simulated time
                time_diffs = (weather_data['Time'] - simulated_time).abs()
                nearest_idx = time_diffs.idxmin()
                nearest_weather = weather_data.loc[nearest_idx]
                current_track_temp = float(nearest_weather.get('TrackTemp', current_track_temp))
                current_air_temp = float(nearest_weather.get('AirTemp', current_air_temp))
            except Exception as e:
                pass  # Fallback na poslední známé teploty

        # RE-4 Broadcast
        asyncio.create_task(asyncio.to_thread(
            fire_and_forget_upsert, "session_state", {
                "id": 1, 
                "current_lap": int(current_lap),
                "total_laps": int(total_laps),
                "flag": flag_val,
                "track_temp": round(current_track_temp, 1) if current_track_temp is not None else 0.0,
                "air_temp": round(current_air_temp, 1) if current_air_temp is not None else 0.0
            }
        ))

        print(f"[Kolo {current_lap}/{total_laps}] Flag={flag_val}, Zbývá={remaining}, Trať={current_track_temp}°C, Jezdců={len(lap_data)}")

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
                    with state_lock:
                        state = current_config.get("playback_state")
                    while state == "paused":
                        await asyncio.sleep(0.1)
                        if restart_event.is_set():
                            break
                        with state_lock:
                            state = current_config.get("playback_state")
                    # --------------------------------
                    
                    if restart_event.is_set():
                        break

                    # Interpolovaný session time v rámci kola
                    frac = step_i / current_lap_steps if current_lap_steps > 0 else 0
                    current_session_time = lap_start_time + frac * time_span
                    current_secs = current_session_time.total_seconds()

                    # ──── RE-1: Dynamický Leaderboard Update ────
                    update_needed = False
                    if not valid_laps.empty:
                        # Najdi všechna kola, která skončila před aktuálním simulačním časem
                        finished_laps = valid_laps[valid_laps['LapEndTime'] <= current_session_time]
                        for _, lap_row in finished_laps.iterrows():
                            abbr = str(lap_row.get('Driver', ''))
                            driver_num = abbr_to_num.get(abbr)
                            if not driver_num or driver_num not in driver_state:
                                continue
                            
                            lap_no = int(lap_row['LapNumber'])
                            
                            if lap_no > driver_state[driver_num]['laps_completed']:
                                driver_state[driver_num]['laps_completed'] = lap_no
                                driver_state[driver_num]['last_lap_end_time'] = lap_row['LapEndTime']
                                update_needed = True
                                
                                prev_best = driver_fastest_lap_secs.get(driver_num, 999999)
                                update_data = prepare_leaderboard_data(lap_row, prev_best)
                                
                                driver_state[driver_num]['gap_to_leader'] = update_data['gap_to_leader']
                                driver_state[driver_num]['interval'] = update_data['interval']
                                driver_state[driver_num]['compound'] = update_data['compound']
                                driver_state[driver_num]['tyre_age'] = update_data['tyre_age']
                                driver_state[driver_num]['in_pit'] = update_data['in_pit']
                                driver_state[driver_num]['last_lap_time'] = update_data['last_lap_time']
                                driver_state[driver_num]['sector1'] = update_data['sector1']
                                driver_state[driver_num]['sector2'] = update_data['sector2']
                                driver_state[driver_num]['sector3'] = update_data['sector3']
                                driver_state[driver_num]['is_personal_best'] = update_data['is_personal_best']
                                
                                if update_data['is_personal_best']:
                                    driver_fastest_lap_secs[driver_num] = update_data['new_best_lap_secs']
                                    driver_state[driver_num]['fastest_lap_time'] = update_data['fastest_lap_time']

                    if update_needed:
                        def sort_key(st):
                            # Seřadit sestupně podle počtu ujetých kol a vzestupně podle času protnutí cíle
                            return (-st['laps_completed'], st['last_lap_end_time'])
                        
                        sorted_drivers = sorted(driver_state.values(), key=sort_key)
                        
                        lb_upserts = []
                        for i, st in enumerate(sorted_drivers):
                            st['position'] = i + 1
                            db_obj = {k: v for k, v in st.items() if k not in ('laps_completed', 'last_lap_end_time')}
                            lb_upserts.append(db_obj)

                        asyncio.create_task(asyncio.to_thread(
                            fire_and_forget_upsert, "leaderboard", lb_upserts
                        ))

                    payloads = []
                    for abbr, pos_df in driver_pos_data.items():
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
                                "speed": int(r.get('Speed', 0)) if not pd.isna(r.get('Speed', 0)) else 0,
                                "rpm": int(r.get('RPM', 0)) if not pd.isna(r.get('RPM', 0)) else 0,
                                "gear": int(r.get('nGear', 0)) if not pd.isna(r.get('nGear', 0)) else 0,
                                "throttle": int(r.get('Throttle', 0)) if not pd.isna(r.get('Throttle', 0)) else 0,
                                "brake": int(r.get('Brake', 0)) if not pd.isna(r.get('Brake', 0)) else 0,
                                "drs": int(r.get('DRS', 0)) if not pd.isna(r.get('DRS', 0)) else 0,
                            }

                            # Normalizace X/Y telemetrického bodu stejnou rovnicí jako obrys
                            if pos_norm_bounds:
                                bounds = pos_norm_bounds
                                payload["x_pos"] = round((float(x_val) - bounds['x_min']) * bounds['scale'] + bounds['x_offset'], 2)
                                payload["y_pos"] = round((float(y_val) - bounds['y_min']) * bounds['scale'] + bounds['y_offset'], 2)

                            payloads.append(payload)

                        except Exception:
                            continue

                    if payloads:
                        asyncio.create_task(asyncio.to_thread(
                            fire_and_forget_upsert, "telemetry", payloads
                        ))

                    await asyncio.sleep(sim_step_sleep)
            # Aktualizace odhadovaného uběhlého času
            simulated_time += pd.Timedelta(seconds=lap_seconds)
        else:
            add_log(f"Kolo {current_lap} nemá platný časový údaj.")
            await asyncio.sleep(2)

    # ──── Konec závodu ────
    if not restart_event.is_set():
        asyncio.create_task(asyncio.to_thread(
            fire_and_forget_upsert, "session_state", {
                "id": 1,
                "flag": "Chequered",
                "remaining_laps": 0,
                "current_lap": total_laps,
                "track_temp": round(current_track_temp if current_track_temp is not None else 0.0, 1),
                "air_temp": round(current_air_temp if current_air_temp is not None else 0.0, 1),
                "total_laps": total_laps
            }
        ))
        print(f"Replay dokončen: {year} {round_name}")
        add_log("Závod dokončen, posílám šachovnicovou vlajku. 🏁")

    print("Replay úspěšně uzavřen.")
    with state_lock:
        current_config['playback_state'] = 'idle'


# ──────────────────────────────────────────────
# Hlavní smyčka
# ──────────────────────────────────────────────
async def main_loop():
    print("Startuji hlavní smyčku Workeru...")
    add_log("Backend F1 engine inicializován a čeká na pokyny...")
    while True:
        if current_config['playback_state'] == 'idle' or not current_config.get('year'):
            # Jsme v idle stavu, nic se nesimuluje, pouze nasloucháme a čekáme na HTTP API
            time.sleep(1)
            # Pokud HTTP handler nastavil novou konfiguraci (restart_event), tak se cyklus probudí
            if restart_event.is_set():
                restart_event.clear()
            continue

        # Vymaž restart flag před novým spuštěním
        restart_event.clear()

        try:
            year = current_config['year']
            round_name = current_config['round']
        except KeyError:
            print("Chyba: 'year' nebo 'round' není nastaveno v konfiguraci. Přepínám do idle.")
            current_config['playback_state'] = 'idle'
            continue # Zpět na začátek smyčky pro zpracování idle stavu

        try:
            await asyncio.to_thread(lambda: None)   # yield smyčce
            await asyncio.get_event_loop().run_in_executor(None, lambda: None)
            await run_replay(year, round_name)
        except Exception as e:
            print(f"Kritická chyba v replay: {e}")
            add_log(f"Kritická chyba v replay: {e}")
            # V případě chyby přepneme do idle, aby se zabránilo nekonečnému cyklu chyb
            current_config["playback_state"] = "idle"

        if not restart_event.is_set():
            print("Replay skončil. Automaticky pauzuji před připravením nového startu...")
            current_config["playback_state"] = "paused"
            for _ in range(100):   # 10s s kontrolou každých 100ms
                if restart_event.is_set():
                    break
                await asyncio.sleep(0.1)


if __name__ == "__main__":
    threading.Thread(target=run_api_server, daemon=True).start()
    asyncio.run(main_loop())

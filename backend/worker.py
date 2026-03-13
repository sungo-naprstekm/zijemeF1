import os
import time
import json
import asyncio
import threading
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import date
from dotenv import load_dotenv
import pandas as pd
import fastf1
from fastf1 import plotting
from supabase import create_client, Client

# ──────────────────────────────────────────────
# Globální stav (sdílený mezi HTTP serverem a asyncio smyčkou)
# ──────────────────────────────────────────────
current_config = {"year": 2023, "round": "Monza"}
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
            current_config['year'] = year
            current_config['round'] = round_name
            restart_event.set()   # Signál pro main_loop
            print(f"[API] Nová konfigurace: {year} – {round_name}")
            self._send_json(200, {"status": "ok", "config": current_config})
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
# Replay engine
# ──────────────────────────────────────────────
async def run_replay(year: int, round_name: str):
    print(f"Stahuji data: {year} – {round_name}...")
    session = fastf1.get_session(year, round_name, 'R')
    session.load(telemetry=True, weather=True, messages=False)
    print("Data načtena. Připravuji vysílání...")

    results = session.results
    drivers_abbr = list(results['Abbreviation']) if not results.empty else []

    # Smazat starý leaderboard
    try:
        supabase.table("leaderboard").delete().neq("driver_number", "0").execute()
        supabase.table("telemetry").delete().neq("id", 0).execute()
    except Exception as e:
        print("Chyba mazání:", e)

    # Zapsat počáteční leaderboard
    leaderboard_inserts = []
    for _, row in results.iterrows():
        driver_num = str(row['DriverNumber'])
        position = int(row['Position']) if not pd.isna(row['Position']) else 99
        leaderboard_inserts.append({
            "driver_number": driver_num,
            "position": position,
            "broadcast_name": str(row['Abbreviation']),
            "team_color": get_team_color(str(row['TeamName'])),
            "gap_to_leader": "",
            "interval": "",
            "compound": "S",
            "tyre_age": 1,
            "in_pit": False
        })
    if leaderboard_inserts:
        supabase.table("leaderboard").insert(leaderboard_inserts).execute()

    # Session state
    supabase.table("session_state").upsert({
        "id": 1,
        "flag": "Green",
        "remaining_laps": 53,
        "track_temp": float(session.weather_data.iloc[0].get('TrackTemp', 0)),
        "air_temp": float(session.weather_data.iloc[0].get('AirTemp', 0))
    }).execute()

    # Pokusíme se vybrat 2 jezdce pro telemetrii (první 2 k dispozici)
    telem_drivers = []
    for abbr in drivers_abbr[:10]:   # zkusíme prvních 10, vezmeme první 2 s daty
        try:
            telem = session.laps.pick_drivers(abbr).get_telemetry()
            if not telem.empty:
                telem_drivers.append((abbr, telem))
            if len(telem_drivers) >= 2:
                break
        except Exception:
            continue

    if not telem_drivers:
        print("Žádná telemetrická data pro tento závod. Přeskakuji replay.")
        return

    all_times = pd.concat([t['SessionTime'] for _, t in telem_drivers])
    current_time = all_times.min()
    end_time = all_times.max()
    step = pd.Timedelta(seconds=1.0)

    print(f"Začíná LIVE STREAM Replay: {year} {round_name}...")

    while current_time <= end_time:
        # Přerušit replay pokud přišla nová konfigurace
        if restart_event.is_set():
            print("Zastaven replay – nová konfigurace požadována.")
            return

        t_start = time.time()
        payloads = []

        for abbr, telem in telem_drivers:
            row = telem.iloc[(telem['SessionTime'] - current_time).abs().argsort()[:1]]
            if row.empty:
                continue
            r = row.iloc[0]
            driver_num = str(results[results['Abbreviation'] == abbr]['DriverNumber'].iloc[0])
            payloads.append({
                "driver_number": driver_num,
                "session_time": float(r['SessionTime'].total_seconds()),
                "speed": int(r['Speed']) if not pd.isna(r['Speed']) else 0,
                "rpm": int(r['RPM']) if not pd.isna(r['RPM']) else 0,
                "gear": int(r['nGear']) if not pd.isna(r['nGear']) else 0,
                "throttle": int(r['Throttle']) if not pd.isna(r['Throttle']) else 0,
                "brake": int(r['Brake']) if not pd.isna(r['Brake']) else 0,
            })

        if payloads:
            try:
                supabase.table("telemetry").insert(payloads).execute()
                print(f"[{current_time}] Odeslána telemetrie pro {len(payloads)} jezdce.")
            except Exception as e:
                print("Chyba insertu:", e)

        current_time += step
        elapsed = time.time() - t_start
        time.sleep(max(0.0, 1.0 - elapsed))


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

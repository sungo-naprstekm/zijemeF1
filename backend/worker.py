import os
import time
import json
import asyncio
from dotenv import load_dotenv
import pandas as pd
import fastf1
from fastf1 import plotting
from supabase import create_client, Client

# Příprava
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Zadej SUPABASE_URL a SUPABASE_KEY do .env souboru!")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Konfigurace FastF1
# Enable cache
if not os.path.exists("cache"):
    os.makedirs("cache")
fastf1.Cache.enable_cache('cache')

TEAM_COLORS = {
    "RBR": "#3671C6",
    "FER": "#E80020",
    "MER": "#27F4D2",
    "MCL": "#FF8000",
    "AST": "#229971",
    "ALN": "#0093CC",
    "WIL": "#64C4FF",
    "VRB": "#6692FF",
    "SAU": "#52E252",
    "HAA": "#B6BABD"
}

def get_team_color(team_name):
    # Pokusíme se najít podle názvu, jinak default
    mapping = {
        "Red Bull Racing": "RBR",
        "Ferrari": "FER",
        "Mercedes": "MER",
        "McLaren": "MCL",
        "Aston Martin": "AST",
        "Alpine": "ALN",
        "Williams": "WIL",
        "RB": "VRB",
        "Kick Sauber": "SAU",
        "Sauber": "SAU",
        "Alfa Romeo": "SAU",
        "Haas F1 Team": "HAA",
        "AlphaTauri": "VRB"
    }
    short = mapping.get(team_name, "HAA")
    return TEAM_COLORS.get(short, "#FFFFFF")

async def run_replay():
    print("Stahuji data závodu pro replay (může to chvilku trvat)...")
    session = fastf1.get_session(2023, 'Monza', 'R')
    session.load(telemetry=True, weather=True, messages=False)

    print("Data načtena. Připravuji vysílání...")
    
    # 1. Init zapsání do Leaderboardu
    # Vezmeme si jezdce z výsledků
    results = session.results
    
    # Smazať starý leaderboard supabase ať neplevelí replay
    print("Vymazávám starý leaderboard...")
    try:
        supabase.table("leaderboard").delete().neq("driver_number", "0").execute()
        supabase.table("telemetry").delete().neq("id", 0).execute()
    except Exception as e:
        print(e)
    
    print("Zapisuji počáteční leaderboard...")
    leaderboard_inserts = []
    
    for _, row in results.iterrows():
        driver_num = str(row['DriverNumber'])
        position = int(row['Position']) if not pd.isna(row['Position']) else 99
        name = str(row['Abbreviation'])
        team = str(row['TeamName'])
        color = get_team_color(team)
        
        # Příklad inicializace
        leaderboard_inserts.append({
            "driver_number": driver_num,
            "position": position,
            "broadcast_name": name,
            "team_color": color,
            "gap_to_leader": "",
            "interval": "",
            "compound": "S", # Zjednodušení pro MVP, normálně se tahá ze stintů
            "tyre_age": 1,
            "in_pit": False
        })
        
    # Vložit všechny jezdce
    if leaderboard_inserts:
        supabase.table("leaderboard").insert(leaderboard_inserts).execute()

    # 2. Replay smyčka 
    # V MVP simulujeme real-time tak, že budeme iterovat časem závodu po vteřinách
    # Vybereme si 2 hlavní jezdce na porovnávání (zátěž z telemetrie)
    VER = session.laps.pick_driver('VER').get_telemetry()
    LEC = session.laps.pick_driver('LEC').get_telemetry()
    
    # Srovnání času od 0
    start_time = min(VER['SessionTime'].min(), LEC['SessionTime'].min())
    end_time = max(VER['SessionTime'].max(), LEC['SessionTime'].max())
    
    current_time = start_time
    # Procházíme replay 10x rychleji (nebo po jedné sekundě v čase závodu, např. každých 100ms real time = 1s race time)
    step = pd.Timedelta(seconds=1.0)
    
    print("Začíná LIVE STREAM (Replay)...")
    
    # Session state insert
    supabase.table("session_state").upsert({
        "id": 1,
        "flag": "Green",
        "remaining_laps": 53,
        "track_temp": float(session.weather_data.iloc[0].get('TrackTemp', 0)),
        "air_temp": float(session.weather_data.iloc[0].get('AirTemp', 0))
    }).execute()

    while current_time <= end_time:
        t_start = time.time()
        
        # Získáme nejbližší bod pro každého z jezdců
        ver_row = VER.iloc[(VER['SessionTime'] - current_time).abs().argsort()[:1]]
        lec_row = LEC.iloc[(LEC['SessionTime'] - current_time).abs().argsort()[:1]]
        
        # Insert telemetry
        payloads = []
        if not ver_row.empty:
            v = ver_row.iloc[0]
            payloads.append({
                "driver_number": "1",
                "session_time": float(v['SessionTime'].total_seconds()),
                "speed": int(v['Speed']) if not pd.isna(v['Speed']) else 0,
                "rpm": int(v['RPM']) if not pd.isna(v['RPM']) else 0,
                "gear": int(v['nGear']) if not pd.isna(v['nGear']) else 0,
                "throttle": int(v['Throttle']) if not pd.isna(v['Throttle']) else 0,
                "brake": int(v['Brake']) if not pd.isna(v['Brake']) else 0,
            })
            
        if not lec_row.empty:
            l = lec_row.iloc[0]
            payloads.append({
                "driver_number": "16",
                "session_time": float(l['SessionTime'].total_seconds()),
                "speed": int(l['Speed']) if not pd.isna(l['Speed']) else 0,
                "rpm": int(l['RPM']) if not pd.isna(l['RPM']) else 0,
                "gear": int(l['nGear']) if not pd.isna(l['nGear']) else 0,
                "throttle": int(l['Throttle']) if not pd.isna(l['Throttle']) else 0,
                "brake": int(l['Brake']) if not pd.isna(l['Brake']) else 0,
            })
            
        if payloads:
            try:
                # Odesíláme telemetrii na pozadí, abychom nezdržovali stream rate
                supabase.table("telemetry").insert(payloads).execute()
                print(f"[{current_time}] Odeslána telemetrie pro 2 jezdce.")
            except Exception as e:
                print("Chyba insertu:", e)
                
        current_time += step
        
        # Počkáme zbytkový čas z 1 sekundy (simulace živého času, případně rychleji)
        elapsed = time.time() - t_start
        sleep_time = max(0.0, 1.0 - elapsed)
        time.sleep(sleep_time)

async def main_loop():
    while True:
        try:
            await run_replay()
        except Exception as e:
            print(f"Kritická chyba v replay smyčce, restartuji za 10s: {e}")
        
        print("Replay skončil nebo spadl. Čekám 10s přes novým puštěním...")
        await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(main_loop())

import asyncio
import json
import time
import websockets
import pandas as pd
import fastf1
import logging
import os
from datetime import datetime, timedelta

# Konfigurace logování
logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger("live_simulator")

# Nastavení FastF1 cache
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')
fastf1.Cache.enable_cache(CACHE_DIR)

# Seznam připojených klientů
connected_clients = set()

# Globální stav pro initial state (v tomto případě simulujeme SessionInfo a DriverList hned)
cached_initial_state = {}

def get_session_data():
    """Načte historická data pro simulaci."""
    logger.info("Načítám data pro GP Británie 2024...")
    session = fastf1.get_session(2024, 'Silverstone', 'R')
    session.load(telemetry=True, weather=True, messages=True)
    return session

def transform_to_signalr_format(category, data):
    """Obalí data do formátu, který očekává náš frontend."""
    return {
        "category": category,
        "data": data,
        "timestamp": time.time()
    }

async def ws_handler(websocket):
    """Handler pro nová WebSocket spojení."""
    connected_clients.add(websocket)
    logger.info(f"Nový klient připojen. Celkem: {len(connected_clients)}")
    
    try:
        # Pošleme úvodní stav, pokud existuje
        for msg in cached_initial_state.values():
            await websocket.send(json.dumps(msg))
        
        # Udržujeme spojení otevřené
        await websocket.wait_closed()
    except Exception as e:
        logger.warning(f"Chyba ve WS handleru: {e}")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        logger.info(f"Klient odpojen. Zbývá: {len(connected_clients)}")

async def run_simulation():
    """Hlavní smyčka simulátoru."""
    session = get_session_data()
    
    # 1. Připravíme DriverList
    drivers_dict = {}
    for drv_num in session.drivers:
        drv = session.get_driver(drv_num)
        drivers_dict[drv_num] = {
            "Abbreviation": drv['Abbreviation'],
            "TeamName": drv['TeamName'],
            "TeamColor": drv['TeamColor'],
            "FullName": drv['FullName']
        }
    
    cached_initial_state["DriverList"] = transform_to_signalr_format("DriverList", drivers_dict)
    
    # 2. Připravíme SessionInfo
    session_info = {
        "Meeting": {"Name": f"{session.event['EventName']} Simulation"},
        "ArchiveStatus": {"Status": "GeneratingLive"},
        "SessionName": session.name
    }
    cached_initial_state["SessionInfo"] = transform_to_signalr_format("SessionInfo", session_info)

    # 3. Připravíme TrackData (geometrie okruhu z nejrychlejšího kola)
    try:
        fastest = session.laps.pick_fastest()
        tel = fastest.get_telemetry()
        track_points = []
        for _, row in tel.iterrows():
            track_points.append({"x": float(row['X']), "y": float(row['Y'])})
        
        cached_initial_state["TrackData"] = transform_to_signalr_format("TrackData", track_points)
        logger.info(f"Geometrie okruhu připravena ({len(track_points)} bodů)")
    except Exception as e:
        logger.warning(f"Nepodařilo se načíst geometrii okruhu: {e}")

    logger.info("Simulace spuštěna. Vysílám data...")

    # Získáme telemetrii všech jezdců
    # Nastavíme okno simulace (např. 5 minut kolem nejrychlejšího kola)
    ref_time = session.laps.pick_fastest()['Time']
    start_time = ref_time - timedelta(seconds=30)
    end_time = ref_time + timedelta(seconds=300)
    
    current_time = start_time
    step_ms = 200 # 5Hz pro plynulejší pohyb
    step = timedelta(milliseconds=step_ms)

    while current_time < end_time:
        messages_to_send = []
        
        # Simulace pozic
        cars_pos = {}
        for drv_num in session.drivers:
            try:
                drv_laps = session.laps.pick_driver(drv_num)
                # Najdeme nejbližší telemetrii v daném čase
                tel = drv_laps.get_telemetry().slice_by_time(current_time, current_time + step)
                if not tel.empty:
                    row = tel.iloc[0]
                    cars_pos[drv_num] = {
                        "X": float(row['X']),
                        "Y": float(row['Y']),
                        "Z": float(row.get('Z', 0))
                    }
            except:
                continue
        
        if cars_pos:
            pos_msg = transform_to_signalr_format("Position", {"Cars": cars_pos})
            messages_to_send.append(pos_msg)

        # Simulace TimingData (vylepšeno pro zobrazení sektorů)
        timing_data = {"Lines": {}}
        for drv_num in session.drivers:
            drv_laps = session.laps.pick_driver(drv_num)
            # Najdeme poslední dokončené kolo k aktuálnímu času simulace
            past_laps = drv_laps[drv_laps['Time'] <= current_time]
            if not past_laps.empty:
                row = past_laps.iloc[-1]
                
                # Formátování času na "M:SS.ms"
                def fmt_time(t):
                    if pd.isna(t): return "--.---"
                    total_seconds = t.total_seconds()
                    minutes = int(total_seconds // 60)
                    seconds = total_seconds % 60
                    return f"{minutes}:{seconds:06.3f}"[2:] if minutes == 0 else f"{minutes}:{seconds:06.3f}"

                timing_data["Lines"][drv_num] = {
                    "GapToLeader": "LAP 1" if row['LapNumber'] == 1 else f"L{int(row['LapNumber'])}",
                    "Sectors": {
                        "0": {"Value": fmt_time(row['Sector1Time']), "PersonalFastest": True},
                        "1": {"Value": fmt_time(row['Sector2Time']), "PersonalFastest": False},
                        "2": {"Value": fmt_time(row['Sector3Time']), "PersonalFastest": True}
                    }
                }
        
        if timing_data["Lines"]:
            messages_to_send.append(transform_to_signalr_format("TimingData", timing_data))

        # Broadcast všem aktivním klientům
        if connected_clients and messages_to_send:
            dead_clients = set()
            for client in connected_clients:
                try:
                    for msg in messages_to_send:
                        await client.send(json.dumps(msg))
                except Exception as e:
                    logger.warning(f"Nepodařilo se poslat data klientovi: {e}")
                    dead_clients.add(client)
            
            for dead in dead_clients:
                connected_clients.remove(dead)

        current_time += step
        await asyncio.sleep(step_ms / 1000.0)

async def main():
    port = int(os.environ.get("PORT", 8081))
    logger.info(f"Spouštím Live Simulator na portu {port}")
    
    server = await websockets.serve(ws_handler, "0.0.0.0", port)
    
    # Spustíme simulaci na pozadí
    sim_task = asyncio.create_task(run_simulation())
    
    await asyncio.gather(server.wait_closed(), sim_task)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Simulátor zastaven.")

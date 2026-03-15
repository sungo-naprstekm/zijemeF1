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

    logger.info("Předpřipravuji data pro všechny jezdce na pozadí (může trvat minutu)...")
    drv_telemetry = {}
    drv_laps_data = {}
    drv_indices = {drv: 0 for drv in session.drivers}
    
    for drv_num in session.drivers:
        try:
            laps = session.laps.pick_driver(drv_num)
            tel = laps.get_telemetry()
            
            # Předpočítáme time sekundy (odstraníme NaN)
            tel = tel[['Time', 'X', 'Y', 'Z']].dropna()
            tel_records = []
            for _, row in tel.iterrows():
                tel_records.append({
                    'time_sec': row['Time'].total_seconds(),
                    'X': float(row['X']),
                    'Y': float(row['Y']),
                    'Z': float(row.get('Z', 0))
                })
            drv_telemetry[drv_num] = tel_records
            
            laps_records = []
            for _, row in laps.iterrows():
                laps_records.append({
                    'time_sec': row['Time'].total_seconds(),
                    'LapNumber': row['LapNumber'],
                    'Sector1Time': row['Sector1Time'],
                    'Sector2Time': row['Sector2Time'],
                    'Sector3Time': row['Sector3Time']
                })
            drv_laps_data[drv_num] = laps_records
        except Exception as e:
            logger.warning(f"Nepodařilo se předzpracovat data jezdce {drv_num}: {e}")
            drv_telemetry[drv_num] = []
            drv_laps_data[drv_num] = []

    logger.info("Simulace spuštěna. Vysílám data o plynulé frekvenci 10 Hz...")

    ref_time = session.laps.pick_fastest()['Time']
    start_time_sec = (ref_time - timedelta(seconds=30)).total_seconds()
    end_time_sec = (ref_time + timedelta(seconds=300)).total_seconds()
    
    current_time_sec = start_time_sec
    step_ms = 100 # 10Hz pro super plynulý pohyb
    step_sec = step_ms / 1000.0

    def fmt_time(t):
        if pd.isna(t) or t is None: return "--.---"
        ts = t.total_seconds()
        m = int(ts // 60)
        s = ts % 60
        return f"{m}:{s:06.3f}"[2:] if m == 0 else f"{m}:{s:06.3f}"

    while current_time_sec < end_time_sec:
        try:
            messages_to_send = []
            
            # Simulace pozic přes lineární interpolaci bodů telemetrie
            cars_pos = {}
            for drv_num, tel_list in drv_telemetry.items():
                if not tel_list:
                    continue
                idx = drv_indices[drv_num]
                
                # Najdeme index nejbližšího bodu v budoucnosti
                while idx < len(tel_list) and tel_list[idx]['time_sec'] < current_time_sec:
                    idx += 1
                drv_indices[drv_num] = idx
                
                if idx > 0 and idx < len(tel_list):
                    p1 = tel_list[idx-1]
                    p2 = tel_list[idx]
                    t_diff = p2['time_sec'] - p1['time_sec']
                    if 0 < t_diff < 5.0:  # Rozumný rozestup dat
                        ratio = (current_time_sec - p1['time_sec']) / t_diff
                        x = p1['X'] + (p2['X'] - p1['X']) * ratio
                        y = p1['Y'] + (p2['Y'] - p1['Y']) * ratio
                        z = p1['Z'] + (p2['Z'] - p1['Z']) * ratio
                        cars_pos[drv_num] = {"X": x, "Y": y, "Z": z}
                    else:
                        cars_pos[drv_num] = {"X": p1['X'], "Y": p1['Y'], "Z": p1['Z']}
            
            if cars_pos:
                messages_to_send.append(transform_to_signalr_format("Position", {"Cars": cars_pos}))

            # TimingData ze zachecovaných kol (bez náročího hledání přes Pandas)
            timing_data = {"Lines": {}}
            for drv_num, laps_list in drv_laps_data.items():
                if not laps_list:
                    continue
                # Najdeme poslední kolo (time_sec <= current)
                last_lap = None
                for lap in laps_list:
                    if lap['time_sec'] <= current_time_sec:
                        last_lap = lap
                    else:
                        break
                    
                if last_lap:
                    lapNum = 1
                    try:
                        if not pd.isna(last_lap['LapNumber']):
                            lapNum = int(last_lap['LapNumber'])
                    except:
                        pass
                        
                    timing_data["Lines"][drv_num] = {
                        "GapToLeader": "LAP 1" if lapNum == 1 else f"L{lapNum}",
                        "Sectors": {
                            "0": {"Value": fmt_time(last_lap['Sector1Time']), "PersonalFastest": True},
                            "1": {"Value": fmt_time(last_lap['Sector2Time']), "PersonalFastest": False},
                            "2": {"Value": fmt_time(last_lap['Sector3Time']), "PersonalFastest": True}
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
                    except Exception:
                        dead_clients.add(client)
                
                for dead in dead_clients:
                    connected_clients.remove(dead)

        except Exception as e:
            logger.error(f"FATAL ERROR IN RUN_SIMULATION LOOP: {e}", exc_info=True)
            
        # Níže stojící sekce běží v rámci whilu vždy
        current_time_sec += step_sec
        await asyncio.sleep(step_sec)

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

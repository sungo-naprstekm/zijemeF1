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
    
    # Pošleme úvodní stav, pokud existuje
    for msg in cached_initial_state.values():
        await websocket.send(json.dumps(msg))
        
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.add(websocket)
        connected_clients.remove(websocket)

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
        "Meeting": {"Name": "British Grand Prix simulation"},
        "ArchiveStatus": {"Status": "GeneratingLive"},
        "SessionName": "Race"
    }
    cached_initial_state["SessionInfo"] = transform_to_signalr_format("SessionInfo", session_info)

    logger.info("Simulace spuštěna. Vysílám data...")

    # Získáme telemetrii všech jezdců
    # Pro jednoduchost budeme simulovat po sekundách
    start_time = session.laps.pick_fastest()['Time'] - timedelta(seconds=60)
    end_time = session.laps.pick_fastest()['Time'] + timedelta(seconds=300)
    
    current_time = start_time
    step = timedelta(milliseconds=500) # 2Hz jako realita

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

        # Simulace TimingData (velmi zjednodušeně pro demo)
        timing_data = {"Lines": {}}
        for drv_num in session.drivers:
            drv_laps = session.laps.pick_driver(drv_num)
            last_lap = drv_laps[drv_laps['Time'] <= current_time]
            if not last_lap.empty:
                row = last_lap.iloc[-1]
                timing_data["Lines"][drv_num] = {
                    "GapToLeader": str(row.get('Time', 'L1')),
                    "Sectors": {
                        "0": {"Value": str(row.get('Sector1Time', ''))[:5]},
                        "1": {"Value": str(row.get('Sector2Time', ''))[:5]},
                        "2": {"Value": str(row.get('Sector3Time', ''))[:5]}
                    }
                }
        
        if timing_data["Lines"]:
            messages_to_send.append(transform_to_signalr_format("TimingData", timing_data))

        # Broadcast
        if connected_clients and messages_to_send:
            json_msgs = [json.dumps(m) for m in messages_to_send]
            # Pošleme vše v jedné dávce každému klientovi
            for client in list(connected_clients):
                try:
                    for jm in json_msgs:
                        await client.send(jm)
                except:
                    connected_clients.remove(client)

        current_time += step
        await asyncio.sleep(0.5)

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

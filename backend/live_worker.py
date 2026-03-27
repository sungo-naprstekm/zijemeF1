import os
import json
import time
import asyncio
import threading
import logging
import base64
import zlib
from typing import Set, Any, Dict, Optional

import websockets
import requests
import fastf1
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client
from signalrcore.hub_connection_builder import HubConnectionBuilder
from signalrcore.messages.completion_message import CompletionMessage

from fastf1.internals.f1auth import get_auth_token

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("live_worker")

# ──────────────────────────────────────────────
# Supabase klient (pro pipeline live dat do DB)
# ──────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase_live: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase_live = create_client(SUPABASE_URL, SUPABASE_KEY)
    logger.info("Supabase live client inicializován.")
else:
    logger.warning("SUPABASE_URL nebo SUPABASE_KEY nejsou nastaveny – DB pipeline zakázána.")

# FastF1 cache pro live_worker
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')
fastf1.Cache.enable_cache(CACHE_DIR)

# ──────────────────────────────────────────────
# Globální stav
# ──────────────────────────────────────────────
connected_clients: Set[websockets.WebSocketServerProtocol] = set()
loop = None
message_queue = None
state_lock = threading.Lock()

# Normalizace souřadnic tratě (raw F1 → 0-1000 SVG prostor)
_norm_params: Dict[str, float] = {}

def _apply_norm(x: float, y: float):
    """Přepočte raw F1 souřadnice na normalizované (0-1000)."""
    p = _norm_params
    if not p:
        return x, y
    nx = (x - p['x_min']) * p['scale'] + p['x_offset']
    ny = (y - p['y_min']) * p['scale'] + p['y_offset']
    return round(nx, 2), round(ny, 2)

def _load_norm_params_from_db():
    """Načte normalizacň parametry z track_outline v Supabase (při startu)."""
    global _norm_params
    if not supabase_live:
        return
    try:
        result = supabase_live.table("track_outline").select(
            "raw_x_min, raw_y_min, raw_scale, raw_x_offset, raw_y_offset"
        ).eq("id", 1).maybe_single().execute()
        d = result.data
        if d and d.get("raw_x_min") is not None:
            _norm_params = {
                'x_min': d['raw_x_min'], 'y_min': d['raw_y_min'],
                'scale': d['raw_scale'], 'x_offset': d['raw_x_offset'],
                'y_offset': d['raw_y_offset'],
            }
            logger.info(f"Norm params načteny z DB: x_min={_norm_params['x_min']:.0f}, scale={_norm_params['scale']:.4f}")
        else:
            logger.info("Norm params v DB nejsou (budou nastaveny po načtení tratě).")
    except Exception as e:
        logger.warning(f"Nelze načst norm params z DB: {e}")

# Lokální stav live session (průběžně aktualizován ze SignalR dat)
live_session_state: Dict[str, Any] = {
    "flag": "Green",
    "current_lap": 0,
    "total_laps": 0,
    "track_temp": 0.0,
    "air_temp": 0.0,
    "session_type": "",
    "event_name": "",
    "track_loaded": False  # Přidáno pro řízení stahování mapy
}

# Mapování čísla řidiče → barva týmu (fallback)
TEAM_COLORS = {
    "RBR": "#3671C6", "FER": "#E80020", "MER": "#27F4D2",
    "MCL": "#FF8000", "AST": "#229971", "ALN": "#0093CC",
    "WIL": "#64C4FF", "VRB": "#6692FF", "SAU": "#52E252", "HAA": "#B6BABD"
}

# Callback pro externí vysílání (např. do WebSockets v worker.py)
external_broadcast_callback = None

def _broadcast_to_ws(category: str, data: Any):
    """Pomocná funkce pro odeslání dat do externího callbacku."""
    if external_broadcast_callback:
        try:
            # Převedeme na formát, který očekává LiveVisualizer.jsx
            msg = {"category": category, "data": data}
            external_broadcast_callback(msg)
        except Exception as e:
            logger.error(f"WS Broadcast error: {e}")


def safe_upsert(table: str, payload):
    """Bezpečný upsert do Supabase - tiché selhaní."""
    if not supabase_live:
        return
    try:
        supabase_live.table(table).upsert(payload).execute()
    except Exception as e:
        logger.error(f"DB upsert chyba ({table}): {e}")


def broadcast_message_sync(message_str: str):
    """Voláno ze SignalR vlákna pro vložení zprávy do asyncio fronty WS klientům."""
    global loop, message_queue
    if loop and message_queue:
        loop.call_soon_threadsafe(message_queue.put_nowait, message_str)


# ──────────────────────────────────────────────
# Parsery SignalR kategorií → Supabase
# ──────────────────────────────────────────────

def _parse_position(data: Any):
    """
    Position nebo Position.z data → telemetry tabulka.
    Struktura: { "Position": { "Timestamp": "...", "Entries": { "driverNum": { "X": int, "Y": int, ... } } } }
    nebo plochý format: [ { "RacingNumber": "...", "X": int, "Y": int } ]
    """
    if not supabase_live:
        return

    payloads = []
    try:
        if isinstance(data, dict):
            # Zanořená struktura SignalR
            entries = data.get("Position", {}).get("Entries", {}) if "Position" in data else data.get("Entries", {})
            if not entries and isinstance(list(data.values())[0] if data else None, dict):
                entries = data  # Může být přímo dict { "driverNum": {...} }

            for driver_num, vals in entries.items():
                if not isinstance(vals, dict):
                    continue
                x = vals.get("X")
                y = vals.get("Y")
                if x is None or y is None:
                    continue
                payloads.append({
                    "id": int(driver_num) if str(driver_num).isdigit() else hash(str(driver_num)) % 100,
                    "driver_number": str(driver_num),
                    "session_time": 0,  # Live: nepouzíváme session_time (nepůsobní čas), jen pozice
                    "x_pos": float(x),
                    "y_pos": float(y),
                    "speed": int(vals.get("Speed", 0)) if vals.get("Speed") is not None else 0,
                    "rpm": 0,
                    "gear": 0,
                    "throttle": 0,
                    "brake": 0,
                })

        elif isinstance(data, list):
            # Plochý seznam
            for entry in data:
                driver_num = str(entry.get("RacingNumber", entry.get("DriverNumber", "")))
                if not driver_num:
                    continue
                payloads.append({
                    "id": int(driver_num) if str(driver_num).isdigit() else 0,
                    "driver_number": driver_num,
                    "session_time": 0,
                    "x_pos": float(entry.get("X", 0)),
                    "y_pos": float(entry.get("Y", 0)),
                    "speed": int(entry.get("Speed", 0)) if entry.get("Speed") is not None else 0,
                    "rpm": 0, "gear": 0, "throttle": 0, "brake": 0,
                })
    except Exception as e:
        logger.error(f"Position parse error: {e}")

    if payloads:
        # Fire-and-forget v separátním threadu aby neblokoval SignalR vlákno
        threading.Thread(target=safe_upsert, args=("telemetry", payloads), daemon=True).start()
        # Odeslat i přes WebSocket pro plynulý pohyb
        _broadcast_to_ws("Position", payloads)


def _parse_timing_data(data: Any):
    """
    TimingData → leaderboard tabulka.
    Struktura: { "Lines": { "driverNum": { "Position": "1", "GapToLeader": "+0.0", ... } } }
    """
    if not supabase_live:
        return
    try:
        lines = data.get("Lines", {}) if isinstance(data, dict) else {}
        if not lines:
            return

        upserts = []
        for driver_num, timing in lines.items():
            if not isinstance(timing, dict):
                continue

            # Připravíme payload pouze s daty, která jsou v paketu přítomna
            payload = {"driver_number": str(driver_num)}

            # Povinné sloupce s defaulty pro případ, že jde o nový záznam (INSERT)
            payload.setdefault("position", 99)
            payload.setdefault("broadcast_name", str(driver_num))
            payload.setdefault("team_color", "#FFFFFF")

            if "Position" in timing:
                try:
                    payload["position"] = int(timing["Position"])
                except (ValueError, TypeError):
                    pass # Necháme 99

            if "GapToLeader" in timing:
                gap = timing["GapToLeader"]
                if isinstance(gap, dict):
                    gap = gap.get("Value", "")
                payload["gap_to_leader"] = str(gap)[:20]

            if "IntervalToPositionAhead" in timing:
                interval = timing["IntervalToPositionAhead"]
                if isinstance(interval, dict):
                    interval = interval.get("Value", "")
                payload["interval"] = str(interval)[:20]

            if "LastLapTime" in timing:
                last_lap = timing["LastLapTime"]
                if isinstance(last_lap, dict):
                    last_lap = last_lap.get("Value", "")
                payload["last_lap_time"] = str(last_lap)[:20]

            # Prázdný objekt (jen driver_number) neposíláme
            if len(payload) > 1:
                upserts.append(payload)

        if upserts:
            threading.Thread(target=safe_upsert, args=("leaderboard", upserts), daemon=True).start()
            _broadcast_to_ws("TimingData", data)
    except Exception as e:
        logger.error(f"TimingData parse error: {e}")


def _parse_driver_list(data: Any):
    """DriverList → aktualizuje broadcast_name a team_color v leaderboard."""
    if not supabase_live:
        return
    try:
        if not isinstance(data, dict):
            return
        upserts = []
        for driver_num, info in data.items():
            if not isinstance(info, dict):
                continue
            
            payload = {
                "driver_number": str(driver_num),
                "broadcast_name": info.get("Tla", info.get("BroadcastName", str(driver_num))),
            }
            
            if "TeamColour" in info:
                payload["team_color"] = f"#{info.get('TeamColour', 'FFFFFF')}"
            
            # Position v DriverListu obvykle není, tak ji tu nebudeme vnucovat jako 99, 
            # pokud tam už v DB nějaká je.
            upserts.append(payload)
        if upserts:
            threading.Thread(target=safe_upsert, args=("leaderboard", upserts), daemon=True).start()
            _broadcast_to_ws("DriverList", data)
    except Exception as e:
        logger.error(f"DriverList parse error: {e}")


def _parse_session_info(data: Any):
    """SessionInfo → session_state a track_outline."""
    global live_session_state
    if not supabase_live:
        return
    try:
        if not isinstance(data, dict):
            return
        meeting = data.get("Meeting", {})
        session = data.get("Session", {})
        event_name = meeting.get("Name", live_session_state.get("event_name", ""))
        session_type = data.get("Type", live_session_state.get("session_type", ""))
        
        logger.info(f"SignalR SessionInfo: {event_name} - {session_type} (Meeting: {meeting.get('Key')}, Session: {session.get('Key')})")
        with state_lock:
            # Pokud se změnil event_name, resetujeme příznak načtené tratě
            if event_name != live_session_state["event_name"]:
                live_session_state["track_loaded"] = False
            
            live_session_state["event_name"] = event_name
            live_session_state["session_type"] = session_type

            # Pokud ještě nemáme načtenou mapu tratě pro tento event, zkusíme ji stáhnout
            if not live_session_state["track_loaded"] and event_name:
                live_session_state["track_loaded"] = True
                threading.Thread(target=_load_and_push_track_outline, 
                                 args=(event_name,), daemon=True).start()

        threading.Thread(target=safe_upsert, args=("session_state", {
            "id": 1,
            "flag": live_session_state.get("flag", "Green"),
            "session_type": session_type,
        }), daemon=True).start()
        _broadcast_to_ws("SessionInfo", data)
    except Exception as e:
        logger.error(f"SessionInfo parse error: {e}")

def _load_and_push_track_outline(event_name: str):
    """Stáhne a uloží geometrii trati do Supabase."""
    try:
        # POUŽIJEME ROK Z SESSION_INFO POKUD MOŽNO, JINAK AKTUALNI
        year = time.localtime().tm_year
        logger.info(f"→ Live: Pokouším se stáhnout track_outline pro {event_name} (zkouším rok {year})...")
        
        def try_load(y, ev):
            for s_type in ['R', 'Q', 'SQ', 'FP3', 'FP2', 'FP1']:
                try:
                    s = fastf1.get_session(y, ev, s_type)
                    s.load(telemetry=False, weather=False, messages=False)
                    return s
                except:
                    continue
            return None

        session = try_load(year, event_name)
        if not session:
            # Fallback na předchozí rok (geometrie trati se obvykle nemění drasticky)
            logger.info(f"→ Live: Data pro {year} {event_name} nenalezena, zkouším rok {year-1}...")
            session = try_load(year - 1, event_name)

        if not session:
            logger.warning(f"⚠ Live: Nepodařilo se najít žádnou session pro {event_name} ani v roce {year-1}")
            return

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
                "circuit_name": f"{year} {event_name}",
                "raw_x_min": float(x_min),
                "raw_y_min": float(y_min),
                "raw_scale": float(scale),
                "raw_x_offset": float(x_offset),
                "raw_y_offset": float(y_offset),
            }).execute()
            # Nastavíme globální norm params ihned
            global _norm_params
            _norm_params = {
                'x_min': float(x_min), 'y_min': float(y_min),
                'scale': float(scale), 'x_offset': float(x_offset),
                'y_offset': float(y_offset),
            }
            logger.info(f"✅ Live: track_outline uložen ({len(outline_points)} bodů), norm params: x_min={x_min:.0f}, y_min={y_min:.0f}, scale={scale:.4f}")
        else:
            logger.warning("⚠ Live: Žádná GPS data pro track_outline")
    except Exception as e:
        logger.error(f"Live Track outline error: {e}")


def _parse_track_status(data: Any):
    """TrackStatus → session_state flag (Green/SC/VSC/Red)."""
    global live_session_state
    if not supabase_live:
        return
    try:
        status_map = {
            "1": "Green", "2": "Yellow", "4": "SC",
            "5": "Red", "6": "VSC", "7": "VSC"
        }
        status_code = str(data.get("Status", "1")) if isinstance(data, dict) else "1"
        flag = status_map.get(status_code, "Green")

        with state_lock:
            live_session_state["flag"] = flag

        threading.Thread(target=safe_upsert, args=("session_state", {
            "id": 1,
            "flag": flag,
        }), daemon=True).start()
    except Exception as e:
        logger.error(f"TrackStatus parse error: {e}")


def _parse_weather(data: Any):
    """WeatherData → session_state (track_temp, air_temp)."""
    global live_session_state
    if not supabase_live:
        return
    try:
        if not isinstance(data, dict):
            return
        track_temp = float(data.get("TrackTemp", live_session_state.get("track_temp", 0)))
        air_temp = float(data.get("AirTemp", live_session_state.get("air_temp", 0)))

        with state_lock:
            live_session_state["track_temp"] = track_temp
            live_session_state["air_temp"] = air_temp

        threading.Thread(target=safe_upsert, args=("session_state", {
            "id": 1,
            "track_temp": track_temp,
            "air_temp": air_temp,
        }), daemon=True).start()
    except Exception as e:
        logger.error(f"WeatherData parse error: {e}")


def _parse_lap_count(data: Any):
    """LapCount → session_state (current_lap, total_laps)."""
    global live_session_state
    if not supabase_live:
        return
    try:
        if not isinstance(data, dict):
            return
        current_lap = int(data.get("CurrentLap", live_session_state.get("current_lap", 0)))
        total_laps = int(data.get("TotalLaps", live_session_state.get("total_laps", 0)))

        with state_lock:
            live_session_state["current_lap"] = current_lap
            live_session_state["total_laps"] = total_laps

        threading.Thread(target=safe_upsert, args=("session_state", {
            "id": 1,
            "current_lap": current_lap,
            "total_laps": total_laps,
        }), daemon=True).start()
    except Exception as e:
        logger.error(f"LapCount parse error: {e}")


# ──────────────────────────────────────────────
# Dispatcher kategorií → příslušný parser
# ──────────────────────────────────────────────
CATEGORY_PARSERS = {
    "Position":      _parse_position,
    "Position.z":    _parse_position,
    "TimingData":    _parse_timing_data,
    "DriverList":    _parse_driver_list,
    "SessionInfo":   _parse_session_info,
    "TrackStatus":   _parse_track_status,
    "WeatherData":   _parse_weather,
    "LapCount":      _parse_lap_count,
}


class ProxySignalRClient:
    """Přijímá F1 Live Timing SignalR stream, parsuje ho do Supabase a broadcastuje do WS klientů."""
    state_cache: Dict[str, Any] = {}
    rcm_history: list = []

    def __init__(self, timeout=60):
        self.timeout = timeout
        self.topics = [
            "Heartbeat", "DriverList",
            "ExtrapolatedClock", "RaceControlMessages",
            "SessionInfo", "SessionStatus", "TeamRadio",
            "TimingAppData", "TimingStats", "TrackStatus",
            "WeatherData", "Position.z", "CarData.z",
            "Position", "CarData",
            "SessionData", "TimingData",
            "TopThree", "LapCount"
        ]

        self._connection_url = 'wss://livetiming.formula1.com/signalrcore'
        self._negotiate_url = 'https://livetiming.formula1.com/signalrcore/negotiate'

        self.headers = {}
        self._connection = None
        self._is_connected = False
        self._t_last_message = None

    def _decode_data(self, data: str) -> Any:
        """Dekóduje base64 + zlib dekomprese pro .z pakety."""
        try:
            decoded_bytes = base64.b64decode(data, validate=False)
            decompressed = zlib.decompress(decoded_bytes, -zlib.MAX_WBITS)
            return json.loads(decompressed)
        except Exception as e:
            logger.error(f"Decompression error: {e}")
            return data

    def _process_payload(self, category: str, payload: Any) -> Dict:
        """Zpracuje payload, dekomprimuje pokud je třeba, zapíše do DB a vrátí strukturovaný objekt."""
        if isinstance(payload, str) and category.endswith('.z'):
            payload = self._decode_data(payload)

        item = {
            "category": category,
            "data": payload,
            "timestamp": time.time()
        }

        # Cache vybraných kategorií pro nové WS klienty
        if category in ["DriverList", "SessionInfo", "SessionStatus", "TrackStatus"]:
            with state_lock:
                self.state_cache[category] = item

        if category == "RaceControlMessages":
            with state_lock:
                messages = payload.get('Messages', []) if isinstance(payload, dict) else []
                for m in messages:
                    self.rcm_history.append(m)
                if len(self.rcm_history) > 20:
                    del self.rcm_history[:-20]
                self.state_cache["RaceControlMessages"] = {
                    "category": "RaceControlMessages",
                    "data": {"Messages": self.rcm_history},
                    "timestamp": time.time()
                }

        # ── Supabase pipeline ──
        parser = CATEGORY_PARSERS.get(category)
        if parser:
            try:
                parser(payload)
            except Exception as e:
                logger.error(f"Parser {category} selhal: {e}")

        # ── Normalizace pozic před WS broadcastem ──
        if category in ('Position.z', 'Position') and _norm_params and isinstance(payload, dict):
            try:
                for pos_entry in payload.get('Position', []):
                    entries = pos_entry.get('Entries', {})
                    if isinstance(entries, dict):
                        first_car = True
                        for driver_num, car_data in entries.items():
                            if isinstance(car_data, dict) and 'X' in car_data and 'Y' in car_data:
                                car_data['X'], car_data['Y'] = _apply_norm(car_data['X'], car_data['Y'])
                                if first_car:
                                    logger.info(f"Normalized car {driver_num}: {car_data['X']}, {car_data['Y']}")
                                    first_car = False
                item['data'] = payload
            except Exception as e:
                logger.error(f"Position norm error: {e}")

        return item

    def _on_message(self, msg):
        self._t_last_message = time.time()

        broadcast_data = []

        if isinstance(msg, CompletionMessage):
            for cat, payload in msg.result.items():
                broadcast_data.append(self._process_payload(cat, payload))

        elif isinstance(msg, list):
            if len(msg) >= 2:
                cat = msg[0]
                payload = msg[1]
                broadcast_data.append(self._process_payload(cat, payload))
            else:
                logger.warning(f"Unexpected list message format: {msg}")

        else:
            logger.error(f"Unknown message type: {type(msg)}")
            return

        for item in broadcast_data:
            cat = item['category']
            formatted = json.dumps(item)

            if cat not in ["Heartbeat", "TimingData", "Position", "Position.z", "CarData.z"]:
                logger.info(f"SignalR: {cat}")

            print(".", end="", flush=True)
            broadcast_message_sync(formatted)

    def _on_connect(self):
        self._is_connected = True
        logger.info("SignalR Connection established to F1 Live Timing")

    def _on_close(self):
        self._is_connected = False
        logger.info("SignalR Connection closed")

    def run_sync(self):
        try:
            r = requests.options(self._negotiate_url, headers=self.headers)
            self.headers.update({"Cookie": f"AWSALBCORS={r.cookies['AWSALBCORS']}"})
        except Exception as e:
            logger.error(f"Negotiation failed: {e}")
            return

        options = {
            "verify_ssl": True,
            "access_token_factory": get_auth_token,
            "headers": self.headers
        }

        self._connection = HubConnectionBuilder() \
            .with_url(self._connection_url, options=options) \
            .configure_logging(logging.WARNING) \
            .build()

        self._connection.on_open(self._on_connect)
        self._connection.on_close(self._on_close)
        self._connection.on('feed', self._on_message)

        self._connection.start()

        while not self._is_connected:
            time.sleep(0.1)

        self._connection.send("Subscribe", [self.topics], on_invocation=self._on_message)
        self._t_last_message = time.time()

        while True:
            if self.timeout != 0 and time.time() - self._t_last_message > self.timeout:
                logger.warning(f"Timeout - přerušuji SignalR spojení.")
                break
            time.sleep(1)

        self._connection.stop()


def signalr_thread_runner():
    """Běží na pozadí a neustále se snaží připojit k Live Timingu."""
    while True:
        try:
            logger.info("Starting SignalR client (with Supabase pipeline)...")
            client = ProxySignalRClient()
            client.run_sync()
        except Exception as e:
            logger.error(f"SignalR client died: {e}")

        logger.info("Reconnecting SignalR in 5 seconds...")
        time.sleep(5)


async def ws_handler(websocket):
    """Handler pro nová WebSocket spojení ze strany (React frontend)."""
    connected_clients.add(websocket)

    # Okamžitě poslat aktuální stav z cache
    with state_lock:
        for cat in ProxySignalRClient.state_cache:
            try:
                await websocket.send(json.dumps(ProxySignalRClient.state_cache[cat]))
            except Exception:
                pass

    try:
        await websocket.wait_closed()
    finally:
        connected_clients.discard(websocket)


async def broadcast_loop():
    """Konzumuje frontu zpráv a odesílá je připojeným klientům."""
    while True:
        msg = await message_queue.get()
        if connected_clients:
            websockets.broadcast(connected_clients, msg)


async def main():
    global loop, message_queue
    loop = asyncio.get_running_loop()
    message_queue = asyncio.Queue()

    # Načtení norm params z DB při startu (pokud existují z předcházejícího běhu)
    _load_norm_params_from_db()

    asyncio.create_task(broadcast_loop())

    t = threading.Thread(target=signalr_thread_runner, daemon=True)
    t.start()

    port = int(os.environ.get('PORT', 8081))
    logger.info(f"Spouštím WebSocket + Supabase Live Pipeline server na portu {port}")
    async with websockets.serve(ws_handler, "0.0.0.0", port):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())

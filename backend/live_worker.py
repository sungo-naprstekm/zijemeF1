import os
import json
import time
import asyncio
import threading
import logging
import base64
import zlib
from typing import Set, Any, Dict

import websockets
import requests
from signalrcore.hub_connection_builder import HubConnectionBuilder
from signalrcore.messages.completion_message import CompletionMessage

from fastf1.internals.f1auth import get_auth_token

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("live_worker")

# Udržujeme množinu připojených WebSocket klientů
connected_clients: Set[websockets.WebSocketServerProtocol] = set()

# Async fronta pro přesun zpráv ze SignalR thready do asyncio smyčky
loop = None
message_queue = None

state_lock = threading.Lock()


def broadcast_message_sync(message_str: str):
    """Voláno ze SignalR vlákna pro vložení zprávy do asyncio fronty WS klientům."""
    global loop, message_queue
    if loop and message_queue:
        loop.call_soon_threadsafe(message_queue.put_nowait, message_str)


class ProxySignalRClient:
    """Modifikovaný klient z FastF1, který místo do souboru posílá raw data do WS klientů."""
    state_cache: Dict[str, Any] = {}
    rcm_history: list = []

    def __init__(self, timeout=60):
        self.timeout = timeout
        self.topics = ["Heartbeat","AudioStreams","DriverList",
                       "ExtrapolatedClock","RaceControlMessages",
                       "SessionInfo","SessionStatus","TeamRadio",
                       "TimingAppData","TimingStats","TrackStatus",
                       "WeatherData","Position.z","CarData.z",
                       "Position", "CarData",
                       "ContentStreams","SessionData","TimingData",
                       "TopThree", "RcmSeries", "LapCount"]
        
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
            # F1 zlib stream nemá hlavičky, používáme -15
            decompressed = zlib.decompress(decoded_bytes, -zlib.MAX_WBITS)
            return json.loads(decompressed)
        except Exception as e:
            logger.error(f"Decompression error: {e}")
            return data

    def _process_payload(self, category: str, payload: Any) -> Dict:
        """Zpracuje payload, dekomprimuje pokud je třeba a vrátí strukturovaný objekt."""
        if isinstance(payload, str) and category.endswith('.z'):
            payload = self._decode_data(payload)
        
        item = {
            "category": category,
            "data": payload,
            "timestamp": time.time()
        }

        # Cache vybraných kategorií
        if category in ["DriverList", "SessionInfo", "SessionStatus", "TrackStatus", "AudioStreams"]:
            with state_lock:
                self.state_cache[category] = item
        
        if category == "RaceControlMessages":
            with state_lock:
                # RaceControlMessages často obsahují seznam 'Messages'
                messages = payload.get('Messages', []) if isinstance(payload, dict) else []
                for m in messages:
                    self.rcm_history.append(m)
                # Držíme posledních 20 zpráv (in-place mutace aby se předešlo scope chybám)
                if len(self.rcm_history) > 20:
                    del self.rcm_history[:-20]
                
                self.state_cache["RaceControlMessages"] = {
                    "category": "RaceControlMessages",
                    "data": {"Messages": self.rcm_history},
                    "timestamp": time.time()
                }

        return item

    def _on_message(self, msg):
        self._t_last_message = time.time()
        
        broadcast_data = []

        if isinstance(msg, CompletionMessage):
            # msg.result je dict, kde klíče jsou kategorie
            for cat, payload in msg.result.items():
                broadcast_data.append(self._process_payload(cat, payload))
        
        elif isinstance(msg, list):
            # SignalR 'feed' zprávy jsou obvykle list: [kategorie, payload]
            if len(msg) >= 2:
                cat = msg[0]
                payload = msg[1]
                broadcast_data.append(self._process_payload(cat, payload))
            else:
                logger.warning(f"Unexpected list message format: {msg}")
        
        else:
            logger.error(f"Unknown message type: {type(msg)}")
            return

        # Odeslat každý zpracovaný kus jako samostatný JSON string
        for item in broadcast_data:
            cat = item['category']
            formatted = json.dumps(item)
            
            # Logování zajímavých kategorií
            if cat not in ["Heartbeat", "TimingData"]:
                logger.info(f"SignalR Category received: {cat}")
            
            logger.debug(f"Broadcasting: {cat}")
            print(".", end="", flush=True) 
            broadcast_message_sync(formatted)

    def _on_connect(self):
        self._is_connected = True
        logger.info("SignalR Connection established to FastF1")

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

        # Počkat na spojení
        while not self._is_connected:
            time.sleep(0.1)

        self._connection.send("Subscribe", [self.topics], on_invocation=self._on_message)
        self._t_last_message = time.time()

        # Udržování vlákna živým a hlídání timeoutu
        while True:
            if self.timeout != 0 and time.time() - self._t_last_message > self.timeout:
                logger.warning(f"Timeout - no data received for more than {self.timeout}s.")
                break
            time.sleep(1)

        self._connection.stop()


def signalr_thread_runner():
    """Běží na pozadí a neustále se snaží připojit k Live Timingu."""
    while True:
        try:
            logger.info("Starting SignalR proxy client...")
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
            except:
                pass

    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)


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

    # Spustit konzumenta zpráv (pro broadcast)
    asyncio.create_task(broadcast_loop())

    # Spustit připojení k FastF1 v odděleném vlákně
    # (protože signalrcore není nativně async)
    t = threading.Thread(target=signalr_thread_runner, daemon=True)
    t.start()

    # Rozjet WebSocket proxy server na portu (pro Koyeb)
    port = int(os.environ.get('PORT', 8081))
    logger.info(f"Spouštím WebSocket server na portu {port}")
    async with websockets.serve(ws_handler, "0.0.0.0", port):
        await asyncio.Future()  # běžet donekonečna

if __name__ == "__main__":
    asyncio.run(main())

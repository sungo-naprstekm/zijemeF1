#!/usr/bin/env python3
"""
stream_recorder.py
──────────────────────────────────────────────────────────────────────────────
Připojí se na F1 Live Timing SignalR a ukládá KAŽDÝ příchozí paket přesně
tak, jak přišel z API (po dekompresi .z paketů) do JSONL souboru.

Formát záznamu (jeden JSON na řádek):
    {
        "ts": 1711525812.456,       ← unix timestamp přijetí
        "elapsed": 3.12,            ← sekund od startu nahrávání
        "category": "Position.z",
        "raw_compressed": true,     ← byl paket komprimovaný?
        "data": { ... }             ← dekomprimovaný obsah
    }

Spuštění:
    python stream_recorder.py
    python stream_recorder.py --output moje_nahravka.jsonl
    python stream_recorder.py --output data/race_shanghai_2026.jsonl --duration 7200

Po ukončení (Ctrl+C nebo po --duration sekundách) vypíše statistiku.
"""

import os
import sys
import json
import time
import base64
import zlib
import argparse
import threading
import logging
from datetime import datetime
from pathlib import Path

import requests
from signalrcore.hub_connection_builder import HubConnectionBuilder
from signalrcore.messages.completion_message import CompletionMessage
from dotenv import load_dotenv

# FastF1 auth token (používá stejný mechanismus jako live_worker.py)
try:
    from fastf1.internals.f1auth import get_auth_token
    HAS_F1_AUTH = True
except ImportError:
    HAS_F1_AUTH = False

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("stream_recorder")

SIGNALR_URL  = "wss://livetiming.formula1.com/signalrcore"
NEGOTIATE_URL = "https://livetiming.formula1.com/signalrcore/negotiate"

TOPICS = [
    "Heartbeat", "DriverList",
    "ExtrapolatedClock", "RaceControlMessages",
    "SessionInfo", "SessionStatus", "TeamRadio",
    "TimingAppData", "TimingStats", "TrackStatus",
    "WeatherData", "Position.z", "CarData.z",
    "Position", "CarData",
    "SessionData", "TimingData",
    "TopThree", "LapCount",
]


def decode_compressed(data: str):
    """Dekóduje base64 + zlib pro .z pakety – vrátí Python objekt."""
    try:
        raw = base64.b64decode(data, validate=False)
        decompressed = zlib.decompress(raw, -zlib.MAX_WBITS)
        return json.loads(decompressed)
    except Exception as e:
        logger.warning(f"Decompression failed: {e} – ukládám raw string")
        return data


class StreamRecorder:
    def __init__(self, output_path: str, duration: int = 0):
        self.output_path = output_path
        self.duration    = duration  # 0 = neomezeně
        self._start_time = None
        self._count      = 0
        self._lock       = threading.Lock()
        self._running    = True
        self._connection = None
        self._is_connected = False
        self._t_last_message = None
        self._outfile    = None

        # Statistiky per-kategorie
        self._stats: dict[str, int] = {}

    def _write(self, record: dict):
        """Thread-safe zápis jednoho záznamu do JSONL."""
        line = json.dumps(record, ensure_ascii=False)
        with self._lock:
            self._outfile.write(line + "\n")
            self._outfile.flush()
            self._count += 1
            cat = record.get("category", "?")
            self._stats[cat] = self._stats.get(cat, 0) + 1

    def _on_message(self, msg):
        self._t_last_message = time.time()
        now = time.time()
        elapsed = round(now - self._start_time, 3)

        packets = []

        if isinstance(msg, CompletionMessage):
            # Zpráva odpovědi na Subscribe – obsahuje plný stav
            if isinstance(msg.result, dict):
                for cat, payload in msg.result.items():
                    packets.append((cat, payload))
        elif isinstance(msg, list) and len(msg) >= 2:
            packets.append((msg[0], msg[1]))
        else:
            # Neznámý formát – přesto uložíme
            record = {
                "ts": now,
                "elapsed": elapsed,
                "category": "__raw__",
                "raw_compressed": False,
                "data": str(msg),
            }
            self._write(record)
            return

        for (cat, payload) in packets:
            compressed = isinstance(payload, str) and cat.endswith(".z")
            if compressed:
                data = decode_compressed(payload)
            else:
                data = payload

            record = {
                "ts": now,
                "elapsed": elapsed,
                "category": cat,
                "raw_compressed": compressed,
                "data": data,
            }
            self._write(record)

        # Progress indicator
        if self._count % 50 == 0:
            mins = int(elapsed // 60)
            secs = int(elapsed % 60)
            logger.info(f"📦 {self._count} paketů | {mins:02d}:{secs:02d} | "
                        + ", ".join(f"{k}:{v}" for k, v in sorted(self._stats.items())
                                     if k not in ("Heartbeat",)))

    def _on_connect(self):
        self._is_connected = True
        logger.info("✅ SignalR připojeno k F1 Live Timing")

    def _on_close(self):
        self._is_connected = False
        logger.info("🔌 SignalR odpojeno")

    def _on_error(self, err):
        logger.error(f"SignalR error: {err}")

    def run(self):
        # Otevřít výstupní soubor
        Path(self.output_path).parent.mkdir(parents=True, exist_ok=True)
        self._outfile = open(self.output_path, "w", encoding="utf-8")
        self._start_time = time.time()
        started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Zapsat hlavičku (meta komentář jako první řádek)
        meta = {
            "ts": self._start_time,
            "elapsed": 0,
            "category": "__META__",
            "raw_compressed": False,
            "data": {
                "started_at": started_at,
                "topics": TOPICS,
                "note": "Raw F1 SignalR stream – každý řádek = jeden paket (JSONL formát)",
            }
        }
        self._write(meta)

        logger.info(f"💾 Nahrávám do: {self.output_path}")
        logger.info(f"⏱  Trvání: {'neomezené' if self.duration == 0 else f'{self.duration}s'}")
        logger.info("Ctrl+C pro ukončení a zobrazení statistik\n")

        # Negotiate cookie (stejně jako live_worker.py)
        headers = {}
        try:
            r = requests.options(NEGOTIATE_URL, headers=headers)
            if "AWSALBCORS" in r.cookies:
                headers["Cookie"] = f"AWSALBCORS={r.cookies['AWSALBCORS']}"
        except Exception as e:
            logger.warning(f"Negotiate failed: {e} – pokračuji bez cookie")

        # Sestavit SignalR spojení
        options = {"verify_ssl": True, "headers": headers}
        if HAS_F1_AUTH:
            options["access_token_factory"] = get_auth_token

        conn = HubConnectionBuilder() \
            .with_url(SIGNALR_URL, options=options) \
            .configure_logging(logging.WARNING) \
            .build()

        self._connection = conn
        conn.on_open(self._on_connect)
        conn.on_close(self._on_close)
        conn.on("feed", self._on_message)

        conn.start()

        # Čekat na připojení
        wait_start = time.time()
        while not self._is_connected:
            if time.time() - wait_start > 30:
                logger.error("❌ Nepodařilo se připojit do 30s – ukončuji")
                conn.stop()
                self._outfile.close()
                return
            time.sleep(0.1)

        conn.send("Subscribe", [TOPICS], on_invocation=self._on_message)
        self._t_last_message = time.time()

        # Hlavní smyčka – čeká na timeout nebo Ctrl+C
        try:
            while self._running:
                time.sleep(1)
                if self.duration > 0:
                    elapsed = time.time() - self._start_time
                    if elapsed >= self.duration:
                        logger.info(f"⏰ Duration {self.duration}s vypršel – zastavuji")
                        break
                # Hlídej heartbeat timeout (5 minut bez zprávy = problém)
                if self._t_last_message and time.time() - self._t_last_message > 300:
                    logger.warning("⚠ Žádná zpráva 5 minut – možná konec session")
        except KeyboardInterrupt:
            logger.info("\n⛔ Přerušeno uživatelem")
        finally:
            conn.stop()
            self._outfile.close()
            self._print_stats()

    def _print_stats(self):
        duration = round(time.time() - self._start_time, 1)
        print("\n" + "="*60)
        print(f"📊 STATISTIKA NAHRÁVKY")
        print(f"   Trvání:        {duration:.1f}s ({duration/60:.1f} min)")
        print(f"   Celkem paketů: {self._count}")
        print(f"   Soubor:        {self.output_path}")
        print(f"   Velikost:      {Path(self.output_path).stat().st_size / 1024:.1f} KB")
        print(f"\n   Pakety po kategorii:")
        for cat, cnt in sorted(self._stats.items(), key=lambda x: -x[1]):
            print(f"     {cat:<30} {cnt:>6}x")
        print("="*60)


def main():
    parser = argparse.ArgumentParser(
        description="Nahraje raw F1 SignalR live stream do JSONL souboru pro mockování."
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Cesta k výstupnímu souboru (default: recordings/live_YYYY-MM-DD_HH-MM.jsonl)"
    )
    parser.add_argument(
        "--duration", "-d",
        type=int,
        default=0,
        help="Maximální doba nahrávání v sekundách (0 = neomezeně, default: 0)"
    )
    args = parser.parse_args()

    if args.output is None:
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M")
        args.output = os.path.join(
            os.path.dirname(__file__), "recordings", f"live_{ts}.jsonl"
        )

    recorder = StreamRecorder(output_path=args.output, duration=args.duration)
    recorder.run()


if __name__ == "__main__":
    main()

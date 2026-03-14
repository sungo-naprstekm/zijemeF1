# 🏎️ F1 Live Pulse — Žijeme F1

Aplikace pro sledování historických i aktuálních závodů Formule 1 v reálném čase. Kombinuje data z FastF1 API s moderním dashboardem postaveným na Supabase Realtime.

---

## 💡 Principy

| Princip | Jak se projevuje |
|---|---|
| **MVP first** | Každá funkce je nasazena v minimální fungující podobě, testována a teprve pak rozšiřována. |
| **Realtime-native** | Veškerá data tečou přes Supabase Realtime (WebSocket), frontend se nikdy neptá „je něco nového?". |
| **Replay engine** | Backend přehrává historická závodní data v reálném čase (1 s = 1 s), takže UI vypadá jako živý přenos. |
| **Zero-polling** | Žádné `setInterval` na frontendu. Stav se mění výhradně reakcí na DB eventy. |
| **Cloud-first** | Celá aplikace běží bez lokálního PC — Vercel (frontend), Render (backend), Supabase (DB + realtime). |

---

## 🏗️ Architektura

```
┌──────────────────────────────────────────────────────────┐
│                      UŽIVATEL (Prohlížeč)                │
│                                                          │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ TrackMap    │  │ Leaderboard  │  │ TelemetryDashboard│  │
│  │ (SVG mapa) │  │ (pořadí)     │  │ (grafy rychlosti) │  │
│  └─────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│        └────────────────┼───────────────────┘            │
│                         │ Supabase Realtime (WS)         │
└─────────────────────────┼────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │   SUPABASE (Cloud)    │
              │                       │
              │  • leaderboard        │
              │  • telemetry          │
              │  • session_state      │
              │  • track_outline      │
              │                       │
              │  Realtime Publication  │
              └───────────┬───────────┘
                          │ INSERT / UPSERT / DELETE
              ┌───────────┴───────────┐
              │  BACKEND (Render.com) │
              │                       │
              │  worker.py            │
              │  • FastF1 data loader │
              │  • Replay engine      │
              │  • REST API           │
              │    GET /schedule      │
              │    POST /set-session  │
              │    GET /current-session│
              └───────────────────────┘
```

---

## 🧰 Tech Stack

### Frontend (`/frontend`)
- **React 18** + **Vite** — rychlý dev server, HMR
- **Zustand** — minimalistický state management
- **Supabase JS Client** — Realtime subscriptions (postgres_changes)
- **Recharts** — telemetrické grafy
- **Vanilla CSS** — cyberpunk minimalism styl
- **Hosting:** Vercel

### Backend (`/backend`)
- **Python 3.9+** — `worker.py` (jeden soubor, ~300 řádků)
- **FastF1** — oficiální knihovna pro stahování závodních dat F1
- **Supabase Python Client** — zápis do DB
- **http.server** — lehký REST API pro ovládání replaye
- **Hosting:** Render.com (Free Web Service + Dockerfile)

### Databáze
- **Supabase (PostgreSQL)** — 4 tabulky, Realtime zapnutý na všech

---

## 📊 Databázové tabulky

| Tabulka | Účel | Klíč |
|---|---|---|
| `leaderboard` | Pořadí jezdců, týmové barvy, pneumatiky | `driver_number` |
| `telemetry` | Rychlost, otáčky, převodovka, pedály, X/Y pozice | `id` (auto) |
| `session_state` | Vlajka, zbývající kola, teploty | `id = 1` |
| `track_outline` | Obrys trati jako JSONB pole [{x, y}] | `id = 1` |

---

## 🎮 Funkce (MVP)

### ✅ Hotové
- **Live Leaderboard** — pořadí všech jezdců s barvami týmů a info o pneumatikách
- **Session Status** — vlajka závodu, zbývající kola, teplota trati a vzduchu
- **Telemetrické grafy** — rychlost, otáčky, zařazený stupeň, plyn/brzda pro 2 vybrané jezdce
- **Mapa trati** — SVG obrys okruhu s pohybujícími se barevnými tečkami jezdců v reálném čase
- **Výběr závodu** — dropdown pro rok (2021–2026) a GP, dynamicky načtený z FastF1 schedule
- **Cloud deployment** — zero-config nasazení bez nutnosti lokálního PC

### 🔮 Potenciální rozšíření
- Více jezdců v telemetrii (dynamický výběr)
- Pit stop timeline
- Animace DRS zón na mapě
- Porovnání kol (overlay grafů)
- Notifikace (Safety Car, Red Flag)

---

## 🚀 Spuštění lokálně

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # doplnit SUPABASE_URL + SUPABASE_KEY
python worker.py
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env  # doplnit VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + VITE_RENDER_URL
npm run dev
```

Aplikace poběží na `http://localhost:5173`, backend API na `http://localhost:8080`.

---

## 📁 Struktura projektu

```
zijemeF1/
├── backend/
│   ├── worker.py          # Replay engine + REST API (vše v jednom)
│   ├── requirements.txt
│   ├── Dockerfile         # Pro Render.com deployment
│   └── .env               # SUPABASE_URL, SUPABASE_KEY
├── frontend/
│   ├── src/
│   │   ├── App.jsx                    # Hlavní layout
│   │   ├── supabaseClient.js          # Supabase init
│   │   ├── store/useF1Store.js        # Zustand store + realtime subscriptions
│   │   └── components/
│   │       ├── SessionStatus.jsx      # Vlajka, kola, teploty
│   │       ├── Leaderboard.jsx        # Tabulka jezdců
│   │       ├── TelemetryDashboard.jsx # Grafy rychlosti/otáček
│   │       ├── TrackMap.jsx           # SVG mapa trati + pozice
│   │       └── RacePicker.jsx         # Výběr roku a závodu
│   ├── .env                           # Lokální config
│   └── .env.production               # Produkční config (Vercel)
├── supabase/                          # Migrace
├── LL.md                              # Lessons Learned
└── README.md                          # ← tento soubor
```

---

## 🧠 Lessons Learned

Průběžně zapisujeme chyby a poučení do `LL.md`. Klíčové poznatky:
- Supabase Realtime vyžaduje explicitní `ALTER PUBLICATION` pro každou tabulku
- Render.com Free Tier uspává službu po 15 min nečinnosti → frontend ho automaticky „budí" při načtení
- FastF1 `pos_data` má jinou strukturu než `get_pos_data()` — pro obrys trati je potřeba `session.laps.pick_fastest().get_pos_data()`
- Zustand store musí explicitně zpracovávat `DELETE` eventy, jinak UI drží stará data

---

## 🏁 MVP přístup krok za krokem

1. **Sprint 1** — Backend replay engine, Supabase schéma, základní frontend s leaderboardem
2. **Sprint 2** — Telemetrické grafy (Recharts), Session Status, cyberpunk vizuál
3. **Sprint 3** — Cloud deployment (Vercel + Render + Supabase), automatické probouzení backendu
4. **Sprint 4** — Výběr závodu (RacePicker), dynamické přepínání session
5. **Sprint 5** — Mapa trati s živými pozicemi jezdců (TrackMap)

Každý sprint = funkční increment nasazený v cloudu. Žádný sprint nečekal na další.

---

*Made with ☕ and 🏎️ by Milas*

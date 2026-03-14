# 📋 Product Backlog — F1 Live Pulse

Organizováno do epiků. Priority: 🔴 Must-have, 🟡 Should-have, 🟢 Nice-to-have.

---

## Epic 1: 🏁 Živý Leaderboard (dynamická data)

**Aktuální stav:** Leaderboard se naplní jednou při startu replaye s hardcoded hodnotami. Pořadí odpovídá konečným výsledkům, ale `gap_to_leader`, `interval`, `compound`, `tyre_age` a `in_pit` se nikdy neaktualizují.

| ID | User Story | Priorita | Poznámka |
|---|---|---|---|
| LB-1 | Jako divák chci vidět **aktuální gapy** (gap_to_leader, interval) mezi jezdci, abych věděl, jak těsné jsou souboje. | 🔴 | Dnes vždy `""`. FastF1 má `LapData` s `GapToLeader` a `IntervalToPositionAhead`. |
| LB-2 | Jako divák chci vidět **změny pozic v průběhu závodu**, ne jen konečné pořadí. | 🔴 | Backend insertne konečné pozice jednou. Potřeba: iterovat přes kola a updatovat pořadí. |
| LB-3 | Jako divák chci vidět **aktuální pneumatiky** (S/M/H/I/W), ne vždy "S". | 🔴 | Dnes `compound: "S"` napevno. FastF1 má `Compound` per lap. |
| LB-4 | Jako divák chci vidět **stáří pneumatik** (tyre_age), abych věděl, kdo bude brzy v boxech. | 🟡 | Dnes `tyre_age: 1` napevno. Odvoditelné z `TyreLife` ve FastF1. |
| LB-5 | Jako divák chci vidět **pit stop indikátor** (in_pit: true/false), abych věděl, kdo je právě v boxech. | 🟡 | Dnes vždy `false`. Odvoditelné z doby pit stopu vs. session time. |
| LB-6 | Jako divák chci vidět **nejrychlejší kolo** zvýrazněné fialově. | 🟢 | UI ready (barvy), chybí data. |

---

## Epic 2: 📡 Session State (dynamický stav závodu)

**Aktuální stav:** `remaining_laps` je hardcoded na 53, `flag` vždy "Green". Teploty se berou z prvního záznamu počasí.

| ID | User Story | Priorita | Poznámka |
|---|---|---|---|
| SS-1 | Jako divák chci vidět **zbývající kola klesající v reálném čase**, ne statické číslo. | 🔴 | Dnes `remaining_laps: 53` napevno. Potřeba: dynamicky z celkového počtu kol - aktuální kolo lídra. |
| SS-2 | Jako divák chci vidět **vlajky** (Safety Car, VSC, Red Flag), ne vždy Green. | 🔴 | Dnes `flag: "Green"` napevno. FastF1 má `RaceControlMessages` s typy vlajek. |
| SS-3 | Jako divák chci vidět **aktuální teploty** (trať, vzduch) měnící se v průběhu závodu. | 🟡 | Dnes z prvního záznamu. FastF1 `weather_data` má časové řady. |
| SS-4 | Jako divák chci vidět **DRS status** (zapnut/vypnut). | 🟢 | Nový datový bod. |

---

## Epic 3: 🗺️ Track Map (pozice všech jezdců)

**Aktuální stav:** Mapa zobrazuje obrys trati správně, ale tečky jezdců se ukazují jen pro 2 jezdce (ti samí jako v telemetrii).

| ID | User Story | Priorita | Poznámka |
|---|---|---|---|
| TM-1 | Jako divák chci vidět **pozice všech 20 jezdců** na mapě, ne jen 2. | 🔴 | Backend posílá X/Y jen pro 2 `telem_drivers`. Potřeba: separátní position stream pro všechny. |
| TM-2 | Jako divák chci vidět **plynulý pohyb** teček (interpolace mezi body). | 🟡 | Nyní skáče po 1 s. CSS transition pomáhá, ale SVG animace by byla plynulejší. |
| TM-3 | Jako divák chci vidět **DRS zóny** zvýrazněné na mapě. | 🟢 | FastF1 má info o DRS zónách. |
| TM-4 | Jako divák chci **kliknout na jezdce** na mapě a zobrazit jeho telemetrii. | 🟢 | Propojení TrackMap ↔ TelemetryDashboard. |

---

## Epic 4: 📊 Telemetrie (dynamický výběr jezdců)

**Aktuální stav:** Dva telemetrické panely jsou hardcoded v `App.jsx` na `driverNumber="1"` (VER) a `driverNumber="16"` (LEC).

| ID | User Story | Priorita | Poznámka |
|---|---|---|---|
| TE-1 | Jako divák chci **vybrat si jezdce** pro telemetrický panel, ne mít napevno VER a LEC. | 🔴 | `App.jsx` řádky 53–54 jsou hardcoded. Potřeba: dropdown nebo klik z leaderboardu. |
| TE-2 | Jako divák chci vidět telemetrii pro **víc než 2 jezdce** (ideálně libovolný počet). | 🟡 | Backend streamuje jen 2. Potřeba: stream všech, frontend filtruje. |
| TE-3 | Jako divák chci **porovnat kola dvou jezdců** (overlay grafů). | 🟢 | Nová komponenta, potřeba lap-by-lap data. |
| TE-4 | Jako divák chci vidět **sektorové časy** v telemetrickém panelu. | 🟢 | FastF1 má `Sector1Time`, `Sector2Time`, `Sector3Time`. |

---

## Epic 5: 🔄 Replay Engine (věrnost simulace)

**Aktuální stav:** Replay přehrává telemetrii 1:1 v reálném čase, ale neaktualizuje leaderboard, gapy, pneumatiky ani session state v průběhu.

| ID | User Story | Priorita | Poznámka |
|---|---|---|---|
| RE-1 | Jako systém potřebuji **kolo-po-kole aktualizovat leaderboard** (pozice, gapy, pneumatiky) na základě FastF1 lap dat. | 🔴 | Jádro celého vylepšení. Bez toho jsou epicy 1 a 2 nefunkční. |
| RE-2 | Jako systém potřebuji **streamovat pozice (X/Y) pro všechny jezdce**, ne jen pro 2. | 🔴 | Prerequisite pro TM-1. |
| RE-3 | Jako systém potřebuji **aktualizovat session_state** (kola, vlajky, teploty) v průběhu replaye. | 🔴 | Prerequisite pro SS-1 a SS-2. |
| RE-4 | Jako uživatel chci **zrychlení replaye** (2x, 5x, 10x). | 🟡 | `time.sleep()` v backendu, stačí parametrizovat. |
| RE-5 | Jako uživatel chci **pauzu a seek** (přeskočit na kolo N). | 🟢 | Vyžaduje indexaci dat po kolech. |

---

## Epic 6: 🎨 UI/UX vylepšení

| ID | User Story | Priorita | Poznámka |
|---|---|---|---|
| UX-1 | Jako divák chci vidět **číslo aktuálního kola** v session status. | 🔴 | Dnes chybí. Snadno přidatelné. |
| UX-2 | Jako divák chci **responzivní layout** (mobilní zobrazení). | 🟡 | Dnes fixní šířka 350px pro levý sloupec. |
| UX-3 | Jako divák chci **animaci změny pozic** v leaderboardu (jezdec stoupá/klesá). | 🟡 | CSS transitions na reorder. |
| UX-4 | Jako divák chci **zvukové notifikace** při Safety Car nebo Red Flag. | 🟢 | Audio API + event trigger. |
| UX-5 | Jako divák chci **dark/light mode** přepínač. | 🟢 | CSS proměnné jsou ready. |

---

## Epic 7: 🏗️ Infrastruktura & DevOps

| ID | User Story | Priorita | Poznámka |
|---|---|---|---|
| IN-1 | Jako vývojář chci **automatický cleanup** staré telemetrie v DB, aby tabulka nerostla donekonečna. | 🔴 | Dnes se telemetrie jen přidává. Potřeba: retention policy nebo DELETE starších záznamů. |
| IN-2 | Jako vývojář chci **error monitoring** (Sentry nebo podobný) pro backend. | 🟡 | Dnes jen `print()` do stdout. |
| IN-3 | Jako vývojář chci **CI/CD pipeline** (auto-deploy při push). | 🟡 | Vercel má auto-deploy, Render potřebuje nastavit. |
| IN-4 | Jako vývojář chci **testy** (unit + integration). | 🟢 | Dnes žádné testy. |

---

## 📊 Shrnutí priorit

| Priorita | Počet stories | Klíčový dopad |
|---|---|---|
| 🔴 Must-have | 12 | Živý leaderboard, reálné gapy, pozice všech jezdců, dynamický session state |
| 🟡 Should-have | 8 | Stáří pneumatik, pit indikátor, replay rychlost, mobil, animace |
| 🟢 Nice-to-have | 10 | DRS, porovnání kol, zvuk, seek, testy |

## 🎯 Doporučený postup (sprinty)

1. **Sprint 6** — Epic 5 (RE-1, RE-2, RE-3): Replay engine aktualizuje data kolo-po-kole → odemkne epicy 1, 2, 3
2. **Sprint 7** — Epic 1 (LB-1 až LB-5) + Epic 2 (SS-1, SS-2): Živý leaderboard + session state
3. **Sprint 8** — Epic 3 (TM-1) + Epic 4 (TE-1): Všichni jezdci na mapě + volba jezdce v telemetrii
4. **Sprint 9** — Epic 6 (UX) + Epic 7 (IN): Polish + infrastruktura

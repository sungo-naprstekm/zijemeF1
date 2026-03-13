# Zaznamenané Chyby a Ponaučení (LL.md)

## Chyba - Supabase Create Project Limit
- **Datum:** 13. března 2026
- **Symptom:** API error `"The following organization members have reached their maximum limits for the number of active free projects..."` při pokusu vytvořit nový projekt `f1-live-pulse-mvp`.
- **Příčina:** Uživatel dosáhl limitu 2 bezplatných projektů na svoje konto v Supabase.
- **Odstranění:** Bylo vyžádáno rozhodnutí uživatele (smazat stávající, zastavit stávající, nebo přeřadit na pro-tier).
- **Ponaučení pro příště:** Před zakládáním nového free projektu na Supabase vždy nejprve zavolat `mcp_supabase-mcp-server_list_projects` a zkontrolovat, jestli v dané oranizaci už neexistují 2 aktivní `FREE` (potažmo obecně) projekty zabírající volnou kvótu.

## Chyba - Chybějící import pandas
- **Datum:** 13. března 2026
- **Symptom:** `NameError: name 'pd' is not defined` při pokusu parsovat DataFrame vrácený FastF1.
- **Příčina:** Opomenutý `import pandas as pd` na začátku souboru.
- **Odstranění:** Přidán `import` do hlavičky `worker.py`.
- **Ponaučení pro příště:** I když balíček jako `fastf1` interně vrací pandas DataFramy, pro manipulaci s nimi v mém vlastním skriptu (např. volání `pd.isna` nebo `pd.Timedelta`) musím `pandas` vždy explicitně naimportovat.

## Chyba - FastF1 Weather Data KeyError
- **Datum:** 13. března 2026
- **Symptom:** `KeyError: 'TrackTemperature'`
- **Příčina:** Tým fastf1 pojmenovává sloupce se zkratkami `TrackTemp` a `AirTemp`, ne `TrackTemperature`.
- **Odstranění:** Změna indexace a přidání `.get('TrackTemp', 0)` přes Python `dict.get()` fallback u pandas Series kvůli bezpečnosti.
- **Ponaučení pro příště:** Názvy metrik u externích non-standard API (jako fastf1) vždy fallbackovat nebo bezpečně listovat.

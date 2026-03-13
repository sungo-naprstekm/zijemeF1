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

## Chyba - Vercel `sh: vite: command not found`
- **Datum:** 13. března 2026
- **Symptom:** Během první fáze nasazení Vercel spadne na exit code 127 s tím, že nezná příkaz `vite`. Ve výpisu chybí zpráva o `npm install`.
- **Příčina:** Vercel naklonoval celý root repozitáře `zijemeF1/`, ale nenalezl tam `package.json` (jelikož ten leží až ve složce `frontend/`). Z tohoto důvodu přeskočil krok instalace NPM balíčků a zkusil rovnou spustit defaultní build, který samozřejmě selhal na chybějící binárce `vite`.
- **Odstranění:** Je nutno jít do Project Settings na Vercelu a nastavit **"Root Directory"** na hodnotu `frontend`.
- **Ponaučení pro příště:** Pokud aplikace neleží přímo v root složce repozitáře, musím uživatele VŽDY dopředu důrazně varovat, ať na Vercelu nezapomene vyplnit `Root Directory`, jinak deployment zhavaruje ihned na začátku.

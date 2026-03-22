# Zaznamenané Chyby a Ponaučení# LL.md - Lessons Learned

## 🎮 Live Simulator (Debugger/Simulator)
- **WebSocket Race Condition:** Pokud dvě komponenty (např. `LiveVisualizer` a `LiveDirectStream`) současně otevírají WebSocket na stejný port, simulátor (pokud není thread-safe/multi-client) může spojení shazovat. Vyřešeno úpravou `ws_handleru` v `live_simulator.py`, aby korektně spravoval množinu `connected_clients`.
- **Data Structure Mismatch:** Frontend očekával hluboce zanořenou strukturu SignalR (`Position -> Entries -> Cars`), zatímco simulátor posílal plochý objekt. `processPositions` ve frontendu byl zobecněn, aby zvládl oba formáty.
- **Timing Data Formatting:** `fastf1` vrací `Timedelta`, které v JSONu končí jako string s mikrosekundami. Je nutné je na backendu naformátovat na `M:SS.ms` pro lidskou čitelnost a stabilitu frontendu.

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

## Chyba - Render.com missing Environment Variables
- **Datum:** 13. března 2026
- **Symptom:** `Zadej SUPABASE_URL a SUPABASE_KEY do .env souboru!` v logách Renderu a pád aplikace (exit status 1).
- **Příčina:** Skript vyžaduje `SUPABASE_URL` a `SUPABASE_KEY`. Tyto proměnné nebyly nastaveny v ovládacím panelu Renderu.
- **Odstranění:** Manuální přidání proměnných v záložce **Environment** u dané služby na Render.com.
- **Ponaučení pro příště:** Při nasazování backendu do cloudu musím uživateli dát naprosto explicitní seznam proměnných, které musí do UI naklikat, a vysvětlit mu, že cloud "nevidí" lokální `.env` soubor.

## Chyba - Zpožděná reakce Replay Engine na zapnutí Pauzy
- **Datum:** 14. března 2026
- **Symptom:** Po stisknutí tlačítka "Pause" se telemetrie na frontendu stále hýbe až do konce aktuálního probíhajícího kola.
- **Příčina:** Hlavní smyčka v `worker.py` sice zohledňovala stav pauzy na začátku počítaného kola, ale nikoli uvnitř vnitřního cyklu `for step_i in range(POSITION_STEPS_PER_LAP):`.
- **Odstranění:** Přidána `while current_config.get("playback_state") == "paused":` smyčka do začátku iterace kroků kola, vč. prevence deadlocku s `restart_event`.
- **Ponaučení pro příště:** U vnořených smyček dbejte na to, aby reakce na změnu globálního stavu (Pause, Play) byla začleněna na dostatečně nízké úrovni granulity pro plynulý/okamžitý výsledek.

## Chyba - Leaderboard VARCHAR(5) constraint
- **Datum:** 14. března 2026
- **Symptom:** Během upsertu updatovaných časů spadnul query `leaderboard UPSERT chyba: {'message': 'value too long for type character varying(5)' ... }`.
- **Příčina:** Sloupce `broadcast_name` a `compound` byly definovány v Supabase tabulce jako `varchar(5)`. Nicméně FastF1 občas pošle plné slovo `INTERMEDIATE` nebo delší název. 
- **Odstranění:** Proveden SQL update typů `ALTER COLUMN broadcast_name TYPE text`.
- **Ponaučení pro příště:** Pro stringové hodnoty a jména generované plynoucími daty (speciálně z neznámých polí web scraping/API) použít pro jednoduchost a bezpečnost rovnou `text` místo striktně vynucovaných omezení `varchar(x)`.

## Chyba - UnboundLocalError `rcm_history` v `live_worker.py`
- **Datum:** 15. března 2026
- **Symptom:** Pád SignalR vlákna s chybou `UnboundLocalError: cannot access local variable 'rcm_history' where it is not associated with a value`.
- **Příčina:** Uvnitř metody `_process_payload` docházelo k re-asignaci globálního seznamu `rcm_history = rcm_history[-20:]`. Python v takovém případě považuje proměnnou za lokální pro celou metodu, což vedlo k chybě při pokusu o `append` ještě před touto asignací.
- **Odstranění:** Do metody `_process_payload` bylo přidáno `global rcm_history`.
- **Ponaučení pro příště:** Pokud v metodě třídy přistupuji k modulové (globální) proměnné a zároveň ji v téže metodě chci přepsat (rebind jména), musím ji explicitně deklarovat jako `global`. To platí i pro mutace typu `var = var + something`.

## Architektura - Falešná asynchronnost a Latence v Pythonu (asyncio + I/O)
- **Datum:** 22. března 2026
- **Symptom:** Během 1:1 playbacku se cyklus postupně zpožďuje a "klouže" proti reálnému času.
- **Příčina:** Backend `worker.py` deklaroval smyčku jako `async def`, ale uvnitř blokoval event loop skrze synchronní instrukce: `time.sleep()` a synchronní SQL dotazy na databázi `supabase.execute()`. To zcela zničilo latenci – každý propis do databáze čekající síť narušil interní chronometráž.
- **Odstranění:** Nahrazení `time.sleep()` nativním `await asyncio.sleep()`. Jakýkoli blokující I/O síťový paket (zápis telemetrie) byl zabalen na odeslání do asynchronní "fire-and-forget" úlohy v separátním vlákně: `asyncio.create_task(asyncio.to_thread(_))`. Zároveň byly smazány falešné yield event-loop leaky `run_in_executor(None, lambda: None)`.
- **Ponaučení pro příště:** V `async` funkcích nikdy nesmím zadržovat blok pomocí `time.sleep()` a nikdy nedělat synchronní HTTP requesty (na DB/externí API) do hlavní event-loop smyčky. Vede to k zamrznutí samotné podstaty asynchronnosti.

## Architektura - Ignorování Vláknové Bezpečnosti u WebServerů (Thread Safety)
- **Datum:** 22. března 2026
- **Symptom:** Teoretické nekonzistentní manipulace logů nebo proměnných z frontendu.
- **Příčina:** Backend sdílel globální proměnné (`current_config`, `app_logs`) do `http.server` HTTP vlákna API a paralelně běžící asynchronní smyčky bez zámků.
- **Odstranění:** Vybudován globální chránič modifikací `state_lock = threading.Lock()`. Od nynějška každé čtení a zápis, mutace configu nebo logů spadá pod exkluzivní tělo `with state_lock:`.
- **Ponaučení pro příště:** Přestože Python disponuje ochranou GIL, manipulovat sdíleným dictem nebo lists z více procesních vláken bez použití `Threading.Lock()` je nebezpečný anti-pattern.

## Chyby logiky, Mikromanagement paměti
- **Datum:** 22. března 2026
- **NameError a Crashe:** Smyčka obsahovala volání proměnné `SIM_LAP_DURATION`, jež vůbec nebyla definována = vyvrzení chyby a zamrznutí fallbackové fallback vteřiny simulátoru. Opraveno exaktním doplněním fixní relaxace `await asyncio.sleep(2)`.
- **Pandas Data-mismatch Masking:** Místo provádění prázdného fallbacku `get('Lap', pd.Series()) <= current_lap` (kdy generování prázdné pd.Series nad nepoměrně velkým Dataframem bez varování hodí logický `ValueError` mismatch délky boolean masky), byla zavedena řádově bezpečnější nativ kontrola `if 'Lap' in ...columns:`.
- **Použití `locals()` jako Anti-Pattern:** Analýza a podmínkování na základě vnitřního slovníku interpreteru `if 'current_track_temp' in locals():` je špinavou programovací technikou; promptně nahrazeno inicializací na bezpečný `None`. Navíc bylo zrušeno vnucování Garbage Collection (`del session` / `gc.collect()`), protože odchod z iterace a scope obslouží uvolnění velkých dat Python samostatně.

## Chyba Databáze - null value in column "speed" (Violates not-null constraint)
- **Datum:** 22. března 2026
- **Symptom:** Pád při `supabase.table("telemetry").upsert(payloads).execute()` chybějící NOT NULL hodnoty (`speed`, `rpm` apod.).
- **Příčina:** Původní skript extrahoval poziční data z FastF1 přes metodu `.get_pos_data()` (která stahuje výhradně X, Y a Z souřadnice). Do Supabase odesílal payload bez atributů rychlosti či otáček, kvůli čemuž databáze dosadila `NULL` do constraintových sloupců a operaci zastavila s chybou `23502`. V případech, kdy byla data částečně načtena, mohla knihovna Pandas vrátit hodnotu `NaN` (Not a Number), což se v konečném JSON insertu opět přeložilo na `null`.
- **Odstranění:** Použita plnohodnotnější metoda `.get_telemetry()` na stažení zkompilovaných car dat i pozičních dat. Objekty generované pro Supabase jsou plně kryty funkcí `pd.isna()` pro odchyt nedefinovaných polí, jež nahrazuje rozumným nulovým fallbackem `0`, případně `0.0`.
- **Ponaučení pro příště:** Pro DB sloupce specifikované jako `NOT NULL` musí odesílající skript exaktně deklarovat tyto fieldy a u externích knihoven pro zpracování surových dat je nutné **vždy** ošetřit potenciální float `NaN` výstup do povoleného base datového typu.

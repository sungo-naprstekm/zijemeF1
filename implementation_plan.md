# Plán Refaktoringu Workeru (Code Review)

Uživatel poskytl navýsost přesné a profesionální Code Review, které odhalilo fatální architektonické chyby (tzv. anti-patterny), jež by dříve či později způsobily zborcení workeru nebo postupné drastické hromadění zpoždění (latence) při pokusu o 1:1 playback.

Všechny body budou zapracovány následovně a zjištění uloženo do souboru [LL.md](file:///Users/mila/zijemeF1/LL.md) (Lessons Learned).

## Přehled plánovaných úprav ve [worker.py](file:///Users/mila/zijemeF1/backend/worker.py)

### 1. Oprava falešné asynchronnosti a "driftingu" času (Latence)
[MODIFY] Odesílání telemetrie a leaderboardu brzdí hlavní smyčku a popírá časový krok 0.5s (protože 0.5s `sleep` + 0.2s `Síť` = 0.7s výsledný krok).
- Změna `time.sleep()` na nativní a neblokující `await asyncio.sleep()`.
- Odesílání payloadů do Supabase bude "fire-and-forget", resp. baleno jako úkol na pozadí přes `asyncio.create_task(asyncio.to_thread(...))`. Smyčka tak nepocítí žádný blokující I/O síťový propad a dosáhne téměř dokonale plynulého časování 1:1 k realitě.
- Úplné smazání zbytečných yieldů `await asyncio.to_thread(lambda: None)`.

### 2. Thread Safety (Zámky)
[MODIFY] Sdílené objekty `current_config` a `app_logs` jsou modifikovány jak z HTTP Server Vlákna, tak ze Simulačního vlákna (asyncio). 
- Bude vytvořen `state_lock = threading.Lock()`. Operace jako [add_log](file:///Users/mila/zijemeF1/backend/worker.py#39-46) a čtení/zápis s modifikací slovníků přes něj budou bezpečně uzamčené (i když GIL v Pythonu pro jednoduché struktury částečně chrání, je to programátorsky správný postup pro bezpečný paralelizmus).

### 3. Oprava Pádů (NameError, Pandas Masking, Locals)
[MODIFY]
- Smazání nesmyslné deklarace s `SIM_LAP_DURATION`, která neexistuje, a její nahrazení bezpečným `await asyncio.sleep(2)`.
- Inicializace proměnné `current_track_temp = None` před smyčkou namísto hloupého dotazování `if 'current_track_temp' in locals()`.
- Oprava Pandas logiky na vlajky. Místo nebezpečného vnucování prázdné série přes [get()](file:///Users/mila/zijemeF1/frontend/src/components/LiveVisualizer.jsx#160-192) s defaultem dojde ke kontrole sloupce: `if 'Lap' in race_control_msgs.columns:`.
- Smazání mikromanagementu paměti (`del session`, `gc.collect()`). Python to vyřeší sám chytřeji a beze ztráty procesního času.

### Vylepšení Logiky a Zotavení z chyb
[MODIFY]
- Jestliže v simulaci něco zásadně havaruje (např. chybí nezbytné klíče), smyčka musí vyhodit `return`, opustit přehrávání zavoláním bezpečné pauzy a nikoliv jen spolknout výjimku přes `pass` a potichu generovat corruptnutá data!

Po implementaci bude ihned vytvořen repozitární záznam [LL.md](file:///Users/mila/zijemeF1/LL.md) dle požadavků z globálních pravidel.

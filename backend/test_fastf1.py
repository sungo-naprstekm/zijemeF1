import fastf1
import collections
fastf1.Cache.enable_cache('cache')
session = fastf1.get_session(2023, 'Monza', 'R')
session.load(telemetry=False, weather=False, messages=False)

laps = session.laps
# Print position of driver '1' (VER) or '55' (SAI) over laps
print("SAI positions:", laps.pick_driver('55')['Position'].tolist()[:10])
print("VER positions:", laps.pick_driver('1')['Position'].tolist()[:10])

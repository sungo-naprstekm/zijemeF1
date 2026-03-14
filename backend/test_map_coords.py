import os
import fastf1
import math
fastf1.Cache.enable_cache('cache')

rounds_to_test = ['Monza', 'Bahrain', 'Spa', 'Monaco', 'Suzuka']

for r in rounds_to_test:
    try:
        session = fastf1.get_session(2023, r, 'R')
        session.load(telemetry=True, laps=True, weather=False, messages=False)
        lap = session.laps.pick_fastest()
        pos_data = lap.get_pos_data()
        
        all_x = pos_data['X'].tolist()
        all_y = pos_data['Y'].tolist()
        
        has_nan_x = any(math.isnan(x) for x in all_x)
        has_nan_y = any(math.isnan(y) for y in all_y)
        
        if not pos_data.empty:
            # this is what the code in worker.py does
            x_min, x_max = min(all_x), max(all_x)
            y_min, y_max = min(all_y), max(all_y)
            print(f"{r}: len(pos_data)={len(pos_data)}, NaN X? {has_nan_x}, NaN Y? {has_nan_y}")
            print(f"  worker.py result bounds: x_min={x_min}, x_max={x_max}, y_min={y_min}, y_max={y_max}")
    except Exception as e:
        print(f"Error on {r}: {e}")

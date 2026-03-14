import pandas as pd
import numpy as np
import pytest
from worker import prepare_leaderboard_data

def test_prepare_leaderboard_data_extreme_cases():
    """
    Otestuje, že prepare_leaderboard_data bezpečně převede všechny chybějící a extrémní 
    hodnoty generované modulem pandas a FastF1 (NaN, NaT, chybějící data) 
    do standardních typů podporovaných JSON / Supabase.
    """
    # Vytvoření mock řádku s extrémními/chybnými stavy
    mock_lap_row = pd.Series({
        'GapToLeader': np.nan,            # Lídr nemá gap
        'IntervalToPositionAhead': pd.NaT,  # Chybějící / neplatný časový údaj
        'Compound': np.nan,               # Chybějící směs (např. před startem)
        'TyreLife': np.nan,               # Chybějící stáří pneu
        'PitInTime': pd.NaT,
        'PitOutTime': pd.NaT,
        'LapTime': pd.NaT,                # Kolo nedokončeno nebo DNF
        'Sector1Time': pd.Timedelta(seconds=25.123),
        'Sector2Time': np.nan,
        'Sector3Time': pd.NaT
    })

    result = prepare_leaderboard_data(mock_lap_row)

    # Validace bezpečných Pythonových typů a výchozích hodnot
    assert result['gap_to_leader'] == "", "NaN hodnota u gap_to_leader nebyla konvertována na prázdný string"
    assert result['interval'] == "", "NaT hodnota u intervalu nebyla konvertována na prázdný string"
    assert result['compound'] == "S", "Chybějící směs nenastavila fallback hodnotu 'S'"
    assert result['tyre_age'] == 1, "Chybějící stáří pneu nenastavilo fallback hodnotu 1"
    assert result['in_pit'] is False, "Neplatné časy zastávek v boxech musí vyústit v False"
    assert result['last_lap_time'] == "", "NaT čas kola nebyl zkonvertován na prázdný string"
    assert result['sector1'] == "25.123", "Validní čas sektoru nebyl správně zformátován"
    assert result['sector2'] == "", "NaN hodnota u Sektoru 2 nebyla zkonvertována bezpečně"
    assert result['sector3'] == "", "NaT hodnota u Sektoru 3 nebyla zkonvertována bezpečně"
    assert result['is_personal_best'] is False, "Pokus o PB s chybějícím časem by měl být False"

def test_prepare_leaderboard_data_valid_pb():
    """
    Otestování správného zaznamenání nejrychlejšího kola jezdce ('Personal Best').
    """
    mock_lap_row = pd.Series({
        'GapToLeader': pd.Timedelta(seconds=5.432),
        'IntervalToPositionAhead': pd.Timedelta(seconds=1.234),
        'Compound': 'M',
        'TyreLife': 5.0,
        'PitInTime': pd.NaT,
        'PitOutTime': pd.NaT,
        'LapTime': pd.Timedelta(seconds=85.500), # 1:25.500
        'Sector1Time': pd.Timedelta(seconds=28.100),
        'Sector2Time': pd.Timedelta(seconds=30.200),
        'Sector3Time': pd.Timedelta(seconds=27.200)
    })
    
    prev_best = 90.0
    result = prepare_leaderboard_data(mock_lap_row, prev_best)
    
    assert result['gap_to_leader'] == "5.432"
    assert result['interval'] == "1.234"
    assert result['compound'] == "M"
    assert result['tyre_age'] == 5
    assert result['last_lap_time'] == "1:25.500"
    assert result['is_personal_best'] is True
    assert result['new_best_lap_secs'] == 85.5
    assert result['fastest_lap_time'] == "1:25.500"

"""Export existing Python engine results for browser parity regression tests."""
import json
import sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.core.models import ConstellationConfig, GroundStation, LinkBudgetConfig
from app.core.constellation import satellite_states_ecef
from app.core.coverage import multi_station_summary
from app.core.link_budget import downlink_margin_db
from app.core.tle import parse_tle_text, propagate_tles
from app.core.sampling import sample_times

def main():
    cases = []
    for altitude in (500, 888, 1280):
        for j2 in (False, True):
            cfg = ConstellationConfig(altitude_km=altitude, inclination_deg=42, planes=8, sats_per_plane=16, phasing=1, j2=j2)
            times = np.array([0, 300, 3600, 43200, 86400], dtype=float)
            states = satellite_states_ecef(cfg, times)
            indices = [0, 17, 42, 127]
            stations = [GroundStation("Seoul", 37.5665, 126.978, 20)]
            timeline, _ = multi_station_summary(cfg, stations, sample_times(1440, 300))
            cases.append({"altitude": altitude, "j2": j2, "times": times.tolist(), "indices": indices, "positions": states[:, indices].tolist(),
                          "summary": {key: timeline[0][key] for key in ("availability", "avg_visible", "max_visible", "handover_count", "reconnection_count", "max_sampled_outage_sec")}})
    tle = (ROOT / "examples/vanguard1_verification.tle").read_text()
    record = parse_tle_text(tle)[0]
    propagation = propagate_tles([record], record.epoch_utc)
    # G/T=5 corresponds to rx_gain=5+10log10(T), other loss includes rain.
    link = downlink_margin_db(1500, LinkBudgetConfig(eirp_dbw=45, rx_gain_dbi=5 + 10*np.log10(500), system_temp_k=500, other_losses_db=6))
    result = {"source":"Orbit Designer Python engine", "walker":cases, "tle":{"text":tle,"epoch":record.epoch_utc.isoformat(),"teme":propagation["teme_km"][0].tolist(),"ecef":propagation["ecef_km"][0].tolist()},"link":link}
    dest = ROOT / "tests/standalone/reference.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Reference written: {dest}")

if __name__ == "__main__":
    main()

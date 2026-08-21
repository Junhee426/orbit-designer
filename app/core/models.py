from dataclasses import dataclass, asdict
from typing import List, Dict, Any

@dataclass
class ConstellationConfig:
    altitude_km: float = 1280.0
    inclination_deg: float = 42.0
    planes: int = 8
    sats_per_plane: int = 16
    phasing: int = 1
    j2: bool = True

    @property
    def total_satellites(self) -> int:
        return self.planes * self.sats_per_plane

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

@dataclass
class GroundStation:
    name: str
    lat_deg: float
    lon_deg: float
    min_elevation_deg: float = 20.0

@dataclass
class LinkBudgetConfig:
    frequency_ghz: float = 20.0
    eirp_dbw: float = 55.0
    rx_gain_dbi: float = 35.0
    system_temp_k: float = 500.0
    data_rate_mbps: float = 200.0
    other_losses_db: float = 3.0
    required_ebn0_db: float = 4.5

@dataclass
class SimulationConfig:
    constellation: ConstellationConfig
    stations: List[GroundStation]
    duration_min: float = 120.0
    step_sec: float = 60.0
    link: LinkBudgetConfig = None

    def __post_init__(self):
        if self.link is None:
            self.link = LinkBudgetConfig()

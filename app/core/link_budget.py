import math
from .constants import C_KM_S, K_BOLTZMANN_DBW_PER_K_HZ
from .models import LinkBudgetConfig


def fspl_db(range_km: float, frequency_ghz: float) -> float:
    if range_km <= 0 or frequency_ghz <= 0:
        raise ValueError("range_km and frequency_ghz must be positive")
    # 20 log10(4*pi*R/lambda), with km and GHz -> 92.45 constant
    return 92.45 + 20.0 * math.log10(range_km) + 20.0 * math.log10(frequency_ghz)


def downlink_margin_db(range_km: float, cfg: LinkBudgetConfig):
    loss = fspl_db(range_km, cfg.frequency_ghz)
    pr_dbw = cfg.eirp_dbw + cfg.rx_gain_dbi - loss - cfg.other_losses_db
    n0_dbw_hz = K_BOLTZMANN_DBW_PER_K_HZ + 10.0 * math.log10(cfg.system_temp_k)
    cn0_dbhz = pr_dbw - n0_dbw_hz
    ebn0_db = cn0_dbhz - 10.0 * math.log10(cfg.data_rate_mbps * 1e6)
    return {
        "fspl_db": loss,
        "received_power_dbw": pr_dbw,
        "cn0_dbhz": cn0_dbhz,
        "ebn0_db": ebn0_db,
        "margin_db": ebn0_db - cfg.required_ebn0_db,
    }

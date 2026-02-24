"""
Enrichment service: converts a forecast (P10/P50/P90 per hour) into a per-hour
cost + contract-capacity risk breakdown.

All functions are pure (no DB, no I/O) and depend only on numpy/scipy.
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np
from scipy import stats as scipy_stats

from ..schemas import (
    ContractConfig,
    CostRiskSummary,
    ForecastPoint,
    HourlyEnrichedPoint,
)

# Minimum sigma to avoid division-by-zero when P10 == P90
_SIGMA_EPSILON = 0.01


def resolve_price_eur_mwh(ts: datetime, config: ContractConfig) -> float:
    """Return the energy price in EUR/MWh for a given UTC timestamp."""
    if config.energy_price_source == "manual_flat":
        return config.flat_price_eur_mwh or 0.0

    if config.energy_price_source == "manual_tou":
        dow = ts.weekday()   # 0=Mon … 6=Sun
        hour = ts.hour
        for slot in config.tou_schedule:
            if slot.dow == dow and slot.h_from <= hour < slot.h_to:
                return slot.eur_mwh
        return 0.0

    # Fallback (e.g. uploaded_csv not yet implemented in pilot)
    return 0.0


def compute_hour_exceedance(
    p10: float,
    p50: float,
    p90: float,
    cap: float,
) -> tuple[float, float]:
    """
    Compute per-hour exceedance probability and expected excess using a
    normal-distribution approximation.

    Distribution assumed: X ~ N(mean=p50, sigma)
    where sigma = (p90 - p10) / (2 * 1.28155)
    (because P10 = mean - 1.28155σ, P90 = mean + 1.28155σ).

    Returns:
        exceedance_p    : P(X > cap)  in [0, 1]
        expected_excess : E[max(0, X - cap)] in kW
    """
    sigma = max((p90 - p10) / (2.0 * 1.28155), _SIGMA_EPSILON)
    z = (cap - p50) / sigma

    exceedance_p: float = float(scipy_stats.norm.sf(z))

    # Truncated-normal formula for E[max(0, X - cap)]:
    #   = sigma * phi(z) + (p50 - cap) * Phi(-z)
    phi_z = float(scipy_stats.norm.pdf(z))
    Phi_neg_z = float(scipy_stats.norm.cdf(-z))
    expected_excess = max(0.0, sigma * phi_z + (p50 - cap) * Phi_neg_z)

    return exceedance_p, expected_excess


def enrich_forecast(
    forecast: list[ForecastPoint],
    config: ContractConfig,
) -> list[HourlyEnrichedPoint]:
    """
    Build HourlyEnrichedPoint[] from a list of ForecastPoint objects.

    Cost calculation:
        kWh per hour = kW * 1h
        cost_EUR = kWh * (EUR/MWh) / 1000

    Penalty proration (if penalty_model == "expected_exceedance_cost"):
        The penalty rate is specified per kW per billing period (assumed 730 h).
        For a forecast of N hours the prorated fraction = N / 730.
        expected_penalty_EUR = expected_excess_kW * rate * (N / 730)
    """
    n = len(forecast)
    period_proration = n / 730.0
    cap = config.contracted_capacity_kw

    result: list[HourlyEnrichedPoint] = []
    for pt in forecast:
        eur_mwh = resolve_price_eur_mwh(pt.ts, config)

        cost_p10 = pt.p10 * eur_mwh / 1000.0
        cost_p50 = pt.p50 * eur_mwh / 1000.0
        cost_p90 = pt.p90 * eur_mwh / 1000.0

        exceedance_p, expected_excess = compute_hour_exceedance(
            pt.p10, pt.p50, pt.p90, cap
        )

        if (
            config.penalty_model == "expected_exceedance_cost"
            and config.penalty_rate_eur_per_kw_period is not None
        ):
            expected_penalty = (
                expected_excess
                * config.penalty_rate_eur_per_kw_period
                * period_proration
            )
        else:
            expected_penalty = 0.0

        result.append(
            HourlyEnrichedPoint(
                ts=pt.ts,
                p10_kw=pt.p10,
                p50_kw=pt.p50,
                p90_kw=pt.p90,
                eur_mwh=eur_mwh,
                cost_p10_eur=cost_p10,
                cost_p50_eur=cost_p50,
                cost_p90_eur=cost_p90,
                exceedance_p=exceedance_p,
                expected_excess_kw=expected_excess,
                expected_penalty_eur=expected_penalty,
            )
        )

    return result


def compute_summary(
    enriched: list[HourlyEnrichedPoint],
    risk_threshold_frac: float,
) -> CostRiskSummary:
    """Compute aggregate KPIs from the enriched hourly list."""
    if not enriched:
        return CostRiskSummary(
            total_cost_p10_eur=0.0,
            total_cost_p50_eur=0.0,
            total_cost_p90_eur=0.0,
            hours_at_risk=0,
            peak_cost_hour_ts=None,
            peak_risk_hour_ts=None,
        )

    total_p10 = sum(h.cost_p10_eur for h in enriched)
    total_p50 = sum(h.cost_p50_eur for h in enriched)
    total_p90 = sum(h.cost_p90_eur for h in enriched)
    hours_at_risk = sum(1 for h in enriched if h.exceedance_p >= risk_threshold_frac)

    peak_cost_idx = int(np.argmax([h.cost_p50_eur for h in enriched]))
    peak_risk_idx = int(np.argmax([h.exceedance_p for h in enriched]))

    return CostRiskSummary(
        total_cost_p10_eur=total_p10,
        total_cost_p50_eur=total_p50,
        total_cost_p90_eur=total_p90,
        hours_at_risk=hours_at_risk,
        peak_cost_hour_ts=enriched[peak_cost_idx].ts,
        peak_risk_hour_ts=enriched[peak_risk_idx].ts,
    )

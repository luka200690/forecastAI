"""
Unit tests for the enrichment service.

Run with:
    pytest backend/tests/test_enrichment.py -v
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.schemas import ContractConfig, ForecastPoint, TouSlot
from app.services.enrichment import (
    _SIGMA_EPSILON,
    compute_hour_exceedance,
    compute_summary,
    enrich_forecast,
    resolve_price_eur_mwh,
)


# ── compute_hour_exceedance ────────────────────────────────────────────────────

def test_exceedance_at_capacity():
    """When P50 == cap the exceedance probability should be ~0.5."""
    p, exc = compute_hour_exceedance(p10=80, p50=100, p90=120, cap=100)
    assert abs(p - 0.5) < 1e-5
    assert exc >= 0


def test_exceedance_well_below_cap():
    """When load is far below cap, exceedance probability should be near 0."""
    p, exc = compute_hour_exceedance(p10=50, p50=60, p90=70, cap=200)
    assert p < 0.01
    assert exc < 0.01


def test_exceedance_well_above_cap():
    """When load is far above cap, exceedance probability should be near 1."""
    p, exc = compute_hour_exceedance(p10=190, p50=200, p90=210, cap=100)
    assert p > 0.99
    assert exc > 90


def test_exceedance_zero_spread_no_divide_by_zero():
    """When P10 == P50 == P90, sigma is clamped to EPSILON — no crash."""
    p, exc = compute_hour_exceedance(p10=100, p50=100, p90=100, cap=150)
    assert 0.0 <= p <= 1.0
    assert exc >= 0


def test_exceedance_probability_bounds():
    """Exceedance probability must always be in [0, 1]."""
    for p10, p50, p90, cap in [
        (0, 0, 0, 0),
        (1000, 2000, 3000, 500),
        (100, 100, 100, 50),
    ]:
        prob, _ = compute_hour_exceedance(p10, p50, p90, cap)
        assert 0.0 <= prob <= 1.0, f"Out of bounds for p50={p50}, cap={cap}"


# ── resolve_price_eur_mwh ──────────────────────────────────────────────────────

def _config(**kwargs) -> ContractConfig:
    defaults = dict(
        upload_id="test",
        contracted_capacity_kw=500,
    )
    defaults.update(kwargs)
    return ContractConfig(**defaults)


def test_flat_price():
    cfg = _config(energy_price_source="manual_flat", flat_price_eur_mwh=120.0)
    ts = datetime(2024, 1, 1, 10, tzinfo=timezone.utc)
    assert resolve_price_eur_mwh(ts, cfg) == 120.0


def test_flat_price_none_returns_zero():
    cfg = _config(energy_price_source="manual_flat", flat_price_eur_mwh=None)
    ts = datetime(2024, 1, 1, 10, tzinfo=timezone.utc)
    assert resolve_price_eur_mwh(ts, cfg) == 0.0


def test_tou_price_match():
    """Monday 09:00 UTC should match dow=0 h_from=8 h_to=12."""
    slot = TouSlot(dow=0, h_from=8, h_to=12, eur_mwh=100.0)
    cfg = _config(energy_price_source="manual_tou", tou_schedule=[slot])
    ts = datetime(2024, 1, 1, 9, tzinfo=timezone.utc)  # 2024-01-01 = Monday
    assert resolve_price_eur_mwh(ts, cfg) == 100.0


def test_tou_price_no_match_returns_zero():
    """Hour outside defined bands returns 0.0."""
    slot = TouSlot(dow=0, h_from=8, h_to=12, eur_mwh=100.0)
    cfg = _config(energy_price_source="manual_tou", tou_schedule=[slot])
    ts = datetime(2024, 1, 1, 14, tzinfo=timezone.utc)  # 14:00, out of band
    assert resolve_price_eur_mwh(ts, cfg) == 0.0


def test_tou_price_wrong_day_returns_zero():
    """Slot defined for Mon, but ts is Tuesday — should return 0.0."""
    slot = TouSlot(dow=0, h_from=8, h_to=12, eur_mwh=100.0)
    cfg = _config(energy_price_source="manual_tou", tou_schedule=[slot])
    ts = datetime(2024, 1, 2, 9, tzinfo=timezone.utc)  # 2024-01-02 = Tuesday
    assert resolve_price_eur_mwh(ts, cfg) == 0.0


# ── enrich_forecast ────────────────────────────────────────────────────────────

def _fp(hour: int, p10: float, p50: float, p90: float) -> ForecastPoint:
    return ForecastPoint(
        ts=datetime(2024, 1, 1, hour, tzinfo=timezone.utc),
        p10=p10, p50=p50, p90=p90,
    )


def test_enrich_flat_price_cost_calculation():
    """cost_p50_eur should equal p50 * price / 1000 exactly."""
    pts = [_fp(0, 90, 100, 110)]
    cfg = _config(energy_price_source="manual_flat", flat_price_eur_mwh=50.0)
    result = enrich_forecast(pts, cfg)
    assert len(result) == 1
    r = result[0]
    expected_cost = 100.0 * 50.0 / 1000.0   # = 5.0
    assert abs(r.cost_p50_eur - expected_cost) < 1e-9


def test_enrich_penalty_model_computes_penalty():
    """With expected_exceedance_cost model, expected_penalty_eur should be > 0."""
    pts = [_fp(0, 140, 160, 180)]   # p50=160 >> cap=150
    cfg = _config(
        contracted_capacity_kw=150,
        energy_price_source="manual_flat",
        flat_price_eur_mwh=60.0,
        penalty_model="expected_exceedance_cost",
        penalty_rate_eur_per_kw_period=10.0,
    )
    result = enrich_forecast(pts, cfg)
    assert result[0].expected_penalty_eur > 0.0


def test_enrich_alert_only_no_penalty():
    """With alert_only model, expected_penalty_eur must always be 0."""
    pts = [_fp(0, 140, 200, 260)]   # clearly above cap
    cfg = _config(
        contracted_capacity_kw=100,
        energy_price_source="manual_flat",
        flat_price_eur_mwh=80.0,
        penalty_model="alert_only",
    )
    result = enrich_forecast(pts, cfg)
    assert result[0].expected_penalty_eur == 0.0


# ── compute_summary ────────────────────────────────────────────────────────────

def test_summary_hours_at_risk_count():
    from app.schemas import HourlyEnrichedPoint

    def _h(hour: int, exceedance_p: float, cost_p50: float):
        return HourlyEnrichedPoint(
            ts=datetime(2024, 1, 1, hour, tzinfo=timezone.utc),
            p10_kw=0, p50_kw=0, p90_kw=0, eur_mwh=0,
            cost_p10_eur=0, cost_p50_eur=cost_p50, cost_p90_eur=0,
            exceedance_p=exceedance_p, expected_excess_kw=0, expected_penalty_eur=0,
        )

    enriched = [_h(h, 0.8 if h < 3 else 0.1, float(h)) for h in range(6)]
    summary = compute_summary(enriched, risk_threshold_frac=0.7)
    assert summary.hours_at_risk == 3
    assert abs(summary.total_cost_p50_eur - sum(range(6))) < 1e-9


def test_summary_empty_input():
    summary = compute_summary([], risk_threshold_frac=0.7)
    assert summary.hours_at_risk == 0
    assert summary.total_cost_p50_eur == 0.0
    assert summary.peak_cost_hour_ts is None

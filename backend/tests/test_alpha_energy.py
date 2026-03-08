from __future__ import annotations

from app.services.alpha_energy import forecast_monthly_costs, parse_bill_csv, run_bill_manager


def test_parse_bill_csv_required_columns() -> None:
    content = b"period_start,period_end,kwh,total_eur\n2026-01-01,2026-01-31,300,90\n"
    df = parse_bill_csv(content)
    assert len(df) == 1
    assert "kwh" in df.columns


def test_run_bill_manager_detects_duplicate_period() -> None:
    content = b"period_start,period_end,kwh,total_eur\n2026-01-01,2026-01-31,300,90\n2026-01-01,2026-01-31,310,95\n"
    df = parse_bill_csv(content)
    artifacts = run_bill_manager(df)
    assert any(a["type"] == "duplicate_period" for a in artifacts.anomalies)


def test_forecast_monthly_costs_returns_horizon() -> None:
    ledger = [
        {
            "period_start": "2025-10-01T00:00:00Z",
            "period_end": "2025-10-31T00:00:00Z",
            "kwh": 320.0,
            "total_eur": 88.0,
        },
        {
            "period_start": "2025-11-01T00:00:00Z",
            "period_end": "2025-11-30T00:00:00Z",
            "kwh": 340.0,
            "total_eur": 95.0,
        },
        {
            "period_start": "2025-12-01T00:00:00Z",
            "period_end": "2025-12-31T00:00:00Z",
            "kwh": 360.0,
            "total_eur": 101.0,
        },
    ]
    res = forecast_monthly_costs(ledger, months_ahead=4)
    assert len(res.forecast) == 4
    assert res.metrics["history_months"] == 3

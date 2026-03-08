from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd


REQUIRED_BILL_COLUMNS = [
    "period_start",
    "period_end",
    "kwh",
    "total_eur",
]


@dataclass
class BillManagerArtifacts:
    ledger: list[dict]
    anomalies: list[dict]
    summary: dict


@dataclass
class BillForecastArtifacts:
    forecast: list[dict]
    metrics: dict


def parse_bill_csv(content: bytes) -> pd.DataFrame:
    df = pd.read_csv(io.BytesIO(content))
    df.columns = [str(c).strip().lower() for c in df.columns]

    missing = [c for c in REQUIRED_BILL_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    for c in ["period_start", "period_end"]:
        df[c] = pd.to_datetime(df[c], errors="coerce", utc=True)
        if df[c].isna().any():
            raise ValueError(f"Invalid datetime values in {c}")

    numeric_cols = [
        "kwh",
        "total_eur",
        "fixed_eur",
        "taxes_eur",
        "fees_eur",
        "variable_eur",
    ]
    for c in numeric_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    for c in ["kwh", "total_eur"]:
        if df[c].isna().any():
            raise ValueError(f"Column {c} must be numeric and non-empty")

    df = df.sort_values("period_start").reset_index(drop=True)
    return df


def run_bill_manager(df: pd.DataFrame) -> BillManagerArtifacts:
    work = df.copy()

    for c in ["fixed_eur", "taxes_eur", "fees_eur", "variable_eur"]:
        if c not in work.columns:
            work[c] = 0.0

    work["days"] = (work["period_end"] - work["period_start"]).dt.days.clip(lower=1)
    work["eur_per_kwh"] = np.where(work["kwh"] > 0, work["total_eur"] / work["kwh"], np.nan)

    anomalies: list[dict] = []

    # Rule 1: duplicate billing period
    dup_mask = work.duplicated(subset=["period_start", "period_end"], keep=False)
    for _, row in work[dup_mask].iterrows():
        anomalies.append(
            {
                "type": "duplicate_period",
                "severity": "high",
                "period_start": row["period_start"].isoformat(),
                "period_end": row["period_end"].isoformat(),
                "detail": "Duplicate billing period detected.",
            }
        )

    # Rule 2: unusual spend spike vs rolling baseline
    work["rolling_total"] = work["total_eur"].rolling(window=3, min_periods=2).mean()
    spike_mask = (work["rolling_total"].notna()) & (work["total_eur"] > (1.35 * work["rolling_total"]))
    for _, row in work[spike_mask].iterrows():
        anomalies.append(
            {
                "type": "spend_spike",
                "severity": "medium",
                "period_start": row["period_start"].isoformat(),
                "period_end": row["period_end"].isoformat(),
                "detail": f"Total bill {row['total_eur']:.2f} EUR exceeds 135% of recent average.",
            }
        )

    # Rule 3: abnormal unit price spread
    median_price = float(np.nanmedian(work["eur_per_kwh"])) if len(work) else 0.0
    if median_price > 0:
        high_price = work["eur_per_kwh"] > (1.30 * median_price)
        for _, row in work[high_price].iterrows():
            anomalies.append(
                {
                    "type": "unit_price_high",
                    "severity": "medium",
                    "period_start": row["period_start"].isoformat(),
                    "period_end": row["period_end"].isoformat(),
                    "detail": f"Unit price {row['eur_per_kwh']:.4f} EUR/kWh above 130% of median {median_price:.4f}.",
                }
            )

    ledger = []
    for _, row in work.iterrows():
        ledger.append(
            {
                "period_start": row["period_start"].isoformat(),
                "period_end": row["period_end"].isoformat(),
                "kwh": float(row["kwh"]),
                "fixed_eur": float(row["fixed_eur"]),
                "taxes_eur": float(row["taxes_eur"]),
                "fees_eur": float(row["fees_eur"]),
                "variable_eur": float(row["variable_eur"]),
                "total_eur": float(row["total_eur"]),
                "eur_per_kwh": float(row["eur_per_kwh"]) if pd.notna(row["eur_per_kwh"]) else None,
            }
        )

    summary = {
        "months": int(len(work)),
        "total_kwh": float(work["kwh"].sum()),
        "total_eur": float(work["total_eur"].sum()),
        "avg_monthly_eur": float(work["total_eur"].mean()) if len(work) else 0.0,
        "avg_eur_per_kwh": float(np.nanmean(work["eur_per_kwh"])) if len(work) else 0.0,
        "anomaly_count": len(anomalies),
        "recommended_action": (
            "investigate" if any(a["severity"] == "high" for a in anomalies)
            else "pay_with_attention" if anomalies
            else "pay"
        ),
    }

    return BillManagerArtifacts(ledger=ledger, anomalies=anomalies, summary=summary)


def forecast_monthly_costs(ledger: list[dict], months_ahead: int = 3) -> BillForecastArtifacts:
    if len(ledger) < 3:
        raise ValueError("At least 3 months of ledger history are required.")
    if months_ahead < 1 or months_ahead > 12:
        raise ValueError("months_ahead must be between 1 and 12")

    df = pd.DataFrame(ledger).copy()
    if "period_end" not in df.columns or "total_eur" not in df.columns or "kwh" not in df.columns:
        raise ValueError("Ledger must contain period_end, total_eur, and kwh")

    df["period_end"] = pd.to_datetime(df["period_end"], utc=True, errors="coerce")
    if df["period_end"].isna().any():
        raise ValueError("Invalid period_end in ledger")

    df = df.sort_values("period_end").reset_index(drop=True)
    totals = df["total_eur"].astype(float).to_numpy()
    kwh = df["kwh"].astype(float).to_numpy()

    recent_window = min(6, len(df))
    mean_total = float(np.mean(totals[-recent_window:]))
    std_total = float(np.std(totals[-recent_window:]))

    mean_kwh = float(np.mean(kwh[-recent_window:]))
    std_kwh = float(np.std(kwh[-recent_window:]))

    # Backtest against one-step naive baseline for transparency
    naive_preds = totals[:-1]
    actuals = totals[1:]
    mae = float(np.mean(np.abs(actuals - naive_preds))) if len(actuals) else 0.0
    mape = float(np.mean(np.abs((actuals - naive_preds) / np.maximum(actuals, 1e-9))) * 100.0) if len(actuals) else 0.0

    last_end = df["period_end"].iloc[-1]
    forecast = []
    for m in range(1, months_ahead + 1):
        next_end = (last_end + pd.DateOffset(months=m)).to_pydatetime()
        p50_cost = mean_total
        p10_cost = max(0.0, mean_total - 1.28 * std_total)
        p90_cost = mean_total + 1.28 * std_total

        p50_kwh = mean_kwh
        p10_kwh = max(0.0, mean_kwh - 1.28 * std_kwh)
        p90_kwh = mean_kwh + 1.28 * std_kwh

        forecast.append(
            {
                "month_end": next_end.astimezone(timezone.utc).isoformat(),
                "cost_p10_eur": float(p10_cost),
                "cost_p50_eur": float(p50_cost),
                "cost_p90_eur": float(p90_cost),
                "kwh_p10": float(p10_kwh),
                "kwh_p50": float(p50_kwh),
                "kwh_p90": float(p90_kwh),
            }
        )

    metrics = {
        "backtest_mae_eur": mae,
        "backtest_mape_pct": mape,
        "history_months": int(len(df)),
        "model": "rolling_mean_with_interval",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    return BillForecastArtifacts(forecast=forecast, metrics=metrics)

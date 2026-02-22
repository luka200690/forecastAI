from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, cast

import numpy as np
import pandas as pd

from ..models import Upload
from ..schemas import FeatureImportanceItem, ForecastPoint, ForecastResponse, Granularity, Metrics, RiskMethod, RiskMetrics
from .features import build_training_features
from .risk import compute_risk


class QuantileRegressorAdapter:
    def __init__(self, q: float) -> None:
        self.q = q
        self.model: Any | None = None
        self.provider = ""
        self._build()

    def _build(self) -> None:
        try:
            from lightgbm import LGBMRegressor

            self.model = LGBMRegressor(objective="quantile", alpha=self.q, n_estimators=300, learning_rate=0.05)
            self.provider = "lightgbm"
            return
        except Exception:
            pass

        try:
            from catboost import CatBoostRegressor

            self.model = CatBoostRegressor(
                loss_function=f"Quantile:alpha={self.q}",
                iterations=300,
                depth=6,
                learning_rate=0.05,
                verbose=False,
            )
            self.provider = "catboost"
            return
        except Exception:
            pass

        try:
            from xgboost import XGBRegressor

            self.model = XGBRegressor(
                objective="reg:quantileerror",
                quantile_alpha=self.q,
                n_estimators=300,
                max_depth=6,
                learning_rate=0.05,
            )
            self.provider = "xgboost"
            return
        except Exception:
            pass

        try:
            from sklearn.ensemble import GradientBoostingRegressor

            self.model = GradientBoostingRegressor(
                loss="quantile",
                alpha=self.q,
                n_estimators=300,
                learning_rate=0.05,
                random_state=42,
            )
            self.provider = "sklearn"
            return
        except Exception as exc:
            raise RuntimeError(
                "No supported quantile model backend available. Install lightgbm, catboost, xgboost, or scikit-learn."
            ) from exc

    def fit(self, X: pd.DataFrame, y: pd.Series) -> None:
        if self.provider == "catboost":
            self.model.fit(X, y)
        else:
            self.model.fit(X.values, y.values)

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if self.provider == "catboost":
            return np.asarray(self.model.predict(X), dtype=float)
        return np.asarray(self.model.predict(X.values), dtype=float)

    def feature_importance(self, feature_names: list[str], X_val: pd.DataFrame, y_val: pd.Series) -> list[FeatureImportanceItem]:
        values: np.ndarray | None = None
        if hasattr(self.model, "feature_importances_"):
            values = np.asarray(getattr(self.model, "feature_importances_"), dtype=float)
        if values is None or values.size != len(feature_names) or np.allclose(values.sum(), 0.0):
            try:
                from sklearn.inspection import permutation_importance

                perm = permutation_importance(self.model, X_val.values, y_val.values, n_repeats=5, random_state=42)
                values = np.asarray(perm.importances_mean, dtype=float)
            except Exception:
                values = np.ones(len(feature_names), dtype=float)

        values = np.maximum(values, 0.0)
        denom = float(values.sum()) if float(values.sum()) > 0 else 1.0
        normalized = values / denom
        paired = sorted(zip(feature_names, normalized), key=lambda x: x[1], reverse=True)[:10]
        return [FeatureImportanceItem(feature=name, importance=float(val)) for name, val in paired]


def _smape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    denom = np.maximum(np.abs(y_true) + np.abs(y_pred), 1e-8)
    return float(np.mean(2.0 * np.abs(y_pred - y_true) / denom))


def _load_clean_data(upload: Upload) -> pd.DataFrame:
    p = Path(upload.storage_path)
    parquet = p / "clean.parquet"
    csv = p / "clean.csv"
    if parquet.exists():
        df = pd.read_parquet(parquet)
    elif csv.exists():
        df = pd.read_csv(csv)
    else:
        raise FileNotFoundError("Clean dataset not found for upload.")

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["timestamp", "value"]).sort_values("timestamp").reset_index(drop=True)
    return df[["timestamp", "value"]]


def _future_feature_row(ts: pd.Timestamp, history: list[float], granularity: str) -> dict[str, float]:
    row: dict[str, float] = {}
    row["hour"] = float(ts.hour)
    row["day_of_week"] = float(ts.dayofweek)
    row["month"] = float(ts.month)
    row["is_weekend"] = float(1 if ts.dayofweek >= 5 else 0)
    row["lag_1"] = float(history[-1])
    if granularity == "hourly":
        row["lag_24"] = float(history[-24])
        row["lag_168"] = float(history[-168])
    else:
        row["lag_7"] = float(history[-7])
    row["roll_mean_7"] = float(np.mean(history[-7:]))
    row["roll_mean_28"] = float(np.mean(history[-28:]))
    return row


def _enforce_order(p10: np.ndarray, p50: np.ndarray, p90: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    low = np.minimum.reduce([p10, p50, p90])
    high = np.maximum.reduce([p10, p50, p90])
    mid = np.clip(p50, low, high)
    return low, mid, high


@dataclass
class ForecastArtifacts:
    response: ForecastResponse
    residuals: np.ndarray
    artifact_path: str


def generate_forecast(upload: Upload, horizon_days: int, threshold: float | None = None) -> ForecastArtifacts:
    df = _load_clean_data(upload)
    feat = build_training_features(df, upload.granularity)
    min_rows = 200 if upload.granularity == "hourly" else 40
    if len(feat.X) < min_rows:
        raise ValueError(f"Not enough rows after feature generation. Need at least {min_rows}.")

    split = int(len(feat.X) * 0.8)
    if split <= 0 or split >= len(feat.X):
        raise ValueError("Unable to make train/validation split.")

    X_train, y_train = feat.X.iloc[:split], feat.y.iloc[:split]
    X_val, y_val = feat.X.iloc[split:], feat.y.iloc[split:]

    model_10 = QuantileRegressorAdapter(0.1)
    model_50 = QuantileRegressorAdapter(0.5)
    model_90 = QuantileRegressorAdapter(0.9)
    for m in (model_10, model_50, model_90):
        m.fit(X_train, y_train)

    val_p10 = model_10.predict(X_val)
    val_p50 = model_50.predict(X_val)
    val_p90 = model_90.predict(X_val)
    val_p10, val_p50, val_p90 = _enforce_order(val_p10, val_p50, val_p90)

    mae = float(np.mean(np.abs(y_val.values - val_p50)))
    smape = _smape(y_val.values, val_p50)
    peak_error = float(np.max(val_p50) - np.max(y_val.values))
    metrics = Metrics(mae=mae, smape=smape, peak_error=peak_error)

    feature_importance = model_50.feature_importance(feat.feature_names, X_val, y_val)
    residuals = y_val.values - val_p50

    periods = horizon_days * 24 if upload.granularity == "hourly" else horizon_days
    step = pd.Timedelta(hours=1) if upload.granularity == "hourly" else pd.Timedelta(days=1)

    history = df["value"].astype(float).tolist()
    timestamps = df["timestamp"]
    next_ts = timestamps.iloc[-1] + step
    future_ts: list[pd.Timestamp] = []
    future_p10: list[float] = []
    future_p50: list[float] = []
    future_p90: list[float] = []

    for _ in range(periods):
        row = _future_feature_row(next_ts, history, upload.granularity)
        X_next = pd.DataFrame([row])
        p10 = float(model_10.predict(X_next)[0])
        p50 = float(model_50.predict(X_next)[0])
        p90 = float(model_90.predict(X_next)[0])
        a10, a50, a90 = _enforce_order(np.array([p10]), np.array([p50]), np.array([p90]))
        p10, p50, p90 = float(a10[0]), float(a50[0]), float(a90[0])
        future_ts.append(next_ts)
        future_p10.append(p10)
        future_p50.append(p50)
        future_p90.append(p90)
        history.append(p50)
        next_ts = next_ts + step

    risk = None
    if threshold is not None:
        rr = compute_risk(np.asarray(future_p50), threshold, residuals)
        risk = RiskMetrics(
            threshold=rr.threshold,
            exceedance_probability=rr.exceedance_probability,
            expected_exceedance=rr.expected_exceedance,
            risk_score=rr.risk_score,
            method=cast(RiskMethod, rr.method),
        )

    forecast = [
        ForecastPoint(ts=ts.to_pydatetime().astimezone(timezone.utc), p10=p10, p50=p50, p90=p90)
        for ts, p10, p50, p90 in zip(future_ts, future_p10, future_p50, future_p90)
    ]

    response = ForecastResponse(
        upload_id=upload.id,
        granularity=cast(Granularity, upload.granularity),
        metrics=metrics,
        feature_importance=feature_importance,
        forecast=forecast,
        risk=risk,
    )

    artifacts_dir = Path(upload.storage_path) / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    threshold_key = "none" if threshold is None else str(threshold).replace(".", "_")
    artifact_path = artifacts_dir / f"forecast_h{horizon_days}_t{threshold_key}.json"
    payload = response.model_dump(mode="json")
    payload["validation_residuals"] = residuals.tolist()
    payload["meta"] = {
        "horizon_days": horizon_days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_provider": model_50.provider,
    }
    artifact_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return ForecastArtifacts(response=response, residuals=residuals, artifact_path=str(artifact_path))

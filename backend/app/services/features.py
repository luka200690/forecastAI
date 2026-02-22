from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass
class FeatureBuildResult:
    X: pd.DataFrame
    y: pd.Series
    timestamps: pd.Series
    feature_names: list[str]


def infer_granularity(df: pd.DataFrame) -> str:
    ts = df["timestamp"].sort_values()
    deltas = ts.diff().dropna()
    if deltas.empty:
        return "daily"
    median_delta = deltas.median()
    return "hourly" if median_delta <= pd.Timedelta(hours=1) else "daily"


def build_training_features(df: pd.DataFrame, granularity: str) -> FeatureBuildResult:
    work = df.copy()
    work = work.sort_values("timestamp").reset_index(drop=True)

    work["hour"] = work["timestamp"].dt.hour
    work["day_of_week"] = work["timestamp"].dt.dayofweek
    work["month"] = work["timestamp"].dt.month
    work["is_weekend"] = (work["day_of_week"] >= 5).astype(int)
    work["lag_1"] = work["value"].shift(1)

    if granularity == "hourly":
        work["lag_24"] = work["value"].shift(24)
        work["lag_168"] = work["value"].shift(168)
    else:
        work["lag_7"] = work["value"].shift(7)

    work["roll_mean_7"] = work["value"].shift(1).rolling(7).mean()
    work["roll_mean_28"] = work["value"].shift(1).rolling(28).mean()
    work = work.dropna().reset_index(drop=True)

    feature_names = ["hour", "day_of_week", "month", "is_weekend", "lag_1", "roll_mean_7", "roll_mean_28"]
    if granularity == "hourly":
        feature_names.extend(["lag_24", "lag_168"])
    else:
        feature_names.append("lag_7")

    X = work[feature_names].astype(float)
    y = work["value"].astype(float)
    timestamps = work["timestamp"]
    return FeatureBuildResult(X=X, y=y, timestamps=timestamps, feature_names=feature_names)

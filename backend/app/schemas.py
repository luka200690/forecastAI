from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


Granularity = Literal["hourly", "daily"]
HorizonDays = Literal[7, 14, 30]
RiskMethod = Literal["empirical_residual", "heuristic"]


class UploadResponse(BaseModel):
    upload_id: str
    inferred_granularity: Granularity
    start_ts: datetime
    end_ts: datetime
    rows: int


class ForecastRequest(BaseModel):
    upload_id: str
    horizon_days: HorizonDays
    threshold: float | None = Field(default=None, gt=0)


class Metrics(BaseModel):
    mae: float
    smape: float
    peak_error: float


class FeatureImportanceItem(BaseModel):
    feature: str
    importance: float


class ForecastPoint(BaseModel):
    ts: datetime
    p10: float
    p50: float
    p90: float


class RiskMetrics(BaseModel):
    threshold: float
    exceedance_probability: float = Field(ge=0.0, le=1.0)
    expected_exceedance: float = Field(ge=0.0)
    risk_score: float = Field(ge=0.0, le=100.0)
    method: RiskMethod


class ForecastResponse(BaseModel):
    upload_id: str
    granularity: Granularity
    metrics: Metrics
    feature_importance: list[FeatureImportanceItem]
    forecast: list[ForecastPoint]
    risk: RiskMetrics | None = None


class ChatRequest(BaseModel):
    upload_id: str
    question: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[Literal["forecast", "metrics", "risk", "features"]]


class DeleteUploadResponse(BaseModel):
    ok: bool

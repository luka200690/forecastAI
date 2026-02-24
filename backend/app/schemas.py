from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


Granularity = Literal["hourly", "daily"]
HorizonDays = Literal[7, 14, 30]
RiskMethod = Literal["empirical_residual", "heuristic"]


# ── Upload list ───────────────────────────────────────────────────────────────

class UploadListItem(BaseModel):
    upload_id: str
    filename: str
    granularity: Granularity
    rows: int
    start_ts: datetime
    end_ts: datetime
    created_at: datetime
    last_forecast_at: datetime | None
    metrics: "Metrics | None"
    schedule_enabled: bool = False
    schedule_horizon_days: int = 14


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


class WeatherPoint(BaseModel):
    ts: str
    temperature_c: float


class HistoryPoint(BaseModel):
    ts: datetime
    value: float


class ForecastResponse(BaseModel):
    upload_id: str
    granularity: Granularity
    metrics: Metrics
    feature_importance: list[FeatureImportanceItem]
    forecast: list[ForecastPoint]
    history: list[HistoryPoint] = []
    risk: RiskMetrics | None = None
    weather: list[WeatherPoint] = []


class AnalysisRequest(BaseModel):
    upload_id: str


class ChatRequest(BaseModel):
    upload_id: str
    question: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[Literal["forecast", "metrics", "risk", "features"]]


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatHistoryResponse(BaseModel):
    messages: list[ChatHistoryItem]


class DeleteUploadResponse(BaseModel):
    ok: bool


class ScheduleConfig(BaseModel):
    enabled: bool
    horizon_days: HorizonDays = 14
    threshold: float | None = Field(default=None, gt=0)


class ScheduleResponse(BaseModel):
    enabled: bool
    horizon_days: int
    threshold: float | None
    next_run_at: str  # human-readable, e.g. "daily at 06:00 UTC"


# ── Contract config & cost/risk enrichment ────────────────────────────────────

PenaltyModel = Literal["expected_exceedance_cost", "alert_only"]
EnergyPriceSource = Literal["manual_flat", "manual_tou"]


class TouSlot(BaseModel):
    dow: int          # 0=Mon … 6=Sun
    h_from: int       # 0–23 inclusive start
    h_to: int         # 1–24 exclusive end
    eur_mwh: float    # price for this band


class ContractConfig(BaseModel):
    upload_id: str
    contracted_capacity_kw: float = Field(gt=0)
    soft_limit_kw: float | None = None
    penalty_model: PenaltyModel = "alert_only"
    penalty_rate_eur_per_kw_period: float | None = None
    risk_threshold_pct: float = Field(default=70.0, ge=0.0, le=100.0)
    energy_price_source: EnergyPriceSource = "manual_flat"
    flat_price_eur_mwh: float | None = None
    tou_schedule: list[TouSlot] = []
    max_shed_kw: float = 0.0
    max_shift_hours: int = Field(default=4, ge=0, le=24)
    protected_hours: list[int] = []   # hour-of-day values (0–23) where no actions allowed


class HourlyEnrichedPoint(BaseModel):
    ts: datetime
    p10_kw: float
    p50_kw: float
    p90_kw: float
    eur_mwh: float
    cost_p10_eur: float
    cost_p50_eur: float
    cost_p90_eur: float
    exceedance_p: float        # 0–1: P(load > contracted_capacity)
    expected_excess_kw: float  # E[max(0, load - capacity)]
    expected_penalty_eur: float


class Recommendation(BaseModel):
    id: str
    action_type: Literal["shed", "shift"]
    ts_from: datetime
    ts_to: datetime
    delta_kw: float    # kW reduction (positive)
    delta_kwh: float   # energy reduction over window
    savings_eur: float
    risk_reduction: float   # absolute drop in exceedance_p
    rationale: str


class CostRiskSummary(BaseModel):
    total_cost_p10_eur: float
    total_cost_p50_eur: float
    total_cost_p90_eur: float
    hours_at_risk: int              # hours where exceedance_p >= risk_threshold
    peak_cost_hour_ts: datetime | None
    peak_risk_hour_ts: datetime | None


class EnrichmentResponse(BaseModel):
    upload_id: str
    config: ContractConfig
    summary: CostRiskSummary
    hourly: list[HourlyEnrichedPoint]
    recommendations: list[Recommendation]


class ContractConfigResponse(BaseModel):
    upload_id: str
    config: ContractConfig | None

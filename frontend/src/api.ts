export type Granularity = "hourly" | "daily";
export type HorizonDays = 7 | 14 | 30;

export interface UploadResponse {
  upload_id: string;
  inferred_granularity: Granularity;
  start_ts: string;
  end_ts: string;
  rows: number;
}

export interface Metrics {
  mae: number;
  smape: number;
  peak_error: number;
}

export interface FeatureImportanceItem {
  feature: string;
  importance: number;
}

export interface ForecastPoint {
  ts: string;
  p10: number;
  p50: number;
  p90: number;
}

export interface RiskMetrics {
  threshold: number;
  exceedance_probability: number;
  expected_exceedance: number;
  risk_score: number;
  method: "empirical_residual" | "heuristic";
}

export interface WeatherPoint {
  ts: string;
  temperature_c: number;
}

export interface HistoryPoint {
  ts: string;
  value: number;
}

export interface ForecastResponse {
  upload_id: string;
  granularity: Granularity;
  metrics: Metrics;
  feature_importance: FeatureImportanceItem[];
  forecast: ForecastPoint[];
  history?: HistoryPoint[];
  risk?: RiskMetrics;
  weather?: WeatherPoint[];
}

export interface ChatResponse {
  answer: string;
  sources: Array<"forecast" | "metrics" | "risk" | "features">;
}

export interface UploadListItem {
  upload_id: string;
  filename: string;
  granularity: Granularity;
  rows: number;
  start_ts: string;
  end_ts: string;
  created_at: string;
  last_forecast_at: string | null;
  metrics: Metrics | null;
  schedule_enabled: boolean;
  schedule_horizon_days: number;
}

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ChatHistoryResponse {
  messages: ChatHistoryItem[];
}

export interface ScheduleConfig {
  enabled: boolean;
  horizon_days: HorizonDays;
  threshold?: number | null;
}

export interface ScheduleResponse {
  enabled: boolean;
  horizon_days: number;
  threshold: number | null;
  next_run_at: string;
}

// ── Contract config & cost/risk enrichment ────────────────────────────────────

export type PenaltyModel = "expected_exceedance_cost" | "alert_only";
export type EnergyPriceSource = "manual_flat" | "manual_tou";

export interface TouSlot {
  dow: number;       // 0=Mon … 6=Sun
  h_from: number;    // 0–23
  h_to: number;      // 1–24 exclusive
  eur_mwh: number;
}

export interface ContractConfig {
  upload_id: string;
  contracted_capacity_kw: number;
  soft_limit_kw?: number | null;
  penalty_model: PenaltyModel;
  penalty_rate_eur_per_kw_period?: number | null;
  risk_threshold_pct: number;
  energy_price_source: EnergyPriceSource;
  flat_price_eur_mwh?: number | null;
  tou_schedule: TouSlot[];
  max_shed_kw: number;
  max_shift_hours: number;
  protected_hours: number[];
}

export interface HourlyEnrichedPoint {
  ts: string;
  p10_kw: number;
  p50_kw: number;
  p90_kw: number;
  eur_mwh: number;
  cost_p10_eur: number;
  cost_p50_eur: number;
  cost_p90_eur: number;
  exceedance_p: number;
  expected_excess_kw: number;
  expected_penalty_eur: number;
}

export type ActionType = "shed" | "shift";

export interface Recommendation {
  id: string;
  action_type: ActionType;
  ts_from: string;
  ts_to: string;
  delta_kw: number;
  delta_kwh: number;
  savings_eur: number;
  risk_reduction: number;
  rationale: string;
}

export interface CostRiskSummary {
  total_cost_p10_eur: number;
  total_cost_p50_eur: number;
  total_cost_p90_eur: number;
  hours_at_risk: number;
  peak_cost_hour_ts: string | null;
  peak_risk_hour_ts: string | null;
}

export interface EnrichmentResponse {
  upload_id: string;
  config: ContractConfig;
  summary: CostRiskSummary;
  hourly: HourlyEnrichedPoint[];
  recommendations: Recommendation[];
}

export interface ContractConfigResponse {
  upload_id: string;
  config: ContractConfig | null;
}

// ── Internals ─────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function authHeader(): Promise<Record<string, string>> {
  try {
    const token = await (window as any).Clerk?.session?.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "Request failed.";
    try {
      const payload = await res.json();
      detail = payload.detail ?? detail;
    } catch {
      // Keep default detail.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

// ── Upload API ────────────────────────────────────────────────────────────────

export async function uploadCsv(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    headers: { ...(await authHeader()) },
    body: form,
  });
  return parseResponse<UploadResponse>(res);
}

export async function getMyUploads(): Promise<UploadListItem[]> {
  const res = await fetch(`${API_BASE}/api/uploads`, {
    headers: { ...(await authHeader()) },
  });
  return parseResponse<UploadListItem[]>(res);
}

export async function getLastForecast(uploadId: string): Promise<ForecastResponse> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/forecast`, {
    headers: { ...(await authHeader()) },
  });
  return parseResponse<ForecastResponse>(res);
}

export async function getChatHistory(uploadId: string): Promise<ChatHistoryResponse> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/history`, {
    headers: { ...(await authHeader()) },
  });
  return parseResponse<ChatHistoryResponse>(res);
}

// ── Forecast API ──────────────────────────────────────────────────────────────

export async function getForecast(
  uploadId: string,
  horizonDays: HorizonDays,
  threshold?: number
): Promise<ForecastResponse> {
  const res = await fetch(`${API_BASE}/api/forecast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({
      upload_id: uploadId,
      horizon_days: horizonDays,
      threshold,
    }),
  });
  return parseResponse<ForecastResponse>(res);
}

export async function runAnalysis(uploadId: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ upload_id: uploadId }),
  });
  return parseResponse<ChatResponse>(res);
}

export async function askChat(uploadId: string, question: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({
      upload_id: uploadId,
      question,
    }),
  });
  return parseResponse<ChatResponse>(res);
}

export async function deleteUpload(uploadId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}`, {
    method: "DELETE",
    headers: { ...(await authHeader()) },
  });
  return parseResponse<{ ok: boolean }>(res);
}

// ── Actuals + Schedule API ─────────────────────────────────────────────────────

export async function appendActuals(uploadId: string, file: File): Promise<ForecastResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/actuals`, {
    method: "POST",
    headers: { ...(await authHeader()) },
    body: form,
  });
  return parseResponse<ForecastResponse>(res);
}

export async function setSchedule(uploadId: string, config: ScheduleConfig): Promise<ScheduleResponse> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/schedule`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(config),
  });
  return parseResponse<ScheduleResponse>(res);
}

export async function removeSchedule(uploadId: string): Promise<ScheduleResponse> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/schedule`, {
    method: "DELETE",
    headers: { ...(await authHeader()) },
  });
  return parseResponse<ScheduleResponse>(res);
}

export async function getContractConfig(uploadId: string): Promise<ContractConfigResponse> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/contract-config`, {
    headers: { ...(await authHeader()) },
  });
  return parseResponse<ContractConfigResponse>(res);
}

export async function saveContractConfig(
  uploadId: string,
  config: ContractConfig,
): Promise<ContractConfigResponse> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/contract-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(config),
  });
  return parseResponse<ContractConfigResponse>(res);
}

export async function runEnrichment(
  uploadId: string,
  config: ContractConfig,
): Promise<EnrichmentResponse> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(config),
  });
  return parseResponse<EnrichmentResponse>(res);
}

// ── Energy bill analysis ───────────────────────────────────────────────────────

export interface EnergyBillAnalysis {
  // Customer / plant identity
  customer_name: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_country: string | null;
  customer_vat: string | null;
  pod_code: string | null;          // Punto di Consegna — electricity
  pdi_code: string | null;          // Punto di Immissione — gas
  meter_serial: string | null;

  // Contract
  energy_type: "electricity" | "gas" | "district_heating" | "other";
  utility_company: string | null;
  contracted_capacity_kw: number | null;
  energy_price_eur_mwh: number | null;
  tariff_type: string | null;
  billing_period: string | null;
  connection_voltage: string | null;

  // Totals
  total_energy_kwh: number | null;
  total_energy_unit: string | null;
  total_bill_eur: number | null;

  notes: string | null;
  confidence: "high" | "medium" | "low";
}

export async function analyzeEnergyBill(file: File): Promise<EnergyBillAnalysis> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/energy-bill/analyze`, {
    method: "POST",
    headers: { ...(await authHeader()) },
    body: form,
  });
  return parseResponse<EnergyBillAnalysis>(res);
}

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

export interface ForecastResponse {
  upload_id: string;
  granularity: Granularity;
  metrics: Metrics;
  feature_importance: FeatureImportanceItem[];
  forecast: ForecastPoint[];
  risk?: RiskMetrics;
}

export interface ChatResponse {
  answer: string;
  sources: Array<"forecast" | "metrics" | "risk" | "features">;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

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

export async function uploadCsv(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    body: form,
  });
  return parseResponse<UploadResponse>(res);
}

export async function getForecast(
  uploadId: string,
  horizonDays: HorizonDays,
  threshold?: number
): Promise<ForecastResponse> {
  const res = await fetch(`${API_BASE}/api/forecast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      upload_id: uploadId,
      horizon_days: horizonDays,
      threshold,
    }),
  });
  return parseResponse<ForecastResponse>(res);
}

export async function askChat(uploadId: string, question: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  });
  return parseResponse<{ ok: boolean }>(res);
}

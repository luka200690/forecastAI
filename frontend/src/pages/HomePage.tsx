import { useEffect, useMemo, useState } from "react";
import { getMyUploads, type UploadListItem } from "../api";

interface HomePageProps {
  onOpenForecastModal: () => void;
  onNavigateHistory: () => void;
  onNavigatePlants: () => void;
}

function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color?: string }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 160, padding: "20px 24px" }}>
      <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: "2rem", fontWeight: 700, fontFamily: "monospace", color: color ?? "var(--c-text)", lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--c-muted)", marginTop: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
    </div>
  );
}

export function HomePage({ onOpenForecastModal, onNavigateHistory, onNavigatePlants }: HomePageProps) {
  const [uploads, setUploads] = useState<UploadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyUploads()
      .then(setUploads)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const plantsCount = useMemo(() => {
    try { return (JSON.parse(localStorage.getItem("forecastai_sites") ?? "[]") as unknown[]).length; }
    catch { return 0; }
  }, []);

  const billsCount = useMemo(() => {
    try { return (JSON.parse(localStorage.getItem("forecastai_bills") ?? "[]") as unknown[]).length; }
    catch { return 0; }
  }, []);

  const activeSchedules = uploads.filter((u) => u.schedule_enabled).length;
  const recentRuns = [...uploads]
    .filter((u) => u.last_forecast_at)
    .sort((a, b) => new Date(b.last_forecast_at!).getTime() - new Date(a.last_forecast_at!).getTime())
    .slice(0, 4);

  const FREQ_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

  return (
    <div style={{ padding: "32px", maxWidth: 1100, margin: "0 auto" }}>

      {/* Welcome */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
          Welcome to ForecastAI
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "var(--c-muted)" }}>
          Your energy forecasting dashboard — upload data, run models, and automate predictions.
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard icon="📂" value={loading ? "—" : uploads.length} label="Datasets" color="var(--c-teal, #00c8b4)" />
        <StatCard icon="🗓" value={loading ? "—" : activeSchedules} label="Active Schedules" color="#60A5FA" />
        <StatCard icon="🏭" value={plantsCount} label="Plants" color="#FBBF24" />
        <StatCard icon="📄" value={billsCount} label="Energy Bills" color="#FB923C" />
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: "0.8rem", marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>

        {/* Recent forecast runs */}
        <div className="card">
          <div className="card-header">
            <span className="card-icon">🕐</span>
            <h2 className="card-title">Recent Forecast Runs</h2>
          </div>
          {loading ? (
            <div style={{ color: "var(--c-muted)", fontSize: "0.82rem", padding: "16px 0", textAlign: "center" }}>Loading…</div>
          ) : recentRuns.length === 0 ? (
            <div style={{ color: "var(--c-muted)", fontSize: "0.82rem", padding: "16px 0", textAlign: "center" }}>
              No forecasts yet — upload a CSV and run your first model.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {recentRuns.map((u) => (
                <div key={u.upload_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--c-border)", fontSize: "0.8rem" }}>
                  <span style={{ fontSize: "0.9rem" }}>📈</span>
                  <span style={{ flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.filename}</span>
                  <span style={{ color: "var(--c-muted)", fontFamily: "monospace", fontSize: "0.73rem", whiteSpace: "nowrap" }}>
                    {new Date(u.last_forecast_at!).toLocaleDateString()}
                  </span>
                  {u.metrics && (
                    <span style={{ color: "var(--c-amber)", fontFamily: "monospace", fontSize: "0.73rem" }}>
                      MAE {u.metrics.mae.toFixed(2)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active schedules */}
        <div className="card">
          <div className="card-header">
            <span className="card-icon">🗓</span>
            <h2 className="card-title">Active Schedules</h2>
          </div>
          {loading ? (
            <div style={{ color: "var(--c-muted)", fontSize: "0.82rem", padding: "16px 0", textAlign: "center" }}>Loading…</div>
          ) : activeSchedules === 0 ? (
            <div style={{ color: "var(--c-muted)", fontSize: "0.82rem", padding: "16px 0", textAlign: "center" }}>
              No schedules configured — go to History to enable auto-forecasting.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {uploads.filter((u) => u.schedule_enabled).map((u) => (
                <div key={u.upload_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--c-border)", fontSize: "0.8rem" }}>
                  <span style={{ fontSize: "0.9rem" }}>⚡</span>
                  <span style={{ flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.filename}</span>
                  <span style={{ background: "rgba(0,200,180,0.15)", color: "var(--c-teal, #00c8b4)", border: "1px solid rgba(0,200,180,0.3)", borderRadius: 10, padding: "2px 9px", fontSize: "0.71rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                    ● {FREQ_LABEL[u.schedule_frequency] ?? u.schedule_frequency} · {u.schedule_horizon_days}d
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Quick actions */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-header">
          <span className="card-icon">⚡</span>
          <h2 className="card-title">Quick Actions</h2>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-run" style={{ padding: "8px 20px", fontSize: "0.83rem" }} onClick={onOpenForecastModal}>
            ▶ Run Forecast
          </button>
          <button className="btn btn-download" style={{ padding: "8px 20px", fontSize: "0.83rem" }} onClick={onNavigateHistory}>
            📋 View History
          </button>
          <button className="btn btn-actuals" style={{ padding: "8px 20px", fontSize: "0.83rem" }} onClick={onNavigatePlants}>
            🏭 Manage Plants
          </button>
        </div>
      </div>

    </div>
  );
}

import { useEffect, useState } from "react";
import { deleteUpload, getLastForecast, getMyUploads, removeSchedule, setSchedule, type ForecastResponse, type UploadListItem, type UploadResponse } from "../api";

interface HistoryPageProps {
  onLoad: (uploadInfo: UploadResponse, forecast: ForecastResponse) => void;
  onNavigateForecast: () => void;
}

export function HistoryPage({ onLoad, onNavigateForecast }: HistoryPageProps) {
  const [items, setItems] = useState<UploadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingId,   setLoadingId]   = useState<string | null>(null);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);

  useEffect(() => {
    getMyUploads()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleLoad = async (item: UploadListItem) => {
    if (!item.last_forecast_at) return;
    setLoadingId(item.upload_id);
    try {
      const forecast = await getLastForecast(item.upload_id);
      const uploadInfo: UploadResponse = {
        upload_id: item.upload_id,
        inferred_granularity: item.granularity,
        start_ts: item.start_ts,
        end_ts: item.end_ts,
        rows: item.rows,
      };
      onLoad(uploadInfo, forecast);
      onNavigateForecast();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load forecast.");
    } finally {
      setLoadingId(null);
    }
  };

  const handleScheduleToggle = async (item: UploadListItem) => {
    setSchedulingId(item.upload_id);
    try {
      if (item.schedule_enabled) {
        await removeSchedule(item.upload_id);
        setItems((prev) => prev.map((i) => i.upload_id === item.upload_id ? { ...i, schedule_enabled: false } : i));
      } else {
        await setSchedule(item.upload_id, { enabled: true, horizon_days: 14 });
        setItems((prev) => prev.map((i) => i.upload_id === item.upload_id ? { ...i, schedule_enabled: true } : i));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Schedule update failed.");
    } finally {
      setSchedulingId(null);
    }
  };

  const handleDelete = async (uploadId: string) => {
    try {
      await deleteUpload(uploadId);
      setItems((prev) => prev.filter((i) => i.upload_id !== uploadId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{
        margin: "0 0 20px",
        fontSize: "1.1rem",
        fontWeight: 700,
        color: "var(--c-text)",
        letterSpacing: "-0.01em",
      }}>
        Forecast History
      </h2>

      {error && (
        <div style={{
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.35)",
          borderRadius: 8,
          padding: "10px 14px",
          color: "#f87171",
          fontSize: "0.8rem",
          marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--c-muted)", fontSize: "0.85rem", padding: "40px 0", textAlign: "center" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div style={{
          color: "var(--c-muted)",
          fontSize: "0.85rem",
          padding: "60px 0",
          textAlign: "center",
        }}>
          No forecasts yet. Upload a CSV and run a forecast to get started.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.8rem",
          }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--c-border)" }}>
                {["Dataset", "Granularity", "Rows", "Date Range", "Forecast Run", "MAE", "sMAPE", "Schedule", "Actions"].map((h) => (
                  <th key={h} style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "var(--c-muted)",
                    fontSize: "0.71rem",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.upload_id}
                  style={{
                    borderBottom: "1px solid var(--c-border)",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <td style={{ padding: "10px 12px", color: "var(--c-text)", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.filename}
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--c-muted)" }}>
                    {item.granularity}
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--c-muted)", fontFamily: "monospace" }}>
                    {item.rows.toLocaleString()}
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--c-muted)", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {item.start_ts.slice(0, 10)} → {item.end_ts.slice(0, 10)}
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--c-muted)", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "0.75rem" }}>
                    {item.last_forecast_at ? new Date(item.last_forecast_at).toLocaleDateString() : <span style={{ opacity: 0.4 }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--c-amber)" }}>
                    {item.metrics ? item.metrics.mae.toFixed(3) : <span style={{ opacity: 0.4 }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--c-teal)" }}>
                    {item.metrics ? `${(item.metrics.smape * 100).toFixed(1)}%` : <span style={{ opacity: 0.4 }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => handleScheduleToggle(item)}
                      disabled={schedulingId === item.upload_id}
                      title={item.schedule_enabled ? `Scheduled · Daily at 06:00 UTC · ${item.schedule_horizon_days}d horizon\nClick to disable` : "Enable daily auto-forecast at 06:00 UTC"}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 12,
                        border: item.schedule_enabled ? "1px solid var(--c-teal, #00c8b4)" : "1px solid var(--c-border)",
                        background: item.schedule_enabled ? "rgba(0,200,180,0.15)" : "transparent",
                        color: item.schedule_enabled ? "var(--c-teal, #00c8b4)" : "var(--c-muted)",
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        cursor: schedulingId === item.upload_id ? "not-allowed" : "pointer",
                        opacity: schedulingId === item.upload_id ? 0.5 : 1,
                        transition: "all 0.15s",
                      }}
                    >
                      {schedulingId === item.upload_id ? "…" : item.schedule_enabled ? "● Daily" : "○ Off"}
                    </button>
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => handleLoad(item)}
                      disabled={!item.last_forecast_at || loadingId === item.upload_id}
                      style={{
                        marginRight: 6,
                        padding: "4px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--c-amber)",
                        background: "transparent",
                        color: "var(--c-amber)",
                        fontSize: "0.74rem",
                        cursor: item.last_forecast_at ? "pointer" : "not-allowed",
                        opacity: item.last_forecast_at ? 1 : 0.4,
                        fontWeight: 600,
                      }}
                    >
                      {loadingId === item.upload_id ? "Loading…" : "Load"}
                    </button>
                    <button
                      onClick={() => handleDelete(item.upload_id)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "1px solid rgba(239,68,68,0.4)",
                        background: "transparent",
                        color: "#f87171",
                        fontSize: "0.74rem",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

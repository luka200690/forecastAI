import { useEffect, useState } from "react";
import { deleteUpload, getLastForecast, getMyUploads, removeSchedule, setSchedule, type ForecastResponse, type HorizonDays, type ScheduleFrequency, type UploadListItem, type UploadResponse } from "../api";

interface HistoryPageProps {
  onLoad: (uploadInfo: UploadResponse, forecast: ForecastResponse) => void;
  onNavigateForecast: () => void;
}

const FREQ_LABEL: Record<ScheduleFrequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

export function HistoryPage({ onLoad, onNavigateForecast }: HistoryPageProps) {
  const [items, setItems] = useState<UploadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);

  // Schedule modal state
  const [scheduleModal, setScheduleModal] = useState<UploadListItem | null>(null);
  const [schedFreq, setSchedFreq] = useState<ScheduleFrequency>("daily");
  const [schedHorizon, setSchedHorizon] = useState<HorizonDays>(14);
  const [schedThreshold, setSchedThreshold] = useState<string>("");

  useEffect(() => {
    getMyUploads()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const openScheduleModal = (item: UploadListItem) => {
    setSchedFreq((item.schedule_frequency as ScheduleFrequency) || "daily");
    setSchedHorizon((item.schedule_horizon_days as HorizonDays) || 14);
    setSchedThreshold(item.schedule_threshold ? String(item.schedule_threshold) : "");
    setScheduleModal(item);
  };

  const handleScheduleSave = async () => {
    if (!scheduleModal) return;
    setSchedulingId(scheduleModal.upload_id);
    try {
      await setSchedule(scheduleModal.upload_id, {
        enabled: true,
        horizon_days: schedHorizon,
        threshold: schedThreshold ? parseFloat(schedThreshold) : null,
        frequency: schedFreq,
      });
      setItems((prev) => prev.map((i) => i.upload_id === scheduleModal.upload_id
        ? { ...i, schedule_enabled: true, schedule_frequency: schedFreq, schedule_horizon_days: schedHorizon }
        : i));
      setScheduleModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Schedule update failed.");
    } finally {
      setSchedulingId(null);
    }
  };

  const handleScheduleDisable = async (item: UploadListItem) => {
    setSchedulingId(item.upload_id);
    try {
      await removeSchedule(item.upload_id);
      setItems((prev) => prev.map((i) => i.upload_id === item.upload_id ? { ...i, schedule_enabled: false } : i));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Schedule update failed.");
    } finally {
      setSchedulingId(null);
    }
  };

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
      <h2 style={{ margin: "0 0 20px", fontSize: "1.1rem", fontWeight: 700, color: "var(--c-text)", letterSpacing: "-0.01em" }}>
        Forecast History
      </h2>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: "0.8rem", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--c-muted)", fontSize: "0.85rem", padding: "40px 0", textAlign: "center" }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: "var(--c-muted)", fontSize: "0.85rem", padding: "60px 0", textAlign: "center" }}>
          No forecasts yet. Upload a CSV and run a forecast to get started.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--c-border)" }}>
                {["Dataset", "Granularity", "Rows", "Date Range", "Forecast Run", "MAE", "sMAPE", "Schedule", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--c-muted)", fontSize: "0.71rem", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.upload_id}
                  style={{ borderBottom: "1px solid var(--c-border)", transition: "background 0.12s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <td style={{ padding: "10px 12px", fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.filename}</td>
                  <td style={{ padding: "10px 12px", color: "var(--c-muted)" }}>{item.granularity}</td>
                  <td style={{ padding: "10px 12px", color: "var(--c-muted)", fontFamily: "monospace" }}>{item.rows.toLocaleString()}</td>
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

                  {/* Schedule cell */}
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {schedulingId === item.upload_id ? (
                      <span style={{ color: "var(--c-muted)", fontSize: "0.72rem" }}>…</span>
                    ) : item.schedule_enabled ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <button
                          onClick={() => openScheduleModal(item)}
                          title="Edit schedule"
                          style={{ padding: "3px 10px", borderRadius: 12, border: "1px solid var(--c-teal, #00c8b4)", background: "rgba(0,200,180,0.15)", color: "var(--c-teal, #00c8b4)", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}
                        >
                          ● {FREQ_LABEL[item.schedule_frequency as ScheduleFrequency] ?? item.schedule_frequency}
                        </button>
                        <button
                          onClick={() => handleScheduleDisable(item)}
                          title="Disable schedule"
                          style={{ background: "none", border: "none", color: "var(--c-muted)", cursor: "pointer", fontSize: "0.75rem", padding: "0 2px" }}
                        >✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openScheduleModal(item)}
                        title="Enable auto-forecast"
                        style={{ padding: "3px 10px", borderRadius: 12, border: "1px solid var(--c-border)", background: "transparent", color: "var(--c-muted)", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}
                      >
                        ○ Off
                      </button>
                    )}
                  </td>

                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => handleLoad(item)}
                      disabled={!item.last_forecast_at || loadingId === item.upload_id}
                      style={{ marginRight: 6, padding: "4px 12px", borderRadius: 6, border: "1px solid var(--c-amber)", background: "transparent", color: "var(--c-amber)", fontSize: "0.74rem", cursor: item.last_forecast_at ? "pointer" : "not-allowed", opacity: item.last_forecast_at ? 1 : 0.4, fontWeight: 600 }}
                    >
                      {loadingId === item.upload_id ? "Loading…" : "Load"}
                    </button>
                    <button
                      onClick={() => handleDelete(item.upload_id)}
                      style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)", background: "transparent", color: "#f87171", fontSize: "0.74rem", cursor: "pointer", fontWeight: 600 }}
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

      {/* Schedule modal */}
      {scheduleModal && (
        <div className="modal-overlay" onClick={() => setScheduleModal(null)}>
          <div className="modal-box" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-icon">🗓</span>
              <h2 className="modal-title">Auto-Forecast Schedule</h2>
            </div>
            <div className="modal-body" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <span style={{ display: "block", marginBottom: 8, fontWeight: 600, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-muted)" }}>Frequency</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["daily", "weekly", "monthly"] as ScheduleFrequency[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setSchedFreq(f)}
                      style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: schedFreq === f ? "1px solid #60A5FA" : "1px solid var(--c-border)", background: schedFreq === f ? "rgba(96,165,250,0.15)" : "transparent", color: schedFreq === f ? "#60A5FA" : "var(--c-muted)", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span style={{ display: "block", marginBottom: 8, fontWeight: 600, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-muted)" }}>Forecast Horizon</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {([7, 14, 30] as HorizonDays[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => setSchedHorizon(d)}
                      style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: schedHorizon === d ? "1px solid #60A5FA" : "1px solid var(--c-border)", background: schedHorizon === d ? "rgba(96,165,250,0.15)" : "transparent", color: schedHorizon === d ? "#60A5FA" : "var(--c-muted)", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              <label style={{ fontSize: "0.78rem" }}>
                <span style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-muted)" }}>
                  Alert Threshold (optional)
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={schedThreshold}
                  onChange={(e) => setSchedThreshold(e.target.value)}
                  placeholder="Leave blank for no threshold"
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </label>

              <div style={{ fontSize: "0.74rem", color: "var(--c-muted)", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "8px 12px" }}>
                📅 Runs <strong style={{ color: "var(--c-text)" }}>{schedFreq}</strong> at 06:00 UTC · forecasts <strong style={{ color: "var(--c-text)" }}>{schedHorizon} days</strong> ahead
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-modal-cancel" onClick={() => setScheduleModal(null)}>Cancel</button>
              <button
                className="btn btn-run"
                onClick={handleScheduleSave}
                disabled={schedulingId === scheduleModal.upload_id}
              >
                {schedulingId === scheduleModal.upload_id ? "Saving…" : "Enable Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

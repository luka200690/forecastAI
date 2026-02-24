import { useRef, useState } from "react";
import {
  getForecast,
  uploadCsv,
  type ForecastResponse,
  type HorizonDays,
  type UploadResponse,
} from "../api";

interface ForecastModalProps {
  currentUploadInfo: UploadResponse | null;
  onClose: () => void;
  onComplete: (uploadInfo: UploadResponse, forecast: ForecastResponse) => void;
  onError: (msg: string) => void;
}

export function ForecastModal({ currentUploadInfo, onClose, onComplete, onError }: ForecastModalProps) {
  const [uploadInfo, setUploadInfo] = useState<UploadResponse | null>(currentUploadInfo);
  const [horizonDays, setHorizonDays] = useState<HorizonDays>(14);
  const [riskEnabled, setRiskEnabled] = useState(false);
  const [threshold, setThreshold] = useState("100");
  const [loading, setLoading] = useState<"upload" | "forecast" | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      onError("Only CSV files are supported.");
      return;
    }
    setLoading("upload");
    try {
      const res = await uploadCsv(file);
      setUploadInfo(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setLoading(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleRun = async () => {
    if (!uploadInfo || loading) return;
    setLoading("forecast");
    try {
      const res = await getForecast(
        uploadInfo.upload_id,
        horizonDays,
        riskEnabled && threshold ? parseFloat(threshold) : undefined
      );
      onComplete(uploadInfo, res);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Forecast failed.");
      setLoading(null);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-box">

        {/* Header */}
        <div className="modal-header">
          <span className="modal-icon">▶</span>
          <h2 className="modal-title">Run Forecast</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Upload zone */}
        <div
          className={`drop-zone${dragOver ? " drag-over" : ""}${uploadInfo ? " uploaded" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploadInfo && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          {loading === "upload" ? (
            <div className="dz-state">
              <span className="dz-spinner">⏳</span>
              <span className="dz-label">Uploading…</span>
            </div>
          ) : uploadInfo ? (
            <div className="dz-state uploaded">
              <span className="dz-check">✓</span>
              <div className="dz-info">
                <span className="dz-label">{uploadInfo.rows.toLocaleString()} rows · {uploadInfo.inferred_granularity}</span>
                <span className="dz-meta">{uploadInfo.start_ts.slice(0, 10)} → {uploadInfo.end_ts.slice(0, 10)}</span>
              </div>
              <button
                className="dz-change"
                onClick={(e) => { e.stopPropagation(); setUploadInfo(null); fileInputRef.current?.click(); }}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="dz-state">
              <span className="dz-icon">📁</span>
              <span className="dz-label">Drop CSV here or <u>browse</u></span>
              <span className="dz-meta">Required columns: timestamp, value</span>
            </div>
          )}
        </div>

        {/* Config */}
        <div className="modal-config">

          <div className="config-row">
            <span className="config-label">Forecast Horizon</span>
            <div className="config-opts">
              {([7, 14, 30] as HorizonDays[]).map((d) => (
                <button
                  key={d}
                  className={`config-opt${horizonDays === d ? " active" : ""}`}
                  onClick={() => setHorizonDays(d)}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          <div className="config-row">
            <span className="config-label">Risk Assessment</span>
            <div className="config-opts">
              <label className="config-toggle">
                <input
                  type="checkbox"
                  checked={riskEnabled}
                  onChange={(e) => setRiskEnabled(e.target.checked)}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
                <span className="toggle-label">{riskEnabled ? "On" : "Off"}</span>
              </label>
              {riskEnabled && (
                <div className="config-threshold">
                  <span className="config-label" style={{ fontSize: "0.7rem" }}>Threshold</span>
                  <input
                    type="number"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    min="0"
                    step="any"
                    style={{ width: 90 }}
                    placeholder="e.g. 100"
                  />
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            className="btn-run"
            disabled={!uploadInfo || loading !== null}
            onClick={handleRun}
          >
            {loading === "forecast" ? "⏳ Running…" : "▶ Run Model"}
          </button>
        </div>

      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import { appendActuals, type ForecastResponse } from "../api";

interface ActualsModalProps {
  uploadId: string;
  onClose: () => void;
  onComplete: (forecast: ForecastResponse) => void;
  onError: (msg: string) => void;
}

export function ActualsModal({ uploadId, onClose, onComplete, onError }: ActualsModalProps) {
  const [file, setFile]         = useState<File | null>(null);
  const [loading, setLoading]   = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef            = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith(".csv")) {
      onError("Only CSV files are supported.");
      return;
    }
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleRun = async () => {
    if (!file || loading) return;
    setLoading(true);
    try {
      const res = await appendActuals(uploadId, file);
      onComplete(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to append actuals.");
      setLoading(false);
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
          <span className="modal-icon">⬆</span>
          <h2 className="modal-title">Upload Actuals</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Description */}
        <p className="modal-desc">
          Upload a CSV with new measured values. Timestamps must be newer than the
          last row in your existing dataset. The forecast will re-run automatically.
        </p>

        {/* Drop zone */}
        <div
          className={`drop-zone${dragOver ? " drag-over" : ""}${file ? " uploaded" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !file && fileInputRef.current?.click()}
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
          {file ? (
            <div className="dz-state uploaded">
              <span className="dz-check">✓</span>
              <div className="dz-info">
                <span className="dz-label">{file.name}</span>
                <span className="dz-meta">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
              <button
                className="dz-change"
                onClick={(e) => { e.stopPropagation(); setFile(null); fileInputRef.current?.click(); }}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="dz-state">
              <span className="dz-icon">📁</span>
              <span className="dz-label">Drop actuals CSV here or <u>browse</u></span>
              <span className="dz-meta">Required columns: timestamp, value</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            className="btn-run"
            disabled={!file || loading}
            onClick={handleRun}
          >
            {loading ? "⏳ Appending…" : "⬆ Append & Re-forecast"}
          </button>
        </div>

      </div>
    </div>
  );
}

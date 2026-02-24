import { useRef, useState } from "react";
import type { UploadResponse } from "../api";

interface UploadPanelProps {
  uploadInfo: UploadResponse | null;
  onUpload: (file: File) => Promise<void>;
  loading: boolean;
}

export function UploadPanel({ uploadInfo, onUpload, loading }: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && (dropped.name.endsWith(".csv") || dropped.type === "text/csv")) {
      setFile(dropped);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
  };

  return (
    <section className="card">
      <div className="card-header">
        <span className="card-icon">📁</span>
        <h2 className="card-title">Data Upload</h2>
      </div>

      {/* Drop zone */}
      <div
        className={`drop-zone${dragActive ? " drag-active" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          disabled={loading}
          style={{ display: "none" }}
        />
        <span className="drop-zone-icon">⬆</span>
        {file ? (
          <div className="drop-zone-file">📄 {file.name}</div>
        ) : (
          <>
            <div className="drop-zone-label">Drop CSV or click to browse</div>
            <div className="drop-zone-hint">timestamp · value · optional site_id</div>
          </>
        )}
      </div>

      <button
        className="btn-action"
        onClick={() => file && onUpload(file)}
        disabled={!file || loading}
      >
        {loading ? "⏳ Uploading…" : "⬆ Upload Dataset"}
      </button>

      {/* Upload metadata */}
      {uploadInfo && (
        <div className="stat-grid" style={{ marginTop: "12px" }}>
          <div className="stat-row">
            <span className="stat-label">Granularity</span>
            <span className="stat-value cyan">{uploadInfo.inferred_granularity}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Rows</span>
            <span className="stat-value green">{uploadInfo.rows.toLocaleString()}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Start</span>
            <span className="stat-value" style={{ fontSize: "0.72rem" }}>
              {new Date(uploadInfo.start_ts).toLocaleDateString()}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">End</span>
            <span className="stat-value" style={{ fontSize: "0.72rem" }}>
              {new Date(uploadInfo.end_ts).toLocaleDateString()}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">ID</span>
            <span className="stat-value" style={{ fontSize: "0.65rem", color: "var(--c-muted)" }}>
              {uploadInfo.upload_id.slice(0, 16)}…
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

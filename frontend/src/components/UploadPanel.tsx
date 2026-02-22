import { useState } from "react";
import type { UploadResponse } from "../api";

interface UploadPanelProps {
  uploadInfo: UploadResponse | null;
  onUpload: (file: File) => Promise<void>;
  loading: boolean;
}

export function UploadPanel({ uploadInfo, onUpload, loading }: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);

  return (
    <section className="card">
      <h2>CSV Upload</h2>
      <p className="muted">Upload a CSV with columns: timestamp, value, optional site_id.</p>
      <div className="row">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={loading}
        />
        <button onClick={() => file && onUpload(file)} disabled={!file || loading}>
          {loading ? "Uploading..." : "Upload CSV"}
        </button>
      </div>
      {uploadInfo && (
        <div className="meta">
          <div>Upload ID: {uploadInfo.upload_id}</div>
          <div>Granularity: {uploadInfo.inferred_granularity}</div>
          <div>Rows: {uploadInfo.rows}</div>
          <div>
            Range: {new Date(uploadInfo.start_ts).toLocaleString()} to {new Date(uploadInfo.end_ts).toLocaleString()}
          </div>
        </div>
      )}
    </section>
  );
}

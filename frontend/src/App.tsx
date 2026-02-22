import { useMemo, useState } from "react";
import "./App.css";
import { askChat, deleteUpload, getForecast, uploadCsv, type ForecastResponse, type HorizonDays, type UploadResponse } from "./api";
import { ChatPanel, type Message } from "./components/ChatPanel";
import { ForecastChart } from "./components/ForecastChart";
import { RiskPanel } from "./components/RiskPanel";
import { StatusToasts, type Toast } from "./components/StatusToasts";
import { UploadPanel } from "./components/UploadPanel";

function App() {
  const [uploadInfo, setUploadInfo] = useState<UploadResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [horizonDays, setHorizonDays] = useState<HorizonDays>(14);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (type: Toast["type"], text: string) =>
    setToasts((prev) => [{ id: crypto.randomUUID(), type, text }, ...prev].slice(0, 4));

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const granularity = useMemo(
    () => forecast?.granularity ?? uploadInfo?.inferred_granularity ?? null,
    [forecast?.granularity, uploadInfo?.inferred_granularity]
  );

  const onUpload = async (file: File) => {
    setLoading("upload");
    try {
      const res = await uploadCsv(file);
      setUploadInfo(res);
      setForecast(null);
      setMessages([]);
      addToast("success", "Upload complete.");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setLoading(null);
    }
  };

  const onGenerateForecast = async (threshold?: number) => {
    if (!uploadInfo) {
      addToast("error", "Upload a CSV before forecasting.");
      return;
    }
    setLoading("forecast");
    try {
      const res = await getForecast(uploadInfo.upload_id, horizonDays, threshold);
      setForecast(res);
      addToast("success", "Forecast generated.");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Forecast failed.");
    } finally {
      setLoading(null);
    }
  };

  const onAskChat = async (question: string) => {
    if (!uploadInfo) {
      addToast("error", "Upload a CSV first.");
      return;
    }
    setLoading("chat");
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    try {
      const res = await askChat(uploadInfo.upload_id, question);
      setMessages((prev) => [...prev, { role: "assistant", text: res.answer, sources: res.sources }]);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Chat failed.");
    } finally {
      setLoading(null);
    }
  };

  const onDelete = async () => {
    if (!uploadInfo) return;
    setLoading("delete");
    try {
      await deleteUpload(uploadInfo.upload_id);
      setUploadInfo(null);
      setForecast(null);
      setMessages([]);
      addToast("success", "Upload deleted.");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="layout">
      <header className="title-row">
        <div>
          <h1>TalkToYourForecast</h1>
          <p className="muted">Upload energy data, forecast uncertainty, estimate threshold risk, and ask questions.</p>
        </div>
        <div className="row">
          <select value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value) as HorizonDays)}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <button onClick={() => onGenerateForecast()} disabled={!uploadInfo || loading !== null}>
            Generate Forecast
          </button>
          <button onClick={onDelete} disabled={!uploadInfo || loading !== null} className="danger">
            Delete Upload
          </button>
        </div>
      </header>

      <UploadPanel uploadInfo={uploadInfo} onUpload={onUpload} loading={loading === "upload"} />
      <ForecastChart data={forecast?.forecast ?? []} granularity={granularity} />
      <RiskPanel
        granularity={granularity}
        risk={forecast?.risk ?? null}
        onCompute={(threshold) => onGenerateForecast(threshold)}
        loading={loading === "forecast"}
      />
      <ChatPanel messages={messages} onAsk={onAskChat} loading={loading === "chat"} />

      {forecast && (
        <section className="card">
          <h2>Model Metrics</h2>
          <div className="meta">
            <div>MAE: {forecast.metrics.mae.toFixed(4)}</div>
            <div>sMAPE: {(forecast.metrics.smape * 100).toFixed(2)}%</div>
            <div>Peak Error: {forecast.metrics.peak_error.toFixed(4)}</div>
            <div>Top Features: {forecast.feature_importance.slice(0, 5).map((f) => f.feature).join(", ")}</div>
          </div>
        </section>
      )}
      <StatusToasts toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

export default App;

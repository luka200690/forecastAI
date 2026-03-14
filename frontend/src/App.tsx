import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  askChat,
  deleteUpload,
  getContractConfig,
  runAnalysis,
  runEnrichment,
  type ContractConfig,
  type EnrichmentResponse,
  type ForecastResponse,
  type UploadResponse,
} from "./api";
import { SignedIn, SignedOut, RedirectToSignIn, UserButton } from "@clerk/clerk-react";
import { ActualsModal } from "./components/ActualsModal";
import { AlertsPanel } from "./components/AlertsPanel";
import { ChatPanel, type Message } from "./components/ChatPanel";
import { ContractConfigModal } from "./components/ContractConfigModal";
import { CostRiskPanel } from "./components/CostRiskPanel";
import { ForecastChart } from "./components/ForecastChart";
import { ForecastModal } from "./components/ForecastModal";
import { StatusToasts, type Toast } from "./components/StatusToasts";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { SitesPage } from "./pages/SitesPage";

// ── Report generation ────────────────────────────────────────────────────────
function mdToHtml(text: string): string {
  return text
    .replace(/### (.+)/g, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[^]*?<\/li>(\n|$))+/g, (m) => `<ul>${m}</ul>`)
    .replace(/^---$/gm, "<hr>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

// Returns a styled HTML fragment (no <html>/<body>) suitable for off-screen rendering + PDF capture.
function generateReportFragment(
  uploadInfo: UploadResponse,
  forecast: ForecastResponse,
  messages: Message[],
  chartImageDataUrl: string | null,
  company: Record<string, string>,
  enrichment?: EnrichmentResponse | null
): string {
  const generated = new Date().toLocaleString();
  const companyName = company.name ?? "";

  const rows = forecast.forecast
    .map(
      (p) =>
        `<tr><td>${new Date(p.ts).toLocaleString()}</td><td>${p.p10.toFixed(3)}</td><td>${p.p50.toFixed(3)}</td><td>${p.p90.toFixed(3)}</td></tr>`
    )
    .join("\n");

  // First assistant message = auto-analysis brief
  const autoAnalysis = messages.find((m) => m.role === "assistant");
  const analysisHtml = autoAnalysis ? mdToHtml(autoAnalysis.text) : "";

  // Subsequent messages = Q&A exchanges (skip the auto-analysis)
  const qaMessages = autoAnalysis ? messages.slice(messages.indexOf(autoAnalysis) + 1) : [];
  const qaHtml = qaMessages.length > 0
    ? qaMessages.map((m) =>
        m.role === "user"
          ? `<div class="qa-question">Q: ${m.text}</div>`
          : `<div class="qa-answer">${mdToHtml(m.text)}</div>`
      ).join("\n")
    : "";

  const costRiskSection = enrichment ? (() => {
    const s = enrichment.summary;
    const top5Risk = [...enrichment.hourly].sort((a, b) => b.exceedance_p - a.exceedance_p).slice(0, 5);
    const top3Recs = enrichment.recommendations.slice(0, 3);
    const riskRows = top5Risk.map((h) =>
      `<tr><td>${new Date(h.ts).toLocaleString()}</td><td>${h.p50_kw.toFixed(1)}</td><td>${enrichment.config.contracted_capacity_kw}</td><td>${(h.exceedance_p * 100).toFixed(1)}%</td><td>${h.expected_excess_kw.toFixed(1)}</td><td>€${h.expected_penalty_eur.toFixed(2)}</td></tr>`
    ).join("\n");
    const recItems = top3Recs.map((r) =>
      `<li><strong>[${r.action_type.toUpperCase()}]</strong> ${new Date(r.ts_from).toLocaleString()} → Save <strong>€${r.savings_eur.toFixed(2)}</strong> · Risk ↓${(r.risk_reduction * 100).toFixed(0)}%. ${r.rationale}</li>`
    ).join("\n");
    return `
<h2>Cost &amp; Risk Summary</h2>
<div class="metric-grid">
  <div class="metric-card"><div class="metric-value">€${s.total_cost_p50_eur.toFixed(0)}</div><div class="metric-name">Total Cost P50 (€)</div></div>
  <div class="metric-card"><div class="metric-value">€${s.total_cost_p10_eur.toFixed(0)} – €${s.total_cost_p90_eur.toFixed(0)}</div><div class="metric-name">Cost P10–P90 Range</div></div>
  <div class="metric-card"><div class="metric-value">${s.hours_at_risk}</div><div class="metric-name">Hours at Risk</div></div>
</div>
<h2>Top Risk Hours</h2>
<table>
  <thead><tr><th>Timestamp</th><th>P50 (kW)</th><th>Capacity (kW)</th><th>Exceedance %</th><th>Expected Excess (kW)</th><th>Penalty (€)</th></tr></thead>
  <tbody>${riskRows}</tbody>
</table>
${top3Recs.length > 0 ? `<h2>Top Recommendations</h2><ul>${recItems}</ul>` : ""}
<h2>Methodology</h2>
<div class="analysis">
  <p>Exceedance probability uses a normal distribution approximation fitted to the P10/P50/P90 quantiles
  (σ = (P90−P10) / 2×1.28). Cost is computed as P_kW × €/MWh / 1000 per hour. Penalty is prorated
  over the billing period assuming 730 h/month. Recommendations are ranked by combined savings and
  risk reduction using a greedy shed-then-shift heuristic.</p>
</div>`;
  })() : "";

  const riskSection = forecast.risk ? `
<h2>Risk Assessment</h2>
<div class="metric-grid">
  <div class="metric-card"><div class="metric-value">${forecast.risk.risk_score.toFixed(0)}</div><div class="metric-name">Risk Score (0–100)</div></div>
  <div class="metric-card"><div class="metric-value">${(forecast.risk.exceedance_probability * 100).toFixed(1)}%</div><div class="metric-name">Exceedance Probability</div></div>
  <div class="metric-card"><div class="metric-value">${forecast.risk.expected_exceedance.toFixed(2)}</div><div class="metric-name">Expected Exceedance</div></div>
</div>` : "";

  const chartSection = chartImageDataUrl ? `
<h2>Forecast Chart</h2>
<img src="${chartImageDataUrl}" style="width:100%;border-radius:8px;border:1px solid #e0d5b0;margin-top:8px;" alt="Forecast chart">` : "";

  return `
<style>
  .rpt { font-family: 'Segoe UI', system-ui, sans-serif; background: #f9f7f2; color: #1c1a14; padding: 40px 48px; width: 900px; box-sizing: border-box; }
  .rpt-header { border-bottom: 3px solid #FFB300; padding-bottom: 20px; margin-bottom: 32px; display: flex; justify-content: space-between; align-items: flex-start; }
  .rpt-header-left h1 { margin: 0 0 6px; font-size: 1.4rem; }
  .rpt-header-left p  { margin: 3px 0; font-size: 0.82rem; color: #666; }
  .rpt-header-right { text-align: right; font-size: 0.76rem; color: #888; line-height: 1.5; }
  .rpt h2 { font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; color: #C47F00; border-bottom: 1px solid #e0d5b0; padding-bottom: 5px; margin: 28px 0 14px; }
  .rpt h3 { font-size: 0.86rem; color: #C47F00; margin: 14px 0 5px; }
  .metric-grid { display: flex; gap: 12px; }
  .metric-card { flex: 1; background: #fff; border: 1px solid #e0d5b0; border-radius: 8px; padding: 12px 16px; }
  .metric-value { font-size: 1.3rem; font-weight: 700; color: #C47F00; font-family: monospace; }
  .metric-name  { font-size: 0.72rem; color: #888; margin-top: 3px; }
  .analysis { background: #fff; border: 1px solid #e0d5b0; border-radius: 8px; padding: 18px 22px; font-size: 0.83rem; line-height: 1.75; }
  .analysis code { background: #fff8e6; border: 1px solid #e0d5b0; border-radius: 3px; padding: 1px 4px; font-family: monospace; color: #C47F00; }
  .analysis ul { padding-left: 18px; margin: 5px 0; }
  .analysis li { margin-bottom: 3px; }
  .analysis hr { border: none; border-top: 1px solid #e0d5b0; margin: 12px 0; }
  .analysis strong { color: #C47F00; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 0.79rem; margin-top: 8px; }
  th { background: #fff8e6; color: #C47F00; font-weight: 700; padding: 6px 10px; border: 1px solid #e0d5b0; text-align: left; }
  td { padding: 4px 10px; border: 1px solid #e8e2d0; font-family: monospace; }
  tr:nth-child(even) td { background: #fdfaf3; }
  .qa-log { display: flex; flex-direction: column; gap: 10px; }
  .qa-question { background: #fff8e6; border-left: 3px solid #FFB300; padding: 8px 14px; font-size: 0.83rem; font-weight: 600; border-radius: 0 6px 6px 0; }
  .qa-answer { background: #fff; border: 1px solid #e0d5b0; border-radius: 8px; padding: 12px 16px; font-size: 0.83rem; line-height: 1.7; }
  .qa-answer code { background: #fff8e6; border: 1px solid #e0d5b0; border-radius: 3px; padding: 1px 4px; font-family: monospace; color: #C47F00; }
  .qa-answer strong { color: #C47F00; }
  .rpt-footer { margin-top: 36px; font-size: 0.72rem; color: #aaa; text-align: center; border-top: 1px solid #e0d5b0; padding-top: 14px; }
</style>
<div class="rpt">
  <div class="rpt-header">
    <div class="rpt-header-left">
      <h1>⚡ ForecastAI — Forecast Report</h1>
      ${companyName ? `<p><strong>${companyName}</strong>${company.contact_email ? ` · ${company.contact_email}` : ""}</p>` : ""}
      <p><strong>Dataset:</strong> ${uploadInfo.rows.toLocaleString()} rows · ${uploadInfo.inferred_granularity} · ${uploadInfo.start_ts.slice(0, 10)} → ${uploadInfo.end_ts.slice(0, 10)}</p>
    </div>
    <div class="rpt-header-right">Generated<br>${generated}</div>
  </div>

  <h2>Accuracy Metrics</h2>
  <div class="metric-grid">
    <div class="metric-card"><div class="metric-value">${forecast.metrics.mae.toFixed(3)}</div><div class="metric-name">MAE</div></div>
    <div class="metric-card"><div class="metric-value">${(forecast.metrics.smape * 100).toFixed(1)}%</div><div class="metric-name">sMAPE</div></div>
    <div class="metric-card"><div class="metric-value">${forecast.metrics.peak_error.toFixed(3)}</div><div class="metric-name">Peak Error</div></div>
  </div>

  ${riskSection}
  ${costRiskSection}
  ${chartSection}
  ${analysisHtml ? `<h2>AI Analysis</h2><div class="analysis">${analysisHtml}</div>` : ""}
  ${qaHtml ? `<h2>Analysis Q&amp;A</h2><div class="qa-log">${qaHtml}</div>` : ""}

  <h2>Forecast Data · P10 / P50 / P90</h2>
  <table>
    <thead><tr><th>Timestamp</th><th>P10</th><th>P50</th><th>P90</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="rpt-footer">${companyName ? `${companyName} · ` : ""}Generated by ForecastAI · ${generated}</div>
</div>`;
}

// ── App ──────────────────────────────────────────────────────────────────────
function AppInner() {
  const [page, setPage]         = useState<"home" | "forecast" | "history" | "sites">("home");
  const [uploadInfo, setUploadInfo] = useState<UploadResponse | null>(null);
  const [forecast,   setForecast]   = useState<ForecastResponse | null>(null);
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [loading,    setLoading]    = useState<string | null>(null);
  const [toasts,     setToasts]     = useState<Toast[]>([]);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [darkMode,   setDarkMode]   = useState(true);
  const [language,   setLanguage]   = useState<"EN" | "IT">("EN");
  const [expanded,      setExpanded]      = useState<"chart" | "chat" | null>(null);
  const [actualsOpen,   setActualsOpen]   = useState(false);
  const [activeTab,     setActiveTab]     = useState<"forecast" | "cost_risk">("forecast");
  const [contractConfig, setContractConfig] = useState<ContractConfig | null>(null);
  const [enrichment,    setEnrichment]    = useState<EnrichmentResponse | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const chartRef = useRef<HTMLElement>(null);

  const toggleExpand = (panel: "chart" | "chat") =>
    setExpanded((prev) => (prev === panel ? null : panel));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const addToast = (type: Toast["type"], text: string) =>
    setToasts((prev) => [{ id: crypto.randomUUID(), type, text }, ...prev].slice(0, 4));

  const dismissToast = (id: string) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const granularity = useMemo(
    () => forecast?.granularity ?? uploadInfo?.inferred_granularity ?? null,
    [forecast?.granularity, uploadInfo?.inferred_granularity]
  );

  const onForecastComplete = async (newUploadInfo: UploadResponse, newForecast: ForecastResponse) => {
    setUploadInfo(newUploadInfo);
    setForecast(newForecast);
    setMessages([]);
    setEnrichment(null);
    setDateFrom(newUploadInfo.start_ts.slice(0, 10));
    const lastForecastTs = newForecast.forecast.at(-1)?.ts;
    setDateTo(lastForecastTs ? lastForecastTs.slice(0, 10) : "");
    setModalOpen(false);
    addToast("success", "Forecast ready.");
    // Best-effort: load saved contract config
    getContractConfig(newUploadInfo.upload_id).then((r) => setContractConfig(r.config)).catch(() => {});

    setLoading("chat");
    try {
      const analysis = await runAnalysis(newUploadInfo.upload_id);
      setMessages([{ role: "assistant", text: analysis.answer, sources: analysis.sources }]);
    } catch {
      // analysis is optional
    } finally {
      setLoading(null);
    }
  };

  const onActualsComplete = (newForecast: ForecastResponse) => {
    setForecast(newForecast);
    setEnrichment(null);
    setActualsOpen(false);
    addToast("success", "Forecast updated with new actuals.");
  };

  // Called from HistoryPage "Load" button
  const onHistoryLoad = (newUploadInfo: UploadResponse, newForecast: ForecastResponse) => {
    setUploadInfo(newUploadInfo);
    setForecast(newForecast);
    setMessages([]);
    setEnrichment(null);
    setDateFrom(newUploadInfo.start_ts.slice(0, 10));
    const lastForecastTs = newForecast.forecast.at(-1)?.ts;
    setDateTo(lastForecastTs ? lastForecastTs.slice(0, 10) : "");
    addToast("success", "Forecast loaded.");
    getContractConfig(newUploadInfo.upload_id).then((r) => setContractConfig(r.config)).catch(() => {});
  };

  const onAskChat = async (question: string) => {
    if (!uploadInfo) { addToast("error", "Run a forecast first."); return; }
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

  const onClear = async () => {
    if (!uploadInfo) return;
    try { await deleteUpload(uploadInfo.upload_id); } catch { /* ignore */ }
    setUploadInfo(null);
    setForecast(null);
    setMessages([]);
    setEnrichment(null);
    setContractConfig(null);
    setDateFrom("");
    setDateTo("");
    setActiveTab("forecast");
    addToast("success", "Session cleared.");
  };

  const onRunEnrichment = async () => {
    if (!uploadInfo || !contractConfig) return;
    setEnrichLoading(true);
    try {
      const result = await runEnrichment(uploadInfo.upload_id, contractConfig);
      setEnrichment(result);
      setContractConfig(result.config);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Enrichment failed.");
    } finally {
      setEnrichLoading(false);
    }
  };

  const onDownloadCsv = () => {
    if (!enrichment || !uploadInfo) return;
    const headers = [
      "ts","p10_kw","p50_kw","p90_kw","eur_mwh",
      "cost_p10_eur","cost_p50_eur","cost_p90_eur",
      "exceedance_p","expected_excess_kw","expected_penalty_eur",
    ].join(",");
    const rows = enrichment.hourly.map((h) =>
      [h.ts, h.p10_kw, h.p50_kw, h.p90_kw, h.eur_mwh,
       h.cost_p10_eur, h.cost_p50_eur, h.cost_p90_eur,
       h.exceedance_p, h.expected_excess_kw, h.expected_penalty_eur].join(",")
    ).join("\n");
    const blob = new Blob([headers + "\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cost-risk-${uploadInfo.upload_id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Cost & Risk memos ──────────────────────────────────────────────────────
  const riskHours = useMemo(() => {
    if (!enrichment || !contractConfig) return new Set<string>();
    const threshold = contractConfig.risk_threshold_pct / 100;
    return new Set(enrichment.hourly.filter((h) => h.exceedance_p >= threshold).map((h) => h.ts));
  }, [enrichment, contractConfig]);

  const enrichedMap = useMemo(() => {
    if (!enrichment) return undefined;
    const m = new Map<string, { eur_mwh: number; cost_p50_eur: number; exceedance_p: number }>();
    enrichment.hourly.forEach((h) =>
      m.set(h.ts.slice(0, 16), { eur_mwh: h.eur_mwh, cost_p50_eur: h.cost_p50_eur, exceedance_p: h.exceedance_p })
    );
    return m;
  }, [enrichment]);

  const onDownloadReport = async () => {
    if (!forecast || !uploadInfo) return;
    let chartImage: string | null = null;
    if (chartRef.current) {
      try {
        const html2canvas = (await import("html2canvas")).default;
        const canvas = await html2canvas(chartRef.current as HTMLElement, { useCORS: true, scale: 1.5, logging: false });
        chartImage = canvas.toDataURL("image/png");
      } catch { /* non-fatal — report still generates without chart */ }
    }
    const company: Record<string, string> = JSON.parse(localStorage.getItem("forecastai_company") ?? "{}");
    const fragment = generateReportFragment(uploadInfo, forecast, messages, chartImage, company, enrichment);

    // Render fragment off-screen, capture with html2canvas, export as real PDF
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-9999px;top:0;width:900px;background:#f9f7f2;";
    container.innerHTML = fragment;
    document.body.appendChild(container);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF }   = await import("jspdf");
      const canvas   = await html2canvas(container, { scale: 2, backgroundColor: "#f9f7f2", useCORS: true, logging: false });
      const imgData  = canvas.toDataURL("image/png");
      const pdf      = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW    = pdf.internal.pageSize.getWidth();
      const pageH    = pdf.internal.pageSize.getHeight();
      const imgH     = (canvas.height * pageW) / canvas.width;
      let remaining  = imgH;
      let offset     = 0;
      pdf.addImage(imgData, "PNG", 0, offset, pageW, imgH);
      remaining -= pageH;
      while (remaining > 0) {
        offset -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, offset, pageW, imgH);
        remaining -= pageH;
      }
      pdf.save(`forecast-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      document.body.removeChild(container);
    }
  };

  return (
    <div className="app">

      {/* ── PRIMARY TOPBAR ── */}
      <header className="topbar-primary">
        <div className="tb-left">
          <span className="topbar-logo">⚡ ForecastAI</span>
          <div className="topbar-sep" />
          <span className="page-title">{page === "home" ? "Home" : page === "history" ? "History" : page === "sites" ? "Manufacturing Plants" : "Forecasting"}</span>
        </div>
        <div className="tb-right">
          <button className="btn-icon" onClick={() => setDarkMode((d) => !d)} title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
            {darkMode ? "☀" : "🌙"}
          </button>
          <button
            className="btn-icon btn-lang"
            onClick={() => setLanguage((l) => (l === "EN" ? "IT" : "EN"))}
            title="Change language"
          >
            {language}
          </button>
          <button
            className="btn-icon"
            title="User manual"
            onClick={() => addToast("success", "Documentation coming soon.")}
          >
            ?
          </button>
          <UserButton />
        </div>
      </header>

      {/* ── CONTENT (sidebar + right panel) ── */}
      <div className="content">

        {/* Sidebar spans full height below primary topbar */}
        <aside className="left-sidebar">
          <div
            className={`sidebar-icon${page === "home" ? " active" : ""}`}
            title="Home"
            onClick={() => setPage("home")}
            style={{ cursor: "pointer" }}
          >
            🏠
          </div>
          <div
            className={`sidebar-icon${page === "forecast" ? " active" : ""}`}
            title="Forecast"
            onClick={() => setPage("forecast")}
            style={{ cursor: "pointer" }}
          >
            📈
          </div>
          <div
            className={`sidebar-icon${page === "history" ? " active" : ""}`}
            title="History"
            onClick={() => setPage("history")}
            style={{ cursor: "pointer" }}
          >
            📋
          </div>
          <div
            className={`sidebar-icon${page === "sites" ? " active" : ""}`}
            title="Manufacturing Plants"
            onClick={() => setPage("sites")}
            style={{ cursor: "pointer" }}
          >
            🏭
          </div>
          <div className="sidebar-icon future" title="Risk (coming soon)">⚠️</div>
          <div className="sidebar-icon future" title="Analysis (coming soon)">📊</div>
          <div className="sidebar-spacer" />
        </aside>

        {/* Right panel */}
        <div className="right-panel">

          {page === "home" ? (
            <div className="sites-page-wrapper">
              <HomePage
                onOpenForecastModal={() => setModalOpen(true)}
                onNavigateHistory={() => setPage("history")}
                onNavigatePlants={() => setPage("sites")}
              />
            </div>
          ) : page === "sites" ? (
            <div className="sites-page-wrapper">
              <SitesPage />
            </div>
          ) : page === "history" ? (
            <HistoryPage
              onLoad={onHistoryLoad}
              onNavigateForecast={() => setPage("forecast")}
            />
          ) : (
            <>
              {/* ── SECONDARY TOPBAR ── */}
              <div className="topbar-secondary">
                <div className="tb-left">
                  <span className="topbar-label">From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    title="Filter chart from date"
                  />
                  <span className="topbar-label">To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    title="Filter chart to date"
                  />
                  {uploadInfo && (
                    <>
                      <div className="topbar-sep" />
                      <span className="info-badge cyan" title="Granularity">{uploadInfo.inferred_granularity}</span>
                      <span className="info-badge green">
                        <span className="dot-pulse" />
                        {uploadInfo.rows.toLocaleString()} rows
                      </span>
                      <div className="topbar-sep" />
                      <div className="tab-group">
                        <button
                          className={`tab-btn${activeTab === "forecast" ? " active" : ""}`}
                          onClick={() => setActiveTab("forecast")}
                        >
                          📈 Forecast
                        </button>
                        <button
                          className={`tab-btn${activeTab === "cost_risk" ? " active" : ""}`}
                          onClick={() => setActiveTab("cost_risk")}
                        >
                          💶 Cost &amp; Risk
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div className="tb-right">
                  {uploadInfo && (
                    <button className="btn-clear-sm" onClick={onClear} title="Clear session">
                      ✕ Clear
                    </button>
                  )}
                  <button
                    className="btn-actuals"
                    disabled={!uploadInfo}
                    onClick={() => setActualsOpen(true)}
                    title={uploadInfo ? "Upload new measured data and re-forecast" : "Run a forecast first"}
                  >
                    ⬆ Actuals
                  </button>
                  <button
                    className="btn-download"
                    disabled={!forecast}
                    onClick={onDownloadReport}
                    title={forecast ? "Download HTML report" : "Run a forecast first"}
                  >
                    ⬇ Report
                  </button>
                  <button
                    className="btn-run"
                    onClick={() => setModalOpen(true)}
                    disabled={loading === "chat"}
                  >
                    ▶ Run Forecast
                  </button>
                </div>
              </div>

              {/* ── ALERTS PANEL ── */}
              <AlertsPanel forecast={forecast} />

              {/* ── MAIN AREA ── */}
              <main className={`main-area${activeTab === "cost_risk" ? " cr-active" : ""}`}>
                {activeTab === "cost_risk" ? (
                  <CostRiskPanel
                    uploadId={uploadInfo?.upload_id ?? ""}
                    forecast={forecast}
                    contractConfig={contractConfig}
                    enrichment={enrichment}
                    loading={enrichLoading}
                    onOpenConfig={() => setConfigModalOpen(true)}
                    onRunEnrichment={onRunEnrichment}
                    onDownloadCsv={onDownloadCsv}
                  />
                ) : (
                  <>
                    <div className={`chart-section${expanded === "chat" ? " panel-hidden" : expanded === "chart" ? " panel-expanded" : ""}`}>
                      <ForecastChart
                        data={forecast?.forecast ?? []}
                        history={forecast?.history ?? []}
                        granularity={granularity}
                        dateFrom={dateFrom}
                        dateTo={dateTo}
                        metrics={forecast?.metrics ?? null}
                        weather={forecast?.weather ?? []}
                        darkMode={darkMode}
                        isExpanded={expanded === "chart"}
                        onToggleExpand={() => toggleExpand("chart")}
                        chartContainerRef={chartRef}
                        contractCapacityKw={contractConfig?.contracted_capacity_kw ?? null}
                        riskHours={riskHours}
                        enrichedMap={enrichedMap}
                      />
                    </div>
                    <div className={`chat-section${expanded === "chart" ? " panel-hidden" : expanded === "chat" ? " panel-expanded" : ""}`}>
                      <ChatPanel
                        messages={messages}
                        onAsk={onAskChat}
                        loading={loading === "chat"}
                        isExpanded={expanded === "chat"}
                        onToggleExpand={() => toggleExpand("chat")}
                      />
                    </div>
                  </>
                )}
              </main>
            </>
          )}

        </div>
      </div>

      {modalOpen && (
        <ForecastModal
          currentUploadInfo={uploadInfo}
          onClose={() => setModalOpen(false)}
          onComplete={onForecastComplete}
          onError={(msg) => addToast("error", msg)}
        />
      )}

      {actualsOpen && uploadInfo && (
        <ActualsModal
          uploadId={uploadInfo.upload_id}
          onClose={() => setActualsOpen(false)}
          onComplete={onActualsComplete}
          onError={(msg) => addToast("error", msg)}
        />
      )}

      {configModalOpen && uploadInfo && (
        <ContractConfigModal
          uploadId={uploadInfo.upload_id}
          initialConfig={contractConfig}
          onClose={() => setConfigModalOpen(false)}
          onSave={(cfg) => { setContractConfig(cfg); setConfigModalOpen(false); }}
          onError={(msg) => addToast("error", msg)}
        />
      )}

      <StatusToasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function App() {
  return (
    <>
      <SignedOut><RedirectToSignIn /></SignedOut>
      <SignedIn><AppInner /></SignedIn>
    </>
  );
}

export default App;

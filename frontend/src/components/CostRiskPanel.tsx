import type {
  ContractConfig,
  EnrichmentResponse,
  ForecastResponse,
  HourlyEnrichedPoint,
  Recommendation,
} from "../api";

interface CostRiskPanelProps {
  uploadId: string;
  forecast: ForecastResponse | null;
  contractConfig: ContractConfig | null;
  enrichment: EnrichmentResponse | null;
  loading: boolean;
  onOpenConfig: () => void;
  onRunEnrichment: () => void;
  onDownloadCsv: () => void;
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtTs(ts: string) {
  return new Date(ts).toLocaleString("en", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function TopExpensiveTable({ rows }: { rows: HourlyEnrichedPoint[] }) {
  const sorted = [...rows].sort((a, b) => b.cost_p50_eur - a.cost_p50_eur).slice(0, 10);
  return (
    <div className="cr-section">
      <div className="cr-section-header">Top 10 Most Expensive Hours</div>
      <table className="cr-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>€/MWh</th>
            <th>P10 Cost €</th>
            <th>P50 Cost €</th>
            <th>P90 Cost €</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr key={h.ts}>
              <td style={{ color: "var(--c-muted)", whiteSpace: "nowrap" }}>{fmtTs(h.ts)}</td>
              <td style={{ color: "var(--c-orange)" }}>{fmt(h.eur_mwh, 1)}</td>
              <td>{fmt(h.cost_p10_eur, 3)}</td>
              <td style={{ color: "var(--c-amber)", fontWeight: 600 }}>{fmt(h.cost_p50_eur, 3)}</td>
              <td>{fmt(h.cost_p90_eur, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopRiskTable({
  rows,
  cap,
}: {
  rows: HourlyEnrichedPoint[];
  cap: number;
}) {
  const sorted = [...rows].sort((a, b) => b.exceedance_p - a.exceedance_p).slice(0, 10);
  return (
    <div className="cr-section">
      <div className="cr-section-header">Top 10 Capacity-Risk Hours</div>
      <table className="cr-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>P50 kW</th>
            <th>Capacity kW</th>
            <th>Exceedance %</th>
            <th>Expected Excess kW</th>
            <th>Expected Penalty €</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr key={h.ts}>
              <td style={{ color: "var(--c-muted)", whiteSpace: "nowrap" }}>{fmtTs(h.ts)}</td>
              <td style={{ color: h.p50_kw > cap ? "var(--c-red)" : "var(--c-text)" }}>
                {fmt(h.p50_kw, 0)}
              </td>
              <td style={{ color: "var(--c-muted)" }}>{fmt(cap, 0)}</td>
              <td style={{ color: h.exceedance_p > 0.7 ? "var(--c-red)" : h.exceedance_p > 0.4 ? "var(--c-orange)" : "var(--c-text)", fontWeight: 600 }}>
                {(h.exceedance_p * 100).toFixed(1)}%
              </td>
              <td>{fmt(h.expected_excess_kw, 1)}</td>
              <td style={{ color: h.expected_penalty_eur > 0 ? "var(--c-red)" : "var(--c-muted)" }}>
                {h.expected_penalty_eur > 0 ? `€ ${fmt(h.expected_penalty_eur, 2)}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationsList({ recs }: { recs: Recommendation[] }) {
  if (recs.length === 0) {
    return (
      <div className="cr-section">
        <div className="cr-section-header">Recommendations</div>
        <div className="cr-empty" style={{ padding: "20px 16px" }}>
          No actionable recommendations — capacity risk is below threshold.
        </div>
      </div>
    );
  }

  return (
    <div className="cr-section">
      <div className="cr-section-header">Recommendations ({recs.length})</div>
      <div className="rec-list">
        {recs.map((r) => (
          <div key={r.id} className="rec-item">
            <span className={`rec-badge ${r.action_type}`}>{r.action_type}</span>
            <span className="rec-window">
              {fmtTs(r.ts_from)}
              {r.ts_to !== r.ts_from && ` → ${fmtTs(r.ts_to)}`}
            </span>
            <span className="rec-detail">
              {fmt(r.delta_kw, 1)} kW &nbsp;|&nbsp; €&thinsp;{fmt(r.savings_eur, 2)} saved &nbsp;|&nbsp;
              {(r.risk_reduction * 100).toFixed(1)}% risk ↓
            </span>
            <span className="rec-rationale">{r.rationale}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CostRiskPanel({
  forecast,
  contractConfig,
  enrichment,
  loading,
  onOpenConfig,
  onRunEnrichment,
  onDownloadCsv,
}: CostRiskPanelProps) {
  const isHourly = forecast?.granularity === "hourly";

  return (
    <div className="cost-risk-panel">
      {/* Toolbar */}
      <div className="cr-toolbar">
        <button className="btn-icon" title="Configure contract & cost settings" onClick={onOpenConfig}>
          ⚙
        </button>
        <button
          className="btn-run"
          disabled={loading || !isHourly || !contractConfig}
          onClick={onRunEnrichment}
          title={!isHourly ? "Requires hourly data" : !contractConfig ? "Configure settings first" : "Run cost & risk analysis"}
        >
          {loading ? "⏳ Analysing…" : "▶ Run Analysis"}
        </button>
        <button
          className="btn-download"
          disabled={!enrichment}
          onClick={onDownloadCsv}
          title={enrichment ? "Download hourly enriched data as CSV" : "Run analysis first"}
        >
          ⬇ CSV
        </button>
        {contractConfig && (
          <span style={{ fontSize: "0.72rem", color: "var(--c-muted)", marginLeft: 6 }}>
            Capacity: <strong style={{ color: "var(--c-text)" }}>{contractConfig.contracted_capacity_kw.toLocaleString()} kW</strong>
            {" · "}
            Price: <strong style={{ color: "var(--c-text)" }}>
              {contractConfig.energy_price_source === "manual_flat"
                ? `${contractConfig.flat_price_eur_mwh ?? "—"} €/MWh flat`
                : "TOU"}
            </strong>
            {" · "}
            Risk threshold: <strong style={{ color: "var(--c-text)" }}>{contractConfig.risk_threshold_pct}%</strong>
          </span>
        )}
      </div>

      {/* Daily granularity warning */}
      {!isHourly && (
        <div style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "rgba(255,179,0,0.08)",
          border: "1px solid rgba(255,179,0,0.3)",
          color: "#FFB300",
          fontSize: "0.8rem",
        }}>
          Cost & Risk analysis requires hourly granularity data. Please upload an hourly dataset.
        </div>
      )}

      {/* Empty state */}
      {isHourly && !enrichment && !loading && (
        <div className="cr-empty">
          {contractConfig
            ? 'Click "Run Analysis" to compute cost and risk breakdown.'
            : 'Click ⚙ Configure to set contract capacity and energy price, then run analysis.'}
        </div>
      )}

      {/* Results */}
      {enrichment && (
        <>
          {/* KPI cards */}
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-value">€ {fmt(enrichment.summary.total_cost_p10_eur, 0)}</div>
              <div className="kpi-label">Total Cost P10</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">€ {fmt(enrichment.summary.total_cost_p50_eur, 0)}</div>
              <div className="kpi-label">Total Cost P50</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">€ {fmt(enrichment.summary.total_cost_p90_eur, 0)}</div>
              <div className="kpi-label">Total Cost P90</div>
            </div>
            <div className={`kpi-card ${enrichment.summary.hours_at_risk === 0 ? "at-risk-low" : enrichment.summary.hours_at_risk <= 10 ? "at-risk-mid" : "at-risk-high"}`}>
              <div className="kpi-value">{enrichment.summary.hours_at_risk}</div>
              <div className="kpi-label">Hours at Risk</div>
            </div>
          </div>

          {/* Percentile legend */}
          <div className="percentile-legend">
            <span className="pct-item"><strong>P10</strong> — Optimistic scenario: actual cost will exceed this only 10% of the time.</span>
            <span className="pct-sep">·</span>
            <span className="pct-item"><strong>P50</strong> — Median / most likely outcome.</span>
            <span className="pct-sep">·</span>
            <span className="pct-item"><strong>P90</strong> — Pessimistic scenario: actual cost will exceed this only 10% of the time.</span>
          </div>

          <TopExpensiveTable rows={enrichment.hourly} />
          <TopRiskTable rows={enrichment.hourly} cap={enrichment.config.contracted_capacity_kw} />
          <RecommendationsList recs={enrichment.recommendations} />
        </>
      )}
    </div>
  );
}

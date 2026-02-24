import { useState } from "react";
import type { Granularity, RiskMetrics } from "../api";

interface RiskPanelProps {
  granularity: Granularity | null;
  risk: RiskMetrics | null;
  onCompute: (threshold: number) => Promise<void>;
  loading: boolean;
}

function getRiskColor(score: number): string {
  if (score <= 30) return "var(--c-green)";
  if (score <= 60) return "var(--c-orange)";
  return "var(--c-red)";
}

function getRiskLabel(score: number): string {
  if (score <= 30) return "LOW";
  if (score <= 60) return "MODERATE";
  return "HIGH";
}

export function RiskPanel({ granularity, risk, onCompute, loading }: RiskPanelProps) {
  const [threshold, setThreshold] = useState<string>("");
  const unit = granularity === "hourly" ? "kWh/h" : "kWh/day";

  const score = risk?.risk_score ?? 0;
  const riskColor = getRiskColor(score);

  return (
    <section className="card">
      <div className="card-header">
        <span className="card-icon">⚠️</span>
        <h2 className="card-title">Risk Assessment</h2>
      </div>

      <div className="row" style={{ marginBottom: "10px" }}>
        <input
          type="number"
          placeholder={`Threshold (${unit})`}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      <button
        className="btn-risk"
        disabled={!threshold || loading}
        onClick={() => onCompute(Number(threshold))}
      >
        {loading ? "⏳ Computing…" : "⚡ Analyse Risk"}
      </button>

      {risk ? (
        <>
          {/* Score display */}
          <div className="risk-score-block" style={{ marginTop: "14px" }}>
            <div className="risk-score-value" style={{ color: riskColor }}>
              {risk.risk_score.toFixed(0)}
            </div>
            <div className="risk-score-label">
              Risk Score / 100 — <span style={{ color: riskColor }}>{getRiskLabel(score)}</span>
            </div>
          </div>

          {/* Bar */}
          <div className="risk-bar-track">
            <div
              className="risk-bar-fill"
              style={{
                width: `${Math.min(risk.risk_score, 100)}%`,
                background: riskColor,
                boxShadow: `0 0 8px ${riskColor}`,
              }}
            />
          </div>

          {/* Metrics */}
          <div className="stat-grid">
            <div className="stat-row">
              <span className="stat-label">Threshold</span>
              <span className="stat-value cyan">{risk.threshold.toFixed(2)} {unit}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Exceedance Prob.</span>
              <span className="stat-value" style={{ color: riskColor }}>
                {(risk.exceedance_probability * 100).toFixed(1)}%
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Exp. Exceedance</span>
              <span className="stat-value orange">{risk.expected_exceedance.toFixed(3)}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Method</span>
              <span className="stat-value" style={{ color: "var(--c-muted)", fontSize: "0.72rem" }}>{risk.method}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="muted" style={{ marginTop: "12px" }}>
          Enter a threshold to compute exceedance probability and risk score.
        </p>
      )}
    </section>
  );
}

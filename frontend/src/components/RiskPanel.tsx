import { useState } from "react";
import type { Granularity, RiskMetrics } from "../api";

interface RiskPanelProps {
  granularity: Granularity | null;
  risk: RiskMetrics | null;
  onCompute: (threshold: number) => Promise<void>;
  loading: boolean;
}

export function RiskPanel({ granularity, risk, onCompute, loading }: RiskPanelProps) {
  const [threshold, setThreshold] = useState<string>("");
  const unit = granularity === "hourly" ? "kWh/hour" : "kWh/day";

  return (
    <section className="card">
      <h2>Risk Panel</h2>
      <div className="row">
        <input
          type="number"
          placeholder={`Threshold (${unit})`}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
        <button
          disabled={!threshold || loading}
          onClick={() => onCompute(Number(threshold))}
        >
          {loading ? "Computing..." : "Compute Risk"}
        </button>
      </div>
      {risk && (
        <div className="meta">
          <div>Threshold: {risk.threshold.toFixed(2)} {unit}</div>
          <div>Exceedance Probability: {(risk.exceedance_probability * 100).toFixed(1)}%</div>
          <div>Expected Exceedance: {risk.expected_exceedance.toFixed(3)}</div>
          <div>Risk Score: {risk.risk_score.toFixed(1)} / 100</div>
          <div>Method: {risk.method}</div>
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import type { ForecastResponse } from "../api";

// ── Types ─────────────────────────────────────────────────────────────────────
type RuleId = "peak" | "smape" | "risk";

interface AlertRule {
  id: RuleId;
  label: string;
  unit: string;
  enabled: boolean;
  threshold: number;
}

interface ActiveAlert {
  level: "error" | "warning";
  label: string;
  message: string;
}

const DEFAULT_RULES: AlertRule[] = [
  { id: "peak",  label: "Peak demand",      unit: "kW", enabled: true,  threshold: 500 },
  { id: "smape", label: "Accuracy (sMAPE)", unit: "%",  enabled: true,  threshold: 15  },
  { id: "risk",  label: "Risk score",       unit: "",   enabled: false, threshold: 75  },
];

const LS_KEY = "forecastai_alerts";

function loadRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_RULES;
    const saved = JSON.parse(raw) as Partial<AlertRule>[];
    // Merge saved values into defaults to handle new rules added later
    return DEFAULT_RULES.map((def) => {
      const match = saved.find((s) => s.id === def.id);
      return match ? { ...def, ...match } : def;
    });
  } catch {
    return DEFAULT_RULES;
  }
}

function saveRules(rules: AlertRule[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(rules));
}

function evaluateAlerts(rules: AlertRule[], forecast: ForecastResponse): ActiveAlert[] {
  const alerts: ActiveAlert[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.id === "peak") {
      const maxP90 = Math.max(...forecast.forecast.map((p) => p.p90));
      if (maxP90 > rule.threshold) {
        alerts.push({
          level: "error",
          label: "Peak demand exceeded",
          message: `Max P90: ${maxP90.toFixed(1)} kW — threshold: ${rule.threshold} kW`,
        });
      }
    }

    if (rule.id === "smape") {
      const smapePct = forecast.metrics.smape * 100;
      if (smapePct > rule.threshold) {
        alerts.push({
          level: "warning",
          label: "Low accuracy",
          message: `sMAPE: ${smapePct.toFixed(1)}% — threshold: ${rule.threshold}%`,
        });
      }
    }

    if (rule.id === "risk" && forecast.risk) {
      if (forecast.risk.risk_score > rule.threshold) {
        alerts.push({
          level: "error",
          label: "High risk score",
          message: `Risk: ${forecast.risk.risk_score.toFixed(0)} — threshold: ${rule.threshold}`,
        });
      }
    }
  }

  return alerts;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface AlertsPanelProps {
  forecast: ForecastResponse | null;
}

export function AlertsPanel({ forecast }: AlertsPanelProps) {
  const [rules, setRules]           = useState<AlertRule[]>(loadRules);
  const [configOpen, setConfigOpen] = useState(false);
  const [draft, setDraft]           = useState<AlertRule[]>([]);

  // Reload from localStorage on mount (in case another tab changed them)
  useEffect(() => { setRules(loadRules()); }, []);

  const openConfig = () => {
    setDraft(rules.map((r) => ({ ...r })));
    setConfigOpen(true);
  };

  const saveConfig = () => {
    saveRules(draft);
    setRules(draft);
    setConfigOpen(false);
  };

  const updateDraft = (id: RuleId, field: "enabled" | "threshold", value: boolean | number) =>
    setDraft((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const alerts = forecast ? evaluateAlerts(rules, forecast) : [];

  // ── Config mode ────────────────────────────────────────────────────────────
  if (configOpen) {
    return (
      <div className="alerts-panel alerts-config">
        <span className="alerts-label">Alert Thresholds</span>
        {draft.map((rule) => (
          <div key={rule.id} className="alert-config-row">
            <label className="alert-toggle-label">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => updateDraft(rule.id, "enabled", e.target.checked)}
              />
              {rule.label}
            </label>
            <input
              className="alert-threshold-input"
              type="number"
              min={0}
              step={rule.id === "smape" ? 0.5 : 1}
              value={rule.threshold}
              disabled={!rule.enabled}
              onChange={(e) => updateDraft(rule.id, "threshold", parseFloat(e.target.value) || 0)}
            />
            {rule.unit && <span className="alert-unit">{rule.unit}</span>}
          </div>
        ))}
        <button className="btn-alert-done" onClick={saveConfig}>✓ Done</button>
      </div>
    );
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  return (
    <div className="alerts-panel">
      {!forecast ? (
        <span className="alert-placeholder">Run a forecast to enable alerts.</span>
      ) : alerts.length === 0 ? (
        <span className="alert-ok">✓ No active alerts</span>
      ) : (
        alerts.map((a, i) => (
          <div key={i} className={`alert-row ${a.level}`}>
            <span className="alert-icon">{a.level === "error" ? "🔴" : "🟡"}</span>
            <span className="alert-text"><strong>{a.label}</strong> — {a.message}</span>
          </div>
        ))
      )}
      <button className="alerts-gear btn-icon" title="Configure alert thresholds" onClick={openConfig}>
        ⚙
      </button>
    </div>
  );
}

import React, { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastPoint, Granularity, HistoryPoint, Metrics, WeatherPoint } from "../api";

interface ForecastChartProps {
  data: ForecastPoint[];
  history?: HistoryPoint[];
  granularity: Granularity | null;
  dateFrom?: string;
  dateTo?: string;
  metrics?: Metrics | null;
  weather?: WeatherPoint[];
  darkMode?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  chartContainerRef?: React.RefObject<HTMLElement | null>;
  // Cost & Risk overlays (optional — backward-compatible)
  contractCapacityKw?: number | null;
  riskHours?: Set<string>;
  enrichedMap?: Map<string, { eur_mwh: number; cost_p50_eur: number; exceedance_p: number }>;
}

// ── Palette ──────────────────────────────────────────────────────────────────
const C_AMBER  = "#60A5FA";   // P50 — sky blue (primary, thickest)
const C_BLUE   = "#4ADE80";   // P10-P90 band — green (secondary)
const C_ORANGE = "#FB923C";   // Temperature — orange dashed
const C_TEAL   = "#A78BFA";   // Metric chips — violet
const C_ACTUAL = "#FBBF24";   // Actual measured values — amber yellow

// ── Metric chip with hover explanation ───────────────────────────────────────
function MetricChip({ label, value, color, explain }: {
  label: string;
  value: string;
  color: string;
  explain: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const handleMouseEnter = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 220) });
    }
  };

  return (
    <span
      ref={ref}
      className="metric-chip"
      style={{ color, cursor: "default" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setPos(null)}
    >
      {label} {value}
      {pos && (
        <span style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: 220,
          background: "rgba(11,13,16,0.97)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 7,
          padding: "8px 11px",
          fontSize: "0.71rem",
          fontFamily: "'Space Grotesk', sans-serif",
          color: "rgba(232,236,240,0.85)",
          lineHeight: 1.55,
          boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
          pointerEvents: "none",
          zIndex: 9999,
          whiteSpace: "normal",
          textAlign: "left",
        }}>
          <span style={{ color, fontWeight: 700, display: "block", marginBottom: 3 }}>{label}</span>
          {explain}
        </span>
      )}
    </span>
  );
}

// ── Legend item with hover explanation box ───────────────────────────────────
function LegendItem({ children, explain, color }: {
  children: React.ReactNode;
  explain: string;
  color?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const handleMouseEnter = () => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.left + r.width / 2 - 110) });
    }
  };

  return (
    <span
      ref={ref}
      style={{ display: "flex", alignItems: "center", gap: 4 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <span style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: 220,
          background: "rgba(11,13,16,0.97)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 7,
          padding: "8px 11px",
          fontSize: "0.71rem",
          fontFamily: "'Space Grotesk', sans-serif",
          color: "rgba(232,236,240,0.85)",
          lineHeight: 1.55,
          boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
          pointerEvents: "none",
          zIndex: 9999,
          whiteSpace: "normal",
          textAlign: "left",
        }}>
          {color && <span style={{ color, fontWeight: 700, display: "block", marginBottom: 3 }}>{
            typeof children === "string" ? children : ""
          }</span>}
          {explain}
        </span>
      )}
    </span>
  );
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; name: string }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;

  const actual  = payload.find((p) => p.dataKey === "actual");
  const p50     = payload.find((p) => p.dataKey === "p50");
  const p10e    = payload.find((p) => p.dataKey === "p10Base");
  const pRange  = payload.find((p) => p.dataKey === "pRange");
  const temp    = payload.find((p) => p.dataKey === "temperature_c");
  const eurMwh  = payload.find((p) => p.dataKey === "eur_mwh");
  const costP50 = payload.find((p) => p.dataKey === "cost_p50_eur");
  const excP    = payload.find((p) => p.dataKey === "exceedance_p");

  const p10Val = p10e?.value ?? null;
  const p90Val = p10Val !== null && pRange ? p10Val + pRange.value : null;

  return (
    <div style={{
      background: "rgba(11, 13, 16, 0.97)",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: "8px",
      padding: "10px 14px",
      fontSize: "0.77rem",
      fontFamily: "'JetBrains Mono', monospace",
      boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    }}>
      <div style={{ color: "rgba(232,236,240,0.45)", marginBottom: 8, fontSize: "0.68rem" }}>
        {new Date(label).toLocaleString()}
      </div>
      {actual && (
        <div style={{ color: C_ACTUAL, marginBottom: 3 }}>
          Actual &nbsp;{actual.value.toFixed(3)}
        </div>
      )}
      {p50 && (
        <div style={{ color: C_AMBER, marginBottom: 3 }}>
          P50 &nbsp;{p50.value.toFixed(3)}
        </div>
      )}
      {p10Val !== null && p90Val !== null && (
        <div style={{ color: C_BLUE, fontSize: "0.71rem", marginBottom: 3 }}>
          P10–P90 &nbsp;{p10Val.toFixed(2)} – {p90Val.toFixed(2)}
        </div>
      )}
      {temp && (
        <div style={{ color: C_ORANGE, fontSize: "0.71rem", marginBottom: 3 }}>
          Temp &nbsp;{temp.value.toFixed(1)} °C
        </div>
      )}
      {eurMwh != null && eurMwh.value > 0 && (
        <div style={{ color: "#a3e635", fontSize: "0.71rem", marginBottom: 3, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 4, marginTop: 4 }}>
          Price &nbsp;{eurMwh.value.toFixed(2)} €/MWh
        </div>
      )}
      {costP50 != null && costP50.value > 0 && (
        <div style={{ color: "#a3e635", fontSize: "0.71rem", marginBottom: 3 }}>
          Cost P50 &nbsp;€ {costP50.value.toFixed(3)}
        </div>
      )}
      {excP != null && excP.value > 0 && (
        <div style={{ color: excP.value >= 0.7 ? "#FF5555" : "#FB923C", fontSize: "0.71rem" }}>
          Exceedance &nbsp;{(excP.value * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

export function ForecastChart({ data, history = [], granularity, dateFrom, dateTo, metrics, weather = [], darkMode = true, isExpanded = false, onToggleExpand, chartContainerRef, contractCapacityKw, riskHours, enrichedMap }: ForecastChartProps) {
  // ── Filter helpers ──────────────────────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to   = dateTo   ? new Date(dateTo + "T23:59:59.999Z").getTime() : null;
    return history.filter((p) => {
      const t = new Date(p.ts).getTime();
      return (from === null || t >= from) && (to === null || t <= to);
    });
  }, [history, dateFrom, dateTo]);

  const filteredForecast = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to   = dateTo   ? new Date(dateTo + "T23:59:59.999Z").getTime() : null;
    return data.filter((p) => {
      const t = new Date(p.ts).getTime();
      return (from === null || t >= from) && (to === null || t <= to);
    });
  }, [data, dateFrom, dateTo]);

  // ── Weather lookup map ──────────────────────────────────────────────────────
  const weatherMap = useMemo(() => {
    const m = new Map<string, number>();
    weather.forEach((w) => {
      const key = granularity === "hourly" ? w.ts.slice(0, 16) : w.ts.slice(0, 10);
      m.set(key, w.temperature_c);
    });
    return m;
  }, [weather, granularity]);

  // ── Unified chart data (history + forecast merged by ts) ───────────────────
  const chartData = useMemo(() => {
    const histPoints = filteredHistory.map((h) => ({
      ts: h.ts,
      actual: h.value,
    }));

    const fcastPoints = filteredForecast.map((d) => {
      const key = granularity === "hourly" ? d.ts.slice(0, 16) : d.ts.slice(0, 10);
      const enriched = enrichedMap?.get(d.ts.slice(0, 16));
      return {
        ts: d.ts,
        p10: d.p10,
        p50: d.p50,
        p90: d.p90,
        p10Base: d.p10,
        pRange: d.p90 - d.p10,
        temperature_c: weatherMap.get(key),
        eur_mwh: enriched?.eur_mwh,
        cost_p50_eur: enriched?.cost_p50_eur,
        exceedance_p: enriched?.exceedance_p,
      };
    });

    return [...histPoints, ...fcastPoints].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
    );
  }, [filteredHistory, filteredForecast, weatherMap, granularity]);

  // ── Weekend shading ─────────────────────────────────────────────────────────
  const weekendRanges = useMemo(() => {
    const ranges: Array<{ start: string; end: string }> = [];
    let inWeekend = false;
    let startTs = "";
    let endTs = "";
    for (const pt of chartData) {
      const day = new Date(pt.ts).getDay();
      const isWeekend = day === 0 || day === 6;
      if (isWeekend && !inWeekend) { inWeekend = true; startTs = pt.ts; endTs = pt.ts; }
      else if (isWeekend && inWeekend) { endTs = pt.ts; }
      else if (!isWeekend && inWeekend) { ranges.push({ start: startTs, end: endTs }); inWeekend = false; }
    }
    if (inWeekend) ranges.push({ start: startTs, end: endTs });
    return ranges;
  }, [chartData]);

  // ── Risk-hour shading ───────────────────────────────────────────────────────
  const riskRanges = useMemo(() => {
    if (!riskHours?.size) return [];
    const ranges: Array<{ start: string; end: string }> = [];
    let inRisk = false;
    let startTs = "";
    let endTs = "";
    for (const pt of chartData) {
      const isRisk = riskHours.has(pt.ts);
      if (isRisk && !inRisk) { inRisk = true; startTs = pt.ts; endTs = pt.ts; }
      else if (isRisk && inRisk) { endTs = pt.ts; }
      else if (!isRisk && inRisk) { ranges.push({ start: startTs, end: endTs }); inRisk = false; }
    }
    if (inRisk) ranges.push({ start: startTs, end: endTs });
    return ranges;
  }, [chartData, riskHours]);

  const hasWeather  = weather.length > 0;
  const hasHistory  = filteredHistory.length > 0;
  const hasForecast = filteredForecast.length > 0;
  const isEmpty     = chartData.length === 0;

  const tickFormatter = (v: string) => {
    const dt = new Date(v);
    return granularity === "hourly"
      ? `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours()}:00`
      : `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`;
  };

  const axisStyle = {
    fill: darkMode ? "rgba(232,236,240,0.75)" : "rgba(30,30,30,0.75)",
    fontSize: 10,
    fontFamily: "'JetBrains Mono',monospace",
  };
  const axisLine = { stroke: darkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)" };

  return (
    <section className="card" ref={chartContainerRef as React.RefObject<HTMLDivElement>}>
      <div className="card-header">
        <span className="card-icon">📈</span>
        <h2 className="card-title">Forecast</h2>

        {/* Legend */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginLeft: 10 }}>
          {hasHistory && (
            <LegendItem color={C_ACTUAL} explain="Measured energy values uploaded via the Actuals button. Used to evaluate forecast accuracy.">
              <span style={{ fontSize: "0.62rem", color: C_ACTUAL, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 16, height: 2.5, background: C_ACTUAL, borderRadius: 1 }} />
                Actual
              </span>
            </LegendItem>
          )}
          {hasForecast && (
            <>
              <LegendItem color={C_BLUE} explain="The uncertainty interval. There is an 80% probability the true value falls within this band. P10 = optimistic lower bound; P90 = pessimistic upper bound.">
                <span style={{ fontSize: "0.62rem", color: C_BLUE, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(74,222,128,0.2)", border: `1px solid ${C_BLUE}`, borderRadius: 2 }} />
                  P10–P90
                </span>
              </LegendItem>
              <LegendItem color={C_AMBER} explain="The median forecast. Half of all simulated scenarios fall below this line, half above. Use this as your best single-number estimate.">
                <span style={{ fontSize: "0.62rem", color: C_AMBER, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ display: "inline-block", width: 16, height: 2.5, background: C_AMBER, borderRadius: 1 }} />
                  P50
                </span>
              </LegendItem>
            </>
          )}
          {hasWeather && (
            <LegendItem color={C_ORANGE} explain="Ambient temperature forecast from Open-Meteo, plotted on the right axis. Temperature is one of the main drivers used by the model.">
              <span style={{ fontSize: "0.62rem", color: C_ORANGE, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 16, height: 0, borderTop: `2px dashed ${C_ORANGE}` }} />
                Temp °C
              </span>
            </LegendItem>
          )}
          <LegendItem explain="Shaded areas mark Saturday and Sunday, when consumption patterns typically differ from weekdays.">
            <span style={{ fontSize: "0.62rem", color: darkMode ? "rgba(232,236,240,0.28)" : "rgba(30,30,30,0.35)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, background: darkMode ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", border: darkMode ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.1)", borderRadius: 2 }} />
              Weekend
            </span>
          </LegendItem>
        </div>

        {/* Metric chips */}
        {metrics && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <MetricChip
              label="MAE"
              value={metrics.mae.toFixed(3)}
              color={C_AMBER}
              explain="Mean Absolute Error — average absolute difference between the P50 forecast and actual values on the validation set. Lower is better."
            />
            <MetricChip
              label="sMAPE"
              value={`${(metrics.smape * 100).toFixed(1)}%`}
              color={C_TEAL}
              explain="Symmetric Mean Absolute Percentage Error — percentage error balanced between over- and under-forecasting. Ranges 0–200%; lower is better."
            />
            <MetricChip
              label="Peak"
              value={metrics.peak_error.toFixed(3)}
              color={C_ORANGE}
              explain="Peak Error — difference between the highest predicted P50 value and the actual peak in the validation period. Positive = over-forecast; negative = under-forecast."
            />
          </div>
        )}
        {!metrics && <div style={{ marginLeft: "auto" }} />}
        {onToggleExpand && (
          <button className="btn-panel-expand" onClick={onToggleExpand} title={isExpanded ? "Restore" : "Expand"}>
            {isExpanded ? "⤡" : "⤢"}
          </button>
        )}
      </div>

      {isEmpty ? (
        <div className="chart-placeholder">
          <span className="chart-placeholder-icon">〰</span>
          <span className="chart-placeholder-text">
            {data.length || history.length ? "No data in selected date range." : "Run a forecast to visualise P10 / P50 / P90 projections."}
          </span>
        </div>
      ) : (
        <div className="chart-inner">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: hasWeather ? 48 : 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="bandGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={C_BLUE} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={C_BLUE} stopOpacity={0.03} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 4" stroke={darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)"} vertical={false} />

              {weekendRanges.map((r, i) => (
                <ReferenceArea
                  key={i}
                  x1={r.start}
                  x2={r.end}
                  yAxisId="energy"
                  fill={darkMode ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"}
                  stroke={darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)"}
                  strokeWidth={1}
                />
              ))}

              {/* Risk-hour shading — red tint on at-risk forecast hours */}
              {riskRanges.map((r, i) => (
                <ReferenceArea
                  key={`risk-${i}`}
                  x1={r.start}
                  x2={r.end}
                  yAxisId="energy"
                  fill="rgba(255,85,85,0.10)"
                  stroke="rgba(255,85,85,0.25)"
                  strokeWidth={1}
                />
              ))}

              {/* Contract capacity line */}
              {contractCapacityKw != null && (
                <ReferenceLine
                  yAxisId="energy"
                  y={contractCapacityKw}
                  stroke="#FF5555"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{ value: "Capacity", fill: "#FF5555", fontSize: 10, position: "insideTopRight" }}
                />
              )}

              <XAxis
                dataKey="ts"
                tickFormatter={tickFormatter}
                minTickGap={40}
                tick={axisStyle}
                axisLine={axisLine}
                tickLine={axisLine}
              />

              <YAxis
                yAxisId="energy"
                tick={axisStyle}
                axisLine={axisLine}
                tickLine={axisLine}
                width={52}
              />

              {hasWeather && (
                <YAxis
                  yAxisId="temp"
                  orientation="right"
                  tick={{ ...axisStyle, fill: "rgba(251,146,60,0.6)" }}
                  axisLine={{ stroke: "rgba(251,146,60,0.15)" }}
                  tickLine={{ stroke: "rgba(251,146,60,0.15)" }}
                  tickFormatter={(v: number) => `${v}°`}
                  width={36}
                />
              )}

              <Tooltip content={<CustomTooltip />} />

              {/* Actual measured data */}
              {hasHistory && (
                <Line
                  yAxisId="energy"
                  type="monotone"
                  dataKey="actual"
                  stroke={C_ACTUAL}
                  strokeWidth={1.5}
                  dot={false}
                  animationDuration={500}
                  connectNulls={false}
                />
              )}

              {/* Confidence band */}
              <Area yAxisId="energy" type="monotone" dataKey="p10Base" stackId="band" strokeOpacity={0} fillOpacity={0} isAnimationActive={false} />
              <Area yAxisId="energy" type="monotone" dataKey="pRange"  stackId="band" stroke={C_BLUE} strokeWidth={1.5} fill="url(#bandGradient)" fillOpacity={1} animationDuration={700} />

              {/* P10 lower boundary (dashed) */}
              <Line yAxisId="energy" type="monotone" dataKey="p10" stroke={C_BLUE} strokeWidth={1.5} strokeDasharray="4 3" dot={false} animationDuration={700} />

              {/* P50 — primary, most prominent */}
              <Line
                yAxisId="energy"
                type="monotone"
                dataKey="p50"
                stroke={C_AMBER}
                strokeWidth={2.5}
                dot={false}
                animationDuration={700}
              />

              {/* Temperature overlay */}
              {hasWeather && (
                <Line
                  yAxisId="temp"
                  type="monotone"
                  dataKey="temperature_c"
                  stroke={C_ORANGE}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  animationDuration={700}
                  connectNulls
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

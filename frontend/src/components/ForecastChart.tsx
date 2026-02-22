import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastPoint, Granularity } from "../api";

interface ForecastChartProps {
  data: ForecastPoint[];
  granularity: Granularity | null;
}

export function ForecastChart({ data, granularity }: ForecastChartProps) {
  if (!data.length) {
    return (
      <section className="card">
        <h2>Forecast</h2>
        <p className="muted">Generate a forecast to view P50 and P10-P90 uncertainty band.</p>
      </section>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    p10Base: d.p10,
    pRange: d.p90 - d.p10,
  }));

  return (
    <section className="card">
      <h2>Forecast</h2>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="ts"
              tickFormatter={(v) => {
                const dt = new Date(v);
                return granularity === "hourly"
                  ? `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours()}:00`
                  : `${dt.getMonth() + 1}/${dt.getDate()}`;
              }}
              minTickGap={24}
            />
            <YAxis />
            <Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} />
            <Area type="monotone" dataKey="p10Base" stackId="band" strokeOpacity={0} fillOpacity={0} />
            <Area type="monotone" dataKey="pRange" stackId="band" strokeOpacity={0} fill="#ffd6a5" fillOpacity={0.5} />
            <Line type="monotone" dataKey="p50" stroke="#bc6c25" strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

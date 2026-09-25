import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const axisTick = { fill: 'var(--ink-3)', fontSize: 11 };
const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  color: 'var(--ink)',
  fontSize: 13,
  boxShadow: 'var(--shadow)',
};

export interface BarDatum {
  label: string;
  value: number;
  title: string;
  current?: boolean;
}

/** Days per week. */
export function WeekBars({ data, color = 'var(--accent)', max = 7, height = 150 }: { data: BarDatum[]; color?: string; max?: number; height?: number }) {
  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval={0} />
          <YAxis domain={[0, max]} ticks={[0, Math.round(max / 2), max]} tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'var(--surface-3)' }}
            contentStyle={tooltipStyle}
            labelFormatter={(_, payload) => (payload?.[0]?.payload as BarDatum | undefined)?.title ?? ''}
            formatter={(v) => [`${v} ${v === 1 ? 'day' : 'days'}`, 'Active']}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={color} fillOpacity={d.current ? 0.55 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface LinePoint {
  x: number;
  y: number;
  title: string;
  color?: string;
}

interface TrendProps {
  points: LinePoint[];
  /** Domain is 0..n-1 on x. */
  n: number;
  yMax: number;
  xLabels: [string, string];
  lineColor?: string;
  height?: number;
  unit?: string;
}

/** A line over a fixed x domain with individually coloured points. */
export function TrendLine({ points, n, yMax, xLabels, lineColor = 'var(--ink-3)', height = 120, unit = '' }: TrendProps) {
  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 10, bottom: 0, left: -24 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, Math.max(1, n - 1)]}
            ticks={[0, Math.max(1, n - 1)]}
            tickFormatter={(v) => (v === 0 ? xLabels[0] : xLabels[1])}
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
          />
          <YAxis domain={[0, yMax]} ticks={[0, yMax / 2, yMax]} tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(_, payload) => (payload?.[0]?.payload as LinePoint | undefined)?.title ?? ''}
            formatter={(v) => [`${v}${unit}`, '']}
            separator=""
          />
          <Line
            type="monotone"
            dataKey="y"
            stroke={lineColor}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(p: { cx?: number; cy?: number; index?: number; payload?: LinePoint }) => (
              <circle key={p.index} cx={p.cx} cy={p.cy} r={3.5} fill={p.payload?.color ?? lineColor} stroke="var(--surface)" strokeWidth={1.5} />
            )}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

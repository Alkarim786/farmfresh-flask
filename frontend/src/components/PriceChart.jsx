import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortDate } from "../lib/format";

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-line rounded-xl px-3 py-2 shadow-lg text-sm num">
      <p className="font-semibold">{shortDate(label)}</p>
      <p>Median ₹{Number(p.median).toFixed(2)}/kg</p>
      <p className="text-muted">
        Range ₹{Number(p.min).toFixed(2)} – ₹{Number(p.max).toFixed(2)}
      </p>
    </div>
  );
}

// Mandi median (line) with the min–max band, plus an optional reference line for a listing's price.
export default function PriceChart({ series, mine, height = 260 }) {
  const data = series.map((s) => ({ ...s, median: +s.median, min: +s.min, max: +s.max, band: [+s.min, +s.max] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="med" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2747a8" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#2747a8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#e2e6ec" />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 12, fill: "#8a94a3" }} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tick={{ fontSize: 12, fill: "#8a94a3" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `₹${v}`} domain={["auto", "auto"]} />
        <Tooltip content={<Tip />} />
        <Area type="monotone" dataKey="band" stroke="none" fill="#e8edfa" isAnimationActive={false} />
        <Area type="monotone" dataKey="median" stroke="#2747a8" strokeWidth={2.25} fill="url(#med)" isAnimationActive={false} />
        {mine && (
          <ReferenceLine y={+mine} stroke="#c58a0b" strokeDasharray="5 4" strokeWidth={2}
            label={{ value: `This listing ₹${(+mine).toFixed(2)}`, position: "insideTopRight", fill: "#8a6000", fontSize: 12 }} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

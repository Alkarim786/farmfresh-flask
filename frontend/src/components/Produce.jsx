import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { MarketChip, ProduceArt, Verified, cx } from "./ui";
import { qty, rupees } from "../lib/format";
import { useApi } from "../lib/useApi";

export function ListingCard({ l }) {
  return (
    <Link
      to={`/listing/${l.id}`}
      className="group bg-white rounded-2xl border border-line overflow-hidden flex flex-col hover:border-[#c6cdd8] focus-visible:border-tarp"
    >
      <div className="relative">
        <ProduceArt listing={l} className="aspect-[16/9] sm:aspect-[4/3] w-full" />
        {l.organic && (
          <span className="absolute top-3 left-3 rounded-md bg-white/95 text-leaf text-[0.78rem] font-semibold px-2 py-0.5">
            Organic
          </span>
        )}
        <span className="absolute top-3 right-3 rounded-md bg-white/95 text-ink text-[0.78rem] font-semibold px-2 py-0.5">
          Grade {l.grade}
        </span>
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[1.2rem] font-bold leading-tight group-hover:text-tarp">
            {l.crop}
            {l.variety && <span className="font-medium text-muted text-base"> {l.variety}</span>}
          </h3>
        </div>
        <p className="flex items-center gap-1 text-sm text-muted">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{l.location}</span>
        </p>
        <div className="mt-auto pt-2 flex items-end justify-between gap-2">
          <p className="num">
            <span className="font-display text-[1.6rem] font-bold">{rupees(l.price)}</span>
            <span className="text-muted text-sm">/{l.unit}</span>
          </p>
          <MarketChip price={l.price} market={l.market} />
        </div>
        <div className="flex items-center justify-between text-sm text-muted border-t border-line pt-2.5 mt-1">
          <span className="flex items-center gap-1 min-w-0">
            <span className="truncate">{l.farmer?.farm_name || l.farmer?.name}</span>
            {l.farmer?.verified && <Verified />}
          </span>
          <span className="num shrink-0">
            {qty(l.qty_available)} {l.unit} left
          </span>
        </div>
      </div>
    </Link>
  );
}

export function ListingGrid({ items }) {
  return (
    <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((l) => (
        <ListingCard key={l.id} l={l} />
      ))}
    </div>
  );
}

// The mandi rate board: farm-gate asking price vs. the median mandi price, per kg.
export function RateBoard({ compact }) {
  const { data, loading } = useApi("/prices/board");
  const rows = (data || []).slice(0, compact ? 6 : 8);
  const sample = rows.some((r) => r.source === "sample");
  return (
    <div className="rounded-[20px] bg-tarp-deep text-white p-5 sm:p-6 shadow-[0_30px_60px_-30px_rgba(25,48,111,.7)] relative overflow-hidden">
      <svg className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none" aria-hidden>
        <defs>
          <pattern id="tarp" width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M0 11h22M11 0v22" stroke="#fff" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tarp)" />
      </svg>
      <div className="relative">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h2 className="font-display text-xl font-bold">Today's rates</h2>
          <p className="text-sm text-white/65">₹ per kg</p>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 sm:gap-x-6 text-[0.8rem] text-white/60 pb-2 border-b border-white/15">
          <span>Crop</span>
          <span className="text-right">On FarmFresh</span>
          <span className="text-right w-16 sm:w-20">Mandi</span>
        </div>
        <ul className="[perspective:600px]" aria-live="polite">
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="h-12 border-b border-white/10 animate-pulse" />
            ))}
          {rows.map((r, i) => {
            const below = r.diff_percent !== null && r.diff_percent <= 0;
            return (
              <li
                key={r.crop}
                className="board-row grid grid-cols-[1fr_auto_auto] gap-x-4 sm:gap-x-6 items-center py-2.5 border-b border-white/10 last:border-0"
                style={{ animationDelay: `${120 + i * 90}ms` }}
              >
                <Link to={`/market?crop=${encodeURIComponent(r.crop)}`} className="font-semibold hover:underline truncate">
                  {r.crop}
                </Link>
                <span className="text-right">
                  <span className="font-display text-[1.45rem] font-bold text-turmeric num">{Number(r.farm_price).toFixed(2)}</span>
                </span>
                <span className="text-right w-16 sm:w-20 num">
                  <span className="block text-white/80">{r.market_median ? Number(r.market_median).toFixed(2) : "—"}</span>
                  {r.diff_percent !== null && (
                    <span className={cx("block text-[0.72rem] font-semibold", below ? "text-[#8fe0b0]" : "text-[#ffd27a]")}>
                      {below ? "▼" : "▲"} {Math.abs(r.diff_percent).toFixed(0)}%
                    </span>
                  )}
                </span>
              </li>
            );
          })}
          {!loading && !rows.length && <li className="py-6 text-white/70">No produce listed yet.</li>}
        </ul>
        <p className="text-[0.78rem] text-white/55 mt-3 leading-snug">
          Mandi column is the median modal price across recent reports{sample ? " (sample reference data until the AGMARKNET feed is connected)" : " from AGMARKNET"}.
        </p>
      </div>
    </div>
  );
}

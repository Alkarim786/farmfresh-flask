import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import PriceChart from "../components/PriceChart";
import { Card, ErrorNote, PageHeader, Spinner, cx } from "../components/ui";
import { useApi } from "../lib/useApi";
import { qs } from "../lib/api";
import { cropArt } from "../lib/crops";
import { rupees, shortDate } from "../lib/format";

export default function Prices() {
  const [params, setParams] = useSearchParams();
  const commodities = useApi("/prices/commodities");
  const commodity = params.get("commodity") || commodities.data?.[0]?.commodity;
  const days = params.get("days") || "60";
  const { data, error, loading } = useApi(commodity ? `/prices${qs({ commodity, days })}` : null);

  const series = data?.series || [];
  const last = series.at(-1), first = series[0];
  const change = last && first ? ((Number(last.median) - Number(first.median)) / Number(first.median)) * 100 : null;
  const top = data?.markets?.[0], bottom = data?.markets?.at(-1);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="Mandi prices" />
      <p className="text-muted -mt-4 mb-6 max-w-2xl">
        Wholesale prices reported by regulated markets, converted to rupees per kg. Use them to check whether a price on FarmFresh is fair before you sell or buy.
      </p>
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-2 -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label="Commodity">
        {commodities.data?.map(({ commodity: c }) => (
          <button key={c} aria-pressed={c === commodity} onClick={() => setParams({ commodity: c, days })}
            className={cx("shrink-0 h-9 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5",
              c === commodity ? "bg-ink text-white border-ink" : "bg-white border-line text-muted hover:text-ink")}>
            <span aria-hidden>{cropArt(c).emoji}</span>{c}
          </button>
        ))}
      </div>

      <ErrorNote error={error || commodities.error} />
      {loading || commodities.loading ? <Spinner label="Loading prices" /> : data && (
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 mt-4">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">{data.commodity}</h2>
                {last && (
                  <p className="mt-1 num">
                    <span className="font-display text-4xl font-extrabold">{rupees(last.median)}</span>
                    <span className="text-muted"> /kg median on {shortDate(last.date)}</span>
                  </p>
                )}
                {change !== null && (
                  <p className={cx("text-sm font-semibold mt-1 num", change >= 0 ? "text-[#8a6000]" : "text-leaf")}>
                    {change >= 0 ? "Up" : "Down"} {Math.abs(change).toFixed(1)}% over {days} days
                  </p>
                )}
              </div>
              <div className="flex rounded-lg border border-line overflow-hidden text-sm" role="group" aria-label="Period">
                {["30", "60", "120"].map((d) => (
                  <button key={d} aria-pressed={d === days} onClick={() => setParams({ commodity, days: d })}
                    className={cx("px-3 py-1.5 font-semibold", d === days ? "bg-tarp text-white" : "bg-white text-muted hover:text-ink")}>
                    {d} days
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5"><PriceChart series={series} height={300} /></div>
            <p className="text-sm text-muted mt-3">
              {data.source === "sample"
                ? "Showing sample reference data. Connect the AGMARKNET feed (data.gov.in) to show live reports."
                : "Source: AGMARKNET via data.gov.in."}
            </p>
            <Link to={`/market?crop=${encodeURIComponent(data.commodity)}`} className="inline-block mt-3 font-semibold text-tarp hover:underline">
              See {data.commodity.toLowerCase()} on sale now
            </Link>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-line">
              <h2 className="text-xl font-bold">By market</h2>
              {top && bottom && top !== bottom && (
                <p className="text-sm text-muted mt-0.5">
                  {top.market} pays {rupees(Number(top.modal_per_kg) - Number(bottom.modal_per_kg))}/kg more than {bottom.market}.
                </p>
              )}
            </div>
            <table className="w-full text-sm num">
              <thead>
                <tr className="text-left text-muted">
                  <th className="font-medium px-5 py-2">Market</th>
                  <th className="font-medium px-2 py-2 text-right">Modal</th>
                  <th className="font-medium px-5 py-2 text-right">Range</th>
                </tr>
              </thead>
              <tbody>
                {data.markets.map((m) => (
                  <tr key={m.market} className="border-t border-line">
                    <td className="px-5 py-2.5"><span className="font-semibold">{m.market}</span><span className="block text-xs text-faint">{shortDate(m.date)}</span></td>
                    <td className="px-2 py-2.5 text-right font-semibold">{rupees(m.modal_per_kg)}</td>
                    <td className="px-5 py-2.5 text-right text-muted whitespace-nowrap">{Number(m.min_per_kg).toFixed(0)}–{Number(m.max_per_kg).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

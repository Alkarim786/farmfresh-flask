import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, Wheat } from "lucide-react";
import { ListingGrid } from "../components/Produce";
import { Button, Empty, ErrorNote, Select, Spinner, cx } from "../components/ui";
import { qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { cropArt } from "../lib/crops";

const PAGE = 24;

export default function Market() {
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get("q") || "");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const filters = Object.fromEntries(params.entries());
  const path = `/listings${qs({ ...filters, page, page_size: PAGE })}`;
  const { data, error, loading, reload } = useApi(path);
  const crops = useApi("/listings/crops");

  useEffect(() => setPage(1), [params]);
  useEffect(() => {
    if (!data) return;
    setItems((prev) => (data.page === 1 ? data.items : [...prev, ...data.items]));
  }, [data]);

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = setTimeout(() => update({ q: term.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  function update(patch) {
    const next = { ...Object.fromEntries(params.entries()), ...patch };
    Object.keys(next).forEach((k) => (next[k] === undefined || next[k] === "") && delete next[k]);
    if (JSON.stringify(next) !== JSON.stringify(Object.fromEntries(params.entries()))) setParams(next, { replace: true });
  }

  const activeCrop = params.get("crop");
  const filterCount = ["location", "grade", "organic", "max_price", "min_qty"].filter((k) => params.get(k)).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl sm:text-[2.4rem] font-extrabold">Marketplace</h1>
          <p className="text-muted mt-1">Produce listed directly by farmers. Prices are per unit, before delivery.</p>
        </div>
      </div>

      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search produce, farms or places</span>
          <Search className="size-5 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            className="input !pl-11 h-12 !text-base"
            placeholder="Search tomato, Hosur, Thottam Organics…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <div className="w-44 hidden sm:block">
          <Select value={params.get("sort") || "new"} onChange={(e) => update({ sort: e.target.value === "new" ? undefined : e.target.value })} aria-label="Sort by" className="[&_select]:h-12">
            <option value="new">Newest first</option>
            <option value="price_asc">Lowest price</option>
            <option value="price_desc">Highest price</option>
            <option value="qty_desc">Most available</option>
          </Select>
        </div>
        <Button variant="secondary" className="h-12" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters{filterCount ? ` (${filterCount})` : ""}
        </Button>
      </div>

      {showFilters && (
        <div className="mt-3 bg-white border border-line rounded-2xl p-4 grid gap-3 grid-cols-2 md:grid-cols-5 items-end">
          <label className="col-span-2 md:col-span-1">
            <span className="block text-sm font-semibold mb-1.5">Near</span>
            <input className="input" placeholder="District or town" defaultValue={params.get("location") || ""}
              onBlur={(e) => update({ location: e.target.value.trim() || undefined })}
              onKeyDown={(e) => e.key === "Enter" && update({ location: e.currentTarget.value.trim() || undefined })} />
          </label>
          <Select label="Grade" value={params.get("grade") || ""} onChange={(e) => update({ grade: e.target.value || undefined })}>
            <option value="">Any grade</option>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
          </Select>
          <label>
            <span className="block text-sm font-semibold mb-1.5">Max ₹ per unit</span>
            <input className="input" type="number" inputMode="decimal" min="0" defaultValue={params.get("max_price") || ""}
              onBlur={(e) => update({ max_price: e.target.value || undefined })} />
          </label>
          <label>
            <span className="block text-sm font-semibold mb-1.5">Need at least</span>
            <input className="input" type="number" inputMode="decimal" min="0" placeholder="kg" defaultValue={params.get("min_qty") || ""}
              onBlur={(e) => update({ min_qty: e.target.value || undefined })} />
          </label>
          <label className="flex items-center gap-2 h-11 col-span-2 md:col-span-1">
            <input type="checkbox" className="size-4 accent-[#2747a8]" checked={params.get("organic") === "1"}
              onChange={(e) => update({ organic: e.target.checked ? "1" : undefined })} />
            <span className="text-sm font-semibold">Organic only</span>
          </label>
          {filterCount > 0 && (
            <button className="text-sm text-tarp font-semibold text-left col-span-2 md:col-span-5"
              onClick={() => setParams(Object.fromEntries([...params.entries()].filter(([k]) => ["q", "crop", "sort"].includes(k))))}>
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto scrollbar-none py-4 -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by crop">
        <button onClick={() => update({ crop: undefined })}
          className={cx("shrink-0 h-9 px-3.5 rounded-full border text-sm font-semibold", !activeCrop ? "bg-ink text-white border-ink" : "bg-white border-line text-muted hover:text-ink")}>
          All crops
        </button>
        {crops.data?.map(({ crop, count }) => (
          <button key={crop} onClick={() => update({ crop: activeCrop === crop ? undefined : crop })} aria-pressed={activeCrop === crop}
            className={cx("shrink-0 h-9 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5",
              activeCrop === crop ? "bg-ink text-white border-ink" : "bg-white border-line text-muted hover:text-ink")}>
            <span aria-hidden>{cropArt(crop).emoji}</span>
            {crop}
            <span className="opacity-60 num">{count}</span>
          </button>
        ))}
      </div>

      <ErrorNote error={error} onRetry={reload} />
      {loading && page === 1 ? (
        <Spinner label="Loading produce" />
      ) : items.length ? (
        <>
          <p className="text-sm text-muted mb-4 num">{data?.total} listings</p>
          <ListingGrid items={items} />
          {data && items.length < data.total && (
            <div className="text-center mt-8">
              <Button variant="secondary" loading={loading} onClick={() => setPage((p) => p + 1)}>
                Show more produce
              </Button>
            </div>
          )}
        </>
      ) : (
        !error && (
          <Empty icon={Wheat} title="Nothing matches yet" action={<Button variant="secondary" onClick={() => { setTerm(""); setParams({}); }}>Clear search</Button>}>
            Try another crop or widen the area. New harvests are listed every day.
          </Empty>
        )
      )}
    </div>
  );
}

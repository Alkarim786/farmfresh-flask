import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ImagePlus, Plus, Sprout, X } from "lucide-react";
import { api, qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useSession } from "../lib/session";
import { CROP_SUGGESTIONS } from "../lib/crops";
import { diffVsMarket, qty, rupees } from "../lib/format";
import {
  Button, Card, Empty, ErrorNote, Input, MarketChip, Modal, PageHeader, ProduceArt, Select, Spinner, Textarea, cx,
} from "../components/ui";

// Resize in the browser so uploads stay small (max 1200px, JPEG ~0.82).
function resizeImage(file, max = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error(`${file.name} isn't an image we can read`));
    img.src = URL.createObjectURL(file);
  });
}

const EMPTY = { crop: "", variety: "", grade: "A", unit: "kg", qty_total: "", min_order_qty: "", price: "", harvest_date: "", description: "", organic: false };

function ListingForm({ initial, onClose, onSaved }) {
  const { user } = useSession();
  const editing = Boolean(initial?.id);
  const [f, setF] = useState(() =>
    editing
      ? { ...initial, harvest_date: initial.harvest_date?.slice(0, 10) || "", qty_available: initial.qty_available }
      : { ...EMPTY, location: user.location || "" }
  );
  const [photos, setPhotos] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [market, setMarket] = useState(initial?.market || null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  // Live mandi reference while the farmer types the crop name.
  useEffect(() => {
    if (!f.crop || f.unit !== "kg") return setMarket(null);
    const t = setTimeout(async () => {
      try {
        const r = await api(`/prices${qs({ commodity: f.crop.trim(), days: 7 })}`, { auth: false });
        const last = r.series?.at(-1);
        setMarket(last ? { median: last.median, unit: "kg", markets: r.markets.length, as_of: last.date, source: r.source } : null);
      } catch {
        setMarket(null);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [f.crop, f.unit]);

  const addPhotos = async (files) => {
    const existing = (initial?.images?.length || 0) - removed.length;
    const room = 4 - existing - photos.length;
    try {
      const next = await Promise.all([...files].slice(0, room).map((x) => resizeImage(x)));
      setPhotos((p) => [...p, ...next]);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = { ...f, images: photos, remove_images: removed };
    delete body.market; delete body.farmer; delete body.status; delete body.id;
    if (!editing) delete body.qty_available;
    else delete body.qty_total;
    if (!body.min_order_qty) delete body.min_order_qty;
    try {
      const saved = await api(editing ? `/listings/${initial.id}` : "/listings", { method: editing ? "PATCH" : "POST", body });
      toast.success(editing ? "Listing updated" : `${saved.crop} is live on the marketplace`);
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const d = diffVsMarket(f.price, market);
  const existingImgs = (initial?.images || []).filter((src) => !removed.includes(Number(src.split("/").pop())));

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field2>
          <Input label="Crop" list="crops" required value={f.crop} onChange={set("crop")} placeholder="Tomato" />
          <datalist id="crops">{CROP_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        </Field2>
        <Input label="Variety" value={f.variety || ""} onChange={set("variety")} placeholder="Hybrid, Ponni…" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Price (₹)" type="number" inputMode="decimal" required value={f.price} onChange={set("price")} />
        <Select label="Per" value={f.unit} onChange={set("unit")}>
          {["kg", "quintal", "dozen", "piece", "crate"].map((u) => <option key={u}>{u}</option>)}
        </Select>
        <Select label="Grade" value={f.grade} onChange={set("grade")}>
          <option value="A">A (best)</option><option value="B">B</option><option value="C">C</option>
        </Select>
      </div>
      {market && (
        <div className={cx("rounded-xl px-4 py-3 text-sm", d === null ? "bg-tarp-soft" : d > 15 ? "bg-turmeric-soft text-[#6b4c00]" : "bg-tarp-soft text-tarp-deep")}>
          <span className="font-semibold">Mandi median for {f.crop}: {rupees(market.median)}/kg</span>
          {d !== null && Number(f.price) > 0 && (
            <span> — your price is {Math.abs(d).toFixed(0)}% {d > 0 ? "above" : "below"}{d > 15 ? ". Buyers may compare." : "."}</span>
          )}
          {market.source === "sample" && <span className="block text-xs opacity-75 mt-0.5">Sample reference data</span>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {editing ? (
          <Input label={`Available now (${f.unit})`} type="number" inputMode="decimal" value={f.qty_available} onChange={set("qty_available")}
            hint="Stock already ordered is kept aside." />
        ) : (
          <Input label={`Quantity (${f.unit})`} type="number" inputMode="decimal" required value={f.qty_total} onChange={set("qty_total")} />
        )}
        <Input label={`Minimum order (${f.unit})`} type="number" inputMode="decimal" value={f.min_order_qty} onChange={set("min_order_qty")} placeholder="1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Pickup location" required value={f.location} onChange={set("location")} />
        <Input label="Harvest date" type="date" value={f.harvest_date} onChange={set("harvest_date")} />
      </div>
      <Textarea label="Description" rows={3} value={f.description || ""} onChange={set("description")} placeholder="Size, freshness, packing, anything buyers should know." />
      <label className="flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-[#1f7a4a]" checked={f.organic} onChange={set("organic")} />
        <span className="text-sm font-semibold">Grown organically</span>
      </label>

      <div>
        <p className="text-sm font-semibold mb-1.5">Photos <span className="font-normal text-faint">(up to 4)</span></p>
        <div className="flex flex-wrap gap-2">
          {existingImgs.map((src) => (
            <Thumb key={src} src={src} onRemove={() => setRemoved((r) => [...r, Number(src.split("/").pop())])} />
          ))}
          {photos.map((src, i) => <Thumb key={i} src={src} onRemove={() => setPhotos((p) => p.filter((_, j) => j !== i))} />)}
          {existingImgs.length + photos.length < 4 && (
            <label className="size-20 rounded-xl border-2 border-dashed border-line grid place-items-center text-muted cursor-pointer hover:border-tarp hover:text-tarp has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-tarp">
              <ImagePlus className="size-6" aria-hidden />
              <span className="sr-only">Add photos</span>
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
            </label>
          )}
        </div>
      </div>

      {err && <p className="text-sm text-chilli" role="alert">{err}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={busy}>{editing ? "Save changes" : "Publish listing"}</Button>
      </div>
    </form>
  );
}

const Field2 = ({ children }) => <div>{children}</div>;

function Thumb({ src, onRemove }) {
  return (
    <div className="relative size-20">
      <img src={src} alt="" className="size-20 rounded-xl object-cover border border-line" />
      <button type="button" onClick={onRemove} className="absolute -top-1.5 -right-1.5 size-6 rounded-full bg-ink text-white grid place-items-center" aria-label="Remove photo">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export default function MyListings() {
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi("/my/listings");
  const [editing, setEditing] = useState(params.get("new") ? {} : null);
  const close = () => {
    setEditing(null);
    if (params.get("new")) setParams({});
  };

  const toggle = async (l) => {
    try {
      await api(`/listings/${l.id}`, { method: "PATCH", body: { status: l.status === "CLOSED" ? "ACTIVE" : "CLOSED" } });
      toast.success(l.status === "CLOSED" ? "Listing is back on sale" : "Listing paused");
      reload();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="My produce">
        <Button onClick={() => setEditing({})}><Plus className="size-4" aria-hidden />List a harvest</Button>
      </PageHeader>
      <ErrorNote error={error} onRetry={reload} />
      {loading ? <Spinner /> : !data?.length ? (
        <Empty icon={Sprout} title="List your first harvest" action={<Button onClick={() => setEditing({})}>List a harvest</Button>}>
          Add the crop, quantity and your price. You'll see the mandi rate as you type.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {data.map((l) => {
              const sold = Number(l.qty_total) - Number(l.qty_available);
              const pct = Number(l.qty_total) ? (sold / Number(l.qty_total)) * 100 : 0;
              return (
                <li key={l.id} className="flex flex-wrap sm:flex-nowrap gap-4 items-center p-4 border-b border-line last:border-0">
                  <ProduceArt listing={l} size="sm" className="size-16 rounded-xl shrink-0" />
                  <div className="flex-1 min-w-40">
                    <Link to={`/listing/${l.id}`} className="font-semibold hover:text-tarp">{l.crop} {l.variety && <span className="text-muted font-normal">{l.variety}</span>}</Link>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm num">{rupees(l.price)}/{l.unit}</span>
                      <MarketChip price={l.price} market={l.market} />
                    </div>
                  </div>
                  <div className="w-40">
                    <div className="flex justify-between text-xs text-muted num"><span>{qty(sold)} sold</span><span>{qty(l.qty_available)} left</span></div>
                    <div className="h-1.5 rounded-full bg-paper mt-1 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Sold">
                      <div className="h-full bg-leaf rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className={cx("text-xs font-semibold rounded-full px-2.5 py-0.5 w-20 text-center",
                    { ACTIVE: "bg-leaf-soft text-leaf", SOLD_OUT: "bg-turmeric-soft text-[#7a5600]", CLOSED: "bg-[#eef1f5] text-muted", HIDDEN: "bg-chilli-soft text-chilli" }[l.status])}>
                    {{ ACTIVE: "On sale", SOLD_OUT: "Sold out", CLOSED: "Paused", HIDDEN: "Hidden" }[l.status]}
                  </span>
                  <div className="flex gap-1.5 ml-auto">
                    {l.status !== "HIDDEN" && <Button size="sm" variant="secondary" onClick={() => setEditing(l)}>Edit</Button>}
                    {["ACTIVE", "CLOSED"].includes(l.status) && <Button size="sm" variant="ghost" onClick={() => toggle(l)}>{l.status === "CLOSED" ? "Resume" : "Pause"}</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Modal open={editing !== null} onClose={close} title={editing?.id ? `Edit ${editing.crop}` : "List a harvest"} wide>
        {editing !== null && <ListingForm initial={editing} onClose={close} onSaved={() => { close(); reload(); }} />}
      </Modal>
    </div>
  );
}

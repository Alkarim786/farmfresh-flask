import { useEffect, useId, useRef } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Loader2, Star, X } from "lucide-react";
import { cropArt } from "../lib/crops";
import { diffVsMarket, PAYMENT_LABEL, rupees, STATUS_LABEL } from "../lib/format";

const cx = (...c) => c.filter(Boolean).join(" ");
export { cx };

const BTN = {
  primary: "bg-tarp text-white hover:bg-tarp-deep shadow-[0_1px_0_#0f1d4a]",
  accent: "bg-turmeric text-ink hover:brightness-95 shadow-[0_1px_0_#b0811a]",
  secondary: "bg-white text-ink border border-line hover:border-[#c6cdd8] hover:bg-[#fbfcfd]",
  ghost: "text-muted hover:text-ink hover:bg-[#eef1f5]",
  danger: "bg-white text-chilli border border-[#f0c9c4] hover:bg-chilli-soft",
  success: "bg-leaf text-white hover:brightness-110",
};

export function Button({ variant = "primary", size = "md", loading, className, children, as, ...props }) {
  const C = as || "button";
  const sz = size === "sm" ? "h-9 px-3 text-sm" : size === "lg" ? "h-12 px-6 text-base" : "h-11 px-4 text-[0.95rem]";
  return (
    <C
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold transition-[background,filter,border-color] disabled:opacity-55 disabled:pointer-events-none select-none whitespace-nowrap",
        sz,
        BTN[variant],
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </C>
  );
}

export function Field({ label, hint, error, children, className }) {
  const id = useId();
  const child = typeof children === "function" ? children({ id, invalid: Boolean(error) }) : children;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-ink mb-1.5">
          {label}
        </label>
      )}
      {child}
      {error ? (
        <p className="text-sm text-chilli mt-1.5">{error}</p>
      ) : hint ? (
        <p className="text-sm text-faint mt-1.5">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ label, hint, error, className, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, invalid }) => <input id={id} aria-invalid={invalid} className="input" {...props} />}
    </Field>
  );
}

export function Select({ label, hint, error, className, children, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, invalid }) => (
        <select id={id} aria-invalid={invalid} className="input appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235b6676%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_0.8rem_center] pr-9" {...props}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Textarea({ label, hint, error, className, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, invalid }) => <textarea id={id} aria-invalid={invalid} className="input min-h-24 resize-y" {...props} />}
    </Field>
  );
}

export function Card({ className, children, ...p }) {
  return (
    <div className={cx("bg-surface rounded-2xl border border-line", className)} {...p}>
      {children}
    </div>
  );
}

export function Spinner({ label = "Loading" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-[#f0c9c4] bg-chilli-soft text-chilli px-4 py-3 flex items-center justify-between gap-3">
      <span>{error.message}</span>
      {onRetry && (
        <Button size="sm" variant="danger" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="text-center py-14 px-6">
      {Icon && (
        <div className="mx-auto mb-4 size-14 rounded-2xl bg-tarp-soft text-tarp grid place-items-center">
          <Icon className="size-7" aria-hidden />
        </div>
      )}
      <h3 className="text-xl font-bold">{title}</h3>
      {children && <p className="text-muted mt-1.5 max-w-md mx-auto">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ProduceArt({ listing, className, size = "md" }) {
  const art = cropArt(listing.crop);
  const img = listing.images?.[0];
  if (img) return <img src={img} alt={`${listing.crop} from ${listing.location}`} className={cx("object-cover", className)} loading="lazy" />;
  const fs = size === "lg" ? "text-[7rem]" : size === "sm" ? "text-3xl" : "text-6xl";
  return (
    <div
      className={cx("grid place-items-center relative overflow-hidden", className)}
      style={{ background: art.bg }}
      role="img"
      aria-label={listing.crop}
    >
      <svg className="absolute inset-0 w-full h-full opacity-[0.18]" aria-hidden>
        <defs>
          <pattern id={`furrow-${listing.id}`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
            <line x1="0" y1="0" x2="0" y2="14" stroke={art.fg} strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#furrow-${listing.id})`} />
      </svg>
      <span className={cx(fs, "relative drop-shadow-[0_6px_10px_rgba(0,0,0,.12)]")} aria-hidden>
        {art.emoji}
      </span>
    </div>
  );
}

const STATUS_STYLE = {
  PENDING: "bg-turmeric-soft text-[#7a5600]",
  ACCEPTED: "bg-tarp-soft text-tarp",
  TRANSPORT_ASSIGNED: "bg-tarp-soft text-tarp",
  DISPATCHED: "bg-tarp text-white",
  DELIVERED: "bg-leaf-soft text-leaf",
  COMPLETED: "bg-leaf text-white",
  REJECTED: "bg-chilli-soft text-chilli",
  CANCELLED: "bg-[#eef1f5] text-muted",
};

export function StatusPill({ status, className, viewer }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.8rem] font-semibold whitespace-nowrap", STATUS_STYLE[status], className)}>
      {viewer === "FARMER" && status === "PENDING" ? "Needs your answer" : STATUS_LABEL[status] || status}
    </span>
  );
}

export function PaymentPill({ status }) {
  const s = {
    PAID: "text-leaf",
    FAILED: "text-chilli",
    REFUNDED: "text-muted",
    REFUND_PENDING: "text-[#7a5600]",
  }[status] || "text-faint";
  return <span className={cx("text-[0.8rem] font-semibold", s)}>{PAYMENT_LABEL[status] || status}</span>;
}

// "₹3.20 below mandi" chip. Green when the asking price is under the market median.
export function MarketChip({ price, market, className }) {
  const d = diffVsMarket(price, market);
  if (d === null) return null;
  const below = d <= 0;
  const abs = Math.abs(d);
  const text = abs < 1 ? "At mandi rate" : `${abs.toFixed(0)}% ${below ? "below" : "above"} mandi`;
  return (
    <span
      title={`Mandi median ${rupees(market.median)}/${market.unit} across ${market.markets} reports, ${market.as_of}${market.source === "sample" ? " (sample data)" : ""}`}
      className={cx(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.78rem] font-semibold num",
        below ? "bg-leaf-soft text-leaf" : "bg-turmeric-soft text-[#7a5600]",
        className
      )}
    >
      {text}
    </span>
  );
}

export function Verified({ className }) {
  return (
    <BadgeCheck className={cx("size-4 text-tarp shrink-0", className)} aria-label="Verified by FarmFresh" role="img" />
  );
}

export function Stars({ value, count, className }) {
  if (!value) return <span className={cx("text-sm text-faint", className)}>No ratings yet</span>;
  return (
    <span className={cx("inline-flex items-center gap-1 text-sm", className)}>
      <Star className="size-4 fill-turmeric text-turmeric" aria-hidden />
      <span className="font-semibold num">{value.toFixed(1)}</span>
      {count !== undefined && <span className="text-faint">({count})</span>}
    </span>
  );
}

export function StarInput({ value, onChange }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onChange(n)}
          className="p-1"
        >
          <Star className={cx("size-7 transition-colors", n <= value ? "fill-turmeric text-turmeric" : "text-line")} />
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "rounded-2xl p-0 backdrop:bg-[#17202c]/45 backdrop:backdrop-blur-[2px] w-[calc(100%-2rem)] m-auto",
        wide ? "max-w-2xl" : "max-w-lg"
      )}
    >
      {open && (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="text-2xl font-bold">{title}</h2>
            <button onClick={onClose} className="p-1.5 -m-1.5 rounded-lg text-muted hover:bg-paper" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({ title, children, back }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div>
        {back && (
          <Link to={back.to} className="text-sm text-muted hover:text-ink inline-block mb-2">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-3xl sm:text-[2.4rem] font-extrabold">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, tone }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className={cx("font-display text-[1.9rem] font-bold mt-1 num", tone)}>{value}</p>
    </Card>
  );
}

import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useSession } from "../lib/session";
import { when } from "../lib/format";
import { ListingGrid } from "../components/Produce";
import { Button, Card, ErrorNote, Input, PageHeader, Spinner, Stars, Verified } from "../components/ui";

export function Profile() {
  const { user, refreshUser } = useSession();
  const [f, setF] = useState(user);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth/me", { method: "PATCH", body: f });
      await refreshUser();
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
      <PageHeader title="Your profile" />
      <Card className="p-6">
        <p className="text-sm text-muted mb-5 flex items-center gap-1.5">
          {user.email}, {user.role.toLowerCase()} account {user.verified ? <><Verified /> verified</> : "(not verified yet)"}
        </p>
        <form onSubmit={save} className="space-y-4">
          <Input label="Full name" value={f.name || ""} onChange={set("name")} />
          <Input label="Phone" value={f.phone || ""} onChange={set("phone")} />
          <Input label="Location" value={f.location || ""} onChange={set("location")} />
          {user.role === "FARMER" && <Input label="Farm name" value={f.farm_name || ""} onChange={set("farm_name")} />}
          {user.role === "BUYER" && <Input label="Business type" value={f.business_type || ""} onChange={set("business_type")} />}
          {user.role === "TRANSPORTER" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Vehicle" value={f.vehicle_type || ""} onChange={set("vehicle_type")} />
                <Input label="Capacity (kg)" type="number" value={f.vehicle_capacity_kg || ""} onChange={set("vehicle_capacity_kg")} />
              </div>
              <Input label="Areas you serve" value={f.service_area || ""} onChange={set("service_area")} hint="Comma separated." />
            </>
          )}
          <Button type="submit" loading={busy}>Save profile</Button>
        </form>
      </Card>
    </div>
  );
}

export function FarmerProfile() {
  const { id } = useParams();
  const { data: f, error, loading } = useApi(`/farmers/${id}`);
  if (loading) return <Spinner />;
  if (error) return <div className="max-w-3xl mx-auto p-6"><ErrorNote error={error} /></div>;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="flex flex-wrap gap-6 items-end justify-between mb-8">
        <div>
          <h1 className="text-4xl sm:text-5xl font-extrabold flex items-center gap-2">{f.farm_name || f.name}{f.verified && <Verified className="size-7" />}</h1>
          <p className="text-muted mt-2 flex items-center gap-1.5"><MapPin className="size-4" aria-hidden />{f.name}, {f.location}</p>
        </div>
        <Stars value={f.rating.average} count={f.rating.count} className="!text-lg" />
      </div>
      <h2 className="text-2xl font-bold mb-4">On sale now</h2>
      {f.listings.length ? <ListingGrid items={f.listings.map((l) => ({ ...l, farmer: f }))} /> : <p className="text-muted">Nothing listed right now.</p>}
      {f.reviews.length > 0 && (
        <>
          <h2 className="text-2xl font-bold mt-12 mb-4">What buyers say</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {f.reviews.map((r, i) => (
              <Card key={i} className="p-5">
                <Stars value={r.rating} />
                {r.comment && <p className="mt-2">{r.comment}</p>}
                <p className="text-sm text-muted mt-2">{r.by}, {when(r.at)}</p>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

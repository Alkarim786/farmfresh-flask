import { Link } from "react-router-dom";
import { Sprout, Store, Truck } from "lucide-react";
import { ListingGrid, RateBoard } from "../components/Produce";
import { Button } from "../components/ui";
import { useApi } from "../lib/useApi";
import { useSession } from "../lib/session";

const ROLES = [
  {
    icon: Sprout,
    title: "Farmers",
    body: "List a harvest in a minute. See the mandi rate next to your price before you publish, accept the orders you want, and get paid before the produce leaves.",
    cta: "Start selling",
    role: "FARMER",
  },
  {
    icon: Store,
    title: "Buyers",
    body: "Restaurants, shops and households buy straight from named farms. Compare each price with the mandi, order from several farms in one basket, and track every load.",
    cta: "Start buying",
    role: "BUYER",
  },
  {
    icon: Truck,
    title: "Transporters",
    body: "See loads that fit your vehicle and route, send a quote, and get booked. Payment is confirmed before you pick up.",
    cta: "Find loads",
    role: "TRANSPORTER",
  },
];

export default function Landing() {
  const { user } = useSession();
  const { data } = useApi("/listings?page_size=8");
  return (
    <>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-14 grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14 items-center">
        <div>
          <h1 className="font-display font-extrabold text-[2.7rem] leading-[1.02] sm:text-[4rem] lg:text-[4.1rem] xl:text-[4.5rem] tracking-[-0.03em]">
            Farm prices,
            <br />
            set by the people
            <br />
            who grow the food.
          </h1>
          <p className="mt-6 text-lg text-muted max-w-xl">
            FarmFresh lets farmers sell straight to restaurants, shops and families, with the day's mandi rate on every
            listing and a truck one quote away.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button as={Link} to="/market" size="lg">
              Browse today's produce
            </Button>
            {!user && (
              <Button as={Link} to="/register?role=FARMER" size="lg" variant="secondary">
                Sell your harvest
              </Button>
            )}
          </div>
        </div>
        <RateBoard />
      </section>

      <section className="bg-white border-y border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 grid md:grid-cols-3 gap-8 md:gap-10">
          {ROLES.map(({ icon: Icon, title, body, cta, role }) => (
            <div key={role}>
              <Icon className="size-7 text-tarp" aria-hidden />
              <h2 className="text-2xl font-bold mt-4">{title}</h2>
              <p className="text-muted mt-2 max-w-sm">{body}</p>
              {!user && (
                <Link to={`/register?role=${role}`} className="inline-block mt-4 font-semibold text-tarp hover:underline">
                  {cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-14">
        <div className="flex items-end justify-between gap-4 mb-6">
          <h2 className="text-3xl font-extrabold">Fresh on the market</h2>
          <Link to="/market" className="font-semibold text-tarp hover:underline">
            See all produce
          </Link>
        </div>
        {data?.items && <ListingGrid items={data.items} />}
      </section>
    </>
  );
}

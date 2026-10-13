import { Navigate, Route, Routes, useLocation, Link } from "react-router-dom";
import { Toaster } from "sonner";
import Shell from "./components/Shell";
import { useSession } from "./lib/session";
import { Button, Empty } from "./components/ui";
import Landing from "./pages/Landing";
import Market from "./pages/Market";
import ListingDetail from "./pages/ListingDetail";
import Cart from "./pages/Cart";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import MyListings from "./pages/MyListings";
import Dashboard from "./pages/Dashboard";
import Prices from "./pages/Prices";
import { Jobs, Deliveries } from "./pages/Transport";
import { AdminHome, AdminListings, AdminOrders, AdminUsers } from "./pages/Admin";
import { FarmerProfile, Profile } from "./pages/Profile";
import { HOME_FOR, Login, Register } from "./pages/Auth";
import { Compass } from "lucide-react";

function Guard({ roles, children }) {
  const { user } = useSession();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME_FOR[user.role]} replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user } = useSession();
  return user ? <Navigate to={HOME_FOR[user.role]} replace /> : children;
}

function NotFound() {
  return (
    <Empty icon={Compass} title="This page doesn't exist" action={<Button as={Link} to="/">Go to the homepage</Button>}>
      The link may be old or mistyped.
    </Empty>
  );
}

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Landing />} />
          <Route path="market" element={<Market />} />
          <Route path="listing/:id" element={<ListingDetail />} />
          <Route path="farmers/:id" element={<FarmerProfile />} />
          <Route path="prices" element={<Prices />} />
          <Route path="cart" element={<Cart />} />
          <Route path="login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route path="profile" element={<Guard><Profile /></Guard>} />
          <Route path="dashboard" element={<Guard roles={["FARMER", "BUYER", "TRANSPORTER"]}><Dashboard /></Guard>} />
          <Route path="orders" element={<Guard roles={["FARMER", "BUYER"]}><Orders /></Guard>} />
          <Route path="orders/:id" element={<Guard><OrderDetail /></Guard>} />
          <Route path="my-listings" element={<Guard roles={["FARMER"]}><MyListings /></Guard>} />
          <Route path="jobs" element={<Guard roles={["TRANSPORTER"]}><Jobs /></Guard>} />
          <Route path="transport" element={<Navigate to="/jobs" replace />} />
          <Route path="deliveries" element={<Guard roles={["TRANSPORTER"]}><Deliveries /></Guard>} />
          <Route path="admin" element={<Guard roles={["ADMIN"]}><AdminHome /></Guard>} />
          <Route path="admin/users" element={<Guard roles={["ADMIN"]}><AdminUsers /></Guard>} />
          <Route path="admin/listings" element={<Guard roles={["ADMIN"]}><AdminListings /></Guard>} />
          <Route path="admin/orders" element={<Guard roles={["ADMIN"]}><AdminOrders /></Guard>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster position="bottom-center" toastOptions={{ style: { fontFamily: "Instrument Sans", borderRadius: 12 } }} />
    </>
  );
}

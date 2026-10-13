import { api } from "./api";

let scriptPromise;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Couldn't load the payment window. Check your connection."));
    };
    document.body.appendChild(s);
  });
  return scriptPromise;
}

// Starts checkout. Resolves "paid" | "dismissed"; throws on failure.
// For demo mode it returns the session so the UI can show its own simulated sheet.
export async function startPayment(orderId) {
  const session = await api(`/payments/orders/${orderId}`, { method: "POST" });
  if (session.mode !== "razorpay") return { demo: session };
  await loadRazorpay();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: session.key_id,
      amount: session.amount,
      currency: session.currency,
      order_id: session.provider_order_id,
      name: "FarmFresh",
      description: `Order #${orderId}`,
      prefill: session.prefill,
      theme: { color: "#2747A8" },
      handler: async (resp) => {
        try {
          await api("/payments/verify", { method: "POST", body: resp });
          resolve({ paid: true });
        } catch (e) {
          reject(e);
        }
      },
      modal: { ondismiss: () => resolve({ dismissed: true }) },
    });
    rzp.on("payment.failed", (r) => {
      api("/payments/failed", {
        method: "POST",
        body: { razorpay_order_id: session.provider_order_id, reason: r?.error?.description },
      }).catch(() => {});
    });
    rzp.open();
  });
}

export async function confirmDemoPayment(providerOrderId) {
  return api("/payments/verify", { method: "POST", body: { razorpay_order_id: providerOrderId, demo_confirm: true } });
}

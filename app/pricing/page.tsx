"use client";

import { useState } from "react";
import Image from "next/image";

type Interval = "month" | "year";
type Currency = "INR" | "USD";

export default function PricingPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"" | "month" | "year">("");
  const [currency, setCurrency] = useState<Currency>("INR"); // toggle between INR / USD

  async function startCheckout(interval: Interval) {
    if (!email || !email.includes("@")) {
      alert("Please enter a valid email");
      return;
    }
    try {
      setBusy(interval);
      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval, email, currency }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data?.error || "Checkout failed");
      window.location.href = data.url; // redirect to Stripe
    } catch (e: any) {
      alert(e.message || "Something went wrong");
      setBusy("");
    }
  }

  // Display prices based on selected currency
  const priceMonthly = currency === "INR" ? "₹4,999 + 18% GST" : "$94.94";
  const priceAnnual  = currency === "INR" ? "₹49,999 + 18% GST" : "$949";

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      {/* Logo at the top */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <Image
          src="/5thElement-large.jpg"
          alt="5th Element Behavior Consultancy Anil Dagia"
          width={0}
          height={0}
          sizes="50vw"
          style={{ width: "50%", height: "auto" }}
          priority
        />
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Discovering Beliefs — Pro Features
      </h1>
      <p style={{ color: "#444", marginBottom: 20 }}>
        <ul style={{ color: "#555", fontSize: 14, margin: "0 0 12px 18px" }}>
          <li>Unlimited scans & reframes</li>
          <li>7-day micro-action plans & PDF export</li>
          <li>Health & Discipline Theme</li>
          <li>Money Theme</li>
          <li>Relationships & Boundaries Theme</li>
          <li>Leadership & Impostor Syndrome Theme</li>
          <li>Entrepreneur Risk-Tolerance Theme</li>
          <li>Belief Blueprint Questionnaire Generator</li>
          <li>Belief Blueprint Analysis & Report</li>          
        </ul>
      </p>

      {/* Currency Toggle */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 14, color: "#555" }}>Currency:</span>
        <button
          onClick={() => setCurrency("INR")}
          disabled={currency === "INR"}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: currency === "INR" ? "2px solid black" : "1px solid #ccc",
            background: currency === "INR" ? "#fff" : "#f7f7f7",
            cursor: currency === "INR" ? "default" : "pointer",
          }}
        >
          INR
        </button>
        <button
          onClick={() => setCurrency("USD")}
          disabled={currency === "USD"}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: currency === "USD" ? "2px solid black" : "1px solid #ccc",
            background: currency === "USD" ? "#fff" : "#f7f7f7",
            cursor: currency === "USD" ? "default" : "pointer",
          }}
        >
          USD
        </button>
      </div>

      {/* Email */}
      <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
        Email for receipt & license key
      </label>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 8, marginBottom: 20 }}
      />

      {/* Plans */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Monthly</h2>
          <p style={{ fontSize: 26, fontWeight: 700, margin: "8px 0" }}>{priceMonthly}</p>

          <button
            onClick={() => startCheckout("month")}
            disabled={!!busy}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 8,
              background: "blue",
              color: "white",
              border: "none",
            }}
          >
            {busy === "month" ? "Redirecting…" : "Start Monthly"}
          </button>
        </div>

        <div style={{ border: "2px solid black", padding: 16, borderRadius: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Annual</h2>
          <p style={{ fontSize: 26, fontWeight: 700, margin: "8px 0" }}>{priceAnnual}</p>

          <button
            onClick={() => startCheckout("year")}
            disabled={!!busy}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 8,
              background: "blue",
              color: "white",
              border: "none",
            }}
          >
            {busy === "year" ? "Redirecting…" : "Start Annual"}
          </button>
        </div>
      </div>

      <p style={{ color: "#666", fontSize: 12, marginTop: 16 }}>
        You’ll be redirected to Stripe Checkout and then back here after payment.
      </p>
    </main>
  );
}

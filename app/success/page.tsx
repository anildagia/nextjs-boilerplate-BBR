"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type Data = {
  customerId?: string;
  licenseKey?: string;
  error?: string;
};

const SUPPORT_EMAIL = "info@anildagia.com"; // ← replace with your real support email

export default function SuccessPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const sessionId = searchParams?.session_id ?? "";
  const [data, setData] = useState<Data>({});
  const [copied, setCopied] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const license = data.licenseKey ?? "";

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/stripe/get-license-from-session?session_id=${encodeURIComponent(
            sessionId
          )}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Fetch failed");
        setData(json);
      } catch (e: any) {
        setFetchError(e.message || "Failed to fetch license");
      }
    })();
  }, [sessionId]);

  async function copy() {
    if (!license) return;
    try {
      await navigator.clipboard.writeText(license);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no-op
    }
  }

  // Recommended: open portal by sending sessionId; backend resolves the cus_...
  async function openPortal() {
    try {
      setPortalLoading(true);
      const res = await fetch("/api/stripe/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, // this is enough
          returnUrl: `${window.location.origin}/success`,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.url)
        throw new Error(json?.error || "Could not open portal");
      window.location.href = json.url; // avoid popup blockers
    } catch (e: any) {
      alert(e.message || "Something went wrong");
      setPortalLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">You’re all set 🎉</h1>

      {/* Show 5thElement log from /public */}
         <Image
          src="/5thElement-large.jpg"
          alt="5thElement Behavior Consultancy Anil Dagia"
          width={0}
          height={0}
          sizes="50vw"
          style={{ width: '50%', height: 'auto' }}
          priority
        />

      {/* Status / errors */}
      {fetchError && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{fetchError}</p>
      )}
      {!license && !fetchError && (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          Retrieving your license key… If it doesn’t appear in a few seconds, refresh—your webhook might not be configured yet.
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/50 dark:bg-amber-900/20">
        <p className="text-amber-900 dark:text-amber-200 font-medium">
          Important: Copy and store your license key now
        </p>
        <p className="mt-2 text-sm text-amber-800/90 dark:text-amber-200/90">
          For your security, this license key may not be shown again. Please copy it and keep it
          somewhere safe (e.g., your password manager). You’ll need it whenever you reinstall,
          switch devices, or reactivate your plan.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <code
            className="flex-1 truncate rounded-lg bg-black/90 px-3 py-2 font-mono text-sm text-white dark:bg-black"
            title={license || "LICENSE-KEY-GOES-HERE"}
          >
            {license || "LICENSE-KEY-GOES-HERE"}
          </code>
          <button
            onClick={copy}
            disabled={!license}
            className="rounded-xl px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-neutral-300 hover:bg-neutral-50 active:scale-[0.99] disabled:opacity-50 dark:ring-neutral-700 dark:hover:bg-neutral-800"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>

        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-neutral-700 dark:text-neutral-300">
          <li>Store it securely (1Password, Bitwarden, iCloud Keychain, etc.).</li>
          <li>Do not share your key publicly; it’s tied to your account.</li>
          <li>If you lose it, recovery may require manual verification.</li>
        </ul>

        <p className="mt-3 text-xs text-neutral-700 dark:text-neutral-300">
          In ChatGPT → open <b>Discovering Beliefs</b> → when asked, paste this into the <code>X-License-Key</code> prompt.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={openPortal}
          disabled={!sessionId || portalLoading}
          className="rounded-xl border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {portalLoading ? "Opening…" : "Manage billing"}
        </button>

        <a href="/pricing" className="px-1 text-sm underline">
          Back to Pricing
        </a>

        <a href="/" className="px-1 text-sm underline">
          Home
        </a>

        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=License%20Key%20Assistance`}
          className="px-1 text-sm underline"
        >
          Email Support
        </a>
      </div>

      <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
        Need help? Contact{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
          {SUPPORT_EMAIL}
        </a>{" "}
        with your purchase email and order ID.
      </p>
    </main>
  );
}

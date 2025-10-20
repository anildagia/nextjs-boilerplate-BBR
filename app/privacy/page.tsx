// app/privacy/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Discovering Beliefs",
  description:
    "How Discovering Beliefs collects, uses, and protects your data, including checkout, license keys, and library access.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://discovering-beliefs.vercel.app/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 prose prose-slate">
      <h1>Privacy Policy</h1>
      <p><em>Last updated: 10 Oct 2025 (IST)</em></p>

      <p>
        Discovering Beliefs (“we”, “us”) respects your privacy. This page explains what
        we collect, why we collect it, and how we handle your information when you use
        our website, our payment flows, and our GPT integrations.
      </p>

      <h2>Who we are</h2>
      <p>
        Discovering Beliefs is a coaching product by Anil Dagia. For privacy questions,
        contact: <a href="mailto:info@anildagia.com">info@anildagia.com</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Checkout &amp; billing (Stripe)</strong>: When you purchase a plan,
          Stripe collects your name, email, payment method details, and (for INR exports)
          billing address as required by regulations. We do not store card numbers on
          our servers. We receive limited payment status information from Stripe webhooks
          (e.g., subscription state) and store a license key tied to your Stripe customer
          ID.
        </li>
        <li>
          <strong>License keys</strong>: After successful checkout, we issue a license
          key and store it with your Stripe customer record. For support and recovery,
          we save a copy of the license record (customer ID, license key, and, when
          available, email) in our storage.
        </li>
        <li>
          <strong>Feature usage</strong>: Our free endpoints may keep a simple, anonymous
          usage counter (e.g., “5 scans/day”) using an anonymized identifier (like IP
          hash or a client-provided anon ID) to enforce quotas.
        </li>
        <li>
          <strong>Support communications</strong>: If you email us, we receive the email
          address and any information you share.
        </li>
        <li>
          <strong>Server logs</strong>: We may store technical logs (e.g., request time,
          route, status) for reliability and abuse prevention.
        </li>
      </ul>

      <h2>Where we store data</h2>
      <ul>
        <li>
          <strong>Stripe</strong> (payments, subscriptions, customer records).
        </li>
        <li>
          <strong>Vercel</strong> (hosting &amp; logs). Some files like license records
          may be stored in Vercel Blob Storage.
        </li>
      </ul>

      <h2>What the GPT sees</h2>
      <p>
        If you use our Custom GPT, that interaction occurs inside OpenAI’s ChatGPT product.
        The GPT may call our API endpoints to perform scans, generate reframes/action plans,
        fetch libraries, or export a PDF. We only receive the specific fields needed to
        fulfill that request (for example, belief statements or plan text), not your full
        chat history. Your use of ChatGPT is also governed by OpenAI’s terms and privacy
        policies.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To provide and enforce access to Pro features (via license keys).</li>
        <li>To fulfill purchases, manage subscriptions, and comply with billing rules.</li>
        <li>To prevent abuse and enforce fair-use limits on free features.</li>
        <li>To respond to support requests.</li>
        <li>To improve reliability and product quality.</li>
      </ul>

      <h2>Legal basis</h2>
      <p>
        We process data to perform a contract (delivering the service you purchase) and
        for our legitimate interests (security, abuse prevention, product improvement).
        When applicable, we comply with local legal requirements (e.g., Indian export
        regulations requiring name and address for certain transactions).
      </p>

      <h2>Data retention</h2>
      <p>
        We keep customer and billing records as required for accounting and compliance.
        Usage counters are short-lived. Logs are retained for a reasonable period to
        ensure reliability and security.
      </p>

      <h2>Sharing</h2>
      <p>
        We share data with service providers that help us operate the product (e.g., Stripe
        for payments, Vercel for hosting). We do not sell personal data.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>Access or deletion</strong>: Email{" "}
          <a href="mailto:info@anildagia.com">info@anildagia.com</a> with your request.
        </li>
        <li>
          <strong>Billing &amp; cancellation</strong>: Email{" "}
          <a href="mailto:info@anildagia.com">info@anildagia.com</a> with your request.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        We use HTTPS, reputable third-party infrastructure, and safeguard license storage.
        No method is 100% secure; we continually improve protections.
      </p>

      <h2>Children</h2>
      <p>
        The service is not intended for children under 16. If you believe a child has
        provided us personal data, contact us to remove it.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy as our product evolves. We will post updates here and
        change the “Last updated” date.
      </p>

      <hr />
      <p>
        Questions? Email <a href="mailto:info@anildagia.com">info@anildagia.com</a>
      </p>
    </main>
  );
}

// Registers this app's Stripe webhook endpoint on the shared sandbox.
// Usage: node --env-file=.env.local scripts/create-webhook.mjs [--url <https url>] [--dry-run] [--replace]
// Prints the signing secret once on creation, so run it yourself.
import Stripe from "stripe";

const API_VERSION = "2026-10-28.endive";
const DEFAULT_URL = "https://marketplace-ten-silk-78.vercel.app/api/stripe/webhook";
const WEBHOOK_PATH = "/api/stripe/webhook";
const ENDPOINT_LIMIT = 16;
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { url: DEFAULT_URL, dryRun: false, replace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--replace") opts.replace = true;
    else if (a === "--url") {
      const v = argv[++i];
      if (!v) fail("--url needs a value");
      opts.url = v;
    } else fail(`Unknown argument: ${a}`);
  }
  return opts;
}

function validateUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    fail("Invalid --url: not a URL");
  }
  if (u.protocol !== "https:") fail("URL must be https");
  if (u.pathname !== WEBHOOK_PATH || u.search || u.hash) {
    fail(`URL path must be exactly ${WEBHOOK_PATH}`);
  }
  if (u.hostname.endsWith(".vercel.app") && u.hostname.includes("-git-")) {
    fail("Preview deployment URLs are login-protected; use the production URL");
  }
  return u.toString();
}

const { url: rawUrl, dryRun, replace } = parseArgs(process.argv.slice(2));
const url = validateUrl(rawUrl);

const key = process.env.STRIPE_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) {
  fail("STRIPE_SECRET_KEY must be a sk_test_ key (sandbox only). Run with --env-file=.env.local.");
}

const stripe = new Stripe(key, { apiVersion: API_VERSION });

try {
  const all = [];
  for await (const ep of stripe.webhookEndpoints.list({ limit: 100 })) all.push(ep);
  const ours = all.filter((ep) => ep.url === url);

  console.log(`URL: ${url}`);
  console.log(`Webhook endpoints on this account: ${all.length}`);
  console.log(`Matching our URL: ${ours.length}`);
  for (const ep of ours) {
    console.log(`  - ${ep.id} status=${ep.status} enabled_events=${ep.enabled_events.join(",")}`);
  }

  if (dryRun) {
    const steps = [];
    if (ours.length && replace) steps.push(`delete ${ours.map((e) => e.id).join(", ")}`);
    if (ours.length && !replace) steps.push("exit 1: matches exist, re-run with --replace");
    else if (all.length >= ENDPOINT_LIMIT && !ours.length) steps.push("exit 1: endpoint limit reached");
    else steps.push(`create endpoint for ${EVENTS.join(", ")}`);
    console.log(`Dry run, plan: ${steps.join("; ")}`);
    process.exit(0);
  }

  if (ours.length && !replace) {
    fail(
      "An endpoint with this exact URL already exists. Stripe shows the signing secret only at creation, " +
        "so re-run with --replace to delete the endpoint(s) with this exact URL and create a fresh one.",
    );
  }
  if (!ours.length && all.length >= ENDPOINT_LIMIT) {
    fail("webhook endpoint limit reached on this shared account");
  }

  // Delete only exact-URL matches; the sandbox is shared.
  for (const ep of ours) {
    await stripe.webhookEndpoints.del(ep.id);
    console.log(`Deleted ${ep.id}`);
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    // Destination charges are created on the platform account, so their events come from the
    // platform, not from connected accounts.
    connect: false,
    enabled_events: EVENTS,
    api_version: API_VERSION,
    description: `marketplace webhook (${new URL(url).host})`,
    metadata: { app: "marketplace" },
  });

  console.log(`Created endpoint: ${created.id}`);
  console.log(`SIGNING SECRET (shown only once): ${created.secret}`);
  console.log("\nNext steps:");
  console.log("1. Add it as STRIPE_WEBHOOK_SECRET in Vercel -> Production.");
  console.log("2. Add it to .env.local only if you run the production webhook locally (local testing normally uses `stripe listen`).");
  console.log("3. Redeploy.");
} catch (err) {
  console.error(`Stripe error: type=${err?.type} code=${err?.code} message=${err?.message}`);
  process.exit(1);
}

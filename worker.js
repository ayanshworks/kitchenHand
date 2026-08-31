/**
 * Kitchen Hand — cooking service
 *
 * Sits between your GitHub Pages site and the Anthropic API. It holds the API
 * key, and it caps how many questions any one visitor can ask per day.
 *
 * The cap lives here, not in the browser. A limit in the page is only a
 * suggestion — anyone can clear their storage, open a private window, or skip
 * the page entirely and POST straight at this worker. This is the real gate.
 *
 * Setup (the free tier covers all of this):
 *   1. npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler kv namespace create ASK_COUNTS
 *        -> copy the id it prints into wrangler.toml
 *   4. wrangler deploy
 *   5. wrangler secret put ANTHROPIC_API_KEY   (paste your key)
 *   6. wrangler secret put ALLOWED_ORIGIN      (e.g. https://yourname.github.io)
 *
 * Then paste the worker URL into the app's settings panel.
 */

const PER_VISITOR_PER_DAY = 20;
const WHOLE_SITE_PER_DAY = 400; // backstop: caps total spend even under attack
const MAX_TOKENS = 1000;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Expose-Headers": "X-Asks-Remaining, X-Asks-Limit",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Send a POST request." }, 405, cors);

    if (env.ALLOWED_ORIGIN) {
      const from = request.headers.get("Origin");
      if (from && from !== env.ALLOWED_ORIGIN) {
        return json({ error: "Requests from this address are not allowed." }, 403, cors);
      }
    }

    /* ---------------- rate limit ---------------- */

    const day = new Date().toISOString().slice(0, 10);
    const ttl = secondsUntilUtcMidnight();

    // Identify the visitor by IP, but store only a hash of it. Enough to count
    // with, and the worker never keeps a readable list of who visited.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const visitorKey = `v:${day}:${await sha256(ip + (env.HASH_SALT || "kitchen-hand"))}`;
    const siteKey = `site:${day}`;

    const [visitorUsed, siteUsed] = await Promise.all([
      readCount(env, visitorKey),
      readCount(env, siteKey),
    ]);

    if (siteUsed >= WHOLE_SITE_PER_DAY) {
      return json(
        { error: "The kitchen is closed for today — the site hit its daily limit. Try tomorrow." },
        429,
        { ...cors, "X-Asks-Remaining": "0", "X-Asks-Limit": String(PER_VISITOR_PER_DAY) }
      );
    }

    if (visitorUsed >= PER_VISITOR_PER_DAY) {
      return json(
        {
          error: `That's all ${PER_VISITOR_PER_DAY} asks for today. The count resets at midnight UTC.`,
          resetsInSeconds: ttl,
        },
        429,
        { ...cors, "X-Asks-Remaining": "0", "X-Asks-Limit": String(PER_VISITOR_PER_DAY) }
      );
    }

    /* ---------------- validate ---------------- */

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "That request wasn't readable." }, 400, cors);
    }

    const messages = Array.isArray(body.messages) ? body.messages.slice(0, 2) : [];
    if (messages.length === 0) return json({ error: "Nothing to answer." }, 400, cors);

    // Pass through only what the app is meant to set, so nobody can rewrite
    // this into a bigger, costlier, or unrelated request.
    const safe = {
      model: "claude-sonnet-4-6",
      max_tokens: MAX_TOKENS,
      system: typeof body.system === "string" ? body.system.slice(0, 4000) : undefined,
      messages,
    };

    /* ---------------- spend, then call ---------------- */

    // Count the ask before making it. Counting afterwards would let someone
    // fire off a hundred at once before any of them landed.
    const nowUsed = visitorUsed + 1;
    await Promise.all([
      writeCount(env, visitorKey, nowUsed, ttl),
      writeCount(env, siteKey, siteUsed + 1, ttl),
    ]);

    const headers = {
      ...cors,
      "Content-Type": "application/json",
      "X-Asks-Remaining": String(Math.max(0, PER_VISITOR_PER_DAY - nowUsed)),
      "X-Asks-Limit": String(PER_VISITOR_PER_DAY),
    };

    let upstream;
    try {
      upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(safe),
      });
    } catch {
      await refund(env, visitorKey, nowUsed, siteKey, siteUsed + 1, ttl);
      return json({ error: "Couldn't reach the kitchen. Try again." }, 502, cors);
    }

    // Don't charge someone an ask for our own failure.
    if (upstream.status >= 500) {
      await refund(env, visitorKey, nowUsed, siteKey, siteUsed + 1, ttl);
      headers["X-Asks-Remaining"] = String(Math.max(0, PER_VISITOR_PER_DAY - visitorUsed));
    }

    return new Response(await upstream.text(), { status: upstream.status, headers });
  },
};

/* ---------------- helpers ---------------- */

async function readCount(env, key) {
  if (!env.ASK_COUNTS) return 0; // KV not bound — no cap, so bind it before going live
  const v = await env.ASK_COUNTS.get(key);
  return v ? parseInt(v, 10) || 0 : 0;
}

async function writeCount(env, key, value, ttl) {
  if (!env.ASK_COUNTS) return;
  await env.ASK_COUNTS.put(key, String(value), { expirationTtl: Math.max(60, ttl) });
}

async function refund(env, vKey, vVal, sKey, sVal, ttl) {
  await Promise.all([
    writeCount(env, vKey, Math.max(0, vVal - 1), ttl),
    writeCount(env, sKey, Math.max(0, sVal - 1), ttl),
  ]);
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((midnight - now.getTime()) / 1000);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

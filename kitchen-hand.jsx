import React, { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Kitchen Hand — a cooking + kitchen assistant                       */
/* ------------------------------------------------------------------ */

const STATIONS = [
  {
    id: "cook",
    label: "Cook it",
    blurb: "A recipe, start to finish",
    icon: "pot",
    system:
      "The cook is asking how to make something. Give a real, workable recipe with exact amounts and times. Assume a normal home kitchen. If they named no serving size, cook for 2.",
  },
  {
    id: "fix",
    label: "Fix it",
    blurb: "Make a dish taste better",
    icon: "spoon",
    system:
      "The cook has a dish that is not working, or wants to improve one. Diagnose the likely cause first in one line, then give the fix. Be specific about salt, acid, fat, heat and time. Rescue what is already in the pan where possible.",
  },
  {
    id: "learn",
    label: "Learn it",
    blurb: "Technique, explained",
    icon: "flame",
    system:
      "The cook wants to understand a technique or piece of equipment. Explain what to do and why it works, in plain language. Name the sign to look for so they know it is going right. No recipe unless they asked for one.",
  },
  {
    id: "sort",
    label: "Sort it",
    blurb: "Organise the kitchen",
    icon: "shelf",
    system:
      "The cook wants help organising their kitchen: storage, layout, what to keep where, what to throw out, shopping and stocking. Give concrete placement advice, not general tidying philosophy. Keep food safety right.",
  },
  {
    id: "world",
    label: "Around the world",
    blurb: "Famous dishes by country",
    icon: "globe",
    system:
      "The cook wants a well-known dish from a specific country. Cook it the way it is actually cooked there. Name the dish properly, say in one line what it is and when it is eaten, then give the recipe. Where an ingredient is hard to find, name one honest substitute and say what changes.",
  },
];

const COUNTRIES = [
  "Italy", "Mexico", "Japan", "India", "Thailand", "France", "Greece",
  "Spain", "China", "Korea", "Vietnam", "Turkey", "Morocco", "Lebanon",
  "Ethiopia", "Nigeria", "Brazil", "Peru", "Argentina", "Poland",
  "Georgia", "Indonesia", "Philippines", "Jamaica", "USA", "Portugal",
];

const STARTERS = {
  cook: ["A weeknight dinner with chicken thighs", "Bread with no kneading", "Something with three ingredients"],
  fix: ["My curry tastes flat", "My steak keeps coming out grey", "The sauce split"],
  learn: ["How do I hold a knife properly", "What does resting meat actually do", "How hot is a medium pan"],
  sort: ["Where should the spices live", "My fridge is chaos", "Small kitchen, no counter space"],
  world: ["The most-loved home dish", "Something for a party", "Breakfast, the way locals eat it"],
};

/* ---------------------------- storage ----------------------------- */

const mem = new Map();
const store = {
  async get(key) {
    try {
      const r = await window.storage.get(key);
      return r ? JSON.parse(r.value) : null;
    } catch {
      return mem.has(key) ? mem.get(key) : null;
    }
  },
  async set(key, value) {
    mem.set(key, value);
    try {
      await window.storage.set(key, JSON.stringify(value));
    } catch {
      /* falls back to memory for this session */
    }
  },
};

/* ---------------------------- passcode ---------------------------- */

async function hashCode(code, salt) {
  const data = new TextEncoder().encode(`${salt}::${code}`);
  try {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 5381;
    for (const b of data) h = ((h << 5) + h + b) >>> 0;
    return `weak-${h.toString(16)}`;
  }
}

function makeSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------ api ------------------------------- */

const FORMAT = `Reply with one JSON object and nothing else. No markdown fence, no preamble.
{
  "title": "short name for this answer, max 6 words",
  "kind": "recipe" | "advice",
  "intro": "one or two sentences",
  "serves": "e.g. Serves 2 — 35 min, or null",
  "ingredients": ["1 tbsp olive oil", ...] or null,
  "steps": ["...", ...],
  "tips": ["...", ...] or null
}
For "advice", set ingredients and serves to null and put the guidance in steps as short paragraphs.
Be warm and direct. No filler. Keep the whole thing under 400 words.`;

async function askClaude({ station, country, question, image }) {
  const s = STATIONS.find((x) => x.id === station) || STATIONS[0];
  const system = `You are the assistant inside a home-cooking app. ${s.system}${
    station === "world" && country ? ` The country is ${country}.` : ""
  }${image ? " A photo of their food, ingredients or kitchen is attached — read it and refer to what you actually see." : ""}

${FORMAT}`;

  const content = [];
  if (image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  }
  content.push({ type: "text", text: question });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) throw new Error(`The kitchen didn't answer (${res.status}).`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const clean = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed.steps)) parsed.steps = [String(parsed.steps || "")];
    return parsed;
  } catch {
    return { title: "From the kitchen", kind: "advice", intro: "", steps: [text], ingredients: null, tips: null, serves: null };
  }
}

/* ----------------------------- icons ------------------------------ */

function Icon({ name }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    pot: <><path {...p} d="M4 9h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z" /><path {...p} d="M2 9h2M20 9h2M9 6c0-1.5 1.3-2 1.3-3M14 6c0-1.5 1.3-2 1.3-3" /></>,
    spoon: <><path {...p} d="M14 5.5a3.5 4.5 0 1 1-5 4.3L5 20" /></>,
    flame: <><path {...p} d="M12 3c3 3.5 5 6 5 9a5 5 0 0 1-10 0c0-1.6.7-3 2-4.5.4 1.5 1.2 2 2 2 .5-3 .5-4.5 1-6.5Z" /></>,
    shelf: <><path {...p} d="M3 8h18M3 16h18M6 4v4M11 4v4M17 4v4M7 12v4M13 12v4" /></>,
    globe: <><circle {...p} cx="12" cy="12" r="8.5" /><path {...p} d="M3.5 12h17M12 3.5c2.2 2.4 3.2 5.4 3.2 8.5s-1 6.1-3.2 8.5c-2.2-2.4-3.2-5.4-3.2-8.5S9.8 5.9 12 3.5Z" /></>,
    camera: <><path {...p} d="M3 8.5h3.5L8 6.5h8l1.5 2H21v10H3v-10Z" /><circle {...p} cx="12" cy="13" r="3.2" /></>,
    tin: <><path {...p} d="M4 8h16v11H4zM4 8l1.5-3h13L20 8M9 12h6" /></>,
    lock: <><rect {...p} x="5" y="10.5" width="14" height="9.5" rx="1.5" /><path {...p} d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" /></>,
    x: <><path {...p} d="M6 6l12 12M18 6L6 18" /></>,
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">{paths[name]}</svg>;
}

/* ----------------------------- styles ----------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap');

.kh, .kh * { box-sizing: border-box; }
.kh {
  --pine:#10382F; --pine-deep:#08221C; --pine-mid:#19503F;
  --tile:#EDEFE7; --tile-2:#DBE0D0; --tile-3:#C6CEB8;
  --yolk:#E9B23C; --beet:#7A2A3E; --ink:#0C1712;
  font-family:'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
  color:var(--ink); background:var(--pine);
  min-height:100%; width:100%;
  -webkit-font-smoothing:antialiased;
}
.kh-display { font-family:'Bricolage Grotesque','Instrument Sans',sans-serif; font-weight:800; letter-spacing:-0.02em; }
.kh button { font:inherit; color:inherit; cursor:pointer; border:0; background:none; }
.kh :focus-visible { outline:3px solid var(--yolk); outline-offset:2px; }
.kh input, .kh textarea, .kh select { font:inherit; color:inherit; }

.kh-shell { max-width:940px; margin:0 auto; padding:0 14px 90px; }

/* header */
.kh-top { display:flex; align-items:center; gap:12px; padding:20px 2px 16px; color:var(--tile); }
.kh-mark { width:34px; height:34px; border-radius:9px; background:var(--yolk); color:var(--pine-deep);
  display:grid; place-items:center; flex:none; box-shadow:inset 0 -3px 0 rgba(0,0,0,.18); }
.kh-name { font-size:19px; line-height:1; }
.kh-sub { font-size:12.5px; opacity:.62; margin-top:4px; }
.kh-topbtns { margin-left:auto; display:flex; gap:8px; }
.kh-ghost { color:var(--tile); border:1px solid rgba(237,239,231,.28); border-radius:999px;
  padding:7px 14px; font-size:13.5px; font-weight:500; display:flex; align-items:center; gap:7px; }
.kh-ghost:hover { background:rgba(237,239,231,.1); }
.kh-ghost[data-on="true"] { background:var(--tile); color:var(--pine-deep); border-color:var(--tile); }

/* tile wall */
.kh-wall { display:grid; grid-template-columns:repeat(5,1fr); gap:3px;
  background:var(--pine-deep); padding:3px; border-radius:6px; }
@media (max-width:720px){ .kh-wall { grid-template-columns:repeat(2,1fr); } }
.kh-tile { background:var(--tile-2); color:var(--pine-deep); text-align:left;
  padding:14px 13px 13px; min-height:104px; display:flex; flex-direction:column; gap:7px;
  box-shadow:inset 0 -6px 12px -8px rgba(8,34,28,.5), inset 0 1px 0 rgba(255,255,255,.7);
  transition:background .12s ease; }
.kh-tile:hover { background:var(--tile); }
.kh-tile[aria-pressed="true"] { background:var(--yolk); box-shadow:inset 0 -6px 14px -8px rgba(122,42,62,.55), inset 0 1px 0 rgba(255,255,255,.55); }
.kh-tile-l { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:15.5px; line-height:1.15; }
.kh-tile-b { font-size:12.5px; line-height:1.3; opacity:.68; margin-top:auto; }

/* counter (main working surface) */
.kh-counter { background:var(--tile); border-radius:6px; margin-top:14px; padding:18px 18px 16px;
  box-shadow:0 14px 30px -18px rgba(0,0,0,.55); }
.kh-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.kh-chip { background:var(--tile-2); border-radius:999px; padding:6px 12px; font-size:13px;
  border:1px solid rgba(12,23,18,.1); }
.kh-chip:hover { background:var(--tile-3); }
.kh-select { background:var(--tile-2); border:1px solid rgba(12,23,18,.16); border-radius:8px;
  padding:8px 11px; font-size:14px; }
.kh-ta { width:100%; border:1px solid rgba(12,23,18,.18); border-radius:8px; background:#fff;
  padding:12px 13px; font-size:15.5px; line-height:1.45; resize:vertical; min-height:82px; }
.kh-ta::placeholder { color:rgba(12,23,18,.4); }
.kh-ask { background:var(--pine); color:var(--tile); border-radius:999px; padding:11px 22px;
  font-weight:600; font-size:15px; }
.kh-ask:hover { background:var(--pine-mid); }
.kh-ask:disabled { opacity:.45; cursor:not-allowed; }
.kh-attach { display:flex; align-items:center; gap:7px; border:1px dashed rgba(12,23,18,.3);
  border-radius:999px; padding:9px 14px; font-size:13.5px; }
.kh-attach:hover { border-color:var(--pine); background:var(--tile-2); }
.kh-thumb { display:flex; align-items:center; gap:9px; background:var(--tile-2);
  border-radius:999px; padding:5px 6px 5px 5px; font-size:13px; }
.kh-thumb img { width:30px; height:30px; border-radius:999px; object-fit:cover; }

/* recipe card */
.kh-card { background:#fff; border-radius:4px; margin-top:14px; overflow:hidden;
  box-shadow:0 18px 34px -22px rgba(0,0,0,.6); }
.kh-card-h { background:var(--beet); color:var(--tile); padding:16px 20px 14px; }
.kh-card-t { font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:24px; line-height:1.1; }
.kh-card-m { font-size:13px; opacity:.8; margin-top:6px; }
.kh-card-b { padding:18px 20px 20px; }
.kh-intro { font-size:15.5px; line-height:1.55; max-width:62ch; }
.kh-h { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:13.5px;
  color:var(--beet); margin:20px 0 9px; }
.kh-ing { list-style:none; padding:0; margin:0; columns:2; column-gap:26px; }
@media (max-width:600px){ .kh-ing { columns:1; } }
.kh-ing li { font-size:14.5px; line-height:1.5; padding:4px 0 4px 16px; position:relative;
  break-inside:avoid; border-bottom:1px solid rgba(12,23,18,.07); }
.kh-ing li::before { content:''; position:absolute; left:2px; top:12px; width:6px; height:6px;
  background:var(--yolk); border-radius:2px; }
.kh-steps { list-style:none; counter-reset:s; padding:0; margin:0; }
.kh-steps li { counter-increment:s; position:relative; padding:0 0 14px 38px; font-size:15px;
  line-height:1.6; max-width:66ch; }
.kh-steps li::before { content:counter(s); position:absolute; left:0; top:1px; width:25px; height:25px;
  border-radius:999px; background:var(--pine); color:var(--tile); font-size:13px; font-weight:600;
  display:grid; place-items:center; }
.kh-tips { background:var(--tile); border-left:4px solid var(--yolk); border-radius:0 6px 6px 0;
  padding:12px 15px; margin-top:6px; }
.kh-tips p { margin:0 0 8px; font-size:14px; line-height:1.5; }
.kh-tips p:last-child { margin:0; }
.kh-card-f { display:flex; gap:9px; flex-wrap:wrap; padding:14px 20px 18px; border-top:1px solid rgba(12,23,18,.1); }
.kh-save { background:var(--yolk); color:var(--pine-deep); border-radius:999px; padding:9px 18px; font-weight:600; font-size:14px; }
.kh-save:disabled { background:var(--tile-2); color:rgba(12,23,18,.5); }

/* saved list */
.kh-saved { display:grid; gap:10px; margin-top:14px; }
.kh-sitem { background:var(--tile); border-radius:6px; padding:14px 16px; display:flex; gap:12px; align-items:flex-start; }
.kh-sitem h4 { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:16.5px; margin:0; }
.kh-sitem p { margin:5px 0 0; font-size:13.5px; line-height:1.45; opacity:.7; }
.kh-del { margin-left:auto; opacity:.45; padding:4px; border-radius:6px; }
.kh-del:hover { opacity:1; background:rgba(122,42,62,.12); color:var(--beet); }

/* gate */
.kh-gate { max-width:400px; margin:0 auto; padding:60px 16px; color:var(--tile); }
.kh-panel { background:var(--tile); color:var(--ink); border-radius:8px; padding:24px; }
.kh-panel h2 { font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:26px; margin:0 0 6px; letter-spacing:-.02em; }
.kh-panel p { font-size:14.5px; line-height:1.55; margin:0 0 18px; opacity:.75; }
.kh-field { display:block; margin-bottom:14px; }
.kh-field span { display:block; font-size:13px; font-weight:600; margin-bottom:6px; }
.kh-in { width:100%; border:1px solid rgba(12,23,18,.22); border-radius:8px; background:#fff; padding:11px 13px; font-size:15.5px; }
.kh-note { font-size:12.5px; line-height:1.5; opacity:.62; margin-top:16px; }
.kh-err { color:var(--beet); font-size:13.5px; font-weight:500; margin:0 0 12px; }

.kh-empty { color:var(--tile); text-align:center; padding:44px 16px; }
.kh-empty h3 { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:19px; margin:0 0 6px; }
.kh-empty p { font-size:14px; opacity:.62; margin:0; max-width:36ch; margin-inline:auto; line-height:1.5; }

.kh-load { display:flex; align-items:center; gap:11px; color:var(--tile); padding:22px 4px; font-size:14.5px; }
.kh-dot { width:9px; height:9px; border-radius:999px; background:var(--yolk); animation:khp 1s infinite ease-in-out; }
.kh-dot:nth-child(2){ animation-delay:.15s } .kh-dot:nth-child(3){ animation-delay:.3s }
@keyframes khp { 0%,100%{ transform:translateY(0); opacity:.4 } 50%{ transform:translateY(-5px); opacity:1 } }
@media (prefers-reduced-motion:reduce){ .kh-dot{ animation:none } .kh *{ transition:none !important } }
`;

/* --------------------------- gate screen -------------------------- */

function Gate({ profile, onReady }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const creating = !profile;

  const submit = async () => {
    setErr("");
    if (creating && name.trim().length < 1) return setErr("Add a name so the app knows whose tin this is.");
    if (code.length < 4) return setErr("The passcode needs at least 4 characters.");
    setBusy(true);
    if (creating) {
      const salt = makeSalt();
      const hash = await hashCode(code, salt);
      const p = { name: name.trim(), salt, hash, created: Date.now() };
      await store.set("profile", p);
      onReady(p);
    } else {
      const hash = await hashCode(code, profile.salt);
      if (hash !== profile.hash) {
        setBusy(false);
        setCode("");
        return setErr("That passcode doesn't match.");
      }
      onReady(profile);
    }
    setBusy(false);
  };

  return (
    <div className="kh-gate">
      <div className="kh-top" style={{ justifyContent: "center", paddingBottom: 22 }}>
        <div className="kh-mark"><Icon name="pot" /></div>
        <div className="kh-display kh-name" style={{ fontSize: 22 }}>Kitchen Hand</div>
      </div>
      <div className="kh-panel">
        <h2>{creating ? "Set up your tin" : `Welcome back, ${profile.name}`}</h2>
        <p>
          {creating
            ? "Your saved recipes live on this device, behind a passcode."
            : "Enter your passcode to open your saved recipes."}
        </p>
        {err && <p className="kh-err">{err}</p>}
        {creating && (
          <label className="kh-field">
            <span>Your name</span>
            <input className="kh-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam" />
          </label>
        )}
        <label className="kh-field">
          <span>Passcode</span>
          <input
            className="kh-in"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="At least 4 characters"
          />
        </label>
        <button className="kh-ask" style={{ width: "100%" }} onClick={submit} disabled={busy}>
          {busy ? "One moment" : creating ? "Create my tin" : "Unlock"}
        </button>
        <p className="kh-note">
          This lock lives on your device. The passcode is stored as a salted hash, never as text — but
          a device lock is not the same as a real account. Accounts that survive a lost phone, allow
          password resets, and stand up to attackers need a server behind them.
        </p>
      </div>
    </div>
  );
}

/* --------------------------- recipe card -------------------------- */

function Card({ data, onSave, saved }) {
  const isRecipe = data.kind === "recipe" && Array.isArray(data.ingredients) && data.ingredients.length > 0;
  return (
    <article className="kh-card">
      <header className="kh-card-h">
        <h2 className="kh-card-t">{data.title}</h2>
        {data.serves && <div className="kh-card-m">{data.serves}</div>}
      </header>
      <div className="kh-card-b">
        {data.intro && <p className="kh-intro" style={{ margin: 0 }}>{data.intro}</p>}
        {isRecipe && (
          <>
            <h3 className="kh-h">What you need</h3>
            <ul className="kh-ing">{data.ingredients.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
        <h3 className="kh-h">{isRecipe ? "What you do" : "How to go about it"}</h3>
        <ol className="kh-steps">{data.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
        {Array.isArray(data.tips) && data.tips.length > 0 && (
          <>
            <h3 className="kh-h">Worth knowing</h3>
            <div className="kh-tips">{data.tips.map((x, i) => <p key={i}>{x}</p>)}</div>
          </>
        )}
      </div>
      <footer className="kh-card-f">
        <button className="kh-save" onClick={onSave} disabled={saved}>
          {saved ? "Saved to your tin" : "Save to my tin"}
        </button>
      </footer>
    </article>
  );
}

/* ------------------------------ app ------------------------------- */

export default function KitchenHand() {
  const [profile, setProfile] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [booting, setBooting] = useState(true);

  const [tab, setTab] = useState("kitchen");
  const [station, setStation] = useState("cook");
  const [country, setCountry] = useState("Italy");
  const [question, setQuestion] = useState("");
  const [image, setImage] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState([]);
  const [justSaved, setJustSaved] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      const p = await store.get("profile");
      setProfile(p);
      setBooting(false);
    })();
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    (async () => setSaved((await store.get("saved-recipes")) || []))();
  }, [unlocked]);

  const pickImage = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) {
      setError("Photos need to be JPEG, PNG, GIF or WebP.");
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      setImage({ mediaType: f.type, data: String(r.result).split(",")[1], url: String(r.result), name: f.name });
      setError("");
    };
    r.readAsDataURL(f);
    e.target.value = "";
  };

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q && !image) return;
    setBusy(true);
    setError("");
    setAnswer(null);
    setJustSaved(false);
    try {
      const out = await askClaude({
        station,
        country,
        question: q || "Tell me what you see here and what I should do with it.",
        image,
      });
      setAnswer(out);
    } catch (e) {
      setError(e.message || "Something went wrong. Try asking again.");
    }
    setBusy(false);
  }, [question, image, station, country]);

  const save = async () => {
    if (!answer) return;
    const entry = {
      id: `${Date.now()}`,
      title: answer.title,
      intro: answer.intro,
      station,
      country: station === "world" ? country : null,
      data: answer,
      at: new Date().toLocaleDateString(),
    };
    const next = [entry, ...saved];
    setSaved(next);
    setJustSaved(true);
    await store.set("saved-recipes", next);
  };

  const remove = async (id) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    await store.set("saved-recipes", next);
  };

  const current = STATIONS.find((s) => s.id === station);

  if (booting) return <div className="kh"><style>{CSS}</style><div className="kh-load" style={{ justifyContent: "center", paddingTop: 80 }}><span className="kh-dot" /><span className="kh-dot" /><span className="kh-dot" /></div></div>;

  if (!unlocked) {
    return (
      <div className="kh">
        <style>{CSS}</style>
        <Gate profile={profile} onReady={(p) => { setProfile(p); setUnlocked(true); }} />
      </div>
    );
  }

  return (
    <div className="kh">
      <style>{CSS}</style>
      <div className="kh-shell">
        <header className="kh-top">
          <div className="kh-mark"><Icon name="pot" /></div>
          <div>
            <div className="kh-display kh-name">Kitchen Hand</div>
            <div className="kh-sub">{profile?.name}'s kitchen</div>
          </div>
          <div className="kh-topbtns">
            <button className="kh-ghost" data-on={tab === "tin"} onClick={() => setTab(tab === "tin" ? "kitchen" : "tin")}>
              <Icon name="tin" />{saved.length ? `Tin · ${saved.length}` : "My tin"}
            </button>
            <button className="kh-ghost" onClick={() => setUnlocked(false)} aria-label="Lock">
              <Icon name="lock" />
            </button>
          </div>
        </header>

        {tab === "kitchen" ? (
          <>
            <div className="kh-wall" role="group" aria-label="Choose what you need">
              {STATIONS.map((s) => (
                <button
                  key={s.id}
                  className="kh-tile"
                  aria-pressed={station === s.id}
                  onClick={() => { setStation(s.id); setAnswer(null); }}
                >
                  <Icon name={s.icon} />
                  <span className="kh-tile-l">{s.label}</span>
                  <span className="kh-tile-b">{s.blurb}</span>
                </button>
              ))}
            </div>

            <div className="kh-counter">
              {station === "world" && (
                <div className="kh-row" style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 14, fontWeight: 600 }} htmlFor="kh-country">Cooking from</label>
                  <select id="kh-country" className="kh-select" value={country} onChange={(e) => setCountry(e.target.value)}>
                    {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              )}

              <textarea
                className="kh-ta"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }}
                placeholder={
                  station === "world"
                    ? `What do you want to cook from ${country}?`
                    : station === "sort"
                    ? "Describe your kitchen, or what's driving you mad about it."
                    : station === "fix"
                    ? "What did you make, and what's wrong with it?"
                    : station === "learn"
                    ? "What do you want to understand?"
                    : "What are you cooking?"
                }
              />

              <div className="kh-row" style={{ marginTop: 10 }}>
                {STARTERS[station].map((t) => (
                  <button key={t} className="kh-chip" onClick={() => setQuestion(t)}>{t}</button>
                ))}
              </div>

              <div className="kh-row" style={{ marginTop: 14, justifyContent: "space-between" }}>
                {image ? (
                  <span className="kh-thumb">
                    <img src={image.url} alt="" />
                    {image.name.slice(0, 22)}
                    <button onClick={() => setImage(null)} aria-label="Remove photo" style={{ display: "grid", padding: 3 }}>
                      <Icon name="x" />
                    </button>
                  </span>
                ) : (
                  <button className="kh-attach" onClick={() => fileRef.current?.click()}>
                    <Icon name="camera" /> Add a photo
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display: "none" }} />
                <button className="kh-ask" onClick={ask} disabled={busy || (!question.trim() && !image)}>
                  {busy ? "Thinking" : "Ask the kitchen"}
                </button>
              </div>

              {error && <p className="kh-err" style={{ marginTop: 12, marginBottom: 0 }}>{error}</p>}
            </div>

            {busy && (
              <div className="kh-load">
                <span className="kh-dot" /><span className="kh-dot" /><span className="kh-dot" />
                <span style={{ marginLeft: 4 }}>Working on {current.label.toLowerCase()}…</span>
              </div>
            )}

            {answer && !busy && <Card data={answer} onSave={save} saved={justSaved} />}

            {!answer && !busy && (
              <div className="kh-empty">
                <h3>Pick a tile, ask a question</h3>
                <p>Add a photo of what's in the pan, on the shelf, or in the fridge and it'll read that too.</p>
              </div>
            )}
          </>
        ) : (
          <>
            {saved.length === 0 ? (
              <div className="kh-empty" style={{ paddingTop: 70 }}>
                <h3>Your tin is empty</h3>
                <p>Anything you ask for can be saved here. It stays on this device.</p>
              </div>
            ) : (
              <div className="kh-saved">
                {saved.map((s) => (
                  <div key={s.id} className="kh-sitem">
                    <button
                      style={{ textAlign: "left", flex: 1 }}
                      onClick={() => { setAnswer(s.data); setStation(s.station); setJustSaved(true); setTab("kitchen"); }}
                    >
                      <h4>{s.title}</h4>
                      <p>{s.country ? `${s.country} · ` : ""}{s.at}{s.intro ? ` · ${s.intro.slice(0, 70)}…` : ""}</p>
                    </button>
                    <button className="kh-del" onClick={() => remove(s.id)} aria-label={`Delete ${s.title}`}>
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

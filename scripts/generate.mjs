// Generate brand-matched profile SVGs from the portfolio API + GitHub GraphQL.
//
// Reads (all with graceful fallbacks so a first run never hard-fails):
//   nordbye.it/api/v1/{profile,infra,blog}   — identity, live cluster, posts
//   GitHub GraphQL (GITHUB_TOKEN)             — repos, stars, commits, followers
//
// Writes dark + light SVGs into dist/, which the workflow pushes to the
// `output` branch; the README references them via <picture>.
//
// Run locally:  API_BASE=https://nordbye.it GITHUB_TOKEN=$(gh auth token) node scripts/generate.mjs

import { mkdirSync, writeFileSync } from "node:fs";

const API_BASE = process.env.API_BASE ?? "https://nordbye.it";
const GH_USER = process.env.GH_USER ?? "mortennordbye";
const TOKEN = process.env.GITHUB_TOKEN ?? "";
const OUT = process.env.OUT_DIR ?? "dist";

// ── Brand palette (portfolio tokens.css: arctic / aurora) ───────────────────
const DARK = {
  bg: "#0a1015", bg2: "#060a0e", surface: "#111923", line: "#2a3849",
  fg: "#e8eef5", muted: "#b0bccb", faint: "#8898aa",
  accent: "#5db7ff", accent2: "#8b7dff", accent3: "#58d2c9",
  ok: "#58d2c9", warn: "#f0b86e", ink: "#03121f",
};
const LIGHT = {
  bg: "#f6f8fb", bg2: "#eef2f7", surface: "#ecf1f7", line: "#d6dde7",
  fg: "#0d141d", muted: "#364456", faint: "#5e6b7c",
  accent: "#1f6fda", accent2: "#6552d8", accent3: "#2a9d94",
  ok: "#2a9d94", warn: "#b9741f", ink: "#ffffff",
};

const W = 840;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

// ── helpers ─────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function tspan(x, y, s, { size = 14, weight = 400, fill, font = FONT, anchor = "start", opacity = 1 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}">${esc(s)}</text>`;
}

const STYLE = `
  .reveal{animation:rise .7s cubic-bezier(.2,.7,.3,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .bar{transform-box:fill-box;transform-origin:bottom;animation:grow .9s cubic-bezier(.2,.7,.3,1) both}
  @keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
  .skbar{transform-box:fill-box;transform-origin:left;animation:growx 1.1s cubic-bezier(.2,.7,.3,1) both}
  @keyframes growx{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .shimmer{animation:sweep 3.4s ease-in-out infinite}
  @keyframes sweep{0%{transform:translateX(-45%)}50%{transform:translateX(45%)}100%{transform:translateX(-45%)}}
  .pulse{animation:pulse 2.2s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .draw{stroke-dasharray:4000;stroke-dashoffset:4000;animation:draw 2.4s cubic-bezier(.2,.7,.3,1) forwards}
  @keyframes draw{to{stroke-dashoffset:0}}
  .fadein{opacity:0;animation:fadein 1.2s ease-out .5s forwards}
  @keyframes fadein{to{opacity:1}}`;

/** Rounded-rect card chrome with an animated top accent line. */
function card(t, height, inner, { accentBar = true } = {}) {
  const bar = accentBar
    ? `<g clip-path="url(#topclip)">
         <rect x="0" y="0" width="${W}" height="3" fill="url(#accent)"/>
         <rect class="shimmer" x="${W / 2 - 130}" y="0" width="260" height="3" fill="url(#glow)"/>
       </g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img">
  <defs>
    <style>${STYLE}</style>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${t.accent}"/><stop offset="0.5" stop-color="${t.accent2}"/><stop offset="1" stop-color="${t.accent3}"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.75"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="banner" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.bg2}"/><stop offset="0.6" stop-color="${t.surface}"/><stop offset="1" stop-color="${t.bg}"/>
      <animate attributeName="x2" values="1;0.7;1" dur="8s" repeatCount="indefinite"/>
    </linearGradient>
    <clipPath id="topclip"><rect x="0" y="0" width="${W}" height="3"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="14" fill="${t.bg}" stroke="${t.line}"/>
  ${bar}
  <g class="reveal">${inner(t)}</g>
</svg>`;
}

const eyebrow = (x, y, s, t) =>
  tspan(x, y, s.toUpperCase(), { size: 11, weight: 600, fill: t.faint, font: MONO });

function write(name, svg) {
  writeFileSync(`${OUT}/${name}`, svg);
}
function emit(base, height, inner, opts) {
  write(`${base}.svg`, card(LIGHT, height, inner, opts));
  write(`${base}-dark.svg`, card(DARK, height, inner, opts));
}

// ── data fetch ──────────────────────────────────────────────────────────────
async function getJSON(path, fallback) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`! ${path} failed (${e.message}) — using fallback`);
    return fallback;
  }
}

async function ghStats() {
  if (!TOKEN) {
    console.warn("! no GITHUB_TOKEN — stats use placeholders");
    return null;
  }
  // Aggregating stargazerCount over many nodes trips GitHub's GraphQL
  // resource limit, so counts come from GraphQL and stars from REST.
  const auth = { authorization: `bearer ${TOKEN}` };
  const gql = async (query) => {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { login: GH_USER } }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    if (!j?.data?.user) throw new Error(JSON.stringify(j?.errors ?? j));
    return j.data.user;
  };

  try {
    // Counts: light query. Kept separate from the calendar so the calendar's
    // heavier node cost can't trip a resource limit on the whole thing.
    const u = await gql(`query($login:String!){user(login:$login){
      followers{totalCount}
      repositories(ownerAffiliations:OWNER, privacy:PUBLIC){totalCount}
      contributionsCollection{totalCommitContributions}
    }}`);

    // Stars via REST (aggregating stargazerCount in GraphQL trips the limit).
    let stars = null;
    try {
      const rr = await fetch(`https://api.github.com/users/${GH_USER}/repos?per_page=100&type=owner`, {
        headers: { ...auth, accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15000),
      });
      const repos = await rr.json();
      if (Array.isArray(repos)) stars = repos.reduce((a, x) => a + (x.stargazers_count || 0), 0);
    } catch { /* stars stay null */ }

    // Contribution calendar: its own query, and non-fatal if it fails.
    let weekly = [], contributions = null;
    try {
      const c = await gql(`query($login:String!){user(login:$login){
        contributionsCollection{contributionCalendar{
          totalContributions
          weeks{contributionDays{contributionCount}}
        }}
      }}`);
      const cal = c.contributionsCollection.contributionCalendar;
      weekly = cal.weeks.map((w) => w.contributionDays.reduce((a, d) => a + d.contributionCount, 0));
      contributions = cal.totalContributions;
    } catch (e) {
      console.warn(`! contribution calendar failed (${e.message}) — graph skipped`);
    }

    return {
      followers: u.followers.totalCount,
      repos: u.repositories.totalCount,
      commits: u.contributionsCollection.totalCommitContributions,
      contributions,
      weekly,
      stars,
    };
  } catch (e) {
    console.warn(`! GraphQL failed (${e.message}) — stats use placeholders`);
    return null;
  }
}

// ── relative time ─────────────────────────────────────────────────────────
function ago(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// ── cards ─────────────────────────────────────────────────────────────────
function headerCard(profile) {
  const role = profile.role ?? "Cloud Engineer & Architect";
  const loc = profile.location ?? "Oslo, Norway";
  return emit("header", 150, (t) => `
    <rect x="1" y="4" width="${W - 2}" height="142" rx="13" fill="url(#banner)"/>
    ${tspan(40, 66, profile.name ?? "Morten Victor Nordbye", { size: 34, weight: 700, fill: t.fg })}
    ${tspan(42, 98, role, { size: 17, weight: 500, fill: t.accent })}
    ${tspan(42, 122, `${loc}  ·  building and running Azure + Kubernetes platforms`, { size: 13, fill: t.muted })}
    ${eyebrow(42, 34, "learning in public", t)}
  `, { accentBar: false });
}

function infraCard(infra) {
  const live = infra && infra.source !== "snapshot" && infra.generatedAt;
  const nodes = infra?.nodes ?? { ready: 6, total: 6 };
  const sync = infra?.argocd?.sync ?? "Synced";
  const health = infra?.argocd?.health ?? "Healthy";
  const k8s = infra?.versions?.kubernetes ?? "";
  const talos = infra?.versions?.talos ?? "";
  const certDays = infra?.cert?.notAfter
    ? Math.max(0, Math.round((new Date(infra.cert.notAfter) - Date.now()) / 86400000))
    : null;
  const hist = Array.isArray(infra?.history) ? infra.history : [];

  const tiles = [
    ["nodes ready", `${nodes.ready}/${nodes.total}`],
    [`argocd · ${health.toLowerCase()}`, sync],
    ["kubernetes", k8s || "—"],
    ["talos", talos || "—"],
  ];

  return emit("infra", 200, (t) => {
    const dotColor = live ? t.ok : t.warn;
    const status = live ? `live · ${ago(infra.generatedAt)}` : "build-time snapshot";
    const statusW = status.length * 6.6 + 14;
    // 4 tiles across the full width
    const tileW = (W - 80) / tiles.length;
    const tilesSvg = tiles.map(([label, val], i) => {
      const x = 40 + i * tileW;
      return `${tspan(x, 98, val, { size: 18, weight: 700, fill: t.fg, font: MONO })}
        ${eyebrow(x, 118, label, t)}`;
    }).join("");
    // uptime sparkline (last 30 days), left; cert countdown right
    const days = hist.slice(-30);
    const barW = 15;
    const spark = days.map((d, i) => {
      const pct = d.total ? d.ok / d.total : 0;
      const h = 4 + Math.round(pct * 20);
      const x = 40 + i * barW;
      const y = 190 - h;
      const c = pct >= 0.999 ? t.accent3 : pct >= 0.95 ? t.accent : t.warn;
      return `<rect class="bar" style="animation-delay:${i * 25}ms" x="${x}" y="${y}" width="${barW - 3}" height="${h}" rx="1.5" fill="${c}" opacity="0.9"/>`;
    }).join("");
    return `
      ${eyebrow(40, 34, "homelab · genesis cluster", t)}
      <circle class="pulse" cx="${W - 40 - statusW}" cy="30" r="4" fill="${dotColor}"/>
      ${tspan(W - 40, 34, status, { size: 12, fill: t.muted, font: MONO, anchor: "end" })}
      ${tilesSvg}
      <line x1="40" y1="140" x2="${W - 40}" y2="140" stroke="${t.line}"/>
      ${eyebrow(40, 158, "30-day uptime", t)}
      ${spark || tspan(40, 184, "no samples yet", { size: 12, fill: t.faint })}
      ${tspan(W - 40, 158, "cert renews in", { size: 11, weight: 600, fill: t.faint, font: MONO, anchor: "end" })}
      ${tspan(W - 40, 184, certDays == null ? "—" : `${certDays} d`, { size: 18, weight: 700, fill: t.fg, font: MONO, anchor: "end" })}
    `;
  });
}

function blogCard(blog) {
  const posts = (blog?.posts ?? []).slice(0, 3);
  return emit("blog", 176, (t) => {
    const rows = posts.map((p, i) => {
      const y = 74 + i * 34;
      const date = p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 10) : "";
      return `<circle cx="46" cy="${y - 5}" r="3" fill="${t.accent}"/>
        ${tspan(62, y, p.title, { size: 15, weight: 600, fill: t.fg })}
        ${tspan(W - 40, y, date, { size: 12, fill: t.faint, font: MONO, anchor: "end" })}`;
    }).join("");
    return `
      ${eyebrow(40, 40, "latest from the blog", t)}
      ${tspan(W - 40, 40, "blog.nordbye.it", { size: 12, fill: t.accent, font: MONO, anchor: "end" })}
      ${rows || tspan(40, 80, "posts coming soon", { size: 14, fill: t.faint })}
    `;
  });
}

function statsCard(stats) {
  const fmt = (n) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const tiles = [
    ["public repos", fmt(stats?.repos)],
    ["stars", fmt(stats?.stars)],
    ["commits (1y)", fmt(stats?.commits)],
    ["followers", fmt(stats?.followers)],
  ];
  const weekly = stats?.weekly ?? [];

  return emit("stats", 254, (t) => {
    const tileW = (W - 80) / tiles.length;
    const tilesSvg = tiles.map(([label, val], i) => {
      const x = 40 + i * tileW;
      return `${tspan(x, 86, val, { size: 26, weight: 700, fill: t.accent, font: MONO })}
        ${eyebrow(x, 108, label, t)}`;
    }).join("");

    // contribution area chart (weekly totals, last 12 months)
    const x0 = 40, chartW = W - 80, base = 232, chartH = 66;
    const max = Math.max(1, ...weekly);
    const n = weekly.length;
    const pts = weekly.map((v, i) => {
      const x = n <= 1 ? x0 : x0 + (i * chartW) / (n - 1);
      const y = base - (v / max) * chartH;
      return [Math.round(x), Math.round(y)];
    });
    const line = pts.map((p) => p.join(",")).join(" ");
    const area = pts.length
      ? `M${pts[0][0]},${base} L${line.split(" ").join(" L")} L${pts.at(-1)[0]},${base} Z`
      : "";
    const last = pts.at(-1);
    const graph = pts.length
      ? `<defs>
           <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0" stop-color="${t.accent}" stop-opacity="0.34"/>
             <stop offset="1" stop-color="${t.accent}" stop-opacity="0"/>
           </linearGradient>
         </defs>
         <line x1="${x0}" y1="${base}" x2="${x0 + chartW}" y2="${base}" stroke="${t.line}"/>
         <path class="fadein" d="${area}" fill="url(#area)"/>
         <polyline class="draw" points="${line}" fill="none" stroke="url(#accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
         <circle class="pulse" cx="${last[0]}" cy="${last[1]}" r="3.5" fill="${t.accent3}"/>`
      : tspan(x0, base - 20, "contribution history unavailable", { size: 12, fill: t.faint });

    return `
      ${eyebrow(40, 40, "github activity", t)}
      ${tilesSvg}
      <line x1="40" y1="130" x2="${W - 40}" y2="130" stroke="${t.line}"/>
      ${eyebrow(40, 152, "contributions · last 12 months", t)}
      ${tspan(W - 40, 152, `${fmt(stats?.contributions)} total`, { size: 12, weight: 600, fill: t.muted, font: MONO, anchor: "end" })}
      ${graph}
    `;
  });
}

function chipsRow(items, t, x0, y, { fill, stroke, textFill, size = 12, padX = 12, gap = 8, maxW = W - 80 }) {
  let x = x0, row = y;
  const out = [];
  for (const label of items) {
    const w = Math.round(label.length * size * 0.62) + padX * 2;
    if (x + w > x0 + maxW) { x = x0; row += 30; }
    out.push(`<rect x="${x}" y="${row - 16}" width="${w}" height="24" rx="12" fill="${fill}" stroke="${stroke}"/>
      ${tspan(x + w / 2, row + 1, label, { size, weight: 500, fill: textFill, anchor: "middle" })}`);
    x += w + gap;
  }
  return { svg: out.join(""), bottom: row + 14 };
}

function certsCard(profile) {
  const certs = (profile.certifications ?? []).map((c) =>
    c.title.replace(/^Microsoft Certified:\s*/, "").replace(/Certified\s+/i, ""));
  return emit("certs", 150, (t) => {
    const { svg } = chipsRow(certs, t, 40, 74, {
      fill: t.surface, stroke: t.line, textFill: t.fg,
    });
    return `${eyebrow(40, 40, "certifications", t)}${svg}`;
  });
}

// Curated tech stack → simple-icons slug. Icons are real brand marks.
const TECH = [
  ["Linux", "linux"], ["Kubernetes", "kubernetes"], ["Docker", "docker"],
  ["Terraform", "terraform"], ["Ansible", "ansible"], ["Azure", "microsoftazure"],
  ["AWS", "amazonwebservices"], ["Argo CD", "argo"], ["Helm", "helm"],
  ["Prometheus", "prometheus"], ["Grafana", "grafana"], ["GitHub Actions", "githubactions"],
];

// Fallback marks for icons simple-icons dropped (e.g. Microsoft's trademark
// removal of the Azure logo). Path is the 24x24 simple-icons glyph.
const ICON_FALLBACK = {
  microsoftazure: {
    hex: "0078D4",
    path: "M22.379 23.343a1.62 1.62 0 0 0 1.536-2.14v.002L17.35 1.76A1.62 1.62 0 0 0 15.816.657H8.184A1.62 1.62 0 0 0 6.65 1.76L.086 21.204a1.62 1.62 0 0 0 1.536 2.139h4.741a1.62 1.62 0 0 0 1.535-1.103l.977-2.892 4.947 3.675c.28.208.618.32.966.32m-3.084-12.531 3.624 10.739a.54.54 0 0 1-.51.713v-.001h-.03a.54.54 0 0 1-.322-.106l-9.287-6.9h4.853m6.313 7.006c.116-.326.13-.694.007-1.058L9.79 1.76a1.722 1.722 0 0 0-.007-.02h6.034a.54.54 0 0 1 .512.366l6.562 19.445a.54.54 0 0 1-.338.684",
  },
};

function luminance(hex) {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

async function loadSI() {
  try { return await import("simple-icons"); }
  catch { console.warn("! simple-icons missing — brand icons skipped"); return null; }
}
function iconFor(si, slug) {
  if (!slug) return null;
  const key = "si" + slug[0].toUpperCase() + slug.slice(1);
  return si?.[key] ?? ICON_FALLBACK[slug] ?? null;
}
function iconFill(t, hex) {
  return luminance(hex) < 0.24 ? t.fg : luminance(hex) > 0.92 ? t.muted : `#${hex}`;
}

function stackCard(si) {
  const items = TECH.map(([label, slug]) => {
    const ic = iconFor(si, slug);
    return ic ? { label, hex: ic.hex, path: ic.path } : { label, hex: null, path: null };
  });

  // flow layout, wrapping
  const iconBox = 22, gap = 10, itemGap = 24, x0 = 40, maxW = W - 80;
  const est = (label) => iconBox + 8 + label.length * 8 + itemGap;
  let rows = 1, x = x0;
  for (const it of items) { const w = est(it.label); if (x + w > x0 + maxW) { rows++; x = x0; } x += w; }
  const rowH = 42;
  const height = 70 + rows * rowH;

  emit("stack", height, (t) => {
    let cx = x0, cy = 74, i = 0;
    const parts = items.map((it) => {
      const w = est(it.label);
      if (cx + w > x0 + maxW) { cx = x0; cy += rowH; }
      const fill = it.hex ? iconFill(t, it.hex) : t.accent;
      // Position with the SVG transform attribute only. A CSS transform (from
      // an animation class) would override it and collapse icons to the origin.
      const iconSvg = it.path
        ? `<g transform="translate(${cx},${cy - iconBox + 4}) scale(${iconBox / 24})"><path d="${it.path}" fill="${fill}"/></g>`
        : `<rect x="${cx}" y="${cy - iconBox + 4}" width="${iconBox}" height="${iconBox}" rx="5" fill="${fill}" opacity="0.18"/>
           ${tspan(cx + iconBox / 2, cy - 2, it.label.slice(0, 2), { size: 10, weight: 700, fill, anchor: "middle" })}`;
      const text = tspan(cx + iconBox + 8, cy, it.label, { size: 14, weight: 500, fill: t.fg });
      cx += w; i++;
      return iconSvg + text;
    }).join("");
    return `${eyebrow(40, 40, "core stack", t)}${parts}`;
  });
}

// Animated GitOps delivery pipeline + the live last-deploy status.
function deliveryCard(infra, si) {
  const stages = [
    { label: "git push", slug: "git" },
    { label: "Actions", slug: "githubactions" },
    { label: "GHCR", slug: "github" },
    { label: "ArgoCD", slug: "argo" },
    { label: "Talos", slug: null },
  ];
  const live = infra && infra.source !== "snapshot" && infra.generatedAt;
  const build = infra?.build, deployedAt = infra?.deployedAt;
  const sync = infra?.argocd?.sync, health = infra?.argocd?.health;

  emit("delivery", 170, (t) => {
    const n = stages.length, cy = 84, m = 18;
    const nx = (i) => 40 + m + (i * (W - 80 - 2 * m)) / (n - 1);
    const line = `<line x1="${nx(0)}" y1="${cy}" x2="${nx(n - 1)}" y2="${cy}" stroke="${t.line}" stroke-width="2"/>`;
    // pulses flowing through the pipeline (SMIL, so it plays on GitHub)
    const dots = [0, 1, 2].map((k) =>
      `<circle r="3.5" cy="${cy}" fill="${t.accent}">
        <animate attributeName="cx" values="${nx(0)};${nx(n - 1)}" dur="3s" begin="${k}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;1;1;0" dur="3s" begin="${k}s" repeatCount="indefinite"/>
      </circle>`).join("");
    const nodes = stages.map((s, i) => {
      const x = nx(i), ic = iconFor(si, s.slug);
      const glyph = ic
        ? `<g transform="translate(${x - 9},${cy - 9}) scale(0.75)"><path d="${ic.path}" fill="${iconFill(t, ic.hex)}"/></g>`
        : `<g transform="translate(${x - 8},${cy - 8})"><rect y="0" width="16" height="4" rx="1" fill="${t.fg}"/><rect y="6" width="16" height="4" rx="1" fill="${t.fg}"/><rect y="12" width="16" height="4" rx="1" fill="${t.fg}"/></g>`;
      return `<circle cx="${x}" cy="${cy}" r="18" fill="${t.surface}" stroke="${t.line}"/>${glyph}
        ${tspan(x, cy + 38, s.label, { size: 12, weight: 500, fill: t.fg, anchor: "middle" })}`;
    }).join("");
    const status = live ? `live · ${ago(infra.generatedAt)}` : "snapshot";
    const statusW = status.length * 6.6 + 14;
    const deploy = `build ${build ?? "—"} · deployed ${ago(deployedAt) || "—"} · ArgoCD ${sync ?? "—"}${health ? " · " + health : ""}`;
    return `
      ${eyebrow(40, 34, "gitops delivery", t)}
      <circle class="pulse" cx="${W - 40 - statusW}" cy="30" r="4" fill="${live ? t.ok : t.warn}"/>
      ${tspan(W - 40, 34, status, { size: 12, fill: t.muted, font: MONO, anchor: "end" })}
      ${line}${dots}${nodes}
      <line x1="40" y1="132" x2="${W - 40}" y2="132" stroke="${t.line}"/>
      ${tspan(40, 154, deploy, { size: 12.5, fill: t.muted, font: MONO })}
    `;
  });
}

// Curated public OSS contributions (work/customer repos are deliberately
// excluded — the portfolio anonymizes those). Star counts fetched live.
const STAR = "M8 .6l2.2 4.6 5.1.5-3.8 3.4 1.1 5L8 12.9 3.4 15l1.1-5L.7 5.7l5.1-.5z";
const OSS = [
  { repo: "traefik/traefik", note: "Gateway API: multi-cert listeners (v3.7.0)" },
  { repo: "nunocoracao/blowfish", note: "Hugo theme that powers my blog" },
  { repo: "FidelusAleksander/ghcertified", note: "GitHub certification practice tool" },
];
async function ossRepos() {
  const auth = TOKEN ? { authorization: `bearer ${TOKEN}` } : {};
  return Promise.all(OSS.map(async (o) => {
    try {
      const r = await fetch(`https://api.github.com/repos/${o.repo}`, {
        headers: { ...auth, accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      return { ...o, stars: typeof j.stargazers_count === "number" ? j.stargazers_count : null };
    } catch { return { ...o, stars: null }; }
  }));
}
function openSourceCard(oss) {
  const rowH = 44;
  const fmt = (n) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  emit("oss", 78 + oss.length * rowH, (t) => {
    const rows = oss.map((o, i) => {
      const y = 86 + i * rowH;
      const divider = i < oss.length - 1
        ? `<line x1="40" y1="${y + 26}" x2="${W - 40}" y2="${y + 26}" stroke="${t.line}"/>` : "";
      return `
        ${tspan(40, y, o.repo, { size: 15, weight: 600, fill: t.accent, font: MONO })}
        ${tspan(40, y + 18, o.note, { size: 12.5, fill: t.muted })}
        <g transform="translate(${W - 114},${y - 13})"><path d="${STAR}" fill="${t.accent3}"/></g>
        ${tspan(W - 40, y - 1, fmt(o.stars), { size: 15, weight: 700, fill: t.fg, font: MONO, anchor: "end" })}
        ${divider}`;
    }).join("");
    return `${eyebrow(40, 40, "open source · merged contributions", t)}${rows}`;
  });
}

// Lighthouse scores for nordbye.it, measured weekly by the homelab's Lighthouse
// CI workflow (on real GitHub runners) and published to its lighthouse-data
// branch. Fetched here so the card refreshes on its own.
async function getLighthouse() {
  const url = "https://raw.githubusercontent.com/mortennordbye/homelab/lighthouse-data/lighthouse.json";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`! lighthouse.json failed (${e.message}) — card uses placeholders`);
    return null;
  }
}

// Four score rings (Lighthouse's own colour convention: green >=90, amber
// 50-89, red <50). Arcs are static so the score is always visible (a drawn-in
// SMIL sweep would leave the ring empty for static/reduced-motion renders); the
// card's reveal handles motion.
function lighthouseCard(lh) {
  const label = (u) => (u || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  // New shape: { generatedAt, sites: [{url, performance, ...}] }. Fall back to
  // the old single-site shape, then to placeholders for both sites.
  const sites = lh?.sites?.length
    ? lh.sites
    : lh?.performance != null
      ? [lh]
      : [{ url: "https://nordbye.it/" }, { url: "https://blog.nordbye.it/" }];

  const cols = [
    ["Performance", "performance"],
    ["Accessibility", "accessibility"],
    ["Best Practices", "bestPractices"],
    ["SEO", "seo"],
  ];
  const top = 78, rowH = 60;
  const height = top + sites.length * rowH;

  return emit("lighthouse", height, (t) => {
    const scoreColor = (v) =>
      v == null ? t.faint : v >= 90 ? t.accent3 : v >= 50 ? t.warn : "#e5484d";
    const x0 = 190, r = 22, C = 2 * Math.PI * r;
    const slot = (W - 40 - x0) / cols.length;
    const colX = (i) => Math.round(x0 + slot * i + slot / 2);

    const headers = cols.map(([lab], i) =>
      tspan(colX(i), 58, lab.toUpperCase(), { size: 11, weight: 600, fill: t.faint, font: MONO, anchor: "middle" })
    ).join("");

    const rows = sites.map((s, ri) => {
      const cy = top + ri * rowH + 20;
      const rings = cols.map(([, key], i) => {
        const v = s[key];
        const cx = colX(i);
        const c = scoreColor(v);
        const arc = C * ((v ?? 0) / 100);
        return `
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.line}" stroke-width="5"/>
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="5"
            stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${C.toFixed(2)}"
            transform="rotate(-90 ${cx} ${cy})"/>
          ${tspan(cx, cy + 5, v == null ? "—" : `${v}`, { size: 16, weight: 700, fill: t.fg, anchor: "middle", font: MONO })}`;
      }).join("");
      return `${tspan(40, cy + 5, label(s.url), { size: 14, weight: 600, fill: t.fg })}${rings}`;
    }).join("");

    const stamp = lh?.generatedAt ? `measured ${ago(lh.generatedAt)}` : "measured on GitHub CI";
    return `
      ${eyebrow(40, 34, "lighthouse", t)}
      ${tspan(W - 40, 34, stamp, { size: 12, fill: t.muted, font: MONO, anchor: "end" })}
      ${headers}
      ${rows}`;
  });
}

// ── main ────────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });

const si = await loadSI();
const [profile, infra, blog, stats, oss, lighthouse] = await Promise.all([
  getJSON("/api/v1/profile", { name: "Morten Victor Nordbye" }),
  getJSON("/api/v1/infra", { source: "snapshot", nodes: { ready: 6, total: 6 } }),
  getJSON("/api/v1/blog", { posts: [] }),
  ghStats(),
  ossRepos(),
  getLighthouse(),
]);

headerCard(profile);
infraCard(infra);
deliveryCard(infra, si);
statsCard(stats);
lighthouseCard(lighthouse);
blogCard(blog);
openSourceCard(oss);
certsCard(profile);
stackCard(si);

console.log(`✓ wrote SVGs to ${OUT}/ (header, infra, delivery, stats, lighthouse, blog, oss, certs, stack ×2 themes)`);

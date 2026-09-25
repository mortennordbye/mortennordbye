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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import subsetFont from "subset-font";

const API_BASE = process.env.API_BASE ?? "https://nordbye.it";
const GH_USER = process.env.GH_USER ?? "mortennordbye";
const TOKEN = process.env.GITHUB_TOKEN ?? "";
const OUT = process.env.OUT_DIR ?? "dist";

// ── The Study (portfolio src/styles/tokens.css, spec at nordbye.it/brand) ───
// Four materials: near-black ground, dark oak, brass, warm paper. Green is the
// forest outside the window: one lit point per card (the live dot), never a
// surface, a border or a glow. The site is dark-only, so there is one image per
// card and no light variant. No <picture> in the README either: GitHub closes
// the <a> before a <picture>'s <img>, which leaves the link dead.
const T = {
  bg: "#0f1410", bg2: "#090c0a", surface: "#191f1a", line: "#2a382c",
  fg: "#e9ebe9", fg2: "#a1ada3", fg3: "#708373",
  wood: "#4a3520", brass: "#7f5a2f", brassHi: "#8a6133", copper: "#c09955",
  paper: "#e8ddc9", paper2: "#d9cbb2", paper3: "#cabb9f",
  ink: "#3a2e1d", ink2: "#574733", ink3: "#62523c",
  lit: "#65a16e", warn: "#c09955", danger: "#d18e83",
};

const W = 840;
// No sans anywhere: Source Serif 4 for words and figures, Fragment Mono for
// labels. Embedded because an SVG behind GitHub's image proxy cannot fetch fonts.
const SERIF = "'Source Serif 4',Georgia,'Times New Roman',serif";
const MONO = "'Fragment Mono',ui-monospace,Menlo,Consolas,monospace";
const asset = (p) => readFileSync(new URL(`../assets/${p}`, import.meta.url)).toString("base64");
// Each SVG gets the two faces cut down to the glyphs its own text uses, filled
// in at write time. The whole faces in every cell would be ~40 KB an image.
const FONTS = "/*fonts*/";
const FACES = [
  ["Source Serif 4", readFileSync(new URL("../assets/fonts/SourceSerif4-Regular.woff2", import.meta.url))],
  ["Fragment Mono", readFileSync(new URL("../assets/fonts/FragmentMono-Regular.woff2", import.meta.url))],
];

// ── helpers ─────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function tspan(x, y, s, { size = 14, fill = T.fg, font = SERIF, anchor = "start", spacing = 0, opacity = 1 } = {}) {
  const ls = spacing ? ` letter-spacing="${spacing}"` : "";
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}"${ls}>${esc(s)}</text>`;
}

// Motion stays calm: things settle into place once, nothing loops but the one
// slow dot on the delivery line.
const STYLE = `${FONTS}
  .reveal{animation:rise 1.2s cubic-bezier(.16,1,.3,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  .bar{transform-box:fill-box;transform-origin:bottom;animation:grow 1s cubic-bezier(.2,.7,.3,1) both}
  @keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
  .draw{stroke-dasharray:4000;stroke-dashoffset:4000;animation:draw 2.6s cubic-bezier(.2,.7,.3,1) forwards}
  @keyframes draw{to{stroke-dashoffset:0}}
  .fadein{opacity:0;animation:fadein 1.4s ease-out .6s forwards}
  @keyframes fadein{to{opacity:1}}`;

const RULE = `<linearGradient id="rule" gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="${W - 40}" y2="0">
      <stop offset="0" stop-color="${T.brassHi}" stop-opacity="0.7"/><stop offset="1" stop-color="${T.brass}" stop-opacity="0"/>
    </linearGradient>`;

/** A panel in the study: ground, a brass edge, and the lamp's highlight along the top. */
function card(height, inner, delay = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img">
  <defs>
    <style>${STYLE}</style>
    <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${T.surface}"/><stop offset="0.55" stop-color="${T.bg}"/><stop offset="1" stop-color="${T.bg2}"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${T.brassHi}" stop-opacity="0.8"/><stop offset="1" stop-color="${T.brass}" stop-opacity="0.2"/>
    </linearGradient>
    ${RULE}
    <linearGradient id="lamp" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${T.copper}" stop-opacity="0"/><stop offset="0.3" stop-color="${T.copper}" stop-opacity="0.35"/><stop offset="1" stop-color="${T.copper}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="10" fill="url(#ground)" stroke="url(#edge)"/>
  <line x1="24" y1="1" x2="${W - 24}" y2="1" stroke="url(#lamp)"/>
  <g class="reveal" style="animation-delay:${delay}ms">${inner}</g>
</svg>`;
}

/** Section label with a brass rule running out to the right edge. */
const eyebrow = (x, y, s, { right = "" } = {}) => `
  ${tspan(x, y, s.toUpperCase(), { size: 11, fill: T.copper, font: MONO, spacing: 1.6 })}
  ${right}
  <line x1="${x}" y1="${y + 14}" x2="${W - 40}" y2="${y + 14}" stroke="url(#rule)"/>`;

const label = (x, y, s, opts = {}) =>
  tspan(x, y, s.toUpperCase(), { size: 10.5, fill: T.fg3, font: MONO, spacing: 1.2, ...opts });

/** The one green in a card: a small lit point beside a status line. */
function status(text, live) {
  const w = text.length * 6.6 + 14;
  return `<circle cx="${W - 40 - w}" cy="32" r="3.5" fill="${live ? T.lit : T.warn}"/>
    ${tspan(W - 40, 36, text, { size: 11.5, fill: T.fg2, font: MONO, anchor: "end" })}`;
}

const pending = [];
function write(name, svg) {
  pending.push([name, svg]);
}

const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const subsets = new Map();
/** @font-face rules for exactly the characters in this SVG's <text> elements. */
async function facesFor(svg) {
  const chars = [...new Set(unesc([...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join("")))].sort().join("");
  if (!chars) return "";
  if (!subsets.has(chars)) {
    subsets.set(chars, Promise.all(FACES.map(async ([family, font]) => {
      const woff2 = await subsetFont(font, chars, { targetFormat: "woff2" });
      return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${woff2.toString("base64")}) format('woff2')}`;
    })).then((rules) => rules.join("")));
  }
  return subsets.get(chars);
}

async function flush() {
  for (const [name, svg] of pending) {
    writeFileSync(`${OUT}/${name}`, svg.replace(FONTS, await facesFor(svg)));
  }
}
function emit(base, height, inner) {
  write(`${base}.svg`, card(height, inner));
}

// ── the panel ───────────────────────────────────────────────────────────────
// Everything below the prose is one panel cut into slices. Each slice is its
// own image floated left (align="left"), which GitHub stacks flush where inline
// images would leave a gap, so a slice can carry its own link and still read as
// part of one box. Widths are shares of W, so every slice scales by the same
// factor and the seams line up.
const RAW = `https://raw.githubusercontent.com/${GH_USER}/${GH_USER}/output`;
const link = (href, inner) => `<a href="${esc(href)}">${inner}</a>`;
const HOMELAB = "https://github.com/mortennordbye/Homelab";
const PANEL = [];
const R = 10;

/** Ground plus only the edges of the panel this slice sits on. */
function frame(w, h, { l = true, r = true, top = false, bottom = false }) {
  const tl = top && l, tr = top && r, bl = bottom && l, br = bottom && r;
  const arc = (x, y) => `A${R},${R} 0 0 1 ${x},${y}`;
  const fill = `M${tl ? R : 0},0 H${tr ? w - R : w} ${tr ? arc(w, R) : ""} V${br ? h - R : h} ${br ? arc(w - R, h) : ""} H${bl ? R : 0} ${bl ? arc(0, h - R) : ""} V${tl ? R : 0} ${tl ? arc(R, 0) : ""} Z`;
  const q = R - 0.5, e = [];
  if (l) e.push(`M0.5,${tl ? R : 0} V${bl ? h - R : h}`);
  if (r) e.push(`M${w - 0.5},${tr ? R : 0} V${br ? h - R : h}`);
  if (top) e.push(`M${tl ? R : 0},0.5 H${tr ? w - R : w}`);
  if (bottom) e.push(`M${bl ? R : 0},${h - 0.5} H${br ? w - R : w}`);
  if (tl) e.push(`M0.5,${R} A${q},${q} 0 0 1 ${R},0.5`);
  if (tr) e.push(`M${w - R},0.5 A${q},${q} 0 0 1 ${w - 0.5},${R}`);
  if (br) e.push(`M${w - 0.5},${h - R} A${q},${q} 0 0 1 ${w - R},${h - 0.5}`);
  if (bl) e.push(`M${R},${h - 0.5} A${q},${q} 0 0 1 0.5,${h - R}`);
  return `<path d="${fill}" fill="${T.bg}"/><path d="${e.join(" ")}" fill="none" stroke="${T.brass}" stroke-opacity="0.6"/>`;
}

/** Write one slice and queue its README tag. `divide` draws the hairline that separates sections. */
function part(name, w, h, inner, { href = null, alt = "", defs = "", delay = 0, divide = false, ...edges } = {}) {
  write(`${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
  <defs><style>${STYLE}</style>${RULE}${defs}</defs>
  ${frame(w, h, edges)}
  ${divide ? `<line x1="40" y1="0.5" x2="${W - 40}" y2="0.5" stroke="${T.line}"/>` : ""}
  <g class="reveal" style="animation-delay:${delay}ms">${inner}</g>
</svg>`);
  const tag = `<img src="${RAW}/${name}.svg" alt="${esc(alt)}" width="${((w / W) * 100).toFixed(4)}%" align="left" />`;
  PANEL.push(href ? link(href, tag) : tag);
}

/**
 * A section drawn once at full width and cut into cells, each an image of its
 * own window (viewBox) onto the same drawing, so every cell can open its own
 * page. `bands` run top to bottom and their heights must sum to `h`; each band
 * is one full-width cell or a row of cells whose widths sum to W. Two split
 * bands in a row need a thin full-width band between them, for the same
 * float reason as the cert rows. `inner` may be a function of the cell's
 * window, to leave out what that cell cannot show.
 */
function cut(name, h, inner, bands, { defs = "", delay = 0, divide = false, ...edges } = {}) {
  const body = (win) => `${frame(W, h, edges)}
  ${divide ? `<line x1="40" y1="0.5" x2="${W - 40}" y2="0.5" stroke="${T.line}"/>` : ""}
  <g class="reveal" style="animation-delay:${delay}ms">${typeof inner === "function" ? inner(win) : inner}</g>`;
  let y = 0, n = 0;
  for (const band of bands) {
    let x = 0;
    for (const c of band.cells ?? [{ w: W, href: band.href, alt: band.alt }]) {
      const id = `${name}-${++n}`;
      write(`${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${c.w}" height="${band.h}" viewBox="${x} ${y} ${c.w} ${band.h}" role="img">
  <defs><style>${STYLE}</style>${RULE}${defs}</defs>
  ${body({ x, y, w: c.w, h: band.h })}
</svg>`);
      const tag = `<img src="${RAW}/${id}.svg" alt="${esc(c.alt ?? "")}" width="${((c.w / W) * 100).toFixed(4)}%" align="left" />`;
      PANEL.push(c.href ? link(c.href, tag) : tag);
      x += c.w;
    }
    y += band.h;
  }
  if (y !== h) throw new Error(`${name}: bands sum to ${y}, not ${h}`);
}

/** The label that opens a clickable group, as its own slice. */
function groupHead(name, text, right, opts) {
  part(name, W, 62, eyebrow(40, 38, text, {
    right: right ? tspan(W - 40, 38, right, { size: 11.5, fill: T.fg2, font: MONO, anchor: "end" }) : "",
  }), { divide: true, ...opts });
}

const PAPER = `<linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${T.paper}"/><stop offset="1" stop-color="${T.paper2}"/>
  </linearGradient>`;

// ── nav link badges ─────────────────────────────────────────────────────────
// GitHub renders markdown links in its own accent blue and strips any CSS from
// a README, so the only way to get the nav row onto the brand palette is to
// ship each link as an image. One small SVG per link, each wrapped in its own
// <a> in the README, so every badge keeps its own href.
const NAV = [
  ["nordbye.it", "nav-site"],
  ["blog.nordbye.it", "nav-blog"],
  ["Homelab repo", "nav-repo"],
  ["LinkedIn", "nav-linkedin"],
  ["Email", "nav-email"],
];

function navBadges() {
  const mono = `<style>${FONTS}</style>`;
  for (const [text, base] of NAV) {
    // Fragment Mono advances 0.6em, plus the letter-spacing, plus padding.
    const w = Math.round(text.length * (12 * 0.6 + 0.6) + 32);
    const h = 30;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(text)}">` +
      `<defs>${mono}</defs>` +
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="7" fill="${T.wood}" stroke="${T.brassHi}" stroke-opacity="0.7"/>` +
      tspan(w / 2, h / 2 + 4, text, { size: 12, fill: T.fg, font: MONO, anchor: "middle", spacing: 0.6 }) +
      `</svg>`;
    write(`${base}.svg`, svg);
  }
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


const fmt = (n) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

// ── cards ─────────────────────────────────────────────────────────────────
function headerCard(profile) {
  const role = profile.role ?? "Cloud Engineer & Architect";
  const loc = profile.location ?? "Oslo, Norway";
  return emit("header", 168, `
    ${tspan(40, 44, "NORDBYE.IT  ·  THE STUDY", { size: 11, fill: T.copper, font: MONO, spacing: 1.6 })}
    ${tspan(38, 96, profile.name ?? "Morten Victor Nordbye", { size: 42, fill: T.fg })}
    <line x1="40" y1="116" x2="176" y2="116" stroke="${T.brassHi}"/>
    ${tspan(40, 144, `${role}  ·  ${loc}  ·  Azure and Kubernetes platforms`, { size: 16, fill: T.fg2 })}
  `);
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

  const tileW = (W - 80) / tiles.length;
  const tilesSvg = tiles.map(([l, val], i) => {
    const x = 40 + i * tileW;
    return `${tspan(x, 102, val, { size: 26, fill: T.fg })}${label(x, 124, l)}`;
  }).join("");
  const days = hist.slice(-30);
  const barW = 15;
  const spark = days.map((d, i) => {
    const pct = d.total ? d.ok / d.total : 0;
    const h = 4 + Math.round(pct * 20);
    const c = pct >= 0.999 ? T.copper : pct >= 0.95 ? T.brassHi : T.danger;
    return `<rect class="bar" style="animation-delay:${i * 25}ms" x="${40 + i * barW}" y="${196 - h}" width="${barW - 4}" height="${h}" rx="1" fill="${c}"/>`;
  }).join("");
  cut("infra", 216, `
    ${eyebrow(40, 36, "homelab · genesis cluster", { right: status(live ? `live · ${ago(infra.generatedAt)}` : "build-time snapshot", live) })}
    ${tilesSvg}
    <line x1="40" y1="146" x2="${W - 40}" y2="146" stroke="${T.line}"/>
    ${label(40, 166, "30-day uptime")}
    ${spark || tspan(40, 192, "no samples yet", { size: 13, fill: T.fg3 })}
    ${label(W - 40, 166, "cert renews in", { anchor: "end" })}
    ${tspan(W - 40, 196, certDays == null ? "—" : `${certDays} days`, { size: 22, fill: T.fg, anchor: "end" })}
  `, [
    { h: 58, href: HOMELAB, alt: "Homelab, Genesis cluster: live status" },
    { h: 82, cells: [
      { w: 220, href: `${HOMELAB}/tree/main/terraform/proxmox/hyper-cluster/k8s`, alt: `${nodes.ready} of ${nodes.total} nodes ready` },
      { w: 190, href: `${HOMELAB}/tree/main/k8s/talos/infra/argocd`, alt: `ArgoCD ${sync}, ${health}` },
      { w: 190, href: `${HOMELAB}/tree/main/k8s/talos`, alt: `Kubernetes ${k8s}` },
      { w: 240, href: "https://www.talos.dev", alt: `Talos ${talos}` },
    ] },
    { h: 76, href: HOMELAB, alt: "30-day uptime and certificate renewal" },
  ], { top: true });
}

/** A post's cover as a data URI, or null. Embedded for the same reason as the fonts. */
async function coverFor(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${res.status}`);
    const type = res.headers.get("content-type") ?? "image/png";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch (e) {
    console.warn(`! cover ${url} failed (${e.message}), print left blank`);
    return null;
  }
}

// The latest posts hung as framed prints, as they are on the wall in the room:
// cover in a paper mat, title and date on the mat below it. Each print is its
// own slice so it opens its own post.
async function blogCard(blog) {
  const posts = (blog?.posts ?? []).slice(0, 3);
  const covers = await Promise.all(posts.map((p) => coverFor(p.image)));
  const cols = 3, pad = 40, gap = 16, pw = (W - 2 * pad - (cols - 1) * gap) / cols, mat = 10;
  const imgW = pw - mat * 2, imgH = Math.round(imgW * 630 / 1200), printH = mat + imgH + 104;

  groupHead("blog", "latest from the blog", "blog.nordbye.it", { href: "https://blog.nordbye.it", alt: "Latest from blog.nordbye.it" });
  for (let i = 0; i < cols; i++) {
    const p = posts[i];
    const lx = i === 0 ? pad : gap / 2, w = lx + pw + (i === cols - 1 ? pad : gap / 2);
    const edges = { l: i === 0, r: i === cols - 1 };
    if (!p) { part(`blog-${i + 1}`, w, printH + 36, "", { ...edges, href: "https://blog.nordbye.it" }); continue; }
    const date = p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 10) : "";
    const cover = covers[i]
      ? `<image x="${mat}" y="${mat}" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#corner)" href="${covers[i]}"/>`
      : `<rect x="${mat}" y="${mat}" width="${imgW}" height="${imgH}" rx="4" fill="${T.paper3}"/>`;
    const wrapped = wrap(p.title, 27);
    if (wrapped.join(" ").length < p.title.length) wrapped[2] += "…";
    const lines = wrapped.map((l, k) =>
      tspan(mat, mat + imgH + 26 + k * 19, l, { size: 15, fill: T.ink })).join("");
    part(`blog-${i + 1}`, w, printH + 36, `<g transform="translate(${lx},8)">
      <rect x="0.5" y="0.5" width="${pw - 1}" height="${printH - 1}" rx="7" fill="url(#paper)" stroke="${T.paper3}" stroke-opacity="0.6"/>
      ${cover}
      <rect x="${mat}" y="${mat}" width="${imgW}" height="${imgH}" rx="4" fill="none" stroke="${T.ink}" stroke-opacity="0.18"/>
      ${lines}
      ${tspan(mat, printH - 14, date, { size: 10.5, fill: T.ink3, font: MONO, spacing: 0.8 })}
    </g>`, {
      ...edges, href: p.url ?? "https://blog.nordbye.it", alt: p.title, delay: 120 + i * 120,
      defs: `${PAPER}<clipPath id="corner"><rect x="${mat}" y="${mat}" width="${imgW}" height="${imgH}" rx="4"/></clipPath>`,
    });
  }
}

function statsCard(stats) {
  const tiles = [
    ["public repos", fmt(stats?.repos)],
    ["stars", fmt(stats?.stars)],
    ["commits (1y)", fmt(stats?.commits)],
    ["followers", fmt(stats?.followers)],
  ];
  const weekly = stats?.weekly ?? [];
  const tileW = (W - 80) / tiles.length;
  const tilesSvg = tiles.map(([l, val], i) => {
    const x = 40 + i * tileW;
    return `${tspan(x, 104, val, { size: 34, fill: T.fg })}${label(x, 126, l)}`;
  }).join("");

  // contribution area chart (weekly totals, last 12 months)
  const x0 = 40, chartW = W - 80, base = 250, chartH = 66;
  const max = Math.max(1, ...weekly);
  const n = weekly.length;
  const pts = weekly.map((v, i) => [
    Math.round(n <= 1 ? x0 : x0 + (i * chartW) / (n - 1)),
    Math.round(base - (v / max) * chartH),
  ]);
  // Catmull-Rom through the weekly points, as cubic Béziers. Control points
  // are clamped to the baseline so the curve never dips below zero.
  const clampY = (y) => Math.min(base, y);
  const curve = pts.map(([x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [x0, y0] = pts[i - 2] ?? pts[i - 1], [x1, y1] = pts[i - 1], [x3, y3] = pts[i + 1] ?? [x, y];
    const c1 = [x1 + (x - x0) / 6, clampY(y1 + (y - y0) / 6)];
    const c2 = [x - (x3 - x1) / 6, clampY(y - (y3 - y1) / 6)];
    return `C${c1.map(Math.round)} ${c2.map(Math.round)} ${x},${y}`;
  }).join(" ");
  const area = pts.length ? `${curve} L${pts.at(-1)[0]},${base} L${pts[0][0]},${base} Z` : "";
  const graph = pts.length
    ? `<defs>
         <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="${T.copper}" stop-opacity="0.22"/>
           <stop offset="1" stop-color="${T.copper}" stop-opacity="0"/>
         </linearGradient>
       </defs>
       <line x1="${x0}" y1="${base}" x2="${x0 + chartW}" y2="${base}" stroke="${T.line}"/>
       <path class="fadein" d="${area}" fill="url(#area)"/>
       <path class="draw" d="${curve}" fill="none" stroke="${T.copper}" stroke-width="1.75" stroke-linecap="round"/>`
    : tspan(x0, base - 20, "contribution history unavailable", { size: 13, fill: T.fg3 });

  cut("stats", 272, `
    ${eyebrow(40, 36, "github activity")}
    ${tilesSvg}
    <line x1="40" y1="148" x2="${W - 40}" y2="148" stroke="${T.line}"/>
    ${label(40, 170, "contributions · last 12 months")}
    ${tspan(W - 40, 170, `${fmt(stats?.contributions)} total`, { size: 11.5, fill: T.fg2, font: MONO, anchor: "end" })}
    ${graph}
  `, [
    { h: 58, href: `https://github.com/${GH_USER}`, alt: "GitHub activity" },
    { h: 82, cells: [
      { w: 220, href: `https://github.com/${GH_USER}?tab=repositories`, alt: `${fmt(stats?.repos)} public repos` },
      { w: 190, href: `https://github.com/${GH_USER}?tab=repositories&sort=stargazers`, alt: `${fmt(stats?.stars)} stars` },
      { w: 190, href: `https://github.com/${GH_USER}`, alt: `${fmt(stats?.commits)} commits in the last year` },
      { w: 240, href: `https://github.com/${GH_USER}?tab=followers`, alt: `${fmt(stats?.followers)} followers` },
    ] },
    { h: 132, href: `https://github.com/${GH_USER}`, alt: "Contributions over the last 12 months" },
  ], { divide: true });
}

// Badge per certificate, as issued by Microsoft Learn and Credly. Tested in
// order, so the GitHub titles resolve before the Microsoft tiers. A cert with
// no badge (LFS458 is a course) gets the Linux Foundation mark if it is theirs.
const BADGES = [
  [/advanced security/i, "github-advanced-security"],
  [/copilot/i, "github-copilot"],
  [/github actions/i, "github-actions"],
  [/expert/i, "microsoft-certified-expert-badge"],
  [/associate/i, "microsoft-certified-associate-badge"],
  [/\bCKA\b/, "cka"],
  [/\baws\b/i, "aws-ccp"],
];
const badgeFor = (title) => BADGES.find(([re]) => re.test(title))?.[1] ?? null;

// A cert with no committed badge falls back to Microsoft Learn, whose badge
// URLs follow from the title. Commit a PNG to assets/badges/ to replace it:
// the live SVG is several times heavier than a 192px PNG.
const LEARN_BADGES = "https://learn.microsoft.com/en-us/media/learn/certification/badges";
function learnBadgeUrl(c) {
  if (/github/i.test(c.issuer ?? "")) {
    const slug = c.title.replace(/\s+Certification$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${LEARN_BADGES}/${slug}.svg`;
  }
  const tier = /^microsoft$/i.test(c.issuer ?? "") && c.title.match(/\b(Fundamentals|Associate|Expert|Specialty)\b/i)?.[1];
  return tier ? `${LEARN_BADGES}/microsoft-certified-${tier.toLowerCase()}-badge.svg` : null;
}

/** One data URI per cert, or null where neither a committed nor a live badge exists. */
async function resolveBadges(certs) {
  return Promise.all(certs.map(async (c) => {
    const local = badgeFor(c.title);
    if (local) return `data:image/png;base64,${asset(`badges/${local}.png`)}`;
    const url = learnBadgeUrl(c);
    if (!url) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`${res.status}`);
      console.warn(`! no committed badge for "${c.title}", embedding ${url}`);
      return `data:image/svg+xml;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    } catch (e) {
      console.warn(`! badge for "${c.title}" failed (${e.message}), tile left without one`);
      return null;
    }
  }));
}

/** Greedy wrap by an estimated serif advance; certificate titles are short. */
function wrap(text, maxChars) {
  const lines = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if (cur && (cur + " " + word).length > maxChars) { lines.push(cur); cur = word; }
    else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

// Where a tile opens: the Microsoft Learn share page for anything with a
// credential ID, the scanned certificate on nordbye.it for the two Linux
// Foundation ones, the resume otherwise.
const LEARN_SHARE = "https://learn.microsoft.com/api/credentials/share/en-us/MortenVictorNordbye-8246";
const CERT_PDFS = [[/\bCKA\b/, "CKA"], [/\bLFS458\b/, "LFS458"]];
function certHref(c) {
  if (c.credentialId) return `${LEARN_SHARE}/${c.credentialId}`;
  const pdf = CERT_PDFS.find(([re]) => re.test(c.title))?.[1];
  return pdf ? `https://nordbye.it/pdf/${pdf}.pdf` : "https://nordbye.it/#resume";
}

// Framed certificates stood in rows, as on the shelf in the room: five to a
// row, and a part-filled last row fills from the left with blank slices
// holding the panel together. A full-width spacer closes every row: tiles of
// different widths round to slightly different heights, and without it the
// next row's first tile floats up into the gap beside the shortest one.
function certsCard(profile, badges, si) {
  const certs = profile.certifications ?? [];
  const cols = 5, pad = 40, gap = 14, cw = (W - 2 * pad - (cols - 1) * gap) / cols, ch = 196, cx = cw / 2;
  const rows = Math.ceil(certs.length / cols);
  const lf = iconFor(si, "linuxfoundation");

  const resume = "https://nordbye.it/#resume";
  groupHead("certs", "certifications", `${certs.length} held`, { href: resume, alt: "Certifications" });
  for (let i = 0; i < rows * cols; i++) {
    const c = certs[i], col = i % cols;
    const lx = col === 0 ? pad : gap / 2, w = lx + cw + (col === cols - 1 ? pad : gap / 2);
    const h = gap + ch;
    const edges = { l: col === 0, r: col === cols - 1 };
    if (!c) { part(`cert-${i + 1}`, w, h, "", { ...edges, href: resume }); rowEnd(i); continue; }
    const title = c.title.replace(/^Microsoft Certified:\s*/, "").replace(/\s+Certification$/, "");
    const mark = badges[i]
      ? `<image x="${cx - 38}" y="16" width="76" height="76" href="${badges[i]}"/>`
      : lf && /linux foundation/i.test(c.issuer ?? "")
        ? `<g transform="translate(${cx - 26},28) scale(${52 / 24})"><path d="${lf.path}" fill="${T.ink2}"/></g>`
        : "";
    const lines = wrap(title, 17).map((l, k) =>
      tspan(cx, 118 + k * 16, l, { size: 13.5, fill: T.ink, anchor: "middle" })).join("");
    part(`cert-${i + 1}`, w, h, `<g transform="translate(${lx},${gap / 2})">
      <rect x="0.5" y="0.5" width="${cw - 1}" height="${ch - 1}" rx="7" fill="url(#paper)" stroke="${T.paper3}" stroke-opacity="0.6"/>
      <rect x="5.5" y="5.5" width="${cw - 11}" height="${ch - 11}" rx="4" fill="none" stroke="${T.brass}" stroke-opacity="0.25"/>
      ${mark}
      ${lines}
      ${tspan(cx, ch - 16, c.date ?? "", { size: 10.5, fill: T.ink3, font: MONO, anchor: "middle", spacing: 0.8 })}
    </g>`, { ...edges, href: certHref(c), alt: `${c.title}, ${c.issuer}, ${c.date}`, defs: PAPER, delay: 80 + i * 70 });
    rowEnd(i);
  }

  function rowEnd(i) {
    if (i % cols !== cols - 1) return;
    const r = Math.floor(i / cols);
    part(`certs-row-${r + 1}`, W, r === rows - 1 ? 16 : 1, "", { href: resume });
  }
}

// Curated tech stack → simple-icons slug. Icons are real brand marks, drawn in
// one ink so twelve brand colours do not break the one-green rule.
const TECH = [
  ["Linux", "linux", "https://www.kernel.org"],
  ["Kubernetes", "kubernetes", "https://kubernetes.io"],
  ["Docker", "docker", "https://www.docker.com"],
  ["Terraform", "terraform", "https://developer.hashicorp.com/terraform"],
  ["Ansible", "ansible", "https://docs.ansible.com"],
  ["Azure", "microsoftazure", "https://azure.microsoft.com"],
  ["AWS", "amazonwebservices", "https://aws.amazon.com"],
  ["Argo CD", "argo", "https://argo-cd.readthedocs.io"],
  ["Helm", "helm", "https://helm.sh"],
  ["Prometheus", "prometheus", "https://prometheus.io"],
  ["Grafana", "grafana", "https://grafana.com"],
  ["GitHub Actions", "githubactions", "https://github.com/features/actions"],
];

// Fallback marks for icons simple-icons dropped (e.g. Microsoft's trademark
// removal of the Azure logo). Path is the 24x24 simple-icons glyph.
const ICON_FALLBACK = {
  microsoftazure: {
    hex: "0078D4",
    path: "M22.379 23.343a1.62 1.62 0 0 0 1.536-2.14v.002L17.35 1.76A1.62 1.62 0 0 0 15.816.657H8.184A1.62 1.62 0 0 0 6.65 1.76L.086 21.204a1.62 1.62 0 0 0 1.536 2.139h4.741a1.62 1.62 0 0 0 1.535-1.103l.977-2.892 4.947 3.675c.28.208.618.32.966.32m-3.084-12.531 3.624 10.739a.54.54 0 0 1-.51.713v-.001h-.03a.54.54 0 0 1-.322-.106l-9.287-6.9h4.853m6.313 7.006c.116-.326.13-.694.007-1.058L9.79 1.76a1.722 1.722 0 0 0-.007-.02h6.034a.54.54 0 0 1 .512.366l6.562 19.445a.54.54 0 0 1-.338.684",
  },
};

async function loadSI() {
  try { return await import("simple-icons"); }
  catch { console.warn("! simple-icons missing — brand icons skipped"); return null; }
}
function iconFor(si, slug) {
  if (!slug) return null;
  const key = "si" + slug[0].toUpperCase() + slug.slice(1);
  return si?.[key] ?? ICON_FALLBACK[slug] ?? null;
}

function stackCard(si) {
  const items = TECH.map(([text, slug, href]) => ({ text, href, path: iconFor(si, slug)?.path ?? null }));

  // Fixed grid rather than flow: serif advances are too uneven to estimate.
  const cols = 6, colW = (W - 80) / cols, rowH = 44, top = 90, iconBox = 18;
  const rows = Math.ceil(items.length / cols);
  const parts = (win) => items.map((it, i) => {
    const x = 40 + (i % cols) * colW;
    const y = top + Math.floor(i / cols) * rowH;
    // By the item's centre: cell edges are sums of colW and land a float's
    // width either side of an item's left edge.
    const mid = x + colW / 2;
    if (mid < win.x || mid >= win.x + win.w || y < win.y || y >= win.y + win.h) return "";
    // Position with the SVG transform attribute only. A CSS transform (from
    // an animation class) would override it and collapse icons to the origin.
    const icon = it.path
      ? `<g transform="translate(${x},${y - iconBox + 3}) scale(${iconBox / 24})"><path d="${it.path}" fill="${T.copper}"/></g>`
      : `<rect x="${x}" y="${y - iconBox + 3}" width="${iconBox}" height="${iconBox}" rx="3" fill="none" stroke="${T.copper}"/>`;
    return icon + tspan(x + iconBox + 9, y, it.text, { size: 15, fill: T.fg });
  }).join("");
  // One cell per tool. Rows are rowH apart from y=64, each followed by a
  // one-unit spacer; the last row runs to the bottom of the section.
  const edge = colW + 40, height = top + (rows - 1) * rowH + 34;
  const rowBands = Array.from({ length: rows }, (_, r) => ({
    h: r === rows - 1 ? height - 64 - (rows - 1) * rowH : rowH - 1,
    cells: items.slice(r * cols, (r + 1) * cols).map((it, k, row) => ({
      w: k === 0 || k === row.length - 1 ? edge : colW, href: it.href, alt: it.text,
    })),
  }));
  const bands = [{ h: 64, href: HOMELAB, alt: "Core stack" }];
  rowBands.forEach((b, r) => { if (r) bands.push({ h: 1, href: HOMELAB }); bands.push(b); });
  cut("stack", height, (win) => `${eyebrow(40, 36, "core stack")}${parts(win)}`, bands,
    { divide: true, bottom: true });
}

// GitOps delivery pipeline + the live last-deploy status.
function deliveryCard(infra, si) {
  const stages = [
    { text: "git push", slug: "git" },
    { text: "Actions", slug: "githubactions" },
    { text: "GHCR", slug: "github" },
    { text: "ArgoCD", slug: "argo" },
    { text: "Talos", slug: null },
  ];
  const live = infra && infra.source !== "snapshot" && infra.generatedAt;
  const build = infra?.build, deployedAt = infra?.deployedAt;
  const sync = infra?.argocd?.sync, health = infra?.argocd?.health;

  const n = stages.length, cy = 96, m = 20;
  const nx = (i) => 40 + m + (i * (W - 80 - 2 * m)) / (n - 1);
  const rail = `<line x1="${nx(0)}" y1="${cy}" x2="${nx(n - 1)}" y2="${cy}" stroke="${T.brass}" stroke-opacity="0.7"/>`;
  // One slow brass bead along the rail (SMIL, so it plays on GitHub).
  const bead = `<circle r="3" cy="${cy}" fill="${T.copper}">
      <animate attributeName="cx" values="${nx(0)};${nx(n - 1)}" dur="6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;1;0" dur="6s" repeatCount="indefinite"/>
    </circle>`;
  const nodes = stages.map((s, i) => {
    const x = nx(i), ic = iconFor(si, s.slug);
    const glyph = ic
      ? `<g transform="translate(${x - 9},${cy - 9}) scale(0.75)"><path d="${ic.path}" fill="${T.fg}"/></g>`
      : `<g transform="translate(${x - 8},${cy - 8})" fill="${T.fg}"><rect width="16" height="4" rx="1"/><rect y="6" width="16" height="4" rx="1"/><rect y="12" width="16" height="4" rx="1"/></g>`;
    return `<circle cx="${x}" cy="${cy}" r="20" fill="${T.wood}" stroke="${T.brassHi}"/>${glyph}
      ${tspan(x, cy + 44, s.text, { size: 14, fill: T.fg, anchor: "middle" })}`;
  }).join("");
  const deploy = `build ${build ?? "—"}  ·  deployed ${ago(deployedAt) || "—"}  ·  ArgoCD ${sync ?? "—"}${health ? " · " + health : ""}`;
  cut("delivery", 196, `
    ${eyebrow(40, 36, "gitops delivery", { right: status(live ? `live · ${ago(infra.generatedAt)}` : "snapshot", live) })}
    ${rail}${bead}${nodes}
    <line x1="40" y1="160" x2="${W - 40}" y2="160" stroke="${T.line}"/>
    ${tspan(40, 180, deploy, { size: 11.5, fill: T.fg2, font: MONO })}
  `, [
    { h: 58, href: `${HOMELAB}/actions`, alt: "GitOps delivery pipeline" },
    { h: 92, cells: [
      { w: 150, href: `${HOMELAB}/commits/main`, alt: "git push" },
      { w: 180, href: `${HOMELAB}/actions`, alt: "GitHub Actions" },
      { w: 180, href: `https://github.com/${GH_USER}?tab=packages`, alt: "GHCR" },
      { w: 180, href: `${HOMELAB}/tree/main/k8s/talos/infra/argocd`, alt: "ArgoCD" },
      { w: 150, href: `${HOMELAB}/tree/main/terraform/proxmox/hyper-cluster/k8s`, alt: "Talos" },
    ] },
    { h: 46, href: `${HOMELAB}/actions`, alt: deploy },
  ], { divide: true });
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
// One slice per contribution, each opening the merged PRs in that repo.
function openSourceCard(oss) {
  // Search, not /pulls: /pulls sends a signed-out visitor to the login page.
  const allPrs = `https://github.com/search?type=pullrequests&q=${encodeURIComponent(`is:pr is:merged author:${GH_USER} -user:${GH_USER}`)}`;
  groupHead("oss", "open source · merged contributions", "", { href: allPrs, alt: "Open source, merged contributions" });
  oss.forEach((o, i) => {
    const last = i === oss.length - 1, h = last ? 70 : 54;
    const prs = `https://github.com/${o.repo}/pulls?q=${encodeURIComponent(`is:pr is:merged author:${GH_USER}`)}`;
    part(`oss-${i + 1}`, W, h, `
      ${tspan(40, 24, o.repo, { size: 14, fill: T.copper, font: MONO })}
      ${tspan(40, 43, o.note, { size: 14, fill: T.fg2 })}
      <g transform="translate(${W - 112},${18})"><path d="${STAR}" fill="${T.brassHi}"/></g>
      ${tspan(W - 40, 33, fmt(o.stars), { size: 18, fill: T.fg, anchor: "end" })}
      ${last ? "" : `<line x1="40" y1="53.5" x2="${W - 40}" y2="53.5" stroke="${T.line}"/>`}`,
      { href: prs, alt: `${o.repo}: ${o.note}`, delay: 100 + i * 100 });
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

// Four score rings. Arcs are static so the score is always visible (a drawn-in
// SMIL sweep would leave the ring empty for static/reduced-motion renders).
// Copper for a pass, a dimmer brass below 90, the danger tone below 50.
function lighthouseCard(lh) {
  const host = (u) => (u || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
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
  const top = 92, rowH = 62;
  const scoreColor = (v) => (v == null ? T.fg3 : v >= 90 ? T.copper : v >= 50 ? T.brassHi : T.danger);
  const x0 = 200, r = 21, C = 2 * Math.PI * r;
  const slot = (W - 40 - x0) / cols.length;
  const colX = (i) => Math.round(x0 + slot * i + slot / 2);

  const headers = cols.map(([l], i) => label(colX(i), 76, l, { anchor: "middle" })).join("");
  const rows = sites.map((s, ri) => {
    const cy = top + ri * rowH + 20;
    const rings = cols.map(([, key], i) => {
      const v = s[key], cx = colX(i);
      const arc = C * ((v ?? 0) / 100);
      return `
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T.line}" stroke-width="3"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${scoreColor(v)}" stroke-width="3"
          stroke-dasharray="${arc.toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>
        ${tspan(cx, cy + 6, v == null ? "—" : `${v}`, { size: 17, fill: T.fg, anchor: "middle" })}`;
    }).join("");
    return `${tspan(40, cy + 5, host(s.url), { size: 16, fill: T.fg })}${rings}`;
  }).join("");

  const stamp = lh?.generatedAt ? `measured ${ago(lh.generatedAt)}` : "measured on GitHub CI";
  const report = (u) => `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(u)}`;
  cut("lighthouse", top + sites.length * rowH + 8, `
    ${eyebrow(40, 36, "lighthouse", { right: tspan(W - 40, 36, stamp, { size: 11.5, fill: T.fg2, font: MONO, anchor: "end" }) })}
    ${headers}
    ${rows}`, [
    { h: top - 8, href: report(sites[0].url), alt: "Lighthouse scores" },
    ...sites.map((st, i) => ({ h: rowH + (i === sites.length - 1 ? 16 : 0), href: report(st.url), alt: `Lighthouse for ${host(st.url)}` })),
  ], { divide: true });
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

// The README links posts and certificates one image each. Rendering from the
// fallback would publish without those images and commit a README missing
// them, so fail instead and leave the last good run in place.
if (!blog?.posts?.length || !profile.certifications?.length) {
  console.error("✗ blog or profile API fell back — nothing written");
  process.exit(1);
}

headerCard(profile);
infraCard(infra);
deliveryCard(infra, si);
statsCard(stats);
lighthouseCard(lighthouse);
await blogCard(blog);
openSourceCard(oss);
certsCard(profile, await resolveBadges(profile.certifications ?? []), si);
stackCard(si);
navBadges();
await flush();

// README.md is README.template.md with <!-- panel --> replaced by the slices.
// The clear ends the floats. The workflow commits it only when it changed.
const template = readFileSync(new URL("../README.template.md", import.meta.url), "utf8");
writeFileSync(new URL("../README.md", import.meta.url),
  template.replace("<!-- panel -->", `${PANEL.join("\n")}\n<br clear="both" />`));

console.log(`✓ wrote SVGs to ${OUT}/`);

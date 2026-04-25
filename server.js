const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const RATINGS_FILE = path.join(DATA_DIR, "ratings.json");

const APP_NAME = "Open Arena";
const APP_DESCRIPTION =
  "Rate Farcaster accounts on Web3 knowledge, climb the leaderboard, and share live player cards.";

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function clampScore(value) {
  return Math.max(1, Math.min(100, Math.round(Number(value) || 0)));
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function loadUsers() {
  return readJson(USERS_FILE, []);
}

function loadRatings() {
  return readJson(RATINGS_FILE, []);
}

function buildProfiles() {
  const users = loadUsers();
  const ratings = loadRatings();
  const usersByFid = new Map(users.map((user) => [user.fid, user]));

  const profiles = users.map((user) => {
    const received = ratings
      .filter((rating) => rating.targetFid === user.fid)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const scores = {
      ecosystem: average(received.map((rating) => rating.scores.ecosystem)),
      technical: average(received.map((rating) => rating.scores.technical)),
      market: average(received.map((rating) => rating.scores.market)),
      community: average(received.map((rating) => rating.scores.community))
    };

    const overall = average(Object.values(scores).filter(Boolean));
    const updatedAt = received[0]?.createdAt || null;

    return {
      ...user,
      overall,
      scores,
      voteCount: received.length,
      updatedAt,
      updatedLabel: updatedAt
        ? new Date(updatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric"
          })
        : "Unrated",
      recentRatings: received.slice(0, 4).map((rating) => ({
        ...rating,
        rater: usersByFid.get(rating.raterFid) || {
          fid: rating.raterFid,
          username: `fid-${rating.raterFid}`
        }
      }))
    };
  });

  profiles.sort((left, right) => {
    if (right.overall !== left.overall) return right.overall - left.overall;
    return right.voteCount - left.voteCount;
  });

  return { profiles, usersByFid };
}

function getProfile(fid) {
  const { profiles } = buildProfiles();
  return profiles.find((profile) => profile.fid === fid) || null;
}

function buildFeed() {
  const users = loadUsers();
  const usersByFid = new Map(users.map((user) => [user.fid, user]));

  return loadRatings()
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .map((rating) => ({
      ...rating,
      rater: usersByFid.get(rating.raterFid) || {
        fid: rating.raterFid,
        username: `fid-${rating.raterFid}`
      },
      target: usersByFid.get(rating.targetFid) || {
        fid: rating.targetFid,
        username: `fid-${rating.targetFid}`
      }
    }));
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, text, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(text);
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath);
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png"
  };

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath) || !resolvedPath.startsWith(PUBLIC_DIR)) {
    sendText(response, 404, "Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".css" || ext === ".js" ? "public, max-age=3600" : "no-store"
  });
  fs.createReadStream(resolvedPath).pipe(response);
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON payload."));
      }
    });
    request.on("error", reject);
  });
}

function buildOrigin(request) {
  const host = request.headers.host || `localhost:${PORT}`;
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = forwardedProto ? forwardedProto.split(",")[0] : host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function initialsFor(profile) {
  const initials = profile.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
  return initials || profile.username.slice(0, 2).toUpperCase();
}

function renderPlayerCardSvg(profile) {
  const [themeA = "#d4ff3f", themeB = "#1df2c2"] = profile.theme || [];
  const badgeMarkup = (profile.badges || [])
    .slice(0, 3)
    .map((badge, index) => {
      const x = 386 + index * 138;
      return `
        <g transform="translate(${x} 280)">
          <rect width="124" height="34" rx="17" fill="#14231d" stroke="#365947"/>
          <text x="62" y="22" text-anchor="middle" fill="#f4f7ef" font-size="18" font-weight="700">${escapeXml(
            badge
          )}</text>
        </g>
      `;
    })
    .join("");

  const scoreRows = [
    ["ECO", profile.scores.ecosystem, "Ecosystem Literacy", "#d3ff58"],
    ["TECH", profile.scores.technical, "Technical & Infrastructure", "#4ff2cb"],
    ["ALPHA", profile.scores.market, "Market & Alpha", "#d3ff58"],
    ["VIBES", profile.scores.community, "Community & Vibes", "#4ff2cb"]
  ]
    .map(
      ([label, value, copy, accent], index) => `
        <g transform="translate(380 ${352 + index * 98})">
          <rect width="730" height="88" rx="22" fill="#102019" stroke="#314b3f" stroke-width="2"/>
          <text x="28" y="40" fill="${accent}" font-size="24" font-weight="700">${label}</text>
          <text x="170" y="48" fill="#f4f7ef" font-size="34" font-weight="700">${value}</text>
          <text x="292" y="48" fill="#9db4a6" font-size="26">${escapeXml(copy)}</text>
        </g>
      `
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(
    `${profile.displayName} player card`
  )}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#08130e"/>
      <stop offset="100%" stop-color="#040a07"/>
    </linearGradient>
    <linearGradient id="avatar" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${themeA}"/>
      <stop offset="100%" stop-color="${themeB}"/>
    </linearGradient>
    <radialGradient id="glowLime">
      <stop offset="0%" stop-color="#d3ff58" stop-opacity="0.36"/>
      <stop offset="100%" stop-color="#d3ff58" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowMint">
      <stop offset="0%" stop-color="#4ff2cb" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#4ff2cb" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1020" cy="90" r="220" fill="url(#glowLime)"/>
  <circle cx="960" cy="540" r="200" fill="url(#glowMint)"/>
  <g stroke="rgba(255,255,255,0.04)">
    <path d="M90 0 L0 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M180 0 L60 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M270 0 L150 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M360 0 L240 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M450 0 L330 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M540 0 L420 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M630 0 L510 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M720 0 L600 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M810 0 L690 630" stroke="#ffffff12" stroke-width="2"/>
    <path d="M900 0 L780 630" stroke="#ffffff12" stroke-width="2"/>
  </g>
  <rect x="30" y="30" width="1140" height="570" rx="28" fill="none" stroke="#2e4338" stroke-width="2"/>
  <rect x="48" y="48" width="282" height="534" rx="26" fill="#09130f" stroke="#42584c" stroke-width="2"/>
  <rect x="348" y="48" width="804" height="534" rx="26" fill="#0b1512" stroke="#42584c" stroke-width="2"/>
  <circle cx="189" cy="184" r="91" fill="url(#avatar)" stroke="#f4f7ef22" stroke-width="2"/>
  <text x="189" y="203" text-anchor="middle" fill="#07110c" font-size="82" font-weight="700">${escapeXml(
    initialsFor(profile)
  )}</text>
  <text x="104" y="300" fill="#9db4a6" font-size="22">FID</text>
  <text x="104" y="332" fill="#f4f7ef" font-size="25" font-weight="700">${escapeXml(profile.fid)}</text>
  <text x="104" y="390" fill="#9db4a6" font-size="22">OVR</text>
  <text x="96" y="490" fill="#ffc85b" font-size="98" font-weight="700">${profile.overall}</text>
  <text x="104" y="534" fill="#f4f7ef" font-size="27">${profile.voteCount} validators</text>
  <text x="386" y="92" fill="#d3ff58" font-size="25" font-weight="700">@${escapeXml(profile.username)}</text>
  <text x="386" y="146" fill="#f4f7ef" font-size="54" font-weight="700">${escapeXml(profile.displayName)}</text>
  <text x="386" y="188" fill="#4ff2cb" font-size="27">${escapeXml(profile.archetype)}</text>
  <text x="386" y="230" fill="#9db4a6" font-size="27">${escapeXml(profile.headline)}</text>
  ${badgeMarkup}
  ${scoreRows}
  <text x="924" y="92" fill="#ffc85b" font-size="25" font-weight="700">LIVE</text>
  <text x="924" y="126" fill="#9db4a6" font-size="22">${escapeXml(profile.updatedLabel || "Realtime")}</text>
  <text x="924" y="156" fill="#f4f7ef" font-size="22">${escapeXml(profile.region || "")}</text>
</svg>`;
}

function renderBrandIconSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Open Arena icon">
  <defs>
    <linearGradient id="iconBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1511"/>
      <stop offset="100%" stop-color="#050906"/>
    </linearGradient>
    <radialGradient id="iconGlowA">
      <stop offset="0%" stop-color="#d3ff58" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#d3ff58" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="iconGlowB">
      <stop offset="0%" stop-color="#4ff2cb" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#4ff2cb" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="84" fill="url(#iconBg)"/>
  <circle cx="160" cy="136" r="150" fill="url(#iconGlowA)"/>
  <circle cx="396" cy="388" r="132" fill="url(#iconGlowB)"/>
  <rect x="28" y="28" width="456" height="456" rx="74" fill="#0b1612" stroke="#365246" stroke-width="4"/>
  <rect x="78" y="78" width="356" height="356" rx="56" fill="#0e1b16" stroke="#d3ff58" stroke-width="4"/>
  <text x="112" y="234" fill="#f4f7ef" font-size="124" font-weight="700">OA</text>
  <text x="114" y="312" fill="#d3ff58" font-size="34" font-weight="700">OPEN ARENA</text>
  <text x="114" y="352" fill="#9db4a6" font-size="34" font-weight="700">CRYPTO REP</text>
</svg>`;
}

function renderBrandSplashSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Open Arena splash">
  <defs>
    <linearGradient id="splashBg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#08120e"/>
      <stop offset="100%" stop-color="#040906"/>
    </linearGradient>
    <radialGradient id="splashGlowA">
      <stop offset="0%" stop-color="#d3ff58" stop-opacity="0.36"/>
      <stop offset="100%" stop-color="#d3ff58" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="splashGlowB">
      <stop offset="0%" stop-color="#4ff2cb" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#4ff2cb" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#splashBg)"/>
  <circle cx="120" cy="60" r="240" fill="url(#splashGlowA)"/>
  <circle cx="1010" cy="490" r="210" fill="url(#splashGlowB)"/>
  <rect x="38" y="38" width="1124" height="554" rx="30" fill="none" stroke="#314b3f" stroke-width="2"/>
  <text x="78" y="114" fill="#d3ff58" font-size="28" font-weight="700">OPEN ARENA</text>
  <text x="78" y="210" fill="#f4f7ef" font-size="88" font-weight="700">Crypto Knowledge Rating</text>
  <text x="78" y="288" fill="#9db4a6" font-size="38">Peer-review Farcaster accounts, build the leaderboard, and share live player cards.</text>
  <g transform="translate(78 360)">
    <rect width="154" height="44" rx="18" fill="#0f1d18" stroke="#456053"/>
    <text x="77" y="28" text-anchor="middle" fill="#f4f7ef" font-size="24" font-weight="700">Rate by FID</text>
    <rect x="182" width="126" height="44" rx="18" fill="#0f1d18" stroke="#456053"/>
    <text x="245" y="28" text-anchor="middle" fill="#f4f7ef" font-size="24" font-weight="700">Live OVR</text>
    <rect x="336" width="194" height="44" rx="18" fill="#0f1d18" stroke="#456053"/>
    <text x="433" y="28" text-anchor="middle" fill="#f4f7ef" font-size="24" font-weight="700">Feed-ready Cards</text>
    <rect x="558" width="214" height="44" rx="18" fill="#0f1d18" stroke="#456053"/>
    <text x="665" y="28" text-anchor="middle" fill="#f4f7ef" font-size="24" font-weight="700">Mini App Metadata</text>
  </g>
  <rect x="812" y="118" width="290" height="394" rx="30" fill="#0a1410" stroke="#4a6b5b" stroke-width="2"/>
  <text x="866" y="182" fill="#9db4a6" font-size="38">OVR</text>
  <text x="852" y="350" fill="#ffc85b" font-size="132" font-weight="700">91</text>
  <text x="862" y="422" fill="#4ff2cb" font-size="28" font-weight="700">LIVE CARD</text>
</svg>`;
}

function buildMetaForRoute(request, pathname) {
  const origin = buildOrigin(request);
  const profileMatch = pathname.match(/^\/(?:player|rate)\/([^/]+)$/);

  if (!profileMatch) {
    return {
      title: `${APP_NAME} | Crypto Knowledge Rating`,
      description: APP_DESCRIPTION,
      imageUrl: `${origin}/api/brand/splash.svg`,
      embed: buildMiniAppEmbed(origin, null)
    };
  }

  const profile = getProfile(profileMatch[1]);
  if (!profile) {
    return {
      title: `${APP_NAME} | Unknown player`,
      description: APP_DESCRIPTION,
      imageUrl: `${origin}/api/brand/splash.svg`,
      embed: buildMiniAppEmbed(origin, null)
    };
  }

  return {
    title: `${profile.displayName} | OVR ${profile.overall} | ${APP_NAME}`,
    description: `${profile.headline} Rated ${profile.overall}/100 overall from ${profile.voteCount} peer validations.`,
    imageUrl: `${origin}/api/card/${profile.fid}.svg`,
    embed: buildMiniAppEmbed(origin, profile.fid)
  };
}

function buildMiniAppEmbed(origin, fid) {
  const imageUrl = fid ? `${origin}/api/card/${fid}.svg` : `${origin}/api/brand/splash.svg`;
  const targetUrl = fid ? `${origin}/rate/${fid}` : `${origin}/`;
  const launchAction = {
    type: "launch_miniapp",
    url: targetUrl,
    name: APP_NAME,
    splashImageUrl: `${origin}/api/brand/splash.svg`,
    splashBackgroundColor: "#07110c"
  };

  return {
    miniapp: {
      version: "1",
      imageUrl,
      button: {
        title: fid ? "Rate this player" : "Open Arena",
        action: launchAction
      }
    },
    frame: {
      version: "1",
      imageUrl,
      button: {
        title: fid ? "Rate this player" : "Open Arena",
        action: {
          ...launchAction,
          type: "launch_frame"
        }
      }
    }
  };
}

function renderDocument(request, pathname) {
  const origin = buildOrigin(request);
  const route = pathname.startsWith("/rate/")
    ? "rate"
    : pathname.startsWith("/player/")
      ? "player"
      : "home";
  const targetFid = pathname.split("/").filter(Boolean)[1] || null;
  const meta = buildMetaForRoute(request, pathname);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}">
    <meta property="og:title" content="${escapeHtml(meta.title)}">
    <meta property="og:description" content="${escapeHtml(meta.description)}">
    <meta property="og:type" content="website">
    <meta property="og:image" content="${escapeHtml(meta.imageUrl)}">
    <meta property="og:url" content="${escapeHtml(`${origin}${pathname}`)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(meta.title)}">
    <meta name="twitter:description" content="${escapeHtml(meta.description)}">
    <meta name="twitter:image" content="${escapeHtml(meta.imageUrl)}">
    <meta name="fc:miniapp" content='${escapeHtml(JSON.stringify(meta.embed.miniapp))}'>
    <meta name="fc:frame" content='${escapeHtml(JSON.stringify(meta.embed.frame))}'>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <div id="app"></div>
    <script>window.__APP_BOOTSTRAP__ = ${safeJson({ route, targetFid })}</script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

function renderManifest(request) {
  const origin = buildOrigin(request);
  return {
    accountAssociation: {
      header: "REPLACE_WITH_SIGNED_HEADER",
      payload: "REPLACE_WITH_SIGNED_PAYLOAD",
      signature: "REPLACE_WITH_SIGNED_SIGNATURE"
    },
    miniapp: {
      version: "1",
      name: APP_NAME,
      homeUrl: `${origin}/`,
      iconUrl: `${origin}/api/brand/icon.svg`,
      imageUrl: `${origin}/api/brand/splash.svg`,
      buttonTitle: "Open Arena",
      splashImageUrl: `${origin}/api/brand/splash.svg`,
      splashBackgroundColor: "#07110c",
      subtitle: "Peer-rated Web3 reputation",
      description: APP_DESCRIPTION,
      primaryCategory: "social",
      tags: ["crypto", "reputation", "leaderboard", "farcaster"],
      heroImageUrl: `${origin}/api/brand/splash.svg`,
      tagline: "Rate crypto knowledge in public",
      ogTitle: `${APP_NAME} | Crypto Knowledge Rating`,
      ogDescription: APP_DESCRIPTION,
      ogImageUrl: `${origin}/api/brand/splash.svg`,
      noindex: true
    }
  };
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/users") {
    const users = loadUsers();
    sendJson(response, 200, { users });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/leaderboard") {
    const { profiles } = buildProfiles();
    sendJson(response, 200, { leaderboard: profiles });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/feed") {
    sendJson(response, 200, { ratings: buildFeed() });
    return true;
  }

  const profileMatch = pathname.match(/^\/api\/profile\/([^/]+)$/);
  if (request.method === "GET" && profileMatch) {
    const profile = getProfile(profileMatch[1]);
    if (!profile) {
      sendJson(response, 404, { error: "Profile not found." });
      return true;
    }

    sendJson(response, 200, { profile });
    return true;
  }

  const cardMatch = pathname.match(/^\/api\/card\/([^/]+)\.svg$/);
  if (request.method === "GET" && cardMatch) {
    const profile = getProfile(cardMatch[1]);
    if (!profile) {
      sendText(response, 404, "Card not found.");
      return true;
    }

    sendText(response, 200, renderPlayerCardSvg(profile), "image/svg+xml; charset=utf-8");
    return true;
  }

  if (request.method === "GET" && pathname === "/api/brand/icon.svg") {
    sendText(response, 200, renderBrandIconSvg(), "image/svg+xml; charset=utf-8");
    return true;
  }

  if (request.method === "GET" && pathname === "/api/brand/splash.svg") {
    sendText(response, 200, renderBrandSplashSvg(), "image/svg+xml; charset=utf-8");
    return true;
  }

  if (request.method === "POST" && pathname === "/api/rate") {
    try {
      const payload = await parseBody(request);
      const users = loadUsers();
      const userIds = new Set(users.map((user) => user.fid));

      if (!userIds.has(payload.raterFid) || !userIds.has(payload.targetFid)) {
        sendJson(response, 400, { error: "Rater and target must be known FIDs." });
        return true;
      }

      if (payload.raterFid === payload.targetFid) {
        sendJson(response, 400, { error: "Self-rating is disabled in this MVP." });
        return true;
      }

      const scores = {
        ecosystem: clampScore(payload.scores?.ecosystem),
        technical: clampScore(payload.scores?.technical),
        market: clampScore(payload.scores?.market),
        community: clampScore(payload.scores?.community)
      };

      const comment = String(payload.comment || "").trim().slice(0, 180);
      const ratings = loadRatings();
      ratings.push({
        id: crypto.randomUUID(),
        raterFid: payload.raterFid,
        targetFid: payload.targetFid,
        scores,
        comment,
        createdAt: new Date().toISOString()
      });
      writeJson(RATINGS_FILE, ratings);

      const profile = getProfile(payload.targetFid);
      sendJson(response, 200, { ok: true, profile });
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Unable to save rating." });
    }
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const parsedUrl = new URL(request.url, `http://${request.headers.host || `localhost:${PORT}`}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (await handleApi(request, response, pathname)) {
    return;
  }

  if (request.method === "GET" && pathname === "/.well-known/farcaster.json") {
    sendJson(response, 200, renderManifest(request));
    return;
  }

  if (
    request.method === "GET" &&
    (pathname === "/" || pathname.startsWith("/player/") || pathname.startsWith("/rate/"))
  ) {
    sendText(response, 200, renderDocument(request, pathname), "text/html; charset=utf-8");
    return;
  }

  if (request.method === "GET") {
    const publicTarget = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
    if (fs.existsSync(publicTarget)) {
      sendFile(response, publicTarget);
      return;
    }
  }

  sendText(response, 404, "Not found");
});

server.listen(PORT, () => {
  console.log(`Open Arena listening on http://localhost:${PORT}`);
});

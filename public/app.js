const bootstrap = window.__APP_BOOTSTRAP__ || { route: "home", targetFid: null };

const categories = [
  { key: "ecosystem", label: "Ecosystem Literacy", short: "ECO" },
  { key: "technical", label: "Technical & Infrastructure", short: "TECH" },
  { key: "market", label: "Market & Alpha", short: "ALPHA" },
  { key: "community", label: "Community & Vibes", short: "VIBES" }
];

const state = {
  route: bootstrap.route || inferRoute(window.location.pathname),
  targetFid: bootstrap.targetFid || inferTargetFid(window.location.pathname),
  users: [],
  leaderboard: [],
  recent: [],
  profile: null,
  status: "Loading arena...",
  error: "",
  toast: "",
  farcaster: {
    connected: false,
    label: "Browser preview"
  }
};

const app = document.querySelector("#app");

boot();

window.addEventListener("popstate", async () => {
  state.route = inferRoute(window.location.pathname);
  state.targetFid = inferTargetFid(window.location.pathname);
  await refreshData();
});

app.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.role !== "rating-form") return;

  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    raterFid: String(formData.get("raterFid") || "").trim(),
    targetFid: String(formData.get("targetFid") || "").trim(),
    comment: String(formData.get("comment") || "").trim(),
    scores: Object.fromEntries(
      categories.map((category) => [
        category.key,
        Number(formData.get(category.key) || 0)
      ])
    )
  };

  try {
    state.toast = "Submitting rating...";
    render();

    const response = await fetch("/api/rate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Unable to submit rating.");
    }

    state.toast = `Vote locked for @${result.profile.username}.`;
    state.targetFid = result.profile.fid;
    if (state.route === "home") {
      history.replaceState({}, "", `/player/${result.profile.fid}`);
      state.route = "player";
    }

    form.reset();
    await refreshData();
  } catch (error) {
    state.toast = "";
    state.error = error instanceof Error ? error.message : "Unable to submit rating.";
    render();
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.matches('input[type="range"]')) return;

  const output = app.querySelector(`[data-score-for="${target.name}"]`);
  if (output) {
    output.textContent = target.value;
  }
});

app.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const actionEl = target.closest("[data-action]");
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  const fid = actionEl.dataset.fid || null;

  if (action === "view-player" && fid) {
    history.pushState({}, "", `/player/${fid}`);
    state.route = "player";
    state.targetFid = fid;
    await refreshData();
    return;
  }

  if (action === "rate-player" && fid) {
    history.pushState({}, "", `/rate/${fid}`);
    state.route = "rate";
    state.targetFid = fid;
    await refreshData();
    return;
  }

  if (action === "go-home") {
    history.pushState({}, "", "/");
    state.route = "home";
    state.targetFid = null;
    await refreshData();
    return;
  }

  if (action === "copy-share" && fid) {
    const shareUrl = `${window.location.origin}/player/${fid}`;
    await navigator.clipboard.writeText(shareUrl);
    state.toast = "Share URL copied.";
    render();
  }
});

async function boot() {
  await initMiniAppSdk();
  await refreshData();
}

async function initMiniAppSdk() {
  try {
    const module = await import("https://esm.sh/@farcaster/miniapp-sdk");
    const sdk = module.sdk;

    if (sdk?.actions?.ready) {
      await sdk.actions.ready();
    }

    const context = sdk?.context
      ? typeof sdk.context.then === "function"
        ? await sdk.context
        : sdk.context
      : null;

    state.farcaster = {
      connected: Boolean(context),
      label: context?.user?.username
        ? `Mini App session for @${context.user.username}`
        : "Mini App session detected"
    };
  } catch (error) {
    state.farcaster = {
      connected: false,
      label: "Browser preview"
    };
  }
}

async function refreshData() {
  state.error = "";
  state.status = "Syncing leaderboard...";
  render();

  try {
    const [users, leaderboard, recent] = await Promise.all([
      fetchJson("/api/users"),
      fetchJson("/api/leaderboard"),
      fetchJson("/api/feed")
    ]);

    state.users = users.users;
    state.leaderboard = leaderboard.leaderboard;
    state.recent = recent.ratings;

    const fallbackFid = state.targetFid || state.leaderboard[0]?.fid || state.users[0]?.fid || null;
    state.targetFid = fallbackFid;
    state.profile = fallbackFid ? (await fetchJson(`/api/profile/${fallbackFid}`)).profile : null;
    state.status = "";
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Unable to load the arena.";
    state.status = "";
  }

  render();
}

function render() {
  const activeProfile = state.profile || state.leaderboard[0] || null;
  const targetFid = state.targetFid || activeProfile?.fid || "";
  const raterOptions = state.users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.fid)}">${escapeHtml(
          `@${user.username} (FID ${user.fid})`
        )}</option>`
    )
    .join("");

  const targetOptions = state.users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.fid)}" ${user.fid === targetFid ? "selected" : ""}>
          ${escapeHtml(`@${user.username} - ${user.displayName}`)}
        </option>`
    )
    .join("");

  const formScores = categories
    .map(
      (category, index) => `
        <label class="slider-row">
          <span class="slider-copy">
            <strong>${escapeHtml(category.label)}</strong>
            <em data-score-for="${escapeHtml(category.key)}">${index === 0 ? "82" : index === 1 ? "78" : index === 2 ? "85" : "88"}</em>
          </span>
          <input
            type="range"
            min="1"
            max="100"
            value="${index === 0 ? "82" : index === 1 ? "78" : index === 2 ? "85" : "88"}"
            name="${escapeHtml(category.key)}"
          >
        </label>
      `
    )
    .join("");

  const leaderboardRows = state.leaderboard
    .map(
      (entry, index) => `
        <button class="board-row" data-action="view-player" data-fid="${escapeHtml(entry.fid)}">
          <span class="board-rank">#${index + 1}</span>
          <span class="board-user">
            <strong>@${escapeHtml(entry.username)}</strong>
            <small>${escapeHtml(entry.displayName)} · ${escapeHtml(entry.archetype)}</small>
          </span>
          <span class="board-score">${entry.overall}</span>
          <span class="board-votes">${entry.voteCount} votes</span>
        </button>
      `
    )
    .join("");

  const recentRatings = state.recent
    .map(
      (rating) => `
        <article class="ticker-item">
          <div>
            <strong>@${escapeHtml(rating.rater.username)}</strong>
            <span>rated @${escapeHtml(rating.target.username)}</span>
          </div>
          <p>${escapeHtml(rating.comment || "No comment attached.")}</p>
          <small>${escapeHtml(new Date(rating.createdAt).toLocaleString())}</small>
        </article>
      `
    )
    .join("");

  const categoryStats = activeProfile
    ? categories
        .map(
          (category) => `
            <article class="stat-tile">
              <span>${escapeHtml(category.short)}</span>
              <strong>${activeProfile.scores[category.key]}</strong>
              <small>${escapeHtml(category.label)}</small>
            </article>
          `
        )
        .join("")
    : "";

  const proofList = activeProfile?.recentRatings?.length
    ? activeProfile.recentRatings
        .map(
          (rating) => `
            <article class="proof-line">
              <div>
                <strong>@${escapeHtml(rating.rater.username)}</strong>
                <span>${escapeHtml(rating.comment || "No comment attached.")}</span>
              </div>
              <small>${new Date(rating.createdAt).toLocaleDateString()}</small>
            </article>
          `
        )
        .join("")
    : `<p class="muted">No ratings yet. Be the first validator.</p>`;

  app.innerHTML = `
    <div class="shell">
      <header class="masthead">
        <button class="brand" data-action="go-home">
          <span class="brand-mark">OA</span>
          <span class="brand-copy">
            <strong>Open Arena</strong>
            <small>Crypto Knowledge Rating</small>
          </span>
        </button>
        <div class="status-strip">
          <span class="chip ${state.farcaster.connected ? "chip-live" : ""}">
            ${escapeHtml(state.farcaster.label)}
          </span>
          <span class="chip">Live cards • shareable feeds</span>
          <span class="chip">Local MVP</span>
        </div>
      </header>

      <main class="layout">
        <section class="hero-band">
          <div class="hero-copy">
            <p class="eyebrow">Peer review your Farcaster graph</p>
            <h1>Score Web3 brains, publish the receipts, and keep the card live after the cast.</h1>
            <p class="hero-note">
              Ratings stay tied to each profile, the leaderboard recalculates in real time, and every player page
              carries share-ready Farcaster Mini App metadata.
            </p>
          </div>
          <div class="hero-metrics">
            <article>
              <strong>${state.leaderboard.length}</strong>
              <span>tracked casters</span>
            </article>
            <article>
              <strong>${state.recent.length}</strong>
              <span>proof points</span>
            </article>
            <article>
              <strong>${activeProfile?.overall ?? "--"}</strong>
              <span>spotlight OVR</span>
            </article>
          </div>
        </section>

        <section class="workbench">
          <div class="panel composer-panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Rate a player</p>
                <h2>Compose a credibility vote</h2>
              </div>
              <button class="ghost-button" data-action="rate-player" data-fid="${escapeHtml(targetFid)}">
                Deep link this target
              </button>
            </div>

            <form data-role="rating-form" class="rating-form">
              <label>
                <span>Rater FID</span>
                <select name="raterFid" required>
                  <option value="">Choose a Farcaster account</option>
                  ${raterOptions}
                </select>
              </label>

              <label>
                <span>Target FID</span>
                <select name="targetFid" required>
                  ${targetOptions}
                </select>
              </label>

              <div class="sliders">
                ${formScores}
              </div>

              <label>
                <span>Comment</span>
                <textarea
                  name="comment"
                  rows="3"
                  maxlength="180"
                  placeholder="What exactly makes this person credible in crypto?"
                ></textarea>
              </label>

              <button type="submit" class="primary-button">Lock rating</button>
            </form>

            ${state.error ? `<p class="feedback error">${escapeHtml(state.error)}</p>` : ""}
            ${state.toast ? `<p class="feedback ok">${escapeHtml(state.toast)}</p>` : ""}
            ${state.status ? `<p class="feedback">${escapeHtml(state.status)}</p>` : ""}
          </div>

          <div class="panel spotlight-panel">
            ${
              activeProfile
                ? `
                  <div class="panel-head">
                    <div>
                      <p class="eyebrow">Spotlight profile</p>
                      <h2>@${escapeHtml(activeProfile.username)}</h2>
                    </div>
                    <div class="panel-actions">
                      <button class="ghost-button" data-action="view-player" data-fid="${escapeHtml(activeProfile.fid)}">
                        Open player page
                      </button>
                      <button class="ghost-button" data-action="copy-share" data-fid="${escapeHtml(activeProfile.fid)}">
                        Copy share URL
                      </button>
                    </div>
                  </div>

                  <div class="spotlight-grid">
                    <img
                      class="player-card"
                      src="/api/card/${encodeURIComponent(activeProfile.fid)}.svg"
                      alt="${escapeHtml(activeProfile.displayName)} player card"
                    >
                    <div class="profile-copy">
                      <div class="profile-title">
                        <strong>${escapeHtml(activeProfile.displayName)}</strong>
                        <span>${escapeHtml(activeProfile.archetype)} · ${escapeHtml(activeProfile.region)}</span>
                      </div>
                      <p>${escapeHtml(activeProfile.headline)}</p>
                      <div class="badge-row">
                        ${activeProfile.badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}
                      </div>
                      <div class="stat-grid">
                        ${categoryStats}
                      </div>
                    </div>
                  </div>
                `
                : `<p class="muted">No spotlight profile available.</p>`
            }
          </div>
        </section>

        <section class="data-band">
          <div class="panel board-panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Global ladder</p>
                <h2>Leaderboard</h2>
              </div>
              <span class="tiny-note">Sorted by overall average, then validation count</span>
            </div>
            <div class="board-list">
              ${leaderboardRows || `<p class="muted">Leaderboard coming online.</p>`}
            </div>
          </div>

          <div class="panel proof-panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Recent proof</p>
                <h2>What validators are saying</h2>
              </div>
            </div>
            <div class="proof-list">
              ${proofList}
            </div>
          </div>
        </section>

        <section class="ticker">
          ${recentRatings}
        </section>
      </main>
    </div>
  `;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function inferRoute(pathname) {
  if (pathname.startsWith("/rate/")) return "rate";
  if (pathname.startsWith("/player/")) return "player";
  return "home";
}

function inferTargetFid(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length === 2 && (parts[0] === "player" || parts[0] === "rate") ? parts[1] : null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

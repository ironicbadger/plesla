const STORAGE_KEY = "plesla.config";
const CLIENT_KEY = "plesla.clientId";

const statusPill = document.getElementById("status-pill");
const toast = document.getElementById("toast");
const player = document.getElementById("player");
const seekbar = document.getElementById("seekbar");
const seekbarFull = document.getElementById("seekbar-full");

const progressEls = {
  trackElapsed: document.getElementById("track-elapsed"),
  trackRemaining: document.getElementById("track-remaining"),
  trackIndex: document.getElementById("track-index"),
  bookProgress: document.getElementById("book-progress"),
  bookRemaining: document.getElementById("book-remaining"),
  bookBar: document.getElementById("book-bar-fill"),
  trackElapsedFull: document.getElementById("track-elapsed-full"),
  trackRemainingFull: document.getElementById("track-remaining-full"),
  trackIndexFull: document.getElementById("track-index-full"),
  bookProgressFull: document.getElementById("book-progress-full"),
  bookRemainingFull: document.getElementById("book-remaining-full"),
  bookBarFull: document.getElementById("book-bar-fill-full"),
};

const nowFullEls = {
  art: document.getElementById("now-full-art"),
  title: document.getElementById("now-full-title"),
  book: document.getElementById("now-full-book"),
  author: document.getElementById("now-full-author"),
};

const views = {
  home: document.getElementById("home-view"),
  library: document.getElementById("library-view"),
  search: document.getElementById("search-view"),
  now: document.getElementById("now-view"),
};

const state = {
  config: null,
  section: null,
  hubs: { continue: [], recent: [] },
  libraryMode: "artists",
  libraryStart: 0,
  libraryPageSize: 36,
  queue: [],
  queueIndex: -1,
  view: "home",
  ready: false,
  loginInProgress: false,
};

const clientId = getClientId();

init();

function init() {
  wireUI();
  state.config = loadConfig();

  if (!state.config) {
    showLogin();
    return;
  }

  boot();
}

function wireUI() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  document.querySelectorAll(".segment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLibraryMode(btn.dataset.browse);
    });
  });

  document.getElementById("library-more").addEventListener("click", () => {
    loadLibraryPage();
  });

  document.getElementById("search-go").addEventListener("click", () => {
    runSearch();
  });

  document.getElementById("search-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      runSearch();
    }
  });

  document.getElementById("prev-btn").addEventListener("click", playPrev);
  document.getElementById("next-btn").addEventListener("click", playNext);
  document.getElementById("play-btn").addEventListener("click", togglePlay);
  document.getElementById("prev-btn-full").addEventListener("click", playPrev);
  document.getElementById("next-btn-full").addEventListener("click", playNext);
  document.getElementById("play-btn-full").addEventListener("click", togglePlay);

  document.getElementById("quick-recent").addEventListener("click", playRecent);
  document.getElementById("quick-shuffle").addEventListener("click", playShuffle);

  document.getElementById("detail-close").addEventListener("click", closeDrawer);
  document.getElementById("login-start").addEventListener("click", startLogin);
  document.getElementById("expand-btn").addEventListener("click", openNowFullscreen);
  document.getElementById("now-fullscreen-close").addEventListener("click", closeNowFullscreen);
  document.getElementById("minimize-btn").addEventListener("click", toggleNowbar);

  seekbar.addEventListener("input", () => handleSeekInput(seekbar.value));
  if (seekbarFull) {
    seekbarFull.addEventListener("input", () => handleSeekInput(seekbarFull.value));
  }

  player.addEventListener("timeupdate", syncSeekbar);
  player.addEventListener("loadedmetadata", syncSeekbar);
  player.addEventListener("durationchange", syncSeekbar);
  player.addEventListener("play", () => updatePlayButton(true));
  player.addEventListener("pause", () => updatePlayButton(false));
  player.addEventListener("ended", () => playNext());
}

function getClientId() {
  const existing = localStorage.getItem(CLIENT_KEY);
  if (existing) {
    return existing;
  }
  const id = `plesla-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(CLIENT_KEY, id);
  return id;
}

function loadConfig() {
  let cfg = null;
  const stored = localStorage.getItem(STORAGE_KEY);

  if (stored) {
    try {
      cfg = JSON.parse(stored);
    } catch (error) {
      cfg = null;
    }
  }

  if (!cfg || !cfg.baseUrl || !cfg.token) {
    return null;
  }

  return {
    baseUrl: cfg.baseUrl.replace(/\/$/, ""),
    token: (cfg.token || "").trim(),
    preferredMusicLibrary: cfg.preferredMusicLibrary || "",
    serverName: cfg.serverName || "",
  };
}

function showLogin() {
  const modal = document.getElementById("login-modal");
  modal.classList.remove("hidden");
  document.getElementById("login-library").value = "";
  document.getElementById("login-link").classList.add("hidden");
  document.getElementById("server-list").innerHTML = "";
  document.getElementById("login-start").disabled = false;
  setLoginStatus("Sign in to link your Plex account.");
}

function setLoginStatus(message) {
  document.getElementById("login-status").textContent = message;
}

async function startLogin() {
  if (state.loginInProgress) {
    return;
  }
  state.loginInProgress = true;
  setLoginStatus("Creating Plex sign-in...");
  document.getElementById("login-start").disabled = true;
  document.getElementById("server-list").innerHTML = "";
  document.getElementById("login-link").classList.add("hidden");

  try {
    const pin = await createPin();
    const authUrl = buildPlexAuthUrl(pin.code);
    const loginLink = document.getElementById("login-link");
    loginLink.href = authUrl;
    loginLink.classList.remove("hidden");
    loginLink.textContent = "Open Plex login";

    try {
      window.open(authUrl, "_blank", "noopener");
    } catch (error) {
      // Ignore popup blockers; the link stays visible.
    }

    setLoginStatus("Finish login, then return here.");
    const token = await pollForToken(pin.id, pin.code);
    setLoginStatus("Signed in. Fetching servers...");
    const resources = await fetchResources(token);
    const servers = filterServers(resources);

    if (!servers.length) {
      throw new Error("No Plex servers found on your account.");
    }

    if (servers.length === 1) {
      finalizeServerSelection(servers[0], token);
      return;
    }

    renderServerChoices(servers, token);
  } catch (error) {
    setLoginStatus(error.message || "Unable to sign in.");
    document.getElementById("login-start").disabled = false;
    state.loginInProgress = false;
  }
}

async function createPin() {
  const response = await fetch("/api/plex/pins", {
    method: "POST",
    headers: buildPlexHeaders(),
  });

  if (!response.ok) {
    throw new Error("Unable to reach Plex login service.");
  }

  return response.json();
}

function buildPlexAuthUrl(code) {
  const base = "https://app.plex.tv/auth#?";
  const params = new URLSearchParams({
    clientID: clientId,
    code,
    "context[device][product]": "Plesla",
    "context[device][version]": "1.0",
    "context[device][platform]": "Web",
    "context[device][device]": "Browser",
    "context[device][deviceName]": "Plesla",
    "context[device][model]": "Web",
    "context[device][layout]": "desktop",
  });

  return `${base}${params.toString()}`;
}

async function pollForToken(pinId, pinCode) {
  const attempts = 90;
  for (let i = 0; i < attempts; i += 1) {
    await delay(2000);
    const response = await fetch(
      `/api/plex/pins/${encodeURIComponent(pinId)}?code=${encodeURIComponent(pinCode)}`,
      {
        headers: buildPlexHeaders(),
      }
    );
    if (!response.ok) {
      continue;
    }
    const data = await response.json();
    if (data.authToken) {
      return data.authToken;
    }
  }
  throw new Error("Login timed out. Try again.");
}

async function fetchResources(token) {
  const response = await fetch("/api/plex/resources", {
    headers: {
      ...buildPlexHeaders(),
      "X-Plex-Token": token,
    },
  });

  if (!response.ok) {
    throw new Error("Unable to fetch Plex resources.");
  }

  return response.json();
}

function filterServers(resources) {
  return resources.filter((resource) => {
    const provides = Array.isArray(resource.provides)
      ? resource.provides
      : String(resource.provides || "").split(",");
    return provides.includes("server") && resource.connections?.length;
  });
}

function renderServerChoices(servers, token) {
  const list = document.getElementById("server-list");
  list.innerHTML = "";
  setLoginStatus("Choose your Plex server.");
  state.loginInProgress = false;
  document.getElementById("login-start").disabled = false;

  servers.forEach((server) => {
    const btn = document.createElement("button");
    btn.className = "server-btn";
    btn.textContent = server.name || "Plex Server";
    btn.addEventListener("click", () => finalizeServerSelection(server, token));
    list.appendChild(btn);
  });
}

async function finalizeServerSelection(server, token) {
  setLoginStatus("Checking server connectivity...");
  const connection = await chooseWorkingConnection(server.connections || [], token);
  if (!connection) {
    setLoginStatus("No usable connection found for that server.");
    return;
  }

  const preferred = document.getElementById("login-library").value.trim();
  const cfg = {
    baseUrl: connection.uri.replace(/\/$/, ""),
    token,
    preferredMusicLibrary: preferred,
    serverName: server.name || "",
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  state.config = cfg;
  document.getElementById("login-modal").classList.add("hidden");
  state.loginInProgress = false;
  document.getElementById("login-start").disabled = false;
  boot();
}

async function chooseWorkingConnection(connections, token) {
  if (!connections.length) return null;
  const scored = connections.map((connection) => ({
    connection,
    score: scoreConnection(connection),
  }));

  scored.sort((a, b) => b.score - a.score);

  for (const entry of scored) {
    const ok = await probeConnection(entry.connection, token);
    if (ok) {
      return entry.connection;
    }
  }

  return scored[0].connection || null;
}

function scoreConnection(connection) {
  let score = 0;
  if (connection.protocol === "https") score += 4;
  if (!connection.relay) score += 2;
  return score;
}

async function probeConnection(connection, token) {
  if (!connection?.uri) return false;
  try {
    const url = buildProxyUrl("/identity", {}, connection.uri);
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          ...buildPlexHeaders(),
          "X-Plex-Token": token,
        },
      },
      7000
    );
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function boot() {
  setStatus("Connecting...", "neutral");
  try {
    await loadLibraries();
    await loadHome();
    setLibraryMode("artists");
    const label = state.config.serverName ? `Connected to ${state.config.serverName}` : "Connected";
    setStatus(label, "ok");
    state.ready = true;
  } catch (error) {
    setStatus("Offline", "error");
    showToast(error.message || "Unable to reach Plex server.");
  }
}

function setStatus(text, level) {
  statusPill.textContent = text;
  statusPill.classList.remove("ok", "error");
  if (level === "ok") {
    statusPill.classList.add("ok");
  } else if (level === "error") {
    statusPill.classList.add("error");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2800);
}

function setView(name) {
  state.view = name;
  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle("active", key === name);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  if (name === "now") {
    renderNow();
  }
}

async function loadLibraries() {
  const data = await plexFetch("/library/sections");
  const sections = data.MediaContainer?.Directory || [];

  const musicLibraries = sections.filter((section) => {
    return section.type === "artist" || section.type === "music" || section.type === 8;
  });

  let chosen = null;

  if (state.config.preferredMusicLibrary) {
    chosen = musicLibraries.find((section) => {
      return section.title.toLowerCase() === state.config.preferredMusicLibrary.toLowerCase();
    });
  }

  if (!chosen) {
    chosen = musicLibraries[0] || null;
  }

  if (!chosen) {
    throw new Error("No music library found on this Plex server.");
  }

  state.section = chosen;
}

async function loadHome() {
  const hubData = await plexFetch(`/hubs/sections/${state.section.key}`, {
    count: 30,
    includeStations: 1,
    includeRecentlyAdded: 1,
  });

  const hubs = hubData.MediaContainer?.Hub || [];
  state.hubs.continue = getHubItems(hubs, [
    "continueListening",
    "continueWatching",
    "onDeck",
    "recentlyPlayed",
  ]);
  state.hubs.recent = getHubItems(hubs, ["recentlyAdded", "recentlyReleased"]);

  if (!state.hubs.continue.length) {
    state.hubs.continue = await fetchContinueFallback();
  }

  if (!state.hubs.recent.length) {
    const recentData = await plexFetch(`/library/sections/${state.section.key}/recentlyAdded`, {
      "X-Plex-Container-Start": 0,
      "X-Plex-Container-Size": 20,
    });
    state.hubs.recent = recentData.MediaContainer?.Metadata || [];
  }

  renderHome();
}

function getHubItems(hubs, ids) {
  const match = hubs.find((hub) => {
    return ids.some((id) => hub.hubIdentifier === id || hub.key === id || hub.title === id);
  });
  return match?.Metadata || [];
}

async function fetchContinueFallback() {
  const key = state.section.key;
  const attempts = [
    {
      path: `/library/sections/${key}/recentlyPlayed`,
      params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 20 },
    },
    {
      path: `/library/sections/${key}/recentlyViewed`,
      params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 20 },
    },
    {
      path: `/library/sections/${key}/onDeck`,
      params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": 20 },
    },
    {
      path: `/library/sections/${key}/all`,
      params: {
        sort: "lastViewedAt:desc",
        "X-Plex-Container-Start": 0,
        "X-Plex-Container-Size": 20,
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const data = await plexFetch(attempt.path, attempt.params);
      const items = data.MediaContainer?.Metadata || [];
      if (items.length) {
        return items;
      }
    } catch (error) {
      // Try the next endpoint.
    }
  }

  return [];
}

function renderHome() {
  const continueList = document.getElementById("continue-list");
  const recentList = document.getElementById("recent-list");

  continueList.innerHTML = "";
  recentList.innerHTML = "";

  const continueItems = state.hubs.continue.slice(0, 12);
  const recentItems = state.hubs.recent.slice(0, 12);

  if (!continueItems.length) {
    continueList.appendChild(createEmptyCard("No recent plays"));
  } else {
    continueItems.forEach((item) => continueList.appendChild(createCard(item)));
  }

  if (!recentItems.length) {
    recentList.appendChild(createEmptyCard("No recent items"));
  } else {
    recentItems.forEach((item) => recentList.appendChild(createCard(item)));
  }
}

function createEmptyCard(label) {
  const card = document.createElement("div");
  card.className = "card";
  card.style.setProperty("--card-bg", "linear-gradient(140deg, rgba(255,255,255,0.1), rgba(0,0,0,0))");
  card.innerHTML = `<div class="card-title">${label}</div>`;
  return card;
}

function createCard(item) {
  const card = document.createElement("button");
  card.className = "card";
  const title = itemTitle(item);
  const subtitle = itemSubtitle(item);
  const thumb = getThumbUrl(item);

  if (thumb) {
    card.style.setProperty("--card-bg", `url('${thumb}')`);
  }

  card.innerHTML = `
    <div class="card-title">${title}</div>
    <div class="card-sub">${subtitle}</div>
  `;

  card.addEventListener("click", () => handleOpenItem(item));
  return card;
}

function createListItem(item) {
  const row = document.createElement("div");
  row.className = "list-item";
  const thumb = getThumbUrl(item);
  const title = itemTitle(item);
  const subtitle = itemSubtitle(item);

  row.innerHTML = `
    <div class="list-thumb"></div>
    <div>
      <div class="list-title">${title}</div>
      <div class="list-sub">${subtitle}</div>
    </div>
  `;

  if (thumb) {
    row.querySelector(".list-thumb").style.backgroundImage = `url('${thumb}')`;
  }

  row.addEventListener("click", () => handleOpenItem(item));
  return row;
}

function itemTitle(item) {
  return item.title || item.name || "Untitled";
}

function itemSubtitle(item) {
  return (
    item.grandparentTitle ||
    item.parentTitle ||
    item.summary ||
    item.year ||
    item.type ||
    ""
  );
}

function normalizeType(item) {
  if (!item) return "unknown";
  const raw = item.type || item.metadataType || "";
  if (typeof raw === "string") return raw;
  if (raw === 8) return "artist";
  if (raw === 9) return "album";
  if (raw === 10) return "track";
  return "unknown";
}

async function handleOpenItem(item) {
  try {
    await openItem(item);
  } catch (error) {
    showToast(error?.message || "Unable to open item.");
  }
}

async function openItem(item) {
  const type = normalizeType(item);

  if (type === "track") {
    await openTrack(item);
    return;
  }

  if (type === "album") {
    await openAlbum(item);
    return;
  }

  if (type === "artist") {
    await openArtist(item);
    return;
  }

  if (type === "playlist") {
    await openPlaylist(item);
    return;
  }

  showToast("Unsupported item type.");
}

async function openArtist(item) {
  const childrenKey = resolveChildrenKey(item);
  if (!childrenKey) {
    throw new Error("Missing artist metadata.");
  }
  const data = await plexFetch(childrenKey, {
    "X-Plex-Container-Start": 0,
    "X-Plex-Container-Size": 60,
  });
  const albums = data.MediaContainer?.Metadata || [];

  const grid = document.createElement("div");
  grid.className = "list-grid";
  albums.forEach((album) => grid.appendChild(createListItem(album)));

  const body = document.createElement("div");
  body.className = "drawer-body";
  body.appendChild(
    renderDetailHeader(item, [
      albums.length ? `${albums.length} albums` : "No albums found",
      item.summary || "",
    ])
  );
  body.appendChild(grid);

  openDrawer(itemTitle(item), [], body);
}

async function openAlbum(item) {
  const tracks = await fetchAlbumTracks(item);

  const actions = [
    {
      label: "Play album",
      action: () => setQueue(tracks, 0),
    },
    {
      label: "Shuffle",
      action: () => setQueue(shuffleArray(tracks), 0),
    },
  ];

  const body = document.createElement("div");
  body.className = "drawer-body";
  body.appendChild(
    renderDetailHeader(item, [
      item.parentTitle || "",
      item.year ? String(item.year) : "",
      tracks.length ? `${tracks.length} tracks` : "No tracks found",
    ])
  );
  body.appendChild(renderTrackList(tracks));
  openDrawer(itemTitle(item), actions, body);
}

async function openPlaylist(item) {
  const tracks = await fetchPlaylistTracks(item);
  const actions = [
    {
      label: "Play playlist",
      action: () => setQueue(tracks, 0),
    },
    {
      label: "Shuffle",
      action: () => setQueue(shuffleArray(tracks), 0),
    },
  ];

  const body = document.createElement("div");
  body.className = "drawer-body";
  body.appendChild(
    renderDetailHeader(item, [
      tracks.length ? `${tracks.length} tracks` : "No tracks found",
      item.summary || "",
    ])
  );
  body.appendChild(renderTrackList(tracks));
  openDrawer(itemTitle(item), actions, body);
}

function openDrawer(title, actions, body) {
  const drawer = document.getElementById("detail-drawer");
  const header = document.getElementById("detail-title");
  const actionRow = document.getElementById("detail-actions");
  const content = document.getElementById("detail-body");

  header.textContent = title;
  actionRow.innerHTML = "";
  actions.forEach((action) => {
    const btn = document.createElement("button");
    btn.className = "action-pill";
    btn.textContent = action.label;
    btn.addEventListener("click", action.action);
    actionRow.appendChild(btn);
  });

  content.innerHTML = "";
  if (body) {
    content.appendChild(body);
  }

  drawer.classList.remove("hidden");
}

function closeDrawer() {
  document.getElementById("detail-drawer").classList.add("hidden");
}

function renderTrackList(tracks) {
  const container = document.createElement("div");
  container.className = "track-list";

  tracks.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = "track-row";

    row.innerHTML = `
      <div class="track-meta">
        <div class="track-title">${itemTitle(track)}</div>
        <div class="track-sub">${track.grandparentTitle || track.parentTitle || ""}</div>
      </div>
      <button class="track-play">Play</button>
    `;

    row.querySelector(".track-play").addEventListener("click", (event) => {
      event.stopPropagation();
      setQueue(tracks, index);
    });

    row.addEventListener("click", () => setQueue(tracks, index));
    container.appendChild(row);
  });

  return container;
}

function setLibraryMode(mode) {
  state.libraryMode = mode;
  state.libraryStart = 0;
  document.querySelectorAll(".segment-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.browse === mode);
  });
  loadLibraryPage(true);
}

async function loadLibraryPage(reset = false) {
  if (!state.section) return;

  const list = document.getElementById("library-list");

  if (reset) {
    list.innerHTML = "";
  }

  try {
    const params = {
      "X-Plex-Container-Start": state.libraryStart,
      "X-Plex-Container-Size": state.libraryPageSize,
    };

    let data = null;

    if (state.libraryMode === "artists") {
      params.type = 8;
      params.sort = "titleSort:asc";
      data = await plexFetch(`/library/sections/${state.section.key}/all`, params);
    } else if (state.libraryMode === "albums") {
      params.type = 9;
      params.sort = "titleSort:asc";
      data = await plexFetch(`/library/sections/${state.section.key}/all`, params);
    } else if (state.libraryMode === "playlists") {
      data = await plexFetch("/playlists", {
        playlistType: "audio",
        "X-Plex-Container-Start": state.libraryStart,
        "X-Plex-Container-Size": state.libraryPageSize,
      });
    }

    const items = data?.MediaContainer?.Metadata || [];

    if (!items.length && reset) {
      list.innerHTML = "";
      list.appendChild(createEmptyCard("No items found"));
      return;
    }

    items.forEach((item) => list.appendChild(createListItem(item)));
    state.libraryStart += state.libraryPageSize;
  } catch (error) {
    showToast("Unable to load library items.");
  }
}

async function runSearch() {
  if (!state.section) return;
  const query = document.getElementById("search-input").value.trim();
  if (!query) {
    showToast("Enter a search term.");
    return;
  }

  try {
    const data = await plexFetch("/search", {
      query,
      type: "8,9,10",
      "X-Plex-Container-Start": 0,
      "X-Plex-Container-Size": 40,
    });

    const results = data.MediaContainer?.Metadata || [];
    const list = document.getElementById("search-results");
    list.innerHTML = "";

    if (!results.length) {
      list.appendChild(createEmptyCard("No results"));
      return;
    }

    results.forEach((item) => list.appendChild(createListItem(item)));
  } catch (error) {
    showToast("Search failed.");
  }
}

async function playRecent() {
  const items = state.hubs.continue.length ? state.hubs.continue : state.hubs.recent;
  if (!items.length) {
    showToast("No recent items yet.");
    return;
  }
  try {
    await playImmediate(items[0]);
  } catch (error) {
    showToast("Unable to start recent playback.");
  }
}

async function playShuffle() {
  if (!state.section) return;
  const data = await plexFetch(`/library/sections/${state.section.key}/all`, {
    type: 10,
    sort: "random",
    "X-Plex-Container-Start": 0,
    "X-Plex-Container-Size": 60,
  });
  const tracks = data.MediaContainer?.Metadata || [];
  if (!tracks.length) {
    showToast("No tracks found to shuffle.");
    return;
  }
  setQueue(tracks, 0);
}

async function playImmediate(item) {
  const type = normalizeType(item);
  if (type === "track") {
    setQueue([item], 0);
    return;
  }

  if (type === "album") {
    const tracks = await fetchAlbumTracks(item);
    setQueue(tracks, 0);
    return;
  }

  if (type === "playlist") {
    const tracks = await fetchPlaylistTracks(item);
    setQueue(tracks, 0);
    return;
  }

  if (type === "artist") {
    const tracks = await fetchArtistTracks(item);
    if (tracks.length) {
      setQueue(tracks, 0);
      return;
    }
  }

  openItem(item);
}

async function fetchAlbumTracks(item) {
  const childrenKey = resolveChildrenKey(item);
  if (!childrenKey) {
    return [];
  }
  const data = await plexFetch(childrenKey, {
    "X-Plex-Container-Start": 0,
    "X-Plex-Container-Size": 120,
  });
  return data.MediaContainer?.Metadata || [];
}

async function fetchPlaylistTracks(item) {
  const data = await plexFetch(`/playlists/${item.ratingKey}/items`, {
    "X-Plex-Container-Start": 0,
    "X-Plex-Container-Size": 200,
  });
  return data.MediaContainer?.Metadata || [];
}

async function fetchArtistTracks(item) {
  const childrenKey = resolveChildrenKey(item);
  if (!childrenKey) {
    return [];
  }
  const data = await plexFetch(childrenKey, {
    "X-Plex-Container-Start": 0,
    "X-Plex-Container-Size": 30,
  });
  const albums = data.MediaContainer?.Metadata || [];
  if (!albums.length) return [];
  return fetchAlbumTracks(albums[0]);
}

function resolveChildrenKey(item) {
  if (item?.ratingKey) {
    return `/library/metadata/${item.ratingKey}/children`;
  }
  if (!item?.key) {
    return "";
  }
  if (item.key.includes("/children")) {
    return item.key;
  }
  return `${item.key.replace(/\/$/, "")}/children`;
}

async function openTrack(item) {
  const meta = await fetchTrackMetadata(item);
  const actions = [
    {
      label: "Play track",
      action: () => setQueue([meta], 0),
    },
  ];

  const body = document.createElement("div");
  body.className = "drawer-body";
  body.appendChild(
    renderDetailHeader(meta, [
      meta.grandparentTitle || "",
      meta.parentTitle || "",
      meta.duration ? formatDuration(meta.duration) : "",
    ])
  );
  const fileDetails = renderFileDetails(meta);
  if (fileDetails) {
    body.appendChild(fileDetails);
  }

  openDrawer(itemTitle(meta), actions, body);
}

async function fetchTrackMetadata(item) {
  if (item.Media && item.Media.length) {
    return item;
  }
  const data = await plexFetch(`/library/metadata/${item.ratingKey}`);
  const meta = data.MediaContainer?.Metadata?.[0];
  return meta || item;
}

function renderDetailHeader(item, lines) {
  const header = document.createElement("div");
  header.className = "detail-header";
  const thumb = document.createElement("div");
  thumb.className = "detail-thumb";
  const meta = document.createElement("div");
  meta.className = "detail-meta";

  const title = document.createElement("div");
  title.className = "detail-title";
  title.textContent = itemTitle(item);
  meta.appendChild(title);

  (lines || [])
    .map((line) => String(line).trim())
    .filter(Boolean)
    .forEach((line) => {
      const row = document.createElement("div");
      row.className = "detail-line";
      row.textContent = line;
      meta.appendChild(row);
    });

  const thumbUrl = getThumbUrl(item);
  if (thumbUrl) {
    thumb.style.backgroundImage = `url('${thumbUrl}')`;
  }

  header.appendChild(thumb);
  header.appendChild(meta);
  return header;
}

function renderFileDetails(item) {
  const media = item.Media?.[0];
  const part = media?.Part?.[0];
  if (!media && !part) {
    return null;
  }

  const list = document.createElement("div");
  list.className = "detail-list";

  addDetailRow(list, "Codec", media?.audioCodec || media?.codec || "");
  addDetailRow(list, "Bitrate", media?.bitrate ? formatBitrate(media.bitrate) : "");
  addDetailRow(list, "Channels", media?.audioChannels ? String(media.audioChannels) : "");
  addDetailRow(list, "Sample rate", media?.audioSampleRate ? `${media.audioSampleRate} Hz` : "");
  addDetailRow(list, "Container", media?.container || "");

  if (part?.size) {
    addDetailRow(list, "File size", formatBytes(part.size));
  }

  if (part?.file) {
    addDetailRow(list, "File", filenameFromPath(part.file));
  }

  return list;
}

function addDetailRow(list, label, value) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = "detail-item";

  const key = document.createElement("div");
  key.className = "detail-key";
  key.textContent = label;

  const val = document.createElement("div");
  val.className = "detail-value";
  val.textContent = value;

  row.appendChild(key);
  row.appendChild(val);
  list.appendChild(row);
}

function formatDuration(ms) {
  if (!ms) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBitrate(value) {
  if (!value) return "";
  return `${Math.round(value)} kbps`;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

function filenameFromPath(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1];
}

function setQueue(tracks, startIndex) {
  if (!tracks || !tracks.length) {
    showToast("No tracks to play.");
    return;
  }
  state.queue = tracks.slice();
  state.queueIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
  playQueueIndex(state.queueIndex);
  setView("now");
}

async function playQueueIndex(index) {
  const item = state.queue[index];
  if (!item) return;

  state.queueIndex = index;
  const media = await resolveTrackMedia(item);

  if (!media?.Part?.length) {
    showToast("Track has no playable media.");
    return;
  }

  const partKey = media.Part[0].key;
  const src = buildUrl(partKey, { download: 1 });

  player.src = src;
  updateNowPlaying(item);

  try {
    await player.play();
  } catch (error) {
    showToast("Tap play to start audio.");
  }
}

async function resolveTrackMedia(item) {
  if (item.Media && item.Media.length) {
    return item.Media[0];
  }
  const data = await plexFetch(`/library/metadata/${item.ratingKey}`);
  const meta = data.MediaContainer?.Metadata?.[0];
  return meta?.Media?.[0] || null;
}

function playNext() {
  if (!state.queue.length) return;
  const next = state.queueIndex + 1;
  if (next >= state.queue.length) {
    player.pause();
    return;
  }
  playQueueIndex(next);
}

function playPrev() {
  if (!state.queue.length) return;
  const prev = state.queueIndex - 1;
  if (prev < 0) {
    player.currentTime = 0;
    return;
  }
  playQueueIndex(prev);
}

function togglePlay() {
  if (!player.src) {
    showToast("Pick something to play.");
    return;
  }
  if (player.paused) {
    player.play();
  } else {
    player.pause();
  }
}

function updatePlayButton(isPlaying) {
  const buttons = [document.getElementById("play-btn"), document.getElementById("play-btn-full")];
  buttons.forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle("is-playing", isPlaying);
    btn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
  });
}

function updateNowPlaying(item) {
  const nowTitle = document.getElementById("now-title");
  const nowSub = document.getElementById("now-sub");
  const nowThumb = document.getElementById("now-thumb");
  const bookTitle = getBookTitle(item);
  const authorName = getAuthorName(item);
  nowTitle.textContent = itemTitle(item);
  nowSub.textContent = [bookTitle, authorName].filter(Boolean).join(" · ") || "Audiobook";

  const thumb = getThumbUrl(item);
  nowThumb.style.backgroundImage = thumb ? `url('${thumb}')` : "";

  if (nowFullEls.title) {
    nowFullEls.title.textContent = itemTitle(item);
    nowFullEls.book.textContent = bookTitle || "";
    nowFullEls.author.textContent = authorName || "";
    nowFullEls.art.style.backgroundImage = thumb ? `url('${thumb}')` : "";
  }

  updateProgressUI();
  renderNow();
}

function renderNow() {
  const detail = document.getElementById("now-detail");
  const queueList = document.getElementById("queue-list");
  const current = state.queue[state.queueIndex];

  detail.innerHTML = "";
  queueList.innerHTML = "";

  if (!current) {
    detail.innerHTML = "<div>Nothing playing yet.</div>";
    return;
  }

  const thumb = getThumbUrl(current);
  const detailBlock = document.createElement("div");
  detailBlock.className = "now-detail";
  detailBlock.innerHTML = `
    <div class="detail-thumb"></div>
    <div>
      <div class="list-title">${itemTitle(current)}</div>
      <div class="list-sub">${current.grandparentTitle || ""}</div>
      <div class="list-sub">${current.parentTitle || ""}</div>
    </div>
  `;

  if (thumb) {
    detailBlock.querySelector(".detail-thumb").style.backgroundImage = `url('${thumb}')`;
  }

  detail.appendChild(detailBlock);

  state.queue.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = "queue-item";
    if (index === state.queueIndex) {
      row.classList.add("active");
    }
    row.innerHTML = `
      <div>
        <div class="list-title">${itemTitle(track)}</div>
        <div class="list-sub">${track.grandparentTitle || track.parentTitle || ""}</div>
      </div>
      <button class="track-play">Play</button>
    `;
    row.querySelector(".track-play").addEventListener("click", (event) => {
      event.stopPropagation();
      playQueueIndex(index);
    });
    row.addEventListener("click", () => playQueueIndex(index));
    queueList.appendChild(row);
  });
}

function syncSeekbar() {
  updateProgressUI();
}

function getThumbUrl(item) {
  const path =
    item.thumb ||
    item.art ||
    item.parentThumb ||
    item.grandparentThumb ||
    item.parentArt ||
    item.grandparentArt ||
    "";

  if (!path) {
    return "";
  }
  return buildUrl(path, { width: 400, height: 400, minSize: 1 });
}

function buildUrl(path, params = {}) {
  const base = state.config.baseUrl.replace(/\/$/, "");
  let urlString = path.startsWith("http") ? path : `${base}${path}`;
  if (base.startsWith("/")) {
    const origin = window.location.origin;
    urlString = path.startsWith("http") ? path : `${origin}${base}${path}`;
  }

  const url = new URL(urlString);

  if (state.config.token) {
    url.searchParams.set("X-Plex-Token", state.config.token);
  }

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

async function plexFetch(path, params = {}) {
  const url = buildProxyUrl(path, params);
  const headers = buildPlexHeaders();

  if (state.config.token) {
    headers["X-Plex-Token"] = state.config.token;
  }

  let response = null;
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers,
      },
      12000
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Plex request timed out.");
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Plex error ${response.status}`);
  }

  return response.json();
}

function shuffleArray(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildPlexHeaders() {
  return {
    Accept: "application/json",
    "X-Plex-Product": "Plesla",
    "X-Plex-Version": "1.0",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Device-Name": "Plesla",
    "X-Plex-Platform": "Web",
  };
}

function buildProxyUrl(path, params = {}, baseUrlOverride) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`/api/plex/proxy${normalized}`, window.location.origin);
  const baseUrl = baseUrlOverride || state.config?.baseUrl;
  if (!baseUrl) {
    return url.toString();
  }
  url.searchParams.set("baseUrl", baseUrl);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function handleSeekInput(value) {
  if (!player.duration || Number.isNaN(player.duration)) {
    return;
  }
  const ratio = Number(value) / 100;
  player.currentTime = player.duration * ratio;
}

function updateProgressUI() {
  const duration = player.duration;
  const currentTime = player.currentTime;
  const hasDuration = duration && !Number.isNaN(duration);

  const trackRatio = hasDuration ? Math.min(1, currentTime / duration) : 0;
  const seekValue = Math.floor(trackRatio * 100);
  seekbar.value = seekValue;
  if (seekbarFull) {
    seekbarFull.value = seekValue;
  }

  const elapsedLabel = hasDuration ? formatClock(currentTime) : "0:00";
  const remainingLabel = hasDuration ? `-${formatClock(duration - currentTime)}` : "-0:00";
  const chapterLabel = formatChapterLabel();

  setProgressText(progressEls.trackElapsed, elapsedLabel);
  setProgressText(progressEls.trackRemaining, remainingLabel);
  setProgressText(progressEls.trackIndex, chapterLabel);
  setProgressText(progressEls.trackElapsedFull, elapsedLabel);
  setProgressText(progressEls.trackRemainingFull, remainingLabel);
  setProgressText(progressEls.trackIndexFull, chapterLabel);

  const bookProgress = computeBookProgress(currentTime);
  setProgressText(progressEls.bookProgress, bookProgress.label);
  setProgressText(progressEls.bookRemaining, bookProgress.remaining);
  setProgressText(progressEls.bookProgressFull, bookProgress.label);
  setProgressText(progressEls.bookRemainingFull, bookProgress.remaining);
  updateProgressBar(progressEls.bookBar, bookProgress.percent);
  updateProgressBar(progressEls.bookBarFull, bookProgress.percent);
}

function formatChapterLabel() {
  if (!state.queue.length || state.queueIndex < 0) {
    return "Chapter --";
  }
  const current = state.queue[state.queueIndex];
  const chapterNumber = Number.isFinite(Number(current?.index))
    ? Number(current.index)
    : state.queueIndex + 1;
  return `Chapter ${chapterNumber} of ${state.queue.length}`;
}

function computeBookProgress(currentSeconds) {
  if (!state.queue.length || state.queueIndex < 0) {
    return { label: "Book --", remaining: "", percent: 0 };
  }

  const durations = state.queue.map((item) => getTrackDurationMs(item));
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  if (!totalMs) {
    return { label: "Book --", remaining: "", percent: 0 };
  }

  const previousMs = durations
    .slice(0, state.queueIndex)
    .reduce((sum, value) => sum + value, 0);
  const currentMs = previousMs + Math.max(0, currentSeconds * 1000);
  const percent = Math.min(100, (currentMs / totalMs) * 100);
  const remainingMs = Math.max(0, totalMs - currentMs);

  return {
    label: `Book ${Math.round(percent)}%`,
    remaining: `${formatDurationLong(remainingMs)} left`,
    percent,
  };
}

function updateProgressBar(element, percent) {
  if (!element) return;
  element.style.width = `${percent}%`;
}

function setProgressText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const rounded = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatDurationLong(ms) {
  if (!ms) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getBookTitle(item) {
  return item.parentTitle || item.grandparentTitle || "";
}

function getAuthorName(item) {
  if (item.grandparentTitle && item.parentTitle) {
    return item.grandparentTitle;
  }
  return item.originalTitle || "";
}

function getTrackDurationMs(item) {
  if (!item) return 0;
  if (Number.isFinite(Number(item.duration))) {
    return Number(item.duration);
  }
  const media = item.Media?.[0];
  if (Number.isFinite(Number(media?.duration))) {
    return Number(media.duration);
  }
  const part = media?.Part?.[0];
  if (Number.isFinite(Number(part?.duration))) {
    return Number(part.duration);
  }
  return 0;
}

function openNowFullscreen() {
  document.getElementById("now-fullscreen").classList.remove("hidden");
  updateProgressUI();
}

function closeNowFullscreen() {
  document.getElementById("now-fullscreen").classList.add("hidden");
}

function toggleNowbar() {
  const bar = document.querySelector(".nowbar");
  if (!bar) return;
  bar.classList.toggle("compact");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

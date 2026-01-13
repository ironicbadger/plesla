const path = require("path");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_DIR = path.join(__dirname);

const PLEX_PRODUCT = process.env.PLEX_PRODUCT || "Plesla";
const PLEX_VERSION = process.env.PLEX_VERSION || "1.0";
const PLEX_PLATFORM = process.env.PLEX_PLATFORM || "Web";
const PLEX_DEVICE = process.env.PLEX_DEVICE || "Browser";
const PLEX_DEVICE_NAME = process.env.PLEX_DEVICE_NAME || "Plesla";

app.use(express.static(PUBLIC_DIR));

app.post("/api/plex/pins", async (req, res) => {
  try {
    const response = await fetchWithTimeout(
      buildPlexUrl("/api/v2/pins", { strong: "true" }),
      {
        method: "POST",
        headers: buildPlexHeaders(req),
      },
      12000
    );

    const body = await response.text();
    res.status(response.status).type("application/json").send(body);
  } catch (error) {
    res.status(500).json({ error: "Unable to reach Plex." });
  }
});

app.get("/api/plex/pins/:id", async (req, res) => {
  try {
    const params = {};
    if (req.query.code) {
      params.code = req.query.code;
    }
    const response = await fetchWithTimeout(
      buildPlexUrl(`/api/v2/pins/${req.params.id}`, params),
      {
        headers: buildPlexHeaders(req),
      },
      12000
    );

    const body = await response.text();
    res.status(response.status).type("application/json").send(body);
  } catch (error) {
    res.status(500).json({ error: "Unable to reach Plex." });
  }
});

app.get("/api/plex/resources", async (req, res) => {
  try {
    const token = req.get("X-Plex-Token") || "";
    if (!token) {
      res.status(401).json({ error: "Missing Plex token." });
      return;
    }

    const response = await fetchWithTimeout(
      buildPlexUrl("/api/v2/resources", {
        includeHttps: "1",
        includeRelay: "1",
        includeIPv6: "1",
      }),
      {
        headers: {
          ...buildPlexHeaders(req),
          "X-Plex-Token": token,
        },
      },
      12000
    );

    const body = await response.text();
    res.status(response.status).type("application/json").send(body);
  } catch (error) {
    res.status(500).json({ error: "Unable to reach Plex." });
  }
});

app.get("/api/plex/proxy/*", async (req, res) => {
  try {
    const baseUrl = String(req.query.baseUrl || "");
    if (!baseUrl) {
      res.status(400).json({ error: "Missing baseUrl." });
      return;
    }

    const targetBase = normalizeBaseUrl(baseUrl);
    if (!targetBase) {
      res.status(400).json({ error: "Invalid baseUrl." });
      return;
    }

    const targetPath = req.params[0] ? `/${req.params[0]}` : "/";
    const targetUrl = new URL(targetPath, targetBase);

    Object.entries(req.query).forEach(([key, value]) => {
      if (key === "baseUrl") return;
      targetUrl.searchParams.set(key, value);
    });

    const headers = buildPlexHeaders(req);
    const token = req.get("X-Plex-Token") || "";
    if (token) {
      headers["X-Plex-Token"] = token;
    }

    const response = await fetchWithTimeout(targetUrl.toString(), { headers }, 12000);
    const body = await response.text();
    res.status(response.status);
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
    res.send(body);
  } catch (error) {
    console.error("Proxy error:", error.message || error);
    res.status(500).json({ error: "Proxy request failed." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Plesla server listening on port ${PORT}`);
});

function buildPlexUrl(pathname, params) {
  const url = new URL(`https://plex.tv${pathname}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function buildPlexHeaders(req) {
  const clientId = req.get("X-Plex-Client-Identifier") || `plesla-${Date.now()}`;
  return {
    Accept: "application/json",
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Version": PLEX_VERSION,
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Device-Name": PLEX_DEVICE_NAME,
    "X-Plex-Platform": PLEX_PLATFORM,
    "X-Plex-Device": PLEX_DEVICE,
  };
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    return null;
  }
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

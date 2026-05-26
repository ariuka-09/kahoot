import type { Track } from "./protocol";

export type SpotifyPlaylistMeta = {
  id: string;
  name: string;
  owner: string;
  trackCount: number;
  imageUrl: string | null;
};

export type SpotifyTrackRaw = {
  id: string;
  name: string;
  artist: string;
  previewUrl: string | null;
  artworkUrl: string | null;
};

export type SpotifyUserAuth = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  displayName: string;
  userId: string;
};

type TokenState = {
  token: string;
  expiresAt: number;
};

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
].join(" ");

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const u = new URL("https://accounts.spotify.com/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", SPOTIFY_SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

async function spotifyTokenRequest(
  env: CloudflareEnv,
  body: Record<string, string>,
): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
} | null> {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!r.ok) return null;
  return r.json();
}

export async function exchangeAuthCode(
  env: CloudflareEnv,
  code: string,
  redirectUri: string,
): Promise<SpotifyUserAuth | null> {
  const tok = await spotifyTokenRequest(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  if (!tok || !tok.refresh_token) return null;
  const profile = await fetchUserProfile(tok.access_token);
  if (!profile) return null;
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    displayName: profile.displayName,
    userId: profile.id,
  };
}

export async function refreshUserToken(
  env: CloudflareEnv,
  auth: SpotifyUserAuth,
): Promise<SpotifyUserAuth | null> {
  const tok = await spotifyTokenRequest(env, {
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
  });
  if (!tok) return null;
  return {
    ...auth,
    accessToken: tok.access_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    // Spotify sometimes returns a new refresh_token; keep the existing one if not.
    refreshToken: tok.refresh_token ?? auth.refreshToken,
  };
}

/** Return a valid access token, refreshing if needed. */
export async function ensureUserAccess(
  env: CloudflareEnv,
  auth: SpotifyUserAuth,
): Promise<{ token: string; auth: SpotifyUserAuth } | null> {
  if (auth.expiresAt > Date.now() + 30_000) {
    return { token: auth.accessToken, auth };
  }
  const refreshed = await refreshUserToken(env, auth);
  if (!refreshed) return null;
  return { token: refreshed.accessToken, auth: refreshed };
}

async function fetchUserProfile(
  token: string,
): Promise<{ id: string; displayName: string } | null> {
  const r = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const d = (await r.json()) as { id: string; display_name?: string };
  return { id: d.id, displayName: d.display_name ?? d.id };
}

/**
 * Spotify's public Web API refuses to return playlist tracks for newly-registered
 * developer apps (Nov 2024 policy). The embed page (intended for iframes) still
 * inlines the full track list as JSON, including working preview URLs. We scrape
 * that as a workaround.
 */
export type EmbedPlaylistResult =
  | { ok: true; meta: SpotifyPlaylistMeta; tracks: SpotifyTrackRaw[] }
  | { ok: false; reason: string };

export async function fetchPlaylistViaEmbed(
  playlistId: string,
): Promise<EmbedPlaylistResult> {
  const url = `https://open.spotify.com/embed/playlist/${playlistId}`;
  let r: Response;
  try {
    r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Ariuntify/1.0)",
        Accept: "text/html",
      },
    });
  } catch {
    return { ok: false, reason: "couldn't reach Spotify embed" };
  }
  if (!r.ok) {
    return { ok: false, reason: `embed responded ${r.status}` };
  }
  const html = await r.text();
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) return { ok: false, reason: "no __NEXT_DATA__ in embed (Spotify may have changed it)" };

  // The embed JSON shape Spotify currently serves.
  type EmbedTrack = {
    uri?: string;
    title?: string;
    subtitle?: string;
    isPlayable?: boolean;
    audioPreview?: { url?: string };
  };
  type EmbedEntity = {
    type?: string;
    id?: string;
    title?: string;
    subtitle?: string;
    coverArt?: { sources?: Array<{ url?: string }> };
    trackList?: EmbedTrack[];
  };
  type EmbedRoot = {
    props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } };
  };

  let data: EmbedRoot;
  try {
    data = JSON.parse(m[1]) as EmbedRoot;
  } catch {
    return { ok: false, reason: "couldn't parse embed JSON" };
  }
  const entity = data.props?.pageProps?.state?.data?.entity;
  if (!entity) return { ok: false, reason: "no playlist data in embed" };
  if (entity.type && entity.type !== "playlist") {
    return { ok: false, reason: `expected playlist, got ${entity.type}` };
  }

  const rawList = entity.trackList ?? [];
  const tracks: SpotifyTrackRaw[] = rawList
    .filter(
      (t): t is EmbedTrack & { uri: string; audioPreview: { url: string } } =>
        !!t.uri &&
        !!t.audioPreview?.url &&
        t.isPlayable !== false,
    )
    .map((t) => ({
      id: t.uri.replace("spotify:track:", ""),
      name: t.title ?? "",
      artist: t.subtitle ?? "",
      previewUrl: t.audioPreview.url,
      artworkUrl: null,
    }))
    .filter((t) => t.id && t.name);

  if (tracks.length === 0) {
    return {
      ok: false,
      reason: `playlist found but 0 playable tracks (of ${rawList.length} listed). Maybe all are unavailable in your region or restricted.`,
    };
  }

  const meta: SpotifyPlaylistMeta = {
    id: entity.id ?? playlistId,
    name: entity.title ?? "Playlist",
    owner: entity.subtitle ?? "Unknown",
    trackCount: rawList.length,
    imageUrl: entity.coverArt?.sources?.[0]?.url ?? null,
  };
  return { ok: true, meta, tracks };
}

/** List the authenticated user's playlists (first 50). */
export async function fetchMyPlaylists(
  token: string,
): Promise<SpotifyPlaylistMeta[]> {
  const r = await fetch(
    "https://api.spotify.com/v1/me/playlists?limit=50",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return [];
  const d = (await r.json()) as {
    items: Array<{
      id: string;
      name: string;
      owner?: { display_name?: string };
      images?: Array<{ url: string }>;
      tracks?: { total: number };
    }>;
  };
  return d.items.map((p) => ({
    id: p.id,
    name: p.name,
    owner: p.owner?.display_name ?? "You",
    trackCount: p.tracks?.total ?? 0,
    imageUrl: p.images?.[0]?.url ?? null,
  }));
}

/** Parse a Spotify playlist link, URI, or bare ID into a playlist ID. */
export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // URL form: https://open.spotify.com/playlist/<id>?si=...
  const urlMatch = trimmed.match(/playlist\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // URI form: spotify:playlist:<id>
  const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (uriMatch) return uriMatch[1];

  // Bare ID (Spotify IDs are base62, 22 chars typically)
  if (/^[A-Za-z0-9]{16,}$/.test(trimmed)) return trimmed;

  return null;
}

export async function getAccessToken(
  env: CloudflareEnv,
  cached: TokenState | null,
): Promise<{ token: string; state: TokenState } | null> {
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return { token: cached.token, state: cached };
  }
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;

  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { access_token: string; expires_in: number };
  const state: TokenState = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return { token: state.token, state };
}

export type FetchPlaylistResult =
  | { ok: true; meta: SpotifyPlaylistMeta }
  | { ok: false; status: number; reason: string };

export async function fetchPlaylistMeta(
  token: string,
  playlistId: string,
): Promise<FetchPlaylistResult> {
  const r = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,owner(display_name),images,tracks(total)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) {
    let reason = `Spotify responded ${r.status}`;
    if (r.status === 404)
      reason =
        "playlist not found — make sure it's a user playlist (Spotify locked editorial playlists out of new API apps)";
    if (r.status === 401) reason = "Spotify auth failed — bad credentials";
    return { ok: false, status: r.status, reason };
  }
  const d = (await r.json()) as {
    id: string;
    name: string;
    owner?: { display_name?: string };
    images?: Array<{ url: string }>;
    tracks?: { total: number };
  };
  return {
    ok: true,
    meta: {
      id: d.id,
      name: d.name,
      owner: d.owner?.display_name ?? "Unknown",
      trackCount: d.tracks?.total ?? 0,
      imageUrl: d.images?.[0]?.url ?? null,
    },
  };
}

export type FetchTracksResult = {
  tracks: SpotifyTrackRaw[];
  status: number;
  errorBody?: string;
  rawCount?: number;
};

export async function fetchPlaylistTracks(
  token: string,
  playlistId: string,
): Promise<FetchTracksResult> {
  const out: SpotifyTrackRaw[] = [];
  let offset = 0;
  let lastStatus = 0;
  let lastError: string | undefined;
  let rawCount = 0;
  while (out.length < 200) {
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&offset=${offset}&market=from_token`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    lastStatus = r.status;
    if (!r.ok) {
      lastError = (await r.text()).slice(0, 500);
      console.log(
        "[spotify] tracks fetch failed",
        playlistId,
        lastStatus,
        lastError,
      );
      break;
    }
    const d = (await r.json()) as {
      items: Array<{
        track: {
          id: string;
          name: string;
          artists: Array<{ name: string }>;
          preview_url: string | null;
          album: { images: Array<{ url: string }> };
          is_local?: boolean;
        } | null;
      }>;
      next: string | null;
      total?: number;
    };
    rawCount += d.items.length;
    console.log(
      "[spotify] tracks page",
      playlistId,
      "items=",
      d.items.length,
      "total=",
      d.total,
    );
    for (const it of d.items) {
      const t = it.track;
      if (!t || !t.id || t.is_local) continue;
      out.push({
        id: t.id,
        name: t.name,
        artist: t.artists.map((a) => a.name).join(", "),
        previewUrl: t.preview_url,
        artworkUrl: t.album.images[0]?.url ?? null,
      });
    }
    if (!d.next) break;
    offset += 100;
  }
  return { tracks: out, status: lastStatus, errorBody: lastError, rawCount };
}

/** Fallback: search iTunes for a `title + artist` to retrieve a preview URL. */
export async function findItunesPreview(
  title: string,
  artist: string,
): Promise<{ previewUrl: string; artworkUrl: string } | null> {
  const term = `${title} ${artist}`.slice(0, 100);
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=5&country=US`;
  try {
    const r = await fetch(url, {
      cf: { cacheTtl: 60 * 60, cacheEverything: true },
    });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      results: Array<{
        previewUrl?: string;
        artworkUrl100?: string;
      }>;
    };
    const hit = d.results.find((t) => t.previewUrl);
    if (!hit?.previewUrl) return null;
    return {
      previewUrl: hit.previewUrl,
      artworkUrl: (hit.artworkUrl100 ?? "").replace("100x100bb", "300x300bb"),
    };
  } catch {
    return null;
  }
}

/**
 * Pick a random Spotify track from the cached list, filling in a preview URL
 * via iTunes fallback when Spotify returns null (which is most tracks now).
 */
export async function pickPlayableTrack(
  tracks: SpotifyTrackRaw[],
): Promise<Track | null> {
  if (tracks.length === 0) return null;
  // Try up to 6 random picks before giving up.
  const tried = new Set<number>();
  for (let attempt = 0; attempt < 6 && tried.size < tracks.length; attempt++) {
    let idx = Math.floor(Math.random() * tracks.length);
    while (tried.has(idx)) idx = (idx + 1) % tracks.length;
    tried.add(idx);
    const t = tracks[idx];
    if (t.previewUrl) {
      return {
        title: t.name,
        artist: t.artist,
        previewUrl: t.previewUrl,
        artworkUrl: t.artworkUrl ?? "",
      };
    }
    const fallback = await findItunesPreview(t.name, t.artist);
    if (fallback) {
      return {
        title: t.name,
        artist: t.artist,
        previewUrl: fallback.previewUrl,
        artworkUrl: t.artworkUrl ?? fallback.artworkUrl,
      };
    }
  }
  return null;
}

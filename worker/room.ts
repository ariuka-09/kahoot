import { DurableObject } from "cloudflare:workers";
import {
  MUSIC_DURATION_MS,
  MUSIC_LEAD_MS,
  type Click,
  type ClientMessage,
  type Participant,
  type Phase,
  type PlaylistInfo,
  type RoomState,
  type ServerMessage,
  type Track,
} from "./protocol";
import {
  ensureUserAccess,
  fetchMyPlaylists,
  fetchPlaylistViaEmbed,
  parsePlaylistId,
  pickPlayableTrack,
  type SpotifyTrackRaw,
  type SpotifyUserAuth,
} from "./spotify";

type Role = "host" | "participant";

type Attachment = {
  role: Role;
  participantId?: string;
  name?: string;
};

type AlarmKind = null;

const POPULAR_QUERIES = [
  "taylor swift",
  "drake",
  "the weeknd",
  "billie eilish",
  "olivia rodrigo",
  "dua lipa",
  "harry styles",
  "post malone",
  "ariana grande",
  "bad bunny",
  "ed sheeran",
  "doja cat",
  "bruno mars",
  "justin bieber",
  "sza",
  "kendrick lamar",
  "miley cyrus",
  "sabrina carpenter",
  "rihanna",
  "beyonce",
  "morgan wallen",
  "travis scott",
];

type ITunesResult = {
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
};

async function pickPopularTrack(): Promise<Track | null> {
  const q = POPULAR_QUERIES[Math.floor(Math.random() * POPULAR_QUERIES.length)];
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=25&country=US`;
  try {
    const r = await fetch(url, {
      cf: { cacheTtl: 60 * 30, cacheEverything: true },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { results: ITunesResult[] };
    const candidates = (data.results ?? []).filter(
      (t): t is Required<Pick<ITunesResult, "trackName" | "artistName" | "previewUrl" | "artworkUrl100">> =>
        !!t.previewUrl && !!t.trackName && !!t.artistName && !!t.artworkUrl100,
    );
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      title: pick.trackName,
      artist: pick.artistName,
      previewUrl: pick.previewUrl,
      artworkUrl: pick.artworkUrl100.replace("100x100bb", "300x300bb"),
    };
  } catch {
    return null;
  }
}


export class Room extends DurableObject<CloudflareEnv> {
  private code = "";
  private phase: Phase = "lobby";
  private track: Track | null = null;
  private playStartedAt: number | null = null;
  private clickStartedAt: number | null = null;
  private participants = new Map<string, { name: string }>();
  private clicks: Click[] = [];
  private firstClickAt: number | null = null;
  private scores = new Map<string, number>();
  private lastWinnerId: string | null = null;
  private roundNumber = 0;
  private alarmKind: AlarmKind = null;
  private playlist: PlaylistInfo | null = null;
  private playlistTracks: SpotifyTrackRaw[] = [];
  private spotifyUser: SpotifyUserAuth | null = null;

  constructor(state: DurableObjectState, env: CloudflareEnv) {
    super(state, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.code = (await this.ctx.storage.get<string>("code")) ?? "";
      this.phase = (await this.ctx.storage.get<Phase>("phase")) ?? "lobby";
      this.track = (await this.ctx.storage.get<Track | null>("track")) ?? null;
      this.playStartedAt =
        (await this.ctx.storage.get<number | null>("playStartedAt")) ?? null;
      this.clickStartedAt =
        (await this.ctx.storage.get<number | null>("clickStartedAt")) ?? null;
      const stored =
        (await this.ctx.storage.get<Array<[string, { name: string }]>>(
          "participants",
        )) ?? [];
      this.participants = new Map(stored);
      this.clicks = (await this.ctx.storage.get<Click[]>("clicks")) ?? [];
      this.firstClickAt =
        (await this.ctx.storage.get<number | null>("firstClickAt")) ?? null;
      const storedScores =
        (await this.ctx.storage.get<Array<[string, number]>>("scores")) ?? [];
      this.scores = new Map(storedScores);
      this.lastWinnerId =
        (await this.ctx.storage.get<string | null>("lastWinnerId")) ?? null;
      this.roundNumber =
        (await this.ctx.storage.get<number>("roundNumber")) ?? 0;
      this.alarmKind =
        (await this.ctx.storage.get<AlarmKind>("alarmKind")) ?? null;
      this.playlist =
        (await this.ctx.storage.get<PlaylistInfo | null>("playlist")) ?? null;
      this.playlistTracks =
        (await this.ctx.storage.get<SpotifyTrackRaw[]>("playlistTracks")) ?? [];
      this.spotifyUser =
        (await this.ctx.storage.get<SpotifyUserAuth | null>("spotifyUser")) ??
        null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/init")) {
      const code = url.searchParams.get("code")?.toUpperCase() ?? "";
      if (!code) return new Response("missing code", { status: 400 });
      if (!this.code) {
        this.code = code;
        await this.ctx.storage.put("code", code);
      }
      return Response.json({ ok: true, code: this.code });
    }

    if (url.pathname.endsWith("/exists")) {
      return Response.json({ exists: Boolean(this.code) });
    }

    if (url.pathname.endsWith("/spotify-store") && request.method === "POST") {
      const auth = (await request.json()) as SpotifyUserAuth;
      this.spotifyUser = auth;
      await this.ctx.storage.put("spotifyUser", auth);
      this.broadcastState();
      return Response.json({ ok: true });
    }

    if (url.pathname.endsWith("/spotify-playlists")) {
      if (!this.spotifyUser) {
        return Response.json(
          { ok: false, reason: "not connected" },
          { status: 401 },
        );
      }
      const access = await ensureUserAccess(this.env, this.spotifyUser);
      if (!access) {
        return Response.json(
          { ok: false, reason: "token refresh failed" },
          { status: 401 },
        );
      }
      if (access.auth !== this.spotifyUser) {
        this.spotifyUser = access.auth;
        await this.ctx.storage.put("spotifyUser", access.auth);
      }
      const playlists = await fetchMyPlaylists(access.token);
      return Response.json({ ok: true, playlists });
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }

    const role = (url.searchParams.get("role") as Role) ?? "participant";
    const participantId = url.searchParams.get("id") ?? "";
    const name = (url.searchParams.get("name") ?? "").trim().slice(0, 24);

    if (!this.code) {
      const code = url.searchParams.get("code")?.toUpperCase();
      if (code) {
        this.code = code;
        await this.ctx.storage.put("code", code);
      } else {
        return new Response("room not initialized", { status: 404 });
      }
    }

    if (role === "participant") {
      if (!participantId || !name) {
        return new Response("missing id or name", { status: 400 });
      }
      if (!this.participants.has(participantId)) {
        this.participants.set(participantId, { name });
        await this.persistParticipants();
      } else {
        const existing = this.participants.get(participantId)!;
        if (existing.name !== name) {
          this.participants.set(participantId, { name });
          await this.persistParticipants();
        }
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const attachment: Attachment = { role, participantId, name };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);

    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { type: "error", message: "invalid json" });
    }

    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;

    switch (msg.type) {
      case "start": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        if (this.phase !== "lobby" && this.phase !== "done") {
          return this.send(ws, { type: "error", message: "round in progress" });
        }
        if (this.participants.size === 0) {
          return this.send(ws, { type: "error", message: "no participants" });
        }
        let track: Track | null = null;
        if (this.playlist && this.playlistTracks.length > 0) {
          track = await pickPlayableTrack(this.playlistTracks);
        }
        if (!track) {
          track = await pickPopularTrack();
        }
        if (!track) {
          return this.send(ws, {
            type: "error",
            message: "couldn't fetch a track, try again",
          });
        }
        this.phase = "playing";
        this.track = track;
        this.playStartedAt = Date.now() + MUSIC_LEAD_MS;
        // Clicks open the moment music starts — no separate clicking phase.
        this.clickStartedAt = this.playStartedAt;
        this.firstClickAt = null;
        this.clicks = [];
        this.lastWinnerId = null;
        this.roundNumber += 1;
        this.alarmKind = null;
        await this.persistRound();
        await this.ctx.storage.put("track", this.track);
        await this.ctx.storage.put("alarmKind", this.alarmKind);
        await this.ctx.storage.deleteAlarm();
        this.broadcastState();
        return;
      }
      case "click": {
        if (att.role !== "participant" || !att.participantId) {
          return this.send(ws, { type: "error", message: "participants only" });
        }
        if (this.phase !== "playing" || this.clickStartedAt == null) {
          return this.send(ws, { type: "error", message: "not accepting clicks" });
        }
        const now = Date.now();
        if (now < this.clickStartedAt) {
          return this.send(ws, { type: "error", message: "too early" });
        }
        if (this.clicks.some((c) => c.participantId === att.participantId)) {
          return;
        }
        const elapsedMs = now - this.clickStartedAt;
        const p = this.participants.get(att.participantId);
        this.clicks.push({
          participantId: att.participantId,
          name: p?.name ?? att.name ?? "Unknown",
          elapsedMs,
        });
        this.clicks.sort((a, b) => a.elapsedMs - b.elapsedMs);
        if (this.firstClickAt == null) {
          // First click — music stops everywhere on next broadcast.
          this.firstClickAt = now;
        }
        if (this.clicks.length >= this.participants.size) {
          this.phase = "done";
        }
        await this.persistRound();
        this.broadcastState();
        return;
      }
      case "award": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        if (this.phase !== "playing" && this.phase !== "done") {
          return this.send(ws, { type: "error", message: "no round to award" });
        }
        if (!this.clicks.some((c) => c.participantId === msg.participantId)) {
          return this.send(ws, {
            type: "error",
            message: "that player hasn't clicked",
          });
        }
        this.scores.set(
          msg.participantId,
          (this.scores.get(msg.participantId) ?? 0) + 1,
        );
        this.lastWinnerId = msg.participantId;
        this.phase = "done";
        this.alarmKind = null;
        await this.persistScores();
        await this.persistRound();
        await this.ctx.storage.put("alarmKind", null);
        await this.ctx.storage.deleteAlarm();
        this.broadcastState();
        return;
      }
      case "deduct": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        if (!this.participants.has(msg.participantId)) {
          return this.send(ws, {
            type: "error",
            message: "no such participant",
          });
        }
        const current = this.scores.get(msg.participantId) ?? 0;
        this.scores.set(msg.participantId, current - 1);
        await this.persistScores();
        this.broadcastState();
        return;
      }
      case "addPoint": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        if (!this.participants.has(msg.participantId)) {
          return this.send(ws, {
            type: "error",
            message: "no such participant",
          });
        }
        const current = this.scores.get(msg.participantId) ?? 0;
        this.scores.set(msg.participantId, current + 1);
        await this.persistScores();
        this.broadcastState();
        return;
      }
      case "clearScores": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        this.scores.clear();
        this.lastWinnerId = null;
        this.roundNumber = 0;
        await this.persistScores();
        await this.ctx.storage.put("roundNumber", 0);
        this.broadcastState();
        return;
      }
      case "reset": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        this.phase = "lobby";
        this.track = null;
        this.playStartedAt = null;
        this.clickStartedAt = null;
        this.firstClickAt = null;
        this.clicks = [];
        this.lastWinnerId = null;
        this.alarmKind = null;
        await this.persistRound();
        await this.ctx.storage.put("track", null);
        await this.ctx.storage.put("alarmKind", null);
        await this.ctx.storage.deleteAlarm();
        this.broadcastState();
        return;
      }
      case "setPlaylist": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        const playlistId = parsePlaylistId(msg.input);
        if (!playlistId) {
          return this.send(ws, {
            type: "error",
            message: "couldn't parse Spotify playlist URL",
          });
        }
        // Spotify's Web API blocks playlist-track listing for new-quota apps,
        // so we scrape the publicly served embed page instead. Works for any
        // public playlist, no OAuth required.
        const result = await fetchPlaylistViaEmbed(playlistId);
        if (!result.ok) {
          return this.send(ws, { type: "error", message: result.reason });
        }
        this.playlist = result.meta;
        this.playlistTracks = result.tracks;
        await this.ctx.storage.put("playlist", this.playlist);
        await this.ctx.storage.put("playlistTracks", result.tracks);
        this.broadcastState();
        return;
      }
      case "clearPlaylist": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        this.playlist = null;
        this.playlistTracks = [];
        await this.ctx.storage.put("playlist", null);
        await this.ctx.storage.put("playlistTracks", []);
        this.broadcastState();
        return;
      }
      case "disconnectSpotify": {
        if (att.role !== "host") {
          return this.send(ws, { type: "error", message: "host only" });
        }
        this.spotifyUser = null;
        await this.ctx.storage.put("spotifyUser", null);
        this.broadcastState();
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {}
    this.broadcastState();
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close();
    } catch {}
    this.broadcastState();
  }

  async alarm() {
    // No automatic phase transitions anymore — host adjudicates each round.
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private broadcastState() {
    const sockets = this.ctx.getWebSockets();
    const hostConnected = sockets.some((s) => {
      const a = s.deserializeAttachment() as Attachment | null;
      return a?.role === "host";
    });
    const connectedParticipantIds = new Set(
      sockets
        .map((s) => s.deserializeAttachment() as Attachment | null)
        .filter((a): a is Attachment => a?.role === "participant" && !!a.participantId)
        .map((a) => a.participantId!),
    );
    const participants: Participant[] = [...this.participants.entries()].map(
      ([id, { name }]) => ({
        id,
        name,
        connected: connectedParticipantIds.has(id),
      }),
    );

    const state: RoomState = {
      code: this.code,
      phase: this.phase,
      participants,
      track: this.track,
      playStartedAt: this.playStartedAt,
      clickStartedAt: this.clickStartedAt,
      firstClickAt: this.firstClickAt,
      musicDurationMs: MUSIC_DURATION_MS,
      clicks: this.clicks,
      hostConnected,
      scores: Object.fromEntries(this.scores),
      lastWinnerId: this.lastWinnerId,
      roundNumber: this.roundNumber,
      playlist: this.playlist,
      spotifyUser: this.spotifyUser
        ? { displayName: this.spotifyUser.displayName }
        : null,
    };

    const payload: ServerMessage = { type: "state", state, serverNow: Date.now() };
    const data = JSON.stringify(payload);
    for (const s of sockets) {
      try {
        s.send(data);
      } catch {}
    }
  }

  private async persistParticipants() {
    await this.ctx.storage.put(
      "participants",
      [...this.participants.entries()],
    );
  }

  private async persistRound() {
    await this.ctx.storage.put("phase", this.phase);
    await this.ctx.storage.put("playStartedAt", this.playStartedAt);
    await this.ctx.storage.put("clickStartedAt", this.clickStartedAt);
    await this.ctx.storage.put("firstClickAt", this.firstClickAt);
    await this.ctx.storage.put("clicks", this.clicks);
    await this.ctx.storage.put("lastWinnerId", this.lastWinnerId);
    await this.ctx.storage.put("roundNumber", this.roundNumber);
  }

  private async persistScores() {
    await this.ctx.storage.put("scores", [...this.scores.entries()]);
  }
}

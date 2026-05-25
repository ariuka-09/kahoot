export type Phase = "lobby" | "playing" | "done";

export type Participant = {
  id: string;
  name: string;
  connected: boolean;
};

export type Click = {
  participantId: string;
  name: string;
  elapsedMs: number;
};

export type Track = {
  title: string;
  artist: string;
  previewUrl: string;
  artworkUrl: string;
};

export type PlaylistInfo = {
  id: string;
  name: string;
  owner: string;
  trackCount: number;
  imageUrl: string | null;
};

export type SpotifyUserPublic = {
  displayName: string;
};

export type RoomState = {
  code: string;
  phase: Phase;
  participants: Participant[];
  track: Track | null;
  playStartedAt: number | null;
  clickStartedAt: number | null;
  firstClickAt: number | null;
  musicDurationMs: number;
  clicks: Click[];
  hostConnected: boolean;
  scores: Record<string, number>;
  lastWinnerId: string | null;
  roundNumber: number;
  playlist: PlaylistInfo | null;
  spotifyUser: SpotifyUserPublic | null;
};

export type ClientMessage =
  | { type: "start" }
  | { type: "click" }
  | { type: "reset" }
  | { type: "award"; participantId: string }
  | { type: "addPoint"; participantId: string }
  | { type: "deduct"; participantId: string }
  | { type: "clearScores" }
  | { type: "setPlaylist"; input: string }
  | { type: "clearPlaylist" }
  | { type: "disconnectSpotify" };

export type ServerMessage =
  | { type: "state"; state: RoomState; serverNow: number }
  | { type: "error"; message: string };

/** Lead time after `start` before audio actually starts (gives clients time to buffer). */
export const MUSIC_LEAD_MS = 1500;
/**
 * Max length of the music clip. Music stops earlier if anyone clicks; this is
 * only a cap for when nobody clicks at all.
 */
export const MUSIC_DURATION_MS = 15000;

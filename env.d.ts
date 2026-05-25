import type { Room } from "./worker/room";

declare global {
  interface CloudflareEnv {
    ROOM: DurableObjectNamespace<Room>;
    SPOTIFY_CLIENT_ID?: string;
    SPOTIFY_CLIENT_SECRET?: string;
  }
}

export {};

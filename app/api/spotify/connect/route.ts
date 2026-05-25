import { getCloudflareContext } from "@opennextjs/cloudflare";
import { buildAuthorizeUrl } from "../../../../worker/spotify";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const room = url.searchParams.get("room")?.toUpperCase();
  if (!room || !/^[A-Z0-9]+$/.test(room)) {
    return new Response("missing or invalid room", { status: 400 });
  }
  const { env } = await getCloudflareContext({ async: true });
  if (!env.SPOTIFY_CLIENT_ID) {
    return new Response("Spotify not configured", { status: 500 });
  }
  const redirectUri = `${url.origin}/api/spotify/callback`;
  const state = room;
  const authorizeUrl = buildAuthorizeUrl(
    env.SPOTIFY_CLIENT_ID,
    redirectUri,
    state,
  );
  return Response.redirect(authorizeUrl, 302);
}

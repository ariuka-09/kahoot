import { getCloudflareContext } from "@opennextjs/cloudflare";
import { exchangeAuthCode } from "../../../../worker/spotify";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.redirect(
      `${url.origin}/?spotify_error=${encodeURIComponent(error)}`,
      302,
    );
  }
  if (!code || !state || !/^[A-Z0-9]+$/.test(state)) {
    return new Response("bad callback", { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const redirectUri = `${url.origin}/api/spotify/callback`;
  const auth = await exchangeAuthCode(env, code, redirectUri);
  if (!auth) {
    return Response.redirect(
      `${url.origin}/host/${state}?spotify_error=exchange_failed`,
      302,
    );
  }

  const id = env.ROOM.idFromName(state);
  const stub = env.ROOM.get(id);
  await stub.fetch("https://room/spotify-store", {
    method: "POST",
    body: JSON.stringify(auth),
    headers: { "Content-Type": "application/json" },
  });

  return Response.redirect(`${url.origin}/host/${state}?spotify=connected`, 302);
}

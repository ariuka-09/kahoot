import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase();
  const { env } = await getCloudflareContext({ async: true });
  const id = env.ROOM.idFromName(code);
  const stub = env.ROOM.get(id);
  const res = await stub.fetch("https://room/spotify-playlists");
  return new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

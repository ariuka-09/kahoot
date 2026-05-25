import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/rooms/[code]">,
) {
  const { code: raw } = await ctx.params;
  const code = raw.toUpperCase();
  const { env } = await getCloudflareContext({ async: true });
  const id = env.ROOM.idFromName(code);
  const stub = env.ROOM.get(id);
  const res = await stub.fetch(`https://room/exists?code=${code}`);
  const { exists } = (await res.json()) as { exists: boolean };
  return Response.json({ code, exists });
}

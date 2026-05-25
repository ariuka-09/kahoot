import { getCloudflareContext } from "@opennextjs/cloudflare";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 6) {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export async function POST() {
  const { env } = await getCloudflareContext({ async: true });
  const code = randomCode();
  const id = env.ROOM.idFromName(code);
  const stub = env.ROOM.get(id);
  await stub.fetch(`https://room/init?code=${code}`);
  return Response.json({ code });
}

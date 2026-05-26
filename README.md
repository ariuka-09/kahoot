# Ariuntify — first-click-wins room

A Kahoot-style web app where a host creates a room, participants join via QR
or 6-character code, and the host runs a 3-second countdown. The first
participant to click after the countdown wins, with full click ordering
broadcast to all clients.

Built with **Next.js 16 (App Router)** + **Cloudflare Workers** + **Durable
Objects** for the room state, deployed via **OpenNext for Cloudflare**.

## Architecture

- `app/` — Next.js App Router pages: home, host, join, play.
- `app/api/rooms/` — Route Handlers that create rooms and check existence.
- `worker/room.ts` — `Room` Durable Object. Hibernation-friendly WebSocket
  server that holds participants, runs the countdown via DO alarms, and tracks
  click order with monotonic server timestamps.
- `worker/index.ts` — Custom Worker entry. Routes `/ws/:code` upgrades to
  the `Room` DO and falls through to the OpenNext Next.js handler for
  everything else.
- `lib/useRoomSocket.ts` — Reusable client WebSocket hook with auto-reconnect
  and clock-skew compensation.
- `wrangler.jsonc` — Worker config with the `ROOM` DO binding.

## Scripts

```bash
npm run dev      # fast UI iteration (Next.js dev server; DO not available)
npm run preview  # full local stack: opennext build + wrangler dev with DO
npm run deploy   # opennext build + deploy to Cloudflare
```

> Use `npm run preview` whenever you need to test joining a room, the
> countdown, or click ordering. `npm run dev` is for layout/styling work only.

## How a round works

1. Host posts `POST /api/rooms` → gets a code → navigates to `/host/<code>`.
2. Host page generates a QR pointing at `/join?code=<code>` and opens a
   host-role WebSocket to `/ws/<code>`.
3. Participants scan/enter the code, pick a name, then connect a
   participant-role WebSocket. Their `participantId` is persisted in
   `localStorage` so a refresh keeps their slot.
4. Host clicks **Start countdown** → DO records `countdownStartedAt`,
   broadcasts state, and schedules an alarm for `+3s`.
5. Alarm fires → phase becomes `clicking`, `clickStartedAt = Date.now()`.
6. Each `{type:"click"}` from a participant is timestamped with
   `Date.now() - clickStartedAt`. Repeat clicks are ignored. When everyone
   has clicked, phase moves to `done`.
7. Host can hit **Reset** at any time to go back to lobby.

"use client";

import { use, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useRoomSocket } from "../../../lib/useRoomSocket";
import { Leaderboard } from "../../../components/Leaderboard";
import { Scoreboard } from "../../../components/Scoreboard";
import { MusicPlayer } from "../../../components/MusicPlayer";

export default function HostPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = use(params);
  const code = raw.toUpperCase();
  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/join?code=${code}`;
  }, [code]);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [playlistInput, setPlaylistInput] = useState("");
  const [playlistEditing, setPlaylistEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [myPlaylists, setMyPlaylists] = useState<
    Array<{
      id: string;
      name: string;
      owner: string;
      trackCount: number;
      imageUrl: string | null;
    }>
  >([]);

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const r = await fetch(`/api/spotify/playlists/${code}`);
      if (r.ok) {
        const d = (await r.json()) as {
          playlists: typeof myPlaylists;
        };
        setMyPlaylists(d.playlists);
      }
    } finally {
      setPickerLoading(false);
    }
  };

  const { state, status, error, clockSkewMs, send } = useRoomSocket({
    code,
    role: "host",
  });

  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, {
      width: 280,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [joinUrl]);

  const phase = state?.phase ?? "lobby";
  const canStart =
    (phase === "lobby" || phase === "done") &&
    (state?.participants.length ?? 0) > 0 &&
    status === "open";
  const totalScored = state
    ? Object.values(state.scores).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-slate-400">
            Host
          </p>
          <h1 className="text-4xl font-bold">Ariuntify room</h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">
            Round {state?.roundNumber ?? 0} · {totalScored} pts awarded
          </p>
          <p
            className={`text-sm font-medium ${
              status === "open" ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {status}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr,1fr,1fr]">
        {/* QR + code panel */}
        <section className="flex flex-col gap-5 rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-slate-400">Scan to join</p>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Join QR code"
                className="rounded-xl bg-white p-2 shadow-xl"
                width={240}
                height={240}
              />
            ) : (
              <div className="h-[240px] w-[240px] animate-pulse rounded-xl bg-slate-700" />
            )}
            <p
              suppressHydrationWarning
              className="break-all text-center text-xs text-slate-400"
            >
              {joinUrl}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm text-slate-400">Room code</p>
            <p className="font-mono text-4xl font-bold tracking-[0.4em] text-fuchsia-300">
              {code}
            </p>
          </div>
        </section>

        {/* Round panel */}
        <section className="flex flex-col gap-5 rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Participants ({state?.participants.length ?? 0})
            </h2>
            {phase !== "lobby" && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                  phase === "playing" && !state?.firstClickAt
                    ? "bg-fuchsia-400/20 text-fuchsia-300"
                    : phase === "playing"
                      ? "bg-emerald-400/20 text-emerald-300"
                      : "bg-slate-700 text-slate-300"
                }`}
              >
                {phase === "playing" && !state?.firstClickAt
                  ? "music"
                  : phase === "playing"
                    ? "clicks in"
                    : phase}
              </span>
            )}
          </div>

          {state?.participants.length ? (
            <ul className="flex flex-wrap gap-2">
              {state.participants.map((p) => (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                    p.connected
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-700 bg-slate-800/40 text-slate-400"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      p.connected ? "bg-emerald-400" : "bg-slate-500"
                    }`}
                  />
                  {p.name}
                  {state.scores[p.id] ? (
                    <span className="ml-1 rounded-full bg-slate-700/80 px-1.5 py-0.5 text-xs font-mono text-slate-200">
                      {state.scores[p.id]}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">
              Waiting for participants to join…
            </p>
          )}

          {phase === "playing" && state?.track && state.playStartedAt && (
            <MusicPlayer
              track={state.track}
              playStartedAt={state.playStartedAt}
              durationMs={state.musicDurationMs}
              stopAt={state.firstClickAt}
              clockSkewMs={clockSkewMs}
            />
          )}

          {phase === "done" && state?.track && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 text-center text-sm">
              <p className="text-xs uppercase tracking-widest text-slate-400">
                Round track
              </p>
              <p className="font-semibold text-slate-100">{state.track.title}</p>
              <p className="text-slate-400">{state.track.artist}</p>
            </div>
          )}

          {(phase === "playing" || phase === "done") && state && (
            <div className="rounded-xl bg-slate-800/40 p-3">
              <Leaderboard
                clicks={state.clicks}
                winnerId={state.lastWinnerId}
                onAward={
                  state.lastWinnerId
                    ? undefined
                    : (id) => send({ type: "award", participantId: id })
                }
              />
              {!state.lastWinnerId && state.clicks.length > 0 && (
                <p className="mt-3 px-1 text-center text-xs text-slate-400">
                  <span className="text-emerald-300">Award</span> a winner, or
                  use <span className="text-red-300">−1</span> on the scoreboard
                  to penalize someone.
                </p>
              )}
            </div>
          )}

          <div className="mt-auto flex flex-col gap-3">
            {/* Music source */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs uppercase tracking-widest text-slate-400">
                  Music source
                </p>
                {state?.spotifyUser ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                      ✓ {state.spotifyUser.displayName}
                    </span>
                    <button
                      onClick={() => send({ type: "disconnectSpotify" })}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <a
                    href={`/api/spotify/connect?room=${code}`}
                    className="rounded-md bg-[#1DB954] hover:bg-[#1ed760] px-3 py-1 text-xs font-semibold text-white"
                  >
                    Connect Spotify
                  </a>
                )}
              </div>
              {state?.spotifyUser && !state?.playlist && !playlistEditing && (
                <button
                  onClick={openPicker}
                  className="mb-2 w-full rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20"
                >
                  Pick one of your playlists
                </button>
              )}
              {state?.playlist && !playlistEditing ? (
                <div className="flex items-center gap-3">
                  {state.playlist.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={state.playlist.imageUrl}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded-md object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {state.playlist.name}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {state.playlist.owner} · {state.playlist.trackCount}{" "}
                      tracks
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setPlaylistInput("");
                      setPlaylistEditing(true);
                    }}
                    className="rounded-md border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800"
                  >
                    Change
                  </button>
                  <button
                    onClick={() => send({ type: "clearPlaylist" })}
                    className="rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!playlistInput.trim()) return;
                    send({ type: "setPlaylist", input: playlistInput.trim() });
                    setPlaylistEditing(false);
                  }}
                  className="flex flex-col gap-2"
                >
                  <input
                    value={playlistInput}
                    onChange={(e) => setPlaylistInput(e.target.value)}
                    placeholder="https://open.spotify.com/playlist/…"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm placeholder-slate-500 focus:border-fuchsia-400 focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex-1 rounded-md bg-emerald-500/90 hover:bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      Use playlist
                    </button>
                    {state?.playlist && (
                      <button
                        type="button"
                        onClick={() => setPlaylistEditing(false)}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Paste a <span className="text-fuchsia-300">public</span>{" "}
                    Spotify playlist URL. Tracks without a Spotify preview
                    auto-fall-back to iTunes.
                  </p>
                </form>
              )}
              {!state?.playlist && !playlistEditing && (
                <p className="text-xs text-slate-500">
                  {state?.spotifyUser
                    ? "Pick a playlist above, or paste any Spotify playlist URL."
                    : "Using random popular charts. Connect Spotify to use your own playlists."}
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => send({ type: "start" })}
                disabled={!canStart}
                className="flex-1 rounded-xl bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-3 text-lg font-semibold transition"
              >
                {state?.roundNumber === 0
                  ? "Start round"
                  : phase === "done" || phase === "lobby"
                    ? `Start round ${(state?.roundNumber ?? 0) + 1}`
                    : "Round in progress…"}
              </button>
              {phase !== "lobby" && (
                <button
                  onClick={() => send({ type: "reset" })}
                  className="rounded-xl border border-slate-600 hover:bg-slate-800 px-4 py-3 text-sm font-medium"
                >
                  Cancel
                </button>
              )}
            </div>
            {error && (
              <p className="text-center text-sm text-red-400">{error}</p>
            )}
          </div>
        </section>

        {/* Scoreboard panel */}
        <section className="flex flex-col gap-5 rounded-2xl border border-slate-700 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Scoreboard</h2>
            {(state?.participants.length ?? 0) > 0 && totalScored > 0 && (
              <button
                onClick={() => {
                  if (confirmClear) {
                    send({ type: "clearScores" });
                    setConfirmClear(false);
                  } else {
                    setConfirmClear(true);
                    setTimeout(() => setConfirmClear(false), 4000);
                  }
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  confirmClear
                    ? "bg-red-500 hover:bg-red-400 text-white"
                    : "border border-slate-600 hover:bg-slate-800 text-slate-300"
                }`}
              >
                {confirmClear ? "Confirm clear" : "Clear scores"}
              </button>
            )}
          </div>
          {state && (
            <Scoreboard
              participants={state.participants}
              scores={state.scores}
              lastWinnerId={state.lastWinnerId}
              onAddPoint={(id) => send({ type: "addPoint", participantId: id })}
              onDeduct={(id) => send({ type: "deduct", participantId: id })}
            />
          )}
        </section>
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-700 p-4">
              <h3 className="text-lg font-semibold">Your Spotify playlists</h3>
              <button
                onClick={() => setPickerOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {pickerLoading ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  Loading…
                </p>
              ) : myPlaylists.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  No playlists found.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {myPlaylists.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => {
                          send({ type: "setPlaylist", input: p.id });
                          setPickerOpen(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-800"
                      >
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.imageUrl}
                            alt=""
                            width={40}
                            height={40}
                            className="h-10 w-10 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 shrink-0 rounded-md bg-slate-700" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {p.name}
                          </p>
                          <p className="truncate text-xs text-slate-400">
                            {p.trackCount} tracks · {p.owner}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

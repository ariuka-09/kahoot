"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useRoomSocket } from "../../../lib/useRoomSocket";
import {
  getOrCreateParticipantId,
  recallName,
  rememberName,
} from "../../../lib/participant";
import { Leaderboard } from "../../../components/Leaderboard";
import { Scoreboard } from "../../../components/Scoreboard";
import { MusicPlayer } from "../../../components/MusicPlayer";

function ordinalSuffix(n: number) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function PlayInner({ code }: { code: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const [participantId] = useState(() => getOrCreateParticipantId());
  const [name] = useState<string | null>(() => {
    const n = (search.get("name") ?? recallName()).trim().slice(0, 24);
    if (!n) return null;
    rememberName(n);
    return n;
  });
  const [audioArmed, setAudioArmed] = useState(false);

  useEffect(() => {
    if (!name) router.replace(`/join?code=${code}`);
  }, [name, code, router]);

  const enabled = Boolean(participantId && name);
  const { state, status, error, clockSkewMs, send } = useRoomSocket({
    code,
    role: "participant",
    participantId,
    name: name ?? "",
    enabled,
  });

  const armAudio = () => {
    // Play a one-frame silent buffer to grant the page audio permission.
    const a = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
    );
    a.play()
      .then(() => setAudioArmed(true))
      .catch(() => setAudioArmed(true)); // even on failure, mark as tried
  };

  if (!name || !participantId) {
    return <p className="text-slate-400">Loading…</p>;
  }

  const phase = state?.phase ?? "lobby";
  const myClick = state?.clicks.find((c) => c.participantId === participantId);
  const myPosition = myClick
    ? state!.clicks.findIndex((c) => c.participantId === participantId) + 1
    : null;
  const acceptingClicks = phase === "playing" && !myClick;
  const iWonThisRound = state?.lastWinnerId === participantId;
  const myScore = state?.scores[participantId] ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400">
            Room · R{state?.roundNumber ?? 0}
          </p>
          <p className="font-mono text-xl tracking-widest text-fuchsia-300">
            {code}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">{name}</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-300">
            {myScore} <span className="text-sm text-slate-400">pts</span>
          </p>
        </div>
      </header>

      <div
        className={`rounded-full px-3 py-1 text-center text-xs font-semibold uppercase tracking-wider ${
          status === "open"
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-amber-500/20 text-amber-300"
        }`}
      >
        {status}
      </div>

      {!audioArmed && (
        <button
          onClick={armAudio}
          className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200 hover:bg-amber-400/20"
        >
          🔊 Tap to enable sound for this room
        </button>
      )}

      {iWonThisRound && phase === "done" && (
        <div className="rounded-2xl border border-amber-400/60 bg-amber-400/15 px-4 py-3 text-center text-amber-200">
          <span className="text-lg font-semibold">★ You won the round!</span>
          <p className="text-xs text-amber-300/80">+1 point</p>
        </div>
      )}

      {phase === "lobby" && (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <div className="h-3 w-3 animate-pulse rounded-full bg-fuchsia-400" />
          <p className="text-lg text-slate-300">Waiting for host to start…</p>
          <p className="text-sm text-slate-500">
            {state?.participants.length ?? 0} player
            {(state?.participants.length ?? 0) === 1 ? "" : "s"} in the room
          </p>
        </div>
      )}

      {phase === "playing" && state?.track && state.playStartedAt && (
        <MusicPlayer
          track={state.track}
          playStartedAt={state.playStartedAt}
          durationMs={state.musicDurationMs}
          stopAt={state.firstClickAt}
          clockSkewMs={clockSkewMs}
          blindfold
        />
      )}

      {(phase === "playing" || phase === "done") && (
        <div className="flex flex-col gap-5">
          <button
            onClick={() => send({ type: "click" })}
            disabled={!acceptingClicks}
            className={`relative aspect-square w-full rounded-full text-4xl font-bold transition-all ${
              acceptingClicks
                ? "bg-fuchsia-500 hover:bg-fuchsia-400 active:scale-95 shadow-2xl shadow-fuchsia-500/50"
                : iWonThisRound
                  ? "bg-amber-400 text-slate-900 shadow-2xl shadow-amber-400/40"
                  : myClick
                    ? "bg-slate-700 text-slate-300"
                    : "bg-slate-800 text-slate-500"
            }`}
          >
            {iWonThisRound
              ? "★ WON"
              : myClick && myPosition != null
                ? `${myPosition}${ordinalSuffix(myPosition)}`
                : acceptingClicks
                  ? "CLICK!"
                  : "Wait…"}
            {myClick && (
              <span className="absolute bottom-8 left-0 right-0 text-base font-normal text-slate-400">
                {myClick.elapsedMs}ms
              </span>
            )}
          </button>

          {state?.lastWinnerId && state?.track && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-center text-sm">
              <p className="text-xs uppercase tracking-widest text-amber-300">
                Won by{" "}
                {state.participants.find(
                  (p) => p.id === state.lastWinnerId,
                )?.name ?? "someone"}
              </p>
              <p className="mt-1 font-semibold text-slate-100">
                {state.track.title}
              </p>
              <p className="text-slate-400">{state.track.artist}</p>
            </div>
          )}

          {state && state.clicks.length > 0 && (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
                Click order
              </h2>
              <Leaderboard
                clicks={state.clicks}
                highlightId={participantId}
                winnerId={state.lastWinnerId}
              />
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Scoreboard
        </h2>
        {state && (
          <Scoreboard
            participants={state.participants}
            scores={state.scores}
            lastWinnerId={state.lastWinnerId}
            highlightId={participantId}
          />
        )}
      </div>

      {error && <p className="text-center text-sm text-red-400">{error}</p>}
    </div>
  );
}

export default function PlayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = use(params);
  const code = raw.toUpperCase();
  return (
    <main className="flex flex-1 flex-col p-6">
      <Suspense fallback={<p className="text-slate-400">Loading…</p>}>
        <PlayInner code={code} />
      </Suspense>
    </main>
  );
}

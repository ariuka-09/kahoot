"use client";

import type { Click } from "../worker/protocol";

export function Leaderboard({
  clicks,
  highlightId,
  winnerId,
  onAward,
}: {
  clicks: Click[];
  highlightId?: string;
  winnerId?: string | null;
  onAward?: (participantId: string) => void;
}) {
  if (clicks.length === 0) {
    return (
      <p className="text-center text-sm text-slate-400">
        No clicks yet.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {clicks.map((c, i) => {
        const isMe = highlightId && c.participantId === highlightId;
        const isWinner = winnerId === c.participantId;
        return (
          <li
            key={c.participantId}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 gap-3 ${
              isWinner
                ? "border-amber-400 bg-amber-400/15"
                : i === 0
                  ? "border-amber-400/60 bg-amber-400/5"
                  : isMe
                    ? "border-fuchsia-400 bg-fuchsia-400/10"
                    : "border-slate-700 bg-slate-800/40"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  i === 0
                    ? "bg-amber-400 text-slate-900"
                    : "bg-slate-700 text-slate-200"
                }`}
              >
                {i + 1}
              </span>
              <span className="truncate text-lg font-medium">
                {c.name}{" "}
                {isMe && (
                  <span className="text-fuchsia-300 text-sm">(you)</span>
                )}
                {isWinner && (
                  <span className="ml-1 text-amber-300 text-sm">
                    ★ winner
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-sm text-slate-300">
                {i === 0 ? "1st" : `+${c.elapsedMs - clicks[0].elapsedMs}ms`}
                <span className="ml-2 text-slate-500">{c.elapsedMs}ms</span>
              </span>
              {onAward && !winnerId && (
                <button
                  onClick={() => onAward(c.participantId)}
                  className="rounded-lg bg-emerald-500/90 hover:bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-white transition"
                >
                  Award
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

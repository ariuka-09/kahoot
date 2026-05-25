"use client";

import type { Participant } from "../worker/protocol";

type Row = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
};

export function Scoreboard({
  participants,
  scores,
  lastWinnerId,
  highlightId,
  onDeduct,
  onAddPoint,
}: {
  participants: Participant[];
  scores: Record<string, number>;
  lastWinnerId: string | null;
  highlightId?: string;
  onDeduct?: (participantId: string) => void;
  onAddPoint?: (participantId: string) => void;
}) {
  const rows: Row[] = participants
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: scores[p.id] ?? 0,
      connected: p.connected,
    }))
    // Include any participant who has scored but might have left.
    .concat(
      Object.entries(scores)
        .filter(([id]) => !participants.some((p) => p.id === id))
        .map(([id, score]) => ({
          id,
          name: "(left)",
          score,
          connected: false,
        })),
    )
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  if (rows.length === 0) {
    return (
      <p className="text-center text-sm text-slate-400">
        No players yet.
      </p>
    );
  }

  const topScore = rows[0]?.score ?? 0;

  return (
    <ol className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const isLeader = r.score > 0 && r.score === topScore;
        const isMe = highlightId && r.id === highlightId;
        const justWon = lastWinnerId === r.id;
        return (
          <li
            key={r.id}
            className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
              justWon
                ? "border-amber-400 bg-amber-400/15"
                : isLeader
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : isMe
                    ? "border-fuchsia-400/40 bg-fuchsia-400/5"
                    : "border-slate-700 bg-slate-800/30"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-6 text-right text-sm text-slate-400 tabular-nums">
                {i + 1}.
              </span>
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  r.connected ? "bg-emerald-400" : "bg-slate-600"
                }`}
              />
              <span className="truncate font-medium">
                {r.name}
                {isMe && (
                  <span className="ml-1.5 text-fuchsia-300 text-xs">
                    (you)
                  </span>
                )}
                {justWon && (
                  <span className="ml-1.5 text-amber-300 text-xs">
                    +1
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`font-mono text-lg font-semibold tabular-nums ${
                  r.score < 0 ? "text-red-400" : ""
                }`}
              >
                {r.score}
              </span>
              {onAddPoint && (
                <button
                  onClick={() => onAddPoint(r.id)}
                  title={`Give a point to ${r.name}`}
                  className="rounded-md border border-emerald-500/40 px-2 py-0.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/15"
                >
                  +1
                </button>
              )}
              {onDeduct && (
                <button
                  onClick={() => onDeduct(r.id)}
                  title={`Subtract a point from ${r.name}`}
                  className="rounded-md border border-red-500/40 px-2 py-0.5 text-xs font-bold text-red-300 hover:bg-red-500/15"
                >
                  −1
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

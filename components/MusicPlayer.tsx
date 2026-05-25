"use client";

import { useEffect, useRef, useState } from "react";
import type { Track } from "../worker/protocol";

type Props = {
  track: Track;
  /** Server timestamp (ms since epoch) when audio should start. */
  playStartedAt: number;
  /** Hard cap if nobody clicks. */
  durationMs: number;
  /** Server timestamp at which a click landed — music stops immediately when this is set. */
  stopAt: number | null;
  /** Skew (serverNow - clientNow) used to translate timestamps to local clock. */
  clockSkewMs: number;
  /** Hide track title/artist (e.g. on participant view to keep guessing fair). */
  blindfold?: boolean;
};

export function MusicPlayer({
  track,
  playStartedAt,
  durationMs,
  stopAt,
  clockSkewMs,
  blindfold = false,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stopReached, setStopReached] = useState(false);
  const stopped = stopAt != null && stopReached;

  // Set up + tear down the audio element + scheduling.
  useEffect(() => {
    const audio = new Audio(track.previewUrl);
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    const localStart = playStartedAt - clockSkewMs;
    const delay = Math.max(0, localStart - Date.now());
    let playTimer: ReturnType<typeof setTimeout> | null = null;
    let endTimer: ReturnType<typeof setTimeout> | null = null;
    let progressTimer: ReturnType<typeof setInterval> | null = null;

    const beginPlayback = async () => {
      try {
        await audio.play();
        setBlocked(false);
      } catch {
        setBlocked(true);
      }
      progressTimer = setInterval(() => {
        const elapsed = Date.now() - localStart;
        setProgress(Math.min(1, Math.max(0, elapsed / durationMs)));
      }, 50);
      endTimer = setTimeout(() => {
        audio.pause();
        if (progressTimer) clearInterval(progressTimer);
        setProgress(1);
      }, durationMs);
    };

    playTimer = setTimeout(beginPlayback, delay);

    return () => {
      if (playTimer) clearTimeout(playTimer);
      if (endTimer) clearTimeout(endTimer);
      if (progressTimer) clearInterval(progressTimer);
      try {
        audio.pause();
      } catch {}
      audio.src = "";
      audioRef.current = null;
    };
  }, [track.previewUrl, playStartedAt, durationMs, clockSkewMs]);

  // Stop on first-click signal from server.
  useEffect(() => {
    if (stopAt == null) return;
    const localStop = stopAt - clockSkewMs;
    const delay = Math.max(0, localStop - Date.now());
    const t = setTimeout(() => {
      try {
        audioRef.current?.pause();
      } catch {}
      setStopReached(true);
    }, delay);
    return () => clearTimeout(t);
  }, [stopAt, clockSkewMs]);

  const resume = () => {
    const audio = audioRef.current;
    if (!audio || stopped) return;
    audio
      .play()
      .then(() => setBlocked(false))
      .catch(() => setBlocked(true));
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={track.artworkUrl}
          alt={blindfold ? "Album artwork" : `${track.title} cover`}
          width={160}
          height={160}
          className={`h-40 w-40 rounded-2xl shadow-2xl shadow-black/40 transition-all ${
            blindfold ? "blur-2xl saturate-150" : ""
          } ${stopped ? "grayscale opacity-40" : ""}`}
        />
        {!stopped && (
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-fuchsia-400/60 animate-pulse"
            aria-hidden
          />
        )}
        {stopped && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
            <span className="rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-amber-200 ring-1 ring-amber-300/40">
              ⏸ stopped
            </span>
          </div>
        )}
      </div>

      {!blindfold && (
        <div className="text-center">
          <p className="text-lg font-semibold leading-tight">{track.title}</p>
          <p className="text-sm text-slate-400">{track.artist}</p>
        </div>
      )}
      {blindfold && (
        <p className="text-sm uppercase tracking-widest text-slate-400">
          {stopped ? "Locked in!" : "Click as soon as you know it"}
        </p>
      )}

      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-[width] duration-75 ${
            stopped
              ? "bg-amber-300"
              : "bg-gradient-to-r from-fuchsia-400 to-amber-300"
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {blocked && !stopped && (
        <button
          onClick={resume}
          className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
        >
          Tap to play sound
        </button>
      )}
    </div>
  );
}

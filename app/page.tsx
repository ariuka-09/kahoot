"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error("could not create room");
      const { code } = (await res.json()) as { code: string };
      router.push(`/host/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
      setCreating(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="text-center">
          <h1 className="text-5xl font-bold tracking-tight">Klick</h1>
          <p className="mt-3 text-slate-300">
            Host a room. First click after the countdown wins.
          </p>
        </header>

        <button
          onClick={createRoom}
          disabled={creating}
          className="w-full rounded-2xl bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-50 px-6 py-4 text-lg font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition"
        >
          {creating ? "Creating…" : "Host a new room"}
        </button>

        <div className="flex items-center gap-4 text-slate-400">
          <div className="h-px flex-1 bg-slate-700" />
          <span className="text-xs uppercase tracking-wider">or</span>
          <div className="h-px flex-1 bg-slate-700" />
        </div>

        <Link
          href="/join"
          className="w-full rounded-2xl border border-slate-600 bg-slate-800/50 hover:bg-slate-800 px-6 py-4 text-center text-lg font-semibold text-white transition"
        >
          Join a room
        </Link>

        {error && (
          <p className="text-center text-sm text-red-400">{error}</p>
        )}
      </div>
    </main>
  );
}

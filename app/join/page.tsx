"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { rememberName, recallName } from "../../lib/participant";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialCode = (params.get("code") ?? "").toUpperCase();
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(() => recallName());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim().slice(0, 24);
    if (!cleanCode || !cleanName) {
      setError("Enter both code and name");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${cleanCode}`);
      const { exists } = (await res.json()) as { exists: boolean };
      if (!exists) {
        setError("That room doesn't exist.");
        setLoading(false);
        return;
      }
      rememberName(cleanName);
      router.push(`/play/${cleanCode}?name=${encodeURIComponent(cleanName)}`);
    } catch {
      setError("Network error");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-5">
      <h1 className="text-3xl font-bold">Join a room</h1>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-slate-300">Room code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={8}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="ABC123"
          className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-3 text-2xl font-mono tracking-widest text-center uppercase focus:outline-none focus:border-fuchsia-400"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-slate-300">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoComplete="off"
          placeholder="Alex"
          className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-3 text-lg focus:outline-none focus:border-fuchsia-400"
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-50 px-6 py-3 text-lg font-semibold transition"
      >
        {loading ? "Joining…" : "Join"}
      </button>
    </form>
  );
}

export default function JoinPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense fallback={<p className="text-slate-400">Loading…</p>}>
        <JoinForm />
      </Suspense>
    </main>
  );
}

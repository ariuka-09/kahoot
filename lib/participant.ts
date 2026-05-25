export function getOrCreateParticipantId(): string {
  if (typeof window === "undefined") return "";
  const key = "klick.participantId";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  return id;
}

export function rememberName(name: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("klick.name", name);
}

export function recallName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("klick.name") ?? "";
}

// lib/saveUserSettings.js
export async function saveUserSettings(payload) {
  const res = await fetch("/api/user-settings/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d?.ok) {
    throw new Error(d?.error || `HTTP ${res.status}`);
  }
  return d;
}

// lib/kis.server.js

// ✅ dev HMR에도 유지되는 전역 캐시(한 번만 선언)
const G = globalThis;
if (!G.__KIS_TOKEN__)     G.__KIS_TOKEN__     = { value: null, exp: 0, pending: null };
if (!G.__KIS_APPROVAL__)  G.__KIS_APPROVAL__  = { value: null, exp: 0, pending: null };

/* ───────── 공통 유틸 ───────── */
function safeJSON(txt) { try { return JSON.parse(txt); } catch { return null; } }
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
function extractEGWCode(txt) {
  const j = typeof txt === "string" ? safeJSON(txt) : null;
  if (j && typeof j === "object") {
    if (j.error_code) return String(j.error_code);
    if (j.code)       return String(j.code);
  }
  if (typeof txt === "string") {
    const m = txt.match(/EGW\d{5}/);
    if (m) return m[0];
  }
  return null;
}
function joinURL(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

/* ───────── 접근 토큰 ─────────
   - 유효 토큰 재사용(만료 1분 전부터 갱신)
   - 동시호출 묶기(pending 공유)
   - EGW00133(1분 1회 제한) → 1회 62초 대기 후 재시도
*/
export async function getKisToken() {
  const c = G.__KIS_TOKEN__;
  const now = Date.now();

  // 1) 아직 유효하면 재사용
  if (c.value && now < c.exp - 60_000) return c.value;

  // 2) 갱신 중이면 그 약속에 편승
  if (c.pending) return c.pending;

  // 3) 새로 발급
  c.pending = (async () => {
    const url = joinURL(process.env.KIS_BASE, process.env.KIS_TOKEN_URL ?? "/oauth2/tokenP");
    let retried = false;

    while (true) {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey: process.env.KIS_APP_KEY,
          appsecret: process.env.KIS_APP_SECRET,
        }),
        cache: "no-store",
      });
      const txt = await r.text().catch(() => "");

      if (!r.ok) {
        const code = extractEGWCode(txt);

        // ⛔ 1분에 1회 제한 -> 1회만 대기 후 재시도
        if (code === "EGW00133" && !retried) {
          retried = true;
          // 혹시 직전에 받아둔 토큰이 아직 유효하면 그걸 그냥 반환
          if (c.value && Date.now() < c.exp - 60_000) return c.value;
          await sleep(62_000);
          continue;
        }
        throw new Error(`KIS token failed: ${txt || r.status}`);
      }

      const d = safeJSON(txt);
      if (!d?.access_token) throw new Error("KIS token parse error");

      c.value = String(d.access_token);
      const ttl = Number(d.expires_in);
      c.exp = Date.now() + (Number.isFinite(ttl) ? ttl * 1000 : 3600_000); // 기본 1시간
      return c.value;
    }
  })();

  try {
    return await c.pending;
  } finally {
    c.pending = null;
  }
}

/* ───────── WS 승인키 ─────────
   - 약 23시간 캐시
   - 동시호출 묶기
*/
export async function getKisApproval() {
  const c = G.__KIS_APPROVAL__;
  const now = Date.now();
  if (c.value && now < c.exp - 60_000) return c.value;
  if (c.pending) return c.pending;

  c.pending = (async () => {
    const url = joinURL(process.env.KIS_BASE, process.env.KIS_APPROVAL_URL ?? "/oauth2/Approval");
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: process.env.KIS_APP_KEY,
        secretkey: process.env.KIS_APP_SECRET, // ✅ Approval은 secretkey 필드명
      }),
      cache: "no-store",
    });
    const txt = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`KIS approval failed: ${txt || r.status}`);

    const d = safeJSON(txt);
    const key = d?.approval_key ? String(d.approval_key) : "";
    if (!key) throw new Error("approval_key missing");
    c.value = key;
    c.exp = Date.now() + 23 * 60 * 60 * 1000; // 23시간
    return key;
  })();

  try {
    return await c.pending;
  } finally {
    c.pending = null;
  }
}

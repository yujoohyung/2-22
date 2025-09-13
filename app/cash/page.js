"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import { createClient } from "@supabase/supabase-js";

/* ===== Supabase Client (클라) – 세션 토큰 얻기 용도만 ===== */
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/* ===== Access Token 헬퍼 ===== */
async function getAccessToken() {
  try {
    const { data } = await supa.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

/* ===== 가격 훅 (폴링 + 캐시 폴백) ===== */
const MOCK_PRICE = { NASDAQ2X: 11500, BIGTECH2X: 9800 };
function useLivePrice(symbol, { intervalMs = 4000 } = {}) {
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    let aborted = false;
    const key = `price:${symbol}`;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/price/last?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (aborted) return;
        const p = Number(data?.price);
        if (Number.isFinite(p)) {
          setPrice(p);
          localStorage.setItem(key, JSON.stringify({ price: p, asOf: data?.asOf ?? new Date().toISOString() }));
        } else {
          throw new Error("invalid");
        }
      } catch {
        try {
          const cached = JSON.parse(localStorage.getItem(key) || "null");
          if (!aborted && Number.isFinite(Number(cached?.price))) {
            setPrice(Number(cached.price));
            return;
          }
        } catch {}
        if (!aborted && MOCK_PRICE[symbol] != null) setPrice(MOCK_PRICE[symbol]);
      } finally {
        if (!aborted) setLoading(false);
      }
    };

    fetchOnce();
    clearInterval(timerRef.current);
    timerRef.current = setInterval(fetchOnce, intervalMs);

    const onVis = () => { if (document.visibilityState === "visible") fetchOnce(); };
    const onFocus = () => fetchOnce();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      aborted = true;
    };
  }, [symbol, intervalMs]);

  return { price, loading };
}

/* ===== 포맷터 ===== */
const won = (n) => Number(n ?? 0).toLocaleString("ko-KR") + "원";
const pct = (n) => `${Number(n ?? 0).toFixed(2)}%`;

/* ===== rbHistory 가공 (표시용) ===== */
const RB_KEY = "rbHistory";
const REMAP_DISPLAY = { dashboard: "NASDAQ2X", stock2: "BIGTECH2X" };
const mapForDisplay = (s) => REMAP_DISPLAY[s] || s;

function summarizeForDisplay(raw = []) {
  const map = new Map();
  for (const r0 of Array.isArray(raw) ? raw : []) {
    const date = r0?.date;
    const symbol = mapForDisplay(r0?.symbol);
    const qtyInt = Math.floor(Number(r0?.qty || 0));
    const priceInt = Math.floor(Number(r0?.price || 0));
    const amtInt = Math.floor(Number(r0?.amount ?? priceInt * qtyInt));
    if (!date || !symbol || qtyInt <= 0 || amtInt <= 0) continue;

    const k = `${date}__${symbol}`;
    const prev = map.get(k) || { date, symbol, amount: 0, qty: 0 };
    map.set(k, { date, symbol, amount: prev.amount + amtInt, qty: prev.qty + qtyInt });
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/* ===== 페이지 ===== */
export default function CashDashboardPage() {
  const yearlyBudgetStore = useAppStore((s) => s.yearlyBudget);
  const { setYearlyBudget, setStepQty } = useAppStore();
  const trades = useAppStore((s) => s.trades || {});

  /* 사용자별 입력값 */
  const [yearlyInput, setYearlyInput] = useState(0);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    (async () => {
      setLoadingUser(true);
      try {
        const token = await getAccessToken();
        console.log("🟢 [Cash] me 요청 토큰:", token);
        if (!token) throw new Error("not-signed-in");
        const res = await fetch("/api/user-settings/me", {
          headers: { Authorization: `Bearer ${token}`, "cache-control": "no-store" }
        });
        const d = await res.json();
        console.log("🟢 [Cash] me 응답:", d);
        if (d?.ok && d.data) {
          const yb = Number(d.data.yearly_budget ?? d.data.deposit ?? 0) || 0;
          setYearlyInput(yb);
          setYearlyBudget(yb);
        }
      } catch {
        console.warn("⚠️ [Cash] 로그인 안 됨 → 기본값 0 유지");
      } finally {
        setLoadingUser(false);
      }
    })();
  }, [setYearlyBudget]);

  const { price: priceNasdaq2x, loading: loadingN } = useLivePrice("NASDAQ2X", { intervalMs: 4000 });
  const { price: priceBigtech2x, loading: loadingB } = useLivePrice("BIGTECH2X", { intervalMs: 4000 });

  const { evalAmt, evalSum } = useMemo(() => {
    const listN = Array.isArray(trades.dashboard) ? trades.dashboard : [];
    const listB = Array.isArray(trades.stock2) ? trades.stock2 : [];
    const sumBuy = (arr) => arr.reduce((s, t) => s + (Number(t.qty) || 0), 0);
    const sumSell = (arr) => arr.reduce((s, t) => s + (Number(t.sellQty) || 0), 0);
    const remQtyN = Math.max(0, sumBuy(listN) - sumSell(listN));
    const remQtyB = Math.max(0, sumBuy(listB) - sumSell(listB));
    const pN = Number(priceNasdaq2x || 0);
    const pB = Number(priceBigtech2x || 0);
    const evalN = remQtyN > 0 && pN > 0 ? remQtyN * pN : 0;
    const evalB = remQtyB > 0 && pB > 0 ? remQtyB * pB : 0;
    return { evalAmt: { nasdaq2x: Math.round(evalN), bigtech2x: Math.round(evalB) }, evalSum: Math.round(evalN + evalB) };
  }, [trades, priceNasdaq2x, priceBigtech2x]);

  const [displayRb, setDisplayRb] = useState([]);
  useEffect(() => {
    const refresh = () => {
      try { setDisplayRb(summarizeForDisplay(JSON.parse(localStorage.getItem(RB_KEY) || "[]"))); }
      catch { setDisplayRb([]); }
    };
    refresh();
    let ch;
    try { ch = new BroadcastChannel("rb"); ch.onmessage = refresh; } catch {}
    const onStorage = (e) => { if (e.key === RB_KEY) refresh(); };
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", refresh);
      try { ch && ch.close(); } catch {}
    };
  }, []);

  const weights = { nasdaq2x: 0.6, bigtech2x: 0.4 };
  const monthlyExpect = useMemo(() => ({
    nasdaq2x: Math.round((yearlyInput * weights.nasdaq2x) / 12),
    bigtech2x: Math.round((yearlyInput * weights.bigtech2x) / 12),
  }), [yearlyInput]);

  const stageBuy = useMemo(() => {
    const factor = 0.92; const s1r = 0.14, s2r = 0.26, s3r = 0.60;
    const mN = monthlyExpect.nasdaq2x, mB = monthlyExpect.bigtech2x;
    return {
      s1: { nasdaq2x: Math.round(mN * s1r * factor), bigtech2x: Math.round(mB * s1r * factor) },
      s2: { nasdaq2x: Math.round(mN * s2r * factor), bigtech2x: Math.round(mB * s2r * factor) },
      s3: { nasdaq2x: Math.round(mN * s3r * factor), bigtech2x: Math.round(mB * s3r * factor) },
    };
  }, [monthlyExpect]);

  const adjustedBuy = useMemo(() => ({
    s1: { nasdaq2x: Math.round(stageBuy.s1.nasdaq2x * 1.6), bigtech2x: Math.round(stageBuy.s1.bigtech2x * 0.4) },
    s2: { nasdaq2x: Math.round(stageBuy.s2.nasdaq2x * 1.6), bigtech2x: Math.round(stageBuy.s2.bigtech2x * 0.4) },
    s3: { nasdaq2x: Math.round(stageBuy.s3.nasdaq2x * 1.6), bigtech2x: Math.round(stageBuy.s3.bigtech2x * 0.4) },
  }), [stageBuy]);

  const qtyByStage = useMemo(() => {
    const toQty = (amount, price) => (Number.isFinite(amount) && Number.isFinite(price) && price > 0 ? Math.round(amount / price) : 0);
    return {
      s1: { nasdaq2x: toQty(adjustedBuy.s1.nasdaq2x, priceNasdaq2x), bigtech2x: toQty(adjustedBuy.s1.bigtech2x, priceBigtech2x) },
      s2: { nasdaq2x: toQty(adjustedBuy.s2.nasdaq2x, priceNasdaq2x), bigtech2x: toQty(adjustedBuy.s2.bigtech2x, priceBigtech2x) },
      s3: { nasdaq2x: toQty(adjustedBuy.s3.nasdaq2x, priceNasdaq2x), bigtech2x: toQty(adjustedBuy.s3.bigtech2x, priceBigtech2x) },
    };
  }, [adjustedBuy, priceNasdaq2x, priceBigtech2x]);

  const handleSaveGlobal = async () => {
    console.log("🟢 [Cash] 저장 버튼 클릭됨, 입력값:", yearlyInput);
    useAppStore.getState().setYearlyBudget(yearlyInput);
    setStepQty({
      nasdaq2x: { s1: qtyByStage.s1.nasdaq2x || 0, s2: qtyByStage.s2.nasdaq2x || 0, s3: qtyByStage.s3.nasdaq2x || 0 },
      bigtech2x: { s1: qtyByStage.s1.bigtech2x || 0, s2: qtyByStage.s2.bigtech2x || 0, s3: qtyByStage.s3.bigtech2x || 0 },
    });

    try {
      const token = await getAccessToken();
      console.log("🟢 [Cash] accessToken:", token);
      if (!token) throw new Error("로그인이 필요합니다.");

      const res = await fetch("/api/user-settings/save", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ yearly_budget: Number(yearlyInput || 0) }),
      });
      console.log("🟢 [Cash] fetch 응답 status:", res.status);
      const d = await res.json().catch(() => ({}));
      console.log("🟢 [Cash] fetch 응답 body:", d);
      if (!d?.ok) throw new Error(d?.error || "save failed");
      alert("전역 저장 + 사용자별 DB 저장 완료!");
    } catch (e) {
      console.error("🔴 [Cash] 저장 실패", e);
      alert("저장 실패: " + (e?.message || e));
    }
  };

  return (
    <div className="cash-root">
      {/* ... (원본 UI 그대로 유지) ... */}
      {/* 생략: 너가 올린 TableHeader/Row/KpiBox 컴포넌트 동일 */}
    </div>
  );
}

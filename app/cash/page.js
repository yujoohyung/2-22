// /app/cash/page.jsx
"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import { supa } from "../../lib/supaClient";
import { saveUserSettings } from "../../lib/saveUserSettings";

/* ===== Access Token 헬퍼 ===== */
async function getAccessToken() {
  try {
    const { data } = await supa.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
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
        const res = await fetch(`/api/price?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
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
  const [saving, setSaving] = useState(false);

  // 서버 API에서 “내 값” 로드 (토큰 or 쿠키)
  useEffect(() => {
    (async () => {
      setLoadingUser(true);
      try {
        const token = await getAccessToken();
        const headers = token
          ? { Authorization: `Bearer ${token}`, "cache-control": "no-store" }
          : { "cache-control": "no-store" };

        const res = await fetch("/api/user-settings/me", { headers, cache: "no-store" });
        if (res.status === 401) throw new Error("로그인이 필요합니다.");
        const d = await res.json();

        if (d?.ok && d.data) {
          const yb = Number(d.data.yearly_budget ?? d.data.deposit ?? 0) || 0;
          setYearlyInput(yb);
          setYearlyBudget(yb);
        }
      } catch (e) {
        console.debug("[cash] load me failed:", e?.message || e);
      } finally {
        setLoadingUser(false);
      }
    })();
  }, [setYearlyBudget]);

  /* 실시간 가격 */
  const { price: priceNasdaq2x,  loading: loadingN } = useLivePrice("NASDAQ2X",  { intervalMs: 4000 });
  const { price: priceBigtech2x, loading: loadingB } = useLivePrice("BIGTECH2X", { intervalMs: 4000 });

  /* 누적평가금 */
  const { evalAmt, evalSum } = useMemo(() => {
    const listN = Array.isArray(trades.dashboard) ? trades.dashboard : [];
    const listB = Array.isArray(trades.stock2)   ? trades.stock2   : [];

    const sumBuy  = (arr) => arr.reduce((s, t) => s + (Number(t.qty) || 0), 0);
    const sumSell = (arr) => arr.reduce((s, t) => s + (Number(t.sellQty) || 0), 0);

    const remQtyN = Math.max(0, sumBuy(listN) - sumSell(listN));
    const remQtyB = Math.max(0, sumBuy(listB) - sumSell(listB));

    const pN = Number(priceNasdaq2x || 0);
    const pB = Number(priceBigtech2x || 0);

    const evalN = remQtyN > 0 && pN > 0 ? remQtyN * pN : 0;
    const evalB = remQtyB > 0 && pB > 0 ? remQtyB * pB : 0;

    return {
      evalAmt: { nasdaq2x: Math.round(evalN), bigtech2x: Math.round(evalB) },
      evalSum: Math.round(evalN + evalB),
    };
  }, [trades, priceNasdaq2x, priceBigtech2x]);

  /* 표시용 rbHistory */
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

  /* 분배/수량 계산 */
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

  /* 저장 → 전역 + 서버(DB) */
  const handleSaveGlobal = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // 전역 상태
      useAppStore.getState().setYearlyBudget(yearlyInput);
      setStepQty({
        nasdaq2x: { s1: qtyByStage.s1.nasdaq2x || 0, s2: qtyByStage.s2.nasdaq2x || 0, s3: qtyByStage.s3.nasdaq2x || 0 },
        bigtech2x:{ s1: qtyByStage.s1.bigtech2x || 0, s2: qtyByStage.s2.bigtech2x || 0, s3: qtyByStage.s3.bigtech2x || 0 },
      });

      // 서버 DB 저장
      const out = await saveUserSettings({ yearly_budget: Number(yearlyInput || 0) });
      console.debug("[cash] save result:", out);
      alert("전역 저장 완료! (DB 반영 OK)");
    } catch (e) {
      alert(`저장 실패: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cash-root">
      <h1 className="h1">예치금</h1>

      <div className="grid-two">
        <section className="card card-strong">
          <TableHeader title="구 분" colA="나스닥100 2x(60%)" colB="빅테크7 2x(40%)" />
          <table className="tbl">
            <tbody>
              <Row label="현재 평가금액" a={won(evalAmt.nasdaq2x)} b={won(evalAmt.bigtech2x)} tone="yellow" />
              <Row label="현재 평가금액 합산액" a={won(evalSum)} b="" tone="gray" spanA />
              <Row label="1단계 매수" a={won(adjustedBuy.s1.nasdaq2x)} b={won(adjustedBuy.s1.bigtech2x)} tone="yellow" />
              <Row label="2단계 매수" a={won(adjustedBuy.s2.nasdaq2x)} b={won(adjustedBuy.s2.bigtech2x)} tone="yellow" />
              <Row label="3단계 매수" a={won(adjustedBuy.s3.nasdaq2x)} b={won(adjustedBuy.s3.bigtech2x)} tone="yellow" />
              <Row label="월별 평균 예상 매입금" a={won(monthlyExpect.nasdaq2x)} b={won(monthlyExpect.bigtech2x)} tone="green" />
              <Row label="1년 매수 금액 분배" a={won(yearlyInput * 0.6)} b={won(yearlyInput * 0.4)} tone="strong" />
            </tbody>
          </table>
          <div className="muted">
            현재가 기준: 나스닥100 2x {priceNasdaq2x ? `${priceNasdaq2x.toLocaleString("ko-KR")}원` : "…"} / 빅테크7 2x {priceBigtech2x ? `${priceBigtech2x.toLocaleString("ko-KR")}원` : "…"}
          </div>
        </section>

        <div className="right-col">
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, color: "#b40000", marginBottom: 8 }}>1년 납입금액 (여기만 입력)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              <label style={{ fontSize: 13, color: "#555" }}>납입금</label>
              <input
                type="number" inputMode="numeric"
                value={Number.isFinite(yearlyInput) ? yearlyInput : 0}
                onChange={(e) => setYearlyInput(Number(e.target.value || 0))}
                className="input" placeholder="예: 20000000" disabled={loadingUser || saving}
              />
              <button onClick={handleSaveGlobal} className="btn-primary" disabled={loadingUser || saving}>
                {saving ? "저장중…" : "저장(전역 반영 + DB)"}
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>현재 매수 비율</div>
            <div className="ratio-grid">
              <KpiBox title="나스닥100 2x" value={pct(evalSum ? (evalAmt.nasdaq2x / evalSum) * 100 : 0)} />
              <KpiBox title="빅테크7 2x" value={pct(evalSum ? (evalAmt.bigtech2x / evalSum) * 100 : 0)} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid-two">
        <section className="card card-strong">
          <TableHeader title="(보정치) 실제 매수 금액 산출" colA="나스닥100 2x(60%)" colB="빅테크7 2x(40%)" />
          <table className="tbl">
            <tbody>
              <Row label="1단계 매수" a={won(adjustedBuy.s1.nasdaq2x)} b={won(adjustedBuy.s1.bigtech2x)} />
              <Row label="2단계 매수" a={won(adjustedBuy.s2.nasdaq2x)} b={won(adjustedBuy.s2.bigtech2x)} />
              <Row label="3단계 매수" a={won(adjustedBuy.s3.nasdaq2x)} b={won(adjustedBuy.s3.bigtech2x)} />
              <Row label="1단계 매수 (수량)" a={loadingN ? "…" : `${qtyByStage.s1.nasdaq2x?.toLocaleString("ko-KR") ?? 0}주`} b={loadingB ? "…" : `${qtyByStage.s1.bigtech2x?.toLocaleString("ko-KR") ?? 0}주`} />
              <Row label="2단계 매수 (수량)" a={loadingN ? "…" : `${qtyByStage.s2.nasdaq2x?.toLocaleString("ko-KR") ?? 0}주`} b={loadingB ? "…" : `${qtyByStage.s2.bigtech2x?.toLocaleString("ko-KR") ?? 0}주`} />
              <Row label="3단계 매수 (수량)" a={loadingN ? "…" : `${qtyByStage.s3.nasdaq2x?.toLocaleString("ko-KR") ?? 0}주`} b={loadingB ? "…" : `${qtyByStage.s3.bigtech2x?.toLocaleString("ko-KR") ?? 0}주`} />
            </tbody>
          </table>
          <div className="muted">
            현재가 기준: 나스닥100 2x {priceNasdaq2x ? `${priceNasdaq2x.toLocaleString("ko-KR")}원` : "…"} / 빅테크7 2x {priceBigtech2x ? `${priceBigtech2x.toLocaleString("ko-KR")}원` : "…"}
          </div>
        </section>

        <section className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", fontWeight: 800 }}>리밸런싱 내역</div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>{["날짜", "나스닥2배", "빅테크2배"].map((h) => (<th key={h} className="thSmall">{h}</th>))}</tr>
              </thead>
              <tbody>
                {displayRb.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: 12, textAlign: "center", color: "#777" }}>기록 없음</td></tr>
                ) : displayRb.map((r) => (
                  <tr key={`${r.date}-${r.symbol}`} style={{ borderTop: "1px solid #f0f0f0" }}>
                    <td className="tdSmall">{r.date}</td>
                    <td className="tdSmall tdRight">{r.symbol === "NASDAQ2X" ? `${Number(r.amount).toLocaleString("ko-KR")}원 / ${Number(r.qty).toLocaleString("ko-KR")}주` : ""}</td>
                    <td className="tdSmall tdRight">{r.symbol === "BIGTECH2X" ? `${Number(r.amount).toLocaleString("ko-KR")}원 / ${Number(r.qty).toLocaleString("ko-KR")}주` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <style jsx>{`
        .cash-root { max-width: 1100px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
        .h1 { font-size: 20px; font-weight: 800; }
        .grid-two { display: grid; grid-template-columns: 1fr; gap: 16px; }
        .right-col { display: grid; gap: 12px; }
        @media (min-width: 980px) { .grid-two { grid-template-columns: 1fr 340px; } }
        .card { background: #fff; border: 1px solid #eee; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .card-strong { border: 2px solid #9aa7b1; }
        .tbl { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
        .thSmall { position: sticky; top: 0; background: #f7f7f8; text-align: left; font-size: 12px; font-weight: 700; color: #555; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
        .tdSmall { padding: 8px 10px; font-size: 13px; color: #111; white-space: nowrap; }
        .tdRight { text-align: right; }
        .input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 10px; font-size: 14px; }
        .btn-primary { height: 42px; border-radius: 10px; font-weight: 700; cursor: pointer; background: #0ea5e9; color: #fff; border: 1px solid #0ea5e9; }
        .muted { padding: 8px 12px; font-size: 12px; color: #666; }
        .ratio-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        @media (max-width: 420px) { .ratio-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

/* ===== 재사용 컴포넌트 ===== */
function TableHeader({ title, colA, colB }) {
  return (
    <div
      style={{
        background: "#dde6ef",
        borderBottom: "2px solid #9aa7b1",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 0, fontWeight: 800,
      }}
    >
      <div style={{ padding: "10px 12px", borderRight: "2px solid #9aa7b1" }}>{title}</div>
      <div style={{ padding: "10px 12px", borderRight: "2px solid #9aa7b1", textAlign: "center" }}>{colA}</div>
      <div style={{ padding: "10px 12px", textAlign: "center" }}>{colB}</div>
    </div>
  );
}

function Row({ label, a, b, tone = "default", spanA = false }) {
  const base = {
    padding: "10px 12px",
    borderTop: "1px solid #cbd5e1",
    height: 44, whiteSpace: "nowrap", verticalAlign: "middle",
  };
  const bg =
    tone === "yellow" ? "#fff1cc" :
    tone === "green"  ? "#d7f0da" :
    tone === "strong" ? "#f4f4f5" :
    tone === "gray"   ? "#eef2f7" : "#fff";

  return (
    <tr style={{ background: bg }}>
      <td style={{ ...base, fontWeight: 700, width: 220 }}>{label}</td>
      <td style={{ ...base, textAlign: "right", fontWeight: 700 }}>{a}</td>
      <td style={{ ...base, textAlign: "right", fontWeight: 700 }}>{spanA ? "" : b}</td>
    </tr>
  );
}

function KpiBox({ title, value, tone = "light" }) {
  const bg = tone === "dark" ? "#5f6570" : "#eef2f7";
  const color = tone === "dark" ? "#fff" : "#111";
  return (
    <div style={{ border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", background: bg, color }}>
      <div style={{ fontSize: 12, opacity: 0.9 }}>{title}</div>
      <div style={{ fontWeight: 800, fontSize: 18 }}>{value}</div>
    </div>
  );
}

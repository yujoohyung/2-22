// app/cash/page.jsx  ← 예치금 페이지
"use client";

import { useMemo, useState, useEffect } from "react";
import { useAppStore } from "../store";

/* ===== 가격 훅 ===== */
const MOCK_PRICE = { NASDAQ2X: 11500, BIGTECH2X: 9800 };

function usePrice(symbol) {
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let aborted = false;
    const key = `price:${symbol}`;

    const fetchPrice = async () => {
      setLoading(true);
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
          throw new Error("Invalid price");
        }
      } catch {
        // 캐시 → 모의값 폴백
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

    fetchPrice();
    const onVis = () => { if (document.visibilityState === "visible") fetchPrice(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { aborted = true; document.removeEventListener("visibilitychange", onVis); };
  }, [symbol]);

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
  const yearlyBudget = useAppStore((s) => s.yearlyBudget);
  const { setYearlyBudget, setStepQty } = useAppStore();
  const trades = useAppStore((s) => s.trades || {}); // ✅ 전역 거래내역

  const [yearlyInput, setYearlyInput] = useState(yearlyBudget);
  useEffect(() => { setYearlyInput(yearlyBudget); }, [yearlyBudget]);

  /* ✅ 현재가 */
  const { price: priceNasdaq2x,  loading: loadingN } = usePrice("NASDAQ2X");
  const { price: priceBigtech2x, loading: loadingB } = usePrice("BIGTECH2X");

  /* ✅ 누적평가금: 잔여수량 × 현재가 (잔여수량이 0이면 0원) */
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

  /* ✅ 표시용 rbHistory */
  const [displayRb, setDisplayRb] = useState([]);

  // 저장 포맷 정리(내부키 통일)
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(RB_KEY) || "[]");
      const cleaned = (Array.isArray(raw) ? raw : []).map((r) => {
        const qty = Number(r?.qty || 0);
        const price = Number(r?.price || 0);
        const amount = Number(r?.amount ?? price * qty);
        let symbol = r?.symbol;
        if (symbol === "NASDAQ2X" || symbol === "dashboard") symbol = "dashboard";
        else if (symbol === "BIGTECH2X" || symbol === "stock2" || symbol === "bigtech") symbol = "stock2";
        return { date: r?.date, symbol, qty, amount, price, type: "SELL" };
      }).filter((r) =>
        !!r.date &&
        (r.symbol === "dashboard" || r.symbol === "stock2") &&
        Number.isFinite(r.qty) && Number.isFinite(r.amount) &&
        r.qty > 0 && r.amount > 0
      );
      if (JSON.stringify(raw) !== JSON.stringify(cleaned)) {
        localStorage.setItem(RB_KEY, JSON.stringify(cleaned));
      }
    } catch {}
  }, []);

  // 동기화
  useEffect(() => {
    const refreshFromStorage = () => {
      try {
        const raw = JSON.parse(localStorage.getItem(RB_KEY) || "[]");
        setDisplayRb(summarizeForDisplay(raw));
      } catch { setDisplayRb([]); }
    };
    refreshFromStorage();

    let ch;
    try { ch = new BroadcastChannel("rb"); ch.onmessage = refreshFromStorage; } catch {}
    const onStorage = (e) => { if (e.key === RB_KEY) refreshFromStorage(); };
    const onVis = () => { if (document.visibilityState === "visible") refreshFromStorage(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", refreshFromStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", refreshFromStorage);
      try { ch && ch.close(); } catch {}
    };
  }, []);

  /* ===== 분배/수량 계산 ===== */
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

  const handleSaveGlobal = () => {
    useAppStore.getState().setYearlyBudget(yearlyInput);
    setStepQty({
      nasdaq2x: { s1: qtyByStage.s1.nasdaq2x || 0, s2: qtyByStage.s2.nasdaq2x || 0, s3: qtyByStage.s3.nasdaq2x || 0 },
      bigtech2x:{ s1: qtyByStage.s1.bigtech2x || 0, s2: qtyByStage.s2.bigtech2x || 0, s3: qtyByStage.s3.bigtech2x || 0 },
    });
    alert("전역 저장 완료! (1년 납입금액 + 단계별 수량)");
  };

  /* ===== 리밸런싱 내역 테이블 ===== */
  const historyRows = useMemo(() => {
    const byDate = new Map();
    for (const r of displayRb) {
      const date = r.date;
      const sym = r.symbol; // 'NASDAQ2X' | 'BIGTECH2X' (표시용)
      const body = `${Number(r.amount).toLocaleString("ko-KR")}원 / ${Number(r.qty).toLocaleString("ko-KR")}주`;
      const row = byDate.get(date) || { id: date, date, nasdaq2x: "", bigtech2x: "" };
      if (sym === "NASDAQ2X") row.nasdaq2x = body;
      if (sym === "BIGTECH2X") row.bigtech2x = body;
      byDate.set(date, row);
    }
    return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [displayRb]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>예치금</h1>

      {/* 상단: 좌(분배표) / 우(입력 + KPI) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        <section className="card" style={{ border: "2px solid #9aa7b1", alignSelf: "start" }}>
          <TableHeader title="구 분" colA="나스닥100 2x(60%)" colB="빅테크7 2x(40%)" />
          <table style={tbl}>
            <tbody>
              {/* ✅ 누적평가금 기반 */}
              <Row label="현재 평가금액" a={won(evalAmt.nasdaq2x)} b={won(evalAmt.bigtech2x)} tone="yellow" />
              <Row label="현재 평가금액 합산액" a={won(evalSum)} b="" tone="gray" spanA />
              <Row label="1단계 매수" a={won(adjustedBuy.s1.nasdaq2x)} b={won(adjustedBuy.s1.bigtech2x)} tone="yellow" />
              <Row label="2단계 매수" a={won(adjustedBuy.s2.nasdaq2x)} b={won(adjustedBuy.s2.bigtech2x)} tone="yellow" />
              <Row label="3단계 매수" a={won(adjustedBuy.s3.nasdaq2x)} b={won(adjustedBuy.s3.bigtech2x)} tone="yellow" />
              <Row label="월별 평균 예상 매입금" a={won(monthlyExpect.nasdaq2x)} b={won(monthlyExpect.bigtech2x)} tone="green" />
              <Row label="1년 매수 금액 분배" a={won(yearlyInput * weights.nasdaq2x)} b={won(yearlyInput * weights.bigtech2x)} tone="strong" />
            </tbody>
          </table>
        </section>

        {/* 우측 */}
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800, color: "#b40000", marginBottom: 8 }}>1년 납입금액 (여기만 입력)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              <label style={{ fontSize: 13, color: "#555" }}>납입금</label>
              <input
                type="number" inputMode="numeric"
                value={yearlyInput}
                onChange={(e) => setYearlyInput(Number(e.target.value || 0))}
                style={input} placeholder="예: 20000000"
              />
              <button onClick={handleSaveGlobal} style={{ ...input, cursor: "pointer", fontWeight: 700 }}>
                저장(전역 반영)
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>현재 매수 비율</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <KpiBox title="나스닥100 2x" value={pct(evalSum ? (evalAmt.nasdaq2x / evalSum) * 100 : 0)} />
              <KpiBox title="빅테크7 2x" value={pct(evalSum ? (evalAmt.bigtech2x / evalSum) * 100 : 0)} />
            </div>
          </div>
        </div>
      </div>

      {/* 하단: 산출표 + 리밸런싱 내역 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        <section className="card" style={{ border: "2px solid #9aa7b1", alignSelf: "start" }}>
          <TableHeader title="(보정치) 실제 매수 금액 산출" colA="나스닥100 2x(60%)" colB="빅테크7 2x(40%)" />
          <table style={tbl}>
            <tbody>
              <Row label="1단계 매수" a={won(adjustedBuy.s1.nasdaq2x)} b={won(adjustedBuy.s1.bigtech2x)} />
              <Row label="2단계 매수" a={won(adjustedBuy.s2.nasdaq2x)} b={won(adjustedBuy.s2.bigtech2x)} />
              <Row label="3단계 매수" a={won(adjustedBuy.s3.nasdaq2x)} b={won(adjustedBuy.s3.bigtech2x)} />
              <Row label="1단계 매수 (수량)" a={loadingN ? "…" : `${qtyByStage.s1.nasdaq2x?.toLocaleString("ko-KR") ?? 0}주`} b={loadingB ? "…" : `${qtyByStage.s1.bigtech2x?.toLocaleString("ko-KR") ?? 0}주`} />
              <Row label="2단계 매수 (수량)" a={loadingN ? "…" : `${qtyByStage.s2.nasdaq2x?.toLocaleString("ko-KR") ?? 0}주`} b={loadingB ? "…" : `${qtyByStage.s2.bigtech2x?.toLocaleString("ko-KR") ?? 0}주`} />
              <Row label="3단계 매수 (수량)" a={loadingN ? "…" : `${qtyByStage.s3.nasdaq2x?.toLocaleString("ko-KR") ?? 0}주`} b={loadingB ? "…" : `${qtyByStage.s3.bigtech2x?.toLocaleString("ko-KR") ?? 0}주`} />
            </tbody>
          </table>
          <div style={{ padding: "8px 12px", fontSize: 12, color: "#666" }}>
            현재가 기준: 나스닥100 2x {priceNasdaq2x ? `${priceNasdaq2x.toLocaleString("ko-KR")}원` : "…"} / 빅테크7 2x {priceBigtech2x ? `${priceBigtech2x.toLocaleString("ko-KR")}원` : "…"}
          </div>
        </section>

        {/* 리밸런싱 내역 */}
        <section className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", fontWeight: 800 }}>리밸런싱 내역</div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["날짜", "나스닥2배", "빅테크2배"].map((h) => (<th key={h} style={thSmall}>{h}</th>))}</tr>
              </thead>
              <tbody>
                {historyRows.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: 12, textAlign: "center", color: "#777" }}>기록 없음</td></tr>
                ) : historyRows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                    <td style={tdSmall}>{r.date}</td>
                    <td style={{ ...tdSmall, textAlign: "right" }}>{r.nasdaq2x}</td>
                    <td style={{ ...tdSmall, textAlign: "right" }}>{r.bigtech2x}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ===== 재사용 컴포넌트/스타일 ===== */
function TableHeader({ title, colA, colB }) {
  return (
    <div
      style={{
        background: "#dde6ef",
        borderBottom: "2px solid #9aa7b1",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 0,
        fontWeight: 800,
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
    height: 44,
    whiteSpace: "nowrap",
    verticalAlign: "middle",
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

/* ===== 스타일 상수 ===== */
const tbl = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  tableLayout: "fixed",
};
const thSmall = {
  position: "sticky",
  top: 0,
  background: "#f7f7f8",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 700,
  color: "#555",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
};
const tdSmall = {
  padding: "8px 10px",
  fontSize: 13,
  color: "#111",
  whiteSpace: "nowrap",
};
const input = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #ddd",
  borderRadius: 10,
  fontSize: 14,
};

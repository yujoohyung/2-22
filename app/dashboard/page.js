"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useAppStore } from "../store";

/** 종목코드: TIGER 미국나스닥100레버리지 */
const CODE = "418660";
const SYMBOL = "dashboard";
const OTHER_SYMBOL = "stock2";

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dkey = (s) => (s ? String(s).replace(/-/g, "").slice(0, 8) : "");
const fmt = (n) => (n == null || Number.isNaN(n) ? "-" : Number(n).toLocaleString("ko-KR"));
const pct = (n) => (n == null || Number.isNaN(n) ? "-" : `${Number(n).toFixed(2)}%`);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** RSI (Cutler) */
function calcRSI_Cutler(values, period = 14) {
  const n = values.length;
  const out = Array(n).fill(null);
  if (!Array.isArray(values) || n < period + 1) return out;
  const gains = Array(n).fill(0), losses = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = values[i] - values[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  let sumG = 0, sumL = 0;
  for (let i = 1; i <= period; i++) { sumG += gains[i]; sumL += losses[i]; }
  let avgG = sumG / period, avgL = sumL / period;
  out[period] = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100 / (1 + (avgG / avgL));
  for (let i = period + 1; i < n; i++) {
    sumG += gains[i] - gains[i - period];
    sumL += losses[i] - losses[i - period];
    avgG = sumG / period; avgL = sumL / period;
    out[i] = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100 / (1 + (avgG / avgL));
  }
  return out;
}

export default function DashboardPage() {
  const { trades, addTrade, setTrades, yearlyBudget } = useAppStore();
  const [apiRows, setApiRows] = useState([]);
  const [isDailyReady, setIsDailyReady] = useState(false);
  const [nowQuote, setNowQuote] = useState(null);
  const topTableScrollRef = useRef(null);

  // 수량 계산 공식 (나스닥 14%, 26%, 60%)
  const getQty = (stage, price) => {
    if (!yearlyBudget || !price || price <= 0) return 0;
    const monthlyAvg = yearlyBudget / 12;
    const weights = [0.14, 0.26, 0.60];
    return Math.floor((monthlyAvg * weights[stage - 1] * 0.92) / price);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/kis/daily?code=${CODE}&start=20240101&end=20251231`);
        const d = await res.json();
        const rows = (d.output || []).map(x => ({
          date: x.stck_bsop_date,
          close: Number(x.stck_clpr),
        })).sort((a, b) => a.date.localeCompare(b.date));

        const series = rows.map(r => r.close);
        const rsi = calcRSI_Cutler(series, 14);

        const resRows = rows.map((r, i) => {
          let sig = "";
          const rv = rsi[i];
          if (rv != null) {
            if (rv < 30) sig = "3단계";
            else if (rv < 36) sig = "2단계";
            else if (rv < 43) sig = "1단계";
          }
          return { ...r, signal: sig, rsi: rv };
        });
        setApiRows(resRows);
        setIsDailyReady(true);
      } catch { setIsDailyReady(true); }
    })();
  }, []);

  useEffect(() => {
    if (!isDailyReady) return;
    const es = new EventSource(`/api/kis/stream?code=${CODE}`);
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "tick") setNowQuote({ price: Number(msg.price) });
    };
    return () => es.close();
  }, [isDailyReady]);

  const rows = useMemo(() => {
    const buyMap = new Map();
    (trades[SYMBOL] || []).forEach(t => {
      const k = dkey(t.date);
      buyMap.set(k, (buyMap.get(k) || 0) + Number(t.qty || 0));
    });
    let cum = 0;
    return apiRows.map(r => {
      const q = buyMap.get(dkey(r.date)) || 0;
      cum += q;
      return { ...r, qty: q, cumQty: cum };
    });
  }, [trades, apiRows]);

  const [date, setDate] = useState(todayLocal());
  const [priceIn, setPriceIn] = useState("");
  const [qtyIn, setQtyIn] = useState("");

  return (
    <div style={{ padding: 16 }}>
      <h2>TIGER 미국나스닥100레버리지</h2>
      <div ref={topTableScrollRef} style={{ maxHeight: 400, overflowY: "auto", border: "1px solid #eee" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8f9fa" }}>
              <th>신호</th><th>날짜</th><th>주가</th><th>RSI</th><th>매수</th><th>누적</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isLast = i === rows.length - 1;
              const p = (isLast && nowQuote) ? nowQuote.price : r.close;
              const q1 = getQty(1, p), q2 = getQty(2, p), q3 = getQty(3, p);
              const sigStr = r.signal === "1단계" ? `1단계/${q1}주` : r.signal === "2단계" ? `2단계/${q2}주` : r.signal === "3단계" ? `3단계/${q3}주` : "";
              return (
                <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                  <td>{sigStr}</td><td>{r.date}</td>
                  <td>{fmt(p)}원 {isLast && nowQuote && <small>(LIVE)</small>}</td>
                  <td>{r.rsi?.toFixed(1)}</td><td>{r.qty}</td><td>{r.cumQty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <input type="number" placeholder="주가" value={priceIn} onChange={e => setPriceIn(e.target.value)} />
        <input type="number" placeholder="수량" value={qtyIn} onChange={e => setQtyIn(e.target.value)} />
        <button onClick={() => addTrade(SYMBOL, { date, price: Number(priceIn), qty: Number(qtyIn) })}>매수</button>
      </div>
    </div>
  );
}
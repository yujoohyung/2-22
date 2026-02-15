"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import { useAppStore } from "../store";

const CODE = "418660";
const SYMBOL = "dashboard";
const OTHER_SYMBOL = "stock2";

/* 유틸 함수 생략 (기존과 동일) */
function todayLocal() { const d = new Date(); return d.toISOString().slice(0,10); }
const dkey = (s) => (s ? String(s).replace(/-/g, "").slice(0, 8) : "");
const fmt = (n) => (n == null || Number.isNaN(n) ? "-" : Number(n).toLocaleString("ko-KR"));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
function calcRSI_Cutler(values, period = 14) {
  const n = values.length; const out = Array(n).fill(null);
  if (n < period + 1) return out;
  const gains = Array(n).fill(0), losses = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = values[i] - values[i - 1]; if (d > 0) gains[i] = d; else losses[i] = -d;
  }
  let sumG = 0, sumL = 0; for (let i = 1; i <= period; i++) { sumG += gains[i]; sumL += losses[i]; }
  let avgG = sumG / period, avgL = sumL / period;
  out[period] = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100 / (1 + (avgG / avgL));
  for (let i = period + 1; i < n; i++) {
    sumG += gains[i] - gains[i - period]; sumL += losses[i] - losses[i - period];
    avgG = sumG / period; avgL = sumL / period;
    out[i] = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100 / (1 + (avgG / avgL));
  }
  return out;
}

export default function DashboardPage() {
  const { stepQty, trades, addTrade, setTrades } = useAppStore();
  const [apiRows, setApiRows] = useState([]);
  const [isDailyReady, setIsDailyReady] = useState(false);
  const [nowQuote, setNowQuote] = useState(null);
  const topTableScrollRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { if (!(trades[SYMBOL] || []).length) setTrades(SYMBOL, []); }, []);

  // 150일 데이터만 빠르게 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/kis/daily?code=${CODE}`);
        const json = await res.json();
        let rows = (json.output || []).map(x => ({
          date: x.stck_bsop_date || x.date,
          close: Number(x.stck_clpr || x.close),
          prev: Number(x.prdy_clpr || x.prev)
        })).filter(r => r.date).sort((a,b) => a.date.localeCompare(b.date));

        const map = new Map(); rows.forEach(r => map.set(r.date, r));
        rows = Array.from(map.values());

        const series = rows.map(r => r.close);
        const rsi = calcRSI_Cutler(series, 14);

        const resRows = rows.map((r, i) => {
          let sig = "";
          if (rsi[i] != null) {
            if (rsi[i] <= 30) sig = "3단계";
            else if (rsi[i] <= 36) sig = "2단계";
            else if (rsi[i] <= 43) sig = "1단계";
          }
          return { ...r, rsi: rsi[i], signal: sig };
        });

        setApiRows(resRows);
        setIsDailyReady(true);
      } catch (e) { console.error(e); }
    })();
  }, []);

  // 실시간 시세
  useEffect(() => {
    if (!isDailyReady) return;
    let es = null;
    try {
      es = new EventSource(`/api/kis/stream?code=${CODE}`);
      es.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "tick") setNowQuote({ price: Number(m.price) });
      };
    } catch {}
    return () => es && es.close();
  }, [isDailyReady]);

  // 스크롤
  useEffect(() => {
    if (scrolled || !apiRows.length) return;
    if (topTableScrollRef.current) {
      topTableScrollRef.current.scrollTop = topTableScrollRef.current.scrollHeight;
      setScrolled(true);
    }
  }, [apiRows, scrolled]);

  // 병합
  const rows = useMemo(() => {
    const buyMap = new Map();
    (trades[SYMBOL] || []).forEach(t => {
      const k = dkey(t.date);
      buyMap.set(k, (buyMap.get(k) || 0) + Number(t.qty));
    });
    let cum = 0;
    return apiRows.map(r => {
      cum += (buyMap.get(r.date) || 0);
      return { ...r, qty: buyMap.get(r.date)||0, cumQty: cum };
    });
  }, [apiRows, trades]);

  const [date, setDate] = useState(todayLocal());
  const [priceIn, setPriceIn] = useState("");
  const [qtyIn, setQtyIn] = useState("");

  const handleTx = (side) => {
    const p = Number(priceIn), q = Number(qtyIn);
    if (!p || !q) return;
    addTrade(SYMBOL, { _txid: uid(), date, price: p, qty: side==="BUY"?q:0, sellQty: side==="SELL"?q:0 });
    setPriceIn(""); setQtyIn("");
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>TIGER 미국나스닥100레버리지</h2>
      <div ref={topTableScrollRef} style={{ maxHeight: 400, overflowY: "auto", border: "1px solid #eee", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, background: "#f8f9fa" }}>
            <tr>{["신호", "날짜", "주가", "RSI", "매수", "누적"].map(h => <th key={h} style={{padding:8, textAlign:"right"}}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isLast = i === rows.length - 1;
              const p = (isLast && nowQuote) ? nowQuote.price : r.close;
              const s1 = stepQty.nasdaq2x?.s1 || 0;
              let sigDisplay = r.signal === "1단계" ? `1단계(${s1})` : r.signal;

              return (
                <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 8, textAlign: "right", color: "red" }}>{sigDisplay}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.date}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{fmt(p)}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.rsi?.toFixed(1)||"-"}{r.rsi<=30 && "🔥"}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{fmt(r.qty)}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{fmt(r.cumQty)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{padding:8, border:"1px solid #ddd", borderRadius:4}} />
        <input type="number" placeholder="가격" value={priceIn} onChange={e=>setPriceIn(e.target.value)} style={{width:80, padding:8, border:"1px solid #ddd", borderRadius:4}} />
        <input type="number" placeholder="수량" value={qtyIn} onChange={e=>setQtyIn(e.target.value)} style={{width:60, padding:8, border:"1px solid #ddd", borderRadius:4}} />
        <button onClick={()=>handleTx("BUY")} style={{padding:"8px 16px", background:"#10b981", color:"white", border:"none", borderRadius:4}}>매수</button>
        <button onClick={()=>handleTx("SELL")} style={{padding:"8px 16px", background:"#ef4444", color:"white", border:"none", borderRadius:4}}>매도</button>
      </div>
    </div>
  );
}
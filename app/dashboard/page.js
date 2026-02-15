"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useAppStore } from "../store";

const CODE = "418660"; // 나스닥
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

/* RSI 계산 */
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

function useOtherNow(otherKey) {
  const [otherNow, setOtherNow] = useState(0);
  useEffect(() => {
    const load = () => { try { setOtherNow(Number(JSON.parse(localStorage.getItem(`now:${otherKey}`) || "0")) || 0); } catch {} };
    load(); window.addEventListener("storage", load); window.addEventListener("focus", load);
    return () => { window.removeEventListener("storage", load); window.removeEventListener("focus", load); };
  }, [otherKey]);
  return otherNow;
}

export default function DashboardPage() {
  const { stepQty, trades, addTrade, setTrades, yearlyBudget } = useAppStore();
  const [apiRows, setApiRows] = useState([]);
  const [isDailyReady, setIsDailyReady] = useState(false);
  const [nowQuote, setNowQuote] = useState(null);
  const topTableScrollRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  
  const otherNow = useOtherNow(OTHER_SYMBOL);

  useEffect(() => { if (!(trades[SYMBOL] || []).length) setTrades(SYMBOL, []); }, []);

  // 1. 빠른 로딩: 200일선 제거됨
  useEffect(() => {
    (async () => {
      try {
        const d = new Date();
        const ymd = (date) => date.toISOString().slice(0,10).replace(/-/g,"");
        const end = ymd(d);
        d.setDate(d.getDate() - 150); // 150일만 요청 (속도 Fast)
        const start = ymd(d);

        const res = await fetch(`/api/kis/daily?code=${CODE}&start=${start}&end=${end}`);
        const json = await res.json();
        let rows = (json.output || []).map(x => ({
          date: x.stck_bsop_date || x.date,
          close: Number(x.stck_clpr || x.close),
          prev: Number(x.prdy_clpr || x.prev)
        })).filter(r => r.date).sort((a,b) => a.date.localeCompare(b.date));

        // 중복 제거
        const map = new Map();
        rows.forEach(r => map.set(r.date, r));
        rows = Array.from(map.values());

        // RSI 계산
        const series = rows.map(r => r.close);
        const rsi = calcRSI_Cutler(series, 14);

        const resRows = rows.map((r, i) => {
          const base = i > 0 ? rows[i-1].close : r.prev;
          const dp = base ? (r.close - base)/base * 100 : 0;
          let sig = "";
          if (rsi[i] != null) {
            if (rsi[i] <= 30) sig = "3단계";
            else if (rsi[i] <= 36) sig = "2단계";
            else if (rsi[i] <= 43) sig = "1단계";
          }
          return { ...r, dailyPct: dp, rsi: rsi[i], signal: sig };
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
        if (m.type === "tick") {
          setNowQuote({ price: Number(m.price), high: Number(m.high) });
          try { localStorage.setItem(`now:${SYMBOL}`, JSON.stringify(Number(m.price))); } catch {}
        }
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

  // 테이블 데이터 병합 (200일선 로직 제거)
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

  /* 입력/로그 로직 */
  const TX_KEY = "txHistory";
  const [date, setDate] = useState(todayLocal());
  const [priceIn, setPriceIn] = useState("");
  const [qtyIn, setQtyIn] = useState("");
  const [txRows, setTxRows] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TX_KEY) || "[]"); } catch { return []; }
  });

  const saveTx = (row) => {
    const next = [row, ...txRows];
    setTxRows(next); localStorage.setItem(TX_KEY, JSON.stringify(next));
  };
  const removeTx = (id) => {
    const next = txRows.filter(r => r._txid !== id);
    setTxRows(next); localStorage.setItem(TX_KEY, JSON.stringify(next));
  };
  
  const handleTx = async (side) => {
    const p = Number(priceIn), q = Number(qtyIn);
    if (!p || !q) return alert("값 입력 확인");
    const _txid = uid();
    const tx = { _txid, date, price: p, qty: side==="BUY"?q:0, sellQty: side==="SELL"?q:0 };
    addTrade(SYMBOL, tx);
    saveTx({ _txid, _ts: Date.now(), type: side, date, symbol: SYMBOL, price: p, qty: q });
    setPriceIn(""); setQtyIn("");
  };

  const undoTx = (r) => {
    setTrades(SYMBOL, (trades[SYMBOL]||[]).filter(t => t._txid !== r._txid));
    removeTx(r._txid);
  };

  const todayTx = txRows.filter(r => r.date === date && r.symbol === SYMBOL);

  /* KPI 계산 (하단 표용) */
  const calcKPI = (sym) => {
    const arr = (trades[sym]||[]);
    const buys = arr.reduce((acc, t) => acc + (Number(t.qty)||0), 0);
    const buyAmt = arr.reduce((acc, t) => acc + (Number(t.qty)||0)*(Number(t.price)||0), 0);
    const sells = arr.reduce((acc, t) => acc + (Number(t.sellQty)||0), 0);
    const sellAmt = arr.reduce((acc, t) => acc + (Number(t.sellQty)||0)*(Number(t.price)||0), 0);
    return { buys, buyAmt, sells, sellAmt };
  };
  
  const kpiThis = calcKPI(SYMBOL);
  const kpiOther = calcKPI(OTHER_SYMBOL);
  
  const curPrice = nowQuote?.price || 0;
  const remQty = Math.max(0, kpiThis.buys - kpiThis.sells);
  const avgPrice = remQty > 0 ? (kpiThis.buyAmt - kpiThis.sellAmt) / remQty : 0;
  const evalAmt = remQty * curPrice;
  const pnl = evalAmt - (kpiThis.buyAmt - kpiThis.sellAmt);
  const roi = (kpiThis.buyAmt - kpiThis.sellAmt) ? (pnl / (kpiThis.buyAmt - kpiThis.sellAmt)) * 100 : 0;

  const totalBuy = kpiThis.buyAmt + kpiOther.buyAmt;
  const totalEval = evalAmt + (Math.max(0, kpiOther.buys - kpiOther.sells) * otherNow);

  return (
    <div style={{ padding: 16, maxWidth: 800, margin: "0 auto" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>TIGER 미국나스닥100레버리지</h2>
      
      {/* 차트 테이블 (200일선 제거됨) */}
      <div ref={topTableScrollRef} style={{ maxHeight: 400, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, background: "#f8f9fa", zIndex: 1 }}>
            <tr>
              {["신호", "날짜", "주가", "RSI", "매수", "누적"].map(h => 
                <th key={h} style={{ padding: 8, textAlign: "right" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isLast = i === rows.length - 1;
              const p = (isLast && nowQuote) ? nowQuote.price : r.close;
              const s1 = stepQty.nasdaq2x?.s1 || 0;
              let sigDisplay = "";
              if (r.signal === "1단계") sigDisplay = `1단계(${s1})`;
              else if (r.signal === "2단계") sigDisplay = "2단계";
              else if (r.signal === "3단계") sigDisplay = "3단계";

              return (
                <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 8, textAlign: "right", color: "red", fontWeight: "bold" }}>{sigDisplay}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.date}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>
                    {fmt(p)} {isLast && nowQuote && <span style={{fontSize:10, color:"green"}}>Live</span>}
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>{r.rsi?.toFixed(1)||"-"}{r.rsi<=30 && "🔥"}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{fmt(r.qty)}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{fmt(r.cumQty)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 입력 폼 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 8 }}>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inputStyle} />
        <input type="number" placeholder="가격" value={priceIn} onChange={e=>setPriceIn(e.target.value)} style={inputStyle} />
        <input type="number" placeholder="수량" value={qtyIn} onChange={e=>setQtyIn(e.target.value)} style={inputStyle} />
        <button onClick={()=>handleTx("BUY")} style={{...btnStyle, background:"#10b981"}}>매수</button>
        <button onClick={()=>handleTx("SELL")} style={{...btnStyle, background:"#ef4444"}}>매도</button>
      </div>

      {/* 오늘 거래 로그 */}
      <div style={{ marginBottom: 16, border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: "bold", marginBottom: 8 }}>오늘 거래 ({date})</h3>
        {todayTx.length === 0 ? <div style={{color:"#999", fontSize:13}}>거래 내역 없음</div> : (
          <table style={{ width: "100%", fontSize: 13 }}>
            <tbody>
              {todayTx.map(r => (
                <tr key={r._txid} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 4, color: r.type==="BUY"?"red":"blue" }}>{r.type}</td>
                  <td style={{ padding: 4 }}>{new Date(r._ts).toLocaleTimeString()}</td>
                  <td style={{ padding: 4 }}>{fmt(r.price)}원</td>
                  <td style={{ padding: 4 }}>{fmt(r.qty)}주</td>
                  <td style={{ padding: 4, textAlign:"right" }}>
                    <button onClick={()=>undoTx(r)} style={{fontSize:11, padding:"2px 6px", border:"1px solid #ddd", borderRadius:4}}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* KPI 대시보드 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Card title="현재가" val={`${fmt(curPrice)}원`} />
        <Card title="평균단가" val={`${fmt(Math.round(avgPrice))}원`} />
        <Card title="평가손익" val={`${fmt(Math.round(pnl))}원`} color={pnl>0?"red":"blue"} />
        <Card title="수익률" val={pct(roi)} color={roi>0?"red":"blue"} />
        <Card title="보유수량" val={`${fmt(remQty)}주`} />
        <Card title="평가금액" val={`${fmt(Math.round(evalAmt))}원`} />
        <Card title="총 매수금(전체)" val={`${fmt(Math.round(totalBuy))}원`} />
        <Card title="총 평가금(전체)" val={`${fmt(Math.round(totalEval))}원`} />
      </div>
    </div>
  );
}

const inputStyle = { flex:1, padding: 8, border: "1px solid #ddd", borderRadius: 6 };
const btnStyle = { padding: "8px 12px", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: "bold" };
function Card({title, val, color="#333"}) {
  return (
    <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff" }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 15, fontWeight: "bold", color }}>{val}</div>
    </div>
  );
}
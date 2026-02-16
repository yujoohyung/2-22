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

function calcSMA(values, window) {
  const n = values.length;
  const out = Array(n).fill(null);
  if (!Array.isArray(values) || window <= 0 || n < window) return out;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += values[i];
  out[window - 1] = sum / window;
  for (let i = window; i < n; i++) {
    sum += values[i] - values[i - window];
    out[i] = sum / window;
  }
  return out;
}

const RED = "#b91c1c";   
const BLUE = "#1d4ed8";  
const colorPL = (v) => (v > 0 ? RED : v < 0 ? BLUE : "#111");

export default function DashboardPage() {
  const { stepQty, trades, addTrade, setTrades, marketData } = useAppStore();
  const yearlyBudget = useAppStore((s) => s.yearlyBudget);

  // [수정] 전역 데이터 사용
  const nowQuote = marketData[CODE] || { price: 0, high: 0 };
  const otherPrice = marketData["465610"]?.price || 0; // 빅테크

  useEffect(() => {
    if ((trades[SYMBOL] || []).length) return;
    setTrades(SYMBOL, []);
  }, [trades, setTrades]);

  const [apiRows, setApiRows] = useState([]);
  const topTableScrollRef = useRef(null);
  const [scrolledToBottomOnce, setScrolledToBottomOnce] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const pad = (n) => String(n).padStart(2, "0");
        const today = new Date();
        const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        const end = ymd(today);
        const s = new Date(today); s.setDate(s.getDate() - 400);
        const start = ymd(s);

        const res = await fetch(`/api/kis/daily?code=${CODE}&start=${start}&end=${end}`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        const rawArr = d.output || d.output1 || [];
        
        const uniqueMap = new Map();
        rawArr.forEach((item) => {
          const key = item.stck_bsop_date || item.bstp_nmis || item.date;
          if (key && !uniqueMap.has(key)) uniqueMap.set(key, item);
        });
        const arr = Array.from(uniqueMap.values());

        const rows = arr.map((x) => ({
          date: x.stck_bsop_date || x.bstp_nmis || x.date,
          close: Number(x.stck_clpr || x.tdd_clsprc || x.close),
          prev:  Number(x.prdy_clpr || x.prev),
        })).filter((r) => r.date && Number.isFinite(r.close));
        
        rows.sort((a, b) => a.date.localeCompare(b.date));

        const series = rows.map((r) => r.close);
        const rsi = calcRSI_Cutler(series, 14);
        const ma200 = calcSMA(series, 200);
        const soldYear = new Set();

        const resRows = rows.map((r, i) => {
          const base = i > 0 ? rows[i - 1].close : (r.prev ?? r.close);
          const dp = base ? ((r.close - base) / base) * 100 : null;
          let sig = "";
          const rv = rsi[i];
          if (rv != null) {
            if (rv <= 30) sig = "3단계"; else if (rv <= 36) sig = "2단계"; else if (rv <= 43) sig = "1단계";
          }
          const year = r.date?.slice(0, 4);
          const below200 = ma200[i] != null && r.close < ma200[i];
          const sellNow = !!(below200 && year && !soldYear.has(year));
          if (sellNow) soldYear.add(year);
          return { signal: sig, date: r.date, price: r.close, dailyPct: dp, rsi: rsi[i], sell: sellNow, ma200: ma200[i] };
        });
        setApiRows(resRows);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (scrolledToBottomOnce) return;
    if (!apiRows.length) return;
    const el = topTableScrollRef.current;
    if (el) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; setScrolledToBottomOnce(true); });
    }
  }, [apiRows, scrolledToBottomOnce]);

  const rows = useMemo(() => {
    const sorted = [...apiRows].sort((a, b) => a.date.localeCompare(b.date));
    const tradingDays = sorted.map((r) => r.date);
    const mapToTradingDay = (key) => {
      if (!key || tradingDays.length === 0) return null;
      let lo = 0, hi = tradingDays.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tradingDays[mid] <= key) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans >= 0 ? tradingDays[ans] : null;
    };
    const buyQtyByDate = new Map(), buyCostByDate = new Map();
    (trades[SYMBOL] || []).forEach((t) => {
      if (!t || !Number(t.qty)) return;
      const dayKey = mapToTradingDay(dkey(t.date));
      if (!dayKey) return;
      const qty = Number(t.qty || 0), price = Number(t.price ?? t.buyPrice ?? 0);
      buyQtyByDate.set(dayKey, (buyQtyByDate.get(dayKey) || 0) + qty);
      buyCostByDate.set(dayKey, (buyCostByDate.get(dayKey) || 0) + price * qty);
    });
    let cumQty = 0, cumCost = 0;
    return sorted.map((r) => {
      const dayQty = buyQtyByDate.get(r.date) || 0;
      cumQty += dayQty; cumCost += buyCostByDate.get(r.date) || 0;
      return { ...r, qty: dayQty, cumQty, avgCost: cumQty > 0 ? Math.round(cumCost / cumQty) : null };
    });
  }, [trades, apiRows]);

  const TX_KEY = "txHistory";
  const [date, setDate] = useState(todayLocal());
  const [priceInput, setPriceInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [txRows, setTxRows] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TX_KEY) || "[]"); } catch { return []; }
  });

  const parseInputs = () => {
    const price = Number(priceInput), qty = Number(qtyInput);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) { alert("입력 오류"); return null; }
    if (!date) { alert("날짜 입력"); return null; }
    return { price, qty };
  };
  function saveTx(row) {
    const next = [row, ...txRows];
    localStorage.setItem(TX_KEY, JSON.stringify(next)); setTxRows(next);
  }
  function removeTx(txid) {
    const next = txRows.filter((r) => r._txid !== txid);
    localStorage.setItem(TX_KEY, JSON.stringify(next)); setTxRows(next);
  }
  const handleBuy = async () => {
    const p = parseInputs(); if (!p) return;
    const _txid = uid();
    addTrade(SYMBOL, { _txid, date, price: p.price, buyPrice: p.price, qty: p.qty, sellQty: 0 });
    saveTx({ _txid, _ts: Date.now(), type: "BUY", date, symbol: SYMBOL, price: p.price, qty: p.qty });
    setPriceInput(""); setQtyInput("");
  };
  const handleSell = async () => {
    const p = parseInputs(); if (!p) return;
    const _txid = uid();
    addTrade(SYMBOL, { _txid, date, price: p.price, buyPrice: p.price, qty: 0, sellQty: p.qty });
    saveTx({ _txid, _ts: Date.now(), type: "SELL", date, symbol: SYMBOL, price: p.price, qty: p.qty });
    setPriceInput(""); setQtyInput("");
  };
  const undoTx = (row) => {
    setTrades(SYMBOL, (trades[SYMBOL] || []).filter((t) => t._txid !== row._txid));
    removeTx(row._txid);
  };
  const todayTx = txRows.filter((r) => r.date === date && r.symbol === SYMBOL);

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>TIGER 미국나스닥100레버리지</h1>
        <section style={cardWrap}>
          <div ref={topTableScrollRef} style={{ maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["매수신호", "날짜", "주가", "일별%", "일봉rsi", "실매수가", "매수수량", "누적"].map(h=><th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const s1 = stepQty.nasdaq2x?.s1 ?? 0, s2 = stepQty.nasdaq2x?.s2 ?? 0, s3 = stepQty.nasdaq2x?.s3 ?? 0;
                  const totalBuyQty = (trades[SYMBOL] || []).reduce((s, t) => s + (Number(t.qty) || 0), 0);
                  const sellQty = totalBuyQty > 0 ? Math.max(1, Math.floor(totalBuyQty * 0.3)) : 0;
                  const sig = r.sell ? (sellQty > 0 ? `매도 / ${fmt(sellQty)}주` : "매도") : r.signal === "1단계" ? (s1 > 0 ? `1단계 / ${s1}주` : "1단계") : r.signal === "2단계" ? (s2 > 0 ? `2단계 / ${s2}주` : "2단계") : r.signal === "3단계" ? (s3 > 0 ? `3단계 / ${s3}주` : "3단계") : "";
                  
                  const isLast = i === rows.length - 1;
                  const live = isLast && nowQuote.price > 0;
                  const price = live ? nowQuote.price : r.price;
                  const prev = i > 0 ? rows[i - 1].price : r.price;
                  const dp = prev ? ((price - prev) / prev) * 100 : 0;

                  return (
                    <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td style={td}>{sig}</td><td style={td}>{r.date}</td>
                      <td style={tdRight}>{fmt(price)}원{live&&<span style={{marginLeft:4,fontSize:10,color:"green"}}>●</span>}</td>
                      <td style={tdRight}>{pct(live ? dp : r.dailyPct)}</td>
                      <td style={tdRight}>{r.rsi ? r.rsi.toFixed(2) : "-"}</td>
                      <td style={tdRight}>{r.avgCost ? fmt(r.avgCost) : "-"}</td>
                      <td style={tdRight}>{fmt(r.qty)}</td><td style={tdRight}>{fmt(r.cumQty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={footNote}>최신일이 맨 아래입니다.</div>
        </section>

        <section style={{ ...cardWrap, padding: 12 }}>
          <div style={controlsGrid}>
            <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} style={inputBase} />
            <input type="number" placeholder="주가" value={priceInput} onChange={(e)=>setPriceInput(e.target.value)} style={inputBase} />
            <input type="number" placeholder="수량" value={qtyInput} onChange={(e)=>setQtyInput(e.target.value)} style={inputBase} />
            <button style={buyBtn} onClick={handleBuy}>매수</button>
            <button style={sellBtn} onClick={handleSell}>매도</button>
          </div>
        </section>

        <section style={cardWrap}>
          <div style={{padding:12,fontWeight:700}}>오늘 거래: {todayTx.length}건</div>
        </section>

        <section style={cardWrap}>
          {(() => {
            const cur = nowQuote.price || 0;
            const high = nowQuote.high || 0;
            const drop = high ? ((cur - high) / high) * 100 : 0;
            
            const getQty = (s) => (trades[s]||[]).reduce((a,b)=>a+(Number(b.qty)||0)-(Number(b.sellQty)||0),0);
            
            const qtyThis = getQty(SYMBOL);
            const qtyOther = getQty(OTHER_SYMBOL);
            const amtThis = qtyThis * cur;
            const amtOther = qtyOther * otherPrice;
            const totalEval = amtThis + amtOther;
            
            return (
              <div style={{display:"grid",gap:12,padding:12,gridTemplateColumns:"1fr 1fr 1fr"}}>
                <Cell title="현재가" value={`${fmt(cur)}원`} />
                <Cell title="최고가" value={`${fmt(high)}원`} />
                <Cell title="낙폭" value={pct(drop)} color={colorPL(drop)} />
                <Cell title="평가금" value={`${fmt(amtThis)}원`} />
                <Cell title="총 평가금" value={`${fmt(totalEval)}원`} />
              </div>
            );
          })()}
        </section>
      </div>
    </div>
  );
}

const cardWrap = { background: "#fff", border: "1px solid #eee", borderRadius: 12, overflow: "hidden", marginBottom: 16 };
const th = { background: "#f7f7f8", textAlign: "left", fontSize: 13, padding: "10px 12px", position: "sticky", top: 0, zIndex: 2 };
const td = { padding: "10px 12px", fontSize: 14 };
const tdRight = { ...td, textAlign: "right" };
const footNote = { padding: 8, fontSize: 12, color: "#777" };
const controlsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 };
const inputBase = { width: "100%", padding: 10, border: "1px solid #ddd", borderRadius: 8 };
const buttonBase = { height: 42, borderRadius: 10, fontWeight: 700, cursor: "pointer", background: "#fff", border: "1px solid #ddd" };
const buyBtn = { ...buttonBase, borderColor: "green", color: "green" };
const sellBtn = { ...buttonBase, borderColor: "red", color: "red" };
function Cell({ title, value, color }) {
  return <div style={{border:"1px solid #eee",borderRadius:8,padding:10}}><div style={{fontSize:12,color:"#666"}}>{title}</div><div style={{fontSize:16,fontWeight:700,color}}>{value}</div></div>;
}
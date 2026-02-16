"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useAppStore } from "../store";

/** 종목코드: TIGER 미국나스닥100레버리지 */
const CODE = "418660";

/** 이 페이지 고유 키 */
const SYMBOL = "dashboard"; 
/** 합산 계산용: 반대편(빅테크) 심볼 */
const OTHER_SYMBOL = "stock2";

/** 로컬 YYYY-MM-DD */
function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-MM-DD / YYYYMMDD → YYYYMMDD */
const dkey = (s) => {
  if (!s) return "";
  const t = String(s).replace(/-/g, "");
  return t.slice(0, 8);
};

/** 포맷터 */
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

/** SMA (200일선용) */
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

/** 다른 페이지(now 가격) 읽기용 훅 */
function useOtherNow(otherKey) {
  const { marketData } = useAppStore();
  const otherCode = otherKey === "stock2" ? "465610" : "418660";
  return marketData[otherCode]?.price || 0;
}

/** 부호/색상 유틸 */
const RED = "#b91c1c";   
const BLUE = "#1d4ed8";  
const colorPL = (v) => (v > 0 ? RED : v < 0 ? BLUE : "#111");
const sPct = (v) => `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(2)}%`;
const sWon = (v) => `${v >= 0 ? "+" : "-"}${Number(Math.round(Math.abs(v))).toLocaleString("ko-KR")}원`;

export default function DashboardPage() {
  // [수정] dailyCache 사용
  const { stepQty, trades, addTrade, setTrades, marketData, dailyCache, setDailyCache } = useAppStore();
  const yearlyBudget = useAppStore((s) => s.yearlyBudget);

  const nowQuote = marketData[CODE] || { price: 0, high: 0 };
  const otherNow = useOtherNow(OTHER_SYMBOL);

  /** trades 초기 보장 */
  useEffect(() => {
    if ((trades[SYMBOL] || []).length) return;
    setTrades(SYMBOL, []);
  }, [trades, setTrades]);

  // [수정] 캐시 사용
  const [apiRows, setApiRows] = useState(dailyCache[CODE] || []);
  
  const topTableScrollRef = useRef(null);
  const [scrolledToBottomOnce, setScrolledToBottomOnce] = useState(false);

  /** 일자별 시세 로드 */
  useEffect(() => {
    // [핵심] 캐시 있으면 호출 생략
    if (dailyCache[CODE] && dailyCache[CODE].length > 0) return;

    (async () => {
      try {
        const pad = (n) => String(n).padStart(2, "0");
        const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        const today = new Date();
        const end = ymd(today);
        const s = new Date(today); s.setDate(s.getDate() - 400);
        const start = ymd(s);

        const res = await fetch(`/api/kis/daily?code=${CODE}&start=${start}&end=${end}`);
        if (!res.ok) { await res.text().catch(() => ""); throw new Error(`daily ${res.status}`); }
        const d = await res.json();
        if (!d.ok) throw new Error("daily api error");

        const out = d.output || d.output1 || [];
        const rawArr = Array.isArray(out) ? out : [];

        const uniqueMap = new Map();
        rawArr.forEach((item) => {
          const key = item.stck_bsop_date || item.bstp_nmis || item.date;
          if (key && !uniqueMap.has(key)) {
            uniqueMap.set(key, item);
          }
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
            if (rv <= 30) sig = "3단계";
            else if (rv <= 36) sig = "2단계";
            else if (rv <= 43) sig = "1단계";
          }

          const year = r.date?.slice(0, 4);
          const below200 = ma200[i] != null && r.close < ma200[i];
          const sellNow = !!(below200 && year && !soldYear.has(year));
          if (sellNow) soldYear.add(year);

          return { signal: sig, date: r.date, price: r.close, dailyPct: dp, rsi: rsi[i], sell: sellNow, ma200: ma200[i] };
        });

        setApiRows(resRows);
        setDailyCache(CODE, resRows); // 캐시 저장
      } catch (e) {
        console.error(e);
      }
    })();
  }, [dailyCache, setDailyCache]);

  /** 스크롤 자동 이동 */
  useEffect(() => {
    if (scrolledToBottomOnce) return;
    if (!apiRows.length) return;
    const el = topTableScrollRef.current;
    if (el) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; setScrolledToBottomOnce(true); });
    }
  }, [apiRows, scrolledToBottomOnce]);

  /** 매수 누적/평단 계산 */
  const rows = useMemo(() => {
    const sorted = [...apiRows].sort((a, b) => a.date.localeCompare(b.date));
    const tradingDays = sorted.map((r) => r.date);

    const mapToTradingDay = (key) => {
      if (!key || tradingDays.length === 0) return null;
      let lo = 0, hi = tradingDays.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tradingDays[mid] <= key) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return ans >= 0 ? tradingDays[ans] : null;
    };

    const buyQtyByDate = new Map();
    const buyCostByDate = new Map();
    (trades[SYMBOL] || []).forEach((t) => {
      if (!t || !Number(t.qty)) return;
      const rawKey = dkey(t.date);
      const dayKey = mapToTradingDay(rawKey);
      if (!dayKey) return;
      const qty = Number(t.qty || 0);
      const price = Number(t.price ?? t.buyPrice ?? 0);
      buyQtyByDate.set(dayKey, (buyQtyByDate.get(dayKey) || 0) + qty);
      buyCostByDate.set(dayKey, (buyCostByDate.get(dayKey) || 0) + price * qty);
    });

    let cumQty = 0, cumCost = 0;
    return sorted.map((r) => {
      const dayQty = buyQtyByDate.get(r.date) || 0;
      const dayCost = buyCostByDate.get(r.date) || 0;
      cumQty += dayQty;
      cumCost += dayCost;
      const avgCost = cumQty > 0 ? Math.round(cumCost / cumQty) : null;
      return { ...r, qty: dayQty, cumQty, avgCost };
    });
  }, [trades, apiRows]);

  const TX_KEY = "txHistory";
  const [date, setDate] = useState(todayLocal());
  const [priceInput, setPriceInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [txRows, setTxRows] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TX_KEY) || "[]"); } catch { return []; }
  });

  function upsertRebalance({ date, price, qty }) {
    try {
      const KEY = "rbHistory";
      const addQty = Number(qty);
      const addAmt = Number(price) * Number(qty);
      const cur = JSON.parse(localStorage.getItem(KEY) || "[]");
      const idx = cur.findIndex((r) => r.date === date && r.symbol === SYMBOL);
      if (idx >= 0) {
        const r0 = cur[idx];
        const newQty = Number(r0.qty || 0) + addQty;
        const newAmt = Number(r0.amount || 0) + addAmt;
        const newPrice = newQty > 0 ? Math.round(newAmt / newQty) : 0;
        cur[idx] = { ...r0, qty: newQty, amount: newAmt, price: newPrice, symbol: SYMBOL, type: "SELL" };
      } else {
        cur.unshift({ date, symbol: SYMBOL, qty: addQty, amount: addAmt, price: addQty > 0 ? Math.round(addAmt / addQty) : 0, type: "SELL" });
      }
      localStorage.setItem(KEY, JSON.stringify(cur));
      try { const ch = new BroadcastChannel("rb"); ch.postMessage({ type: "upsert" }); ch.close(); } catch {}
    } catch {}
  }
  function deleteFromRebalance({ date, price, qty }) {
    try {
      const KEY = "rbHistory";
      const subQty = Number(qty);
      const subAmt = Number(price) * Number(qty);
      const cur = JSON.parse(localStorage.getItem(KEY) || "[]");
      const idx = cur.findIndex((r) => r.date === date && r.symbol === SYMBOL);
      if (idx < 0) return;
      const r0 = cur[idx];
      const newQty = Number(r0.qty || 0) - subQty;
      const newAmt = Number(r0.amount || 0) - subAmt;
      if (newQty <= 0 || newAmt <= 0) cur.splice(idx, 1);
      else cur[idx] = { ...r0, qty: newQty, amount: newAmt, price: Math.round(newAmt / newQty) };
      localStorage.setItem(KEY, JSON.stringify(cur));
      try { const ch = new BroadcastChannel("rb"); ch.postMessage({ type: "delete" }); ch.close(); } catch {}
    } catch {}
  }

  const parseInputs = () => {
    const price = Number(priceInput);
    const qty = Number(qtyInput);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) {
      alert("주가와 수량을 올바르게 입력하세요. (최소 1)");
      return null;
    }
    if (!date) { alert("날짜를 입력하세요."); return null; }
    return { price, qty };
  };

  function saveTx(row) {
    const cur = JSON.parse(localStorage.getItem(TX_KEY) || "[]");
    const next = [row, ...cur];
    localStorage.setItem(TX_KEY, JSON.stringify(next));
    setTxRows(next);
  }
  function removeTx(txid) {
    const cur = JSON.parse(localStorage.getItem(TX_KEY) || "[]");
    const next = cur.filter((r) => r._txid !== txid);
    localStorage.setItem(TX_KEY, JSON.stringify(next));
    setTxRows(next);
  }

  async function saveToServer({ side, date, price, qty }) {
    try {
      await fetch("/api/trades/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: "nasdaq2x", side, date, price, qty })
      });
    } catch {}
  }

  const handleBuy = async () => {
    const parsed = parseInputs(); if (!parsed) return;
    const { price, qty } = parsed;
    const _txid = uid();
    addTrade(SYMBOL, { _txid, signal: "", date, price, buyPrice: price, dailyPct: null, rsi: null, qty, sellQty: 0 });
    saveTx({ _txid, _ts: Date.now(), type: "BUY", date, symbol: SYMBOL, price, qty });
    await saveToServer({ side: "BUY", date, price, qty });
    setPriceInput(""); setQtyInput("");
    requestAnimationFrame(() => { const el = topTableScrollRef.current; if (el) el.scrollTop = el.scrollHeight; });
    void fetch("/api/trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "dashboard", date, price, qty, side: "BUY" })
    }).catch(()=>{});
  };

  const handleSell = async () => {
    const parsed = parseInputs(); if (!parsed) return;
    const { price, qty } = parsed;
    const _txid = uid();
    addTrade(SYMBOL, { _txid, signal: "", date, price, buyPrice: price, dailyPct: null, rsi: null, qty: 0, sellQty: qty });
    upsertRebalance({ date, price, qty });
    saveTx({ _txid, _ts: Date.now(), type: "SELL", date, symbol: SYMBOL, price, qty });
    await saveToServer({ side: "SELL", date, price, qty });
    setPriceInput(""); setQtyInput("");
    void fetch("/api/trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "dashboard", date, price, qty, side: "SELL" })
    }).catch(()=>{});
  };

  const undoTx = (row) => {
    setTrades(SYMBOL, (trades[SYMBOL] || []).filter((t) => t._txid !== row._txid));
    if (row.type === "SELL") deleteFromRebalance({ date: row.date, price: row.price, qty: row.qty });
    removeTx(row._txid);
  };

  const todayTx = useMemo(
    () => txRows.filter((r) => r.date === date && r.symbol === SYMBOL),
    [txRows, date]
  );

  const buysThis = useMemo(() => {
    const arr = (trades[SYMBOL] || []).filter((t) => Number(t.qty) > 0);
    const qty = arr.reduce((s, t) => s + Number(t.qty || 0), 0);
    const amt = arr.reduce((s, t) => s + Number(t.qty || 0) * Number(t.price ?? t.buyPrice ?? 0), 0);
    return { qty, amt, avg: qty > 0 ? amt / qty : 0 };
  }, [trades]);
  const buysOther = useMemo(() => {
    const arr = (trades[OTHER_SYMBOL] || []).filter((t) => Number(t.qty) > 0);
    const qty = arr.reduce((s, t) => s + Number(t.qty || 0), 0);
    const amt = arr.reduce((s, t) => s + Number(t.qty || 0) * Number(t.price ?? t.buyPrice ?? 0), 0);
    return { qty, amt, avg: qty > 0 ? amt / qty : 0 };
  }, [trades]);

  const sellsThisQty = useMemo(() => (trades[SYMBOL] || []).reduce((s, t) => s + Number(t.sellQty || 0), 0), [trades]);
  const sellsOtherQty = useMemo(() => (trades[OTHER_SYMBOL] || []).reduce((s, t) => s + Number(t.sellQty || 0), 0), [trades]);
  const sellAmtThis = useMemo(() => (trades[SYMBOL] || []).reduce((s, t) => s + Number(t.sellQty || 0) * Number(t.price ?? t.sellPrice ?? 0), 0), [trades]);
  const sellAmtOther = useMemo(() => (trades[OTHER_SYMBOL] || []).reduce((s, t) => s + Number(t.sellQty || 0) * Number(t.price ?? t.sellPrice ?? 0), 0), [trades]);

  const avgThis = buysThis.qty > 0 ? buysThis.amt / buysThis.qty : 0;
  const avgOther = buysOther.qty > 0 ? buysOther.amt / buysOther.qty : 0;
  const remQtyThis = Math.max(0, buysThis.qty - sellsThisQty);
  const remQtyOther = Math.max(0, buysOther.qty - sellsOtherQty);
  const remCostThis = remQtyThis * avgThis;
  const remCostOther = remQtyOther * avgOther;

  const evalThis = remQtyThis * nowQuote.price;
  const profitThis = evalThis - remCostThis;
  const roiThis = remCostThis ? (profitThis / remCostThis) * 100 : 0;
  const avgCostThisDisp = remQtyThis > 0 ? (remCostThis / remQtyThis) : 0;

  const evalOther = remQtyOther * (otherNow || 0);

  const totalBuyAmt = buysThis.amt + buysOther.amt;
  const totalEval = evalThis + evalOther;
  const totalProfitVsBuy = totalEval - totalBuyAmt;
  const totalROIVsBuy = totalBuyAmt ? (totalProfitVsBuy / totalBuyAmt) * 100 : 0;

  const deposit = Number(yearlyBudget || 0);
  const totalSellAmt = sellAmtThis + sellAmtOther;
  const cashBase = deposit + totalSellAmt;
  const depositRemain = cashBase - totalBuyAmt;
  const buyRatioToDeposit = cashBase > 0 ? (totalBuyAmt / cashBase) * 100 : 0;

  const cur = nowQuote.price || 0;
  const high = nowQuote.high || 0;
  const drop = high ? ((cur - high) / high) * 100 : 0;

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>TIGER 미국나스닥100레버리지</h1>

        {/* 가격/지표 표 */}
        <section style={cardWrap}>
          <div ref={topTableScrollRef} style={{ maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["매수신호", "날짜", "주가", "일별%", "일봉rsi", "실매수가(누적 평단)", "매수수량", "누적매수량"].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const s1 = stepQty.nasdaq2x?.s1 ?? 0;
                  const s2 = stepQty.nasdaq2x?.s2 ?? 0;
                  const s3 = stepQty.nasdaq2x?.s3 ?? 0;

                  const totalBuyQty = (trades[SYMBOL] || []).reduce((s, t) => s + (Number(t.qty) || 0), 0);
                  const sellQty = totalBuyQty > 0 ? Math.max(1, Math.floor(totalBuyQty * 0.3)) : 0;

                  const sig =
                    r.sell
                      ? (sellQty > 0 ? `매도 / ${fmt(sellQty)}주` : "매도")
                      : r.signal === "1단계" ? (s1 > 0 ? `1단계 / ${s1}주` : "1단계") :
                        r.signal === "2단계" ? (s2 > 0 ? `2단계 / ${s2}주` : "2단계") :
                        r.signal === "3단계" ? (s3 > 0 ? `3단계 / ${s3}주` : "3단계") : "";

                  const isLast = i === rows.length - 1;
                  const live = isLast && nowQuote?.price > 0;
                  const price = live ? nowQuote.price : r.price;
                  const prevClose = i > 0 ? rows[i - 1].price : r.price;
                  const dailyPctLive = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
                  const dailyPctValue = live ? dailyPctLive : r.dailyPct;

                  return (
                    <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td style={td}>{sig}</td>
                      <td style={td}>{r.date}</td>
                      <td style={tdRight}>
                        {fmt(price)}원
                        {live && (
                          <span style={{
                            marginLeft: 8, fontSize: 11, padding: "2px 6px",
                            border: "1px solid #b7eb8f", borderRadius: 999,
                            background: "#e6ffed", color: "#135200", fontWeight: 700
                          }}>실시간</span>
                        )}
                      </td>
                      <td style={tdRight}>{pct(dailyPctValue)}</td>
                      <td style={tdRight}>{r.rsi != null ? r.rsi.toFixed(2) : "-"}</td>
                      <td style={tdRight}>{r.avgCost != null ? `${fmt(r.avgCost)}원` : "-"}</td>
                      <td style={tdRight}>{fmt(r.qty)}</td>
                      <td style={tdRight}>{fmt(r.cumQty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={footNote}>최신일이 맨 아래입니다. 처음 들어오면 자동으로 최신행으로 스크롤돼요.</div>
        </section>

        {/* 입력 */}
        <section style={{ ...cardWrap, padding: 12 }}>
          <div style={controlsGrid}>
            <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} style={inputBase} autoComplete="off" />
            <input type="number" inputMode="numeric" min="1" step="1" placeholder="주가 입력" value={priceInput} onChange={(e)=>setPriceInput(e.target.value)} style={inputBase} />
            <input type="number" inputMode="numeric" min="1" step="1" placeholder="수량 입력" value={qtyInput} onChange={(e)=>setQtyInput(e.target.value)} style={inputBase} />
            <button style={buyBtn} onClick={handleBuy}>매수</button>
            <button style={sellBtn} onClick={handleSell}>매도</button>
          </div>
        </section>

        {/* 오늘 거래 로그 */}
        <section style={cardWrap}>
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>오늘 거래 ({date})</div>
            <div style={{ maxHeight: 3 * 44 + 56, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["구분", "시간", "가격", "수량", "합계", ""].map((h) => (<th key={h} style={th}>{h}</th>))}</tr>
                </thead>
                <tbody>
                  {todayTx.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 16, textAlign: "center", color: "#777" }}>내역 없음</td></tr>
                  ) : todayTx.map((r) => {
                    const time = new Date(r._ts || Date.now());
                    const hh = String(time.getHours()).padStart(2, "0");
                    const mm = String(time.getMinutes()).padStart(2, "0");
                    const sum = Number(r.price) * Number(r.qty);
                    const isBuy = r.type === "BUY";
                    return (
                      <tr key={r._txid} style={{ borderTop: "1px solid #f0f0f0", background: isBuy ? "#f0fff4" : "#fff5f5" }}>
                        <td style={{ ...td, fontWeight: 800, color: isBuy ? "#107a2e" : "#ad1a1a" }}>{r.type}</td>
                        <td style={td}>{`${hh}:${mm}`}</td>
                        <td style={tdRight}>{fmt(r.price)}원</td>
                        <td style={tdRight}>{fmt(r.qty)}</td>
                        <td style={tdRight}>{fmt(sum)}원</td>
                        <td style={tdRight}><button style={smallBtn} onClick={() => undoTx(r)}>삭제</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* KPI */}
        <section style={cardWrap}>
          <div style={{ display: "grid", gap: 12, padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Cell title="현재가" value={`${Number(Math.round(cur)).toLocaleString("ko-KR")}원`} />
              <Cell title="최고가" value={`${Number(Math.round(high)).toLocaleString("ko-KR")}원`} />
              <Cell title="±최고점 기준 낙폭" value={sPct(drop)} color={colorPL(drop)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Cell title="평균단가" value={`${Number(Math.round(avgCostThisDisp)).toLocaleString("ko-KR")}원`} />
              <Cell title="손익률" value={sPct(roiThis)} color={colorPL(roiThis)} />
              <Cell
                title="누적평가금"
                value={`${Number(Math.round(evalThis)).toLocaleString("ko-KR")}원 (${sWon(profitThis)})`}
                color={colorPL(profitThis)}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Cell title="합산매수금" value={`${Number(Math.round(totalBuyAmt)).toLocaleString("ko-KR")}원`} />
              <Cell title="합산손익률" value={sPct(totalROIVsBuy)} color={colorPL(totalROIVsBuy)} />
              <Cell
                title="합산평가금"
                value={`${Number(Math.round(totalEval)).toLocaleString("ko-KR")}원 (${sWon(totalProfitVsBuy)})`}
                color={colorPL(totalProfitVsBuy)}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              <Cell title="예치금잔액" value={`${Number(Math.round(depositRemain)).toLocaleString("ko-KR")}원`} />
              <Cell title="예치금대비 매수비율" value={`${buyRatioToDeposit.toFixed(2)}%`} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* 스타일 */
const cardWrap = { background: "#fff", border: "1px solid #eee", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: 16 };
const th = {
  background: "#f7f7f8",
  textAlign: "left",
  fontSize: 13,
  fontWeight: 700,
  color: "#555",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 2,
  boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
};
const td = { padding: "10px 12px", fontSize: 14, color: "#111" };
const tdRight = { ...td, textAlign: "right", whiteSpace: "nowrap" };
const footNote = { padding: "8px 12px", fontSize: 12, color: "#777", borderTop: "1px solid #eee" };

const controlsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
  alignItems: "center",
};
const inputBase = {
  minWidth: 0,
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #ddd",
  borderRadius: 10,
  fontSize: 14,
  boxSizing: "border-box",
};
const buttonBase = {
  height: 42,
  minWidth: 120,
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
  background: "#fff",
  border: "1px solid #e5e7eb",
  justifySelf: "stretch",
};
const buyBtn  = { ...buttonBase, borderColor: "#10b981", color: "#0f766e" };
const sellBtn = { ...buttonBase, borderColor: "#ef4444", color: "#b91c1c" };
const smallBtn = { padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, background: "#fff", fontWeight: 700, cursor: "pointer" };

function Cell({ title, value, color }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", background: "#fff" }}>
      <div style={{ fontSize: 13, color: "#666", fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useAppStore, selectCashRemain } from "../store";

/** 로컬 YYYY-MM-DD */
function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 포맷터 */
const fmt = (n) => (n == null || Number.isNaN(n) ? "-" : Number(n).toLocaleString("ko-KR"));
const pct = (n) => (n == null || Number.isNaN(n) ? "-" : `${Number(n).toFixed(2)}%`);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** API 고정 표본(실운영 시 API 응답으로 대체) */
const apiRows = [
  { signal: "1단계", date: "2025-08-01", price: 11825, dailyPct: -1.2, rsi: 28.4 },
  { signal: "",     date: "2025-08-02", price: 12440, dailyPct:  1.9, rsi: 31.2 },
  { signal: "",     date: "2025-08-03", price: 13405, dailyPct:  3.0, rsi: 35.8 },
  { signal: "",     date: "2025-08-04", price: 13980, dailyPct:  1.7, rsi: 39.1 },
  { signal: "2단계", date: "2025-08-05", price: 14750, dailyPct:  2.3, rsi: 42.5 },
  { signal: "",     date: "2025-08-06", price: 15220, dailyPct:  1.4, rsi: 45.0 },
  { signal: "",     date: "2025-08-07", price: 15990, dailyPct:  2.2, rsi: 49.2 },
  { signal: "",     date: "2025-08-08", price: 16210, dailyPct:  0.6, rsi: 50.3 },
  { signal: "3단계", date: "2025-08-09", price: 16880, dailyPct:  1.8, rsi: 53.7 },
  { signal: "",     date: "2025-08-10", price: 17240, dailyPct:  1.0, rsi: 55.9 },
  { signal: "",     date: "2025-08-11", price: 17990, dailyPct:  2.0, rsi: 58.6 },
  { signal: "",     date: "2025-08-12", price: 18110, dailyPct:  0.3, rsi: 59.1 },
];

export default function Stock2Page() {
  /** 👇 심볼은 'stock2'로 저장 (예치금 페이지가 표시용으로 BIGTECH2X로 묶어 보여줌) */
  const SYMBOL = "stock2";
  const { stepQty, trades, addTrade, setTrades } = useAppStore();
  const remainCash = useAppStore(selectCashRemain);

  /** 초기 trades 보장 */
  useEffect(() => {
    if ((trades[SYMBOL] || []).length) return;
    setTrades(SYMBOL, []);
  }, [trades, setTrades]);

  /** 매수 누적/평단 계산 (매도 제외) */
  const rows = useMemo(() => {
    const buyQtyByDate = new Map();
    const buyCostByDate = new Map();
    (trades[SYMBOL] || []).forEach((t) => {
      if (!t || !Number(t.qty)) return;
      const d = t.date;
      const qty = Number(t.qty ?? 0);
      const price = Number(t.price ?? t.buyPrice ?? 0);
      buyQtyByDate.set(d, (buyQtyByDate.get(d) || 0) + qty);
      buyCostByDate.set(d, (buyCostByDate.get(d) || 0) + price * qty);
    });

    let cumQty = 0, cumCost = 0;
    const sorted = [...apiRows].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((r) => {
      const dayQty = buyQtyByDate.get(r.date) || 0;
      const dayCost = buyCostByDate.get(r.date) || 0;
      cumQty += dayQty;
      cumCost += dayCost;
      const avgCost = cumQty > 0 ? Math.round(cumCost / cumQty) : null;
      return { ...r, qty: dayQty, cumQty, avgCost };
    });
  }, [trades]);

  /** 입력/로그 상태 */
  const TX_KEY = "txHistory";
  const [date, setDate] = useState(todayLocal());
  const [priceInput, setPriceInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [txRows, setTxRows] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TX_KEY) || "[]"); } catch { return []; }
  });

  /** 상단 표 스크롤 참조 */
  const topTableScrollRef = useRef(null);

  /** 리밸런싱 합산 upsert / delete (rbHistory에 당일 합산) */
  function upsertRebalance({ date, symbol, price, qty }) {
    try {
      const KEY = "rbHistory";
      const addQty = Number(qty);
      const addAmt = Number(price) * Number(qty);
      const cur = JSON.parse(localStorage.getItem(KEY) || "[]");
      const idx = cur.findIndex((r) => r.date === date && r.symbol === symbol);
      if (idx >= 0) {
        const r0 = cur[idx];
        const newQty = Number(r0.qty || 0) + addQty;
        const newAmt = Number(r0.amount || 0) + addAmt;
        const newPrice = newQty > 0 ? Math.round(newAmt / newQty) : 0;
        cur[idx] = { ...r0, qty: newQty, amount: newAmt, price: newPrice, type: "SELL" };
      } else {
        cur.unshift({
          date, symbol,
          qty: addQty,
          amount: addAmt,
          price: addQty > 0 ? Math.round(addAmt / addQty) : 0,
          type: "SELL",
        });
      }
      localStorage.setItem(KEY, JSON.stringify(cur));
      try {
        const ch = new BroadcastChannel("rb");
        ch.postMessage({ type: "upsert", payload: { date, symbol, price, qty } });
        ch.close();
      } catch {}
    } catch {}
  }
  function deleteFromRebalance({ date, symbol, price, qty }) {
    try {
      const KEY = "rbHistory";
      const subQty = Number(qty);
      const subAmt = Number(price) * Number(qty);
      const cur = JSON.parse(localStorage.getItem(KEY) || "[]");
      const idx = cur.findIndex((r) => r.date === date && r.symbol === symbol);
      if (idx < 0) return;
      const r0 = cur[idx];
      const newQty = Number(r0.qty || 0) - subQty;
      const newAmt = Number(r0.amount || 0) - subAmt;
      if (newQty <= 0 || newAmt <= 0) {
        cur.splice(idx, 1);
      } else {
        cur[idx] = { ...r0, qty: newQty, amount: newAmt, price: Math.round(newAmt / newQty) };
      }
      localStorage.setItem(KEY, JSON.stringify(cur));
      try {
        const ch = new BroadcastChannel("rb");
        ch.postMessage({ type: "delete", payload: { date, symbol, price, qty } });
        ch.close();
      } catch {}
    } catch {}
  }

  /** 입력 검증 */
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

  /** 거래 로그 저장/삭제 */
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

  /** 매수 */
  const handleBuy = () => {
    const parsed = parseInputs();
    if (!parsed) return;
    const { price, qty } = parsed;

    const _txid = uid();
    addTrade(SYMBOL, {
      _txid, signal: "", date, price, buyPrice: price,
      dailyPct: null, rsi: null, qty, sellQty: 0,
    });
    saveTx({ _txid, _ts: Date.now(), type: "BUY", date, symbol: SYMBOL, price, qty });

    setPriceInput(""); setQtyInput("");
    requestAnimationFrame(() => {
      const el = topTableScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  /** 매도 */
  const handleSell = () => {
    const parsed = parseInputs();
    if (!parsed) return;
    const { price, qty } = parsed;

    const _txid = uid();
    addTrade(SYMBOL, {
      _txid, signal: "", date, price, buyPrice: price,
      dailyPct: null, rsi: null, qty: 0, sellQty: qty,
    });
    upsertRebalance({ date, symbol: SYMBOL, price, qty });
    saveTx({ _txid, _ts: Date.now(), type: "SELL", date, symbol: SYMBOL, price, qty });

    setPriceInput(""); setQtyInput("");
  };

  /** 거래 로그에서 삭제 → 되돌리기 */
  const undoTx = (row) => {
    setTrades(SYMBOL, (trades[SYMBOL] || []).filter((t) => t._txid !== row._txid));
    if (row.type === "SELL") {
      deleteFromRebalance({ date: row.date, symbol: row.symbol, price: row.price, qty: row.qty });
    }
    removeTx(row._txid);
  };

  /** 입력 날짜 기준 "오늘 거래"만 필터 */
  const todayTx = useMemo(() => {
    return txRows.filter((r) => r.date === date && r.symbol === SYMBOL);
  }, [txRows, date, SYMBOL]);

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>TIGER 빅테크7 2x</h1>

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
                  const s1 = stepQty.bigtech2x?.s1 ?? 0;
                  const s2 = stepQty.bigtech2x?.s2 ?? 0;
                  const s3 = stepQty.bigtech2x?.s3 ?? 0;
                  const sig =
                    r.signal === "1단계" ? (s1 > 0 ? `1단계 / ${s1}주` : "1단계") :
                    r.signal === "2단계" ? (s2 > 0 ? `2단계 / ${s2}주` : "2단계") :
                    r.signal === "3단계" ? (s3 > 0 ? `3단계 / ${s3}주` : "3단계") : "";

                  return (
                    <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                      <td style={td}>{sig}</td>
                      <td style={td}>{r.date}</td>
                      <td style={tdRight}>{fmt(r.price)}원</td>
                      <td style={tdRight}>{pct(r.dailyPct)}</td>
                      <td style={tdRight}>{r.rsi != null ? r.rsi.toFixed(1) : "-"}</td>
                      <td style={tdRight}>{r.avgCost != null ? `${fmt(r.avgCost)}원` : "-"}</td>
                      <td style={tdRight}>{fmt(r.qty)}</td>
                      <td style={tdRight}>{fmt(r.cumQty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={footNote}>10개를 초과하면 위 표 영역에서 스크롤로 넘겨볼 수 있어요.</div>
        </section>

        {/* 입력 행 */}
        <section style={{ ...cardWrap, padding: 12 }}>
          <div style={inputGrid}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
            <input type="number" inputMode="numeric" min="1" step="1" placeholder="주가 입력"
              value={priceInput} onChange={(e) => setPriceInput(e.target.value)} style={input} />
            <input type="number" inputMode="numeric" min="1" step="1" placeholder="수량 입력"
              value={qtyInput} onChange={(e) => setQtyInput(e.target.value)} style={input} />
            <button style={btn} onClick={handleBuy}>매수</button>
            <button style={btn} onClick={handleSell}>매도</button>
          </div>
        </section>

        {/* 오늘 거래 로그 */}
        <section style={cardWrap}>
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>오늘 거래 ({date})</div>
            <div style={{ maxHeight: 3 * 44 + 56, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["구분", "시간", "가격", "수량", "합계", ""].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
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
                        <td style={tdRight}>
                          <button style={smallBtn} onClick={() => undoTx(r)}>삭제</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={footNote}>여기서 삭제하면 위 표/리밸런싱 기록도 함께 되돌려집니다.</div>
          </div>
        </section>

        {/* 샘플 지표 섹션 */}
        <section style={cardWrap}>
          {(() => {
            const 현재가 = 42000;
            const 평균단가 = 40000;
            const 최고주가 = 50000;
            const 합산매수금 = 5_000_000;
            const 합산평가금 = 4_200_000;
            const 예치금잔액 = remainCash;

            const 최고점기준낙폭 = ((현재가 - 최고주가) / 최고주가) * 100;
            const 손익률 = ((현재가 - 평균단가) / 평균단가) * 100;
            const 손익금 = 합산평가금 - 합산매수금;
            const 합산손익률 = ((합산평가금 - 합산매수금) / 합산매수금) * 100;
            const 예치금대비매수비율 = (합산매수금 / Math.max(예치금잔액, 1)) * 100;
            const fmtWon = (n) => `${fmt(n)}원`;

            return (
              <div style={{ display: "grid", gap: 12, padding: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                  <Cell title="현재가(평균단가)" value={`${fmtWon(현재가)} (${fmtWon(평균단가)})`} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  <Cell title="최고주가" value={fmtWon(최고주가)} />
                  <Cell title="최고점기준 낙폭" value={pct(최고점기준낙폭)} highlight={최고점기준낙폭 < 0} />
                  <Cell title="손익률 및 손익금" value={`${손익률 >= 0 ? "▲" : "▼"} ${pct(Math.abs(손익률))} / ${fmtWon(Math.abs(손익금))}`} highlight={손익률 < 0} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  <Cell title="합산 매수금" value={fmtWon(합산매수금)} />
                  <Cell title="합산 손익률" value={`${합산손익률 >= 0 ? "▲" : "▼"} ${pct(Math.abs(합산손익률))}`} highlight={합산손익률 < 0} />
                  <Cell title="합산 평가금" value={fmtWon(합산평가금)} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                  <Cell title="예치금잔액" value={fmtWon(예치금잔액)} />
                  <Cell title="예치금대비 매수비율" value={pct(예치금대비매수비율)} />
                </div>
              </div>
            );
          })()}
        </section>
      </div>
    </div>
  );
}

/* 스타일 */
const cardWrap = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  overflow: "hidden",
  marginBottom: 16,
};
const th = {
  background: "#f7f7f8",
  textAlign: "left",
  fontSize: 13,
  fontWeight: 700,
  color: "#555",
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
};
const td = { padding: "10px 12px", fontSize: 14, color: "#111" };
const tdRight = { ...td, textAlign: "right", whiteSpace: "nowrap" };
const footNote = { padding: "8px 12px", fontSize: 12, color: "#777", borderTop: "1px solid #eee" };
const input = { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 10, fontSize: 14 };
const btn = { padding: "10px 12px", borderWidth: 1, borderStyle: "solid", borderColor: "#ddd", borderRadius: 10, background: "#fff", cursor: "pointer", fontWeight: 600 };
const smallBtn = { padding: "6px 10px", border: "1px solid #ddd", borderRadius: 8, background: "#fff", fontWeight: 700, cursor: "pointer" };

const inputGrid = { display: "grid", gridTemplateColumns: "180px 1fr 1fr 120px 120px", gap: 10, alignItems: "center" };

function Cell({ title, value, highlight }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "12px 14px",
        background: highlight ? "#fff5f5" : "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 13, color: "#666", fontWeight: 600 }}>{title}</div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

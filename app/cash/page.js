"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useAppStore } from "../store";

/** 종목코드 설정 */
const CODE = "418660"; // 나스닥 기준
const SYMBOL = "dashboard";
const OTHER_SYMBOL = "stock2";

/** 포맷터 유틸 */
const fmt = (n) => (n == null || Number.isNaN(n) ? "-" : Number(n).toLocaleString("ko-KR"));
const pct = (n) => (n == null || Number.isNaN(n) ? "-" : `${Number(n).toFixed(2)}%`);

/** 색상 상수 */
const RED = "#b91c1c";   
const BLUE = "#1d4ed8";  
const colorPL = (v) => (v > 0 ? RED : v < 0 ? BLUE : "#111");
const sWon = (v) => `${v >= 0 ? "+" : "-"}${Number(Math.round(Math.abs(v))).toLocaleString("ko-KR")}원`;
const sPct = (v) => `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(2)}%`;

export default function CashPage() {
  const { trades, yearlyBudget, setTrades } = useAppStore();
  
  const [nowQuote, setNowQuote] = useState({ price: 0 });
  const [otherPrice, setOtherPrice] = useState(0);

  // 데이터 로드 및 동기화
  useEffect(() => {
    // 다른 종목 가격 로드
    const loadOther = () => {
      try {
        const val = Number(JSON.parse(localStorage.getItem(`now:${OTHER_SYMBOL}`) || "0"));
        setOtherPrice(val);
      } catch {}
    };
    loadOther();

    // 실시간 시세 연결
    let es = null;
    try {
      es = new EventSource(`/api/kis/stream?code=${CODE}`);
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "tick") setNowQuote({ price: Number(msg.price) });
        } catch {}
      };
    } catch (e) {}
    return () => { if (es) es.close(); };
  }, []);

  /** 자산 계산 로직 */
  const assets = useMemo(() => {
    const calc = (sym) => {
      const arr = trades[sym] || [];
      const bQty = arr.reduce((s, t) => s + (Number(t.qty) || 0), 0);
      const bAmt = arr.reduce((s, t) => s + (Number(t.qty) || 0) * (Number(t.price) || 0), 0);
      const sQty = arr.reduce((s, t) => s + (Number(t.sellQty) || 0), 0);
      const sAmt = arr.reduce((s, t) => s + (Number(t.sellQty) || 0) * (Number(t.price) || 0), 0);
      return { bQty, bAmt, sQty, sAmt, avg: bQty > 0 ? bAmt / bQty : 0 };
    };

    const nasdaq = calc(SYMBOL);
    const bigtech = calc(OTHER_SYMBOL);

    const remN = Math.max(0, nasdaq.bQty - nasdaq.sQty);
    const remB = Math.max(0, bigtech.bQty - bigtech.sQty);
    
    const curN = nowQuote.price || 0;
    const curB = otherPrice || 0;

    const evalN = remN * curN;
    const evalB = remB * curB;

    const totalBuy = nasdaq.bAmt + bigtech.bAmt;
    const totalEval = evalN + evalB;
    const totalProfit = totalEval - totalBuy;
    const totalROI = totalBuy > 0 ? (totalProfit / totalBuy) * 100 : 0;

    const deposit = Number(yearlyBudget || 0);
    const totalRealized = nasdaq.sAmt + bigtech.sAmt;
    const currentCash = deposit + totalRealized - totalBuy;

    return { 
      totalBuy, totalEval, totalProfit, totalROI, 
      deposit, currentCash, 
      buyRatio: (deposit + totalRealized) > 0 ? (totalBuy / (deposit + totalRealized)) * 100 : 0 
    };
  }, [trades, nowQuote, otherPrice, yearlyBudget]);

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>현금 및 자산 현황</h1>
        
        {/* 기존 카드 레이아웃 디자인 그대로 유지 */}
        <section style={cardWrap}>
          <div style={{ display: "grid", gap: 12, padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Cell title="예치금 잔액" value={`${fmt(assets.currentCash)}원`} />
              <Cell title="매수 비율" value={`${assets.buyRatio.toFixed(2)}%`} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Cell title="총 매수금액" value={`${fmt(assets.totalBuy)}원`} />
              <Cell title="총 평가금액" value={`${fmt(assets.totalEval)}원`} color={colorPL(assets.totalProfit)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Cell title="총 손익" value={sWon(assets.totalProfit)} color={colorPL(assets.totalProfit)} />
              <Cell title="총 수익률" value={sPct(assets.totalROI)} color={colorPL(assets.totalROI)} />
            </div>
          </div>
        </section>

        <section style={{...cardWrap, padding: 16, marginTop: 16}}>
          <h3 style={{fontSize: 15, fontWeight: 700, marginBottom: 8}}>자산 운용 참고</h3>
          <div style={{fontSize: 14, lineHeight: 1.8, color: "#666"}}>
            • 설정된 1년 예치금과 실제 매매 기록을 바탕으로 계산되었습니다.<br/>
            • 실시간 시세를 반영하여 평가금액 및 손익이 계산됩니다.
          </div>
        </section>
      </div>
    </div>
  );
}

/** * 빌드 오류 해결을 위한 핵심 포인트: 
 * 파일 하단에 Cell 컴포넌트를 명확히 정의 
 */
function Cell({ title, value, color = "#111" }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", background: "#fff" }}>
      <div style={{ fontSize: 13, color: "#666", fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

/** 기존 스타일 객체 정의 */
const cardWrap = { 
  background: "#fff", 
  border: "1px solid #eee", 
  borderRadius: 12, 
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)", 
  overflow: "hidden" 
};
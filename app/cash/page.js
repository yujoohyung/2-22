"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";
import { saveUserSettings } from "@/lib/saveUserSettings";

/* ===== 가격 훅 (API 호출) ===== */
function useLivePrice(symbol) {
  const [price, setPrice] = useState(0);
  
  useEffect(() => {
    // 1. 심볼 매핑 (실제 KIS 종목코드로 변경 필요)
    // NASDAQ2X -> 418660 (예시)
    // BIGTECH2X -> 종목코드 입력
    let code = symbol;
    if (symbol === "NASDAQ2X") code = "418660"; 
    
    // 초기 로드 및 주기적 갱신
    const fetchPrice = async () => {
      try {
        const res = await fetch(`/api/price?symbol=${code}`);
        const data = await res.json();
        if (data.price) setPrice(data.price);
      } catch (e) {
        console.error("Price fetch failed", e);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 5000); // 5초마다 갱신
    return () => clearInterval(interval);
  }, [symbol]);

  return { price };
}

const won = (n) => Number(Math.round(n ?? 0)).toLocaleString("ko-KR") + "원";

export default function CashDashboardPage() {
  const { yearlyBudget, setYearlyBudget, setStepQty } = useAppStore();
  const [yearlyInput, setYearlyInput] = useState(yearlyBudget || 0);

  // 실시간 가격 (나스닥, 빅테크)
  const { price: priceN } = useLivePrice("NASDAQ2X");
  const { price: priceB } = useLivePrice("BIGTECH2X");

  // 초기 예치금 로드
  useEffect(() => {
    (async () => {
      const { data } = await supa.auth.getSession();
      if (data?.session) {
        const res = await fetch("/api/user-settings/me", {
          headers: { Authorization: `Bearer ${data.session.access_token}` }
        });
        const d = await res.json();
        if (d?.data?.yearly_budget) {
          setYearlyInput(d.data.yearly_budget);
          setYearlyBudget(d.data.yearly_budget);
        }
      }
    })();
  }, [setYearlyBudget]);

  /* ===== 계산 로직 ===== */
  const mAvg = yearlyInput / 12;
  const factor = 0.92;

  // 금액 계산
  const n1_amt = mAvg * 0.14 * factor;
  const n2_amt = mAvg * 0.26 * factor;
  const n3_amt = mAvg * 0.60 * factor;
  
  const b1_amt = mAvg * 0.14 * factor;
  const b2_amt = mAvg * 0.14 * factor;
  const b3_amt = mAvg * 0.26 * factor;

  // 수량 계산
  const n1_qty = priceN ? Math.floor(n1_amt / priceN) : 0;
  const n2_qty = priceN ? Math.floor(n2_amt / priceN) : 0;
  const n3_qty = priceN ? Math.floor(n3_amt / priceN) : 0;

  const b1_qty = priceB ? Math.floor(b1_amt / priceB) : 0;
  const b2_qty = priceB ? Math.floor(b2_amt / priceB) : 0;
  const b3_qty = priceB ? Math.floor(b3_amt / priceB) : 0;

  const handleSave = async () => {
    setYearlyBudget(yearlyInput);
    setStepQty({
        nasdaq2x: { s1: n1_qty, s2: n2_qty, s3: n3_qty },
        bigtech2x: { s1: b1_qty, s2: b2_qty, s3: b3_qty }
    });
    await saveUserSettings({ yearly_budget: yearlyInput });
    alert("저장되었습니다.");
  };

  return (
    <div className="container">
      <h1 className="title">예치금 및 매수 설정</h1>
      
      <div className="input-section">
        <label>1년 총 납입금</label>
        <div className="input-group">
          <input 
            type="number" 
            value={yearlyInput} 
            onChange={(e) => setYearlyInput(Number(e.target.value))} 
          />
          <button onClick={handleSave}>저장</button>
        </div>
        <div className="sub-info">월 평균 매입금: {won(mAvg)}</div>
      </div>

      <div className="table-card">
        <div className="row header">
          <div className="col">구분</div>
          <div className="col">나스닥 2배 ({won(priceN)})</div>
          <div className="col">빅테크 2배 ({won(priceB)})</div>
        </div>

        {/* 1단계 */}
        <div className="row">
          <div className="col label">1단계 수량 (rsi 43)</div>
          <div className="col val">{n1_qty}주 <span className="amt">({won(n1_amt)})</span></div>
          <div className="col val">{b1_qty}주 <span className="amt">({won(b1_amt)})</span></div>
        </div>

        {/* 2단계 */}
        <div className="row">
          <div className="col label">2단계 수량 (rsi 36)</div>
          <div className="col val">{n2_qty}주 <span className="amt">({won(n2_amt)})</span></div>
          <div className="col val">{b2_qty}주 <span className="amt">({won(b2_amt)})</span></div>
        </div>

        {/* 3단계 */}
        <div className="row">
          <div className="col label">3단계 수량 (rsi 30)</div>
          <div className="col val">{n3_qty}주 <span className="amt">({won(n3_amt)})</span></div>
          <div className="col val">{b3_qty}주 <span className="amt">({won(b3_amt)})</span></div>
        </div>
      </div>

      <style jsx>{`
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        .title { font-size: 24px; font-weight: 800; margin-bottom: 20px; }
        
        .input-section { background: #fff; padding: 20px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #eee; }
        .input-group { display: flex; gap: 10px; margin-top: 8px; }
        input { flex: 1; padding: 12px; font-size: 18px; border: 1px solid #ddd; border-radius: 8px; }
        button { padding: 0 20px; background: #2563eb; color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; }
        .sub-info { margin-top: 8px; color: #2563eb; font-size: 14px; font-weight: 600; }

        .table-card { background: #fff; border-radius: 12px; border: 1px solid #eee; overflow: hidden; }
        .row { display: grid; grid-template-columns: 1.2fr 1fr 1fr; border-bottom: 1px solid #f0f0f0; padding: 16px; align-items: center; }
        .header { background: #f9fafb; font-weight: 800; color: #4b5563; font-size: 14px; }
        .label { font-weight: 600; color: #374151; font-size: 15px; }
        .val { text-align: right; font-weight: 800; font-size: 16px; color: #111; }
        .amt { font-size: 12px; color: #9ca3af; font-weight: 400; display: block; }
        
        @media (max-width: 480px) {
           .row { font-size: 13px; padding: 12px 8px; }
           .val { font-size: 14px; }
        }
      `}</style>
    </div>
  );
}
"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";

const won = (n) => Number(Math.round(n ?? 0)).toLocaleString("ko-KR") + "원";

export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  
  const [nasdaqData, setNasdaqData] = useState({ rsi: null, ma200: 0, price: 0 });
  const [bigtechData, setBigtechData] = useState({ rsi: null, price: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        const { data: { session } } = await supa.auth.getSession();
        if (session) {
          const res = await fetch("/api/user-settings/me", {
            headers: { Authorization: `Bearer ${session.access_token}` }
          });
          const json = await res.json();
          if (json?.data?.yearly_budget) {
            setYearlyBudget(Number(json.data.yearly_budget));
          }
        }

        const resN = await fetch(`/api/kis/ma200?symbol=418660`);
        const jsonN = await resN.json();
        if (jsonN.ok) {
          setNasdaqData({ rsi: jsonN.rsi, ma200: jsonN.ma200, price: jsonN.price });
        }

        const resB = await fetch(`/api/kis/ma200?symbol=465610`);
        const jsonB = await resB.json();
        if (jsonB.ok) {
          setBigtechData({ rsi: jsonB.rsi, price: jsonB.price });
        }

      } catch (e) {
        console.error("Data load failed:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [setYearlyBudget]);

  /* ===== 판단 로직 ===== */
  // const TEST_RSI = 40; 
  const rsiN = (typeof TEST_RSI !== 'undefined') ? TEST_RSI : nasdaqData.rsi;
  const priceN = nasdaqData.price;
  const ma200N = nasdaqData.ma200;

  let signalType = "HOLD"; 
  let stage = 0; 
  let signalText = "관망";
  let signalColor = "#6b7280"; 

  // 매도
  if (priceN > 0 && ma200N > 0 && priceN < ma200N) {
    signalType = "SELL";
    signalText = "매도 (30% 비중)";
    signalColor = "#ef4444"; 
  } 
  // 매수
  else if (rsiN !== null) {
    if (rsiN < 30) {
      signalType = "BUY";
      stage = 3;
      signalText = "매수 / 3단계";
      signalColor = "#dc2626"; 
    } else if (rsiN < 36) {
      signalType = "BUY";
      stage = 2;
      signalText = "매수 / 2단계";
      signalColor = "#f59e0b"; 
    } else if (rsiN < 43) {
      signalType = "BUY";
      stage = 1;
      signalText = "매수 / 1단계";
      signalColor = "#eab308"; 
    } else {
      signalText = "관망 (RSI 안정)";
      signalColor = "#10b981";
    }
  }

  /* ===== 수량 계산 ===== */
  const monthNasdaq = (yearlyBudget * 0.6) / 12;
  const monthBigTech = (yearlyBudget * 0.4) / 12;
  const factor = 0.92;

  let applyStage = stage > 0 ? stage : 1; 
  let ratio = 0.14; 
  if (applyStage === 2) ratio = 0.26;
  if (applyStage === 3) ratio = 0.60;

  const targetAmtN = monthNasdaq * ratio * factor;
  const targetAmtB = monthBigTech * ratio * factor;

  const qtyN = (priceN > 0) ? Math.floor(targetAmtN / priceN) : 0;
  const priceB = bigtechData.price;
  const qtyB = (priceB > 0) ? Math.floor(targetAmtB / priceB) : 0;

  /* ===== 텍스트 ===== */
  let displayN = "-";
  let displayB = "-";

  if (signalType === "SELL") {
    displayN = "30% 매도";
    displayB = "30% 매도";
  } else {
    // 매수 or 관망
    const prefix = signalType === "HOLD" ? "(1단계) " : "";
    displayN = `${prefix}${qtyN}주 매수`;
    displayB = `${prefix}${qtyB}주 매수`;
  }

  if (loading) return <div style={{ padding: 20 }}>데이터를 불러오는 중입니다...</div>;

  return (
    <div className="total-wrap">
      <h1 className="title">종합 투자 현황</h1>

      <div className="status-table">
        <div className="t-row">
          <div className="label">나스닥 RSI</div>
          <div className="val rsi" style={{ color: rsiN < 43 ? "#dc2626" : "#111" }}>
            {rsiN ? rsiN.toFixed(1) : "-"}
          </div>
          <div className="label">현재가</div>
          <div className="val">{won(priceN)}</div>
        </div>

        <div className="t-row">
          <div className="label">빅테크 RSI</div>
          <div className="val rsi">
            {bigtechData.rsi ? bigtechData.rsi.toFixed(1) : "-"}
          </div>
          <div className="label">현재가</div>
          <div className="val">{won(priceB)}</div>
        </div>

        <div className="t-row highlight">
          <div className="label">판단</div>
          <div className="val signal" style={{ color: signalColor }}>
            {signalText}
          </div>
          <div className="label">200일선</div>
          <div className="val" style={{ color: priceN < ma200N ? "#ef4444" : "#2563eb" }}>
            {won(ma200N)}
          </div>
        </div>

        <div className="t-row action-row">
          <div className="action-col">
            <div className="act-label">나스닥</div>
            <div className="act-val" style={{ color: signalType === "SELL" ? "blue" : "#dc2626" }}>
              {displayN}
            </div>
          </div>
          <div className="action-col">
            <div className="act-label">빅테크</div>
            <div className="act-val" style={{ color: signalType === "SELL" ? "blue" : "#dc2626" }}>
              {displayB}
            </div>
          </div>
        </div>
      </div>

      <div className="footer-info">
        * 매수 기준: 나스닥 RSI (43/36/30 미만)<br/>
        * 매도 기준: 나스닥 가격이 200일 이평선({won(ma200N)}) 미만 시<br/>
        * 관망 시에는 1단계 기준 예상 수량을 보여줍니다.
      </div>

      <style jsx>{`
        .total-wrap { max-width: 800px; margin: 0 auto; padding: 20px; font-family: -apple-system, sans-serif; }
        .title { font-size: 24px; font-weight: 800; margin-bottom: 24px; color: #111; }
        .status-table { display: flex; flexDirection: column; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.03); background: #fff; }
        .t-row { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; padding: 20px; border-bottom: 1px solid #f3f4f6; align-items: center; }
        .t-row:last-child { border-bottom: none; }
        .label { font-size: 14px; color: #6b7280; font-weight: 600; }
        .val { font-size: 16px; font-weight: 700; color: #111; text-align: right; }
        .rsi { font-weight: 800; }
        .signal { font-size: 17px; font-weight: 800; }
        .highlight { background-color: #f9fafb; }
        .action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0; padding: 0; }
        .action-col { padding: 24px; text-align: center; border-right: 1px solid #f3f4f6; }
        .action-col:last-child { border-right: none; }
        .act-label { font-size: 14px; color: #6b7280; margin-bottom: 8px; font-weight: 600; }
        .act-val { font-size: 20px; font-weight: 800; word-break: keep-all; }
        .footer-info { margin-top: 20px; font-size: 13px; color: #9ca3af; line-height: 1.6; }
        @media (max-width: 480px) {
          .total-wrap { padding: 12px; }
          .t-row { grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px; }
          .label { font-size: 13px; }
          .val { font-size: 15px; }
          .action-col { padding: 20px 10px; }
          .act-val { font-size: 16px; }
        }
      `}</style>
    </div>
  );
}
"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "../store";
// [수정] supa 대신 getBrowserClient를 가져옵니다.
import { getBrowserClient } from "@/lib/supaClient";

/* RSI 계산 함수 */
function calcRSI_Cutler(values, period = 14) {
  const n = values.length;
  if (n < period + 1) return null;
  const gains = new Array(n).fill(0), losses = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains[i] = diff; else losses[i] = -diff;
  }
  let sumG = 0, sumL = 0;
  for (let i = 1; i <= period; i++) { sumG += gains[i]; sumL += losses[i]; }
  let avgG = sumG / period, avgL = sumL / period;
  
  for (let i = period + 1; i < n; i++) {
    sumG += gains[i] - gains[i - period];
    sumL += losses[i] - losses[i - period];
    avgG = sumG / period; avgL = sumL / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - (100 / (1 + rs));
}

function useStockData(code) {
  const { marketData, setMarketData } = useAppStore();
  const cached = marketData[code];
  const [data, setData] = useState(cached || { price: 0, rsi: null, ma200: null, ready: false });

  useEffect(() => { if (cached) setData(cached); }, [cached]);

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        const [resDaily, resNow] = await Promise.all([
          fetch(`/api/kis/daily?code=${code}`),
          fetch(`/api/kis/now?code=${code}`)
        ]);
        const jsonDaily = await resDaily.json();
        const jsonNow = await resNow.json();
        
        if (!isMounted) return;

        let items = jsonDaily.output || [];
        items.sort((a, b) => (a.stck_bsop_date || a.date).localeCompare(b.stck_bsop_date || b.date));
        
        const closes = items.map(i => Number(i.stck_clpr || i.close));
        const rsi = calcRSI_Cutler(closes, 14);
        const nowPrice = Number(jsonNow.output?.stck_prpr || 0) || (closes.length ? closes[closes.length-1] : 0);

        const baseData = { price: nowPrice, rsi, ma200: null, ready: true };
        setMarketData(code, baseData);

        const resMa = await fetch(`/api/kis/ma200?symbol=${code}`);
        const jsonMa = await resMa.json();
        
        if (isMounted && jsonMa.ok && jsonMa.ma200 > 0) {
          setMarketData(code, { ...baseData, ma200: jsonMa.ma200 });
        }
      } catch (e) { console.error(e); }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000); 
    return () => { isMounted = false; clearInterval(interval); };
  }, [code, setMarketData]);

  return data;
}

export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  const nasdaq = useStockData("418660"); 
  const bigtech = useStockData("465610"); 

  useEffect(() => {
    (async () => {
      try {
        // [수정] getBrowserClient()를 사용하여 supabase 인스턴스를 가져옵니다.
        const supabase = getBrowserClient();
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session) {
          const res = await fetch("/api/user-settings/me", { 
            headers: { Authorization: `Bearer ${sessionData.session.access_token}` } 
          });
          const d = await res.json();
          if (d?.data?.yearly_budget) setYearlyBudget(Number(d.data.yearly_budget));
        }
      } catch (e) { console.error("Session fetch error", e); }
    })();
  }, [setYearlyBudget]);

  const { rsi: rsiN, price: priceN, ma200: ma200N } = nasdaq;
  const { rsi: rsiB, price: priceB } = bigtech;

  let signalType = "HOLD"; 
  let stage = 0; 
  let signalText = nasdaq.ready ? "관망" : "로딩중.."; 
  let signalColor = nasdaq.ready ? "#10b981" : "#9ca3af"; 

  if (nasdaq.ready) {
    if (priceN > 0 && ma200N > 0 && priceN < ma200N) {
      signalType = "SELL"; signalText = "매도 (30% 비중)"; signalColor = "#ef4444"; 
    } else if (rsiN !== null) {
      if (rsiN < 30) { signalType = "BUY"; stage = 3; signalText = "3단계 매수"; signalColor = "#dc2626"; }
      else if (rsiN < 36) { signalType = "BUY"; stage = 2; signalText = "2단계 매수"; signalColor = "#f59e0b"; }
      else if (rsiN < 43) { signalType = "BUY"; stage = 1; signalText = "1단계 매수"; signalColor = "#eab308"; }
    }
  }

  const monthAvg = yearlyBudget / 12;
  const factor = 0.92;
  const stageRatio = stage === 1 ? 0.14 : stage === 2 ? 0.26 : stage === 3 ? 0.60 : 0;
  const amtNasdaq = monthAvg * 0.60 * stageRatio * factor;
  const amtBigtech = monthAvg * 0.40 * stageRatio * factor;
  const qtyN = (signalType === "BUY" && priceN > 0) ? Math.floor(amtNasdaq / priceN) : 0;
  const qtyB = (signalType === "BUY" && priceB > 0) ? Math.floor(amtBigtech / priceB) : 0;
  const won = (n) => (n > 0 ? Math.round(n).toLocaleString("ko-KR") + "원" : "-");

  return (
    <div className="total-wrap">
      <h1 className="title">종합 투자 현황</h1>
      <div className="status-table">
        <div className="t-row">
          <div className="cell label">나스닥 RSI</div>
          <div className="cell val rsi" style={{ color: rsiN && rsiN < 43 ? "#dc2626" : "#111" }}>
            {nasdaq.ready ? (rsiN ? rsiN.toFixed(2) : "-") : "..."}
          </div>
          <div className="cell label">현재가</div>
          <div className="cell val">{nasdaq.ready ? won(priceN) : "..."}</div>
        </div>
        <div className="t-row">
          <div className="cell label">빅테크 RSI</div>
          <div className="cell val rsi">{bigtech.ready ? (rsiB ? rsiB.toFixed(2) : "-") : "..."}</div>
          <div className="cell label">현재가</div>
          <div className="cell val">{bigtech.ready ? won(priceB) : "..."}</div>
        </div>
        <div className="t-row highlight">
          <div className="cell label">판단</div>
          <div className="cell val signal" style={{ color: signalColor }}>{signalText}</div>
          <div className="cell label">200일선</div>
          <div className="cell val" style={{ color: (priceN > 0 && ma200N > 0 && priceN < ma200N) ? "#ef4444" : "#2563eb" }}>
            {ma200N ? won(ma200N) : <span style={{fontSize:11, color:"#999"}}>계산중..</span>}
          </div>
        </div>
        <div className="action-row">
          <div className="action-col">
            <div className="act-label">나스닥</div>
            <div className="act-val" style={{ color: signalType === "BUY" ? "#dc2626" : "#6b7280" }}>
              {signalType === "SELL" ? "30% 매도" : (qtyN > 0 ? `${qtyN}주 매수` : "관망")}
            </div>
          </div>
          <div className="action-col">
            <div className="act-label">빅테크</div>
            <div className="act-val" style={{ color: signalType === "BUY" ? "#dc2626" : "#6b7280" }}>
              {signalType === "SELL" ? "30% 매도" : (qtyB > 0 ? `${qtyB}주 매수` : "관망")}
            </div>
          </div>
        </div>
      </div>
      <div className="footer-info">* 매도 기준: 200일선({ma200N ? won(ma200N) : "..."}) 하회 시</div>
      <style jsx>{`
        .total-wrap { max-width: 800px; margin: 0 auto; padding: 20px; font-family: -apple-system, sans-serif; }
        .title { font-size: 22px; font-weight: 800; margin-bottom: 20px; color: #111; }
        .status-table { display: flex; flex-direction: column; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .t-row { display: grid; grid-template-columns: 90px 1fr 90px 1fr; border-bottom: 1px solid #f3f4f6; align-items: center; }
        .highlight { background-color: #f9fafb; }
        .cell { padding: 16px 12px; font-size: 15px; }
        .label { color: #6b7280; font-weight: 600; background: #fff; }
        .val { color: #111; font-weight: 700; text-align: right; }
        .rsi { font-weight: 800; font-family: monospace; }
        .signal { font-size: 16px; font-weight: 800; word-break: keep-all; }
        .action-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: none; }
        .action-col { padding: 20px; text-align: center; border-right: 1px solid #f3f4f6; }
        .action-col:last-child { border-right: none; }
        .act-label { font-size: 14px; color: #6b7280; margin-bottom: 6px; font-weight: 600; }
        .act-val { font-size: 18px; font-weight: 800; word-break: keep-all; }
        .footer-info { margin-top: 16px; font-size: 12px; color: #9ca3af; line-height: 1.5; }
        @media (max-width: 480px) { .t-row { grid-template-columns: 90px 1fr; padding: 8px 0; } }
      `}</style>
    </div>
  );
}
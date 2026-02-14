"use client";

import { useState, useEffect, useMemo } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";

/* ===== 유틸: RSI/MA 계산 (클라이언트 사이드) ===== */
function calcRSI(values, period = 14) {
  const n = values.length;
  if (n < period + 1) return null;
  
  // values는 시간순 정렬된 배열 (0: 과거, n-1: 최신)이라고 가정하지 않고
  // 여기서는 편의상 최신순(0이 최신)으로 들어온다고 가정하고 계산하거나,
  // 대시보드 로직(calcRSI_Cutler)을 따름.
  // 대시보드는 과거->미래 순으로 정렬해서 계산함.
  
  // 입력이 [최신, ..., 과거]라면 뒤집어야 함.
  // 여기서는 호출부에서 정렬을 제어하겠음.
  
  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  
  for(let i=1; i<n; i++) {
    const diff = values[i] - values[i-1];
    if(diff > 0) gains[i] = diff;
    else losses[i] = -diff;
  }
  
  let sumGain = 0, sumLoss = 0;
  for(let i=1; i<=period; i++) {
    sumGain += gains[i];
    sumLoss += losses[i];
  }
  
  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  
  // 그 이후
  let lastRSI = rsi;
  for(let i=period+1; i<n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    lastRSI = 100 - (100 / (1 + rs));
  }
  
  return lastRSI;
}

function calcMA(values, period = 200) {
  const n = values.length;
  if(n < period) return null;
  // 마지막 period 개의 평균
  let sum = 0;
  for(let i = n - period; i < n; i++) {
    sum += values[i];
  }
  return sum / period;
}

const won = (n) => n > 0 ? Number(Math.round(n)).toLocaleString("ko-KR") + "원" : "-";

/* ===== 데이터 로드 훅 ===== */
function useStockData(code) {
  const [data, setData] = useState({ price: 0, rsi: null, ma200: null, ready: false });

  useEffect(() => {
    let isMounted = true;
    
    const load = async () => {
      try {
        // 1. 일봉 데이터 (약 2년치)
        const today = new Date();
        const p = (n) => String(n).padStart(2, "0");
        const ymd = (d) => `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
        
        const end = ymd(today);
        const startDt = new Date(today); startDt.setDate(startDt.getDate() - 730);
        const start = ymd(startDt);

        const resDaily = await fetch(`/api/kis/daily?code=${code}&start=${start}&end=${end}`);
        const jsonDaily = await resDaily.json();
        const dailyItems = jsonDaily.output || jsonDaily.output2 || [];
        
        // 2. 실시간 현재가
        const resNow = await fetch(`/api/kis/now?code=${code}`);
        const jsonNow = await resNow.json();
        const nowPrice = Number(jsonNow.output?.stck_prpr || 0);

        if (!isMounted) return;

        // 3. 데이터 병합 및 정렬 (과거 -> 미래 순)
        let candles = dailyItems.map(item => ({
          date: item.stck_bsop_date,
          close: Number(item.stck_clpr)
        })).filter(c => c.close > 0);
        
        candles.sort((a, b) => a.date.localeCompare(b.date));

        // 실시간 가격 반영 (오늘 날짜 캔들이 없으면 추가, 있으면 업데이트)
        if (nowPrice > 0 && candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          const todayStr = ymd(today);
          
          if (lastCandle.date === todayStr) {
            lastCandle.close = nowPrice;
          } else {
            // 장중/장마감 직후 날짜 불일치 시에도 최신가 반영을 위해 가짜 캔들 추가 대신
            // 그냥 마지막 캔들 값을 최신가로 간주하거나, 아예 새 캔들을 붙임
            // 여기선 RSI 정확도를 위해 '현재가'를 가장 최신 종가로 취급하여 배열에 추가
            candles.push({ date: todayStr, close: nowPrice });
          }
        }

        // 4. 지표 계산
        const closes = candles.map(c => c.close);
        const rsi = calcRSI(closes, 14);
        const ma200 = calcMA(closes, 200);
        const finalPrice = nowPrice > 0 ? nowPrice : closes[closes.length - 1];

        setData({ price: finalPrice, rsi, ma200, ready: true });

      } catch (e) {
        console.error("Stock load error", code, e);
      }
    };

    load();
    const interval = setInterval(load, 30000); // 30초 갱신
    return () => { isMounted = false; clearInterval(interval); };
  }, [code]);

  return data;
}

export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  
  // 나스닥(418660), 빅테크(465610)
  const nasdaq = useStockData("418660");
  const bigtech = useStockData("465610");

  // 예치금 로드
  useEffect(() => {
    (async () => {
      const { data } = await supa.auth.getSession();
      if (data?.session) {
        const res = await fetch("/api/user-settings/me", {
          headers: { Authorization: `Bearer ${data.session.access_token}` }
        });
        const d = await res.json();
        if (d?.data?.yearly_budget) {
          setYearlyBudget(Number(d.data.yearly_budget));
        }
      }
    })();
  }, [setYearlyBudget]);

  /* ===== 판단 로직 ===== */
  const rsiN = nasdaq.rsi;
  const priceN = nasdaq.price;
  const ma200N = nasdaq.ma200;

  let signalType = "HOLD"; // BUY, SELL, HOLD
  let stage = 0;
  let signalText = "관망";
  let signalColor = "#6b7280"; // 회색

  if (nasdaq.ready) {
    // 1. 매도 조건: 200일선 이탈
    if (priceN > 0 && ma200N > 0 && priceN < ma200N) {
      signalType = "SELL";
      signalText = "매도 (30% 비중)";
      signalColor = "#ef4444"; // 빨강
    } 
    // 2. 매수 조건: RSI
    else if (rsiN !== null) {
      if (rsiN < 30) {
        signalType = "BUY"; stage = 3;
        signalText = "매수 (3단계)";
        signalColor = "#dc2626"; // 진한 빨강
      } else if (rsiN < 36) {
        signalType = "BUY"; stage = 2;
        signalText = "매수 (2단계)";
        signalColor = "#f59e0b"; // 주황
      } else if (rsiN < 43) {
        signalType = "BUY"; stage = 1;
        signalText = "매수 (1단계)";
        signalColor = "#eab308"; // 노랑
      } else {
        signalType = "HOLD";
        signalText = "관망";
        signalColor = "#10b981"; // 초록
      }
    }
  }

  /* ===== 수량 계산 ===== */
  const monthNasdaq = (yearlyBudget * 0.6) / 12;
  const monthBigTech = (yearlyBudget * 0.4) / 12;
  const factor = 0.92;

  let ratio = 0;
  if (stage === 1) ratio = 0.14;
  if (stage === 2) ratio = 0.26;
  if (stage === 3) ratio = 0.60;

  const targetAmtN = monthNasdaq * ratio * factor;
  const targetAmtB = monthBigTech * ratio * factor;

  const qtyN = (priceN > 0 && signalType === "BUY") ? Math.floor(targetAmtN / priceN) : 0;
  const priceB = bigtech.price;
  const qtyB = (priceB > 0 && signalType === "BUY") ? Math.floor(targetAmtB / priceB) : 0;

  /* ===== 텍스트 표시 ===== */
  let displayN = "관망";
  let displayB = "관망";

  if (signalType === "SELL") {
    displayN = "30% 매도";
    displayB = "30% 매도";
  } else if (signalType === "BUY") {
    displayN = `${qtyN}주 매수`;
    displayB = `${qtyB}주 매수`;
  }

  if (!nasdaq.ready && !bigtech.ready) {
    return <div style={{ padding: 20 }}>데이터를 불러오는 중입니다...</div>;
  }

  return (
    <div className="total-wrap">
      <h1 className="title">종합 투자 현황</h1>

      <div className="status-table">
        {/* 나스닥 */}
        <div className="t-row">
          <div className="cell label">나스닥 RSI</div>
          <div className="cell val rsi" style={{ color: rsiN < 43 ? "#dc2626" : "#111" }}>
            {rsiN ? rsiN.toFixed(2) : "-"}
          </div>
          <div className="cell label">현재가</div>
          <div className="cell val">{won(priceN)}</div>
        </div>

        {/* 빅테크 */}
        <div className="t-row">
          <div className="cell label">빅테크 RSI</div>
          <div className="cell val rsi">
            {bigtech.rsi ? bigtech.rsi.toFixed(2) : "-"}
          </div>
          <div className="cell label">현재가</div>
          <div className="cell val">{won(priceB)}</div>
        </div>

        {/* 판단 */}
        <div className="t-row highlight">
          <div className="cell label">판단</div>
          <div className="cell val signal" style={{ color: signalColor }}>
            {signalText}
          </div>
          <div className="cell label">200일선</div>
          <div className="cell val" style={{ color: priceN < ma200N ? "#ef4444" : "#2563eb" }}>
            {ma200N ? won(ma200N) : "-"}
          </div>
        </div>

        {/* 실행 가이드 */}
        <div className="action-row">
          <div className="action-col">
            <div className="act-label">나스닥</div>
            <div className="act-val" style={{ color: signalType === "HOLD" ? "#6b7280" : (signalType === "SELL" ? "blue" : "#dc2626") }}>
              {displayN}
            </div>
          </div>
          <div className="action-col">
            <div className="act-label">빅테크</div>
            <div className="act-val" style={{ color: signalType === "HOLD" ? "#6b7280" : (signalType === "SELL" ? "blue" : "#dc2626") }}>
              {displayB}
            </div>
          </div>
        </div>
      </div>

      <div className="footer-info">
        * 매수 기준: 나스닥 RSI (43 / 36 / 30 미만)<br/>
        * 매도 기준: 나스닥 가격이 200일 이평선({ma200N ? won(ma200N) : "-"}) 미만 시
      </div>

      <style jsx>{`
        .total-wrap { max-width: 800px; margin: 0 auto; padding: 20px; font-family: -apple-system, sans-serif; }
        .title { font-size: 22px; font-weight: 800; margin-bottom: 20px; color: #111; }

        .status-table { 
          display: flex; 
          flex-direction: column; 
          border: 1px solid #e5e7eb; 
          border-radius: 12px; 
          overflow: hidden; 
          background: #fff;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .t-row {
          display: grid;
          grid-template-columns: 90px 1fr 90px 1fr;
          border-bottom: 1px solid #f3f4f6;
          align-items: center;
        }
        .highlight { background-color: #f9fafb; }

        .cell { padding: 16px 12px; font-size: 15px; }
        .label { color: #6b7280; font-weight: 600; background: #fff; }
        .val { color: #111; font-weight: 700; text-align: right; }
        
        .rsi { font-weight: 800; font-family: monospace; }
        .signal { font-size: 16px; font-weight: 800; word-break: keep-all; }

        .action-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-bottom: none;
        }
        .action-col {
          padding: 20px;
          text-align: center;
          border-right: 1px solid #f3f4f6;
        }
        .action-col:last-child { border-right: none; }
        
        .act-label { font-size: 14px; color: #6b7280; margin-bottom: 6px; font-weight: 600; }
        .act-val { font-size: 18px; font-weight: 800; word-break: keep-all; }

        .footer-info { margin-top: 16px; font-size: 12px; color: #9ca3af; line-height: 1.5; }

        @media (max-width: 480px) {
          .total-wrap { padding: 12px; }
          .t-row {
            grid-template-columns: 90px 1fr; 
            padding: 8px 0;
          }
          .cell { padding: 10px 12px; font-size: 14px; }
          .act-val { font-size: 16px; }
        }
      `}</style>
    </div>
  );
}
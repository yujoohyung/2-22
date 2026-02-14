"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";

/* ===== [로직 1] 지표 계산 함수 ===== */

// RSI 계산 (Cutler's Method)
function calcRSI(values, period = 14) {
  const n = values.length;
  if (!Array.isArray(values) || n < period + 1) return null;

  // values: [과거, ..., 최신] 가정 (사용처에서 정렬함)
  
  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains[i] = diff;
    else losses[i] = -diff;
  }

  let sumGain = 0, sumLoss = 0;
  for (let i = 1; i <= period; i++) {
    sumGain += gains[i];
    sumLoss += losses[i];
  }

  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;
  
  let val = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - (100 / (1 + (avgGain / avgLoss)));
  let result = val;

  for (let i = period + 1; i < n; i++) {
    sumGain += gains[i] - gains[i - period];
    sumLoss += losses[i] - losses[i - period];
    avgGain = sumGain / period;
    avgLoss = sumLoss / period;
    val = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - (100 / (1 + (avgGain / avgLoss)));
    result = val;
  }

  return result;
}

// 200일 이동평균선 (SMA)
function calcSMA(values, period = 200) {
  const n = values.length;
  if (n < period) return null;
  let sum = 0;
  for (let i = n - period; i < n; i++) {
    sum += values[i];
  }
  return sum / period;
}

const won = (n) => n > 0 ? Number(Math.round(n)).toLocaleString("ko-KR") + "원" : "-";

/* ===== [로직 2] 데이터 가져오기 (Hook) ===== */
function useStockData(code) {
  const [data, setData] = useState({ price: 0, rsi: null, ma200: null, ready: false });

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        const pad = (n) => String(n).padStart(2, "0");
        const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        
        const today = new Date();
        const end = ymd(today);
        const startDt = new Date(today); 
        startDt.setDate(startDt.getDate() - 500); 
        const start = ymd(startDt);

        // 일봉
        const resDaily = await fetch(`/api/kis/daily?code=${code}&start=${start}&end=${end}`);
        const jsonDaily = await resDaily.json();
        
        let items = jsonDaily.output || jsonDaily.output2 || [];
        let candles = items.map(item => ({
          date: item.stck_bsop_date,
          close: Number(item.stck_clpr)
        })).filter(c => c.close > 0 && c.date).sort((a, b) => a.date.localeCompare(b.date));

        // 현재가
        const resNow = await fetch(`/api/kis/now?code=${code}`);
        const jsonNow = await resNow.json();
        const nowPrice = Number(jsonNow.output?.stck_prpr || 0);

        if (!isMounted) return;

        // 병합
        if (nowPrice > 0 && candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          const todayStr = ymd(today);
          if (lastCandle.date === todayStr) {
            lastCandle.close = nowPrice;
          } else {
            candles.push({ date: todayStr, close: nowPrice });
          }
        }

        const closes = candles.map(c => c.close);
        const rsi = calcRSI(closes, 14);
        const ma200 = calcSMA(closes, 200);
        const finalPrice = nowPrice > 0 ? nowPrice : (closes.length > 0 ? closes[closes.length - 1] : 0);

        setData({ price: finalPrice, rsi, ma200, ready: true });

      } catch (e) {
        console.error(`Error fetching ${code}:`, e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => { isMounted = false; clearInterval(interval); };
  }, [code]);

  return data;
}

export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  
  // 데이터 훅
  const nasdaq = useStockData("418660");
  const bigtech = useStockData("465610");

  // 예치금 로드
  useEffect(() => {
    (async () => {
      try {
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
      } catch (e) { console.error(e); }
    })();
  }, [setYearlyBudget]);

  /* ===== [로직 3] 판단 및 수량 계산 ===== */
  
  const rsiN = nasdaq.rsi;
  const priceN = nasdaq.price;
  const ma200N = nasdaq.ma200;

  let signalType = "HOLD"; // SELL, BUY, HOLD
  let stage = 0; 
  let signalText = nasdaq.ready ? "관망" : "데이터 로딩중...";
  let signalColor = nasdaq.ready ? "#10b981" : "#9ca3af"; // 초록(준비됨) vs 회색(로딩)

  // 데이터가 준비되었을 때만 판단
  if (nasdaq.ready) {
    // 1. 매도 조건: 200일선 이탈
    if (priceN > 0 && ma200N > 0 && priceN < ma200N) {
      signalType = "SELL";
      signalText = "매도 (30% 비중)";
      signalColor = "#ef4444"; // 빨강
    } 
    // 2. 매수 조건: RSI 기준
    else if (rsiN !== null) {
      if (rsiN < 30) {
        signalType = "BUY"; stage = 3;
        signalText = "3단계 매수";
        signalColor = "#dc2626"; // 진한 빨강
      } else if (rsiN < 36) {
        signalType = "BUY"; stage = 2;
        signalText = "2단계 매수";
        signalColor = "#f59e0b"; // 주황
      } else if (rsiN < 43) {
        signalType = "BUY"; stage = 1;
        signalText = "1단계 매수";
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

  // 매수 신호(BUY)일 때만 수량 계산, 아니면 0
  const qtyN = (signalType === "BUY" && priceN > 0) ? Math.floor(targetAmtN / priceN) : 0;
  const priceB = bigtech.price;
  const qtyB = (signalType === "BUY" && priceB > 0) ? Math.floor(targetAmtB / priceB) : 0;

  /* ===== 텍스트 표시 ===== */
  let displayN = "-";
  let displayB = "-";

  if (nasdaq.ready) {
    if (signalType === "SELL") {
      displayN = "30% 매도";
      displayB = "30% 매도";
    } else if (signalType === "BUY") {
      displayN = `${qtyN}주 매수`;
      displayB = `${qtyB}주 매수`;
    } else {
      displayN = "관망";
      displayB = "관망";
    }
  }

  return (
    <div className="total-wrap">
      <h1 className="title">종합 투자 현황</h1>

      <div className="status-table">
        {/* Row 1: 나스닥 */}
        <div className="t-row">
          <div className="cell label">나스닥 RSI</div>
          <div className="cell val rsi" style={{ color: rsiN && rsiN < 43 ? "#dc2626" : "#111" }}>
            {nasdaq.ready ? (rsiN ? rsiN.toFixed(2) : "-") : "..."}
          </div>
          <div className="cell label">현재가</div>
          <div className="cell val">
            {nasdaq.ready ? won(priceN) : "..."}
          </div>
        </div>

        {/* Row 2: 빅테크 */}
        <div className="t-row">
          <div className="cell label">빅테크 RSI</div>
          <div className="cell val rsi">
            {bigtech.ready ? (bigtech.rsi ? bigtech.rsi.toFixed(2) : "-") : "..."}
          </div>
          <div className="cell label">현재가</div>
          <div className="cell val">
            {bigtech.ready ? won(priceB) : "..."}
          </div>
        </div>

        {/* Row 3: 판단 & MA200 */}
        <div className="t-row highlight">
          <div className="cell label">판단</div>
          <div className="cell val signal" style={{ color: signalColor }}>
            {signalText}
          </div>
          <div className="cell label">200일선</div>
          <div className="cell val" style={{ color: (priceN > 0 && ma200N > 0 && priceN < ma200N) ? "#ef4444" : "#2563eb" }}>
            {nasdaq.ready ? (ma200N ? won(ma200N) : "-") : "..."}
          </div>
        </div>

        {/* Row 4: 실행 가이드 */}
        <div className="action-row">
          <div className="action-col">
            <div className="act-label">나스닥</div>
            <div className="act-val" style={{ color: signalType === "SELL" ? "blue" : (signalType === "BUY" ? "#dc2626" : "#6b7280") }}>
              {displayN}
            </div>
          </div>
          <div className="action-col">
            <div className="act-label">빅테크</div>
            <div className="act-val" style={{ color: signalType === "SELL" ? "blue" : (signalType === "BUY" ? "#dc2626" : "#6b7280") }}>
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
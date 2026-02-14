"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";

/* ===== [로직 1] 지표 계산 함수 (대시보드/Stock2와 동일한 Cutler 방식) ===== */
function calcRSI_Cutler(values, period = 14) {
  const n = values.length;
  if (!Array.isArray(values) || n < period + 1) return null;

  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains[i] = diff;
    else losses[i] = -diff;
  }

  let sumG = 0, sumL = 0;
  // 초기 period
  for (let i = 1; i <= period; i++) {
    sumG += gains[i];
    sumL += losses[i];
  }

  // 이후 계산
  let currentRSI = null;
  
  // 첫 구간
  let avgG = sumG / period;
  let avgL = sumL / period;
  currentRSI = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - (100 / (1 + (avgG / avgL)));

  // 슬라이딩 윈도우 (전체 배열 순회하여 마지막 값 도출)
  for (let i = period + 1; i < n; i++) {
    sumG += gains[i] - gains[i - period];
    sumL += losses[i] - losses[i - period];
    avgG = sumG / period;
    avgL = sumL / period;
    currentRSI = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - (100 / (1 + (avgG / avgL)));
  }

  return currentRSI;
}

/* 200일 이동평균선 (단순) */
function calcSMA(values, period = 200) {
  const n = values.length;
  if (n < period) return null;
  let sum = 0;
  for (let i = n - period; i < n; i++) {
    sum += values[i];
  }
  return sum / period;
}

/* 포맷터 */
const won = (n) => (n > 0 ? Number(Math.round(n)).toLocaleString("ko-KR") + "원" : "-");

/* ===== [로직 2] 데이터 훅 (일봉 + 실시간 병합) ===== */
function useStockData(code) {
  const [data, setData] = useState({ price: 0, rsi: null, ma200: null, ready: false });

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        // 날짜 계산 (400일 전 ~ 오늘)
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        const todayStr = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
        
        const startDt = new Date(d);
        startDt.setDate(startDt.getDate() - 400);
        const startStr = `${startDt.getFullYear()}${p(startDt.getMonth() + 1)}${p(startDt.getDate())}`;

        // 1. 일봉 데이터
        const resDaily = await fetch(`/api/kis/daily?code=${code}&start=${startStr}&end=${todayStr}`);
        const jsonDaily = await resDaily.json();
        const items = jsonDaily.output || jsonDaily.output2 || [];
        
        // 날짜 오름차순 정렬 (과거 -> 현재)
        let candles = items.map((item) => ({
          date: item.stck_bsop_date,
          close: Number(item.stck_clpr)
        })).filter((c) => c.close > 0 && c.date).sort((a, b) => a.date.localeCompare(b.date));

        // 2. 실시간 현재가
        const resNow = await fetch(`/api/kis/now?code=${code}`);
        const jsonNow = await resNow.json();
        const nowPrice = Number(jsonNow.output?.stck_prpr || 0);

        if (!isMounted) return;

        // 3. 병합 (실시간 가격 반영)
        // 차트 데이터가 있으면 마지막 캔들 확인
        if (candles.length > 0 && nowPrice > 0) {
          const lastCandle = candles[candles.length - 1];
          if (lastCandle.date === todayStr) {
            // 오늘 날짜 캔들이면 가격 업데이트
            lastCandle.close = nowPrice;
          } else {
            // 오늘 날짜가 아니면(어제까지 데이터) 오늘 캔들 추가
            candles.push({ date: todayStr, close: nowPrice });
          }
        } else if (candles.length === 0 && nowPrice > 0) {
            // 차트 데이터 실패 시 현재가라도 넣음
            candles.push({ date: todayStr, close: nowPrice });
        }

        // 4. 지표 계산
        const closes = candles.map((c) => c.close);
        const rsi = calcRSI_Cutler(closes, 14);
        const ma200 = calcSMA(closes, 200);
        const finalPrice = nowPrice > 0 ? nowPrice : (closes.length > 0 ? closes[closes.length - 1] : 0);

        setData({ price: finalPrice, rsi, ma200, ready: true });

      } catch (e) {
        console.error(`Error fetching ${code}`, e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // 30초 갱신
    return () => { isMounted = false; clearInterval(interval); };
  }, [code]);

  return data;
}

export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  
  // 데이터 로드
  const nasdaq = useStockData("418660"); // 나스닥
  const bigtech = useStockData("465610"); // 빅테크

  // 예치금 설정 로드
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

  /* ===== [로직 3] 매매 판단 (나스닥 기준) ===== */
  const rsiN = nasdaq.rsi;
  const priceN = nasdaq.price;
  const ma200N = nasdaq.ma200;

  let signalType = "HOLD"; // BUY, SELL, HOLD
  let stage = 0; 
  let signalText = nasdaq.ready ? "관망" : "데이터 로딩중...";
  let signalColor = nasdaq.ready ? "#10b981" : "#9ca3af"; // 초록/회색

  if (nasdaq.ready) {
    // 1. 매도: 200일선 이탈
    if (priceN > 0 && ma200N > 0 && priceN < ma200N) {
      signalType = "SELL";
      signalText = "매도 (30% 비중)";
      signalColor = "#ef4444"; // 빨강
    }
    // 2. 매수: RSI 기준
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

  /* ===== [로직 4] 수량 계산 (예치금 페이지 공식 동일) ===== */
  const monthAvg = yearlyBudget / 12;
  const factor = 0.92;

  // 단계별 비율
  let stageRatio = 0;
  if (stage === 1) stageRatio = 0.14;
  else if (stage === 2) stageRatio = 0.26;
  else if (stage === 3) stageRatio = 0.60;

  // 종목별 할당 금액 (나스닥 60%, 빅테크 40%)
  const amtNasdaq = monthAvg * 0.60 * stageRatio * factor;
  const amtBigtech = monthAvg * 0.40 * stageRatio * factor;

  // 수량 계산 (매수 신호일 때만)
  const qtyN = (signalType === "BUY" && priceN > 0) ? Math.floor(amtNasdaq / priceN) : 0;
  const priceB = bigtech.price;
  const qtyB = (signalType === "BUY" && priceB > 0) ? Math.floor(amtBigtech / priceB) : 0;

  /* ===== [로직 5] 최종 표시 텍스트 ===== */
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
      // HOLD 상태
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
        * 매도 기준: 나스닥 가격이 200일 이평선({nasdaq.ready && ma200N ? won(ma200N) : "-"}) 미만 시
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
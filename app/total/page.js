"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";

/* ===== 유틸: 원화 포맷터 ===== */
const won = (n) => Number(Math.round(n ?? 0)).toLocaleString("ko-KR") + "원";

export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  
  // 상태 관리
  // nasdaqData: 나스닥 (418660) - RSI, MA200, 현재가
  const [nasdaqData, setNasdaqData] = useState({ rsi: null, ma200: 0, price: 0 });
  // bigtechData: 빅테크 (465610) - RSI, 현재가
  const [bigtechData, setBigtechData] = useState({ rsi: null, price: 0 });
  
  const [loading, setLoading] = useState(true);

  // 1. 데이터 로드 (API 호출)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // A. 예치금 설정 가져오기
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

        // B. 나스닥 (418660) 데이터 가져오기 (RSI, MA200, Price)
        // ma200 API가 RSI와 현재가까지 모두 계산해서 반환하도록 수정되었음을 가정
        const resN = await fetch(`/api/kis/ma200?symbol=418660`);
        const jsonN = await resN.json();
        if (jsonN.ok) {
          setNasdaqData({
            rsi: jsonN.rsi,
            ma200: jsonN.ma200,
            price: jsonN.price
          });
        }

        // C. 빅테크 (465610) 데이터 가져오기 (RSI, Price)
        const resB = await fetch(`/api/kis/ma200?symbol=465610`);
        const jsonB = await resB.json();
        if (jsonB.ok) {
          setBigtechData({
            rsi: jsonB.rsi,
            price: jsonB.price // 빅테크는 MA200 판단 로직이 없으므로 price, rsi만 사용
          });
        }

      } catch (e) {
        console.error("Data load failed:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
    // 1분마다 갱신 (실시간성 유지)
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [setYearlyBudget]);

  /* ===== 2. 판단 로직 (나스닥 기준) ===== */
  
  // ★★★ 테스트용 (주석 풀면 강제 적용) ★★★
  // const TEST_RSI = 40; // 1단계 테스트 (43 미만)
  
  const rsiN = (typeof TEST_RSI !== 'undefined') ? TEST_RSI : nasdaqData.rsi;
  const priceN = nasdaqData.price;
  const ma200N = nasdaqData.ma200;

  // 매매 신호 (우선순위: 매도 > 매수 > 관망)
  let signalType = "HOLD"; // SELL, BUY, HOLD
  let stage = 0; // 1, 2, 3
  let signalText = "관망";
  let signalColor = "#6b7280"; // 회색

  // 매도: 나스닥 현재가 < 200일선
  if (priceN > 0 && ma200N > 0 && priceN < ma200N) {
    signalType = "SELL";
    signalText = "매도 (30% 비중)";
    signalColor = "#ef4444"; // 빨강
  } 
  // 매수: 나스닥 RSI 기준
  else if (rsiN !== null) {
    if (rsiN < 30) {
      signalType = "BUY";
      stage = 3;
      signalText = "매수 / 3단계";
      signalColor = "#dc2626"; // 진한 빨강
    } else if (rsiN < 36) {
      signalType = "BUY";
      stage = 2;
      signalText = "매수 / 2단계";
      signalColor = "#f59e0b"; // 주황
    } else if (rsiN < 43) {
      signalType = "BUY";
      stage = 1;
      signalText = "매수 / 1단계";
      signalColor = "#eab308"; // 노랑
    }
  }

  /* ===== 3. 수량 계산 ===== */
  // 예치금 페이지 공식과 동일 (60:40 배분)
  const monthNasdaq = (yearlyBudget * 0.6) / 12;
  const monthBigTech = (yearlyBudget * 0.4) / 12;
  const factor = 0.92;

  // 단계별 비율 (관망일 때도 1단계 기준 수량을 보여주기 위해 ratio 설정)
  let ratio = 0;
  if (stage === 3) ratio = 0.60;
  else if (stage === 2) ratio = 0.26;
  else ratio = 0.14; // 기본 1단계(14%) 기준 (관망 또는 1단계)

  // 목표 금액
  const targetAmtN = monthNasdaq * ratio * factor;
  const targetAmtB = monthBigTech * ratio * factor;

  // 수량 계산
  // 매도 신호일 때는 계산 안 함.
  // 관망 상태일 때도 "1단계 기준 수량"을 보여주고 싶다면 아래 조건 수정 가능.
  // 여기서는 "매수 신호"일 때 해당 단계 수량을, "관망"일 때는 "-"를 표시하되
  // 요청하신 대로 "관망이라 확인이 안 된다"는 점을 고려하여,
  // 관망 상태에서도 '1단계 진입 시 예상 수량'을 흐릿하게라도 보여주는 것이 좋을 수 있으나,
  // 명확한 시그널 전달을 위해 일단은 매수/매도 시그널에 맞춰 표시합니다.
  // (만약 관망 때도 보고 싶으시면 signalType check를 제거하면 됩니다)
  
  const qtyN = (priceN > 0) ? Math.floor(targetAmtN / priceN) : 0;
  const priceB = bigtechData.price;
  const qtyB = (priceB > 0) ? Math.floor(targetAmtB / priceB) : 0;

  /* ===== 4. 표시 텍스트 ===== */
  let displayN = "-";
  let displayB = "-";

  if (signalType === "SELL") {
    displayN = "30% 매도";
    displayB = "30% 매도";
  } else if (signalType === "BUY") {
    displayN = `${qtyN}주 매수`;
    displayB = `${qtyB}주 매수`;
  } else {
    // 관망 상태
    displayN = "관망";
    displayB = "관망";
  }

  if (loading) return <div style={{ padding: 20 }}>데이터 로딩중...</div>;

  return (
    <div className="total-wrap">
      <h1 className="title">종합 투자 현황</h1>

      <div className="status-table">
        {/* Row 1: 나스닥 */}
        <div className="t-row">
          <div className="label">나스닥 RSI</div>
          <div className="val rsi" style={{ color: rsiN < 43 ? "#dc2626" : "#111" }}>
            {rsiN ? rsiN.toFixed(1) : "-"}
          </div>
          <div className="label">현재가</div>
          <div className="val">{won(priceN)}</div>
        </div>

        {/* Row 2: 빅테크 */}
        <div className="t-row">
          <div className="label">빅테크 RSI</div>
          <div className="val rsi">
            {bigtechData.rsi ? bigtechData.rsi.toFixed(1) : "-"}
          </div>
          <div className="label">현재가</div>
          <div className="val">{won(priceB)}</div>
        </div>

        {/* Row 3: 판단 & MA200 */}
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

        {/* Row 4: 실행 가이드 */}
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
        * 매도 기준: 나스닥 가격이 200일 이평선({won(ma200N)}) 미만 시
      </div>

      <style jsx>{`
        .total-wrap { max-width: 800px; margin: 0 auto; padding: 20px; font-family: -apple-system, sans-serif; }
        .title { font-size: 24px; font-weight: 800; margin-bottom: 24px; color: #111; }

        .status-table { 
          display: flex; 
          flex-direction: column; 
          border: 1px solid #e5e7eb; 
          border-radius: 16px; 
          overflow: hidden; 
          box-shadow: 0 4px 6px rgba(0,0,0,0.03); 
          background: #fff;
        }

        .t-row {
          display: grid; 
          grid-template-columns: 1fr 1fr 1fr 1fr; 
          padding: 20px; 
          border-bottom: 1px solid #f3f4f6;
          align-items: center;
        }
        .t-row:last-child { border-bottom: none; }
        
        .label { font-size: 14px; color: #6b7280; font-weight: 600; }
        .val { font-size: 16px; font-weight: 700; color: #111; text-align: right; }
        .rsi { font-weight: 800; }
        .signal { font-size: 17px; font-weight: 800; }

        .highlight { background-color: #f9fafb; }

        /* 실행 가이드 행 (2컬럼) */
        .action-row {
          display: grid;
          grid-template-columns: 1fr 1fr; /* 2등분 */
          gap: 0;
          padding: 0;
        }
        .action-col {
          padding: 24px;
          text-align: center;
          border-right: 1px solid #f3f4f6;
        }
        .action-col:last-child { border-right: none; }
        
        .act-label { font-size: 14px; color: #6b7280; margin-bottom: 8px; font-weight: 600; }
        .act-val { font-size: 20px; font-weight: 800; }

        .footer-info { margin-top: 20px; font-size: 13px; color: #9ca3af; line-height: 1.6; }

        /* 모바일 대응 */
        @media (max-width: 480px) {
          .total-wrap { padding: 12px; }
          .t-row { 
            grid-template-columns: 1fr 1fr; 
            gap: 12px;
            padding: 16px;
          }
          /* 모바일에서 라벨-값 줄바꿈 처리 */
          .label { font-size: 13px; }
          .val { font-size: 15px; }
          
          .action-col { padding: 20px 10px; }
          .act-val { font-size: 18px; }
        }
      `}</style>
    </div>
  );
}
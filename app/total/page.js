"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";

/* ===== 유틸: 원화 포맷터 ===== */
const won = (n) => Number(Math.round(n ?? 0)).toLocaleString("ko-KR") + "원";

/* ===== 실시간 가격 훅 ===== */
function useLivePrice(code) {
  const [price, setPrice] = useState(0);
  useEffect(() => {
    if (!code) return;
    const fetchPrice = async () => {
      try {
        const res = await fetch(`/api/price?symbol=${code}`);
        const data = await res.json();
        if (data.price) setPrice(data.price);
      } catch (e) {
        console.error(e);
      }
    };
    fetchPrice();
    const t = setInterval(fetchPrice, 5000);
    return () => clearInterval(t);
  }, [code]);
  return { price };
}

export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  
  // 1. 상태 관리
  const [ma200, setMa200] = useState(0);
  const [rsi, setRsi] = useState(null); // 나스닥 RSI
  const [loading, setLoading] = useState(true);

  // 2. 실시간 가격 (나스닥: 418660, 빅테크: 465610)
  const { price: priceN } = useLivePrice("418660"); 
  const { price: priceB } = useLivePrice("465610"); 

  // 3. 데이터 로드 (MA200, RSI, 예산)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // A. 예치금 설정
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

        // B. MA200 (나스닥 418660 기준)
        const maRes = await fetch(`/api/kis/ma200?symbol=418660`);
        const maJson = await maRes.json();
        if (maJson.ok) {
          setMa200(maJson.ma200);
        }

        // C. RSI (나스닥 기준)
        const sigRes = await fetch("/api/signals/check?force=1");
        const sigJson = await sigRes.json();
        if (sigJson?.ok) {
          setRsi(sigJson.rsi);
        }

      } catch (e) {
        console.error("Data load failed:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [setYearlyBudget]);

  /* ===== 4. 로직 판단 ===== */
  
  // ★★★ 테스트 영역: 아래 주석을 풀면 1단계 매수 화면을 미리 볼 수 있습니다 ★★★
  // const TEST_RSI = 40;  // 1단계 테스트 (43 미만)
  // const TEST_RSI = 35;  // 2단계 테스트 (36 미만)
  // const TEST_RSI = 25;  // 3단계 테스트 (30 미만)
  
  // 실제 RSI 사용 (테스트 값이 있으면 그것을 사용)
  const currentRsi = (typeof TEST_RSI !== 'undefined') ? TEST_RSI : rsi;


  // (1) 매매 신호 (우선순위: 매도 > 매수 > 관망)
  let signalType = "HOLD"; // SELL, BUY, HOLD
  let stage = 0; // 1, 2, 3
  let signalText = "관망";
  let signalColor = "#6b7280"; // 회색

  // 매도 조건: 나스닥 현재가가 200일선 미만
  if (priceN > 0 && ma200 > 0 && priceN < ma200) {
    signalType = "SELL";
    signalText = "매도 (30% 비중)";
    signalColor = "#ef4444"; // 빨강 (경고)
  } 
  // 매수 조건: RSI 기준
  else if (currentRsi !== null) {
    if (currentRsi < 30) {
      signalType = "BUY";
      stage = 3;
      signalText = "매수 / 3단계";
      signalColor = "#dc2626"; // 진한 빨강
    } else if (currentRsi < 36) {
      signalType = "BUY";
      stage = 2;
      signalText = "매수 / 2단계";
      signalColor = "#f59e0b"; // 주황
    } else if (currentRsi < 43) {
      signalType = "BUY";
      stage = 1;
      signalText = "매수 / 1단계";
      signalColor = "#eab308"; // 노랑
    }
  }

  // (2) 수량 계산 (매수일 때만 계산 - 예치금 페이지와 동일 공식)
  // 예산 배분: 나스닥 60%, 빅테크 40%
  const monthNasdaq = (yearlyBudget * 0.6) / 12;
  const monthBigTech = (yearlyBudget * 0.4) / 12;
  const factor = 0.92;

  // 단계별 비율
  let ratio = 0;
  if (stage === 1) ratio = 0.14;
  if (stage === 2) ratio = 0.26;
  if (stage === 3) ratio = 0.60;

  // 목표 매수 금액
  const targetAmtN = monthNasdaq * ratio * factor;
  const targetAmtB = monthBigTech * ratio * factor;

  // 수량 (소수점 버림)
  const qtyN = (signalType === "BUY" && priceN > 0) ? Math.floor(targetAmtN / priceN) : 0;
  const qtyB = (signalType === "BUY" && priceB > 0) ? Math.floor(targetAmtB / priceB) : 0;

  // (3) 최종 표시 텍스트 생성
  let displayN = "-";
  let displayB = "-";

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

  if (loading) return <div style={{ padding: 20 }}>데이터 로딩중...</div>;

  return (
    <div className="total-wrap">
      <h1 className="title">종합 투자 현황</h1>

      <div className="status-table">
        {/* Row 1: 나스닥 정보 */}
        <div className="t-row">
          <div className="label">나스닥 RSI</div>
          <div className="val rsi" style={{ color: currentRsi < 43 ? "#dc2626" : "#111" }}>
            {currentRsi ? currentRsi.toFixed(1) : "-"}
          </div>
          <div className="label">현재가</div>
          <div className="val">{won(priceN)}</div>
        </div>

        {/* Row 2: 빅테크 정보 */}
        <div className="t-row">
          <div className="label">빅테크 RSI</div>
          <div className="val">-</div>
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
          <div className="val" style={{ color: priceN < ma200 ? "#ef4444" : "#2563eb" }}>
            {won(ma200)}
          </div>
        </div>

        {/* Row 4: 실행 가이드 */}
        <div className="t-row action-row">
          <div className="action-col">
            <div className="act-label">나스닥 (418660)</div>
            <div className="act-val" style={{ color: signalType === "SELL" ? "blue" : "#dc2626" }}>
              {displayN}
            </div>
          </div>
          <div className="action-col">
            <div className="act-label">빅테크 (465610)</div>
            <div className="act-val" style={{ color: signalType === "SELL" ? "blue" : "#dc2626" }}>
              {displayB}
            </div>
          </div>
        </div>
      </div>

      <div className="footer-info">
        * 매수 기준: 나스닥 RSI (43/36/30 미만)<br/>
        * 매도 기준: 나스닥 가격이 200일 이평선({won(ma200)}) 미만 시
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
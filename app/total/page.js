"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";

/* ===== 유틸 ===== */
const won = (n) => Number(Math.round(n ?? 0)).toLocaleString("ko-KR") + "원";

/* ===== 컴포넌트 ===== */
export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  
  // 상태 관리
  const [ma200, setMa200] = useState(0);
  const [currentPrice, setCurrentPrice] = useState(0); // API로 가져온 현재가
  const [rsi, setRsi] = useState(null);
  const [loading, setLoading] = useState(true);

  // 설정값 (나스닥 2배 종목 코드 - 실제 코드로 변경하세요)
  // 예: TIGER 미국나스닥100레버리지(합성) = 418660
  const TARGET_CODE = "418660"; 

  // 1. 데이터 로드 (MA200, RSI, 예치금)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // A. 예치금 가져오기
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

        // B. MA200 및 현재가 가져오기 (새로 만든 API)
        const maRes = await fetch(`/api/kis/ma200?symbol=${TARGET_CODE}`);
        const maJson = await maRes.json();
        if (maJson.ok) {
          setMa200(maJson.ma200);
          setCurrentPrice(maJson.currentPrice);
        }

        // C. RSI 가져오기 (기존 API 활용)
        const sigRes = await fetch("/api/signals/check?force=1");
        const sigJson = await sigRes.json();
        if (sigJson?.ok) {
          setRsi(sigJson.rsi);
        }

      } catch (e) {
        console.error("Error loading total data:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [setYearlyBudget]);

  /* ===== 2. 계산 로직 ===== */
  // 예산 배분 (14% / 26% / 60%)
  const mAvg = yearlyBudget / 12; // 월 평균
  const factor = 0.92; // 환율 등 보정 계수
  
  const budget1 = mAvg * 0.14 * factor;
  const budget2 = mAvg * 0.26 * factor;
  const budget3 = mAvg * 0.60 * factor;

  // 수량 계산 (현재가가 0이면 0)
  const qty1 = currentPrice ? Math.floor(budget1 / currentPrice) : 0;
  const qty2 = currentPrice ? Math.floor(budget2 / currentPrice) : 0;
  const qty3 = currentPrice ? Math.floor(budget3 / currentPrice) : 0;

  /* ===== 3. 상태 판단 ===== */
  let status = "관망";
  let statusColor = "#9ca3af"; // 회색
  let activeStep = 0;

  if (currentPrice > 0 && ma200 > 0 && currentPrice < ma200) {
    status = "🚨 200일선 이탈 (매도/관망)";
    statusColor = "#ef4444"; // 빨강
  } else if (rsi !== null) {
    if (rsi < 30) {
      status = "🔥 3단계 매수 (풀매수)";
      statusColor = "#dc2626"; // 진한 빨강
      activeStep = 3;
    } else if (rsi < 36) {
      status = "🟠 2단계 매수";
      statusColor = "#f59e0b"; // 주황
      activeStep = 2;
    } else if (rsi < 43) {
      status = "🟡 1단계 매수";
      statusColor = "#eab308"; // 노랑
      activeStep = 1;
    } else {
      status = "🟢 홀딩 / 관망";
      statusColor = "#10b981"; // 초록
    }
  }

  if (loading) return <div style={{ padding: 20 }}>데이터를 불러오는 중...</div>;

  return (
    <div className="total-container">
      <h1 className="page-title">종합 투자 현황</h1>

      {/* 상단 카드 영역 */}
      <div className="card-grid">
        <StatusCard title="현재 RSI" value={rsi ? rsi.toFixed(1) : "-"} color={rsi < 30 ? "red" : "black"} />
        <StatusCard title="현재 주가" value={won(currentPrice)} />
        <StatusCard title="200일 이평선" value={won(ma200)} subValue={currentPrice < ma200 ? "이탈 발생" : "지지 중"} subColor={currentPrice < ma200 ? "red" : "blue"} />
        <StatusCard title="매매 신호" value={status} color={statusColor} bold />
      </div>

      {/* 전략 테이블 */}
      <div className="strategy-section">
        <h2 className="section-title">RSI 매수 전략 (월 적립식)</h2>
        <div className="strategy-table">
          <div className="table-head">
            <div>단계</div>
            <div>매수 조건</div>
            <div>금액</div>
            <div>수량</div>
          </div>
          
          <StrategyRow 
            step="1단계" 
            cond="RSI 43 미만" 
            amt={won(budget1)} 
            qty={`${qty1}주`} 
            active={activeStep === 1} 
          />
          <StrategyRow 
            step="2단계" 
            cond="RSI 36 미만" 
            amt={won(budget2)} 
            qty={`${qty2}주`} 
            active={activeStep === 2} 
          />
          <StrategyRow 
            step="3단계" 
            cond="RSI 30 미만" 
            amt={won(budget3)} 
            qty={`${qty3}주`} 
            active={activeStep === 3} 
          />
        </div>
        <p className="info-text">
          * 매도 기준: 주가가 200일 이평선({won(ma200)}) 아래로 내려갈 때
        </p>
      </div>

      <style jsx>{`
        .total-container { max-width: 800px; margin: 0 auto; padding: 20px; font-family: -apple-system, sans-serif; }
        .page-title { font-size: 24px; font-weight: 800; margin-bottom: 24px; color: #111; }
        
        .card-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
        
        .strategy-section { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .section-title { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #374151; }
        
        .strategy-table { display: flex; flexDirection: column; }
        .table-head { display: grid; grid-template-columns: 1fr 1.5fr 1fr 1fr; padding-bottom: 12px; border-bottom: 2px solid #f3f4f6; font-weight: 700; color: #6b7280; font-size: 14px; text-align: right; }
        .table-head div:first-child { text-align: left; }
        .table-head div:nth-child(2) { text-align: center; }

        .info-text { margin-top: 16px; font-size: 13px; color: #9ca3af; text-align: right; }

        @media (max-width: 600px) {
          .card-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function StatusCard({ title, value, subValue, color = "#111", subColor = "#666", bold }) {
  return (
    <div style={{ background: "#fff", padding: "20px", borderRadius: "16px", border: "1px solid #e5e7eb", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
      <div style={{ fontSize: "14px", color: "#6b7280", marginBottom: "8px" }}>{title}</div>
      <div style={{ fontSize: "20px", fontWeight: bold ? "800" : "600", color: color }}>{value}</div>
      {subValue && <div style={{ fontSize: "12px", color: subColor, marginTop: "4px", fontWeight: "600" }}>{subValue}</div>}
    </div>
  );
}

function StrategyRow({ step, cond, amt, qty, active }) {
  return (
    <div style={{ 
      display: "grid", 
      gridTemplateColumns: "1fr 1.5fr 1fr 1fr", 
      padding: "16px 0", 
      borderBottom: "1px solid #f3f4f6",
      backgroundColor: active ? "#fffbeb" : "transparent",
      color: active ? "#d97706" : "#1f2937",
      alignItems: "center",
      textAlign: "right"
    }}>
      <div style={{ textAlign: "left", fontWeight: active ? "800" : "500" }}>{step}</div>
      <div style={{ textAlign: "center", fontSize: "14px" }}>{cond}</div>
      <div style={{ fontSize: "14px", color: "#6b7280" }}>{amt}</div>
      <div style={{ fontWeight: "700" }}>{qty}</div>
    </div>
  );
}
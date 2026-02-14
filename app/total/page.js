// app/total/page.jsx
"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";

/* ===== 유틸: 포맷터 ===== */
const won = (n) => Number(Math.round(n ?? 0)).toLocaleString("ko-KR") + "원";

/* ===== 유틸: 가격 실시간 훅 ===== */
function useLivePrice(symbol, { intervalMs = 4000 } = {}) {
  const [price, setPrice] = useState(null);
  useEffect(() => {
    let aborted = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/price?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const data = await res.json();
        if (aborted) return;
        const p = Number(data?.price);
        if (Number.isFinite(p)) setPrice(p);
      } catch (e) { console.error("Price fetch error", e); }
    };
    fetchOnce();
    const timer = setInterval(fetchOnce, intervalMs);
    return () => { clearInterval(timer); aborted = true; };
  }, [symbol, intervalMs]);
  return { price };
}

/* ===== 유틸: Access Token ===== */
async function getAccessToken() {
  try {
    const { data } = await supa.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

export default function TotalPage() {
  const { yearlyBudget, setYearlyBudget } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [signalData, setSignalData] = useState({ rsi: null, ma200: null });

  // 1. 실시간 가격 (나스닥 2배)
  const { price: priceN } = useLivePrice("NASDAQ2X");

  // 2. 초기 데이터 로드 (유저설정 + 시그널 API)
  useEffect(() => {
    (async () => {
      try {
        // A. 유저 예치금 설정 가져오기
        const token = await getAccessToken();
        const userRes = await fetch("/api/user-settings/me", { 
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store" 
        });
        const userJson = await userRes.json();
        if (userJson?.ok && userJson.data) {
          setYearlyBudget(Number(userJson.data.yearly_budget || 0));
        }

        // B. 시그널(RSI, MA200) 가져오기
        // 주의: cron용 auth가 필요하다면 headers에 추가해야 함. 여기선 공개라고 가정하거나 내부 호출 사용.
        // 클라이언트에서 직접 호출 시 CRON_SECRET 보안 문제가 있을 수 있으므로,
        // 실제로는 별도 public API를 통하거나 해야 하지만, 일단 요청하신 흐름대로 진행합니다.
        // (개발 환경이나 내부망에서는 보통 호출 가능)
        const sigRes = await fetch("/api/signals/check?force=1", { // force=1로 현재 상태 강제 조회
           headers: { Authorization: process.env.NEXT_PUBLIC_CRON_SECRET || "" } 
        }); 
        // 만약 위 호출이 401이면, api/signals/check를 클라이언트용으로 수정하거나
        // 별도 조회 API를 만들어야 합니다. 여기서는 데이터가 온다고 가정합니다.
        
        const sigJson = await sigRes.json();
        if (sigJson?.ok) {
          setSignalData({ rsi: sigJson.rsi, ma200: sigJson.ma200 });
        }
      } catch (e) {
        console.error("Load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [setYearlyBudget]);

  /* ===== 3. 수량 계산 로직 (예치금 페이지와 동일) ===== */
  const mAvg = useMemo(() => yearlyBudget / 12, [yearlyBudget]); 
  const factor = 0.92;
  
  // 나스닥 1, 2, 3단계 예산
  const n1_budget = mAvg * 0.14 * factor;
  const n2_budget = mAvg * 0.26 * factor;
  const n3_budget = mAvg * 0.60 * factor;

  // 수량 (현재가 기준)
  const qty1 = priceN ? Math.floor(n1_budget / priceN) : 0;
  const qty2 = priceN ? Math.floor(n2_budget / priceN) : 0;
  const qty3 = priceN ? Math.floor(n3_budget / priceN) : 0;

  /* ===== 4. 매수/매도 판단 로직 ===== */
  const { rsi, ma200 } = signalData;
  const currentPrice = priceN || 0;
  
  let statusText = "관망";
  let statusColor = "#666"; // 기본 회색
  let activeRow = 0; // 1, 2, 3 (0은 없음)

  if (ma200 && currentPrice > 0 && currentPrice < ma200) {
    statusText = "🚨 매도 (200일선 이탈)";
    statusColor = "#dc2626"; // 빨강(경고)
  } else if (rsi !== null) {
    if (rsi < 30) {
      statusText = "🔥 3단계 매수 (RSI < 30)";
      statusColor = "#d97706"; // 진한 주황
      activeRow = 3;
    } else if (rsi < 36) {
      statusText = "🟠 2단계 매수 (RSI < 36)";
      statusColor = "#f59e0b"; // 주황
      activeRow = 2;
    } else if (rsi < 43) {
      statusText = "🟡 1단계 매수 (RSI < 43)";
      statusColor = "#eab308"; // 노랑
      activeRow = 1;
    }
  }

  return (
    <main style={{ padding: "16px", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "800", marginBottom: "20px" }}>종합 현황 (Total)</h1>

      {/* 1. 요약 정보 카드 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
        <Card title="현재 RSI" value={rsi ? rsi.toFixed(2) : "-"} subColor={rsi < 30 ? "red" : "#333"} />
        <Card title="나스닥 현재가" value={won(currentPrice)} />
        <Card title="200일 이평선" value={ma200 ? won(ma200) : "로딩중..."} />
        <Card title="현재 상태" value={statusText} valueColor={statusColor} isBold />
      </div>

      {/* 2. 매수/매도 단계 테이블 */}
      <section style={{ background: "#fff", borderRadius: "16px", border: "1px solid #eee", padding: "20px", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}>
        <h2 style={{ fontSize: "16px", color: "#666", marginBottom: "12px" }}>매매 전략 가이드</h2>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "2px solid #eee", paddingBottom: "8px", fontWeight: "800", fontSize: "14px", color: "#444" }}>
          <div>단계</div>
          <div style={{ textAlign: "center" }}>조건</div>
          <div style={{ textAlign: "right" }}>매수 수량</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <Row 
            label="1단계" 
            cond="RSI 43 미만" 
            qty={`${qty1}주`} 
            isActive={activeRow === 1} 
          />
          <Row 
            label="2단계" 
            cond="RSI 36 미만" 
            qty={`${qty2}주`} 
            isActive={activeRow === 2} 
          />
          <Row 
            label="3단계" 
            cond="RSI 30 미만" 
            qty={`${qty3}주`} 
            isActive={activeRow === 3} 
          />
        </div>
        
        <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px dashed #eee", fontSize: "12px", color: "#888", textAlign: "right" }}>
          * 매도 조건: 나스닥 가격({won(currentPrice)})이 200일 이평선({ma200 ? won(ma200) : "-"}) 보다 낮을 때
        </div>
      </section>
    </main>
  );
}

function Card({ title, value, valueColor = "#111", subColor, isBold }) {
  return (
    <div style={{ background: "#fff", padding: "16px", borderRadius: "12px", border: "1px solid #eee" }}>
      <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>{title}</div>
      <div style={{ fontSize: "18px", fontWeight: isBold ? "800" : "600", color: valueColor }}>
        {value}
      </div>
    </div>
  );
}

function Row({ label, cond, qty, isActive }) {
  return (
    <div style={{ 
      display: "grid", 
      gridTemplateColumns: "1fr 1fr 1fr", 
      padding: "12px 0", 
      borderBottom: "1px solid #f9f9f9", 
      backgroundColor: isActive ? "#fffbeb" : "transparent", // 활성화시 연한 노랑 배경
      color: isActive ? "#d97706" : "#333",
      fontWeight: isActive ? "800" : "500"
    }}>
      <div style={{ paddingLeft: "4px" }}>{label}</div>
      <div style={{ textAlign: "center" }}>{cond}</div>
      <div style={{ textAlign: "right", paddingRight: "4px" }}>{qty}</div>
    </div>
  );
}
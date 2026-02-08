// /app/cash/page.jsx
"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";
import { saveUserSettings } from "@/lib/saveUserSettings";

/* ===== Access Token 헬퍼 ===== */
async function getAccessToken() {
  try {
    const { data } = await supa.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

/* ===== 가격 훅 (폴링 + 캐시 폴백) ===== */
function useLivePrice(symbol, { intervalMs = 4000 } = {}) {
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

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
      finally { if (!aborted) setLoading(false); }
    };
    fetchOnce();
    timerRef.current = setInterval(fetchOnce, intervalMs);
    return () => { clearInterval(timerRef.current); aborted = true; };
  }, [symbol, intervalMs]);

  return { price, loading };
}

/* ===== 포맷터 ===== */
const won = (n) => Number(Math.round(n ?? 0)).toLocaleString("ko-KR") + "원";
const pct = (n) => `${Number(n ?? 0).toFixed(2)}%`;

export default function CashDashboardPage() {
  const { yearlyBudget, setYearlyBudget, setStepQty, trades } = useAppStore();
  const [yearlyInput, setYearlyInput] = useState(yearlyBudget || 0);
  const [loadingUser, setLoadingUser] = useState(true);
  const [saving, setSaving] = useState(false);

  // 서버에서 예치금 로드
  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/user-settings/me", { 
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store" 
        });
        const d = await res.json();
        if (d?.ok && d.data) {
          const yb = Number(d.data.yearly_budget || 0);
          setYearlyInput(yb);
          setYearlyBudget(yb);
        }
      } finally { setLoadingUser(false); }
    })();
  }, [setYearlyBudget]);

  // 실시간 가격
  const { price: priceN } = useLivePrice("NASDAQ2X");
  const { price: priceB } = useLivePrice("BIGTECH2X");

  /* ===== 핵심 계산 로직 (요청하신 공식 적용) ===== */
  const mAvg = useMemo(() => yearlyInput / 12, [yearlyInput]); // 월별 평균 예상 매입금
  const factor = 0.92;

  const calcs = useMemo(() => {
    // 나스닥: 14%, 26%, 60%
    const n1 = mAvg * 0.14 * factor;
    const n2 = mAvg * 0.26 * factor;
    const n3 = mAvg * 0.60 * factor;

    // 빅테크: 14%, 14%, 26%
    const b1 = mAvg * 0.14 * factor;
    const b2 = mAvg * 0.14 * factor;
    const b3 = mAvg * 0.26 * factor;

    return {
      amt: {
        n: [n1, n2, n3],
        b: [b1, b2, b3]
      },
      qty: {
        n: [priceN ? Math.floor(n1 / priceN) : 0, priceN ? Math.floor(n2 / priceN) : 0, priceN ? Math.floor(n3 / priceN) : 0],
        b: [priceB ? Math.floor(b1 / priceB) : 0, priceB ? Math.floor(b2 / priceB) : 0, priceB ? Math.floor(b3 / priceB) : 0]
      }
    };
  }, [mAvg, priceN, priceB]);

  const handleSave = async () => {
    setSaving(true);
    try {
      setYearlyBudget(yearlyInput);
      setStepQty({
        nasdaq2x: { s1: calcs.qty.n[0], s2: calcs.qty.n[1], s3: calcs.qty.n[2] },
        bigtech2x: { s1: calcs.qty.b[0], s2: calcs.qty.b[1], s3: calcs.qty.b[2] }
      });
      await saveUserSettings({ yearly_budget: yearlyInput });
      alert("저장되었습니다.");
    } finally { setSaving(false); }
  };

  return (
    <div className="cash-container">
      <h1 className="title">예치금 및 매수설정</h1>

      {/* 1년 납입금액 입력부 */}
      <section className="input-card">
        <h2 className="section-title">1년 납입금액 설정</h2>
        <div className="input-group">
          <input 
            type="number" 
            value={yearlyInput} 
            onChange={(e) => setYearlyInput(Number(e.target.value))}
            placeholder="총 예치금 입력"
          />
          <button onClick={handleSave} disabled={saving}>저장</button>
        </div>
        <p className="monthly-info">월평균 예상 매입금: {won(mAvg)}</p>
      </section>

      {/* 매수 금액 및 수량 표 */}
      <section className="table-card">
        <div className="table-header">
          <div className="col">구분</div>
          <div className="col">나스닥100 2x</div>
          <div className="col">빅테크 7</div>
        </div>
        <div className="table-body">
          <Row label="1단계 매수금" a={won(calcs.amt.n[0])} b={won(calcs.amt.b[0])} />
          <Row label="2단계 매수금" a={won(calcs.amt.n[1])} b={won(calcs.amt.b[1])} />
          <Row label="3단계 매수금" a={won(calcs.amt.n[2])} b={won(calcs.amt.b[2])} />
          <Row label="1단계 수량" a={`${calcs.qty.n[0]}주`} b={`${calcs.qty.b[0]}주`} highlight />
          <Row label="2단계 수량" a={`${calcs.qty.n[1]}주`} b={`${calcs.qty.b[1]}주`} highlight />
          <Row label="3단계 수량" a={`${calcs.qty.n[2]}주`} b={`${calcs.qty.b[2]}주`} highlight />
        </div>
        <div className="price-footer">
          실시간가: 나스닥 {won(priceN)} / 빅테크 {won(priceB)}
        </div>
      </section>

      <style jsx>{`
        .cash-container { max-width: 800px; margin: 0 auto; padding: 16px; display: grid; gap: 20px; }
        .title { font-size: 24px; font-weight: 800; }
        .input-card, .table-card { background: #fff; border: 1px solid #eee; border-radius: 16px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .section-title { font-size: 16px; color: #666; marginBottom: 12px; }
        .input-group { display: flex; gap: 8px; }
        input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 18px; font-weight: 700; width: 100%; }
        button { padding: 0 24px; background: #007aff; color: #fff; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; }
        .monthly-info { margin-top: 10px; font-size: 14px; color: #007aff; font-weight: 600; }
        
        /* 모바일 겹침 방지 테이블 스타일 */
        .table-header { display: grid; grid-template-columns: 1.2fr 1fr 1fr; border-bottom: 2px solid #eee; padding-bottom: 8px; margin-bottom: 8px; font-weight: 800; font-size: 14px; }
        .price-footer { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #eee; font-size: 12px; color: #888; text-align: right; }
        
        @media (max-width: 480px) {
          .table-header { font-size: 12px; }
          .cash-container { padding: 10px; }
          input { font-size: 16px; }
        }
      `}</style>
    </div>
  );
}

function Row({ label, a, b, highlight }) {
  return (
    <div style={{ 
      display: "grid", 
      gridTemplateColumns: "1.2fr 1fr 1fr", 
      padding: "10px 0", 
      borderBottom: "1px solid #f9f9f9",
      fontSize: "14px",
      alignItems: "center"
    }}>
      <div style={{ color: "#555", fontWeight: 600 }}>{label}</div>
      <div style={{ textAlign: "right", fontWeight: 800, color: highlight ? "#007aff" : "#111" }}>{a}</div>
      <div style={{ textAlign: "right", fontWeight: 800, color: highlight ? "#007aff" : "#111" }}>{b}</div>
    </div>
  );
}
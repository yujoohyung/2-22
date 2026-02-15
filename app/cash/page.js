// app/cash/page.js
"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { supa } from "@/lib/supaClient";
import { saveUserSettings } from "@/lib/saveUserSettings";

/* ===== 실시간 가격 훅 (스토어 캐시 우선 사용) ===== */
function useLivePrice(code) {
  // 1. 스토어에서 캐시된 데이터 가져오기
  const { marketData, setMarketData } = useAppStore();
  const cachedPrice = marketData[code]?.price || 0;
  
  // 2. 초기값을 캐시된 가격으로 설정 (0초 로딩)
  const [price, setPrice] = useState(cachedPrice);

  // 3. 스토어 데이터가 외부(다른 탭/페이지)에서 업데이트되면 반영
  useEffect(() => {
    if (marketData[code]?.price) {
      setPrice(marketData[code].price);
    }
  }, [marketData, code]);

  useEffect(() => {
    if (!code) return;

    const fetchPrice = async () => {
      try {
        const res = await fetch(`/api/price?symbol=${code}`);
        const data = await res.json();
        if (data.price && typeof data.price === 'number') {
          setPrice(data.price);
          // 4. 가져온 최신 가격을 스토어에도 업데이트 (다른 페이지 공유)
          setMarketData(code, { ...marketData[code], price: data.price });
        }
      } catch (e) {
        console.error(`Price fetch error for ${code}`, e);
      }
    };
    
    // 캐시가 없으면 즉시 실행, 있으면 백그라운드 갱신
    if (cachedPrice === 0) fetchPrice();
    else fetchPrice(); // 최신화 보장 위해 실행은 하되 화면은 이미 떠있음

    const timer = setInterval(fetchPrice, 5000); 
    return () => clearInterval(timer);
  }, [code, setMarketData]); // marketData는 의존성에서 제외하여 루프 방지

  return { price };
}

/* ===== 숫자 포맷터 (원화 표시) ===== */
const won = (n) => Number(Math.round(n ?? 0)).toLocaleString("ko-KR") + "원";

export default function CashPage() {
  const { yearlyBudget, setYearlyBudget, setStepQty } = useAppStore();
  
  // 1. 스토어에 저장된 예치금을 초기값으로 바로 사용 (로딩 없음)
  const [inputBudget, setInputBudget] = useState(yearlyBudget);

  // 2. 서버 데이터 동기화 (뒷단 실행)
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
            const serverValue = Number(d.data.yearly_budget);
            // 스토어 업데이트
            setYearlyBudget(serverValue);
            // 입력창도 최신값으로 동기화 (사용자가 입력 중이 아닐 때만 하는 게 좋지만, 단순화를 위해 반영)
            setInputBudget(serverValue);
          }
        }
      } catch (e) {
        console.error("User settings load error", e);
      }
    })();
  }, [setYearlyBudget]);

  // 3. 실시간 가격 로드 (캐시 적용됨)
  const { price: priceN } = useLivePrice("418660"); // 나스닥
  const { price: priceB } = useLivePrice("465610"); // 빅테크

  /* ===== 4. 계산 로직 적용 ===== */
  
  // A. 연간 배분 (나스닥 60%, 빅테크 40%)
  const yearlyNasdaq = inputBudget * 0.6;
  const yearlyBigTech = inputBudget * 0.4;

  // B. 월별 기준액 (연간 / 12)
  const monthNasdaq = yearlyNasdaq / 12;
  const monthBigTech = yearlyBigTech / 12;

  // C. 단계별 매입 금액 (월별 매입금 * 비율 * 0.92)
  const factor = 0.92;

  // [나스닥] 14% / 26% / 60%
  const n1_amt = monthNasdaq * 0.14 * factor;
  const n2_amt = monthNasdaq * 0.26 * factor;
  const n3_amt = monthNasdaq * 0.60 * factor;

  // [빅테크] 14% / 26% / 60% (나스닥과 동일 비율 적용)
  const b1_amt = monthBigTech * 0.14 * factor;
  const b2_amt = monthBigTech * 0.26 * factor;
  const b3_amt = monthBigTech * 0.60 * factor;

  // D. 수량 계산 (금액 / 실시간가)
  const n1_qty = priceN > 0 ? Math.floor(n1_amt / priceN) : 0;
  const n2_qty = priceN > 0 ? Math.floor(n2_amt / priceN) : 0;
  const n3_qty = priceN > 0 ? Math.floor(n3_amt / priceN) : 0;

  const b1_qty = priceB > 0 ? Math.floor(b1_amt / priceB) : 0;
  const b2_qty = priceB > 0 ? Math.floor(b2_amt / priceB) : 0;
  const b3_qty = priceB > 0 ? Math.floor(b3_amt / priceB) : 0;

  const handleSave = async () => {
    setYearlyBudget(inputBudget);
    setStepQty({
      nasdaq2x: { s1: n1_qty, s2: n2_qty, s3: n3_qty },
      bigtech2x: { s1: b1_qty, s2: b2_qty, s3: b3_qty }
    });
    await saveUserSettings({ yearly_budget: inputBudget });
    alert("저장되었습니다.");
  };

  return (
    <div className="cash-container">
      <h1 className="title">예치금 및 매수설정</h1>

      {/* 입력 섹션 */}
      <div className="input-card">
        <label>1년 총 납입금 (예상 연봉/저축액)</label>
        <div className="input-row">
          <input 
            type="number" 
            value={inputBudget} 
            onChange={(e) => setInputBudget(Number(e.target.value))} 
            placeholder="금액 입력"
          />
          <button onClick={handleSave}>저장</button>
        </div>
        
        {/* 월 평균 배분 정보 표시 */}
        <div className="info-row">
          <div>
            <span className="label">나스닥(60%) 월평균:</span> 
            <span className="val">{won(monthNasdaq)}</span>
          </div>
          <div>
            <span className="label">빅테크(40%) 월평균:</span> 
            <span className="val">{won(monthBigTech)}</span>
          </div>
        </div>
      </div>

      {/* 테이블 섹션 */}
      <div className="table-card">
        <div className="header-row">
          <div className="th">구분</div>
          <div className="th">
            나스닥 2배 <br/>
            <span className="price-tag">
              {priceN > 0 ? won(priceN) : "(로딩중...)"}
            </span>
          </div>
          <div className="th">
            빅테크 2배 <br/>
            <span className="price-tag">
              {priceB > 0 ? won(priceB) : "(로딩중...)"}
            </span>
          </div>
        </div>

        <Row label="1단계 (14% x 0.92)" q1={n1_qty} q2={b1_qty} a1={n1_amt} a2={b1_amt} />
        <Row label="2단계 (26% x 0.92)" q1={n2_qty} q2={b2_qty} a1={n2_amt} a2={b2_amt} />
        <Row label="3단계 (60% x 0.92)" q1={n3_qty} q2={b3_qty} a1={n3_amt} a2={b3_amt} />
      </div>

      <style jsx>{`
        .cash-container { max-width: 800px; margin: 0 auto; padding: 20px; font-family: -apple-system, sans-serif; }
        .title { font-size: 24px; font-weight: 800; margin-bottom: 20px; color: #111; }
        
        .input-card { background: #fff; padding: 24px; border-radius: 16px; border: 1px solid #e5e7eb; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
        .input-row { display: flex; gap: 8px; margin-top: 12px; margin-bottom: 16px; }
        input { flex: 1; padding: 14px; font-size: 18px; border: 1px solid #d1d5db; border-radius: 8px; font-weight: 700; color: #111; }
        button { padding: 0 24px; background: #2563eb; color: #fff; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; }
        
        .info-row { display: flex; flex-direction: column; gap: 8px; font-size: 14px; color: #4b5563; background: #f9fafb; padding: 16px; border-radius: 8px; }
        .info-row div { display: flex; justify-content: space-between; align-items: center; }
        .info-row .label { font-weight: 500; }
        .info-row .val { font-weight: 700; color: #2563eb; font-size: 15px; }

        .table-card { background: #fff; border-radius: 16px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
        .header-row { display: grid; grid-template-columns: 1.1fr 1fr 1fr; background: #f9fafb; padding: 16px; border-bottom: 1px solid #e5e7eb; align-items: center; }
        .th { font-weight: 700; font-size: 14px; color: #4b5563; text-align: right; line-height: 1.4; word-break: keep-all; }
        .th:first-child { text-align: left; }
        
        .price-tag { font-size: 13px; color: #2563eb; font-weight: 700; display: block; margin-top: 2px; }
        
        /* 모바일 최적화 (너비 480px 이하) */
        @media (max-width: 480px) {
          .cash-container { padding: 12px; }
          .title { font-size: 20px; margin-bottom: 16px; }
          
          .input-card { padding: 16px; }
          input { font-size: 16px; padding: 10px; }
          button { padding: 0 16px; font-size: 14px; }
          
          .header-row { padding: 12px 10px; font-size: 12px; }
          .th { font-size: 12px; }
          .price-tag { font-size: 12px; }
          
          .info-row { font-size: 13px; padding: 12px; }
        }
      `}</style>
    </div>
  );
}

function Row({ label, q1, q2, a1, a2 }) {
  return (
    <>
      <div className="row">
        <div className="label-col">{label}</div>
        <div className="val-col">
          <div className="qty">{q1}주</div>
          <div className="amt">({won(a1)})</div>
        </div>
        <div className="val-col">
          <div className="qty">{q2}주</div>
          <div className="amt">({won(a2)})</div>
        </div>
      </div>
      <style jsx>{`
        .row { display: grid; grid-template-columns: 1.1fr 1fr 1fr; padding: 16px; border-bottom: 1px solid #f3f4f6; align-items: center; }
        .label-col { font-weight: 600; font-size: 13px; color: #374151; word-break: keep-all; }
        .val-col { text-align: right; }
        
        .qty { font-size: 15px; font-weight: 800; color: #111; }
        .amt { font-size: 11px; color: #9ca3af; margin-top: 2px; }

        @media (max-width: 480px) {
          .row { padding: 12px 10px; }
          .label-col { font-size: 12px; }
          .qty { font-size: 14px; }
          .amt { font-size: 10px; }
        }
      `}</style>
    </>
  );
}
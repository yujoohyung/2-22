"use client";

import { useMemo, useState } from "react";

/** 로컬(브라우저) 기준 YYYY-MM-DD */
function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

export default function DashboardPage() {
  // === 샘플 데이터(나중에 API 연동) ===
  const rawRows = [
    { signal: "1단계", date: "2025-08-01", price: 31825, dailyPct: -1.2, rsi: 28.4, buyPrice: 32000, qty: 5,  sellQty: 0 },
    { signal: "",     date: "2025-08-02", price: 32440, dailyPct: 1.9,  rsi: 31.2, buyPrice: 32300, qty: 8,  sellQty: 0 },
    { signal: "",     date: "2025-08-03", price: 33405, dailyPct: 3.0,  rsi: 35.8, buyPrice: 33200, qty: 6,  sellQty: 0 },
    { signal: "",     date: "2025-08-04", price: 33980, dailyPct: 1.7,  rsi: 39.1, buyPrice: 33800, qty: 7,  sellQty: 0 },
    { signal: "2단계", date: "2025-08-05", price: 34750, dailyPct: 2.3,  rsi: 42.5, buyPrice: 34500, qty: 10, sellQty: 0 },
    { signal: "",     date: "2025-08-06", price: 35220, dailyPct: 1.4,  rsi: 45.0, buyPrice: 35100, qty: 4,  sellQty: 0 },
    { signal: "",     date: "2025-08-07", price: 35990, dailyPct: 2.2,  rsi: 49.2, buyPrice: 36000, qty: 9,  sellQty: 0 },
    { signal: "",     date: "2025-08-08", price: 36210, dailyPct: 0.6,  rsi: 50.3, buyPrice: 36100, qty: 3,  sellQty: 0 },
    { signal: "3단계", date: "2025-08-09", price: 36880, dailyPct: 1.8,  rsi: 53.7, buyPrice: 36900, qty: 12, sellQty: 5 },
    { signal: "",     date: "2025-08-10", price: 37240, dailyPct: 1.0,  rsi: 55.9, buyPrice: 37200, qty: 5,  sellQty: 0 },
    { signal: "",     date: "2025-08-11", price: 37990, dailyPct: 2.0,  rsi: 58.6, buyPrice: 38000, qty: 6,  sellQty: 2 },
    { signal: "",     date: "2025-08-12", price: 38110, dailyPct: 0.3,  rsi: 59.1, buyPrice: 38150, qty: 2,  sellQty: 0 },
  ];

  // 누적매수량/누적매도량 계산
  const rows = useMemo(() => {
    let cumBuy = 0;
    let cumSell = 0;
    return rawRows.map((r) => {
      cumBuy += r.qty || 0;
      cumSell += r.sellQty || 0;
      return { ...r, cumQty: cumBuy, cumSellQty: cumSell };
    });
  }, [rawRows]);

  // 입력 폼 상태(두 표 사이)
  const [date, setDate] = useState(todayLocal());
  const [priceInput, setPriceInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");

  // 포맷터
  const fmt = (n) => (n == null || Number.isNaN(n) ? "-" : Number(n).toLocaleString("ko-KR"));
  const pct = (n) => (n == null || Number.isNaN(n) ? "-" : `${Number(n).toFixed(2)}%`);

  // 버튼 핸들러(임시)
  const handleBuy = () => {
    if (!priceInput || !qtyInput) return alert("주가와 수량을 입력하세요.");
    alert(`[매수] ${date} / 주가 ${priceInput}원 / 수량 ${qtyInput}주`);
    // TODO: 매수 API 호출 → 성공 시 입력 초기화
    setPriceInput("");
    setQtyInput("");
  };
  const handleSell = () => {
    if (!priceInput || !qtyInput) return alert("주가와 수량을 입력하세요.");
    alert(`[매도] ${date} / 주가 ${priceInput}원 / 수량 ${qtyInput}주`);
    // TODO: 매도 API 호출 → 성공 시 입력 초기화
    setPriceInput("");
    setQtyInput("");
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>대시보드</h1>

      {/* 1) 첫 번째 표: 매수신호 등 + 누적매도량 추가 */}
      <section
        style={{
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "매수신호",
                  "날짜",
                  "주가",
                  "일별%",
                  "일봉rsi",
                  "실매수가",
                  "매수수량",
                  "누적매수량",
                  "누적매도량", // ✅ 추가
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      position: "sticky",
                      top: 0,
                      background: "#f7f7f8",
                      textAlign: "left",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#555",
                      padding: "10px 12px",
                      borderBottom: "1px solid #e5e7eb",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <td style={td}>{r.signal}</td>
                  <td style={td}>{r.date}</td>
                  <td style={tdRight}>{fmt(r.price)}원</td>
                  <td style={tdRight}>{pct(r.dailyPct)}</td>
                  <td style={tdRight}>{r.rsi?.toFixed(1)}</td>
                  <td style={tdRight}>{fmt(r.buyPrice)}원</td>
                  <td style={tdRight}>{fmt(r.qty)}</td>
                  <td style={tdRight}>{fmt(r.cumQty)}</td>
                  <td style={tdRight}>{fmt(r.cumSellQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "8px 12px", fontSize: 12, color: "#777", borderTop: "1px solid #eee" }}>
          10개를 초과하면 위 표 영역에서 스크롤로 넘겨볼 수 있어요.
        </div>
      </section>

      {/* 2) 입력 행: 오늘날짜(자동) / 주가 / 수량 / 매수 / 매도 */}
      <section
        style={{
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          padding: 12,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "180px 1fr 1fr 120px 120px",
            gap: 10,
            alignItems: "center",
          }}
        >
          {/* 오늘 날짜 자동 */}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={input}
          />
          {/* 주가 */}
          <input
            type="number"
            inputMode="numeric"
            placeholder="주가 입력"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            style={input}
          />
          {/* 수량 */}
          <input
            type="number"
            inputMode="numeric"
            placeholder="수량 입력"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            style={input}
          />
          {/* 매수/매도 버튼 */}
          <button style={btn} onClick={handleBuy}>매수</button>
          <button style={btn} onClick={handleSell}>매도</button>
        </div>
      </section>

      {/* 3) 지표 4줄 섹션 (그대로) */}
      <section
        style={{
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        {(() => {
          // 샘플 값
          const 현재가 = 42000;
          const 평균단가 = 40000;
          const 최고주가 = 50000;
          const 합산매수금 = 5_000_000;
          const 합산평가금 = 4_200_000;
          const 예치금잔액 = 7_000_000;

          const 최고점기준낙폭 = ((현재가 - 최고주가) / 최고주가) * 100;
          const 손익률 = ((현재가 - 평균단가) / 평균단가) * 100;
          const 손익금 = 합산평가금 - 합산매수금;
          const 합산손익률 = ((합산평가금 - 합산매수금) / 합산매수금) * 100;
          const 예치금대비매수비율 = (합산매수금 / 예치금잔액) * 100;
          const fmtWon = (n) => `${fmt(n)}원`;

          return (
            <div style={{ display: "grid", gap: 12, padding: 12 }}>
              {/* 1줄: 1칸 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                <Cell title="현재가(평균단가)" value={`${fmtWon(현재가)} (${fmtWon(평균단가)})`} />
              </div>

              {/* 2줄: 3칸 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <Cell title="최고주가" value={fmtWon(최고주가)} />
                <Cell title="최고점기준 낙폭" value={pct(최고점기준낙폭)} highlight={최고점기준낙폭 < 0} />
                <Cell
                  title="손익률 및 손익금"
                  value={`${손익률 >= 0 ? "▲" : "▼"} ${pct(Math.abs(손익률))} / ${fmtWon(Math.abs(손익금))}`}
                  highlight={손익률 < 0}
                />
              </div>

              {/* 3줄: 3칸 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <Cell title="합산 매수금" value={fmtWon(합산매수금)} />
                <Cell
                  title="합산 손익률"
                  value={`${합산손익률 >= 0 ? "▲" : "▼"} ${pct(Math.abs(합산손익률))}`}
                  highlight={합산손익률 < 0}
                />
                <Cell title="합산 평가금" value={fmtWon(합산평가금)} />
              </div>

              {/* 4줄: 2칸 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                <Cell title="예치금잔액" value={fmtWon(예치금잔액)} badge="x" />
                <Cell title="예치금대비 매수비율" value={pct(예치금대비매수비율)} />
              </div>
            </div>
          );
        })()}
      </section>
    </div>
  );
}

const td = {
  padding: "10px 12px",
  fontSize: 14,
  color: "#111",
};
const tdRight = { ...td, textAlign: "right", whiteSpace: "nowrap" };

const input = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #ddd",
  borderRadius: 10,
  fontSize: 14,
};

const btn = {
  padding: "10px 12px",
  border: "1px solid #ddd",
  borderRadius: 10,
  background: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

// 재사용 셀 컴포넌트
function Cell({ title, value, badge, highlight }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "12px 14px",
        background: highlight ? "#fff5f5" : "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 13, color: "#666", fontWeight: 600 }}>{title}</div>
        {badge ? (
          <span
            style={{
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: 999,
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              color: "#6b7280",
            }}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

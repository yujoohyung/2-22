"use client";

import { useEffect } from "react";

const KEY = "rbHistory";

function appendEvent(evt) {
  // 1) localStorage에 누적 저장 (최근 것이 먼저)
  const cur = JSON.parse(localStorage.getItem(KEY) || "[]");
  cur.unshift(evt);
  localStorage.setItem(KEY, JSON.stringify(cur));

  // 2) 브로드캐스트로 모든 탭/페이지에 알림
  try {
    const ch = new BroadcastChannel("rb");
    ch.postMessage({ type: "append", payload: evt });
    ch.close();
  } catch {}
}

export default function RebalanceBus() {
  useEffect(() => {
    // 대시보드(나스닥2배) 매도
    function onNasdaq(e) {
      const { date, delta } = e.detail || {};
      if (!date || typeof delta !== "number") return;
      appendEvent({ date, nasdaq2x: delta, bigtech2x: null });
    }

    // stock2(빅테크2배) 매도
    function onBigtech(e) {
      const { date, delta } = e.detail || {};
      if (!date || typeof delta !== "number") return;
      appendEvent({ date, nasdaq2x: null, bigtech2x: delta });
    }

    window.addEventListener("rebalance:nasdaq", onNasdaq);
    window.addEventListener("rebalance:bigtech", onBigtech);

    return () => {
      window.removeEventListener("rebalance:nasdaq", onNasdaq);
      window.removeEventListener("rebalance:bigtech", onBigtech);
    };
  }, []);

  return null; // 화면에 표시 없음
}

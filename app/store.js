"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

function sumBuySell(rows = []) {
  let buy = 0, sell = 0;
  for (const r of rows) {
    const price = Number(r.buyPrice ?? r.price ?? 0);
    if (r.qty)     buy  += price * r.qty;
    if (r.sellQty) sell += price * r.sellQty;
  }
  return { buy, sell };
}

const shallowObjEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
};

const shallowArrayOfObjEqual = (a = [], b = []) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (typeof x === "object" && typeof y === "object") {
      if (!shallowObjEqual(x, y)) return false;
    } else {
      if (x !== y) return false;
    }
  }
  return true;
};

export const useAppStore = create(
  persist(
    (set, get) => ({
      yearlyBudget: 20_000_000,

      marketData: {}, // 실시간 가격
      dailyCache: {}, // [추가] 차트 데이터 캐시 (페이지 이동 시 로딩 제거용)

      stepQty: {
        nasdaq2x:  { s1: 0, s2: 0, s3: 0 },
        bigtech2x: { s1: 0, s2: 0, s3: 0 },
      },

      trades: {
        NASDAQ2X:  [],
        BIGTECH2X: [],
      },

      setYearlyBudget: (amt) =>
        set((s) => (s.yearlyBudget === amt ? s : { yearlyBudget: amt })),

      setMarketData: (code, data) =>
        set((s) => ({
          marketData: { ...s.marketData, [code]: data }
        })),

      // [추가] 차트 데이터 저장
      setDailyCache: (code, rows) => 
        set((s) => ({
          dailyCache: { ...s.dailyCache, [code]: rows }
        })),

      setStepQty: (next) =>
        set((s) => {
          const merged = { ...s.stepQty, ...next };
          if (shallowObjEqual(s.stepQty.nasdaq2x, merged.nasdaq2x) &&
              shallowObjEqual(s.stepQty.bigtech2x, merged.bigtech2x)) return s;
          return { stepQty: merged };
        }),

      setTrades: (symbol, rows = []) =>
        set((s) => {
          const prev = s.trades?.[symbol] || [];
          if (shallowArrayOfObjEqual(prev, rows)) return s;
          return { trades: { ...s.trades, [symbol]: rows } };
        }),

      addTrade: (symbol, row) =>
        set((s) => {
          const prev = s.trades?.[symbol] || [];
          const next = [...prev, row];
          if (prev.length && shallowObjEqual(prev[prev.length - 1], row)) return s;
          return { trades: { ...s.trades, [symbol]: next } };
        }),
    }),
    {
      name: "app-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        yearlyBudget: s.yearlyBudget,
        stepQty: s.stepQty,
        trades: s.trades,
        marketData: s.marketData,
        // dailyCache는 제외 (새로고침 시 갱신, 페이지 이동 간에는 유지)
      }),
    }
  )
);

export const selectCashRemain = (s) => {
  const n = sumBuySell(s.trades.NASDAQ2X);
  const b = sumBuySell(s.trades.BIGTECH2X);
  const totalBuy  = n.buy + b.buy;
  const totalSell = n.sell + b.sell;
  return s.yearlyBudget - totalBuy + totalSell;
};
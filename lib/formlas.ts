// lib/formulas.ts
type BasketItem = { symbol: string; weight: number };
type Settings = {
  deposit: number; // 기존 필드(참고용)
  rsi_period: number;
  rsi_levels?: { buy: number[]; rebalance: number }; // 호환용
  ladder?: { buy_pct: number[] };                    // 호환용
  main_symbol?: string;
  basket?: BasketItem[];             // [{"symbol":"A","weight":0.6},{"symbol":"B","weight":0.4}]
  rsi_buy_levels?: number[];         // [43,36,30]
  stage_amounts_krw?: number[];      // [S1,S2,S3]  (100% 기준 원화)
};

/** A의 RSI 기준으로 단계 결정: [43,36,30]이면 43↓=1단, 36↓=2단, 30↓=3단 */
export function decideBuyLevel(rsi: number, levels: number[]): number {
  if (!levels?.length) return -1;
  let hit = -1;
  for (let i=0; i<levels.length; i++) {
    if (rsi <= levels[i]) hit = i;
  }
  return hit; // -1이면 없음
}

/** 각 심볼별 매수 수량 계산 (반올림) */
export function computeBasketQuantities(
  settings: Settings,
  level: number,
  priceMap: Record<string, number> // {A: 현재가, B: 현재가}
): { symbol: string; qty: number; krw: number }[] {
  const basket = settings.basket || [];
  const stageAmounts = settings.stage_amounts_krw || [];
  const stageBase = stageAmounts[level] ?? 0; // 100% 기준 단계 금액

  return basket.map(({ symbol, weight }) => {
    const budget = Math.max(0, Math.round(stageBase * (weight ?? 0)));
    const price = Number(priceMap[symbol] || 0);
    const qty = price > 0 ? Math.max(1, Math.round(budget / price)) : 0; // ← 반올림
    return { symbol, qty, krw: budget };
  });
}

/** 리밸런싱은 "전체 보유 수량의 30%" (수량 계산은 나중 조건 완성 시 적용) */
export function rebalancePortion(totalQty: number): number {
  return Math.max(1, Math.round(totalQty * 0.3));
}

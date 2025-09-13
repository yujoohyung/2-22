import { normSymbol } from "./symbols.js";

export function decideBuyLevel(rsi, levels = [43, 36, 30]) {
  if (rsi <= levels[2]) return 2; // 3단계
  if (rsi <= levels[1]) return 1; // 2단계
  if (rsi <= levels[0]) return 0; // 1단계
  return -1;
}

export function computeBasketQuantities(sets, level, priceMap) {
  const stageKRW = sets.stage_amounts_krw || [120000, 240000, 552000];
  const basket = sets.basket || [];
  const weights = basket.map((b) => Number(b.weight ?? b.w ?? 0));
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;

  const stageBudget = stageKRW[level] || 0;
  return basket.map(({ symbol, weight }, idx) => {
    const sym = normSymbol(symbol);
    const w = Number(weight ?? weights[idx] ?? 0) / sumW;
    const krw = Math.round(stageBudget * w);
    const price = Number(priceMap[sym] || 0);
    const qty = price > 0 ? Math.max(0, Math.round(krw / price)) : 0;
    return { symbol: sym, krw, qty, price };
  });
}

// lib/formulas.js
// buyLevels 예: [43, 36, 30] (1/2/3단계 임계값)
export function decideBuyLevel(rsi, buyLevels = [43, 36, 30]) {
  if (!Number.isFinite(rsi) || !Array.isArray(buyLevels) || buyLevels.length < 3) return -1;
  const [L1, L2, L3] = buyLevels; // 1단계, 2단계, 3단계 기준
  if (rsi <= L3) return 2; // 3단계
  if (rsi <= L2) return 1; // 2단계
  if (rsi <= L1) return 0; // 1단계
  return -1;               // 매수 아님
}

// settings.stage_amounts_krw: [S1,S2,S3] 총액(100%)
// settings.basket: [{symbol:"A", weight:0.6},{symbol:"B", weight:0.4}]
// priceMap: {A: 현재가, B: 현재가}
export function computeBasketQuantities(settings, level, priceMap) {
  const stages = settings?.stage_amounts_krw || [];
  const basket = settings?.basket || [];
  const totalKRW = Number(stages[level] ?? 0);
  if (!Number.isFinite(totalKRW) || totalKRW <= 0) return [];

  const plans = [];
  for (const { symbol, weight } of basket) {
    const w = Number(weight ?? 0);
    const p = Number(priceMap?.[symbol] ?? 0);
    const krw = Math.round(totalKRW * w);
    const qty = p > 0 ? Math.round(krw / p) : 0;
    plans.push({ symbol, krw, qty });
  }
  return plans;
}

// lib/rsi.js
// Cutler 방식 RSI (대시보드와 동일 로직)

export function calcRSISeries(values, period = 14) {
  const n = Array.isArray(values) ? values.length : 0;
  const out = Array(n).fill(null);
  if (n < period + 1) return out;

  const gains = Array(n).fill(0);
  const losses = Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = Number(values[i]) - Number(values[i - 1]);
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  let sumG = 0, sumL = 0;
  for (let i = 1; i <= period; i++) { sumG += gains[i]; sumL += losses[i]; }
  let avgG = sumG / period, avgL = sumL / period;

  out[period] = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100 / (1 + (avgG / avgL));
  for (let i = period + 1; i < n; i++) {
    sumG += gains[i] - gains[i - period];
    sumL += losses[i] - losses[i - period];
    avgG = sumG / period; avgL = sumL / period;
    out[i] = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100 / (1 + (avgG / avgL));
  }
  return out;
}

export function calcRSI(values, period = 14) {
  const arr = calcRSISeries(values, period);
  if (!arr.length) return null;
  const last = arr[arr.length - 1];
  return Number.isFinite(last) ? last : null;
}

export default calcRSI;

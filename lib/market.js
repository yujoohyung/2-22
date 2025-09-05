// lib/market.js
// 지금이 KST 기준 지정 시각(들)과 ±tolerance 분 이내인지 체크 (주중만)
export function isCheckTimeKST(times = ["10:30", "14:30"], toleranceMin = 0) {
  const nowUTC = new Date();
  const kstMs = nowUTC.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const day = kst.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false; // 주말 제외

  const curMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  for (const hhmm of times) {
    const [h, m] = String(hhmm).split(":").map((x) => Number(x));
    const t = h * 60 + m;
    if (Math.abs(curMin - t) <= toleranceMin) return true;
  }
  return false;
}

export function kstISOString(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return k.toISOString().replace("Z", "+09:00");
}

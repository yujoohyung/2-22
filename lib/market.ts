// lib/market.ts
export function isMarketOpenKST(date = new Date()): boolean {
  const kst = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const d = kst.getDay(); if (d === 0 || d === 6) return false;
  const m = kst.getHours()*60 + kst.getMinutes();
  return m >= 540 && m <= 930; // 09:00~15:30
}

export function endOfSessionKST(date = new Date()): Date {
  const kst = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  kst.setHours(15,30,0,0);
  return kst;
}

// "10:30" / "14:30" 체크 시각인지(±2분 허용)
export function isCheckTimeKST(targets: string[] = ["10:30","14:30"], windowMin = 2, now = new Date()): boolean {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const curMin = kst.getHours()*60 + kst.getMinutes();
  return targets.some(t => {
    const [hh, mm] = t.split(":").map(Number);
    const tm = hh*60 + mm;
    return Math.abs(curMin - tm) <= windowMin;
  });
}

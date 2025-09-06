// lib/market.js
export function isCheckTimeKST(allow = ["10:30", "14:30"], slackMinutes = 2) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 3600 * 1000);

  const hh = String(kst.getHours()).padStart(2, "0");
  const mm = String(kst.getMinutes()).padStart(2, "0");
  const cur = `${hh}:${mm}`;

  if (allow.includes(cur)) return true;
  if (slackMinutes > 0) {
    const curMin = kst.getHours() * 60 + kst.getMinutes();
    return allow.some((t) => {
      const [H, M] = t.split(":").map(Number);
      const tgt = H * 60 + M;
      return Math.abs(curMin - tgt) <= slackMinutes;
    });
  }
  return false;
}

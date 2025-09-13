// 표기 통일: 화면/API/DB에서 쓰는 다양한 표기를 DB 표준으로 맞춤
export function normSymbol(input = "") {
  const s = String(input || "").trim().toUpperCase();
  const map = {
    NASDAQ2X: "nasdaq2x",
    BIGTECH2X: "bigtech2x",
    DASHBOARD: "nasdaq2x",
    STOCK2: "bigtech2x",
  };
  return map[s] || s.toLowerCase();
}

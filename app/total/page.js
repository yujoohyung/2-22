/* ===== 리밸런싱 유틸 (총액/주수 누적) ===== */
const toInt = (v) => Math.floor(Number(v || 0));

function normalizeRb(raw = []) {
  const map = new Map(); // date__symbol -> {date,symbol,amount,qty,price,type:"SELL"}
  for (const r of Array.isArray(raw) ? raw : []) {
    const date = r?.date;
    const symbol = r?.symbol;
    const qtyInt = toInt(r?.qty);
    const priceInt = toInt(r?.price);
    const amtInt = priceInt * qtyInt; // 항상 가격*수량으로 재계산
    if (!date || !symbol || qtyInt <= 0 || amtInt <= 0) continue;

    const k = `${date}__${symbol}`;
    const prev = map.get(k) || { date, symbol, amount: 0, qty: 0, price: 0, type: "SELL" };
    const nextQty = prev.qty + qtyInt;
    const nextAmt = prev.amount + amtInt;
    map.set(k, { ...prev, qty: nextQty, amount: nextAmt, price: Math.round(nextAmt / nextQty) });
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function addRb(prevArr, payload) {
  const { date, symbol } = payload || {};
  const qtyInt = toInt(payload?.qty);
  const priceInt = toInt(payload?.price);
  const amtInt = priceInt * qtyInt;
  if (!date || !symbol || qtyInt <= 0 || amtInt <= 0) return prevArr;

  const map = new Map(prevArr.map((r) => [`${r.date}__${r.symbol}`, r]));
  const k = `${date}__${symbol}`;
  const old = map.get(k);
  if (old) {
    const nextQty = old.qty + qtyInt;
    const nextAmt = old.amount + amtInt;
    map.set(k, { ...old, qty: nextQty, amount: nextAmt, price: Math.round(nextAmt / nextQty) });
  } else {
    map.set(k, { date, symbol, qty: qtyInt, amount: amtInt, price: Math.round(amtInt / qtyInt), type: "SELL" });
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function subRb(prevArr, payload) {
  const { date, symbol } = payload || {};
  const qtyInt = toInt(payload?.qty);
  const priceInt = toInt(payload?.price);
  const amtInt = priceInt * qtyInt;
  if (!date || !symbol || qtyInt <= 0 || amtInt <= 0) return prevArr;

  const map = new Map(prevArr.map((r) => [`${r.date}__${r.symbol}`, r]));
  const k = `${date}__${symbol}`;
  const old = map.get(k);
  if (!old) return prevArr;

  const nextQty = old.qty - qtyInt;
  const nextAmt = old.amount - amtInt;
  if (nextQty <= 0 || nextAmt <= 0) {
    map.delete(k);
  } else {
    map.set(k, { ...old, qty: nextQty, amount: nextAmt, price: Math.round(nextAmt / nextQty) });
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/* ===== input 스타일 (에러 수정됨) ===== */
const input = { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 10, fontSize: 14 };

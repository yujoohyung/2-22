// app/api/price-test/route.js
import { NextResponse } from "next/server";

// 임시 데이터 (나중에 실시간 API 연결)
const mockPrices = {
  A: 60500, // A 주식 현재가
  B: 40200, // B 주식 현재가
};

export async function GET() {
  return NextResponse.json(mockPrices);
}

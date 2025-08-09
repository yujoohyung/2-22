// app/dashboard/page.js
"use client";

import React, { useState, useEffect } from "react";
import { Button, Input, Table, message } from "antd";
import { Line } from "@ant-design/charts";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";

const columns = [
  { title: "종류", dataIndex: "type", key: "type" },
  { title: "가격", dataIndex: "price", key: "price" },
  { title: "수량", dataIndex: "quantity", key: "quantity" },
  {
    title: "시간",
    dataIndex: "created_at",
    key: "created_at",
    render: (v) => (v ? new Date(v).toLocaleString("ko-KR") : "-"),
  },
];

export default function DashboardPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();

  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [trades, setTrades] = useState([]);
  const [stockData, setStockData] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(0);

  const [stats, setStats] = useState({
    totalInvestment: 0,
    averagePrice: 0,
    totalShares: 0,
    currentValue: 0,
    profit: 0,
    profitRate: "0.00",
  });

  // 로그아웃 후 로그인 페이지로 하드 리다이렉트
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.assign("/logout");
  };

  const calcPortfolio = (rows, now) => {
    let totalBuyCost = 0;
    let shares = 0;

    rows.filter(r => r.type === "매수").forEach(r => {
      totalBuyCost += Number(r.price) * Number(r.quantity);
      shares += Number(r.quantity);
    });

    const avg = shares > 0 ? totalBuyCost / shares : 0;

    rows.filter(r => r.type === "매도").forEach(r => {
      shares -= Number(r.quantity);
    });

    const curVal = shares * now;
    const curInv = shares * avg;
    const profit = curVal - curInv;
    const rate = curInv > 0 ? (profit / curInv) * 100 : 0;

    setStats({
      totalInvestment: Math.round(totalBuyCost),
      averagePrice: Math.round(avg),
      totalShares: shares,
      currentValue: Math.round(curVal),
      profit: Math.round(profit),
      profitRate: rate.toFixed(2),
    });
  };

  const loadAll = async () => {
    try {
      const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
      const ticker = "AAPL";
      if (!apiKey) {
        message.warning("FMP API 키가 없습니다. .env에 NEXT_PUBLIC_FMP_API_KEY 설정하세요.");
      }

      const q = await fetch(`https://financialmodelingprep.com/api/v3/quote-short/${ticker}?apikey=${apiKey}`);
      const qJson = await q.json();
      const now = qJson?.[0]?.price ?? 0;
      setCurrentPrice(now);

      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTrades(data || []);

      calcPortfolio(data || [], now);

      const c = await fetch(`https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?apikey=${apiKey}`);
      const cJson = await c.json();
      const arr = (cJson?.historical || [])
        .slice(0, 30)
        .map(d => ({ date: d.date, price: d.close }))
        .reverse();
      setStockData(arr);
    } catch (e) {
      console.error(e);
      message.error("데이터를 불러오는 데 실패했습니다.");
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTrade = async (type) => {
    const p = parseFloat(price);
    const q = parseInt(quantity, 10);

    if (!p || !q) {
      message.warning("가격/수량을 정확히 입력하세요.");
      return;
    }

    const { error } = await supabase
      .from("trades")
      .insert([{ type, price: p, quantity: q }]);

    if (error) {
      message.error(`${type} 저장 실패: ${error.message}`);
      return;
    }
    message.success(`${type} 저장 완료`);
    setPrice("");
    setQuantity("");
    loadAll();
  };

  const chartConfig = {
    data: stockData,
    xField: "date",
    yField: "price",
    height: 300,
    point: { size: 3, shape: "circle" },
  };

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>나의 투자 대시보드</h1>
        <Button danger onClick={handleLogout}>로그아웃</Button>
      </div>

      {/* 차트 */}
      <div style={{ marginBottom: 32 }}>
        <h2>AAPL 주가 (현재가: ${Number(currentPrice || 0).toLocaleString()})</h2>
        {stockData.length ? <Line {...chartConfig} /> : <p>주가 차트 로딩 중...</p>}
      </div>

      {/* 포트폴리오 */}
      <div style={{ marginBottom: 32 }}>
        <h2>내 포트폴리오 현황</h2>
        <p>총 매수금액: {stats.totalInvestment.toLocaleString()}원</p>
        <p>현재 평가금액: {stats.currentValue.toLocaleString()}원</p>
        <p>평가손익: {stats.profit.toLocaleString()}원 ({stats.profitRate}%)</p>
        <p>보유 수량: {stats.totalShares}주</p>
        <p>평균 단가: {stats.averagePrice.toLocaleString()}원</p>
      </div>

      {/* 매매 입력 */}
      <div style={{ marginBottom: 32 }}>
        <h2>매매 기록 입력</h2>
        <Input
          placeholder="가격"
          type="number"
          style={{ width: 150, marginRight: 10 }}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Input
          placeholder="수량"
          type="number"
          style={{ width: 150, marginRight: 10 }}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Button type="primary" style={{ marginRight: 6 }} onClick={() => handleTrade("매수")}>
          매수
        </Button>
        <Button danger onClick={() => handleTrade("매도")}>
          매도
        </Button>
      </div>

      {/* 매매 내역 */}
      <div>
        <h2>매매 내역</h2>
        <Table
          columns={columns}
          dataSource={trades}
          // key 경고 방지
          rowKey={(row) => row.id ?? `${row.type}-${row.created_at}`}
        />
      </div>
    </div>
  );
}

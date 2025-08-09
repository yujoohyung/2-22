"use client";

import React, { useState, useEffect } from 'react';
import { Button, Input, Table, message } from 'antd';
import { Line } from '@ant-design/charts';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const tradeHistoryColumns = [
  { title: '종류', dataIndex: 'type', key: 'type' }, { title: '가격', dataIndex: 'price', key: 'price' },
  { title: '수량', dataIndex: 'quantity', key: 'quantity' },
];

export default function HomePage() {
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [tradeHistory, setTradeHistory] = useState([]);
  const [portfolioStats, setPortfolioStats] = useState({ totalInvestment: 0, averagePrice: 0, totalShares: 0 });
  const [stockData, setStockData] = useState([]); // <--- 실제 주식 차트 데이터를 담을 공간

  const calculatePortfolio = (trades) => {
    let totalInvestment = 0;
    let totalShares = 0;
    trades.forEach(trade => {
      if (trade.type === '매수') {
        totalInvestment += trade.price * trade.quantity;
        totalShares += trade.quantity;
      }
    });
    const averagePrice = totalShares > 0 ? totalInvestment / totalShares : 0;
    setPortfolioStats({ totalInvestment, averagePrice: Math.round(averagePrice), totalShares });
  };

  const fetchTrades = async () => {
    const { data, error } = await supabase.from('trades').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error("매매 내역 불러오기 실패:", error);
    } else {
      setTradeHistory(data);
      calculatePortfolio(data);
    }
  };

  // 주식 데이터를 불러오는 함수
  const fetchStockData = async () => {
    const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
    const ticker = 'AAPL'; // 예시로 애플 주식
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?apikey=${apiKey}`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      
      // 차트 형식에 맞게 데이터 가공
      const formattedData = data.historical.slice(0, 30).map(item => ({
        date: item.date,
        price: item.close,
      })).reverse(); // 최신 날짜가 뒤로 가도록 배열 뒤집기

      setStockData(formattedData);
    } catch (error) {
      console.error("주식 데이터 불러오기 실패:", error);
      message.error("주식 데이터를 불러오는 데 실패했습니다.");
    }
  };

  useEffect(() => {
    fetchTrades();
    fetchStockData(); // <--- 페이지 시작 시 주식 데이터도 불러오기
  }, []);

  const chartConfig = { data: stockData, xField: 'date', yField: 'price', height: 300 };

  const handleBuy = async () => {
    // ... (handleBuy 함수는 변경 없음) ...
    const { error } = await supabase
      .from('trades')
      .insert([{ type: '매수', price: parseInt(price), quantity: parseInt(quantity) }]);
    if (error) { message.error('매수 기록 저장에 실패했습니다: ' + error.message); }
    else { message.success('매수 기록이 성공적으로 저장되었습니다.'); setPrice(''); setQuantity(''); fetchTrades(); }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>나의 투자 대시보드</h1>
      
      <div style={{ marginBottom: '40px' }}>
        <h2>AAPL 주가</h2>
        {/* stockData가 비어있으면 로딩 메시지 표시 */}
        {stockData.length > 0 ? <Line {...chartConfig} /> : <p>주가 차트 로딩 중...</p>}
      </div>

      <div style={{ marginBottom: '40px' }}>
        <h2>내 예수금 / 평단 / 수익률</h2>
        <p>총 투자 예수금: {portfolioStats.totalInvestment.toLocaleString()}원</p>
        <p>보유 수량: {portfolioStats.totalShares}주</p>
        <p>평균 단가: {portfolioStats.averagePrice.toLocaleString()}원</p>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <h2>매매 기록 입력</h2>
        <Input placeholder="가격" type="number" style={{ width: '150px', marginRight: '10px' }} value={price} onChange={(e) => setPrice(e.target.value)} />
        <Input placeholder="수량" type="number" style={{ width: '150px', marginRight: '10px' }} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <Button type="primary" style={{ marginRight: '5px' }} onClick={handleBuy}>매수</Button>
        <Button danger>매도</Button>
      </div>

      <div>
        <h2>매매 내역</h2>
        <Table columns={tradeHistoryColumns} dataSource={tradeHistory} rowKey="id" />
      </div>
    </div>
  );
}
"use client";

import { useEffect } from "react";
import { useAppStore } from "../app/store";

const SYMBOLS = ["465610", "418660"]; // 빅테크, 나스닥

export default function GlobalMarketWatcher() {
  const { setMarketData } = useAppStore();

  useEffect(() => {
    const connections = [];

    // 순차적으로 연결 (서버 부하 방지)
    SYMBOLS.forEach((code, index) => {
      setTimeout(() => {
        let es = null;
        let isRetry = false;

        const connect = () => {
          try {
            // 1. REST 초기값
            fetch(`/api/kis/now?code=${code}`, { cache: "no-store" })
              .then((res) => res.json())
              .then((d) => {
                if (d.output?.stck_prpr) {
                  const price = Number(d.output.stck_prpr);
                  const high = Number(d.output.stck_hgpr);
                  setMarketData(code, { price, high });
                }
              })
              .catch(() => {});

            // 2. SSE 실시간
            es = new EventSource(`/api/kis/stream?code=${code}`);
            
            es.onmessage = (ev) => {
              try {
                const msg = JSON.parse(ev.data);
                if (msg.type === "tick") {
                  const price = Number(msg.price);
                  const high = Number(msg.high);
                  if (price > 0) setMarketData(code, { price, high });
                }
              } catch {}
            };

            es.onerror = () => {
              es?.close();
              if (!isRetry) {
                isRetry = true;
                setTimeout(connect, 3000);
              }
            };
            connections.push(es);
          } catch (e) {
            console.error(e);
          }
        };

        connect();
      }, index * 500); // 0.5초 간격으로 실행
    });

    return () => {
      connections.forEach((es) => es?.close());
    };
  }, [setMarketData]);

  return null;
}
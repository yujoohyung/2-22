"use client";

import { useEffect } from "react";
import { useAppStore } from "../app/store";

const SYMBOLS = ["465610", "418660"]; // 빅테크, 나스닥

export default function GlobalMarketWatcher() {
  const { setMarketData } = useAppStore();

  useEffect(() => {
    const connections = {};

    SYMBOLS.forEach((code) => {
      let es = null;
      let isRetry = false;

      const connect = () => {
        try {
          // 1. 초기값 REST (빠른 로딩)
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

          // 2. 실시간 SSE 연결
          es = new EventSource(`/api/kis/stream?code=${code}`);
          
          es.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.type === "tick") {
                const price = Number(msg.price);
                const high = Number(msg.high);
                if (price > 0) {
                  setMarketData(code, { price, high });
                }
              }
            } catch {}
          };

          es.onerror = () => {
            es?.close();
            if (!isRetry) {
              isRetry = true;
              setTimeout(connect, 3000); // 3초 뒤 재연결
            }
          };

          connections[code] = es;
        } catch (e) {
          console.error(e);
        }
      };

      connect();
    });

    return () => {
      Object.values(connections).forEach((es) => es?.close());
    };
  }, [setMarketData]);

  return null;
}
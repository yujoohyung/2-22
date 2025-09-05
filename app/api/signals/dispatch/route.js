import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toKST(d) {
  return new Date(new Date(d).getTime() + 9 * 60 * 60 * 1000);
}
function fmtKST(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${dd} ${hh}시 ${mm}분`;
}

export async function GET() {
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    // 최근 30분 내 미전송만 취급
    const { data: rows, error } = await supa
      .from("alerts")
      .select("*")
      .eq("sent", false)
      .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true });

    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ sent: 0, skip: "no unsent alerts" }), { status: 200 });
    }

    // 같은 시각(분)끼리 묶어 1건만 보냄 → 제일 오래된 묶음만 처리
    const firstTs = rows[0].created_at;
    const baseMin = Math.floor(new Date(firstTs).getTime() / 60000);
    const batch = rows.filter(r => Math.floor(new Date(r.created_at).getTime() / 60000) === baseMin);

    // 표기명(심볼→이름) — 필요 시 수정
    const NAME = { A: "나스닥100 2x", B: "빅테크7 2x", dashboard: "나스닥100 2x", stock2: "빅테크7 2x" };

    // 공통 헤더
    const dt = fmtKST(toKST(firstTs));
    const level = batch[0]?.level || "";       // "1단계" 등
    const rsi = batch[0]?.rsi != null ? Number(batch[0].rsi).toFixed(2) : "-";

    const lines = [];
    lines.push(`${dt}`);
    lines.push(`RSI ${rsi} / 매수${level}`);
    lines.push("");

    for (const r of batch) {
      // message에서 "약 N주" 추출 (저장 포맷 유지 가정)
      let qtyTxt = "";
      const m = String(r.message || "").match(/약\s*([\d,]+)\s*주/);
      if (m) qtyTxt = `${m[1].replace(/,/g, "")}주`;
      const nm = NAME[r.symbol] || r.symbol;
      lines.push(`${nm} ${qtyTxt} 매수`);
    }

    const text = lines.join("\n").trim();
    await sendTelegram(text);

    // 전송 완료 처리
    const ids = batch.map(b => b.id);
    await supa.from("alerts").update({ sent: true }).in("id", ids);

    return new Response(JSON.stringify({ sent: ids.length, text }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}

// lib/supaClient.js
import { supa } from "@/lib/supaClient";

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

if (!url) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) {
  throw new Error("Bad env: NEXT_PUBLIC_SUPABASE_URL (ex: https://xxxxx.supabase.co)");
}
if (!anon) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");

// 마지막 슬래시 제거(일관성)
export const supa = createClient(url.replace(/\/$/, ""), anon);

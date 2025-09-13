// /lib/auth-server.js
import { createClient } from "@supabase/supabase-js";

/** Authorization: Bearer <JWT> 를 받아 서버에서 유저 확인 */
export async function requireUser(req) {
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE
  );
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) throw new Error("unauthorized: no token");
  const { data, error } = await supa.auth.getUser(auth);
  if (error || !data?.user?.id) throw new Error("unauthorized: invalid token");
  return { supa, user: data.user };
}

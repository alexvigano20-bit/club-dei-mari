// Club dei Mari · funzione server "admin-users"
// Operazioni sugli ACCOUNT che richiedono la chiave di servizio:
// creare un accesso, reimpostare la password, bloccare/sbloccare il login.
// Il permesso è verificato due volte: qui (whoami del chiamante) e nel
// database (le RPC admin_* rifiutano chi non è responsabile attivo).
// Nessuna dipendenza esterna: solo fetch verso le API REST di Supabase.

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BAN_FOREVER = "876000h"; // ~100 anni

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function rpc(fn: string, args: unknown, jwt: string) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.message ?? `Errore ${r.status}`);
  return data;
}

async function authAdmin(path: string, method: string, body?: unknown) {
  const r = await fetch(`${URL_}/auth/v1/admin/${path}`, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.msg ?? data?.message ?? data?.error_description ?? `Errore account ${r.status}`);
  return data;
}

const validPassword = (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 72;
const validUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Accesso richiesto" }, 401);

  try {
    const me = await rpc("whoami", {}, jwt);
    if (!me?.is_admin) return json({ error: "Solo il responsabile può gestire gli accessi" }, 403);

    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "create": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const name = String(body.display_name ?? "").trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Email non valida" }, 400);
        if (!name || name.length > 60) return json({ error: "Nome non valido" }, 400);
        if (!validPassword(body.temp_password)) return json({ error: "La password temporanea deve avere almeno 8 caratteri" }, 400);
        const user = await authAdmin("users", "POST", { email, password: body.temp_password, email_confirm: true });
        try {
          await rpc("admin_create_profile2", {
            p_id: user.id, p_name: name, p_email: email,
            p_workouts: !!body.can_manage_workouts,
            p_courses: body.teaches_courses !== false, p_trainings: body.teaches_trainings !== false,
          }, jwt);
        } catch (e) {
          await authAdmin(`users/${user.id}`, "DELETE").catch(() => {}); // annulla: nessun account orfano
          throw e;
        }
        return json({ ok: true, id: user.id });
      }
      case "reset_password": {
        if (!validUuid(body.profile_id)) return json({ error: "Profilo non valido" }, 400);
        if (!validPassword(body.temp_password)) return json({ error: "La password temporanea deve avere almeno 8 caratteri" }, 400);
        await rpc("admin_require_password_change", { p_profile: body.profile_id }, jwt);
        await authAdmin(`users/${body.profile_id}`, "PUT", { password: body.temp_password });
        return json({ ok: true });
      }
      case "set_active": {
        if (!validUuid(body.profile_id)) return json({ error: "Profilo non valido" }, 400);
        const active = body.active === true;
        // 1) database: effetto immediato su tutte le letture (RLS)
        await rpc("admin_set_active", { p_profile: body.profile_id, p_active: active }, jwt);
        // 2) login: impedisce nuovi accessi e il rinnovo delle sessioni su ogni dispositivo
        await authAdmin(`users/${body.profile_id}`, "PUT", { ban_duration: active ? "none" : BAN_FOREVER });
        return json({ ok: true });
      }
      default:
        return json({ error: "Azione sconosciuta" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});

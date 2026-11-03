/* ============================================================
   SimuPrime v17 — portage Cloudflare Worker de app.py (Flask)
   Auth par rôles · Typo TECH/SIMPLE par MSA · payplan importable
   · prorata base d'heures · points par mois + historique
   ============================================================ */
import { ObjectId } from "mongodb";

import { getDb, getPayplan, savePayplan, resetPayplan,
         getRefMsa, saveRefMsa, resetRefMsa,
         runWithRequestStore, pendingClientClose } from "./db.js";
import { calculatePrime, PROFILE_POINT_EFFECTS } from "./payplan_config.js";
import { sessionCookie, clearSessionCookie, currentUser } from "./session.js";
import { parseActif, parsePayplanMatrix, parseRefMsa, buildPayplanTemplate,
         deriveTypo, extractMsaCode } from "./excel.js";

import loginHtml from "./templates/login.html";
import indexHtml from "./templates/index.html";
import adminHtml from "./templates/admin.html";
import glossaireHtml from "./templates/glossaire.html";

// ------------------------------------------------------------------ helpers
const J = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });
const nowUtc = () => new Date();
const randomHex = (n) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Secret éphémère par isolate si SECRET_KEY n'est pas défini (comme Flask).
// ⚠️ généré paresseusement : crypto.getRandomValues est interdit dans le
// scope global d'un Worker (génération à la première requête).
let _ephemeralSecret = null;
const getSecret = (env) => env.SECRET_KEY || (_ephemeralSecret ??= randomHex(32));
const envAdminPassword = (env) => env.ADMIN_PASSWORD || env.ADMIN_TOKEN || "";

// int() Python : tronque les nombres, refuse les chaînes non entières
function pyInt(v) {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("invalid literal for int()");
    return Math.trunc(v);
  }
  if (typeof v === "bigint") return Number(v);
  const s = String(v).trim();
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  throw new Error(`invalid literal for int() with base 10: '${v}'`);
}

// date.fromisoformat Python : strict YYYY-MM-DD + date réelle
function parseStrictISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 ||
      d.getUTCDate() !== +m[3]) return null;
  return d;
}

// Rendu : blocs __ADMIN_START__…__ADMIN_END__ conservés si admin,
// __ROLE__ remplacé par le badge.
function renderPage(html, role) {
  const keep = role === "admin";
  let out = "";
  let rest = html;
  for (;;) {
    const s = rest.indexOf("__ADMIN_START__");
    if (s === -1) { out += rest; break; }
    const e = rest.indexOf("__ADMIN_END__", s);
    if (e === -1) { out += rest; break; }
    out += rest.slice(0, s) + (keep ? rest.slice(s + 15, e) : "");
    rest = rest.slice(e + 13);
  }
  return out.replace(/__ROLE__/g, role === "admin" ? "ADMIN" : "UTILISATEUR");
}
const html = (body) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

// ------------------------------------------------------------------ router
export default {
  async fetch(request, env, ctx) {
    // Une connexion MongoDB par requête (voir db.js) — partagée entre
    // tous les helpers via AsyncLocalStorage, fermée après réponse.
    return runWithRequestStore(env, async () => {
      try {
        const res = await handleRequest(request, env);
        const client = pendingClientClose();
        if (client && ctx && ctx.waitUntil) {
          ctx.waitUntil(client.close().catch(() => {}));
        }
        return res;
      } catch (err) {
        const client = pendingClientClose();
        if (client && ctx && ctx.waitUntil) {
          ctx.waitUntil(client.close().catch(() => {}));
        }
        throw err;
      }
    });
  },
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  try {
    let handler = null;
    let mat = null;

      if (method === "GET" && path === "/login") handler = loginPage;
      else if (method === "GET" && path === "/") handler = indexPage;
      else if (method === "GET" && path === "/admin") handler = adminPage;
      else if (method === "GET" && path === "/glossaire") handler = glossairePage;

      else if (method === "POST" && path === "/api/auth/login") handler = authLogin;
      else if (method === "POST" && path === "/api/auth/logout") handler = authLogout;
      else if (method === "GET" && path === "/api/auth/me") handler = authMe;

      else if (method === "GET" && path === "/api/health") handler = health;

      else if (method === "GET" && path === "/api/payplan") handler = apiPayplanGet;
      else if (method === "PUT" && path === "/api/payplan") handler = apiPayplanPut;
      else if (method === "POST" && path === "/api/payplan/reset") handler = apiPayplanReset;
      else if (method === "POST" && path === "/api/payplan/upload") handler = apiPayplanUpload;
      else if (method === "GET" && path === "/api/payplan/template") handler = apiPayplanTemplate;

      else if (method === "GET" && path === "/api/ref-msa") handler = apiRefMsaGet;
      else if (method === "PUT" && path === "/api/ref-msa") handler = apiRefMsaPut;
      else if (method === "POST" && path === "/api/ref-msa/reset") handler = apiRefMsaReset;
      else if (method === "POST" && path === "/api/ref-msa/upload") handler = apiRefMsaUpload;

      else if (method === "POST" && path === "/api/calculate") handler = apiCalculate;

      else if (method === "GET" && path === "/api/simulations") handler = apiSimulations;
      else if (method === "DELETE" && path === "/api/simulations/all") handler = apiSimsDeleteAll;
      else if (method === "DELETE" && path === "/api/simulations/mine") handler = apiSimsClearMine;
      else if (method === "DELETE" && (mat = /^\/api\/simulations\/(.+)$/.exec(path))) {
        handler = (req, env2) => apiSimDeleteOne(req, env2, decodeURIComponent(mat[1]));
      }

      else if (method === "POST" && path === "/api/upload") handler = apiUpload;
      else if (method === "GET" && path === "/api/stats") handler = apiStats;
      else if (method === "GET" && (mat = /^\/api\/employee\/(.+)$/.exec(path))) {
        handler = (req, env2) => apiEmployee(req, env2, decodeURIComponent(mat[1]));
      }

    if (handler) return await handler(request, env, url);
    return new Response("Not Found", { status: 404 });
  } catch (err) {
    if (err && err.status) return J({ ok: false, error: err.error }, err.status);
    console.error("Erreur:", err && err.stack || err);
    return J({ ok: false, error: "Erreur interne du serveur." }, 500);
  }
}

export { validateProfils, validateRegles };

// ------------------------------------------------------------------- Pages
async function loginPage(request, env) {
  const u = await currentUser(request, getSecret(env));
  if (u) {
    return Response.redirect(new URL(u.role === "admin" ? "/admin" : "/", request.url), 302);
  }
  return html(renderPage(loginHtml, null));
}

async function indexPage(request, env) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  return html(renderPage(indexHtml, u.user.role));
}

async function adminPage(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  return html(renderPage(adminHtml, "admin"));
}

async function glossairePage(request, env) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  return html(renderPage(glossaireHtml, u.user.role));
}

// ---------------------------------------------------------------- Auth API
async function authLogin(request, env) {
  let d = {};
  try { d = await request.json(); } catch (e) {}
  const role = d.role;
  const secret = getSecret(env);
  if (role === "user") {
    const value = await sessionCookie(
      { role: "user", sid: randomHex(16), logged_at: nowUtc().toISOString() }, secret);
    return J({ ok: true, redirect: "/" }, 200, { "Set-Cookie": value });
  }
  if (role === "admin") {
    const pwd = envAdminPassword(env);
    if (!pwd) {
      return J({ ok: false, error: "Mot de passe admin non configuré (variable ADMIN_PASSWORD)." }, 503);
    }
    if (String(d.password || "") !== pwd) {
      return J({ ok: false, error: "Mot de passe incorrect." }, 401);
    }
    const value = await sessionCookie(
      { role: "admin", sid: randomHex(16), logged_at: nowUtc().toISOString() }, secret);
    return J({ ok: true, redirect: "/admin" }, 200, { "Set-Cookie": value });
  }
  return J({ ok: false, error: "Rôle invalide." }, 400);
}

async function authLogout() {
  return J({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

async function authMe(request, env) {
  const u = await currentUser(request, getSecret(env));
  return J({ ok: !!u, user: u });
}

// ------------------------------------------------------------------ Guards
async function requireUser(request, env) {
  const u = await currentUser(request, getSecret(env));
  if (!u) return { response: unauthorized(request) };
  return { user: u };
}
async function requireAdmin(request, env) {
  const u = await currentUser(request, getSecret(env));
  if (!u) return { response: unauthorized(request) };
  if (u.role !== "admin") return { response: forbidden(request) };
  return { user: u };
}
function unauthorized(request) {
  const p = new URL(request.url).pathname;
  if (p.startsWith("/api/")) {
    return J({ ok: false, error: "Session expirée — reconnectez-vous." }, 401);
  }
  return Response.redirect(new URL("/login", request.url), 302);
}
function forbidden(request) {
  const p = new URL(request.url).pathname;
  if (p.startsWith("/api/")) {
    return J({ ok: false, error: "Accès réservé à l'administrateur." }, 403);
  }
  return Response.redirect(new URL("/", request.url), 302);
}

// ------------------------------------------------------------------- Public
async function health() {
  let dbStatus = "error";
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    dbStatus = "connected";
  } catch (e) { dbStatus = "error"; }
  return J({ ok: true, db: dbStatus });
}

// ------------------------------------------------------------------ Payplan
async function apiPayplanGet(request, env) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  const [profils, regles] = await getPayplan();
  return J({ ok: true, profils, regles, effets: PROFILE_POINT_EFFECTS });
}

async function apiPayplanPut(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  let d = {};
  try { d = await request.json(); } catch (e) {}
  let profils, regles;
  try {
    profils = validateProfils(d.profils);
    regles = validateRegles(d.regles);
  } catch (e) {
    return J({ ok: false, error: e.message }, 400);
  }
  await savePayplan(profils, regles);
  const [p2, r2] = await getPayplan();
  return J({ ok: true, message: "Payplan enregistré.", profils: p2, regles: r2 });
}

async function apiPayplanReset(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  await resetPayplan();
  const [profils, regles] = await getPayplan();
  return J({ ok: true, message: "Payplan réinitialisé depuis payplan_config.py.",
             profils, regles });
}

// Dates des 3 mois de profils (résolution mois par mois) — fidèle à app.py
export function computeMonthDates(referenceDate) {
  const y = referenceDate.getUTCFullYear(), mo = referenceDate.getUTCMonth() + 1;
  const ref = new Date(Date.UTC(y, mo - 1, 1));
  const m2 = mo >= 2 ? new Date(Date.UTC(y, mo - 2, 1))
                     : new Date(Date.UTC(y - 1, 11, 1));
  const m1 = mo >= 3 ? new Date(Date.UTC(y, mo - 3, 1))
                     : new Date(Date.UTC(y - 1, 11, 1));
  const first = (d) => d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-01";
  return { M1: first(m1), M2: first(m2), M3: first(ref) };
}

function validateProfils(p) {
  if (!p || typeof p !== "object" || Array.isArray(p) || !Object.keys(p).length) {
    throw new Error("Profils invalides.");
  }
  const out = {};
  for (const [kRaw, vRaw] of Object.entries(p)) {
    const k = String(kRaw).trim();
    if (!k) throw new Error("Nom de profil vide.");
    let v;
    if (vRaw === null || vRaw === undefined || vRaw === "" || vRaw === "null" || vRaw === "None") {
      v = null;
    } else {
      try {
        v = pyInt(vRaw);            // int(v) Python — erreur si invalide
      } catch (e) {
        throw new Error(`Points invalides pour « ${k} ».`);
      }
      if (!(0 <= v && v <= 20)) throw new Error(`Points invalides pour « ${k} » (0 à 20).`);
    }
    out[k] = v;
  }
  return out;
}

function valDate(v) {
  const s = String(v ?? "").trim();
  if (!s || ["none", "null", "*"].includes(s.toLowerCase())) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const d = parseStrictISO(`${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`);
    if (d) return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
    throw new Error(`Date invalide : « ${s} » (AAAA-MM-JJ)`);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const y = +m[3], mo = +m[2], da = +m[1];
    const d = new Date(Date.UTC(y, mo - 1, da));
    if (d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === da) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
  }
  throw new Error(`Date invalide : « ${s} » (AAAA-MM-JJ)`);
}

function validateRegles(rs) {
  // Accepte montants en LISTE de paliers [{min,max,montant}] ou en DICT.
  if (!Array.isArray(rs) || !rs.length) throw new Error("Au moins une règle est requise.");
  const out = [];
  rs.forEach((r, i) => {
    const n = i + 1;
    const nom = String((r && r.nom) || `Règle ${n}`).trim();
    let amin = 0, amax = null;
    try {
      r = r || {};
      const sites = String(r.sites || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      const msa = String(r.msa || "").split(",").map((m) => m.trim().toUpperCase()).filter(Boolean);
      const avant = valDate(r.embauche_avant), apres = valDate(r.embauche_apres);
      let index;
      try {
        index = pyInt(r.index || n * 10);
      } catch (e) { index = n * 10; }
      amin = pyInt(r.anciennete_min || 0);
      const rawMax = r.anciennete_max;
      amax = (rawMax === null || rawMax === undefined || rawMax === "" ||
              rawMax === "null" || rawMax === "*") ? null : pyInt(rawMax);
      const nb = pyInt(r.nb_mois_profil || 3);
      if (!(1 <= nb && nb <= 3)) throw new Error("nb_mois_profil doit être 1, 2 ou 3");

      const raw = r.montants;
      let paliers = [];
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) {
          let kn, vn;
          try { kn = pyInt(k); vn = pyInt(v); } catch (e) { throw new Error("montant invalide"); }
          paliers.push({ min: kn, max: kn, montant: vn });
        }
      } else if (Array.isArray(raw)) {
        for (const p of raw) {
          let mn, mx, mt;
          try {
            mn = pyInt(p && p.min); mx = pyInt(p && p.max); mt = pyInt(p && p.montant);
          } catch (e) { throw new Error("palier invalide"); }
          if (mn < 0 || mx < mn) throw new Error(`palier ${mn}-${mx} invalide (min ≤ max requis)`);
          if (mt < 0) throw new Error("montant négatif");
          paliers.push({ min: mn, max: mx, montant: mt });
        }
      } else {
        throw new Error("aucun barème défini");
      }
      paliers.sort((a, b) => a.min - b.min);
      for (let j = 0; j < paliers.length - 1; j++) {
        const a = paliers[j], b = paliers[j + 1];
        if (b.min <= a.max) {
          throw new Error(`paliers ${a.min}-${a.max} et ${b.min}-${b.max} se chevauchent`);
        }
      }
      if (!paliers.length) throw new Error("aucun palier défini");
      out.push({ nom, sites, msa,
                 embauche_avant: avant, embauche_apres: apres, index,
                 anciennete_min: amin, anciennete_max: amax,
                 nb_mois_profil: nb, montants: paliers,
                 explication: String(r.explication || "") });
    } catch (e) {
      throw new Error(`Règle « ${nom} » invalide : ${e.message}`);
    }
    if (amax != null && amin > amax) {
      throw new Error(`Règle « ${nom} » : ancienneté min > max`);
    }
  });
  return out;
}

async function apiPayplanUpload(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  const file = await getFile(request, "Format attendu : Excel (.xlsx/.xls).");
  if (file.error) return J({ ok: false, error: file.error }, 400);
  let rules;
  try {
    rules = await parsePayplanMatrix(file.file);
  } catch (e) {
    if (e && e.status) return J({ ok: false, error: e.error }, e.status);
    return J({ ok: false, error: `Fichier illisible : ${e.message || e}` }, 400);
  }
  let reglesValid;
  try {
    reglesValid = validateRegles(rules);
  } catch (e) {
    return J({ ok: false, error: e.message }, 400);
  }
  const [profils] = await getPayplan();
  await savePayplan(profils, reglesValid);
  return J({ ok: true, message: `Payplan importé : ${reglesValid.length} règles.`,
             profils, regles: reglesValid });
}

async function apiPayplanTemplate(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  const buf = buildPayplanTemplate();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=payplan_modele.xlsx",
    },
  });
}

async function getFile(request, formatMsg) {
  try {
    const fd = await request.formData();
    const f = fd.get("file");
    if (!f || typeof f === "string" || !f.name) {
      return { error: "Aucun fichier reçu." };
    }
    if (!/\.(xlsx|xls)$/i.test(f.name)) return { error: formatMsg };
    return { file: f };
  } catch (e) {
    return { error: "Aucun fichier reçu." };
  }
}

// ----------------------------------------------------------------- Employee
async function apiEmployee(request, env, matricule) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  let mat = String(matricule ?? "").trim();
  if (mat.endsWith(".0")) mat = mat.slice(0, -2);
  mat = mat.toUpperCase();
  const db = await getDb();
  const e = await db.collection("employees").findOne({
    $or: [{ mat_wkd: mat }, { mat_paie: mat }],
  });
  if (!e) {
    return J({ ok: false, error: `Matricule « ${matricule} » introuvable dans l'extraction ACTIF.` }, 404);
  }
  const msaCode = e.msa_code || extractMsaCode(e.msa);
  return J({ ok: true, data: {
    matricule: e.mat_wkd || "",
    matricule_paie: e.mat_paie || "",
    nom: e.nom || "",
    poste: e.poste || "",
    typo: deriveTypo(msaCode),
    site: e.site || "",
    location: e.location || "",
    msa: e.msa || "",
    projet: e.projet || "",
    msa_code: msaCode,
    projet_code: e.projet_code || "",
    statut_wkd: e.statut_wkd || "ACTIVE",
    hire_date: e.hire_date ?? null,
  } });
}

// ----------------------------------------------------------------- Ref MSA
async function apiRefMsaGet(request, env) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  return J({ ok: true, data: await getRefMsa() });
}

async function apiRefMsaPut(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  let d = {};
  try { d = await request.json(); } catch (e) {}
  const rows = d.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return J({ ok: false, error: "Au moins une ligne requise." }, 400);
  }
  const cleanRows = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const aid = String(r.id || "").trim().toUpperCase();
    const msa = String(r.msa || "").trim().toUpperCase();
    const lib = String(r.libelle || "").trim();
    if (!aid || !msa) return J({ ok: false, error: `Ligne ${i + 1} : ID activité et MSA requis.` }, 400);
    if (seen.has(aid)) return J({ ok: false, error: `Ligne ${i + 1} : ID « ${aid} » en double.` }, 400);
    seen.add(aid);
    cleanRows.push({ id: aid, msa, libelle: lib });
  }
  await saveRefMsa(cleanRows);
  return J({ ok: true, message: `Référentiel enregistré : ${cleanRows.length} lignes.`,
             data: cleanRows });
}

async function apiRefMsaReset(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  await resetRefMsa();
  return J({ ok: true, message: "Référentiel réinitialisé.", data: await getRefMsa() });
}

async function apiRefMsaUpload(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  const file = await getFile(request, "Format attendu : Excel (.xlsx/.xls).");
  if (file.error) return J({ ok: false, error: file.error }, 400);
  let rows;
  try {
    rows = await parseRefMsa(file.file);
  } catch (e) {
    if (e && e.status) return J({ ok: false, error: e.error }, e.status);
    return J({ ok: false, error: `Fichier illisible : ${e.message || e}` }, 400);
  }
  await saveRefMsa(rows);
  return J({ ok: true, message: `Référentiel importé : ${rows.length} lignes.`, data: rows });
}

// ---------------------------------------------------------------- Calculate
async function apiCalculate(request, env) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  let p = {};
  try { p = await request.json(); } catch (e) {}

  const [profils, regles] = await getPayplan();
  const hireRaw = String(p.hire_date || "").trim();
  const site = String(p.site || "").trim().toUpperCase();
  const refRaw = String(p.reference_date || "").trim();
  const activites = p.activites || [];

  if (!hireRaw) {
    return J({ ok: false, error: "Date d'embauche manquante — recherchez d'abord le collaborateur." }, 400);
  }
  const hireDate = parseStrictISO(hireRaw);
  if (!hireDate) return J({ ok: false, error: "Date d'embauche invalide." }, 400);
  if (!site) return J({ ok: false, error: "Le site est obligatoire." }, 400);
  let baseHeures = parseFloat(p.base_heures || 0);
  if (Number.isNaN(baseHeures)) baseHeures = 0;
  if (baseHeures <= 0) return J({ ok: false, error: "La base d'heures est obligatoire." }, 400);
  if (!Array.isArray(activites) || !(1 <= activites.length && activites.length <= 7)) {
    return J({ ok: false, error: "Renseignez entre 1 et 7 activités." }, 400);
  }
  let referenceDate;
  if (!refRaw) {
    const t = nowUtc();
    referenceDate = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  } else {
    referenceDate = parseStrictISO(refRaw);
    if (!referenceDate) return J({ ok: false, error: "Date de référence invalide." }, 400);
  }

  const refMsaRows = await getRefMsa();
  const refMsa = {};
  for (const r of refMsaRows) refMsa[r.id] = r.msa;

  const clean = [];
  for (let i = 0; i < activites.length; i++) {
    const a = activites[i] || {};
    const n = i + 1;
    const activityId = String(a.activity_id || "").trim().toUpperCase();
    const profiles = a.profiles || [];
    let heures = parseFloat(a.heures || 0);
    if (Number.isNaN(heures)) heures = 0;
    if (!activityId) return J({ ok: false, error: `Activité ${n} : ID d'activité manquant.` }, 400);
    if (heures < 0) return J({ ok: false, error: `Activité ${n} : heures négatives interdites.` }, 400);
    if (profiles.length !== 3 || profiles.some((x) => !(x in profils))) {
      return J({ ok: false, error: `Activité ${n} : 3 profils attendus parmi : ${Object.keys(profils).join(", ")}.` }, 400);
    }
    const msa = refMsa[activityId];
    if (!msa) {
      return J({ ok: false, error: `Activité ${n} : ID « ${activityId} » absent du référentiel (voir panneau Admin).` }, 400);
    }
    clean.push({ activity_id: activityId, msa, heures, profiles });
  }

  let result = calculatePrime(hireDate, site, clean, referenceDate,
                              profils, regles, baseHeures);

  const matricule = String(p.matricule || "").trim();
  let nom = null;
  if (matricule) {
    let m = matricule;
    if (m.endsWith(".0")) m = m.slice(0, -2);
    const emp = await (await getDb()).collection("employees")
      .findOne({ mat_wkd: m.toUpperCase() }, { projection: { nom: 1 } });
    nom = emp ? emp.nom : null;
  }
  const record = { ...result, matricule, site, nom,
                   sid: u.user.sid, role: u.user.role, created_at: nowUtc() };
  try {
    await (await getDb()).collection("simulations").insertOne(record);
  } catch (e) { /* comme Flask : échec d'insertion silencieux */ }

  // Dates des 3 mois de profils (résolution mois par mois) — fidèle à app.py
  const monthDates = computeMonthDates(referenceDate);

  result = calculatePrime(hireDate, site, clean, referenceDate,
                          profils, regles, baseHeures, monthDates);
  return J({ ok: true, data: result });
}

// ------------------------------------------------------------- Simulations
async function apiSimulations(request, env) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") || "mine";
  let limit = parseInt(url.searchParams.get("limit") || "20", 10);
  if (Number.isNaN(limit)) limit = 20;
  limit = Math.min(limit, 200);
  const q = (u.user.role === "admin" && scope === "all") ? {} : { sid: u.user.sid };
  const db = await getDb();
  const cur = db.collection("simulations").find(q).sort({ created_at: -1 }).limit(limit);
  const data = [];
  for await (const d of cur) {
    const o = { ...d };
    o.id = String(o._id ?? "");
    delete o._id;
    data.push(o);
  }
  return J({ ok: true, data });
}

async function apiSimsDeleteAll(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  await (await getDb()).collection("simulations").deleteMany({});
  return J({ ok: true, message: "Historique vidé (toutes simulations)." });
}

async function apiSimDeleteOne(request, env, recId) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  let oid;
  try {
    oid = new ObjectId(recId);
  } catch (e) {
    return J({ ok: false, error: "Identifiant invalide." }, 400);
  }
  const filtre = { _id: oid };
  if (u.user.role !== "admin") filtre.sid = u.user.sid;
  const res = await (await getDb()).collection("simulations").deleteOne(filtre);
  if (res.deletedCount === 0) {
    return J({ ok: false, error: "Simulation introuvable (ou non à vous)." }, 404);
  }
  return J({ ok: true, message: "Simulation supprimée." });
}

async function apiSimsClearMine(request, env) {
  const u = await requireUser(request, env);
  if (u.response) return u.response;
  await (await getDb()).collection("simulations").deleteMany({ sid: u.user.sid });
  return J({ ok: true, message: "Vos simulations ont été supprimées." });
}

// ------------------------------------------------------------------- Upload
async function apiUpload(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  const file = await getFile(request, "Format attendu : Excel.");
  if (file.error) return J({ ok: false, error: file.error }, 400);
  let docs;
  try {
    docs = await parseActif(file.file);
  } catch (e) {
    if (e && e.status) return J({ ok: false, error: e.error }, e.status);
    return J({ ok: false, error: `Fichier illisible : ${e.message || e}` }, 400);
  }
  const db = await getDb();
  await db.collection("employees").deleteMany({});
  if (docs.length) await db.collection("employees").insertMany(docs);
  await db.collection("meta").replaceOne(
    { _id: "actif" },
    { _id: "actif", count: docs.length, updated_at: nowUtc() },
    { upsert: true });
  return J({ ok: true, message: `Extraction ACTIF enregistrée : ${docs.length} collaborateurs.` });
}

// -------------------------------------------------------------------- Stats
async function apiStats(request, env) {
  const u = await requireAdmin(request, env);
  if (u.response) return u.response;
  const db = await getDb();
  let dbStatus = "error";
  try {
    await db.command({ ping: 1 });
    dbStatus = "connected";
  } catch (e) { dbStatus = "error"; }
  const meta = await db.collection("meta").findOne({ _id: "actif" }) || {};
  const pp = await db.collection("payplan").findOne({ _id: "active" }) || {};
  const employees = await db.collection("employees").countDocuments({});
  const simulations = await db.collection("simulations").countDocuments({});
  return J({ ok: true, data: {
    employees, simulations, db: dbStatus,
    actif_updated_at: meta.updated_at ?? null,
    payplan_updated_at: pp.updated_at ?? null,
  } });
}

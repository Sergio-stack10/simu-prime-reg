/* ============================================================
   Connexion MongoDB + helpers — portage de db.py.
   Même base SIMULATEUR (Atlas) que Render : données partagées.

   ⚠️ Pattern Cloudflare officiel (docs MongoDB × Workers) :
   une connexion NOUVELLE par requête. Un MongoClient global en
   cache garde des sockets mortes (le reaper d'idle de Node ne
   tourne pas dans workerd) → requêtes qui « hangent ».
   Le client est partagé entre tous les helpers d'une même requête
   via AsyncLocalStorage, puis fermé (ctx.waitUntil) une fois la
   réponse construite.
   ============================================================ */
import { MongoClient } from "mongodb";
import { AsyncLocalStorage } from "node:async_hooks";

import { PROFILE_POINTS as DEFAULT_PROFILE_POINTS,
         PAYPLAN_RULES as DEFAULT_RULES,
         REF_MSA_SEED } from "./payplan_config.js";

export const REF_VERSION = 6;   // ne pas toucher (conserve votre référentiel importé)

// Migration v12 : renomme/ajoute les profils SANS toucher aux règles importées
const PROFILE_RENAME = { "Soutien Intense": "Care" };
const PROFILE_ENSURE = { "Challenger": 2 };

// ── Contexte par requête (AsyncLocalStorage) ──
const als = new AsyncLocalStorage();

export function runWithRequestStore(env, fn) {
  return als.run({ env, client: null, db: null }, fn);
}

export async function getDb() {
  const store = als.getStore();
  if (!store) throw new Error("getDb() appelé hors contexte de requête.");
  if (store.db) return store.db;
  const uri = store.env.MONGODB_URI;
  if (!uri) throw new Error("Variable d'environnement MONGODB_URI manquante.");
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 3,           // Atlas M0 : limiter les connexions
    minPoolSize: 0,
  });
  store.client = client;
  store.db = client.db("SIMULATEUR");
  await client.connect();
  // NB : les index existent déjà (créés par la version Render) — pas de
  // createIndex ici pour ne pas ajouter de latence.
  return store.db;
}

/* Client à fermer une fois la réponse prête (voir index.js) */
export function pendingClientClose() {
  const store = als.getStore();
  const c = store ? store.client : null;
  if (store) store.client = null;
  return c;
}

// ── Normalisation des montants (dict palier unique ou liste) ──
function normMontants(m) {
  if (m && typeof m === "object" && !Array.isArray(m)) {
    return Object.entries(m)
      .map(([k, v]) => ({ min: parseInt(k, 10), max: parseInt(k, 10), montant: parseInt(v, 10) }))
      .sort((a, b) => a.min - b.min);
  }
  if (Array.isArray(m)) {
    const out = [];
    for (const p of m) {
      try {
        out.push({ min: parseInt(p.min ?? 0, 10),
                   max: parseInt(p.max ?? p.min ?? 0, 10),
                   montant: parseInt(p.montant ?? 0, 10) });
      } catch (e) { continue; }
    }
    return out.sort((a, b) => a.min - b.min);
  }
  return [];
}

function rulesToDb(rules) {
  return (rules || []).map((r, i) => {
    r = { ...r };
    if (r.msa == null) r.msa = [];
    if (r.embauche_avant === undefined) r.embauche_avant = null;
    if (r.embauche_apres === undefined) r.embauche_apres = null;
    if (r.index == null) r.index = (i + 1) * 10;
    if (r.explication === undefined) r.explication = "";
    r.montants = normMontants(r.montants);
    return r;
  });
}

function rulesFromDb(rules) {
  return (rules || []).map((r, i) => {
    r = { ...r };
    if (r.msa == null) r.msa = [];
    if (r.embauche_avant === undefined) r.embauche_avant = null;
    if (r.embauche_apres === undefined) r.embauche_apres = null;
    if (r.index == null) r.index = (i + 1) * 10;
    if (r.explication === undefined) r.explication = "";
    r.montants = normMontants(r.montants);
    return r;
  });
}

// ── Migration profils (Soutien Intense→Care, Challenger assuré) ──
function migrateProfils(profils) {
  let changed = false;
  const out = { ...(profils || {}) };
  for (const [oldK, newK] of Object.entries(PROFILE_RENAME)) {
    if (oldK in out) {
      if (!(newK in out)) out[newK] = out[oldK];
      delete out[oldK];
      changed = true;
    }
  }
  for (const [k, v] of Object.entries(PROFILE_ENSURE)) {
    if (!(k in out)) { out[k] = v; changed = true; }
  }
  return [out, changed];
}

export async function getPayplan() {
  const db = await getDb();
  const doc = await db.collection("payplan").findOne({ _id: "active" });
  if (!doc) {
    await db.collection("payplan").replaceOne(
      { _id: "active" },
      { _id: "active", profils: { ...DEFAULT_PROFILE_POINTS },
        regles: rulesToDb(DEFAULT_RULES), updated_at: new Date() },
      { upsert: true });
    return [{ ...DEFAULT_PROFILE_POINTS }, rulesFromDb(DEFAULT_RULES)];
  }
  const [profils, changed] = migrateProfils(doc.profils);
  if (changed) {
    await db.collection("payplan").updateOne(
      { _id: "active" },
      { $set: { profils, updated_at: new Date() } });
  }
  return [profils, rulesFromDb(doc.regles)];
}

export async function savePayplan(profils, regles) {
  const db = await getDb();
  await db.collection("payplan").replaceOne(
    { _id: "active" },
    { _id: "active", profils, regles: rulesToDb(regles), updated_at: new Date() },
    { upsert: true });
}

export async function resetPayplan() {
  const db = await getDb();
  await db.collection("payplan").deleteOne({ _id: "active" });
}

export async function getRefMsa() {
  const db = await getDb();
  let doc = await db.collection("ref_msa").findOne({ _id: "active" });
  if (!doc || doc.version !== REF_VERSION) {
    doc = { _id: "active", version: REF_VERSION,
            rows: REF_MSA_SEED.map(([id, msa, libelle]) => ({ id, msa, libelle })),
            updated_at: new Date() };
    await db.collection("ref_msa").replaceOne({ _id: "active" }, doc, { upsert: true });
  }
  return doc.rows || [];
}

export async function saveRefMsa(rows) {
  const db = await getDb();
  await db.collection("ref_msa").replaceOne(
    { _id: "active" },
    { _id: "active", version: REF_VERSION, rows, updated_at: new Date() },
    { upsert: true });
}

export async function resetRefMsa() {
  const db = await getDb();
  await db.collection("ref_msa").deleteOne({ _id: "active" });
}

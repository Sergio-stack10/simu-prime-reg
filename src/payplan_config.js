/* ============================================================
   PAYPLAN — PRIME DE RÉGULARITÉ (v17 · portage exact de
   payplan_config.py pour Cloudflare Workers)
   · Points par MOIS + historique PROFILE_POINT_EFFECTS
   · Dégradation sur points COURANTS
   ⚠️ Montants seed = placeholders 0 : les vrais montants
      vivent en base MongoDB (partagée avec Render).
   ============================================================ */

// -------------------------------------------------------------------------
// 1) PROFILS (valeurs COURANTES — modifiables via Admin → Payplan)
// -------------------------------------------------------------------------
export const PROFILE_POINTS = {
  "Leader": 3,
  "Challenger": 2,
  "Fragile": 1,
  "Care": 0,
  "Non évalué": null,     // null = vide : aucun point
};

// ── Historique des points (date d'effet au mois de PERFORMANCE) ──
export const PROFILE_POINT_EFFECTS = [
  { profil: "Challenger", ancien: 3, date_effet: "2026-09-01" },
];

export const MIN_ANCIENNETE_MOIS = 4;
export const REGLE_DEGRADATION = true;   // dernier mois en baisse → points non comptés
export const REGLE_NOUVEAUX_4_6 = true;  // ancienneté 4-6 mois : 1er mois non compté

// -------------------------------------------------------------------------
// 2) RÈGLES SEED (⚠️ placeholders 0 — vraies valeurs en BDD via Admin)
// -------------------------------------------------------------------------
const paliers = (...triplets) =>
  triplets.map(([a, b, m]) => ({ min: a, max: b, montant: m }));

export const PAYPLAN_RULES = [
  { index: 1, nom: "ANTA · Avant 01/06/2023 · WHFR1135 & WHFR919",
    sites: ["ANTA"], msa: ["WHFR1135", "WHFR919"],
    embauche_avant: "2023-06-01", embauche_apres: null,
    anciennete_min: 4, anciennete_max: null, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 5, 0], [6, 9, 0]), explication: "Seed." },
  { index: 2, nom: "ANTA · Avant 01/06/2023 · Projets spécifiques (liste 2)",
    sites: ["ANTA"],
    msa: ["WHFR919", "WHFR1006", "WHFR1039", "WHFR1154", "WHFR1171", "WHFR218",
          "WHFR2749", "WHFR594", "WHFR907", "WHFR977", "WHFR1265"],
    embauche_avant: "2023-06-01", embauche_apres: null,
    anciennete_min: 4, anciennete_max: null, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 5, 0], [6, 9, 0]), explication: "Seed." },
  { index: 10, nom: "TMM · Avant 01/06/2023 · 4 à 6 mois",
    sites: ["TMM"], msa: [], embauche_avant: "2023-06-01", embauche_apres: null,
    anciennete_min: 4, anciennete_max: 6, nb_mois_profil: 2,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0]), explication: "Seed." },
  { index: 11, nom: "TMM · Avant 01/06/2023 · 7 à 18 mois",
    sites: ["TMM"], msa: [], embauche_avant: "2023-06-01", embauche_apres: null,
    anciennete_min: 7, anciennete_max: 18, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0], [7, 9, 0]), explication: "Seed." },
  { index: 12, nom: "TMM · Avant 01/06/2023 · 19 mois et +",
    sites: ["TMM"], msa: [], embauche_avant: "2023-06-01", embauche_apres: null,
    anciennete_min: 19, anciennete_max: null, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0], [7, 9, 0]), explication: "Seed." },
  { index: 20, nom: "ANTA · Avant 01/06/2023 · 4 à 6 mois",
    sites: ["ANTA"], msa: [], embauche_avant: "2023-06-01", embauche_apres: null,
    anciennete_min: 4, anciennete_max: 6, nb_mois_profil: 2,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0]), explication: "Seed." },
  { index: 21, nom: "ANTA · Avant 01/06/2023 · 7 à 18 mois",
    sites: ["ANTA"], msa: [], embauche_avant: "2023-06-01", embauche_apres: null,
    anciennete_min: 7, anciennete_max: 18, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0], [7, 9, 0]), explication: "Seed." },
  { index: 22, nom: "ANTA · Avant 01/06/2023 · 19 mois et +",
    sites: ["ANTA"], msa: [], embauche_avant: "2023-06-01", embauche_apres: null,
    anciennete_min: 19, anciennete_max: null, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0], [7, 9, 0]), explication: "Seed." },
  { index: 40, nom: "TMM · Après 01/06/2023 · 4 à 6 mois",
    sites: ["TMM"], msa: [], embauche_avant: null, embauche_apres: "2023-06-01",
    anciennete_min: 4, anciennete_max: 6, nb_mois_profil: 2,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0]), explication: "Seed." },
  { index: 41, nom: "TMM · Après 01/06/2023 · 7 à 18 mois",
    sites: ["TMM"], msa: [], embauche_avant: null, embauche_apres: "2023-06-01",
    anciennete_min: 7, anciennete_max: 18, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0], [7, 9, 0]), explication: "Seed." },
  { index: 42, nom: "TMM · Après 01/06/2023 · 19 mois et +",
    sites: ["TMM"], msa: [], embauche_avant: null, embauche_apres: "2023-06-01",
    anciennete_min: 19, anciennete_max: null, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0], [7, 9, 0]), explication: "Seed." },
  { index: 50, nom: "ANTA · Après 01/06/2023 · 4 à 6 mois",
    sites: ["ANTA"], msa: [], embauche_avant: null, embauche_apres: "2023-06-01",
    anciennete_min: 4, anciennete_max: 6, nb_mois_profil: 2,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0]), explication: "Seed." },
  { index: 51, nom: "ANTA · Après 01/06/2023 · 7 à 18 mois",
    sites: ["ANTA"], msa: [], embauche_avant: null, embauche_apres: "2023-06-01",
    anciennete_min: 7, anciennete_max: 18, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0], [7, 9, 0]), explication: "Seed." },
  { index: 52, nom: "ANTA · Après 01/06/2023 · 19 mois et +",
    sites: ["ANTA"], msa: [], embauche_avant: null, embauche_apres: "2023-06-01",
    anciennete_min: 19, anciennete_max: null, nb_mois_profil: 3,
    montants: paliers([0, 2, 0], [3, 4, 0], [5, 6, 0], [7, 9, 0]), explication: "Seed." },
];

export const REF_MSA_SEED = [
  ["W0ZVC5", "SITECSO", "Site CSO"],
  ["W0ZQPJ", "WHFR1006", "Orange At Hd"],
  ["W0ZRVV", "WHFR2729", "DRM - FRAIS DE ROUTE"],
];

// =========================================================================
// LOGIQUE (portage exact — ne pas modifier)
// =========================================================================

// ── Arrondi Python (banker's rounding : 22.5 → 22, 23.5 → 24) ──
export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return x;
  const f = Math.pow(10, nd);
  const y = x * f;
  const floor = Math.floor(y);
  const diff = y - floor;
  let r;
  if (Math.abs(diff - 0.5) < 1e-9) {          // égalité parfaite → vers le pair
    r = (floor % 2 === 0) ? floor : floor + 1;
  } else {
    r = Math.round(y);
  }
  return r / f;
}

// ── Dates : manipulées en UTC pur (comme datetime.date en Python) ──
export function parseISODate(s) {
  if (s instanceof Date) return s;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
export function isoOf(d) {
  if (!d) return null;
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0");
}
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

export function monthsBetween(start, end) {
  if (end < start) return 0;
  let m = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
          (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() < start.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

export function ancienneteDecimale(start, end) {
  if (end < start) return 0.0;
  const base = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
               (end.getUTCMonth() - start.getUTCMonth());
  const dim = daysInMonth(end.getUTCFullYear(), end.getUTCMonth() + 1);
  return pyRound(Math.max(0.0, base + (end.getUTCDate() - start.getUTCDate()) / dim), 1);
}

function _iso(d) {
  if (!d) return null;
  return parseISODate(String(d).slice(0, 10));
}

// ── Historique : valeur « ancienne » d'un profil pour un mois ISO ──
export function _legacyValue(profil, moisIso) {
  for (const e of PROFILE_POINT_EFFECTS) {
    if (e.profil === profil && String(moisIso) < String(e.date_effet).slice(0, 10)) {
      return e.ancien;
    }
  }
  return null;
}

// ── Résolution globale (compatibilité) ──
export function resolveProfilePoints(baseProfils, perfDate) {
  const pts = { ...(baseProfils || {}) };
  if (perfDate == null) return pts;
  let d = perfDate;
  if (typeof d === "string") d = parseISODate(d.slice(0, 10));
  if (!d) return pts;
  const debutMois = isoOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  for (const e of PROFILE_POINT_EFFECTS) {
    if (debutMois < String(e.date_effet).slice(0, 10) && Object.prototype.hasOwnProperty.call(pts, e.profil)) {
      pts[e.profil] = e.ancien;
    }
  }
  return pts;
}

// ── Points des profils d'une activité (résolution MOIS PAR MOIS) ──
export function sommePointsProfils(profiles, nbMois, profilePoints, monthDates = null) {
  const labels = ["M1", "M2", "M3"];
  const retenus = nbMois >= profiles.length ? profiles : profiles.slice(-nbMois);
  const offset = profiles.length - retenus.length;
  const detail = [];

  const basePts = (p) => {
    const v = Object.prototype.hasOwnProperty.call(profilePoints, p)
      ? profilePoints[p] : null;
    return v == null ? 0 : v;
  };
  const ptsForMonth = (profil, label) => {
    const moisIso = (monthDates || {})[label];
    if (moisIso == null) return basePts(profil);
    const legacy = _legacyValue(profil, moisIso);
    if (legacy != null) return legacy == null ? 0 : legacy;
    return basePts(profil);
  };

  // Mois hors période (ex : M1 quand la règle n'en compte que 2)
  for (let j = 0; j < offset; j++) {
    const p = profiles[j];
    detail.push({ mois: labels[j], profil: p,
      points: Object.prototype.hasOwnProperty.call(profilePoints, p)
        ? profilePoints[p] : 0,
      pris_en_compte: false, note: "hors période" });
  }

  // Valeurs effectives MOIS PAR MOIS (pour le total)
  const counted = retenus.map((p, i) => ptsForMonth(p, labels[offset + i]));

  // Dégradation : comparaison sur points COURANTS — la baisse due à un
  // changement de barème n'est pas une dégradation
  const countedCourants = retenus.map((p) => basePts(p));
  const degraded = REGLE_DEGRADATION && countedCourants.length >= 2 &&
                   countedCourants[countedCourants.length - 1] < countedCourants[countedCourants.length - 2];
  if (degraded) counted[counted.length - 1] = 0;

  let total = 0;
  for (let i = 0; i < retenus.length; i++) {
    const p = retenus[i];
    const note = (degraded && i === counted.length - 1) ? "0 pt — dégradation" : null;
    detail.push({ mois: labels[offset + i], profil: p,
      points: Object.prototype.hasOwnProperty.call(profilePoints, p)
        ? profilePoints[p] : 0,
      pris_en_compte: true, note,
      points_mois: counted[i] });
    total += counted[i];
  }
  return [total, detail];
}

// ── Sélection de la règle (priorité : MSA spécifiques puis index) ──
export function trouverRegle(regles, site, msa, ancienneteMois, hireDate) {
  const cle = (r) => [
    (r.msa && r.msa.length) ? 0 : 1,
    r.index != null ? r.index : 999,
  ];
  const sorted = [...(regles || [])].sort((a, b) => {
    const ka = cle(a), kb = cle(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  });
  for (const regle of sorted) {
    if (regle.sites && regle.sites.length &&
        !regle.sites.map((s) => String(s).toUpperCase()).includes(String(site).toUpperCase())) continue;
    const avant = _iso(regle.embauche_avant), apres = _iso(regle.embauche_apres);
    if (avant && !(hireDate < avant)) continue;
    if (apres && !(hireDate >= apres)) continue;
    const liste = (regle.msa || []).map((m) => String(m).trim().toUpperCase())
      .filter((m) => m);
    if (liste.length && !liste.includes(String(msa || "").trim().toUpperCase())) continue;
    if (ancienneteMois < (regle.anciennete_min ?? 0)) continue;
    const amax = regle.anciennete_max ?? null;
    if (amax != null && ancienneteMois > amax) continue;
    return regle;
  }
  return null;
}

function _montantForPoints(paliersListe, points) {
  for (const p of (paliersListe || [])) {
    try {
      if (parseInt(p.min, 10) <= points && points <= parseInt(p.max, 10)) {
        return parseInt(p.montant, 10);
      }
    } catch (e) { continue; }
  }
  return null;
}

// ── Calcul d'une activité ──
export function calculateActivity(hireDate, site, msa, profiles, anciennete,
                                  profilePoints, rules, monthDates = null) {
  const res = { msa, regle: null, total_points: 0, montant: null,
                eligible: false, explication: "", detail_points: [], nb_mois_profil: null };
  const regle = trouverRegle(rules, site, msa, anciennete, hireDate);
  if (!regle) {
    res.explication =
      `Aucune règle : Site=${site} · MSA=${msa || "—"} · ` +
      `embauche=${isoOf(hireDate).split("-").reverse().join("/")} · ` +
      `ancienneté=${anciennete} mois. Complétez le payplan (Admin).`;
    return res;
  }

  let nbMois = regle.nb_mois_profil;
  if (REGLE_NOUVEAUX_4_6 && anciennete >= 4 && anciennete <= 6) {
    nbMois = Math.min(nbMois, 2);
  }

  const [total, detail] = sommePointsProfils(profiles, nbMois, profilePoints, monthDates);
  const montant = _montantForPoints(regle.montants, total);
  Object.assign(res, { regle: regle.nom, nb_mois_profil: nbMois,
                       detail_points: detail, total_points: total,
                       explication: regle.explication || "",
                       bareme: regle.montants,
                       regle_infos: { sites: regle.sites || [], msa: regle.msa || [],
                                      embauche_avant: regle.embauche_avant ?? null,
                                      embauche_apres: regle.embauche_apres ?? null,
                                      anciennete_min: regle.anciennete_min ?? 0,
                                      anciennete_max: regle.anciennete_max ?? null } });
  if (montant == null) {
    res.explication += ` | Aucun palier ne contient ${total} pt.`;
    return res;
  }
  res.eligible = true;
  res.montant = montant;
  return res;
}

// ── Calcul global (prorata base d'heures) ──
export function calculatePrime(hireDate, site, activites, referenceDate = null,
                               profilePoints = null, rules = null, baseHeures = null,
                               monthDates = null) {
  // activites : [{activity_id, msa, heures, profiles}, ...]
  // Prorata : montant_proratise = (montant_base × heures_activité) ÷ base_heures
  profilePoints = profilePoints != null ? profilePoints : PROFILE_POINTS;
  rules = rules != null ? rules : PAYPLAN_RULES;
  const refDate = referenceDate != null ? referenceDate : new Date();
  const anciennete = monthsBetween(hireDate, refDate);

  const resultat = { date_embauche: isoOf(hireDate),
                     date_reference: isoOf(refDate),
                     anciennete_mois: anciennete,
                     anciennete_affichee: ancienneteDecimale(hireDate, refDate),
                     eligible: false, montant_prime: 0, explication: "",
                     activites: [], total_heures: 0, base_heures: null };
  if (anciennete < MIN_ANCIENNETE_MOIS) {
    resultat.explication =
      `Non éligible : ancienneté ${anciennete} mois (minimum ${MIN_ANCIENNETE_MOIS} mois).`;
    return resultat;
  }
  if (!baseHeures || baseHeures <= 0) {
    resultat.explication = "Renseignez la base d'heures (ex : 176).";
    return resultat;
  }
  resultat.base_heures = baseHeures;
  resultat.total_heures =
    activites.reduce((s, a) => s + parseFloat(a.heures || 0), 0);

  let montantFinal = 0;
  for (const a of activites) {
    const h = parseFloat(a.heures || 0);
    const act = calculateActivity(hireDate, site, a.msa, a.profiles || [],
                                  anciennete, profilePoints, rules, monthDates);
    act.activity_id = a.activity_id;
    act.heures = h;
    act.part = pyRound(h / baseHeures * 100, 1);
    act.montant_proratise = act.eligible
      ? pyRound((act.montant || 0) * h / baseHeures) : 0;
    montantFinal += act.montant_proratise;
    resultat.activites.push(act);
  }

  resultat.montant_prime = montantFinal;
  resultat.eligible = montantFinal > 0;
  return resultat;
}

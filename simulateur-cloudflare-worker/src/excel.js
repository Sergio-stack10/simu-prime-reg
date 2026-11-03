/* ============================================================
   Excel — remplace pandas/openpyxl par SheetJS (xlsx).
   Parité stricte avec les parseurs Python de app.py.
   ============================================================ */
import * as XLSX from "xlsx";

// ── Helpers communs (équivalents _clean / _norm_mat de app.py) ──
export function clean(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isNaN(v)) return "";
  const s = String(v).trim();
  return ["nan", "none", "*"].includes(s.toLowerCase()) ? "" : s;
}

export function normMat(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isNaN(v)) return "";
  let s = String(v).trim();
  if (s.endsWith(".0")) s = s.slice(0, -2);
  return s;
}

const mkDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;   // date impossible (31/02…) → comme strptime
  }
  return dt;
};
const isoOf = (d) =>
  d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") +
  "-" + String(d.getUTCDate()).padStart(2, "0");

// ── Lecture du classeur : 1re feuille → lignes objets ──
async function readRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  // Recopie avec clés stringifiées + trimées (df.columns = [str(c).strip()])
  return raw.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[String(k).trim()] = v;
    return o;
  });
}

// ── Dates ──
// Parité pd.to_datetime(str) : ISO d'abord, puis "a/b/yyyy" mois-d'abord
// (bascule jour-d'abord si le 1er nombre > 12), puis tirets.
export function parseFlexibleDate(s) {
  s = String(s).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})([T ].*)?$/.exec(s);
  if (m) return mkDate(+m[1], +m[2], +m[3]);
  // Format compact YYYYMMDD (accepté par pd.to_datetime)
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return mkDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a <= 12) {
      const d = mkDate(y, a, b);
      if (d) return d;
    }
    return mkDate(y, b, a);
  }
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a <= 12) {
      const d = mkDate(y, a, b);
      if (d) return d;
    }
    return mkDate(y, b, a);
  }
  return null;
}

// parse_hire_date de app.py (cellule Excel : Date SheetJS ou texte)
export function parseHireDate(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return null;   // cellule numérique brute → None (parité pandas)
  if (typeof v !== "string") return null;
  const d = parseFlexibleDate(v);
  return d;
}

// to_iso du payplan (jour d'abord : %d/%m/%Y, %Y-%m-%d, %d-%m-%Y)
function toIsoPayplan(v) {
  if (v instanceof Date) return isoOf(v);
  const s = String(v ?? "").trim();
  if (!s || s === "*" || s === "-") return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) { const d = mkDate(+m[3], +m[2], +m[1]); if (d) return isoOf(d); }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) { const d = mkDate(+m[1], +m[2], +m[3]); if (d) return isoOf(d); }
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (m) { const d = mkDate(+m[3], +m[2], +m[1]); if (d) return isoOf(d); }
  return null;
}

// to_int de app.py : int(float(str(v).replace(",", "."))) ou None
function toInt(v) {
  const s = String(v ?? "").replace(",", ".").trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  return Math.trunc(parseFloat(s));
}

// ── Normalisation de noms de colonnes ──
const stripAccents = (s) => s
  .replace(/é/g, "e").replace(/è/g, "e").replace(/ê/g, "e");
function normPayplanCol(c) {
  return stripAccents(String(c).trim().toLowerCase())
    .replace(/à/g, "a").replace(/ /g, "").replace(/-/g, "")
    .replace(/_/g, "").replace(/\./g, "");
}
function normRefCol(c) {
  return stripAccents(String(c).trim().toLowerCase())
    .replace(/ /g, "").replace(/-/g, "").replace(/_/g, "").replace(/\./g, "");
}

function makeFinder(rows, normFn) {
  const cols = {};
  if (rows.length) {
    for (const k of Object.keys(rows[0])) cols[normFn(k)] = k;
  }
  return (...cands) => {
    for (const c of cands) if (cols[c] != null) return cols[c];
    return null;
  };
}

// ============================================================
// 1) Import ACTIF  (POST /api/upload)
// ============================================================
export function deriveSite(location) {
  const loc = String(location || "").toLowerCase();
  const kw = { ANTA: ["antananarivo", "tana"], TMM: ["tamatave", "toamasina"] };
  for (const [code, list] of Object.entries(kw)) {
    if (list.some((k) => loc.includes(k))) return code;
  }
  return "AUTRE";
}

const TECH_MSA = new Set([
  "WHFR1135", "WHFR919", "WHFR1006", "WHFR1039", "WHFR1154", "WHFR1171",
  "WHFR218", "WHFR2749", "WHFR594", "WHFR907", "WHFR977", "WHFR1265",
]);
export function deriveTypo(msaCode) {
  return TECH_MSA.has(String(msaCode || "").trim().toUpperCase()) ? "TECH" : "SIMPLE";
}
export function extractMsaCode(msaFull) {
  const s = String(msaFull || "").trim();
  if (!s) return "";
  const parts = s.split(" - ").map((p) => p.trim());
  return (parts.length && parts[parts.length - 1]) ? parts[parts.length - 1].toUpperCase() : s.toUpperCase();
}
export function extractActivityCode(activityFull) {
  const s = String(activityFull || "").trim();
  return s ? s.split(/\s+/)[0].toUpperCase() : "";
}

export async function parseActif(file) {
  const rows = await readRows(file);
  const has = (rows, col) => rows.length && Object.prototype.hasOwnProperty.call(rows[0], col);
  const required = ["Employee ID", "Hire Date", "Location", "Activity ID", "Business Title"];
  const present = rows.length ? Object.keys(rows[0]) : [];
  for (const c of required) {
    if (!present.includes(c)) {
      throw { status: 400, error: "Colonnes manquantes : " + required.filter((x) => !present.includes(x)).sort().join(", ") };
    }
  }
  const docs = [];
  for (const r of rows) {
    const mat = normMat(r["Employee ID"]);
    if (!mat) continue;
    const poste = clean(r["Business Title"]);
    const location = clean(r["Location"]);
    const hire = parseHireDate(r["Hire Date"]);
    const msaRaw = has(rows, "MSA") ? clean(r["MSA"]) : "";
    const msaCode = extractMsaCode(msaRaw);
    docs.push({
      mat_wkd: mat,
      mat_paie: has(rows, "Previous Payroll ID") ? normMat(r["Previous Payroll ID"]).toUpperCase() : "",
      nom: (clean(r["First Name"]) + " " + clean(r["Last Name"])).trim(),
      poste,
      typo: deriveTypo(msaCode),
      location,
      site: deriveSite(location),
      projet: clean(r["Activity ID"]),
      msa: msaRaw,
      msa_code: msaCode,
      projet_code: extractActivityCode(clean(r["Activity ID"])),
      statut_wkd: "ACTIVE",
      hire_date: hire ? isoOf(hire) : null,
    });
  }
  return docs;
}

// ============================================================
// 2) Import matrice Payplan  (POST /api/payplan/upload)
// ============================================================
export async function parsePayplanMatrix(file) {
  const rows = await readRows(file);
  const find = makeFinder(rows, normPayplanCol);

  const cAvant = find("avant", "embaucheavant");
  const cApres = find("apres", "embaucheapres");
  const cSite = find("site", "poste");
  const cMsa = find("msa", "cpsa", "projetmsa", "specificationprojetmsa", "specification");
  const cAmin = find("ancmin", "anciennetemin");
  const cAmax = find("ancmax", "anciennetemax");
  const cPmin = find("ptsmin", "pointsmin", "pointmin");
  const cPmax = find("ptsmax", "pointsmax", "pointmax");
  const cMont = find("montant", "montants");
  const cIdx = find("index", "priorite");

  if (!(cSite && cAmin && cPmin && cPmax && cMont)) {
    throw { status: 400, error: "Colonnes requises manquantes : Site · Anc_min · Pts_min · Pts_max · Montant." };
  }

  const cell = (v) => {
    const s = clean(v);
    return ["*", "**", "-"].includes(s) ? "" : s;
  };

  const groups = new Map();
  const order = [];
  for (const r of rows) {
    const site = cell(r[cSite]).toUpperCase();
    const msaRaw = cell(r[cMsa]);
    const msa = msaRaw ? msaRaw.toUpperCase().split(/[,;/|\s]+/).filter((m) => m) : [];
    const aminRaw = cell(r[cAmin]);
    const amin = aminRaw ? toInt(aminRaw) : 0;
    const amaxRaw = cell(r[cAmax]);
    let amax = amaxRaw ? toInt(amaxRaw) : null;
    if (amax != null && amax >= 600) amax = null;
    const pmin = toInt(cell(r[cPmin]));
    const pmax = toInt(cell(r[cPmax]));
    const montant = toInt(cell(r[cMont]));
    if (pmin == null || pmax == null || montant == null) continue;
    const idx = cIdx ? toInt(cell(r[cIdx])) : null;
    const avant = cAvant ? toIsoPayplan(cell(r[cAvant])) : null;
    const apres = cApres ? toIsoPayplan(cell(r[cApres])) : null;
    const key = JSON.stringify([site, msa, avant, apres, amin, amax]);
    if (!groups.has(key)) {
      order.push(key);
      groups.set(key, { index: idx, paliers: [] });
    }
    const g = groups.get(key);
    g.paliers.push({ min: pmin, max: pmax, montant });
    if (idx != null && g.index == null) g.index = idx;
  }

  const libelle = (site, msa, avant, apres, amin, amax) => {
    let s = site || "Tous sites";
    if (avant) s += ` · Avant ${avant}`;
    else if (apres) s += ` · Après ${apres}`;
    else s += " · Toutes dates";
    if (msa && msa.length) s += " · " + msa.join(", ");
    if (amin === 0 && amax == null) s += " · Toutes anciennetés";
    else if (amax != null) s += ` · ${amin}-${amax} mois`;
    else s += ` · ${amin} mois et +`;
    return s;
  };

  const rules = [];
  let pos = 0;
  for (const key of order) {
    pos += 1;
    const [site, msa, avant, apres, amin, amax] = JSON.parse(key);
    const g = groups.get(key);
    const paliers = [...g.paliers].sort((a, b) => a.min - b.min);
    for (let i = 0; i < paliers.length - 1; i++) {
      const a = paliers[i], b = paliers[i + 1];
      if (b.min <= a.max) {
        throw { status: 400, error:
          `Paliers en chevauchement (${a.min}-${a.max} et ${b.min}-${b.max}) dans : ` +
          libelle(site, msa, avant, apres, amin, amax) };
      }
    }
    rules.push({
      nom: libelle(site, msa, avant, apres, amin, amax),
      sites: site, msa: msa.join(", "),
      embauche_avant: avant, embauche_apres: apres,
      index: g.index != null ? g.index : pos * 10,
      anciennete_min: amin, anciennete_max: amax,
      nb_mois_profil: (amax != null && amax <= 6) ? 2 : 3,
      montants: paliers,
      explication: "Importé depuis la matrice Excel",
    });
  }

  if (!rules.length) {
    throw { status: 400, error: "Aucune ligne exploitable : vérifiez que Pts_min, Pts_max et Montant sont remplis sur chaque ligne." };
  }
  return rules;
}

// ============================================================
// 3) Import référentiel MSA  (POST /api/ref-msa/upload)
// ============================================================
export async function parseRefMsa(file) {
  const rows = await readRows(file);
  const find = makeFinder(rows, normRefCol);

  const cCpsa = find("cpsa", "msa");
  const cAct = find("activites", "activite", "libelle", "libelleactivite");
  const cId = find("idactivite", "idactivites", "id", "activiteid");
  if (!(cCpsa && cAct && cId)) {
    throw { status: 400, error: "Colonnes attendues : CPSA · Activités · ID activité" };
  }
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const aid = clean(r[cId]).toUpperCase();
    const msa = clean(r[cCpsa]).toUpperCase();
    const lib = clean(r[cAct]);
    if (!aid || !msa || seen.has(aid)) continue;
    seen.add(aid);
    out.push({ id: aid, msa, libelle: lib });
  }
  if (!out.length) {
    throw { status: 400, error: "Aucune ligne valide (ID et CPSA requis)." };
  }
  return out;
}

// ============================================================
// 4) Modèle Excel du payplan  (GET /api/payplan/template)
// ============================================================
export function buildPayplanTemplate() {
  const PIVOT = "01/06/2023";
  const L1 = "WHFR1135,WHFR919";
  const L2 = "WHFR919,WHFR1006,WHFR1039,WHFR1154,WHFR1171,WHFR218," +
             "WHFR2749,WHFR594,WHFR907,WHFR977,WHFR1265";
  const P2 = [[0, 2], [3, 4], [5, 6]];
  const P3 = [[0, 2], [3, 4], [5, 6], [7, 9]];
  const header = ["Date", "Avant", "Après", "Site", "MSA", "Anc_min", "Anc_max",
                  "Pts_min", "Pts_max", "Montant", "Index"];
  const rows = [header];
  // (l'objet ligne suit l'ordre du dict Python : Date, Avant, Après, Site, MSA,
  //  Anc_min, Anc_max, Pts_min, Pts_max, Montant, Index)
  const add2 = (avant, site, msa, amin, amax, paliers, index) => {
    for (const [pmin, pmax] of paliers) {
      rows.push([PIVOT, avant ? PIVOT : "", avant ? "" : PIVOT, site, msa, amin,
                 amax == null ? "" : amax, pmin, pmax, 0, index]);
    }
  };
  add2(true,  "ANTA", L1, 4, null, P3, 1);
  add2(true,  "ANTA", L2, 4, null, P3, 2);
  add2(true,  "TMM",  "",  4, 6,    P2, 10);
  add2(true,  "TMM",  "",  7, 18,   P3, 11);
  add2(true,  "TMM",  "",  19, null, P3, 12);
  add2(true,  "ANTA", "",  4, 6,    P2, 20);
  add2(true,  "ANTA", "",  7, 18,   P3, 21);
  add2(true,  "ANTA", "",  19, null, P3, 22);
  add2(false, "TMM",  "",  4, 6,    P2, 40);
  add2(false, "TMM",  "",  7, 18,   P3, 41);
  add2(false, "TMM",  "",  19, null, P3, 42);
  add2(false, "ANTA", "",  4, 6,    P2, 50);
  add2(false, "ANTA", "",  7, 18,   P3, 51);
  add2(false, "ANTA", "",  19, null, P3, 52);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payplan");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

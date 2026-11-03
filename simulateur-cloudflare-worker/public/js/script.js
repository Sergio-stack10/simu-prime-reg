/* ============================================================
   SimuPrime v17 — script.js COMPLET
   · Mois de paie (M+1) → perf = paie − 1
   · Points de profils résolus MOIS PAR MOIS (historique date d'effet)
   · Dropdowns : chaque bloc M1/M2/M3 affiche SES points + sa couleur
   · Dégradation sur points COURANTS (changement de barème ≠ dégradation)
   · Heures ≥ 0 · dropdown activités filtré par MSA · couleurs profils
   · Suppression de simulations par ligne
   ============================================================ */
const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat("fr-FR");
const PP = { profilsBase: {}, effets: [], regles: [] };
const REF = {};                    // { "W0ZRVV": {msa, libelle} }
let ALL_REF_ROWS = [];
let employee = null;
const MAX_ACT = 7;
let placeholderResult = "", placeholderRules = "";

/* ═══════════ 🎨 CODE COULEUR DES PROFILS (par POINTS) ═══════════ */
const COLOR_STYLES = {
  green:  { bg: "#dcfce7", border: "#15803d", fg: "#166534" },   // 3 pts et +
  yellow: { bg: "#fef9c3", border: "#eab308", fg: "#713f12" },   // 2 pts
  orange: { bg: "#ffedd5", border: "#ea580c", fg: "#7c2d12" },   // 1 pt
  red:    { bg: "#fef2f2", border: "#dc2626", fg: "#7f1d1d" },   // 0 pt
  gray:   { bg: "#f1f5f9", border: "#94a3b8", fg: "#64748b" },   // vide
};

/* Couleur selon les POINTS — suit automatiquement les valeurs du payplan */
function colorForPoints(pts) {
  if (pts === null || pts === undefined) return "gray";
  if (pts >= 3) return "green";
  if (pts === 2) return "yellow";
  if (pts === 1) return "orange";
  if (pts === 0) return "red";
  return null;
}

/* Points d'un profil pour un mois précis (historique inclus)
   monthKey = "M1"|"M2"|"M3" (absent = valeur courante) */
function ptsForProfileMonth(name, monthKey) {
  if (!name) return null;
  let v = PP.profilsBase[name];
  if (monthKey) {
    const moisISO = moisISOForKey(monthKey);
    const legacy = (PP.effets || []).find(
      (e) => e.profil === name && moisISO < String(e.date_effet).slice(0, 10));
    if (legacy) v = legacy.ancien;
  }
  return v;
}

function colorForProfile(name, monthKey) {
  if (!name) return null;
  const pts = ptsForProfileMonth(name, monthKey);
  if (pts !== undefined && pts !== null) return colorForPoints(pts);
  if (pts === null && PP.profilsBase[name] === null) return "gray";
  const n = String(name).trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/(leader|^l$)/.test(n)) return "green";
  if (/(challeng)/.test(n)) return "yellow";
  if (/(fragile|^f$)/.test(n)) return "orange";
  if (/(care|soutien|^si$)/.test(n)) return "red";
  if (/(non|evalue|vide)/.test(n)) return "gray";
  return null;
}

/* Peint UN select selon SON mois (M1/M2/M3 via data-month) */
function paintSelect(sel) {
  const monthKey = sel.dataset.month || null;
  const c = colorForProfile(sel.value, monthKey);
  sel.classList.remove("pc-green", "pc-yellow", "pc-orange", "pc-red", "pc-gray");
  const monthEl = sel.closest(".profile-cell")?.querySelector(".p-month");
  if (!c) {
    sel.style.background = ""; sel.style.borderColor = "";
    sel.style.color = ""; sel.style.fontWeight = "";
    if (monthEl) monthEl.style.color = "";
    return;
  }
  const s = COLOR_STYLES[c];
  sel.style.background = s.bg;
  sel.style.borderColor = s.border;
  sel.style.color = s.fg;
  sel.style.fontWeight = "700";
  sel.classList.add("pc-" + c);
  if (monthEl) monthEl.style.color = s.border;
}

function colorProfiles(cardEl) {
  (cardEl ? [cardEl] : document.querySelectorAll(".act-card")).forEach((card) => {
    card.querySelectorAll("select.profile").forEach(paintSelect);
  });
}

/* Pastille colorée — couleur selon le mois si fourni (ex: détail des règles) */
function profilBadgeHTML(name, monthKey) {
  const c = colorForProfile(name, monthKey);
  return c ? `<span class="pchip pc-${c}">${esc(name)}</span>` : `<b>${esc(name)}</b>`;
}

/* Ordre d'affichage voulu ; profils inconnus en fin de liste */
const PROFILE_ORDER = ["Non évalué", "Care", "Fragile", "Challenger", "Leader"];
function orderedProfiles() {
  const keys = Object.keys(PP.profilsBase);
  const known = PROFILE_ORDER.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !PROFILE_ORDER.includes(k));
  return [...known, ...rest];
}

const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet",
                 "Août","Septembre","Octobre","Novembre","Décembre"];
const MOIS_AB = ["Janv.","Févr.","Mars","Avr.","Mai","Juin","Juil.",
                 "Août","Sept.","Oct.","Nov.","Déc."];
const SITE_LABELS = { ANTA: "ANTA — Antananarivo", TMM: "TMM — Tamatave", AUTRE: "AUTRE" };

/* ═══════════════ Utilitaires ═══════════════ */
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { location.href = "/login"; throw new Error("401"); }
  const ct = res.headers.get("content-type") || "";
  const j = ct.includes("json") ? await res.json() : { ok: false, error: "Réponse invalide" };
  if (res.status === 403) { toast(j.error || "Accès refusé", "error"); throw new Error("403"); }
  return j;
}
function toast(msg, type = "info") {
  const t = document.createElement("div");
  t.className = "toast " + type; t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3800);
}
function countUp(el, target, { dur = 900, suffix = "" } = {}) {
  const t0 = performance.now();
  (function f(t) {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt.format(Math.round(target * e)) + suffix;
    if (p < 1) requestAnimationFrame(f);
  })(t0);
}
function iso(y, m, d) {
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

/* ═══════════════ Mois de PAIE → PERFORMANCE = paie − 1 ═══════════════ */
function paieMonthDate() {
  return new Date(parseInt($("#ref-year").value), parseInt($("#ref-month").value) - 1, 1);
}
function perfMonthDate() {
  const p = paieMonthDate();
  return new Date(p.getFullYear(), p.getMonth() - 1, 1);
}
function perfMonthLabel() {
  const d = perfMonthDate();
  return MOIS_AB[d.getMonth()] + " " + d.getFullYear();
}
function perfMonthEndISO() {
  const d = perfMonthDate();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return iso(d.getFullYear(), d.getMonth() + 1, last);
}
function monthMap() {
  const d = perfMonthDate(), map = {};
  ["M1", "M2", "M3"].forEach((k, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (2 - i), 1);
    map[k] = MOIS_AB[m.getMonth()] + " " + m.getFullYear();
  });
  return map;
}

/* ISO du 1er jour du mois correspondant à la clé M1/M2/M3 */
function moisISOForKey(key) {
  const d = perfMonthDate();
  const shift = key === "M1" ? -2 : key === "M2" ? -1 : 0;
  const m = new Date(d.getFullYear(), d.getMonth() + shift, 1);
  return iso(m.getFullYear(), m.getMonth() + 1, 1);
}

function updateMonthLabels() {
  const mm = monthMap();
  document.querySelectorAll(".act-card .p-month").forEach((el) => {
    el.textContent = mm[el.dataset.m] || el.dataset.m;
  });
}
function updateBaseHeures() {
  const d = perfMonthDate();
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  let ouvres = 0;
  for (let i = 1; i <= days; i++) {
    const wd = new Date(d.getFullYear(), d.getMonth(), i).getDay();
    if (wd !== 0 && wd !== 6) ouvres++;
  }
  const base = ouvres * 8;
  $("#base-heures").value = base;
  $("#base-heures-info").textContent = "Perf. " + perfMonthLabel() + " : " +
    ouvres + " j ouvrés × 8 h = " + base + " h (modifiable)";
}
function onRefMonthChange() {
  updateBaseHeures();
  updateMonthLabels();
  refreshProfileSelects();   // régénère les dropdowns avec les points du trimestre
}

/* ═══════════════ Dropdown activités (filtré par MSA du collaborateur) ═══════════════ */
function renderActList(msaCode) {
  const dl = $("#act-list");
  if (!dl) return;
  let rows = ALL_REF_ROWS;
  if (msaCode && rows.some((r) => r.msa === msaCode)) {
    rows = rows.filter((r) => r.msa === msaCode);
  }
  dl.innerHTML = rows.map((r) =>
    `<option value="${esc(r.id)}" label="${esc(r.libelle || r.msa)}"></option>`).join("");
}

/* ═══════════════ Initialisation ═══════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  placeholderResult = $("#result-card").innerHTML;
  placeholderRules = $("#rules-card").innerHTML;

  /* 🎨 Délégation globale : tout changement de select profil repeint selon SON mois */
  document.addEventListener("change", (e) => {
    if (e.target && e.target.matches && e.target.matches("select.profile")) {
      paintSelect(e.target);
    }
  });

  const now = new Date();
  const ms = $("#ref-month");
  MOIS_FR.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = i + 1; o.textContent = m; ms.appendChild(o);
  });
  const ys = $("#ref-year");
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
    const o = document.createElement("option");
    o.value = y; o.textContent = y; ys.appendChild(o);
  }
  ms.value = now.getMonth() + 1;
  ys.value = now.getFullYear();
  ms.onchange = onRefMonthChange;
  ys.onchange = onRefMonthChange;
  onRefMonthChange();

  $("#btn-search").onclick = searchEmployee;
  $("#matricule").addEventListener("keydown", (e) => { if (e.key === "Enter") searchEmployee(); });
  $("#btn-calculate").onclick = calculate;
  $("#btn-reset").onclick = resetAll;
  $("#btn-logout").onclick = logout;
  $("#btn-refresh-sims").onclick = loadMySims;
  $("#btn-clear-sims").onclick = clearMySims;
  $("#btn-add-act").onclick = () => addActivity();

  await loadPayplan();
  await loadRef();
  addActivity();
  await loadMySims();
});

/* ═══════════════ Nouvelle simulation ═══════════════ */
function resetAll() {
  if (!confirm("Effacer toutes les saisies pour commencer une nouvelle simulation ?")) return;
  employee = null;
  $("#matricule").value = "";
  $("#employee-result").innerHTML = "";
  $("#typo").value = ""; $("#typo").placeholder = "—";
  $("#site").value = ""; $("#site").placeholder = "—";
  delete $("#site").dataset.code;
  $("#hire-date").value = "";
  const now = new Date();
  $("#ref-month").value = now.getMonth() + 1;
  $("#ref-year").value = now.getFullYear();
  onRefMonthChange();
  renderActList(null);
  $("#activites").innerHTML = "";
  addActivity();
  $("#result-card").innerHTML = placeholderResult;
  $("#rules-card").innerHTML = placeholderRules;
  fillPhProfils();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Formulaire réinitialisé — nouvelle simulation prête ✨", "success");
}

function fillPhProfils() {
  const ph = $("#ph-profils");
  if (!ph) return;
  ph.innerHTML = orderedProfiles().map((c) => {
    const p = PP.profilsBase[c];
    const col = colorForPoints(p);
    const cls = col ? "pc-" + col : "pc-gray";
    const lbl = p === null ? "vide" : p + " pt" + (Math.abs(p) >= 2 ? "s" : "");
    return `<span class="pchip ${cls}">${esc(c)} · ${lbl}</span>`;
  }).join("");
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch (e) {}
  location.href = "/login";
}

async function loadPayplan() {
  try {
    const j = await api("/api/payplan");
    if (!j.ok) return;
    PP.profilsBase = j.profils || {};
    PP.effets = j.effets || [];
    PP.regles = j.regles || [];
    refreshProfileSelects();
    fillPhProfils();
  } catch (e) { console.error(e); }
}

async function loadRef() {
  try {
    const j = await api("/api/ref-msa");
    if (!j.ok) return;
    ALL_REF_ROWS = j.data || [];
    ALL_REF_ROWS.forEach((r) => {
      REF[r.id] = { msa: r.msa, libelle: r.libelle || "" };
    });
    renderActList(employee ? employee.msa_code : null);
  } catch (e) { console.error(e); }
}

/* Options colorées + points propres à CE mois (historique inclus) */
function profileOptionsHTML(monthKey) {
  return `<option value="" disabled selected>Sélectionner…</option>` +
    orderedProfiles().map((code) => {
      const v = ptsForProfileMonth(code, monthKey);
      const val = (v === null || v === undefined) ? "vide"
        : v + " pt" + (Math.abs(v) >= 2 ? "s" : "");
      const c = colorForPoints(v);
      const style = c
        ? ` style="background:${COLOR_STYLES[c].bg};color:${COLOR_STYLES[c].fg};font-weight:700"`
        : "";
      return `<option value="${esc(code)}"${style}>${esc(code)} · ${val}</option>`;
    }).join("");
}

/* Régénère tous les dropdowns avec les points du trimestre (sélections gardées) */
function refreshProfileSelects() {
  document.querySelectorAll(".act-card select.profile").forEach((sel) => {
    const cur = sel.value;
    sel.innerHTML = profileOptionsHTML(sel.dataset.month || null);
    if (cur) sel.value = cur;
    paintSelect(sel);
  });
}

/* ═══════════════ Activités ═══════════════ */
function addActivity(activityId = "") {
  const cont = $("#activites");
  if (cont.children.length >= MAX_ACT) { toast(`Maximum ${MAX_ACT} activités.`, "error"); return; }
  const div = document.createElement("div");
  div.className = "act-card";
  div.innerHTML = `
    <div class="act-head">
      <button type="button" class="act-toggle" title="Replier/déplier">▾</button>
      <span class="act-title">Activité</span>
      <span class="badge a-badge">—</span>
      <button type="button" class="btn btn-danger btn-sm act-del" title="Supprimer">✕</button>
    </div>
    <div class="act-body">
      <div class="grid-act">
        <div class="field">
          <label>ID de l'activité *</label>
          <input class="a-act" list="act-list" placeholder="ex : W0ZRVV" value="${esc(activityId)}"/>
          <span class="msa-resolved" hidden><span class="dot"></span><span class="txt"></span></span>
        </div>
        <div class="field"><label>Heures sur l'activité * <span class="muted">(0 autorisé)</span></label>
          <input class="a-heures" type="number" min="0" step="0.5" placeholder="ex : 105"/></div>
      </div>
      <div class="field"><label>Profils des 3 derniers mois *</label>
        <div class="profile-row">
          <div class="profile-cell"><span class="p-month" data-m="M1">M1</span>
            <select class="profile a-p1" data-month="M1">${profileOptionsHTML("M1")}</select></div>
          <div class="profile-cell"><span class="p-month" data-m="M2">M2</span>
            <select class="profile a-p2" data-month="M2">${profileOptionsHTML("M2")}</select></div>
          <div class="profile-cell"><span class="p-month" data-m="M3">M3</span>
            <select class="profile a-p3" data-month="M3">${profileOptionsHTML("M3")}</select></div>
        </div></div>
    </div>`;

  const actInput = div.querySelector(".a-act");
  const resolve = () => {
    const v = actInput.value.trim().toUpperCase();
    const box = div.querySelector(".msa-resolved");
    if (!v) { box.hidden = true; }
    else if (REF[v]) {
      box.hidden = false; box.classList.remove("unknown");
      box.querySelector(".txt").textContent =
        "MSA : " + REF[v].msa + (REF[v].libelle ? " · " + REF[v].libelle : "");
    } else {
      box.hidden = false; box.classList.add("unknown");
      box.querySelector(".txt").textContent = "ID inconnu — vérifiez le référentiel (Admin)";
    }
    refreshActs();
  };
  actInput.addEventListener("input", resolve);

  div.querySelector(".act-toggle").onclick = () => {
    div.classList.toggle("collapsed");
    div.querySelector(".act-toggle").textContent =
      div.classList.contains("collapsed") ? "▸" : "▾";
  };
  div.querySelector(".act-del").onclick = () => {
    if ($("#activites").children.length <= 1) { toast("Au moins une activité requise.", "error"); return; }
    div.remove(); refreshActs();
  };
  div.querySelector(".a-heures").addEventListener("input", refreshActs);

  cont.appendChild(div);
  resolve();
  updateMonthLabels();
  colorProfiles(div);
}

function refreshActs() {
  let total = 0;
  [...$("#activites").children].forEach((c, i) => {
    const id = c.querySelector(".a-act").value.trim().toUpperCase();
    const lib = REF[id] && REF[id].libelle ? REF[id].libelle : "";
    c.querySelector(".act-title").textContent = "Activité " + (i + 1) + (lib ? " — " + lib : "");
    const badge = c.querySelector(".a-badge");
    badge.textContent = id ? (REF[id] ? id + " → " + REF[id].msa : id + " ⚠") : "—";
    badge.title = lib;
    const h = parseFloat(c.querySelector(".a-heures").value);
    if (!isNaN(h)) total += h;
  });
  $("#act-count").textContent = $("#activites").children.length + " / " + MAX_ACT;
  $("#act-total-h").textContent = "Heures totales : " + fmt.format(total) + " h";
}

/* ═══════════════ Recherche collaborateur ═══════════════ */
async function searchEmployee() {
  const mat = $("#matricule").value.trim(), box = $("#employee-result");
  if (!mat) { box.innerHTML = `<div class="alert warn">Veuillez saisir un matricule.</div>`; return; }
  box.innerHTML = `<p class="muted">⏳ Recherche…</p>`;
  try {
    const j = await api("/api/employee/" + encodeURIComponent(mat));
    if (!j.ok) { employee = null;
      box.innerHTML = `<div class="alert warn">${esc(j.error)}</div>`; return; }
    employee = j.data;
    box.innerHTML = renderEmployee(j.data);
    $("#typo").value = j.data.typo || "SIMPLE";
    $("#site").value = SITE_LABELS[j.data.site] || j.data.site || "—";
    $("#site").dataset.code = j.data.site || "ANTA";
    $("#hire-date").value = j.data.hire_date || "";
    renderActList(j.data.msa_code);
    const first = $("#activites").querySelector(".act-card");
    if (first && !first.querySelector(".a-act").value && j.data.projet_code) {
      first.querySelector(".a-act").value = j.data.projet_code;
      first.querySelector(".a-act").dispatchEvent(new Event("input"));
    }
  } catch (e) { box.innerHTML = `<div class="alert error">Erreur réseau.</div>`; }
}

function renderEmployee(e) {
  const info = (label, value) => `
    <div class="emp-item"><span class="emp-label">${label}</span>
      <span class="emp-value">${esc(value || "—")}</span></div>`;
  return `
    <div class="employee-card">
      <div class="emp-head">
        <div><span class="emp-name">${esc(e.nom)}</span>
             <span class="muted"> · ${esc(e.poste)}</span></div>
        <span class="badge ok">${esc(e.statut_wkd)}</span>
      </div>
      <div class="emp-grid-2">
        ${info("Matricule WKD", e.matricule)}
        ${info("Matricule paie", e.matricule_paie)}
        ${info("Location", e.location)}
        ${info("MSA", e.msa)}
      </div>
    </div>`;
}

/* ═══════════════ Calcul ═══════════════ */
async function calculate() {
  const hireDate = $("#hire-date").value;
  const site = $("#site").dataset.code || "ANTA";
  const baseHeures = parseFloat($("#base-heures").value);

  if (!hireDate) { toast("Recherchez d'abord le collaborateur — la date d'embauche se remplit automatiquement.", "error"); return; }
  if (!baseHeures || baseHeures <= 0) { toast("Base d'heures manquante.", "error"); return; }

  const acts = [...$("#activites").children].map((c) => ({
    activity_id: c.querySelector(".a-act").value.trim().toUpperCase(),
    heures: parseFloat(c.querySelector(".a-heures").value) || 0,
    profiles: [".a-p1", ".a-p2", ".a-p3"].map((s) => c.querySelector(s).value),
  }));
  for (let i = 0; i < acts.length; i++) {
    const n = i + 1;
    if (!acts[i].activity_id) { toast(`Activité ${n} : ID d'activité manquant.`, "error"); return; }
    if (!REF[acts[i].activity_id]) { toast(`Activité ${n} : ID inconnu dans le référentiel.`, "error"); return; }
    if (acts[i].heures < 0) { toast(`Activité ${n} : heures négatives interdites.`, "error"); return; }
    if (acts[i].profiles.some((p) => !p)) { toast(`Activité ${n} : 3 profils requis.`, "error"); return; }
  }

  const btn = $("#btn-calculate");
  btn.classList.add("loading"); btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Calcul…';
  try {
    const j = await api("/api/calculate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matricule: employee ? employee.matricule : $("#matricule").value.trim(),
        hire_date: hireDate, site,
        reference_date: perfMonthEndISO(),
        base_heures: baseHeures,
        activites: acts }) });
    if (!j.ok) { toast(j.error, "error"); return; }
    renderResult(j.data);
    await loadMySims();
  } catch (e) { toast("Erreur réseau.", "error"); }
  finally { btn.classList.remove("loading"); btn.disabled = false;
            btn.innerHTML = "✨ Calculer ma prime"; }
}

/* ═══════════════ Résultats + Règles ═══════════════ */
function renderResult(d) {
  const rc = $("#result-card"), rcard = $("#rules-card");
  const acts = d.activites || [];
  const mm = monthMap();

  const isDegraded = (a) => (a.detail_points || [])
    .some((p) => p.note && p.note.includes("dégradation"));
  const libelleOf = (id) => REF[id] && REF[id].libelle ? REF[id].libelle : "";

  const rows = acts.map((a) => `
    <tr class="${a.eligible ? "" : "off"}">
      <td><b>${esc(a.activity_id || "")}</b> → ${esc(a.msa)}
          ${libelleOf(a.activity_id) ? `<br/><span class="muted small">${esc(libelleOf(a.activity_id))}</span>` : ""}</td>
      <td class="center">${fmt.format(a.heures)} h</td>
      <td class="center">${a.part ?? 0}%</td>
      <td class="center"><b>${a.total_points}</b> pt${Math.abs(a.total_points) >= 2 ? "s" : ""}${isDegraded(a) ? '<span class="deg-badge">⚠</span>' : ""}</td>
      <td>${a.eligible ? fmt.format(a.montant) + " Ar" : "—"}</td>
      <td><b>${fmt.format(a.montant_proratise || 0)} Ar</b></td>
    </tr>`).join("");

  rc.innerHTML = `
    <h2><span class="chip">4</span> Résultats de la simulation
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="resetAll()">🔄 Nouvelle</button></h2>
    ${d.explication && !d.eligible ? `<div class="alert warn">${esc(d.explication)}</div>` : ""}
    <div class="results">
      <div class="result-box">
        <span class="result-label">Activités calculées</span>
        <span class="result-value">${acts.filter((a) => a.eligible).length}<small>/${acts.length}</small></span>
        <span class="result-sub">Perf. ${esc(perfMonthLabel())} · Heures : ${fmt.format(d.total_heures || 0)} h ·
          Base : ${fmt.format(d.base_heures || 0)} h</span>
      </div>
      <div class="result-box highlight">
        <span class="result-label">Prime de régularité estimée</span>
        <span class="result-value gold" id="rv-amount">0</span>
        <span class="result-sub">Ancienneté : ${d.anciennete_affichee} mois (au ${d.date_reference})</span>
      </div>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Activité (ID → MSA)</th><th>Heures</th><th>% base</th><th>Points</th>
        <th>Montant base</th><th>Montant proratisé</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  requestAnimationFrame(() => countUp($("#rv-amount"), d.montant_prime || 0, { suffix: " Ar" }));

  const baremeChips = (a) => (a.bareme || []).slice().sort((x, y) => x.min - y.min)
    .map((p) => {
      const hit = a.total_points >= p.min && a.total_points <= p.max;
      const plage = p.min === p.max
        ? p.min + " pt" + (p.min >= 2 ? "s" : "")
        : p.min + "–" + p.max + " pts";
      return `<span class="bchip ${hit ? "hit" : ""}">${plage} → ${fmt.format(p.montant)} Ar</span>`;
    }).join("");
  const conditions = (a) => {
    const i = a.regle_infos || {}, parts = [];
    if (i.sites && i.sites.length) parts.push("Site : " + i.sites.join(", "));
    if (i.msa && i.msa.length) parts.push("MSA : " + i.msa.join(", "));
    if (i.embauche_avant) parts.push("Embauche avant le " + i.embauche_avant);
    if (i.embauche_apres) parts.push("Embauche à partir du " + i.embauche_apres);
    parts.push(`Ancienneté : ${i.anciennete_min != null ? i.anciennete_min : "?"}` +
               `${i.anciennete_max != null ? " à " + i.anciennete_max + " mois" : " mois et +"}`);
    return parts.join(" · ");
  };

  /* Mois comptés : points EFFECTIFS du mois (historique inclus) — badge coloré du mois */
  const details = acts.map((a, idx) => `
    <details class="rule-detail" ${idx === 0 ? "open" : ""}>
      <summary>${esc(a.activity_id || "")} — ${esc(a.msa)} ·
        <span class="muted">${esc(a.regle || "aucune règle")}</span></summary>
      <div class="rd-body">
        ${a.regle ? `
        <p class="small"><b>Conditions :</b> ${esc(conditions(a))}</p>
        <p class="small"><b>Mois comptés (${a.nb_mois_profil}) :</b>
          ${(a.detail_points || []).filter((p) => p.pris_en_compte)
            .map((p) => {
              const pts = (p.points_mois !== undefined && p.points_mois !== null)
                ? p.points_mois : p.points;
              const ancien = (p.points != null && pts != null && p.points !== pts)
                ? ` (nouvelle valeur : ${p.points} pt)` : "";
              const ptsTxt = (pts === null || pts === undefined) ? "vide" : pts + " pt" + ancien;
              return `${mm[p.mois] || p.mois} : ${profilBadgeHTML(p.profil, p.mois)} (${p.note ? esc(p.note) : ptsTxt})`;
            })
            .join(" · ")}</p>
        ${a.nb_mois_profil < 3 && (d.anciennete_mois >= 4 && d.anciennete_mois <= 6)
          ? `<p class="small"><b>Nouvel intégrant (4-6 mois) :</b> 1er mois non compté.</p>` : ""}
        <div class="bareme-row">${baremeChips(a)}</div>
        ${a.eligible ? `<p class="small formula">${fmt.format(a.montant)} Ar ×
          (${fmt.format(a.heures)} h ÷ ${fmt.format(d.base_heures)} h) =
          <b>${fmt.format(a.montant_proratise)} Ar</b></p>` : ""}` : ""}
      </div>
    </details>`).join("");

  rcard.innerHTML = `
    <h2><span class="chip">§</span> Règles du payplan appliquées</h2>
    ${details || `<p class="muted small">Aucune règle applicable.</p>`}`;
}

/* ═══════════════ Mes simulations ═══════════════ */
async function loadMySims() {
  try {
    const j = await api("/api/simulations?scope=mine&limit=10");
    const rows = (j.data || []).map((r) => {
      const acts = r.activites
        ? r.activites.map((a) => a.activity_id || a.msa).join(", ")
        : (r.profiles || []).join(" / ");
      return `<tr><td>${new Date(r.created_at).toLocaleString("fr-FR")}</td>
        <td>${esc(r.matricule || "—")}</td><td>${esc(r.site || "")}</td>
        <td>${esc(acts || "—")}</td>
        <td>${r.montant_prime ? fmt.format(r.montant_prime) + " Ar" : "—"}</td>
        <td>${r.id ? `<button class="btn btn-danger btn-sm" title="Supprimer cette simulation"
          onclick="deleteSim('${r.id}')">🗑</button>` : ""}</td></tr>`;
    }).join("");
    $("#my-sims-body").innerHTML = rows ||
      `<tr><td colspan="6" class="muted center">Aucune simulation pour le moment.</td></tr>`;
  } catch (e) {}
}

async function clearMySims() {
  if (!confirm("Supprimer toutes VOS simulations de cette session ?")) return;
  try {
    const j = await api("/api/simulations/mine", { method: "DELETE" });
    if (j.ok) { toast(j.message, "success"); await loadMySims(); }
  } catch (e) {}
}

async function deleteSim(id) {
  if (!confirm("Supprimer cette simulation ?")) return;
  try {
    const j = await api("/api/simulations/" + id, { method: "DELETE" });
    if (j.ok) { toast(j.message, "success"); await loadMySims(); }
    else toast(j.error, "error");
  } catch (e) {}
}

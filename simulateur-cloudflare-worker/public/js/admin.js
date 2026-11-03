/* ============================================================
   Admin v11 — Stats · ACTIF · Référentiel · Payplan (éditeur
   paliers + import Excel matrice) · Historique
   ============================================================ */
const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat("fr-FR");
let allSims = [];

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
function countUp(el, target, { dur = 900 } = {}) {
  const t0 = performance.now();
  (function f(t) {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt.format(Math.round(target * e));
    if (p < 1) requestAnimationFrame(f);
  })(t0);
}

document.addEventListener("DOMContentLoaded", async () => {
  $("#btn-logout").onclick = logout;

  const dz = $("#dropzone"), fi = $("#file-actif");
  dz.onclick = () => fi.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("dragover"); };
  dz.ondragleave = () => dz.classList.remove("dragover");
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("dragover");
    if (e.dataTransfer.files[0]) uploadActif(e.dataTransfer.files[0]); };
  fi.onchange = () => { if (fi.files[0]) uploadActif(fi.files[0]); };

  $("#ref-add").onclick = () => $("#ref-body").appendChild(refRow("", "", ""));
  $("#ref-reset").onclick = resetRef;
  $("#ref-save").onclick = saveRef;
  $("#ref-import-btn").onclick = () => $("#file-ref").click();
  $("#file-ref").onchange = () => { const f = $("#file-ref").files[0]; if (f) uploadRef(f); };

  $("#pp-import-btn").onclick = () => $("#file-payplan").click();
  $("#file-payplan").onchange = () => { const f = $("#file-payplan").files[0]; if (f) uploadPayplan(f); };
  $("#pp-add-profil").onclick = () => $("#pp-profiles").appendChild(profilRow("", 1));
  $("#pp-add-rule").onclick = () => $("#pp-rules").appendChild(ruleCard({
    nom: "Nouvelle règle", sites: "", msa: "", embauche_avant: null, embauche_apres: null,
    index: null, anciennete_min: 4, anciennete_max: null, nb_mois_profil: 3,
    montants: [{ min: 0, max: 2, montant: 0 }], explication: "" }));
  $("#pp-reset").onclick = () => loadPayplan();
  $("#pp-save").onclick = savePayplan;

  $("#btn-refresh-admin-sims").onclick = loadSims;
  $("#btn-export-csv").onclick = () => exportCSV(allSims);
  $("#btn-clear-all-sims").onclick = clearAllSims;
  $("#sims-search").oninput = renderSims;

  await Promise.all([loadStats(), loadPayplan(), loadRef(), loadSims()]);
});

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch (e) {}
  location.href = "/login";
}
async function loadStats() {
  try {
    const j = await api("/api/stats");
    if (!j.ok) return;
    countUp($("#stat-employees"), j.data.employees || 0);
    countUp($("#stat-sims"), j.data.simulations || 0);
    $("#stat-db").textContent = j.data.db === "connected" ? "✅ Connectée" : "❌ Erreur";
    $("#stat-actif").textContent = j.data.actif_updated_at
      ? new Date(j.data.actif_updated_at).toLocaleString("fr-FR") : "Jamais";
  } catch (e) {}
}

/* ---------------- ACTIF ---------------- */
async function uploadActif(file) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) { toast("Format attendu : .xlsx", "error"); return; }
  $("#upload-status").textContent = "⏳ Chargement de " + file.name + "…";
  const fd = new FormData(); fd.append("file", file);
  try {
    const j = await api("/api/upload", { method: "POST", body: fd });
    if (j.ok) { toast(j.message, "success"); $("#upload-status").textContent = "✅ " + j.message; await loadStats(); }
    else { toast(j.error, "error"); $("#upload-status").textContent = "❌ " + j.error; }
  } catch (e) { $("#upload-status").textContent = "❌ Erreur réseau"; }
}

/* ---------------- Référentiel ---------------- */
async function loadRef() {
  try {
    const j = await api("/api/ref-msa");
    if (!j.ok) return;
    const tb = $("#ref-body"); tb.innerHTML = "";
    (j.data || []).forEach((r) => tb.appendChild(refRow(r.id, r.msa, r.libelle)));
    $("#ref-count").textContent = (j.data || []).length + " ligne(s)";
  } catch (e) { toast("Impossible de charger le référentiel.", "error"); }
}
function refRow(id, msa, lib) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="rf-id" placeholder="ex : W0ZRVV" value="${esc(id)}"/></td>
    <td><input class="rf-msa" placeholder="ex : WHFR2729" value="${esc(msa)}"/></td>
    <td><input class="rf-lib" placeholder="ex : DRM - FRAIS DE ROUTE" value="${esc(lib)}"/></td>
    <td><button class="btn btn-danger btn-sm">✕</button></td>`;
  tr.querySelector("button").onclick = () => tr.remove();
  return tr;
}
async function saveRef() {
  const rows = [...document.querySelectorAll("#ref-body tr")].map((tr) => ({
    id: tr.querySelector(".rf-id").value, msa: tr.querySelector(".rf-msa").value,
    libelle: tr.querySelector(".rf-lib").value }));
  const btn = $("#ref-save"); btn.disabled = true; btn.textContent = "⏳…";
  try {
    const j = await api("/api/ref-msa", { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
    if (j.ok) { toast("✅ " + j.message, "success"); await loadRef(); }
    else toast(j.error, "error");
  } catch (e) { toast("Erreur réseau.", "error"); }
  finally { btn.disabled = false; btn.textContent = "💾 Enregistrer"; }
}
async function resetRef() {
  if (!confirm("Remplacer le référentiel par les valeurs du fichier payplan_config.py ?")) return;
  try {
    const j = await api("/api/ref-msa/reset", { method: "POST" });
    if (j.ok) { toast("✅ " + j.message, "success"); await loadRef(); }
    else toast(j.error, "error");
  } catch (e) { toast("Erreur réseau.", "error"); }
}
async function uploadRef(file) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) { toast("Format attendu : .xlsx", "error"); return; }
  $("#ref-import-status").textContent = "⏳ Import de " + file.name + "…";
  const fd = new FormData(); fd.append("file", file);
  try {
    const j = await api("/api/ref-msa/upload", { method: "POST", body: fd });
    if (j.ok) { toast("✅ " + j.message, "success");
      $("#ref-import-status").textContent = "✅ " + j.message; await loadRef(); }
    else { toast(j.error, "error"); $("#ref-import-status").textContent = "❌ " + j.error; }
  } catch (e) { $("#ref-import-status").textContent = "❌ Erreur réseau"; }
}

/* ---------------- Payplan ---------------- */
async function loadPayplan() {
  try {
    const j = await api("/api/payplan");
    if (!j.ok) return;
    const pc = $("#pp-profiles"); pc.innerHTML = "";
    Object.entries(j.profils).forEach(([l, p]) => pc.appendChild(profilRow(l, p)));
    const rc = $("#pp-rules"); rc.innerHTML = "";
    j.regles.forEach((r) => rc.appendChild(ruleCard(r)));
    // Avertissement : règles dont le plus haut palier est à 0 (montants non configurés)
    const suspects = j.regles.filter((r) => {
      const m = (r.montants || []).slice().sort((a, b) => a.min - b.min);
      return m.length && m[m.length - 1].montant === 0;
    });
    const w = $("#pp-warning");
    w.hidden = suspects.length === 0;
    w.textContent = `⚠ ${suspects.length} règle(s) avec montants à 0 — importez votre matrice Excel ou saisissez les montants.`;
  } catch (e) { toast("Impossible de charger le payplan.", "error"); }
}
async function uploadPayplan(file) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) { toast("Format attendu : .xlsx", "error"); return; }
  if (!confirm("Remplacer le payplan actuel par le contenu de « " + file.name + " » ?")) return;
  $("#pp-import-status").textContent = "⏳ Import de " + file.name + "…";
  const fd = new FormData(); fd.append("file", file);
  try {
    const j = await api("/api/payplan/upload", { method: "POST", body: fd });
    if (j.ok) { toast("✅ " + j.message, "success");
      $("#pp-import-status").textContent = "✅ " + j.message; await loadPayplan(); }
    else { toast(j.error, "error"); $("#pp-import-status").textContent = "❌ " + j.error; }
  } catch (e) { $("#pp-import-status").textContent = "❌ Erreur réseau"; }
}
function profilRow(label, pts) {
  const div = document.createElement("div"); div.className = "pp-row";
  div.innerHTML = `
    <input class="pp-label" placeholder="Nom du profil (ex : Soutien Intense)" value="${esc(label)}"/>
    <input class="pp-pts" type="number" min="0" max="20" placeholder="vide" value="${pts ?? ""}"/> pt(s)
    <button class="btn btn-danger btn-sm">✕</button>`;
  div.querySelector("button").onclick = () => div.remove();
  return div;
}
function ruleCard(r) {
  const div = document.createElement("div"); div.className = "rule-card";
  const sites = Array.isArray(r.sites) ? r.sites.join(",") : (r.sites || "");
  const msa = Array.isArray(r.msa) ? r.msa.join(",") : (r.msa || "");
  const monts = (Array.isArray(r.montants) ? r.montants : [])
    .slice().sort((a, b) => (a.min || 0) - (b.min || 0));
  div.innerHTML = `
    <div class="rule-head">
      <span class="rule-idx" title="Priorité (plus petit = appliqué en premier, après les règles CPSA)">
        #<input class="r-index" type="number"/></span>
      <input class="r-nom" value="${esc(r.nom || "")}" placeholder="Nom de la règle"/>
      <button class="btn btn-danger btn-sm r-del">🗑</button>
    </div>
    <div class="rule-grid">
      <div class="field"><label>Sites (vide = tous)</label>
        <input class="r-sites" placeholder="ANTA, TMM" value="${esc(sites)}"/></div>
      <div class="field"><label>Codes MSA (vide = tous)</label>
        <input class="r-msa" placeholder="WHFR1135, WHFR919" value="${esc(msa)}"/></div>
      <div class="field"><label>Embauche avant le</label>
        <input class="r-avant" type="date" value="${esc(r.embauche_avant || "")}"/></div>
      <div class="field"><label>Embauche à partir du</label>
        <input class="r-apres" type="date" value="${esc(r.embauche_apres || "")}"/></div>
    </div>
    <div class="rule-grid">
      <div class="field"><label>Anc. min (mois)</label>
        <input class="r-amin" type="number" min="0" value="${r.anciennete_min ?? 0}"/></div>
      <div class="field"><label>Anc. max (vide = ∞)</label>
        <input class="r-amax" type="number" min="0" value="${r.anciennete_max ?? ""}"/></div>
      <div class="field"><label>Mois comptés</label>
        <select class="r-nb"><option value="1">1</option>
          <option value="2">2</option><option value="3">3</option></select></div>
      <div class="field"><label>Explication</label>
        <input class="r-exp" value="${esc(r.explication || "")}"/></div>
    </div>
    <label class="field-label">Barème (paliers) : de [min] à [max] points → montant (Ar)</label>
    <div class="montants"></div>
    <button class="btn btn-ghost btn-sm m-add">+ Palier</button>`;
  div.querySelector(".r-index").value = r.index ?? "";
  div.querySelector(".r-nb").value = String(r.nb_mois_profil || 3);
  const mcont = div.querySelector(".montants");
  const addM = (p) => {
    const row = document.createElement("div"); row.className = "m-row";
    row.innerHTML = `
      <input class="m-min" type="number" min="0" placeholder="de" value="${p?.min ?? ""}"/> à
      <input class="m-max" type="number" min="0" placeholder="à" value="${p?.max ?? ""}"/> pts →
      <input class="m-val" type="number" min="0" placeholder="Montant" value="${p?.montant ?? ""}"/> Ar
      <button class="btn btn-danger btn-sm">✕</button>`;
    row.querySelector("button").onclick = () => row.remove();
    mcont.appendChild(row);
  };
  monts.forEach((p) => addM(p));
  if (!monts.length) addM(null);
  div.querySelector(".m-add").onclick = () => addM(null);
  div.querySelector(".r-del").onclick = () => { if (confirm("Supprimer cette règle ?")) div.remove(); };
  return div;
}
async function savePayplan() {
  const profils = {};
  for (const row of document.querySelectorAll("#pp-profiles .pp-row")) {
    const l = row.querySelector(".pp-label").value.trim();
    const raw = row.querySelector(".pp-pts").value.trim();
    if (l) {
      if (profils[l] != null) { toast("Profil en double : " + l, "error"); return; }
      if (raw === "") { profils[l] = null; }
      else {
        const p = parseInt(raw);
        if (isNaN(p) || p < 0) { toast("Points invalides pour « " + l + " ».", "error"); return; }
        profils[l] = p;
      }
    }
  }
  if (!Object.keys(profils).length) { toast("Au moins un profil est requis.", "error"); return; }

  const regles = [];
  for (const div of document.querySelectorAll("#pp-rules .rule-card")) {
    const nom = div.querySelector(".r-nom").value.trim() || "Règle";
    const montants = [];
    for (const row of div.querySelectorAll(".m-row")) {
      const mn = parseInt(row.querySelector(".m-min").value);
      const mx = parseInt(row.querySelector(".m-max").value);
      const v = parseInt(row.querySelector(".m-val").value);
      if (!isNaN(mn) && !isNaN(mx) && !isNaN(v)) montants.push({ min: mn, max: mx, montant: v });
    }
    if (!montants.length) { toast("La règle « " + nom + " » n'a aucun palier.", "error"); return; }
    const amaxRaw = div.querySelector(".r-amax").value;
    regles.push({
      nom, sites: div.querySelector(".r-sites").value, msa: div.querySelector(".r-msa").value,
      embauche_avant: div.querySelector(".r-avant").value,
      embauche_apres: div.querySelector(".r-apres").value,
      index: parseInt(div.querySelector(".r-index").value) || undefined,
      anciennete_min: parseInt(div.querySelector(".r-amin").value) || 0,
      anciennete_max: amaxRaw === "" ? null : parseInt(amaxRaw),
      nb_mois_profil: parseInt(div.querySelector(".r-nb").value),
      montants, explication: div.querySelector(".r-exp").value });
  }
  if (!regles.length) { toast("Au moins une règle est requise.", "error"); return; }

  const btn = $("#pp-save"); btn.disabled = true; btn.textContent = "⏳ Enregistrement…";
  try {
    const j = await api("/api/payplan", { method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profils, regles }) });
    if (j.ok) { toast("✅ " + j.message, "success"); await loadPayplan(); }
    else toast(j.error, "error");
  } catch (e) { toast("Erreur réseau.", "error"); }
  finally { btn.disabled = false; btn.textContent = "💾 Enregistrer le payplan"; }
}

/* ---------------- Historique ---------------- */
async function loadSims() {
  try {
    const j = await api("/api/simulations?scope=all&limit=200");
    allSims = j.data || []; renderSims();
  } catch (e) {}
}
function renderSims() {
  const q = ($("#sims-search").value || "").toLowerCase();
  const rows = allSims.filter((r) => !q ||
    [r.matricule, r.nom, r.site].some((v) => String(v ?? "").toLowerCase().includes(q)));
  $("#admin-sims-body").innerHTML = rows.map((r) => {
    const acts = r.activites ? r.activites.map((a) => a.activity_id || a.msa).join(", ")
                             : (r.profiles || []).join(" / ");
    const pts = r.activites ? r.activites.map((a) => a.total_points).join("/") : r.total_points;
    return `<tr>
      <td>${new Date(r.created_at).toLocaleString("fr-FR")}</td>
      <td>${esc(r.matricule || "—")}</td><td>${esc(r.nom || "—")}</td>
      <td>${esc(r.site || "")}</td>
      <td>${esc(acts || "—")}<br/><span class="muted small">${pts ?? ""} pts</span></td>
      <td>${r.montant_prime != null ? fmt.format(r.montant_prime) + " Ar" : "—"}</td>
      <td>${r.eligible ? '<span class="badge ok">Éligible</span>' : '<span class="badge">Non</span>'}</td>
      <td>${r.id ? `<button class="btn btn-danger btn-sm" title="Supprimer"
          onclick="deleteSimAdmin('${r.id}')">🗑</button>` : ""}</td></tr>`;  }).join("") || `<tr><td colspan="7" class="muted center">Aucune simulation.</td></tr>`;
  $("#sims-count").textContent = rows.length + " ligne(s)";
}
function exportCSV(rows) {
  if (!rows.length) { toast("Rien à exporter.", "error"); return; }
  const head = ["Date", "Matricule", "Nom", "Site", "Anciennete (mois)",
                "Activites (ID)", "Points", "Eligible", "Montant (Ar)"];
  const lines = rows.map((r) => {
    const acts = r.activites ? r.activites.map((a) => a.activity_id || a.msa).join(", ")
                             : (r.profiles || []).join("/");
    const pts = r.activites ? r.activites.map((a) => a.total_points).join("/") : r.total_points;
    return [new Date(r.created_at).toLocaleString("fr-FR"), r.matricule || "", r.nom || "",
      r.site || "", r.anciennete_mois ?? "", acts, pts,
      r.eligible ? "Oui" : "Non", r.montant_prime ?? ""];
  });
  const csv = [head, ...lines]
    .map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = "simulations.csv"; a.click();
  toast("Export CSV téléchargé.", "success");
}
async function deleteSimAdmin(id) {
  if (!confirm("Supprimer cette simulation ?")) return;
  try {
    const j = await api("/api/simulations/" + id, { method: "DELETE" });
    if (j.ok) { toast(j.message, "success"); await loadSims(); }
    else toast(j.error, "error");
  } catch (e) {}
}
async function clearAllSims() {
  if (!confirm("Vider TOUT l'historique des simulations (toutes sessions) ? Action irréversible.")) return;
  try {
    const j = await api("/api/simulations/all", { method: "DELETE" });
    if (j.ok) { toast(j.message, "success"); await loadSims(); }
    else toast(j.error, "error");
  } catch (e) {}
}

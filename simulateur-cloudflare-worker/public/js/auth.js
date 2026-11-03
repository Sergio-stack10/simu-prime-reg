/* SimuPrime — page de connexion */
const $ = (s) => document.querySelector(s);
let selectedRole = "user";

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".role-card").forEach((c) =>
    c.onclick = () => selectRole(c.dataset.role));
  $("#btn-login").onclick = doLogin;
  document.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
});

function selectRole(r) {
  selectedRole = r;
  document.querySelectorAll(".role-card").forEach((c) =>
    c.classList.toggle("selected", c.dataset.role === r));
  $("#pwd-field").classList.toggle("hidden", r !== "admin");
  if (r === "admin") setTimeout(() => $("#admin-password").focus(), 150);
  $("#login-error").classList.add("hidden");
}

async function doLogin() {
  const btn = $("#btn-login"), err = $("#login-error");
  err.classList.add("hidden");
  const body = { role: selectedRole };
  if (selectedRole === "admin") body.password = $("#admin-password").value;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner dark"></span> Connexion…';
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) });
    const j = await res.json();
    if (j.ok) { location.href = j.redirect; return; }
    err.textContent = j.error || "Échec de la connexion.";
    err.classList.remove("hidden");
    const card = $("#login-card");
    card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
  } catch (e) {
    err.textContent = "Erreur réseau."; err.classList.remove("hidden");
  } finally { btn.disabled = false; btn.textContent = "Se connecter"; }
}

# SimuPrime — Version Cloudflare Workers 🦄

Portage **100 % fidèle** de SimuPrime v17 (Flask/Render) vers **Cloudflare Workers**.

- **Même base MongoDB Atlas** que Render → les employés, le payplan, le référentiel
  et l'historique sont **déjà là**, rien à migrer.
- **Gratuit** : plan Workers Free (100 000 requêtes/jour — largement suffisant pour l'équipe).
- **Pas de démarrage à froid** : réponse instantanée, contrairement à Render.
- **Aucun droit administrateur requis** : tout se fait dans le navigateur
  (GitHub + tableau de bord Cloudflare).

---

## 🚀 Déploiement en 4 étapes (≈ 15 minutes, sans rien installer)

### Étape 1 — Créer le dépôt GitHub (5 min)

1. Va sur **https://github.com/new** (connecte-toi si besoin).
2. Nom du dépôt : `simulateur-cloudflare` · Visibilité : **Private** → **Create repository**.
3. Sur la page du dépôt vide, clique sur **« uploading an existing file »** (lien au-dessus
   de la zone d'édition).
4. Décompresse le ZIP fourni sur ton PC, puis **glisse-dépose TOUS les fichiers et
   dossiers** décompressés dans la page GitHub :

```
simulateur-cloudflare/
├── wrangler.jsonc        ← config Cloudflare
├── package.json
├── package-lock.json
├── .gitignore
├── LISEZMOI-DEPLOIEMENT.md   (ce fichier)
├── public/               ← css, js, img (servis par le CDN Cloudflare)
└── src/                  ← le code du Worker (portage de app.py)
```

5. **Commit changes** (bouton vert en bas).

> ⚠️ Le fichier `.dev.vars` (s'il apparaît) ne doit **pas** être envoyé — il est déjà
> dans le `.gitignore`. Il ne sert qu'aux tests locaux.

### Étape 2 — Connecter Cloudflare (5 min)

1. Crée un compte gratuit : **https://dash.cloudflare.com/sign-up**.
2. Dans le menu de gauche : **Compute (Workers) → Create** → onglet
   **« Import a repository »** → **Connect Git** → autorise GitHub → choisis le dépôt
   `simulateur-cloudflare`.
3. **Nom du Worker** : `simulateur-prime` (c'est ce nom qui apparaît dans l'URL).
4. **Deploy command** : laisse la valeur par défaut `npx wrangler deploy`.
5. Clique **Save and Deploy** → attends 1-2 minutes (Cloudflare installe les dépendances
   et déploie).

### Étape 3 — Ajouter les secrets (2 min)

Les 3 variables d'environnement de Render, **mêmes valeurs** :

1. Page du Worker → **Settings → Variables and Secrets → Add** (type **Secret**).
2. Ajoute :

| Nom | Valeur |
|---|---|
| `MONGODB_URI` | ta connexion MongoDB Atlas (celle de Render — `mongodb+srv://...`) |
| `ADMIN_PASSWORD` | le mot de passe admin actuel |
| `SECRET_KEY` | n'importe quelle longue chaîne aléatoire (ex. 32 caractères) |

3. Après ajout, **redéploie** : onglet **Deployments → ... → Redeploy** (les secrets ne
   s'appliquent qu'au prochain déploiement).

### Étape 4 — Vérifier (1 min)

1. Ouvre l'URL du Worker : **`https://simulateur-prime.<ton-sous-domaine>.workers.dev`**
2. Teste `https://.../api/health` → doit afficher `{"ok":true,"db":"connected"}`.
3. Connecte-toi en **Utilisateur** → la liste ACTIF se charge (elle vient d'Atlas).
4. Connecte-toi en **Admin** → payplan, référentiel et stats identiques à Render.

**C'est en ligne ! Partage l'URL `workers.dev` à l'équipe.** 🎉

---

## 🔄 Mises à jour (même habitude que Render)

`git push` vers GitHub (ou édition de fichier sur github.com) → **redéploiement
automatique** par Cloudflare Workers Builds. Aucune action supplémentaire.

---

## 🗂️ Ce qui a été porté (vérifié automatiquement)

Le portage a été validé par des tests automatiques d'**équivalence byte-à-byte** entre
le code Python original et le Worker JS, sur :

- parsing de ta **vraie matrice Excel** (45 lignes → 9 règles, montants identiques) ;
- la logique v17 complète : points par mois M1/M2/M3, historique Challenger 3→2
  (01/09/2026), dégradation sur points courants, nouveaux intégrés 4-6 mois,
  prorata base d'heures, priorité des règles MSA puis index ;
- les **arrondis** (y compris l'arrondi « banquier » de Python : 22,5 → 22) ;
- les 12 formats de dates acceptés/refusés par pandas (y compris les cas ambigus
  comme `05/06/2023`) ;
- les 3 imports Excel (ACTIF, matrice payplan, référentiel MSA) et la génération du
  modèle Excel ;
- les messages d'erreur exacts de validation.

Différences assumées (sans impact) :

- les sessions Flask sont remplacées par un cookie signé HMAC (même comportement :
  rôle + identifiant de session, durée 30 jours) ;
- `MongoClient` : une connexion par requête (pattern recommandé par la documentation
  Cloudflare × MongoDB) — ajoute ~200-300 ms par requête qui touche la base, imperceptible
  à l'usage ;
- en janvier (mois de perf), M1 et M2 pointent tous deux sur décembre — c'est le
  comportement **historique identique** de la version Render (aucun impact avec la
  date d'effet actuelle).

## 🧰 Développement local (optionnel, pour VS Code)

```bash
npm install
npx wrangler dev        # http://localhost:8787 — nécessite Node.js
```

Crée un fichier `.dev.vars` (déjà ignoré par git) :

```
MONGODB_URI=mongodb+srv://...
ADMIN_PASSWORD=...
SECRET_KEY=...
```

---

## ❓ Dépannage

| Problème | Solution |
|---|---|
| `{"db":"error"}` sur /api/health | Vérifie `MONGODB_URI` (Secret) + Atlas **Network Access = 0.0.0.0/0**, puis **Redeploy** |
| « Mot de passe admin non configuré » | Le secret `ADMIN_PASSWORD` n'est pas défini, ou pas de redéploiement après ajout |
| Le build échoue sur Cloudflare | Vérifie que `wrangler.jsonc`, `package.json` et `package-lock.json` sont bien à la racine du dépôt |
| URL déjà prise | Change le nom du Worker (`simulateur-prime-2`…) : Settings → Domains & Routes |
| Données différentes de Render | Impossible si même `MONGODB_URI` — vérifie que l'URI pointe bien sur le même cluster |

## 💡 Aller plus loin (optionnel)

- **Nom de domaine perso** (~10 €/an) : Settings → Domains & Routes → Custom domain.
- **Cloudflare Access** (gratuit ≤ 50 utilisateurs) : ajoute une porte email avant la
  page de connexion — demande-moi le guide si tu le veux.

---

*SimuPrime — portage Cloudflare Workers — Developed by TEAM TMM 🦄*

# Elite Barber — démo

Site vitrine (démo) du salon **Elite Barber**, 5 rue Saint-Éloi, 68000 Colmar.
Page unique, statique, sans back-end : elle peut être servie telle quelle par GitHub Pages.

> ⚠️ **Démo, pas le site officiel.** Les tarifs, horaires et mentions légales
> affichés restent à confirmer par le salon.

---

## Contenu du dépôt

| Fichier | Rôle |
| --- | --- |
| `index.html` | La page du site (renommée depuis `Elite Barber.dc.html`, contenu inchangé) |
| `support.js` | Moteur de rendu (runtime Claude Design) — **indispensable** |
| `image-slot.js` | Composant des photos de la galerie — **indispensable** |
| `barber-scene.js` | Scène 3D d'arrière-plan (three.js) |
| `vendor/three.module.min.js` | three.js servi depuis le dépôt (pas de CDN) |
| `assets/` | Photos, polices, logos, image de partage |
| `.nojekyll` | Désactive Jekyll — **ne pas supprimer** (voir plus bas) |
| `elite-barber-v1.html` | Ancienne version de la page (archive, non liée au site) |
| `one-snack/` | **Autre démo :** borne de commande du food truck ONE SNACK (Colmar) — dossier autonome, voir `one-snack/README.md` |
| `logo.html` | Planche du logo (archive, non liée au site) |

Tous les chemins sont **relatifs** : le site fonctionne aussi bien à la racine
d'un domaine (`https://exemple.fr/`) que dans un sous-dossier
(`https://anasdine.github.io/elite-coiffeur/`).

---

## Publier sur GitHub Pages

1. **Fusionner la branche** `claude/elegant-euler-2l36k0` dans `main`
   (ou publier directement depuis cette branche à l'étape 2).
2. Dans le dépôt GitHub : **Settings → Pages**.
3. **Source** : `Deploy from a branch`.
4. **Branch** : `main` (ou `claude/elegant-euler-2l36k0`) — **dossier** : `/ (root)`.
5. **Save**. Le déploiement prend 1 à 2 minutes.
6. Le site est en ligne sur :
   **`https://anasdine.github.io/elite-coiffeur/`**

### Pourquoi `.nojekyll` est obligatoire

GitHub Pages fait passer les fichiers par Jekyll par défaut. La page contient des
expressions `{{ ... }}` (le gabarit du runtime). Le fichier vide `.nojekyll`
coupe Jekyll et garantit que tout est servi tel quel. **S'il est supprimé, la
page risque de s'afficher cassée.**

### Plus tard : nom de domaine

La page se déclare déjà canonique sur `https://elitebarber-colmar.fr/`.
Le jour où ce domaine existe :

1. Ajouter un fichier `CNAME` à la racine contenant `elitebarber-colmar.fr`.
2. Chez le registrar, pointer le domaine vers GitHub Pages
   (4 enregistrements `A` vers `185.199.108-111.153`, et un `CNAME` `www` vers
   `anasdine.github.io`).
3. Cocher **Enforce HTTPS** dans Settings → Pages.

Tant que le domaine n'existe pas, la balise `canonical` et l'`og:image`
pointent dans le vide : c'est sans effet visuel sur la démo, mais l'aperçu
au partage (WhatsApp, Facebook…) restera sans vignette et la démo ne sera pas
indexée par Google. C'est plutôt souhaitable pour une démo.

---

## Points connus (aucun n'empêche la publication)

* **La page a besoin de JavaScript et d'un accès à `unpkg.com`.** React est
  chargé depuis ce CDN au démarrage. Si le visiteur bloque JS ou n'atteint pas
  `unpkg.com`, la page reste **entièrement noire** — il n'y a pas de repli.
* Le bouton flottant « Réserver » reste en français dans les 6 autres langues.
* Les fenêtres « Mentions légales » et « Confidentialité » sont en français
  uniquement.
* Deux requêtes 404 sans conséquence apparaissent dans la console
  (`{{ ph.src }}` et `.image-slots.state.json`).
* Les 4 photos de la galerie (~1,1 Mo) se chargent toutes au démarrage.

---

## Aperçu en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/
```

# ONE SNACK — borne de commande

Borne / site de commande en ligne pour le food truck **ONE SNACK**,
8a rue Denis Papin, ZI — 68000 Colmar.

Une seule page, sans serveur ni base de données : elle s'ouvre directement
dans un navigateur, sur un écran tactile de borne, sur un ordinateur ou sur
un téléphone. Elle peut être publiée telle quelle par GitHub Pages.

> ⚠️ **Démo.** Aucun paiement réel n'est encaissé, aucune commande n'est
> envoyée au camion. Les prix, horaires et compositions restent à confirmer.

---

## Ce qu'il y a dedans

| Fichier | Rôle |
| --- | --- |
| `index.html` | Toute la borne : design, carte, panier, assistant, vue cuisine |
| `polices/` | Les 4 polices (Anton, Barlow, Barlow Condensed, Caveat Brush) servies depuis le dépôt |

Aucune dépendance externe : pas de framework, pas de CDN, pas de Google Fonts
à distance. Seules les photos sont chargées depuis internet (voir plus bas).

## Les écrans

1. **Accueil** — logo, horaires en direct (ouvert / fermé), trois entrées :
   commander à emporter, l'assistant, livraison.
2. **La carte** — 5 familles (box, smash, baguettes, à côté, boissons),
   étiquette de prix « seul / en menu » comme sur les affiches, ajout en un
   geste avec le bouton **+**.
3. **La fiche produit** — seul ou en menu, accompagnement, boisson, sauces
   (2 offertes puis 0,50 €), suppléments. Le prix se met à jour en direct.
4. **L'assistant** — 3 questions (faim, envie, nombre de personnes) et il
   compose une commande complète, chiffrée, à ajouter en un bouton. Il répond
   aussi aux questions courantes (livraison, délai, adresse, sans porc…).
5. **La commande** — créneau de retrait à la minute près, coordonnées,
   paiement, récapitulatif.
6. **La confirmation** — numéro de commande, ticket, suivi.
7. **La vue cuisine** — ce que voit l'équipe dans le camion : les tickets,
   avec « en préparation » et « prête ».

Le panier est gardé en mémoire dans le navigateur : si on ferme la page en
cours de route, la commande est toujours là au retour.

---

## Modifier la carte

Tout est regroupé en haut du `<script>`, dans `index.html` :

- `RESTO` — adresse, horaires, temps de préparation, frais et minimum de
  livraison.
- `CATEGORIES` — les familles affichées dans le menu de gauche.
- `MENU` — les produits. Pour chacun : `prix` (à l'unité) et `prixMenu`
  (formule frites + boisson, `null` s'il n'y a pas de menu).
- `GROUPES` — accompagnements, boissons, sauces, suppléments.
- `QUESTIONS`, `FAQ` et `composer()` — le cerveau de l'assistant. La fonction
  `composer()` tient en 30 lignes et se lit comme une recette : c'est là qu'on
  change ce qu'il propose.

Exemple — changer le prix du Triple Smash :

```js
{id:"smash-3", cat:"smash", nom:"Le Triple Smash", prix:8, prixMenu:11, ...}
```

## Mettre les vraies photos

Les visuels des produits sont **dessinés à la main en SVG**, dans les couleurs
des affiches : ils s'affichent toujours, même sans connexion.

Par-dessus, la constante `PHOTOS` ajoute de vraies photos (fond de l'accueil,
bandeaux des familles, Box du Peuple). Si une photo ne charge pas, le dessin
reprend la main tout seul — la borne n'est jamais cassée.

```js
const PHOTOS = {
  camion  :"...",   // fond de l'accueil
  box     :"...",   // la Box du Peuple
  smash   :"...",   // bandeau des smash burgers
  baguette:"..."    // bandeau des baguettes
};
```

Les photos actuelles sont des images d'illustration hébergées à l'extérieur.
**À remplacer par les photos du camion** : déposez vos fichiers dans un dossier
`photos/` à côté de `index.html`, puis écrivez `"photos/box.jpg"`. Pour donner
une photo à un produit précis, ajoutez-lui `photo:"box"` dans `MENU`.

## Publier

Le dossier est autonome et tous les chemins sont relatifs. Sur GitHub Pages,
la borne est en ligne à l'adresse `…/one-snack/`.

Pour une vraie borne : ouvrir la page en plein écran (F11), écran tactile en
portrait ou paysage, la mise en page s'adapte des deux côtés.

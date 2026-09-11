PIZZA LABYRINTHE — MVP V2
==========================

CONTENU
-------
index.html
assets/
  app.js
  style.css
data/
  pizzas.json
  concepts.json
  pictograms.json
_private/
  pizza-map.json
.gitignore
README.txt

LANCEMENT LOCAL
---------------
Depuis ce dossier :

  python -m http.server 8080

Puis ouvrir :

  http://localhost:8080

IMPORTANT
---------
Ne pas ouvrir index.html directement en file:// :
le navigateur peut bloquer le chargement des fichiers JSON.

PUBLICATION GITHUB PAGES
------------------------
1. Créer un dépôt GitHub.
2. Copier le contenu de CE DOSSIER à la racine du dépôt.
3. git add .
4. git commit -m "Pizza game MVP"
5. git push
6. GitHub > Settings > Pages
7. Source : Deploy from a branch
8. Branche : main / root

Le dossier _private/ est ignoré par .gitignore.
Il contient la correspondance numéro -> vrai nom de pizza.
Il ne doit donc pas partir sur GitHub.

SANITY CHECK
------------
Le début de index.html doit être :

  <!doctype html>
  <html lang="fr">

Le contenu de .gitignore doit être :

  _private/
  .DS_Store

Si index.html affiche "_private/" ou ".DS_Store", ce n'est pas le bon fichier.


V3 — ALIGNEMENT DU MOTEUR
-------------------------
- Ajout du concept "Jambon" pour rétablir la couverture de la pizza #24.
- L'étape "envie du moment" utilise maintenant un vocabulaire cohérent avec le mood choisi.
  Le choix reste dynamique/statistique à l'intérieur de ce vocabulaire.
- Le tie-break propose "Rien de tout ça" : les pizzas qui ne correspondent à aucun
  picto proposé reçoivent alors le bonus de départage.
- Les pondérations restent inchangées :
    mood +2
    envie +4
    signature +3
    veto = exclusion
    tie-break +5

TEST DE COUVERTURE
------------------
Un script de QA privé est inclus :

  node _private/reachability-check.mjs

Il explore les branches générées par le moteur et vérifie que les 30 pizzas
peuvent apparaître dans une finale de 1 à 3 pizzas.


V4 — VISUALISATION DES SCORES + CORRECTION D'UN BIAIS
------------------------------------------------------
- Les cercles ne sont plus colorés selon le "top pool".
- Leur remplissage représente maintenant le score réel de chaque pizza rapporté
  au maximum théorique atteignable à ce stade du questionnaire.
- Avant toute réponse : 0 remplissage pour les 30 pizzas.
- Une pizza éliminée par veto devient grisée.
- Les finalistes ont un contour spécifique.
- Le score exact est disponible au survol (ex. 6/10 pts).

Correction importante :
- Le top pool interne ne départage plus arbitrairement les égalités par numéro.
  Si plusieurs pizzas sont ex aequo au seuil, elles restent toutes dans le pool.
  Cela supprime notamment le biais "1 à 12" lorsque tous les scores sont à zéro.


V4.1 — CORRECTION DU CERCLE GÉANT
---------------------------------
Le nom de classe CSS `winner` était utilisé à la fois :
- pour le grand conteneur du résultat final ;
- pour le petit cercle de la pizza choisie.

Le cercle héritait donc des dimensions/layout du conteneur final.

Correction :
- état du petit cercle renommé `.chosen`
- le conteneur final conserve `.winner`


V5 — FINALE ENRICHIE
--------------------
Ajouts purement UX / présentation :
- Affinité (%) sur chaque finaliste, calculée à partir du score courant / score max théorique.
- Profil pizza généré à partir du parcours.
- Résumé complet des choix sur l'écran final.
- Bouton "Laisser le destin choisir" lorsqu'il reste 2 ou 3 finalistes.
  Le hasard ne choisit QUE parmi les finalistes déjà sélectionnées par le moteur.
- Réglage de la sélection finale :
    closeScoreDelta = 4
    strongLeadDelta = 5

Le moteur de scoring principal reste inchangé :
- mood +2 / +3
- envie +4
- signature +3
- veto = exclusion
- tie-break +5


V6 — CONCLUSION DU FAUX SERVICE DE LIVRAISON
--------------------------------------------
Ajouts sur l'écran final :
- Bloc "Commande validée".
- Instruction : communiquer le numéro choisi au livreur.
- Module local de satisfaction de 1 à 5 étoiles.
- Message humoristique personnalisé pour chaque note.
- Aucun enregistrement ni backend : la note reste purement locale.


V6.1 — CLIN D'ŒIL FINAL
-----------------------
Ajout de la phrase de clôture :
- "Les noisettes sont offertes."
- "Et n'oubliez pas votre pull."

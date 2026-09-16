# Visibilité de MotMan — état au 17/09/2026

Document de passation pour le clavardage « étude de marché ». Il décrit **ce qui
est en place, ce qui est en attente, et ce qu'on ne sait pas encore mesurer**.

Ce qui est marqué *vérifié* a été constaté dans le dépôt ou en ligne. Ce qui est
marqué *rapporté* vient du propriétaire — je n'ai accès ni à la Search Console
ni à la Play Console.

---

## 1. Référencement web — fait le 15/09/2026

**Le problème de départ.** MotMan est une application React derrière un contrôle
anti-robot (Turnstile) : un moteur de recherche qui demandait la page ne voyait
aucun texte. Le jeu était donc introuvable sur Google, y compris sur son propre
nom.

**La parade, livrée le 15/09** (commit « Referencement Google : titre,
description, apercu de lien, page de presentation et plan du site ») :

| Élément | Où | Rôle |
|---|---|---|
| Titre, description, canonical, Open Graph, JSON-LD `VideoGame` | `index.html` | Ce que Google et les réseaux affichent |
| Page de présentation autonome | `public/mots-fleches-en-duel/index.html` | **Lisible sans JavaScript** : c'est elle qui porte le texte indexable |
| Plan du site | `public/sitemap.xml` | 2 URL : `/motman/` et `/motman/mots-fleches-en-duel/` |
| Image d'aperçu 1200×630 | `scripts/build_social_image.mjs` | Vignette des liens partagés |
| Contrôles automatiques | `scripts/check_pages_artifact.mjs` | Vérifie à chaque build que canonical, description, image et liens du sitemap existent |

*Vérifié* : les fichiers sont en production, le sitemap contient bien ces deux
adresses, et le contrôle tourne dans la chaîne de livraison.

**Search Console** (*rapporté*) : propriété vérifiée, sitemap soumis,
indexation demandée pour les deux URL le 16/09. Au moment de la demande, Google
répondait encore « Cette URL n'a pas été indexée ». **À recontrôler vers le
23/09** : pages indexées, état du sitemap, et position sur « MotMan mots
fléchés ».

**Ce que ça peut rapporter, honnêtement** : le référencement web amène surtout
des recherches de marque (quelqu'un à qui on a parlé du jeu et qui le cherche).
Pour « mots fléchés » tout court, la concurrence est hors d'atteinte d'un site
d'une page.

---

## 2. Google Play — en cours

*Rapporté, sauf mention contraire.*

- **Accès production accordé le 16/09** (les 12 testeurs × 14 jours ont été
  réunis par le propriétaire lui-même).
- **Test ouvert** choisi comme dernière étape, avec la version **1.0.9**.
- **Pays** : France, Belgique, Suisse, Luxembourg, Monaco.
- La piste avait été suspendue ; « Reprendre le test » a été fait le 17/09.
- Captures d'écran produites pour téléphone et tablettes 7″ et 10″.
- **Production visée : dimanche 20/09.**
- *Vérifié le 16/09* : `play.google.com/store/apps/details?id=com.motman.game`
  répondait « Introuvable » — cohérent avec une piste de test sans release en
  production.

**Point à retenir pour l'étude de marché** : Google **ne fournit aucun vivier de
testeurs ni de joueurs**. Les pistes de test ne distribuent l'application qu'aux
personnes qu'on recrute soi-même. Tant que rien n'est en production, l'app
n'apparaît dans aucune recherche du Play Store. **La mise en production est donc
le premier vrai canal d'acquisition du projet.**

---

## 3. Partage — le seul mécanisme viral en place

- **« Partager mon résultat »** sur le défi du jour : depuis le 16/09, c'est
  l'action principale de la carte une fois le défi joué (avant, c'était un petit
  bouton de coin). Le texte partagé est produit par `dailyShare.ts`.
- **Code ami** partageable depuis l'accueil, mis en avant quand la liste d'amis
  est vide.

*Vérifié* : les deux sont en production.

Il n'y a **aucun autre mécanisme d'acquisition** : pas de parrainage, pas de
notification de rappel vers des non-joueurs, pas d'acquisition payante (décision
du propriétaire, voir la note « Plan de revenus » du 14/09).

---

## 4. Mesure — le trou actuel

**Il n'existe aujourd'hui aucune mesure du trafic web.** *Vérifié* : aucun script
d'analyse dans `index.html` ni dans la page de présentation.

Ce qui existe déjà sans le savoir : le domaine est passé sur **Cloudflare** le
15/09, avec `www` en proxy. Le tableau de bord Cloudflare compte donc les
requêtes **depuis cette date, rétroactivement** (Analytics & Logs).

**Recommandation faite au propriétaire le 17/09** : activer **Cloudflare Web
Analytics** — gratuit, sans cookie, sans bandeau de consentement, activable sans
toucher au code. Il donne les visites, les pages vues et **les sources de
trafic**, ce que les statistiques de requêtes ne disent pas. *Action en attente
du propriétaire* (l'activation se fait dans son tableau de bord).

Google Analytics a été écarté : cookies, bandeau obligatoire, données hors UE.

---

## 5. Ce qu'on sait, ce qu'on ne sait pas

| Question | Réponse aujourd'hui |
|---|---|
| Combien de joueurs actifs ? | **7 par jour** (relevé du 14/09, base Supabase) |
| Combien de visiteurs sur le site ? | **Inconnu** — mesure non activée ; données Cloudflare brutes disponibles depuis le 15/09 |
| D'où viennent-ils ? | **Inconnu** — c'est ce que Web Analytics répondra |
| Combien d'installations Android ? | **Aucune en production** ; seulement les testeurs recrutés à la main |
| Le jeu est-il indexé par Google ? | **Pas encore confirmé** ; à revérifier vers le 23/09 |

---

## 6. Ce que cela change pour l'étude de marché

1. **Le grand public n'est pas encore atteignable.** Avant le 20/09, MotMan n'a
   aucun canal d'acquisition ouvert : ni Play Store en production, ni
   référencement établi, ni budget publicitaire. Les 7 joueurs par jour sont
   l'entourage du propriétaire.
2. **La production Play Store est le seul jalon qui peut changer l'échelle** à
   court terme. Tout chiffre d'acquisition antérieur n'est pas représentatif.
3. **Les pistes B2B ne dépendent pas de tout cela.** Résidences seniors,
   jeunesse et orthophonie (voir « Étude de marché des grilles », 14/09) se
   vendent par contact direct, pas par visibilité grand public. Elles restent
   jouables indépendamment du calendrier Play Store.
4. **Rien ne pourra être conclu des chiffres avant d'avoir activé la mesure.**
   C'est la première dépense de temps à faire, elle coûte deux minutes.

---

## 7. Prochaines échéances

| Quand | Quoi | Qui |
|---|---|---|
| Dès que possible | Activer Cloudflare Web Analytics | Propriétaire |
| Dimanche 20/09 | Passage en production sur Google Play | Propriétaire |
| ≈ 23/09 | Contrôle Search Console (pages indexées, sitemap, position sur « MotMan mots fléchés ») | À faire ensemble |
| Après la production | Premier relevé : visites, sources, installations, joueurs actifs | À faire ensemble |

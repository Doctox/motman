# Publier MotMan sur Google Play — version 1.1.0

Version de production : **1.1.0, `versionCode 11`**, publiée le 20/09/2026 en
France, Belgique, Suisse, Luxembourg et Monaco. Le plus petit APK encore servi
en ligne est la **1.0.8 (`versionCode 9`)**.

Les corrections du site (JS, CSS, images) n'ont pas besoin de ce document :
elles arrivent sur les téléphones par les mises à jour embarquées
(`docs/MOBILE.md`). Un nouvel AAB, et donc un nouveau numéro, n'est nécessaire
que si le **natif** change : module Capacitor, permission, manifeste Android,
`capacitor.config.json`.

## Les numéros

Trois sources doivent dire la même chose, sinon `npm run check:version` (lancé
avant chaque build) arrête tout :

- `package.json` → `version` ;
- `android/app/build.gradle` → `versionCode` et `versionName` ;
- `src/clientVersion.ts` → `ANDROID_VERSION_CODE` et `ANDROID_VERSION_NAME`.

Après `x.y.9` vient `x.(y+1).0`, jamais `x.y.10`. Le `versionCode` monte de 1 à
chaque AAB envoyé, sans exception : Google refuse un code déjà utilisé.

## Construire l'AAB

**Seulement depuis un commit déjà poussé sur `main` dont le run `deploy-pages`
a réussi** (et `verify-android` aussi), dans une copie de travail propre :
`git status --short` ne doit rien afficher. `mobile:aab` construit ce qui est
sur le disque, pas le commit : un fichier modifié ou non suivi partirait dans
l'AAB sans être passé par aucun test.

Prérequis sur la machine :

- `android/app/google-services.json` (Crashlytics et notifications) — hors Git ;
  sans lui, le script refuse de construire ;
- `.env.local` avec `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` et
  `VITE_TURNSTILE_SITE_KEY` de production ;
- le JDK 21 d'Android Studio (détecté automatiquement) et le SDK Android 36.

```powershell
git status --short          # doit être vide
git log -1 --oneline        # le commit dont deploy-pages a réussi

# Facultatif mais recommandé : le numéro du run deploy-pages de CE commit
# (le « #N » de GitHub Actions, ou `gh run list --workflow deploy-pages.yml`).
$env:GITHUB_RUN_NUMBER = '<N>'

npm run mobile:aab -- -InteractiveSigning
```

`-InteractiveSigning` demande les deux mots de passe dans la fenêtre et prend
par défaut la clé d'upload et l'alias `motman-upload` connus du script. Autre
possibilité : poser les quatre variables avant `npm run mobile:aab` —
`MOTMAN_KEYSTORE_PATH`, `MOTMAN_KEYSTORE_PASSWORD`, `MOTMAN_KEY_ALIAS`,
`MOTMAN_KEY_PASSWORD`. Ne jamais les écrire dans un fichier du dépôt.

Le script régénère les icônes, construit le site (`npm run build`, qui finit par
`audit:security` : un site qui contiendrait des grilles privées est refusé),
synchronise Capacitor, lance `gradlew :app:bundleRelease` et vérifie la
signature. Résultat : `android/app/build/outputs/bundle/release/app-release.aab`.

**Pourquoi `GITHUB_RUN_NUMBER`.** Le site embarqué porte un numéro de
construction ; construit sur la machine, il vaut « local », que l'application
compte comme 0. Or l'installation d'un nouvel APK repart toujours du site
embarqué (`resetWhenUpdate`) : au premier lancement, la 1.1.0 téléchargerait
alors la mise à jour embarquée `#N` — environ 15 Mo — pour obtenir exactement le
code qu'elle contient déjà. Avec le numéro du run, elle se sait à jour. Ne poser
QUE cette variable : `GITHUB_REPOSITORY` ferait construire le site pour
`/motman/`, et l'APK ne trouverait plus ses fichiers.

**Après la construction**, dans la même fenêtre :

```powershell
npm run audit:play     # doit finir sur « 0 blocage(s) »
New-Item -ItemType Directory -Force "$HOME\MotMan-versions" | Out-Null
Copy-Item android\app\build\outputs\bundle\release\app-release.aab "$HOME\MotMan-versions\MotMan-1.1.0-code11.aab"
Get-FileHash "$HOME\MotMan-versions\MotMan-1.1.0-code11.aab" -Algorithm SHA256
```

`audit:play` contrôle la configuration Android, Firebase, les pages légales et
la signature de l'AAB le plus récent : il se lance APRÈS la construction. La
copie archivée (hors du dépôt : les `.aab` y sont ignorés) est celle qu'on
envoie ; `app-release.aab` sera écrasé au prochain build. Noter son empreinte.

Pour un diagnostic local seulement, `-AllowUnsigned` et `-AllowWithoutFirebase`
lèvent les deux refus. Un tel AAB ne doit jamais partir sur Google Play.

La clé d'upload signe l'envoi ; Google re-signe l'application (Play App
Signing). Perdre la clé d'upload se répare auprès de Google, la divulguer non :
elle reste hors du dépôt, comme ses mots de passe.

## Tester avant la production

Installer l'AAB archivé depuis la piste de test interne, puis sur un téléphone :

1. premier lancement : en bas des paramètres, « Application à jour » (si
   `GITHUB_RUN_NUMBER` était posé) et le numéro `#N` attendu ;
2. compte invité, connexion Google, protection par e-mail ;
3. partie normale, classée, entre amis sur deux téléphones, défi du jour ;
4. notifications de tour et d'invitation ;
5. coupure réseau puis reconnexion ;
6. suppression du compte depuis Menu (roue crantée) → « Compte connecté » →
   Supprimer mon compte, avec un compte de test.

## Publier, puis basculer le serveur

1. Envoyer `MotMan-1.1.0-code11.aab` sur la piste **Production**, pays France,
   Belgique, Suisse, Luxembourg et Monaco.
2. Attendre que la version soit **réellement téléchargeable** dans les cinq pays
   (examen de Google terminé, fiche Play Store qui propose la 1.1.0).
3. Alors seulement, déclarer la nouvelle version au serveur :

```sql
update public.server_app_config
set android_version_code = 11,
    android_version_name = '1.1.0',
    updated_at = now()
where id = 'motman';
```

C'est une donnée, pas un schéma : l'éditeur SQL du tableau de bord convient.
Les fonctions relisent ce réglage toutes les 30 secondes.

`minimum_android_version_code` **reste à 9** sauf décision contraire. Les trois
valeurs se lisent ainsi :

- `android_version_code` / `android_version_name` : la dernière version publiée,
  affichée par l'écran de mise à jour obligatoire. Le nom doit avoir la forme
  `x.y.z`, sinon l'application rejette toute la configuration ;
- `minimum_android_version_code` : en dessous, les services en ligne répondent
  HTTP 426 et l'application affiche un écran bloquant avec un bouton vers
  Google Play — la suppression de compte, elle, reste toujours possible ;
- une contrainte impose `minimum_android_version_code ≤ android_version_code` :
  déclarer la version d'abord, relever le minimum ensuite, jamais l'inverse.

Relever le minimum (à 11 par exemple) oblige tous les joueurs des APK plus
anciens à passer par le Play Store. Ne jamais le faire avant que l'AAB soit
téléchargeable partout : ces joueurs resteraient bloqués sans issue.

## Play Console

### Public cible et contenu

- Tranches d'âge : **16-17 ans et 18 ans et plus**, comme les conditions
  d'utilisation (« 16 ans et plus, pas destiné aux enfants »). Aucune tranche
  plus jeune.
- Publicités : aucune.
- **Achats intégrés : aucun.** L'application n'intègre pas Google Play Billing
  et ne vend rien. Les plumes se gagnent en jouant ; les paniers s'ouvrent
  uniquement avec des plumes, jamais avec de l'argent. Leurs probabilités sont
  affichées avant chaque ouverture.
  **Le jour où un achat revient** (un pass en euros, par exemple — piste du
  plan de revenus du 14/09/2026) : Google Play Billing devient obligatoire pour
  tout bien numérique vendu dans l'appli ; déclarer « Contient des achats
  intégrés » dans la fiche ; retirer « Pas d'achat intégré : rien ne se paie en
  euros » et « Les plumes ne s'achètent pas » de la description (texte de
  référence : `MotMan Contexte/MotMan_Fiche_PlayStore.md`) ; ajouter les achats
  à la sécurité des données et à la politique de confidentialité ; refaire le
  questionnaire IARC. Les paniers,
  eux, ne doivent jamais s'acheter en euros : ce serait un objet aléatoire
  payant, à déclarer comme tel.
- Questionnaire IARC : jeu de mots, multijoueur en ligne, interactions entre
  joueurs (pseudos, amis, invitations, signalements), pas de discussion libre,
  ni violence, ni sexe, ni drogue, ni langage grossier, ni jeu d'argent. Aucun
  objet aléatoire ne s'achète avec de l'argent réel.

La classification finale vient de l'IARC ; ne pas écrire de classement PEGI à
la main dans la fiche.

### Sécurité des données

Données collectées, à reporter dans les catégories les plus proches du
formulaire :

- **Informations de compte** : identifiant du compte, pseudo, adresse e-mail
  (seulement pour un compte protégé par e-mail ou Google — facultatif).
- **Activité dans l'application** : progression, scores, parties, collection.
  (L'avis de grille de fin de partie a été retiré le 19/09/2026 : plus rien ne
  l'envoie, et les textes légaux ne le mentionnent plus.)
- **Relations sociales** : amis, invitations, blocages, et signalements (dont le
  texte rédigé par le joueur).
- **Identifiants de l'appareil** : jeton de notification FCM, seulement si le
  joueur autorise les notifications ; identifiant d'installation Firebase, joint
  aux rapports de plantage.
- **Diagnostics** : rapports de plantage Crashlytics (actif dans les versions de
  publication) — modèle de l'appareil, version du système, identifiant
  d'installation, trace de l'erreur. Ni le contenu des parties ni les messages.

Ce qui n'est **pas** collecté :

- rien par le formulaire de contact : « Nous écrire » prépare un e-mail dans
  l'application de messagerie du joueur (`mailto:contact@doctox.fr`) ; MotMan ne
  reçoit que ce que le joueur envoie lui-même ;
- rien vers Capgo : dans la 1.1.0, `statsUrl` est vide (`capacitor.config.json`)
  et le module de mise à jour n'envoie aucune statistique. Les APK antérieurs
  gardent le réglage par défaut du module, qui en envoie à `plugin.capgo.app` ;
- ni localisation, ni contacts, ni photos, ni publicité, ni revente.

Autres réponses :

- chiffrement en transit : oui (HTTPS seulement, trafic en clair interdit) ;
- suppression des données : oui, dans l'application (Menu → « Compte connecté »
  ou « Créer ou retrouver un compte » → Supprimer mon compte) et sur la page publique ci-dessous ; les comptes invités
  inactifs depuis 30 jours sont supprimés automatiquement ;
- partage avec des tiers : non. Supabase (hébergement en France), Cloudflare
  Turnstile (protection contre les robots), Firebase Cloud Messaging et
  Crashlytics, Google Sign-In agissent comme prestataires techniques.

Relire ces réponses contre `public/legal/confidentialite.html` avant d'envoyer
le formulaire : les deux doivent dire la même chose.

### Fiche Play Store

- Site : `https://www.doctox.fr/motman/`
- Confidentialité : `https://www.doctox.fr/motman/legal/confidentialite.html`
- Suppression du compte : `https://www.doctox.fr/motman/legal/suppression-compte.html`
- E-mail de contact : `contact@doctox.fr`
- Icône 512 × 512 sans masque ajouté, bannière 1 024 × 500, au moins deux
  captures de téléphone faites sur la version candidate.
- Accès pour l'examen : le jeu s'ouvre en compte invité, sans identifiants.

Toujours `www.doctox.fr` : l'ancienne adresse GitHub Pages n'est plus l'adresse
publique du jeu.

## Après la mise en production

- Suivre Crashlytics et les ANR de la Play Console les premiers jours.
- Ne relever `minimum_android_version_code` que sur décision, par exemple le
  jour où un changement natif monte `LIVE_UPDATE_MIN_NATIVE_VERSION_CODE`
  (`src/liveUpdateManifest.ts`) au-dessus de 9.

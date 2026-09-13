# MotMan sur Android et iOS

MotMan utilise Capacitor 7 avec l’identifiant provisoire `com.motman.game`.
Les projets natifs sont conservés dans `android/` et `ios/` ; le jeu React reste
la source unique de l’interface et des règles.

## Commandes

- `npm run mobile:sync` construit le Web puis synchronise Android et iOS.
- `npm run mobile:android` ouvre le projet Android après synchronisation.
- `npm run mobile:ios` ouvre le projet iOS après synchronisation.
- `npm run mobile:doctor` contrôle les prérequis locaux.

## Authentification

Google, la confirmation d’e-mail et la récupération de compte reviennent vers
`com.motman.game://auth/callback`. Cette adresse doit être ajoutée aux URL de
redirection autorisées dans Supabase avant un test natif de l’authentification.
Le code utilise PKCE et ouvre le fournisseur dans le navigateur système.

## Notifications de tours et d'invitations

Le client natif utilise Firebase Cloud Messaging via Capacitor. Les notifications
ouvrent directement la partie concernée, ou la page Jouer lorsqu'une invitation
n'a pas encore créé de partie. Le serveur envoie trois événements : nouveau tour
en temps illimité, invitation d'un ami et invitation acceptée.

Configuration Android à effectuer une seule fois :

1. Ajouter l'application Android `com.motman.game` au projet Firebase MotMan.
2. Placer le fichier téléchargé `google-services.json` dans `android/app/`.
3. Générer une clé de compte de service Firebase dans un dossier extérieur au
   dépôt. Ne jamais ajouter cette clé à Git.
4. Charger son contenu JSON dans le secret Supabase
   `FIREBASE_SERVICE_ACCOUNT_JSON`, puis redéployer `match-api`.
5. Installer une nouvelle version de l'application et accepter la permission de
   notification lors du premier lancement.

Pour iOS, activer ultérieurement Push Notifications et Background Modes dans
Xcode, puis relier une clé APNs au projet Firebase.

## Prérequis de compilation

- Android : Android Studio, SDK Android 36 et JDK 21.
- iOS : macOS, Xcode et CocoaPods.

La machine Windows de développement utilise le JDK 21 d'Android Studio. Gradle
peut installer automatiquement le SDK Android 36 si sa licence est acceptée.
Le projet iOS peut être synchronisé sous Windows mais doit être
compilé et signé sur un Mac.

## Avant publication

1. Remplacer l’identifiant provisoire si le nom de domaine final impose un autre
   identifiant, avant toute signature de production.
2. Les icônes et le splash sont générés avec `npm run mobile:assets`. Produire
   les captures de boutique sur la version candidate.
3. Renseigner l’identité légale et le contact de l’éditeur dans les documents.
4. Tester Google, e-mail, liens profonds et récupération sur les deux plateformes.
5. Dans Google Play Console, renseigner comme URL de suppression du compte :
   `https://doctox.github.io/MotMan/legal/suppression-compte.html`.
6. Vérifier la suppression depuis Paramètres → Compte avec un compte de test :
   progression, collection, amis, parties et sessions doivent disparaître.
7. Créer les certificats, profils de signature et fiches Play Store/App Store.

La procédure complète Google Play, les variables de signature et les réponses à
préparer dans la Console sont documentées dans `docs/GOOGLE_PLAY.md`.

## Mises à jour embarquées

Depuis la version 1.0.7 (code 8), l'APK n'a plus besoin d'être republié pour
une correction du site. À chaque envoi sur `main`, la chaîne GitHub publie une
copie du site construite pour l'APK, et l'application l'installe d'elle-même.

**Le trajet.** La chaîne construit le site pour la racine (`dist-app`, car
l'APK sert ses fichiers à `/` et le site public à `/motman/`), le passe à
l'audit de sécurité, le zippe et publie dans `https://www.doctox.fr/motman/app-update/` (avec `www.` : sans lui, une redirection bloque la lecture depuis l'APK) :
`bundle-<N>.zip` et `latest.json`, un manifeste signé. Au lancement,
l'application (`src/liveUpdate.ts`) lit le manifeste, vérifie sa signature,
télécharge le zip en arrière-plan et l'installe au lancement suivant. Le module
`@capgo/capacitor-updater` (MPL-2.0) vérifie ensuite l'empreinte SHA-256 du zip.

**Ce qui est refusé.** Une signature invalide, une adresse hors de
`app-update/`, un numéro égal ou inférieur à celui qui tourne (un vieux
manifeste reste valablement signé pour toujours : le rejouer ramènerait une
ancienne version), et un code qui réclame un APK plus récent que celui installé.

**Retour arrière automatique.** L'application confirme son démarrage au module
avant tout appel réseau (`confirmLiveUpdateBoot`). Sans cette confirmation au
bout de 10 secondes, le module revient à la version précédente.

**La clé.** La clé publique est dans `src/liveUpdateKey.ts`. La clé privée est
dans le secret GitHub `MOTMAN_UPDATE_SIGNING_KEY`, et dans un fichier du
propriétaire hors du dépôt. Jamais ailleurs : quiconque la détient peut
installer du code sur tous les téléphones. Sans le secret, la chaîne publie le
site normalement et n'envoie aucune mise à jour (avertissement).

**Quand un APK redevient nécessaire.** Tout ce qui est natif : un nouveau
module Capacitor, une permission, un réglage du manifeste Android. Monter alors
`LIVE_UPDATE_MIN_NATIVE_VERSION_CODE` (`src/liveUpdateManifest.ts`) au code du
nouvel APK : les anciens APK cesseront de recevoir les mises à jour au lieu
d'exécuter un code qui appelle un module absent. Puis, une fois le nouvel APK
diffusé, relever `minimum_android_version_code` (voir docs/GOOGLE_PLAY.md).

**Changer de clé**, sans perdre les téléphones déjà installés :

1. Déplacer l'ancien fichier de clé privée, puis lancer
   `node scripts/generate_update_signing_key.mjs` : il écrit la nouvelle clé
   privée hors du dépôt et la nouvelle clé publique dans `src/liveUpdateKey.ts`.
2. Envoyer ce changement SANS toucher au secret : la chaîne signe encore avec
   l'ancienne clé, que les téléphones connaissent, et leur livre la nouvelle.
3. Laisser le temps aux téléphones de l'installer, puis seulement remplacer le
   secret par la nouvelle clé privée.

Un téléphone resté éteint pendant toute l'opération ne reconnaîtra plus les
mises à jour : il lui faudra un nouvel APK.

**Le poids.** Une mise à jour est une copie complète du site, environ 13 Mo,
images comprises. Négligeable pendant le test fermé ; à revoir avant une large
diffusion (le module sait ne télécharger que les fichiers modifiés).

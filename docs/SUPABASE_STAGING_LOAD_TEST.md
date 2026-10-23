# Test de charge Supabase staging

Le banc de charge refuse explicitement le projet MotMan de production
`kfacjvxzdtxybvxhfmzg`. Il ne lit jamais `.env.local`.

## Préparer le staging

Le projet de staging doit contenir les mêmes migrations, fonctions Edge,
secrets fonctionnels et catalogue que la production, mais aucune donnée réelle.

Créer un fichier local non versionné `.env.loadtest.local` :

```dotenv
MOTMAN_STAGING_URL=https://PROJECT_REF.supabase.co
MOTMAN_STAGING_PROJECT_REF=PROJECT_REF
MOTMAN_STAGING_PUBLISHABLE_KEY=...
MOTMAN_STAGING_SERVICE_ROLE_KEY=...
MOTMAN_LOAD_TEST_CONFIRM=LOAD_TEST_PROJECT_REF
```

La confirmation doit contenir la vraie référence à la place de `PROJECT_REF`.

## Exécuter

```powershell
node scripts/load_test_supabase_staging.mjs --env=.env.loadtest.local
```

Le scénario exécute successivement 10, 50 puis 100 joueurs :

1. création et authentification des comptes temporaires ;
2. ouverture des canaux Realtime privés du menu ;
3. heartbeat de présence ;
4. chargement social groupé ;
5. chargement du lobby ;
6. instantané d’utilisation des grilles ;
7. recherche de partie atomique simultanée ;
8. rechargement du lobby et lecture autoritaire des matchs ;
9. abandon technique des matchs et suppression des comptes temporaires.

### Capacité d'un live (23/10/2026)

```powershell
node scripts/load_test_supabase_staging.mjs --env=.env.loadtest.local --stages=10,50,100,200,300,500 --partie=180 --continuer
```

- `--stages` va jusqu'à 1 000 joueurs par palier.
- Chaque palier commence par `ouverture-en-rafale` : tous les joueurs ouvrent
  l'appli à la même seconde.
- `--partie=180` ajoute `partie-soutenue` : 3 minutes de vraie partie pour
  chaque paire, au rythme du client. Le joueur relit la partie toutes les 8 à
  12 s ; à son tour, il envoie un brouillon puis joue. Le rapport donne les
  appels par minute et par joueur, et des tranches de 30 s qui montrent le
  moment où ça cède.
- `--continuer` enchaîne les paliers même après un échec.

Attention aux quotas : sur le plan gratuit, ils se partagent par
ORGANISATION. Le projet de test vit dans une organisation à lui (« MotMan
Test »), jamais à côté de la production.

Le rapport JSON est enregistré sous `output/load-tests/`. Il contient les
statuts HTTP, erreurs, débit et latences min/p50/p95/p99/max pour chaque phase.
Les clés Supabase, JWT, e-mails et identifiants joueurs n’y sont jamais écrits.

Un palier est validé uniquement si :

- toutes les requêtes réussissent ;
- aucun statut réseau, 5xx ou 546 n’apparaît ;
- le matchmaking crée exactement `joueurs / 2` matchs ;
- le nettoyage final ne laisse aucun compte de charge.

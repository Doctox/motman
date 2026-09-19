# Sécurité des comptes invités

## Cloudflare Turnstile

MotMan demande un jeton Turnstile uniquement lorsqu’aucune session Supabase
n’existe encore. Les joueurs déjà connectés ne repassent donc pas le contrôle à
chaque ouverture.

Configuration de production :

1. Créer un widget **Managed** nommé `MotMan · comptes invités` dans Cloudflare
   Turnstile.
2. Autoriser au minimum `www.doctox.fr` (le site public est servi sous
   `https://www.doctox.fr/motman/`) et `localhost` (origine de l’application
   Capacitor). Ajouter l’adresse ou le domaine utilisé pour les tests locaux si
   nécessaire.
3. Ajouter la clé publique dans la variable GitHub Actions
   `VITE_TURNSTILE_SITE_KEY` et dans `.env.local` pour les builds mobiles.
4. Dans Supabase, ouvrir **Authentication → Bot and Abuse Protection**, choisir
   Cloudflare Turnstile, saisir la clé secrète et activer la protection.
5. Ne jamais placer la clé secrète Cloudflare dans GitHub, Vite ou le paquet
   Android. Seule la clé publique commence par `VITE_`.

Le client transmet le jeton à `signInAnonymously({ options: { captchaToken } })` ;
Supabase effectue la validation serveur auprès de Cloudflare.

## Limites applicatives

Les Edge Functions consomment des compteurs atomiques dans
`public.server_rate_limits`. La table et la fonction RPC sont interdites aux
rôles `anon` et `authenticated`; seul `service_role` peut les utiliser.

- chaque API possède un plafond global par joueur et par minute ;
- les invités ont des plafonds plus stricts ;
- recherche de partie (normale et classée), invitations de match, demandes et
  recherches d’ami, signalements, parties solo et défi du jour possèdent aussi
  leur propre fenêtre (`src/rateLimitPolicies.ts`) ;
- un refus renvoie HTTP `429` avec l’en-tête `Retry-After`.

## Nettoyage

Le job `motman-cleanup-inactive-guests` s’exécute chaque jour à 03:17 UTC
(5 h 17 à Paris en été, 4 h 17 en hiver). Il
supprime au maximum 100 comptes anonymes inactifs depuis 30 jours par passage,
sans toucher aux invités engagés dans une partie active. Le même job nettoie
les compteurs expirés. Les comptes liés à Google ou à une adresse e-mail ne
sont jamais concernés.

-- ─────────────────────────────────────────────────────────────────────────────
-- LE POULS DU JEU, POUR LE PROPRIÉTAIRE SEUL (20/09/2026)
--
-- « J'aimerais avoir un compteur de joueurs actifs, genre à jour, mais que
-- j'aie que moi qui le voie. » Jusqu'ici, connaître l'audience demandait
-- d'ouvrir le tableau de bord Supabase et d'écrire du SQL à la main.
--
-- Une seule requête, une seule ligne de retour, et RIEN d'identifiant : des
-- nombres, jamais des pseudos. Même le propriétaire n'a pas besoin de savoir
-- QUI joue pour savoir COMBIEN jouent.
--
-- Le jour est celui d'Europe/Paris, comme le défi du jour et comme tout le
-- reste du jeu : un compteur qui bascule à minuit UTC dirait « 0 joueur
-- aujourd'hui » à deux heures du matin, en pleine soirée de jeu.
--
-- « Actif » se lit sur `profiles.last_seen`, que le battement de présence
-- réécrit toutes les 25 secondes tant que l'appli est ouverte. « En ligne »,
-- c'est moins de 75 secondes — le seuil du client (PRESENCE_ONLINE_TTL_MS).
--
-- Le contrôle du rôle est fait par l'edge function AVANT l'appel ; cette
-- fonction n'est donnée qu'à `service_role`, jamais au client.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.server_game_pulse()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with bornes as (
    select
      (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') as debut_du_jour,
      pg_catalog.now() - interval '75 seconds' as seuil_en_ligne,
      pg_catalog.now() - interval '7 days' as seuil_semaine,
      pg_catalog.to_char(pg_catalog.now() at time zone 'Europe/Paris', 'YYYY-MM-DD') as jour,
      (pg_catalog.now() at time zone 'Europe/Paris')::date as jour_date
  )
  select jsonb_build_object(
    'jour', (select jour from bornes),
    'enLigne', (select count(*) from public.profiles, bornes where last_seen > seuil_en_ligne),
    'actifsDuJour', (select count(*) from public.profiles, bornes where last_seen >= debut_du_jour),
    'actifsSeptJours', (select count(*) from public.profiles, bornes where last_seen >= seuil_semaine),
    'nouveauxDuJour', (select count(*) from public.profiles, bornes where created_at >= debut_du_jour),
    'comptes', (select count(*) from public.profiles where account_kind = 'account'),
    'partiesDuJour', (select count(*) from public.server_matches, bornes where created_at >= debut_du_jour),
    -- `daily_plays.day` est une DATE : la comparer au texte du jour échoue.
    'defisDuJour', (select count(*) from public.daily_plays, bornes where day = jour_date),
    'classeesSeptJours', (select count(*) from public.ranked_rating_events, bornes where created_at >= seuil_semaine)
  );
$$;

revoke all on function public.server_game_pulse() from public, anon, authenticated;
grant execute on function public.server_game_pulse() to service_role;

comment on function public.server_game_pulse() is
  'Nombres d''audience du jour (Europe/Paris) pour le propriétaire : aucun pseudo, aucune donnée identifiante.';

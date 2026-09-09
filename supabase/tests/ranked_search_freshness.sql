-- Une recherche classée abandonnée ne doit plus servir d'adversaire.
--
-- Le scénario est celui qui a été constaté en production le 08/09/2026 : une
-- ligne en `searching` que plus personne ne rafraîchit, parce que le joueur a
-- fermé l'application. Sans le filtre de fraîcheur, le joueur suivant lui était
-- apparié, la fenêtre de confirmation s'ouvrait, et il attendait trente secondes
-- devant quelqu'un qui n'était plus là.
--
-- Le test vérifie les DEUX sens, parce qu'un filtre trop zélé serait pire que
-- pas de filtre : un fantôme n'est pas apparié, un joueur vivant l'est.

begin;

do $$
declare
  fantome   constant uuid := 'f0aa2001-0000-4000-8000-0000000000f1';
  vivant    constant uuid := 'f0aa2002-0000-4000-8000-0000000000f2';
  chercheur constant uuid := 'f0aa2003-0000-4000-8000-0000000000f3';
  resultat  jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (fantome,   false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (vivant,    false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (chercheur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  -- La file réelle est écartée le temps du test : sa suppression appartient à
  -- cette transaction et sera annulée avec elle. Sans cela, le test dépendrait
  -- de qui cherche en production au moment où il tourne.
  delete from public.server_ranked_searches;

  -- Les trois joueurs doivent être dans la même tranche pour être appariables
  -- entre eux ; on force donc le même classement.
  update public.player_progress
  set ranked_points = 1200, ranked_matches = 10
  where user_id in (fantome, vivant, chercheur);

  -- ── 1. Un fantôme n'est pas apparié ────────────────────────────────────────
  -- On met le fantôme en file, puis on fait reculer son `updated_at` de dix
  -- minutes : c'est exactement l'état d'une application fermée.
  resultat := public.server_ranked_matchmake_atomic(fantome, null, null, null, null);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'Le fantome aurait du entrer en file : %', resultat;
  end if;

  update public.server_ranked_searches
  set updated_at = pg_catalog.clock_timestamp() - interval '10 minutes'
  where user_id = fantome;

  resultat := public.server_ranked_matchmake_atomic(chercheur, null, null, null, null);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'Le chercheur a ete apparie a un fantome : %', resultat;
  end if;

  -- ── 2. Un joueur vivant, lui, est bien apparié ─────────────────────────────
  -- Le contrôle symétrique : sans lui, un filtre qui rejetterait TOUT le monde
  -- passerait ce test sans qu'on s'en aperçoive.
  delete from public.server_ranked_searches;

  resultat := public.server_ranked_matchmake_atomic(vivant, null, null, null, null);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'Le joueur vivant aurait du entrer en file : %', resultat;
  end if;

  resultat := public.server_ranked_matchmake_atomic(chercheur, null, null, null, null);
  if resultat ->> 'status' <> 'candidate' then
    raise exception 'Un joueur vivant aurait du etre propose comme adversaire : %', resultat;
  end if;
  if resultat ->> 'opponentId' <> vivant::text then
    raise exception 'Adversaire inattendu : %', resultat;
  end if;

  -- ── 3. Le ménage efface le fantôme, pas le vivant ──────────────────────────
  delete from public.server_ranked_searches;
  insert into public.server_ranked_searches(user_id, status, rating_snapshot, tier_snapshot, placement_snapshot, created_at, updated_at)
  -- `placement_snapshot` est plafonne a 5 par contrainte (le RPC pose
  -- least(5, ranked_matches)) : y mettre 10 fait echouer l'insertion.
  values
    (fantome, 'searching', 1200, 1, 5, pg_catalog.clock_timestamp() - interval '30 minutes', pg_catalog.clock_timestamp() - interval '30 minutes'),
    (vivant,  'searching', 1200, 1, 5, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  perform private.purge_abandoned_ranked_searches();

  if exists (select 1 from public.server_ranked_searches where user_id = fantome) then
    raise exception 'Le fantome aurait du etre purge';
  end if;
  if not exists (select 1 from public.server_ranked_searches where user_id = vivant) then
    raise exception 'Le joueur vivant n''aurait pas du etre purge';
  end if;
end;
$$;

rollback;

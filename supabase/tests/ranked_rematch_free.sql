-- On se rejoue en classée sans attendre (migration 20261016233000).
--
-- L'appariement classé écartait, pendant dix minutes, l'adversaire contre qui
-- on venait de finir une classée ; seul le propriétaire en était exempté. Le
-- 16/10/2026, il a demandé de retirer la règle pour tout le monde. Deux
-- promesses :
--   1. deux joueurs ORDINAIRES qui viennent de s'affronter se retrouvent tout
--      de suite, s'ils sont les seuls en file ;
--   2. le propriétaire aussi, comme avant.
--
-- On entre en file par le RPC lui-même : une ligne posée à la main dans
-- `server_ranked_searches` n'a ni instantané de classement ni tranche.

begin;

do $$
declare
  joueur constant uuid := 'f7ee0925-0000-4000-8000-0000000000b1';
  autre constant uuid := 'f7ee0925-0000-4000-8000-0000000000b2';
  grille text;
  duel uuid;
  resultat jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  -- Même tranche, sinon ils ne sont pas appariables pour une raison étrangère
  -- à ce qu'on éprouve ici.
  update public.player_progress
  set ranked_points = 1200, ranked_matches = 10
  where user_id in (joueur, autre);

  select grid.id into grille
  from public.server_grid_catalog as grid
  where grid.active is true
  order by grid.id
  limit 1;
  if grille is null then
    raise exception 'Cet essai a besoin d''une grille active';
  end if;

  -- Une partie classée entre eux, terminée il y a deux minutes.
  insert into public.server_matches(mode, pace, grid_id, state, status, finish_reason, updated_at)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object(
            'playerIds', pg_catalog.jsonb_build_array(joueur, autre),
            'bot', null,
            'scores', pg_catalog.jsonb_build_object(joueur::text, 0, autre::text, 0)),
          'finished', 'completed', pg_catalog.clock_timestamp() - interval '2 minutes')
  returning id into duel;
  insert into public.match_participants(match_id, user_id, opponent_id)
  values (duel, joueur, autre), (duel, autre, joueur);

  -- ── 1. Deux joueurs ordinaires : ils se retrouvent tout de suite ──────────
  delete from public.server_ranked_searches;
  perform public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  if resultat ->> 'opponentId' is distinct from autre::text then
    raise exception 'Deux joueurs qui viennent de s''affronter doivent pouvoir se rejouer tout de suite : %', resultat;
  end if;

  -- ── 2. Le propriétaire aussi, comme avant ─────────────────────────────────
  update public.profiles set role = 'admin' where id = autre;
  delete from public.server_ranked_searches;
  perform public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  if resultat ->> 'opponentId' is distinct from autre::text then
    raise exception 'Un joueur doit pouvoir reprendre le proprietaire tout de suite : %', resultat;
  end if;
end;
$$;

rollback;

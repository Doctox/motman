-- Rien ne fait sortir d'un défi du jour en cours (migration 20261019100000).
--
-- Le propriétaire cherche une partie, puis joue son défi du jour en attendant.
-- « Quand je suis en train de jouer mon défi, rien ne doit m'en sortir. »
-- Quatre promesses :
--   1. en classée, il n'est ni apparié ni proposé tant que le défi dure, et
--      l'appariement reprend dès la fin du défi ;
--   2. en file normale à temps limité, pareil ;
--   3. sa recherche normale n'est pas purgée pendant le défi ;
--   4. l'illimité, qui n'interrompt rien, s'apparie comme avant.
--
-- On entre en file par les RPC eux-mêmes, comme le fait match-api.

begin;

do $$
declare
  joueur constant uuid := 'f0bd1019-0000-4000-8000-0000000000a1';
  autre  constant uuid := 'f0bd1019-0000-4000-8000-0000000000b2';
  grille text;
  defi   uuid;
  resultat jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
  update public.player_progress set ranked_points = 1200, ranked_matches = 10
  where user_id in (joueur, autre);

  select grid.id into grille from public.server_grid_catalog as grid
  where grid.active is true order by grid.id limit 1;

  -- Sa recherche normale, ouverte AVANT le défi.
  delete from public.server_match_searches;
  perform public.server_matchmake_atomic(joueur, 'realtime', null, null, null, null, null, null);

  -- Son défi du jour, en cours.
  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number, created_at, updated_at)
  values ('solo', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(joueur, 'bot-defi'), 'isDaily', true),
          'active', joueur, 3, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
  returning id into defi;
  insert into public.match_participants(match_id, user_id) values (defi, joueur);

  if not private.en_plein_defi(joueur) or private.en_plein_defi(autre) then
    raise exception 'en_plein_defi doit reconnaître le défi en cours, et lui seul';
  end if;

  -- ── 1. Classée ────────────────────────────────────────────────────────────
  delete from public.server_ranked_searches;
  perform public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'En plein défi, il ne doit pas être apparié en classée : %', resultat;
  end if;
  if not exists (select 1 from public.server_ranked_searches where user_id = joueur and status = 'searching') then
    raise exception 'Sa recherche classée doit rester en file pendant le défi';
  end if;
  resultat := public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  if resultat ->> 'opponentId' = joueur::text then
    raise exception 'Il ne doit pas être proposé à un autre pendant son défi : %', resultat;
  end if;

  -- ── 2. Normale, temps limité ──────────────────────────────────────────────
  resultat := public.server_matchmake_atomic(autre, 'realtime', null, null, null, null, null, null);
  if resultat ->> 'opponentId' = joueur::text then
    raise exception 'En file normale, il ne doit pas être proposé pendant son défi : %', resultat;
  end if;
  resultat := public.server_matchmake_atomic(joueur, 'realtime', null, null, null, null, null, null);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'En plein défi, il ne doit pas être apparié en file normale : %', resultat;
  end if;

  -- ── 3. Sa recherche normale n'est pas purgée ──────────────────────────────
  update public.server_match_searches
  set updated_at = pg_catalog.clock_timestamp() - interval '6 minutes', claim_token = null, claimed_by = null, claim_expires_at = null
  where pace = 'realtime';
  perform private.purge_abandoned_normal_searches();
  if not exists (select 1 from public.server_match_searches where user_id = joueur and pace = 'realtime') then
    raise exception 'Sa recherche normale doit survivre à la purge pendant le défi';
  end if;
  if exists (select 1 from public.server_match_searches where user_id = autre and pace = 'realtime') then
    raise exception 'La purge doit toujours emporter une recherche muette hors défi';
  end if;

  -- ── 4. L'illimité s'apparie comme avant ───────────────────────────────────
  perform public.server_matchmake_atomic(joueur, 'async', null, null, null, null, null, null);
  resultat := public.server_matchmake_atomic(autre, 'async', null, null, null, null, null, null);
  if resultat ->> 'opponentId' is distinct from joueur::text then
    raise exception 'En illimité, le défi n''empêche pas l''appariement : %', resultat;
  end if;

  -- ── 1 bis. Le défi fini, l'appariement classé reprend ─────────────────────
  update public.server_matches set status = 'finished', finish_reason = 'completed' where id = defi;
  delete from public.server_ranked_searches;
  perform public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  if resultat ->> 'opponentId' is distinct from autre::text then
    raise exception 'Le défi fini, il doit retrouver un adversaire classé : %', resultat;
  end if;
end;
$$;

rollback;

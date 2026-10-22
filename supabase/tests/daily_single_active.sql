-- Un seul défi du jour ACTIF par joueur et par jour (migration 20261022120000,
-- code U7).
--
-- Le 14/09/2026, deux appuis à 1,6 s d'écart ont ouvert deux défis : le
-- contrôle de match-api et la création se faisaient en deux temps. Un tricheur
-- pouvait en jouer un pour voir les réponses, l'abandonner, puis jouer l'autre.
-- Trois promesses :
--   1. un second défi actif du même joueur, le même jour, est refusé en base ;
--   2. un autre joueur ouvre le sien sans gêne ;
--   3. le défi TERMINÉ ne compte plus : l'index ne garde que les actifs (c'est
--      l'historique qui ferme la journée, côté match-api).

begin;

do $$
declare
  joueur constant uuid := 'f7ee1022-0000-4000-8000-0000000000d1';
  autre constant uuid := 'f7ee1022-0000-4000-8000-0000000000d2';
  grille text;
  jour constant text := '2026-10-22';
  premier uuid;
  refuse boolean := false;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  select grid.id into grille from public.server_grid_catalog as grid
  where grid.active is true order by grid.id limit 1;

  insert into public.server_matches(mode, pace, grid_id, state, status)
  values ('solo', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(joueur, 'bot-a'), 'isDaily', true, 'dailyDate', jour),
          'active')
  returning id into premier;

  -- ── 1. Le second défi actif du même jour est refusé ───────────────────────
  begin
    insert into public.server_matches(mode, pace, grid_id, state, status)
    values ('solo', 'realtime', grille,
            pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(joueur, 'bot-b'), 'isDaily', true, 'dailyDate', jour),
            'active');
  exception when unique_violation then
    refuse := true;
  end;
  if not refuse then
    raise exception 'Un second défi actif du même joueur, le même jour, doit être refusé';
  end if;

  -- ── 2. Un autre joueur ouvre le sien ──────────────────────────────────────
  insert into public.server_matches(mode, pace, grid_id, state, status)
  values ('solo', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(autre, 'bot-c'), 'isDaily', true, 'dailyDate', jour),
          'active');

  -- ── 3. Une fois terminé, il ne bloque plus l'index ────────────────────────
  update public.server_matches set status = 'finished', finish_reason = 'completed' where id = premier;
  insert into public.server_matches(mode, pace, grid_id, state, status)
  values ('solo', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(joueur, 'bot-d'), 'isDaily', true, 'dailyDate', jour),
          'active');
end;
$$;

rollback;

-- Parties jouées par grille (migration 20260915150000).
--
-- Trois promesses : un ancien identifiant compte pour la grille renommée ;
-- l'archive (rollups) s'ajoute à l'historique détaillé ; seul le rôle service
-- peut lire ces comptes.

begin;

do $$
declare
  joueur constant uuid := 'f7ee0011-0000-4000-8000-0000000000e1';
  autre constant uuid := 'f7ee0011-0000-4000-8000-0000000000e2';
  lignes jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at) values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
  insert into public.grid_id_aliases(old_id, new_id) values ('test-ancienne-grille', 'test-grille-renommee');

  insert into public.grid_player_history(user_id, play_key, grid_id, mode, pace, outcome, completed, score, opponent_score, completed_at)
  values
    (joueur, 'test:1', 'test-ancienne-grille', 'solo', 'realtime', 'win', true, 10, 5, '2026-07-20 10:00+00'),
    (joueur, 'test:2', 'test-grille-renommee', 'solo', 'realtime', 'loss', true, 4, 9, '2026-09-14 10:00+00'),
    (joueur, 'test:3', 'test-autre-grille', 'multiplayer', 'async', 'win', true, 8, 2, '2026-09-10 10:00+00'),
    (autre, 'test:4', 'test-autre-grille', 'solo', 'realtime', 'win', true, 8, 2, '2026-09-11 10:00+00');
  insert into public.grid_player_history_rollups(user_id, grid_id, mode, pace, plays, first_played_at, last_played_at)
  values (joueur, 'test-ancienne-grille', 'solo', 'realtime', 3, '2026-05-01 10:00+00', '2026-06-01 10:00+00');

  select pg_catalog.jsonb_object_agg(r.grid_id, pg_catalog.jsonb_build_object('plays', r.plays, 'last', r.last_played_at))
  into lignes
  from public.server_player_grid_plays(array[joueur]) as r;

  if lignes ? 'test-ancienne-grille' then
    raise exception 'L''ancien identifiant aurait du etre rattache a la grille renommee : %', lignes;
  end if;
  if (lignes -> 'test-grille-renommee' ->> 'plays')::bigint <> 5 then
    raise exception 'Grille renommee : 1 + 1 parties detaillees + 3 archivees = 5 attendues, obtenu %', lignes;
  end if;
  if (lignes -> 'test-grille-renommee' ->> 'last')::timestamptz <> '2026-09-14 10:00+00'::timestamptz then
    raise exception 'Derniere partie de la grille renommee fausse : %', lignes;
  end if;
  if (lignes -> 'test-autre-grille' ->> 'plays')::bigint <> 1 then
    raise exception 'Les parties d''un autre joueur ne doivent pas compter : %', lignes;
  end if;
  if (select count(*) from public.server_player_grid_plays(array[joueur, autre]) where user_id = autre) <> 1 then
    raise exception 'Plusieurs joueurs : une ligne par joueur et par grille attendue';
  end if;

  if pg_catalog.has_function_privilege('anon', 'public.server_player_grid_plays(uuid[])', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.server_player_grid_plays(uuid[])', 'execute')
     or pg_catalog.has_table_privilege('authenticated', 'public.grid_id_aliases', 'select') then
    raise exception 'Comptes et correspondances doivent rester reserves au role service';
  end if;
end $$;

rollback;

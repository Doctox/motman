-- Le pouls du jeu compte les AUTRES (migration 20260920210000).
--
-- Ce cadre n'est lu que par le propriétaire, et il le lit depuis l'appli : il y
-- serait toujours compté lui-même. Quatre promesses, vérifiées en différence
-- pour rester vraies quelles que soient les données réelles du moment :
--   1. chaque nombre baisse d'exactement un quand on s'exclut ;
--   2. sa partie et son défi du jour sortent du compte ;
--   3. une partie classée compte pour UNE, pas pour deux (une ligne par
--      joueur dans `ranked_rating_events`) — et la sienne sort entièrement ;
--   4. la fonction reste réservée au service.

begin;

do $$
declare
  moi constant uuid := 'f7ee0010-0000-4000-8000-0000000000f1';
  autre constant uuid := 'f7ee0010-0000-4000-8000-0000000000f2';
  grille text;
  partie uuid;
  classee uuid;
  avant jsonb;
  apres jsonb;
  jour date := (pg_catalog.now() at time zone 'Europe/Paris')::date;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (moi, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  -- Les deux sont en ligne à l'instant, et l'un d'eux est un vrai compte.
  update public.profiles
  set last_seen = pg_catalog.now(), account_kind = 'account', status = 'active'
  where id in (moi, autre);

  select grid.id into grille
  from public.server_grid_catalog as grid
  where grid.active is true
  order by grid.id
  limit 1;
  if grille is null then
    raise exception 'Le pouls a besoin d''une grille active pour fabriquer une partie';
  end if;

  -- Une partie normale à nous deux, et un défi du jour ouvert par moi.
  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number)
  values ('normal', 'realtime', grille,
          pg_catalog.jsonb_build_object(
            'playerIds', pg_catalog.jsonb_build_array(moi, autre),
            'bot', null,
            'scores', pg_catalog.jsonb_build_object(moi::text, 0, autre::text, 0)),
          'active', moi, 1)
  returning id into partie;
  insert into public.match_participants(match_id, user_id, opponent_id)
  values (partie, moi, autre), (partie, autre, moi);

  insert into public.daily_plays(user_id, day, match_id) values (moi, jour, null);
  insert into public.daily_plays(user_id, day, match_id) values (autre, jour, null);

  -- ── 1. M'exclure retire exactement une unité à chaque nombre de joueurs ────
  avant := public.server_game_pulse(null);
  apres := public.server_game_pulse(moi);

  if (apres ->> 'enLigne')::int <> (avant ->> 'enLigne')::int - 1 then
    raise exception 'En ligne : % devrait valoir un de moins que %', apres ->> 'enLigne', avant ->> 'enLigne';
  end if;
  if (apres ->> 'actifsDuJour')::int <> (avant ->> 'actifsDuJour')::int - 1 then
    raise exception 'Actifs du jour : % contre %', apres ->> 'actifsDuJour', avant ->> 'actifsDuJour';
  end if;
  if (apres ->> 'actifsSeptJours')::int <> (avant ->> 'actifsSeptJours')::int - 1 then
    raise exception 'Actifs sept jours : % contre %', apres ->> 'actifsSeptJours', avant ->> 'actifsSeptJours';
  end if;
  if (apres ->> 'nouveauxDuJour')::int <> (avant ->> 'nouveauxDuJour')::int - 1 then
    raise exception 'Nouveaux du jour : % contre %', apres ->> 'nouveauxDuJour', avant ->> 'nouveauxDuJour';
  end if;
  if (apres ->> 'comptes')::int <> (avant ->> 'comptes')::int - 1 then
    raise exception 'Comptes : % contre %', apres ->> 'comptes', avant ->> 'comptes';
  end if;

  -- ── 2. Ma partie et mon défi sortent du compte, celui de l'autre reste ─────
  if (apres ->> 'partiesDuJour')::int <> (avant ->> 'partiesDuJour')::int - 1 then
    raise exception 'Ma partie aurait du sortir du compte : % contre %',
      apres ->> 'partiesDuJour', avant ->> 'partiesDuJour';
  end if;
  if (apres ->> 'defisDuJour')::int <> (avant ->> 'defisDuJour')::int - 1 then
    raise exception 'Mon defi du jour aurait du sortir du compte : % contre %',
      apres ->> 'defisDuJour', avant ->> 'defisDuJour';
  end if;

  -- ── 3. Une partie classée compte pour une ─────────────────────────────────
  -- Deux joueurs étrangers : le duel doit ajouter UN, pas deux.
  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object(
            'playerIds', pg_catalog.jsonb_build_array(autre, moi),
            'bot', null,
            'scores', pg_catalog.jsonb_build_object(autre::text, 0, moi::text, 0)),
          'finished', autre, 1)
  returning id into classee;
  insert into public.match_participants(match_id, user_id, opponent_id)
  values (classee, autre, moi), (classee, moi, autre);

  insert into public.ranked_rating_events(
    match_id, user_id, opponent_id, points_before, points_after, points_delta,
    expected_score, actual_score, placement_number)
  values
    (classee, autre, moi, 1000, 1010, 10, 0.5, 1.0, 1),
    (classee, moi, autre, 1000, 990, -10, 0.5, 0.0, 1);

  if (public.server_game_pulse(null) ->> 'classeesSeptJours')::int
     <> (avant ->> 'classeesSeptJours')::int + 1 then
    raise exception 'Un duel classe doit compter pour UN, pas pour deux : % contre %',
      public.server_game_pulse(null) ->> 'classeesSeptJours', avant ->> 'classeesSeptJours';
  end if;

  -- Et comme j'y ai joué, elle sort entièrement de MON tableau : écarter ma
  -- seule ligne en gardant celle de l'adversaire aurait laissé le duel.
  if (public.server_game_pulse(moi) ->> 'classeesSeptJours')::int
     <> (apres ->> 'classeesSeptJours')::int then
    raise exception 'Ma partie classee aurait du sortir entierement du compte : % contre %',
      public.server_game_pulse(moi) ->> 'classeesSeptJours', apres ->> 'classeesSeptJours';
  end if;

  -- ── 4. Réservé au service ─────────────────────────────────────────────────
  if pg_catalog.has_function_privilege('authenticated', 'public.server_game_pulse(uuid)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.server_game_pulse(uuid)', 'execute') then
    raise exception 'Le pouls du jeu doit rester reserve au service';
  end if;
end;
$$;

rollback;

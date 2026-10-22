-- Classées jouées sans points (migration 20261022120000, code S1).
--
-- Depuis les revanches libres (16/10/2026), deux comptes d'un même joueur
-- pouvaient s'enchaîner, l'un abandonnant en deux secondes. Cinq promesses :
--   1. une classée normale rapporte toujours ses points ;
--   2. un abandon avant le 6e tour ne rapporte RIEN au vainqueur, et le perdant
--      perd quand même ;
--   3. au-delà de 3 classées entre les deux mêmes joueurs le même jour, la
--      partie se joue sans points, pour les deux ;
--   4. le motif est noté sur la ligne d'événement ;
--   5. avec un joueur de l'ombre, pas de plafond.
--
-- Les mesures sont des DIFFÉRENCES, calculées dans la transaction.

begin;

do $$
declare
  a constant uuid := 'f7ee1022-0000-4000-8000-0000000000e1';
  b constant uuid := 'f7ee1022-0000-4000-8000-0000000000e2';
  ombre constant uuid := 'f7ee1022-0000-4000-8000-0000000000e3';
  grille text;
  partie uuid;
  avant_a integer;
  avant_b integer;
  apres_a integer;
  apres_b integer;
  resultat jsonb;
  i integer;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (a, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (b, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (ombre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
  update public.player_progress set ranked_points = 1050, ranked_matches = 20
  where user_id in (a, b, ombre);

  select grid.id into grille from public.server_grid_catalog as grid
  where grid.active is true order by grid.id limit 1;

  -- ── 1. Une classée normale rapporte ses points ────────────────────────────
  insert into public.server_matches(mode, pace, grid_id, state, status, finish_reason, winner_id, turn_number)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(a, b), 'bot', null),
          'finished', 'completed', a, 14)
  returning id into partie;
  select ranked_points into avant_a from public.player_progress where user_id = a;
  resultat := public.server_apply_ranked_result_atomic(partie);
  select ranked_points into apres_a from public.player_progress where user_id = a;
  if resultat ->> 'status' <> 'applied' or apres_a <= avant_a or resultat ->> 'sansPoints' is not null then
    raise exception 'Une classée normale gagnée doit rapporter des points : %', resultat;
  end if;

  -- ── 2. L'abandon rapide ne rapporte rien au vainqueur ─────────────────────
  insert into public.server_matches(mode, pace, grid_id, state, status, finish_reason, winner_id, turn_number)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(a, b), 'bot', null),
          'finished', 'forfeit', a, 2)
  returning id into partie;
  select ranked_points into avant_a from public.player_progress where user_id = a;
  select ranked_points into avant_b from public.player_progress where user_id = b;
  resultat := public.server_apply_ranked_result_atomic(partie);
  select ranked_points into apres_a from public.player_progress where user_id = a;
  select ranked_points into apres_b from public.player_progress where user_id = b;
  if apres_a <> avant_a then
    raise exception 'Un abandon avant le 6e tour ne doit rien rapporter au vainqueur (% → %)', avant_a, apres_a;
  end if;
  if apres_b >= avant_b then
    raise exception 'Celui qui abandonne doit perdre ses points quand même (% → %)', avant_b, apres_b;
  end if;
  -- ── 4. Le motif est noté ──
  if not exists (select 1 from public.ranked_rating_events where match_id = partie and user_id = a and sans_points = 'abandon-rapide')
    or resultat ->> 'sansPoints' is distinct from 'abandon-rapide' then
    raise exception 'Le motif « abandon-rapide » doit être noté sur la ligne du vainqueur : %', resultat;
  end if;
  -- … et seulement sur elle : le perdant a bien perdu ses points.
  if exists (select 1 from public.ranked_rating_events where match_id = partie and user_id = b and sans_points is not null) then
    raise exception 'La ligne du perdant d''un abandon rapide ne doit porter aucun motif';
  end if;

  -- Un abandon TARDIF, lui, rapporte : la partie a vraiment été jouée.
  insert into public.server_matches(mode, pace, grid_id, state, status, finish_reason, winner_id, turn_number)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(a, b), 'bot', null),
          'finished', 'forfeit', a, 9)
  returning id into partie;

  -- ── 3. Le plafond : a et b ont déjà joué 3 classées aujourd'hui ───────────
  -- (la normale du 1, l'abandon du 2, et celle-ci, qu'on applique maintenant).
  select ranked_points into avant_a from public.player_progress where user_id = a;
  resultat := public.server_apply_ranked_result_atomic(partie);
  select ranked_points into apres_a from public.player_progress where user_id = a;
  if apres_a <= avant_a then
    raise exception 'Un abandon au 9e tour doit rapporter au vainqueur (% → %) : %', avant_a, apres_a, resultat;
  end if;

  insert into public.server_matches(mode, pace, grid_id, state, status, finish_reason, winner_id, turn_number)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(b, a), 'bot', null),
          'finished', 'completed', b, 14)
  returning id into partie;
  select ranked_points into avant_a from public.player_progress where user_id = a;
  select ranked_points into avant_b from public.player_progress where user_id = b;
  resultat := public.server_apply_ranked_result_atomic(partie);
  select ranked_points into apres_a from public.player_progress where user_id = a;
  select ranked_points into apres_b from public.player_progress where user_id = b;
  if apres_a <> avant_a or apres_b <> avant_b or resultat ->> 'sansPoints' is distinct from 'plafond-paire' then
    raise exception 'Une 4e classée entre les deux mêmes joueurs le même jour doit se jouer sans points : %', resultat;
  end if;

  -- ── 5. Avec un joueur de l'ombre, pas de plafond ──────────────────────────
  insert into public.shadow_players(user_id, tuning, arrives_at)
  values (ombre, '{}'::jsonb, pg_catalog.clock_timestamp() - interval '1 day');
  for i in 1..4 loop
    insert into public.server_matches(mode, pace, grid_id, state, status, finish_reason, winner_id, turn_number)
    values ('ranked', 'realtime', grille,
            pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(a, ombre), 'bot', null),
            'finished', 'completed', a, 14)
    returning id into partie;
    select ranked_points into avant_a from public.player_progress where user_id = a;
    resultat := public.server_apply_ranked_result_atomic(partie);
    select ranked_points into apres_a from public.player_progress where user_id = a;
    if apres_a <= avant_a then
      raise exception 'Contre un joueur de l''ombre, la %e victoire du jour doit rapporter : %', i, resultat;
    end if;
  end loop;
end;
$$;

rollback;

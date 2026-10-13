-- ─────────────────────────────────────────────────────────────────────────────────
-- LE FANTÔME A SON PROPRE CLASSEMENT (13/10/2026)
--
-- « Pas normal qu'elle ne fasse que gagner contre mon fantôme. Ça pourrit le
-- classement. » Le 12/10 au soir, une joueuse a battu le fantôme six fois sur sept
-- en 46 minutes (+90 points). Le fantôme était noté avec le classement du
-- PROPRIÉTAIRE (1 004), quelle que soit sa force réelle : le battre rapportait
-- autant que battre le propriétaire en personne — qui, lui, l'avait battue
-- 83 à 53 le même soir.
--
-- Le fantôme a désormais sa propre note, dans `ghost_ratings`. Elle part du
-- niveau du propriétaire, puis bouge à chaque partie comme celle d'un joueur
-- établi (K = 40) : s'il perd, elle baisse, et le battre rapporte de moins en
-- moins ; s'il gagne, elle remonte. Les points gagnés contre lui disent sa
-- force réelle. Le classement du propriétaire, lui, ne bouge toujours pas.
--
-- `server_apply_ranked_result_atomic` est recopiée de 20261011120000 : seule la
-- branche du fantôme change.
-- ─────────────────────────────────────────────────────────────────────────────────

create table if not exists public.ghost_ratings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  points integer not null,
  matches integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ghost_ratings enable row level security;
revoke all on public.ghost_ratings from public, anon, authenticated;
grant all on public.ghost_ratings to service_role;

comment on table public.ghost_ratings is
  'La note du fantôme du propriétaire en classée, distincte de la sienne. Voir 20261013120000_le_fantome_a_son_propre_classement.sql.';

create or replace function public.server_apply_ranked_result_atomic(
  p_match_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ranked_match public.server_matches%rowtype;
  player_a uuid;
  player_b uuid;
  progress_a public.player_progress%rowtype;
  progress_b public.player_progress%rowtype;
  points_a integer;
  points_b integer;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  k_a integer;
  k_b integer;
  delta_a integer;
  delta_b integer;
  next_a integer;
  next_b integer;
  ghost_id uuid;
  human_id uuid;
  progress_h public.player_progress%rowtype;
  progress_g public.player_progress%rowtype;
  points_h integer;
  points_g integer;
  expected_h numeric;
  actual_h numeric;
  k_h integer;
  delta_h integer;
  next_h integer;
  delta_g integer;
  next_g integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'motman:ranked-result:' || p_match_id::text,
      0
    )
  );

  select match.*
  into ranked_match
  from public.server_matches as match
  where match.id = p_match_id
    and match.mode = 'ranked'
    and match.status = 'finished'
    and match.finish_reason in ('completed', 'timeout', 'forfeit')
  for update;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  if exists (
    select 1
    from public.ranked_rating_events as event
    where event.match_id = p_match_id
  ) then
    return jsonb_build_object('status', 'already-applied');
  end if;

  player_a := (ranked_match.state -> 'playerIds' ->> 0)::uuid;
  player_b := (ranked_match.state -> 'playerIds' ->> 1)::uuid;

  -- ── LE FANTÔME DU PROPRIÉTAIRE (11/10/2026) ──────────────────────────────
  -- Une partie contre lui compte pour le JOUEUR, comme contre le propriétaire
  -- en personne : l'attente et l'écart se calculent sur le vrai classement du
  -- propriétaire. Le sien, lui, ne bouge jamais — il n'a pas joué. Une seule
  -- ligne d'événement, celle du joueur, avec le propriétaire pour adversaire.
  ghost_id := nullif(ranked_match.state -> 'bot' ->> 'ghostOf', '')::uuid;
  if ghost_id is not null then
    if ghost_id not in (player_a, player_b) then
      return jsonb_build_object('status', 'invalid');
    end if;
    human_id := case when player_a = ghost_id then player_b else player_a end;

    select progress.* into progress_h
    from public.player_progress as progress
    where progress.user_id = human_id
    for update;
    select progress.* into progress_g
    from public.player_progress as progress
    where progress.user_id = ghost_id;

    if progress_h.user_id is null or progress_g.user_id is null then
      return jsonb_build_object('status', 'invalid');
    end if;

    points_h := private.ranked_effective_points(progress_h.ranked_points, progress_h.ranked_matches);
    -- SON PROPRE CLASSEMENT (13/10/2026) : la première partie part du niveau
    -- du propriétaire, les suivantes de la note que le fantôme s'est faite.
    insert into public.ghost_ratings(owner_id, points)
    values (ghost_id, private.ranked_effective_points(progress_g.ranked_points, progress_g.ranked_matches))
    on conflict (owner_id) do nothing;
    select rating.points into points_g
    from public.ghost_ratings as rating
    where rating.owner_id = ghost_id
    for update;
    expected_h := 1.0 / (1.0 + power(10.0, (points_g - points_h) / 400.0));
    actual_h := case
      when ranked_match.winner_id is null then 0.5
      when ranked_match.winner_id = human_id then 1.0
      else 0.0
    end;
    k_h := case when progress_h.ranked_matches < 5 then 64 else 40 end;
    delta_h := round(k_h * (actual_h - expected_h));
    next_h := greatest(0, points_h + delta_h);

    update public.player_progress
    set ranked_points = next_h,
        ranked_matches = ranked_matches + 1,
        ranked_wins = ranked_wins + case when actual_h = 1 then 1 else 0 end,
        ranked_losses = ranked_losses + case when actual_h = 0 then 1 else 0 end,
        ranked_draws = ranked_draws + case when actual_h = 0.5 then 1 else 0 end,
        ranked_peak_points = greatest(ranked_peak_points, next_h),
        updated_at = pg_catalog.clock_timestamp()
    where user_id = human_id;

    insert into public.ranked_rating_events(
      match_id, user_id, opponent_id, points_before, points_after,
      points_delta, expected_score, actual_score, placement_number
    )
    values (
      p_match_id, human_id, ghost_id, points_h, next_h,
      delta_h, expected_h, actual_h, least(5, progress_h.ranked_matches + 1)
    );

    -- Le fantôme encaisse le résultat inverse, comme un joueur établi (K = 40).
    delta_g := round(40 * ((1.0 - actual_h) - (1.0 - expected_h)));
    next_g := greatest(0, points_g + delta_g);
    update public.ghost_ratings
    set points = next_g,
        matches = matches + 1,
        wins = wins + case when actual_h = 0 then 1 else 0 end,
        losses = losses + case when actual_h = 1 then 1 else 0 end,
        draws = draws + case when actual_h = 0.5 then 1 else 0 end,
        updated_at = pg_catalog.clock_timestamp()
    where owner_id = ghost_id;

    return jsonb_build_object(
      'status', 'applied',
      'ghost', true,
      'ghostPoints', jsonb_build_object('before', points_g, 'after', next_g),
      'player', jsonb_build_object(
        'userId', human_id,
        'pointsBefore', points_h,
        'pointsAfter', next_h,
        'delta', delta_h,
        'placements', least(5, progress_h.ranked_matches + 1)
      )
    );
  end if;

  select progress.*
  into progress_a
  from public.player_progress as progress
  where progress.user_id = player_a
  for update;
  select progress.*
  into progress_b
  from public.player_progress as progress
  where progress.user_id = player_b
  for update;

  if progress_a.user_id is null or progress_b.user_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  points_a := private.ranked_effective_points(
    progress_a.ranked_points,
    progress_a.ranked_matches
  );
  points_b := private.ranked_effective_points(
    progress_b.ranked_points,
    progress_b.ranked_matches
  );
  expected_a := 1.0 / (1.0 + power(10.0, (points_b - points_a) / 400.0));
  expected_b := 1.0 - expected_a;

  if ranked_match.winner_id is null then
    actual_a := 0.5;
    actual_b := 0.5;
  elsif ranked_match.winner_id = player_a then
    actual_a := 1.0;
    actual_b := 0.0;
  else
    actual_a := 0.0;
    actual_b := 1.0;
  end if;

  k_a := case when progress_a.ranked_matches < 5 then 64 else 40 end;
  k_b := case when progress_b.ranked_matches < 5 then 64 else 40 end;
  delta_a := round(k_a * (actual_a - expected_a));
  delta_b := round(k_b * (actual_b - expected_b));
  next_a := greatest(0, points_a + delta_a);
  next_b := greatest(0, points_b + delta_b);

  update public.player_progress
  set ranked_points = next_a,
      ranked_matches = ranked_matches + 1,
      ranked_wins = ranked_wins + case when actual_a = 1 then 1 else 0 end,
      ranked_losses = ranked_losses + case when actual_a = 0 then 1 else 0 end,
      ranked_draws = ranked_draws + case when actual_a = 0.5 then 1 else 0 end,
      ranked_peak_points = greatest(ranked_peak_points, next_a),
      updated_at = pg_catalog.clock_timestamp()
  where user_id = player_a;

  update public.player_progress
  set ranked_points = next_b,
      ranked_matches = ranked_matches + 1,
      ranked_wins = ranked_wins + case when actual_b = 1 then 1 else 0 end,
      ranked_losses = ranked_losses + case when actual_b = 0 then 1 else 0 end,
      ranked_draws = ranked_draws + case when actual_b = 0.5 then 1 else 0 end,
      ranked_peak_points = greatest(ranked_peak_points, next_b),
      updated_at = pg_catalog.clock_timestamp()
  where user_id = player_b;

  insert into public.ranked_rating_events(
    match_id,
    user_id,
    opponent_id,
    points_before,
    points_after,
    points_delta,
    expected_score,
    actual_score,
    placement_number
  )
  values
    (
      p_match_id,
      player_a,
      player_b,
      points_a,
      next_a,
      delta_a,
      expected_a,
      actual_a,
      least(5, progress_a.ranked_matches + 1)
    ),
    (
      p_match_id,
      player_b,
      player_a,
      points_b,
      next_b,
      delta_b,
      expected_b,
      actual_b,
      least(5, progress_b.ranked_matches + 1)
    );

  return jsonb_build_object(
    'status', 'applied',
    'playerA', jsonb_build_object(
      'userId', player_a,
      'pointsBefore', points_a,
      'pointsAfter', next_a,
      'delta', delta_a,
      'placements', least(5, progress_a.ranked_matches + 1)
    ),
    'playerB', jsonb_build_object(
      'userId', player_b,
      'pointsBefore', points_b,
      'pointsAfter', next_b,
      'delta', delta_b,
      'placements', least(5, progress_b.ranked_matches + 1)
    )
  );
end;
$$;

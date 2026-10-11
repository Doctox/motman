-- ─────────────────────────────────────────────────────────────────────────────────
-- LE FANTÔME DU PROPRIÉTAIRE EN CLASSÉE (11/10/2026)
--
-- Le propriétaire joue les classées pour que les joueurs aient un adversaire.
-- Quand il n'est pas là, son fantôme prend sa place : un bot réglé sur SA façon
-- de jouer (src/ghostOpponent.ts), présenté sous son nom, son avatar et son
-- niveau — sans mention, à sa demande.
--
-- QUAND. Un joueur cherche une classée depuis une minute, et moins de deux
-- joueurs sont en ligne (lui compris). Si le propriétaire est en ligne, il est
-- compté : le fantôme s'efface, et c'est la notification de recherche classée
-- qui le prévient.
--
-- COMMENT. Comme une vraie classée : la confirmation « Adversaire trouvé »
-- s'ouvre, le fantôme l'a déjà acceptée, le joueur a trente secondes. La partie
-- est un match de bot (`state.bot`) dont l'identifiant est celui du
-- propriétaire et qui porte `ghostOf`. Le joueur seul est inscrit dans
-- `match_participants` : rien ne fait apparaître le vrai compte dans la partie
-- — ni son menu, ni ses notifications, ni le droit d'y jouer un coup.
--
-- LES POINTS. Le joueur gagne ou perd comme contre le propriétaire en personne,
-- calculé sur le vrai classement de celui-ci ; le classement du propriétaire ne
-- bouge jamais (`server_apply_ranked_result_atomic`, branche du fantôme).
--
-- Les procédures de confirmation et d'expiration restent telles quelles : elles
-- ne font que mettre à jour ou effacer les recherches EXISTANTES, et le
-- propriétaire, absent par définition, n'en a pas.
-- ─────────────────────────────────────────────────────────────────────────────────

-- L'INTERRUPTEUR DU PROPRIÉTAIRE. Il allume ou éteint son fantôme depuis le
-- pouls du jeu (src/menu/GamePulse.tsx) ; `match-api` revérifie son rôle en
-- base avant d'écrire. Sans ligne, le fantôme est allumé.
create table if not exists public.owner_switches (
  name text primary key check (name in ('fantome')),
  enabled boolean not null,
  updated_at timestamptz not null default now()
);

alter table public.owner_switches enable row level security;
revoke all on public.owner_switches from public, anon, authenticated;
grant all on public.owner_switches to service_role;

insert into public.owner_switches(name, enabled) values ('fantome', true)
on conflict (name) do nothing;

create or replace function public.server_create_ranked_ghost_match_atomic(
  p_user_id uuid,
  p_ghost_id uuid,
  p_grid_id text,
  p_state jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  own_search public.server_ranked_searches%rowtype;
  created_match public.server_matches%rowtype;
  created_ready public.server_ranked_ready_sessions%rowtype;
  paused_match uuid;
  en_ligne integer;
begin
  -- Le même verrou que l'appariement : un vrai adversaire et le fantôme ne
  -- peuvent pas se disputer le même joueur.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('motman:ranked-matchmaking', 0)
  );

  if p_user_id = p_ghost_id then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- Éteint par le propriétaire : on attend un vrai adversaire, comme avant.
  if not coalesce((select switch.enabled from public.owner_switches as switch where switch.name = 'fantome'), true) then
    return jsonb_build_object('status', 'waiting');
  end if;

  if not exists (
    select 1 from public.profiles as profile
    where profile.id = p_ghost_id and profile.role = 'admin' and profile.status = 'active'
  ) or not exists (
    select 1 from public.player_progress as progress where progress.user_id = p_ghost_id
  ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  if p_state is null
    or p_grid_id is null
    or p_state -> 'playerIds' is distinct from jsonb_build_array(p_user_id, p_ghost_id)
    or p_state -> 'bot' ->> 'playerId' is distinct from p_ghost_id::text
    or p_state -> 'bot' ->> 'ghostOf' is distinct from p_ghost_id::text
  then
    return jsonb_build_object('status', 'invalid');
  end if;

  if exists (
    select 1
    from public.server_matches as match
    join public.match_participants as participant
      on participant.match_id = match.id
     and participant.user_id = p_user_id
    where match.mode = 'ranked'
      and match.status in ('pending', 'active')
  ) then
    return jsonb_build_object('status', 'already-playing');
  end if;

  -- Une recherche ouverte depuis une minute, vivante, libre.
  select search.* into own_search
  from public.server_ranked_searches as search
  where search.user_id = p_user_id
    and search.status = 'searching'
    and search.ready_session_id is null
    and (search.claim_expires_at is null or search.claim_expires_at <= pg_catalog.clock_timestamp())
    and search.created_at <= pg_catalog.clock_timestamp() - interval '1 minute'
    and search.updated_at > pg_catalog.clock_timestamp() - interval '2 minutes'
  for update;
  if not found then
    return jsonb_build_object('status', 'waiting');
  end if;

  -- Moins de deux joueurs en ligne, le chercheur compris.
  select count(*)::integer into en_ligne
  from public.profiles as profile
  where profile.status = 'active'
    and profile.last_seen > pg_catalog.clock_timestamp() - interval '75 seconds';
  if en_ligne >= 2 then
    return jsonb_build_object('status', 'waiting');
  end if;

  if exists (
    select 1 from public.blocks as block
    where (block.owner_id = p_user_id and block.blocked_id = p_ghost_id)
       or (block.owner_id = p_ghost_id and block.blocked_id = p_user_id)
  ) or not exists (
    select 1 from public.server_grid_catalog as grid
    where grid.id = p_grid_id and grid.active is true
  ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  insert into public.server_matches(
    mode, pace, grid_id, state, status, current_player_id, turn_number, turn_started_at, turn_ends_at
  )
  values ('ranked', 'realtime', p_grid_id, p_state, 'pending', p_user_id, 1, null, null)
  returning * into created_match;

  -- Le joueur seul : comme pour tout bot, `opponent_id` reste vide.
  insert into public.match_participants(match_id, user_id, opponent_id)
  values (created_match.id, p_user_id, null);

  -- Le fantôme a déjà accepté : il ne reste que la réponse du joueur.
  insert into public.server_ranked_ready_sessions(
    match_id, player_a_id, player_b_id, player_b_accepted, expires_at
  )
  values (
    created_match.id, p_user_id, p_ghost_id, true,
    pg_catalog.clock_timestamp() + interval '30 seconds'
  )
  returning * into created_ready;

  paused_match := private.pause_realtime_normal_for_ranked(p_user_id, created_ready.id);
  update public.server_ranked_ready_sessions
  set player_a_paused_match_id = paused_match,
      updated_at = pg_catalog.clock_timestamp()
  where id = created_ready.id;

  update public.server_ranked_searches
  set status = 'ready',
      ready_session_id = created_ready.id,
      claim_token = null,
      claimed_by = null,
      claim_expires_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where user_id = p_user_id;

  return jsonb_build_object(
    'status', 'ready',
    'readySessionId', created_ready.id,
    'matchId', created_match.id,
    'opponentId', p_ghost_id,
    'created', true
  );
end;
$$;

revoke all on function public.server_create_ranked_ghost_match_atomic(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.server_create_ranked_ghost_match_atomic(uuid, uuid, text, jsonb)
  to service_role;

-- Recopiée de 20260729230940 : seule la branche du fantôme s'ajoute.
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
    points_g := private.ranked_effective_points(progress_g.ranked_points, progress_g.ranked_matches);
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

    return jsonb_build_object(
      'status', 'applied',
      'ghost', true,
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

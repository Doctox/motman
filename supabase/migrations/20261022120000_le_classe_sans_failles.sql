-- ─────────────────────────────────────────────────────────────────────────────
-- LE CLASSÉ SANS FAILLES (22/10/2026)
--
-- Quatre trous relevés par l'audit de sécurité du 22/10, retenus par le
-- propriétaire (codes U1, U7, S1 et S4 du grand tour) :
--
--   U1. « Quitter pour le classé » acceptait une classée EN COURS comme partie
--       quittée, avec pour témoin n'importe quelle classée des dernières 26 h.
--       Une requête forgée changeait donc une classée perdue en égalité, sans
--       perte de points. Rien n'indique que ce soit arrivé : aucune des 17
--       sorties `ranked_transfer` en base ne vient d'une classée.
--   U7. Le défi du jour se dédoublait quand deux demandes arrivaient à la même
--       seconde (l'incident du 14/09) : le contrôle et la création se faisaient
--       en deux temps. Un index unique ferme la porte en base.
--   S1. Les forfaits arrangés entre deux comptes d'un même joueur.
--   S4. La vue qui porte les réponses de toutes les grilles ne devait sa
--       fermeture qu'aux droits par défaut ; elle est fermée en toutes lettres.
--
-- Les fonctions sont recopiées de leur dernière version (md5 vérifié contre la
-- production le 22/10/2026), puis modifiées aux seuls endroits commentés.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── U1. Quitter pour le classé : seulement une partie ordinaire, seulement pour
--    une classée qui vient VRAIMENT de s'ouvrir ────────────────────────────────
create or replace function public.server_finish_match_for_ranked_transfer(
  p_user_id uuid,
  p_match_id uuid,
  p_ranked_match_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ferme boolean := false;
  v_ouverture timestamptz;
begin
  if p_user_id is null or p_match_id is null or p_ranked_match_id is null then
    return false;
  end if;

  -- Le match classé doit être celui de ce joueur, classé, EN COURS, et ouvert
  -- depuis moins de dix minutes : c'est l'arène qu'il rejoint à l'instant, pas
  -- une vieille classée gardée comme « témoin ».
  select arene.created_at
  into v_ouverture
  from public.server_matches arene
  join public.match_participants participant
    on participant.match_id = arene.id
   and participant.user_id = p_user_id
  where arene.id = p_ranked_match_id
    and arene.mode = 'ranked'
    and arene.status = 'active'
    and arene.created_at > pg_catalog.clock_timestamp() - interval '10 minutes';

  if v_ouverture is null then
    return false;
  end if;

  -- La partie quittée doit être la sienne, encore active, NON classée, et
  -- antérieure à l'arène. Une classée ne se quitte jamais par ce chemin : on
  -- l'abandonne, et l'abandon compte.
  update public.server_matches quittee
  set status = 'finished',
      current_player_id = null,
      winner_id = null,
      finish_reason = 'ranked_transfer',
      turn_started_at = pg_catalog.clock_timestamp(),
      turn_ends_at = pg_catalog.clock_timestamp(),
      paused_at = null,
      pause_reason = null,
      paused_remaining_ms = null,
      ranked_ready_session_id = null,
      updated_at = pg_catalog.clock_timestamp()
  where quittee.id = p_match_id
    and quittee.id <> p_ranked_match_id
    and quittee.mode <> 'ranked'
    and quittee.status = 'active'
    and quittee.created_at < v_ouverture
    and exists (
      select 1
      from public.match_participants participant
      where participant.match_id = quittee.id
        and participant.user_id = p_user_id
    );

  get diagnostics v_ferme = row_count;
  return v_ferme;
end;
$$;

revoke all on function public.server_finish_match_for_ranked_transfer(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.server_finish_match_for_ranked_transfer(uuid, uuid, uuid)
  to service_role;

-- ── U7. Un seul défi du jour ACTIF par joueur et par jour ───────────────────
-- Le joueur du défi est toujours le premier de `playerIds` (createMatch le pose
-- en hôte, le bot en second). match-api reconnaît le refus (23505) et rend le
-- défi déjà ouvert, comme quand il le reprend.
create unique index if not exists server_matches_un_defi_actif_par_jour
  on public.server_matches ((state ->> 'dailyDate'), (state -> 'playerIds' ->> 0))
  where (state ->> 'isDaily') = 'true' and status = 'active';

-- ── S1. Le motif d'une classée jouée sans points ─────────────────────────────
alter table public.ranked_rating_events
  add column if not exists sans_points text
  check (sans_points in ('abandon-rapide', 'plafond-paire'));

comment on column public.ranked_rating_events.sans_points is
  'Pourquoi cette classée n''a rien rapporté : abandon avant le 3e tour du perdant, ou plus de 3 classées comptées entre ces deux joueurs ce jour-là. Voir 20261022120000_le_classe_sans_failles.sql.';

-- ── S1. Le résultat classé (recopié de 20261013160000) ───────────────────────
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
  v_sans_points text;
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
  -- Un joueur de l'ombre (13/10/2026) n'est PAS le fantôme du propriétaire : sa
  -- note est celle de son compte, et la voie ordinaire, plus bas, la fait
  -- bouger comme celle de son adversaire.
  if ghost_id is not null and not exists (
    select 1 from public.profiles as profile where profile.id = ghost_id and profile.role = 'admin'
  ) then
    ghost_id := null;
  end if;
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

  -- ── VICTOIRE SANS POINTS (22/10/2026) ────────────────────────────────────
  -- Depuis que les revanches sont libres (16/10), deux comptes d'un même joueur
  -- pouvaient s'enchaîner : l'un abandonne en deux secondes, l'autre empoche
  -- les points. Deux parades, décidées par le propriétaire :
  --   • ABANDON RAPIDE : une classée gagnée par abandon ou par absence avant le
  --     3e tour du perdant (6e tour de la partie) ne rapporte rien au
  --     vainqueur. Le perdant perd quand même : refuser de jouer reste puni, et
  --     l'abandon arrangé ne rapporte plus rien ;
  --   • PLAFOND PAR PAIRE : passé 3 classées comptées entre deux mêmes joueurs
  --     dans la journée (heure de Paris), les suivantes se jouent sans points.
  --     Les joueurs de l'ombre en sont exemptés : on ne triche pas avec eux, et
  --     un joueur seul la nuit les retrouve souvent.
  -- Le motif est noté dans `ranked_rating_events.sans_points` : l'écran de fin
  -- dit pourquoi le compteur n'a pas bougé.
  if ranked_match.finish_reason in ('forfeit', 'timeout')
    and coalesce(ranked_match.turn_number, 0) < 6
  then
    v_sans_points := 'abandon-rapide';
    if actual_a = 1 then
      delta_a := 0;
    elsif actual_b = 1 then
      delta_b := 0;
    end if;
  elsif not exists (
      select 1
      from public.shadow_players as ombre
      where ombre.user_id in (player_a, player_b)
    )
    and (
      select count(*)
      from public.ranked_rating_events as event
      where event.user_id = player_a
        and event.opponent_id = player_b
        and (event.created_at at time zone 'Europe/Paris')::date
          = (pg_catalog.clock_timestamp() at time zone 'Europe/Paris')::date
    ) >= 3
  then
    v_sans_points := 'plafond-paire';
    delta_a := 0;
    delta_b := 0;
  end if;

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
    placement_number,
    sans_points
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
      least(5, progress_a.ranked_matches + 1),
      v_sans_points
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
      least(5, progress_b.ranked_matches + 1),
      v_sans_points
    );

  return jsonb_build_object(
    'status', 'applied',
    'sansPoints', v_sans_points,
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

-- ── S4. La vue des réponses : fermée en toutes lettres ──────────────────────
-- Elle était déjà fermée (droits par défaut, vérifié le 22/10/2026). Elle le
-- reste si elle est un jour recréée autrement, et lit avec les droits de qui
-- l'interroge, plus avec ceux de son propriétaire.
revoke all on public.server_grid_selection from public, anon, authenticated;
alter view public.server_grid_selection set (security_invoker = true);
grant select on public.server_grid_selection to service_role;

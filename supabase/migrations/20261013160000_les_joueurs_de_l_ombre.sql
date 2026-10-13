-- ─────────────────────────────────────────────────────────────────────────────────
-- LES JOUEURS DE L'OMBRE (13/10/2026)
--
-- Le propriétaire a voulu de la variété en classée quand personne n'est en
-- ligne : son fantôme, plus six joueurs de l'ombre, chacun avec sa force, son
-- niveau, son avatar et SA note. Il les a validés un par un ; ils arrivent l'un
-- après l'autre, tous les trois jours.
--
-- CE SONT DE VRAIS COMPTES, marqués dans `shadow_players` et nulle part
-- ailleurs. Pas de rôle à part : `profiles` est lisible par tout joueur
-- connecté, un rôle « shadow » s'y lirait. Un compte non anonyme, sans e-mail,
-- qui ne se connecte jamais — `cleanup_inactive_guests` ne touche que les
-- anonymes. Comme vrais comptes, ils ont tout naturellement un profil public,
-- une note et une place au tableau classé après 5 parties.
--
-- CE QU'ILS NE DOIVENT PAS FAUSSER :
--   - le pouls du propriétaire : exclus de tous ses comptages de joueurs ;
--   - la recherche d'amis et les demandes : social-api les écarte ;
--   - « en ligne » : créés avec un `last_seen` ancien, ils ne le sont jamais.
--
-- COMMENT ILS JOUENT : comme le fantôme (même procédure, même règle d'entrée :
-- une minute d'attente, moins de deux joueurs en ligne, interrupteur commun).
-- Mais leurs résultats passent par la voie ORDINAIRE de
-- `server_apply_ranked_result_atomic` : leur note est celle de leur compte, et
-- elle bouge comme celle d'un joueur.
--
-- CHAQUE MOIS, chacun change d'avatar OU de cadre, comme un joueur qui dépense
-- ses plumes (`private.renouveler_ombres`, le 1er à 9 h UTC).
-- ─────────────────────────────────────────────────────────────────────────────────

create table if not exists public.shadow_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Les réglages du bot (src/botOpponents.ts, BotTuning), mesurés en simulation.
  tuning jsonb not null,
  -- Avant cette heure, il n'existe pour personne : ni adversaire, ni classement.
  arrives_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.shadow_players enable row level security;
revoke all on public.shadow_players from public, anon, authenticated;
grant all on public.shadow_players to service_role;

comment on table public.shadow_players is
  'Les joueurs de l''ombre : des comptes qui ne jouent qu''en classée, quand personne n''est en ligne. Voir 20261013160000_les_joueurs_de_l_ombre.sql.';

-- ── Les six ─────────────────────────────────────────────────────────────────
-- Leur création — pseudo, niveau, titre, avatar, réglages, rang d'arrivée — ne
-- se lit PAS ici : le dépôt est public, et un pseudo dirait à n'importe qui
-- lequel de ses adversaires est une ombre. Elle vit dans l'atelier privé
-- (`supabase/prive/ombres_creation_20261013.sql`) et a été appliquée en
-- production avec cette migration, le 13/10/2026.

-- ── Chaque mois, un avatar ou un cadre neuf ──────────────────────────────────
create or replace function private.renouveler_ombres(p_mois text default pg_catalog.to_char(pg_catalog.now(), 'YYYY-MM'))
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ombre record;
  avatars constant text[] := array[
    'lapin', 'loutre', 'panda',
    'drapeau-france', 'drapeau-italie', 'drapeau-portugal', 'drapeau-espagne', 'drapeau-canada',
    'drapeau-suisse', 'drapeau-maroc', 'drapeau-algerie', 'drapeau-tunisie', 'drapeau-senegal',
    'drapeau-cote-divoire', 'drapeau-bresil', 'drapeau-japon'
  ];
  -- Les cadres d'un joueur modeste, puis ceux qu'on s'offre en montant.
  cadres_simples constant text[] := array[
    'cadre-ivoire', 'cadre-sauge', 'cadre-terracotta', 'cadre-encre', 'cadre-laiton',
    'cadre-rosee', 'cadre-coquelicot', 'cadre-porcelaine'
  ];
  cadres_riches constant text[] := array[
    'cadre-herbier', 'cadre-maree', 'cadre-bibliotheque', 'cadre-braise', 'cadre-royal', 'cadre-encrier',
    'cadre-clair-de-lune', 'cadre-givre', 'cadre-aurore'
  ];
  choix integer;
  liste text[];
  neuf text;
  changes integer := 0;
begin
  for ombre in
    select p.id, p.avatar_id, p.frame_id, coalesce(pp.level, 1) as niveau
    from public.shadow_players s
    join public.profiles p on p.id = s.user_id
    left join public.player_progress pp on pp.user_id = s.user_id
  loop
    choix := abs(pg_catalog.hashtext(ombre.id::text || ':' || p_mois));
    if choix % 2 = 0 then
      liste := avatars;
      neuf := liste[1 + (choix / 2) % pg_catalog.array_length(liste, 1)];
      if neuf = ombre.avatar_id then neuf := liste[1 + ((choix / 2) + 1) % pg_catalog.array_length(liste, 1)]; end if;
      update public.profiles set avatar_id = neuf, updated_at = pg_catalog.now() where id = ombre.id;
    else
      liste := case when ombre.niveau >= 20 then cadres_simples || cadres_riches else cadres_simples end;
      neuf := liste[1 + (choix / 2) % pg_catalog.array_length(liste, 1)];
      if neuf = ombre.frame_id then neuf := liste[1 + ((choix / 2) + 1) % pg_catalog.array_length(liste, 1)]; end if;
      update public.profiles set frame_id = neuf, updated_at = pg_catalog.now() where id = ombre.id;
    end if;
    changes := changes + 1;
  end loop;
  return changes;
end;
$$;

revoke all on function private.renouveler_ombres(text) from public, anon, authenticated;

do $$
declare v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'motman-renouveler-ombres'
  loop perform cron.unschedule(v_job_id); end loop;
end;
$$;

select cron.schedule(
  'motman-renouveler-ombres',
  '0 9 1 * *',
  'select private.renouveler_ombres();'
);

-- ── La procédure d'entrée accepte les ombres arrivées (recopiée de 20261011120000) ──
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

  -- Le fantôme du propriétaire, ou un joueur de l'ombre déjà arrivé (13/10/2026).
  if not exists (
    select 1 from public.profiles as profile
    where profile.id = p_ghost_id and profile.status = 'active'
      and (
        profile.role = 'admin'
        or exists (
          select 1 from public.shadow_players as ombre
          where ombre.user_id = p_ghost_id and ombre.arrives_at <= pg_catalog.clock_timestamp()
        )
      )
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

-- ── Le résultat : le fantôme du propriétaire seul a sa branche (recopiée de 20261013120000) ──
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

-- ── Le pouls ne compte pas les ombres (recopié de 20260921110000) ──
create or replace function public.server_game_pulse(p_moi uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with bornes as (
    select
      (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') as debut_du_jour,
      pg_catalog.now() - interval '75 seconds' as seuil_en_ligne,
      pg_catalog.now() - interval '7 days' as seuil_semaine,
      pg_catalog.to_char(pg_catalog.now() at time zone 'Europe/Paris', 'YYYY-MM-DD') as jour,
      (pg_catalog.now() at time zone 'Europe/Paris')::date as jour_date
  ),
  -- Ses parties à lui, écartées d'un bloc : il joue pour tester, et ça
  -- gonflerait le seul chiffre qu'il regarde.
  miennes as (
    select mp.match_id
    from public.match_participants mp
    where mp.user_id = p_moi
  )
  select jsonb_build_object(
    'jour', (select jour from bornes),
    'enLigne', (select count(*) from public.profiles, bornes
                where last_seen > seuil_en_ligne and id is distinct from p_moi
                  and not exists (select 1 from public.shadow_players s where s.user_id = profiles.id)),
    'actifsDuJour', (select count(*) from public.profiles, bornes
                     where last_seen >= debut_du_jour and id is distinct from p_moi
                  and not exists (select 1 from public.shadow_players s where s.user_id = profiles.id)),
    'actifsSeptJours', (select count(*) from public.profiles, bornes
                        where last_seen >= seuil_semaine and id is distinct from p_moi
                  and not exists (select 1 from public.shadow_players s where s.user_id = profiles.id)),
    'nouveauxDuJour', (select count(*) from public.profiles, bornes
                       where created_at >= debut_du_jour and id is distinct from p_moi
                  and not exists (select 1 from public.shadow_players s where s.user_id = profiles.id)),
    'comptes', (select count(*) from public.profiles
                where account_kind = 'account' and id is distinct from p_moi
                  and not exists (select 1 from public.shadow_players s where s.user_id = profiles.id)),
    'partiesDuJour', (select count(*) from public.server_matches m, bornes
                      where m.created_at >= debut_du_jour
                        and not exists (select 1 from miennes where miennes.match_id = m.id)),
    -- `daily_plays.day` est une DATE : la comparer au texte du jour échoue.
    'defisDuJour', (select count(*) from public.daily_plays, bornes
                    where day = jour_date and user_id is distinct from p_moi),
    -- Une ligne par JOUEUR : sans `distinct`, chaque duel comptait double. Et
    -- l'exclusion porte sur la PARTIE, pas sur la ligne : écarter la sienne en
    -- gardant celle de son adversaire aurait laissé le duel dans le compte.
    'classeesSeptJours', (select count(distinct e.match_id) from public.ranked_rating_events e, bornes
                          where e.created_at >= seuil_semaine
                            and not exists (select 1 from miennes where miennes.match_id = e.match_id)),
    -- Le seul nombre qui appelle une ACTION, et le seul compté sans exclusion.
    'signalementsOuverts', (select count(*) from public.reports where status = 'open'),
    'signalementPlusAncienHeures', (
      select coalesce(floor(extract(epoch from pg_catalog.now() - min(created_at)) / 3600)::int, 0)
      from public.reports where status = 'open')
  );
$$;

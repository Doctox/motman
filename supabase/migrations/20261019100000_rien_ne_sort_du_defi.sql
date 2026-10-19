-- ─────────────────────────────────────────────────────────────────────────────────
-- RIEN NE FAIT SORTIR D'UN DÉFI DU JOUR EN COURS (19/10/2026)
--
-- Le propriétaire lance une recherche, classée ou normale, puis joue son défi
-- du jour en attendant. « Quand je suis en train de jouer mon défi, rien ne
-- doit m'en sortir. » Or :
--   - une classée trouvée ouvrait la confirmation PAR-DESSUS le défi : accepter
--     le faisait quitter, ne pas répondre arrêtait sa recherche. La mise en
--     pause d'une partie pour le classé (`private.pause_realtime_normal_for_ranked`)
--     ne vise que les parties normales entre humains, jamais le défi ;
--   - le fantôme et les ombres entraient par le même chemin (match-api) ;
--   - en file normale, un autre joueur pouvait tomber sur lui pendant le défi,
--     et sa recherche, muette pendant la partie, était purgée à cinq minutes.
--
-- Désormais, tant qu'il a un défi du jour EN COURS (`private.en_plein_defi`) :
--   - il n'est proposé à personne, et personne ne lui est proposé ;
--   - sa recherche reste en file (la classée garde son battement, la normale
--     n'est plus purgée), et l'appariement reprend dès la fin du défi.
-- Seul le temps limité est concerné en file normale : une partie illimitée
-- n'interrompt rien.
--
-- Les trois fonctions sont recopiées à l'identique de leur dernière version
-- (vérifiées par md5 contre la production le 19/10/2026) : seules les gardes
-- marquées « 19/10/2026 » s'ajoutent. Le fantôme et la bascule sur un bot sont
-- gardés côté match-api, par `public.server_en_plein_defi`.
--
-- Garde : supabase/tests/daily_not_interrupted.sql.
-- ─────────────────────────────────────────────────────────────────────────────────

create or replace function private.en_plein_defi(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.server_matches as defi
    join public.match_participants as participant
      on participant.match_id = defi.id
     and participant.user_id = p_user_id
    where defi.status = 'active'
      and defi.mode = 'solo'
      and defi.state ->> 'isDaily' = 'true'
  );
$$;

revoke all on function private.en_plein_defi(uuid) from public, anon, authenticated;
grant execute on function private.en_plein_defi(uuid) to service_role;

comment on function private.en_plein_defi(uuid) is
  'Vrai si le joueur joue en ce moment son défi du jour : aucun appariement ne doit l''en faire sortir (19/10/2026).';

-- La même question, pour match-api (fantôme, bascule sur un bot).
create or replace function public.server_en_plein_defi(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.en_plein_defi(p_user_id);
$$;

revoke all on function public.server_en_plein_defi(uuid) from public, anon, authenticated;
grant execute on function public.server_en_plein_defi(uuid) to service_role;

create or replace function public.server_ranked_matchmake_atomic(
  p_user_id uuid,
  p_candidate_id uuid,
  p_claim_token uuid,
  p_grid_id text,
  p_state jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  own_progress public.player_progress%rowtype;
  candidate_search public.server_ranked_searches%rowtype;
  own_search public.server_ranked_searches%rowtype;
  created_match public.server_matches%rowtype;
  created_ready public.server_ranked_ready_sessions%rowtype;
  next_claim uuid;
  paused_a uuid;
  paused_b uuid;
  effective_points integer;
  effective_tier integer;
begin
  if p_user_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('motman:ranked-matchmaking', 0)
  );

  if exists (
    select 1
    from public.server_matches as match
    join public.match_participants as participant
      on participant.match_id = match.id
     and participant.user_id = p_user_id
    where match.mode = 'ranked'
      and match.status in ('pending', 'active')
  ) then
    select search.*
    into own_search
    from public.server_ranked_searches as search
    where search.user_id = p_user_id;

    if found and own_search.ready_session_id is not null then
      return jsonb_build_object(
        'status', 'ready',
        'readySessionId', own_search.ready_session_id
      );
    end if;
    return jsonb_build_object('status', 'already-playing');
  end if;

  select progress.*
  into own_progress
  from public.player_progress as progress
  where progress.user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  effective_points := private.ranked_effective_points(
    own_progress.ranked_points,
    own_progress.ranked_matches
  );
  effective_tier := private.ranked_tier_index(effective_points);

  update public.server_ranked_searches
  set claim_token = null,
      claimed_by = null,
      claim_expires_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where claim_expires_at <= pg_catalog.clock_timestamp()
    and status = 'searching';

  insert into public.server_ranked_searches(
    user_id,
    status,
    rating_snapshot,
    tier_snapshot,
    placement_snapshot,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    'searching',
    effective_points,
    effective_tier,
    least(5, own_progress.ranked_matches),
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  )
  on conflict (user_id) do update
  set rating_snapshot = excluded.rating_snapshot,
      tier_snapshot = excluded.tier_snapshot,
      placement_snapshot = excluded.placement_snapshot,
      updated_at = excluded.updated_at
  -- LE BATTEMENT (10/10/2026). Chaque appel d'un joueur qui cherche rafraîchit
  -- `updated_at`, que ses chiffres aient changé ou non. Avant, la mise à jour
  -- n'avait lieu QUE si le classement du joueur avait bougé : une recherche
  -- ordinaire gardait son heure de création, sortait du filtre de fraîcheur
  -- (deux minutes, plus bas) et devenait invisible aux autres, puis la purge
  -- l'effaçait à cinq minutes. Le déclencheur de réveil ignore une mise à jour
  -- qui ne change pas le statut : ce battement ne réveille personne.
  where public.server_ranked_searches.status = 'searching';

  if p_candidate_id is not null and p_claim_token is not null then
    select search.*
    into candidate_search
    from public.server_ranked_searches as search
    where search.user_id = p_candidate_id
      and search.status = 'searching'
      and search.claim_token = p_claim_token
      and search.claimed_by = p_user_id
      and search.claim_expires_at > pg_catalog.clock_timestamp()
    for update;

    select search.*
    into own_search
    from public.server_ranked_searches as search
    where search.user_id = p_user_id
      and search.status = 'searching'
      and search.claim_token = p_claim_token
      and search.claimed_by = p_user_id
      and search.claim_expires_at > pg_catalog.clock_timestamp()
    for update;

    if found and candidate_search.user_id is not null then
      if p_candidate_id = p_user_id
        or p_grid_id is null
        or p_state is null
        or p_state -> 'playerIds'
          is distinct from jsonb_build_array(p_candidate_id, p_user_id)
        or abs(candidate_search.tier_snapshot - own_search.tier_snapshot) > 1
        -- L'un ou l'autre en plein défi du jour : rien ne l'en fait sortir.
        or private.en_plein_defi(p_candidate_id)
        or private.en_plein_defi(p_user_id)
        or not exists (
          select 1
          from public.server_grid_catalog as grid
          where grid.id = p_grid_id
            and grid.active is true
        )
        or exists (
          select 1
          from public.blocks as block
          where (block.owner_id = p_user_id and block.blocked_id = p_candidate_id)
             or (block.owner_id = p_candidate_id and block.blocked_id = p_user_id)
        )
      then
        update public.server_ranked_searches
        set claim_token = null,
            claimed_by = null,
            claim_expires_at = null,
            updated_at = pg_catalog.clock_timestamp()
        where user_id in (p_user_id, p_candidate_id);
        return jsonb_build_object('status', 'retry');
      end if;

      insert into public.server_matches(
        mode,
        pace,
        grid_id,
        state,
        status,
        current_player_id,
        turn_number,
        turn_started_at,
        turn_ends_at
      )
      values (
        'ranked',
        'realtime',
        p_grid_id,
        p_state,
        'pending',
        p_candidate_id,
        1,
        null,
        null
      )
      returning * into created_match;

      insert into public.match_participants(match_id, user_id, opponent_id)
      values
        (created_match.id, p_candidate_id, p_user_id),
        (created_match.id, p_user_id, p_candidate_id);

      insert into public.server_ranked_ready_sessions(
        match_id,
        player_a_id,
        player_b_id,
        expires_at
      )
      values (
        created_match.id,
        p_candidate_id,
        p_user_id,
        pg_catalog.clock_timestamp() + interval '30 seconds'
      )
      returning * into created_ready;

      paused_a := private.pause_realtime_normal_for_ranked(
        p_candidate_id,
        created_ready.id
      );
      paused_b := private.pause_realtime_normal_for_ranked(
        p_user_id,
        created_ready.id
      );

      update public.server_ranked_ready_sessions
      set player_a_paused_match_id = paused_a,
          player_b_paused_match_id = paused_b,
          updated_at = pg_catalog.clock_timestamp()
      where id = created_ready.id
      returning * into created_ready;

      update public.server_ranked_searches
      set status = 'ready',
          ready_session_id = created_ready.id,
          claim_token = null,
          claimed_by = null,
          claim_expires_at = null,
          updated_at = pg_catalog.clock_timestamp()
      where user_id in (p_user_id, p_candidate_id);

      return jsonb_build_object(
        'status', 'ready',
        'readySessionId', created_ready.id,
        'matchId', created_match.id,
        'opponentId', p_candidate_id,
        'created', true
      );
    end if;
  end if;

  select search.*
  into own_search
  from public.server_ranked_searches as search
  where search.user_id = p_user_id
  for update;

  if own_search.status = 'ready' and own_search.ready_session_id is not null then
    return jsonb_build_object(
      'status', 'ready',
      'readySessionId', own_search.ready_session_id
    );
  end if;

  if own_search.claim_token is not null
    and own_search.claim_expires_at > pg_catalog.clock_timestamp()
    and own_search.claimed_by <> p_user_id
  then
    return jsonb_build_object('status', 'waiting', 'claimed', true);
  end if;

  -- A casual match can only be suspended by one ready check at a time. If the
  -- caller is the opponent in somebody else's ready check, keep their ranked
  -- search alive but do not create a second overlapping transition.
  if exists (
    select 1
    from public.server_matches as paused_match
    join public.match_participants as paused_participant
      on paused_participant.match_id = paused_match.id
     and paused_participant.user_id = p_user_id
    where paused_match.status = 'active'
      and paused_match.paused_at is not null
      and paused_match.ranked_ready_session_id is not null
  ) then
    return jsonb_build_object('status', 'waiting', 'claimed', false);
  end if;

  -- EN PLEIN DÉFI DU JOUR (19/10/2026). « Quand je suis en train de jouer mon
  -- défi, rien ne doit m'en sortir » (propriétaire). Sa recherche reste en
  -- file — le battement ci-dessus la garde fraîche —, mais personne ne lui est
  -- proposé avant la fin du défi.
  if private.en_plein_defi(p_user_id) then
    return jsonb_build_object('status', 'waiting', 'claimed', false);
  end if;

  select search.*
  into candidate_search
  from public.server_ranked_searches as search
  join public.profiles as profile
    on profile.id = search.user_id
   and profile.status = 'active'
  where search.status = 'searching'
    and search.user_id <> p_user_id
    -- FRAÎCHEUR. `updated_at` est rafraîchi à chaque appel de cette fonction, et
    -- un client qui cherche l'appelle toutes les 8 s au premier plan, toutes les
    -- 15 s en arrière-plan (src/App.tsx). Une ligne muette depuis deux minutes —
    -- huit fois le pire intervalle — appartient donc à quelqu'un qui n'est plus
    -- là : app balayée, tuée, plantée, ou réseau perdu.
    --
    -- Sans ce filtre, elle restait appariable indéfiniment : le joueur présent
    -- était mis en face d'un fantôme, la fenêtre de confirmation s'ouvrait, et il
    -- attendait trente secondes pour rien. Constaté le 08/09/2026 sur une ligne
    -- en attente depuis huit jours.
    and search.updated_at > pg_catalog.clock_timestamp() - interval '2 minutes'
    and abs(search.tier_snapshot - own_search.tier_snapshot) <= 1
    -- Ni proposé à un autre tant qu'il joue son défi du jour (19/10/2026).
    and not private.en_plein_defi(search.user_id)
    and (
      search.claim_token is null
      or search.claim_expires_at <= pg_catalog.clock_timestamp()
    )
    and not exists (
      select 1
      from public.blocks as block
      where (block.owner_id = p_user_id and block.blocked_id = search.user_id)
         or (block.owner_id = search.user_id and block.blocked_id = p_user_id)
    )
    and not exists (
      select 1
      from public.server_matches as active_ranked
      join public.match_participants as ranked_participant
        on ranked_participant.match_id = active_ranked.id
       and ranked_participant.user_id = search.user_id
      where active_ranked.mode = 'ranked'
        and active_ranked.status in ('pending', 'active')
    )
    and not exists (
      select 1
      from public.server_matches as paused_match
      join public.match_participants as paused_participant
        on paused_participant.match_id = paused_match.id
       and paused_participant.user_id = search.user_id
      where paused_match.status = 'active'
        and paused_match.paused_at is not null
        and paused_match.ranked_ready_session_id is not null
    )
  order by
    abs(search.rating_snapshot - own_search.rating_snapshot),
    search.created_at,
    search.user_id
  for update of search skip locked
  limit 1;

  if found then
    next_claim := pg_catalog.gen_random_uuid();
    update public.server_ranked_searches
    set claim_token = next_claim,
        claimed_by = p_user_id,
        claim_expires_at = pg_catalog.clock_timestamp() + interval '20 seconds',
        updated_at = pg_catalog.clock_timestamp()
    where user_id in (p_user_id, candidate_search.user_id);

    return jsonb_build_object(
      'status', 'candidate',
      'opponentId', candidate_search.user_id,
      'claimToken', next_claim
    );
  end if;

  return jsonb_build_object('status', 'waiting', 'claimed', false);
end;
$$;

create or replace function public.server_matchmake_atomic(
  p_user_id uuid,
  p_pace text,
  p_candidate_id uuid,
  p_claim_token uuid,
  p_grid_id text,
  p_state jsonb,
  p_turn_started_at timestamptz,
  p_turn_ends_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate_search public.server_match_searches%rowtype;
  own_search public.server_match_searches%rowtype;
  created_match public.server_matches%rowtype;
  next_claim_token uuid;
begin
  if p_user_id is null or p_pace not in ('realtime', 'async') then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- A very short transaction-wide lock per pace makes discovery/reservation
  -- deterministic and avoids symmetric A->B / B->A queue races.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('motman:matchmaking:' || p_pace, 0)
  );

  update public.server_match_searches
  set claim_token = null,
      claimed_by = null,
      claim_expires_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where pace = p_pace
    and claim_expires_at <= pg_catalog.clock_timestamp();

  if p_candidate_id is not null and p_claim_token is not null then
    select search.*
    into candidate_search
    from public.server_match_searches as search
    where search.user_id = p_candidate_id
      and search.pace = p_pace
      and search.claim_token = p_claim_token
      and search.claimed_by = p_user_id
      and search.claim_expires_at > pg_catalog.clock_timestamp()
    for update;

    if found then
      if p_candidate_id = p_user_id
        or p_grid_id is null
        or p_state is null
        or p_turn_started_at is null
        or p_turn_ends_at is null
        or p_turn_ends_at <= p_turn_started_at
        or p_state -> 'playerIds' is distinct from jsonb_build_array(p_candidate_id, p_user_id)
        or not exists (
          select 1
          from public.server_grid_catalog as grid
          where grid.id = p_grid_id
            and grid.active is true
        )
        or exists (
          select 1
          from public.blocks as block
          where (block.owner_id = p_user_id and block.blocked_id = p_candidate_id)
             or (block.owner_id = p_candidate_id and block.blocked_id = p_user_id)
        )
        -- En temps limité, l'un ou l'autre en plein défi du jour (19/10/2026).
        or (p_pace = 'realtime' and (private.en_plein_defi(p_candidate_id) or private.en_plein_defi(p_user_id)))
        or not exists (
          select 1
          from public.profiles as profile
          where profile.id = p_candidate_id
            and profile.status = 'active'
        )
      then
        update public.server_match_searches
        set claim_token = null,
            claimed_by = null,
            claim_expires_at = null,
            updated_at = pg_catalog.clock_timestamp()
        where id = candidate_search.id;
        return jsonb_build_object('status', 'retry');
      end if;

      insert into public.server_matches (
        mode,
        pace,
        grid_id,
        state,
        status,
        current_player_id,
        turn_number,
        turn_started_at,
        turn_ends_at
      )
      values (
        'normal',
        p_pace,
        p_grid_id,
        p_state,
        'active',
        p_candidate_id,
        1,
        p_turn_started_at,
        p_turn_ends_at
      )
      returning * into created_match;

      insert into public.match_participants(match_id, user_id, opponent_id)
      values
        (created_match.id, p_candidate_id, p_user_id),
        (created_match.id, p_user_id, p_candidate_id);

      delete from public.server_match_searches
      where pace = p_pace
        and user_id in (p_user_id, p_candidate_id);

      return jsonb_build_object(
        'status', 'matched',
        'created', true,
        'matchId', created_match.id,
        'opponentId', p_candidate_id,
        'match', to_jsonb(created_match)
      );
    end if;
  end if;

  select search.*
  into own_search
  from public.server_match_searches as search
  where search.user_id = p_user_id
    and search.pace = p_pace
  for update;

  if found
    and own_search.claim_token is not null
    and own_search.claim_expires_at > pg_catalog.clock_timestamp()
    and own_search.claimed_by <> p_user_id
  then
    return jsonb_build_object('status', 'waiting', 'claimed', true);
  end if;

  -- EN PLEIN DÉFI DU JOUR (19/10/2026) : pas de partie en temps limité qui l'en
  -- ferait sortir. Sa recherche reste en file pour l'après-défi.
  if p_pace = 'realtime' and private.en_plein_defi(p_user_id) then
    return jsonb_build_object('status', 'waiting', 'claimed', false);
  end if;

  select search.*
  into candidate_search
  from public.server_match_searches as search
  join public.profiles as profile on profile.id = search.user_id
  where search.pace = p_pace
    and search.user_id <> p_user_id
    and profile.status = 'active'
    -- Ni proposé à un autre tant qu'il joue son défi du jour (19/10/2026).
    and (p_pace = 'async' or not private.en_plein_defi(search.user_id))
    and (search.claim_token is null or search.claim_expires_at <= pg_catalog.clock_timestamp())
    -- FRAÎCHEUR, en temps limité seulement. `updated_at` est rafraîchi à chaque
    -- sondage `state` du propriétaire (60 s au pire, en arrière-plan). Une ligne
    -- muette depuis deux minutes appartient à quelqu'un qui n'est plus là.
    and (
      p_pace = 'async'
      or search.updated_at > pg_catalog.clock_timestamp() - interval '2 minutes'
    )
    and not exists (
      select 1
      from public.blocks as block
      where (block.owner_id = p_user_id and block.blocked_id = search.user_id)
         or (block.owner_id = search.user_id and block.blocked_id = p_user_id)
    )
  order by search.created_at, search.id
  for update of search skip locked
  limit 1;

  if found then
    next_claim_token := pg_catalog.gen_random_uuid();
    update public.server_match_searches
    set claim_token = next_claim_token,
        claimed_by = p_user_id,
        claim_expires_at = pg_catalog.clock_timestamp() + interval '20 seconds',
        updated_at = pg_catalog.clock_timestamp()
    where id = candidate_search.id;

    delete from public.server_match_searches
    where user_id = p_user_id
      and pace = p_pace;

    return jsonb_build_object(
      'status', 'candidate',
      'opponentId', candidate_search.user_id,
      'claimToken', next_claim_token
    );
  end if;

  insert into public.server_match_searches (
    user_id,
    pace,
    claim_token,
    claimed_by,
    claim_expires_at,
    updated_at
  )
  values (p_user_id, p_pace, null, null, null, pg_catalog.clock_timestamp())
  on conflict (user_id, pace) do update
  set claim_token = null,
      claimed_by = null,
      claim_expires_at = null,
      updated_at = excluded.updated_at;

  return jsonb_build_object('status', 'waiting', 'claimed', false);
end;
$$;

create or replace function private.purge_abandoned_normal_searches()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  supprimees integer := 0;
begin
  delete from public.server_match_searches
  where pace = 'realtime'
    and updated_at < pg_catalog.clock_timestamp() - interval '5 minutes'
    and (claim_token is null or claim_expires_at <= pg_catalog.clock_timestamp())
    -- Un joueur en plein défi du jour garde sa place dans la file (19/10/2026).
    and not private.en_plein_defi(user_id);
  get diagnostics supprimees = row_count;
  return supprimees;
end;
$$;

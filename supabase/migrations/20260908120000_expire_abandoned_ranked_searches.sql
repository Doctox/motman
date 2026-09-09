-- Classé — une recherche abandonnée ne doit plus servir d'adversaire.
--
-- CE QUI N'ALLAIT PAS. Aucune expiration TEMPORELLE n'existait sur
-- `server_ranked_searches` : toutes les suppressions étaient événementielles
-- (annulation explicite, appariement, expiration d'une confirmation). Un joueur
-- qui ferme l'application en cherchant restait donc en file INDÉFINIMENT.
--
-- Constaté le 08/09/2026, en branchant enfin les suites de tests SQL qui
-- dormaient dans `supabase/tests/` : une ligne en `searching` depuis le 31 août,
-- huit jours, jamais rafraîchie. Le test du classé échouait à cause d'elle — il
-- attendait d'être le premier en file et ne l'était pas.
--
-- Ce n'est pas cosmétique. Le joueur suivant qui cherche est apparié à ce
-- fantôme, la fenêtre de confirmation s'ouvre, l'absent n'accepte jamais, et
-- elle expire au bout de trente secondes. Le joueur présent a attendu pour rien.
--
-- POURQUOI DEUX SEUILS, ET PAS UN.
--
--   • 2 MINUTES pour ne plus l'APPARIER (dans la fonction ci-dessous). C'est
--     réversible et sans conséquence : si le client réapparaît, son prochain
--     sondage rafraîchit `updated_at` et il redevient appariable aussitôt.
--
--   • 5 MINUTES pour la SUPPRIMER (purge ci-dessous). Supprimer est visible par
--     le joueur : `advanceRankedSearch` n'est rappelée que si la base le dit
--     encore `searching`, donc une ligne effacée sous les pieds d'un client
--     vivant fait disparaître sa recherche en silence. Une coupure de réseau
--     mérite mieux que ça, d'où les trois minutes de grâce supplémentaires.
--
-- Le client signale aussi son départ sur `pagehide` (voir `src/rankedMatchmaking.ts`),
-- ce qui rend le cas « onglet fermé » instantané. Mais un balayage vers le haut
-- sur Android n'exécute aucun JavaScript, et c'est le cas le plus fréquent :
-- le délai ci-dessous reste le seul filet qui couvre tout.

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
  where public.server_ranked_searches.status = 'searching'
    and (
      public.server_ranked_searches.rating_snapshot,
      public.server_ranked_searches.tier_snapshot,
      public.server_ranked_searches.placement_snapshot
    ) is distinct from (
      excluded.rating_snapshot,
      excluded.tier_snapshot,
      excluded.placement_snapshot
    );

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
      from public.server_matches as previous_match
      join public.match_participants as me
        on me.match_id = previous_match.id
       and me.user_id = p_user_id
      join public.match_participants as them
        on them.match_id = previous_match.id
       and them.user_id = search.user_id
      where previous_match.mode = 'ranked'
        and previous_match.status = 'finished'
        and previous_match.finish_reason in ('completed', 'timeout', 'forfeit')
        and previous_match.updated_at >
          pg_catalog.clock_timestamp() - interval '10 minutes'
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Ménage. Le filtre de fraîcheur ci-dessus suffit à la correction ; ceci évite
-- seulement que la table accumule des lignes mortes.
--
-- `ready_session_id is null` : une recherche engagée dans une confirmation a son
-- propre cycle de vie (`server_expire_ranked_ready_atomic`) et ne doit pas être
-- emportée par le ménage au milieu d'une négociation.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function private.purge_abandoned_ranked_searches()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  supprimees integer := 0;
begin
  delete from public.server_ranked_searches
  where status = 'searching'
    and ready_session_id is null
    and updated_at < pg_catalog.clock_timestamp() - interval '5 minutes';
  get diagnostics supprimees = row_count;
  return supprimees;
end;
$$;

revoke all on function private.purge_abandoned_ranked_searches() from public, anon, authenticated;

comment on function private.purge_abandoned_ranked_searches() is
  'Efface les recherches classees muettes depuis plus de 5 minutes. Le filtre de fraicheur de server_ranked_matchmake_atomic les avait deja ecartees a 2 minutes.';

-- Toutes les cinq minutes : le seuil est à cinq, inutile de repasser plus vite.
select cron.schedule(
  'motman-purge-abandoned-ranked-searches',
  '*/5 * * * *',
  'select private.purge_abandoned_ranked_searches();'
);

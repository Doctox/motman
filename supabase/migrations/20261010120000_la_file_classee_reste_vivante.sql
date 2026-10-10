-- ─────────────────────────────────────────────────────────────────────────────────
-- LA FILE CLASSÉE RESTE VIVANTE, ET LE PROPRIÉTAIRE APPREND AU FANTÔME (10/10/2026)
--
-- 1. LE BATTEMENT DE LA RECHERCHE CLASSÉE. Le commentaire du filtre de
--    fraîcheur dit « `updated_at` est rafraîchi à chaque appel » ; ce n'était
--    pas vrai. La mise à jour ne passait que si le classement du joueur avait
--    changé depuis l'ouverture de sa recherche. Un joueur seul en file devenait
--    donc invisible au bout de deux minutes, puis était effacé par la purge à
--    cinq — alors que son écran cherchait encore, et que le propriétaire,
--    prévenu par sa notification, arrivait souvent après ces deux minutes.
--    La fonction est recopiée de 20260925090000 à l'identique : seule la clause
--    `on conflict` change.
--
-- 2. UN DÉCLENCHEUR EN DOUBLE. 20260920160000 a créé
--    `server_ranked_searches_menu_wakeup` sans retirer l'ancien
--    `ranked_searches_menu_wakeup` (20260729230940) : les deux appellent la même
--    fonction, et chaque ouverture ou fermeture de recherche réveillait deux
--    fois tous les joueurs en ligne. L'ancien part.
--
-- 3. LE CARNET DE TOURS DU PROPRIÉTAIRE. Le fantôme du propriétaire — un bot
--    qui jouera en classée sous son nom quand personne n'est en ligne — doit
--    jouer COMME lui : combien de lettres il pose, combien sont justes, combien
--    de temps il réfléchit, s'il finit les mots. Rien de tout cela ne survit à
--    une partie : `server_matches` est purgé à 26 h et l'historique ne garde que
--    le plateau final. `match-api` note donc ici chaque tour d'un compte
--    `admin`, et de lui seul. Aucune lettre, aucune réponse : des comptes.
-- ─────────────────────────────────────────────────────────────────────────────────

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
    and (
      -- EXEMPTION DU PROPRIÉTAIRE (25/09/2026). « Enlève cette règle, comme ça
      -- si quelqu'un veut spammer les classées contre moi il peut. »
      --
      -- À cette échelle, la pause protège surtout du vide : celui qui vient de
      -- jouer contre lui n'a plus personne, et repart pour dix minutes
      -- d'animation sans adversaire. Le propriétaire campe dans la file pour
      -- donner des parties — il doit pouvoir en enchaîner.
      --
      -- La règle reste entière entre deux joueurs ordinaires : c'est là qu'elle
      -- sert, à empêcher un duo de se fabriquer du classement en boucle.
      exists (
        select 1
        from public.profiles as exempte
        where exempte.id in (p_user_id, search.user_id)
          and exempte.role = 'admin'
      )
      or
      not exists (
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


drop trigger if exists ranked_searches_menu_wakeup on public.server_ranked_searches;

create table if not exists public.owner_turn_samples (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Pas de clé étrangère : la partie est purgée 26 h après, l'échantillon reste.
  match_id uuid not null,
  mode text not null,
  pace text not null,
  against_bot boolean not null,
  turn_number integer not null,
  kind text not null check (kind in ('played', 'timeout')),
  -- Temps entre le début du tour et l'arrivée du coup au serveur.
  think_ms integer,
  rack_size integer not null,
  -- Cases encore vides AVANT le coup : où en était la partie.
  open_cells integer not null,
  -- Mon score moins celui de l'adversaire, AVANT le coup.
  score_gap integer not null,
  placed integer not null,
  correct integer not null,
  wrong integer not null,
  words_completed integer not null,
  word_points integer not null,
  rack_bonus integer not null,
  score_gained integer not null,
  hint_used boolean not null,
  reroll_used boolean not null,
  created_at timestamptz not null default now()
);

alter table public.owner_turn_samples enable row level security;
revoke all on public.owner_turn_samples from public, anon, authenticated;
grant all on public.owner_turn_samples to service_role;

create index if not exists owner_turn_samples_user_idx
  on public.owner_turn_samples(user_id, created_at);

comment on table public.owner_turn_samples is
  'Un tour joué par un compte admin, en comptes seulement : ce que le fantôme du propriétaire apprend. Voir 20261010120000_la_file_classee_reste_vivante.sql.';

-- Parties normales en temps limité — une recherche abandonnée ne doit plus
-- servir d'adversaire.
--
-- CE QUI N'ALLAIT PAS. `server_matchmake_atomic` choisissait le candidat le plus
-- ancien de `server_match_searches` sans aucun critère de fraîcheur : seul
-- `claim_expires_at` était testé. Et rien ne rafraîchissait `updated_at` pendant
-- l'attente — l'action `search` appelle la fonction UNE fois, puis le client se
-- contente de sonder `state`, qui lisait la file sans y toucher.
--
-- Constaté le 14/09/2026 : une ligne `realtime` créée à 08:44 UTC, jamais
-- rafraîchie, était encore là quarante minutes plus tard. Le prochain joueur qui
-- lançait une partie rapide aurait été apparié à un absent, avec des tours de
-- 45 s qui s'écoulent en face de personne.
--
-- Pourquoi la bascule sur un bot ne la couvrait pas : elle est faite par l'action
-- `state` DU PROPRIÉTAIRE de la recherche, au bout de 30 s (15 s après cette
-- migration, voir § 5). Un joueur qui a
-- balayé l'application ne sonde plus rien ; sa ligne n'est donc jamais convertie.
--
-- MÊME REMÈDE QUE LA FILE CLASSÉE (20260908120000_expire_abandoned_ranked_searches),
-- avec les mêmes deux seuils :
--
--   • 2 MINUTES sans rafraîchissement → plus appariée. Réversible : le sondage
--     `state` rafraîchit désormais `updated_at` (`server_refresh_match_searches`),
--     toutes les 5 s au premier plan pendant une recherche, 30 à 45 s sinon,
--     60 s en arrière-plan (`lobbyMenuPollDelay`). Deux minutes = deux fois le
--     pire.
--
--   • 5 MINUTES → supprimée (cron). Supprimer est visible : le menu affiche la
--     recherche tant que la ligne existe. Trois minutes de grâce pour une coupure.
--
-- SEULEMENT POUR `realtime`. Une recherche en temps illimité (24 h par tour) est
-- faite pour être posée puis quittée : apparier un joueur absent y est normal,
-- la notification de tour le fera revenir.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Le filtre de fraîcheur. Seul le bloc « select … into candidate_search »
--    change par rapport à 20260729201946 ; le reste est recopié tel quel.
-- ─────────────────────────────────────────────────────────────────────────────
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

  select search.*
  into candidate_search
  from public.server_match_searches as search
  join public.profiles as profile on profile.id = search.user_id
  where search.pace = p_pace
    and search.user_id <> p_user_id
    and profile.status = 'active'
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Le battement. Appelé par l'action `state` de match-api, qui le renvoie à la
--    place de son ancien `select` : une seule requête, et l'horloge est celle de
--    la base — la même que celle du filtre ci-dessus.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.server_refresh_match_searches(p_user_id uuid)
returns setof public.server_match_searches
language sql
security invoker
set search_path = ''
as $$
  update public.server_match_searches
  set updated_at = pg_catalog.clock_timestamp()
  where user_id = p_user_id
  returning *;
$$;

revoke all on function public.server_refresh_match_searches(uuid) from public, anon, authenticated;
grant execute on function public.server_refresh_match_searches(uuid) to service_role;

comment on function public.server_refresh_match_searches(uuid) is
  'Battement de la file normale : rafraichit updated_at des recherches du joueur et les renvoie.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Le battement ne doit PAS réveiller le menu.
--
-- `match_searches_menu_wakeup` diffusait un réveil au propriétaire à CHAQUE
-- mise à jour. Avec le battement, on aurait eu une boucle : `state` rafraîchit →
-- le déclencheur réveille le client → le client rappelle `state` → qui
-- rafraîchit… Une mise à jour qui ne touche que `updated_at` ne change rien à ce
-- que le menu affiche (id, rythme, date de création) : elle ne réveille plus.
-- Les réservations (`claim_token`) continuent de le faire, comme avant.
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists match_searches_menu_wakeup on public.server_match_searches;

create trigger match_searches_menu_wakeup
after insert or delete on public.server_match_searches
for each row execute function private.broadcast_search_menu_wakeup();

drop trigger if exists match_searches_menu_wakeup_update on public.server_match_searches;

create trigger match_searches_menu_wakeup_update
after update on public.server_match_searches
for each row
when (
  old.user_id is distinct from new.user_id
  or old.pace is distinct from new.pace
  or old.created_at is distinct from new.created_at
  or old.claim_token is distinct from new.claim_token
)
execute function private.broadcast_search_menu_wakeup();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Ménage. Le filtre de fraîcheur suffit à la correction ; ceci évite que la
--    table garde des lignes mortes, et qu'un menu rouvert trois jours plus tard
--    affiche encore « Recherche en cours ».
--
-- Une réservation en cours (claim non expiré) n'est jamais emportée : elle vit
-- 20 s et rafraîchit `updated_at`, donc ne peut pas avoir cinq minutes, mais le
-- test explicite coûte moins cher qu'une partie créée sans sa recherche.
-- ─────────────────────────────────────────────────────────────────────────────
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
    and (claim_token is null or claim_expires_at <= pg_catalog.clock_timestamp());
  get diagnostics supprimees = row_count;
  return supprimees;
end;
$$;

revoke all on function private.purge_abandoned_normal_searches() from public, anon, authenticated;

comment on function private.purge_abandoned_normal_searches() is
  'Efface les recherches normales en temps limite muettes depuis plus de 5 minutes. Le filtre de fraicheur de server_matchmake_atomic les avait deja ecartees a 2 minutes.';

select cron.schedule(
  'motman-purge-abandoned-normal-searches',
  '*/5 * * * *',
  'select private.purge_abandoned_normal_searches();'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Bascule sur un bot à 15 s au lieu de 30 (demande du propriétaire, 14/09/2026).
--    Le seuil vit à DEUX endroits qui doivent rester égaux : ici, et
--    `BOT_SEARCH_MS` dans match-api. Seule la ligne `interval` change par rapport
--    à 20260729201946 ; le reste est recopié tel quel.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.server_create_bot_match_atomic(
  p_user_id uuid,
  p_search_id uuid,
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
  search_pace text;
  locked_search public.server_match_searches%rowtype;
  created_match public.server_matches%rowtype;
begin
  select search.pace
  into search_pace
  from public.server_match_searches as search
  where search.id = p_search_id
    and search.user_id = p_user_id;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('motman:matchmaking:' || search_pace, 0)
  );

  select search.*
  into locked_search
  from public.server_match_searches as search
  where search.id = p_search_id
    and search.user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  if locked_search.created_at > pg_catalog.clock_timestamp() - interval '15 seconds'
    or (
      locked_search.claim_token is not null
      and locked_search.claim_expires_at > pg_catalog.clock_timestamp()
    )
  then
    return jsonb_build_object('status', 'waiting');
  end if;

  if p_grid_id is null
    or p_state is null
    or p_turn_started_at is null
    or p_turn_ends_at is null
    or p_turn_ends_at <= p_turn_started_at
    or p_state -> 'playerIds' ->> 0 is distinct from p_user_id::text
    or pg_catalog.jsonb_typeof(p_state -> 'bot') is distinct from 'object'
    or not exists (
      select 1
      from public.server_grid_catalog as grid
      where grid.id = p_grid_id
        and grid.active is true
    )
  then
    return jsonb_build_object('status', 'invalid');
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
    locked_search.pace,
    p_grid_id,
    p_state,
    'active',
    p_user_id,
    1,
    p_turn_started_at,
    p_turn_ends_at
  )
  returning * into created_match;

  insert into public.match_participants(match_id, user_id, opponent_id)
  values (created_match.id, p_user_id, null);

  delete from public.server_match_searches
  where id = locked_search.id;

  return jsonb_build_object(
    'status', 'matched',
    'created', true,
    'matchId', created_match.id,
    'match', to_jsonb(created_match)
  );
end;
$$;

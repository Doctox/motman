-- ─────────────────────────────────────────────────────────────────────────────
-- LE DUEL EN CHAÎNE (02/11/2026, l'idée du propriétaire)
--
-- 30 s par tour, chaque lettre posée est jugée aussitôt et en donne une nouvelle.
-- Les règles vivent dans match-api (matchChaine.ts).
--
-- UN DRAPEAU ET NON UNE VALEUR DE `pace`. Un duel en chaîne EST une partie en temps
-- limité : `pace` vaut `realtime`, et tout ce qui teste ce mot continue de valoir
-- (cinq contraintes `check`, les gardes du défi du jour, la mise en pause pour le
-- classé, la purge des recherches, les parties sans témoin, l'archivage). La partie
-- porte `state.chaine`, indépendamment de `mode` : une version classée pourra s'y
-- brancher.
--
-- CE QUI CHANGE EN BASE, ET RIEN D'AUTRE :
--   1. la file et les invitations portent une `variante`, pour qu'un joueur qui
--      cherche « En chaîne » ne tombe jamais sur une partie de 45 s ;
--   2. `server_matchmake_atomic` n'apparie que la même variante. Elle est recopiée de
--      20261019100000 ; seules les lignes de `variante` s'ajoutent, et le paramètre
--      a une valeur par défaut, pour que match-api d'avant la livraison continue
--      de marcher. L'ancienne signature part : deux versions rendraient l'appel
--      ambigu ;
--   3. UNE LETTRE N'EST PAS UN CHANGEMENT DE TOUR. Chaque écriture de
--      `server_matches` diffusait `changed` sur le canal de la partie ET réveillait
--      le menu de chaque joueur : deux relectures complètes par joueur, à chaque
--      lettre. Dans un tour de chaîne, seul l'événement `chaine` part : les lettres
--      du tour et les scores, déjà publics. Ni chevalet, ni solution, ni sac.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.server_match_searches
  add column variante text not null default 'classique'
  check (variante in ('classique', 'chaine'));

alter table public.server_match_invitations
  add column variante text not null default 'classique'
  check (variante in ('classique', 'chaine'));

comment on column public.server_match_searches.variante is
  'classique, ou chaine : la file n''apparie que deux recherches de la même variante.';
comment on column public.server_match_invitations.variante is
  'classique, ou chaine : la partie proposée par cette invitation.';

drop function public.server_matchmake_atomic(uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz);

create function public.server_matchmake_atomic(
  p_user_id uuid,
  p_pace text,
  p_candidate_id uuid,
  p_claim_token uuid,
  p_grid_id text,
  p_state jsonb,
  p_turn_started_at timestamptz,
  p_turn_ends_at timestamptz,
  p_variante text default 'classique'
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
  -- Un duel en chaîne est une partie en temps limité (02/11/2026).
  if p_variante is null or p_variante not in ('classique', 'chaine') or (p_variante = 'chaine' and p_pace <> 'realtime') then
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
      and search.variante = p_variante
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
        -- La partie doit être de la variante qu'ils ont cherchée, l'un comme l'autre.
        or (p_state -> 'chaine' is not null) is distinct from (p_variante = 'chaine')
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
    and search.variante = p_variante
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
    variante,
    claim_token,
    claimed_by,
    claim_expires_at,
    updated_at
  )
  values (p_user_id, p_pace, p_variante, null, null, null, pg_catalog.clock_timestamp())
  on conflict (user_id, pace) do update
  set variante = excluded.variante,
      claim_token = null,
      claimed_by = null,
      claim_expires_at = null,
      updated_at = excluded.updated_at;

  return jsonb_build_object('status', 'waiting', 'claimed', false);
end;
$$;

revoke all on function public.server_matchmake_atomic(
  uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.server_matchmake_atomic(
  uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz, text
) to service_role;

comment on function public.server_matchmake_atomic(
  uuid, text, uuid, uuid, text, jsonb, timestamptz, timestamptz, text
) is 'Reserves a queued opponent of the same variant and commits a human match atomically.';

-- Une écriture à l'intérieur d'un tour de chaîne ne réveille plus personne : les
-- lettres partent par l'événement `chaine`, une seule fois, avec l'heure de la ligne.
-- Une diffusion ratée ne fait jamais échouer le coup : le sondage reste le filet.
create or replace function private.broadcast_match_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.state -> 'chaine' is not null
      and old.status = new.status
      and old.turn_number = new.turn_number
      and old.grid_id = new.grid_id
      and old.paused_at is not distinct from new.paused_at
    then
      if old.state -> 'chaine' -> 'lettres' is distinct from new.state -> 'chaine' -> 'lettres' then
        begin
          perform realtime.send(
            jsonb_build_object(
              'turnNumber', new.turn_number,
              'chaine', new.state -> 'chaine',
              'scores', new.state -> 'scores',
              'updatedAt', new.updated_at
            ),
            'chaine',
            'match:' || new.id::text,
            true
          );
        exception when others then
          raise warning 'Lettres de chaîne non diffusées : %', sqlerrm;
        end;
      end if;
      return null;
    end if;
  end if;

  perform realtime.send(
    jsonb_build_object('updatedAt', new.updated_at),
    'changed',
    'match:' || new.id::text,
    true
  );
  return null;
end;
$$;

-- Le menu n'a rien à apprendre d'un tour de chaîne qui passe, seulement de sa fin ou
-- de sa mise en pause. Sans ça, chaque changement de main ferait relire le salon entier
-- aux deux joueurs, et un tour de chaîne dure dix secondes.
create or replace function private.broadcast_match_menu_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant record;
begin
  if new.state -> 'chaine' is not null
    and old.status = new.status
    and old.paused_at is not distinct from new.paused_at
  then
    return null;
  end if;
  for participant in
    select match_participant.user_id
    from public.match_participants as match_participant
    where match_participant.match_id = new.id
  loop
    perform private.broadcast_user_menu_wakeup(participant.user_id, 'lobby');
  end loop;
  return null;
end;
$$;

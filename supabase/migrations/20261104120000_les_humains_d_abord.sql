-- ─────────────────────────────────────────────────────────────────────────────
-- UNE PARTIE À TEMPS LIMITÉ À LA FOIS, ET LES HUMAINS D'ABORD (04/11/2026)
--
-- Le 03/11/2026, un compte a joué deux parties en chaîne en même temps, deux fois de
-- suite, et son adversaire humain a attendu un absent près de deux minutes. Les deux
-- RPC effaçaient bien la recherche en créant la partie, mais :
--   - « Rejouer » envoie `search` en arrivant au menu, et rien ne regardait si le
--     joueur était déjà en partie : une ligne renaissait en file ;
--   - un humain pouvait tomber dessus pendant les deux minutes de fraîcheur ;
--   - sinon, l'écran de fin lit `state` et la ligne, vieille de plus de 15 s, devenait
--     une partie automatique avant le moindre geste du joueur.
--
-- LA RÈGLE DU PROPRIÉTAIRE. Une partie entre deux humains prend le dessus sur une partie
-- contre l'automate, tant que celle-ci en est à la lecture de la grille : personne n'a
-- encore joué, elle cède sans gain ni perte. « Si la partie contre le bot est lancée et
-- en cours, laisse tombé. » Une partie entre humains ne cède jamais. Le défi du jour non
-- plus (20261019100000), ni l'illimité.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE :
--   1. `search` rend la partie en cours au lieu de remettre le joueur en file ;
--   2. personne n'a de ligne en file pendant une partie, quelle que soit sa porte
--      d'entrée : la classée n'effaçait pas la recherche normale ;
--   3. `server_create_bot_match_atomic` ne donne jamais une seconde partie ;
--   4. personne en file : un joueur qui lit sa grille contre l'automate est proposé.
--
-- `server_matchmake_atomic` est recopiée de 20261102220000 et
-- `server_create_bot_match_atomic` de 20260914090000 : seules s'ajoutent les lignes
-- datées du 04/11/2026 et leurs variables.
--
-- Garde : supabase/tests/une_partie_limitee_a_la_fois.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- La ligne d'un joueur qu'on est venu chercher pendant sa lecture : elle n'existe que
-- le temps de la réservation, et ne devient jamais une partie automatique.
alter table public.server_match_searches
  add column partie_auto uuid references public.server_matches(id) on delete cascade;

comment on column public.server_match_searches.partie_auto is
  'La partie automatique en lecture que ce joueur quittera si la réservation aboutit.';

-- Sa partie à temps limité en cours. Le défi du jour n'en est pas une : sa recherche
-- attend l'après-défi (20261019100000).
create or replace function private.en_partie_limitee(p_user_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select partie.id
  from public.server_matches as partie
  join public.match_participants as participant
    on participant.match_id = partie.id
   and participant.user_id = p_user_id
  where partie.status = 'active'
    and partie.pace = 'realtime'
    and not (partie.mode = 'solo' and partie.state ->> 'isDaily' = 'true')
  order by partie.created_at desc, partie.id
  limit 1;
$$;

revoke all on function private.en_partie_limitee(uuid) from public, anon, authenticated;
grant execute on function private.en_partie_limitee(uuid) to service_role;

-- « Si la partie contre le bot est lancée et en cours, laisse tombé » : seule une
-- partie encore à la lecture de la grille cède la place à un humain.
create or replace function private.partie_auto_en_lecture(p_match_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.server_matches as partie
    where partie.id = p_match_id
      and partie.status = 'active'
      and partie.mode = 'normal'
      and partie.pace = 'realtime'
      and partie.paused_at is null
      and partie.turn_number = 1
      and partie.turn_started_at > pg_catalog.clock_timestamp()
      and pg_catalog.jsonb_typeof(partie.state -> 'bot') = 'object'
  );
$$;

revoke all on function private.partie_auto_en_lecture(uuid) from public, anon, authenticated;
grant execute on function private.partie_auto_en_lecture(uuid) to service_role;

-- Toute partie à temps limité qui commence emporte la recherche normale de ses joueurs,
-- quelle que soit sa porte d'entrée. Une classée naît en `pending`, le temps de la
-- confirmation : elle ne commence qu'en passant à `active`, voir le déclencheur suivant.
create or replace function private.la_partie_emporte_la_recherche()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.server_match_searches as search
  using public.server_matches as partie
  where partie.id = new.match_id
    and search.user_id = new.user_id
    and search.pace = 'realtime'
    and partie.pace = 'realtime'
    and partie.status = 'active'
    and not (partie.mode = 'solo' and partie.state ->> 'isDaily' = 'true');
  return null;
end;
$$;

revoke all on function private.la_partie_emporte_la_recherche() from public, anon, authenticated;

create trigger la_partie_emporte_la_recherche
  after insert on public.match_participants
  for each row execute function private.la_partie_emporte_la_recherche();

create or replace function private.la_classee_emporte_la_recherche()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.server_match_searches as search
  using public.match_participants as participant
  where participant.match_id = new.id
    and search.user_id = participant.user_id
    and search.pace = 'realtime';
  return null;
end;
$$;

revoke all on function private.la_classee_emporte_la_recherche() from public, anon, authenticated;

create trigger la_classee_emporte_la_recherche
  after update of status on public.server_matches
  for each row
  when (old.status = 'pending' and new.status = 'active' and new.pace = 'realtime')
  execute function private.la_classee_emporte_la_recherche();

create or replace function public.server_matchmake_atomic(
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
  partie_en_cours uuid;
  partie_cedee uuid;
  joueur_en_lecture uuid;
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

  -- PERSONNE EN PARTIE N'A DE LIGNE EN FILE (04/11/2026), sauf le temps d'une réservation.
  delete from public.server_match_searches as search
  where search.pace = p_pace
    and search.claim_token is null
    and (
      search.partie_auto is not null
      or (p_pace = 'realtime' and private.en_partie_limitee(search.user_id) is not null)
    );

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
      partie_cedee := candidate_search.partie_auto;
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
        -- Une partie à la fois (04/11/2026). Seule cède une partie automatique encore en lecture.
        or (p_pace = 'realtime' and private.en_partie_limitee(p_user_id) is not null)
        or (p_pace = 'realtime' and private.en_partie_limitee(p_candidate_id) is distinct from partie_cedee)
        or (partie_cedee is not null and not private.partie_auto_en_lecture(partie_cedee))
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

      -- La partie automatique cède la place : elle ne rapporte ni ne coûte rien, et
      -- dit à l'écran du joueur où aller. Elle est close avant l'arrivée des participants.
      if partie_cedee is not null then
        update public.server_matches
        set status = 'finished',
            current_player_id = null,
            winner_id = null,
            finish_reason = 'human_takeover',
            turn_started_at = pg_catalog.clock_timestamp(),
            turn_ends_at = pg_catalog.clock_timestamp(),
            state = state || jsonb_build_object('remplaceePar', created_match.id),
            updated_at = pg_catalog.clock_timestamp()
        where id = partie_cedee
          and status = 'active';
      end if;

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

  -- DÉJÀ EN PARTIE (04/11/2026) : « Rejouer » arrive après la naissance de la partie.
  -- On lui rend la partie au lieu de le remettre en file.
  if p_pace = 'realtime' then
    partie_en_cours := private.en_partie_limitee(p_user_id);
    if partie_en_cours is not null then
      delete from public.server_match_searches
      where user_id = p_user_id
        and pace = p_pace;
      return jsonb_build_object('status', 'en-partie', 'matchId', partie_en_cours);
    end if;
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

  -- LES HUMAINS D'ABORD (04/11/2026). Personne en file : quelqu'un lit-il sa grille
  -- contre l'automate ? Il n'a encore rien joué, il joue contre cet humain.
  if p_pace = 'realtime' then
    select participant.user_id, partie.id
    into joueur_en_lecture, partie_cedee
    from public.server_matches as partie
    join public.match_participants as participant on participant.match_id = partie.id
    join public.profiles as profile on profile.id = participant.user_id
    where partie.status = 'active'
      and private.partie_auto_en_lecture(partie.id)
      and (partie.state -> 'chaine' is not null) = (p_variante = 'chaine')
      and profile.status = 'active'
      and not private.en_plein_defi(participant.user_id)
      and not exists (
        select 1
        from public.blocks as block
        where (block.owner_id = p_user_id and block.blocked_id = participant.user_id)
           or (block.owner_id = participant.user_id and block.blocked_id = p_user_id)
      )
      and not exists (
        select 1
        from public.server_match_searches as search
        where search.user_id = participant.user_id
          and search.pace = p_pace
      )
    order by partie.created_at, partie.id
    for update of partie skip locked
    limit 1;

    if found then
      next_claim_token := pg_catalog.gen_random_uuid();
      insert into public.server_match_searches (
        user_id, pace, variante, claim_token, claimed_by, claim_expires_at, partie_auto, updated_at
      )
      values (
        joueur_en_lecture, p_pace, p_variante, next_claim_token, p_user_id,
        pg_catalog.clock_timestamp() + interval '20 seconds', partie_cedee, pg_catalog.clock_timestamp()
      );

      delete from public.server_match_searches
      where user_id = p_user_id
        and pace = p_pace;

      return jsonb_build_object(
        'status', 'candidate',
        'opponentId', joueur_en_lecture,
        'claimToken', next_claim_token
      );
    end if;
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

  -- Une partie à la fois (04/11/2026) : une ligne oubliée disparaît, et ne devient rien.
  if locked_search.partie_auto is not null
    or (locked_search.pace = 'realtime' and private.en_partie_limitee(p_user_id) is not null)
  then
    delete from public.server_match_searches
    where id = locked_search.id;
    return jsonb_build_object('status', 'unavailable');
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

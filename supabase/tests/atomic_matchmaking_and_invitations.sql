begin;

do $$
declare
  first_user constant uuid := 'f0aa1001-0000-4000-8000-000000000001';
  second_user constant uuid := 'e0bb2002-0000-4000-8000-000000000002';
  ghost_user constant uuid := 'f0aa1003-0000-4000-8000-000000000003';
  refreshed_count integer;
  wakeups_before bigint;
  selected_grid text;
  invitation_id uuid;
  reservation_token uuid;
  matchmaking_result jsonb;
  first_acceptance jsonb;
  repeated_acceptance jsonb;
begin
  -- La suite tourne sur la VRAIE base, dans une transaction annulée. Une
  -- recherche réelle restée dans la file (14/09/2026 : un joueur parti sans
  -- annuler) appariait le premier joueur de test au lieu de le mettre en
  -- attente. On vide la file ici ; le rollback final la rend intacte.
  delete from public.server_match_searches;

  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (first_user, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (second_user, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (ghost_user, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  -- Le fantôme du 14/09/2026 : une recherche en temps limité posée il y a dix
  -- minutes et jamais rafraîchie depuis (application balayée). Elle est PLUS
  -- ANCIENNE que toutes les autres, donc la première servie par
  -- `order by created_at` — c'est exactement ce qui appariait le joueur suivant
  -- à un absent. Les deux assertions qui suivent (« waiting », puis
  -- « opponentId = first_user ») échouent sans le filtre de fraîcheur.
  matchmaking_result := public.server_matchmake_atomic(
    ghost_user, 'realtime', null, null, null, null, null, null
  );
  if matchmaking_result ->> 'status' <> 'waiting' then
    raise exception 'Ghost player was not queued: %', matchmaking_result;
  end if;
  update public.server_match_searches
  set created_at = pg_catalog.clock_timestamp() - interval '10 minutes',
      updated_at = pg_catalog.clock_timestamp() - interval '10 minutes'
  where user_id = ghost_user;

  select grid.id
  into selected_grid
  from public.server_grid_catalog as grid
  where grid.active is true
  order by grid.id
  limit 1;

  if selected_grid is null then
    raise exception 'Atomic matchmaking test requires one active grid';
  end if;

  matchmaking_result := public.server_matchmake_atomic(
    first_user, 'realtime', null, null, null, null, null, null
  );
  if matchmaking_result ->> 'status' <> 'waiting' then
    raise exception 'First player was not queued (paired with a stale search?): %', matchmaking_result;
  end if;

  matchmaking_result := public.server_matchmake_atomic(
    second_user, 'realtime', null, null, null, null, null, null
  );
  if matchmaking_result ->> 'status' <> 'candidate'
    or matchmaking_result ->> 'opponentId' <> first_user::text
  then
    raise exception 'Second player did not reserve the first: %', matchmaking_result;
  end if;

  reservation_token := (matchmaking_result ->> 'claimToken')::uuid;
  matchmaking_result := public.server_matchmake_atomic(
    second_user,
    'realtime',
    first_user,
    reservation_token,
    selected_grid,
    pg_catalog.jsonb_build_object(
      'playerIds', pg_catalog.jsonb_build_array(first_user, second_user),
      'invitationId', null,
      'bot', null
    ),
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '45 seconds'
  );
  if matchmaking_result ->> 'status' <> 'matched' then
    raise exception 'Reserved matchmaking commit failed: %', matchmaking_result;
  end if;

  if (
    select count(*)
    from public.server_matches as match
    where match.mode = 'normal'
      and match.state -> 'playerIds' = pg_catalog.jsonb_build_array(first_user, second_user)
  ) <> 1 then
    raise exception 'Matchmaking created an unexpected number of matches';
  end if;

  if (
    select count(*)
    from public.match_participants as participant
    where participant.match_id = (matchmaking_result ->> 'matchId')::uuid
  ) <> 2 then
    raise exception 'Matchmaking did not create both participants atomically';
  end if;

  perform public.server_matchmake_atomic(
    second_user,
    'realtime',
    first_user,
    reservation_token,
    selected_grid,
    pg_catalog.jsonb_build_object(
      'playerIds', pg_catalog.jsonb_build_array(first_user, second_user),
      'invitationId', null,
      'bot', null
    ),
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '45 seconds'
  );

  if (
    select count(*)
    from public.server_matches as match
    where match.mode = 'normal'
      and match.state -> 'playerIds' = pg_catalog.jsonb_build_array(first_user, second_user)
  ) <> 1 then
    raise exception 'A consumed reservation created a duplicate match';
  end if;

  insert into public.friendships(left_user_id, right_user_id)
  values (least(first_user, second_user), greatest(first_user, second_user));

  insert into public.server_match_invitations(host_id, guest_id, pace, expires_at)
  values (first_user, second_user, 'async', pg_catalog.clock_timestamp() + interval '1 day')
  returning id into invitation_id;

  first_acceptance := public.server_respond_match_invitation_atomic(
    invitation_id,
    second_user,
    'accept',
    selected_grid,
    pg_catalog.jsonb_build_object(
      'playerIds', pg_catalog.jsonb_build_array(first_user, second_user),
      'invitationId', invitation_id,
      'bot', null
    ),
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  repeated_acceptance := public.server_respond_match_invitation_atomic(
    invitation_id,
    second_user,
    'accept',
    selected_grid,
    pg_catalog.jsonb_build_object(
      'playerIds', pg_catalog.jsonb_build_array(first_user, second_user),
      'invitationId', invitation_id,
      'bot', null
    ),
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '1 day'
  );

  if first_acceptance ->> 'status' <> 'matched'
    or first_acceptance ->> 'created' <> 'true'
    or repeated_acceptance ->> 'status' <> 'matched'
    or repeated_acceptance ->> 'created' <> 'false'
    or first_acceptance ->> 'matchId' is distinct from repeated_acceptance ->> 'matchId'
  then
    raise exception 'Invitation acceptance is not idempotent: first=%, repeated=%',
      first_acceptance, repeated_acceptance;
  end if;

  if (
    select count(*)
    from public.server_matches as match
    where match.mode = 'friend'
      and match.state ->> 'invitationId' = invitation_id::text
  ) <> 1 then
    raise exception 'Invitation acceptance created a duplicate match';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.server_matchmake_atomic(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz)',
    'execute'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.server_respond_match_invitation_atomic(uuid,uuid,text,text,jsonb,timestamptz,timestamptz)',
    'execute'
  ) then
    raise exception 'Atomic match RPCs must remain service-role only';
  end if;

  -- ── Fraîcheur de la file normale (20260914090000) ─────────────────────────

  -- Le battement ressuscite une recherche muette : un joueur revenu au premier
  -- plan après une coupure redevient appariable dès son sondage `state`. Sans ce
  -- contrôle, un filtre qui écarterait tout le monde passerait les assertions
  -- du début sans qu'on s'en aperçoive.
  select count(*) into refreshed_count
  from public.server_refresh_match_searches(ghost_user);
  if refreshed_count <> 1 then
    raise exception 'Heartbeat refreshed % searches instead of 1', refreshed_count;
  end if;

  matchmaking_result := public.server_matchmake_atomic(
    second_user, 'realtime', null, null, null, null, null, null
  );
  if matchmaking_result ->> 'status' <> 'candidate'
    or matchmaking_result ->> 'opponentId' <> ghost_user::text
  then
    raise exception 'A refreshed search should be matchable again: %', matchmaking_result;
  end if;

  -- En temps illimité, un absent reste un adversaire légitime : tours de 24 h,
  -- la notification le fera revenir. Le filtre ne doit pas s'y appliquer.
  delete from public.server_match_searches;
  insert into public.server_match_searches(user_id, pace, created_at, updated_at)
  values (ghost_user, 'async', pg_catalog.clock_timestamp() - interval '1 hour', pg_catalog.clock_timestamp() - interval '1 hour');

  matchmaking_result := public.server_matchmake_atomic(
    first_user, 'async', null, null, null, null, null, null
  );
  if matchmaking_result ->> 'status' <> 'candidate'
    or matchmaking_result ->> 'opponentId' <> ghost_user::text
  then
    raise exception 'An idle async search must stay matchable: %', matchmaking_result;
  end if;

  -- Le ménage : emporte le fantôme en temps limité, épargne le vivant et
  -- l'attente en temps illimité.
  delete from public.server_match_searches;
  insert into public.server_match_searches(user_id, pace, created_at, updated_at)
  values
    (ghost_user, 'realtime', pg_catalog.clock_timestamp() - interval '30 minutes', pg_catalog.clock_timestamp() - interval '30 minutes'),
    (first_user, 'realtime', pg_catalog.clock_timestamp() - interval '30 minutes', pg_catalog.clock_timestamp()),
    (second_user, 'async', pg_catalog.clock_timestamp() - interval '30 minutes', pg_catalog.clock_timestamp() - interval '30 minutes');

  perform private.purge_abandoned_normal_searches();

  if exists (select 1 from public.server_match_searches where user_id = ghost_user) then
    raise exception 'The stale realtime search should have been purged';
  end if;
  if not exists (select 1 from public.server_match_searches where user_id = first_user) then
    raise exception 'A refreshed realtime search must not be purged';
  end if;
  if not exists (select 1 from public.server_match_searches where user_id = second_user) then
    raise exception 'An async search must not be purged';
  end if;

  -- Le battement ne réveille pas le menu, sinon `state` → réveil → `state`
  -- tourne en boucle. Contrôle symétrique : une vraie entrée en file, elle,
  -- réveille bien — sans quoi le comptage ne prouverait rien.
  select count(*) into wakeups_before
  from realtime.messages
  where topic = 'user:' || first_user::text;

  perform public.server_refresh_match_searches(first_user);

  if (select count(*) from realtime.messages where topic = 'user:' || first_user::text) <> wakeups_before then
    raise exception 'The search heartbeat must not broadcast a menu wakeup';
  end if;

  delete from public.server_match_searches where user_id = first_user;
  if (select count(*) from realtime.messages where topic = 'user:' || first_user::text) <= wakeups_before then
    raise exception 'Queue changes should still broadcast a menu wakeup (is the counter blind?)';
  end if;

  -- ── Bascule sur un bot à 15 s ─────────────────────────────────────────────
  -- Doit rester aligné sur `BOT_SEARCH_MS` de match-api. À 10 s, la base
  -- refuse (`waiting`) ; à 20 s, elle passe le seuil et va jusqu'à la
  -- validation des données — `invalid`, puisqu'on n'envoie pas de grille.
  delete from public.server_match_searches;
  insert into public.server_match_searches(user_id, pace, created_at, updated_at)
  values
    (first_user, 'realtime', pg_catalog.clock_timestamp() - interval '10 seconds', pg_catalog.clock_timestamp()),
    (second_user, 'realtime', pg_catalog.clock_timestamp() - interval '20 seconds', pg_catalog.clock_timestamp());

  matchmaking_result := public.server_create_bot_match_atomic(
    first_user,
    (select id from public.server_match_searches where user_id = first_user),
    null, null, null, null
  );
  if matchmaking_result ->> 'status' <> 'waiting' then
    raise exception 'A 10 s old search must still wait for a human: %', matchmaking_result;
  end if;

  matchmaking_result := public.server_create_bot_match_atomic(
    second_user,
    (select id from public.server_match_searches where user_id = second_user),
    null, null, null, null
  );
  if matchmaking_result ->> 'status' <> 'invalid' then
    raise exception 'A 20 s old search should be past the 15 s bot threshold: %', matchmaking_result;
  end if;
end;
$$;

rollback;

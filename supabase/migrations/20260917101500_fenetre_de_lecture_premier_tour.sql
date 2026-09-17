-- FENÊTRE DE LECTURE AVANT LE PREMIER TOUR — 17/09/2026
--
-- Le premier joueur découvrait la grille pendant que son chronomètre tournait
-- déjà ; le second avait lu les définitions pendant le tour du premier. Le
-- désavantage est structurel. Remarque d'un testeur, vérifiée dans le code.
--
-- Le tour n°1 ne court donc plus pour personne pendant dix secondes : les deux
-- joueurs lisent, puis le premier joue ses quarante-cinq secondes entières.
-- 10 s de lecture + 45 s de tour = 55 s avant l'expiration du premier tour.
--
-- Les parties NORMALES reçoivent leurs horodatages de la fonction edge
-- (`matchSetup.ts`, FIRST_TURN_READING_MS). Les parties CLASSÉES, elles,
-- démarrent ici, en plpgsql, quand les deux joueurs ont accepté : la constante
-- est donc écrite deux fois, et `matchTiming.test.ts` tient les deux d'accord.
--
-- La fonction est recopiée telle quelle, à ces deux intervalles près.

create or replace function public.server_respond_ranked_ready_atomic(
  p_user_id uuid,
  p_ready_session_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ready public.server_ranked_ready_sessions%rowtype;
  ranked_match public.server_matches%rowtype;
  opponent_id uuid;
begin
  if p_decision not in ('accept', 'decline') then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'motman:ranked-ready:' || p_ready_session_id::text,
      0
    )
  );

  select session.*
  into ready
  from public.server_ranked_ready_sessions as session
  where session.id = p_ready_session_id
    and p_user_id in (session.player_a_id, session.player_b_id)
  for update;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if ready.status = 'started' then
    return jsonb_build_object(
      'status', 'started',
      'matchId', ready.match_id
    );
  end if;
  if ready.status <> 'pending' then
    return jsonb_build_object('status', ready.status);
  end if;
  if ready.expires_at <= pg_catalog.clock_timestamp() then
    return public.server_expire_ranked_ready_atomic(ready.id);
  end if;

  opponent_id := case
    when p_user_id = ready.player_a_id then ready.player_b_id
    else ready.player_a_id
  end;

  if p_decision = 'decline' then
    perform private.resume_ranked_paused_match(
      ready.player_a_paused_match_id,
      ready.id
    );
    perform private.resume_ranked_paused_match(
      ready.player_b_paused_match_id,
      ready.id
    );

    update public.server_matches
    set status = 'finished',
        current_player_id = null,
        winner_id = null,
        finish_reason = 'ready_declined',
        turn_started_at = pg_catalog.clock_timestamp(),
        turn_ends_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where id = ready.match_id
      and status = 'pending';

    update public.server_ranked_ready_sessions
    set status = 'cancelled',
        updated_at = pg_catalog.clock_timestamp()
    where id = ready.id;

    delete from public.server_ranked_searches
    where user_id = p_user_id;

    update public.server_ranked_searches
    set status = 'searching',
        ready_session_id = null,
        claim_token = null,
        claimed_by = null,
        claim_expires_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where user_id = opponent_id;

    return jsonb_build_object(
      'status', 'declined',
      'opponentRequeued', true
    );
  end if;

  if p_user_id = ready.player_a_id then
    update public.server_ranked_ready_sessions
    set player_a_accepted = true,
        updated_at = pg_catalog.clock_timestamp()
    where id = ready.id
    returning * into ready;
  else
    update public.server_ranked_ready_sessions
    set player_b_accepted = true,
        updated_at = pg_catalog.clock_timestamp()
    where id = ready.id
    returning * into ready;
  end if;

  if not (ready.player_a_accepted and ready.player_b_accepted) then
    return jsonb_build_object(
      'status', 'accepted',
      'readySessionId', ready.id,
      'expiresAt', ready.expires_at
    );
  end if;

  update public.server_matches
  set status = 'active',
      turn_started_at = pg_catalog.clock_timestamp() + interval '10 seconds',
      turn_ends_at = pg_catalog.clock_timestamp() + interval '55 seconds',
      updated_at = pg_catalog.clock_timestamp()
  where id = ready.match_id
    and status = 'pending'
  returning * into ranked_match;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  perform private.finish_ranked_transfer_match(
    ready.player_a_paused_match_id,
    ready.id
  );
  if ready.player_b_paused_match_id is distinct from ready.player_a_paused_match_id then
    perform private.finish_ranked_transfer_match(
      ready.player_b_paused_match_id,
      ready.id
    );
  end if;

  update public.server_ranked_ready_sessions
  set status = 'started',
      updated_at = pg_catalog.clock_timestamp()
  where id = ready.id;

  delete from public.server_ranked_searches
  where user_id in (ready.player_a_id, ready.player_b_id);

  return jsonb_build_object(
    'status', 'started',
    'matchId', ranked_match.id,
    'match', to_jsonb(ranked_match),
    'closedNormalMatchIds', jsonb_build_array(
      ready.player_a_paused_match_id,
      ready.player_b_paused_match_id
    )
  );
end;
$$;

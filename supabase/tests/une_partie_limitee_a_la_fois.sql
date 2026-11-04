-- Une partie à temps limité à la fois, et les humains d'abord tant qu'on n'a pas joué.
--
-- Relevé le 04/11/2026 : un compte s'est retrouvé deux fois dans deux parties en
-- chaîne en même temps, contre l'adversaire automatique et contre un humain. Les
-- deux RPC effacent bien la recherche quand ils créent la partie. Mais :
--   - « Rejouer » envoie `search` en arrivant au menu, sans savoir qu'une partie
--     vient de naître, et `server_matchmake_atomic` remet le joueur en file ;
--   - cette ligne, un humain peut tomber dessus : il attend alors un absent qui finit
--     son autre partie, pendant près de deux minutes ;
--   - sinon, l'écran de fin de cette partie lit `state`, et la ligne, vieille de plus
--     de 15 s, devient aussitôt une partie contre l'adversaire automatique.
--
-- LA RÈGLE DU PROPRIÉTAIRE (04/11/2026). Une partie entre deux humains prend le dessus
-- sur une partie contre l'automate, tant que celle-ci en est à la lecture de la grille.
-- « Si la partie contre le bot est lancée et en cours, laisse tombé. » Aucun joueur n'a
-- jamais deux parties à la fois. Une partie entre humains ne cède jamais, le défi du
-- jour non plus : rien n'en fait sortir (daily_not_interrupted.sql).
--
-- Une invitation acceptée va plus loin : deux amis se sont choisis, et l'objectif reste
-- de faire jouer les joueurs entre eux. Leurs parties contre l'automate cèdent, même
-- lancées. Celui qui joue contre quelqu'un, ou son défi du jour, n'en sort pas.
--
-- Le serveur local des e2e refuse déjà la mise en file (server/match/requestHandler.ts) :
-- ils ne pouvaient pas voir le défaut.
--
-- Chaque défaut est noté, et ils sont tous rapportés à la fin : un seul à la fois
-- cacherait les suivants. Contre la production, un vrai joueur peut être en lecture
-- contre l'automate : les parties de ce test sont vieillies d'un an pour passer devant.

begin;

create function pg_temp.parties_en_cours(joueur uuid)
returns bigint
language sql
as $$
  select count(*)
  from public.match_participants as participant
  join public.server_matches as partie on partie.id = participant.match_id
  where participant.user_id = joueur and partie.status = 'active' and partie.pace = 'realtime';
$$;

-- Par le vrai RPC : une recherche de 20 s, sans humain, qui bascule sur l'automate.
-- `turn_started_at` est dans le futur pendant la lecture (prepareAtomicMatch).
create function pg_temp.partie_auto(joueur uuid, variante text, en_lecture boolean)
returns uuid
language plpgsql
as $$
declare
  automate constant uuid := 'f0bd1104-0000-4000-8000-0000000000ff';
  ligne uuid;
  resultat jsonb;
  partie uuid;
  debut timestamptz := pg_catalog.clock_timestamp() + interval '30 seconds';
  etat jsonb := pg_catalog.jsonb_build_object(
    'playerIds', pg_catalog.jsonb_build_array(joueur, automate),
    'bot', pg_catalog.jsonb_build_object('playerId', automate),
    'scores', pg_catalog.jsonb_build_object()
  );
begin
  if variante = 'chaine' then
    etat := etat || pg_catalog.jsonb_build_object('chaine', pg_catalog.jsonb_build_object('tour', 1, 'lettres', pg_catalog.jsonb_build_array()));
  end if;
  delete from public.server_match_searches where user_id = joueur;
  insert into public.server_match_searches(user_id, pace, variante, created_at, updated_at)
  values (joueur, 'realtime', variante, pg_catalog.clock_timestamp() - interval '20 seconds', pg_catalog.clock_timestamp())
  returning id into ligne;
  resultat := public.server_create_bot_match_atomic(
    joueur, ligne,
    (select grid.id from public.server_grid_catalog as grid where grid.active is true order by grid.id limit 1),
    etat, debut, debut + interval '30 seconds'
  );
  if resultat ->> 'status' <> 'matched' then
    raise exception 'Témoin : 20 s sans humain doivent donner une partie automatique : %', resultat;
  end if;
  partie := (resultat ->> 'matchId')::uuid;
  update public.server_matches
  set created_at = pg_catalog.clock_timestamp() - interval '1 year',
      turn_started_at = case when en_lecture then turn_started_at else pg_catalog.clock_timestamp() - interval '5 seconds' end
  where id = partie;
  return partie;
end;
$$;

-- Écrite directement : la partie importe ici, pas la façon dont elle est née. En lecture.
create function pg_temp.partie_ecrite(mode text, pace text, joueurs uuid[], etat jsonb, statut text default 'active')
returns uuid
language plpgsql
as $$
declare
  partie uuid;
begin
  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number, turn_started_at, turn_ends_at, created_at)
  values (
    mode, pace,
    (select grid.id from public.server_grid_catalog as grid where grid.active is true order by grid.id limit 1),
    etat || pg_catalog.jsonb_build_object('playerIds', pg_catalog.to_jsonb(joueurs), 'scores', pg_catalog.jsonb_build_object()),
    statut, joueurs[1], 1,
    pg_catalog.clock_timestamp() + interval '30 seconds', pg_catalog.clock_timestamp() + interval '1 minute',
    pg_catalog.clock_timestamp() - interval '1 year'
  )
  returning id into partie;
  insert into public.match_participants(match_id, user_id, opponent_id)
  select partie, joueur, null from pg_catalog.unnest(joueurs) as joueur;
  return partie;
end;
$$;

-- Par le vrai RPC : `hote` invite `ami`, qui accepte.
create function pg_temp.accepter_invitation(hote uuid, ami uuid, rythme text)
returns jsonb
language plpgsql
as $$
declare
  invitation uuid;
  debut timestamptz := pg_catalog.clock_timestamp() + interval '30 seconds';
begin
  insert into public.friendships(left_user_id, right_user_id)
  values (least(hote, ami), greatest(hote, ami))
  on conflict do nothing;
  insert into public.server_match_invitations(host_id, guest_id, pace, expires_at)
  values (hote, ami, rythme, pg_catalog.clock_timestamp() + interval '2 minutes')
  returning id into invitation;
  return public.server_respond_match_invitation_atomic(
    invitation, ami, 'accept',
    (select grid.id from public.server_grid_catalog as grid where grid.active is true order by grid.id limit 1),
    pg_catalog.jsonb_build_object(
      'playerIds', pg_catalog.jsonb_build_array(hote, ami),
      'invitationId', invitation,
      'bot', null,
      'scores', pg_catalog.jsonb_build_object()
    ),
    debut, debut + interval '45 seconds'
  );
end;
$$;

-- Tout ce qui est en cours pour ces joueurs est clos, et la file est vidée.
create function pg_temp.tourner_la_page(joueurs uuid[])
returns void
language sql
as $$
  update public.server_matches
  set status = 'finished', finish_reason = coalesce(finish_reason, 'completed')
  where status = 'active'
    and id in (select match_id from public.match_participants where user_id = any(joueurs));
  delete from public.server_match_searches;
$$;

do $$
declare
  a constant uuid := 'f0bd1104-0000-4000-8000-0000000000a1';
  b constant uuid := 'f0bd1104-0000-4000-8000-0000000000b2';
  c constant uuid := 'f0bd1104-0000-4000-8000-0000000000c3';
  d constant uuid := 'f0bd1104-0000-4000-8000-0000000000d4';
  e constant uuid := 'f0bd1104-0000-4000-8000-0000000000e5';
  g constant uuid := 'f0bd1104-0000-4000-8000-000000000a06';
  h constant uuid := 'f0bd1104-0000-4000-8000-000000000a07';
  automate constant uuid := 'f0bd1104-0000-4000-8000-0000000000ff';
  tous constant uuid[] := array[a, b, c, d, e, g, h];
  grille text;
  resultat jsonb;
  partie_auto uuid;
  partie uuid;
  ligne uuid;
  parties bigint;
  debut timestamptz := pg_catalog.clock_timestamp() + interval '30 seconds';
  etat jsonb;
  etat_chaine constant jsonb := pg_catalog.jsonb_build_object(
    'scores', pg_catalog.jsonb_build_object(),
    'chaine', pg_catalog.jsonb_build_object('tour', 1, 'lettres', pg_catalog.jsonb_build_array())
  );
  avec_automate constant jsonb := pg_catalog.jsonb_build_object('bot', pg_catalog.jsonb_build_object('playerId', automate));
  defauts text[] := '{}';
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  select joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  from pg_catalog.unnest(tous) as joueur;

  select grid.id into grille from public.server_grid_catalog as grid
  where grid.active is true order by grid.id limit 1;

  delete from public.server_match_searches;

  -- ── 1. L'incident : A joue contre l'automate et touche « Rejouer » ────────
  partie_auto := pg_temp.partie_auto(a, 'chaine', false);
  if exists (select 1 from public.server_match_searches where user_id = a) then
    raise exception 'Témoin : la partie doit emporter sa recherche';
  end if;

  resultat := public.server_matchmake_atomic(a, 'realtime', null, null, null, null, null, null, 'chaine');
  if exists (select 1 from public.server_match_searches where user_id = a and pace = 'realtime') then
    defauts := defauts || ('1. « Rejouer » remet en file un joueur déjà en partie : ' || resultat::text);
  end if;
  if resultat ->> 'matchId' is distinct from partie_auto::text then
    defauts := defauts || ('1. « Rejouer » doit rendre la partie en cours : ' || resultat::text);
  end if;

  -- ── 2. La partie est lancée : on laisse tomber, l'humain attend ───────────
  resultat := public.server_matchmake_atomic(b, 'realtime', null, null, null, null, null, null, 'chaine');
  if resultat ->> 'opponentId' = a::text then
    defauts := defauts || ('2. B ne doit pas tirer A d''une partie lancée : ' || resultat::text);
    etat := etat_chaine || pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(a, b));
    perform public.server_matchmake_atomic(b, 'realtime', a, (resultat ->> 'claimToken')::uuid, grille, etat, debut, debut + interval '30 seconds', 'chaine');
    parties := pg_temp.parties_en_cours(a);
    if parties <> 1 then
      defauts := defauts || ('2. A joue ' || parties::text || ' parties en même temps');
    end if;
  elsif not exists (select 1 from public.server_match_searches where user_id = b) then
    defauts := defauts || ('2. B doit rester en file : ' || resultat::text);
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- ── 3. La partie en est à la lecture : l'humain prend le dessus ───────────
  partie_auto := pg_temp.partie_auto(d, 'chaine', true);
  resultat := public.server_matchmake_atomic(e, 'realtime', null, null, null, null, null, null, 'chaine');
  if resultat ->> 'opponentId' is distinct from d::text then
    defauts := defauts || ('3. E cherche et D lit encore sa grille contre l''automate : ils doivent se trouver : ' || resultat::text);
  else
    etat := etat_chaine || pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(d, e));
    resultat := public.server_matchmake_atomic(e, 'realtime', d, (resultat ->> 'claimToken')::uuid, grille, etat, debut, debut + interval '30 seconds', 'chaine');
    if resultat ->> 'status' <> 'matched' then
      defauts := defauts || ('3. La partie entre D et E doit naître : ' || resultat::text);
    else
      partie := (resultat ->> 'matchId')::uuid;
      parties := pg_temp.parties_en_cours(d);
      if parties <> 1 then
        defauts := defauts || ('3. D joue ' || parties::text || ' parties en même temps');
      end if;
      if (select status from public.server_matches where id = partie_auto) = 'active' then
        defauts := defauts || '3. La partie contre l''automate doit céder la place'::text;
      end if;
      if (select finish_reason from public.server_matches where id = partie_auto) in ('completed', 'timeout', 'forfeit', 'ranked_transfer') then
        defauts := defauts || '3. La partie qui cède ne doit rien rapporter ni coûter : ce n''est pas une fin récompensée'::text;
      end if;
      if (select state ->> 'remplaceePar' from public.server_matches where id = partie_auto) is distinct from partie::text then
        defauts := defauts || '3. La partie qui cède doit dire où aller, sinon l''écran de D reste dessus'::text;
      end if;
      if exists (select 1 from public.server_match_searches where user_id in (d, e)) then
        defauts := defauts || '3. Aucune ligne en file ne doit survivre à la partie'::text;
      end if;
    end if;
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- La lecture se termine entre la réservation et la création : on laisse tomber aussi.
  partie_auto := pg_temp.partie_auto(d, 'chaine', true);
  resultat := public.server_matchmake_atomic(e, 'realtime', null, null, null, null, null, null, 'chaine');
  if resultat ->> 'opponentId' = d::text then
    update public.server_matches set turn_started_at = pg_catalog.clock_timestamp() - interval '1 second' where id = partie_auto;
    etat := etat_chaine || pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(d, e));
    resultat := public.server_matchmake_atomic(e, 'realtime', d, (resultat ->> 'claimToken')::uuid, grille, etat, debut, debut + interval '30 seconds', 'chaine');
    if resultat ->> 'status' = 'matched' or pg_temp.parties_en_cours(d) <> 1 or (select status from public.server_matches where id = partie_auto) <> 'active' then
      defauts := defauts || ('3. Une lecture finie entre-temps ne cède plus : ' || resultat::text);
    end if;
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- ── 4. Une partie entre humains ne cède jamais, même en lecture ───────────
  partie := pg_temp.partie_ecrite('normal', 'realtime', array[a, b], etat_chaine);
  insert into public.server_match_searches(user_id, pace, variante, created_at, updated_at)
  values (a, 'realtime', 'chaine', pg_catalog.clock_timestamp() - interval '5 seconds', pg_catalog.clock_timestamp());
  resultat := public.server_matchmake_atomic(c, 'realtime', null, null, null, null, null, null, 'chaine');
  if resultat ->> 'opponentId' = a::text then
    defauts := defauts || ('4. C ne doit pas tomber sur A, déjà en partie contre un humain : ' || resultat::text);
  end if;
  delete from public.server_match_searches;

  -- ── 5. Une ligne oubliée ne devient pas une seconde partie ────────────────
  insert into public.server_match_searches(user_id, pace, variante, created_at, updated_at)
  values (a, 'realtime', 'chaine', pg_catalog.clock_timestamp() - interval '20 seconds', pg_catalog.clock_timestamp())
  returning id into ligne;
  parties := pg_temp.parties_en_cours(a);
  etat := etat_chaine || avec_automate || pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(a, automate));
  resultat := public.server_create_bot_match_atomic(a, ligne, grille, etat, debut, debut + interval '30 seconds');
  if pg_temp.parties_en_cours(a) <> parties then
    defauts := defauts || ('5. Une ligne oubliée donne une seconde partie automatique à un joueur en partie : ' || (resultat ->> 'status'));
  end if;
  if exists (select 1 from public.server_match_searches where user_id = a) then
    defauts := defauts || '5. La ligne oubliée doit disparaître'::text;
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- ── 6. Une classée qui commence ne laisse pas de recherche normale ────────
  -- Sinon l'écran de fin de la classée la convertit en partie automatique. Elle naît en
  -- `pending`, comme le fait `server_ranked_matchmake_atomic` : tant que la confirmation
  -- n'a pas abouti, rien n'a commencé et la recherche reste.
  insert into public.server_match_searches(user_id, pace, variante, created_at, updated_at)
  values (c, 'realtime', 'classique', pg_catalog.clock_timestamp() - interval '20 seconds', pg_catalog.clock_timestamp());
  partie := pg_temp.partie_ecrite('ranked', 'realtime', array[c, d], pg_catalog.jsonb_build_object(), 'pending');
  if not exists (select 1 from public.server_match_searches where user_id = c) then
    defauts := defauts || '6. Une classée en attente de confirmation ne doit pas effacer la recherche normale'::text;
  end if;
  update public.server_matches set status = 'active' where id = partie;
  if exists (select 1 from public.server_match_searches where user_id = c) then
    defauts := defauts || '6. Une classée qui commence laisse la recherche normale du joueur en file'::text;
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- ── 7. Une invitation acceptée passe avant l'automate, même lancé ─────────
  partie_auto := pg_temp.partie_auto(a, 'classique', false);
  partie := pg_temp.partie_auto(b, 'classique', true);
  resultat := pg_temp.accepter_invitation(a, b, 'realtime');
  if resultat ->> 'status' is distinct from 'matched' then
    defauts := defauts || ('7. L''invitation doit donner une partie : ' || resultat::text);
  end if;
  if pg_temp.parties_en_cours(a) <> 1 or pg_temp.parties_en_cours(b) <> 1 then
    defauts := defauts || ('7. L''invitation laisse ' || pg_temp.parties_en_cours(a)::text || ' et ' || pg_temp.parties_en_cours(b)::text || ' parties aux deux amis');
  end if;
  if (select status from public.server_matches where id = partie_auto) = 'active' or (select status from public.server_matches where id = partie) = 'active' then
    defauts := defauts || '7. Les parties contre l''automate doivent céder la place à la partie entre amis'::text;
  end if;
  if (select state ->> 'remplaceePar' from public.server_matches where id = partie_auto) is distinct from resultat ->> 'matchId' then
    defauts := defauts || '7. La partie qui cède doit dire où aller'::text;
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- L'hôte ou l'invité joue contre quelqu'un : on ne l'en sort pas, l'invitation attend.
  partie := pg_temp.partie_ecrite('normal', 'realtime', array[a, b], pg_catalog.jsonb_build_object());
  resultat := pg_temp.accepter_invitation(a, c, 'realtime');
  if resultat ->> 'status' is distinct from 'occupied' or pg_temp.parties_en_cours(c) <> 0 then
    defauts := defauts || ('7. L''hôte joue contre un humain : pas de seconde partie : ' || (resultat ->> 'status'));
  end if;
  resultat := pg_temp.accepter_invitation(c, b, 'realtime');
  if resultat ->> 'status' is distinct from 'occupied' or pg_temp.parties_en_cours(c) <> 0 then
    defauts := defauts || ('7. L''invité joue contre un humain : pas de seconde partie : ' || (resultat ->> 'status'));
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- Une classée contre un adversaire automatique ne se quitte pas par ce chemin.
  partie := pg_temp.partie_ecrite('ranked', 'realtime', array[a], avec_automate);
  resultat := pg_temp.accepter_invitation(a, c, 'realtime');
  if resultat ->> 'status' is distinct from 'occupied' or (select status from public.server_matches where id = partie) <> 'active' then
    defauts := defauts || ('7. Une classée ne cède pas à une invitation : ' || (resultat ->> 'status'));
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- Le défi du jour non plus : rien n'en fait sortir.
  partie := pg_temp.partie_ecrite('solo', 'realtime', array[a], avec_automate || pg_catalog.jsonb_build_object('isDaily', true));
  resultat := pg_temp.accepter_invitation(a, c, 'realtime');
  if resultat ->> 'status' is distinct from 'occupied' or (select status from public.server_matches where id = partie) <> 'active' then
    defauts := defauts || ('7. Le défi du jour ne cède pas à une invitation : ' || (resultat ->> 'status'));
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- Une invitation en illimité n'interrompt rien.
  partie_auto := pg_temp.partie_auto(a, 'classique', false);
  resultat := pg_temp.accepter_invitation(a, c, 'async');
  if resultat ->> 'status' is distinct from 'matched' or (select status from public.server_matches where id = partie_auto) <> 'active' then
    defauts := defauts || ('Témoin : une invitation en illimité n''interrompt rien : ' || (resultat ->> 'status'));
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- ── Témoins : ce que la priorité aux humains ne doit pas toucher ──────────
  -- Toutes ces parties sont en lecture : c'est le seul moment où l'une d'elles pourrait céder.
  -- Le défi du jour : rien n'en fait sortir.
  partie := pg_temp.partie_ecrite('solo', 'realtime', array[g], avec_automate || pg_catalog.jsonb_build_object('isDaily', true));
  resultat := public.server_matchmake_atomic(h, 'realtime', null, null, null, null, null, null, 'classique');
  if resultat ->> 'opponentId' = g::text then
    defauts := defauts || ('Témoin : un joueur en plein défi du jour ne doit être proposé à personne : ' || resultat::text);
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- L'autre variante : une chaîne ne donne jamais une partie de 45 s, ni l'inverse.
  partie := pg_temp.partie_auto(g, 'chaine', true);
  resultat := public.server_matchmake_atomic(h, 'realtime', null, null, null, null, null, null, 'classique');
  if resultat ->> 'opponentId' = g::text then
    defauts := defauts || ('Témoin : une recherche de 45 s ne doit pas tirer un joueur d''une chaîne : ' || resultat::text);
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- Un joueur bloqué.
  partie := pg_temp.partie_auto(g, 'classique', true);
  insert into public.blocks(owner_id, blocked_id) values (g, h);
  resultat := public.server_matchmake_atomic(h, 'realtime', null, null, null, null, null, null, 'classique');
  if resultat ->> 'opponentId' = g::text then
    defauts := defauts || ('Témoin : un joueur bloqué ne doit pas être proposé : ' || resultat::text);
  end if;
  delete from public.blocks where owner_id = g and blocked_id = h;
  perform pg_temp.tourner_la_page(tous);

  -- L'illimité : une partie à 24 h n'interrompt rien et n'est interrompue par rien.
  partie := pg_temp.partie_ecrite('normal', 'async', array[g], avec_automate);
  resultat := public.server_matchmake_atomic(h, 'realtime', null, null, null, null, null, null, 'classique');
  if resultat ->> 'opponentId' = g::text then
    defauts := defauts || ('Témoin : une partie illimitée ne doit pas céder sa place : ' || resultat::text);
  end if;
  perform pg_temp.tourner_la_page(tous);

  -- La partie finie, on peut chercher de nouveau, et la ligne attend un humain.
  resultat := public.server_matchmake_atomic(a, 'realtime', null, null, null, null, null, null, 'chaine');
  if resultat ->> 'status' <> 'waiting' or not exists (select 1 from public.server_match_searches where user_id = a) then
    defauts := defauts || ('Témoin : la partie finie, le joueur doit pouvoir chercher : ' || resultat::text);
  end if;

  if pg_catalog.array_length(defauts, 1) is not null then
    raise exception E'% défaut(s) :\n%', pg_catalog.array_length(defauts, 1), pg_catalog.array_to_string(defauts, E'\n');
  end if;
end;
$$;

rollback;

-- Le duel en chaîne (migration 20261102220000).
--
-- Trois promesses en base :
--   1. un joueur qui cherche « En chaîne » ne tombe jamais sur une partie de 45 s,
--      et la partie créée est bien de la variante cherchée ;
--   2. une lettre posée dans un tour ne réveille personne : ni `changed` sur le canal
--      de la partie, ni le menu des joueurs. Seul l'événement `chaine` part, sans
--      chevalet, sans sac, sans solution ;
--   3. les autres parties ne bougent pas : chaque écriture diffuse `changed` comme avant.

begin;

do $$
declare
  a constant uuid := 'f0bd1102-0000-4000-8000-0000000000a1';
  b constant uuid := 'f0bd1102-0000-4000-8000-0000000000b2';
  c constant uuid := 'f0bd1102-0000-4000-8000-0000000000c3';
  grille text;
  partie uuid;
  classique uuid;
  resultat jsonb;
  jeton uuid;
  etat jsonb;
  envois bigint;
  debut timestamptz := pg_catalog.clock_timestamp() + interval '30 seconds';
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (a, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (b, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (c, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  select grid.id into grille from public.server_grid_catalog as grid
  where grid.active is true order by grid.id limit 1;

  delete from public.server_match_searches;

  -- ── Les droits ────────────────────────────────────────────────────────────
  if pg_catalog.has_function_privilege('authenticated', 'public.server_matchmake_atomic(uuid,text,uuid,uuid,text,jsonb,timestamptz,timestamptz,text)', 'execute') then
    raise exception 'Seul match-api apparie';
  end if;

  -- ── Des demandes invalides ────────────────────────────────────────────────
  resultat := public.server_matchmake_atomic(a, 'realtime', null, null, null, null, null, null, 'autre chose');
  if resultat ->> 'status' <> 'invalid' then raise exception 'Variante inconnue acceptée : %', resultat; end if;
  resultat := public.server_matchmake_atomic(a, 'async', null, null, null, null, null, null, 'chaine');
  if resultat ->> 'status' <> 'invalid' then raise exception 'Une chaîne est en temps limité : %', resultat; end if;

  -- ── Deux files séparées ───────────────────────────────────────────────────
  perform public.server_matchmake_atomic(a, 'realtime', null, null, null, null, null, null, 'chaine');
  if (select variante from public.server_match_searches where user_id = a) <> 'chaine' then
    raise exception 'La recherche doit garder sa variante';
  end if;

  -- Sans variante, c'est une partie ordinaire : elle ne doit pas tomber sur lui.
  resultat := public.server_matchmake_atomic(b, 'realtime', null, null, null, null, null, null);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'Une recherche de 45 s ne doit pas trouver une recherche en chaîne : %', resultat;
  end if;
  if (select variante from public.server_match_searches where user_id = b) <> 'classique' then
    raise exception 'Sans variante, la recherche reste ordinaire';
  end if;

  -- Et l'inverse : celui qui cherche en chaîne ne prend pas la place de l'ordinaire.
  resultat := public.server_matchmake_atomic(c, 'realtime', null, null, null, null, null, null, 'chaine');
  if resultat ->> 'status' <> 'candidate' or resultat ->> 'opponentId' <> a::text then
    raise exception 'Deux recherches en chaîne doivent se trouver : %', resultat;
  end if;
  jeton := (resultat ->> 'claimToken')::uuid;

  -- Une partie sans le marqueur de chaîne ne passe pas : elle serait de 45 s pour eux.
  etat := pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(a, c), 'scores', pg_catalog.jsonb_build_object());
  resultat := public.server_matchmake_atomic(c, 'realtime', a, jeton, grille, etat, debut, debut + interval '30 seconds', 'chaine');
  if resultat ->> 'status' <> 'retry' then
    raise exception 'La partie créée doit être de la variante cherchée : %', resultat;
  end if;

  resultat := public.server_matchmake_atomic(c, 'realtime', null, null, null, null, null, null, 'chaine');
  jeton := (resultat ->> 'claimToken')::uuid;
  etat := etat || pg_catalog.jsonb_build_object('chaine', pg_catalog.jsonb_build_object('tour', 1, 'lettres', pg_catalog.jsonb_build_array()));
  resultat := public.server_matchmake_atomic(c, 'realtime', a, jeton, grille, etat, debut, debut + interval '30 seconds', 'chaine');
  if resultat ->> 'status' <> 'matched' then
    raise exception 'Les deux recherches en chaîne devaient faire une partie : %', resultat;
  end if;
  partie := (resultat ->> 'matchId')::uuid;
  if (select pace from public.server_matches where id = partie) <> 'realtime' then
    raise exception 'Une chaîne reste une partie en temps limité, pour tout le reste du jeu';
  end if;
  if not exists (select 1 from public.server_match_searches where user_id = b and variante = 'classique') then
    raise exception 'La recherche ordinaire doit rester en file';
  end if;

  -- ── Une lettre dans le tour : l'événement `chaine`, et rien d'autre ───────
  delete from realtime.messages where topic in ('match:' || partie::text, 'user:' || a::text, 'user:' || c::text);

  update public.server_matches
  set state = state
        || pg_catalog.jsonb_build_object('chaine', pg_catalog.jsonb_build_object('tour', 1, 'lettres', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('cellIndex', 8, 'letter', 'A'))))
        || pg_catalog.jsonb_build_object('scores', pg_catalog.jsonb_build_object(a::text, 1), 'racks', pg_catalog.jsonb_build_object(a::text, pg_catalog.jsonb_build_array('Z')), 'letterBag', pg_catalog.jsonb_build_array('Y')),
      updated_at = pg_catalog.clock_timestamp()
  where id = partie;

  select count(*) into envois from realtime.messages where topic = 'match:' || partie::text and event = 'changed';
  if envois <> 0 then raise exception 'Une lettre ne doit pas réveiller le sondage de l''autre : % changed', envois; end if;
  select count(*) into envois from realtime.messages where topic in ('user:' || a::text, 'user:' || c::text);
  if envois <> 0 then raise exception 'Une lettre ne doit pas réveiller le menu des joueurs : % réveils', envois; end if;
  select count(*) into envois from realtime.messages where topic = 'match:' || partie::text and event = 'chaine' and private;
  if envois <> 1 then raise exception 'Une lettre doit partir une fois sur le canal privé : % envois', envois; end if;

  -- Ce qui part : les lettres et les scores. Pas le chevalet, pas le sac.
  if exists (
    select 1 from realtime.messages
    where topic = 'match:' || partie::text and event = 'chaine'
      and (payload ? 'racks' or payload ? 'letterBag' or payload ? 'board' or payload -> 'chaine' -> 'lettres' -> 0 ->> 'letter' <> 'A' or not payload ? 'updatedAt' or (payload ->> 'turnNumber')::integer <> 1)
  ) then
    raise exception 'La diffusion ne doit porter que le tour en cours, déjà public';
  end if;

  -- Une écriture sans lettre nouvelle (« Je suis là ») ne diffuse rien.
  update public.server_matches
  set state = state || pg_catalog.jsonb_build_object('presenceAck', pg_catalog.jsonb_build_object(a::text, 1)), updated_at = pg_catalog.clock_timestamp()
  where id = partie;
  select count(*) into envois from realtime.messages where topic = 'match:' || partie::text;
  if envois <> 1 then raise exception 'Rien de neuf, rien à diffuser : % envois', envois; end if;

  -- ── Le tour passe : le signal ordinaire, sans le menu ─────────────────────
  update public.server_matches set turn_number = 2, current_player_id = c, updated_at = pg_catalog.clock_timestamp() where id = partie;
  select count(*) into envois from realtime.messages where topic = 'match:' || partie::text and event = 'changed';
  if envois <> 1 then raise exception 'Un changement de tour doit réveiller l''autre : % changed', envois; end if;
  select count(*) into envois from realtime.messages where topic = 'user:' || a::text;
  if envois <> 0 then raise exception 'Un tour de chaîne qui passe ne réveille pas le menu : % réveils', envois; end if;

  -- ── La fin de partie réveille le menu, comme toujours ─────────────────────
  update public.server_matches set status = 'finished', updated_at = pg_catalog.clock_timestamp() where id = partie;
  select count(*) into envois from realtime.messages where topic = 'user:' || a::text;
  if envois <> 1 then raise exception 'La fin d''une chaîne doit réveiller le menu : % réveils', envois; end if;

  -- ── Les autres parties ne bougent pas ─────────────────────────────────────
  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number, created_at, updated_at)
  values ('normal', 'realtime', grille, pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(a, b), 'scores', pg_catalog.jsonb_build_object()),
          'active', a, 1, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
  returning id into classique;
  insert into public.match_participants(match_id, user_id, opponent_id) values (classique, a, b), (classique, b, a);
  delete from realtime.messages where topic in ('match:' || classique::text, 'user:' || a::text);
  update public.server_matches set state = state || pg_catalog.jsonb_build_object('scores', pg_catalog.jsonb_build_object(a::text, 3)), updated_at = pg_catalog.clock_timestamp() where id = classique;
  select count(*) into envois from realtime.messages where topic = 'match:' || classique::text and event = 'changed';
  if envois <> 1 then raise exception 'Une partie ordinaire diffuse chaque écriture : % changed', envois; end if;
  select count(*) into envois from realtime.messages where topic = 'user:' || a::text;
  if envois <> 1 then raise exception 'Une partie ordinaire réveille le menu à chaque écriture : % réveils', envois; end if;

  -- ── La variante d'une invitation ──────────────────────────────────────────
  insert into public.server_match_invitations(host_id, guest_id, pace, variante, expires_at)
  values (a, b, 'realtime', 'chaine', pg_catalog.clock_timestamp() + interval '2 minutes');
  if not exists (select 1 from public.server_match_invitations where host_id = a and guest_id = b and variante = 'chaine') then
    raise exception 'L''invitation doit garder sa variante';
  end if;
  begin
    insert into public.server_match_invitations(host_id, guest_id, pace, variante, expires_at)
    values (b, a, 'realtime', 'n importe quoi', pg_catalog.clock_timestamp() + interval '2 minutes');
    raise exception 'Une variante inconnue ne doit pas entrer en base';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;

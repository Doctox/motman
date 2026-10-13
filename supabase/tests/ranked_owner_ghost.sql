-- Le fantôme du propriétaire en classée (11/10/2026).
--
-- Un joueur seul en file depuis une minute reçoit le fantôme du propriétaire :
-- la confirmation s'ouvre comme pour un vrai adversaire, la partie se joue, et
-- le résultat ne bouge QUE les points du joueur. Le test vérifie aussi les
-- refus : trop tôt, trop de monde en ligne, et personne d'autre qu'un admin ne
-- peut servir de fantôme.

begin;

do $$
declare
  proprio  constant uuid := 'f0bb3001-0000-4000-8000-0000000000a1';
  joueur   constant uuid := 'f0bb3002-0000-4000-8000-0000000000a2';
  autre    constant uuid := 'f0bb3003-0000-4000-8000-0000000000a3';
  grille   text;
  etat     jsonb;
  resultat jsonb;
  partie   uuid;
  session  uuid;
  points_proprio_avant integer;
  matches_proprio_avant integer;
  points_joueur_avant integer;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (proprio, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (joueur,  false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre,   false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  -- La file et la présence réelles sont écartées le temps du test : tout est
  -- annulé avec la transaction. Sans cela, le test dépendrait de qui joue en
  -- production au moment où il tourne.
  delete from public.server_ranked_searches;
  update public.profiles
  set last_seen = pg_catalog.clock_timestamp() - interval '10 minutes'
  where last_seen > pg_catalog.clock_timestamp() - interval '75 seconds';

  update public.profiles set role = 'admin' where id = proprio;
  update public.player_progress set ranked_points = 1300, ranked_matches = 20 where user_id = proprio;
  update public.player_progress set ranked_points = 1000, ranked_matches = 10 where user_id = joueur;
  select ranked_points, ranked_matches into points_proprio_avant, matches_proprio_avant
  from public.player_progress where user_id = proprio;
  select ranked_points into points_joueur_avant from public.player_progress where user_id = joueur;

  select id into grille from public.server_grid_catalog
  where active and coalesce((payload ->> 'dailyOnly')::boolean, false) = false
  order by id limit 1;

  etat := jsonb_build_object(
    'playerIds', jsonb_build_array(joueur, proprio),
    'bot', jsonb_build_object('playerId', proprio, 'ghostOf', proprio, 'displayName', 'Proprio', 'level', 30, 'skill', 'expert', 'avatarId', 'a', 'frameId', 'f')
  );

  -- Le joueur entre en file, et il est seul en ligne.
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  update public.profiles set last_seen = pg_catalog.clock_timestamp() where id = joueur;

  -- ── 1. Trop tôt : moins d'une minute d'attente ────────────────────────────
  resultat := public.server_create_ranked_ghost_match_atomic(joueur, proprio, grille, etat);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'Le fantome ne doit pas venir avant une minute : %', resultat;
  end if;

  update public.server_ranked_searches
  set created_at = pg_catalog.clock_timestamp() - interval '70 seconds'
  where user_id = joueur;

  -- ── 2. Deux joueurs en ligne : le fantôme s'efface ────────────────────────
  update public.profiles set last_seen = pg_catalog.clock_timestamp() where id = autre;
  resultat := public.server_create_ranked_ghost_match_atomic(joueur, proprio, grille, etat);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'Le fantome ne doit pas venir quand deux joueurs sont en ligne : %', resultat;
  end if;
  update public.profiles set last_seen = pg_catalog.clock_timestamp() - interval '10 minutes' where id = autre;

  -- ── 3. Seul un admin peut servir de fantôme, et jamais à lui-même ─────────
  resultat := public.server_create_ranked_ghost_match_atomic(joueur, autre, grille,
    jsonb_set(jsonb_set(jsonb_set(etat, '{playerIds}', jsonb_build_array(joueur, autre)), '{bot,playerId}', to_jsonb(autre::text)), '{bot,ghostOf}', to_jsonb(autre::text)));
  if resultat ->> 'status' <> 'unavailable' then
    raise exception 'Un joueur ordinaire ne doit pas servir de fantome : %', resultat;
  end if;
  resultat := public.server_create_ranked_ghost_match_atomic(proprio, proprio, grille, etat);
  if resultat ->> 'status' <> 'forbidden' then
    raise exception 'Le proprietaire ne doit pas affronter son propre fantome : %', resultat;
  end if;

  -- ── 4. Éteint par le propriétaire : on attend un vrai adversaire ──────────
  insert into public.owner_switches(name, enabled) values ('fantome', false)
  on conflict (name) do update set enabled = false;
  resultat := public.server_create_ranked_ghost_match_atomic(joueur, proprio, grille, etat);
  if resultat ->> 'status' <> 'waiting' then
    raise exception 'Le fantome eteint ne doit pas venir : %', resultat;
  end if;
  update public.owner_switches set enabled = true where name = 'fantome';

  -- ── 5. Seul, après une minute : la confirmation s'ouvre ───────────────────
  resultat := public.server_create_ranked_ghost_match_atomic(joueur, proprio, grille, etat);
  if resultat ->> 'status' <> 'ready' or (resultat ->> 'created')::boolean is not true then
    raise exception 'Le fantome aurait du ouvrir la confirmation : %', resultat;
  end if;
  partie := (resultat ->> 'matchId')::uuid;
  session := (resultat ->> 'readySessionId')::uuid;

  if (select count(*) from public.match_participants where match_id = partie) <> 1
     or exists (select 1 from public.match_participants where match_id = partie and user_id = proprio) then
    raise exception 'Seul le joueur doit etre inscrit dans la partie du fantome';
  end if;
  if not (select player_b_accepted and not player_a_accepted from public.server_ranked_ready_sessions where id = session) then
    raise exception 'Le fantome doit avoir deja accepte, et le joueur pas encore';
  end if;
  if (select status from public.server_ranked_searches where user_id = joueur) <> 'ready' then
    raise exception 'La recherche du joueur doit passer en confirmation';
  end if;

  -- ── 6. Le joueur accepte : la partie démarre ──────────────────────────────
  resultat := public.server_respond_ranked_ready_atomic(joueur, session, 'accept');
  if resultat ->> 'status' <> 'started' then
    raise exception 'La partie contre le fantome aurait du demarrer : %', resultat;
  end if;
  if exists (select 1 from public.server_ranked_searches where user_id in (joueur, proprio)) then
    raise exception 'Aucune recherche ne doit rester apres le depart';
  end if;

  -- ── 7. Le joueur gagne : seuls SES points bougent ─────────────────────────
  update public.server_matches
  set status = 'finished', finish_reason = 'completed', winner_id = joueur, current_player_id = null
  where id = partie;
  resultat := public.server_apply_ranked_result_atomic(partie);
  if resultat ->> 'status' <> 'applied' or (resultat ->> 'ghost')::boolean is not true then
    raise exception 'Le resultat contre le fantome aurait du etre applique : %', resultat;
  end if;

  if (select ranked_points from public.player_progress where user_id = joueur) <= points_joueur_avant then
    raise exception 'Le joueur aurait du gagner des points en battant le fantome';
  end if;
  if (select ranked_points from public.player_progress where user_id = proprio) <> points_proprio_avant
     or (select ranked_matches from public.player_progress where user_id = proprio) <> matches_proprio_avant then
    raise exception 'Le classement du proprietaire ne doit jamais bouger';
  end if;
  if (select count(*) from public.ranked_rating_events where match_id = partie) <> 1
     or (select opponent_id from public.ranked_rating_events where match_id = partie) <> proprio then
    raise exception 'Une seule ligne d''evenement, celle du joueur, avec le proprietaire pour adversaire';
  end if;
  -- Contre 1300, le joueur à 1000 gagne gros : l'écart se calcule sur le vrai
  -- classement du propriétaire.
  if (select points_delta from public.ranked_rating_events where match_id = partie) < 30 then
    raise exception 'Le gain doit se calculer sur le classement du proprietaire';
  end if;

  if public.server_apply_ranked_result_atomic(partie) ->> 'status' <> 'already-applied' then
    raise exception 'Le resultat ne doit s''appliquer qu''une fois';
  end if;

  -- ── 8. Le fantôme a sa propre note (13/10/2026) ──────────────────────────
  -- Elle part du classement du propriétaire, puis encaisse ses défaites : battu,
  -- il descend sous 1300 ; le propriétaire, lui, reste à 1300.
  if (select points from public.ghost_ratings where owner_id = proprio) >= points_proprio_avant
     or (select matches from public.ghost_ratings where owner_id = proprio) <> 1
     or (select losses from public.ghost_ratings where owner_id = proprio) <> 1 then
    raise exception 'Battu, le fantome aurait du perdre des points sur SA note : %',
      (select to_jsonb(r) from public.ghost_ratings r where owner_id = proprio);
  end if;

  -- Une seconde partie se calcule sur cette note-là, plus sur celle du
  -- propriétaire : le même joueur, à classement égal, gagne moins.
  update public.player_progress set ranked_points = 1000, ranked_matches = 10 where user_id = joueur;
  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number, winner_id, finish_reason)
  values ('ranked', 'realtime', grille, etat, 'finished', null, 9, joueur, 'completed')
  returning id into partie;
  resultat := public.server_apply_ranked_result_atomic(partie);
  if (resultat -> 'ghostPoints' ->> 'before')::integer >= points_proprio_avant
     or (resultat -> 'player' ->> 'delta')::integer >= (select points_delta from public.ranked_rating_events e
         where e.user_id = joueur and e.match_id <> partie order by e.created_at limit 1) then
    raise exception 'La seconde partie aurait du se calculer sur la note du fantome, plus basse : %', resultat;
  end if;
  if (select ranked_points from public.player_progress where user_id = proprio) <> points_proprio_avant then
    raise exception 'Le classement du proprietaire ne doit jamais bouger';
  end if;
end;
$$;

rollback;

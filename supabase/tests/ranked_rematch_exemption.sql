-- On peut rejouer le propriétaire tout de suite (migration 20260925090000).
--
-- Le matchmaking classé écarte un candidat contre qui on vient de finir une
-- partie classée depuis moins de dix minutes. Quatre promesses :
--   1. entre deux joueurs ORDINAIRES, la pause tient — c'est là qu'elle sert,
--      à empêcher un duo de se fabriquer du classement en boucle ;
--   2. quand le propriétaire cherche, elle saute ;
--   3. quand c'est LUI qu'on cherche, elle saute aussi — c'est le cas réel ;
--   4. passé dix minutes, elle est levée pour tout le monde.
--
-- On entre en file par le RPC lui-même : une ligne posée à la main dans
-- `server_ranked_searches` n'a ni instantané de classement ni tranche.

begin;

do $$
declare
  joueur constant uuid := 'f7ee0925-0000-4000-8000-0000000000b1';
  autre constant uuid := 'f7ee0925-0000-4000-8000-0000000000b2';
  grille text;
  duel uuid;
  resultat jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  -- Même tranche, sinon ils ne sont pas appariables pour une raison étrangère
  -- à ce qu'on éprouve ici.
  update public.player_progress
  set ranked_points = 1200, ranked_matches = 10
  where user_id in (joueur, autre);

  select grid.id into grille
  from public.server_grid_catalog as grid
  where grid.active is true
  order by grid.id
  limit 1;
  if grille is null then
    raise exception 'Cet essai a besoin d''une grille active';
  end if;

  -- Une partie classée entre eux, terminée il y a deux minutes.
  insert into public.server_matches(mode, pace, grid_id, state, status, finish_reason, updated_at)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object(
            'playerIds', pg_catalog.jsonb_build_array(joueur, autre),
            'bot', null,
            'scores', pg_catalog.jsonb_build_object(joueur::text, 0, autre::text, 0)),
          'finished', 'completed', pg_catalog.clock_timestamp() - interval '2 minutes')
  returning id into duel;
  insert into public.match_participants(match_id, user_id, opponent_id)
  values (duel, joueur, autre), (duel, autre, joueur);

  -- ── 1. Deux joueurs ordinaires : la pause tient ───────────────────────────
  delete from public.server_ranked_searches;
  perform public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  if resultat ->> 'opponentId' = autre::text then
    raise exception 'Deux joueurs ordinaires ne doivent pas se rejouer avant dix minutes : %', resultat;
  end if;

  -- ── 2. Le propriétaire CHERCHE : la pause saute ───────────────────────────
  update public.profiles set role = 'admin' where id = joueur;
  delete from public.server_ranked_searches;
  perform public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  if resultat ->> 'opponentId' is distinct from autre::text then
    raise exception 'Le proprietaire doit pouvoir reprendre le meme adversaire : %', resultat;
  end if;

  -- ── 3. Le propriétaire est CHERCHÉ : la pause saute aussi ─────────────────
  -- Le cas réel : le joueur relance une classée juste après l'avoir affronté.
  update public.profiles set role = 'player' where id = joueur;
  update public.profiles set role = 'admin' where id = autre;
  delete from public.server_ranked_searches;
  perform public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  if resultat ->> 'opponentId' is distinct from autre::text then
    raise exception 'Un joueur doit pouvoir reprendre le proprietaire : %', resultat;
  end if;

  -- ── 4. Passé dix minutes, la pause est levée pour tous ────────────────────
  update public.profiles set role = 'player' where id in (joueur, autre);
  update public.server_matches set updated_at = pg_catalog.clock_timestamp() - interval '11 minutes'
  where id = duel;
  delete from public.server_ranked_searches;
  perform public.server_ranked_matchmake_atomic(autre, null, null, null, null);
  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  if resultat ->> 'opponentId' is distinct from autre::text then
    raise exception 'Apres dix minutes, la pause doit etre levee pour tous : %', resultat;
  end if;
end;
$$;

rollback;

-- Les joueurs de l'ombre (13/10/2026).
--
-- Six comptes qui ne jouent qu'en classée quand personne n'est en ligne. Le
-- test vérifie qu'ils existent avec un visage de joueur, qu'ils n'entrent qu'à
-- leur date, que leur note bouge comme celle d'un joueur, qu'ils ne gonflent
-- pas le pouls, et que chaque mois l'un de leurs habits change.
--
-- AUCUN PSEUDO ICI : le dépôt est public, et un pseudo dirait à n'importe qui
-- lequel de ses adversaires est une ombre. Le test les prend dans
-- `shadow_players`, par ordre d'arrivée, et règle lui-même deux dates
-- d'arrivée — la transaction est annulée : il reste valable une fois les six
-- arrivés, et quand l'une d'elles a déjà joué de vraies parties.

begin;

do $$
declare
  joueur      constant uuid := 'f0cc4001-0000-4000-8000-0000000000b1';
  arrivee     uuid;  -- une ombre déjà là
  attendue    uuid;  -- une ombre pas encore arrivée
  grille      text;
  etat        jsonb;
  resultat    jsonb;
  partie      uuid;
  session     uuid;
  note_avant  record;
  avant       record;
  apres       record;
  comptes     integer;
begin
  -- ── 1. Les six, avec un visage de joueur ─────────────────────────────────
  if (select count(*) from public.shadow_players) <> 6 then
    raise exception 'Six joueurs de l''ombre attendus, % trouves', (select count(*) from public.shadow_players);
  end if;
  -- Un vrai compte, un drapeau ou un animal (jamais l'avatar de départ), un
  -- titre qu'il possède, une progression, et jamais « en ligne ».
  if exists (
    select 1
    from public.shadow_players s
    join public.profiles p on p.id = s.user_id
    left join public.player_progress pp on pp.user_id = s.user_id
    where p.account_kind <> 'account'
       or not (p.avatar_id like 'drapeau-%' or p.avatar_id in ('lapin', 'loutre', 'panda'))
       or not exists (select 1 from public.player_titles t where t.user_id = s.user_id and t.title_id = p.title_id)
       or pp.user_id is null
       or p.last_seen > pg_catalog.now() - interval '1 day'
  ) then
    raise exception 'Une ombre n''a pas un visage de joueur';
  end if;
  -- Ils arrivent l'un après l'autre, à trois jours d'écart.
  if exists (
    select 1 from (
      select arrives_at - pg_catalog.lag(arrives_at) over (order by arrives_at) as ecart
      from public.shadow_players
    ) as ecarts
    where ecart is not null and ecart <> interval '3 days'
  ) then
    raise exception 'Les ombres doivent arriver a trois jours d''ecart';
  end if;

  -- ── 2. Le pouls ne les compte pas ────────────────────────────────────────
  comptes := (public.server_game_pulse('00000000-0000-4000-8000-000000000000'::uuid) ->> 'comptes')::integer;
  if comptes <> (select count(*) from public.profiles p where p.account_kind = 'account'
                 and not exists (select 1 from public.shadow_players s where s.user_id = p.id)) then
    raise exception 'Le pouls compte les joueurs de l''ombre parmi les comptes';
  end if;

  -- ── 3. Seule une ombre ARRIVÉE peut prendre une classée ──────────────────
  select user_id into arrivee from public.shadow_players order by arrives_at limit 1;
  select user_id into attendue from public.shadow_players order by arrives_at desc limit 1;
  update public.shadow_players set arrives_at = pg_catalog.clock_timestamp() - interval '1 minute' where user_id = arrivee;
  update public.shadow_players set arrives_at = pg_catalog.clock_timestamp() + interval '1 day' where user_id = attendue;

  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
  delete from public.server_ranked_searches;
  update public.profiles set last_seen = pg_catalog.clock_timestamp() - interval '10 minutes'
  where last_seen > pg_catalog.clock_timestamp() - interval '75 seconds';
  update public.player_progress set ranked_points = 1000, ranked_matches = 10 where user_id = joueur;
  insert into public.owner_switches(name, enabled) values ('fantome', true) on conflict (name) do update set enabled = true;

  select id into grille from public.server_grid_catalog
  where active and coalesce((payload ->> 'dailyOnly')::boolean, false) = false order by id limit 1;

  resultat := public.server_ranked_matchmake_atomic(joueur, null, null, null, null);
  update public.server_ranked_searches set created_at = pg_catalog.clock_timestamp() - interval '70 seconds' where user_id = joueur;
  update public.profiles set last_seen = pg_catalog.clock_timestamp() where id = joueur;

  -- L'état que match-api écrirait : le bot porte le visage du compte.
  select jsonb_build_object('playerIds', jsonb_build_array(joueur, p.id),
    'bot', jsonb_build_object('playerId', p.id, 'ghostOf', p.id, 'ombre', true, 'displayName', p.display_name,
      'level', coalesce(pp.level, 1), 'skill', 'regular', 'avatarId', p.avatar_id, 'frameId', p.frame_id))
  into etat
  from public.profiles p left join public.player_progress pp on pp.user_id = p.id
  where p.id = attendue;
  if public.server_create_ranked_ghost_match_atomic(joueur, attendue, grille, etat) ->> 'status' <> 'unavailable' then
    raise exception 'Une ombre pas encore arrivee ne doit pas jouer';
  end if;

  select jsonb_build_object('playerIds', jsonb_build_array(joueur, p.id),
    'bot', jsonb_build_object('playerId', p.id, 'ghostOf', p.id, 'ombre', true, 'displayName', p.display_name,
      'level', coalesce(pp.level, 1), 'skill', 'regular', 'avatarId', p.avatar_id, 'frameId', p.frame_id))
  into etat
  from public.profiles p left join public.player_progress pp on pp.user_id = p.id
  where p.id = arrivee;
  resultat := public.server_create_ranked_ghost_match_atomic(joueur, arrivee, grille, etat);
  if resultat ->> 'status' <> 'ready' then
    raise exception 'Une ombre arrivee aurait du prendre la classee : %', resultat;
  end if;
  partie := (resultat ->> 'matchId')::uuid;
  session := (resultat ->> 'readySessionId')::uuid;
  if public.server_respond_ranked_ready_atomic(joueur, session, 'accept') ->> 'status' <> 'started' then
    raise exception 'La classee contre l''ombre aurait du demarrer';
  end if;

  -- ── 4. Sa note bouge comme celle d'un joueur ─────────────────────────────
  -- Relative à la note du moment : l'ombre a peut-être déjà de vraies parties.
  -- Avant la première, la note stockée vaut 0 et compte pour 1 000.
  select case when ranked_matches = 0 then 1000 else ranked_points end as ranked_points, ranked_matches
  into note_avant from public.player_progress where user_id = arrivee;
  update public.server_matches set status = 'finished', finish_reason = 'completed', winner_id = joueur, current_player_id = null where id = partie;
  resultat := public.server_apply_ranked_result_atomic(partie);
  if resultat ->> 'status' <> 'applied' or resultat ? 'ghost' then
    raise exception 'Une ombre passe par la voie ordinaire, pas par celle du fantome : %', resultat;
  end if;
  if (select ranked_matches from public.player_progress where user_id = arrivee) <> note_avant.ranked_matches + 1
     or (select ranked_points from public.player_progress where user_id = arrivee) >= note_avant.ranked_points
     or (select count(*) from public.ranked_rating_events where match_id = partie) <> 2 then
    raise exception 'Battue, l''ombre aurait du perdre des points sur SA note : avant %, apres %', to_jsonb(note_avant),
      (select to_jsonb(pp) from public.player_progress pp where pp.user_id = arrivee);
  end if;

  -- ── 5. Chaque mois, un avatar OU un cadre neuf ───────────────────────────
  select p.avatar_id, p.frame_id into avant from public.profiles p where p.id = arrivee;
  if private.renouveler_ombres('2026-11') <> 6 then
    raise exception 'Les six ombres auraient du changer d''habit';
  end if;
  select p.avatar_id, p.frame_id into apres from public.profiles p where p.id = arrivee;
  if (avant.avatar_id <> apres.avatar_id) = (avant.frame_id <> apres.frame_id) then
    raise exception 'Un mois, une seule chose change (avatar OU cadre) : avant %, apres %', to_jsonb(avant), to_jsonb(apres);
  end if;
  if not exists (select 1 from cron.job where jobname = 'motman-renouveler-ombres' and schedule = '0 9 1 * *') then
    raise exception 'Le renouvellement mensuel doit etre planifie';
  end if;
end;
$$;

rollback;

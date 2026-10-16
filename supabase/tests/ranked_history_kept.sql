-- L'historique classé reste après la purge de sa partie (16/10/2026).
--
-- Une classée finie depuis 27 h : son résultat s'applique, puis la VRAIE purge
-- horaire (`private.purge_stale_matches`) emporte la partie. Ses deux lignes de
-- résultat doivent rester — avant la migration 20261016100000, une clé
-- étrangère en cascade les effaçait avec elle. Ils partent ensuite à 90 jours,
-- comme le détail de l'historique des parties.

begin;

do $$
declare
  joueur_a constant uuid := 'f0bb4001-0000-4000-8000-0000000000a1';
  joueur_b constant uuid := 'f0bb4002-0000-4000-8000-0000000000b2';
  grille   text;
  partie   uuid;
  resultat jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur_a, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (joueur_b, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  update public.player_progress set ranked_points = 1000, ranked_matches = 10
  where user_id in (joueur_a, joueur_b);

  select id into grille from public.server_grid_catalog
  where active and coalesce((payload ->> 'dailyOnly')::boolean, false) = false
  order by id limit 1;

  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number, winner_id, finish_reason, created_at, updated_at)
  values ('ranked', 'realtime', grille, jsonb_build_object('playerIds', jsonb_build_array(joueur_a, joueur_b)),
          'finished', null, 9, joueur_a, 'completed', now() - interval '28 hours', now() - interval '27 hours')
  returning id into partie;

  resultat := public.server_apply_ranked_result_atomic(partie);
  if resultat ->> 'status' <> 'applied' then
    raise exception 'Le résultat classé aurait dû s''appliquer : %', resultat;
  end if;
  if (select count(*) from public.ranked_rating_events where match_id = partie) <> 2 then
    raise exception 'Une ligne de résultat par joueur était attendue';
  end if;

  -- La purge horaire, telle qu'elle tourne en production.
  perform private.purge_stale_matches();

  if exists (select 1 from public.server_matches where id = partie) then
    raise exception 'La partie, inactive depuis 27 h, aurait dû être purgée (le test ne prouverait rien)';
  end if;
  if (select count(*) from public.ranked_rating_events where match_id = partie) <> 2 then
    raise exception 'Le résultat classé doit survivre à la purge de sa partie';
  end if;

  -- 90 jours, puis plus rien : comme le détail de l'historique des parties.
  update public.ranked_rating_events set created_at = now() - interval '91 days'
  where match_id = partie and user_id = joueur_b;
  perform private.purge_old_ranked_rating_events(90);
  if exists (select 1 from public.ranked_rating_events where match_id = partie and user_id = joueur_b) then
    raise exception 'Un résultat classé de plus de 90 jours aurait dû partir';
  end if;
  if not exists (select 1 from public.ranked_rating_events where match_id = partie and user_id = joueur_a) then
    raise exception 'Un résultat classé récent doit rester';
  end if;
  if not exists (select 1 from cron.job where jobname = 'motman-purge-old-ranked-events' and command like '%purge_old_ranked_rating_events(90)%') then
    raise exception 'Le ménage des résultats classés doit être programmé chaque nuit';
  end if;
end;
$$;

rollback;

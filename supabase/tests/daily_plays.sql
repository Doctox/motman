-- Le défi OUVERT compte pour la série (migration 20260919130000).
--
-- Quatre promesses : un jour joué sans victoire fait avancer la série ; une
-- nouvelle tentative du même jour ne recompte rien ; une victoire après
-- l'ouverture ne consomme pas deux fois les gels ; une victoire d'un match créé
-- avant le déploiement fait entrer le jour dans la série à elle seule.

begin;

do $$
declare
  joueur constant uuid := 'f7ee0010-0000-4000-8000-0000000000e2';
  reponse jsonb;
  serie jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
  update public.player_wallets set streak_freezes = 1 where user_id = joueur;

  -- ── 1. Perdu, perdu, abandonné : trois jours de série ──────────────────────
  perform public.server_record_daily_play(joueur, date '2026-04-01', null);
  perform public.server_record_daily_play(joueur, date '2026-04-02', null);
  perform public.server_record_daily_play(joueur, date '2026-04-03', null);
  serie := public.server_daily_streak(joueur, date '2026-04-03');
  if (serie ->> 'streak')::int <> 3 or (serie ->> 'lastWin') <> '2026-04-03' then
    raise exception 'Trois jours joues devraient faire une serie de 3 : %', serie;
  end if;
  if exists (select 1 from public.daily_wins where user_id = joueur) then
    raise exception 'Un jour joue ne doit pas passer pour une victoire';
  end if;

  -- ── 2. Une nouvelle tentative du même jour ne recompte rien ────────────────
  reponse := public.server_record_daily_play(joueur, date '2026-04-03', null);
  if (reponse ->> 'recorded')::boolean then
    raise exception 'La seconde tentative a ete recomptee : %', reponse;
  end if;

  -- ── 3. Gagner le jour ouvert : victoire écrite, rien de consommé ───────────
  -- Un jour manqué (04/04), couvert par le gel à l'ouverture du 05/04.
  reponse := public.server_record_daily_play(joueur, date '2026-04-05', null);
  if reponse -> 'frozenDays' <> '["2026-04-04"]'::jsonb or (reponse ->> 'freezes')::int <> 0 then
    raise exception 'Le gel aurait du couvrir le 04/04 a l''ouverture : %', reponse;
  end if;
  reponse := public.server_record_daily_win(joueur, date '2026-04-05', null);
  if (reponse ->> 'recorded')::boolean then
    raise exception 'La victoire d''un jour deja ouvert a recompte le jour : %', reponse;
  end if;
  if not exists (select 1 from public.daily_wins where user_id = joueur and day = date '2026-04-05') then
    raise exception 'La victoire n''a pas ete ecrite';
  end if;
  serie := public.server_daily_streak(joueur, date '2026-04-05');
  if (serie ->> 'streak')::int <> 4 then
    raise exception 'Serie fausse apres le gel et la victoire : %', serie;
  end if;

  -- ── 4. Victoire d'un match créé avant le déploiement ──────────────────────
  reponse := public.server_record_daily_win(joueur, date '2026-04-06', null);
  if not (reponse ->> 'recorded')::boolean
     or not exists (select 1 from public.daily_plays where user_id = joueur and day = date '2026-04-06') then
    raise exception 'La victoire aurait du faire entrer le jour dans la serie : %', reponse;
  end if;
  if (public.server_daily_streak(joueur, date '2026-04-06') ->> 'streak')::int <> 5 then
    raise exception 'La serie aurait du passer a 5';
  end if;

  -- ── 5. Réservé au serveur ─────────────────────────────────────────────────
  if pg_catalog.has_function_privilege('authenticated', 'public.server_record_daily_play(uuid,date,uuid)', 'execute')
     or pg_catalog.has_table_privilege('authenticated', 'public.daily_plays', 'select') then
    raise exception 'Les jours joues doivent rester reserves au service';
  end if;
end;
$$;

rollback;

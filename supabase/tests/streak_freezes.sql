-- Gels de série achetés (migration 20260914220000).
--
-- Quatre promesses : un gel s'achète 500 plumes, 3 au plus, et l'achat est
-- idempotent ; une victoire après un trou consomme exactement les gels
-- nécessaires ; sans assez de gels, aucun n'est pris et la série repart ; un
-- rejeu de la même victoire ne consomme rien de plus.

begin;

do $$
declare
  joueur constant uuid := 'f7ee0010-0000-4000-8000-0000000000e1';
  reponse jsonb;
  serie jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
  update public.player_wallets set feathers = 1600, streak_freezes = 0 where user_id = joueur;

  -- ── 1. Achat : prix, plafond, idempotence ────────────────────────────────
  reponse := public.server_buy_streak_freeze(joueur, 'test-gel-1');
  if (reponse ->> 'freezes')::int <> 1 or (reponse ->> 'balance')::bigint <> 1100 then
    raise exception 'Achat faux : %', reponse;
  end if;
  if public.server_buy_streak_freeze(joueur, 'test-gel-1') <> reponse
     or (select feathers from public.player_wallets where user_id = joueur) <> 1100 then
    raise exception 'La cle d''achat rejouee a debite deux fois';
  end if;
  perform public.server_buy_streak_freeze(joueur, 'test-gel-2');
  -- 600 plumes restantes : le troisième passe, le quatrième est refusé par le plafond.
  perform public.server_buy_streak_freeze(joueur, 'test-gel-3');
  if (select streak_freezes from public.player_wallets where user_id = joueur) <> 3 then
    raise exception 'Trois gels auraient du etre en poche';
  end if;
  update public.player_wallets set feathers = 5000 where user_id = joueur;
  begin
    perform public.server_buy_streak_freeze(joueur, 'test-gel-4');
    raise exception 'Un quatrieme gel est passe';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%deja 3 gels%' then raise; end if;
  end;

  -- ── 2. Victoires : un trou de deux jours consomme deux gels ──────────────
  perform public.server_record_daily_win(joueur, date '2026-03-01', null);
  perform public.server_record_daily_win(joueur, date '2026-03-02', null);
  reponse := public.server_record_daily_win(joueur, date '2026-03-05', null);
  if reponse -> 'frozenDays' <> '["2026-03-03", "2026-03-04"]'::jsonb or (reponse ->> 'freezes')::int <> 1 then
    raise exception 'Consommation fausse : %', reponse;
  end if;
  serie := public.server_daily_streak(joueur, date '2026-03-05');
  if (serie ->> 'streak')::int <> 3 or (serie ->> 'freezes')::int <> 1 then
    raise exception 'Serie fausse apres deux jours geles : %', serie;
  end if;

  -- Rejouer la même victoire ne consomme rien.
  reponse := public.server_record_daily_win(joueur, date '2026-03-05', null);
  if (reponse ->> 'recorded')::boolean or (select streak_freezes from public.player_wallets where user_id = joueur) <> 1 then
    raise exception 'Le rejeu a consomme un gel : %', reponse;
  end if;

  -- ── 3. Un trou de deux jours avec un seul gel : aucun gel pris ───────────
  reponse := public.server_record_daily_win(joueur, date '2026-03-08', null);
  if reponse -> 'frozenDays' <> '[]'::jsonb or (reponse ->> 'freezes')::int <> 1 then
    raise exception 'Un gel a ete pris pour un trou trop grand : %', reponse;
  end if;
  if (public.server_daily_streak(joueur, date '2026-03-08') ->> 'streak')::int <> 1 then
    raise exception 'La serie aurait du repartir a 1';
  end if;

  -- ── 4. Réservé au serveur ─────────────────────────────────────────────────
  if pg_catalog.has_function_privilege('authenticated', 'public.server_buy_streak_freeze(uuid,text)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.server_record_daily_win(uuid,date,uuid)', 'execute') then
    raise exception 'Les fonctions de gel doivent rester reservees au service';
  end if;
end;
$$;

rollback;

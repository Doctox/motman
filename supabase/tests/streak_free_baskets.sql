-- Paniers offerts par la série du défi du jour (migration 20260914200000).
--
-- Trois promesses : le versement est idempotent (une tranche de série = un
-- panier, même si la clôture du match est rejouée) ; un panier offert rend
-- l'ouverture gratuite et se CONSOMME ; le premier panier d'un joueur reste
-- offert SANS entamer sa réserve.

begin;

do $$
declare
  habitue constant uuid := 'f7ee0001-0000-4000-8000-0000000000d1';
  debutant constant uuid := 'f7ee0002-0000-4000-8000-0000000000d2';
  resultat jsonb;
  rejoue jsonb;
  ouverture jsonb;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (habitue, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (debutant, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  -- L'habitué a déjà ouvert un panier et n'a pas une plume.
  update public.player_wallets set feathers = 0, basket_pity = 0, opened_baskets = 1, free_baskets = 0 where user_id = habitue;
  update public.player_wallets set feathers = 0, basket_pity = 0, opened_baskets = 0, free_baskets = 0 where user_id = debutant;

  -- ── 1. Versement idempotent ──────────────────────────────────────────────
  resultat := public.server_grant_free_basket(habitue, 'daily-streak-reward:test:2026-09-21', 1, '{"streak":7}'::jsonb);
  if not (resultat ->> 'applied')::boolean or (resultat ->> 'freeBaskets')::int <> 1 then
    raise exception 'Le panier offert n''a pas ete verse : %', resultat;
  end if;
  rejoue := public.server_grant_free_basket(habitue, 'daily-streak-reward:test:2026-09-21', 1, '{"streak":7}'::jsonb);
  if (rejoue ->> 'applied')::boolean or (select free_baskets from public.player_wallets where user_id = habitue) <> 1 then
    raise exception 'La cle rejouee a verse un second panier : %', rejoue;
  end if;
  if (select kind from public.economy_transactions where user_id = habitue and idempotency_key = 'daily-streak-reward:test:2026-09-21') <> 'streak-free-basket' then
    raise exception 'Transaction du panier offert absente ou mal typee';
  end if;

  -- ── 2. Le panier offert paie l'ouverture, et se consomme ─────────────────
  ouverture := public.server_open_basket(habitue, 'panier-epicerie', 'test-panier-offert-1');
  if (ouverture ->> 'price')::bigint <> 0 or not (ouverture ->> 'freeCredit')::boolean then
    raise exception 'Le panier offert n''a pas rendu l''ouverture gratuite : %', ouverture;
  end if;
  if (select free_baskets from public.player_wallets where user_id = habitue) <> 0 then
    raise exception 'Le panier offert n''a pas ete consomme';
  end if;
  -- Sans réserve ni plume, l'ouverture suivante est refusée.
  -- (Le refus attendu et un « raise exception » de ce test partagent le code
  -- P0001 : on distingue par le message, sinon ce contrôle ne pourrait échouer.)
  begin
    perform public.server_open_basket(habitue, 'panier-epicerie', 'test-panier-offert-2');
    raise exception 'Une ouverture sans plume ni panier offert est passee';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%manque quelques plumes%' then raise; end if;
  end;

  -- ── 3. Le premier panier reste offert sans entamer la réserve ────────────
  perform public.server_grant_free_basket(debutant, 'daily-streak-reward:test-debutant:2026-09-21', 1, '{}'::jsonb);
  ouverture := public.server_open_basket(debutant, 'panier-epicerie', 'test-premier-panier');
  if (ouverture ->> 'price')::bigint <> 0 or (ouverture ->> 'freeCredit')::boolean then
    raise exception 'Le premier panier a consomme un panier offert : %', ouverture;
  end if;
  if (select free_baskets from public.player_wallets where user_id = debutant) <> 1 then
    raise exception 'La reserve du debutant a ete entamee par son premier panier';
  end if;

  -- ── 4. Garde-fous ─────────────────────────────────────────────────────────
  begin
    perform public.server_grant_free_basket(habitue, 'test-trop', 50, '{}'::jsonb);
    raise exception 'Un versement de 50 paniers est passe';
  exception when others then
    if sqlerrm not like '%invalid free basket count%' then raise; end if;
  end;
  if pg_catalog.has_function_privilege('authenticated', 'public.server_grant_free_basket(uuid,text,integer,jsonb)', 'execute') then
    raise exception 'server_grant_free_basket doit rester reserve au service';
  end if;
end;
$$;

rollback;

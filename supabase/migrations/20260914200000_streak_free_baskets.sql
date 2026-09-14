-- Paniers OFFERTS par la série du défi du jour (décision du propriétaire,
-- 14/09/2026) : chaque tranche de 7 jours de série offre un panier au lieu de
-- 250 plumes.
--
-- 1. player_wallets.free_baskets : le nombre de paniers offerts en réserve.
-- 2. server_grant_free_basket : ajoute des paniers offerts, IDEMPOTENT par clé
--    (economy_transactions, kind 'streak-free-basket', montant 0). match-api
--    l'appelle avec la clé du jour de la série, 'daily-streak-reward:<user>:<jour>'.
-- 3. server_open_basket : identique à la migration 20260914170000 (doubles
--    remboursés à 30 %, premier panier offert), sauf qu'un panier offert en
--    réserve rend l'ouverture gratuite et se consomme. Le premier panier offert
--    ne consomme pas de crédit. Le client lit la même règle dans
--    `isBasketFree` (src/cosmetics.ts).

alter table public.player_wallets
  add column if not exists free_baskets integer not null default 0 check (free_baskets >= 0);

create or replace function public.server_grant_free_basket(
  p_user_id uuid,
  p_idempotency_key text,
  p_count integer,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet public.player_wallets%rowtype;
begin
  -- Une victoire franchit au plus une ou deux tranches : au-delà, c'est un bug d'appel.
  if p_count is null or p_count < 1 or p_count > 3 then raise exception 'invalid free basket count'; end if;
  if coalesce(p_idempotency_key,'') = '' then raise exception 'invalid idempotency key'; end if;
  if jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object' then raise exception 'invalid metadata'; end if;

  -- Verrou AVANT le contrôle d'idempotence : deux appels concurrents se sérialisent.
  select * into v_wallet from public.player_wallets where user_id=p_user_id for update;
  if v_wallet.user_id is null then raise exception 'player wallet missing'; end if;

  if exists(select 1 from public.economy_transactions where user_id=p_user_id and idempotency_key=p_idempotency_key) then
    return jsonb_build_object('applied',false,'freeBaskets',v_wallet.free_baskets);
  end if;

  update public.player_wallets
    set free_baskets=free_baskets+p_count, updated_at=now()
    where user_id=p_user_id;
  insert into public.economy_transactions(user_id,idempotency_key,kind,amount,balance_after,metadata)
    values(p_user_id,p_idempotency_key,'streak-free-basket',0,v_wallet.feathers,
           coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('freeBaskets',p_count));
  return jsonb_build_object('applied',true,'freeBaskets',v_wallet.free_baskets+p_count);
end;
$$;
revoke all on function public.server_grant_free_basket(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.server_grant_free_basket(uuid,text,integer,jsonb) to service_role;

create or replace function public.server_open_basket(
  p_user_id uuid,
  p_basket_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price bigint;
  v_balance bigint;
  v_pity integer;
  v_opened integer;
  v_credits integer;
  v_free boolean;
  v_credit_used boolean;
  v_kind text;
  v_item_id text;
  v_name text;
  v_rarity text;
  v_asset text;
  v_item_price bigint;
  v_duplicate boolean;
  v_refund bigint := 0;
  v_existing jsonb;
begin
  select metadata into v_existing
  from public.economy_transactions
  where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  select price_feathers into v_price
  from public.server_basket_catalog where id=p_basket_id and active;
  if not found then raise exception 'Ce panier n''est plus disponible.' using errcode='P0001'; end if;

  select feathers,basket_pity,opened_baskets,free_baskets into v_balance,v_pity,v_opened,v_credits
  from public.player_wallets where user_id=p_user_id for update;
  if not found then raise exception 'Portefeuille introuvable.' using errcode='P0001'; end if;
  -- Le tout premier panier d'un joueur est offert.
  v_free := v_opened = 0;
  -- Sinon, un panier offert par la série du défi du jour est consommé. Le
  -- premier panier, lui, ne consomme aucun crédit.
  v_credit_used := not v_free and v_credits > 0;
  if v_credit_used then v_free := true; end if;
  if v_free then v_price := 0; end if;
  if v_balance < v_price then raise exception 'Il vous manque quelques plumes.' using errcode='P0001'; end if;

  with eligible as (
    select c.*
    from public.server_cosmetic_catalog c
    where c.active and c.availability='epicerie'
  ), rarity_weights as (
    select rarity,
      case rarity
        when 'commun' then greatest(12.0,50.0-v_pity*2.4)
        when 'singulier' then greatest(14.0,28.0-v_pity*0.7)
        when 'rare' then 14.0+v_pity*1.35
        when 'precieux' then 5.0+v_pity*0.72
        when 'exceptionnel' then 2.5+v_pity*0.31
        else 0.5+v_pity*0.12
      end as weight
    from (select distinct rarity from eligible) r
  ), picked_rarity as (
    select rarity from rarity_weights
    order by -ln(greatest(random(),0.0000001))/weight
    limit 1
  )
  select e.kind,e.item_id,e.name,e.rarity,e.asset,e.price_feathers
  into v_kind,v_item_id,v_name,v_rarity,v_asset,v_item_price
  from eligible e join picked_rarity p using(rarity)
  order by random() limit 1;

  if v_item_id is null then raise exception 'Ce panier n''est plus disponible.' using errcode='P0001'; end if;

  v_duplicate := exists(
    select 1 from public.player_inventory i
    where i.user_id=p_user_id and i.kind=v_kind and i.item_id=v_item_id
  );
  if v_duplicate then
    v_refund := floor(v_item_price*30/100);
  else
    insert into public.player_inventory(user_id,kind,item_id,source)
      values(p_user_id,v_kind,v_item_id,'basket');
  end if;

  v_balance := v_balance-v_price+v_refund;
  update public.player_wallets
    set feathers=v_balance,
        opened_baskets=opened_baskets+1,
        free_baskets=free_baskets-case when v_credit_used then 1 else 0 end,
        basket_pity=case when v_rarity in ('rare','precieux','exceptionnel','legendaire') then 0 else least(20,basket_pity+1) end,
        updated_at=now()
    where user_id=p_user_id;
  v_existing := jsonb_build_object(
    'kind',v_kind,'id',v_item_id,'name',v_name,'rarity',v_rarity,
    'asset',v_asset,'balance',v_balance,
    'duplicate',v_duplicate,'refund',v_refund,'price',v_price,'free',v_free,'freeCredit',v_credit_used
  );
  insert into public.economy_transactions(user_id,idempotency_key,kind,amount,balance_after,metadata)
    values(p_user_id,p_idempotency_key,'basket_open',v_refund-v_price,v_balance,v_existing);
  return v_existing;
end;
$$;
revoke all on function public.server_open_basket(uuid,text,text) from public,anon,authenticated;
grant execute on function public.server_open_basket(uuid,text,text) to service_role;

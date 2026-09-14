-- Le PREMIER panier de chaque joueur est offert (décision du propriétaire,
-- 14/09/2026) : tant que player_wallets.opened_baskets vaut 0, l'ouverture ne
-- coûte rien. Tous les joueurs qui n'en ont jamais ouvert en profitent, anciens
-- comptes compris.
--
-- Le reste de la fonction est identique à la migration 20260914120000 (doubles
-- remboursés à 30 %). Le client lit la même règle dans
-- `isFirstBasketFree` (src/cosmetics.ts).

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
  v_free boolean;
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

  select feathers,basket_pity,opened_baskets into v_balance,v_pity,v_opened
  from public.player_wallets where user_id=p_user_id for update;
  if not found then raise exception 'Portefeuille introuvable.' using errcode='P0001'; end if;
  -- Le tout premier panier d'un joueur est offert.
  v_free := v_opened = 0;
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
        basket_pity=case when v_rarity in ('rare','precieux','exceptionnel','legendaire') then 0 else least(20,basket_pity+1) end,
        updated_at=now()
    where user_id=p_user_id;
  v_existing := jsonb_build_object(
    'kind',v_kind,'id',v_item_id,'name',v_name,'rarity',v_rarity,
    'asset',v_asset,'balance',v_balance,
    'duplicate',v_duplicate,'refund',v_refund,'price',v_price,'free',v_free
  );
  insert into public.economy_transactions(user_id,idempotency_key,kind,amount,balance_after,metadata)
    values(p_user_id,p_idempotency_key,'basket_open',v_refund-v_price,v_balance,v_existing);
  return v_existing;
end;
$$;
revoke all on function public.server_open_basket(uuid,text,text) from public,anon,authenticated;
grant execute on function public.server_open_basket(uuid,text,text) to service_role;

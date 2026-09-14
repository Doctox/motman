-- Le panier peut donner un double, et un double rend 30 % du prix direct.
--
-- Deux sens, comme toujours : un joueur qui possède TOUT reçoit forcément un
-- double remboursé (avant la migration 20260914120000 il recevait « collection
-- complète »), et un joueur qui ne possède RIEN reçoit forcément un objet neuf,
-- sans remboursement. Un remboursement versé à tort dans le second cas passerait
-- inaperçu sans ce contrôle symétrique.

begin;

do $$
declare
  complet constant uuid := 'b45e0001-0000-4000-8000-0000000000c1';
  novice  constant uuid := 'b45e0002-0000-4000-8000-0000000000c2';
  prix_panier bigint;
  prix_objet bigint;
  objets_avant integer;
  resultat jsonb;
  rejoue jsonb;
  solde bigint;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (complet, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (novice,  false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  select price_feathers into prix_panier from public.server_basket_catalog where id = 'panier-epicerie';
  update public.player_wallets set feathers = 100000, basket_pity = 0 where user_id in (complet, novice);

  insert into public.player_inventory(user_id, kind, item_id, source)
  select complet, kind, item_id, 'test'
  from public.server_cosmetic_catalog
  where active and availability = 'epicerie'
  on conflict do nothing;
  select count(*) into objets_avant from public.player_inventory where user_id = complet;

  -- ── 1. Collection complète : un double, remboursé à 30 % ───────────────────
  resultat := public.server_open_basket(complet, 'panier-epicerie', 'test-doubles-complet-1');
  if not (resultat ->> 'duplicate')::boolean then
    raise exception 'Une collection complete aurait du donner un double : %', resultat;
  end if;
  select price_feathers into prix_objet from public.server_cosmetic_catalog
  where kind = resultat ->> 'kind' and item_id = resultat ->> 'id';
  if (resultat ->> 'refund')::bigint <> floor(prix_objet * 30 / 100) then
    raise exception 'Remboursement faux : % pour un objet a %', resultat ->> 'refund', prix_objet;
  end if;
  select feathers into solde from public.player_wallets where user_id = complet;
  if solde <> 100000 - prix_panier + floor(prix_objet * 30 / 100) then
    raise exception 'Solde faux apres un double : %', solde;
  end if;
  if (select count(*) from public.player_inventory where user_id = complet) <> objets_avant then
    raise exception 'Un double a ajoute une ligne d''inventaire';
  end if;
  if (select amount from public.economy_transactions where user_id = complet and idempotency_key = 'test-doubles-complet-1')
     <> floor(prix_objet * 30 / 100) - prix_panier then
    raise exception 'Transaction du double mal comptee';
  end if;

  -- Rejouer la même clé ne rembourse pas deux fois.
  rejoue := public.server_open_basket(complet, 'panier-epicerie', 'test-doubles-complet-1');
  if rejoue <> resultat or (select feathers from public.player_wallets where user_id = complet) <> solde then
    raise exception 'La cle rejouee a produit un second effet : %', rejoue;
  end if;

  -- ── 2. Collection vide : un objet neuf, sans remboursement ─────────────────
  resultat := public.server_open_basket(novice, 'panier-epicerie', 'test-doubles-novice-1');
  if (resultat ->> 'duplicate')::boolean or (resultat ->> 'refund')::bigint <> 0 then
    raise exception 'Un objet neuf a ete compte comme double : %', resultat;
  end if;
  if not exists (select 1 from public.player_inventory where user_id = novice and kind = resultat ->> 'kind' and item_id = resultat ->> 'id') then
    raise exception 'L''objet neuf n''a pas rejoint l''inventaire';
  end if;
  if (select feathers from public.player_wallets where user_id = novice) <> 100000 - prix_panier then
    raise exception 'Solde faux apres un objet neuf';
  end if;
end
$$;

rollback;

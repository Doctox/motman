-- Cadre Citrouilles (13/10/2026), second cadre d'Halloween : légendaire,
-- 8 000 plumes, entre Constellation et Dragon doré. Il entre dans le panier.
-- Sa lueur animée (cadre-citrouilles-lueur.webp) est un détail d'affichage de
-- l'appli : le serveur ne connaît que l'image du cadre.
--
-- Ligne reprise de supabase/functions/account-api/cosmetic-catalog.json,
-- généré par scripts/build_supabase_cosmetic_catalog.mjs ; cosmetics.test.ts
-- vérifie que ce catalogue reprend exactement celui de l'appli.
insert into public.server_cosmetic_catalog (kind,item_id,name,rarity,price_feathers,availability,asset,active) values
  ('frame','cadre-citrouilles','Citrouilles','legendaire',8000,'epicerie','/assets/frames/cadre-citrouilles.webp',true)
on conflict (kind,item_id) do update set name=excluded.name,rarity=excluded.rarity,price_feathers=excluded.price_feathers,
  availability=excluded.availability,asset=excluded.asset,active=excluded.active,updated_at=now();

do $$
begin
  if not exists (select 1 from public.server_cosmetic_catalog
                 where kind='frame' and item_id='cadre-citrouilles' and active and availability='epicerie'
                   and rarity='legendaire' and price_feathers=8000) then
    raise exception 'Le cadre Citrouilles n''est pas en vente.';
  end if;
end
$$;

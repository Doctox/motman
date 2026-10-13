-- Vague « Halloween » de l'Épicerie (13/10/2026) : deux avatars de sorciers
-- (humains, 1 400 plumes), le cadre Sous-bois (précieux, 3 500) et
-- l'animation Chauves-souris (singulier, 1 800). Tous entrent dans le panier.
--
-- Lignes reprises de supabase/functions/account-api/cosmetic-catalog.json,
-- généré par scripts/build_supabase_cosmetic_catalog.mjs ; cosmetics.test.ts
-- vérifie que ce catalogue reprend exactement celui de l'appli.
insert into public.server_cosmetic_catalog (kind,item_id,name,rarity,price_feathers,availability,asset,active) values
  ('avatar','apprenti-sorcier','Apprenti sorcier','commun',1400,'epicerie','/assets/avatars/apprenti-sorcier.webp',true),
  ('avatar','apprentie-sorciere','Apprentie sorcière','commun',1400,'epicerie','/assets/avatars/apprentie-sorciere.webp',true),
  ('frame','cadre-sous-bois','Sous-bois','precieux',3500,'epicerie','/assets/frames/cadre-sous-bois.webp',true),
  ('animation','chauves-souris','Chauves-souris','singulier',1800,'epicerie','/assets/animations/lab/chauves-souris.png',true)
on conflict (kind,item_id) do update set name=excluded.name,rarity=excluded.rarity,price_feathers=excluded.price_feathers,
  availability=excluded.availability,asset=excluded.asset,active=excluded.active,updated_at=now();

do $$
begin
  if (select count(*) from public.server_cosmetic_catalog
      where active and availability='epicerie'
        and (kind,item_id) in (('avatar','apprenti-sorcier'),('avatar','apprentie-sorciere'),
                               ('frame','cadre-sous-bois'),('animation','chauves-souris'))) <> 4 then
    raise exception 'La vague Halloween n''est pas entierement en vente.';
  end if;
end
$$;

-- Collection Douceur de l'Épicerie (16/10/2026), contenu hors thème : cinq
-- cadres (Osier, Pâquerettes, Tricot, Ruche, Salon de thé) et cinq animations
-- (Tasse de thé, Escargot, Coccinelle, Chat endormi, Rouge-gorge). Tous entrent
-- dans le panier.
--
-- Lignes reprises de supabase/functions/account-api/cosmetic-catalog.json,
-- généré par scripts/build_supabase_cosmetic_catalog.mjs ; cosmetics.test.ts
-- vérifie que ce catalogue reprend exactement celui de l'appli.
insert into public.server_cosmetic_catalog (kind,item_id,name,rarity,price_feathers,availability,asset,active) values
  ('frame','cadre-osier','Osier','commun',1400,'epicerie','/assets/frames/cadre-osier.webp',true),
  ('frame','cadre-paquerettes','Pâquerettes','singulier',1650,'epicerie','/assets/frames/cadre-paquerettes.webp',true),
  ('frame','cadre-tricot','Tricot','singulier',1850,'epicerie','/assets/frames/cadre-tricot.webp',true),
  ('frame','cadre-ruche','Ruche','rare',2300,'epicerie','/assets/frames/cadre-ruche.webp',true),
  ('frame','cadre-salon-the','Salon de thé','rare',2400,'epicerie','/assets/frames/cadre-salon-the.webp',true),
  ('animation','tasse-the','Tasse de thé','commun',1300,'epicerie','/assets/animations/lab/tasse-the.png',true),
  ('animation','escargot','Escargot','singulier',1800,'epicerie','/assets/animations/lab/escargot.png',true),
  ('animation','coccinelle','Coccinelle','singulier',1900,'epicerie','/assets/animations/lab/coccinelle.png',true),
  ('animation','chat-endormi','Chat endormi','rare',2600,'epicerie','/assets/animations/lab/chat-endormi.png',true),
  ('animation','rouge-gorge','Rouge-gorge','rare',2700,'epicerie','/assets/animations/lab/rouge-gorge.png',true)
on conflict (kind,item_id) do update set name=excluded.name,rarity=excluded.rarity,price_feathers=excluded.price_feathers,
  availability=excluded.availability,asset=excluded.asset,active=excluded.active,updated_at=now();

do $$
begin
  if (select count(*) from public.server_cosmetic_catalog
      where active and availability='epicerie'
        and item_id in ('cadre-osier','cadre-paquerettes','cadre-tricot','cadre-ruche','cadre-salon-the','tasse-the','escargot','coccinelle','chat-endormi','rouge-gorge')) <> 10 then
    raise exception 'La collection Douceur n''est pas entierement en vente.';
  end if;
end
$$;

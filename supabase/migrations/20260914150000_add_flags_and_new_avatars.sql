-- Nouveaux avatars de l'Épicerie (14/09/2026) : 4 humains fantastiques
-- (extraterrestre, troll, elfe, vampire), 2 objets de conte (fiole « Bois-moi »,
-- ticket d'or), l'easter egg du chat, et la famille « Drapeaux » (20 pays,
-- 1 400 plumes, commun). Tous entrent dans le panier.
--
-- Lignes générées depuis src/data/avatar.catalog.json par
-- scripts/build_supabase_cosmetic_catalog.mjs ; cosmetics.test.ts vérifie que
-- le catalogue du serveur reprend exactement celui de l'appli.
insert into public.server_cosmetic_catalog (kind,item_id,name,rarity,price_feathers,availability,asset,active) values
  ('avatar','extraterrestre','Extraterrestre','commun',1400,'epicerie','/assets/avatars/extraterrestre.webp',true),
  ('avatar','troll','Troll','commun',1400,'epicerie','/assets/avatars/troll.webp',true),
  ('avatar','elfe','Elfe','commun',1400,'epicerie','/assets/avatars/elfe.webp',true),
  ('avatar','vampire','Vampire','commun',1400,'epicerie','/assets/avatars/vampire.webp',true),
  ('avatar','fiole-bois-moi','Fiole « Bois-moi »','rare',2200,'epicerie','/assets/avatars/fiole-bois-moi.webp',true),
  ('avatar','ticket-dor','Ticket d’or','rare',2200,'epicerie','/assets/avatars/ticket-dor.webp',true),
  ('avatar','easter-egg-chat','Chat','singulier',1800,'epicerie','/assets/avatars/easter-egg-chat.webp',true),
  ('avatar','drapeau-france','France','commun',1400,'epicerie','/assets/avatars/drapeau-france.webp',true),
  ('avatar','drapeau-belgique','Belgique','commun',1400,'epicerie','/assets/avatars/drapeau-belgique.webp',true),
  ('avatar','drapeau-suisse','Suisse','commun',1400,'epicerie','/assets/avatars/drapeau-suisse.webp',true),
  ('avatar','drapeau-canada','Canada','commun',1400,'epicerie','/assets/avatars/drapeau-canada.webp',true),
  ('avatar','drapeau-allemagne','Allemagne','commun',1400,'epicerie','/assets/avatars/drapeau-allemagne.webp',true),
  ('avatar','drapeau-espagne','Espagne','commun',1400,'epicerie','/assets/avatars/drapeau-espagne.webp',true),
  ('avatar','drapeau-italie','Italie','commun',1400,'epicerie','/assets/avatars/drapeau-italie.webp',true),
  ('avatar','drapeau-portugal','Portugal','commun',1400,'epicerie','/assets/avatars/drapeau-portugal.webp',true),
  ('avatar','drapeau-royaume-uni','Royaume-Uni','commun',1400,'epicerie','/assets/avatars/drapeau-royaume-uni.webp',true),
  ('avatar','drapeau-etats-unis','États-Unis','commun',1400,'epicerie','/assets/avatars/drapeau-etats-unis.webp',true),
  ('avatar','drapeau-bresil','Brésil','commun',1400,'epicerie','/assets/avatars/drapeau-bresil.webp',true),
  ('avatar','drapeau-mexique','Mexique','commun',1400,'epicerie','/assets/avatars/drapeau-mexique.webp',true),
  ('avatar','drapeau-argentine','Argentine','commun',1400,'epicerie','/assets/avatars/drapeau-argentine.webp',true),
  ('avatar','drapeau-maroc','Maroc','commun',1400,'epicerie','/assets/avatars/drapeau-maroc.webp',true),
  ('avatar','drapeau-algerie','Algérie','commun',1400,'epicerie','/assets/avatars/drapeau-algerie.webp',true),
  ('avatar','drapeau-tunisie','Tunisie','commun',1400,'epicerie','/assets/avatars/drapeau-tunisie.webp',true),
  ('avatar','drapeau-senegal','Sénégal','commun',1400,'epicerie','/assets/avatars/drapeau-senegal.webp',true),
  ('avatar','drapeau-cote-divoire','Côte d’Ivoire','commun',1400,'epicerie','/assets/avatars/drapeau-cote-divoire.webp',true),
  ('avatar','drapeau-japon','Japon','commun',1400,'epicerie','/assets/avatars/drapeau-japon.webp',true),
  ('avatar','drapeau-chine','Chine','commun',1400,'epicerie','/assets/avatars/drapeau-chine.webp',true)
on conflict (kind,item_id) do update set name=excluded.name,rarity=excluded.rarity,price_feathers=excluded.price_feathers,availability=excluded.availability,asset=excluded.asset,active=excluded.active;

do $$
begin
  if (select count(*) from public.server_cosmetic_catalog
      where kind='avatar' and item_id like 'drapeau-%' and active and availability='epicerie'
        and rarity='commun' and price_feathers=1400) <> 20 then
    raise exception 'Les 20 drapeaux ne sont pas tous en vente a 1 400 plumes.';
  end if;
end
$$;

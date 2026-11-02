-- Les cadres du carnet de timbres (02/11/2026), choisis sur planche par le
-- propriétaire : Dentelure à 50 timbres, Cachet de cire à 100, Quatre saisons à 365.
-- `easter-egg`, prix 0 : ni vendus, ni dans un panier, ni comptés dans la collection
-- de l'Épicerie, qui ne lisent tous que `epicerie`.
--
-- Lignes reprises de supabase/functions/account-api/cosmetic-catalog.json,
-- généré par scripts/build_supabase_cosmetic_catalog.mjs ; cosmetics.test.ts
-- vérifie que ce catalogue et les seuils ci-dessous reprennent ceux de l'appli.
insert into public.server_cosmetic_catalog (kind,item_id,name,rarity,price_feathers,availability,asset,active) values
  ('frame','cadre-dentelure','Dentelure','rare',0,'easter-egg','/assets/frames/cadre-dentelure.webp',true),
  ('frame','cadre-cachet-de-cire','Cachet de cire','precieux',0,'easter-egg','/assets/frames/cadre-cachet-de-cire.webp',true),
  ('frame','cadre-quatre-saisons','Quatre saisons','legendaire',0,'easter-egg','/assets/frames/cadre-quatre-saisons.webp',true)
on conflict (kind,item_id) do update set name=excluded.name,rarity=excluded.rarity,price_feathers=excluded.price_feathers,
  availability=excluded.availability,asset=excluded.asset,active=excluded.active,updated_at=now();

insert into public.stamp_book_frames (seuil, item_id) values
  (50, 'cadre-dentelure'),
  (100, 'cadre-cachet-de-cire'),
  (365, 'cadre-quatre-saisons')
on conflict (seuil) do update set item_id = excluded.item_id;

-- Ce qui est déjà atteint se verse à l'arrivée : les plus assidus ont passé 50 timbres.
select private.verser_le_carnet(joueur.user_id)
from (
  select user_id from public.daily_plays
  union
  select user_id from public.daily_wins
) as joueur;

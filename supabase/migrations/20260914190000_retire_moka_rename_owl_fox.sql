-- Animaux de l'Épicerie (demande du propriétaire, 14/09/2026) :
--   • le chat noir « Moka » est SUPPRIMÉ, y compris pour ceux qui le possèdent
--     (choix explicite du propriétaire, sans remboursement). Qui le portait
--     retombe sur l'avatar de départ, la Plume MotMan ;
--   • « Céleste » s'appelle désormais « Chouette », « Roux » s'appelle « Renard » ;
--   • trois nouveaux animaux : Panda, Lapin, Loutre (1 800 plumes, singulier, dans le panier).
update public.profiles set avatar_id = 'plume-motman', updated_at = now()
where avatar_id = 'moka';
delete from public.player_inventory where kind = 'avatar' and item_id = 'moka';
delete from public.server_cosmetic_catalog where kind = 'avatar' and item_id = 'moka';

update public.server_cosmetic_catalog set name = 'Chouette', updated_at = now()
where kind = 'avatar' and item_id = 'celeste';
update public.server_cosmetic_catalog set name = 'Renard', updated_at = now()
where kind = 'avatar' and item_id = 'roux';

insert into public.server_cosmetic_catalog (kind,item_id,name,rarity,price_feathers,availability,asset,active) values
  ('avatar','panda','Panda','singulier',1800,'epicerie','/assets/avatars/panda.webp',true),
  ('avatar','lapin','Lapin','singulier',1800,'epicerie','/assets/avatars/lapin.webp',true),
  ('avatar','loutre','Loutre','singulier',1800,'epicerie','/assets/avatars/loutre.webp',true)
on conflict (kind,item_id) do update set name=excluded.name,rarity=excluded.rarity,price_feathers=excluded.price_feathers,availability=excluded.availability,asset=excluded.asset,active=excluded.active;

do $$
begin
  if exists (select 1 from public.server_cosmetic_catalog where kind = 'avatar' and item_id = 'moka')
     or exists (select 1 from public.player_inventory where kind = 'avatar' and item_id = 'moka')
     or exists (select 1 from public.profiles where avatar_id = 'moka') then
    raise exception 'Moka existe encore quelque part.';
  end if;
  if (select count(*) from public.server_cosmetic_catalog where kind = 'avatar' and item_id in ('panda','lapin','loutre') and active and price_feathers = 1800) <> 3 then
    raise exception 'Les trois nouveaux animaux ne sont pas en vente.';
  end if;
end
$$;

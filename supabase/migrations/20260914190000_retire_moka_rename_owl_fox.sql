-- Animaux de l'Épicerie (demande du propriétaire, 14/09/2026) :
--   • le chat noir « Moka » quitte la vente et les paniers. Ceux qui le
--     possèdent le gardent et peuvent toujours l'équiper : l'équipement ne
--     regarde que player_inventory, et l'appli garde l'avatar dans son catalogue
--     (availability « retire » dans src/data/avatar.catalog.json) ;
--   • « Céleste » s'appelle désormais « Chouette », « Roux » s'appelle « Renard ».
alter table public.server_cosmetic_catalog
  drop constraint if exists server_cosmetic_catalog_availability_check;
alter table public.server_cosmetic_catalog
  add constraint server_cosmetic_catalog_availability_check
  check (availability in ('starter','epicerie','easter-egg','retire'));

update public.server_cosmetic_catalog set availability = 'retire', active = false, updated_at = now()
where kind = 'avatar' and item_id = 'moka';
update public.server_cosmetic_catalog set name = 'Chouette', updated_at = now()
where kind = 'avatar' and item_id = 'celeste';
update public.server_cosmetic_catalog set name = 'Renard', updated_at = now()
where kind = 'avatar' and item_id = 'roux';

do $$
begin
  if exists (select 1 from public.server_cosmetic_catalog where kind = 'avatar' and item_id = 'moka' and (active or availability = 'epicerie')) then
    raise exception 'Moka est encore en vente.';
  end if;
end
$$;

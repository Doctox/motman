-- Animaux de l'Épicerie (demande du propriétaire, 14/09/2026) :
--   • le chat noir « Moka » est SUPPRIMÉ, y compris pour ceux qui le possèdent
--     (choix explicite du propriétaire, sans remboursement). Qui le portait
--     retombe sur l'avatar de départ, la Plume MotMan ;
--   • « Céleste » s'appelle désormais « Chouette », « Roux » s'appelle « Renard ».
update public.profiles set avatar_id = 'plume-motman', updated_at = now()
where avatar_id = 'moka';
delete from public.player_inventory where kind = 'avatar' and item_id = 'moka';
delete from public.server_cosmetic_catalog where kind = 'avatar' and item_id = 'moka';

update public.server_cosmetic_catalog set name = 'Chouette', updated_at = now()
where kind = 'avatar' and item_id = 'celeste';
update public.server_cosmetic_catalog set name = 'Renard', updated_at = now()
where kind = 'avatar' and item_id = 'roux';

do $$
begin
  if exists (select 1 from public.server_cosmetic_catalog where kind = 'avatar' and item_id = 'moka')
     or exists (select 1 from public.player_inventory where kind = 'avatar' and item_id = 'moka')
     or exists (select 1 from public.profiles where avatar_id = 'moka') then
    raise exception 'Moka existe encore quelque part.';
  end if;
end
$$;

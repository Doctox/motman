-- La vue qui porte les réponses de toutes les grilles reste fermée aux clients
-- (migration 20261022120000, code S4).
--
-- `server_grid_selection` rassemble les réponses de toutes les grilles, défi du
-- jour compris. Ouverte par erreur, une requête avec la clé publique les
-- livrerait toutes. Deux promesses :
--   1. ni `anon` ni `authenticated` ne peuvent la lire ;
--   2. le rôle de service, qui fait le tirage, la lit toujours.

begin;

do $$
begin
  if has_table_privilege('anon', 'public.server_grid_selection', 'select')
    or has_table_privilege('authenticated', 'public.server_grid_selection', 'select') then
    raise exception 'La vue des réponses ne doit être lisible ni par anon ni par authenticated';
  end if;
  if not has_table_privilege('service_role', 'public.server_grid_selection', 'select') then
    raise exception 'Le rôle de service doit pouvoir lire la vue de tirage';
  end if;
end;
$$;

rollback;

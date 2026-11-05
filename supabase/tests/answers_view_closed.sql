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
  -- Une vue recréée sans `with (security_invoker = true)` perd cette option sans le dire.
  if not exists (
    select 1 from pg_catalog.pg_class as vue
    where vue.oid = 'public.server_grid_selection'::regclass
      and 'security_invoker=true' = any(vue.reloptions)
  ) then
    raise exception 'La vue des réponses doit lire avec les droits de qui l''interroge';
  end if;
end;
$$;

rollback;

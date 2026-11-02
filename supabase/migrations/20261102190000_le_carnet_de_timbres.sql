-- ─────────────────────────────────────────────────────────────────────────────
-- LE CARNET DE TIMBRES (02/11/2026)
--
-- Validé par le propriétaire après la recherche sur la rétention, forme n° 3 de la
-- planche : une ligne dans le profil, le carnet s'ouvre au toucher. Chaque défi
-- joué ajoute un timbre, et un jour manqué n'en retire aucun, contrairement à la
-- série. Les timbres se lisent dans `daily_plays` : rien de plus à stocker.
--
-- LES RÉCOMPENSES se versent ici et nulle part ailleurs.
--   - Les titres : `server_title_catalog`, identifiants `carnet-*`, le seuil dans
--     `required_value`. Le client lit les seuils dans le compte, sans les recopier.
--   - Les cadres : `stamp_book_frames`, vide tant que le poste Cosmétiques n'a pas
--     livré les siens. Sa migration remplit la table, puis rappelle
--     `private.verser_le_carnet` pour ceux qui ont déjà le compte de timbres.
--
-- Le versement passe par un déclencheur sur `daily_plays` : aucune des deux
-- règles de série écrites en double n'est touchée. Une panne ici ne doit JAMAIS
-- empêcher d'ouvrir le défi, d'où le rattrapage dans le déclencheur.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.server_title_catalog (id, name, description, unlock_type, required_value, active, sort_order) values
  ('carnet-10', 'Premières pages', '10 timbres dans ton carnet.', 'special', 10, true, 210),
  ('carnet-25', 'Carnet bien tenu', '25 timbres dans ton carnet.', 'special', 25, true, 220),
  ('carnet-50', 'Un peu timbré', '50 timbres dans ton carnet.', 'special', 50, true, 230),
  ('carnet-100', 'Cent timbres', '100 timbres dans ton carnet.', 'special', 100, true, 240),
  ('carnet-200', 'Philatéliste', '200 timbres dans ton carnet.', 'special', 200, true, 250),
  ('carnet-365', 'Le tour de l’année', '365 timbres dans ton carnet.', 'special', 365, true, 260)
on conflict (id) do nothing;

create table if not exists public.stamp_book_frames (
  seuil integer primary key check (seuil > 0),
  kind text not null default 'frame' check (kind = 'frame'),
  item_id text not null,
  foreign key (kind, item_id) references public.server_cosmetic_catalog (kind, item_id)
);

alter table public.stamp_book_frames enable row level security;
revoke all on public.stamp_book_frames from public, anon, authenticated;
grant all on public.stamp_book_frames to service_role;

comment on table public.stamp_book_frames is
  'Les cadres du carnet de timbres, par seuil. Voir 20261102190000_le_carnet_de_timbres.sql.';

-- Ce que le joueur a mérité et n'a pas encore. Rejouable sans risque.
-- `daily_wins` en plus, comme server_daily_streak : une victoire est toujours un jour joué.
create or replace function private.verser_le_carnet(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timbres integer;
begin
  select count(*) into v_timbres from (
    select day from public.daily_plays where user_id = p_user_id
    union
    select day from public.daily_wins where user_id = p_user_id
  ) as jours;

  insert into public.player_titles (user_id, title_id, source)
  select p_user_id, titre.id, 'special'
  from public.server_title_catalog titre
  where titre.active and titre.unlock_type = 'special' and titre.id like 'carnet-%' and titre.required_value <= v_timbres
  on conflict (user_id, title_id) do nothing;

  insert into public.player_inventory (user_id, kind, item_id, source)
  select p_user_id, cadre.kind, cadre.item_id, 'carnet'
  from public.stamp_book_frames cadre
  where cadre.seuil <= v_timbres
  on conflict (user_id, kind, item_id) do nothing;
end;
$$;

revoke all on function private.verser_le_carnet(uuid) from public, anon, authenticated;
grant execute on function private.verser_le_carnet(uuid) to service_role;

create or replace function private.carnet_apres_un_defi()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.verser_le_carnet(new.user_id);
  return null;
exception when others then
  raise warning 'Carnet de timbres : versement impossible (%).', sqlerrm;
  return null;
end;
$$;

revoke all on function private.carnet_apres_un_defi() from public, anon, authenticated;

drop trigger if exists carnet_apres_un_defi on public.daily_plays;
create trigger carnet_apres_un_defi
  after insert on public.daily_plays
  for each row execute function private.carnet_apres_un_defi();

-- Ce qui est déjà atteint se verse à l'arrivée : les plus assidus ont passé 50 timbres.
select private.verser_le_carnet(joueur.user_id)
from (
  select user_id from public.daily_plays
  union
  select user_id from public.daily_wins
) as joueur;

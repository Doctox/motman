-- Tirage « la moins jouée d'abord » (src/gridSelection.ts, 15/09/2026).
--
-- Le tirage n'évitait que les 5 dernières grilles de chaque joueur. Relevé en
-- base : une joueuse avait fait 43 parties sur seulement 24 grilles distinctes,
-- 13 grilles revenues 2 à 4 fois, alors que 42 des 66 grilles tirables ne lui
-- étaient jamais sorties. Le serveur doit donc connaître TOUT ce qu'un joueur a
-- joué, et combien de fois.
--
-- Deux pièces :
--
-- 1. `grid_id_aliases` : anciens identifiants → identifiants actuels. Les 56
--    grilles génériques ont été renommées le 13/09/2026 (anti-triche) ; l'historique
--    d'avant porte les anciens noms, et sans ce lien toutes paraîtraient neuves.
--    ⚠️ La table est créée VIDE ici et remplie depuis l'atelier privé. Les
--    anciens identifiants mènent aux réponses dans l'historique public du dépôt :
--    publier la correspondance dans une migration annulerait le renommage.
--
-- 2. `server_player_grid_plays` : pour des joueurs donnés, chaque grille jouée
--    (identifiant actuel), le nombre de parties et la dernière date. Historique
--    détaillé ET archive (`grid_player_history_rollups`, parties de plus de 90
--    jours) — défi du jour compris : une grille dont on connaît les réponses est
--    une grille déjà vue.

create table if not exists public.grid_id_aliases (
  old_id text primary key,
  new_id text not null,
  renamed_at date not null default current_date,
  check (old_id <> new_id)
);

alter table public.grid_id_aliases enable row level security;
revoke all on table public.grid_id_aliases from public, anon, authenticated;
grant select, insert, update, delete on table public.grid_id_aliases to service_role;

create or replace function public.server_player_grid_plays(p_user_ids uuid[])
returns table (user_id uuid, grid_id text, plays bigint, last_played_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select jeux.user_id,
         coalesce(alias.new_id, jeux.grid_id) as grid_id,
         sum(jeux.plays)::bigint as plays,
         max(jeux.last_played_at) as last_played_at
  from (
    select history.user_id, history.grid_id, count(*)::bigint as plays, max(history.completed_at) as last_played_at
    from public.grid_player_history as history
    where history.user_id = any(p_user_ids)
    group by history.user_id, history.grid_id
    union all
    select rollup.user_id, rollup.grid_id, rollup.plays, rollup.last_played_at
    from public.grid_player_history_rollups as rollup
    where rollup.user_id = any(p_user_ids)
  ) as jeux
  left join public.grid_id_aliases as alias on alias.old_id = jeux.grid_id
  group by jeux.user_id, coalesce(alias.new_id, jeux.grid_id)
$$;

revoke all on function public.server_player_grid_plays(uuid[]) from public, anon, authenticated;
grant execute on function public.server_player_grid_plays(uuid[]) to service_role;

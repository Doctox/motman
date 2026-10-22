-- Quitter pour le classé : seulement une partie ordinaire, et seulement pour une
-- classée qui vient de s'ouvrir (migration 20261022120000, code U1).
--
-- Une requête forgée transformait une classée perdue en égalité sans perte de
-- points : la fonction acceptait une classée EN COURS comme partie quittée, avec
-- n'importe quelle classée des dernières 26 h pour « témoin ». Trois promesses :
--   1. une classée en cours ne se quitte jamais par ce chemin ;
--   2. une vieille classée terminée ne sert pas de témoin ;
--   3. le vrai cas, une partie normale quittée pour une arène qui s'ouvre,
--      se clôt toujours en égalité.

begin;

do $$
declare
  joueur constant uuid := 'f7ee1022-0000-4000-8000-0000000000c1';
  autre constant uuid := 'f7ee1022-0000-4000-8000-0000000000c2';
  tiers constant uuid := 'f7ee1022-0000-4000-8000-0000000000c3';
  grille text;
  normale uuid;
  classee_en_cours uuid;
  vieille_classee uuid;
  arene uuid;
  ferme boolean;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (tiers, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  select grid.id into grille from public.server_grid_catalog as grid
  where grid.active is true order by grid.id limit 1;

  -- Une partie normale en cours, ouverte il y a cinq minutes.
  insert into public.server_matches(mode, pace, grid_id, state, status, created_at, updated_at)
  values ('normal', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(joueur, autre)),
          'active', pg_catalog.clock_timestamp() - interval '5 minutes', pg_catalog.clock_timestamp())
  returning id into normale;
  -- Une classée en cours, celle que le tricheur est en train de perdre.
  insert into public.server_matches(mode, pace, grid_id, state, status, created_at, updated_at)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(joueur, tiers)),
          'active', pg_catalog.clock_timestamp() - interval '4 minutes', pg_catalog.clock_timestamp())
  returning id into classee_en_cours;
  -- Une vieille classée terminée, gardée comme « témoin ».
  insert into public.server_matches(mode, pace, grid_id, state, status, finish_reason, created_at, updated_at)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(joueur, tiers)),
          'finished', 'completed', pg_catalog.clock_timestamp() - interval '2 hours', pg_catalog.clock_timestamp() - interval '2 hours')
  returning id into vieille_classee;
  -- L'arène qui s'ouvre à l'instant.
  insert into public.server_matches(mode, pace, grid_id, state, status, created_at, updated_at)
  values ('ranked', 'realtime', grille,
          pg_catalog.jsonb_build_object('playerIds', pg_catalog.jsonb_build_array(joueur, tiers)),
          'active', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
  returning id into arene;

  insert into public.match_participants(match_id, user_id, opponent_id)
  values (normale, joueur, autre), (normale, autre, joueur),
         (classee_en_cours, joueur, tiers), (classee_en_cours, tiers, joueur),
         (vieille_classee, joueur, tiers), (vieille_classee, tiers, joueur),
         (arene, joueur, tiers), (arene, tiers, joueur);

  -- ── 1. Une classée en cours ne se quitte pas par ce chemin ────────────────
  ferme := public.server_finish_match_for_ranked_transfer(joueur, classee_en_cours, arene);
  if ferme or exists (select 1 from public.server_matches where id = classee_en_cours and status <> 'active') then
    raise exception 'Une classée en cours ne doit jamais se clore en égalité par « quitter pour le classé »';
  end if;

  -- ── 2. Une vieille classée terminée ne sert pas de témoin ─────────────────
  ferme := public.server_finish_match_for_ranked_transfer(joueur, normale, vieille_classee);
  if ferme or exists (select 1 from public.server_matches where id = normale and status <> 'active') then
    raise exception 'Une classée terminée ne doit pas servir de témoin';
  end if;

  -- ── 3. Le vrai cas : la partie normale se clôt en égalité ─────────────────
  ferme := public.server_finish_match_for_ranked_transfer(joueur, normale, arene);
  if not ferme or not exists (
    select 1 from public.server_matches
    where id = normale and status = 'finished' and finish_reason = 'ranked_transfer' and winner_id is null
  ) then
    raise exception 'Une partie normale quittée pour une arène qui s''ouvre doit se clore en égalité';
  end if;
end;
$$;

rollback;

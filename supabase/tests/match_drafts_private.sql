-- Les lettres posées au fil du tour (16/10/2026, migration 20261016230000).
--
-- Elles restent PRIVÉES : ni un joueur ni un visiteur ne lit la table ni
-- n'appelle la fonction d'écriture — seul match-api, par la clé de service. Un
-- brouillon ancien (version plus basse, ou tour précédent) ne remplace jamais
-- un plus récent. Et il part avec sa partie.

begin;

do $$
declare
  joueur  constant uuid := 'f0bb5001-0000-4000-8000-0000000000a1';
  autre   constant uuid := 'f0bb5002-0000-4000-8000-0000000000b2';
  grille  text;
  partie  uuid;
  ligne   record;
begin
  -- ── Fermée à tous ─────────────────────────────────────────────────────────
  if pg_catalog.has_table_privilege('anon', 'public.server_match_drafts', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.server_match_drafts', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.server_match_drafts', 'insert')
     or pg_catalog.has_table_privilege('authenticated', 'public.server_match_drafts', 'update') then
    raise exception 'Les brouillons ne doivent être lisibles ni modifiables par aucun joueur';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.server_match_drafts'::regclass) then
    raise exception 'La table des brouillons doit avoir la sécurité par ligne';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.server_save_match_draft(uuid, uuid, integer, bigint, jsonb, timestamptz)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.server_save_match_draft(uuid, uuid, integer, bigint, jsonb, timestamptz)', 'execute') then
    raise exception 'Seul match-api écrit un brouillon';
  end if;

  -- ── Une partie classée en cours ───────────────────────────────────────────
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  select id into grille from public.server_grid_catalog
  where active and coalesce((payload ->> 'dailyOnly')::boolean, false) = false
  order by id limit 1;

  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number, created_at, updated_at)
  values ('ranked', 'realtime', grille, jsonb_build_object('playerIds', jsonb_build_array(joueur, autre)),
          'active', joueur, 2, now(), now())
  returning id into partie;

  -- ── Le plus récent gagne ──────────────────────────────────────────────────
  perform public.server_save_match_draft(partie, joueur, 2, 100, '[{"cellIndex":1,"letter":"A"}]'::jsonb, now());
  perform public.server_save_match_draft(partie, joueur, 2, 90, '[{"cellIndex":1,"letter":"B"}]'::jsonb, now());
  select * into ligne from public.server_match_drafts where match_id = partie and user_id = joueur;
  if ligne.placements -> 0 ->> 'letter' <> 'A' then
    raise exception 'Un brouillon plus ancien a remplacé le plus récent : %', ligne.placements;
  end if;

  -- Des lettres reprises : le plateau vidé remplace bien le précédent.
  perform public.server_save_match_draft(partie, joueur, 2, 110, '[]'::jsonb, now());
  select * into ligne from public.server_match_drafts where match_id = partie and user_id = joueur;
  if pg_catalog.jsonb_array_length(ligne.placements) <> 0 then
    raise exception 'Un plateau vidé doit remplacer le brouillon précédent';
  end if;

  -- Un brouillon d'un tour PRÉCÉDENT, même de version plus haute, n'écrase rien.
  perform public.server_save_match_draft(partie, joueur, 1, 500, '[{"cellIndex":2,"letter":"C"}]'::jsonb, now());
  select * into ligne from public.server_match_drafts where match_id = partie and user_id = joueur;
  if ligne.turn_number <> 2 or pg_catalog.jsonb_array_length(ligne.placements) <> 0 then
    raise exception 'Un brouillon d''un tour précédent a écrasé le tour en cours';
  end if;

  -- Le tour suivant du même joueur repart de zéro, quelle que soit la version.
  perform public.server_save_match_draft(partie, joueur, 4, 1, '[{"cellIndex":3,"letter":"D"}]'::jsonb, now());
  select * into ligne from public.server_match_drafts where match_id = partie and user_id = joueur;
  if ligne.turn_number <> 4 or ligne.placements -> 0 ->> 'letter' <> 'D' then
    raise exception 'Le brouillon d''un tour suivant doit remplacer l''ancien';
  end if;

  -- ── Il part avec sa partie ────────────────────────────────────────────────
  delete from public.server_matches where id = partie;
  if exists (select 1 from public.server_match_drafts where match_id = partie) then
    raise exception 'Le brouillon doit partir avec sa partie';
  end if;
end;
$$;

rollback;

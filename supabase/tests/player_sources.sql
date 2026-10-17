-- D'où viennent les joueurs (17/10/2026, migration 20261017100000).
--
-- Trois promesses :
--   1. PRIVÉ : ni un joueur ni un visiteur ne lit les sources ni le compteur,
--      ni n'appelle la fonction qui les écrit — seul account-api, par la clé
--      de service ;
--   2. UNE FOIS : la première source d'un compte est la seule retenue, et le
--      compteur du jour ne monte qu'une fois par compte ;
--   3. LE COMPTEUR SURVIT AU COMPTE : un invité effacé (nettoyage à 30 jours)
--      emporte sa ligne, pas son arrivée dans le compteur.

begin;

do $$
declare
  joueur constant uuid := 'f0bc1017-0000-4000-8000-0000000000a1';
  autre  constant uuid := 'f0bc1017-0000-4000-8000-0000000000b2';
  aujourdhui date := (pg_catalog.now() at time zone 'Europe/Paris')::date;
  avant  integer;
  apres  integer;
begin
  -- ── 1. Privé ──────────────────────────────────────────────────────────────
  if pg_catalog.has_table_privilege('anon', 'public.player_sources', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.player_sources', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.player_sources', 'insert')
     or pg_catalog.has_table_privilege('anon', 'public.player_source_daily', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.player_source_daily', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.player_source_daily', 'update') then
    raise exception 'Les sources des joueurs ne doivent être lisibles ni modifiables par aucun joueur';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.player_sources'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.player_source_daily'::regclass) then
    raise exception 'Les tables des sources doivent avoir la sécurité par ligne';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.server_note_player_source(uuid, text, text, text)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.server_note_player_source(uuid, text, text, text)', 'execute') then
    raise exception 'Seul account-api note une source';
  end if;

  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, true, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (autre, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  select coalesce(sum(joueurs), 0) into avant
  from public.player_source_daily where jour = aujourdhui and canal = 'instagram' and plateforme = 'web';

  -- ── 2. Une fois ───────────────────────────────────────────────────────────
  if not public.server_note_player_source(joueur, 'instagram', 'l.instagram.com', 'web') then
    raise exception 'La première source d''un compte doit être notée';
  end if;
  if public.server_note_player_source(joueur, 'site', null, 'web') then
    raise exception 'Une deuxième source pour le même compte ne doit pas être notée';
  end if;
  if (select canal from public.player_sources where user_id = joueur) <> 'instagram' then
    raise exception 'La première source doit rester celle du compte';
  end if;
  perform public.server_note_player_source(autre, 'instagram', null, 'web');

  select coalesce(sum(joueurs), 0) into apres
  from public.player_source_daily where jour = aujourdhui and canal = 'instagram' and plateforme = 'web';
  if apres - avant <> 2 then
    raise exception 'Deux comptes venus d''Instagram aujourd''hui : le compteur doit monter de 2, il monte de %', apres - avant;
  end if;

  -- Une forme interdite ne passe pas (le serveur valide déjà ; la base aussi).
  begin
    perform public.server_note_player_source(pg_catalog.gen_random_uuid(), 'Instagram!', null, 'web');
    raise exception 'Un canal mal formé aurait dû être refusé';
  exception when check_violation or foreign_key_violation then
    null;
  end;

  -- ── 3. Le compteur survit au compte ───────────────────────────────────────
  delete from auth.users where id = joueur;
  if exists (select 1 from public.player_sources where user_id = joueur) then
    raise exception 'La source d''un compte supprimé doit partir avec lui';
  end if;
  select coalesce(sum(joueurs), 0) into apres
  from public.player_source_daily where jour = aujourdhui and canal = 'instagram' and plateforme = 'web';
  if apres - avant <> 2 then
    raise exception 'Le compteur doit garder l''arrivée d''un compte effacé';
  end if;
end;
$$;

rollback;

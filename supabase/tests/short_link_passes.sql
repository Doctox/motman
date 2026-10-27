-- Les passages par les adresses courtes (27/10/2026, migration 20261027130000).
--
-- Trois promesses :
--   1. LA TABLE EST FERMÉE : ni un visiteur ni un joueur ne lit ni n'écrit le
--      compteur directement ;
--   2. LA CLÉ PUBLIQUE COMPTE, ET RIEN DE PLUS : le Worker de doctox.fr, avec
--      la clé publiable (rôle anon), ajoute un passage par appel ;
--   3. UN NOM QUI N'EST PAS CELUI D'UNE ADRESSE COURTE N'EST PAS COMPTÉ.

begin;

create temporary table passages_avant on commit drop as
select coalesce(sum(passages), 0)::integer as total
from public.short_link_daily
where jour = (pg_catalog.now() at time zone 'Europe/Paris')::date and lien = 'roblox';

-- Deux passages, comme le Worker les envoie : avec le rôle de la clé publiable.
set local role anon;
select public.note_short_link_pass('roblox');
select public.note_short_link_pass('roblox');
reset role;

do $$
declare
  aujourdhui constant date := (pg_catalog.now() at time zone 'Europe/Paris')::date;
  avant integer;
  apres integer;
begin
  -- ── 1. La table est fermée ────────────────────────────────────────────────
  if pg_catalog.has_table_privilege('anon', 'public.short_link_daily', 'select')
     or pg_catalog.has_table_privilege('anon', 'public.short_link_daily', 'insert')
     or pg_catalog.has_table_privilege('anon', 'public.short_link_daily', 'update')
     or pg_catalog.has_table_privilege('authenticated', 'public.short_link_daily', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.short_link_daily', 'update') then
    raise exception 'Le compteur des adresses courtes ne doit être ni lisible ni modifiable de l''extérieur';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.short_link_daily'::regclass) then
    raise exception 'Le compteur des adresses courtes doit avoir la sécurité par ligne';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.note_short_link_pass(text)', 'execute') then
    raise exception 'Seul le Worker de doctox.fr (clé publiable) compte un passage';
  end if;

  -- ── 2. Un passage par appel ───────────────────────────────────────────────
  select total into avant from passages_avant;
  select passages into apres from public.short_link_daily where jour = aujourdhui and lien = 'roblox';
  if apres is distinct from avant + 2 then
    raise exception 'Deux passages attendus sur /motman/roblox : avant %, après %', avant, apres;
  end if;

  -- ── 3. Les faux noms ne sont pas comptés ──────────────────────────────────
  if public.note_short_link_pass('Roblox')
     or public.note_short_link_pass('../motman')
     or public.note_short_link_pass('')
     or public.note_short_link_pass(null) then
    raise exception 'Un nom qui n''est pas celui d''une adresse courte a été compté';
  end if;
end;
$$;

rollback;

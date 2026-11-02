-- Les premiers pas d'un nouveau (02/11/2026, migration 20261102100000).
--
-- Trois promesses :
--   1. LA TABLE EST FERMÉE : ni un visiteur ni un joueur ne lit ni n'écrit le
--      compteur directement ;
--   2. UN JOUEUR CONNECTÉ COMPTE UNE ÉTAPE, LA CLÉ PUBLIQUE SEULE NON ;
--   3. UN NOM QUI N'EST PAS CELUI D'UNE ÉTAPE N'EST PAS COMPTÉ.

begin;

create temporary table pas_avant on commit drop as
select coalesce(sum(nombre), 0)::integer as total
from public.first_steps_daily
where jour = (pg_catalog.now() at time zone 'Europe/Paris')::date and etape = 'menu';

-- Deux premiers pas, avec le rôle d'un joueur connecté.
set local role authenticated;
select public.note_first_step('menu');
select public.note_first_step('menu');
reset role;

do $$
declare
  aujourdhui constant date := (pg_catalog.now() at time zone 'Europe/Paris')::date;
  avant integer;
  apres integer;
begin
  -- ── 1. La table est fermée ────────────────────────────────────────────────
  if pg_catalog.has_table_privilege('anon', 'public.first_steps_daily', 'select')
     or pg_catalog.has_table_privilege('anon', 'public.first_steps_daily', 'insert')
     or pg_catalog.has_table_privilege('authenticated', 'public.first_steps_daily', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.first_steps_daily', 'update') then
    raise exception 'Le compteur des premiers pas ne doit être ni lisible ni modifiable de l''extérieur';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.first_steps_daily'::regclass) then
    raise exception 'Le compteur des premiers pas doit avoir la sécurité par ligne';
  end if;

  -- ── 2. Le joueur connecté compte, la clé publique seule non ───────────────
  if pg_catalog.has_function_privilege('anon', 'public.note_first_step(text)', 'execute') then
    raise exception 'La clé publique seule ne doit pas pouvoir compter un premier pas';
  end if;
  select total into avant from pas_avant;
  select nombre into apres from public.first_steps_daily where jour = aujourdhui and etape = 'menu';
  if apres is distinct from avant + 2 then
    raise exception 'Deux premiers pas attendus : avant %, après %', avant, apres;
  end if;

  -- ── 3. Les faux noms ne sont pas comptés ──────────────────────────────────
  if public.note_first_step('Menu')
     or public.note_first_step('../menu')
     or public.note_first_step('')
     or public.note_first_step(null) then
    raise exception 'Un nom qui n''est pas celui d''une étape a été compté';
  end if;
end;
$$;

rollback;

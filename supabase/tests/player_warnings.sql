-- Avertir un joueur, et compter (migration 20260921130000).
--
-- Décision du propriétaire du 21/09/2026 : la suspension disparaît, l'avertis-
-- sement la remplace, et c'est le CUMUL qui fondera un bannissement au
-- troisième. Quatre promesses :
--   1. un avertissement s'écrit et rend le total accumulé ;
--   2. le total monte à chaque avertissement — c'est tout l'intérêt ;
--   3. lire n'efface pas : `read_at` se remplit, la ligne reste ;
--   4. la table et la fonction restent réservées au service.

begin;

do $$
declare
  joueur constant uuid := 'f7ee0010-0000-4000-8000-0000000000a1';
  moderateur constant uuid := 'f7ee0010-0000-4000-8000-0000000000a2';
  reponse jsonb;
  restantes int;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (moderateur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  -- ── 1. Le premier avertissement ───────────────────────────────────────────
  reponse := public.server_warn_player(joueur, null, moderateur, 'Premier message.');
  if (reponse ->> 'avertissements')::int <> 1 then
    raise exception 'Le premier avertissement devrait rendre 1 : %', reponse;
  end if;

  -- ── 2. Le cumul, qui est tout l'intérêt ───────────────────────────────────
  perform public.server_warn_player(joueur, null, moderateur, 'Deuxième message.');
  reponse := public.server_warn_player(joueur, null, moderateur, 'Troisième message.');
  if (reponse ->> 'avertissements')::int <> 3 then
    raise exception 'Trois avertissements devraient se cumuler : %', reponse;
  end if;

  -- Le texte est stocké TEL QUEL : un message déjà reçu ne change pas de sens
  -- parce qu'on réécrit une constante six mois plus tard.
  if not exists (
    select 1 from public.player_warnings
    where user_id = joueur and message = 'Premier message.'
  ) then
    raise exception 'Le texte envoyé doit rester tel quel en base';
  end if;

  -- ── 3. Lu n'est pas effacé ────────────────────────────────────────────────
  update public.player_warnings set read_at = pg_catalog.now()
  where user_id = joueur and read_at is null;
  select count(*) into restantes from public.player_warnings where user_id = joueur;
  if restantes <> 3 then
    raise exception 'Lire ne doit rien effacer : % ligne(s) au lieu de 3', restantes;
  end if;
  if (public.server_warn_player(joueur, null, moderateur, 'Quatrième.') ->> 'avertissements')::int <> 4 then
    raise exception 'Le compte doit inclure les avertissements deja lus';
  end if;

  -- ── 4. Réservé au service ─────────────────────────────────────────────────
  -- Un joueur qui lirait la table compterait les avertissements des AUTRES :
  -- ce sont des données de modération, pas des données de jeu.
  if pg_catalog.has_table_privilege('authenticated', 'public.player_warnings', 'select')
     or pg_catalog.has_table_privilege('anon', 'public.player_warnings', 'select')
     or pg_catalog.has_function_privilege('authenticated', 'public.server_warn_player(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'Les avertissements doivent rester reserves au service';
  end if;
end;
$$;

rollback;

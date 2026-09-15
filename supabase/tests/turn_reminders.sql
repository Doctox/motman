-- Rappels de tour (migration 20260915210000).
--
-- Ce qui est vérifié ici : la PORTE. La table des rappels n'est lisible que par
-- le serveur, l'appel à la fonction n'est pas à la portée d'un joueur, la tâche
-- tourne bien toutes les 15 minutes, et une ligne disparaît avec sa partie. Les
-- règles d'envoi, elles, sont testées en Deno (match-api/matchReminders.test.ts).

begin;

do $$
begin
  -- ── 1. Aucun joueur n'y touche ─────────────────────────────────────────────
  if pg_catalog.has_table_privilege('anon', 'public.server_match_turn_reminders', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.server_match_turn_reminders', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.server_match_turn_reminders', 'insert') then
    raise exception 'La table des rappels est accessible aux joueurs.';
  end if;

  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.server_match_turn_reminders'::regclass) then
    raise exception 'La RLS n''est pas active sur la table des rappels.';
  end if;

  if pg_catalog.has_function_privilege('anon', 'private.appeler_rappels_tours()', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'private.appeler_rappels_tours()', 'execute') then
    raise exception 'Un joueur peut déclencher la tâche des rappels.';
  end if;

  -- ── 2. La tâche est planifiée ──────────────────────────────────────────────
  if not exists (
    select 1 from cron.job
    where jobname = 'motman-rappels-tours'
      and schedule = '*/15 * * * *'
      and command = 'select private.appeler_rappels_tours();'
  ) then
    raise exception 'La tâche motman-rappels-tours n''est pas planifiée toutes les 15 minutes.';
  end if;

  -- ── 3. Un rappel disparaît avec sa partie ──────────────────────────────────
  -- Lu dans le catalogue plutôt qu'éprouvé : supprimer une vraie partie, même
  -- dans une transaction annulée, la verrouillerait sous les doigts d'un joueur.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.server_match_turn_reminders'::regclass
      and confrelid = 'public.server_matches'::regclass
      and contype = 'f'
      and confdeltype = 'c'
  ) then
    raise exception 'Les rappels ne sont pas effacés avec leur partie (on delete cascade manquant).';
  end if;
end;
$$;

rollback;

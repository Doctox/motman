-- Le rappel du défi (02/11/2026, migration 20261102180000).
--
-- Trois promesses :
--   1. LES TABLES SONT FERMÉES : ni un visiteur ni un joueur ne lit ou n'écrit
--      directement qui a demandé le rappel, ni à qui il a été envoyé ;
--   2. UN JOUEUR NE CHANGE QUE SA PROPRE RÉPONSE, et la clé publique seule rien ;
--   3. UN RAPPEL PAR JOUR : la clé primaire refuse le second, c'est elle qui
--      empêche deux envois quand deux passages de la tâche se chevauchent.

begin;

do $$
declare
  joueur_a uuid;
  joueur_b uuid;
  aujourdhui constant date := (pg_catalog.now() at time zone 'Europe/Paris')::date;
  insere integer;
begin
  -- ── 1. Les tables sont fermées ────────────────────────────────────────────
  if pg_catalog.has_table_privilege('anon', 'public.daily_reminders', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.daily_reminders', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.daily_reminders', 'insert')
     or pg_catalog.has_table_privilege('authenticated', 'public.daily_reminder_sends', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.daily_reminder_sends', 'insert') then
    raise exception 'Le rappel du défi ne doit être ni lisible ni modifiable de l''extérieur';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.daily_reminders'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.daily_reminder_sends'::regclass) then
    raise exception 'Le rappel du défi doit avoir la sécurité par ligne';
  end if;

  -- ── 2. Chacun sa réponse ──────────────────────────────────────────────────
  if pg_catalog.has_function_privilege('anon', 'public.set_daily_reminder(boolean)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.daily_reminder_on()', 'execute') then
    raise exception 'La clé publique seule ne doit pas toucher au rappel du défi';
  end if;

  select id into joueur_a from auth.users order by created_at limit 1;
  select id into joueur_b from auth.users where id <> joueur_a order by created_at limit 1;
  delete from public.daily_reminders where user_id in (joueur_a, joueur_b);

  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', joueur_a, 'role', 'authenticated')::text, true);
  if public.daily_reminder_on() then
    raise exception 'Personne ne reçoit le rappel sans l''avoir demandé';
  end if;
  -- En deux instructions : une fonction `stable` lit l'état d'avant l'instruction en cours.
  if not public.set_daily_reminder(true) then
    raise exception 'Demander le rappel doit répondre vrai';
  end if;
  if not public.daily_reminder_on() then
    raise exception 'Le joueur doit pouvoir demander le rappel';
  end if;
  -- Une seconde demande ne casse rien.
  perform public.set_daily_reminder(true);
  if (select count(*) from public.daily_reminders where user_id = joueur_a) <> 1 then
    raise exception 'Une seule ligne par joueur';
  end if;

  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', joueur_b, 'role', 'authenticated')::text, true);
  if public.daily_reminder_on() then
    raise exception 'Un joueur ne doit pas lire la réponse d''un autre';
  end if;
  perform public.set_daily_reminder(false);
  if not exists (select 1 from public.daily_reminders where user_id = joueur_a) then
    raise exception 'Un joueur ne doit pas changer la réponse d''un autre';
  end if;

  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', joueur_a, 'role', 'authenticated')::text, true);
  if public.set_daily_reminder(false) then
    raise exception 'Arrêter le rappel doit répondre faux';
  end if;
  if public.daily_reminder_on() then
    raise exception 'Le joueur doit pouvoir arrêter le rappel';
  end if;

  perform pg_catalog.set_config('request.jwt.claims', '', true);
  begin
    perform public.set_daily_reminder(true);
    raise exception 'Sans session, le rappel doit être refusé' using errcode = 'P0002';
  exception when raise_exception then
    null;
  end;

  -- ── 3. Un rappel par jour ─────────────────────────────────────────────────
  insert into public.daily_reminder_sends (user_id, jour) values (joueur_a, aujourdhui)
  on conflict (user_id, jour) do nothing;
  insert into public.daily_reminder_sends (user_id, jour) values (joueur_a, aujourdhui)
  on conflict (user_id, jour) do nothing;
  get diagnostics insere = row_count;
  if insere <> 0 then
    raise exception 'Le second rappel du même jour doit être refusé';
  end if;
end;
$$;

rollback;

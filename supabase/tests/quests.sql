-- Les quêtes (migration 20260916050000) : ce que la base garantit.
--
-- Le barème vit dans src/quests.ts ; ici on vérifie les promesses de la base :
-- un avancement ne compte qu'une fois, une quête n'est payée qu'une fois, les
-- montants sont bornés, le gel ne dépasse jamais 3, et rien de tout cela n'est à
-- la portée d'un joueur.

begin;

do $$
declare
  joueur constant uuid := 'f0aa5001-0000-4000-8000-00000000c001';
  jour   constant text := '2026-09-16';
  semaine constant text := '2026-W38';
  resultat jsonb;
  plumes_avant bigint;
  niveau_avant integer;
begin
  -- ── 1. Rien de tout cela n'est à la portée d'un joueur ──────────────────────
  if pg_catalog.has_table_privilege('authenticated', 'public.player_quest_counters', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.player_quest_claims', 'insert')
     or pg_catalog.has_table_privilege('anon', 'public.quest_progress_events', 'select') then
    raise exception 'Les tables de quêtes sont accessibles aux joueurs.';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.server_claim_quest(uuid, text, text, text, integer, integer, integer)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.server_record_quest_progress(uuid, text, text, text, jsonb)', 'execute') then
    raise exception 'Un joueur peut appeler les fonctions de quêtes.';
  end if;

  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  select feathers into plumes_avant from public.player_wallets where user_id = joueur;
  select level into niveau_avant from public.player_progress where user_id = joueur;

  -- ── 2. Un avancement s'accumule, et ne compte qu'une fois ───────────────────
  resultat := public.server_record_quest_progress(joueur, 'quest:m1:' || joueur, jour, semaine,
    jsonb_build_object('lettres', 7, 'partie', 1, 'defi', 1));
  if resultat ->> 'applied' <> 'true' then
    raise exception 'Le premier avancement aurait dû être pris : %', resultat;
  end if;

  resultat := public.server_record_quest_progress(joueur, 'quest:m1:' || joueur, jour, semaine,
    jsonb_build_object('lettres', 7));
  if resultat ->> 'applied' <> 'false' then
    raise exception 'Le même match a compté deux fois : %', resultat;
  end if;

  resultat := public.server_record_quest_progress(joueur, 'quest:m2:' || joueur, jour, semaine,
    jsonb_build_object('lettres', 5, 'inconnu', 99));
  if (select value from public.player_quest_counters where user_id = joueur and scope = 'day' and period = jour and counter = 'lettres') <> 12 then
    raise exception 'Les lettres ne s''additionnent pas sur la journée.';
  end if;
  if exists (select 1 from public.player_quest_counters where user_id = joueur and counter = 'inconnu') then
    raise exception 'Un compteur inconnu a été accepté.';
  end if;
  if (select value from public.player_quest_counters where user_id = joueur and scope = 'week' and period = semaine and counter = 'defi') <> 1 then
    raise exception 'Le défi du jour ne remonte pas dans la semaine.';
  end if;

  -- ── 3. Une quête n'est payée qu'une fois ───────────────────────────────────
  resultat := public.server_claim_quest(joueur, 'day', jour, 'lettres-12', 60, 30, 0);
  if resultat ->> 'applied' <> 'true' or (resultat ->> 'feathers')::bigint <> plumes_avant + 60 then
    raise exception 'La première récupération n''a pas payé : %', resultat;
  end if;
  if (select lifetime_xp from public.player_progress where user_id = joueur) < 30 then
    raise exception 'L''XP de la quête n''a pas été versée.';
  end if;

  resultat := public.server_claim_quest(joueur, 'day', jour, 'lettres-12', 60, 30, 0);
  if resultat ->> 'applied' <> 'false' or (resultat ->> 'feathers')::bigint <> plumes_avant + 60 then
    raise exception 'La quête a été payée deux fois : %', resultat;
  end if;

  -- ── 4. Le gel : versé, et jamais plus de trois en poche ────────────────────
  resultat := public.server_claim_quest(joueur, 'week', semaine, 'defi-4', 0, 0, 1);
  if (resultat ->> 'streakFreezes')::int <> 1 then
    raise exception 'Le gel de la semaine n''a pas été versé : %', resultat;
  end if;

  update public.player_wallets set streak_freezes = 3 where user_id = joueur;
  resultat := public.server_claim_quest(joueur, 'week', '2026-W39', 'defi-4', 0, 0, 1);
  if (resultat ->> 'streakFreezes')::int <> 3 or (resultat ->> 'freezes')::int <> 0 then
    raise exception 'La poche à gels a dépassé trois : %', resultat;
  end if;

  -- ── 5. Les montants sont bornés ────────────────────────────────────────────
  begin
    resultat := public.server_claim_quest(joueur, 'day', jour, 'triche', 5000, 0, 0);
    raise exception 'Un montant hors barème a été accepté.';
  exception when others then
    if pg_catalog.strpos(sqlerrm, 'invalid quest reward') = 0 then raise; end if;
  end;

  begin
    resultat := public.server_claim_quest(joueur, 'mois', jour, 'triche', 10, 0, 0);
    raise exception 'Une portée inconnue a été acceptée.';
  exception when others then
    if pg_catalog.strpos(sqlerrm, 'invalid quest scope') = 0 then raise; end if;
  end;
end;
$$;

rollback;

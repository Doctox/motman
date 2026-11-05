-- MotMan+ se branche (05/11/2026) : les emotes, et la partie au calme qui ne s'efface pas.
--
-- Les emotes : la cadence se compte en base, et seul un participant d'une partie en cours
-- peut en envoyer. Les limites viennent de match-api, qui les lit dans src/emotes.ts.
--
-- La purge efface toute partie 26 h après sa dernière activité. Une partie au calme doit
-- y échapper tant qu'elle n'est pas finie : on la reprend quand on veut.
--
-- Chaque défaut est noté, et ils sont tous rapportés à la fin.

begin;

create function pg_temp.partie(joueurs uuid[], pace text, etat jsonb, statut text default 'active', age interval default interval '0')
returns uuid
language plpgsql
as $$
declare
  partie uuid;
begin
  insert into public.server_matches(mode, pace, grid_id, state, status, current_player_id, turn_number, turn_started_at, turn_ends_at, created_at, updated_at)
  values (
    'solo', pace,
    (select grid.id from public.server_grid_catalog as grid where grid.active is true order by grid.id limit 1),
    etat, statut, joueurs[1], 1,
    pg_catalog.clock_timestamp() - age, pg_catalog.clock_timestamp() - age + interval '10 years',
    pg_catalog.clock_timestamp() - age, pg_catalog.clock_timestamp() - age
  )
  returning id into partie;
  insert into public.match_participants(match_id, user_id)
  select partie, joueur from pg_catalog.unnest(joueurs) as joueur;
  return partie;
end;
$$;

do $$
declare
  a constant uuid := 'f0bd1105-0000-4000-8000-0000000000a1';
  b constant uuid := 'f0bd1105-0000-4000-8000-0000000000b2';
  etat constant jsonb := '{"playerIds": [], "scores": {}}'::jsonb;
  defauts text[] := '{}';
  duel uuid;
  statut text;
  au_calme uuid;
  au_calme_finie uuid;
  illimitee uuid;
begin
  insert into auth.users(id) values (a), (b);

  -- Les emotes.
  duel := pg_temp.partie(array[a], 'realtime', etat);
  statut := public.server_send_match_emote(duel, a, 'coucou', 5500, 10);
  if statut <> 'envoyee' then defauts := defauts || ('la première emote doit partir : ' || statut); end if;
  statut := public.server_send_match_emote(duel, a, 'pouce', 5500, 10);
  if statut <> 'attente' then defauts := defauts || ('la seconde, dans la foulée, doit attendre : ' || statut); end if;
  statut := public.server_send_match_emote(duel, b, 'pouce', 5500, 10);
  if statut <> 'interdite' then defauts := defauts || ('un autre joueur ne peut pas parler dans cette partie : ' || statut); end if;

  update public.server_match_emotes set sent_at = pg_catalog.clock_timestamp() - interval '1 minute' where match_id = duel;
  statut := public.server_send_match_emote(duel, a, 'bravo', 5500, 10);
  if statut <> 'envoyee' then defauts := defauts || ('après l''attente, elle repart : ' || statut); end if;

  insert into public.server_match_emotes(match_id, user_id, emote, sent_at)
  select duel, a, 'pouce', pg_catalog.clock_timestamp() - rang * interval '1 hour' from pg_catalog.generate_series(1, 8) as rang;
  update public.server_match_emotes set sent_at = sent_at - interval '1 minute' where match_id = duel;
  statut := public.server_send_match_emote(duel, a, 'bravo', 5500, 10);
  if statut <> 'epuisee' then defauts := defauts || ('dix par partie, pas une de plus : ' || statut); end if;

  update public.server_matches set status = 'finished' where id = duel;
  delete from public.server_match_emotes where match_id = duel;
  statut := public.server_send_match_emote(duel, a, 'bravo', 5500, 10);
  if statut <> 'terminee' then defauts := defauts || ('rien après la fin de la partie : ' || statut); end if;

  -- La purge.
  au_calme := pg_temp.partie(array[a], 'async', etat || '{"calme": true}', 'active', interval '40 days');
  au_calme_finie := pg_temp.partie(array[a], 'async', etat || '{"calme": true}', 'finished', interval '40 days');
  illimitee := pg_temp.partie(array[b], 'async', etat, 'active', interval '40 days');
  perform private.purge_stale_matches();
  if not exists (select 1 from public.server_matches where id = au_calme) then
    defauts := defauts || 'une partie au calme en cours ne s''efface pas'::text;
  end if;
  if exists (select 1 from public.server_matches where id = au_calme_finie) then
    defauts := defauts || 'une partie au calme finie s''efface comme les autres'::text;
  end if;
  if exists (select 1 from public.server_matches where id = illimitee) then
    defauts := defauts || 'une partie ordinaire oubliée s''efface toujours'::text;
  end if;

  -- Ce que les colonnes refusent.
  begin
    update public.profiles set couleur_pseudo = 'rose-bonbon' where id = a;
    defauts := defauts || 'une couleur inconnue doit être refusée'::text;
  exception when check_violation then null;
  end;
  update public.profiles set couleur_pseudo = 'arc-en-ciel' where id = a;

  -- Le tirage dans un thème : le thème se lit dans la vue.
  if exists (
    select 1 from public.server_grid_selection as selection
    where selection.active and selection.daily_only and selection.theme is null
  ) then
    defauts := defauts || 'toute grille réservée au défi doit porter son thème'::text;
  end if;

  if pg_catalog.array_length(defauts, 1) is not null then
    raise exception E'% défaut(s) :\n%', pg_catalog.array_length(defauts, 1), pg_catalog.array_to_string(defauts, E'\n');
  end if;
end;
$$;

rollback;

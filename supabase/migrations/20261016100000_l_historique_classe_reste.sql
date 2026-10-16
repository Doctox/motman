-- ─────────────────────────────────────────────────────────────────────────────
-- L'HISTORIQUE CLASSÉ RESTE (16/10/2026)
--
-- `ranked_rating_events.match_id` pointait vers `server_matches(id)` en
-- ON DELETE CASCADE (20260729230940). Or `private.purge_stale_matches` supprime
-- une partie 26 h après sa dernière activité : son résultat classé partait avec
-- elle. Trouvé le 13/10/2026 : la base ne gardait de résultats classés que pour
-- la veille. Le pouls (« classées sur sept jours ») ne comptait donc que le
-- dernier jour, et le détail classé d'un joueur s'effaçait au bout d'un jour.
-- Les totaux (`player_progress.ranked_*`) restaient justes.
--
-- La clé étrangère disparaît, rien d'autre ne change. `match_id` fait partie de
-- la clé primaire : un SET NULL est impossible. Aucun lecteur ne joint les
-- résultats à `server_matches` : le pouls compte les `match_id` distincts, la vue
-- d'une partie et `server_apply_ranked_result_atomic` les cherchent par l'id
-- d'une partie qui existe encore. L'index sur `match_id` (20260729231105) reste :
-- il sert ces recherches. Le passé déjà effacé ne revient pas.
--
-- COMBIEN DE TEMPS ? 90 JOURS, comme le détail de l'historique des parties
-- (`motman-archive-old-grid-history`, 20260729205407), puis plus rien : les
-- totaux de chaque joueur (`player_progress.ranked_*`) gardent le cumul. La
-- politique de confidentialité promet une conservation « pendant la durée
-- nécessaire au service » ; garder le détail à l'infini ne servait à rien. La
-- suppression d'un compte emporte toujours ses résultats (clés vers auth.users).
--
-- Garde : supabase/tests/ranked_history_kept.sql.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.ranked_rating_events
  drop constraint if exists ranked_rating_events_match_id_fkey;

comment on column public.ranked_rating_events.match_id is
  'Partie d''origine. Sans clé étrangère depuis le 16/10/2026 : le résultat classé reste quand la partie est purgée (26 h).';

create or replace function private.purge_old_ranked_rating_events(p_retention_days integer default 90)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  supprimes integer := 0;
begin
  if p_retention_days < 30 or p_retention_days > 365 then
    raise exception 'ranked rating event retention must be between 30 and 365 days';
  end if;
  delete from public.ranked_rating_events
  where created_at < pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => p_retention_days);
  get diagnostics supprimes = row_count;
  return supprimes;
end;
$$;

revoke all on function private.purge_old_ranked_rating_events(integer) from public, anon, authenticated;

comment on function private.purge_old_ranked_rating_events(integer) is
  'Efface les résultats classés de plus de 90 jours, comme le détail de l''historique des parties. Les totaux de player_progress restent.';

-- Rejouable : l'ancienne programmation, s'il y en a une, part d'abord.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'motman-purge-old-ranked-events'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

-- Chaque nuit, dix minutes après l'archivage de l'historique des parties.
select cron.schedule(
  'motman-purge-old-ranked-events',
  '47 3 * * *',
  'select private.purge_old_ranked_rating_events(90);'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RAPPELS DE TOUR ET CLÔTURE DES TOURS DÉPASSÉS (15/09/2026)
--
-- En temps illimité, un tour dure 24 h. Jusqu'ici, rien ne se passait tant
-- qu'aucun joueur n'ouvrait l'application : le tour dépassé n'était clos qu'à la
-- visite suivante, et au bout de 26 h sans mise à jour `private.purge_stale_matches`
-- effaçait la partie, sans résultat ni historique.
--
-- Toutes les 15 minutes, la base appelle désormais la fonction `match-rappels`,
-- qui clôt les tours dépassés et envoie les rappels (6 h, 12 h, 18 h ; silence de
-- 22 h à 8 h). Le détail des règles : supabase/functions/match-api/matchReminders.ts.
--
-- Le secret partagé avec la fonction est lu dans le coffre (`vault`, nom
-- `motman_cron_secret`) et n'apparaît dans aucun fichier. Tant qu'il n'y est pas,
-- l'appel n'est même pas émis.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_net with schema extensions;

-- Paliers déjà traités, par partie et par tour. Effacés avec la partie.
create table if not exists public.server_match_turn_reminders (
  match_id uuid not null references public.server_matches(id) on delete cascade,
  turn_number integer not null,
  marks_sent smallint not null check (marks_sent between 1 and 3),
  sent_at timestamptz not null default now(),
  primary key (match_id, turn_number)
);

alter table public.server_match_turn_reminders enable row level security;
revoke all on public.server_match_turn_reminders from public, anon, authenticated;
grant select, insert, update, delete on public.server_match_turn_reminders to service_role;

comment on table public.server_match_turn_reminders is
  'Rappels de tour en temps illimité déjà envoyés (match-rappels). Serveur uniquement.';

create or replace function private.appeler_rappels_tours()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  secret text;
begin
  select secrets.decrypted_secret into secret
  from vault.decrypted_secrets as secrets
  where secrets.name = 'motman_cron_secret'
  limit 1;

  if secret is null or pg_catalog.length(secret) < 32 then
    return null;
  end if;

  return net.http_post(
    url := 'https://kfacjvxzdtxybvxhfmzg.supabase.co/functions/v1/match-rappels',
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-motman-cron', secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.appeler_rappels_tours() from public, anon, authenticated;

comment on function private.appeler_rappels_tours() is
  'Appelle match-rappels (tours dépassés + rappels). Rend l''identifiant pg_net, ou null sans secret dans le coffre.';

select cron.schedule(
  'motman-rappels-tours',
  '*/15 * * * *',
  'select private.appeler_rappels_tours();'
);

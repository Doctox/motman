-- ─────────────────────────────────────────────────────────────────────────────
-- LE RAPPEL DU DÉFI, AU CHOIX DU JOUEUR (02/11/2026)
--
-- Validé par le propriétaire après la recherche sur la rétention : 6 joueurs du
-- défi sur 8 hors fidèles n'ont jamais joué deux jours de suite, et rien n'agit
-- sur quelqu'un qui n'ouvre pas l'appli. La carte de notifications promet
-- « Seulement pour tes parties et tes invitations » : le rappel ne part donc que
-- pour celui qui l'a demandé lui-même, à la fin d'un défi.
--
-- `daily_reminders` : une ligne = le joueur l'a demandé. Pas de ligne, pas de rappel.
-- `daily_reminder_sends` : un rappel par joueur et par jour, noté AVANT l'envoi
-- par la clé primaire (match-rappels/rappelDuDefi.ts). Elle permet aussi de lire
-- si le joueur a joué le jour de son rappel.
--
-- Les deux tables restent fermées à tous sauf à la clé de service. Le joueur ne
-- peut que changer sa propre réponse, et la relire.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.daily_reminders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_reminder_sends (
  user_id uuid not null references auth.users(id) on delete cascade,
  jour date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, jour)
);

alter table public.daily_reminders enable row level security;
alter table public.daily_reminder_sends enable row level security;
revoke all on public.daily_reminders from public, anon, authenticated;
revoke all on public.daily_reminder_sends from public, anon, authenticated;
grant all on public.daily_reminders to service_role;
grant all on public.daily_reminder_sends to service_role;

comment on table public.daily_reminders is
  'Joueurs qui ont demandé le rappel du défi du jour. Voir 20261102180000_le_rappel_du_defi.sql.';
comment on table public.daily_reminder_sends is
  'Rappels du défi envoyés, un par joueur et par jour de Paris. Voir 20261102180000_le_rappel_du_defi.sql.';

-- Le joueur connecté change sa réponse. Rend ce qui est maintenant vrai.
create or replace function public.set_daily_reminder(p_actif boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  joueur uuid := auth.uid();
begin
  if joueur is null then
    raise exception 'Joueur non connecté.';
  end if;

  if coalesce(p_actif, false) then
    insert into public.daily_reminders (user_id) values (joueur)
    on conflict (user_id) do nothing;
    return true;
  end if;

  delete from public.daily_reminders where user_id = joueur;
  return false;
end;
$$;

-- A-t-il demandé le rappel ? Un seul joueur peut être lu : lui-même.
create or replace function public.daily_reminder_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.daily_reminders where user_id = auth.uid());
$$;

revoke all on function public.set_daily_reminder(boolean) from public, anon, authenticated;
revoke all on function public.daily_reminder_on() from public, anon, authenticated;
grant execute on function public.set_daily_reminder(boolean) to authenticated, service_role;
grant execute on function public.daily_reminder_on() to authenticated, service_role;

-- Le GEL DE SÉRIE devient un objet, le RATTRAPAGE disparaît (décision du
-- propriétaire, 14/09/2026).
--
-- AVANT : les gels n'existaient nulle part. `private.daily_streak_from_days` les
-- recalculait à chaque appel depuis l'historique (un gel gagné à 7 et à 30, 2 au
-- plus), et un « pont » relevait une série cassée par deux victoires d'affilée.
--
-- MAINTENANT :
--   • player_wallets.streak_freezes : les gels EN POCHE, 3 au plus, achetés
--     500 plumes à l'Épicerie (server_buy_streak_freeze). Plus aucun gel offert.
--   • daily_frozen_days : les jours COUVERTS par un gel, enregistrés une fois
--     pour toutes. Un jour gelé relie deux victoires ; il ne compte pas comme une.
--   • server_record_daily_win : enregistre une victoire ET, s'il manque N jours
--     depuis la dernière journée active et que le joueur a au moins N gels, les
--     consomme — dans la même transaction.
--   • server_daily_streak : même signature et mêmes clés qu'avant, calculées
--     désormais par private.daily_streak_from_history.
--
-- Jumeaux TypeScript : src/dailyStreakRule.ts (freezeDaysToUse, computeStreak),
-- tenus égaux par src/data/dailyStreakScenarios.json (npm run test:rules).
--
-- CONVERSION : chaque rattrapage déjà fait devient un jour gelé OFFERT (source
-- 'legacy-recovery'), y compris un rattrapage encore en cours. Les séries
-- affichées ne bougent donc pas. Aucun gel n'avait jamais été gagné (meilleure
-- série en base : 4) : le garde-fou ci-dessous refuse la migration si ce n'était
-- plus vrai, car ces gels-là ne seraient pas convertis.

do $$
begin
  if exists (
    select 1 from (select distinct user_id from public.daily_wins) as joueur
    where (public.server_daily_streak(joueur.user_id, current_date) ->> 'best')::int >= 7
  ) then
    raise exception 'Une serie a deja atteint 7 : des gels ont ete gagnes, la conversion est a revoir.';
  end if;
end;
$$;

alter table public.player_wallets
  add column if not exists streak_freezes integer not null default 0
  check (streak_freezes between 0 and 3);

create table if not exists public.daily_frozen_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  source text not null check (source in ('freeze', 'legacy-recovery')),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
comment on table public.daily_frozen_days is
  'Jours du défi du jour couverts par un gel de série. Relient deux victoires sans compter comme une.';
alter table public.daily_frozen_days enable row level security;
revoke all on public.daily_frozen_days from public, anon, authenticated;
grant select, insert on public.daily_frozen_days to service_role;

-- Rattrapages déjà faits (ou encore en cours) → jours gelés offerts.
-- Le pont : victoire la veille du jour manqué, victoire le lendemain, et victoire
-- le surlendemain (ou surlendemain pas encore arrivé : rattrapage en cours).
insert into public.daily_frozen_days (user_id, day, source)
select avant.user_id, avant.day + 1, 'legacy-recovery'
from public.daily_wins as avant
where not exists (select 1 from public.daily_wins w where w.user_id = avant.user_id and w.day = avant.day + 1)
  and exists (select 1 from public.daily_wins w where w.user_id = avant.user_id and w.day = avant.day + 2)
  and (
    exists (select 1 from public.daily_wins w where w.user_id = avant.user_id and w.day = avant.day + 3)
    or avant.day + 3 >= (now() at time zone 'Europe/Paris')::date
  )
on conflict do nothing;

-- ── La règle, en SQL ─────────────────────────────────────────────────────────

create or replace function private.daily_freeze_days(
  p_last_active date,
  p_win_day date,
  p_pocket integer
) returns date[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_trou integer;
begin
  if p_last_active is null then return '{}'::date[]; end if;
  v_trou := p_win_day - p_last_active - 1;
  if v_trou <= 0 or v_trou > greatest(0, coalesce(p_pocket, 0)) then return '{}'::date[]; end if;
  return array(select p_last_active + i from generate_series(1, v_trou) as i order by i);
end;
$$;

create or replace function private.daily_streak_from_history(
  p_wins date[],
  p_frozen date[],
  p_today date,
  p_pocket integer
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_jour record;
  v_serie integer := 0;
  v_best integer := 0;
  v_veille date := null;
  v_derniere_victoire date := null;
  v_manques integer;
  v_vivante integer := 0;
begin
  for v_jour in
    select d.jour, bool_or(d.victoire) as victoire
    from (
      select unnest(coalesce(p_wins, '{}'::date[])) as jour, true as victoire
      union all
      select unnest(coalesce(p_frozen, '{}'::date[])), false
    ) as d
    where d.jour <= p_today
    group by d.jour
    order by d.jour
  loop
    if v_veille is not null and v_jour.jour - v_veille > 1 then v_serie := 0; end if;
    if v_jour.victoire then
      v_serie := v_serie + 1;
      v_best := greatest(v_best, v_serie);
      v_derniere_victoire := v_jour.jour;
    end if;
    v_veille := v_jour.jour;
  end loop;

  if v_veille is not null then
    v_manques := p_today - v_veille - 1;
    if v_manques <= 0 or v_manques <= greatest(0, coalesce(p_pocket, 0)) then v_vivante := v_serie; end if;
  end if;

  return jsonb_build_object(
    'streak', v_vivante,
    'streakAtLastWin', case when v_derniere_victoire is null then 0 else v_serie end,
    'best', v_best,
    'freezes', greatest(0, coalesce(p_pocket, 0)),
    'lastWin', v_derniere_victoire,
    'computedFor', p_today
  );
end;
$$;

create or replace function public.server_daily_streak(
  p_user_id uuid,
  p_today date
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.daily_streak_from_history(
    array(select day from public.daily_wins where user_id = p_user_id and day <= p_today order by day),
    array(select day from public.daily_frozen_days where user_id = p_user_id and day <= p_today order by day),
    p_today,
    coalesce((select streak_freezes from public.player_wallets where user_id = p_user_id), 0)
  );
end;
$$;
revoke all on function public.server_daily_streak(uuid, date) from public, anon, authenticated;
grant execute on function public.server_daily_streak(uuid, date) to service_role;

-- L'ancien moteur (gels déduits, pont) n'a plus d'appelant.
drop function if exists private.daily_streak_from_days(date[], date);

-- ── Enregistrer une victoire, et consommer les gels nécessaires ──────────────
create or replace function public.server_record_daily_win(
  p_user_id uuid,
  p_day date,
  p_match_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poche integer;
  v_derniere date;
  v_geles date[];
begin
  -- Verrou du portefeuille : deux clôtures concurrentes ne consomment pas deux fois.
  select streak_freezes into v_poche from public.player_wallets where user_id = p_user_id for update;
  if not found then raise exception 'player wallet missing'; end if;

  -- La PREMIÈRE victoire du jour fait foi : un rejeu ne change rien.
  if exists (select 1 from public.daily_wins where user_id = p_user_id and day = p_day) then
    return jsonb_build_object('recorded', false, 'frozenDays', '[]'::jsonb, 'freezes', v_poche);
  end if;

  select max(jour) into v_derniere from (
    select day as jour from public.daily_wins where user_id = p_user_id and day < p_day
    union all
    select day from public.daily_frozen_days where user_id = p_user_id and day < p_day
  ) as actifs;

  v_geles := private.daily_freeze_days(v_derniere, p_day, v_poche);
  if coalesce(array_length(v_geles, 1), 0) > 0 then
    insert into public.daily_frozen_days (user_id, day, source)
      select p_user_id, jour, 'freeze' from unnest(v_geles) as jour
      on conflict do nothing;
    update public.player_wallets
      set streak_freezes = streak_freezes - array_length(v_geles, 1), updated_at = now()
      where user_id = p_user_id;
  end if;

  insert into public.daily_wins (user_id, day, match_id) values (p_user_id, p_day, p_match_id)
    on conflict do nothing;

  return jsonb_build_object(
    'recorded', true,
    'frozenDays', to_jsonb(coalesce(v_geles, '{}'::date[])),
    'freezes', v_poche - coalesce(array_length(v_geles, 1), 0)
  );
end;
$$;
revoke all on function public.server_record_daily_win(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.server_record_daily_win(uuid, date, uuid) to service_role;

-- ── Acheter un gel ───────────────────────────────────────────────────────────
create or replace function public.server_buy_streak_freeze(
  p_user_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prix constant bigint := 500;
  v_max constant integer := 3;
  v_solde bigint;
  v_poche integer;
  v_existant jsonb;
begin
  if coalesce(p_idempotency_key, '') = '' then raise exception 'invalid idempotency key'; end if;

  select feathers, streak_freezes into v_solde, v_poche
  from public.player_wallets where user_id = p_user_id for update;
  if not found then raise exception 'Portefeuille introuvable.' using errcode = 'P0001'; end if;

  select metadata into v_existant from public.economy_transactions
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then return v_existant; end if;

  if v_poche >= v_max then raise exception 'Vous avez deja 3 gels de serie.' using errcode = 'P0001'; end if;
  if v_solde < v_prix then raise exception 'Il vous manque quelques plumes.' using errcode = 'P0001'; end if;

  update public.player_wallets
    set feathers = feathers - v_prix, streak_freezes = streak_freezes + 1, updated_at = now()
    where user_id = p_user_id;
  v_existant := jsonb_build_object('freezes', v_poche + 1, 'balance', v_solde - v_prix, 'price', v_prix);
  insert into public.economy_transactions (user_id, idempotency_key, kind, amount, balance_after, metadata)
    values (p_user_id, p_idempotency_key, 'streak-freeze-purchase', -v_prix, v_solde - v_prix, v_existant);
  return v_existant;
end;
$$;
revoke all on function public.server_buy_streak_freeze(uuid, text) from public, anon, authenticated;
grant execute on function public.server_buy_streak_freeze(uuid, text) to service_role;

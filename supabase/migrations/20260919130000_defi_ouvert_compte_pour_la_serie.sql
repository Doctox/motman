-- LE DÉFI DU JOUR OUVERT COMPTE POUR LA SÉRIE (décision du propriétaire,
-- 19/09/2026).
--
-- AVANT : la série se déduisait de `daily_wins` — seuls les jours GAGNÉS la
-- faisaient avancer.
--
-- MAINTENANT : « tout défi ouvert compte, même abandonné ». Le même jour, le
-- propriétaire ferme le défi à qui l'abandonne (bouton « Abandonner » ou
-- absence) : il ne se retente plus avant minuit. Sans la première règle, la
-- seconde casserait la série de quiconque abandonne.
--
--   • daily_plays : une ligne par joueur et par jour où il a OUVERT le défi,
--     écrite par match-api à la création de la partie. Source de la série.
--   • daily_wins ne change pas de sens : les jours GAGNÉS, pour le bonus de
--     250 plumes et le calendrier (« on garde l'idée de victoire »).
--   • server_record_daily_play : enregistre le jour joué et consomme les gels qui
--     couvrent le trou depuis la dernière journée active — la logique que
--     server_record_daily_win portait jusqu'ici, déplacée telle quelle.
--   • server_record_daily_win : enregistre d'abord le jour joué (un match créé
--     avant ce déploiement n'en a pas), puis la victoire.
--   • server_daily_streak : même signature, mêmes clés ; il lit les jours JOUÉS.
--     `lastWin` y désigne donc la dernière journée jouée.
--
-- Le moteur de série lui-même (private.daily_streak_from_history, jumeau
-- TypeScript computeStreak) ne change pas : il compte des « jours actifs », on
-- lui passe simplement les jours joués au lieu des jours gagnés. Le banc
-- d'essai commun (src/data/dailyStreakScenarios.json) reste donc valable.

create table if not exists public.daily_plays (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  match_id uuid references public.server_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
comment on table public.daily_plays is
  'Une ligne par joueur et par jour où le défi du jour a été OUVERT (gagné, perdu ou abandonné). Source de vérité de la série depuis le 19/09/2026.';
alter table public.daily_plays enable row level security;
revoke all on public.daily_plays from public, anon, authenticated;
grant select, insert on public.daily_plays to service_role;

-- Toute victoire passée est un jour joué : les séries en cours ne bougent pas.
insert into public.daily_plays (user_id, day, match_id, created_at)
select user_id, day, match_id, created_at from public.daily_wins
on conflict do nothing;

-- ── La série, d'après les jours JOUÉS ────────────────────────────────────────
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
    -- `daily_wins` en plus, par prudence : une victoire est toujours un jour joué.
    array(
      select day from public.daily_plays where user_id = p_user_id and day <= p_today
      union
      select day from public.daily_wins where user_id = p_user_id and day <= p_today
      order by 1
    ),
    array(select day from public.daily_frozen_days where user_id = p_user_id and day <= p_today order by day),
    p_today,
    coalesce((select streak_freezes from public.player_wallets where user_id = p_user_id), 0)
  );
end;
$$;
revoke all on function public.server_daily_streak(uuid, date) from public, anon, authenticated;
grant execute on function public.server_daily_streak(uuid, date) to service_role;

-- ── Enregistrer un jour joué, et consommer les gels nécessaires ──────────────
create or replace function public.server_record_daily_play(
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
  -- Verrou du portefeuille : deux ouvertures concurrentes ne consomment pas deux fois.
  select streak_freezes into v_poche from public.player_wallets where user_id = p_user_id for update;
  if not found then raise exception 'player wallet missing'; end if;

  -- Le PREMIER défi ouvert du jour fait foi : une nouvelle tentative ne change rien.
  if exists (select 1 from public.daily_plays where user_id = p_user_id and day = p_day) then
    return jsonb_build_object('recorded', false, 'frozenDays', '[]'::jsonb, 'freezes', v_poche);
  end if;

  select max(jour) into v_derniere from (
    select day as jour from public.daily_plays where user_id = p_user_id and day < p_day
    union all
    select day from public.daily_wins where user_id = p_user_id and day < p_day
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

  insert into public.daily_plays (user_id, day, match_id) values (p_user_id, p_day, p_match_id)
    on conflict do nothing;

  return jsonb_build_object(
    'recorded', true,
    'frozenDays', to_jsonb(coalesce(v_geles, '{}'::date[])),
    'freezes', v_poche - coalesce(array_length(v_geles, 1), 0)
  );
end;
$$;
revoke all on function public.server_record_daily_play(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.server_record_daily_play(uuid, date, uuid) to service_role;

-- ── Enregistrer une victoire ─────────────────────────────────────────────────
-- Rend la réponse de server_record_daily_play : `recorded` dit si CE jour vient
-- d'entrer dans la série (vrai pour un match créé avant ce déploiement, qui n'a
-- pas été enregistré à l'ouverture).
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
  v_jeu jsonb;
begin
  v_jeu := public.server_record_daily_play(p_user_id, p_day, p_match_id);
  insert into public.daily_wins (user_id, day, match_id) values (p_user_id, p_day, p_match_id)
    on conflict do nothing;
  return v_jeu;
end;
$$;
revoke all on function public.server_record_daily_win(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.server_record_daily_win(uuid, date, uuid) to service_role;

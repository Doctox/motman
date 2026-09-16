-- ─────────────────────────────────────────────────────────────────────────────
-- LES QUÊTES (16/09/2026, décidées par le propriétaire)
--
-- Trois quêtes par jour, toutes réalisables dans UNE partie, plus une quête de
-- la semaine. Rien n'est versé tout seul : le joueur touche « Récupérer », et
-- c'est ce geste qui paie — 60 plumes et 30 XP par quête du jour, un gel de
-- série pour la semaine (rendu en 500 plumes si la poche est déjà pleine).
--
-- CE QUE LA BASE SAIT, ET CE QU'ELLE IGNORE. Elle accumule des COMPTEURS
-- (lettres justes, chevalets complets, mots terminés…) et enregistre les
-- récupérations. Elle ne connaît NI les cibles NI les montants : ils vivent dans
-- `src/quests.ts`, lu par le jeu et par les edge functions. Écrire le barème une
-- seconde fois ici, c'est l'assurance qu'il diverge — c'est déjà arrivé sur ce
-- projet avec la courbe d'XP et la note du défi.
--
-- Le garde-fou reste côté base : les montants passés en argument sont bornés,
-- et une quête ne peut être récupérée qu'une fois (clé primaire).
--
-- AU PASSAGE : la boucle de niveaux sort de `server_award_progress` dans
-- `private.appliquer_experience`, pour que la récupération d'une quête accorde
-- l'XP EXACTEMENT comme une fin de partie. La courbe (100 + 15 × (niveau − 1),
-- plafond 50) n'est donc toujours écrite qu'une fois côté SQL, et
-- `npm run test:rules` la compare à `src/experienceCurve.ts`.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. L'expérience, en un seul endroit ──────────────────────────────────────

create or replace function private.appliquer_experience(p_user_id uuid, p_xp integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_progress public.player_progress%rowtype;
  gagne integer := greatest(0, coalesce(p_xp, 0));
  remaining integer;
  goal integer;
  next_level integer;
  next_xp integer;
  new_title_ids text[] := '{}'::text[];
begin
  select * into current_progress from public.player_progress where user_id = p_user_id for update;
  if current_progress.user_id is null then
    raise exception 'player progression missing';
  end if;

  remaining := gagne;
  next_level := current_progress.level;
  next_xp := current_progress.xp;
  while remaining > 0 and next_level < 50 loop
    goal := 100 + (next_level - 1) * 15;
    if next_xp + remaining >= goal then
      remaining := remaining - (goal - next_xp);
      next_level := next_level + 1;
      next_xp := 0;
    else
      next_xp := next_xp + remaining;
      remaining := 0;
    end if;
  end loop;
  if next_level >= 50 then next_level := 50; next_xp := 0; end if;

  update public.player_progress set
    level = next_level,
    xp = next_xp,
    lifetime_xp = lifetime_xp + gagne,
    updated_at = now()
  where user_id = p_user_id;

  with newly_unlocked as (
    insert into public.player_titles(user_id, title_id, source)
    select p_user_id, title.id, 'level'
    from public.server_title_catalog title
    where title.active and title.unlock_type = 'level' and title.required_value <= next_level
    on conflict do nothing
    returning title_id
  )
  select coalesce(array_agg(title_id order by title_id), '{}'::text[])
  into new_title_ids
  from newly_unlocked;

  update public.profiles
  set title_id = coalesce(title_id, 'premiers-mots'), updated_at = now()
  where id = p_user_id;

  return jsonb_build_object(
    'levelBefore', current_progress.level, 'level', next_level, 'xp', next_xp,
    'xpAwarded', gagne, 'unlockedTitleIds', new_title_ids
  );
end;
$$;

revoke all on function private.appliquer_experience(uuid, integer) from public, anon, authenticated;

comment on function private.appliquer_experience(uuid, integer) is
  'Verse de l''XP : niveaux, titres débloqués, titre par défaut. Seul endroit où la courbe est écrite en SQL.';

create or replace function public.server_award_progress(
  p_user_id uuid, p_idempotency_key text, p_mode text, p_outcome text,
  p_productive_turns integer, p_feather_amount integer, p_feather_breakdown jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_progress public.player_progress%rowtype;
  current_wallet public.player_wallets%rowtype;
  productive_xp integer;
  completion_xp integer;
  result_xp integer;
  total_xp integer;
  progression jsonb;
  next_balance bigint;
begin
  if p_mode not in ('solo','multiplayer') or p_outcome not in ('win','draw','loss','abandon','opponent-abandoned') then
    raise exception 'invalid award';
  end if;
  if p_feather_amount < 0 or jsonb_typeof(coalesce(p_feather_breakdown,'{}'::jsonb)) <> 'object' then
    raise exception 'invalid feather reward';
  end if;
  if exists(select 1 from public.experience_awards where user_id=p_user_id and idempotency_key=p_idempotency_key) then
    select * into current_progress from public.player_progress where user_id=p_user_id;
    select * into current_wallet from public.player_wallets where user_id=p_user_id;
    return jsonb_build_object('applied',false,'level',current_progress.level,'xp',current_progress.xp,'feathers',current_wallet.feathers);
  end if;

  select * into current_progress from public.player_progress where user_id=p_user_id for update;
  select * into current_wallet from public.player_wallets where user_id=p_user_id for update;
  if current_progress.user_id is null or current_wallet.user_id is null then
    raise exception 'player progression missing';
  end if;

  productive_xp := greatest(0,p_productive_turns) * case when p_mode='solo' then 1 else 2 end;
  completion_xp := case when p_outcome in ('win','draw','loss') then case when p_mode='solo' then 5 else 10 end else 0 end;
  result_xp := case
    when p_mode='solo' and p_outcome='win' then 10
    when p_mode='solo' and p_outcome='draw' then 6
    when p_mode='solo' and p_outcome='loss' then 3
    when p_mode='multiplayer' and p_outcome='win' then 20
    when p_mode='multiplayer' and p_outcome='draw' then 12
    when p_mode='multiplayer' and p_outcome='loss' then 6
    else 0 end;
  total_xp := productive_xp + completion_xp + result_xp;

  progression := private.appliquer_experience(p_user_id, total_xp);

  update public.player_progress set
    wins = wins + case when p_outcome in ('win','opponent-abandoned') then 1 else 0 end,
    losses = losses + case when p_outcome in ('loss','abandon') then 1 else 0 end,
    updated_at = now()
  where user_id = p_user_id;

  next_balance := current_wallet.feathers + greatest(0,p_feather_amount);
  update public.player_wallets set feathers=next_balance, updated_at=now() where user_id=p_user_id;

  insert into public.experience_awards(
    user_id,idempotency_key,mode,outcome,productive_turns,xp_amount,feather_amount,
    feather_breakdown,unlocked_title_ids,level_before,level_after
  ) values (
    p_user_id,p_idempotency_key,p_mode,p_outcome,greatest(0,p_productive_turns),total_xp,
    greatest(0,p_feather_amount),coalesce(p_feather_breakdown,'{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(progression -> 'unlockedTitleIds')), '{}'::text[]),
    (progression ->> 'levelBefore')::int, (progression ->> 'level')::int
  );
  insert into public.economy_transactions(user_id,idempotency_key,kind,amount,balance_after,metadata)
  values(
    p_user_id,p_idempotency_key,'match-reward',greatest(0,p_feather_amount),next_balance,
    jsonb_build_object('mode',p_mode,'outcome',p_outcome,'breakdown',coalesce(p_feather_breakdown,'{}'::jsonb))
  );
  return jsonb_build_object(
    'applied',true,'xpAwarded',total_xp,'level',(progression ->> 'level')::int,'xp',(progression ->> 'xp')::int,
    'feathersAwarded',greatest(0,p_feather_amount),'feathers',next_balance,
    'unlockedTitleIds',coalesce(array(select jsonb_array_elements_text(progression -> 'unlockedTitleIds')), '{}'::text[])
  );
end;
$$;

-- ── 2. Les compteurs et les récupérations ────────────────────────────────────

create table if not exists public.player_quest_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('day', 'week')),
  period text not null check (char_length(period) between 7 and 10),
  counter text not null check (counter in ('lettres', 'chevalet', 'partie', 'sans-indice', 'mots', 'images', 'defi')),
  value integer not null default 0 check (value >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, period, counter)
);

comment on table public.player_quest_counters is
  'Compteurs de quêtes accumulés par jour et par semaine. Les cibles vivent dans src/quests.ts.';

create table if not exists public.player_quest_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('day', 'week')),
  period text not null,
  quest_id text not null check (char_length(quest_id) between 1 and 60),
  plumes integer not null default 0 check (plumes >= 0),
  xp integer not null default 0 check (xp >= 0),
  freezes integer not null default 0 check (freezes >= 0),
  claimed_at timestamptz not null default now(),
  primary key (user_id, scope, period, quest_id)
);

comment on table public.player_quest_claims is
  'Quêtes déjà récupérées. La clé primaire est ce qui empêche d''être payé deux fois.';

create table if not exists public.quest_progress_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

comment on table public.quest_progress_events is
  'Clés d''idempotence des avancements de quêtes (une par partie et par joueur).';

alter table public.player_quest_counters enable row level security;
alter table public.player_quest_claims enable row level security;
alter table public.quest_progress_events enable row level security;
revoke all on public.player_quest_counters from public, anon, authenticated;
revoke all on public.player_quest_claims from public, anon, authenticated;
revoke all on public.quest_progress_events from public, anon, authenticated;
grant select, insert, update, delete on public.player_quest_counters to service_role;
grant select, insert, update, delete on public.player_quest_claims to service_role;
grant select, insert, delete on public.quest_progress_events to service_role;

-- ── 3. Avancer ───────────────────────────────────────────────────────────────

create or replace function public.server_record_quest_progress(
  p_user_id uuid, p_idempotency_key text, p_day text, p_week text, p_increments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  nouveau boolean;
begin
  if p_day is null or p_week is null or jsonb_typeof(coalesce(p_increments, 'null'::jsonb)) <> 'object' then
    raise exception 'invalid quest progress';
  end if;

  insert into public.quest_progress_events (user_id, idempotency_key)
  values (p_user_id, p_idempotency_key)
  on conflict do nothing
  returning true into nouveau;
  if nouveau is null then
    return jsonb_build_object('applied', false);
  end if;

  -- Tous les compteurs vont dans le jour ET dans la semaine : une quête
  -- hebdomadaire pourra demain compter autre chose que le défi sans migration.
  insert into public.player_quest_counters (user_id, scope, period, counter, value)
  select p_user_id, portee.scope, portee.period, item.key, least(1000, greatest(0, (item.value)::integer))
  from jsonb_each_text(p_increments) as item(key, value)
  cross join (values ('day', p_day), ('week', p_week)) as portee(scope, period)
  where item.key in ('lettres', 'chevalet', 'partie', 'sans-indice', 'mots', 'images', 'defi')
    and item.value ~ '^[0-9]+$'
  on conflict (user_id, scope, period, counter) do update
  set value = least(1000000, public.player_quest_counters.value + excluded.value), updated_at = now();

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.server_record_quest_progress(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ── 4. Récupérer ─────────────────────────────────────────────────────────────

create or replace function public.server_claim_quest(
  p_user_id uuid, p_scope text, p_period text, p_quest_id text,
  p_plumes integer, p_xp integer, p_freezes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_wallet public.player_wallets%rowtype;
  progression jsonb;
  gels integer;
  solde bigint;
  nouveau boolean;
begin
  if p_scope not in ('day', 'week') then
    raise exception 'invalid quest scope';
  end if;
  -- Bornes de sécurité : les montants viennent de src/quests.ts, côté serveur.
  -- Si ce code se trompait un jour, la base refuse plutôt que de créditer.
  if coalesce(p_plumes, 0) not between 0 and 500
     or coalesce(p_xp, 0) not between 0 and 100
     or coalesce(p_freezes, 0) not between 0 and 1 then
    raise exception 'invalid quest reward';
  end if;

  insert into public.player_quest_claims (user_id, scope, period, quest_id, plumes, xp, freezes)
  values (p_user_id, p_scope, p_period, p_quest_id, coalesce(p_plumes, 0), coalesce(p_xp, 0), coalesce(p_freezes, 0))
  on conflict do nothing
  returning true into nouveau;

  select * into current_wallet from public.player_wallets where user_id = p_user_id for update;
  if current_wallet.user_id is null then
    raise exception 'player wallet missing';
  end if;

  if nouveau is null then
    return jsonb_build_object('applied', false, 'feathers', current_wallet.feathers, 'streakFreezes', current_wallet.streak_freezes);
  end if;

  solde := current_wallet.feathers + coalesce(p_plumes, 0);
  gels := least(3, current_wallet.streak_freezes + coalesce(p_freezes, 0));
  update public.player_wallets
  set feathers = solde, streak_freezes = gels, updated_at = now()
  where user_id = p_user_id;

  if coalesce(p_plumes, 0) > 0 then
    insert into public.economy_transactions (user_id, idempotency_key, kind, amount, balance_after, metadata)
    values (
      p_user_id, 'quest:' || p_scope || ':' || p_period || ':' || p_quest_id, 'quest-reward',
      coalesce(p_plumes, 0), solde,
      jsonb_build_object('scope', p_scope, 'period', p_period, 'questId', p_quest_id, 'freezes', coalesce(p_freezes, 0))
    );
  end if;

  progression := private.appliquer_experience(p_user_id, coalesce(p_xp, 0));

  return jsonb_build_object(
    'applied', true,
    'plumes', coalesce(p_plumes, 0),
    'xp', coalesce(p_xp, 0),
    'freezes', gels - current_wallet.streak_freezes,
    'feathers', solde,
    'streakFreezes', gels,
    'level', (progression ->> 'level')::int,
    'levelXp', (progression ->> 'xp')::int,
    'unlockedTitleIds', coalesce(array(select jsonb_array_elements_text(progression -> 'unlockedTitleIds')), '{}'::text[])
  );
end;
$$;

revoke all on function public.server_claim_quest(uuid, text, text, text, integer, integer, integer) from public, anon, authenticated;

comment on function public.server_claim_quest(uuid, text, text, text, integer, integer, integer) is
  'Paie UNE fois une quête finie : plumes, XP et gel de série. Les montants sont bornés ici, décidés dans src/quests.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- MOTMAN+ SE BRANCHE (05/11/2026, demande du propriétaire).
--
-- Tout ce que les parties à thème, la partie au calme, les emotes et la couleur du
-- pseudo demandent en base. Ouvert sur son seul compte pour l'instant : match-api et
-- account-api revérifient le rôle à chaque action. Rien ici n'est lisible par un joueur,
-- sauf la couleur, qui est faite pour se voir.
--
-- À APPLIQUER AVANT match-api : le tirage des grilles et la force d'En chaîne lisent
-- les nouvelles colonnes.
-- ─────────────────────────────────────────────────────────────────────────────

-- Le thème de chaque grille, pour tirer dans un thème sans lire tout le catalogue.
create or replace view public.server_grid_selection as
select
  catalogue.id,
  catalogue.active,
  coalesce((catalogue.payload ->> 'dailyOnly')::boolean, false) as daily_only,
  coalesce(
    (
      select jsonb_agg(jsonb_build_object('answer', mot ->> 'answer') order by ordinalite)
      from jsonb_array_elements(catalogue.payload -> 'words') with ordinality as mots(mot, ordinalite)
    ),
    '[]'::jsonb
  ) as words,
  catalogue.payload ->> 'theme' as theme
from public.server_grid_catalog as catalogue;

-- Une force d'adversaire par famille : sans chrono, un joueur gagne plus, et ça ne doit
-- pas durcir ses parties chronométrées. Null : En chaîne, comme depuis le 04/11.
alter table public.grid_player_history
  add column if not exists famille_force text
  check (famille_force is null or famille_force in ('classique', 'calme'));

comment on column public.grid_player_history.famille_force is
  'De quelle force de l''adversaire parle force_adversaire : null pour En chaîne, classique ou calme pour MotMan+.';

-- L'invitation d'un ami sur un thème, et les parties qu'il a déjà reçues.
alter table public.server_match_invitations
  add column if not exists theme text;

comment on column public.server_match_invitations.theme is
  'MotMan+ : le thème sur lequel l''ami est invité. Null pour une partie ordinaire.';

create table if not exists public.server_parties_offertes (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Sans clé étrangère : la partie s'efface 26 h après sa fin, pas ce qu'elle a compté.
  match_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

alter table public.server_parties_offertes enable row level security;
revoke all on table public.server_parties_offertes from public, anon, authenticated;
grant select, insert, update on table public.server_parties_offertes to service_role;

comment on table public.server_parties_offertes is
  'Les parties à thème jouées sur invitation par un joueur sans MotMan+ : 3 en tout (src/reglesPlus.ts).';

-- UNE PARTIE AU CALME NE S'EFFACE PAS tant qu'elle n'est pas finie : on la reprend quand
-- on veut, et sans cette exception elle disparaîtrait 26 h après le dernier coup.
create or replace function private.purge_stale_matches()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_matches integer := 0;
  stale_match_ids uuid[] := '{}'::uuid[];
begin
  -- Lock the exact cleanup set for the duration of this short transaction.
  -- A match being resolved concurrently is skipped and reconsidered by the
  -- next hourly run instead of losing its invitation halfway through cleanup.
  select coalesce(array_agg(stale.id), '{}'::uuid[])
  into stale_match_ids
  from (
    select matches.id
    from public.server_matches as matches
    where matches.updated_at < now() - interval '26 hours'
      and not (matches.status = 'active' and coalesce(matches.state ->> 'calme', '') = 'true')
    order by matches.updated_at, matches.id
    for update skip locked
  ) as stale;

  if cardinality(stale_match_ids) = 0 then
    return 0;
  end if;

  delete from public.server_match_invitations
  where match_id = any(stale_match_ids);

  delete from public.server_matches
  where id = any(stale_match_ids);

  get diagnostics deleted_matches = row_count;
  return deleted_matches;
end;
$$;

-- LES EMOTES. La cadence se compte ici, pas dans l'état de la partie : une emote ne doit
-- jamais faire échouer le coup qui part au même instant (`persist` écrit sous condition
-- de `updated_at`). Les limites viennent de match-api, qui les lit dans src/emotes.ts.
create table if not exists public.server_match_emotes (
  match_id uuid not null references public.server_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emote text not null,
  sent_at timestamptz not null default clock_timestamp(),
  primary key (match_id, user_id, sent_at)
);

alter table public.server_match_emotes enable row level security;
revoke all on table public.server_match_emotes from public, anon, authenticated;

create or replace function public.server_send_match_emote(
  p_match_id uuid,
  p_user_id uuid,
  p_emote text,
  p_attente_ms integer,
  p_maximum integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre integer;
  v_derniere timestamptz;
begin
  if not exists (
    select 1 from public.match_participants as participant
    where participant.match_id = p_match_id and participant.user_id = p_user_id
  ) then
    return 'interdite';
  end if;
  if not exists (select 1 from public.server_matches as partie where partie.id = p_match_id and partie.status = 'active') then
    return 'terminee';
  end if;

  -- Deux envois au même instant passeraient sinon tous les deux.
  perform pg_advisory_xact_lock(hashtextextended('emote:' || p_match_id::text || ':' || p_user_id::text, 0));

  select count(*), max(emote.sent_at) into v_nombre, v_derniere
  from public.server_match_emotes as emote
  where emote.match_id = p_match_id and emote.user_id = p_user_id;

  if v_nombre >= p_maximum then
    return 'epuisee';
  end if;
  if v_derniere is not null and clock_timestamp() - v_derniere < make_interval(secs => p_attente_ms / 1000.0) then
    return 'attente';
  end if;

  insert into public.server_match_emotes (match_id, user_id, emote) values (p_match_id, p_user_id, p_emote);

  begin
    perform realtime.send(
      jsonb_build_object('playerId', p_user_id, 'emote', p_emote),
      'emote',
      'match:' || p_match_id::text,
      true
    );
  exception when others then
    raise warning 'Emote non diffusée : %', sqlerrm;
  end;
  return 'envoyee';
end;
$$;

revoke all on function public.server_send_match_emote(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.server_send_match_emote(uuid, uuid, text, integer, integer) to service_role;

-- LA COULEUR DU PSEUDO. `profiles` se lit par tous : la couleur est faite pour se voir.
-- Le joueur ne l'écrit jamais lui-même : account-api vérifie son droit (20260717114659).
alter table public.profiles
  add column if not exists couleur_pseudo text
  check (couleur_pseudo is null or couleur_pseudo in ('emeraude', 'ocean', 'indigo', 'prune', 'framboise', 'ambre', 'turquoise', 'ardoise', 'arc-en-ciel'));

comment on column public.profiles.couleur_pseudo is
  'MotMan+ : la couleur du pseudo (src/reglesPlus.ts). Null : le pseudo sans couleur.';

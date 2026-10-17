-- ─────────────────────────────────────────────────────────────────────────────
-- D'OÙ VIENNENT LES JOUEURS (17/10/2026)
--
-- Demande du propriétaire : savoir si les nouveaux joueurs arrivent de Google,
-- du Play Store, d'Instagram, de TikTok ou de YouTube. Version automatique,
-- sans question au joueur (src/sourceDuJoueur.ts) : lien marqué
-- (`?src=instagram`), page précédente, ou appli Android.
--
-- DEUX TABLES, PRIVÉES TOUTES LES DEUX (clé de service seulement) :
--   - `player_sources` : la source de CHAQUE nouveau compte, une fois. Elle
--     sert à ne compter personne deux fois, et à lire d'où vient un « autre ».
--     Elle part avec le compte, comme le reste (suppression, nettoyage des
--     invités inactifs).
--   - `player_source_daily` : un compteur par jour de Paris, par canal et par
--     plateforme, SANS identifiant. Les invités qui essaient une fois puis
--     disparaissent sont effacés au bout de 30 jours ; le compteur, lui, garde
--     leur arrivée — c'est elle qu'on veut compter.
--
-- Jamais lisible par un joueur : `profiles` l'est par tout joueur connecté, la
-- source n'y est donc pas. Seul le pouls du propriétaire l'affiche (match-api).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.player_sources (
  user_id uuid primary key references auth.users(id) on delete cascade,
  canal text not null check (canal ~ '^[a-z0-9-]{1,32}$'),
  -- Le nom du site ou de l'appli d'où l'on vient, jamais l'adresse complète.
  referrer_host text check (referrer_host is null or referrer_host ~ '^[a-z0-9.-]{1,100}$'),
  plateforme text not null check (plateforme in ('web', 'android', 'ios')),
  created_at timestamptz not null default now()
);

alter table public.player_sources enable row level security;
revoke all on public.player_sources from public, anon, authenticated;
grant all on public.player_sources to service_role;

comment on table public.player_sources is
  'D''où vient chaque nouveau compte, noté une fois à sa création. Privé. Voir 20261017100000_d_ou_viennent_les_joueurs.sql.';

create table if not exists public.player_source_daily (
  jour date not null,
  canal text not null check (canal ~ '^[a-z0-9-]{1,32}$'),
  plateforme text not null check (plateforme in ('web', 'android', 'ios')),
  joueurs integer not null default 0 check (joueurs >= 0),
  primary key (jour, canal, plateforme)
);

alter table public.player_source_daily enable row level security;
revoke all on public.player_source_daily from public, anon, authenticated;
grant all on public.player_source_daily to service_role;

comment on table public.player_source_daily is
  'Nouveaux joueurs par jour de Paris, canal et plateforme. Sans identifiant : survit au nettoyage des invités. Voir 20261017100000_d_ou_viennent_les_joueurs.sql.';

-- Noter la source d'un compte : la première seulement, et le compteur du jour
-- avec elle, dans la même transaction. Vrai si elle vient d'être notée.
create or replace function public.server_note_player_source(
  p_user_id uuid,
  p_canal text,
  p_referrer_host text,
  p_plateforme text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  notee integer;
begin
  insert into public.player_sources (user_id, canal, referrer_host, plateforme)
  values (p_user_id, p_canal, p_referrer_host, p_plateforme)
  on conflict (user_id) do nothing;
  get diagnostics notee = row_count;
  if notee = 0 then
    return false;
  end if;

  insert into public.player_source_daily as compteur (jour, canal, plateforme, joueurs)
  values ((pg_catalog.now() at time zone 'Europe/Paris')::date, p_canal, p_plateforme, 1)
  on conflict (jour, canal, plateforme) do update
    set joueurs = compteur.joueurs + 1;
  return true;
end;
$$;

revoke all on function public.server_note_player_source(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.server_note_player_source(uuid, text, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- AVERTIR UN JOUEUR, ET COMPTER LES AVERTISSEMENTS (21/09/2026)
--
-- Décision du propriétaire, le jour où il a découvert que ses signalements
-- n'arrivaient nulle part : « enlève Suspendre et mets Avertir, parce que moi
-- j'ai aucun moyen de communiquer avec le compte. Ça lui envoie un message
-- dans la lettre, et moi ça me met un +1 sur averti — au bout de 3 j'aurais
-- assez pour décider d'un ban. »
--
-- Deux besoins dans une seule table :
--   1. PARLER au joueur. Jusqu'ici l'appli ne savait s'adresser qu'à TOUS les
--      joueurs à la fois (les nouveautés, écrites dans le build). Une ligne
--      ici, et l'enveloppe du menu a enfin un message pour une personne.
--   2. COMPTER. Un avertissement ne s'efface pas quand le joueur l'a lu :
--      `read_at` dit qu'il l'a vu, la LIGNE reste. C'est le cumul qui permet
--      de trancher au troisième.
--
-- La suspension disparaît des décisions offertes : elle coupait l'accès sans
-- rien expliquer à personne. Le bannissement reste, et se décide maintenant
-- sur un dossier — trois avertissements écrits — au lieu d'un coup de tête.
--
-- Le texte n'est PAS figé ici : il est écrit par le serveur au moment de
-- l'avertissement et stocké tel quel. Un message déjà envoyé ne doit pas
-- changer de sens parce qu'on a réécrit une constante six mois plus tard.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.player_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid references public.reports(id) on delete set null,
  message text not null,
  issued_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.player_warnings is
  'Avertissements de modération : le message lu par le joueur dans l''enveloppe, et le cumul qui fonde un bannissement.';

create index if not exists player_warnings_user_idx
  on public.player_warnings (user_id, created_at desc);

alter table public.player_warnings enable row level security;
revoke all on public.player_warnings from public, anon, authenticated;

-- Aucune politique RLS : la table ne se lit QUE par le service. Un joueur qui
-- interrogerait la table directement pourrait compter les avertissements des
-- autres — ce sont des données de modération, pas des données de jeu.

-- ─────────────────────────────────────────────────────────────────────────────
-- Poser un avertissement, et rendre le compte à jour dans la foulée : la
-- modération a besoin des deux, et deux allers-retours laisseraient une
-- fenêtre où le compte affiché serait déjà faux.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.server_warn_player(
  p_user uuid,
  p_report uuid,
  p_by uuid,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  total int;
begin
  insert into public.player_warnings(user_id, report_id, message, issued_by)
  values (p_user, p_report, p_message, p_by);

  select count(*) into total from public.player_warnings where user_id = p_user;
  return jsonb_build_object('avertissements', total);
end;
$$;

revoke all on function public.server_warn_player(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.server_warn_player(uuid, uuid, uuid, text) to service_role;

comment on function public.server_warn_player(uuid, uuid, uuid, text) is
  'Écrit un avertissement de modération et rend le nombre total accumulé par ce joueur.';

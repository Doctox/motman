-- ─────────────────────────────────────────────────────────────────────────────
-- LES LETTRES POSÉES, AU FIL DU TOUR (16/10/2026)
--
-- Partie classée du propriétaire, le 16/10 au soir : il pose ses lettres, en
-- ajoute une dans la dernière seconde, et son tour passe « comme s'il n'avait
-- rien joué ». Aucun coup reçu pour ce tour-là : à 00:00, son téléphone envoie
-- lui-même les lettres posées, et cet envoi n'est pas arrivé dans les 8 s que le
-- serveur lui laisse. Le tour a été compté manqué — et comme une ABSENCE, avec
-- « Je suis là » à la clé.
--
-- Désormais le téléphone envoie ses lettres AU FIL DU TOUR (action `draft` de
-- match-api). Si l'envoi final manque, c'est ce brouillon que le serveur joue,
-- au lieu d'un tour manqué (match-api/matchDrafts.ts). En temps LIMITÉ
-- seulement : en illimité, « 24 h sans jouer = abandon » reste la règle.
--
-- UNE TABLE À PART, ET PAS UN CHAMP DE `server_matches.state` : chaque écriture
-- de la partie change `updated_at`, réveille l'adversaire par le temps réel, et
-- ferait échouer en conflit le coup que le joueur envoie au même instant. Le
-- brouillon ne touche pas la partie.
--
-- PRIVÉE : ni l'adversaire ni le joueur ne la lisent. Seul match-api y écrit et
-- y lit, par la clé de service. Rien n'en sort vers le client, pas même la
-- justesse d'une lettre. Une ligne par joueur et par partie, remplacée à chaque
-- envoi ; elle part avec la partie (purge à 26 h) ou avec le compte.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.server_match_drafts (
  match_id uuid not null references public.server_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_number integer not null,
  -- Croissante dans le tour, posée par le téléphone : deux brouillons qui se
  -- croisent en route, l'ancien ne remplace jamais le récent.
  version bigint not null,
  placements jsonb not null default '[]'::jsonb,
  -- L'arrivée au serveur : un brouillon reçu après la fin du tour (plus la
  -- marge d'un coup envoyé à la main) ne compte pas.
  received_at timestamptz not null,
  primary key (match_id, user_id)
);

create index if not exists server_match_drafts_user_id_idx on public.server_match_drafts (user_id);

alter table public.server_match_drafts enable row level security;
revoke all on public.server_match_drafts from public, anon, authenticated;
grant all on public.server_match_drafts to service_role;

comment on table public.server_match_drafts is
  'Les lettres posées par le joueur dont c''est le tour, envoyées au fil du tour. Joué par match-api si l''envoi de fin de tour manque. Voir 20261016230000_les_lettres_posees_au_fil_du_tour.sql.';

-- Écrire un brouillon : un seul aller-retour, et jamais un plus ancien par-dessus
-- un plus récent (tour plus ancien, ou version plus basse dans le même tour).
create or replace function public.server_save_match_draft(
  p_match_id uuid,
  p_user_id uuid,
  p_turn_number integer,
  p_version bigint,
  p_placements jsonb,
  p_received_at timestamptz
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  insert into public.server_match_drafts as brouillon (match_id, user_id, turn_number, version, placements, received_at)
  values (p_match_id, p_user_id, p_turn_number, p_version, p_placements, p_received_at)
  on conflict (match_id, user_id) do update
    set turn_number = excluded.turn_number,
        version = excluded.version,
        placements = excluded.placements,
        received_at = excluded.received_at
    where excluded.turn_number > brouillon.turn_number
       or (excluded.turn_number = brouillon.turn_number and excluded.version > brouillon.version)
  returning true;
$$;

revoke all on function public.server_save_match_draft(uuid, uuid, integer, bigint, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.server_save_match_draft(uuid, uuid, integer, bigint, jsonb, timestamptz) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────
-- LES HEURES DES JOUEURS DE L'OMBRE (13/10/2026)
--
-- « Le but est de faire croire au joueur qu'il y a du monde sur le jeu. » Un
-- vrai joueur a ses habitudes : le midi, en fin d'après-midi, le soir… Une
-- ombre qui joue à toute heure, et toujours elle, se remarque.
--
-- Chaque ombre peut donc avoir ses HEURES (heures de Paris, 0 à 23). Le choix
-- de l'adversaire (match-api, `choisirAdversaire`) fait passer devant une ombre
-- « à son heure », mais sans jamais en priver le joueur : hors de ses heures,
-- elle vient quand même si personne d'autre ne le peut. Sans heures : à toute
-- heure, comme le fantôme du propriétaire.
--
-- Les heures de chacune ne se lisent PAS ici (le dépôt est public, un pseudo
-- dirait qui est une ombre) : elles sont dans l'atelier privé
-- (`supabase/prive/ombres_creation_20261013.sql`), collées par le propriétaire.
-- ─────────────────────────────────────────────────────────────────────────────────

alter table public.shadow_players add column if not exists heures smallint[];

alter table public.shadow_players drop constraint if exists shadow_players_heures_valides;
alter table public.shadow_players add constraint shadow_players_heures_valides
  check (heures is null or (0 <= all(heures) and 23 >= all(heures)));

comment on column public.shadow_players.heures is
  'Heures de Paris (0-23) où l''ombre joue de préférence ; null = à toute heure. Voir 20261013200000_les_heures_des_ombres.sql.';

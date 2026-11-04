-- ─────────────────────────────────────────────────────────────────────────────
-- L'ADVERSAIRE EN CHAÎNE S'ADAPTE À CHAQUE JOUEUR (04/11/2026).
--
-- Demande du propriétaire : l'adversaire automatique était trop fort pour lui et sa
-- famille, et une joueuse gagnait presque tout. Sa force suit donc les résultats de
-- chacun (src/botOpponents.ts).
--
-- POURQUOI ICI. Les parties s'effacent 26 h après leur dernière activité : un joueur qui
-- saute un jour perdrait sa force. L'historique, lui, garde chaque partie 90 jours, et sa
-- ligne est déjà écrite une fois par partie, sans doublon (`play_key`). Il lui manquait
-- seulement cette valeur. Rien à relire de plus : la dernière ligne qui la porte, et son
-- `outcome`, disent d'où repart le prochain adversaire.
--
-- Pas de nouvel index : `grid_player_history_user_recent_idx` (user_id, completed_at desc)
-- suffit. La table reste fermée aux joueurs : ni `authenticated` ni `anon` ne la lisent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.grid_player_history
  add column if not exists force_adversaire real
  check (force_adversaire is null or force_adversaire between 0 and 1);

comment on column public.grid_player_history.force_adversaire is
  'En chaîne contre l''adversaire automatique : sa force, de 0 à 1. Null pour toute autre partie.';

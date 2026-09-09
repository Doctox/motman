-- Classement du défi du jour — les trois colonnes qui manquaient.
--
-- CE QUI EXISTAIT DÉJÀ. `grid_player_history` retient le score, la durée,
-- l'issue et la grille de chaque partie. Tout le monde joue la MÊME grille au
-- défi du jour (`dailyGridIdFor`), donc la matière d'un classement était là.
-- Il manquait trois choses, et sans elles rien n'est classable :
--
--   daily_date   Rien ne distinguait une partie du défi d'une partie solo
--                ordinaire tombée par hasard sur la même grille. Classer sur
--                `grid_id` aurait mélangé les deux.
--
--   turns        La durée en secondes est enregistrée, mais elle mesure aussi
--                le temps de RÉFLEXION du joueur : un père interrompu par son
--                enfant dégringolerait au classement sans avoir moins bien
--                joué. Le nombre de tours, lui, ne dépend que du jeu.
--
--   daily_note   La note elle-même, écrite à la clôture.
--
-- POURQUOI LA NOTE EST STOCKÉE ET NON CALCULÉE EN SQL. La formule vit dans
-- `src/dailyScore.ts` et nulle part ailleurs. La réécrire ici en plpgsql en
-- ferait une seconde source de vérité — exactement ce qui a déjà mal tourné
-- sur cette base : le moteur de série du défi du jour existait en TypeScript
-- ET en plpgsql, les deux ont divergé en silence, et des joueurs ont atteint
-- des paliers sans jamais être payés. On ne recommence pas.
--
-- La contrepartie est assumée : changer l'exposant de la note demandera un
-- recalcul des lignes existantes. C'est un prix bien plus faible qu'une
-- divergence qu'on ne voit pas.
--
-- ⚠️ NE VAUT QUE POUR L'AVENIR. Les parties déjà jouées n'ont ni tours ni note
-- enregistrés, et rien ne permet de les reconstituer : `server_matches` est
-- purgé au bout de 26 heures. Le classement démarrera donc vide, et se
-- remplira au premier défi joué après le déploiement.

alter table public.grid_player_history
  add column if not exists daily_date date,
  add column if not exists turns smallint check (turns is null or turns >= 0),
  add column if not exists daily_note integer check (daily_note is null or daily_note >= 0);

comment on column public.grid_player_history.daily_date is
  'Jour (Europe/Paris) du defi quotidien auquel cette partie appartient. NULL pour toute autre partie.';
comment on column public.grid_player_history.turns is
  'Nombre de tours joues dans la partie. Sert la note du defi : contrairement a duration_seconds, il ne depend pas du temps de reflexion du joueur.';
comment on column public.grid_player_history.daily_note is
  'Note du defi du jour, calculee a la cloture par src/dailyScore.ts. JAMAIS recalculee en SQL : source unique.';

-- Le classement lit un jour entier, trié par note décroissante. Sans cet index
-- il ferait un parcours complet de la table, qui grossit d'une ligne par partie
-- et par joueur.
create index if not exists grid_player_history_daily_ranking_idx
  on public.grid_player_history (daily_date, daily_note desc, score desc, turns asc, completed_at asc)
  where daily_date is not null;

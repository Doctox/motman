-- Historique — le plateau final, pour pouvoir relire une partie terminée.
--
-- CE QUI MANQUAIT. `grid_player_history` ne gardait que des résumés : score,
-- adversaire, issue, durée. Le plateau, lui, vit dans `server_matches.state`,
-- que `private.purge_stale_matches()` efface au bout de 26 heures. Une partie
-- de la veille était donc déjà irrécupérable — d'où l'observation des testeurs
-- que les lignes d'historique « ne fournissent que des résumés » (suggestion
-- S-02, rapport 6766). Ce n'était pas un oubli d'interface : il n'y avait
-- littéralement plus rien à afficher.
--
-- POURQUOI PAS UNE IMAGE. L'idée d'origine était d'enregistrer une capture de
-- la grille. Mesuré sur une grille 7×8 pleine : ~40 à 80 Ko pour un PNG, 2 869
-- octets pour le plateau brut, 224 octets pour la forme compacte retenue (voir
-- `src/matchBoardSnapshot.ts`). Deux cents fois plus léger — et surtout, du
-- HTML se rend net à toutes les tailles, suit le thème clair/sombre, respecte
-- « Texte plus grand » et se laisse lire par un lecteur d'écran. Une image ne
-- fait aucun des quatre.
--
-- CE QU'ON N'ENREGISTRE PAS, ET C'EST LE POINT IMPORTANT. Uniquement les cases
-- RÉELLEMENT POSÉES, jamais la solution. Une partie perdue par expiration ne
-- révèle donc aucune réponse manquante, et la grille peut rester en rotation
-- (`server_grid_rotation_cooldowns`) sans qu'on ait livré ses mots. C'est ce
-- qui rend cette relecture possible sans ouvrir de brèche : `publicGrid`
-- continue de vider les solutions, et le client ne reçoit que la structure.
--
-- LA SUPPRESSION EST GRATUITE. La colonne appartient à la ligne : quand
-- `private.archive_old_grid_player_history` supprime la ligne de détail au bout
-- de 90 jours, le plateau part avec elle. Aucun ménage à écrire, aucun risque
-- d'orphelin — ce qui n'aurait pas été le cas d'un fichier dans un seau de
-- stockage, à faire vivre et mourir séparément.
--
-- ⚠️ NE VAUT QUE POUR L'AVENIR. Les parties déjà purgées ne peuvent pas être
-- reconstituées : leur plateau n'existe plus nulle part. L'historique existant
-- restera en résumés, et l'écran de relecture doit le supporter sans broncher.

alter table public.grid_player_history
  add column if not exists final_board jsonb;

comment on column public.grid_player_history.final_board is
  'Plateau final compact (voir src/matchBoardSnapshot.ts) : cases posees, lettres, et propriete vue par le joueur de cette ligne. Jamais la solution. NULL pour les parties anterieures a cette colonne.';

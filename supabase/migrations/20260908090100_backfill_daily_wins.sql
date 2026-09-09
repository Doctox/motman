-- Défi du jour — RATTRAPAGE des victoires quotidiennes antérieures à `daily_wins`.
--
-- CE QUI MANQUAIT. La migration 20260901090000 a créé `daily_wins` VIDE, et le
-- disait : « PAS DE RATTRAPAGE ». Conséquence pour tout joueur ayant joué avant
-- cette date — c'est-à-dire tous les bêta-testeurs : sa série repartait de zéro
-- côté serveur, et il devait réatteindre 7 jours pour toucher des 200 plumes
-- qu'il croyait déjà acquises. La note ajoutait « à faire tant que la bêta est
-- petite ». C'est maintenant.
--
-- LA MATIÈRE PREMIÈRE. Chaque première victoire du jour a laissé une trace
-- monétaire : une ligne d'`economy_transactions` de type `daily-completion`,
-- idempotente sur `daily:<user>:<date>`, dont le `metadata.dateKey` porte le jour
-- Europe/Paris. Une transaction = une première victoire = exactement la ligne
-- `daily_wins` qui aurait dû être écrite. La reconstitution est donc EXACTE, pas
-- approchée : on ne devine rien, on relit.
--
-- POURQUOI `match_id` SERA SOUVENT NULL. Les parties sont purgées 26 heures
-- après leur dernière activité (`private.purge_stale_matches`). Au moment
-- d'écrire ceci, 7 des 8 transactions concernées désignaient un match qui
-- n'existe plus : écrire l'identifiant tel quel violerait la clé étrangère et
-- ferait échouer la migration entière. La colonne est de toute façon
-- documentaire — la série se déduit des JOURS, pas des matchs.
--
-- AUCUN PALIER N'EST DÛ PAR CE RATTRAPAGE, vérifié en le rejouant dans une
-- transaction annulée avant de l'écrire : 8 lignes, 5 joueurs, jours étalés du
-- 16/08 au 02/09/2026, et la plus longue série reconstituée vaut 2 (les 30 et
-- 31 août d'un même joueur) — très loin du premier palier, à 7. Ne verse donc
-- aucune plume, et n'a pas à en verser. Si un palier devenait dû, il le serait
-- à la prochaine victoire quotidienne du joueur : `recordDailyWinAndMilestones`
-- (match-api) repasse tous les paliers en revue à chaque fois, et l'idempotence
-- `daily-milestone:<user>:<palier>` interdit le double versement.
--
-- REJOUABLE SANS DOMMAGE : `on conflict do nothing` sur la clé primaire
-- (user_id, day). Une victoire déjà enregistrée par le serveur garde sa ligne
-- d'origine — c'est elle qui fait foi.

insert into public.daily_wins (user_id, day, match_id, created_at)
select
  transaction.user_id,
  (transaction.metadata->>'dateKey')::date,
  -- Le match n'est repris QUE s'il existe encore ; la jointure externe met NULL
  -- pour tous les autres, ce que la colonne accepte.
  partie.id,
  transaction.created_at
from public.economy_transactions as transaction
left join public.server_matches as partie
  on transaction.metadata->>'matchId' ~ '^[0-9a-fA-F-]{36}$'
 and partie.id = (transaction.metadata->>'matchId')::uuid
where transaction.kind = 'daily-completion'
  -- Les toutes premières transactions n'avaient pas de `dateKey` exploitable ;
  -- le filtre de forme les écarte plutôt que de faire échouer la conversion.
  and transaction.metadata->>'dateKey' ~ '^\d{4}-\d{2}-\d{2}$'
on conflict (user_id, day) do nothing;

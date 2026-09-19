-- L'INTERFACE TUTOIE (décision du propriétaire, 19/09/2026). Deux titres,
-- envoyés par le serveur au panneau des titres, vouvoyaient encore. La valeur
-- de secours du client (src/progressionRewards.ts) dit déjà la même chose.
update public.server_title_catalog
set description = 'Les premières lettres de ton aventure.'
where id = 'premiers-mots' and description = 'Les premières lettres de votre aventure.';

update public.server_title_catalog
set description = 'Les mots peuvent compter sur toi.'
where id = 'gardien-des-mots' and description = 'Les mots peuvent compter sur vous.';

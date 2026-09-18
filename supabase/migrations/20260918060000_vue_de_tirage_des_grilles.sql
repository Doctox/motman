-- TIRER UNE GRILLE SANS LIRE TOUT LE CATALOGUE.
--
-- `chooseGrid` (match-api/matchSetup.ts) chargeait la charge utile ENTIÈRE des
-- grilles actives à chaque création de partie, pour n'en garder qu'une. Mesuré
-- le 17/09/2026, catalogue v30, 166 grilles actives :
--
--     stocké                          643 Ko
--     transféré à chaque partie     1 089 Ko
--     utile au tirage                  18 Ko
--
-- Le tirage n'a besoin que de l'identifiant, des réponses (pour le délai de
-- répétition des mots) et du drapeau du défi du jour, qui sort les grilles à
-- thème de la rotation. Tout le reste — définitions, coordonnées, et surtout
-- les images en `data:`, qui font 65 % du poids — traversait le réseau pour
-- être jeté aussitôt.
--
-- Cette vue sert cette projection. La grille RETENUE est ensuite chargée par
-- son identifiant, exactement comme le défi du jour le fait déjà
-- (`activeGridById`). Le coût par partie passe d'environ 1 089 Ko à 25 Ko.
--
-- Ce qui n'y touche pas : la relecture de partie et les images des définitions
-- passent par `matchView`, qui lit UNE grille par son identifiant ; l'export
-- d'administration (`grid-usage-api`) lit tout, mais n'est pas un chemin de
-- joueur.
--
-- La vue ne filtre PAS sur `active` : le tirage le fait, et une vue non filtrée
-- reste lisible pour un contrôle qui voudrait comparer actives et inactives.

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
  ) as words
from public.server_grid_catalog as catalogue;

comment on view public.server_grid_selection is
  'Projection légère du catalogue pour le tirage : identifiant, drapeau du défi du jour et réponses. Voir 20260918060000_vue_de_tirage_des_grilles.sql.';

-- Le rôle de service lit déjà `server_grid_catalog` ; la vue hérite des droits
-- de son propriétaire, on lui accorde donc la lecture explicitement.
grant select on public.server_grid_selection to service_role;

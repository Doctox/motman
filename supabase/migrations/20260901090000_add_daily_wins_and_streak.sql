-- Défi du jour — mémoire SERVEUR des victoires quotidiennes et calcul de la série.
--
-- POURQUOI CETTE TABLE. Jusqu'ici la série (streak), les gels et les paliers
-- franchis n'existaient QUE dans le `localStorage` du joueur
-- (`motman-daily-v1`). Trois conséquences, toutes constatées le 31/08/2026 :
--
--   1. La série mourait avec l'appareil. Réinstallation, vidage des données ou
--      changement de téléphone : retour à zéro. Pour une fonctionnalité dont
--      toute la valeur EST la série, c'est une perte irrattrapable.
--   2. Le serveur ne pouvait pas payer les paliers sans croire le client sur
--      parole — or éditer `localStorage` est à la portée de n'importe qui, et
--      annoncer « je suis à 365 jours » rapporterait 4 500 plumes.
--   3. En conséquence directe, AUCUN palier n'était versé : le code de
--      versement n'existait pas. Le joueur voyait « palier atteint » à l'écran
--      et ne recevait rien. Les 200 / 700 / 1 800 / 4 500 étaient annoncés dans
--      le jeu ET dans la fiche Play Store.
--
-- Le remède est une ligne par joueur et par jour gagné, écrite par le serveur au
-- moment où il verse déjà le bonus de 250 plumes. Tout le reste — série, gels,
-- éligibilité aux paliers — se REDÉDUIT de ces lignes. Rien à croire sur parole,
-- et la série survit à une réinstallation puisqu'elle appartient au compte.

create table if not exists public.daily_wins (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  match_id uuid references public.server_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

comment on table public.daily_wins is
  'Une ligne par joueur et par jour où le défi du jour a été GAGNÉ. Source de vérité de la série.';

-- Pas d'index supplémentaire : la clé primaire (user_id, day) sert déjà les
-- parcours ordonnés par jour pour un joueur, dans les deux sens. En ajouter un
-- ne ferait que renchérir les écritures.

-- Aucun accès depuis le client : la table n'est écrite et lue que par les edge
-- functions, via le `service_role`. Un joueur qui pourrait y insérer une ligne
-- s'inventerait une série — c'est exactement ce qu'on empêche ici.
--
-- CORRECTION DU 01/09/2026 : le `grant` ci-dessous ne restreint RIEN. Supabase
-- accorde déjà tous les droits au `service_role` sur toute nouvelle table du
-- schéma public ; ce grant s'y ajoute sans rien retirer. Vérifié après coup :
-- le rôle détient bien DELETE, UPDATE et TRUNCATE. Il est conservé pour dire
-- explicitement ce dont le serveur a besoin, mais il ne faut pas s'y fier comme
-- à une protection. La vraie protection d'une donnée irrécupérable est une
-- SAUVEGARDE (voir scripts/export_supabase_backup.ps1) — l'offre gratuite de
-- Supabase n'en fait aucune.
alter table public.daily_wins enable row level security;
revoke all on public.daily_wins from public, anon, authenticated;
grant select, insert on public.daily_wins to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Calcul de la série à partir des seules victoires enregistrées.
--
-- RÈGLE DES GELS — recopiée à l'identique de `advanceStreak` (src/dailyChallenge.ts)
-- pour que les deux moteurs ne divergent jamais :
--   • un gel couvre EXACTEMENT UN jour manqué, pas davantage. Un trou de deux
--     jours casse la série même avec deux gels en réserve. C'est plus strict que
--     ce qu'on pourrait croire naturel, mais c'est ce que le client applique et
--     ce que le joueur a toujours connu ;
--   • on gagne un gel en atteignant 7 puis 30, UNE SEULE FOIS par compte — d'où
--     la comparaison avec `v_best`, qui garantit qu'un joueur cassant sa série
--     puis remontant à 7 ne regagne pas de gel ;
--   • plafond de 2 gels détenus.
--
-- La fonction est déterministe et ne dépend que de `daily_wins` : deux appels le
-- même jour donnent le même résultat, et un joueur qui réinstalle retrouve
-- exactement sa série.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.server_daily_streak(
  p_user_id uuid,
  p_today date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day     date;
  v_prev    date := null;
  v_streak  integer := 0;
  v_best    integer := 0;
  v_freezes integer := 0;
  v_missed  integer;
begin
  for v_day in
    select day from public.daily_wins
    where user_id = p_user_id and day <= p_today
    order by day
  loop
    if v_prev is null then
      v_streak := 1;
    else
      v_missed := (v_day - v_prev) - 1;
      if v_missed = 0 then
        v_streak := v_streak + 1;
      elsif v_missed = 1 and v_freezes > 0 then
        v_freezes := v_freezes - 1;
        v_streak := v_streak + 1;
      else
        v_streak := 1;
      end if;
    end if;

    -- Gel gagné aux paliers 7 et 30, UNE SEULE FOIS par compte (d'où le test sur
    -- `v_best`, qui n'a pas encore intégré la série courante à ce point) et
    -- plafonné à 2 gels détenus.
    if (v_streak = 7 and v_best < 7) or (v_streak = 30 and v_best < 30) then
      v_freezes := least(2, v_freezes + 1);
    end if;

    v_best := greatest(v_best, v_streak);
    v_prev := v_day;
  end loop;

  -- La série est-elle encore vivante AUJOURD'HUI ? Les jours écoulés depuis la
  -- dernière victoire ne sont pas encore « payés » en gels : ils le seront à la
  -- prochaine victoire. Ici on regarde seulement si le joueur en a assez pour
  -- que sa série tienne encore.
  if v_prev is null then
    v_streak := 0;
  else
    v_missed := (p_today - v_prev) - 1;
    -- Même règle qu'au-dessus : un seul jour manqué, et seulement si un gel est
    -- disponible pour le couvrir à la prochaine victoire.
    if v_missed > 1 or (v_missed = 1 and v_freezes = 0) then
      v_streak := 0;
    end if;
  end if;

  return jsonb_build_object(
    'streak',   v_streak,
    'best',     v_best,
    'freezes',  v_freezes,
    'lastWin',  v_prev,
    'computedFor', p_today
  );
end;
$$;

revoke all on function public.server_daily_streak(uuid, date) from public, anon, authenticated;
grant execute on function public.server_daily_streak(uuid, date) to service_role;

comment on function public.server_daily_streak(uuid, date) is
  'Série du défi du jour recalculée depuis daily_wins. Un gel couvre un jour manqué ; gagnés aux paliers 7 et 30, plafond 2.';

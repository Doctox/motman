-- Défi du jour — le moteur SERVEUR rejoint le moteur CLIENT.
--
-- CE QUI N'ALLAIT PAS. La migration 20260901090000 affirmait avoir recopié la
-- règle des gels « à l'identique de `advanceStreak` ». Elle avait recopié les
-- gels, et OUBLIÉ la fenêtre de récupération — un mécanisme entier de
-- `src/dailyChallenge.ts` : regagner le LENDEMAIN du jour où la série s'est
-- cassée ne redémarre pas à 1, mais restaure l'ancienne série augmentée de deux
-- (`previousStreak + 2`, le « pont »).
--
-- Conséquence directe, et c'est exactement le défaut que `daily_wins` devait
-- éliminer : un joueur remonté à 30 jours par le pont voyait « palier atteint »
-- à l'écran, et le serveur — qui comptait 12 — ne lui versait rien. L'écart
-- entre ce que le jeu annonce et ce qu'il paie était simplement revenu par la
-- porte de derrière.
--
-- DEUXIÈME DÉFAUT, conséquence du premier. Le gel de palier était crédité sur
-- `v_streak = 7` et `v_streak = 30`, une ÉGALITÉ. Le pont fait sauter des
-- valeurs : une série qui passe de 1 à 8 d'un coup ne vaut jamais 7, et le gel
-- n'était jamais crédité. `advanceStreak` teste `streak >= palier`, pas
-- l'égalité. Corrigé ici de même.
--
-- CE QUI CHANGE DE FORME. Le calcul est extrait dans une fonction PURE,
-- `private.daily_streak_from_days`, qui ne lit aucune table : on lui donne une
-- liste de jours, elle rend la série. `public.server_daily_streak` n'est plus
-- qu'une enveloppe qui va chercher les jours dans `daily_wins`.
--
-- Ce n'est pas de l'élégance : c'est ce qui rend le moteur SQL TESTABLE. Les
-- douze cas de `src/data/dailyStreakScenarios.json` passent maintenant dans les
-- deux moteurs — `src/dailyStreakScenarios.test.ts` pour le TypeScript,
-- `npm run test:streak` pour celui-ci —, et sans écrire une seule ligne dans
-- `daily_wins`, donc sans risque sur la base de production.
--
-- ⚠️ CE QUI RESTE DUPLIQUÉ. Les seuils à gel (7 et 30) sont écrits ici en dur ;
-- le barème vit dans `src/dailyMilestones.ts`, qu'aucun moteur SQL ne peut
-- importer. C'est le banc d'essai commun qui tient les deux bouts : changer les
-- seuils côté TypeScript sans les changer ici fait rougir `npm run test:streak`.

-- ─────────────────────────────────────────────────────────────────────────────
-- Le moteur, PUR. Port ligne à ligne de `advanceStreak` (src/dailyChallenge.ts).
-- Toute correction ici doit être reportée là-bas, et réciproquement — et le banc
-- d'essai commun est là pour que l'oubli se voie.
--
--   • une victoire le lendemain (écart 1) prolonge la série ;
--   • un gel couvre EXACTEMENT un jour manqué (écart 2), pas davantage ; il est
--     alors consommé, et la fenêtre de récupération est désarmée ;
--   • au-delà, la série retombe à 1 et ARME la fenêtre de récupération sur ce
--     jour-là ;
--   • fenêtre de récupération : gagner le lendemain d'un jour de rupture rend
--     `série d'avant + 2` (le run précédent, le jour de rupture, et celui-ci) ;
--   • un gel est gagné en ATTEIGNANT 7 puis 30, une seule fois par compte (d'où
--     la comparaison avec `v_best`, qui n'a pas encore intégré la série
--     courante), plafond de 2 gels détenus.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function private.daily_streak_from_days(
  p_days date[],
  p_today date
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_jours    date[];
  v_jour     date;
  v_veille   date := null;
  v_ecart    integer;
  v_serie    integer := 0;
  v_best     integer := 0;
  v_gels     integer := 0;
  -- Fenêtre de récupération : la série d'avant la rupture, et le jour où elle a
  -- cassé. Le pont ne joue que si la victoire suivante tombe le lendemain PILE
  -- de ce jour-là.
  v_repli    integer := null;
  v_repli_le date := null;
  v_vivante  integer;
begin
  -- Tri et dédoublonnage en entrée : la boucle raisonne sur des écarts, elle
  -- suppose donc des jours strictement croissants. `advanceStreak` traite un
  -- jour déjà gagné comme sans effet (`daysBetween(last, day) <= 0`) — ici c'est
  -- le `distinct` qui s'en charge, et l'enveloppe lit de toute façon une table
  -- dont la clé primaire interdit le doublon.
  select coalesce(array_agg(distinct j order by j), '{}'::date[])
    into v_jours
    from unnest(coalesce(p_days, '{}'::date[])) as j;

  foreach v_jour in array v_jours
  loop
    if v_veille is null then
      v_serie := 1;
    else
      v_ecart := v_jour - v_veille;
      if v_ecart = 1 and v_repli_le is not null and v_repli_le = v_veille then
        -- Le pont : run d'avant + jour de rupture + celui-ci.
        v_serie := v_repli + 2;
        v_repli := null;
        v_repli_le := null;
      elsif v_ecart = 1 then
        v_serie := v_serie + 1;
      elsif v_ecart = 2 and v_gels > 0 then
        v_gels := v_gels - 1;
        v_serie := v_serie + 1;
        v_repli := null;
        v_repli_le := null;
      else
        v_repli := v_serie;
        v_repli_le := v_jour;
        v_serie := 1;
      end if;
    end if;

    -- `>=` et non `=` : le pont fait SAUTER des valeurs. Une série qui passe de
    -- 1 à 8 ne vaut jamais 7, et un test d'égalité ne créditerait jamais le gel.
    if v_serie >= 7 and v_best < 7 then
      v_gels := least(2, v_gels + 1);
    end if;
    if v_serie >= 30 and v_best < 30 then
      v_gels := least(2, v_gels + 1);
    end if;

    v_best := greatest(v_best, v_serie);
    v_veille := v_jour;
  end loop;

  -- La série est-elle encore vivante AUJOURD'HUI ? Les jours écoulés depuis la
  -- dernière victoire ne sont pas encore « payés » en gels : ils le seront à la
  -- prochaine victoire. Ici on regarde seulement si le joueur en a assez pour
  -- que sa série tienne encore. Un zéro n'est pas définitif : la fenêtre de
  -- récupération peut encore la relever demain.
  if v_veille is null then
    v_vivante := 0;
  else
    v_ecart := (p_today - v_veille) - 1;
    if v_ecart > 1 or (v_ecart = 1 and v_gels = 0) then
      v_vivante := 0;
    else
      v_vivante := v_serie;
    end if;
  end if;

  return jsonb_build_object(
    'streak',          v_vivante,
    -- Série AU MOMENT de la dernière victoire, avant le test de survie. C'est
    -- elle qui se compare au moteur TypeScript, lequel ne calcule rien tant
    -- qu'aucune partie n'est gagnée.
    'streakAtLastWin', case when v_veille is null then 0 else v_serie end,
    'best',            v_best,
    'freezes',         v_gels,
    'lastWin',         v_veille,
    'computedFor',     p_today
  );
end;
$$;

comment on function private.daily_streak_from_days(date[], date) is
  'Moteur PUR de série du défi du jour. Port de advanceStreak (src/dailyChallenge.ts), fenêtre de récupération comprise. Banc d''essai : src/data/dailyStreakScenarios.json.';

revoke all on function private.daily_streak_from_days(date[], date) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- L'enveloppe : elle ne fait plus que lire les jours et déléguer.
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
  v_jours date[];
begin
  select coalesce(array_agg(day order by day), '{}'::date[])
    into v_jours
    from public.daily_wins
    where user_id = p_user_id and day <= p_today;

  return private.daily_streak_from_days(v_jours, p_today);
end;
$$;

revoke all on function public.server_daily_streak(uuid, date) from public, anon, authenticated;
grant execute on function public.server_daily_streak(uuid, date) to service_role;

comment on function public.server_daily_streak(uuid, date) is
  'Série du défi du jour recalculée depuis daily_wins. Enveloppe de private.daily_streak_from_days, qui porte la règle.';

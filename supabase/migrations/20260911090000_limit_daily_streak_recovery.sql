-- Série du défi du jour — le rattrapage ne franchit plus qu'UN jour manqué.
--
-- LE DÉFAUT. La fenêtre de récupération (« regagner le lendemain d'une rupture
-- rend la série d'avant + 2 ») ne regardait pas la LONGUEUR de la rupture. Un
-- joueur absent neuf jours retrouvait sa série d'avant en gagnant deux jours de
-- suite, comme s'il n'était jamais parti. Constaté en production le 2026-09-11 :
-- victoires les 29/08, 01/09, 10/09 et 11/09, série affichée 3 au lieu de 2.
-- Et comme la série commande des paliers PAYÉS en plumes, une série de 29 jours
-- suivie de trois semaines d'absence pouvait toucher le palier 30.
--
-- LA RÈGLE. Le pont n'est offert que si la rupture tient à UN SEUL jour manqué
-- (écart de 2) — exactement le cas qu'un gel aurait couvert, pour le joueur qui
-- n'en avait pas. Au-delà, la série repart de 1 sans mémoire.
--
-- ⚠️ JUMEAU TYPESCRIPT : `advanceStreak`, dans `src/dailyChallenge.ts`. Les deux
-- sont tenus par `src/data/dailyStreakScenarios.json`, lu par vitest ET par
-- `npm run test:rules`. Toute correction de l'un se reporte sur l'autre.
--
-- `set search_path = ''` est REDÉCLARÉ : `create or replace` remplace aussi les
-- réglages de la fonction, et perdrait sans ça celui que
-- `harden_daily_streak_search_path` avait posé.
--
-- Rien à rattraper après coup : `server_daily_streak` recalcule la série depuis
-- `daily_wins` à chaque lecture, elle est donc juste dès l'application. Les
-- paliers déjà versés restent versés.

create or replace function private.daily_streak_from_days(
  p_days date[],
  p_today date
)
returns jsonb
language plpgsql
immutable
set search_path = ''
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
  -- de ce jour-là, et seulement si la rupture ne tenait qu'à un jour manqué.
  v_repli    integer := null;
  v_repli_le date := null;
  v_vivante  integer;
begin
  -- Tri et dédoublonnage en entrée : la boucle raisonne sur des écarts, elle
  -- suppose donc des jours strictement croissants.
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
        -- Le pont ne s'ouvre que sur UN jour manqué (écart de 2, sans gel pour
        -- le couvrir). Après une vraie absence, la série repart sans mémoire.
        if v_ecart = 2 then
          v_repli := v_serie;
          v_repli_le := v_jour;
        else
          v_repli := null;
          v_repli_le := null;
        end if;
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
  -- prochaine victoire. Un zéro n'est pas définitif : la fenêtre de
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
    'streakAtLastWin', case when v_veille is null then 0 else v_serie end,
    'best',            v_best,
    'freezes',         v_gels,
    'lastWin',         v_veille,
    'computedFor',     p_today
  );
end;
$$;

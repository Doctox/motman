-- ─────────────────────────────────────────────────────────────────────────────
-- LE POULS COMPTE LES AUTRES, PAS LE PROPRIÉTAIRE (20/09/2026)
--
-- « Est-ce que tu peux me laisser dans le cadre le nombre de joueurs actuel
-- (sans me compter) ? » Deux heures après la première version, et il a raison :
-- il regarde ce compteur DEPUIS l'appli, donc il y est toujours compté. « 2 en
-- ligne » voulait dire « lui, et une autre personne » — le chiffre qui
-- l'intéresse est le second.
--
-- L'exclusion vaut pour TOUT le tableau, pas seulement pour « en ligne » : un
-- cadre qui dirait « 1 en ligne » puis « 8 joueurs aujourd'hui, dont toi »
-- mélangerait deux comptes différents. Ses propres parties et ses propres
-- défis sortent aussi du calcul : il teste le jeu plusieurs fois par jour, et
-- ce qu'il veut lire ici, c'est SON AUDIENCE, pas son activité.
--
-- `is distinct from` plutôt que `<>` : si l'identifiant manquait, `<>` rendrait
-- NULL et le compteur tomberait à zéro — un tableau de bord vide qui ment.
--
-- Au passage, un défaut de la première version : `ranked_rating_events` porte
-- UNE LIGNE PAR JOUEUR, donc deux par partie classée. Le compteur annonçait le
-- double. Invisible jusqu'ici — il n'y a eu aucune partie classée — mais il
-- aurait menti au premier duel.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.server_game_pulse();

create or replace function public.server_game_pulse(p_moi uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with bornes as (
    select
      (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') as debut_du_jour,
      pg_catalog.now() - interval '75 seconds' as seuil_en_ligne,
      pg_catalog.now() - interval '7 days' as seuil_semaine,
      pg_catalog.to_char(pg_catalog.now() at time zone 'Europe/Paris', 'YYYY-MM-DD') as jour,
      (pg_catalog.now() at time zone 'Europe/Paris')::date as jour_date
  ),
  -- Ses parties à lui, écartées d'un bloc : il joue pour tester, et ça
  -- gonflerait le seul chiffre qu'il regarde.
  miennes as (
    select mp.match_id
    from public.match_participants mp
    where mp.user_id = p_moi
  )
  select jsonb_build_object(
    'jour', (select jour from bornes),
    'enLigne', (select count(*) from public.profiles, bornes
                where last_seen > seuil_en_ligne and id is distinct from p_moi),
    'actifsDuJour', (select count(*) from public.profiles, bornes
                     where last_seen >= debut_du_jour and id is distinct from p_moi),
    'actifsSeptJours', (select count(*) from public.profiles, bornes
                        where last_seen >= seuil_semaine and id is distinct from p_moi),
    'nouveauxDuJour', (select count(*) from public.profiles, bornes
                       where created_at >= debut_du_jour and id is distinct from p_moi),
    'comptes', (select count(*) from public.profiles
                where account_kind = 'account' and id is distinct from p_moi),
    'partiesDuJour', (select count(*) from public.server_matches m, bornes
                      where m.created_at >= debut_du_jour
                        and not exists (select 1 from miennes where miennes.match_id = m.id)),
    -- `daily_plays.day` est une DATE : la comparer au texte du jour échoue.
    'defisDuJour', (select count(*) from public.daily_plays, bornes
                    where day = jour_date and user_id is distinct from p_moi),
    -- Une ligne par JOUEUR : sans `distinct`, chaque duel comptait double. Et
    -- l'exclusion porte sur la PARTIE, pas sur la ligne : écarter la sienne en
    -- gardant celle de son adversaire aurait laissé le duel dans le compte.
    'classeesSeptJours', (select count(distinct e.match_id) from public.ranked_rating_events e, bornes
                          where e.created_at >= seuil_semaine
                            and not exists (select 1 from miennes where miennes.match_id = e.match_id))
  );
$$;

revoke all on function public.server_game_pulse(uuid) from public, anon, authenticated;
grant execute on function public.server_game_pulse(uuid) to service_role;

comment on function public.server_game_pulse(uuid) is
  'Nombres d''audience du jour (Europe/Paris) pour le propriétaire, LUI EXCLU : aucun pseudo, aucune donnée identifiante.';

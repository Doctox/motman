-- ─────────────────────────────────────────────────────────────────────────────
-- LE POULS ANNONCE LES SIGNALEMENTS À TRAITER (21/09/2026)
--
-- Défaut de conception relevé par le propriétaire : « si je fais un signalement
-- d'un joueur il va où ? j'ai signalé ma femme hier, j'ai aucun retour. »
--
-- Le signalement partait bien — en base, puis en alerte sur une issue GitHub.
-- Mais cette issue, il ne l'ouvre jamais : le canal ne coûtait rien à mettre en
-- place, et ne servait à rien. Le sien a attendu quatorze heures sans que
-- personne le sache.
--
-- Le compteur voyage donc avec le pouls, la carte qu'il ouvre depuis son
-- accueil. Une requête de plus aurait voulu dire un aller-retour de plus à
-- chaque ouverture de l'appli, pour un nombre qui vaut zéro la plupart du
-- temps : il tient dans celle qui part déjà.
--
-- Il compte TOUS les signalements ouverts, y compris ceux du propriétaire :
-- ici, `p_moi` sert à mesurer l'audience, pas à filtrer la modération — un
-- signalement qu'il a déposé lui-même reste un signalement à traiter.
-- ─────────────────────────────────────────────────────────────────────────────

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
                            and not exists (select 1 from miennes where miennes.match_id = e.match_id)),
    -- Le seul nombre qui appelle une ACTION, et le seul compté sans exclusion.
    'signalementsOuverts', (select count(*) from public.reports where status = 'open'),
    'signalementPlusAncienHeures', (
      select coalesce(floor(extract(epoch from pg_catalog.now() - min(created_at)) / 3600)::int, 0)
      from public.reports where status = 'open')
  );
$$;

comment on function public.server_game_pulse(uuid) is
  'Nombres d''audience du jour (Europe/Paris) pour le propriétaire, LUI EXCLU — plus les signalements ouverts, comptés sans exclusion.';

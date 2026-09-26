-- ─────────────────────────────────────────────────────────────────────────────
-- UNE ARRIVÉE RÉVEILLE LES AMIS (26/09/2026)
--
-- « Je ne vois pas les gens qui se connectent en temps réel. » Il avait raison,
-- et la cause est nette.
--
-- Depuis le 18/09, un déclencheur prévient les amis quand `profiles.activity`
-- CHANGE. Mais rien n'écrit jamais « hors ligne » : l'absence se déduit de
-- `last_seen`. Quelqu'un qui revient réécrit donc `online` par-dessus `online`
-- — aucun changement, aucun réveil. Le déclencheur ne partait que pour les
-- joueurs restés coincés sur `playing`, c'est-à-dire ceux qui avaient fermé
-- l'appli EN PARTIE.
--
-- Mesuré en production le 26/09, à un instant où personne ne jouait : 85 profils
-- tous hors ligne, dont 70 marqués `online` et 15 `playing`. Autrement dit
-- l'arrivée de 82 % des joueurs ne prévenait personne, et leurs amis ne la
-- voyaient qu'au sondage suivant.
--
-- `server_presence_touch` sait déjà reconnaître une arrivée : elle a été écrite
-- le 23/09 pour l'alerte du propriétaire. Elle sert maintenant aux deux, et la
-- boucle sur les amis vit dans UNE fonction que le déclencheur d'activité et le
-- battement appellent tous les deux.
--
-- Le coût est nul sur le chemin chaud : la boucle ne tourne qu'à une arrivée,
-- jamais aux battements des 25 secondes.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.reveiller_les_amis(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ami uuid;
begin
  if p_user is null then
    return;
  end if;
  for ami in
    select case when amitie.left_user_id = p_user then amitie.right_user_id else amitie.left_user_id end
    from public.friendships as amitie
    where amitie.left_user_id = p_user or amitie.right_user_id = p_user
  loop
    perform private.broadcast_user_menu_wakeup(ami, 'social');
  end loop;
end;
$$;

revoke all on function private.reveiller_les_amis(uuid) from public, anon, authenticated;

comment on function private.reveiller_les_amis(uuid) is
  'Pousse un réveil « social » à tous les amis d''un joueur : sa présence vient de changer.';

-- Le déclencheur d'activité (en ligne ↔ en jeu) passe par la même boucle.
create or replace function private.broadcast_presence_menu_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reveiller_les_amis(new.id);
  return null;
end;
$$;

revoke all on function private.broadcast_presence_menu_wakeup()
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Le battement de présence, qui prévient désormais les amis à l'arrivée.
--
-- L'ARRIVÉE SE CALCULE À PART DU SILENCE. Jusqu'ici la détection était noyée
-- dans la condition de l'alerte du propriétaire : pendant ses heures calmes,
-- `p_alertable` valait faux et l'arrivée n'existait plus du tout. Les amis
-- n'auraient donc rien reçu de minuit à 10 h. Les deux décisions sont séparées.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.server_presence_touch(
  p_user uuid,
  p_activity text,
  p_alertable boolean,
  p_absence_seconds int,
  p_en_ligne_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  arrivee boolean;
  etait_admin boolean;
  en_ligne int;
begin
  with avant as (
    select profil.id, profil.last_seen, profil.role
    from public.profiles as profil
    where profil.id = p_user
  ),
  maj as (
    update public.profiles as profil
    set activity = case when p_activity = 'playing' then 'playing' else 'online' end,
        last_seen = pg_catalog.now()
    from avant
    where profil.id = avant.id
    returning
      (avant.last_seen is null
       or avant.last_seen < pg_catalog.now() - pg_catalog.make_interval(secs => p_absence_seconds)) as arrivee,
      (avant.role = 'admin') as etait_admin
  )
  select maj.arrivee, maj.etait_admin into arrivee, etait_admin from maj;

  if not coalesce(arrivee, false) then
    return pg_catalog.jsonb_build_object('alerte', false);
  end if;

  -- Ses amis d'abord : c'est la raison d'être de ce changement, et elle ne
  -- dépend ni du rôle ni de l'heure.
  perform private.reveiller_les_amis(p_user);

  -- L'alerte du propriétaire, elle, se tait la nuit et ne s'annonce pas à
  -- lui-même.
  if not p_alertable or coalesce(etait_admin, false) then
    return pg_catalog.jsonb_build_object('alerte', false);
  end if;

  -- Le nombre n'est compté que pour la notification qui part : sur la route la
  -- plus chaude du jeu, un count() à chaque battement serait payé pour rien.
  --
  -- Le propriétaire ne s'y compte pas, comme dans le pouls du jeu (« toi non
  -- compté ») : le même nombre doit vouloir dire la même chose sur les deux
  -- écrans, sinon sa notification et sa carte se contrediraient.
  select pg_catalog.count(*) into en_ligne
  from public.profiles
  where last_seen > pg_catalog.now() - pg_catalog.make_interval(secs => p_en_ligne_seconds)
    and role <> 'admin';

  return pg_catalog.jsonb_build_object('alerte', true, 'enLigne', en_ligne);
end;
$$;

revoke all on function public.server_presence_touch(uuid, text, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.server_presence_touch(uuid, text, boolean, int, int) to service_role;

comment on function public.server_presence_touch(uuid, text, boolean, int, int) is
  'Battement de présence : réveille les amis à l''arrivée, et signale celle-ci au propriétaire hors heures calmes.';

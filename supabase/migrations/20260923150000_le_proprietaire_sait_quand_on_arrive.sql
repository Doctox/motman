-- ─────────────────────────────────────────────────────────────────────────────
-- LE PROPRIÉTAIRE SAIT QUAND UN JOUEUR ARRIVE (23/09/2026)
--
-- « Est-ce que mon compte admin peut me notifier quand y a quelqu'un qui se co
-- à MotMan ? » — oui, mais il n'existe aucun événement de connexion à écouter.
-- Une appli ouverte réécrit `last_seen` toutes les 25 secondes ; « hors ligne »
-- ne s'écrit nulle part, il se déduit d'un battement qui manque. Une arrivée,
-- c'est donc un battement qui arrive APRÈS UN TROU.
--
-- CE QUE CETTE FONCTION AJOUTE au simple `update` qu'elle remplace : elle dit,
-- au passage, si ce battement-ci est une arrivée. Elle ne décide RIEN toute
-- seule — la durée du trou et l'autorisation d'alerter lui sont données en
-- paramètres par `_shared/ownerAlertPolicy.ts`. Une règle écrite deux fois
-- finit par diverger ; celle-ci n'existe qu'en TypeScript.
--
-- AUCUN PLAFOND, tranché par le propriétaire le jour même : « je m'en fous du
-- plafond, même s'il se co 15 fois je veux le savoir, donc fais vibrer. » Le
-- seuil d'absence est donc celui du jeu — les 75 secondes qui font déjà passer
-- un joueur « hors ligne » aux yeux de ses amis — et chaque retour en ligne
-- part en notification.
--
-- POURQUOI UNE SEULE INSTRUCTION. Lire `last_seen`, décider, puis écrire, ce
-- sont trois temps pendant lesquels un second battement peut passer : deux
-- notifications pour une arrivée. Ici, la CTE `avant` retient l'ANCIEN
-- `last_seen` et l'`update` écrit le nouveau, dans le même verrou. La décision
-- se lit donc sur la valeur d'avant, jamais sur l'horloge : `now()` vaut
-- l'ouverture de la TRANSACTION, et une version antérieure de cette fonction
-- s'y était fait piéger — la suite SQL l'a attrapée au deuxième battement.
--
-- LE PROPRIÉTAIRE N'EST PAS ANNONCÉ À LUI-MÊME : il lit ce jeu depuis l'appli,
-- il déclencherait sa propre notification à chaque ouverture.
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
  alerte boolean;
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
    returning (
      p_alertable
      and avant.role <> 'admin'
      and (avant.last_seen is null
           or avant.last_seen < pg_catalog.now() - pg_catalog.make_interval(secs => p_absence_seconds))
    ) as arrivee
  )
  select maj.arrivee into alerte from maj;

  if not coalesce(alerte, false) then
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
  'Battement de présence, et signal d''arrivée pour le propriétaire : un seul verrou, aucun pseudo.';

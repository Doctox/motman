-- ─────────────────────────────────────────────────────────────────────────────
-- LE PROPRIÉTAIRE SAIT QUAND UN JOUEUR ARRIVE (23/09/2026)
--
-- « Est-ce que mon compte admin peut me notifier quand y a quelqu'un qui se co
-- à MotMan ? » — oui, mais il n'existe aucun événement de connexion à écouter.
-- Une appli ouverte réécrit `last_seen` toutes les 25 secondes ; « hors ligne »
-- ne s'écrit nulle part, il se déduit d'un battement qui manque. Une arrivée,
-- c'est donc un battement qui arrive APRÈS UN TROU.
--
-- CE QUE CETTE FONCTION AJOUTE au simple `update` qu'elle remplace : elle sait
-- dire, au passage, si ce battement-ci est une arrivée à signaler. Elle ne
-- décide RIEN toute seule — la durée du trou et l'autorisation d'alerter lui
-- sont données en paramètres par `_shared/ownerAlertPolicy.ts`. Une règle
-- écrite deux fois finit par diverger ; celle-ci n'existe qu'en TypeScript.
--
-- POURQUOI UNE SEULE INSTRUCTION. Lire `last_seen`, décider, puis écrire, ce
-- sont trois temps pendant lesquels un second battement peut passer : deux
-- notifications pour une arrivée. Ici, l'`update` lit l'ancienne ligne et pose
-- le drapeau dans le même verrou.
--
-- Et il dit s'il vient de le poser en COMPARANT À L'ANCIENNE VALEUR, jamais à
-- l'horloge. La première écriture de cette fonction testait
-- `owner_alert_at = now()` : `now()` vaut l'ouverture de la TRANSACTION, pas
-- l'instant présent, si bien qu'un drapeau posé plus tôt dans la même
-- transaction se relisait comme fraîchement posé. La suite SQL a attrapé le
-- défaut au deuxième battement.
--
-- LE PLAFOND EST DANS LA COLONNE. `owner_alert_at` retient la dernière alerte
-- envoyée pour ce joueur : tant qu'elle date d'aujourd'hui (journée de Paris,
-- comme le défi du jour et comme le pouls), aucune autre ne part. Un joueur qui
-- ouvre l'appli quinze fois dans la journée ne fait vibrer qu'une fois.
--
-- LE PROPRIÉTAIRE N'EST PAS ANNONCÉ À LUI-MÊME : il lit ce jeu depuis l'appli,
-- il déclencherait sa propre notification à chaque ouverture.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists owner_alert_at timestamptz;

comment on column public.profiles.owner_alert_at is
  'Dernière alerte d''arrivée envoyée au propriétaire pour ce joueur ; sert de plafond journalier.';

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
    select profil.id, profil.owner_alert_at
    from public.profiles as profil
    where profil.id = p_user
  ),
  maj as (
    update public.profiles as profil
    set activity = case when p_activity = 'playing' then 'playing' else 'online' end,
        last_seen = pg_catalog.now(),
        owner_alert_at = case
          when p_alertable
           and profil.role <> 'admin'
           and (profil.last_seen is null
                or profil.last_seen < pg_catalog.now() - pg_catalog.make_interval(secs => p_absence_seconds))
           and (profil.owner_alert_at is null
                or profil.owner_alert_at < (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'))
          then pg_catalog.now()
          else profil.owner_alert_at
        end
    from avant
    where profil.id = avant.id
    returning (profil.owner_alert_at is distinct from avant.owner_alert_at) as posee
  )
  select maj.posee into alerte from maj;

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

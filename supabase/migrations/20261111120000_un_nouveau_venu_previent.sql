-- ─────────────────────────────────────────────────────────────────────────────
-- UN NOUVEAU VENU PRÉVIENT LE PROPRIÉTAIRE (11/11/2026)
--
-- « Pourquoi je reçois pas les notifs quand y a un invité ? Quand c'est des
-- comptes je reçois. » Ce n'était pas une affaire d'invité, mais de PREMIÈRE
-- ouverture.
--
-- Une arrivée est un battement qui suit un trou de plus de 75 s (voir
-- 20260923150000). Or un profil naît avec `last_seen = now()` (valeur par
-- défaut de la colonne) : son premier battement, quelques secondes plus tard,
-- ne suit aucun trou. Le tout premier passage d'un joueur n'alertait donc
-- jamais. Les comptes qui sonnaient étaient des joueurs qui REVENAIENT ; les
-- invités, eux, ne viennent presque toujours qu'une fois. Mesuré le 11/11 : les
-- 12 invités arrivés depuis le 03/11 sont tous repartis le jour même, aucun
-- n'a donc jamais sonné.
--
-- LE REPÈRE : un profil qui n'a jamais battu garde `last_seen` égal à
-- `created_at`, les deux colonnes prenant `now()` dans la même insertion. Son
-- premier battement est une arrivée, signalée comme NOUVELLE pour que le
-- propriétaire la distingue d'un retour (« Nouveau : Lina arrive »).
--
-- LE BATTEMENT S'ÉCRIT DÉSORMAIS À `clock_timestamp()`. Avec `now()`, l'heure du
-- début de la transaction, un profil créé et touché dans la même transaction
-- (les bancs d'essai) garderait `last_seen = created_at` après son battement, et
-- chaque battement suivant passerait pour un premier. En production, chaque
-- battement est sa propre transaction : la différence est de quelques
-- microsecondes, et rien ne compare `last_seen` à mieux que la seconde.
--
-- Le reste ne change pas : réveil des amis à chaque arrivée, silence de minuit
-- à 10 h, le propriétaire ne se signale pas lui-même.
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
  nouveau boolean;
  etait_admin boolean;
  en_ligne int;
begin
  with avant as (
    select profil.id, profil.last_seen, profil.created_at, profil.role
    from public.profiles as profil
    where profil.id = p_user
  ),
  maj as (
    update public.profiles as profil
    set activity = case when p_activity = 'playing' then 'playing' else 'online' end,
        last_seen = pg_catalog.clock_timestamp()
    from avant
    where profil.id = avant.id
    returning
      (avant.last_seen is null
       or avant.last_seen <= avant.created_at
       or avant.last_seen < pg_catalog.now() - pg_catalog.make_interval(secs => p_absence_seconds)) as arrivee,
      -- Jamais battu : c'est sa toute première ouverture.
      (avant.last_seen is null or avant.last_seen <= avant.created_at) as nouveau,
      (avant.role = 'admin') as etait_admin
  )
  select maj.arrivee, maj.nouveau, maj.etait_admin into arrivee, nouveau, etait_admin from maj;

  if not coalesce(arrivee, false) then
    return pg_catalog.jsonb_build_object('alerte', false);
  end if;

  -- Ses amis d'abord : la raison d'être de 20260926160000, qui ne dépend ni du
  -- rôle ni de l'heure.
  perform private.reveiller_les_amis(p_user);

  -- L'alerte du propriétaire, elle, se tait la nuit et ne s'annonce pas à
  -- lui-même.
  if not p_alertable or coalesce(etait_admin, false) then
    return pg_catalog.jsonb_build_object('alerte', false);
  end if;

  -- Le propriétaire ne se compte pas dans le nombre en ligne, comme dans le
  -- pouls du jeu : le même nombre doit dire la même chose sur les deux écrans.
  select pg_catalog.count(*) into en_ligne
  from public.profiles
  where last_seen > pg_catalog.now() - pg_catalog.make_interval(secs => p_en_ligne_seconds)
    and role <> 'admin';

  return pg_catalog.jsonb_build_object('alerte', true, 'enLigne', en_ligne, 'nouveau', coalesce(nouveau, false));
end;
$$;

revoke all on function public.server_presence_touch(uuid, text, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.server_presence_touch(uuid, text, boolean, int, int) to service_role;

comment on function public.server_presence_touch(uuid, text, boolean, int, int) is
  'Battement de présence : réveille les amis à l''arrivée, et la signale au propriétaire hors heures calmes, en marquant la toute première ouverture d''un joueur.';

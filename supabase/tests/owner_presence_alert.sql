-- Le propriétaire sait quand un joueur arrive (migration 20260923150000).
--
-- Il n'existe aucun événement de connexion : une arrivée, c'est un battement de
-- présence qui suit un trou assez long. Six promesses :
--   1. un battement après une heure d'absence est une arrivée, et il écrit
--      bien la présence au passage ;
--   2. le battement suivant n'alerte plus — une seule alerte par joueur et par
--      journée de Paris, même en refabriquant un trou ;
--   3. un trou trop court n'est pas une arrivée ;
--   4. pendant le silence, rien ne part ET le plafond n'est pas consommé : la
--      première arrivée d'après le silence alerte encore ;
--   5. le propriétaire ne se signale jamais lui-même ;
--   6. la fonction reste réservée au service.

begin;

do $$
declare
  joueur constant uuid := 'f7ee0023-0000-4000-8000-0000000000a1';
  patron constant uuid := 'f7ee0023-0000-4000-8000-0000000000a2';
  reponse jsonb;
  vu timestamptz;
  avec_lui int;
  sans_lui int;
  activite text;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (patron, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  update public.profiles set role = 'admin' where id = patron;
  update public.profiles set last_seen = pg_catalog.now() where id = patron;

  -- ── 1. Un battement après une heure d'absence est une arrivée ─────────────
  update public.profiles
  set last_seen = pg_catalog.now() - interval '3 hours', owner_alert_at = null
  where id = joueur;

  reponse := public.server_presence_touch(joueur, 'online', true, 3600, 75);
  if (reponse ->> 'alerte')::boolean is distinct from true then
    raise exception 'Trois heures d''absence auraient du valoir une arrivee : %', reponse;
  end if;
  if (reponse ->> 'enLigne')::int < 1 then
    raise exception 'Celui qui vient d''arriver doit etre compte en ligne : %', reponse;
  end if;

  -- Le propriétaire ne se compte pas lui-même, comme dans le pouls du jeu
  -- (« toi non compté ») : le même nombre doit vouloir dire la même chose sur
  -- les deux écrans. Mesuré en DIFFÉRENCE : la suite tourne contre la
  -- production, où de vrais joueurs peuvent être en ligne à cet instant.
  select pg_catalog.count(*) into avec_lui
  from public.profiles
  where last_seen > pg_catalog.now() - interval '75 seconds';
  select pg_catalog.count(*) into sans_lui
  from public.profiles
  where last_seen > pg_catalog.now() - interval '75 seconds' and role <> 'admin';

  if avec_lui <> sans_lui + 1 then
    raise exception 'L''essai suppose UN seul admin en ligne : % avec lui, % sans', avec_lui, sans_lui;
  end if;
  if (reponse ->> 'enLigne')::int <> sans_lui then
    raise exception 'Le proprietaire en ligne ne doit rien ajouter au compte : % contre %',
      reponse ->> 'enLigne', sans_lui;
  end if;

  -- La présence a bien été écrite : la fonction remplace un `update`, elle ne
  -- doit pas se contenter de décider.
  select last_seen, activity into vu, activite from public.profiles where id = joueur;
  if vu < pg_catalog.now() - interval '5 seconds' then
    raise exception 'Le battement n''a pas ete ecrit : last_seen vaut %', vu;
  end if;
  if activite <> 'online' then
    raise exception 'L''activite devrait valoir online, elle vaut %', activite;
  end if;

  -- ── 2. Une seule alerte par joueur et par journée ─────────────────────────
  reponse := public.server_presence_touch(joueur, 'playing', true, 3600, 75);
  if (reponse ->> 'alerte')::boolean is distinct from false then
    raise exception 'Deux battements de suite ne font pas deux arrivees : %', reponse;
  end if;
  select activity into activite from public.profiles where id = joueur;
  if activite <> 'playing' then
    raise exception 'Le second battement devait passer en playing, il vaut %', activite;
  end if;

  -- Même en refabriquant un trou de trois heures : le plafond tient jusqu'à
  -- minuit, heure de Paris. C'est ce qui empêche quinze notifications pour un
  -- joueur qui ouvre et ferme l'appli toute la journée.
  update public.profiles set last_seen = pg_catalog.now() - interval '3 hours' where id = joueur;
  reponse := public.server_presence_touch(joueur, 'online', true, 3600, 75);
  if (reponse ->> 'alerte')::boolean is distinct from false then
    raise exception 'Le plafond journalier devrait tenir malgre un nouveau trou : %', reponse;
  end if;

  -- Hier, en revanche, ne plafonne pas aujourd'hui.
  update public.profiles
  set last_seen = pg_catalog.now() - interval '3 hours',
      owner_alert_at = (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') - interval '1 second'
  where id = joueur;
  reponse := public.server_presence_touch(joueur, 'online', true, 3600, 75);
  if (reponse ->> 'alerte')::boolean is distinct from true then
    raise exception 'Une alerte d''hier ne doit pas plafonner aujourd''hui : %', reponse;
  end if;

  -- ── 3. Un trou trop court n'est pas une arrivée ───────────────────────────
  -- Le seuil « hors ligne » vaut 75 secondes : un telephone verrouille deux
  -- minutes ne doit pas faire vibrer le proprietaire.
  update public.profiles
  set last_seen = pg_catalog.now() - interval '2 minutes', owner_alert_at = null
  where id = joueur;
  reponse := public.server_presence_touch(joueur, 'online', true, 3600, 75);
  if (reponse ->> 'alerte')::boolean is distinct from false then
    raise exception 'Deux minutes d''absence ne sont pas une arrivee : %', reponse;
  end if;

  -- ── 4. Le silence ne consomme pas le plafond ──────────────────────────────
  update public.profiles
  set last_seen = pg_catalog.now() - interval '3 hours', owner_alert_at = null
  where id = joueur;
  reponse := public.server_presence_touch(joueur, 'online', false, 3600, 75);
  if (reponse ->> 'alerte')::boolean is distinct from false then
    raise exception 'Pendant le silence, rien ne part : %', reponse;
  end if;
  if (select owner_alert_at from public.profiles where id = joueur) is not null then
    raise exception 'Le silence ne doit pas consommer le plafond du jour';
  end if;

  -- Et la présence a quand même été écrite : le silence tait la notification,
  -- pas le battement — sinon tout le monde passerait hors ligne la nuit.
  select last_seen into vu from public.profiles where id = joueur;
  if vu < pg_catalog.now() - interval '5 seconds' then
    raise exception 'Le battement doit etre ecrit meme pendant le silence : %', vu;
  end if;

  -- Le trou reprend, hors silence cette fois : l'arrivée est bien signalée.
  update public.profiles set last_seen = pg_catalog.now() - interval '3 hours' where id = joueur;
  reponse := public.server_presence_touch(joueur, 'online', true, 3600, 75);
  if (reponse ->> 'alerte')::boolean is distinct from true then
    raise exception 'La premiere arrivee d''apres le silence doit alerter : %', reponse;
  end if;

  -- ── 5. Le propriétaire ne se signale pas lui-même ─────────────────────────
  update public.profiles
  set last_seen = pg_catalog.now() - interval '3 hours', owner_alert_at = null
  where id = patron;
  reponse := public.server_presence_touch(patron, 'online', true, 3600, 75);
  if (reponse ->> 'alerte')::boolean is distinct from false then
    raise exception 'Le proprietaire ne doit pas se notifier lui-meme : %', reponse;
  end if;
  select last_seen into vu from public.profiles where id = patron;
  if vu < pg_catalog.now() - interval '5 seconds' then
    raise exception 'Son propre battement doit quand meme etre ecrit : %', vu;
  end if;

  -- ── 6. Réservé au service ─────────────────────────────────────────────────
  if pg_catalog.has_function_privilege('authenticated', 'public.server_presence_touch(uuid, text, boolean, int, int)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.server_presence_touch(uuid, text, boolean, int, int)', 'execute') then
    raise exception 'Le battement de presence doit rester reserve au service';
  end if;
end;
$$;

rollback;

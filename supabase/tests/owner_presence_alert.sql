-- Le propriétaire sait quand un joueur arrive (migration 20260923150000).
--
-- Il n'existe aucun événement de connexion : une arrivée, c'est un battement de
-- présence qui suit un trou. Aucun plafond — « même s'il se co 15 fois je veux
-- le savoir » — donc six promesses :
--   1. un battement qui suit une absence est une arrivée, et il écrit bien la
--      présence au passage ;
--   2. DEUX absences font DEUX arrivées : rien ne plafonne dans la journée ;
--   3. un battement qui en suit un autre de près n'est pas une arrivée ;
--   4. pendant le silence rien ne part, mais le battement s'écrit quand même ;
--   5. le propriétaire ne se signale jamais lui-même, et ne se compte pas dans
--      le nombre de joueurs en ligne ;
--   6. la fonction reste réservée au service.

begin;

do $$
declare
  joueur constant uuid := 'f7ee0023-0000-4000-8000-0000000000a1';
  patron constant uuid := 'f7ee0023-0000-4000-8000-0000000000a2';
  -- Le seuil du jeu : au-delà, un joueur est « hors ligne » pour ses amis.
  hors_ligne constant int := 75;
  reponse jsonb;
  vu timestamptz;
  activite text;
  avec_lui int;
  sans_lui int;
begin
  insert into auth.users(id, is_anonymous, created_at, updated_at)
  values
    (joueur, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (patron, false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

  update public.profiles set role = 'admin', last_seen = pg_catalog.now() where id = patron;

  -- ── 1. Un battement qui suit une absence est une arrivée ──────────────────
  update public.profiles set last_seen = pg_catalog.now() - interval '10 minutes' where id = joueur;

  reponse := public.server_presence_touch(joueur, 'online', true, hors_ligne, hors_ligne);
  if (reponse ->> 'alerte')::boolean is distinct from true then
    raise exception 'Dix minutes d''absence auraient du valoir une arrivee : %', reponse;
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

  -- ── 5a. Le propriétaire ne se compte pas dans le nombre en ligne ──────────
  -- Mesuré en DIFFÉRENCE : la suite tourne contre la production, où de vrais
  -- joueurs peuvent être en ligne à cet instant.
  select pg_catalog.count(*) into avec_lui
  from public.profiles where last_seen > pg_catalog.now() - pg_catalog.make_interval(secs => hors_ligne);
  select pg_catalog.count(*) into sans_lui
  from public.profiles where last_seen > pg_catalog.now() - pg_catalog.make_interval(secs => hors_ligne) and role <> 'admin';

  if avec_lui <> sans_lui + 1 then
    raise exception 'L''essai suppose UN seul admin en ligne : % avec lui, % sans', avec_lui, sans_lui;
  end if;
  if (reponse ->> 'enLigne')::int <> sans_lui then
    raise exception 'Le proprietaire en ligne ne doit rien ajouter au compte : % contre %',
      reponse ->> 'enLigne', sans_lui;
  end if;

  -- ── 3. Un battement rapproché n'est pas une arrivée ───────────────────────
  -- C'est le cas courant : l'appli bat toutes les 25 secondes pendant qu'on
  -- joue. Sans ce refus, chaque battement ferait vibrer le propriétaire.
  reponse := public.server_presence_touch(joueur, 'playing', true, hors_ligne, hors_ligne);
  if (reponse ->> 'alerte')::boolean is distinct from false then
    raise exception 'Un battement qui suit le precedent n''est pas une arrivee : %', reponse;
  end if;
  select activity into activite from public.profiles where id = joueur;
  if activite <> 'playing' then
    raise exception 'Le second battement devait passer en playing, il vaut %', activite;
  end if;

  -- ── 2. Deux absences font deux arrivées : AUCUN plafond ───────────────────
  -- La promesse que le propriétaire a demandée explicitement. Quinze allers et
  -- retours dans la journée valent quinze notifications.
  for _ in 1..3 loop
    update public.profiles set last_seen = pg_catalog.now() - interval '10 minutes' where id = joueur;
    reponse := public.server_presence_touch(joueur, 'online', true, hors_ligne, hors_ligne);
    if (reponse ->> 'alerte')::boolean is distinct from true then
      raise exception 'Chaque retour doit alerter, aucun plafond : %', reponse;
    end if;
  end loop;

  -- ── 4. Le silence tait la notification, pas le battement ──────────────────
  update public.profiles set last_seen = pg_catalog.now() - interval '10 minutes' where id = joueur;
  reponse := public.server_presence_touch(joueur, 'online', false, hors_ligne, hors_ligne);
  if (reponse ->> 'alerte')::boolean is distinct from false then
    raise exception 'Pendant le silence, rien ne part : %', reponse;
  end if;
  -- Sinon tout le monde passerait hors ligne la nuit.
  select last_seen into vu from public.profiles where id = joueur;
  if vu < pg_catalog.now() - interval '5 seconds' then
    raise exception 'Le battement doit etre ecrit meme pendant le silence : %', vu;
  end if;

  -- ── 5b. Le propriétaire ne se signale pas lui-même ────────────────────────
  update public.profiles set last_seen = pg_catalog.now() - interval '10 minutes' where id = patron;
  reponse := public.server_presence_touch(patron, 'online', true, hors_ligne, hors_ligne);
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

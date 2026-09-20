-- ─────────────────────────────────────────────────────────────────────────────
-- LE CLASSÉ PRÉVIENT LES JOUEURS EN LIGNE (20/09/2026)
--
-- Le classé exige DEUX humains en même temps. Au 20/09/2026 : 11 comptes, et
-- zéro partie classée en trente jours. Personne ne cherche en même temps, donc
-- personne ne joue, donc personne ne cherche — le mode s'éteint de lui-même.
--
-- Décision du propriétaire : prévenir TOUT LE MONDE qui est DÉJÀ EN LIGNE au
-- moment de la recherche, SAUF les joueurs déjà engagés dans une partie classée
-- — eux n'ont rien à rejoindre. Pas de notification poussée (on ne réveille pas
-- un téléphone rangé dans une poche pour ça), pas de rendez-vous quotidien, pas
-- de réglage de plus. Celui qui est dans l'appli voit le bandeau, les autres ne
-- sont pas dérangés.
--
-- Les INVITÉS sont réveillés eux aussi : le classé leur est fermé, mais leur
-- écran affiche « crée un compte pour le rejoindre ». C'est le seul moment où
-- cette invitation tombe juste — quelqu'un attend, de l'autre côté.
--
-- DEUX EXCLUSIONS, demandées par le propriétaire :
--  - le joueur déjà dans une partie CLASSÉE n'a rien à rejoindre ;
--  - le joueur en plein DÉFI DU JOUR n'est pas dérangé : depuis le 20/09/2026
--    il n'a qu'une tentative, et quitter le défi la consommerait.
--
-- Et seule la PREMIÈRE recherche ouverte réveille les autres. Sans cette
-- condition, le troisième joueur qui rejoint — celui que l'appariement n'a pas
-- pris — déclenchait une deuxième vague de fenêtres chez tout le monde.
--
-- On réutilise le canal qui existe : `private.broadcast_user_menu_wakeup`
-- (migration du 29/07) pousse un réveil au menu du joueur, qui relit son état.
-- Le chercheur lui-même est exclu.
--
-- « En ligne » = `last_seen` de moins de 75 secondes, exactement le seuil du
-- client (`PRESENCE_ONLINE_TTL_MS`, src/presencePolicy.ts) : le battement de
-- présence réécrit la ligne toutes les 25 secondes.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.broadcast_ranked_search_menu_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  compte uuid;
begin
  -- Seule l'OUVERTURE d'une recherche réveille : passer de 'searching' à
  -- 'ready' est une affaire entre les deux joueurs concernés, que le serveur
  -- leur annonce déjà par leur propre sondage.
  if tg_op <> 'INSERT' then
    return new;
  end if;

  -- Une file déjà ouverte : les autres ont vu passer la première fenêtre, on ne
  -- la rejoue pas pour chaque arrivant.
  if exists (
    select 1
    from public.server_ranked_searches autre
    where autre.user_id <> new.user_id
      and autre.created_at > pg_catalog.now() - interval '10 minutes'
  ) then
    return new;
  end if;

  for compte in
    select p.id
    from public.profiles p
    where p.id <> new.user_id
      and p.status = 'active'
      and p.last_seen > now() - interval '75 seconds'
      -- Déjà dans une partie classée, ou en plein défi du jour : on le laisse.
      and not exists (
        select 1
        from public.match_participants mp
        join public.server_matches m on m.id = mp.match_id
        where mp.user_id = p.id
          and m.status = 'active'
          and (
            m.mode = 'ranked'
            or coalesce((m.state -> 'isDaily')::boolean, false)
          )
      )
  loop
    perform private.broadcast_user_menu_wakeup(compte, 'lobby');
  end loop;

  return new;
end;
$$;

revoke all on function private.broadcast_ranked_search_menu_wakeup() from public, anon, authenticated;

drop trigger if exists server_ranked_searches_menu_wakeup on public.server_ranked_searches;
create trigger server_ranked_searches_menu_wakeup
after insert on public.server_ranked_searches
for each row
execute function private.broadcast_ranked_search_menu_wakeup();

comment on function private.broadcast_ranked_search_menu_wakeup() is
  'Réveille le menu des comptes en ligne quand une recherche classée s''ouvre, pour qu''ils puissent la rejoindre.';

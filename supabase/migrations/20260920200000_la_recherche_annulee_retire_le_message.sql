-- ─────────────────────────────────────────────────────────────────────────────
-- UNE RECHERCHE CLASSÉE QUI S'ARRÊTE RETIRE LE MESSAGE (20/09/2026)
--
-- Défaut relevé par le propriétaire le jour même de la livraison : « si je
-- lance une recherche de classé et que je l'annule, le message pour les autres
-- ne part pas de lui-même. »
--
-- Le déclencheur d'hier ne réveillait les menus qu'à l'OUVERTURE d'une
-- recherche. À l'annulation — ou quand l'appariement la fait passer en
-- `ready`, ou quand le cron l'expire — plus personne n'était prévenu : le
-- bandeau et la fenêtre restaient affichés jusqu'au prochain sondage, à
-- promettre un adversaire qui n'attendait plus.
--
-- Le réveil part donc aussi sur UPDATE et sur DELETE. À l'ouverture, seule la
-- PREMIÈRE recherche réveille (sinon le troisième arrivant relance une vague
-- chez tout le monde) ; à la fermeture, on réveille toujours : un message faux
-- coûte plus cher qu'un réveil de trop, et ces réveils-là sont rares.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.broadcast_ranked_search_menu_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  compte uuid;
  chercheur uuid := coalesce(new.user_id, old.user_id);
begin
  -- À l'ouverture seulement : une file déjà ouverte a déjà prévenu tout le
  -- monde. À la fermeture, au contraire, il FAUT retirer le message.
  if tg_op = 'INSERT' and exists (
    select 1
    from public.server_ranked_searches autre
    where autre.user_id <> new.user_id
      and autre.created_at > pg_catalog.now() - interval '10 minutes'
  ) then
    return new;
  end if;

  -- Un simple battement de recherche (`updated_at` rafraîchi) ne change rien
  -- pour les autres : seul le STATUT compte.
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  for compte in
    select p.id
    from public.profiles p
    where p.id <> chercheur
      and p.status = 'active'
      and p.last_seen > pg_catalog.now() - interval '75 seconds'
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

  return coalesce(new, old);
end;
$$;

revoke all on function private.broadcast_ranked_search_menu_wakeup() from public, anon, authenticated;

drop trigger if exists server_ranked_searches_menu_wakeup on public.server_ranked_searches;
create trigger server_ranked_searches_menu_wakeup
after insert or update or delete on public.server_ranked_searches
for each row
execute function private.broadcast_ranked_search_menu_wakeup();

comment on function private.broadcast_ranked_search_menu_wakeup() is
  'Réveille le menu des joueurs en ligne quand une recherche classée s''ouvre — et quand elle s''arrête, pour retirer le message.';

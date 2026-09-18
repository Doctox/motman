-- ─────────────────────────────────────────────────────────────────────────────
-- UN AMI QUI QUITTE SA PARTIE N'EST PLUS « EN JEU » UNE MINUTE DE TROP.
--
-- Relevé par le propriétaire le 18/09/2026 : sa femme et lui finissent une
-- partie, reviennent tous deux au menu, et il la voit encore « En jeu » une à
-- deux minutes. Son téléphone à elle avait pourtant dit « en ligne » dès la
-- sortie de partie (MultiplayerGame → presence 'online'). Mais rien ne
-- prévenait les amis : leur menu ne relisait la liste qu'à son sondage suivant,
-- toutes les 60 s quand le temps réel est connecté — le temps réel étant censé
-- les réveiller, et ne le faisant pour aucun changement de présence.
--
-- Désormais, quand `activity` CHANGE (en ligne ↔ en jeu), chaque ami reçoit le
-- même réveil « social » que pour une demande d'ami. Le battement de présence,
-- qui réécrit `activity` et `last_seen` toutes les 25 s, ne déclenche rien tant
-- que l'activité ne change pas : c'est la clause WHEN qui le garantit.
--
-- Le passage « hors ligne » n'est pas concerné : il se déduit de `last_seen`
-- (75 s sans battement), aucune ligne ne change à cet instant.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.broadcast_presence_menu_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ami uuid;
begin
  for ami in
    select case when friendship.left_user_id = new.id then friendship.right_user_id else friendship.left_user_id end
    from public.friendships as friendship
    where friendship.left_user_id = new.id or friendship.right_user_id = new.id
  loop
    perform private.broadcast_user_menu_wakeup(ami, 'social');
  end loop;
  return null;
end;
$$;

revoke all on function private.broadcast_presence_menu_wakeup()
from public, anon, authenticated;

drop trigger if exists profiles_presence_menu_wakeup on public.profiles;
create trigger profiles_presence_menu_wakeup
after update of activity on public.profiles
for each row
when (old.activity is distinct from new.activity)
execute function private.broadcast_presence_menu_wakeup();

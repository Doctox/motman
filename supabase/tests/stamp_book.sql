-- Le carnet de timbres (02/11/2026, migration 20261102190000).
--
-- Quatre promesses :
--   1. LES CADRES RESTENT FERMÉS : ni un visiteur ni un joueur ne lit ni n'écrit
--      la table des seuils ;
--   2. LE SEUIL ATTEINT VERSE LE TITRE, à l'insertion du jour joué, et jamais avant ;
--   3. UN JOUR MANQUÉ N'ENLÈVE RIEN, et rejouer le versement ne double rien ;
--   4. ON NE BLOQUE JAMAIS LE DÉFI : une panne du versement laisse le jour s'écrire.

begin;

do $$
declare
  joueur uuid;
  jour_base constant date := date '2020-01-01';
  cadre_essai text;
begin
  -- ── 1. Fermé ──────────────────────────────────────────────────────────────
  if pg_catalog.has_table_privilege('anon', 'public.stamp_book_frames', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.stamp_book_frames', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.stamp_book_frames', 'insert') then
    raise exception 'Les cadres du carnet ne doivent être ni lisibles ni modifiables de l''extérieur';
  end if;
  if (select count(*) from public.server_title_catalog where id like 'carnet-%' and unlock_type = 'special') <> 6 then
    raise exception 'Six titres de carnet attendus';
  end if;

  -- Un compte vierge du carnet.
  select id into joueur from auth.users
  where not exists (select 1 from public.daily_plays p where p.user_id = auth.users.id)
    and not exists (select 1 from public.daily_wins w where w.user_id = auth.users.id)
  order by created_at limit 1;
  if joueur is null then raise exception 'Il faut un compte sans défi pour ce banc d''essai'; end if;
  delete from public.player_titles where user_id = joueur and title_id like 'carnet-%';

  -- ── 2. Le seuil, et pas avant ─────────────────────────────────────────────
  insert into public.daily_plays (user_id, day)
  select joueur, jour_base + rang from pg_catalog.generate_series(0, 8) as rang;
  if exists (select 1 from public.player_titles where user_id = joueur and title_id = 'carnet-10') then
    raise exception 'À 9 timbres, le titre des 10 n''est pas encore mérité';
  end if;
  -- Le 10e jour, trois ans plus tard : le compte ne dépend pas des jours de suite.
  insert into public.daily_plays (user_id, day) values (joueur, jour_base + 1000);
  if not exists (select 1 from public.player_titles where user_id = joueur and title_id = 'carnet-10' and source = 'special') then
    raise exception 'Le 10e timbre doit verser son titre';
  end if;
  if exists (select 1 from public.player_titles where user_id = joueur and title_id = 'carnet-25') then
    raise exception 'Le titre des 25 ne doit pas venir à 10 timbres';
  end if;

  -- ── 3. Rien ne se perd, rien ne se double ─────────────────────────────────
  perform private.verser_le_carnet(joueur);
  if (select count(*) from public.player_titles where user_id = joueur and title_id = 'carnet-10') <> 1 then
    raise exception 'Rejouer le versement ne doit rien doubler';
  end if;

  -- Un jour gagné sans ligne de jeu (d'avant le 19/09/2026) compte aussi, une seule fois.
  insert into public.daily_wins (user_id, day) values (joueur, jour_base + 1000) on conflict do nothing;
  insert into public.daily_wins (user_id, day)
  select joueur, jour_base + 2000 + rang from pg_catalog.generate_series(0, 14) as rang;
  perform private.verser_le_carnet(joueur);
  if not exists (select 1 from public.player_titles where user_id = joueur and title_id = 'carnet-25') then
    raise exception 'Dix jours joués et quinze jours gagnés font 25 timbres';
  end if;

  -- Un cadre posé par Cosmétiques se verse au prochain passage, sans autre code.
  select item_id into cadre_essai from public.server_cosmetic_catalog where kind = 'frame' and availability = 'epicerie' order by item_id limit 1;
  delete from public.stamp_book_frames;
  delete from public.player_inventory where user_id = joueur and kind = 'frame' and item_id = cadre_essai;
  insert into public.stamp_book_frames (seuil, item_id) values (25, cadre_essai);
  perform private.verser_le_carnet(joueur);
  if not exists (select 1 from public.player_inventory where user_id = joueur and kind = 'frame' and item_id = cadre_essai and source = 'carnet') then
    raise exception 'Un cadre du carnet doit se verser dès son seuil';
  end if;

  -- ── 4. Le défi passe, même si le versement tombe ──────────────────────────
  -- La fonction tombe pour de bon le temps de ce banc : la transaction annulée la rend.
  create or replace function private.verser_le_carnet(p_user_id uuid) returns void
  language plpgsql set search_path = '' as $panne$ begin raise exception 'panne simulée'; end; $panne$;
  insert into public.daily_plays (user_id, day) values (joueur, jour_base + 3000);
  if not exists (select 1 from public.daily_plays where user_id = joueur and day = jour_base + 3000) then
    raise exception 'Une panne du carnet ne doit jamais empêcher le défi de s''ouvrir';
  end if;
end;
$$;

rollback;

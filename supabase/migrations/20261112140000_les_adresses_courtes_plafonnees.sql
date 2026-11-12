-- ─────────────────────────────────────────────────────────────────────────────
-- LES ADRESSES COURTES, PLAFONNÉES (12/11/2026, audit sécurité, n° 2)
--
-- `note_short_link_pass` (20261027130000) vérifiait la FORME du nom, pas qu'il
-- s'agisse d'une vraie adresse courte : chaque nom inventé créait une ligne. La
-- fonction est ouverte à la clé publiable, déjà publique dans le jeu : un script
-- sans compte pouvait donc remplir la base jusqu'aux 500 Mo du plan gratuit, et
-- Supabase la passait alors en lecture seule — plus aucune partie ne s'écrivait.
--
-- Un nom déjà vu aujourd'hui compte toujours. Au-delà de 20 noms différents dans
-- la journée, un nom NOUVEAU n'est plus compté : la table grandit de 20 lignes
-- par jour au plus. La liste des vraies adresses n'est pas recopiée ici (elle vit
-- dans le Worker de doctox.fr, dépôt doctox-site) : la règle ne s'écrit qu'une
-- fois. Le pire qui reste possible est de gonfler un compteur existant.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.note_short_link_pass(p_lien text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  aujourdhui constant date := (pg_catalog.now() at time zone 'Europe/Paris')::date;
begin
  if p_lien is null or p_lien !~ '^[a-z0-9-]{1,24}$' then
    return false;
  end if;

  update public.short_link_daily
     set passages = passages + 1
   where jour = aujourdhui and lien = p_lien;
  if found then
    return true;
  end if;

  if (select count(*) from public.short_link_daily where jour = aujourdhui) >= 20 then
    return false;
  end if;

  insert into public.short_link_daily as compteur (jour, lien, passages)
  values (aujourdhui, p_lien, 1)
  on conflict (jour, lien) do update
    set passages = compteur.passages + 1;
  return true;
end;
$$;

revoke all on function public.note_short_link_pass(text) from public, anon, authenticated;
grant execute on function public.note_short_link_pass(text) to anon, service_role;

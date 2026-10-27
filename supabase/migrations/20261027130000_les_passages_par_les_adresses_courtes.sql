-- ─────────────────────────────────────────────────────────────────────────────
-- LES PASSAGES PAR LES ADRESSES COURTES (27/10/2026)
--
-- Demande du Community Manager, accord du propriétaire : doctox.fr/motman/roblox
-- renvoie vers le jeu Roblox, et il faut savoir combien de gens passent par là
-- (Roblox réclame 250 joueurs). Le jeu Roblox n'est pas chez nous : la source
-- des joueurs (20261017100000) ne le voit pas. On compte donc le passage, au
-- moment où le Worker de doctox.fr redirige (dépôt doctox-site, src/acces.ts).
-- Les autres adresses courtes (/motman/insta, /tiktok…) sont comptées aussi :
-- un passage sans arrivée dit où les gens décrochent.
--
-- UN COMPTEUR PAR JOUR DE PARIS ET PAR ADRESSE, RIEN D'AUTRE : ni adresse IP,
-- ni navigateur, ni heure. Le propriétaire ne garde pas de fichiers de joueurs.
--
-- ⚠️ LA SEULE ÉCRITURE OUVERTE À LA CLÉ PUBLIQUE. Le Worker n'a que la clé
-- publiable (celle du jeu, déjà publique) : la clé de service n'a pas à vivre
-- sur un deuxième site. La fonction ne fait qu'ajouter 1 à un compteur dont le
-- nom est contrôlé ; le pire qu'on puisse en faire est de gonfler un chiffre de
-- bilan. La table, elle, reste fermée à tous sauf à la clé de service.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.short_link_daily (
  jour date not null,
  lien text not null check (lien ~ '^[a-z0-9-]{1,24}$'),
  passages integer not null default 0 check (passages >= 0),
  primary key (jour, lien)
);

alter table public.short_link_daily enable row level security;
revoke all on public.short_link_daily from public, anon, authenticated;
grant all on public.short_link_daily to service_role;

comment on table public.short_link_daily is
  'Passages par les adresses courtes de doctox.fr (/motman/roblox…), par jour de Paris. Sans identifiant. Voir 20261027130000_les_passages_par_les_adresses_courtes.sql.';

-- Un passage de plus. Faux si le nom n'est pas celui d'une adresse courte.
create or replace function public.note_short_link_pass(p_lien text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lien is null or p_lien !~ '^[a-z0-9-]{1,24}$' then
    return false;
  end if;

  insert into public.short_link_daily as compteur (jour, lien, passages)
  values ((pg_catalog.now() at time zone 'Europe/Paris')::date, p_lien, 1)
  on conflict (jour, lien) do update
    set passages = compteur.passages + 1;
  return true;
end;
$$;

revoke all on function public.note_short_link_pass(text) from public, anon, authenticated;
grant execute on function public.note_short_link_pass(text) to anon, service_role;

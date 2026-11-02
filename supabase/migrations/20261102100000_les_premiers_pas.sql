-- ─────────────────────────────────────────────────────────────────────────────
-- LES PREMIERS PAS D'UN NOUVEAU (02/11/2026)
--
-- Demande du propriétaire, après la recherche sur la rétention : 4 arrivants sur
-- 6 sans partie repartaient en moins d'une minute, et rien ne disait à quel
-- écran. Le jeu compte donc les étapes de la première ouverture (src/premiersPas.ts).
--
-- UN COMPTEUR PAR JOUR DE PARIS ET PAR ÉTAPE, RIEN D'AUTRE : ni joueur, ni
-- appareil, ni heure. Il se lit avec les comptes créés (player_source_daily).
--
-- Ouvert aux joueurs connectés, invités compris (rôle authenticated), jamais à la
-- clé publique seule. La fonction ne fait qu'ajouter 1 à une étape connue : le
-- pire qu'on puisse en faire est de gonfler un chiffre du pouls. La table, elle,
-- reste fermée à tous sauf à la clé de service.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.first_steps_daily (
  jour date not null,
  etape text not null check (etape in ('menu', 'essai_passe', 'essai_fini', 'choix_defi', 'choix_partie', 'choix_plus_tard')),
  nombre integer not null default 0 check (nombre >= 0),
  primary key (jour, etape)
);

alter table public.first_steps_daily enable row level security;
revoke all on public.first_steps_daily from public, anon, authenticated;
grant all on public.first_steps_daily to service_role;

comment on table public.first_steps_daily is
  'Étapes de la première ouverture du jeu, par jour de Paris. Sans identifiant. Voir 20261102100000_les_premiers_pas.sql.';

-- Une étape de plus. Faux si ce n'est pas une étape connue.
create or replace function public.note_first_step(p_etape text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_etape is null or p_etape not in ('menu', 'essai_passe', 'essai_fini', 'choix_defi', 'choix_partie', 'choix_plus_tard') then
    return false;
  end if;

  insert into public.first_steps_daily as compteur (jour, etape, nombre)
  values ((pg_catalog.now() at time zone 'Europe/Paris')::date, p_etape, 1)
  on conflict (jour, etape) do update
    set nombre = compteur.nombre + 1;
  return true;
end;
$$;

revoke all on function public.note_first_step(text) from public, anon, authenticated;
grant execute on function public.note_first_step(text) to authenticated, service_role;

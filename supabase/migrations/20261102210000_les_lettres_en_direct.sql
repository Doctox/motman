-- ─────────────────────────────────────────────────────────────────────────────
-- LES LETTRES DE L'AUTRE, EN DIRECT (02/11/2026, demande du propriétaire)
--
-- En temps limité, le téléphone envoie déjà les lettres posées au fil du tour
-- (20261016230000). Désormais le serveur les diffuse aussi aux participants de
-- la partie, sur le canal privé `match:<id>` dont la lecture leur est réservée
-- (20260720124737). L'adversaire les voit arriver avant que le joueur valide.
--
-- CE QUI NE CHANGE PAS : la table reste fermée à tout le monde sauf match-api, et
-- rien de ce qui part ne dit si une lettre est juste. Les lettres qui partent
-- sont celles que match-api a retenues d'un coup valable : prises au chevalet,
-- sur des cases libres.
--
-- Diffusé seulement quand le brouillon est VRAIMENT écrit : un envoi plus ancien
-- que celui déjà reçu ne doit rien faire réapparaître. Et une diffusion ratée ne
-- fait jamais échouer le brouillon, qui protège les lettres du joueur.
--
-- `security definer` : le canal s'écrit dans le schéma realtime, comme
-- private.broadcast_match_update. Seul match-api appelle cette fonction.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.server_save_match_draft(
  p_match_id uuid,
  p_user_id uuid,
  p_turn_number integer,
  p_version bigint,
  p_placements jsonb,
  p_received_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ecrit boolean;
begin
  insert into public.server_match_drafts as brouillon (match_id, user_id, turn_number, version, placements, received_at)
  values (p_match_id, p_user_id, p_turn_number, p_version, p_placements, p_received_at)
  on conflict (match_id, user_id) do update
    set turn_number = excluded.turn_number,
        version = excluded.version,
        placements = excluded.placements,
        received_at = excluded.received_at
    where excluded.turn_number > brouillon.turn_number
       or (excluded.turn_number = brouillon.turn_number and excluded.version > brouillon.version)
  returning true into v_ecrit;

  if v_ecrit then
    begin
      perform realtime.send(
        jsonb_build_object('turnNumber', p_turn_number, 'placements', p_placements, 'recuA', p_received_at),
        'lettres',
        'match:' || p_match_id::text,
        true
      );
    exception when others then
      raise warning 'Lettres en direct non diffusées : %', sqlerrm;
    end;
  end if;

  return v_ecrit;
end;
$$;

revoke all on function public.server_save_match_draft(uuid, uuid, integer, bigint, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.server_save_match_draft(uuid, uuid, integer, bigint, jsonb, timestamptz) to service_role;

comment on table public.server_match_drafts is
  'Les lettres posées par le joueur dont c''est le tour, envoyées au fil du tour. Joué par match-api si l''envoi de fin de tour manque, et montré à l''adversaire sans dire si c''est juste. Voir 20261016230000_les_lettres_posees_au_fil_du_tour.sql et 20261102210000_les_lettres_en_direct.sql.';

-- ─────────────────────────────────────────────────────────────────────────────
-- QUITTER UNE PARTIE POUR LE CLASSÉ VAUT ÉGALITÉ (propriétaire, 20/09/2026)
--
-- Jusqu'ici, deux poids deux mesures. Une partie NORMALE en temps limité entre
-- deux humains était mise en pause, puis close en ÉGALITÉ quand le match classé
-- démarrait (`private.finish_ranked_transfer_match`, migration du 29/07). Tout
-- le reste — défi du jour, partie entre amis, partie contre un bot — était
-- ABANDONNÉ par le client (`forfeitMatch`) : défaite, aucune plume, aucune
-- expérience, alors que le joueur n'avait rien fui.
--
-- Désormais, une seule règle : la partie quittée pour rejoindre l'arène est
-- déclarée ÉGALE, quels que soient son mode et son rythme. « Comme lors d'une
-- recherche de partie », dit le propriétaire.
--
-- LE MOMENT COMPTE AUTANT QUE LA RÈGLE. Rien n'est clos quand le joueur se met
-- en file : le match classé peut ne jamais venir, ou l'autre refuser. La partie
-- n'est close qu'une fois le match classé RÉELLEMENT OUVERT — c'est ce que
-- vérifie cette fonction, et c'est pour ça qu'elle exige l'identifiant du match
-- classé plutôt qu'un simple « fais-moi confiance ».
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.server_finish_match_for_ranked_transfer(
  p_user_id uuid,
  p_match_id uuid,
  p_ranked_match_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ferme boolean := false;
begin
  if p_user_id is null or p_match_id is null or p_ranked_match_id is null then
    return false;
  end if;

  -- Le match classé doit exister, être classé, et appartenir à ce joueur.
  if not exists (
    select 1
    from public.server_matches arene
    join public.match_participants participant
      on participant.match_id = arene.id
     and participant.user_id = p_user_id
    where arene.id = p_ranked_match_id
      and arene.mode = 'ranked'
  ) then
    return false;
  end if;

  -- La partie quittée doit être la sienne, encore active, et ne pas être
  -- l'arène elle-même.
  update public.server_matches quittee
  set status = 'finished',
      current_player_id = null,
      winner_id = null,
      finish_reason = 'ranked_transfer',
      turn_started_at = pg_catalog.clock_timestamp(),
      turn_ends_at = pg_catalog.clock_timestamp(),
      paused_at = null,
      pause_reason = null,
      paused_remaining_ms = null,
      ranked_ready_session_id = null,
      updated_at = pg_catalog.clock_timestamp()
  where quittee.id = p_match_id
    and quittee.id <> p_ranked_match_id
    and quittee.status = 'active'
    and exists (
      select 1
      from public.match_participants participant
      where participant.match_id = quittee.id
        and participant.user_id = p_user_id
    );

  get diagnostics v_ferme = row_count;
  return v_ferme;
end;
$$;

revoke all on function public.server_finish_match_for_ranked_transfer(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.server_finish_match_for_ranked_transfer(uuid, uuid, uuid)
  to service_role;

comment on function public.server_finish_match_for_ranked_transfer(uuid, uuid, uuid) is
  'Clôt en égalité la partie qu''un joueur quitte pour rejoindre un match classé déjà ouvert.';

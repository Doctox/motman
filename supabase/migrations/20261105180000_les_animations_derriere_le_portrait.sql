-- Quatre animations ne passent plus sur le visage (05/11/2026), à la demande du
-- propriétaire : Dragon solaire, L'Oiseau de lumière et Papillons du songe passent
-- derrière le portrait (scripts/animations/derriere_portrait.py) ; la vapeur de la
-- Tasse de thé s'arrête sous le menton. Une image refaite change de nom de fichier :
-- les URL ne sont pas versionnées, le cache servirait l'ancienne.
update public.server_cosmetic_catalog
set asset = '/assets/animations/lab/' || item_id || '-2.png', updated_at = now()
where kind = 'animation' and item_id in ('dragon-solaire', 'oiseau-de-lumiere', 'papillons-du-songe', 'tasse-the');

do $$
begin
  if (select count(*) from public.server_cosmetic_catalog
      where kind = 'animation' and asset like '/assets/animations/lab/%-2.png') <> 4 then
    raise exception 'Les quatre animations refaites doivent pointer vers leurs nouveaux fichiers.';
  end if;
end
$$;

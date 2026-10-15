// ─────────────────────────────────────────────────────────────────────────────
// UNE DÉFINITION EN ATTENDANT (15/10/2026).
//
// Le reste de B2, retenu par le propriétaire au tour « détente » : « pendant
// l'attente, une définition à deviner pour le plaisir, sans enjeu ». Validé
// sous cette forme le même jour (« parfait ») : une définition à la fois, ses
// lettres mélangées à toucher, la suivante dès qu'elle est trouvée. Ni XP ni
// plumes.
//
// LA RÉSERVE EST À PART DU CATALOGUE, exprès. Ses réponses voyagent dans
// l'appli (il faut bien vérifier le mot du joueur) ; prises dans les vraies
// grilles, elles publieraient des solutions — et la règle du dépôt public est
// qu'aucune n'y entre (voir « atelier privé »). Ce sont des mots de tous les
// jours, définis simplement, lisibles par un enfant.
// ─────────────────────────────────────────────────────────────────────────────

export type MotEnAttente = { mot: string; definition: string }

/** Le mot, en capitales sans accent (comme dans les grilles), et sa définition. */
export const RESERVE_EN_ATTENTE: readonly MotEnAttente[] = [
  { mot: 'CHAT', definition: 'Il miaule sur le canapé' },
  { mot: 'LOUP', definition: 'Il hurle à la lune' },
  { mot: 'OURS', definition: 'Il dort tout l’hiver' },
  { mot: 'LAIT', definition: 'Boisson blanche du matin' },
  { mot: 'PAIN', definition: 'On le coupe en tranches' },
  { mot: 'MIEL', definition: 'Trésor sucré des abeilles' },
  { mot: 'LUNE', definition: 'Elle brille la nuit' },
  { mot: 'VENT', definition: 'Il fait tourner les éoliennes' },
  { mot: 'NEIGE', definition: 'Le bonhomme d’hiver en est fait' },
  { mot: 'PLUIE', definition: 'Elle mouille les trottoirs' },
  { mot: 'SOLEIL', definition: 'Il chauffe la plage' },
  { mot: 'NUAGE', definition: 'Il cache le soleil' },
  { mot: 'ROSE', definition: 'Fleur qui pique' },
  { mot: 'LIVRE', definition: 'On le lit page après page' },
  { mot: 'STYLO', definition: 'Il écrit à l’encre' },
  { mot: 'GOMME', definition: 'Elle efface le crayon' },
  { mot: 'CRAIE', definition: 'Elle écrit au tableau' },
  { mot: 'VELO', definition: 'Deux roues et des pédales' },
  { mot: 'TRAIN', definition: 'Il roule sur des rails' },
  { mot: 'AVION', definition: 'Il vole avec des passagers' },
  { mot: 'BATEAU', definition: 'Il flotte sur l’eau' },
  { mot: 'POMME', definition: 'Fruit croquant du verger' },
  { mot: 'POIRE', definition: 'Fruit en forme de goutte' },
  { mot: 'CITRON', definition: 'Fruit jaune très acide' },
  { mot: 'FRAISE', definition: 'Petit fruit rouge de juin' },
  { mot: 'CERISE', definition: 'Fruit rouge avec un noyau' },
  { mot: 'ORANGE', definition: 'On la presse au petit-déjeuner' },
  { mot: 'KIWI', definition: 'Fruit poilu à la chair verte' },
  { mot: 'MELON', definition: 'Fruit d’été à la chair orange' },
  { mot: 'TARTE', definition: 'Gâteau plat aux fruits' },
  { mot: 'CREPE', definition: 'Galette fine de la Chandeleur' },
  { mot: 'SOUPE', definition: 'On la mange à la cuillère' },
  { mot: 'SALADE', definition: 'Feuilles vertes en vinaigrette' },
  { mot: 'BEURRE', definition: 'On le tartine le matin' },
  { mot: 'SUCRE', definition: 'Il adoucit le café' },
  { mot: 'OEUF', definition: 'La poule le pond' },
  { mot: 'PATES', definition: 'Spaghettis et coquillettes' },
  { mot: 'JUPE', definition: 'Elle tourne quand on danse' },
  { mot: 'ROBE', definition: 'Vêtement des jours de fête' },
  { mot: 'GANT', definition: 'Il réchauffe la main' },
  { mot: 'BOTTE', definition: 'Chaussure des jours de pluie' },
  { mot: 'PULL', definition: 'Il tient chaud en hiver' },
  { mot: 'BONNET', definition: 'Il couvre les oreilles' },
  { mot: 'MAISON', definition: 'On y habite' },
  { mot: 'PORTE', definition: 'On la ferme à clé' },
  { mot: 'TOIT', definition: 'Il protège de la pluie' },
  { mot: 'JARDIN', definition: 'On y plante des fleurs' },
  { mot: 'ARBRE', definition: 'Il a des racines et des branches' },
  { mot: 'FLEUR', definition: 'L’abeille la butine' },
  { mot: 'HERBE', definition: 'On la tond le dimanche' },
  { mot: 'FORET', definition: 'Beaucoup d’arbres ensemble' },
  { mot: 'PLAGE', definition: 'Du sable et des vagues' },
  { mot: 'VAGUE', definition: 'Le surfeur l’attend' },
  { mot: 'SABLE', definition: 'On en fait des châteaux' },
  { mot: 'ETOILE', definition: 'Elle scintille la nuit' },
  { mot: 'CIEL', definition: 'Il est bleu quand il fait beau' },
  { mot: 'ORAGE', definition: 'Il gronde et fait des éclairs' },
  { mot: 'HIVER', definition: 'Saison des bonshommes de neige' },
  { mot: 'LUNDI', definition: 'Premier jour de la semaine' },
  { mot: 'MATIN', definition: 'Le début de la journée' },
  { mot: 'SOIR', definition: 'La fin de la journée' },
  { mot: 'NUIT', definition: 'On dort pendant ce temps-là' },
  { mot: 'HEURE', definition: 'Soixante minutes' },
  { mot: 'MINUTE', definition: 'Il y en a soixante dans une heure' },
  { mot: 'DOUZE', definition: 'Une douzaine' },
  { mot: 'CINQ', definition: 'Les doigts d’une main' },
  { mot: 'DEUX', definition: 'Une paire' },
  { mot: 'TROIS', definition: 'Juste après deux' },
  { mot: 'CHIEN', definition: 'Il aboie sur le facteur' },
  { mot: 'LAPIN', definition: 'Il adore les carottes' },
  { mot: 'CHEVAL', definition: 'On le monte avec une selle' },
  { mot: 'VACHE', definition: 'Elle donne du lait' },
  { mot: 'MOUTON', definition: 'Sa laine tient chaud' },
  { mot: 'COCHON', definition: 'Animal rose de la ferme' },
  { mot: 'POULE', definition: 'Elle pond des œufs' },
  { mot: 'CANARD', definition: 'Il fait coin-coin' },
  { mot: 'SOURIS', definition: 'Le chat la poursuit' },
  { mot: 'ZEBRE', definition: 'Cheval à rayures' },
  { mot: 'LION', definition: 'Roi de la savane' },
  { mot: 'SINGE', definition: 'Il grimpe aux arbres' },
  { mot: 'GIRAFE', definition: 'Elle a un très long cou' },
  { mot: 'TORTUE', definition: 'Elle porte sa maison' },
  { mot: 'REQUIN', definition: 'Poisson aux dents pointues' },
  { mot: 'FOURMI', definition: 'Petite travailleuse en file' },
  { mot: 'HIBOU', definition: 'Il hulule la nuit' },
  { mot: 'MERLE', definition: 'Oiseau noir au bec jaune' },
  { mot: 'PIANO', definition: 'Touches noires et blanches' },
  { mot: 'FLUTE', definition: 'On souffle dedans' },
  { mot: 'DANSE', definition: 'On la fait en musique' },
  { mot: 'CHANT', definition: 'Musique avec la voix' },
  { mot: 'BALLON', definition: 'On tape dedans au foot' },
  { mot: 'JOUET', definition: 'On le trouve sous le sapin' },
  { mot: 'POUPEE', definition: 'Jouet qu’on habille' },
  { mot: 'DOMINO', definition: 'Petit rectangle à points' },
  { mot: 'CARTE', definition: 'Valet, dame ou roi' },
  { mot: 'ECOLE', definition: 'On y apprend à lire' },
  { mot: 'CLASSE', definition: 'Salle avec un tableau' },
  { mot: 'CAHIER', definition: 'On y écrit ses leçons' },
  { mot: 'REGLE', definition: 'Elle aide à tracer droit' },
  { mot: 'TABLE', definition: 'On s’y assoit pour manger' },
  { mot: 'CHAISE', definition: 'Siège à quatre pieds' },
  { mot: 'LAMPE', definition: 'Elle éclaire le salon' },
  { mot: 'SAVON', definition: 'Il mousse sous la douche' },
  { mot: 'BAIN', definition: 'Moment dans la baignoire' },
  { mot: 'DOUCHE', definition: 'Plus rapide qu’un bain' },
  { mot: 'BROSSE', definition: 'Elle démêle les cheveux' },
  { mot: 'PEIGNE', definition: 'Il a des dents mais ne mord pas' },
  { mot: 'MIROIR', definition: 'Il te renvoie ton reflet' },
  { mot: 'MAIN', definition: 'Elle a cinq doigts' },
  { mot: 'PIED', definition: 'Au bout de la jambe' },
  { mot: 'TETE', definition: 'On y met un chapeau' },
  { mot: 'BRAS', definition: 'Entre l’épaule et la main' },
  { mot: 'DENT', definition: 'La petite souris l’emporte' },
  { mot: 'COEUR', definition: 'Il bat dans la poitrine' },
  { mot: 'RIRE', definition: 'Ce que fait une bonne blague' },
  { mot: 'JOIE', definition: 'Grand bonheur' },
  { mot: 'COPAIN', definition: 'Ami de la récré' },
  { mot: 'BEBE', definition: 'Il dort dans un berceau' },
  { mot: 'ROUGE', definition: 'Couleur de la tomate' },
  { mot: 'VERT', definition: 'Couleur de l’herbe' },
  { mot: 'BLEU', definition: 'Couleur de la mer' },
  { mot: 'JAUNE', definition: 'Couleur du poussin' },
  { mot: 'BLANC', definition: 'Couleur de la neige' },
  { mot: 'NOIR', definition: 'Couleur du corbeau' },
  { mot: 'ROND', definition: 'Comme un cercle' },
  { mot: 'CARRE', definition: 'Forme d’une case de grille' },
  { mot: 'FETE', definition: 'On y danse et on y rit' },
  { mot: 'CADEAU', definition: 'Il est emballé dans du papier' },
  { mot: 'GATEAU', definition: 'On y plante des bougies' },
  { mot: 'BOUGIE', definition: 'On la souffle à l’anniversaire' },
  { mot: 'NOEL', definition: 'Fête du sapin et des cadeaux' },
  { mot: 'SAPIN', definition: 'On le décore en décembre' },
  { mot: 'CIRQUE', definition: 'Clowns et acrobates' },
  { mot: 'CLOWN', definition: 'Il a un nez rouge' },
  { mot: 'MAGIE', definition: 'Le lapin sort du chapeau' },
  { mot: 'PIRATE', definition: 'Il cherche un trésor' },
  { mot: 'TRESOR', definition: 'Coffre plein d’or' },
  { mot: 'REINE', definition: 'Elle porte une couronne' },
  { mot: 'DRAGON', definition: 'Il crache du feu' },
  { mot: 'FUSEE', definition: 'Elle décolle vers l’espace' },
  { mot: 'ROBOT', definition: 'Machine qui imite l’humain' },
  { mot: 'PHOTO', definition: 'On sourit pour elle' },
  { mot: 'MUSEE', definition: 'On y admire des tableaux' },
  { mot: 'CINEMA', definition: 'On y voit des films' },
  { mot: 'MONTRE', definition: 'Elle donne l’heure au poignet' },
  { mot: 'VALISE', definition: 'On la remplit pour partir' },
  { mot: 'TENTE', definition: 'La maison du campeur' },
  { mot: 'VOYAGE', definition: 'On le prépare avant de partir' },
  { mot: 'PONT', definition: 'Il passe au-dessus de l’eau' },
  { mot: 'ROUTE', definition: 'Les voitures y roulent' },
  { mot: 'MONT', definition: 'Le Saint-Michel en est un' },
  { mot: 'CAFE', definition: 'Petit noir du matin' },
  { mot: 'TASSE', definition: 'On y boit le thé' },
  { mot: 'FOUR', definition: 'Il cuit le gâteau' },
  { mot: 'FRIGO', definition: 'Il garde les aliments au frais' },
  { mot: 'PIZZA', definition: 'Ronde, au fromage et à la tomate' },
  { mot: 'FRITES', definition: 'Bâtonnets de pomme de terre' },
  { mot: 'GLACE', definition: 'Dessert qui fond au soleil' },
  { mot: 'BONBON', definition: 'Petite friandise sucrée' },
  { mot: 'BISOU', definition: 'Petit baiser' },
  { mot: 'CALIN', definition: 'On le fait dans les bras' },
  { mot: 'REVE', definition: 'On le fait en dormant' },
  { mot: 'QUIZ', definition: 'Une série de questions' },
  { mot: 'LETTRE', definition: 'A, B ou C' },
  { mot: 'TIMBRE', definition: 'On le colle sur l’enveloppe' },
]

/** Une graine pseudo-aléatoire stable (mulberry32) : l'ordre et le mélange se rejouent à l'identique. */
function hasard(graine: number): () => number {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function brasser<T>(liste: readonly T[], graine: number): T[] {
  const tire = hasard(graine)
  const copie = [...liste]
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = Math.floor(tire() * (i + 1))
    ;[copie[i], copie[j]] = [copie[j], copie[i]]
  }
  return copie
}

/** L'ordre de passage : toute la réserve, brassée une fois, sans répétition avant la fin. */
export function ordreDesMots(graine = 20261015): readonly MotEnAttente[] {
  return brasser(RESERVE_EN_ATTENTE, graine)
}

/**
 * Les lettres du mot, mélangées. Jamais dans l'ordre du mot — ce serait la
 * réponse posée sur la table —, sauf pour un mot dont toutes les lettres sont
 * identiques (il n'y en a pas).
 */
export function lettresMelangees(mot: string, graine: number): string[] {
  const lettres = [...mot]
  for (let essai = 0; essai < 12; essai += 1) {
    const melange = brasser(lettres, graine + essai)
    if (melange.join('') !== mot) return melange
  }
  return [...lettres.slice(1), lettres[0]]
}

/** Une tuile : sa lettre, et la case où elle est posée (ou null si elle est encore sur la table). */
export type Tuile = { lettre: string; case: number | null }

/** Toucher une tuile libre la pose dans la première case vide. Rien ne bouge si tout est plein. */
export function poser(tuiles: readonly Tuile[], indice: number, longueur: number): Tuile[] {
  if (tuiles[indice]?.case !== null) return [...tuiles]
  const occupees = new Set(tuiles.map(t => t.case).filter((c): c is number => c !== null))
  let libre = -1
  for (let c = 0; c < longueur; c += 1) if (!occupees.has(c)) { libre = c; break }
  if (libre < 0) return [...tuiles]
  return tuiles.map((t, i) => i === indice ? { ...t, case: libre } : t)
}

/** Toucher une case pleine renvoie sa tuile sur la table. */
export function retirer(tuiles: readonly Tuile[], numeroDeCase: number): Tuile[] {
  return tuiles.map(t => t.case === numeroDeCase ? { ...t, case: null } : t)
}

/** Ce qui est écrit dans les cases, case par case (« » pour une case vide). */
export function lecture(tuiles: readonly Tuile[], longueur: number): string[] {
  const cases = Array.from({ length: longueur }, () => '')
  for (const t of tuiles) if (t.case !== null) cases[t.case] = t.lettre
  return cases
}

/** null tant qu'une case est vide ; sinon, le mot est-il le bon ? */
export function verdict(tuiles: readonly Tuile[], mot: string): boolean | null {
  const cases = lecture(tuiles, mot.length)
  if (cases.some(lettre => !lettre)) return null
  return cases.join('') === mot
}

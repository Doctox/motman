# Captures Play Store (1080 x 1920) : capture telephone recadree + bandeau.
# Les captures brutes viennent du telephone de JM (Android, 945x2048 apres
# passage par WhatsApp). On retire la barre d'etat et la barre de navigation
# d'Android : l'heure, l'operateur et le niveau de batterie n'apportent rien et
# datent la capture.
from PIL import Image, ImageDraw, ImageFont
import sys, os

CREAM=(253,245,224); GREEN=(5,81,57); ORANGE=(247,111,38)
W,H=1080,1920
_ICI = os.path.dirname(os.path.abspath(__file__))
PF = os.path.join(_ICI, 'fonts', 'playfair.ttf')
DM = os.path.join(_ICI, 'fonts', 'dmsans.ttf')

def font(path,size,weight):
    f=ImageFont.truetype(path,size)
    try: f.set_variation_by_axes([weight])
    except Exception: pass
    return f

# Barre d'etat et barre de navigation d'Android, mesurees par definition de
# capture. Valeurs fixes plutot que detection automatique : la detection par
# luminosite se trompait sur la capture de victoire, dont le bas est occupe par
# un bouton vert sombre. Si le telephone ou la definition changent, remesurer.
#   945 x 2048  : captures du 28/08/2026, Samsung passe par WhatsApp ;
#   1440 x 3120 : captures du 19/09/2026 par `adb exec-out screencap` sur le
#                 Galaxy S24 Ultra du proprietaire (sans compression).
BARRES = {
    (945, 2048): (85, 1930),
    (1440, 3120): (130, 2951),
}

def rogner_barres(im):
    """Retire l'heure, l'operateur, la batterie et les touches systeme : ils
    n'apportent rien a la fiche et datent la capture."""
    w, h = im.size
    if (w, h) not in BARRES:
        raise SystemExit(f'definition inconnue {w}x{h} : mesurer les barres et les ajouter a BARRES')
    haut, bas = BARRES[(w, h)]
    return effacer_poignee(im.crop((0, haut, w, min(bas, h))))

# Largeur de la poignee du panneau lateral Samsung (barre grise collee au bord
# gauche de l'ecran, sur les captures du 19/09/2026). On la recouvre avec la
# colonne voisine : le fond de l'appli y est uni.
POIGNEE = 12

def effacer_poignee(im):
    im = im.convert('RGB')
    colonne = im.crop((POIGNEE, 0, POIGNEE + 1, im.height))
    for x in range(POIGNEE):
        im.paste(colonne, (x, 0))
    return im

def ajuster(d,texte,chemin,taille,poids,largeur_max):
    while taille>20:
        f=font(chemin,taille,poids)
        bb=d.textbbox((0,0),texte,font=f)
        if bb[2]-bb[0]<=largeur_max: return f
        taille-=2
    return font(chemin,taille,poids)

def composer(source,titre,soustitre,sortie):
    shot=rogner_barres(Image.open(source))
    toile=Image.new('RGB',(W,H),CREAM); d=ImageDraw.Draw(toile)
    ft=ajuster(d,titre,DM,62,700,W-120)
    fs=ajuster(d,soustitre,DM,34,400,W-140)
    def centrer(t,f,y):
        bb=d.textbbox((0,0),t,font=f)
        d.text((W/2-(bb[2]-bb[0])/2-bb[0],y),t,font=f,fill=GREEN)
    centrer(titre,ft,96)
    d.rectangle([W/2-46,192,W/2+46,197],fill=ORANGE)
    centrer(soustitre,fs,226)
    zone=H-300-60
    ratio=shot.width/shot.height
    h=zone; w=int(h*ratio)
    if w>W-140: w=W-140; h=int(w/ratio)
    shot=shot.resize((w,h),Image.LANCZOS)
    masque=Image.new('L',(w,h),0); ImageDraw.Draw(masque).rounded_rectangle([0,0,w-1,h-1],radius=34,fill=255)
    x=(W-w)//2; y=300+(zone-h)//2
    toile.paste(shot,(x,y),masque)
    d.rounded_rectangle([x,y,x+w-1,y+h-1],radius=34,outline=(214,203,178),width=3)
    toile.save(sortie,'PNG',optimize=True)
    print(os.path.basename(sortie), toile.size, f"{os.path.getsize(sortie)//1024} ko")

# Bandeaux au « tu » depuis le 19/09/2026, comme l'appli. Les noms de fichiers
# sources sont ceux des captures du 28/08 : les remplacer par ceux des
# nouvelles captures, même écran pour même bandeau.
if __name__ == '__main__':
    # src : dossier des captures brutes, nommees duel / defi / victoire /
    # quetes / epicerie (.png ou .jpeg) ; dst : dossier des visuels.
    # Jamais le compte du proprietaire ni un vrai joueur a l'ecran : un profil
    # de test neutre (APK de debogage), et pas de classement, qui affiche
    # forcement de vrais pseudos. Les quetes le remplacent depuis le 19/09/2026.
    src=sys.argv[1]; dst=sys.argv[2]
    plan=[
      ('duel','1-duel.png',
       "Deux joueurs, une grille","Chacun son tour, sur la même grille."),
      ('defi','2-defi.png',
       "Un défi chaque jour","Une grille à thème, la même pour tous. Ta série grandit."),
      ('victoire','3-victoire.png',
       "Gagne, monte, débloque","Expérience et plumes à chaque partie."),
      ('quetes','4-quetes.png',
       "Des quêtes chaque jour","Trois par jour, une par semaine, des plumes à gagner."),
      ('epicerie','5-epicerie.png',
       "Compose ton profil","Avatars, cadres, animations. Aucun avantage en jeu."),
    ]
    for base,nom,titre,soustitre in plan:
        fichier=next((f for f in os.listdir(src) if os.path.splitext(f)[0]==base), None)
        if not fichier: raise SystemExit(f'capture {base} absente de {src}')
        composer(os.path.join(src,fichier), titre, soustitre, os.path.join(dst,nom))

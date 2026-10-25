# python review.py <dir> <activity> <n> <mouthbox x0,y0,x1,y1>: loop sheet, mouth sheet, preview gif
import sys
from PIL import Image
D=sys.argv[1]+'/'; ACT=sys.argv[2]; N=int(sys.argv[3]); box=tuple(int(v) for v in sys.argv[4].split(','))
sel=[round(1+k*(N-1)/11) for k in range(12)]
tiles=[]
for k,n in enumerate(sel):
    im=Image.open(D+f'out/{ACT}-{n}.webp').convert('RGBA').resize((470,535))
    b=Image.new('RGBA',im.size,((40,40,60) if k%2==0 else (250,250,250))+(255,)); b.alpha_composite(im); tiles.append(b.convert('RGB'))
s=Image.new('RGB',(470*6,535*2))
for i,t in enumerate(tiles): s.paste(t,((i%6)*470,(i//6)*535))
s.resize((1880,535)).save(D+'loop-sheet.png')
tiles=[]
for n in [sel[i] for i in (0,2,4,6,8,10)]:
    for kind in ('','talk-'):
        im=Image.open(D+f'fr/{ACT}-{kind}{n}.png').convert('RGBA'); b=Image.new('RGBA',im.size,(255,255,255,255)); b.alpha_composite(im)
        tiles.append(b.convert('RGB').crop(box).resize((300,int(300*(box[3]-box[1])/(box[2]-box[0])))))
h=tiles[0].height; s=Image.new('RGB',(300*6,h*2))
for i,t in enumerate(tiles): s.paste(t,((i%6)*300,(i//6)*h))
s.save(D+'talk-sheet.png')
fr=[]
for n in range(1,N+1):
    im=Image.open(D+f'out/{ACT}-{n}.webp').convert('RGBA').resize((470,535),Image.LANCZOS)
    b=Image.new('RGBA',im.size,(70,48,110,255)); b.alpha_composite(im); fr.append(b.convert('RGB'))
fr=fr*2; fr[0].save(D+'preview.gif',save_all=True,append_images=fr[1:],duration=83,loop=0)

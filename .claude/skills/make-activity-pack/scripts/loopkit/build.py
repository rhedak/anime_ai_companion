"""python build.py config.json -- cut-out frames -> (water unmix) -> scale -> head-align -> talking set -> webp. See the make-activity-pack skill."""
import sys, os, json, math, numpy as np
cfg=json.load(open(sys.argv[1]))
D=cfg['dir']+'/'; ACT=cfg['activity']; start,end,step=cfg.get('start',0),cfg.get('end',0),cfg.get('step',2)
os.environ["IRIS"]=cfg.get('iris','default')
if cfg.get('hair'): os.environ['HAIR']=cfg['hair']
if cfg.get('mouth_thresh'): os.environ['MOUTH_THRESH']=str(cfg['mouth_thresh'])
sys.path.insert(0,"/Users/henrik/git/anime_ai_companion-dev/.claude/skills/make-activity-pack/scripts")
from PIL import Image
from scipy import ndimage as ndi
import face, mouth
K=np.array([255,0,255],np.float32)
WATER=[np.array(c,np.float32) for c in [(127,174,213),(225,240,250)]]
T=float(cfg.get('res',38)); AMIN=float(cfg.get('amin',0.14)); WATER_ON=cfg.get('water',False)
base=Image.open(D+'base-magenta.png')
def head(img):
    g=np.asarray(img.convert('L').crop(tuple(cfg.get('headbox',(250,40,650,330)))),dtype=np.float32); return g-g.mean()
def shift_of(img):
    a,b=head(base),head(img)
    f=np.fft.fft2(a)*np.conj(np.fft.fft2(b)); f/=np.abs(f)+1e-6
    r=np.fft.ifft2(f).real; y,x=np.unravel_index(r.argmax(),r.shape)
    if y>r.shape[0]//2: y-=r.shape[0]
    if x>r.shape[1]//2: x-=r.shape[1]
    return x,y
def premult_resize(im,size):
    a=np.asarray(im,dtype=np.float32); al=a[...,3:4]/255
    pm=np.concatenate([a[...,:3]*al,a[...,3:4]],axis=-1)
    chans=[np.asarray(Image.fromarray(pm[...,k]).resize(size,Image.LANCZOS),dtype=np.float32) for k in range(4)]
    pm=np.stack(chans,-1); al=np.clip(pm[...,3:4]/255,0,1)
    rgb=np.where(al>0.001,pm[...,:3]/np.maximum(al,0.001),0)
    return Image.fromarray(np.clip(np.concatenate([rgb,pm[...,3:4]],-1),0,255).astype(np.uint8),'RGBA')
def water_fix(n,i):
    orig=np.asarray(Image.open(D+f'full/f{i+1:03d}.png').convert('RGB'),dtype=np.float32)
    cut=np.asarray(Image.open(D+f'cut/c{n:02d}.png').convert('RGBA'),dtype=np.float32)
    alpha=cut[...,3]/255
    best_a=np.zeros(alpha.shape,np.float32); best_res=np.full(alpha.shape,1e9,np.float32); best_fg=np.zeros(orig.shape,np.float32)
    for W in WATER:
        d=W-K; a=np.clip(((orig-K)@d)/(d@d),0,1)
        res=np.linalg.norm(orig-(K+a[...,None]*d),axis=-1); take=res<best_res
        best_res=np.where(take,res,best_res); best_a=np.where(take,a,best_a)
        fg=np.clip((orig-(1-a[...,None])*K)/np.maximum(a[...,None],0.08),0,255); best_fg=np.where(take[...,None],fg,best_fg)
    fix=(best_res<T)&(best_a>AMIN)&(best_a<0.97)
    out=cut.copy(); out[...,:3]=np.where(fix[...,None],best_fg,out[...,:3]); na=np.where(fix,best_a,alpha)
    lab,cnt=ndi.label(na>0.03)
    if cnt:
        sizes=ndi.sum(np.ones_like(na),lab,range(1,cnt+1)); small=np.isin(lab,[k+1 for k,s in enumerate(sizes) if s<25]); na=np.where(small,0,na)
    na=np.where(na<AMIN*0.8,0,na); out[...,3]=na*255; out[...,:3]=np.where(na[...,None]>0,out[...,:3],0)
    return Image.fromarray(out.astype(np.uint8),'RGBA')
idx=cfg.get('frames') or list(range(start,end,step)); N=len(idx)
for d in ('lossless','fr','tmp','out'): os.makedirs(D+d,exist_ok=True)
W2,H2=cfg.get('size',(940,1070)); K2=W2/896
shifts=[]; 
for n,i in enumerate(idx,1):
    im=water_fix(n,i) if WATER_ON else Image.open(D+f'cut/c{n:02d}.png').convert('RGBA')
    shifts.append(shift_of(Image.open(D+f'full/f{i+1:03d}.png').convert('RGB')))
    premult_resize(im,(W2,H2)).save(D+f'lossless/{ACT}-{n}.png')
mdx=float(np.median([s[0] for s in shifts])); mdy=float(np.median([s[1] for s in shifts])); ok=[abs(sx-mdx)<=cfg.get('maxdev',7) and abs(sy-mdy)<=cfg.get('maxdev',7) for sx,sy in shifts]
good=[k for k,v in enumerate(ok) if v]
shifts=[shifts[k] if ok[k] else shifts[min(good,key=lambda g:min(abs(g-k),len(shifts)-abs(g-k)))] for k in range(len(shifts))]; tx,ty=(0,0) if cfg.get('noshift') else (round(mdx*K2),round(mdy*K2)); print('global shift',tx,ty,'frames',N); print('shifts',shifts)
if cfg.get('talk',True) is False:
    os.makedirs(D+'fr',exist_ok=True)
    for n in range(1,N+1):
        im=Image.open(D+f'lossless/{ACT}-{n}.png').convert('RGBA'); can=Image.new('RGBA',im.size,(0,0,0,0)); can.paste(im,(tx,ty)); can.save(D+f'fr/{ACT}-{n}.png')
        can.save(D+f'out/{ACT}-{n}.webp','WEBP',quality=90,alpha_quality=100,method=6)
    print('done (no talking set)'); sys.exit(0)
neutral=cfg['neutral']   # path of the pack's neutral (940x1070 png)
top,eyes=face.measure(neutral)
if len(eyes)>=2: (x0,y0,*_),(x1,y1,*_)=eyes[0],eyes[1]; nx,ny,nsp,nang=(x0+x1)/2,(y0+y1)/2,x1-x0,math.degrees(math.atan2(y1-y0,x1-x0))
else: nx,ny,nsp,nang=cfg['eyes']  # fallback by hand
if 'eyes' in cfg: nx,ny,nsp,nang=cfg['eyes']
print('neutral eye geometry',round(nx),round(ny),round(nsp),round(nang,1))
real=mouth.head_geometry; cur={}
def geometry(path):
    if path.endswith('cheer-1.png'): return real(path)
    dx,dy=shifts[cur['n']-1]; return (nx-(dx-mdx)*K2, ny-(dy-mdy)*K2, nang, nsp)
mouth.head_geometry=geometry
_mc=mouth.mouth_center
def wide_center(arr,mx,ey,spacing):
    c,box=_mc(arr,mx,ey,spacing)
    w=cfg.get('widen',12)
    if box is not None: box=(box[0]-w,box[1]-cfg.get('up',6),box[2]+w,box[3]+2)
    return c,box
mouth.mouth_center=wide_center
_er=mouth.erase_mouth; _lp=mouth.line_pixels
def dark_lp(sub):
    lum=0.3*sub[...,0].astype(float)+0.59*sub[...,1].astype(float)+0.11*sub[...,2].astype(float)
    return (sub[...,3]>200)&(lum<cfg.get('dark',95))
def erase_twice(arr,cx,cy,box):
    out=_er(arr,cx,cy,box)
    if cfg.get('dark',95)<=0: return out
    mcx,mcy=(box[0]+box[2])//2,(box[1]+box[3])//2
    big=(mcx-cfg.get('dwide',40),mcy-cfg.get('dup',12),mcx+cfg.get('dwide',40),mcy+cfg.get('ddown',6))
    mouth.line_pixels=dark_lp
    try: return _er(out,cx,cy,big)
    finally: mouth.line_pixels=_lp
mouth.erase_mouth=erase_twice
os.makedirs(D+'frames-raw',exist_ok=True)
Image.open(cfg['cheer']).convert('RGBA').save(D+'frames-raw/cheer-1.png')
cwd=os.getcwd(); os.chdir(D)
patch,sang=mouth.cheer_patch(); print('patch',patch.size,round(sang,1))
PAT=[2,2,3,3,2,2,1,1,3,3,2,2]
for n in range(1,N+1):
    im=Image.open(f'lossless/{ACT}-{n}.png').convert('RGBA')
    can=Image.new('RGBA',im.size,(0,0,0,0)); can.paste(im,(tx,ty)); can.save(f'fr/{ACT}-{n}.png')
    cur['n']=n
    q=np.asarray(Image.open(f'fr/{ACT}-{n}.png').convert('RGBA')).astype(int)
    dx,dy=shifts[n-1]; wx,wy=int(nx-(dx-mdx)*K2),int(ny-(dy-mdy)*K2+0.68*nsp)
    win=q[wy-22:wy+28,wx-50:wx+50]
    over=((win[...,3]>200)&(win[...,0]>170)&(win[...,1]>90)&(win[...,1]<200)&(win[...,2]<115)&(win[...,0]-win[...,2]>110)).sum() if cfg.get('skip_overlap') else 0
    if over>cfg.get('overlap_px',40):
        print('frame',n,'something covers her mouth: the quiet picture is used for the talking one'); Image.open(f'fr/{ACT}-{n}.png').convert('RGBA').save(f'fr/{ACT}-talk-{n}.png')
    else:
        outs,info=mouth.talk_frames(f'fr/{ACT}-{n}.png',f'tmp/s{n}-',patch,sang)
        t=Image.open(outs[PAT[(n-1)%len(PAT)]-1]).convert('RGBA'); t.save(f'fr/{ACT}-talk-{n}.png')
    for name in (f'{ACT}-{n}',f'{ACT}-talk-{n}'):
        Image.open(f'fr/{name}.png').convert('RGBA').save(f'out/{name}.webp','WEBP',quality=90,alpha_quality=100,method=6)
print('done')

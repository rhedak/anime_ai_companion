"""Water (or any see-through thing) in front of a magenta key: unmix it instead of letting the cut-out tint it violet.

Used for Risa's splash loop (see the make-activity-pack skill, "Water on a key"). Layout, all in one folder S (argv[1], with a trailing slash):
  full/fNNN.png      the video's frames (ffmpeg), 896 x 1024
  cut/cNN.png        the studio's cut-out of the chosen frames at full size (cutout.ts, key magenta, floor 0.02, no cleanPink)
  base-magenta.png   the pack's neutral on magenta at 896 x 1024 (to measure how far the head moved)
Output: lossless/ (940 x 1070 PNG) and out/ (lossy WebP q90, lossless alpha). Edit the range(56, 128, 2) in `shifts` for your own loop.
RES (default 38) is how far a pixel may be from the key-to-water line to count as water; AMIN (default 0.14) the least opacity kept (the video's noise on the key).
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as ndi
S=sys.argv[1]
K=np.array([255,0,255],np.float32)
WATER=[np.array(c,np.float32) for c in [(127,174,213),(225,240,250)]]
T=float(os.environ.get('RES','38')); AMIN=float(os.environ.get('AMIN','0.14'))
os.makedirs(S+'lossless',exist_ok=True); os.makedirs(S+'out',exist_ok=True)

def head(img):  # grey of the head area
    g=np.asarray(img.convert('L').crop((250,40,650,330)),dtype=np.float32)
    return g-g.mean()
base=Image.open(S+'base-magenta.png')
def shift_of(img):
    a,b=head(base),head(img)
    f=np.fft.fft2(a)*np.conj(np.fft.fft2(b)); f/=np.abs(f)+1e-6
    r=np.fft.ifft2(f).real; y,x=np.unravel_index(r.argmax(),r.shape)
    if y>r.shape[0]//2: y-=r.shape[0]
    if x>r.shape[1]//2: x-=r.shape[1]
    return x,y   # shift to apply to img to match base

def one(n,i):
    orig_im=Image.open(S+f'full/f{i+1:03d}.png').convert('RGB')
    orig=np.asarray(orig_im,dtype=np.float32)
    cut=np.asarray(Image.open(S+f'cut/c{n:02d}.png').convert('RGBA'),dtype=np.float32)
    alpha=cut[...,3]/255
    best_a=np.zeros(alpha.shape,np.float32); best_res=np.full(alpha.shape,1e9,np.float32); best_fg=np.zeros(orig.shape,np.float32)
    for W in WATER:
        d=W-K; a=np.clip(((orig-K)@d)/(d@d),0,1)
        res=np.linalg.norm(orig-(K+a[...,None]*d),axis=-1)
        take=res<best_res
        best_res=np.where(take,res,best_res); best_a=np.where(take,a,best_a)
        fg=np.clip((orig-(1-a[...,None])*K)/np.maximum(a[...,None],0.08),0,255)
        best_fg=np.where(take[...,None],fg,best_fg)
    fix=(best_res<T)&(best_a>AMIN)&(best_a<0.97)
    out=cut.copy()
    out[...,:3]=np.where(fix[...,None],best_fg,out[...,:3])
    na=np.where(fix,best_a,alpha)
    # drop tiny stray specks of alpha (video noise on the key)
    lab,cnt=ndi.label(na>0.03)
    if cnt:
        sizes=ndi.sum(np.ones_like(na),lab,range(1,cnt+1))
        small=np.isin(lab,[k+1 for k,s in enumerate(sizes) if s<25])
        na=np.where(small,0,na)
    na=np.where(na<AMIN*0.8,0,na)
    out[...,3]=na*255
    out[...,:3]=np.where(na[...,None]>0,out[...,:3],0)
    return Image.fromarray(out.astype(np.uint8),'RGBA'), orig_im

def premult_resize(im,size):
    a=np.asarray(im,dtype=np.float32); al=a[...,3:4]/255
    pm=np.concatenate([a[...,:3]*al,a[...,3:4]],axis=-1)
    chans=[np.asarray(Image.fromarray(pm[...,k]).resize(size,Image.LANCZOS),dtype=np.float32) for k in range(4)]
    pm=np.stack(chans,-1); al=np.clip(pm[...,3:4]/255,0,1)
    rgb=np.where(al>0.001,pm[...,:3]/np.maximum(al,0.001),0)
    return Image.fromarray(np.clip(np.concatenate([rgb,pm[...,3:4]],-1),0,255).astype(np.uint8),'RGBA')

shifts=[]
for n,i in enumerate(range(56,128,2),1):
    im,orig_im=one(n,i)
    dx,dy=shift_of(orig_im); shifts.append((dx,dy))
    im=premult_resize(im,(940,1070))
    im.save(S+f'lossless/activity-swimming-{n}.png')
    im.save(S+f'out/activity-swimming-{n}.webp',format='WEBP',quality=90,alpha_quality=100,method=6)
print('head shifts vs the neutral (dx,dy) min/max:',min(s[0] for s in shifts),max(s[0] for s in shifts),min(s[1] for s in shifts),max(s[1] for s in shifts))

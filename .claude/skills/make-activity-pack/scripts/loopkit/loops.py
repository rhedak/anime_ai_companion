# python loops.py <dir> <minperiod> [maxperiod]: the pairs of frames that close a loop best
import sys, numpy as np, glob
from PIL import Image
d=sys.argv[1]; lo=int(sys.argv[2]); hi=int(sys.argv[3]) if len(sys.argv)>3 else 10**6
fs=sorted(glob.glob(d+'/full/f*.png'))
A=np.stack([np.asarray(Image.open(f).convert('RGB').resize((224,256)),dtype=np.float32) for f in fs]); n=len(A)
step2=np.mean([np.abs(A[i+2]-A[i]).mean() for i in range(n-2)])
best=sorted((np.abs(A[i]-A[j]).mean(),i,j) for i in range(n) for j in range(i+lo,min(n,i+hi+1)))
print('frames',n,'12fps step',round(step2,2))
for dd,i,j in best[:8]: print(round(dd/step2,2),'i',i,'j',j,'len',j-i)

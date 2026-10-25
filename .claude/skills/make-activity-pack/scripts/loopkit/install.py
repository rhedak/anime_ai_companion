# python install.py <pack> <activity-word> <workdir> <notes.md> <refname>: swaps the activity pictures of a pack in the packs repo for the new ones, keeps the old in ref/, replaces the activity section of PROCESS.md
import sys, os, re, shutil, glob
pack,act,work,notes,refname=sys.argv[1:6]
R='/Users/henrik/git/anime_ai_companion-packs/'
P=R+f'packs-src/{pack}/'
old=R+f'ref/{pack}-{act}-old/'; os.makedirs(old,exist_ok=True)
for f in glob.glob(P+f'activity-{act}-*'): shutil.move(f,old+os.path.basename(f))
for f in glob.glob(work+'/out/*.webp'): shutil.copy(f,P)
ref=R+f'ref/{refname}/'; os.makedirs(ref+'scripts',exist_ok=True)
shutil.copytree(work+'/lossless',ref+'loop-lossless',dirs_exist_ok=True)
for f in glob.glob(work+'/*.mp4'): shutil.copy(f,ref)
for f in glob.glob(work+'/base-magenta.png'): shutil.copy(f,ref)
for f in glob.glob(os.path.dirname(os.path.abspath(__file__))+'/*'): 
    if os.path.isfile(f): shutil.copy(f,ref+'scripts/')
txt=open(P+'PROCESS.md').read()
m=re.search(r'^## [A-Za-z ]*activity frames[^\n]*\n',txt,re.M); end=txt.index('## Licence')
txt=txt[:m.start()]+open(notes).read().rstrip('\n')+'\n\n'+txt[end:]
open(P+'PROCESS.md','w').write(txt)
print('files in pack',len(os.listdir(P)))

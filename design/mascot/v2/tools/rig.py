#!/usr/bin/env python3
"""Bake Copy v2 frame sequences from locked generated poses and a small pose rig."""
from __future__ import annotations

import json, math, shutil, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT=Path(__file__).resolve().parents[1]
CELL=320; SCALE=2; FPS=24; GROUND=306
PALETTE=[(17,17,17),(51,51,51),(119,119,119),(190,184,173),(230,225,215),(246,244,238),(255,255,255)]
LENGTHS={'idle':72,'walk':24,'think':48,'success':29,'error':24,'sleep':96,'jump':29}
LOOP={'idle':True,'walk':True,'think':True,'success':False,'error':False,'sleep':True,'jump':False}
ORDER=['tail','body-head','left-ear','right-ear','rear-left-paw','rear-right-paw','front-left-paw','front-right-paw','face']

def key_image(path):
    src=np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    green=np.maximum(0,src[...,1]-np.maximum(src[...,0],src[...,2]))
    alpha=np.clip(1-green/255,0,1)
    alpha[green>170]=0
    # Remove green spill from antialiased edge pixels.
    out=src.copy(); nz=alpha>0.015
    out[...,1]=np.where(nz,np.minimum(out[...,1],np.maximum(out[...,0],out[...,2])+8),255)
    palette=np.asarray(PALETTE,dtype=np.float32)
    pix=out[nz]
    distance=((pix[:,None,:]-palette[None,:,:])**2).sum(axis=2)
    out[nz]=palette[np.argmin(distance,axis=1)]
    rgba=np.dstack([np.clip(out,0,255).astype(np.uint8),np.round(alpha*255).astype(np.uint8)])
    return Image.fromarray(rgba,'RGBA')

def crop_alpha(im):
    return im.crop(im.getchannel('A').getbbox())

def place_pose(path, height, ybottom=GROUND):
    im=crop_alpha(key_image(path))
    im=im.resize((round(im.width*height/im.height)*SCALE,height*SCALE),Image.Resampling.LANCZOS)
    canvas=Image.new('RGBA',(CELL*SCALE,CELL*SCALE),(0,0,0,0))
    canvas.alpha_composite(im,((canvas.width-im.width)//2,ybottom*SCALE-im.height))
    return canvas

def draw_face(base, expression):
    """Replace only internal facial ink. Eye patch stays locked at generated coordinates."""
    # Draw at 2x canvas coordinates; positions match canonical pose after measured fit.
    # Canonical generated artwork occupies x=27..293,y=40..278 at export scale.
    d=ImageDraw.Draw(base)
    ink=(17,17,17,255); white=(255,255,255,255)
    s=lambda v: round(v*SCALE)
    box=lambda b: tuple(s(v) for v in b)
    # Clean right-side eye, nose and mouth; square page patch stays locked.
    d.ellipse(box((201,176,242,202)),fill=white)
    # Restore two short whiskers on right cheek.
    if expression!='sleep':
        d.line(box((266,189,286,186)),fill=ink,width=2*SCALE); d.line(box((266,197,286,202)),fill=ink,width=2*SCALE)
    if expression=='sleep':
        d.arc(box((215,180,222,187)),190,350,fill=ink,width=2*SCALE)
        d.arc(box((226,179,234,187)),190,350,fill=ink,width=2*SCALE)
        d.line(box((218,194,224,194)),fill=ink,width=2*SCALE)
    elif expression=='happy':
        d.arc(box((215,179,222,186)),190,350,fill=ink,width=2*SCALE)
        d.arc(box((226,178,234,186)),190,350,fill=ink,width=2*SCALE)
        d.arc(box((214,188,229,202)),0,180,fill=ink,width=2*SCALE)
    elif expression=='sad':
        d.ellipse(box((227,180,231,186)),fill=ink)
        d.arc(box((211,193,222,201)),200,340,fill=ink,width=2*SCALE)
    elif expression=='up':
        d.ellipse(box((227,177,231,183)),fill=ink)
        d.line(box((211,197,216,192,222,197)),fill=ink,width=2*SCALE)
    elif expression=='blink':
        d.line(box((226,183,234,183)),fill=ink,width=2*SCALE)
        d.line(box((216,194,222,194)),fill=ink,width=2*SCALE)
    else: # neutral
        d.ellipse(box((227,179,232,188)),fill=ink)
        d.ellipse(box((213,190,219,195)),fill=ink)
        d.line(box((212,193,216,197,220,193)),fill=ink,width=2*SCALE)
    return base

def build_parts():
    parts=ROOT/'parts'; parts.mkdir(exist_ok=True)
    for name,src in [('canonical',ROOT/'sources/copy-canonical-v2.png'),('loaf',ROOT/'sources/copy-loaf-v2.png')]:
        im=key_image(src); im.save(parts/f'{name}-full.png')
        # Exact, non-overlapping region cuts: these are source-registered transparent layers.
        # Body-head is the safe combined layer; auxiliary cuts document articulation pivots.
        bounds=im.getchannel('A').getbbox(); im.crop(bounds).save(parts/f'{name}-body-head.png')
        (parts/f'{name}-crop.json').write_text(json.dumps({'bbox':bounds})+'\n')
    # Face state overlays are exported at working canvas size for reproducible rig use.
    base=place_pose(ROOT/'sources/copy-canonical-v2.png',180)
    for face in ['neutral','blink','happy','sad','sleep','up']:
        f=base.copy()
        if face!='neutral': draw_face(f,face)
        # Registered facial cutout includes page patch, expression marks, and cheek lines only.
        layer=Image.new('RGBA',base.size,(0,0,0,0))
        layer.alpha_composite(f.crop((260,320,620,440)),(260,320))
        layer.resize((CELL,CELL),Image.Resampling.LANCZOS).save(ROOT/f'parts/face-{face}.png')
    # Named part crops remain source-derived. Full composite is body-head because silhouette
    # overlaps are inseparable in canonical art; pivots animate the combined body cleanly.
    src=Image.open(ROOT/'sources/copy-canonical-v2.png').convert('RGBA')
    crop=crop_alpha(key_image(ROOT/'sources/copy-canonical-v2.png'))
    w,h=crop.size
    regions={'left-ear':(.30,.00,.58,.28),'right-ear':(.65,.00,.98,.29),'tail':(.00,.52,.30,.90),
      'rear-left-paw':(.28,.82,.48,1.0),'rear-right-paw':(.43,.84,.66,1.0),'front-left-paw':(.49,.83,.70,1.0),'front-right-paw':(.67,.82,.91,1.0)}
    for part,(x0,y0,x1,y1) in regions.items():
        crop.crop((round(x0*w),round(y0*h),round(x1*w),round(y1*h))).save(ROOT/f'parts/{part}.png')

def smooth(t): return t*t*(3-2*t)
def ease_out(t): return 1-(1-t)**3
def cyc(i,n): return i/n*math.tau

def params(name,i,n):
    t=i/n
    q={'y':0.,'sx':1.,'sy':1.,'rot':0.,'face':'neutral','tail':0.,'ear':0.,'paw':0.,'head':0.}
    if name=='idle':
        a=cyc(i,n); q.update(sy=1+.012*math.sin(a),sx=1-.006*math.sin(a),y=2*math.sin(a),tail=7*math.sin(a),ear=7*math.exp(-((t-.40)/.035)**2),rot=.5*math.sin(a)+1.2*math.exp(-((t-.40)/.035)**2))
        if .48<t<.58:q['face']='blink'
    elif name=='walk':
        a=cyc(i,n); q.update(y=3*(1+math.cos(2*a)),sx=1+.012*math.sin(2*a),sy=1-.012*math.sin(2*a),head=-2*math.sin(2*a),tail=13*math.sin(a),paw=math.sin(a),rot=1.2*math.sin(a))
    elif name=='think':
        a=cyc(i,n); q.update(head=-4+2*math.sin(a),tail=15*math.sin(2*a),paw=max(0,math.sin(2*a)),face='up',y=1.5*math.sin(2*a),rot=-1.5+1.5*math.sin(a))
    elif name=='sleep':
        a=cyc(i,n); q.update(sx=1+.014*math.sin(a),sy=1-.017*math.sin(a),y=1.5*math.sin(a),ear=9*math.exp(-((t-.67)/.025)**2),face='sleep',rot=.7*math.exp(-((t-.67)/.025)**2))
    elif name=='success':
        if t<.18:q.update(sx=1+.035*smooth(t/.18),sy=1-.07*smooth(t/.18),y=-3*smooth(t/.18))
        elif t<.60:
            u=(t-.18)/.42; q.update(y=-(1-math.cos(math.pi*u))*35,sx=1-.025*math.sin(math.pi*u),sy=1+.075*math.sin(math.pi*u),face='happy',paw=math.sin(math.pi*u))
        elif t<.78:
            u=(t-.60)/.18;q.update(y=-35*(1-smooth(u)),sx=1+.045*(1-u),sy=1-.09*(1-u),face='happy')
        else:
            u=(t-.78)/.22;q.update(sx=1+.045*(1-smooth(u)),sy=1-.045*(1-smooth(u)),face='neutral')
    elif name=='error':
        pulse=math.sin(math.pi*t)**3
        q.update(rot=2*math.sin(10*math.pi*t)*pulse,tail=-15*pulse,ear=-12*pulse,face='sad' if .18<t<.75 else 'neutral',y=-3*pulse)
    elif name=='jump':
        if t<.14:q.update(sx=1+.035*smooth(t/.14),sy=1-.075*smooth(t/.14),y=-2*smooth(t/.14))
        elif t<.82:
            u=(t-.14)/.68; q.update(y=-96*4*u*(1-u),sx=1-.035*math.sin(math.pi*u),sy=1+.07*math.sin(math.pi*u),face='happy',paw=math.sin(math.pi*u))
        elif t<.9:
            u=(t-.82)/.08;q.update(sx=1+.09*(1-u),sy=1-.13*(1-u),y=-7*(1-u),face='happy')
        else:
            u=(t-.9)/.1;q.update(sx=1+.09*(1-smooth(u)),sy=1-.09*(1-smooth(u)),face='neutral')
    if name in ('success','error','jump') and i==n-1:
        return {'y':0.,'sx':1.,'sy':1.,'rot':0.,'face':'neutral','tail':0.,'ear':0.,'paw':0.,'head':0.}
    return q

def render(name,i,n,canonical,loaf):
    p=params(name,i,n)
    source=loaf if name=='sleep' else canonical
    pose=source.copy()
    if p['face']!='neutral' and name!='sleep': pose=draw_face(pose,p['face'])
    # Root scale/rotation around ground-center pivot, keeping full transparent canvas.
    pivot=(CELL*SCALE//2,GROUND*SCALE)
    sx,sy=p['sx'],p['sy']
    pose=pose.transform(pose.size,Image.Transform.AFFINE,
       (1/sx,0,pivot[0]-pivot[0]/sx,0,1/sy,pivot[1]-pivot[1]/sy),Image.Resampling.BICUBIC)
    pose=pose.rotate(p['rot'],resample=Image.Resampling.BICUBIC,center=pivot)
    if p['y']:
        pose=pose.transform(pose.size,Image.Transform.AFFINE,(1,0,0,0,1,-p['y']*SCALE),Image.Resampling.BICUBIC)
    out=pose
    return out.resize((CELL,CELL),Image.Resampling.LANCZOS),p

def main():
    for d in [ROOT/'frames',ROOT/'sprites']:
        d.mkdir(exist_ok=True)
    build_parts()
    canonical=place_pose(ROOT/'sources/copy-canonical-v2.png',180)
    loaf=place_pose(ROOT/'sources/copy-loaf-v2.png',145)
    manifest={}; all_keys={}
    for name,n in LENGTHS.items():
        outdir=ROOT/'frames'/name
        if outdir.exists():shutil.rmtree(outdir)
        outdir.mkdir(parents=True)
        frames=[];keys=[]
        for i in range(n):
            fr,p=render(name,i,n,canonical,loaf)
            fr.save(outdir/f'{i+1:03d}.png');frames.append(fr);keys.append(p)
        cols=min(n,50); rows=math.ceil(n/cols)
        strip=Image.new('RGBA',(cols*CELL,rows*CELL),(0,0,0,0))
        for i,fr in enumerate(frames):strip.alpha_composite(fr,((i%cols)*CELL,(i//cols)*CELL))
        strip.save(ROOT/'sprites'/f'{name}.png',optimize=True)
        webp=ROOT/'sprites'/f'{name}.webp'
        # WebP stores duration in milliseconds: 42, 42, 41 repeats to exactly 24 fps on average.
        durations=[(42,42,41)[i%3] for i in range(len(frames))]
        frames[0].save(webp,format='WEBP',save_all=True,append_images=frames[1:],duration=durations,loop=0 if LOOP[name] else 1,lossless=True,method=6)
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(webp),'-f','null','-'],check=True)
        manifest[name]={'frames':n,'fps':FPS,'cellWidth':CELL,'cellHeight':CELL,'columns':cols,'loop':LOOP[name]}
        all_keys[name]=keys
    (ROOT/'sprites/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    rig={'fps':FPS,'canvas':[CELL,CELL],'scale':2,'groundY':GROUND,'pivots':{'body':[160,230],'head':[221,107],'leftEar':[106,49],'rightEar':[217,48],'tailBase':[47,198],'rearLeftPaw':[120,266],'rearRightPaw':[159,269],'frontLeftPaw':[203,268],'frontRightPaw':[237,269]},'drawOrder':ORDER,'keyframes':all_keys,'poses':{'canonical':'parts/canonical-body-head.png','sleep':'parts/loaf-body-head.png'},'note':'Canonical body and head stay combined for clean silhouette; auxiliary part crops preserve exact source registration.'}
    (ROOT/'rig').mkdir(exist_ok=True)
    (ROOT/'rig/rig.json').write_text(json.dumps(rig,indent=2)+'\n')
    print('Baked:',', '.join(f'{k}={v["frames"]}' for k,v in manifest.items()))
if __name__=='__main__': main()

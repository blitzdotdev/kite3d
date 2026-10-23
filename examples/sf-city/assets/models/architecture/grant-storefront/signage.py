"""Original inferred shop typography and notices, no reference photograph pixels."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
out=Path(__file__).parent/'textures';out.mkdir(exist_ok=True)
font='/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'
sans='/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
def f(n,serif=False):return ImageFont.truetype(font if serif else sans,n)
for name in ['lettering','notice','awning-ornament','small-notice']:
 im=Image.new('RGBA',(512,512));d=ImageDraw.Draw(im)
 if name=='lettering':
  d.text((256,145),'Wine & Spirits',font=f(52,True),fill='#d9d2b5',anchor='mm');d.text((256,205),'NORTH BEACH',font=f(25),fill='#d9d2b5',anchor='mm');d.text((256,325),'OPEN',font=f(34),fill='#d9d2b5',anchor='mm')
 elif name=='awning-ornament':
  d.text((256,250),'Grant Avenue',font=f(54,True),fill='#b8a66e',anchor='mm');d.line((60,290,452,290),fill='#b8a66e',width=2)
 else:
  d.rectangle((8,8,504,504),fill='#c7bfa5' if name=='notice' else '#a4b4b0');d.rectangle((24,24,488,488),outline='#333d37',width=7)
  d.text((256,85),'NEIGHBORHOOD',font=f(32),fill='#253c35',anchor='mm');d.text((256,139),'MUSIC',font=f(67,True),fill='#713c31',anchor='mm')
  for k in range(7):d.line((65,215+k*27,448-(k%3)*35,215+k*27),fill='#54574d',width=5)
  d.text((256,450),'NORTH BEACH',font=f(26),fill='#253c35',anchor='mm')
 im.save(out/(name+'.png'))
# Original varied display cards, deliberately generic rather than real event claims.
for i,(title,bg,ink) in enumerate([('JAZZ','#d2b64a','#283d3e'),('BOOKS','#b8c7bd','#673e35'),('ART','#d1c0aa','#39445c'),('LOCAL','#b78365','#eee1bc')]):
 im=Image.new('RGBA',(256,384),bg);d=ImageDraw.Draw(im)
 d.rectangle((12,12,244,372),outline=ink,width=3)
 d.text((128,60),title,font=f(38,True),fill=ink,anchor='mm')
 if i%2:d.polygon([(35,245),(128,115),(220,245)],fill=ink)
 else:
  for r in [65,47,29]:d.ellipse((128-r,190-r,128+r,190+r),outline=ink,width=5)
 for k in range(3):d.line((35,290+k*15,220-(k%2)*30,290+k*15),fill=ink,width=3)
 im.save(out/('display-'+str(i)+'.png'))

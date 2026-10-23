// Original inferred opposite-street environment, not a captured photograph or survey.
import * as T from 'three'
const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(16,16)
const scene=new T.Scene();scene.background=new T.Color('#9bb4c7')
function box(x,y,z,w,h,d,color){const m=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshBasicMaterial({color}));m.position.set(x,y+h/2,z);scene.add(m)}
box(0,-.3,0,360,.3,160,'#373a3c')
// Grazing rays from the far shop panes hit the opposite frontage more than
// 60 m along the street. The initial short row ended before those rays arrived,
// leaving broad panes reflecting a featureless sky instead of street context.
for(const side of [-1,1])for(let i=-24;i<=24;i++){
 const x=i*6,z=side*15,front=z-side*.7,height=10+(i%3+3)%3*2
 box(x,0,z,5.9,height,1.2,['#b9b19b','#d0cbc0','#87998b'][(i+24)%3])
 for(let floor=0;floor<3;floor++)for(let col=-1;col<=1;col++){
  const xx=x+col*1.65,y=3.4+floor*2.8
  box(xx,y,front,1.12,1.95,.09,'#e4dfd0');box(xx,y+.07,front-side*.06,.95,1.8,.04,'#172026')
  if((i+col+floor)%3===0)box(xx,y+1.2,front-side*.1,.9,.6,.015,'#a4a49a')
 }
 box(x,.25,front,5.3,2.5,.08,'#141b1b');box(x,2.6,front-side*.35,5.5,.35,.7,i%2?'#243d36':'#563231')
 for(let k=-2;k<=2;k++)box(x+k,0,front-side*.08,.1,2.65,.1,'#9b9b87')
 box(x,height-.12,front,6,.16,.4,'#ddd8c9')
}
for(const x of [-23,-9,17,32]){
 box(x,0,8,.18,4,.18,'#4b4739')
 for(let j=0;j<16;j++){const t=j*2.3999,r=1+Math.sin(j*1.27)*.4;const m=new T.Mesh(new T.IcosahedronGeometry(.65+(j%3)*.2,1),new T.MeshBasicMaterial({color:['#25372b','#3d4b32','#526044','#18291f'][j%4]}));m.position.set(x+Math.cos(t)*r,3.6+(j%5)*.45,8+Math.sin(t)*r);scene.add(m)}
}
const cube=new T.WebGLCubeRenderTarget(512,{type:T.HalfFloatType});const camera=new T.CubeCamera(.1,220,cube);camera.position.y=2;camera.update(renderer,scene)
const width=2048,height=1024,target=new T.WebGLRenderTarget(width,height,{type:T.FloatType});const material=new T.ShaderMaterial({uniforms:{cube:{value:cube.texture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform samplerCube cube;varying vec2 vUv;void main(){float phi=(vUv.x-.5)*6.2831853;float theta=vUv.y*3.14159265;vec3 d=vec3(-sin(phi)*sin(theta),-cos(theta),-cos(phi)*sin(theta));gl_FragColor=textureCube(cube,d);}'})
const quad=new T.Scene();quad.add(new T.Mesh(new T.PlaneGeometry(2,2),material));renderer.setRenderTarget(target);renderer.render(quad,new T.Camera());const pixels=new Float32Array(width*height*4);renderer.readRenderTargetPixels(target,0,0,width,height,pixels)
// Radiance RGBE, uncompressed scanlines. Browser pixels are bottom-up.
const header=new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y '+height+' +X '+width+'\n'),bytes=new Uint8Array(header.length+width*height*4);bytes.set(header)
for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=((height-1-y)*width+x)*4,j=header.length+(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],v=Math.max(r,g,b);if(v<1e-20)continue;const e=Math.floor(Math.log2(v))+1,s=256/2**e;bytes[j]=r*s;bytes[j+1]=g*s;bytes[j+2]=b*s;bytes[j+3]=e+128}
let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));window.environmentHDR=btoa(binary);document.body.dataset.ready='true'

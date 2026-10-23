// Lossless Radiance scanline encoding for the original offline environment bake.
export function encodeRGBEScanlines(input) {
 const bytes=Buffer.from(input),header=bytes.subarray(0,256).toString('ascii'),match=/\n-Y (\d+) \+X (\d+)\n/.exec(header)
 if(!match)throw new Error('Expected upright Radiance RGBE input')
 const height=Number(match[1]),width=Number(match[2]),offset=match.index+match[0].length
 if(width<8||width>32767||bytes.length-offset!==width*height*4)throw new Error('Expected uncompressed RGBE scanlines')
 const chunks=[bytes.subarray(0,offset)]
 for(let y=0;y<height;y++){
  const row=[2,2,width>>8,width&255]
  for(let c=0;c<4;c++){
   const at=x=>bytes[offset+(y*width+x)*4+c]
   let x=0
   while(x<width){
    let run=1;while(run<127&&x+run<width&&at(x+run)===at(x))run++
    if(run>=4){row.push(128+run,at(x));x+=run;continue}
    const start=x;x+=run
    while(x<width&&x-start<128){let n=1;while(n<4&&x+n<width&&at(x+n)===at(x))n++;if(n>=4)break;x+=Math.min(n,128-(x-start))}
    row.push(x-start);for(let i=start;i<x;i++)row.push(at(i))
   }
  }
  chunks.push(Buffer.from(row))
 }
 return Buffer.concat(chunks)
}

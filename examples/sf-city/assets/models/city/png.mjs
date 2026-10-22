import {deflateSync} from 'node:zlib'
// Minimal deterministic RGBA PNG writer for original procedural material swatches.
export function png(size, pixels) {
  function chunk(type,data) {
    const name=Buffer.from(type),body=Buffer.concat([name,data]);let crc=0xffffffff
    for(const b of body){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
    const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);body.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6
  const rows=Buffer.alloc(size*(size*4+1));for(let y=0;y<size;y++)pixels.copy(rows,y*(size*4+1)+1,y*size*4,(y+1)*size*4)
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])
}

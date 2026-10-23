// Geographic rectangle union without filling an expanded bounding rectangle.
export function validateRectangle(r){
 if(!Array.isArray(r)||r.length!==4||r.some(v=>typeof v!=='number'||!Number.isFinite(v))||r[0]>=r[2]||r[1]>=r[3]||Math.abs(r[0])>180||Math.abs(r[2])>180||Math.abs(r[1])>90||Math.abs(r[3])>90)throw new Error('Invalid geographic coverage rectangle')
 return r
}
function subtract(a,b){
 const w=Math.max(a[0],b[0]),s=Math.max(a[1],b[1]),e=Math.min(a[2],b[2]),n=Math.min(a[3],b[3]);if(w>=e||s>=n)return[a]
 return[[a[0],a[1],w,a[3]],[e,a[1],a[2],a[3]],[w,a[1],e,s],[w,n,e,a[3]]].filter(r=>r[0]<r[2]&&r[1]<r[3])
}
export function unionRectangles(rectangles){
 const output=[]
 // Sorting makes union partitioning independent of capture argument order.
 for(const rectangle of rectangles.map(r=>[...validateRectangle(r)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]||a[3]-b[3])){
  let remaining=[rectangle];for(const existing of output)remaining=remaining.flatMap(r=>subtract(r,existing));output.push(...remaining)
 }
 return output.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]||a[3]-b[3])
}
export const rectangleArea=rectangles=>rectangles.reduce((sum,r)=>sum+(r[2]-r[0])*(r[3]-r[1]),0)

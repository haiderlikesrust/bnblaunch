// Samples a logo's dominant colours in the browser to steer "Match the logo".
export async function logoPalette(dataUrl:string):Promise<string[]>{
  const image=new Image();image.src=dataUrl;await image.decode();
  const size=48,canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
  const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)return [];
  context.drawImage(image,0,0,size,size);
  const pixels=context.getImageData(0,0,size,size).data,buckets=new Map<number,{count:number;r:number;g:number;b:number}>();
  for(let i=0;i<pixels.length;i+=4){
    if(pixels[i+3]<128)continue;
    const [r,g,b]=[pixels[i],pixels[i+1],pixels[i+2]],key=(r>>5)<<6|(g>>5)<<3|(b>>5);
    const bucket=buckets.get(key)??{count:0,r:0,g:0,b:0};bucket.count++;bucket.r+=r;bucket.g+=g;bucket.b+=b;buckets.set(key,bucket);
  }
  const colours=[...buckets.values()].sort((a,b)=>b.count-a.count).map(v=>({r:v.r/v.count,g:v.g/v.count,b:v.b/v.count})),picked:typeof colours=[];
  for(const colour of colours){if(picked.length>=3)break;if(picked.every(p=>Math.abs(p.r-colour.r)+Math.abs(p.g-colour.g)+Math.abs(p.b-colour.b)>90))picked.push(colour);}
  const hex=(n:number)=>Math.round(n).toString(16).padStart(2,"0");
  return picked.map(c=>"#"+hex(c.r)+hex(c.g)+hex(c.b));
}

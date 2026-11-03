/** Keep only bounded native diagnostic text/gas values; never persist arbitrary payloads. */
const textKeys = new Set(['code','error_code','message','reason','description','errorMessage','error_description','simulation_error','revert_reason','revertReason']);
const gasKeys = new Set(['gas','gasLimit','gasUsed','estimatedGas','maxGas','blockGasLimit','gas_limit','gas_used','estimated_gas']);
const branches = new Set(['details','error','cause','simulation','simulation_error']);
/** A private trace link is displayed as inert text; never fetched or auto-opened. */
export function sanitizeDebugUrl(value: unknown): string | null {
  if(typeof value!=='string'||value.length>2048)return null;
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')return null;
    return url.origin+url.pathname;
  }catch{return null;}
}
function clean(value: string) {
  return value.slice(0,700)
    .replace(/https?:\/\/[^\s"'<>]+/gi,'[URL removed]')
    .replace(/(?:bearer\s+)[\w.\-]+/gi,'[credential removed]')
    .replace(/(?:signature|nonce|token|authorization|password|secret|calldata|rawtransaction)\s*[:=]\s*[^\s,;]+/gi,'[sensitive value removed]')
    .replace(/0x[\da-f]{8,}/gi,'[hex removed]')
    .replace(/[A-Za-z0-9_+\/-]{40,}(?:={0,2})/g,'[long value removed]')
    .slice(0,500);
}
export function sanitizeNativeDiagnostics(input: unknown): Record<string, unknown> {
  let remaining=2000;
  const visit=(value:unknown,depth:number):Record<string,unknown>=>{
    if(!value||typeof value!=='object'||depth>3||remaining<=0)return {};
    const result:Record<string,unknown>={};
    for(const [key,item] of Object.entries(value).slice(0,24)){
      if(key==='debugUrl'||key==='debug_url'){const url=sanitizeDebugUrl(item);result[key]=url??(typeof item==='string'?'[unsupported URL]':`[unavailable: ${item===null?'null':typeof item}]`);remaining-=url?.length??12;}else if(textKeys.has(key)&&typeof item==='string'){
        const text=clean(item).slice(0,remaining);remaining-=text.length;result[key]=text;
      }else if(gasKeys.has(key)&&(typeof item==='number'&&Number.isFinite(item)||typeof item==='string'&&/^\d{1,20}$/.test(item))){
        result[key]=item;remaining-=24;
      }else if(branches.has(key)){
        const child=visit(item,depth+1);result[key]=Object.keys(child).length?child:'[omitted]';
      }else if(/^[a-zA-Z_][a-zA-Z0-9_]{0,47}$/.test(key)&&!/(?:signature|nonce|token|authorization|password|secret|calldata|rawtransaction|address|wallet)/i.test(key)){result[key]='[omitted]';remaining-=key.length+12;}
      if(remaining<=0)break;
    }
    return result;
  };
  return visit(input,0);
}

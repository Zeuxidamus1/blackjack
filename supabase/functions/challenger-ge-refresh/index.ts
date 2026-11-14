import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Global, 15-minute-throttled, authenticated OSRS Wiki GE quote refresh.
 * Only this server function possesses Supabase's service role key.
 */
const endpoint = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const serviceHeaders = {
  "content-type": "application/json",
  "apikey": serviceKey,
  "authorization": "Bearer " + serviceKey
};
const cors = {
  "access-control-allow-origin": "https://zeuxidamus1.github.io",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS"
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers:{...cors,"content-type":"application/json"}
});
async function rpc(name: string, payload: object = {}) {
  const response = await fetch(endpoint + "/rest/v1/rpc/" + name, {
    method:"POST", headers:serviceHeaders, body:JSON.stringify(payload)
  });
  if(!response.ok) throw new Error(name + " HTTP " + response.status);
  return await response.json();
}

Deno.serve(async (request: Request) => {
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(request.method!=="POST") return reply(405,{error:"Method not allowed"});
  try {
    if(!endpoint || !serviceKey) return reply(503,{error:"Price service is not configured"});
    const jwt=(request.headers.get("authorization") || "").replace(/^Bearer /i,"");
    if(!jwt) return reply(401,{error:"Sign in first"});
    const response=await fetch(endpoint+"/auth/v1/user",{
      headers:{"apikey":serviceKey,"authorization":"Bearer "+jwt}
    });
    if(!response.ok) return reply(401,{error:"Invalid session"});
    const user=await response.json();
    if(!user?.id) return reply(401,{error:"Invalid session"});

    const claimed=await rpc("rips_claim_ge_refresh");
    if(!claimed) return reply(200,{status:"fresh",message:"Server quotes were checked recently"});

    const ids=await rpc("rips_ge_ids");
    const known=new Set<number>(Array.isArray(ids)?ids:[]);
    const upstream=await fetch("https://prices.runescape.wiki/api/v1/osrs/latest",{
      headers:{"user-agent":"ChallengerRips/1.0 (non-commercial; github.com/Zeuxidamus1/blackjack)"},
      signal:AbortSignal.timeout(12000)
    });
    if(!upstream.ok) throw new Error("OSRS Wiki GE returned "+upstream.status);
    const payload=await upstream.json();
    const now=Math.floor(Date.now()/1000);
    const quotes:{ge_id:number;guide:number;guide_time:string}[]=[];
    for(const [raw,value] of Object.entries(payload.data ?? {})){
      const geId=Number(raw);
      if(!known.has(geId)) continue;
      const quote=value as Record<string,number>;
      const sides=["high","low"].filter(side=>Number.isFinite(quote[side]) && quote[side]>0 &&
        Number.isFinite(quote[side+"Time"]) &&
        quote[side+"Time"]>now-7*86400 && quote[side+"Time"]<=now+300);
      if(!sides.length) continue;
      const recent=Math.max(...sides.map(side=>quote[side+"Time"]));
      const close=sides.filter(side=>recent-quote[side+"Time"]<=21600);
      const guide=Math.round(close.reduce((sum,side)=>sum+quote[side],0)/close.length);
      if(guide>0 && Number.isSafeInteger(guide)){
        quotes.push({ge_id:geId,guide,guide_time:new Date(recent*1000).toISOString()});
      }
    }
    if(!quotes.length) throw new Error("No fresh Grand Exchange quotes available");
    const changed=await rpc("rips_apply_ge_quotes",{quotes});
    await rpc("rips_mark_ge_refresh");
    return reply(200,{status:"updated",quotes:quotes.length,changed});
  }catch(error){
    console.error("GE refresh failed:",error);
    return reply(503,{error:"Unable to refresh live Grand Exchange prices"});
  }
});
<script lang="ts">
let { language, text, context="", hideMissing=false }: {language:string;text:string;context?:string;hideMissing?:boolean}=$props();
let url=$state("");let playing=$state(false);let failed=$state(false);let player:HTMLAudioElement|undefined;
$effect(()=>{const value=JSON.stringify([language,text.normalize("NFC").trim(),context]);let active=true;url="";failed=false;
(async()=>{try{const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));const id=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");const manifest=await audioManifest();if(active)url=manifest[id]?.url??"";}catch{if(active)failed=true;}})();return()=>{active=false;player?.pause();};});
async function play(rate:number){if(!url)return;player?.pause();player=new Audio(url);player.playbackRate=rate;player.preservesPitch=true;playing=true;player.onended=()=>playing=false;player.onerror=()=>{failed=true;playing=false;};try{await player.play();}catch{failed=true;playing=false;}}
</script>
<script module lang="ts">
let pending:Promise<Record<string,{url:string}>>|undefined;
function audioManifest():Promise<Record<string,{url:string}>>{return pending??=fetch("/audio/manifest.json").then(async r=>r.ok?await r.json() as Record<string,{url:string}>:{}).catch(()=>({}));}
</script>
<span class="audio-controls">{#if url&&!failed}<button type="button" aria-label={`Play pronunciation: ${text}`} onclick={()=>play(1)}>Listen</button><button type="button" aria-label={`Play slowly: ${text}`} onclick={()=>play(.75)}>Slow</button>{#if playing}<button type="button" onclick={()=>{player?.pause();playing=false;}}>Stop</button>{/if}{:else if !hideMissing || failed}<small>{failed?"Recording unavailable":"Pronunciation not recorded yet"}</small>{/if}</span>
<style>.audio-controls{display:inline-flex;gap:.4rem;flex-wrap:wrap;margin:.4rem 0}.audio-controls button{font-size:12px;padding:.3rem .5rem;border:1px solid #b9c7ad;border-radius:4px;background:white;color:#315945}.audio-controls small{font-size:10px;color:#737a6f}</style>

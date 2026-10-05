<script lang="ts">
import CoursePanel from "../client/components/CoursePanel.svelte";
import { session } from "../client/lib/stores.svelte";
let route = $state(location.hash.replace(/^#\/course\/?/, "") || "hu");
let email = $state(""); let password = $state(""); let error = $state(""); let busy = $state(false); let ready = $state(false); let signedIn = $state(false);
function navigate(next: string) { location.hash = `/course/${next}`; route = next; }
async function refresh() { try {const r = await fetch("/api/session"); signedIn = r.ok;} catch {error="Account service unavailable. You can still read public lessons.";} finally {ready = true;} }
refresh();
async function login(event: SubmitEvent) { event.preventDefault(); busy=true; error="";
try { const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})}); password=""; if(!r.ok)throw Error(r.status===429?"Too many attempts. Try again in 15 minutes.":"Could not sign in. Check your existing account details."); signedIn=true; }
catch(e){error=e instanceof Error?e.message:"Could not sign in";}finally{busy=false;} }
async function logout(){ await fetch("/api/logout",{method:"POST"}); session.value=null; signedIn=false; }
</script>
<svelte:window onhashchange={() => route=location.hash.replace(/^#\/course\/?/, "") || "hu"}/>
<header class="account"><strong>Langouste</strong>{#if signedIn}<span>Your practice syncs to your account.</span><button onclick={logout}>Sign out</button>{:else}<form onsubmit={login}><label>Email <input type="email" autocomplete="username" required bind:value={email}/></label><label>Password <input type="password" autocomplete="current-password" required bind:value={password}/></label><button disabled={busy}>Sign in</button></form><p>Lessons are public. Sign in with an existing Langouste account to save practice across devices.</p>{/if}{#if error}<p role="alert">{error}</p>{/if}</header>
{#if ready}{#key signedIn}<CoursePanel {route} onRouteChange={navigate} guest={!signedIn} hosted/>{/key}{/if}
<style>.account{padding:1rem 2rem;border-bottom:1px solid #ddd;display:flex;gap:1rem;flex-wrap:wrap;align-items:center}.account p{width:100%;margin:0;font-size:.9rem}form{display:flex;gap:.7rem;flex-wrap:wrap}label{display:flex;gap:.4rem;align-items:center}input{max-width:180px;padding:.4rem}button{padding:.5rem .9rem;border:1px solid #315945;border-radius:5px;background:#244e43;color:white}input{border:1px solid #b9c7ad;border-radius:4px;background:white} @media(max-width:500px){.account{padding:1rem}label{width:100%}}</style>

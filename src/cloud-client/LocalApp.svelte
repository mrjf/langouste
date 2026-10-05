<script lang="ts">
import StudyWorkspace from "../client/components/StudyWorkspace.svelte";
let route=$state(location.hash.replace(/^#\/course\/?/, "") || "hu");
function navigate(next:string){location.hash=`/course/${next}`;route=next;}
</script>
<svelte:window onhashchange={()=>route=location.hash.replace(/^#\/course\/?/, "") || "hu"}/>
<StudyWorkspace {route} onRouteChange={navigate}/>

<script lang="ts">
import type {SentenceSupport} from '../lib/course-reading-support';
import {readingPopoverStyle} from '../lib/popover-position';
let {support,language,anchor,onpointerenter,onpointerleave,onclose,onDictionary}:{support:SentenceSupport;language:string;anchor:HTMLElement|null;onpointerenter:()=>void;onpointerleave:()=>void;onclose:()=>void;onDictionary:()=>void}=$props();
let position=$state('');
function place(){if(anchor)position=readingPopoverStyle(anchor,540,true);}
$effect(()=>{if(anchor)place();});
</script>
<svelte:window onresize={place} onscroll={place}/>
<dialog open class="sentence-gloss-popover" aria-label="Sentence meaning" style={position} {onpointerenter} {onpointerleave} onfocusin={onpointerenter} onfocusout={onpointerleave}>
<div class="actions"><button type="button" onclick={onDictionary}>Word dictionary</button><button type="button" aria-label="Close sentence meaning" onclick={onclose}>Close</button></div>
<div class="interlinear-sentence" dir={language==='ar-EG'?'rtl':'ltr'}>{#each support.words as word}<span class="literal-word"><bdi class="literal-source" lang={language}>{word.surface}</bdi><span class="literal-gloss" lang="en" dir="ltr">{word.gloss}</span></span>{/each}</div>
<p class="natural-translation" lang="en" dir="ltr">{support.english}</p>
</dialog>
<style>
.sentence-gloss-popover{position:fixed;inset:auto;z-index:60;margin:0;padding:12px;overflow:auto;border:1px solid #c7c2b8;border-radius:3px;background:#fcfcf8;box-shadow:0 8px 24px #24352c25;color:#24352c;font:15px/1.5 system-ui,sans-serif;text-align:start;white-space:normal;box-sizing:border-box}.interlinear-sentence{display:flex;flex-wrap:wrap;gap:12px 18px}.literal-word{display:inline-flex;flex-direction:column;align-items:center;max-width:180px}.literal-source{font-size:19px}.literal-gloss{font-size:12px;color:#526057;text-align:center}.natural-translation{border-top:1px solid #d4dad2;padding-top:10px;margin:12px 0 0}.actions{display:flex;justify-content:space-between;gap:16px;margin-bottom:10px;direction:ltr}.actions button{font:13px/1.4 system-ui,sans-serif;color:#245c44;border:1px solid #a6b6a8;border-radius:3px;background:white;padding:5px 8px;min-height:32px}.actions button:focus-visible{outline:2px solid #245c44;outline-offset:2px}
</style>

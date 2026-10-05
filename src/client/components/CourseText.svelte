<script lang="ts">
import {courseTextParts,courseTransliteration} from '../lib/course-transliteration';
let {text,language,showTransliteration=true,transliteration,block=false}:{text:string;language:string;showTransliteration?:boolean;transliteration?:string;block?:boolean}=$props();
let displayText=$derived(language==='ar-EG'&&/[\u0621-\u065f]/u.test(text)?text.split(/\s+[—–]\s+(?=[A-Za-zʿʾ])/u)[0]:text);
let hasArabic=$derived(language==='ar-EG'&&/[\u0621-\u065f]/u.test(text));
</script>
{#if hasArabic && block && !/[A-Za-z]/u.test(displayText)}<span class="paired block"><bdi class="arabic" lang="ar-EG" dir="rtl">{displayText}</bdi>{#if showTransliteration}<span class="romanization" lang="ar-Latn" dir="ltr">{transliteration??courseTransliteration(displayText)}</span>{/if}</span>
{:else if hasArabic}{#each courseTextParts(displayText) as part}{#if part.arabic}<span class="paired"><bdi class="arabic" lang="ar-EG" dir="rtl">{part.text}</bdi>{#if showTransliteration}<span class="romanization" lang="ar-Latn" dir="ltr">{part.transliteration}</span>{/if}</span>{:else}{part.text}{/if}{/each}
{:else}{text}{/if}
<style>
.paired{display:inline-flex;flex-direction:column;vertical-align:middle;align-items:center;max-width:100%;text-align:center;gap:1px}.paired.block{display:flex;align-items:flex-start;text-align:start;width:fit-content}.arabic{font:400 28px/1.55 Tahoma,"Noto Sans Arabic",sans-serif;overflow-wrap:anywhere}.romanization{font:400 15px/1.4 system-ui,sans-serif;color:#526057;overflow-wrap:anywhere}.block .romanization{text-align:left}.block .arabic{text-align:right}.paired:only-child{margin:0}
</style>

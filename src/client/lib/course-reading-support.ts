import {courseTransliteration} from './course-transliteration';
import authored from '../../../content/ai-course/reading-support/lexicon.json';
import type { CourseSentence, CourseLanguage } from '../../types/course';
import type { FiloDocumentJson } from './stores.svelte';

export interface ReadingWord { surface: string; gloss: string; lemma: string; form: string; transliteration?:string; }
export interface SentenceSupport { words: ReadingWord[]; english: string; }
type Entry = {lemma:string;gloss:string;form:string};
const lexicon: Record<string,Record<string,Entry>> = authored.languages;
export const readingWordPattern = /[\p{Letter}\p{Mark}\p{Number}]+(?:['’.-][\p{Letter}\p{Mark}\p{Number}]+)*/gu;

/** Exact local surfaces only: no guessed lemmatization or remote lookup. */
export function courseReadingSupport(sentence:CourseSentence,language:CourseLanguage): {doc:FiloDocumentJson;support:SentenceSupport} {
 const encoder=new TextEncoder();
 const words:ReadingWord[]=[];
 const doc:FiloDocumentJson={id:`course-reading:${language}:${sentence.id}`,text:sentence.text,byteLength:encoder.encode(sentence.text).length,metadata:{language,provider:'course-authored'},tiers:[{id:'word',kind:'word',annotations:[]},{id:'dictionary',kind:'dictionary',annotations:[]},{id:'word.translation:en:literal',kind:'translation',annotations:[]}]};
 for(const match of sentence.text.matchAll(readingWordPattern)){
  const surface=match[0],key=surface.toLocaleLowerCase(language),entry=lexicon[language]?.[key];
  if(!entry)throw new Error(`Missing course reading word: ${language}/${surface}`);
  let gloss=entry.gloss,form=entry.form;
  if(language==='hu'){
   if(key==='egy')gloss=/\bone\b/i.test(sentence.english)?'one':'a / an';
   if(key==='az'&&((match.index===0&&/^Az (?:a|az) /u.test(sentence.text))||/^(?:[.,!?]| jobb| elég| probléma)/u.test(sentence.text.slice(match.index+surface.length)))){gloss='that';form='Demonstrative pronoun, not the definite article.';}
   if(key==='mondja'&&!/kérem/i.test(sentence.text)){gloss='says it';form='Third person singular present, definite.';}
   if(key==='ki'&&/próbáljuk ki/iu.test(sentence.text)){gloss='out [verbal prefix]';form='Separated prefix in kipróbál: try out.';}
   if(key==='értek'&&/egyet/iu.test(sentence.text)){gloss='I understand';form='értek egyet: first person singular of egyetért, with the prefix separated after nem.';}
   if(key==='még')gloss=/még egyszer/iu.test(sentence.text)?'once more [with egyszer]':/még nem/iu.test(sentence.text)?'yet':'still';
  }else{
   if(key==='إيه')gloss=sentence.text.includes('أوبن إيه آي')?'A [letter name]':'what';
   if(key==='بس')gloss=/\bonly\b/i.test(sentence.english)?'only':'but';
   if(key==='مهمة'){gloss='important [feminine]';form='Feminine predicate adjective, agreeing with الحقيقة.';}
   if(key==='بتقرا')gloss=/إنت|يا كريم/.test(sentence.text)?'you read':'it reads';
   if(key==='بتكتب')gloss='it writes';
   if(key==='عن'&&sentence.text.includes('منفصل عن')){gloss='from';form='Preposition in منفصل عن: separate from.';}
   if(key==='بتعمل'&&sentence.text.includes('وإنت بتعمل')){gloss='you are making';form='Second person singular habitual, with explicit إنت subject.';}
  }
  const word={surface,lemma:entry.lemma,gloss,form,transliteration:language==='ar-EG'?courseTransliteration(surface):undefined};words.push(word);
  const id=`word-${words.length-1}`,start=encoder.encode(sentence.text.slice(0,match.index)).length,end=start+encoder.encode(surface).length;
  doc.tiers[0].annotations.push({id,tierId:'word',kind:'word',start,end,payload:{text:surface},source:'course-authored'});
  doc.tiers[1].annotations.push({id:`dictionary-${id}`,tierId:'dictionary',kind:'dictionary',start,end,payload:{wordAnnotationId:id,surface,lemma:entry.lemma,language,definitions:[entry.gloss],senses:[],formDescription:form,contextMeaning:gloss},source:'course-authored'});
  doc.tiers[2].annotations.push({id:`literal-${id}`,tierId:'word.translation:en:literal',kind:'translation',start,end,payload:{sourceWordAnnotationId:id,text:gloss},source:'course-authored'});
 }
 return {doc,support:{words,english:sentence.english}};
}

/** Keep a multi-sentence authored row aligned at actual sentence boundaries. */
export function courseSentenceParts(sentence:CourseSentence,language:CourseLanguage):CourseSentence[]{
 const split=(text:string,lang:string)=>[...new Intl.Segmenter(lang,{granularity:'sentence'}).segment(text)].map(s=>s.segment);
 const source=split(sentence.text,language),english=split(sentence.english,'en');
 if(source.length===1)return [sentence];
 while(english.length>source.length && /^\s*\[/.test(english.at(-1)??'')){const tail=english.pop();english[english.length-1]+=tail;}
 if(source.length!==english.length)throw new Error(`Unaligned course sentence: ${sentence.id}`);
 return source.map((text,index)=>({...sentence,id:`${sentence.id}:sentence:${index}`,text,english:english[index].trim(),transliteration:language==='ar-EG'?courseTransliteration(text.trim()):undefined}));
}

/** A complete local entry from authored course forms, without guessed dictionary data. */
export function courseDictionaryEntry(term:string,language:CourseLanguage){
 const entries=lexicon[language]??{};
 const lemma=entries[term.toLocaleLowerCase(language)]?.lemma??term;
 const forms=Object.entries(entries).filter(([,entry])=>entry.lemma===lemma).map(([surface,entry])=>({term:surface,description:entry.form,meaning:entry.gloss}));
 const base=entries[lemma.toLocaleLowerCase(language)];
 return {term:lemma,language,source_term:lemma,source_url:null,target_source_url:null,form_description:null,definitions:base?[base.gloss]:[],senses:[],forms};
}

import authored from '../../../content/ai-course/reading-support/transliteration.json';
const words:Record<string,string>=authored.words;
const phrases:Record<string,string>=authored.phrases;
export const arabicWordPattern=/[\u0621-\u065f\u0660-\u0669\u0671-\u06d3]+/gu;
export function courseTransliteration(text:string):string {
 return phrases[text]??text.replace(arabicWordPattern,word=>words[word]??word);
}
export function courseTextParts(text:string):{text:string;arabic:boolean;transliteration:string}[]{
 return text.split(/([\u0600-\u06ff]+(?:[ \t]+[\u0600-\u06ff]+)*)/gu).filter(Boolean).map(text=>({text,arabic:/[\u0621-\u065f]/u.test(text),transliteration:courseTransliteration(text)}));
}
// A new version intentionally replaces the former per-view default-off behavior.
// Only an explicit choice made under this version persists; lesson records are untouched.
export const transliterationPreferenceKey='langouste-transliteration:v2';
export function readTransliterationPreference():boolean {
 try{return localStorage.getItem(transliterationPreferenceKey)!=='off';}catch{return true;}
}
export function saveTransliterationPreference(value:boolean):void {
 try{localStorage.setItem(transliterationPreferenceKey,value?'on':'off');}catch{/* The current view still honors the choice. */}
}

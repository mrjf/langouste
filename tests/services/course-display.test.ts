import {describe,expect,test} from 'bun:test';
import {loadCourseCatalog} from '../../src/services/course/catalog';
import {publicCourseLesson} from '../../src/services/course/public';
import {courseExerciseFeedback} from '../../src/services/course/state';
import {courseReadingSupport} from '../../src/client/lib/course-reading-support';
import {courseTextParts,courseTransliteration} from '../../src/client/lib/course-transliteration';
const lessons=await loadCourseCatalog();
describe('course display coverage',()=>{
 test('every Arabic run rendered from lesson content has Latin support',()=>{
  const missing=new Set<string>();
  function walk(value:unknown){if(typeof value==='string'){for(const part of courseTextParts(value))if(part.arabic&&/[\u0621-\u065f]/u.test(part.transliteration))missing.add(part.text);}else if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')for(const [key,v] of Object.entries(value))if(!['originalExercise','sourceIds','sources'].includes(key))walk(v);}
  for(const lesson of lessons.filter(l=>l.language==='ar-EG')){walk(publicCourseLesson(lesson));for(const e of lesson.exercises)walk(courseExerciseFeedback(e));for(const r of lesson.readings)for(const sentence of r.sentences){const {support}=courseReadingSupport(sentence,'ar-EG');for(const w of support.words){expect(w.transliteration).toBeTruthy();walk(w.lemma);walk(w.form);}}}
  expect([...missing]).toEqual([]);
 });
 test('choice meanings and correct markers are revealed only in feedback',()=>{
  for(const lesson of lessons){const visible=publicCourseLesson(lesson);for(const e of lesson.exercises.filter(e=>e.type==='choice')){const initial=visible.exercises.find(v=>v.id===e.id)!;expect(Object.values(initial.choiceSupport??{}).every(v=>!v.english)).toBe(true);const feedback=courseExerciseFeedback(e);expect(feedback.correctChoices?.length).toBeGreaterThan(0);for(const c of e.choices??[])if(/[\u0621-\u065f]/u.test(c))expect(feedback.choiceSupport?.[c]?.english).toBeTruthy();}}
 });
 test('all course counts and lesson identities remain stable',()=>{const prior=lessons.filter(l=>l.day<=32);expect(prior.length).toBe(64);expect(new Set(lessons.map(l=>l.id)).size).toBe(lessons.length);expect(prior.reduce((n,l)=>n+l.exercises.length,0)).toBe(1148);const ids=lessons.flatMap(l=>l.exercises.map(e=>e.id));expect(new Set(ids).size).toBe(ids.length);});
});

for(const [date,day] of [['2026-10-07',34],['2026-10-08',35]] as const)test(`${date} provides complete beginner lessons with grounded facts and varied tasks`,()=>{
 const daily=lessons.filter(l=>l.id.includes(date));expect(daily.length).toBe(2);
 for(const l of daily){expect(l.day).toBe(day);expect(l.estimatedMinutes).toBeGreaterThanOrEqual(30);expect(l.estimatedMinutes).toBeLessThanOrEqual(45);expect(l.vocabulary.length).toBe(10);expect(l.exercises.length).toBe(18);expect(new Set(l.exercises.map(e=>e.type)).size).toBe(5);
 for(const v of l.vocabulary){expect(v.term).toBeTruthy();expect(v.english).toBeTruthy();expect(v.example.english).toBeTruthy();if(v.plannedRole==='review')expect(lessons.some(old=>old.day<l.day&&old.language===l.language&&old.vocabulary.some(w=>w.id===v.id))).toBe(true);}
 for(const e of l.exercises){const target=(e.target.type==='vocabulary'?l.vocabulary:l.concepts).find(t=>t.id===e.target.id);expect(target).toBeDefined();expect(e.hint).toBeTruthy();expect(e.explanation).toBeTruthy();}
 expect(l.readings.filter(r=>r.sentences.some(s=>s.kind==='teaching-example')).every(r=>r.title.includes('Fictional'))).toBe(true);
 for(const s of l.sources)expect(s.publishedOn).toBe(date);
 }
});

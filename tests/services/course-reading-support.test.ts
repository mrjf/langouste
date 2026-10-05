import {describe,expect,test} from 'bun:test';
import {loadCourseCatalog} from '../../src/services/course/catalog';
import {courseReadingSupport,courseSentenceParts,readingWordPattern,courseDictionaryEntry} from '../../src/client/lib/course-reading-support';
import type {CourseSentence} from '../../src/types/course';
const lessons=await loadCourseCatalog();
describe('offline course reading dictionary',()=>{
 test('every displayed word has byte-aligned dictionary and literal-gloss annotations',()=>{
  const decoder=new TextDecoder(),encoder=new TextEncoder();let count=0;
  for(const lesson of lessons){
   const rows=[...lesson.readings.flatMap(r=>[...r.sentences,...(r.recognitionOnly??[])]),...lesson.vocabulary.map(v=>v.example),...lesson.concepts.flatMap(c=>c.examples),...(lesson.optionalDialogue??[]),...(lesson.instructionBlocks?.flatMap(b=>b.examples??[])??[])];
   for(const row of rows)for(const sentence of courseSentenceParts(row,lesson.language)){
    const {doc,support}=courseReadingSupport(sentence,lesson.language);
    expect(doc.tiers[0].annotations.length).toBe([...sentence.text.matchAll(readingWordPattern)].length);
    expect(support.words.length).toBe(doc.tiers[0].annotations.length);
    for(const [i,word] of doc.tiers[0].annotations.entries()){
     expect(decoder.decode(encoder.encode(sentence.text).slice(word.start,word.end))).toBe(support.words[i].surface);
     expect(support.words[i].gloss.trim().length).toBeGreaterThan(0);
     expect(support.words[i].lemma.trim().length).toBeGreaterThan(0);
     expect(doc.tiers[1].annotations[i].payload.wordAnnotationId).toBe(word.id);
     expect(doc.tiers[2].annotations[i].payload.text).toBe(support.words[i].gloss);
    }
    count++;
   }
  }
  expect(count).toBeGreaterThan(1800);
 });
 test('inflected surfaces and contextual homographs retain their actual meaning',()=>{
  const row=(text:string,english=''):CourseSentence=>({id:'test',text,english,kind:'teaching-example',sourceIds:[]});
  expect(courseReadingSupport(row('adatot'), 'hu').support.words[0]).toMatchObject({lemma:'adat',gloss:'data [object]'});
  expect(courseReadingSupport(row('مشفّرة'),'ar-EG').support.words[0].lemma).toBe('شفّر');
  expect(courseReadingSupport(row('Az az eszköz gyorsabb.'),'hu').support.words.slice(0,2).map(w=>w.gloss)).toEqual(['that','the']);
  expect(courseReadingSupport(row('دي إيه؟'),'ar-EG').support.words[1].gloss).toBe('what');
  expect(courseReadingSupport(row('أوبن إيه آي شركة.'),'ar-EG').support.words[1].gloss).toBe('A [letter name]');
  const split=courseSentenceParts(row('Ki segít? Mi ez?','Who helps? What is this?'),'hu');
  expect(split.map(s=>s.english)).toEqual(['Who helps?','What is this?']);
  expect(()=>courseReadingSupport(row('unprovidedword'),'hu')).toThrow('Missing course reading word');
 });
});

test('full dictionary entry resolves inflections and includes authored sibling forms',()=>{
 const entry=courseDictionaryEntry('جديدة','ar-EG');
 expect(entry.source_term).toBe('جديد');
 expect(entry.forms.map(f=>f.term)).toContain('جديدة');
 expect(entry.forms.map(f=>f.term)).toContain('جديد');
 expect(entry.definitions.length).toBeGreaterThan(0);
 expect(courseDictionaryEntry('عندها','ar-EG').forms.map(f=>f.term)).toContain('عندي');
 expect(courseDictionaryEntry('unprovidedword','hu').forms).toEqual([]);
});

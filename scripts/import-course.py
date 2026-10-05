"""Import authored course packets without creating learner events.
Usage: python3 scripts/import-course.py INPUT_DIRECTORY [OUTPUT_FILENAME]
Original packet remains unchanged. Validation completes before atomic replacement.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def sentence(raw, ident):
    return {"id": raw.get("id", ident), "text": raw.get("text") or raw.get("arabic") or raw.get("hungarian"), "english": raw["english"], "kind": "teaching-example", "sourceIds": [], **({"transliteration": raw["transliteration"]} if raw.get("transliteration") else {})}


def readable(value):
    if value is None: return ""
    if isinstance(value,str): return value
    if isinstance(value,bool): return str(value).lower()
    if isinstance(value,(int,float)): return str(value)
    if isinstance(value,list): return "\n".join(filter(None,(readable(x) for x in value)))
    if isinstance(value,dict):
        if value.get("arabic") or value.get("text") or value.get("hungarian"):
            return " · ".join(filter(None,[value.get("arabic",value.get("text",value.get("hungarian"))),value.get("transliteration"),value.get("english")]))
        return "\n".join(f'{k.replace("_"," ")}: {readable(v)}' for k,v in value.items() if k not in ["id","optionId","tokenOrder","pairs"])
    return ""


def collect_atoms(value, ident):
    out=[]
    if isinstance(value,list):
        for x in value: out.extend(collect_atoms(x,ident))
    elif isinstance(value,dict):
        if (value.get("arabic") or value.get("text") or value.get("hungarian")) and value.get("english"): out.append(sentence(value,ident+"-model"))
        else:
            for x in value.values(): out.extend(collect_atoms(x,ident))
    return out


def adapt(raw):
    lesson = dict(raw)
    lesson["sourceIds"] = [s["id"] for s in lesson.pop("sources")]
    lesson["route"] = [r if isinstance(r, str) else f'{r.get("title", r.get("section", "Practice"))} · {r.get("minutes", "")} min' for r in raw.get("route", [])]
    blocks = list(raw.get("instructionBlocks") or [])
    meta = raw.get("metadata", {})
    for key, title in [("startHere", "Start here"), ("scope", "A manageable first step"), ("editorialPolicy", "About the news")]:
        if meta.get(key): blocks.append({"title": title, "body": meta[key]})
    tr = raw.get("transliteration")
    if tr:
        blocks.append({"title": "Pronunciation key", "body": tr.get("description", "") + "\n" + "\n".join(tr.get("key", tr.get("conventions", []))), "examples": [sentence(x, f'{raw["id"]}-sound-{i}') for i,x in enumerate(tr.get("examples", []))]})
    if raw.get("supportWords"):
        blocks.append({"title": "Useful support words", "body": "Recognition support; these are not extra memorization targets.", "examples": [sentence(x, f'{raw["id"]}-support-{i}') for i,x in enumerate(raw["supportWords"])]})
    lesson["instructionBlocks"] = blocks
    dialogue = raw.get("optionalDialogue", [])
    lesson["optionalDialogue"] = dialogue if isinstance(dialogue, list) else [sentence(x, f'{raw["id"]}-dialogue-{i}') for i,x in enumerate(dialogue.get("lines", []) + dialogue.get("substitutions", []))]
    review = raw.get("review")
    if review:
        lesson["review"] = {**review, "prompts": [p if isinstance(p, str) else p["prompt"] for p in review.get("prompts", [])]}
    warmup = raw.get("warmupAndVocabulary", {})
    if warmup.get("instruction"): blocks.append({"title": "Warm up", "body": warmup["instruction"]})
    if review: lesson["review"]["prompts"] = [x if isinstance(x,str) else x["prompt"] for x in review.get("prompts", review.get("retrievalPrompts", review.get("exitCheck", [])))]
    result = []
    for source_exercise in raw["exercises"]:
        e = dict(source_exercise)
        o = e.get("originalExercise", {})
        e["trackInSrs"] = e.get("trackInSrs", True)
        atom = e.get("promptAtom")
        if not atom and isinstance(o.get("prompt"), dict) and o["prompt"].get("arabic"):
            atom = sentence(o["prompt"], e["id"]+"-cue")
        if atom: e["promptAtom"] = atom
        atoms = e.get("choiceAtoms", o.get("options", [])) if e["type"] == "choice" else e.get("tokenAtoms", e.get("cards", o.get("tokens", []))) if e["type"] == "order" else []
        if e["type"] == "order": e["choices"] = [a if isinstance(a,str) else a.get("text",a.get("arabic",a.get("hungarian"))) for a in (atoms or e.get("tokens", []))]
        e["choiceSupport"] = {a.get("text", a.get("arabic",a.get("hungarian"))): {"transliteration": a.get("transliteration"), "english": a.get("english")} for a in atoms if isinstance(a,dict)}
        original_answer = o.get("answer")
        if isinstance(original_answer,dict) and isinstance(original_answer.get("explanation"),str) and original_answer["explanation"] not in e["explanation"]:
            e["explanation"] += "\nModel explanation: " + original_answer["explanation"]
        if isinstance(original_answer,dict) and original_answer.get("acceptedEnglish"): e["acceptedAnswers"] = original_answer["acceptedEnglish"]
        if o.get("sourceStoryId") or o.get("sourceIds") or e.get("support") or e.get("pedagogicalType") == "supportedReconstruction": e["trackInSrs"] = False
        if o.get("display", {}).get("englishGloss", "").startswith("visible"): e["showChoiceEnglish"] = True
        e["supportAtoms"] = [sentence(a,e["id"]+f"-support-{i}") for i,a in enumerate(e.get("support",[])) if isinstance(a,dict) and a.get("english")]
        rubric = e.get("rubric") or e.get("grading") or o.get("grading") or e.get("answerPolicy")
        e["rubricText"] = readable(rubric.get("criteria",rubric.get("instructions"))) if isinstance(rubric,dict) else readable(rubric)
        e["rubricText"] = e["rubricText"] or "Compare the requested meaning and grammar with the model. Valid alternatives may exist."
        e["modelAnswer"] = readable(e.get("answerData", o.get("answer"))) or readable(e.get("modelAnswers",o.get("modelAnswers"))) or " / ".join(e["acceptedAnswers"])
        e["answerAtoms"] = collect_atoms(e.get("answerData", o.get("answer")), e["id"])
        if e.get("pedagogicalType") == "matching":
            pairs=[]
            answer_data = e.get("answerData", original_answer)
            if isinstance(answer_data,dict) and answer_data.get("pairs"):
                right={r["id"]:r for r in o["right"]}
                pairs=[(a, right[answer_data["pairs"][a["id"]]]["english"]) for a in o["left"]]
            elif isinstance(answer_data,list):
                for i,a in enumerate(answer_data):
                    if "left" in a: pairs.append((a["left"],a["right"]))
                    else:
                        word=next(v for v in raw["vocabulary"] if v["id"]==a["itemId"])
                        pairs.append(({"text":word["term"],"transliteration":word.get("transliteration"),"itemId":word["id"]},a["english"]))
            if not pairs: raise ValueError("Unsupported matching shape: "+e["id"])
            e["matchingPairs"]=[]
            for i,(left,right) in enumerate(pairs):
                native=left if isinstance(left,str) else left.get("text",left.get("arabic",left.get("hungarian")))
                word=next((v for v in raw["vocabulary"] if v["term"]==native),None)
                e["matchingPairs"].append({"id":str(i),"text":native,"transliteration":left.get("transliteration") if isinstance(left,dict) else None,"answer":right,"target": {"type":"vocabulary","id":word["id"],"semanticConcept":word.get("semanticConcept")} if word else None})
            e["type"]="matching"; e["choices"]=list(reversed([x[1] for x in pairs]));e["acceptedAnswers"]=[json.dumps({str(i):p[1] for i,p in enumerate(pairs)},ensure_ascii=False)]
            e["modelAnswer"]="\n".join(p["text"]+" → "+p["answer"] for p in e["matchingPairs"])
            e["trackInSrs"]=False
        elif not e["acceptedAnswers"] or e.get("assessmentMode")=="semanticSelfCheck" or (e["type"]=="recall" and any(x in str(e.get("grading", "")).lower() for x in ["semantic", "human", "self", "equivalent", "alternatives"])):
            e["type"]="self-check";e["trackInSrs"]=False
            e["acceptedAnswers"]=[e["modelAnswer"] or "Use the rubric to evaluate your response."]
        result.append(e)
    lesson["exercises"] = result
    return lesson


def main():
    source = Path(sys.argv[1]).resolve()
    name = sys.argv[2] if len(sys.argv) > 2 else "authored-course.json"
    if Path(name).name != name or not name.endswith('.json'): raise ValueError('Use a JSON basename')
    registry = json.loads((source/'source-registry.json').read_text())
    lessons = []
    authored = []
    aliases = json.loads((source/'id-aliases.json').read_text()) if (source/'id-aliases.json').exists() else {}
    for path in sorted(source.rglob('*.json')):
        data = json.loads(path.read_text())
        if isinstance(data, dict) and data.get('schemaVersion') == 1 and data.get('language') in ['hu', 'ar-EG'] and 'exercises' in data:
            authored.append(data)
    lexical_registry = {v['id']:v for v in json.loads((source/'vocabulary-registry.json').read_text())} if (source/'vocabulary-registry.json').exists() else {}
    words = {v['id']:v for l in authored for v in l['vocabulary']}
    concepts = {v['id']:v for l in authored for v in l['concepts']}
    plan = json.loads((source/'curriculum-30-days.json').read_text()) if (source/'curriculum-30-days.json').exists() else {}
    planned_sources = {day['day']:day['sourceIds'] for day in plan.get('days',[])}
    sources_by_id = {s['id']:s for s in registry}
    for data in authored:
        if not data['sources']: data['sources'] = [sources_by_id[id] for id in planned_sources.get(data['day'],[])]
        for e in data['exercises']:
            t=e['target'];t['id']=aliases.get(t['id'],t['id'])
            collection=data['vocabulary'] if t['type']=='vocabulary' else data['concepts']
            if not any(v['id']==t['id'] for v in collection):
                target_registry=words if t['type']=='vocabulary' else concepts
                collection.append({**target_registry[t['id']], 'plannedRole':'review'})
        for v in data['vocabulary']:
            v['id']=aliases.get(v['id'],v['id'])
            v['lexicalTerm']=lexical_registry.get(v['id'],v)['term']
        lessons.append(adapt(data))
    if not lessons: raise ValueError('No authored lessons found')
    bundle = {"schemaVersion": 1, "sourceRegistry": registry, "lessons": lessons}
    for filename,key in [("source-readings.json","sourceReadings"),("vocabulary-registry.json","vocabularyRegistry"),("concept-registry.json","conceptRegistry"),("id-aliases.json","idAliases")]:
        if (source/filename).exists(): bundle[key]=json.loads((source/filename).read_text())
    output = ROOT/'content/ai-course'/name
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', dir=output.parent, delete=False) as f:
        json.dump(bundle,f,ensure_ascii=False,indent=2); f.write('\n'); temp=Path(f.name)
    try:
        subprocess.run(['bun','scripts/validate-course.ts',str(temp)],cwd=ROOT,check=True)
        os.replace(temp,output)
    finally: temp.unlink(missing_ok=True)
    print(f'Installed {len(lessons)} lessons at {output}. No learner records were created.')

if __name__ == '__main__': main()

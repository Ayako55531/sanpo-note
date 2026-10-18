import {validDate,validMonth} from './core.js';

export function buildDutyCopies(templates,day){
 if(!validDate(day)||!Array.isArray(templates)||!templates.length||templates.length>100)throw Error('コピーする当番と日付を確認してください。');
 const ids=new Set();
 return templates.map(t=>{
  const persons=Array.isArray(t.persons)?[...t.persons]:[t.person];
  if(!['am','pm'].includes(t.slot)||typeof t.dog!=='string'||!t.dog||!persons.length||persons.length>8||persons.some(x=>typeof x!=='string'||!x)||new Set(persons).size!==persons.length)throw Error('コピーする当番の担当者・時間帯・グループを確認してください。');
  const id=`${day}_${t.slot}_${t.dog}`;if(ids.has(id))throw Error('コピーする当番が重複しています。');ids.add(id);
  return {id,data:{day,slot:t.slot,dog:t.dog,person:persons[0],persons}};
 });
}

export async function copyDutyPattern(sdk,db,templates,day){
 const copies=buildDutyCopies(templates,day),{doc,runTransaction}=sdk;
 await runTransaction(db,async tx=>{
  const refs=copies.map(x=>doc(db,'duties',x.id));
  const existing=await Promise.all(refs.map(r=>tx.get(r)));
  if(existing.some(x=>x.exists()))throw Error('コピー先に同じ時間帯・グループの当番があります。別の日付を選んでください。');
  copies.forEach((x,i)=>tx.set(refs[i],x.data));
 });
}

export function dutySignature(d){return d?JSON.stringify([d.day,d.slot,d.dog,Array.isArray(d.persons)?d.persons:[d.person]]):null}
export function buildDutySlotEdits(day,slot,assignments,expected=[]){
 if(!validDate(day)||!['am','pm'].includes(slot)||!Array.isArray(assignments)||!assignments.length||assignments.length>20||!Array.isArray(expected))throw Error('日付・時間帯・担当者を確認してください。');
 const seen=new Set();return assignments.map(a=>{
  if(typeof a.dog!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(a.dog)||seen.has(a.dog)||!Array.isArray(a.persons)||a.persons.length>8||new Set(a.persons).size!==a.persons.length||a.persons.some(uid=>typeof uid!=='string'||!uid))throw Error('グループごとに担当者を0〜8人選んでください。');
  seen.add(a.dog);const id=`${day}_${slot}_${a.dog}`,old=expected.find(d=>d.day===day&&d.slot===slot&&d.dog===a.dog);
  return {id,expected:dutySignature(old),data:a.persons.length?{day,slot,dog:a.dog,person:a.persons[0],persons:[...a.persons]}:null};
 });
}
export async function saveDutySlot(sdk,db,day,slot,assignments,expected){
 const changes=buildDutySlotEdits(day,slot,assignments,expected),{doc,runTransaction}=sdk;
 await runTransaction(db,async tx=>{
  const refs=changes.map(c=>doc(db,'duties',c.id)),current=await Promise.all(refs.map(r=>tx.get(r)));
  changes.forEach((c,i)=>{if(dutySignature(current[i].exists()?current[i].data():null)!==c.expected)throw Error('別の画面で当番が変更されています。最新に更新してから選び直してください。')});
  changes.forEach((c,i)=>{if(dutySignature(c.data)===c.expected)return;if(c.data)tx.set(refs[i],c.data);else if(current[i].exists())tx.delete(refs[i])});
 });
}

export async function saveAdminScheduleNote(sdk,db,uid,month,note,expectedRevision){
 if(!validMonth(month)||typeof note!=='string'||note.length>2000||!Number.isInteger(expectedRevision)||expectedRevision<0)throw Error('月と2,000文字以内のメモを確認してください。');
 const {doc,runTransaction,serverTimestamp}=sdk,ref=doc(db,'adminScheduleNotes',month);
 const conflict=()=>Error('別の画面でメモが更新されました。入力内容は残しています。「保存済みのメモを読み直す」で確認してください。');
 try{await runTransaction(db,async tx=>{
  const current=await tx.get(ref),revision=current.exists()?current.data().revision:0;
  if(revision!==expectedRevision)throw conflict();
  tx.set(ref,{note,revision:revision+1,updatedBy:uid,updatedAt:serverTimestamp()});
 })}catch(error){
  if(error.code==='permission-denied'&&sdk.getDoc){let current;try{current=await sdk.getDoc(ref)}catch{throw error}if((current.exists()?current.data().revision:0)!==expectedRevision)throw conflict()}
  throw error;
 }
}

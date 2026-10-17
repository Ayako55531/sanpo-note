import {validDate} from './core.js';

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

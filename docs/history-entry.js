import {monthKey,DEFAULT_GROUPS,groupMembers} from './core.js?v=20261018-group-all';
export function historicalInput(d){
 const start=new Date(d.startedAt),end=new Date(d.endedAt);
 if(typeof d.uid!=='string'||!d.uid||typeof d.dog!=='string'||!d.dog||!Number.isFinite(+start)||!Number.isFinite(+end)||+start<+new Date('2000-01-01T00:00:00+09:00')||+end<+start||+end>Date.now())throw Error('担当者と過去の開始・終了日時を確認してください。');
 if(!Number.isInteger(d.rate)||d.rate<0||d.rate>200000)throw Error('金額は0〜200,000円の整数で入力してください。');
 if(typeof d.reason!=='string'||!d.reason.trim()||d.reason.trim().length>500)throw Error('登録理由を1〜500文字で入力してください。');
 return {...d,startedAt:start,endedAt:end,period:monthKey(end),reason:d.reason.trim()};
}
export function historicalId(d){return 'past_'+encodeURIComponent(d.uid)+'_'+new Date(d.startedAt).getTime();}
export async function addHistoricalWalk(sdk,db,by,input){
 const d=historicalInput(input),{doc,runTransaction,serverTimestamp,Timestamp}=sdk,id=historicalId(d),ref=doc(db,'walks',id),ledgerRef=doc(db,'ledgers',d.uid,'months',d.period);
 await runTransaction(db,async tx=>{
  const prior=await tx.get(ref),person=(await tx.get(doc(db,'members',d.uid))).data(),config=(await tx.get(doc(db,'walkGroups',d.dog))).data()||DEFAULT_GROUPS[d.dog],ledger=(await tx.get(ledgerRef)).data();
  if(prior.exists())throw Error('同じ担当者・開始日時の記録が既にあります。散歩履歴を確認してください。');
  if(person?.role!=='member'||!config?.active)throw Error('担当者と散歩グループを確認してください。');
  if(person.allowanceEnabled===false&&d.rate!==0)throw Error('おこづかい対象外の人は0円で登録してください。');
  const groups=groupMembers(d.dog,config),locks=[];for(const group of groups)locks.push((await tx.get(doc(db,'dogLocks',group))).data()||{active:null});
  tx.set(ref,{uid:d.uid,dog:d.dog,rate:d.rate,startedAt:Timestamp.fromDate(d.startedAt),endedAt:Timestamp.fromDate(d.endedAt),period:d.period,food:false,water:false,clean:false,source:'admin-history',recordedBy:by,recordedAt:serverTimestamp(),recordReason:d.reason});
  tx.set(ledgerRef,{...ledger,total:(ledger?.total||0)+d.rate,count:(ledger?.count||0)+1,lastWalk:id,updatedAt:serverTimestamp(),receivedAt:null});
  groups.forEach((g,i)=>{const old=locks[i],at=old.completedAt?.toDate?old.completedAt.toDate():new Date(old.completedAt||0);if(+at<+d.endedAt)tx.set(doc(db,'dogLocks',g),{...old,active:old.active||null,completedAt:Timestamp.fromDate(d.endedAt),lastWalk:id,historicalWalk:id})});
 });return id;
}

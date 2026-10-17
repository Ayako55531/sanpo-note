import {DOGS,DEFAULT_GROUPS,DEFAULT_ANIMALS,monthKey} from './core.js';
export async function startWalk(sdk,db,uid,dog,allowanceEnabled=true){
  if(typeof dog!=='string'||!dog)throw Error('散歩グループを選んでください。');
  const {doc,collection,runTransaction,serverTimestamp}=sdk;
  const w=doc(collection(db,'walks')),d=doc(db,'dogLocks',dog),h=doc(db,'handlerLocks',uid);
  await runTransaction(db,async tx=>{const [dl,hl,g]=await Promise.all([tx.get(d),tx.get(h),tx.get(doc(db,'walkGroups',dog))]);const group=g.exists()?g.data():DEFAULT_GROUPS[dog];if(!group?.active)throw Error('利用できる散歩グループを選んでください。');if(dl.data()?.active||hl.data()?.active)throw Error('すでに担当者または犬が散歩中です。');tx.set(w,{uid,dog,rate:allowanceEnabled?group.rate:0,startedAt:serverTimestamp(),endedAt:null,food:false,water:false,clean:false,period:null});tx.set(d,{active:w.id});tx.set(h,{active:w.id})});
  return w.id;
}
export async function completeWalk(sdk,db,uid,id){
  const {doc,runTransaction,serverTimestamp,getDoc}=sdk;
  const w=doc(db,'walks',id),period=monthKey(),l=doc(db,'ledgers',uid,'months',period);
  try {
    await runTransaction(db,async tx=>{const walk=await tx.get(w);if(!walk.exists()||walk.data().uid!==uid)throw Error('この散歩を完了できません。');if(walk.data().endedAt)return;const data=(await tx.get(l)).data();tx.update(w,{endedAt:serverTimestamp(),food:true,water:true,clean:true,period});tx.set(doc(db,'dogLocks',walk.data().dog),{active:null});tx.set(doc(db,'handlerLocks',uid),{active:null});tx.set(l,{total:(data?.total||0)+walk.data().rate,count:(data?.count||0)+1,lastWalk:id,updatedAt:serverTimestamp(),receivedAt:null})});
  } catch(error) {
    // A competing completion can commit before the stale request reaches Rules.
    // Return the confirmed result only when this exact owned walk is complete.
    if(error.code!=='permission-denied')throw error;
    const completed=await getDoc(w);
    if(!completed.exists()||completed.data().uid!==uid||!completed.data().endedAt)throw error;
  }
  const r=await getDoc(w);return {id:r.id,...r.data()};
}
export async function receiveLedger(sdk,db,uid,period,expected){
  const {doc,runTransaction,serverTimestamp}=sdk,l=doc(db,'ledgers',uid,'months',period);
  await runTransaction(db,async tx=>{const d=(await tx.get(l)).data();if(!d||!d.total||period>=monthKey())throw Error('締め後の金額を確認してください。');if(d.receivedAt)return;if(d.total!==expected)throw Error('金額が更新されています。画面を開き直してください。');tx.update(l,{receivedAt:serverTimestamp()})});
}

// Locks are read in the same transaction as edits, so a concurrent start retries.
export async function saveCatalogEntry(sdk,db,kind,id,data){
 const {doc,runTransaction}=sdk,ref=doc(db,kind==='dogs'?'dogs':'walkGroups',id);
 await runTransaction(db,async tx=>{const old=(await tx.get(ref)).data()||(kind==='dogs'?DEFAULT_ANIMALS[id]:DEFAULT_GROUPS[id]);
 const groups=kind==='dogs'?[old?.groupId,data.groupId]:[id];
 for(const group of new Set(groups.filter(Boolean))){if((await tx.get(doc(db,'dogLocks',group))).data()?.active)throw Error('散歩中です。完了してから変更してください。')}
 if(kind==='dogs'&&data.groupId){const group=(await tx.get(doc(db,'walkGroups',data.groupId))).data()||DEFAULT_GROUPS[data.groupId];if(!group?.active)throw Error('利用できる散歩グループを選んでください。')}
 tx.set(ref,data);
 });
}

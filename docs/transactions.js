import {DOGS,DEFAULT_GROUPS,DEFAULT_ANIMALS,monthKey,walkGroups,cooldownUntil,groupMembers,isCombinedGroup} from './core.js?v=20261018-group-all';
const walkVersion=w=>JSON.stringify([w?.dog,w?.rate,w?.endedAt,w?.cancelledAt,w?.correctionId]);
// Rules may reject a stale write before the SDK returns a transaction conflict.
// Retry only after confirming this same walk actually changed; never weaken checks.
async function walkTransaction(sdk,db,ref,task){
 for(let attempt=0;attempt<3;attempt++){
  let version;
  try{return await sdk.runTransaction(db,async tx=>{const snap=await tx.get(ref);version=walkVersion(snap.data());return task(tx,snap)})}
  catch(error){if(error.code!=='permission-denied'||attempt===2)throw error;const current=await sdk.getDoc(ref);if(walkVersion(current.data())===version)throw error}
 }
}
export async function startWalk(sdk,db,uid,dog,allowanceEnabled=true){
 if(typeof dog!=='string'||!dog)throw Error('散歩グループを選んでください。');
 const {doc,collection,runTransaction,serverTimestamp}=sdk,w=doc(collection(db,'walks')),h=doc(db,'handlerLocks',uid);
 await runTransaction(db,async tx=>{
  const selected=await tx.get(doc(db,'walkGroups',dog)),selectedGroup=selected.exists()?selected.data():DEFAULT_GROUPS[dog],groups=groupMembers(dog,selectedGroup);if(!selectedGroup?.active)throw Error('利用できる散歩グループを選んでください。');const hl=await tx.get(h),locks=[],catalog=[];
  for(const g of groups){locks.push(await tx.get(doc(db,'dogLocks',g)));catalog.push(await tx.get(doc(db,'walkGroups',g)))}
  if(hl.data()?.active)throw Error('すでに担当者が散歩中です。');
  let rate=0;
  groups.forEach((g,i)=>{const group=catalog[i].exists()?catalog[i].data():DEFAULT_GROUPS[g],lock=locks[i].data();if(!group?.active)throw Error('利用できる散歩グループを選んでください。');if(lock?.active)throw Error('すでに犬が散歩中です。');if(cooldownUntil(lock)>Date.now())throw Error('散歩済みです。完了から6時間後に開始できます。');rate+=group.rate});
  const configuredRate=dog==='both'&&!selected.exists()?rate:selectedGroup.rate;
  tx.set(w,{uid,dog,rate:allowanceEnabled?configuredRate:0,startedAt:serverTimestamp(),endedAt:null,food:false,water:false,clean:false,period:null});
  groups.forEach((g,i)=>tx.set(doc(db,'dogLocks',g),{...locks[i].data(),active:w.id}));tx.set(h,{active:w.id});
 });return w.id;
}
export async function completeWalk(sdk,db,uid,id){
 const {doc,runTransaction,serverTimestamp,getDoc}=sdk,w=doc(db,'walks',id),period=monthKey(),l=doc(db,'ledgers',uid,'months',period);
 try{await walkTransaction(sdk,db,w,async(tx,walk)=>{
  if(!walk.exists()||walk.data().uid!==uid||walk.data().cancelledAt)throw Error('この散歩を完了できません。');if(walk.data().endedAt)return;
  const config=await tx.get(doc(db,'walkGroups',walk.data().dog)),groups=groupMembers(walk.data().dog,config.exists()?config.data():DEFAULT_GROUPS[walk.data().dog]);const data=(await tx.get(l)).data();tx.update(w,{endedAt:serverTimestamp(),food:true,water:true,clean:true,period});
  for(const g of groups)tx.set(doc(db,'dogLocks',g),{active:null,completedAt:serverTimestamp(),lastWalk:id});
  tx.set(doc(db,'handlerLocks',uid),{active:null});tx.set(l,{...data,total:(data?.total||0)+walk.data().rate,count:(data?.count||0)+1,lastWalk:id,updatedAt:serverTimestamp(),receivedAt:null});
 })}catch(error){if(error.code!=='permission-denied')throw error;const done=await getDoc(w);if(!done.exists()||done.data().uid!==uid||!done.data().endedAt||done.data().cancelledAt)throw error}
 const r=await getDoc(w);return {id:r.id,...r.data()};
}

// A correction and its audit, locks and monetary delta commit together.
export async function correctWalk(sdk,db,adminUid,id,dog,reason,cancel=false){
 const {doc,collection,runTransaction,serverTimestamp}=sdk;
 reason=reason.trim();if(!reason||reason.length>500)throw Error('訂正理由を1〜500文字で入力してください。');
 const ref=doc(db,'walks',id),audit=doc(collection(db,'walkEdits'));
 await walkTransaction(sdk,db,ref,async(tx,snap)=>{
  if(!snap.exists()||snap.data().cancelledAt)throw Error('訂正できる散歩が見つかりません。');
  const old=snap.data(),target=cancel?old.dog:dog,sourceConfig=await tx.get(doc(db,'walkGroups',old.dog)),targetConfig=await tx.get(doc(db,'walkGroups',target)),targetGroup=targetConfig.exists()?targetConfig.data():DEFAULT_GROUPS[target],groups=groupMembers(target,targetGroup),oldGroups=groupMembers(old.dog,sourceConfig.exists()?sourceConfig.data():DEFAULT_GROUPS[old.dog]),union=[...new Set([...oldGroups,...groups])];
  const person=(await tx.get(doc(db,'members',old.uid))).data(),locks={},catalog={};
  for(const g of union){locks[g]=(await tx.get(doc(db,'dogLocks',g))).data()||{active:null};catalog[g]=(await tx.get(doc(db,'walkGroups',g))).data()||DEFAULT_GROUPS[g]}
  const handler=await tx.get(doc(db,'handlerLocks',old.uid));
  let ledger,ledgerRef;if(old.endedAt){ledgerRef=doc(db,'ledgers',old.uid,'months',old.period);ledger=(await tx.get(ledgerRef)).data();if(!ledger)throw Error('集計が見つかりません。管理者に確認してください。')}
  if(!cancel){if(!targetGroup?.active)throw Error('利用できる散歩グループを選んでください。');for(const g of groups){if(!catalog[g]?.active)throw Error('利用できる散歩グループを選んでください。');if(!oldGroups.includes(g)&&(locks[g].active||cooldownUntil(locks[g])>Date.now()))throw Error('変更先は散歩中または6時間以内に散歩済みです。')}if(target===old.dog)throw Error('変更するグループを選んでください。')}
  const rate=cancel?0:person?.allowanceEnabled===true?(target==='both'&&!targetConfig.exists()?groups.reduce((n,g)=>n+catalog[g].rate,0):targetGroup.rate):0;
  const patch={dog:target,rate,cancelledAt:cancel?serverTimestamp():null,correctedAt:serverTimestamp(),correctedBy:adminUid,correctionId:audit.id};
  tx.update(ref,patch);tx.set(audit,{walkId:id,uid:old.uid,by:adminUid,at:serverTimestamp(),reason,beforeDog:old.dog,afterDog:target,beforeRate:old.rate,afterRate:rate,cancelled:cancel});
  // Preserve other, newer walks. Remove only this record's lock/cooldown.
  for(const g of union){const lock={...locks[g]},isTarget=!cancel&&groups.includes(g);let changed=false;
   if(lock.active===id&&!isTarget){lock.active=null;changed=true}
   if(lock.lastWalk===id&&!isTarget){lock.lastWalk=null;lock.completedAt=null;changed=true}
   if(isTarget&&!old.endedAt){if(lock.active&&lock.active!==id)throw Error('変更先は散歩中です。');lock.active=id;changed=true}
   if(isTarget&&old.endedAt&&(!lock.completedAt||lock.lastWalk===id||new Date(lock.completedAt.toDate?lock.completedAt.toDate():lock.completedAt)<new Date(old.endedAt.toDate?old.endedAt.toDate():old.endedAt))){lock.lastWalk=id;lock.completedAt=old.endedAt;changed=true}
   if(changed)tx.set(doc(db,'dogLocks',g),{...lock,correctionWalk:id});
  }
  if(cancel&&handler.data()?.active===id)tx.set(doc(db,'handlerLocks',old.uid),{active:null,correctionWalk:id});
  if(old.endedAt){const total=ledger.total+rate-old.rate,count=ledger.count-(cancel?1:0);if(total<0||count<0)throw Error('集計と記録が一致しません。');tx.set(ledgerRef,{...ledger,total,count,lastCorrection:id,updatedAt:serverTimestamp(),receivedAt:total!==ledger.total||count!==ledger.count?null:ledger.receivedAt})}
 });
}
export async function receiveLedger(sdk,db,uid,period,expected){
  const {doc,runTransaction,serverTimestamp}=sdk,l=doc(db,'ledgers',uid,'months',period);
  await runTransaction(db,async tx=>{const d=(await tx.get(l)).data();if(!d||!d.total||period>=monthKey())throw Error('締め後の金額を確認してください。');if(d.receivedAt)return;if(d.total!==expected)throw Error('金額が更新されています。画面を開き直してください。');tx.update(l,{receivedAt:serverTimestamp()})});
}

// Locks are read in the same transaction as edits, so a concurrent start retries.
export async function saveCatalogEntry(sdk,db,kind,id,data){
 const {doc,runTransaction}=sdk,ref=doc(db,kind==='dogs'?'dogs':'walkGroups',id);
 await runTransaction(db,async tx=>{const old=(await tx.get(ref)).data()||(kind==='dogs'?DEFAULT_ANIMALS[id]:DEFAULT_GROUPS[id]);
 if(kind!=='dogs'&&(['gin','chibi'].includes(id)&&(data.combined===true||data.name==='全員')||id==='both'&&data.combined===false))throw Error('銀・ちびと全員の対象を確認してください。');if(kind!=='dogs'&&old&&isCombinedGroup(id,old)!==isCombinedGroup(id,data))throw Error('登録済みグループの散歩対象は変更できません。新しいグループを作ってください。');
 const groups=kind==='dogs'?[old?.groupId,data.groupId]:[id,...groupMembers(id,old),...groupMembers(id,data)];
 for(const group of new Set(groups.filter(Boolean))){if((await tx.get(doc(db,'dogLocks',group))).data()?.active)throw Error('散歩中です。完了してから変更してください。')}
 if(kind==='dogs'&&data.groupId){const group=(await tx.get(doc(db,'walkGroups',data.groupId))).data()||DEFAULT_GROUPS[data.groupId];if(!group?.active||isCombinedGroup(data.groupId,group))throw Error('犬の所属先は銀・ちびなどの個別グループを選んでください。')}
 tx.set(ref,data);
 });
}

// Upgrade existing completed records without changing walks or money.
export async function backfillWalkStatus(sdk,db,walks){
 const {doc,runTransaction,getDoc}=sdk,latest=new Map(),configs=new Map();
 for(const w of walks)if(w.endedAt&&!w.cancelledAt){if(!configs.has(w.dog)){const snapshot=await getDoc(doc(db,'walkGroups',w.dog));configs.set(w.dog,snapshot.exists()?snapshot.data():DEFAULT_GROUPS[w.dog])}for(const group of groupMembers(w.dog,configs.get(w.dog))){const at=w.endedAt.toMillis?w.endedAt.toMillis():new Date(w.endedAt).getTime();if(at>(latest.get(group)?.at||0))latest.set(group,{w,at})}}
 for(const [group,{w}] of latest){const ref=doc(db,'dogLocks',group);await runTransaction(db,async tx=>{const old=(await tx.get(ref)).data();if(!old?.active&&!old?.completedAt)tx.set(ref,{active:null,completedAt:w.endedAt,lastWalk:w.id})})}
}

import {copyDutyPattern,saveDutySlot,saveAdminScheduleNote} from './duty-copy.js?v=20261018-submission-popup';
import {deleteHealthReport} from './health-delete.js';
import {initializeApp,deleteApp} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,browserSessionPersistence,signInWithEmailAndPassword,signOut,createUserWithEmailAndPassword,deleteUser} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js';
import {onSnapshot,getFirestore,collection,doc,getDoc,getDocs,query,where,orderBy,limit,startAfter,runTransaction,writeBatch,setDoc,updateDoc,deleteDoc,serverTimestamp,Timestamp} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';
import {checkHealth,checkEvent,validDate,applyCatalog,checkCatalog,checkUnavailable} from './core.js?v=20261018-family-nine';
import {startWalk,completeWalk,receiveLedger,saveCatalogEntry,correctWalk,backfillWalkStatus} from './transactions.js?v=20261018-family-nine';
export async function connect(config,domain){
  const application=initializeApp(config),auth=getAuth(application),db=getFirestore(application);
  const preferenceKey=`sanpo-keep-login:${config.projectId}`;
  let keepLogin=true;
  try{keepLogin=localStorage.getItem(preferenceKey)!=='false'}catch{}
  await setPersistence(auth,keepLogin?browserLocalPersistence:browserSessionPersistence);
  await auth.authStateReady();
  let profile,statusMigrated=false;
  const ref=(...p)=>doc(db,...p);
  const rows=async q=>(await getDocs(q)).docs.map(x=>({id:x.id,...x.data()}));
  const api={demo:false,
    get keepLoginPreference(){return keepLogin},
    async login(id,password,keep=keepLogin){await setPersistence(auth,keep?browserLocalPersistence:browserSessionPersistence);keepLogin=Boolean(keep);try{localStorage.setItem(preferenceKey,String(keepLogin))}catch{}await signInWithEmailAndPassword(auth,`${id}@${domain}`,password);return this.restore()},
    async restore(){if(!auth.currentUser)return null;const d=await getDoc(ref('members',auth.currentUser.uid));if(!d.exists()||!d.data().active){await signOut(auth);throw Error('このアカウントは利用できません。管理者に確認してください。')}profile={uid:d.id,...d.data()};return profile},
    async logout(){profile=null;await signOut(auth)},
    async catalog(){const [dogs,groups]=await Promise.all([rows(collection(db,'dogs')),rows(collection(db,'walkGroups'))]);const c={dogs,groups};applyCatalog(c);return c},
    async saveCatalog(kind,id,data){checkCatalog(kind,data);await saveCatalogEntry({doc,runTransaction},db,kind,id,data)},
    async members(){return rows(collection(db,'members'))},
    async walks(){const q=profile.role==='admin'?collection(db,'walks'):query(collection(db,'walks'),where('uid','==',profile.uid));return (await rows(q)).sort((a,b)=>(b.startedAt?.toMillis()||0)-(a.startedAt?.toMillis()||0))},
    async walkPage(cursor){let q=profile.role==='admin'?query(collection(db,'walks'),orderBy('startedAt','desc'),limit(101)):query(collection(db,'walks'),where('uid','==',profile.uid),orderBy('startedAt','desc'),limit(101));if(cursor)q=query(q,startAfter(cursor));const snap=await getDocs(q);return {walks:snap.docs.slice(0,100).map(x=>({id:x.id,...x.data()})),next:snap.docs.length>100?snap.docs[99]:null}},
    async correctWalk(id,dog,reason,cancel=false){return correctWalk({doc,collection,runTransaction,serverTimestamp,getDoc},db,profile.uid,id,dog,reason,cancel)},
    async correctionHistory(id){return rows(query(collection(db,'walkEdits'),where('walkId','==',id)))},
    async unavailable(month){let q=query(collection(db,'unavailability'),where('month','==',month));if(profile.role!=='admin')q=query(q,where('uid','==',profile.uid));return rows(q)},
    async adminScheduleNote(month){if(!/^(20[0-9]{2}|2100)(0[1-9]|1[0-2])$/.test(month))throw Error('月を確認してください。');const snapshot=await getDoc(ref('adminScheduleNotes',month));return snapshot.exists()?snapshot.data():{note:'',revision:0}},
    async saveAdminScheduleNote(month,note,revision){await saveAdminScheduleNote({doc,runTransaction,serverTimestamp,getDoc},db,profile.uid,month,note,revision);return {note,revision:revision+1}},
    async saveUnavailable(month,slots,note){checkUnavailable(month,slots,note);await setDoc(ref('unavailability',profile.uid+'_'+month),{uid:profile.uid,month,slots,note,submittedAt:serverTimestamp()})},
    async walkDetails(uid,period){return rows(query(collection(db,'walks'),where('uid','==',uid),where('period','==',period)))},
    watchLocks(callback,onError){return onSnapshot(collection(db,'dogLocks'),snap=>callback(snap.docs.map(d=>({id:d.id,...d.data()}))),onError)},
    async locks(){if(profile.role==='admin'&&!statusMigrated){const recent=await rows(query(collection(db,'walks'),where('endedAt','>',Timestamp.fromMillis(Date.now()-6*3600000))));await backfillWalkStatus({doc,runTransaction},db,recent);statusMigrated=true}return rows(collection(db,'dogLocks'))},
    async start(dog){return startWalk({doc,collection,runTransaction,serverTimestamp},db,profile.uid,dog,profile.allowanceEnabled!==false)},
    async complete(id){return completeWalk({doc,runTransaction,serverTimestamp,getDoc},db,profile.uid,id)},
    async markReported(id,kind='walks'){if(!['walks','health'].includes(kind))throw Error('報告の種類を確認してください。');await runTransaction(db,async tx=>{const r=ref(kind,id),snapshot=await tx.get(r);if(!snapshot.exists()||(kind==='walks'&&!snapshot.data().endedAt))throw Error('完了した散歩だけ報告済みにできます。');if(snapshot.data().lineReportedAt)return;tx.update(r,{lineReportedAt:serverTimestamp()})})},
    async ledgers(uid){return rows(collection(db,'ledgers',uid,'months'))},
    async receive(period,expected){return receiveLedger({doc,runTransaction,serverTimestamp},db,profile.uid,period,expected)},
    async calendar(month){const start=month.slice(0,4)+'-'+month.slice(4)+'-01',end=month.slice(0,4)+'-'+month.slice(4)+'-32';const load=name=>rows(query(collection(db,name),where('day','>=',start),where('day','<',end)));const [duties,events]=await Promise.all([load('duties'),load('events')]);return {duties,events}},
    async saveDuty(data,oldId){if(!validDate(data.day))throw Error('日付を確認してください。');const id=`${data.day}_${data.slot}_${data.dog}`;await runTransaction(db,async tx=>{const existing=await tx.get(ref('duties',id));if(existing.exists()&&id!==oldId)throw Error('同じ日・時間帯・犬の当番が登録済みです。');tx.set(ref('duties',id),data);if(oldId&&oldId!==id)tx.delete(ref('duties',oldId))})},
    async saveDutySlot(day,slot,assignments,expected){return saveDutySlot({doc,runTransaction},db,day,slot,assignments,expected)},
    async copyDuties(templates,day){return copyDutyPattern({doc,runTransaction},db,templates,day)},
    async deleteDuty(id){await deleteDoc(ref('duties',id))},
    async saveEvent(data,id){checkEvent(data);await setDoc(id?ref('events',id):doc(collection(db,'events')),data)},
    async deleteEvent(id){await deleteDoc(ref('events',id))},
    async health(cursor,dog){let q=dog?query(collection(db,'health'),where('dog','==',dog),orderBy('createdAt','desc'),limit(21)):query(collection(db,'health'),orderBy('createdAt','desc'),limit(21));if(cursor)q=query(q,startAfter(cursor));const snap=await getDocs(q);return {reports:snap.docs.slice(0,20).map(x=>({id:x.id,...x.data()})),next:snap.docs.length>20?snap.docs[19]:null}},
    async addHealth(data){checkHealth(data);const r=doc(collection(db,'health'));await setDoc(r,{...data,observedAt:Timestamp.fromDate(new Date(data.observedAt)),uid:profile.uid,createdAt:serverTimestamp()});return {id:r.id,...data,uid:profile.uid}},
    async deleteHealth(id){return deleteHealthReport({doc,collection,runTransaction,getDocs,query,limit,writeBatch,deleteDoc,getDoc},db,id)},
    async comments(id){return rows(query(collection(db,'health',id,'comments'),orderBy('createdAt')))},
    async comment(id,body){body=body.trim();if(!body||body.length>1000)throw Error('コメントは1〜1000文字で入力してください。');await setDoc(doc(collection(db,'health',id,'comments')),{uid:profile.uid,body,createdAt:serverTimestamp()})},
    async addMember(data){
      if(!/^[a-z0-9]{3,20}$/.test(data.handlerId)||!data.name.trim()||data.name.length>40||data.password.length<6||data.password.length>128)throw Error('ID・名前・6〜128文字の初期パスワードを確認してください。');
      const other=initializeApp(config,'member-'+crypto.randomUUID()),otherAuth=getAuth(other);await setPersistence(otherAuth,browserSessionPersistence);let created;
      try{created=await createUserWithEmailAndPassword(otherAuth,`${data.handlerId}@${domain}`,data.password);await runTransaction(db,async tx=>{const idRef=ref('memberIds',data.handlerId);if((await tx.get(idRef)).exists())throw Error('そのIDは登録済みです。');tx.set(ref('members',created.user.uid),{handlerId:data.handlerId,name:data.name.trim(),role:data.role,active:true,allowanceEnabled:data.allowanceEnabled});tx.set(idRef,{uid:created.user.uid})})}
      catch(e){if(created)try{await deleteUser(created.user)}catch{throw Error('登録途中で停止しました。FirebaseのAuthenticationで、このIDの未登録アカウントを確認してください。')}throw e}
      finally{await signOut(otherAuth);await deleteApp(other)}
    },
    async updateMember(uid,data){if(uid===profile.uid)throw Error('自分自身の権限や利用状態は変更できません。');const [lock,person]=await Promise.all([getDoc(ref('handlerLocks',uid)),getDoc(ref('members',uid))]);if(lock.data()?.active&&(!data.active||data.role!==person.data().role))throw Error('散歩中です。完了してから利用状態や権限を変更してください。');await updateDoc(ref('members',uid),data)},
    async backup(){const adminScheduleNotes=await rows(collection(db,'adminScheduleNotes'));const unavailability=await rows(collection(db,'unavailability')),walkEdits=await rows(collection(db,'walkEdits'));const members=await this.members(),walks=await this.walks(),duties=await rows(collection(db,'duties')),events=await rows(collection(db,'events')),health=await rows(collection(db,'health'));const ledgers={},comments={};for(const m of members)ledgers[m.id]=await this.ledgers(m.id);for(const h of health)comments[h.id]=await this.comments(h.id);return {adminScheduleNotes,unavailability,walkEdits,catalog:await this.catalog(),version:3,exportedAt:new Date().toISOString(),members,walks,duties,events,health,ledgers,comments}}
  };return api;
}

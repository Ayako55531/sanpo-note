import {initializeApp,deleteApp} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import {getAuth,setPersistence,browserSessionPersistence,signInWithEmailAndPassword,signOut,createUserWithEmailAndPassword,deleteUser} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js';
import {getFirestore,collection,doc,getDoc,getDocs,query,where,orderBy,limit,startAfter,runTransaction,writeBatch,setDoc,updateDoc,deleteDoc,serverTimestamp,Timestamp} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';
import {checkHealth,checkEvent,validDate,applyCatalog,checkCatalog} from './core.js';
import {startWalk,completeWalk,receiveLedger,saveCatalogEntry} from './transactions.js';
export async function connect(config,domain){
  const application=initializeApp(config),auth=getAuth(application),db=getFirestore(application);
  await setPersistence(auth,browserSessionPersistence);
  await auth.authStateReady();
  let profile;
  const ref=(...p)=>doc(db,...p);
  const rows=async q=>(await getDocs(q)).docs.map(x=>({id:x.id,...x.data()}));
  const api={demo:false,
    async login(id,password){await signInWithEmailAndPassword(auth,`${id}@${domain}`,password);return this.restore()},
    async restore(){if(!auth.currentUser)return null;const d=await getDoc(ref('members',auth.currentUser.uid));if(!d.exists()||!d.data().active){await signOut(auth);throw Error('このアカウントは利用できません。管理者に確認してください。')}profile={uid:d.id,...d.data()};return profile},
    async logout(){profile=null;await signOut(auth)},
    async catalog(){const [dogs,groups]=await Promise.all([rows(collection(db,'dogs')),rows(collection(db,'walkGroups'))]);const c={dogs,groups};applyCatalog(c);return c},
    async saveCatalog(kind,id,data){checkCatalog(kind,data);await saveCatalogEntry({doc,runTransaction},db,kind,id,data)},
    async members(){return rows(collection(db,'members'))},
    async walks(){const q=profile.role==='admin'?collection(db,'walks'):query(collection(db,'walks'),where('uid','==',profile.uid));return (await rows(q)).sort((a,b)=>(b.startedAt?.toMillis()||0)-(a.startedAt?.toMillis()||0))},
    async walkPage(cursor){let q=profile.role==='admin'?query(collection(db,'walks'),orderBy('startedAt','desc'),limit(101)):query(collection(db,'walks'),where('uid','==',profile.uid),orderBy('startedAt','desc'),limit(101));if(cursor)q=query(q,startAfter(cursor));const snap=await getDocs(q);return {walks:snap.docs.slice(0,100).map(x=>({id:x.id,...x.data()})),next:snap.docs.length>100?snap.docs[99]:null}},
    async locks(){return rows(collection(db,'dogLocks'))},
    async start(dog){return startWalk({doc,collection,runTransaction,serverTimestamp},db,profile.uid,dog,profile.allowanceEnabled!==false)},
    async complete(id){return completeWalk({doc,runTransaction,serverTimestamp,getDoc},db,profile.uid,id)},
    async ledgers(uid){return rows(collection(db,'ledgers',uid,'months'))},
    async receive(period,expected){return receiveLedger({doc,runTransaction,serverTimestamp},db,profile.uid,period,expected)},
    async calendar(month){const start=month.slice(0,4)+'-'+month.slice(4)+'-01',end=month.slice(0,4)+'-'+month.slice(4)+'-32';const load=name=>rows(query(collection(db,name),where('day','>=',start),where('day','<',end)));const [duties,events]=await Promise.all([load('duties'),load('events')]);return {duties,events}},
    async saveDuty(data,oldId){if(!validDate(data.day))throw Error('日付を確認してください。');const id=`${data.day}_${data.slot}_${data.dog}`;await runTransaction(db,async tx=>{const existing=await tx.get(ref('duties',id));if(existing.exists()&&id!==oldId)throw Error('同じ日・時間帯・犬の当番が登録済みです。');tx.set(ref('duties',id),data);if(oldId&&oldId!==id)tx.delete(ref('duties',oldId))})},
    async deleteDuty(id){await deleteDoc(ref('duties',id))},
    async saveEvent(data,id){checkEvent(data);await setDoc(id?ref('events',id):doc(collection(db,'events')),data)},
    async deleteEvent(id){await deleteDoc(ref('events',id))},
    async health(cursor,dog){let q=dog?query(collection(db,'health'),where('dog','==',dog),orderBy('createdAt','desc'),limit(21)):query(collection(db,'health'),orderBy('createdAt','desc'),limit(21));if(cursor)q=query(q,startAfter(cursor));const snap=await getDocs(q);return {reports:snap.docs.slice(0,20).map(x=>({id:x.id,...x.data()})),next:snap.docs.length>20?snap.docs[19]:null}},
    async addHealth(data){checkHealth(data);await setDoc(doc(collection(db,'health')),{...data,observedAt:Timestamp.fromDate(new Date(data.observedAt)),uid:profile.uid,createdAt:serverTimestamp()})},
    async comments(id){return rows(query(collection(db,'health',id,'comments'),orderBy('createdAt')))},
    async comment(id,body){body=body.trim();if(!body||body.length>1000)throw Error('コメントは1〜1000文字で入力してください。');await setDoc(doc(collection(db,'health',id,'comments')),{uid:profile.uid,body,createdAt:serverTimestamp()})},
    async addMember(data){
      if(!/^[a-z0-9]{3,20}$/.test(data.handlerId)||!data.name.trim()||data.name.length>40||data.password.length<12||data.password.length>128)throw Error('ID・名前・12〜128文字の初期パスワードを確認してください。');
      const other=initializeApp(config,'member-'+crypto.randomUUID()),otherAuth=getAuth(other);await setPersistence(otherAuth,browserSessionPersistence);let created;
      try{created=await createUserWithEmailAndPassword(otherAuth,`${data.handlerId}@${domain}`,data.password);await runTransaction(db,async tx=>{const idRef=ref('memberIds',data.handlerId);if((await tx.get(idRef)).exists())throw Error('そのIDは登録済みです。');tx.set(ref('members',created.user.uid),{handlerId:data.handlerId,name:data.name.trim(),role:data.role,active:true,allowanceEnabled:data.allowanceEnabled});tx.set(idRef,{uid:created.user.uid})})}
      catch(e){if(created)try{await deleteUser(created.user)}catch{throw Error('登録途中で停止しました。FirebaseのAuthenticationで、このIDの未登録アカウントを確認してください。')}throw e}
      finally{await signOut(otherAuth);await deleteApp(other)}
    },
    async updateMember(uid,data){if(uid===profile.uid)throw Error('自分自身の権限や利用状態は変更できません。');const [lock,person]=await Promise.all([getDoc(ref('handlerLocks',uid)),getDoc(ref('members',uid))]);if(lock.data()?.active&&(!data.active||data.role!==person.data().role))throw Error('散歩中です。完了してから利用状態や権限を変更してください。');await updateDoc(ref('members',uid),data)},
    async backup(){const members=await this.members(),walks=await this.walks(),duties=await rows(collection(db,'duties')),events=await rows(collection(db,'events')),health=await rows(collection(db,'health'));const ledgers={},comments={};for(const m of members)ledgers[m.id]=await this.ledgers(m.id);for(const h of health)comments[h.id]=await this.comments(h.id);return {catalog:await this.catalog(),version:2,exportedAt:new Date().toISOString(),members,walks,duties,events,health,ledgers,comments}}
  };return api;
}

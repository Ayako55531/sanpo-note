// Stop new comments before removing children, so a concurrent comment cannot be orphaned.
// Re-running this operation safely resumes an interrupted deletion.
export async function deleteHealthReport(sdk,db,id){
 const {doc,collection,runTransaction,getDocs,query,limit,writeBatch,deleteDoc,getDoc}=sdk;
 const report=doc(db,'health',id);
 const exists=await runTransaction(db,async tx=>{const snapshot=await tx.get(report);if(!snapshot.exists())return false;if(!snapshot.data().deleting)tx.update(report,{deleting:true});return true});
 if(!exists)return;
 try{
  while(true){const comments=await getDocs(query(collection(db,'health',id,'comments'),limit(200)));if(comments.empty)break;const batch=writeBatch(db);for(const comment of comments.docs)batch.delete(comment.ref);await batch.commit()}
  await deleteDoc(report);
 }catch(error){if(!(await getDoc(report)).exists())return;throw error}
}

export const DOGS = {gin:{name:'銀',rate:1000},chibi:{name:'ちび',rate:500}};
export const HEALTH = {
  appetite:['ご飯・食欲',['未確認','いつも通り食べた','少ししか食べない','食べない']],
  stool:['うんち',['未確認','いつも通り','出なかった','ゆるい','水っぽい','かたい','血が混じる']],
  energy:['元気・様子',['未確認','いつも通り','元気がない','気になる様子がある']]
};
export const KINDS=['病院','予防接種','その他'];
export const yen=n=>Number(n||0).toLocaleString('ja-JP')+'円';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function asDate(v){return v?.toDate?v.toDate():new Date(v)}
export function jstParts(value=new Date()){
  const p=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(asDate(value));
  return Object.fromEntries(p.map(x=>[x.type,x.value]));
}
export function dateKey(value=new Date()){const p=jstParts(value);return `${p.year}-${p.month}-${p.day}`}
export function monthKey(value=new Date()){const p=jstParts(value);return p.year+p.month}
export function monthLabel(k){return `${k.slice(0,4)}年${Number(k.slice(4))}月`}
export function displayTime(value){if(!value)return '—';const p=jstParts(value);return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`}
export function shiftMonth(key,delta){const y=Number(key.slice(0,4)),m=Number(key.slice(4));const d=new Date(Date.UTC(y,m-1+delta,1));return String(d.getUTCFullYear()).padStart(4,'0')+String(d.getUTCMonth()+1).padStart(2,'0')}
export function validMonth(k){return /^\d{4}(0[1-9]|1[0-2])$/.test(k)&&Number(k)>=200001&&Number(k)<=210012}
export function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00+09:00');return !isNaN(d)&&dateKey(d)===s&&s>='2000-01-01'&&s<='2100-12-31'}
export function checkHealth(d){if(!DOGS[d.dog]||Object.entries(HEALTH).some(([k,s])=>!s[1].includes(d[k])))throw Error('犬と体調の項目を確認してください。');if(d.note.length>2000||(!d.note.trim()&&Object.keys(HEALTH).every(k=>d[k]==='未確認')))throw Error('気づいたことを1つ以上入力してください。');const t=new Date(d.observedAt);if(isNaN(t)||t.getTime()>Date.now()+300000)throw Error('確認した日時を確認してください。')}
export function checkEvent(d){if(!validDate(d.day)||(d.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))||!KINDS.includes(d.kind)||!['gin','chibi','both'].includes(d.dog)||!d.title.trim()||d.title.length>100||d.place.length>200||d.note.length>2000)throw Error('予定の日付・項目・文字数を確認してください。')}
export function reportText(w,name){return `【散歩完了の報告】\n担当：${name}\n犬：${DOGS[w.dog].name}\n開始：${displayTime(w.startedAt)}\n終了：${displayTime(w.endedAt)}\nご飯OK\nお水OK\n掃除OK\nお世話が完了しました。`}
export function csv(rows){return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}).join(',')).join('\r\n')}

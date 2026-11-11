'use strict';
const STORAGE='zhixi.study.v1';
const NAV=[['home','学习概览','总览'],['practice','开始练习','练习'],['wrong','我的错题','错题'],['favorites','我的收藏','收藏'],['bank','全部题库','题库']];
const PATHS={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',practice:'m8 4 12 8-12 8Z',wrong:'M5 4h14v17l-7-4-7 4ZM9 8l6 6m0-6-6 6',favorites:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L2 9.6l6.2-.9Z',bank:'M4 4h7v7H4Zm9 0h7v7h-7ZM4 13h7v7H4Zm9 0h7v7h-7Z'};
let questions=[],byId=new Map(),state,route='home',page=1,search='',typeFilter='',storageHealthy=true,toastTimer;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=key=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[key]}"></path></svg>`;
const fresh=()=>({schema:1,updatedAt:null,progress:{},favorites:[],history:[],session:null});
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',3800);}
function save(){
 state.updatedAt=new Date().toISOString();
 try{localStorage.setItem(STORAGE,JSON.stringify(state));storageHealthy=true;$('#save-status').textContent='✓ 已自动保存到此设备 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}
 catch(e){storageHealthy=false;$('#save-status').textContent='保存失败 · 请立即导出备份';toast('浏览器未能保存记录。请到备份与设置导出当前记录。');}
}
function validate(data){
 if(!data||data.schema!==1||!data.progress||typeof data.progress!=='object'||Array.isArray(data.progress)||!Array.isArray(data.favorites)||!Array.isArray(data.history))throw new Error('备份格式不正确');
 const clean=fresh();let skipped=0;
 const finite=(x,max=1e7)=>Number.isInteger(x)&&x>=0&&x<=max;
 for(const [id,p] of Object.entries(data.progress)){
  if(!byId.has(id)){skipped++;continue;}
  if(!p||!finite(p.attempts)||!finite(p.correct)||!finite(p.wrong)||p.correct+p.wrong!==p.attempts||typeof p.activeWrong!=='boolean')throw new Error('答题记录不完整');
  clean.progress[id]={attempts:p.attempts,correct:p.correct,wrong:p.wrong,activeWrong:p.activeWrong,lastAt:typeof p.lastAt==='string'?p.lastAt:null};
 }
 clean.favorites=[...new Set(data.favorites.filter(id=>typeof id==='string'&&byId.has(id)))];
 if(data.history.length>10000)throw new Error('备份历史超过10000条');
 clean.history=data.history.filter(h=>h&&typeof h.qid==='string'&&byId.has(h.qid)).map(h=>{
  const q=byId.get(h.qid);if(typeof h.at!=='string'||typeof h.correct!=='boolean'||!Array.isArray(h.selected)||h.selected.some(i=>!finite(i,q.options.length-1)))throw new Error('答题历史格式不正确');
  return {qid:h.qid,at:h.at,correct:h.correct,selected:[...new Set(h.selected)].sort((a,b)=>a-b)};
 });
 if(data.session){
  const s=data.session;
  if(!Array.isArray(s.ids)||!s.ids.length||s.ids.length>2000||!finite(s.index,s.ids.length-1)||!s.responses||typeof s.responses!=='object')throw new Error('练习进度格式不正确');
  if(s.ids.every(id=>byId.has(id))){
   const responses={};
   for(const [id,r] of Object.entries(s.responses)){
    const q=byId.get(id);if(!q||!s.ids.includes(id)||!r||!Array.isArray(r.selected)||r.selected.some(i=>!finite(i,q.options.length-1))||typeof r.submitted!=='boolean')throw new Error('练习选项格式不正确');
    const selected=[...new Set(r.selected)].sort((a,b)=>a-b);
    responses[id]={selected,submitted:r.submitted,correct:r.submitted&&q.verified?equal(selected,q.answer):null};
   }
   clean.session={ids:[...s.ids],index:s.index,responses,mode:['order','random','wrong','favorites','single'].includes(s.mode)?s.mode:'order',createdAt:typeof s.createdAt==='string'?s.createdAt:new Date().toISOString(),finished:!!s.finished};
  }else skipped++;
 }
 clean.updatedAt=typeof data.updatedAt==='string'?data.updatedAt:null;
 return {clean,skipped};
}
function load(){
 let raw;try{raw=localStorage.getItem(STORAGE);}catch(e){storageHealthy=false;toast('此浏览器限制本地存储，请更换普通浏览窗口。');return fresh();}
 if(!raw)return fresh();
 try{return validate(JSON.parse(raw)).clean;}catch(e){storageHealthy=false;toast('已有记录格式异常，暂未覆盖。请先在设置中导出检查。');return fresh();}
}
function equal(a,b){return a.length===b.length&&[...a].sort((x,y)=>x-y).every((v,i)=>v===[...b].sort((x,y)=>x-y)[i]);}
const progress=q=>state.progress[q.id]||{attempts:0,correct:0,wrong:0,activeWrong:false};
const wrongs=()=>questions.filter(q=>progress(q).activeWrong);
const favorites=()=>questions.filter(q=>state.favorites.includes(q.id));
function totals(){const p=Object.values(state.progress);const attempts=p.reduce((n,x)=>n+x.attempts,0),correct=p.reduce((n,x)=>n+x.correct,0);return {attempts,correct,unique:p.filter(x=>x.attempts).length,rate:attempts?Math.round(correct/attempts*100):0};}
function navigation(){
 for(const selector of ['#desktop-nav','#mobile-nav'])$(selector).innerHTML=NAV.map(([id,long,short])=>`<a href="#${id}" class="${route===id?'active':''}" ${route===id?'aria-current="page"':''}>${icon(id)}<span>${selector==='#desktop-nav'?long:short}</span>${selector==='#desktop-nav'&&['wrong','favorites'].includes(id)?`<span class="count">${id==='wrong'?wrongs().length:favorites().length}</span>`:''}</a>`).join('');
}
function render(scroll=false){
 navigation();
 if(route==='home')home();else if(route==='practice')state.session&&!state.session.finished?quiz():setup();else list();
 if(scroll)window.scrollTo({top:0,behavior:'instant'});
}
function home(){
 const t=totals(),unfinished=state.session&&!state.session.finished,submitted=unfinished?Object.values(state.session.responses).filter(r=>r.submitted).length:0;
 $('#app').innerHTML=`<section class="hero"><div><span class="eyebrow">YOUR EVERYDAY PROGRESS</span><h1>${t.attempts?'每一次练习，都算数。':'从今天，开始一点积累。'}</h1><p>${unfinished?`上次练习已完成 ${submitted} / ${state.session.ids.length} 题，进度已经为你保留。`:'不必一次学完。每天练习一点，错过的题会被记住，想再看的题随时收藏。'}</p><button class="button lime large" data-action="${unfinished?'resume':'goto-practice'}">${unfinished?'继续上次练习':'开始今天的练习'} <span class="arrow">→</span></button></div><div class="hero-side"><b>${questions.length}</b><span>道题，慢慢掌握</span><span>${questions.filter(q=>q.verified).length} 道可参考判分</span></div></section>
 <div class="stats-grid">${stat('已经练习',t.unique,'题目覆盖 / '+questions.length+' 题')}${stat('累计正确率',t.attempts?t.rate+'%':'—',t.attempts+' 次已判分作答')}${stat('待复习错题',wrongs().length,'重新理解，再做一次')}${stat('我的收藏',favorites().length,'值得多看一眼的题')}</div>
 <div class="section-title"><h2>选择你的练习方式</h2><span>短一点，也是一种进步</span></div><div class="practice-grid">${modeCard('order','01','顺序练习','按顺序继续未做题，已做题不会重复出现。')}${modeCard('random','↝','随机挑战','打乱题序，检验真正的掌握程度。')}${modeCard('wrong','↺','错题重练','把不熟悉的知识，再巩固一次。')}</div>
 <div class="bottom-grid"><section class="panel"><h3>我的题型进度</h3>${['单选题','多选题','判断题'].map(type=>{const all=questions.filter(q=>q.type===type&&q.verified),done=all.filter(q=>progress(q).attempts).length;return `<div class="progress-row"><div><span>${type}</span><span>${done} / ${all.length}</span></div><div class="track"><i style="width:${done/all.length*100}%"></i></div></div>`;}).join('')}</section><section class="panel"><h3>给自己的学习提醒</h3><p class="muted small">记录只属于这台设备的当前浏览器。无需账号，也不会上传你的答题记录。</p><button class="button ghost" data-action="export">导出一次备份 ↗</button><p class="muted small">${questions.filter(q=>!q.verified).length}道待核对、版本或歧义题保留说明，默认不参与自动判分。</p></section></div>`;
}
function stat(label,value,small){return `<div class="stat"><span class="stat-label"><span class="device-dot"></span>${label}</span><b class="stat-value">${value}</b><small>${small}</small></div>`;}
function modeCard(mode,symbol,title,desc){return `<button class="practice-card" data-action="quick" data-mode="${mode}"><span class="card-symbol">${symbol}</span><h3>${title}</h3><p>${desc}</p><span class="card-link">开始练习 →</span></button>`;}
function setup(){
 const last=state.session,finished=last&&last.finished;
 $('#app').innerHTML=`<div class="page-title"><h1>把知识，练成自己的。</h1><p>选一个适合今天的节奏。进度会自动保存，随时可以回来。</p></div>${finished?resultHTML(last):''}<section class="panel"><h3>开始一组新练习</h3><div class="setup"><label>练习方式<select id="mode"><option value="order">顺序练习（继续未做题）</option><option value="random">随机练习</option><option value="wrong">错题重练（${wrongs().length}）</option><option value="favorites">收藏练习（${favorites().length}）</option></select></label><label>题目类型<select id="setup-type"><option value="">全部题型</option><option>单选题</option><option>多选题</option><option>判断题</option></select></label><label>每组题数<select id="size"><option value="10">10题 · 热身一下</option><option value="30">30题 · 稳步积累</option><option value="90">90题 · 集中练习</option><option value="all">全部符合条件的题</option></select></label><button class="button primary" data-action="start">开始练习 →</button></div></section><div class="notice" style="margin-top:20px">日常练习默认只包含${questions.filter(q=>q.verified).length}道可按参考答案判分的题。其余待核对、版本或歧义题，可以到全部题库查看说明、收藏和单独阅读。</div>`;
}
function start(mode='order',type='',size=10){
 let pool=(mode==='wrong'?wrongs():mode==='favorites'?favorites():questions).filter(q=>q.verified&&(!type||q.type===type));
 if(!pool.length){toast('没有符合条件的可判分题目，可以先去题库看看。');return;}
 if(mode==='order'){
  pool=pool.filter(q=>!progress(q).attempts);
  if(!pool.length){toast('该题型已全部练习过，可切换随机练习或错题重练。');return;}
 }
 if(mode==='random')for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 state.session={ids:pool.slice(0,size==='all'?pool.length:Number(size)).map(q=>q.id),index:0,responses:{},mode,createdAt:new Date().toISOString(),finished:false};save();go('practice');
}
function go(next){if(location.hash==='#'+next){route=next;render(true);}else location.hash=next;}
function current(){const s=state.session;return s?byId.get(s.ids[s.index]):null;}
function response(q){const s=state.session;return s.responses[q.id]||(s.responses[q.id]={selected:[],submitted:false,correct:null});}
function quiz(){
 const s=state.session,q=current(),r=response(q),t=Object.values(s.responses).filter(x=>x.submitted).length;
 $('#app').innerHTML=`<div class="quiz-top"><button class="button ghost" data-action="home">← 学习概览</button><span class="muted">${{order:'顺序练习',random:'随机练习',wrong:'错题重练',favorites:'收藏练习',single:'题目练习'}[s.mode]} · 已完成 ${t} / ${s.ids.length}</span></div><div class="quiz-progress"><i style="width:${t/s.ids.length*100}%"></i></div><div class="quiz-layout"><section class="quiz-card"><div class="question-meta"><span class="pill">${esc(q.type)}</span><button class="star ${state.favorites.includes(q.id)?'on':''}" data-action="favorite" data-id="${q.id}" aria-pressed="${state.favorites.includes(q.id)}">${state.favorites.includes(q.id)?'★ 已收藏':'☆ 收藏此题'}</button></div><h1 class="question-heading">${s.index+1}. ${esc(q.stem)}</h1>${!q.verified?'<div class="notice">这道题存在版本或歧义，阅读参考说明后继续；不计入正确率。</div>':''}<div class="options" style="margin-top:15px">${q.options.map((option,i)=>`<button class="option ${r.selected.includes(i)?'selected':''} ${r.submitted&&q.verified?(q.answer.includes(i)?'correct':r.selected.includes(i)?'incorrect':''):''}" data-action="select" data-option="${i}" ${r.submitted?'disabled':''} aria-pressed="${r.selected.includes(i)}"><span class="letter">${String.fromCharCode(65+i)}</span><span>${esc(option)}</span></button>`).join('')}</div>${r.submitted?feedback(q,r):`<p class="small muted">${q.type==='多选题'?'请选择所有符合条件的选项，再提交答案。':'点击选项立即提交并查看答案。'}</p>`}<div class="quiz-actions"><button class="button secondary" data-action="prev" ${s.index===0?'disabled':''}>上一题</button>${r.submitted?`<button class="button primary" data-action="next">${s.index===s.ids.length-1?'查看本组结果':'下一题 →'}</button>`:(q.type==='多选题'||!q.verified)?`<button class="button primary" data-action="submit" ${q.verified&&!r.selected.length?'disabled':''}>${q.verified?'提交答案':'查看参考说明'}</button>`:''}</div><p class="save-hint">自动保存 · 题库编号 ${q.number} · 答案为参考答案，未经平台判分核验</p></section><aside class="quiz-side"><section class="panel"><h3>本组答题卡</h3><div class="dots">${s.ids.map((id,i)=>{const rr=s.responses[id];return `<button data-action="jump" data-index="${i}" aria-label="前往第${i+1}题" class="${i===s.index?'current':''} ${rr?.submitted?(rr.correct===false?'bad':'done'):''}">${i+1}</button>`;}).join('')}</div><p>点题号自由查看。已提交的题目不会重复计分。</p></section><div class="notice" style="margin-top:15px">本组进度已留在此浏览器，下次打开可以继续。</div></aside></div>`;
}
function feedback(q,r){return `<div class="feedback ${!q.verified?'warn':r.correct?'':'bad'}"><b>${!q.verified?'阅读说明 · 不参与判分':r.correct?'✓ 回答正确，再积累一点。':'这道题已记入错题本。'}</b><p>参考答案：${esc(q.reference)}</p>${q.note?`<p class="answer-note">${esc(q.note)}</p>`:''}${q.verified&&!r.correct?`<p>你的选择：${esc(r.selected.map(i=>String.fromCharCode(65+i)).join('、'))}</p>`:''}${progress(q).activeWrong?`<button class="button ghost" data-action="master" data-id="${q.id}">标记已掌握，移出错题本</button>`:''}</div>`;}
function submit(){
 const q=current(),r=response(q);if(r.submitted||q.verified&&!r.selected.length)return;
 r.submitted=true;r.correct=q.verified?equal(r.selected,q.answer):null;
 if(q.verified){
  const p=progress(q);p.attempts++;p.correct+=r.correct?1:0;p.wrong+=r.correct?0:1;p.activeWrong=p.activeWrong||!r.correct;p.lastAt=new Date().toISOString();state.progress[q.id]=p;
  state.history.push({qid:q.id,selected:[...r.selected],correct:r.correct,at:p.lastAt});if(state.history.length>10000)state.history=state.history.slice(-10000);
 }
 save();render();
}
function resultHTML(s){
 const rr=Object.entries(s.responses).filter(([id,r])=>r.submitted&&byId.get(id)?.verified),good=rr.filter(([,r])=>r.correct).length,reviewed=Object.values(s.responses).filter(r=>r.submitted).length;
 return `<section class="result" style="margin-bottom:22px"><span class="eyebrow">A LITTLE PROGRESS, EVERY DAY</span><h2>这一组，练完了。</h2><div class="big">${rr.length?Math.round(good/rr.length*100)+'%':'—'}</div><p class="muted small">本组参考正确率 · ${good} / ${rr.length} 道已判分题<br>共查看 ${reviewed} / ${s.ids.length} 题；未提交题目不计入成绩</p><div class="result-buttons"><button class="button primary" data-action="retry-wrong">重练错题</button><button class="button secondary" data-action="home">回到学习概览</button></div></section>`;
}
function list(){
 const title={wrong:['我的错题','答错过的题，会一直留在这里。重新理解后，可以标记已掌握。'],favorites:['我的收藏','把值得再看一眼的知识，留给下一次复习。'],bank:['全部题库',questions.length+'道题，支持搜索、按题型筛选，也可查看待核对题目。']}[route];
 let pool=route==='wrong'?wrongs():route==='favorites'?favorites():questions;
 const total=pool.length;
 if(typeFilter)pool=pool.filter(q=>typeFilter==='special'?!q.verified:q.type===typeFilter);
 if(search.trim()){const term=search.trim().toLowerCase();pool=pool.filter(q=>(q.number+' '+q.stem+' '+q.options.join(' ')+' '+q.reference+' '+q.note).toLowerCase().includes(term));}
 const pages=Math.max(1,Math.ceil(pool.length/20));page=Math.min(page,pages);
 $('#app').innerHTML=`<div class="page-title"><h1>${title[0]} <span class="pill">${total}题</span></h1><p>${title[1]}</p></div>${route!=='bank'&&total?`<button class="button primary" data-action="quick" data-mode="${route}">开始${route==='wrong'?'错题':'收藏'}练习 →</button>`:''}<div class="toolbar"><input id="list-search" type="search" placeholder="搜索题干、关键词或题库编号" value="${esc(search)}" aria-label="搜索题库"><select id="list-type" aria-label="筛选题型"><option value="">全部题型</option>${['单选题','多选题','判断题'].map(t=>`<option ${typeFilter===t?'selected':''}>${t}</option>`).join('')}<option value="special" ${typeFilter==='special'?'selected':''}>版本或歧义题</option></select><span class="muted small">找到 ${pool.length} 题</span></div><div class="list">${pool.length?pool.slice((page-1)*20,page*20).map(q=>row(q)).join(''):empty(route,total)}</div>${pages>1?`<div class="pagination"><button class="button secondary" data-action="page-prev" ${page===1?'disabled':''}>上一页</button><span>${page} / ${pages}</span><button class="button secondary" data-action="page-next" ${page===pages?'disabled':''}>下一页</button></div>`:''}`;
}
function row(q){const p=progress(q);return `<article class="question-row"><div class="row-head"><span class="pill ${!q.verified?'warn':''}">${esc(q.type)}</span><small>#${q.number}${!q.verified?' · 版本或歧义':''}${p.attempts?' · 已练 '+p.attempts+' 次':''}</small></div><h3>${esc(q.stem)}</h3><div class="row-bottom"><span class="muted small">${p.wrong?'累计答错 '+p.wrong+' 次':q.verified?'参考答案可判分':'不自动判分'}</span><div class="row-actions">${route==='wrong'?`<button class="button ghost" data-action="master" data-id="${q.id}">已掌握</button>`:''}<button class="star ${state.favorites.includes(q.id)?'on':''}" data-action="favorite" data-id="${q.id}" aria-label="${state.favorites.includes(q.id)?'取消收藏':'收藏'}第${q.number}题">${state.favorites.includes(q.id)?'★':'☆'}</button><button class="button secondary" data-action="open-question" data-id="${q.id}">${q.verified?'练这道题':'查看说明'}</button></div></div></article>`;}
function empty(where,total){return `<div class="empty"><span class="card-symbol">${where==='favorites'?'☆':'✓'}</span><h3>${total?'没有匹配的题目':where==='wrong'?'暂时没有待复习错题':where==='favorites'?'还没有收藏':'没有题目'}</h3><p>${total?'换一个关键词或筛选条件试试。':where==='wrong'?'答错的题目会自动记录在这里。':where==='favorites'?'练习时点击收藏按钮，就能把题目留在这里。':'请检查题库是否加载成功。'}</p><button class="button secondary" data-action="goto-practice">去练习 →</button></div>`;}
let reviewQuestion=null,reviewSelected=[],reviewSubmitted=false;
function goSetup(mode){
 route='practice';history.replaceState(null,'','#practice');navigation();setup();$('#mode').value=mode;
 if(state.session&&!state.session.finished)$('#app').insertAdjacentHTML('afterbegin','<div class="notice">上组未完成的题目仍可继续。开始新组后，已提交的记录和收藏会保留。 <button class="button secondary" data-action="resume">继续上组</button></div>');
 window.scrollTo(0,0);
}
function openQuestion(id){
 if(!byId.has(id))return;
 reviewQuestion=byId.get(id);reviewSelected=[];reviewSubmitted=false;
 if(!$('#question-review')){const d=document.createElement('dialog');d.id='question-review';document.body.append(d);}
 drawReview();$('#question-review').showModal();
}
function drawReview(showAnswer=false){
 const q=reviewQuestion;
 $('#question-review').innerHTML=`<div class="dialog-head"><h2>题目 #${q.number} · ${esc(q.type)}</h2><button class="button secondary" data-action="close-review">关闭</button></div><h3>${esc(q.stem)}</h3><div class="options">${q.options.map((o,i)=>`<button class="option ${reviewSelected.includes(i)?'selected':''} ${reviewSubmitted&&q.answer.includes(i)?'correct':''}" data-action="review-select" data-option="${i}" ${reviewSubmitted?'disabled':''}><span class="letter">${String.fromCharCode(65+i)}</span>${esc(o)}</button>`).join('')}</div><div class="quiz-actions">${q.type==='多选题'&&!reviewSubmitted?'<button class="button primary" data-action="review-submit">提交答案</button>':''}<button class="button secondary" data-action="review-answer">查看答案与说明</button></div>${showAnswer||reviewSubmitted?`<div class="feedback"><b>参考答案：${esc(q.reference)}</b><p>${esc(q.note||'本题暂无补充解析。')}</p>${reviewSubmitted?`<p>${!q.verified?'本题不参与判分':equal(reviewSelected,q.answer)?'✓ 回答正确':'回答错误，已记入错题本。'}</p>`:''}</div>`:''}<p class="muted small">单题复习不影响正在进行的整组练习。答案为参考答案，未经平台核验。</p>`;
}
function recordAnswer(q,selected){
 const correct=equal(selected,q.answer),p=progress(q);p.attempts++;p.correct+=correct?1:0;p.wrong+=correct?0:1;p.activeWrong=p.activeWrong||!correct;p.lastAt=new Date().toISOString();state.progress[q.id]=p;
 state.history.push({qid:q.id,selected:[...selected],correct,at:p.lastAt});state.history=state.history.slice(-10000);
}
function submitReview(){if(reviewSubmitted)return;if(reviewQuestion.verified&&!reviewSelected.length){toast('请先选择答案。');return;}reviewSubmitted=true;if(reviewQuestion.verified)recordAnswer(reviewQuestion,reviewSelected);save();render();drawReview(true);}
function exportBackup(){const payload={app:'zhixi-study',exportedAt:new Date().toISOString(),...state};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='知习备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);toast('备份已导出，请妥善保存。');}
document.addEventListener('click',event=>{
 const el=event.target.closest('[data-action]');if(!el||el.disabled||!state)return;const action=el.dataset.action,id=el.dataset.id;
 if(action==='close-review'){$('#question-review').close();}
 else if(action==='review-answer')drawReview(true);
 else if(action==='review-submit')submitReview();
 else if(action==='review-select'){if(reviewSubmitted)return;const i=Number(el.dataset.option);reviewSelected=reviewQuestion.type==='多选题'?(reviewSelected.includes(i)?reviewSelected.filter(x=>x!==i):[...reviewSelected,i]):[i];if(reviewQuestion.type!=='多选题')submitReview();else drawReview();}
 else if(action==='home')go('home');
 else if(action==='goto-practice'||action==='resume')go('practice');
 else if(action==='retry-wrong'){if(!wrongs().some(q=>q.verified)){toast('目前没有待复习错题，可以开始下一组练习。');return;}start('wrong','','all');}
 else if(action==='quick'){goSetup(el.dataset.mode);}
 else if(action==='start')start($('#mode').value,$('#setup-type').value,$('#size').value);
 else if(action==='select'){
  const q=current(),r=response(q);if(r.submitted)return;const i=Number(el.dataset.option);
  r.selected=q.type==='多选题'?(r.selected.includes(i)?r.selected.filter(x=>x!==i):[...r.selected,i].sort((a,b)=>a-b)):[i];
  if(q.type!=='多选题'){submit();}else{save();quiz();}
 }
 else if(action==='submit')submit();
 else if(action==='prev'){state.session.index=Math.max(0,state.session.index-1);save();render(true);}
 else if(action==='jump'){state.session.index=Number(el.dataset.index);save();render(true);}
 else if(action==='next'){
  const s=state.session;if(s.index<s.ids.length-1){s.index++;save();render(true);}
  else {const missing=s.ids.findIndex(id=>!s.responses[id]?.submitted);if(missing>=0){s.index=missing;save();render(true);toast('已跳到本组尚未提交的题目。');return;}s.finished=true;save();render(true);}
 }
 else if(action==='favorite'){
  if(!byId.has(id))return;const exists=state.favorites.includes(id);state.favorites=exists?state.favorites.filter(x=>x!==id):[...state.favorites,id];save();render();toast(exists?'已取消收藏':'已加入收藏');
 }
 else if(action==='master'){
  if(state.progress[id])state.progress[id].activeWrong=false;save();render();toast('已标记掌握。再次答错时会重新记录。');
 }
 else if(action==='open-question')openQuestion(id);
 else if(action==='page-prev'){page--;list();window.scrollTo({top:0,behavior:'smooth'});}
 else if(action==='page-next'){page++;list();window.scrollTo({top:0,behavior:'smooth'});}
 else if(action==='settings'){$('#data-summary').textContent=`${totals().attempts} 次作答 · ${wrongs().length} 道错题 · ${favorites().length} 道收藏 · 最近 ${state.history.length} 条明细`+(storageHealthy?'':' · 当前保存异常');$('#settings').showModal();}
 else if(action==='close-settings')$('#settings').close();
 else if(action==='export')exportBackup();
});
document.addEventListener('input',event=>{if(event.target.id==='list-search'){const pos=event.target.selectionStart;search=event.target.value;page=1;list();$('#list-search').focus();$('#list-search').setSelectionRange(pos,pos);}});
document.addEventListener('change',event=>{if(event.target.id==='list-type'){typeFilter=event.target.value;page=1;list();}});
$('#import-file').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;
 try{
  if(file.size>10*1024*1024)throw new Error('备份文件过大');
  const parsed=JSON.parse(await file.text());if(parsed.app!=='zhixi-study')throw new Error('不是知习备份文件');
  const {clean,skipped}=validate(parsed);
  if(!confirm(`将恢复 ${Object.values(clean.progress).reduce((n,p)=>n+p.attempts,0)} 次作答、${clean.favorites.length} 道收藏，并替换当前记录。建议先导出当前备份。继续吗？`))return;
  state=clean;save();$('#settings').close();render(true);toast(skipped?`已恢复；跳过 ${skipped} 项当前题库不包含的记录。`:'备份已恢复');
 }catch(e){toast('无法导入：'+e.message);}finally{event.target.value='';}
});
window.addEventListener('hashchange',()=>{route=NAV.some(([id])=>id===location.hash.slice(1))?location.hash.slice(1):'home';page=1;search='';typeFilter='';if(state)render(true);});
window.addEventListener('storage',event=>{if(event.key!==STORAGE||!event.newValue||!state)return;try{state=validate(JSON.parse(event.newValue)).clean;render();toast('已更新另一标签页保存的记录。');}catch(e){toast('另一标签页的数据格式异常，未载入。');}});
window.addEventListener('beforeunload',event=>{if(!storageHealthy&&state){event.preventDefault();event.returnValue='';}});
async function init(){
 try{
  const res=await fetch('questions.json');if(!res.ok)throw new Error('题库加载失败');const payload=await res.json();questions=bankRows(payload);byId=new Map(questions.map(q=>[q.id,q]));showBankDate(payload);
  state=load();$('#date-label').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
  $('#save-status').textContent=state.updatedAt?'✓ 已恢复此设备的上次记录':'✓ 自动保存已就绪 · 仅此设备';
  if(!storageHealthy)$('#save-status').textContent='本地记录读取异常 · 请检查备份';
  route=NAV.some(([id])=>id===location.hash.slice(1))?location.hash.slice(1):'home';render();
  if(publicBankUrl){checkPublicBank();setInterval(()=>{if(document.visibilityState!=='hidden')checkPublicBank();},60000);}
  if('serviceWorker' in navigator){let refreshing=false;const hadController=!!navigator.serviceWorker.controller;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!refreshing){refreshing=true;location.reload();}});navigator.serviceWorker.register('sw.js').then(r=>r.update()).catch(()=>{});}
 }catch(e){$('#app').innerHTML='<section class="empty"><h2>暂时无法打开题库</h2><p>请检查网络并刷新。首次使用需要通过网站地址访问，不能直接双击本地网页文件。</p></section>';}
}
const publicBankUrl=location.hostname==='jiayilong246.github.io'&&location.pathname.startsWith('/zhixi/')?'https://raw.githubusercontent.com/JiayiLong246/JiayiLong246.github.io/master/zhixi/questions.json':null;
let pendingBank=null,checkingBank=false;
function bankRows(payload){
 const rows=Array.isArray(payload)?payload:payload?.questions;
 if(!Array.isArray(rows)||!rows.length||rows.some(q=>!q||typeof q.id!=='string'||typeof q.stem!=='string'||!Array.isArray(q.options)||!Array.isArray(q.answer)||q.answer.some(i=>!Number.isInteger(i)||i<0||i>=q.options.length)))throw new Error('题库数据格式不完整');
 return rows;
}
function showBankDate(payload){
 $('#bank-version').textContent=`共享题库 ${bankRows(payload).length} 题`+(payload.updatedAt?` · 更新于 ${new Date(payload.updatedAt).toLocaleString('zh-CN')}`:'');
}
function applyPublicBank(payload){
 questions=bankRows(payload);byId=new Map(questions.map(q=>[q.id,q]));showBankDate(payload);
 if(state){state=validate(state).clean;render();}
 pendingBank=null;$('#bank-refresh').hidden=true;
}
async function checkPublicBank(){
 if(checkingBank||!publicBankUrl)return;checkingBank=true;
 try{
  let response;
  try{response=await fetch(`${publicBankUrl}?v=${Math.floor(Date.now()/60000)}`,{cache:'no-store'});if(!response.ok)throw new Error('远端暂不可用');}
  catch(_){response=await fetch('questions.json',{cache:'no-store'});}
  if(!response.ok)return;
  const payload=await response.json(),rows=bankRows(payload);
  if(JSON.stringify(rows)===JSON.stringify(questions))return;
  if(route==='practice'&&state?.session&&!state.session.finished){pendingBank=payload;$('#bank-refresh').hidden=false;$('#bank-refresh').textContent=`更新题库（${rows.length}题）`;}
  else applyPublicBank(payload);
 }catch(_){}finally{checkingBank=false;}
}
$('#bank-refresh').addEventListener('click',()=>{if(pendingBank){applyPublicBank(pendingBank);toast('共享题库已更新');}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkPublicBank();});
init();

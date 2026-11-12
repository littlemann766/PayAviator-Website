/* PayAviator site: menu, FAQ accordion + filter, legal accordions */
(function(){
  var btn=document.querySelector('.menu-btn'),nav=document.getElementById('navlinks');
  if(btn&&nav){
    var set=function(o){btn.setAttribute('aria-expanded',o);btn.setAttribute('aria-label',o?'Close menu':'Open menu');nav.classList.toggle('open',o);};
    btn.addEventListener('click',function(){set(btn.getAttribute('aria-expanded')!=='true');});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&nav.classList.contains('open')){set(false);btn.focus();}});
    document.addEventListener('click',function(e){if(nav.classList.contains('open')&&!nav.contains(e.target)&&!btn.contains(e.target))set(false);});
    window.addEventListener('resize',function(){if(window.innerWidth>900)set(false);});
  }
})();
(function(){
  var items=document.querySelectorAll('.faq-item');if(!items.length)return;
  Array.prototype.forEach.call(items,function(it){
    var b=it.querySelector('button'),p=it.querySelector('.faq-panel');p.hidden=true;
    b.addEventListener('click',function(){var o=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',o);p.hidden=!o;it.classList.toggle('open',o);});
  });
  var q=document.getElementById('faqFilter'),none=document.getElementById('faqNone');
  if(q)q.addEventListener('input',function(){
    var t=q.value.trim().toLowerCase(),n=0;
    Array.prototype.forEach.call(items,function(it){var m=!t||it.textContent.toLowerCase().indexOf(t)>-1;it.hidden=!m;if(m)n++;});
    if(none)none.hidden=n>0;
  });
})();
(function(){
  var accs=document.querySelectorAll('details.acc');if(!accs.length)return;
  var openHash=function(){var id=decodeURIComponent(location.hash.slice(1));if(!id)return;var el=document.getElementById(id);if(!el)return;var d=el.closest('details.acc');if(!d)return;d.open=true;setTimeout(function(){d.scrollIntoView({block:'start'});},0);};
  window.addEventListener('hashchange',openHash);openHash();
  var b=document.querySelector('.acc-all');
  if(b)b.addEventListener('click',function(){var all=Array.prototype.every.call(accs,function(d){return d.open;});Array.prototype.forEach.call(accs,function(d){d.open=!all;});b.textContent=all?'Expand all':'Collapse all';});
})();
(function(){var f=function(){var el=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));if(el&&el.tagName==='DETAILS')el.open=true;};window.addEventListener('hashchange',f);f();})();
/* Screenshot gallery: desktop arrows, click-drag, wheel, keyboard; native swipe on touch */
(function(){
  var band=document.querySelector('.car-band');if(!band)return;
  var t=band.querySelector('.swipe'),dots=band.querySelectorAll('.car-dots i');if(!t)return;
  var figs=t.querySelectorAll('figure');
  Array.prototype.forEach.call(t.querySelectorAll('img'),function(img){img.draggable=false;});
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var smooth=reduce?'auto':'smooth';
  var chev=function(d){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+d+'"/></svg>';};
  var prev=document.createElement('button');
  prev.type='button';prev.className='car-btn car-prev';prev.setAttribute('aria-label','Previous screen');
  prev.innerHTML=chev('M14.5 6l-6 6 6 6');
  var next=document.createElement('button');
  next.type='button';next.className='car-btn car-next';next.setAttribute('aria-label','Next screen');
  next.innerHTML=chev('M9.5 6l6 6-6 6');
  var stage=document.createElement('div');
  stage.className='car-stage';
  t.parentNode.insertBefore(stage,t);
  stage.appendChild(prev);
  stage.appendChild(t);
  stage.appendChild(next);
  var hint=band.querySelector('.swipe-hint');
  if(hint)hint.dataset.desktop='Scroll or use arrows';
  function step(){
    var f=t.querySelector('figure');if(!f)return Math.max(200,t.clientWidth*0.8);
    var gap=parseFloat(getComputedStyle(t).columnGap||getComputedStyle(t).gap)||18;
    return f.offsetWidth+gap;
  }
  function maxScroll(){return Math.max(0,t.scrollWidth-t.clientWidth);}
  function go(dir){t.scrollBy({left:dir*step(),behavior:smooth});}
  function update(){
    var x=t.scrollLeft+t.clientWidth/2,b=0,bd=1e9;
    Array.prototype.forEach.call(figs,function(e,i){var c=e.offsetLeft+e.offsetWidth/2,dd=Math.abs(c-x);if(dd<bd){bd=dd;b=i;}});
    Array.prototype.forEach.call(dots,function(e,i){e.style.background=i===b?'var(--cyan)':'';e.setAttribute('aria-current',i===b?'true':'false');});
    var sl=t.scrollLeft,mx=maxScroll();
    prev.disabled=sl<=1;next.disabled=sl>=mx-1;
  }
  t.addEventListener('scroll',update,{passive:true});
  prev.addEventListener('click',function(){go(-1);});
  next.addEventListener('click',function(){go(1);});
  t.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'){e.preventDefault();go(1);}
    else if(e.key==='ArrowLeft'){e.preventDefault();go(-1);}
    else if(e.key==='Home'){e.preventDefault();t.scrollTo({left:0,behavior:smooth});}
    else if(e.key==='End'){e.preventDefault();t.scrollTo({left:maxScroll(),behavior:smooth});}
  });
  Array.prototype.forEach.call(dots,function(dot,i){
    dot.tabIndex=0;dot.setAttribute('role','button');dot.setAttribute('aria-label','Show screen '+(i+1));
    var jump=function(){if(figs[i])figs[i].scrollIntoView({inline:'center',block:'nearest',behavior:smooth});};
    dot.addEventListener('click',jump);
    dot.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();jump();}});
  });
  var drag=false,sx=0,ss=0,moved=false;
  t.addEventListener('pointerdown',function(e){
    if(e.pointerType==='touch')return;
    if(e.button!==0)return;
    drag=true;moved=false;sx=e.clientX;ss=t.scrollLeft;
    t.classList.add('dragging');
    try{t.setPointerCapture(e.pointerId);}catch(err){}
  });
  t.addEventListener('pointermove',function(e){
    if(!drag)return;
    var dx=e.clientX-sx;
    if(Math.abs(dx)>4)moved=true;
    t.scrollLeft=ss-dx;
  });
  var endDrag=function(){if(!drag)return;drag=false;t.classList.remove('dragging');};
  t.addEventListener('pointerup',endDrag);
  t.addEventListener('pointercancel',endDrag);
  t.addEventListener('lostpointercapture',endDrag);
  t.addEventListener('click',function(e){if(moved){e.preventDefault();e.stopPropagation();moved=false;}},true);
  t.addEventListener('wheel',function(e){
    var mx=maxScroll();if(mx<=0)return;
    var dx=e.deltaX,dy=e.deltaY;
    if(e.deltaMode===1){dx*=16;dy*=16;}
    if(e.deltaMode===2){dx*=t.clientWidth;dy*=t.clientHeight;}
    var delta=Math.abs(dx)>=Math.abs(dy)?dx:dy;
    if(e.shiftKey)delta=dy||dx;
    if(!delta)return;
    var can=(delta>0&&t.scrollLeft<mx-0.5)||(delta<0&&t.scrollLeft>0.5);
    if(!can)return;
    e.preventDefault();
    t.scrollLeft=Math.max(0,Math.min(mx,t.scrollLeft+delta));
  },{passive:false});
  update();
  window.addEventListener('resize',update);
})();
/* Interactive sections: animated open/close, aria-expanded, whole-card tap */
(function(){
  var ds=document.querySelectorAll('details.acc,details.sec,details.more-d');if(!ds.length)return;
  var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  Array.prototype.forEach.call(ds,function(d){
    var s=d.querySelector(':scope>summary'),b=d.querySelector(':scope>.d-body,:scope>.acc-body');if(!s)return;
    var sync=function(){s.setAttribute('aria-expanded',d.open?'true':'false');};sync();
    d.addEventListener('toggle',sync);
    s.addEventListener('click',function(e){
      if(!b||rm||!b.animate)return;e.preventDefault();
      if(d._a)d._a.cancel();
      if(!d.open){d.open=true;sync();var h=b.scrollHeight;d._a=b.animate([{height:'0px',opacity:0},{height:h+'px',opacity:1}],{duration:260,easing:'ease-out'});d._a.onfinish=function(){d._a=null;};}
      else{var h2=b.scrollHeight;s.setAttribute('aria-expanded','false');d._a=b.animate([{height:h2+'px',opacity:1},{height:'0px',opacity:0}],{duration:220,easing:'ease-in'});d._a.onfinish=function(){d.open=false;d._a=null;sync();};}
    });
  });
  // Whole feature card taps its "More details"
  Array.prototype.forEach.call(document.querySelectorAll('.feat-grid .card'),function(c){
    var s=c.querySelector('details.more-d>summary');if(!s)return;
    c.addEventListener('click',function(e){if(e.target.closest('summary,a,button,.d-body'))return;s.click();});
  });
})();

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
(function(){var t=document.querySelector('.car-band .swipe'),d=document.querySelectorAll('.car-dots i');if(!t||!d.length)return;var f=t.querySelectorAll('figure');
t.addEventListener('scroll',function(){var x=t.scrollLeft+t.clientWidth/2,b=0,bd=1e9;Array.prototype.forEach.call(f,function(e,i){var c=e.offsetLeft+e.offsetWidth/2,dd=Math.abs(c-x);if(dd<bd){bd=dd;b=i;}});Array.prototype.forEach.call(d,function(e,i){e.style.background=i===b?'var(--cyan)':'';});},{passive:true});})();
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

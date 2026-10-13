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

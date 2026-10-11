/* PayAviator v2 — vanilla JS interactions */
(function(){
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function(s,c){return (c||document).querySelector(s)};
  var $$ = function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
  var money = function(n,dp){return (n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:dp||0,maximumFractionDigits:dp||0})};

  /* Header shadow */
  var header = $('.site-header');
  var onScroll = function(){ if(header) header.classList.toggle('scrolled', window.scrollY>8); };
  window.addEventListener('scroll', onScroll, {passive:true}); onScroll();

  /* Mobile nav: dropdown panel under the header (<=860px). Own scope so later code can't clobber its variables. */
  (function(){
    var btn = $('.menu-btn'), panel = $('#navlinks'), hdr = $('.site-header');
    if(!btn || !panel) return;
    var mq = window.matchMedia('(max-width:860px)');
    var scrim = document.createElement('div'); scrim.className = 'nav-scrim'; scrim.setAttribute('aria-hidden','true');
    document.body.appendChild(scrim);
    var isOpen = function(){ return btn.getAttribute('aria-expanded') === 'true'; };
    var setMenu = function(open){
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      panel.classList.toggle('open', open);
      scrim.classList.toggle('open', open);
      document.documentElement.classList.toggle('menu-open', open);
    };
    var hdrBottom = function(){ return hdr && getComputedStyle(hdr).position === 'sticky' ? hdr.getBoundingClientRect().bottom : 0; };
    btn.addEventListener('click', function(e){ e.stopPropagation(); setMenu(!isOpen()); });
    $$('a', panel).forEach(function(a){
      a.addEventListener('click', function(e){
        var wasOpen = isOpen(); setMenu(false);
        var h = a.getAttribute('href') || '';
        if(!wasOpen || h.charAt(0) !== '#' || h.length < 2) return;
        var t = document.getElementById(h.slice(1)); if(!t) return;
        // Scroll ourselves once the scroll lock is off, landing just below the sticky header.
        e.preventDefault();
        var y = t.getBoundingClientRect().top + window.pageYOffset - hdrBottom() - 8;
        window.scrollTo({top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth'});
        if(history.pushState) history.pushState(null, '', h);
      });
    });
    scrim.addEventListener('click', function(){ setMenu(false); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && isOpen()){ setMenu(false); btn.focus(); } });
    document.addEventListener('click', function(e){ if(isOpen() && !panel.contains(e.target) && !btn.contains(e.target)) setMenu(false); });
    var onMq = function(){ if(!mq.matches && isOpen()) setMenu(false); };
    if(mq.addEventListener) mq.addEventListener('change', onMq); else if(mq.addListener) mq.addListener(onMq);
  })();

  /* Scroll reveal */
  var reveals = $$('.reveal');
  if('IntersectionObserver' in window && !reduce){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
    }, {threshold:.12, rootMargin:'0px 0px -40px 0px'});
    reveals.forEach(function(el){ io.observe(el); });
  } else reveals.forEach(function(el){ el.classList.add('in'); });

  /* ---------- PayAviator Gauge, mirroring the app's Home gauge (PayAviator 3.9.4/3.9.5 index.html, render() + pp973Scale()).
     viewBox 400x400, centre 200,200, dial sweeps 280deg (130deg -> 410deg). Colour bands sit between the scale marks.
     Default scale (no custom scale set): max = niceMax(max(value, available)), at least $500; marks at 0/25/50/75/100%. */
  function pt(r,deg){ var a=deg*Math.PI/180; return [200+r*Math.cos(a), 200+r*Math.sin(a)]; }
  function arc(r,d0,d1){ var p0=pt(r,d0), p1=pt(r,d1); return 'M '+p0[0].toFixed(2)+' '+p0[1].toFixed(2)+' A '+r+' '+r+' 0 '+((d1-d0)>180?1:0)+' 1 '+p1[0].toFixed(2)+' '+p1[1].toFixed(2); }
  function ang(f){ return 130+280*Math.max(0,Math.min(1,f)); }
  function niceMax(v){ v=Math.max(100,v); var raw=v*1.12, p=Math.pow(10,Math.floor(Math.log10(raw))), n=raw/p; return (n<=1?1:n<=2?2:n<=5?5:10)*p; }
  function appScale(value,available){ var max=niceMax(Math.max(0,value,available)); if(max<500) max=500; return {max:max, marks:[0,max*.25,max*.5,max*.75,max]}; }
  function markLabel(v,i){ return i===0 ? '$0' : (v>=1000 ? '$'+(v/1000).toFixed(v%1000?1:0)+'k' : '$'+Math.round(v)); }
  function makeGauge(svg){
    if(!svg) return null;
    var title=svg.querySelector('title')?svg.querySelector('title').outerHTML:'';
    var h='<circle cx="200" cy="200" r="174" fill="#0a315f" stroke="#71808e" stroke-width="10"/>'+
          '<circle cx="200" cy="200" r="158" fill="none" stroke="#d8e0e7" stroke-width="34"/><g class="g-bands"></g><g stroke="#0b2847" stroke-width="3">';
    for(var i=0;i<=28;i++){ var d=130+280*i/28, A=pt(i%7===0?142:147,d), B=pt(169,d); h+='<line x1="'+A[0].toFixed(1)+'" y1="'+A[1].toFixed(1)+'" x2="'+B[0].toFixed(1)+'" y2="'+B[1].toFixed(1)+'"/>'; }
    h+='</g><line class="g-needle" x1="200" y1="200" x2="200" y2="200" stroke="#fff" stroke-width="10" stroke-linecap="round"/>'+
       '<circle cx="200" cy="200" r="25" fill="#c7d0d9" stroke="#091a30" stroke-width="8"/><circle cx="200" cy="200" r="10" fill="#07182f"/><g class="g-labels"></g>';
    svg.innerHTML=title+h;
    var needle=svg.querySelector('.g-needle'), bandsG=svg.querySelector('.g-bands'), lab=svg.querySelector('.g-labels'), cur=0, raf, lastKey='';
    function draw(f){ var p=pt(116,ang(f)); needle.setAttribute('x2',p[0].toFixed(1)); needle.setAttribute('y2',p[1].toFixed(1)); }
    function scale(sc){
      var key=sc.max+'|'+sc.marks.join(','); if(key===lastKey) return; lastKey=key;
      var m=sc.marks, f=function(v){return v/sc.max;}, cols=['#e23a3a','#f27827','#e9ce31','#2cad48'];
      bandsG.innerHTML=[[0,f(m[1])],[f(m[1]),f(m[2])],[f(m[2]),f(m[3])],[f(m[3]),1]].map(function(b,i){ return '<path d="'+arc(158,ang(b[0]),ang(b[1]))+'" fill="none" stroke="'+cols[i]+'" stroke-width="27"/>'; }).join('');
      lab.innerHTML=m.map(function(v,i){ var p=pt(166,ang(f(v))); return '<text x="'+p[0].toFixed(1)+'" y="'+(p[1]+7).toFixed(1)+'" text-anchor="middle" font-size="21" font-weight="900" fill="#fff" stroke="#07182f" stroke-width="3" paint-order="stroke fill">'+markLabel(v,i)+'</text>'; }).join('');
    }
    draw(0);
    return {scale:scale, set:function(f,ms,onStep){
      cancelAnimationFrame(raf); var from=cur; cur=f;
      if(reduce||!ms){ draw(f); if(onStep) onStep(1); return; }
      var t0=null; raf=requestAnimationFrame(function step(ts){ if(!t0)t0=ts; var p=Math.min(1,(ts-t0)/ms), e=1-Math.pow(1-p,3);
        draw(from+(f-from)*e); if(onStep) onStep(e); if(p<1) raf=requestAnimationFrame(step); });
    }};
  }

  /* Hero replica: gauge sweep + count-up (example value), then cycle Home / Calendar / Bills */
  var heroG = makeGauge($('#heroGauge'));
  if(heroG){
    // Example numbers follow the app's formula: Safe to Spend = Available now + (savings if included) - Cushion
    var AVAIL=2486.17, SAV=0, CUSH=436.11 /* 20% of a $2,180.55 example paycheck */, VAL=Math.max(0,AVAIL+0*SAV-CUSH), amt=$('#heroAmt');
    var HS=appScale(VAL,AVAIL), MAX=HS.max; heroG.scale(HS);
    var run=function(){ heroG.set(VAL/MAX, 1800, function(e){ amt.textContent=money(VAL*e,2); }); };
    if(reduce){ heroG.set(VAL/MAX); amt.textContent=money(VAL,2); } else setTimeout(run, 500);
    var phone=$('#phone'), scr=['home','calendar','bills'], idx=0, timer=null, userPicked=false;
    var labelsA={home:'Illustrative replica of the PayAviator app Home screen: the PayAviator Gauge showing an example Safe to Spend amount of $2,050.06, with Available now, Savings and Cushion totals. Example data only.',
      calendar:'Illustrative replica of the PayAviator app Calendar screen: Calendar Actions and an October 2026 month view with example bills and paychecks. Example data only.',
      bills:'Illustrative replica of the PayAviator app Bills screen: search, category filter and example upcoming bills grouped by due date. Example data only.'};
    var show=function(name){
      idx=scr.indexOf(name);
      $$('.a-screen',phone).forEach(function(sc){ sc.classList.toggle('on', sc.dataset.screen===name); });
      $$('.a-nav span',phone).forEach(function(t){ t.classList.toggle('on', t.dataset.tab===name); });
      $$('.screen-tabs button').forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.show===name)); });
      phone.setAttribute('aria-label', labelsA[name]);
      if(name==='home' && !reduce){ heroG.set(0,0); amt.textContent=money(0,2); setTimeout(run,250); }
    };
    $$('.screen-tabs button').forEach(function(b){ b.addEventListener('click', function(){ userPicked=true; clearInterval(timer); show(b.dataset.show); }); });
    // swipe on the phone
    var sx=null;
    phone.addEventListener('pointerdown', function(e){ sx=e.clientX; });
    phone.addEventListener('pointerup', function(e){ if(sx===null) return; var dx=e.clientX-sx; sx=null;
      if(Math.abs(dx)>40){ userPicked=true; clearInterval(timer); show(scr[(idx+(dx<0?1:scr.length-1))%scr.length]); } });
    if(!reduce){
      timer=setInterval(function(){ if(!userPicked && !document.hidden) show(scr[(idx+1)%scr.length]); }, 7000);
      phone.addEventListener('mouseenter', function(){ userPicked=true; });
      phone.addEventListener('mouseleave', function(){ userPicked=false; });
    }
  }

  /* Feature cards: tap/click toggle (hover handled in CSS) + spotlight */
  $$('[data-feature]').forEach(function(card){
    var btn = $('.linkbtn', card);
    btn.addEventListener('click', function(){
      var open = !card.classList.contains('open');
      card.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  /* Range fill helper */
  function fill(r){ var p = (r.value-r.min)/(r.max-r.min)*100; r.style.setProperty('--p', p+'%'); }

  /* Safe to Spend demo — mirrors the app's Home gauge state():
       safe = max(0, available - cushion + (includeSavings ? savings : 0))
       cushion = percent mode: paycheck * pct/100 (default 20%), dollar mode: fixed amount. */
  var av=$('#avail'), sv=$('#sav'), pc=$('#pct'), py=$('#pay'), dl=$('#dol'), incBtn=$('#incSav'), calcG=makeGauge($('#calcGauge'));
  if(av){
    var cmode='percent', incSav=false;
    var calc=function(ms){
      [av,sv,pc,py,dl].forEach(fill);
      var A=+av.value, S=+sv.value, cush=cmode==='percent' ? (+py.value)*(+pc.value)/100 : +dl.value;
      var safe=Math.max(0, A-cush+(incSav?S:0));
      $('#availOut').textContent=money(A); $('#savOut').textContent=money(S);
      $('#pctOut').textContent=pc.value+'%'; $('#payOut').textContent=money(+py.value); $('#dolOut').textContent=money(+dl.value);
      $('#mAvail').textContent=money(A); $('#mSav').textContent=money(S); $('#mSavMode').textContent=incSav?'Included':'Protected'; $('#mCush').textContent=money(cush,cush%1?2:0);
      $('#stsBig').textContent=money(safe,safe%1?2:0);
      var bv=$('#stsBarVal'); if(bv){ bv.textContent=money(safe,safe%1?2:0);
        $('#stsBarSub').textContent='Available '+money(A)+(incSav?' + savings '+money(S):'')+' − cushion '+money(cush,cush%1?2:0);
        $('#stsBarFill').style.width=(A+(incSav?S:0)>0?Math.min(100,safe/(A+(incSav?S:0))*100):0).toFixed(1)+'%'; }
      $('#stsPer').textContent='Available now is '+money(A)+'. You can spend up to '+money(safe,safe%1?2:0)+' without going below this cushion.';
      if(calcG){ var sc=appScale(safe,A); calcG.scale(sc); calcG.set(safe/sc.max, ms);
        $('#calcGauge').setAttribute('aria-label','PayAviator Gauge: Safe to Spend '+money(safe)); }
    };
    [av,sv,pc,py,dl].forEach(function(r){ r.addEventListener('input', function(){ calc(250); }); });
    incBtn.addEventListener('click', function(){ incSav=!incSav; incBtn.setAttribute('aria-pressed',String(incSav)); incBtn.textContent=incSav?'Included':'Protected'; calc(400); });
    $$('[data-cmode]').forEach(function(b){ b.addEventListener('click', function(){ cmode=b.dataset.cmode;
      $$('[data-cmode]').forEach(function(x){ x.setAttribute('aria-pressed',String(x===b)); });
      $('#pctWrap').hidden = cmode!=='percent'; $('#dolWrap').hidden = cmode!=='dollar'; calc(400); }); });
    calc(0);
    if(calcG && 'IntersectionObserver' in window && !reduce){
      var done=false;
      new IntersectionObserver(function(es,o){ es.forEach(function(e){ if(e.isIntersecting && !done){ done=true; o.disconnect(); calcG.set(0,0); calc(1400); } }); },{threshold:.4}).observe($('#calcGauge'));
    }
  }

  /* Payoff Planner demo — EXAMPLE DATA ONLY. Mirrors the PayAviator 3.9.6 Payoff Planner
     (PayAviator main 98a40d2 + payaviator-redesign-on-3.9.5.patch, index.html pp151-payoff-authority-js, lines 23568-23603):
       Snowball payment = the card's saved minimum, or if none 3% of the balance with a $25 floor (never more than the balance).
       Snowball projection = plan(): full snowball across every open balance. Each month interest (balance*APR/1200) is added,
         every balance pays its own minimum, and the Extra monthly payment plus any minimum freed by a paid-off balance
         goes to the smallest balance first (ties: higher APR first).
       Avalanche = full payoff: balance + one month of interest. The Extra field is hidden for Avalanche, as in the app.
       Gauge = credit used (balance / credit limit); the needle follows the selected card. */
  var CARDS = [
    {id:'a', name:'Example Visa card',    balance:3240.55, limit:8000, apr:24.99, min:180},
    {id:'b', name:'Example rewards card', balance:4980.00, limit:7500, apr:21.49, min:0},
    {id:'c', name:'Example travel card',  balance:6200.00, limit:9000, apr:27.24, min:210}
  ];
  var cents = function(v){ return '$'+(Math.max(0,v)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  function minPay(d){ return d.min || Math.max(25, Math.round(d.balance*.03*100)/100); }
  function snowPay(d){ return Math.min(minPay(d), d.balance); }
  function fullPayoff(d){ return Math.round((d.balance + d.balance*d.apr/1200)*100)/100; }
  function ppSim(d,pay){
    var bal=d.balance, rate=d.apr/1200, m=0, int=0;
    if(!bal) return {months:0,interest:0,finished:true};
    while(bal>.005 && m<1200){ var i=bal*rate; int+=i; bal+=i; if(!pay||pay<=i) return {months:m+1,interest:int,finished:false}; bal-=Math.min(pay,bal); m++; }
    return {months:m,interest:int,finished:true};
  }
  function ppPlan(sel, ex){
    var ds=CARDS.filter(function(x){return x.balance>0;}).map(function(x){ return {id:x.id,name:x.name,bal:x.balance,apr:x.apr,min:minPay(x)}; })
                .sort(function(a,b){ return a.bal-b.bal || b.apr-a.apr; });
    var me=ds.filter(function(x){return x.id===sel.id;})[0], target=ds[0], m=0, int=0, pay1=0, after1=me.bal;
    while(me.bal>.005 && m<1200 && me.bal<1e9){
      m++; var pool=ex;
      ds.forEach(function(x){ if(x.bal>.005){ var i=x.bal*x.apr/1200; x.bal+=i; if(x===me) int+=i; } });
      ds.forEach(function(x){ if(x.bal<=.005){ pool+=x.min; return; } var p=Math.min(x.min,x.bal); x.bal-=p; pool+=x.min-p; if(x===me&&m===1) pay1+=p; });
      for(var k=0;k<ds.length;k++){ var x=ds[k]; if(pool<=.005) break; if(x.bal<=.005) continue; var p=Math.min(pool,x.bal); x.bal-=p; pool-=p; if(x===me&&m===1) pay1+=p; }
      if(m===1) after1=Math.max(0,me.bal);
    }
    return {months:m, interest:int, finished:me.bal<=.005, pay1:Math.round(pay1*100)/100, after1:after1, extra:ex, min:Math.min(me.min,sel.balance), targetName:target.name, isTarget:target===me};
  }
  function ppDate(m){ var d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+m); return d.toLocaleDateString('en-US',{month:'short',year:'numeric'}); }

  var ppSvg=$('#ppGauge'), ppNeedle=null, ppCur=0, ppRaf;
  function pAng(f){ return 135+270*Math.max(0,Math.min(1,f)); }
  if(ppSvg){
    var t=ppSvg.querySelector('title').outerHTML, h='<circle cx="200" cy="200" r="174" fill="#071a36" stroke="#71808e" stroke-width="10"/><circle cx="200" cy="200" r="158" fill="none" stroke="#d8e0e7" stroke-width="30"/>';
    [[0,.30,'#22c55e'],[.30,.50,'#e9ce31'],[.50,.70,'#f59e0b'],[.70,1,'#ef4444']].forEach(function(z){ h+='<path d="'+arc(158,pAng(z[0]),pAng(z[1]))+'" fill="none" stroke="'+z[2]+'" stroke-width="25"/>'; });
    h+='<g stroke="#0b2847" stroke-width="3">';
    for(var k=0;k<=24;k++){ var dg=135+270*k/24, A=pt(k%6===0?145:149,dg), B=pt(169,dg); h+='<line x1="'+A[0].toFixed(1)+'" y1="'+A[1].toFixed(1)+'" x2="'+B[0].toFixed(1)+'" y2="'+B[1].toFixed(1)+'"/>'; }
    h+='</g><line class="pp-needle" x1="200" y1="200" x2="200" y2="200" stroke="#fff" stroke-width="10" stroke-linecap="round"/><circle cx="200" cy="200" r="25" fill="#c7d0d9" stroke="#091a30" stroke-width="8"/><circle cx="200" cy="200" r="10" fill="#07182f"/>';
    ppSvg.innerHTML=t+h; ppNeedle=ppSvg.querySelector('.pp-needle');
  }
  function ppDraw(f){ var p=pt(112,pAng(f)); ppNeedle.setAttribute('x2',p[0].toFixed(1)); ppNeedle.setAttribute('y2',p[1].toFixed(1)); }
  function ppNeedleTo(f){
    cancelAnimationFrame(ppRaf); var from=ppCur; ppCur=f;
    if(reduce){ ppDraw(f); return; }
    var t0=null; ppRaf=requestAnimationFrame(function step(ts){ if(!t0)t0=ts; var p=Math.min(1,(ts-t0)/700), e=1-Math.pow(1-p,3); ppDraw(from+(f-from)*e); if(p<1) ppRaf=requestAnimationFrame(step); });
  }

  var ppSel=0, ppKind={a:'snowball',b:'snowball',c:'snowball'}, ppExtra=$('#ppExtra');
  function ppExtraVal(){ var v=ppExtra?Number(ppExtra.value):0; return isFinite(v)&&v>0?Math.min(v,5000):0; }
  function renderCards(){
    var box=$('#ppCards'); if(!box) return;
    box.innerHTML=CARDS.map(function(d,i){
      var lim=Math.max(d.limit,d.balance), u=(d.balance/lim*100).toFixed(1);
      return '<button type="button" class="pp-card" data-i="'+i+'" aria-pressed="'+(i===ppSel)+'"><span class="nm">'+d.name+'</span>'+
        '<span class="meta">'+cents(d.balance)+' / '+cents(lim)+' credit used • '+u+'%</span>'+
        '<span class="meta">'+d.apr.toFixed(2)+'% APR • '+cents(minPay(d))+' minimum'+(d.min?'':' (none saved: 3% of balance)')+'</span>'+
        '<span class="pill">'+(ppKind[d.id]==='avalanche'?'Avalanche':'Snowball')+'</span></button>';
    }).join('');
  }
  function renderPlanner(){
    if(!ppSvg) return;
    var d=CARDS[ppSel], kind=ppKind[d.id], name=kind==='avalanche'?'Avalanche':'Snowball', ex=ppExtraVal(),
        bal=d.balance, limit=Math.max(d.limit,bal), pl=kind==='avalanche'?null:ppPlan(d,ex),
        pay=pl?pl.pay1:fullPayoff(d), p=pl||ppSim(d,pay),
        cur=limit?Math.round(bal/limit*100):0, after=pl?pl.after1:Math.max(0,bal+bal*d.apr/1200-pay), aft=limit?Math.round(after/limit*100):0,
        avail=Math.max(0,limit-bal), availAfter=Math.max(0,limit-after), drop=Math.max(0,cur-aft);
    $('#ppName').textContent=d.name; $('#ppUsed').textContent=cur+'% used';
    $('#ppPct').textContent=cur+'%';
    $('#ppGaugeT').textContent=d.name+': '+cur+'% of credit limit used';
    ppNeedleTo(Math.min(1,bal/limit));
    $('#ppAvail').textContent=cents(avail); $('#ppBal').textContent=cents(bal);
    $('#ppDate').textContent=p.finished?ppDate(p.months):'Needs payment';
    $('#ppProjH').textContent=name+' projection • '+(pl?cents(pl.min)+'/mo minimum'+(pl.extra?' + '+cents(pl.extra)+' extra':''):cents(pay)+' payoff');
    $('#ppProjB').textContent=p.finished?ppDate(p.months)+' • '+p.months+' month'+(p.months===1?'':'s')+' • '+cents(p.interest)+' projected interest':'Payment does not reduce the balance';
    $('#ppMode').textContent=(!pl||!pl.extra)?'Your '+cents(pay)+' payment is classified as '+name+'.':
      (pl.isTarget?'Your '+cents(pl.extra)+' extra goes to this balance first (smallest balance), so this month you pay '+cents(pay)+'.':
       'Your '+cents(pl.extra)+' extra goes to '+pl.targetName+' first (smallest balance). When that is paid off, its payment rolls over to this balance.');
    $('#ppDelta').innerHTML='Projected utilization: '+cur+'% → '+aft+'% <span aria-hidden="true">(↓ '+drop+' points)</span><small>'+name+' preview with '+cents(pay)+' payment: available credit '+cents(avail)+' → '+cents(availAfter)+'</small>';
    $('#ppSnowPay').textContent='Snowball payment: '+cents(snowPay(d))+'/mo';
    $('#ppAvaPay').textContent='Full payoff: '+cents(fullPayoff(d));
    $('#ppSnow').setAttribute('aria-pressed',String(kind==='snowball'));
    $('#ppAva').setAttribute('aria-pressed',String(kind==='avalanche'));
    var w=$('#ppExtraWrap'); if(w) w.hidden=(kind==='avalanche');
    if($('#ppBar')){
      $('#ppBarName').textContent=d.name.replace(/^Example /,'')+' · '+name;
      $('#ppBarPct').textContent=cur+'% used';
      $('#ppBarFill').style.width=Math.min(100,cur)+'%';
      $('#ppBarRes').textContent=pl?(p.finished?'Paid off '+ppDate(p.months)+' · '+p.months+' mo · '+cents(p.interest)+' interest':'Payment does not reduce the balance'):'Full payoff '+cents(pay)+' · '+cur+'% → '+aft+'% used';
    }
  }
  if(ppSvg){
    renderCards(); renderPlanner();
    $('#ppCards').addEventListener('click',function(e){
      var b=e.target.closest('.pp-card'); if(!b) return;
      ppSel=+b.dataset.i;
      $$('.pp-card').forEach(function(x){ x.setAttribute('aria-pressed',String(x===b)); });
      renderPlanner();
    });
    $$('.pp-strategy button').forEach(function(b){
      b.addEventListener('click',function(){
        var d=CARDS[ppSel]; ppKind[d.id]=b.dataset.kind;
        var pill=$('.pp-card[data-i="'+ppSel+'"] .pill'); if(pill) pill.textContent=b.dataset.kind==='avalanche'?'Avalanche':'Snowball';
        renderPlanner();
      });
    });
    if(ppExtra){ var pr; ppExtra.addEventListener('input',function(){ cancelAnimationFrame(pr); pr=requestAnimationFrame(renderPlanner); }); }
  }

  /* Screenshot carousel buttons */
  var track=$('#track');
  $$('[data-car]').forEach(function(b){
    b.addEventListener('click', function(){
      var slide=$('.slide',track); var w=slide? slide.getBoundingClientRect().width+20 : 260;
      track.scrollBy({left:+b.dataset.car*w, behavior:reduce?'auto':'smooth'});
    });
  });
  /* Phones (<=760px): centered slides, dots + small arrows below, tap a screenshot to view it full screen */
  var phoneMq = window.matchMedia ? window.matchMedia('(max-width:760px)') : {matches:false, addListener:function(){}};
  var carIdx = 0, goTo = null;
  if(track){
    var slides = $$('.slide', track);
    var centerOf = function(i){ var s=slides[i], tr=track.getBoundingClientRect(), r=s.getBoundingClientRect();
      return track.scrollLeft + (r.left-tr.left) - (track.clientWidth-r.width)/2; };
    goTo = function(i){ i=Math.max(0,Math.min(slides.length-1,i)); track.scrollTo({left:centerOf(i), behavior:reduce?'auto':'smooth'}); };
    var carNav = document.createElement('div'); carNav.className='car-carNav';
    var cap = function(s){ var c=$('figcaption',s); return c?c.textContent:''; };
    carNav.innerHTML = '<button type="button" class="car-arrow" data-go="-1" aria-label="Previous screenshot"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M14.5 6 8.5 12l6 6\"/></svg></button><div class="car-dots" role="group" aria-label="Choose a screenshot">'+
      slides.map(function(s,i){ return '<button type="button" class="car-dot" data-dot="'+i+'" aria-label="Screenshot '+(i+1)+' of '+slides.length+': '+cap(s)+'"><span></span></button>'; }).join('')+
      '</div><button type="button" class="car-arrow" data-go="1" aria-label="Next screenshot"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M9.5 6l6 6-6 6\"/></svg></button>';
    track.insertAdjacentElement('afterend', carNav);
    var dots = $$('.car-dot', carNav), prevB=$('[data-go="-1"]',carNav), nextB=$('[data-go="1"]',carNav);
    var setActive = function(i){ carIdx=i; dots.forEach(function(d,k){ if(k===i) d.setAttribute('aria-current','true'); else d.removeAttribute('aria-current'); });
      prevB.disabled = i===0; nextB.disabled = i===slides.length-1; };
    var nearest = function(){ var tr=track.getBoundingClientRect(), mid=tr.left+tr.width/2, best=0, bd=1e9;
      slides.forEach(function(s,i){ var r=s.getBoundingClientRect(), d=Math.abs(r.left+r.width/2-mid); if(d<bd){bd=d;best=i;} }); return best; };
    var sr; track.addEventListener('scroll', function(){ cancelAnimationFrame(sr); sr=requestAnimationFrame(function(){ setActive(nearest()); }); }, {passive:true});
    // If the slide's top is tucked under the sticky header, nudge the page so the whole slide shows (phones only).
    var reveal = function(){
      if(!phoneMq.matches) return;
      var hdr=document.querySelector('.site-header'), hb=hdr && getComputedStyle(hdr).position==='sticky' ? hdr.getBoundingClientRect().bottom : 0;
      var top=track.getBoundingClientRect().top, need=(hb+8)-top;
      if(need>0 && need<window.innerHeight*0.6) window.scrollBy({top:-need, behavior:reduce?'auto':'smooth'});
    };
    dots.forEach(function(d){ d.addEventListener('click', function(){ goTo(+d.dataset.dot); reveal(); }); });
    [prevB,nextB].forEach(function(b){ b.addEventListener('click', function(){ goTo(carIdx + (+b.dataset.go)); reveal(); }); });
    var se; var onSwipeEnd=function(){ clearTimeout(se); se=setTimeout(reveal, 'onscrollend' in window ? 0 : 160); };
    track.addEventListener('onscrollend' in window ? 'scrollend' : 'scroll', onSwipeEnd, {passive:true});
    setActive(0);

    // Lightbox (phones only)
    var lb = document.createElement('dialog'); lb.className='lightbox'; lb.setAttribute('aria-label','Screenshot');
    lb.innerHTML = '<button type="button" class="lb-close" aria-label="Close full-screen screenshot">✕</button><img alt=""><p class="lb-cap"></p>';
    document.body.appendChild(lb);
    var lbImg=$('img',lb), lbCap=$('.lb-cap',lb), lastFrame=null;
    var closeLb = function(){ if(lb.open) lb.close(); };
    lb.addEventListener('close', function(){ document.documentElement.classList.remove('lb-open'); if(lastFrame) lastFrame.focus({preventScroll:true}); });
    $('.lb-close',lb).addEventListener('click', closeLb);
    lb.addEventListener('click', function(e){ if(e.target===lb || e.target===lbImg) closeLb(); });
    var openLb = function(frame){
      if(!phoneMq.matches || typeof lb.showModal!=='function') return;
      var img=$('img',frame), s=frame.closest('.slide');
      lbImg.src = img.currentSrc || img.src; lbImg.alt = img.alt; lbCap.textContent = cap(s);
      lastFrame = frame; document.documentElement.classList.add('lb-open'); lb.showModal(); $('.lb-close',lb).focus();
    };
    var frames = $$('.frame', track);
    var syncFrames = function(){ frames.forEach(function(f){ var s=f.closest('.slide');
      if(phoneMq.matches){ f.setAttribute('role','button'); f.setAttribute('tabindex','0'); f.setAttribute('aria-label','View full screen: '+cap(s)); }
      else { f.removeAttribute('role'); f.removeAttribute('tabindex'); f.removeAttribute('aria-label'); closeLb(); } }); };
    frames.forEach(function(f){
      f.addEventListener('click', function(){ openLb(f); });
      f.addEventListener('keydown', function(e){ if(phoneMq.matches && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); openLb(f); } });
    });
    syncFrames();
    if(phoneMq.addEventListener) phoneMq.addEventListener('change', syncFrames); else phoneMq.addListener(syncFrames);
  }
  if(track) track.addEventListener('keydown', function(e){
    if(e.target!==track) return;
    if(e.key==='ArrowRight'||e.key==='ArrowLeft'){ e.preventDefault();
      if(phoneMq.matches && goTo) goTo(carIdx+(e.key==='ArrowRight'?1:-1));
      else $('[data-car="'+(e.key==='ArrowRight'?1:-1)+'"]').click(); }
  });

  /* FAQ accordion */
  $$('.faq-item button').forEach(function(b){
    b.addEventListener('click', function(){
      var item=b.closest('.faq-item'), open=b.getAttribute('aria-expanded')!=='true';
      b.setAttribute('aria-expanded', String(open)); item.classList.toggle('open', open);
    });
  });

  /* "Coming soon" store buttons */
  $$('[data-soon]').forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      var old=a.querySelector('b').innerHTML;
      if(a.dataset.busy) return; a.dataset.busy=1;
      a.querySelector('b').textContent='Coming soon!';
      setTimeout(function(){ a.querySelector('b').innerHTML=old; delete a.dataset.busy; }, 1600);
    });
  });
})();

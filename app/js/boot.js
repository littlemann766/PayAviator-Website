/* Show the cloud load-up once per browser session. Later pages in the same session skip it. */
(function () { try { if (sessionStorage.getItem('pa_boot_seen') === '1') document.documentElement.className += ' boot-seen'; } catch (e) { /* storage blocked: show it, as before */ } })();

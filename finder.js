// ==UserScript==
// @name         Cyprus Exam Slot Finder
// @namespace    local
// @version      5.0
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  const DELAY = 100;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function format(d) {
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function parse(s) {
    const [dd, mm, yyyy] = s.split('/');
    return new Date(yyyy, mm - 1, dd);
  }

  function parseYMD(s) {
    const [yyyy, mm, dd] = s.split('-');
    return new Date(yyyy, mm - 1, dd);
  }

  function addDay(d) {
    const x = new Date(d);
    x.setDate(x.getDate() + 1);
    return x;
  }

  function addWeek(d) {
    const x = new Date(d);
    x.setDate(x.getDate() + 7);
    return x
  }

  function getForm() {
    return document.forms[0];
  }

  function isTarget() {
    const f = getForm();
    return f && f.asd && f.enddate;
  }

  function getSlots() {
    return Array.from(document.querySelectorAll('td[background], td[BACKGROUND]'))
      .filter(td => {
        const bg = (td.getAttribute('background') || '').toLowerCase();
        return !bg.includes('redtime');
      });
  }

  function highlight(el) {
    el.style.outline = '4px solid lime';
    el.scrollIntoView({ block: 'center' });
  }

  function isRunning() {
    return GM_getValue('running', false) === true;
  }

  function start() {
    GM_setValue('running', true);
    console.log('START');
    updatePanel();
    schedule();
  }

  function stop() {
    GM_setValue('running', false);
    console.log('STOP');
    updatePanel();
  }

  function schedule() {
    if (!isRunning()) return;
    setTimeout(step, DELAY);
  }

  function step() {
    if (!isRunning()) return;
    if (!isTarget()) return;

    const form = getForm();
    const currentStr = form.asd.value;

    console.log('CHECK:', currentStr);

    const slots = getSlots();

    if (slots.length) {
      highlight(slots[0]);
      console.log('FOUND:', currentStr);
      alert('FOUND: ' + currentStr);
      stop();
      return;
    }

    const current = parse(currentStr);
    const end = parseYMD(form.enddate.value);

    const next = addWeek(current);

    if (next > end) {
      console.log('END reached');
      stop();
      return;
    }

    const nextStr = format(next);

    console.log('→', nextStr);

    form.asd.value = nextStr;
    form.submit();
  }

  function createPanel() {
    if (document.getElementById('slot-finder-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'slot-finder-panel';

    panel.style.position = 'fixed';
    panel.style.top = '10px';
    panel.style.right = '10px';
    panel.style.zIndex = '999999';
    panel.style.background = 'white';
    panel.style.border = '1px solid black';
    panel.style.padding = '10px';
    panel.style.font = '12px Arial';

    panel.innerHTML = `
      <div><b>Slot Finder</b></div>
      <div id="sf-status"></div>
      <button id="sf-start">Start</button>
      <button id="sf-stop">Stop</button>
    `;

    document.body.appendChild(panel);

    panel.querySelector('#sf-start').onclick = start;
    panel.querySelector('#sf-stop').onclick = stop;

    updatePanel();
  }

  function updatePanel() {
    const el = document.getElementById('sf-status');
    if (!el) return;
    el.textContent = isRunning() ? 'RUNNING' : 'STOPPED';
  }

  function init() {
    if (!isTarget()) return;

    createPanel();
    updatePanel();

    if (isRunning()) {
      schedule();
    }
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
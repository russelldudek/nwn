const scenarios = {
  managed: {
    label: 'New managed service',
    states: ['ready','ready','watch','ready','ready','watch'],
    note: 'Proceed with controls: finance treatment and operating adoption require explicit launch owners before release.'
  },
  bundle: {
    label: 'Device + service bundle',
    states: ['ready','watch','hold','watch','hold','watch'],
    note: 'Hold: transaction path and system configuration are not yet reconciled across device fulfillment, recurring service, and billing.'
  },
  exception: {
    label: 'Custom pricing exception',
    states: ['watch','hold','watch','hold','watch','ready'],
    note: 'Hold: margin logic and finance treatment need approval; define the expiration and owner for the exception.'
  }
};

const stateLabels = { ready: 'Ready', watch: 'Ready with control', hold: 'Hold' };

function setScenario(key) {
  const data = scenarios[key] || scenarios.managed;
  document.querySelectorAll('.scenario-button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === key));
  });
  const gates = [...document.querySelectorAll('.gate')];
  gates.forEach((gate, index) => {
    const state = data.states[index];
    gate.dataset.state = state;
    gate.querySelector('.gate-state').textContent = stateLabels[state];
  });
  const hasHold = data.states.includes('hold');
  const hasWatch = data.states.includes('watch');
  const result = hasHold ? 'HOLD FOR REWORK' : hasWatch ? 'READY WITH CONTROLS' : 'READY TO TRANSACT';
  const status = document.querySelector('#readiness-result');
  if (status) {
    status.textContent = result;
    status.style.color = hasHold ? 'var(--hold)' : hasWatch ? 'var(--watch)' : 'var(--ready)';
  }
  const note = document.querySelector('#readiness-note');
  if (note) note.textContent = data.note;
  const scenarioName = document.querySelector('#scenario-name');
  if (scenarioName) scenarioName.textContent = data.label;
}

function initCampaign() {
  const menu = document.querySelector('.menu-button');
  const links = document.querySelector('.nav-links');
  menu?.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.scenario-button').forEach((button) => {
    button.addEventListener('click', () => setScenario(button.dataset.scenario));
  });
  document.querySelector('.reset-button')?.addEventListener('click', () => setScenario('managed'));
  setScenario('managed');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCampaign, { once: true });
} else {
  initCampaign();
}

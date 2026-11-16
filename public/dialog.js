'use strict';

(function () {
  let dialog = null;
  let titleEl = null;
  let bodyEl = null;
  let okBtn = null;
  let cancelBtn = null;
  let active = null;
  const queue = [];

  function ensure() {
    if (dialog) return true;
    dialog = document.getElementById('uiDialog');
    if (!dialog) return false;
    titleEl = document.getElementById('uiDialogTitle');
    bodyEl = document.getElementById('uiDialogBody');
    okBtn = document.getElementById('uiDialogOk');
    cancelBtn = document.getElementById('uiDialogCancel');

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) finish(false);
    });
    dialog.querySelectorAll('[data-dialog-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => finish(false));
    });
    okBtn.addEventListener('click', () => finish(true));
    return true;
  }

  function normalize(options) {
    if (typeof options === 'string' || options == null) {
      return { message: options == null ? '' : String(options) };
    }
    return { ...options };
  }

  function appendLine(parent, text, cls) {
    const line = document.createElement('div');
    line.className = cls || 'ui-dialog-line';
    line.textContent = String(text == null ? '' : text);
    parent.appendChild(line);
  }

  function render(options) {
    const danger = options.danger === true;
    titleEl.textContent = options.title || (danger ? '确认操作' : '请确认');
    bodyEl.innerHTML = '';

    if (options.message) {
      const msg = document.createElement('div');
      msg.className = 'ui-dialog-message';
      msg.textContent = String(options.message);
      bodyEl.appendChild(msg);
    }

    for (const section of options.sections || []) {
      if (!section) continue;
      const box = document.createElement('section');
      box.className = 'ui-dialog-section' + (section.tone === 'warn' ? ' warn' : '');
      if (section.title) {
        const head = document.createElement('div');
        head.className = 'ui-dialog-section-title';
        head.textContent = String(section.title);
        box.appendChild(head);
      }
      for (const line of section.lines || []) appendLine(box, line);
      bodyEl.appendChild(box);
    }

    if (options.note) {
      const note = document.createElement('div');
      note.className = 'ui-dialog-note';
      note.textContent = String(options.note);
      bodyEl.appendChild(note);
    }

    okBtn.textContent = options.okText || '确定';
    cancelBtn.textContent = options.cancelText || '取消';
    okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
    bodyEl.scrollTop = 0;
  }

  function pump() {
    if (active || !queue.length) return;
    if (!ensure()) {
      const job = queue.shift();
      const options = normalize(job.options);
      job.resolve(window.confirm(options.message || ''));
      pump();
      return;
    }
    active = queue.shift();
    const options = normalize(active.options);
    active.options = options;
    active.restoreFocus = document.activeElement;
    render(options);
    document.body.classList.add('has-dialog');
    if (!dialog.open) dialog.showModal();
    const focusTarget = options.danger === true ? cancelBtn : okBtn;
    setTimeout(() => {
      if (dialog.open) focusTarget.focus();
    }, 0);
  }

  function finish(result) {
    if (!active) return;
    const job = active;
    active = null;
    if (dialog && dialog.open) dialog.close();
    document.body.classList.remove('has-dialog');
    job.resolve(result === true);
    if (job.restoreFocus && typeof job.restoreFocus.focus === 'function') {
      try { job.restoreFocus.focus(); } catch (e) { /* ignore */ }
    }
    setTimeout(pump, 0);
  }

  function uiConfirm(options) {
    return new Promise((resolve) => {
      queue.push({ options, resolve });
      pump();
    });
  }

  window.uiConfirm = uiConfirm;
  window.uiDialogOpen = () => Boolean(dialog && dialog.open);
})();

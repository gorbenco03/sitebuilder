/**
 * Visitor manage-link UI — token from ?token= only; single-booking scoped.
 */
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function tokenFromUrl() {
    try {
      var u = new URL(location.href);
      return (u.searchParams.get('token') || '').trim();
    } catch (_) {
      return '';
    }
  }

  function ymdLocal(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function addDaysYmd(ymd, days) {
    var parts = ymd.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + days);
    return ymdLocal(d);
  }

  function formatSlotLocal(startUtc, tz) {
    try {
      return new Intl.DateTimeFormat('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(startUtc));
    } catch (_) {
      return startUtc;
    }
  }

  function formatDateLabel(ymd, tz) {
    try {
      var d = new Date(ymd + 'T12:00:00Z');
      return new Intl.DateTimeFormat('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      }).format(d);
    } catch (_) {
      return ymd;
    }
  }

  function formatWhen(startUtc, endUtc, tz) {
    try {
      var dtf = new Intl.DateTimeFormat('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      });
      var end = new Intl.DateTimeFormat('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(endUtc));
      return dtf.format(new Date(startUtc)) + '–' + end;
    } catch (_) {
      return startUtc + ' – ' + endUtc;
    }
  }

  function badgeClass(status) {
    return 'hm__badge hm__badge--' + String(status || 'requested').replace(/[^a-z_]/g, '');
  }

  function renderError(msg) {
    var body = $('#hm-body');
    body.innerHTML = '';
    var box = el('div', 'hm__alert hm__alert--err', msg || 'Link invalid.');
    box.setAttribute('role', 'alert');
    body.appendChild(box);
    $('#hm-sub').textContent = 'Nu putem deschide această programare.';
  }

  function renderBooking(booking, opts) {
    opts = opts || {};
    var body = $('#hm-body');
    body.innerHTML = '';
    if (opts.flash) {
      var flash = el('div', 'hm__alert hm__alert--ok', opts.flash);
      flash.setAttribute('role', 'status');
      body.appendChild(flash);
    }
    var card = el('div', 'hm__card');
    card.setAttribute('data-hm-status', booking.status);

    var st = el('div', 'hm__row');
    st.appendChild(el('dt', '', 'Stare'));
    var dd = el('dd', '');
    var badge = el('span', badgeClass(booking.status), booking.statusLabelRo || booking.status);
    dd.appendChild(badge);
    st.appendChild(dd);
    card.appendChild(st);

    var when = el('div', 'hm__row');
    when.appendChild(el('dt', '', 'Interval'));
    when.appendChild(el('dd', '', formatWhen(booking.startUtc, booking.endUtc, booking.timezone)));
    card.appendChild(when);

    if (booking.serviceName) {
      var svc = el('div', 'hm__row');
      svc.appendChild(el('dt', '', 'Serviciu'));
      svc.appendChild(el('dd', '', booking.serviceName));
      card.appendChild(svc);
    }

    var who = el('div', 'hm__row');
    who.appendChild(el('dt', '', 'Pe numele'));
    who.appendChild(el('dd', '', booking.visitorName || '—'));
    card.appendChild(who);

    body.appendChild(card);

    var cancelled = booking.status === 'cancelled';
    $('#hm-sub').textContent = cancelled
      ? 'Această programare este anulată. Intervalul este eliberat.'
      : 'Link unic pentru această programare. Poți anula dacă ești încă în fereastra permisă.';

    if (!cancelled) {
      var actions = el('div', 'hm__actions');

      var reschedBtn = el('button', 'hm__btn hm__btn--ghost', 'Reprogramează');
      reschedBtn.type = 'button';
      reschedBtn.setAttribute('data-hm-reschedule', '1');
      reschedBtn.addEventListener('click', function () {
        openReschedulePane(booking);
      });
      actions.appendChild(reschedBtn);

      var btn = el('button', 'hm__btn', 'Anulează programarea');
      btn.type = 'button';
      btn.setAttribute('data-hm-cancel', '1');
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        if (!window.confirm('Sigur anulezi această programare? Intervalul va fi eliberat.')) return;
        btn.disabled = true;
        btn.textContent = 'Se anulează…';
        cancel(booking);
      });
      actions.appendChild(btn);
      var hint = el('p', 'hm__hint',
        'Anularea și reprogramarea sunt posibile cu cel puțin ' +
        (booking.minCancelHours != null ? booking.minCancelHours : 24) +
        ' ore înainte de început (setarea cabinetului).');
      actions.appendChild(hint);
      body.appendChild(actions);

      var pane = el('div', 'hm__resched');
      pane.id = 'hm-resched-pane';
      pane.hidden = true;
      body.appendChild(pane);
    }
  }

  function openReschedulePane(booking) {
    var pane = $('#hm-resched-pane');
    if (!pane) return;
    pane.hidden = false;
    pane.innerHTML = '';
    pane.appendChild(el('p', 'hm__loading', 'Se încarcă intervalele libere…'));
    var token = tokenFromUrl();
    var fromYmd = ymdLocal(new Date());
    var toYmd = addDaysYmd(fromYmd, 13);
    fetch('/api/calendar-native/manage/slots?token=' + encodeURIComponent(token) +
      '&from=' + fromYmd + '&to=' + toYmd, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.body || !res.body.ok) {
          pane.innerHTML = '';
          pane.appendChild(el('div', 'hm__alert hm__alert--err',
            (res.body && res.body.error) || 'Nu am putut încărca intervalele libere.'));
          return;
        }
        renderReschedulePane(pane, booking, res.body);
      })
      .catch(function () {
        pane.innerHTML = '';
        pane.appendChild(el('div', 'hm__alert hm__alert--err',
          'Programările online sunt temporar indisponibile. Încearcă mai târziu.'));
      });
  }

  function renderReschedulePane(pane, booking, slotsResp) {
    pane.innerHTML = '';
    var tz = slotsResp.timezone || booking.timezone;
    var byDate = {};
    (slotsResp.slots || []).forEach(function (s) {
      var d = String(s.startUtc).slice(0, 10);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(s);
    });
    var dates = Object.keys(byDate).sort();
    if (!dates.length) {
      pane.appendChild(el('p', 'hm__hint', 'Nu mai sunt intervale libere în următoarele zile. Încearcă mai târziu sau contactează cabinetul direct.'));
      return;
    }
    pane.appendChild(el('p', 'hm__label', 'Alege un interval nou'));
    var errBox = el('div', 'hm__alert hm__alert--err');
    errBox.hidden = true;
    pane.appendChild(errBox);

    dates.forEach(function (d) {
      pane.appendChild(el('p', 'hm__day-label', formatDateLabel(d, tz)));
      var grid = el('div', 'hm__slots');
      byDate[d].forEach(function (slot) {
        var slotBtn = el('button', 'hm__slot', formatSlotLocal(slot.startUtc, tz));
        slotBtn.type = 'button';
        slotBtn.addEventListener('click', function () {
          if (!window.confirm('Muți programarea pe ' + formatWhen(slot.startUtc, slot.endUtc, tz) + '?')) return;
          errBox.hidden = true;
          slotBtn.disabled = true;
          submitReschedule(slot.startUtc, errBox, pane, booking);
        });
        grid.appendChild(slotBtn);
      });
      pane.appendChild(grid);
    });
  }

  function submitReschedule(startUtc, errBox, pane, prevBooking) {
    var token = tokenFromUrl();
    fetch('/api/calendar-native/manage/reschedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: token, startUtc: startUtc })
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.body || !res.body.ok) {
          errBox.hidden = false;
          errBox.textContent = (res.body && res.body.error) || 'Reprogramarea a eșuat.';
          // Slot may have just been taken — refresh the list so it disappears.
          openReschedulePane(prevBooking);
          return;
        }
        renderBooking(res.body.booking, { flash: 'Programare mutată. Vechiul interval este din nou liber.' });
      })
      .catch(function () {
        errBox.hidden = false;
        errBox.textContent = 'Nu am putut reprograma acum. Încearcă din nou.';
      });
  }

  function cancel(prev) {
    var token = tokenFromUrl();
    fetch('/api/calendar-native/manage/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: token })
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.body || !res.body.ok) {
          renderError((res.body && res.body.error) || 'Anularea a eșuat.');
          return;
        }
        renderBooking(res.body.booking, {
          flash: res.body.already
            ? 'Programarea era deja anulată.'
            : 'Programare anulată. Intervalul este din nou liber.'
        });
      })
      .catch(function () {
        renderError('Nu am putut anula acum. Încearcă din nou.');
      });
  }

  function load() {
    var token = tokenFromUrl();
    if (!token) {
      renderError('Lipsește linkul de gestionare. Deschide linkul din email.');
      return;
    }
    fetch('/api/calendar-native/manage?token=' + encodeURIComponent(token), {
      headers: { Accept: 'application/json' }
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.body || !res.body.ok || !res.body.booking) {
          renderError((res.body && res.body.error) || 'Link invalid sau expirat.');
          return;
        }
        renderBooking(res.body.booking);
      })
      .catch(function () {
        renderError('Programările online sunt temporar indisponibile. Încearcă mai târziu.');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();

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
        'Anularea este posibilă cu cel puțin ' +
        (booking.minCancelHours != null ? booking.minCancelHours : 24) +
        ' ore înainte de început (setarea cabinetului).');
      actions.appendChild(hint);
      body.appendChild(actions);
    }
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

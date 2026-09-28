(function () {
  function check() {
    var status = document.getElementById('startup-status');
    if (!status) return;
    if (document.documentElement.getAttribute('data-kiosk-ready') === 'true') {
      status.hidden = true;
    } else {
      status.textContent = 'Le lecteur n’a pas démarré. Fermez puis relancez l’application (version 1.0.2).';
    }
  }
  var timer = setTimeout(check, 6000);
  window.addEventListener('kiosk-ready', function () { clearTimeout(timer); check(); });
}());

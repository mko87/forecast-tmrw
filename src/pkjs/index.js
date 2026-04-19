// ─────────────────────────────────────────────────────────────────────────
// forecast-tmrw PebbleKit JS
// ─────────────────────────────────────────────────────────────────────────

var keys = require('message_keys');

var DEBUG_LOG_KEY = 'forecast_debug_log';
var MAX_LOG_ENTRIES = 40;

// ── Debug log (in PebbleKit JS localStorage) ──────────────────────────────

function debugLog(msg) {
  try {
    var raw = localStorage.getItem(DEBUG_LOG_KEY);
    var log = raw ? JSON.parse(raw) : [];
    var ts  = new Date().toISOString().slice(11, 19);
    log.unshift('[' + ts + '] ' + msg);
    if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(log));
  } catch(e) {}
  try { console.log('[ft] ' + msg); } catch(e) {}
}

function getDebugLog() {
  try {
    var raw = localStorage.getItem(DEBUG_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

// ── Settings ──────────────────────────────────────────────────────────────

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem('clay-settings') || '{}');
  } catch(e) { return {}; }
}

function isLangDe() { return !!getSettings().LANGUAGE_DE; }

function getApiKey() {
  var k = getSettings().API_KEY || '';
  return (k && k.length > 5) ? k : '';
}

// ── Send helpers (use named keys from message_keys module) ────────────────

function sendStatus(msg) {
  var m = {};
  m[keys.STATUS_MSG] = String(msg);
  Pebble.sendAppMessage(m,
    function() { debugLog('status sent: ' + msg); },
    function(e) { debugLog('status send FAIL: ' + msg + ' err=' + (e && e.error && e.error.message)); }
  );
}

// ── Weather code translation ──────────────────────────────────────────────

var CODES_EN = {
  1000:'Clear',1001:'Cloudy',1100:'Mostly Clear',1101:'Partly Cloudy',
  1102:'Mostly Cloudy',2000:'Fog',2100:'Light Fog',3000:'Light Wind',
  3001:'Wind',3002:'Strong Wind',4000:'Drizzle',4001:'Rain',
  4200:'Light Rain',4201:'Heavy Rain',5000:'Snow',5001:'Flurries',
  5100:'Light Snow',5101:'Heavy Snow',6000:'Freezing Drizzle',
  6001:'Freezing Rain',6200:'Light Freezing Rain',6201:'Heavy Freezing Rain',
  7000:'Ice Pellets',7101:'Heavy Ice Pellets',7102:'Light Ice Pellets',
  8000:'Thunderstorm'
};
var CODES_DE = {
  1000:'Klar',1001:'Bew\u00f6lkt',1100:'\u00dcberw. klar',1101:'Teilw. bew\u00f6lkt',
  1102:'\u00dcberw. bew\u00f6lkt',2000:'Nebel',2100:'Leichter Nebel',
  3000:'Leichter Wind',3001:'Wind',3002:'Starker Wind',4000:'Nieselregen',
  4001:'Regen',4200:'Leichter Regen',4201:'Starker Regen',5000:'Schnee',
  5001:'Schneegest\u00f6ber',5100:'Leichter Schnee',5101:'Starker Schnee',
  6000:'Gefr. Niesel',6001:'Gefrierregen',6200:'Leichter Gefrierregen',
  6201:'Starker Gefrierregen',7000:'Eisk\u00f6rner',7101:'Starke Eisk\u00f6rner',
  7102:'Leichte Eisk\u00f6rner',8000:'Gewitter'
};
function getWeatherStr(code, de) {
  var c = de ? CODES_DE : CODES_EN;
  return c[code] || (de ? 'Unbekannt' : 'Unknown');
}

// ── Sunrise/sunset ────────────────────────────────────────────────────────

function calcSunriseSunset(lat, lon) {
  var now   = new Date();
  var start = new Date(now.getFullYear(), 0, 0);
  var doy   = Math.floor((now - start) / 86400000);
  var B     = (360 / 365) * (doy - 81) * Math.PI / 180;
  var eot   = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  var latR  = lat * Math.PI / 180;
  var decl  = 23.45 * Math.sin((360 / 365) * (doy - 81) * Math.PI / 180) * Math.PI / 180;
  var cosHA = Math.max(-1, Math.min(1, -Math.tan(latR) * Math.tan(decl)));
  var ha    = Math.acos(cosHA) * 180 / Math.PI;
  var tz    = -now.getTimezoneOffset() / 60;
  var solar = 12 - eot / 60;
  var rise  = ((solar - ha / 15 + (lon / 15 - tz)) % 24 + 24) % 24;
  var set   = ((solar + ha / 15 + (lon / 15 - tz)) % 24 + 24) % 24;
  return { sunriseMin: Math.round(rise * 60), sunsetMin: Math.round(set * 60) };
}

// ── Weather fetch ─────────────────────────────────────────────────────────

function fetchWeather(lat, lon) {
  var apiKey = getApiKey();
  var de     = isLangDe();

  if (!apiKey) {
    debugLog('no API key');
    sendStatus(de ? 'Kein API-Key' : 'No API key');
    return;
  }
  debugLog('fetching weather');
  sendStatus(de ? 'Lade...' : 'Loading...');

  var loc = lat + ',' + lon;
  var base = 'https://api.tomorrow.io/v4/weather/';
  var rtUrl = base + 'realtime?location=' + encodeURIComponent(loc)
    + '&fields=temperature,weatherCode,precipitationProbability,precipitationIntensity'
    + '&units=metric&apikey=' + apiKey;
  var fcUrl = base + 'forecast?location=' + encodeURIComponent(loc)
    + '&timesteps=1h&fields=temperature,precipitationIntensity'
    + '&units=metric&apikey=' + apiKey;

  var xhr1 = new XMLHttpRequest();
  xhr1.open('GET', rtUrl, true);
  xhr1.onload = function() {
    debugLog('realtime HTTP ' + xhr1.status);
    if (xhr1.status < 200 || xhr1.status >= 300) {
      sendStatus((de ? 'Fehler ' : 'Err ') + xhr1.status);
      return;
    }
    var rt;
    try { rt = JSON.parse(xhr1.responseText); }
    catch(e) { debugLog('realtime parse err'); sendStatus('Parse err'); return; }

    var v = rt.data.values;
    var tempX10 = Math.round(v.temperature * 10);
    var codeStr = getWeatherStr(v.weatherCode, de);
    var prob    = Math.round(v.precipitationProbability || 0);
    var mmX10   = Math.round((v.precipitationIntensity || 0) * 10);

    var xhr2 = new XMLHttpRequest();
    xhr2.open('GET', fcUrl, true);
    xhr2.onload = function() {
      debugLog('forecast HTTP ' + xhr2.status);
      if (xhr2.status < 200 || xhr2.status >= 300) {
        sendStatus((de ? 'Fehler ' : 'Err ') + xhr2.status);
        return;
      }
      var fc;
      try { fc = JSON.parse(xhr2.responseText); }
      catch(e) { debugLog('forecast parse err'); sendStatus('Parse err'); return; }

      var intervals = fc.timelines.hourly.slice(0, 24);
      var fTemps = new Int16Array(24);
      var fRains = new Int16Array(24);
      var fHours = new Uint8Array(24);
      for (var i = 0; i < intervals.length; i++) {
        var iv = intervals[i];
        var t  = new Date(iv.time);
        fHours[i] = t.getHours();
        fTemps[i] = Math.round(iv.values.temperature * 10);
        fRains[i] = Math.round((iv.values.precipitationIntensity || 0) * 10);
      }

      var sun = calcSunriseSunset(lat, lon);

      var msg = {};
      msg[keys.TEMP_CURRENT]   = tempX10;
      msg[keys.WEATHER_STR]    = codeStr;
      msg[keys.RAIN_PROB]      = prob;
      msg[keys.RAIN_MM]        = mmX10;
      msg[keys.FORECAST_TEMP]  = Array.prototype.slice.call(new Uint8Array(fTemps.buffer));
      msg[keys.FORECAST_RAIN]  = Array.prototype.slice.call(new Uint8Array(fRains.buffer));
      msg[keys.FORECAST_HOURS] = Array.prototype.slice.call(fHours);
      msg[keys.SUNRISE_MIN]    = sun.sunriseMin;
      msg[keys.SUNSET_MIN]     = sun.sunsetMin;
      msg[keys.LANGUAGE_DE]    = de ? 1 : 0;

      Pebble.sendAppMessage(msg,
        function() { debugLog('data send OK'); },
        function(e) { debugLog('data send FAIL: ' + (e && e.error && e.error.message)); }
      );
    };
    xhr2.onerror = function() { debugLog('forecast net err'); sendStatus('Net err'); };
    xhr2.send();
  };
  xhr1.onerror = function() { debugLog('realtime net err'); sendStatus('Net err'); };
  xhr1.send();
}

function startFetch() {
  debugLog('GPS start');
  sendStatus('GPS...');
  if (!navigator.geolocation) {
    debugLog('no geolocation API');
    sendStatus('No GPS API');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      var lat = pos.coords.latitude;
      var lon = pos.coords.longitude;
      debugLog('GPS OK ' + lat.toFixed(2) + ',' + lon.toFixed(2));
      fetchWeather(lat, lon);
    },
    function(err) {
      debugLog('GPS err code=' + err.code + ' msg=' + err.message);
      sendStatus('GPS err ' + err.code);
    },
    { timeout: 15000, maximumAge: 60000 }
  );
}

// ── Ready handler (registered FIRST before Clay) ──────────────────────────

Pebble.addEventListener('ready', function() {
  debugLog('=== JS ready ===');
  sendStatus('JS ready');
  setTimeout(function() { startFetch(); }, 300);
});

Pebble.addEventListener('appmessage', function(e) {
  debugLog('appmsg received');
  if (e.payload && e.payload[keys.FETCH_TRIGGER]) {
    startFetch();
  }
});

// ── Clay (after ready handler, wrapped in try-catch) ──────────────────────

var clayConfig = [
  { 'type': 'heading', 'defaultValue': 'forecast-tmrw' },
  {
    'type': 'section',
    'items': [{
      'type': 'input',
      'messageKey': 'API_KEY',
      'label': 'Tomorrow.io API Key',
      'defaultValue': '',
      'attributes': { 'placeholder': 'Paste API key...', 'type': 'text' }
    }]
  },
  {
    'type': 'section',
    'items': [{
      'type': 'toggle',
      'messageKey': 'LANGUAGE_DE',
      'label': 'Deutsch / German',
      'defaultValue': false
    }]
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'toggle',
        'messageKey': 'DEBUG_ENABLED',
        'label': 'Debug Log',
        'defaultValue': true
      },
      {
        'type': 'text',
        'defaultValue': '<div id="ft-log"></div>'
      }
    ]
  },
  { 'type': 'submit', 'defaultValue': 'Save / Speichern' }
];

function buildLogHtml() {
  var log = getDebugLog();
  var body = log.length
    ? log.map(function(l) {
        return l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }).join('\n')
    : '(no entries yet — open app first)';
  return '<b style="color:#ccc">Debug Log:</b>'
    + '<pre style="font-size:10px;font-family:monospace;white-space:pre-wrap;'
    + 'word-break:break-all;max-height:180px;overflow-y:auto;background:#1a1a1a;'
    + 'color:#aaa;padding:6px;margin-top:4px;border-radius:4px">'
    + body + '</pre>';
}

try {
  var Clay = require('pebble-clay');
  // Build config snapshot so we can inject log HTML on each open
  var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

  Pebble.addEventListener('showConfiguration', function() {
    debugLog('config open');
    // Inject current debug log into the text component's defaultValue
    try {
      for (var i = 0; i < clayConfig.length; i++) {
        var s = clayConfig[i];
        if (s.items) {
          for (var j = 0; j < s.items.length; j++) {
            if (s.items[j].type === 'text') {
              s.items[j].defaultValue = buildLogHtml();
            }
          }
        }
      }
    } catch(e) { debugLog('log inject err: ' + e.message); }
    try {
      Pebble.openURL(clay.generateUrl());
    } catch(e) {
      debugLog('openURL err: ' + e.message);
    }
  });

  Pebble.addEventListener('webviewclosed', function(e) {
    debugLog('config closed');
    if (e && e.response) {
      try {
        var dict = clay.getSettings(e.response);
        Pebble.sendAppMessage(dict,
          function() { debugLog('settings forwarded'); },
          function(er) { debugLog('settings forward err'); }
        );
      } catch(er) { debugLog('getSettings err: ' + er.message); }
    }
    setTimeout(function() { startFetch(); }, 500);
  });

  debugLog('Clay init OK');
} catch(e) {
  debugLog('Clay init FAIL: ' + (e && e.message));
}

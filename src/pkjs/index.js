var Clay = require('pebble-clay');

var clayConfig = [
  {
    'type': 'heading',
    'defaultValue': 'forecast-tmrw'
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'input',
        'messageKey': 'API_KEY',
        'label': 'Tomorrow.io API Key',
        'defaultValue': '',
        'attributes': {
          'placeholder': 'Paste API key here...',
          'type': 'text'
        }
      }
    ]
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'toggle',
        'messageKey': 'LANGUAGE_DE',
        'label': 'Deutsch / German',
        'defaultValue': false
      }
    ]
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'toggle',
        'messageKey': 'DEBUG_ENABLED',
        'label': 'Debug Log',
        'defaultValue': false
      },
      {
        'type': 'text',
        'defaultValue': '<b style="color:#ccc">Debug Log:</b><div id="ft-debug-log" style="font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow-y:auto;background:#1a1a1a;color:#aaa;padding:6px;margin-top:4px;border-radius:4px">(enable debug + fetch to see log)</div>'
      }
    ]
  },
  {
    'type': 'submit',
    'defaultValue': 'Save / Speichern'
  }
];

function clayCustomFn() {
  // Runs in webview context — read debug log from shared localStorage
  var el = document.getElementById('ft-debug-log');
  if (!el) return;
  try {
    var raw = localStorage.getItem('forecast_debug_log');
    var log = raw ? JSON.parse(raw) : [];
    el.textContent = log.length ? log.join('\n') : '(no entries yet)';
  } catch(e) {
    el.textContent = '(error reading log)';
  }
}

var clay = new Clay(clayConfig, clayCustomFn, {autoHandleEvents: false});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (e && e.response) {
    try {
      var dict = clay.getSettings(e.response);
      Pebble.sendAppMessage(dict, function(){}, function(){});
    } catch(err) {}
  }
  // Refetch weather with new settings
  startFetch();
});

// Message key indices (must match package.json messageKeys order)
var KEY = {
  TEMP_CURRENT:   0,
  WEATHER_STR:    1,
  RAIN_PROB:      2,
  RAIN_MM:        3,
  FORECAST_TEMP:  4,
  FORECAST_RAIN:  5,
  FORECAST_HOURS: 6,
  SUNRISE_MIN:    7,
  SUNSET_MIN:     8,
  LANGUAGE_DE:    9,
  DEBUG_ENABLED:  10,
  STATUS_MSG:     11,
  FETCH_TRIGGER:  12
};

var DEBUG_LOG_KEY = 'forecast_debug_log';
var MAX_LOG_ENTRIES = 40;

// ── Weather code translation ───────────────────────────────────────────────

var WEATHER_CODES_EN = {
  1000: 'Clear', 1001: 'Cloudy', 1100: 'Mostly Clear',
  1101: 'Partly Cloudy', 1102: 'Mostly Cloudy',
  2000: 'Fog', 2100: 'Light Fog',
  3000: 'Light Wind', 3001: 'Wind', 3002: 'Strong Wind',
  4000: 'Drizzle', 4001: 'Rain', 4200: 'Light Rain', 4201: 'Heavy Rain',
  5000: 'Snow', 5001: 'Flurries', 5100: 'Light Snow', 5101: 'Heavy Snow',
  6000: 'Freezing Drizzle', 6001: 'Freezing Rain',
  6200: 'Light Freezing Rain', 6201: 'Heavy Freezing Rain',
  7000: 'Ice Pellets', 7101: 'Heavy Ice Pellets', 7102: 'Light Ice Pellets',
  8000: 'Thunderstorm'
};

var WEATHER_CODES_DE = {
  1000: 'Klar', 1001: 'Bew\u00f6lkt', 1100: '\u00dcberwiegend klar',
  1101: 'Teilweise bew\u00f6lkt', 1102: '\u00dcberwiegend bew\u00f6lkt',
  2000: 'Nebel', 2100: 'Leichter Nebel',
  3000: 'Leichter Wind', 3001: 'Wind', 3002: 'Starker Wind',
  4000: 'Nieselregen', 4001: 'Regen', 4200: 'Leichter Regen', 4201: 'Starker Regen',
  5000: 'Schnee', 5001: 'Schneegest\u00f6ber', 5100: 'Leichter Schnee', 5101: 'Starker Schnee',
  6000: 'Gefr. Nieselregen', 6001: 'Gefrierregen',
  6200: 'Leichter Gefrierregen', 6201: 'Starker Gefrierregen',
  7000: 'Eisk\u00f6rner', 7101: 'Starke Eisk\u00f6rner', 7102: 'Leichte Eisk\u00f6rner',
  8000: 'Gewitter'
};

function getWeatherStr(code, langDe) {
  var codes = langDe ? WEATHER_CODES_DE : WEATHER_CODES_EN;
  return codes[code] || (langDe ? 'Unbekannt' : 'Unknown');
}

// ── Debug log ──────────────────────────────────────────────────────────────

function debugLog(msg) {
  try {
    var log = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || '[]');
    var ts  = new Date().toISOString().slice(11, 19);
    log.unshift('[' + ts + '] ' + msg);
    if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(log));
  } catch(e) {}
}

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem('clay-settings') || '{}');
  } catch(e) { return {}; }
}

function isDebugEnabled() { return !!getSettings().DEBUG_ENABLED; }
function isLangDe()       { return !!getSettings().LANGUAGE_DE; }

function getApiKey() {
  var k = getSettings().API_KEY || '';
  return (k && k.length > 5) ? k : '';
}

// ── Sunrise/sunset (simplified solar formula) ─────────────────────────────

function calcSunriseSunset(lat, lon) {
  var now      = new Date();
  var start    = new Date(now.getFullYear(), 0, 0);
  var doy      = Math.floor((now - start) / 86400000);
  var B        = (360 / 365) * (doy - 81) * (Math.PI / 180);
  var eot      = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  var latR     = lat * Math.PI / 180;
  var decl     = 23.45 * Math.sin((360 / 365) * (doy - 81) * Math.PI / 180) * Math.PI / 180;
  var cosHA    = -Math.tan(latR) * Math.tan(decl);
  cosHA        = Math.max(-1, Math.min(1, cosHA));
  var ha       = Math.acos(cosHA) * 180 / Math.PI;
  var tz       = -now.getTimezoneOffset() / 60;
  var solar    = 12 - eot / 60;
  var rise     = ((solar - ha / 15 + (lon / 15 - tz)) % 24 + 24) % 24;
  var set      = ((solar + ha / 15 + (lon / 15 - tz)) % 24 + 24) % 24;
  return { sunriseMin: Math.round(rise * 60), sunsetMin: Math.round(set * 60) };
}

// ── API fetch ─────────────────────────────────────────────────────────────

function fetchWeather(lat, lon) {
  var apiKey = getApiKey();
  var langDe = isLangDe();
  var debug  = isDebugEnabled();

  if (!apiKey) {
    debugLog('No API key in settings');
    sendStatus(langDe ? 'Kein API-Key' : 'No API key');
    return;
  }
  debugLog('API key found, fetching...');

  var loc = lat + ',' + lon;
  var baseUrl = 'https://api.tomorrow.io/v4/weather/';

  var realtimeUrl = baseUrl + 'realtime'
    + '?location=' + encodeURIComponent(loc)
    + '&fields=temperature,weatherCode,precipitationProbability,precipitationIntensity'
    + '&units=metric&apikey=' + apiKey;

  var forecastUrl = baseUrl + 'forecast'
    + '?location=' + encodeURIComponent(loc)
    + '&timesteps=1h'
    + '&fields=temperature,precipitationIntensity'
    + '&units=metric&apikey=' + apiKey;

  sendStatus(langDe ? 'Lade...' : 'Loading...');

  var xhr1 = new XMLHttpRequest();
  xhr1.open('GET', realtimeUrl, true);
  xhr1.onload = function() {
    if (xhr1.status >= 200 && xhr1.status < 300) {
      debugLog('realtime OK');
      var rt;
      try { rt = JSON.parse(xhr1.responseText); }
      catch(e) {
        debugLog('realtime parse error');
        sendStatus(langDe ? 'Fehler (Parse)' : 'Error (parse)');
        return;
      }
      var v      = rt.data.values;
      var tempX10 = Math.round(v.temperature * 10);
      var codeStr = getWeatherStr(v.weatherCode, langDe);
      var prob    = Math.round(v.precipitationProbability || 0);
      var mmX10   = Math.round((v.precipitationIntensity || 0) * 10);

      var xhr2 = new XMLHttpRequest();
      xhr2.open('GET', forecastUrl, true);
      xhr2.onload = function() {
        if (xhr2.status >= 200 && xhr2.status < 300) {
          debugLog('forecast OK');
          var fc;
          try { fc = JSON.parse(xhr2.responseText); }
          catch(e) {
            debugLog('forecast parse error');
            sendStatus(langDe ? 'Fehler (Parse)' : 'Error (parse)');
            return;
          }

          var intervals = fc.timelines.hourly.slice(0, 24);
          var fTemps  = new Int16Array(24);
          var fRains  = new Int16Array(24);
          var fHours  = new Uint8Array(24);

          for (var i = 0; i < intervals.length; i++) {
            var iv = intervals[i];
            var t  = new Date(iv.time);
            fHours[i] = t.getHours();
            fTemps[i] = Math.round(iv.values.temperature * 10);
            fRains[i] = Math.round((iv.values.precipitationIntensity || 0) * 10);
          }

          var sun = calcSunriseSunset(lat, lon);

          var msg = {};
          msg[KEY.TEMP_CURRENT]   = tempX10;
          msg[KEY.WEATHER_STR]    = codeStr;
          msg[KEY.RAIN_PROB]      = prob;
          msg[KEY.RAIN_MM]        = mmX10;
          msg[KEY.FORECAST_TEMP]  = Array.from(new Uint8Array(fTemps.buffer));
          msg[KEY.FORECAST_RAIN]  = Array.from(new Uint8Array(fRains.buffer));
          msg[KEY.FORECAST_HOURS] = Array.from(fHours);
          msg[KEY.SUNRISE_MIN]    = sun.sunriseMin;
          msg[KEY.SUNSET_MIN]     = sun.sunsetMin;
          msg[KEY.LANGUAGE_DE]    = langDe ? 1 : 0;

          Pebble.sendAppMessage(msg,
            function() { debugLog('send OK'); },
            function(e) { debugLog('send fail: ' + (e && e.error)); }
          );
        } else {
          debugLog('forecast HTTP ' + xhr2.status);
          sendStatus((langDe ? 'Fehler' : 'Error') + ' ' + xhr2.status);
        }
      };
      xhr2.onerror = function() {
        debugLog('forecast network error');
        sendStatus(langDe ? 'Netzwerkfehler' : 'Network error');
      };
      xhr2.send();
    } else {
      debugLog('realtime HTTP ' + xhr1.status);
      sendStatus((langDe ? 'Fehler' : 'Error') + ' ' + xhr1.status);
    }
  };
  xhr1.onerror = function() {
    debugLog('realtime network error');
    sendStatus(langDe ? 'Netzwerkfehler' : 'Network error');
  };
  xhr1.send();
}

function sendStatus(msg) {
  var m = {};
  m[KEY.STATUS_MSG] = msg;
  Pebble.sendAppMessage(m, function(){}, function(){});
}

// ── GPS + trigger ─────────────────────────────────────────────────────────

function startFetch() {
  debugLog('GPS request start');
  sendStatus('GPS...');
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      var lat = pos.coords.latitude;
      var lon = pos.coords.longitude;
      debugLog('GPS OK ' + lat.toFixed(2) + ',' + lon.toFixed(2));
      fetchWeather(lat, lon);
    },
    function(err) {
      var msg = 'GPS err ' + err.code + ': ' + err.message;
      debugLog(msg);
      sendStatus('GPS err ' + err.code);
    },
    { timeout: 15000, maximumAge: 60000 }
  );
}

// ── Pebble events ─────────────────────────────────────────────────────────

Pebble.addEventListener('ready', function() {
  debugLog('JS ready');
  sendStatus('JS ready, getting GPS...');
  startFetch();
});

Pebble.addEventListener('appmessage', function(e) {
  if (e.payload && e.payload[KEY.FETCH_TRIGGER]) {
    startFetch();
  }
});

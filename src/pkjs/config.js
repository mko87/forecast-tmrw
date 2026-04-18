module.exports = [
  {
    "type": "heading",
    "defaultValue": "forecast-tmrw"
  },
  {
    "type": "section",
    "items": [
      {
        "type": "input",
        "id": "apiKey",
        "label": "Tomorrow.io API Key",
        "attributes": {
          "placeholder": "Paste API key here...",
          "type": "password"
        }
      }
    ]
  },
  {
    "type": "section",
    "items": [
      {
        "type": "toggle",
        "messageKey": "LANGUAGE_DE",
        "label": "Deutsch / German",
        "defaultValue": false
      }
    ]
  },
  {
    "type": "section",
    "items": [
      {
        "type": "toggle",
        "messageKey": "DEBUG_ENABLED",
        "label": "Debug Log",
        "defaultValue": false
      },
      {
        "type": "text",
        "defaultValue": "<div id='debug-log' style='font-size:10px;font-family:monospace;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow-y:auto;background:#111;color:#aaa;padding:6px;border-radius:4px;'></div><script>(function(){var el=document.getElementById('debug-log');try{var log=JSON.parse(localStorage.getItem('forecast_debug_log')||'[]');el.textContent=log.length?log.join('\\n'):'(no entries)';}catch(e){el.textContent='(error reading log)';}}());</script>"
      }
    ]
  }
];

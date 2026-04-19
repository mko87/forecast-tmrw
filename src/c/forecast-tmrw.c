#include <pebble.h>

#define FORECAST_COUNT 24
#define Y_LABEL_W      20
#define TITLE_H        13
#define X_LABEL_H      11
#define CHART_TOTAL_H  46
#define CHART_INNER_H  (CHART_TOTAL_H - TITLE_H - X_LABEL_H)  // 22

#define WEATHER_SECTION_H  56

static Window *s_window;

static TextLayer *s_temp_layer;
static TextLayer *s_code_layer;
static TextLayer *s_rain_layer;
static Layer     *s_temp_chart_layer;
static Layer     *s_rain_chart_layer;
static TextLayer *s_loading_layer;

static int32_t s_temp_current = 0;        // *10
static char    s_weather_str[40] = "";
static int32_t s_rain_prob = 0;
static int32_t s_rain_mm = 0;             // *10
static int16_t s_forecast_temp[FORECAST_COUNT];
static int16_t s_forecast_rain[FORECAST_COUNT];
static uint8_t s_forecast_hours[FORECAST_COUNT];
static int32_t s_sunrise_min = 360;
static int32_t s_sunset_min  = 1200;
static bool    s_data_loaded = false;
static bool    s_language_de = false;

static char s_temp_str[20];
static char s_rain_str[48];
static char s_status_str[64] = "Loading...";

// ── helpers ───────────────────────────────────────────────────────────────

static void format_decimal(char *buf, size_t len, int32_t val_x10) {
  int whole = (int)(val_x10 / 10);
  int frac  = (int)abs((int)(val_x10 % 10));
  snprintf(buf, len, "%d.%d", whole, frac);
}

static bool is_night(uint8_t hour) {
  int32_t min = (int32_t)hour * 60;
  return (min < s_sunrise_min || min >= s_sunset_min);
}

static int16_t arr_min(int16_t *arr, int n) {
  int16_t m = arr[0];
  for (int i = 1; i < n; i++) if (arr[i] < m) m = arr[i];
  return m;
}

static int16_t arr_max(int16_t *arr, int n) {
  int16_t m = arr[0];
  for (int i = 1; i < n; i++) if (arr[i] > m) m = arr[i];
  return m;
}

// ── chart drawing ─────────────────────────────────────────────────────────

static void draw_chart(GContext *ctx, GRect bounds, int16_t *data, bool is_rain) {
  // Layout inside canvas layer (bounds.origin is 0,0 in local coords)
  int cw = bounds.size.w;

  int title_y  = 0;
  int chart_x  = Y_LABEL_W;
  int chart_y  = TITLE_H;
  int chart_w  = cw - Y_LABEL_W - 1;
  int chart_h  = CHART_INNER_H;
  int xlbl_y   = TITLE_H + CHART_INNER_H + 2;

  // Title
  GFont small_font = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  graphics_context_set_text_color(ctx, GColorWhite);
  const char *title = is_rain
    ? (s_language_de ? "Regen 24h (mm/h)" : "Rain 24h (mm/h)")
    : (s_language_de ? "Temp 24h (\260C)"  : "Temp 24h (\260C)");
  graphics_draw_text(ctx, title, small_font,
    GRect(chart_x, title_y, chart_w, TITLE_H),
    GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);

  // Min / max
  int16_t dmin = arr_min(data, FORECAST_COUNT);
  int16_t dmax = arr_max(data, FORECAST_COUNT);
  int16_t range = dmax - dmin;
  if (range < 5) {
    dmin -= 5;
    dmax += 5;
    range = dmax - dmin;
  }

  // Y-axis labels (max top, min bottom)
  char ymax_str[16], ymin_str[16];
  format_decimal(ymax_str, sizeof(ymax_str), (int32_t)dmax);
  format_decimal(ymin_str, sizeof(ymin_str), (int32_t)dmin);
  graphics_draw_text(ctx, ymax_str, small_font,
    GRect(0, chart_y, Y_LABEL_W - 1, TITLE_H),
    GTextOverflowModeWordWrap, GTextAlignmentRight, NULL);
  graphics_draw_text(ctx, ymin_str, small_font,
    GRect(0, chart_y + chart_h - TITLE_H, Y_LABEL_W - 1, TITLE_H),
    GTextOverflowModeWordWrap, GTextAlignmentRight, NULL);

  // Night shading (stipple pattern)
  for (int i = 0; i < FORECAST_COUNT; i++) {
    int x0 = chart_x + (i * chart_w) / FORECAST_COUNT;
    int x1 = chart_x + ((i + 1) * chart_w) / FORECAST_COUNT;
    if (!is_night(s_forecast_hours[i])) continue;

#ifdef PBL_COLOR
    graphics_context_set_fill_color(ctx, GColorOxfordBlue);
    graphics_fill_rect(ctx, GRect(x0, chart_y, x1 - x0, chart_h), 0, GCornerNone);
#else
    for (int y = chart_y; y < chart_y + chart_h; y++) {
      for (int x = x0 + (y % 2); x < x1; x += 2) {
        graphics_context_set_stroke_color(ctx, GColorWhite);
        graphics_draw_pixel(ctx, GPoint(x, y));
      }
    }
#endif
  }

  // Data line (2px)
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_context_set_stroke_width(ctx, 2);

  GPoint prev = GPoint(0, 0);
  for (int i = 0; i < FORECAST_COUNT; i++) {
    int cx = chart_x + (i * chart_w) / FORECAST_COUNT + chart_w / (2 * FORECAST_COUNT);
    int cy = chart_y + chart_h - 1 - ((int)(data[i] - dmin) * (chart_h - 1)) / range;
    cy = (cy < chart_y) ? chart_y : (cy >= chart_y + chart_h ? chart_y + chart_h - 1 : cy);
    GPoint pt = GPoint(cx, cy);
    if (i > 0) {
      graphics_draw_line(ctx, prev, pt);
    }
    prev = pt;
  }
  graphics_context_set_stroke_width(ctx, 1);

  // X-axis baseline
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_draw_line(ctx,
    GPoint(chart_x, chart_y + chart_h),
    GPoint(chart_x + chart_w, chart_y + chart_h));

  // X-axis ticks + labels every 6 hours
  int last_lbl_x = -99;
  for (int i = 0; i < FORECAST_COUNT; i++) {
    if (s_forecast_hours[i] % 6 != 0) continue;
    int tx = chart_x + (i * chart_w) / FORECAST_COUNT + chart_w / (2 * FORECAST_COUNT);
    // Tick
    graphics_draw_line(ctx, GPoint(tx, chart_y + chart_h), GPoint(tx, chart_y + chart_h + 3));
    // Label (avoid overlap: min 18px apart)
    if (tx - last_lbl_x >= 18) {
      char lbl[4];
      snprintf(lbl, sizeof(lbl), "%02d", s_forecast_hours[i]);
      graphics_draw_text(ctx, lbl, small_font,
        GRect(tx - 8, xlbl_y, 18, X_LABEL_H),
        GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
      last_lbl_x = tx;
    }
  }
}

static void temp_chart_update(Layer *layer, GContext *ctx) {
  if (!s_data_loaded) return;
  draw_chart(ctx, layer_get_bounds(layer), s_forecast_temp, false);
}

static void rain_chart_update(Layer *layer, GContext *ctx) {
  if (!s_data_loaded) return;
  draw_chart(ctx, layer_get_bounds(layer), s_forecast_rain, true);
}

// ── UI update ─────────────────────────────────────────────────────────────

static void update_ui(void) {
  if (!s_data_loaded) {
    layer_set_hidden(text_layer_get_layer(s_loading_layer), false);
    layer_set_hidden(text_layer_get_layer(s_temp_layer),    true);
    layer_set_hidden(text_layer_get_layer(s_code_layer),    true);
    layer_set_hidden(text_layer_get_layer(s_rain_layer),    true);
    layer_set_hidden(s_temp_chart_layer, true);
    layer_set_hidden(s_rain_chart_layer, true);
    return;
  }

  layer_set_hidden(text_layer_get_layer(s_loading_layer), true);
  layer_set_hidden(text_layer_get_layer(s_temp_layer),    false);
  layer_set_hidden(text_layer_get_layer(s_code_layer),    false);
  layer_set_hidden(text_layer_get_layer(s_rain_layer),    false);
  layer_set_hidden(s_temp_chart_layer, false);
  layer_set_hidden(s_rain_chart_layer, false);

  // Temperature
  char tmp[16];
  format_decimal(tmp, sizeof(tmp), s_temp_current);
  snprintf(s_temp_str, sizeof(s_temp_str), "%s\260C", tmp);
  text_layer_set_text(s_temp_layer, s_temp_str);

  // Weather code string
  text_layer_set_text(s_code_layer, s_weather_str);

  // Rain info
  char rain_tmp[16];
  format_decimal(rain_tmp, sizeof(rain_tmp), s_rain_mm);
  if (s_language_de) {
    snprintf(s_rain_str, sizeof(s_rain_str), "Regen %d%% | %s mm/h",
             (int)s_rain_prob, rain_tmp);
  } else {
    snprintf(s_rain_str, sizeof(s_rain_str), "Rain %d%% | %s mm/h",
             (int)s_rain_prob, rain_tmp);
  }
  text_layer_set_text(s_rain_layer, s_rain_str);

  layer_mark_dirty(s_temp_chart_layer);
  layer_mark_dirty(s_rain_chart_layer);
}

// ── AppMessage ────────────────────────────────────────────────────────────

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *t;

  t = dict_find(iter, MESSAGE_KEY_TEMP_CURRENT);
  if (t) s_temp_current = t->value->int32;

  t = dict_find(iter, MESSAGE_KEY_WEATHER_STR);
  if (t) strncpy(s_weather_str, t->value->cstring, sizeof(s_weather_str) - 1);

  t = dict_find(iter, MESSAGE_KEY_RAIN_PROB);
  if (t) s_rain_prob = t->value->int32;

  t = dict_find(iter, MESSAGE_KEY_RAIN_MM);
  if (t) s_rain_mm = t->value->int32;

  t = dict_find(iter, MESSAGE_KEY_FORECAST_TEMP);
  if (t && t->length >= FORECAST_COUNT * 2) {
    memcpy(s_forecast_temp, t->value->data, FORECAST_COUNT * sizeof(int16_t));
  }

  t = dict_find(iter, MESSAGE_KEY_FORECAST_RAIN);
  if (t && t->length >= FORECAST_COUNT * 2) {
    memcpy(s_forecast_rain, t->value->data, FORECAST_COUNT * sizeof(int16_t));
  }

  t = dict_find(iter, MESSAGE_KEY_FORECAST_HOURS);
  if (t && t->length >= FORECAST_COUNT) {
    memcpy(s_forecast_hours, t->value->data, FORECAST_COUNT * sizeof(uint8_t));
  }

  t = dict_find(iter, MESSAGE_KEY_SUNRISE_MIN);
  if (t) s_sunrise_min = t->value->int32;

  t = dict_find(iter, MESSAGE_KEY_SUNSET_MIN);
  if (t) s_sunset_min = t->value->int32;

  t = dict_find(iter, MESSAGE_KEY_LANGUAGE_DE);
  if (t) s_language_de = (t->value->int32 != 0);

  // Check if we got enough data to show
  bool has_weather = (s_weather_str[0] != '\0');
  bool has_forecast = (s_forecast_hours[0] != 0 || s_forecast_hours[1] != 0);
  if (has_weather && has_forecast) {
    s_data_loaded = true;
  }

  t = dict_find(iter, MESSAGE_KEY_STATUS_MSG);
  if (t && !s_data_loaded) {
    strncpy(s_status_str, t->value->cstring, sizeof(s_status_str) - 1);
    s_status_str[sizeof(s_status_str) - 1] = '\0';
    text_layer_set_text(s_loading_layer, s_status_str);
  }

  update_ui();
}

static void inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox dropped: %d", (int)reason);
}

static void send_fetch_request(void) {
  DictionaryIterator *iter;
  AppMessageResult r = app_message_outbox_begin(&iter);
  if (r != APP_MSG_OK) return;
  dict_write_int32(iter, MESSAGE_KEY_FETCH_TRIGGER, 1);
  app_message_outbox_send();
}

// ── Window ────────────────────────────────────────────────────────────────

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect full = layer_get_bounds(root);
  window_set_background_color(window, GColorBlack);

  int w = full.size.w;
  int h = full.size.h;

  // Compact fixed layout — no scroll, no status bar
  // y=0..26:  temperature (GOTHIC_24_BOLD)
  // y=26..40: weather code (GOTHIC_14)
  // y=40..54: rain info (GOTHIC_14)
  // y=56..102: temp chart (46px)
  // y=104..150: rain chart (46px)
  int top_y   = 0;
  int chart1_y = WEATHER_SECTION_H;                         // 56
  int chart2_y = chart1_y + CHART_TOTAL_H + 2;              // 104
  int content_bottom = chart2_y + CHART_TOTAL_H;            // 150

  // Center content vertically if screen is taller (emery/chalk)
  if (h > content_bottom) {
    top_y = (h - content_bottom) / 2;
    chart1_y += top_y;
    chart2_y += top_y;
  }

  // Loading label (centered, covers whole area when no data)
  s_loading_layer = text_layer_create(GRect(0, h / 2 - 12, w, 24));
  text_layer_set_background_color(s_loading_layer, GColorClear);
  text_layer_set_text_color(s_loading_layer, GColorWhite);
  text_layer_set_font(s_loading_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_loading_layer, GTextAlignmentCenter);
  text_layer_set_text(s_loading_layer, s_status_str);
  layer_add_child(root, text_layer_get_layer(s_loading_layer));

  // Temperature (large)
  s_temp_layer = text_layer_create(GRect(2, top_y, w - 4, 28));
  text_layer_set_background_color(s_temp_layer, GColorClear);
  text_layer_set_text_color(s_temp_layer, GColorWhite);
  text_layer_set_font(s_temp_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_temp_layer, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_temp_layer));

  // Weather code
  s_code_layer = text_layer_create(GRect(2, top_y + 26, w - 4, 14));
  text_layer_set_background_color(s_code_layer, GColorClear);
  text_layer_set_text_color(s_code_layer, GColorWhite);
  text_layer_set_font(s_code_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_code_layer, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_code_layer));

  // Rain info
  s_rain_layer = text_layer_create(GRect(2, top_y + 40, w - 4, 14));
  text_layer_set_background_color(s_rain_layer, GColorClear);
  text_layer_set_text_color(s_rain_layer, GColorWhite);
  text_layer_set_font(s_rain_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_rain_layer, GTextAlignmentCenter);
  layer_add_child(root, text_layer_get_layer(s_rain_layer));

  // Charts
  s_temp_chart_layer = layer_create(GRect(0, chart1_y, w, CHART_TOTAL_H));
  layer_set_update_proc(s_temp_chart_layer, temp_chart_update);
  layer_add_child(root, s_temp_chart_layer);

  s_rain_chart_layer = layer_create(GRect(0, chart2_y, w, CHART_TOTAL_H));
  layer_set_update_proc(s_rain_chart_layer, rain_chart_update);
  layer_add_child(root, s_rain_chart_layer);

  update_ui();
}

static void window_unload(Window *window) {
  text_layer_destroy(s_loading_layer);
  text_layer_destroy(s_temp_layer);
  text_layer_destroy(s_code_layer);
  text_layer_destroy(s_rain_layer);
  layer_destroy(s_temp_chart_layer);
  layer_destroy(s_rain_chart_layer);
}

// ── App init/deinit ───────────────────────────────────────────────────────

static void prv_init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load   = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);

  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_open(512, 64);
  // JS triggers fetch automatically on ready; no outbox needed at startup
}

static void prv_deinit(void) {
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}

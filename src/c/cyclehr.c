// The SDK builds with -D_TIME_H_, which suppresses <time.h>. Some toolchains
// (e.g. our local one) then leave time_t undefined, so we pull it in from
// <sys/types.h>. Other build environments (e.g. CloudPebble) instead pass
// -Dtime_t=long, making time_t a predefined macro — including <sys/types.h>
// there would redeclare it and fail with "two or more data types in
// declaration specifiers". Only include it when time_t is not already defined.
#ifndef time_t
#include <sys/types.h>
#endif
#include <pebble.h>

// ---------------------------------------------------------------------------
// CycleHR - cycling watchface
//   top    : weather (icon / temperature / conditions)
//   middle : time, AM/PM, date
//   below  : current heart rate (bpm)
//   bottom : last 60 minutes of HR as 1-minute zone-colored bars + Z1-Z5 legend
// ---------------------------------------------------------------------------

#define HISTORY_LEN 60

// HR zones derived from max HR (simple %max model). The max HR defaults to
// 190 but is overridden from the config screen (220 - age). Zone thresholds
// are computed at runtime from s_max_hr.
#define DEFAULT_MAX_HR 190
#define ZONE2_MIN (s_max_hr * 60 / 100)
#define ZONE3_MIN (s_max_hr * 70 / 100)
#define ZONE4_MIN (s_max_hr * 80 / 100)
#define ZONE5_MIN (s_max_hr * 90 / 100)

// Chart vertical scale
#define CHART_HR_MIN 50
#define CHART_HR_MAX (s_max_hr)

// Time format (from config): 0=follow watch, 1=12h (AM/PM), 2=24h
enum {
  TIME_FORMAT_SYSTEM = 0,
  TIME_FORMAT_12H,
  TIME_FORMAT_24H,
};

// How often the HR sensor should sample while this face is open (seconds)
#define HR_SAMPLE_PERIOD_SEC 15

// Persistence keys
#define PERSIST_KEY_HISTORY     1
#define PERSIST_KEY_HEAD        2
#define PERSIST_KEY_SAVED_AT    3
#define PERSIST_KEY_MAX_HR      4
#define PERSIST_KEY_TIME_FORMAT 5

// Weather icon ids (must match src/pkjs/index.js)
enum {
  ICON_SUN = 0,
  ICON_PART_CLOUD,
  ICON_CLOUD,
  ICON_RAIN,
  ICON_SNOW,
  ICON_THUNDER,
};

static Window *s_window;
static Layer *s_bg_layer;          // separator lines
static Layer *s_weather_icon_layer;
static TextLayer *s_temp_layer;
static TextLayer *s_cond_layer;
static TextLayer *s_time_layer;
static TextLayer *s_ampm_layer;
static TextLayer *s_date_layer;
static TextLayer *s_hr_label_layer;
static Layer *s_heart_layer;
static TextLayer *s_hr_value_layer;
static TextLayer *s_hr_unit_layer;
static TextLayer *s_zones_label_layer;
static Layer *s_chart_layer;
static Layer *s_legend_layer;

static char s_time_buf[8];
static char s_ampm_buf[4];
static char s_date_buf[12];
static char s_hr_buf[12];
static char s_temp_buf[8];
static char s_cond_buf[16];

static int s_weather_icon = ICON_SUN;
static bool s_weather_valid = false;
static int s_current_hr = 0;

// User settings (config screen)
static int s_max_hr = DEFAULT_MAX_HR;
static int s_time_format = TIME_FORMAT_SYSTEM;

static GFont s_font_time;   // large Orbitron for the clock
static GFont s_font_hr;     // medium Orbitron for the HR number
static GFont s_font_label_14;  // Saira SemiCondensed labels
static GFont s_font_label_18;
static GFont s_font_label_24;
static bool s_blink = false;

// Circular buffer of 1-minute HR samples; s_head is the next write slot,
// so oldest sample is s_history[s_head] and newest is s_history[s_head-1].
static uint8_t s_history[HISTORY_LEN];
static int s_head = 0;

// Section boundaries computed from the display size in prv_window_load
static int s_sep_y[3];

// --- HR helpers -------------------------------------------------------------

static GColor prv_zone_color(int hr) {
#if defined(PBL_COLOR)
  if (hr >= ZONE5_MIN) return GColorRed;
  if (hr >= ZONE4_MIN) return GColorYellow;
  if (hr >= ZONE3_MIN) return GColorGreen;
  if (hr >= ZONE2_MIN) return GColorBlueMoon;
  return GColorLightGray;
#else
  (void)hr;
  return GColorWhite;
#endif
}

static bool prv_hr_accessible(void) {
#if defined(PBL_HEALTH)
  time_t now = time(NULL);
  return health_service_metric_accessible(HealthMetricHeartRateBPM, now - 60, now)
         & HealthServiceAccessibilityMaskAvailable;
#else
  return false;
#endif
}

static int prv_read_current_hr(void) {
#if defined(PBL_HEALTH)
  HealthValue hr = health_service_peek_current_value(HealthMetricHeartRateBPM);
  return (hr > 0) ? (int)hr : 0;
#else
  return 0;
#endif
}

static void prv_update_hr_text(void) {
  if (s_current_hr > 0) {
    snprintf(s_hr_buf, sizeof(s_hr_buf), "%d", s_current_hr);
  } else if (!prv_hr_accessible()) {
    snprintf(s_hr_buf, sizeof(s_hr_buf), "---");
  } else {
    snprintf(s_hr_buf, sizeof(s_hr_buf), "--");
  }
  text_layer_set_text(s_hr_value_layer, s_hr_buf);
}

static void prv_record_sample(void) {
  int hr = s_current_hr;
  if (hr < 0) hr = 0;
  if (hr > 255) hr = 255;
  s_history[s_head] = (uint8_t)hr;
  s_head = (s_head + 1) % HISTORY_LEN;
  layer_mark_dirty(s_chart_layer);
}

static void prv_save_history(void) {
  persist_write_data(PERSIST_KEY_HISTORY, s_history, sizeof(s_history));
  persist_write_int(PERSIST_KEY_HEAD, s_head);
  persist_write_int(PERSIST_KEY_SAVED_AT, (int)time(NULL));
}

static void prv_load_history(void) {
  if (persist_exists(PERSIST_KEY_HISTORY)) {
    persist_read_data(PERSIST_KEY_HISTORY, s_history, sizeof(s_history));
    s_head = persist_read_int(PERSIST_KEY_HEAD) % HISTORY_LEN;
    int elapsed_min = (int)((time(NULL) - persist_read_int(PERSIST_KEY_SAVED_AT)) / 60);
    if (elapsed_min >= HISTORY_LEN || elapsed_min < 0) {
      memset(s_history, 0, sizeof(s_history));
      s_head = 0;
    } else {
      // Fill the gap since the face was last open with "no data"
      for (int i = 0; i < elapsed_min; i++) {
        s_history[s_head] = 0;
        s_head = (s_head + 1) % HISTORY_LEN;
      }
    }
  }
}

static void prv_load_settings(void) {
  if (persist_exists(PERSIST_KEY_MAX_HR)) {
    s_max_hr = persist_read_int(PERSIST_KEY_MAX_HR);
  }
  if (s_max_hr < 100 || s_max_hr > 230) s_max_hr = DEFAULT_MAX_HR;
  if (persist_exists(PERSIST_KEY_TIME_FORMAT)) {
    s_time_format = persist_read_int(PERSIST_KEY_TIME_FORMAT);
  }
  if (s_time_format < 0 || s_time_format > TIME_FORMAT_24H) {
    s_time_format = TIME_FORMAT_SYSTEM;
  }
}

static void prv_save_settings(void) {
  persist_write_int(PERSIST_KEY_MAX_HR, s_max_hr);
  persist_write_int(PERSIST_KEY_TIME_FORMAT, s_time_format);
}

// --- time / date -------------------------------------------------------------

static void prv_update_time(void) {
  time_t now = time(NULL);
  struct tm *t = localtime(&now);

  bool h24 = (s_time_format == TIME_FORMAT_24H) ||
             (s_time_format == TIME_FORMAT_SYSTEM && clock_is_24h_style());

  if (h24) {
    strftime(s_time_buf, sizeof(s_time_buf), "%H:%M", t);
    s_ampm_buf[0] = '\0';
  } else {
    strftime(s_time_buf, sizeof(s_time_buf), "%I:%M", t);
    strftime(s_ampm_buf, sizeof(s_ampm_buf), "%p", t);
  }
  text_layer_set_text(s_time_layer, s_time_buf);
  text_layer_set_text(s_ampm_layer, s_ampm_buf);

  strftime(s_date_buf, sizeof(s_date_buf), "%a %d", t);
  for (char *p = s_date_buf; *p; p++) {
    if (*p >= 'a' && *p <= 'z') *p -= 'a' - 'A';
  }
  text_layer_set_text(s_date_layer, s_date_buf);
}

// --- drawing ----------------------------------------------------------------

static void prv_bg_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_stroke_color(ctx, GColorWhite);
  for (int i = 0; i < 3; i++) {
    graphics_draw_line(ctx, GPoint(0, s_sep_y[i]), GPoint(b.size.w, s_sep_y[i]));
  }
}

static void prv_weather_icon_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  GPoint c = GPoint(b.size.w / 2, b.size.h / 2);
  int r = b.size.h / 2 - 2;
  if (!s_weather_valid) return;

  GColor sun = PBL_IF_COLOR_ELSE(GColorYellow, GColorWhite);
  GColor cloud = PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite);

  switch (s_weather_icon) {
    case ICON_SUN:
      graphics_context_set_fill_color(ctx, sun);
      graphics_fill_circle(ctx, c, r - 3);
      graphics_context_set_stroke_color(ctx, sun);
      for (int a = 0; a < 8; a++) {
        int32_t ang = a * TRIG_MAX_ANGLE / 8;
        GPoint p1 = GPoint(c.x + sin_lookup(ang) * (r - 1) / TRIG_MAX_RATIO,
                           c.y - cos_lookup(ang) * (r - 1) / TRIG_MAX_RATIO);
        GPoint p2 = GPoint(c.x + sin_lookup(ang) * (r + 2) / TRIG_MAX_RATIO,
                           c.y - cos_lookup(ang) * (r + 2) / TRIG_MAX_RATIO);
        graphics_draw_line(ctx, p1, p2);
      }
      break;
    case ICON_PART_CLOUD:
      graphics_context_set_fill_color(ctx, sun);
      graphics_fill_circle(ctx, GPoint(c.x - 3, c.y - 3), r - 4);
      // then draw the cloud over the sun
      __attribute__((fallthrough));
    case ICON_CLOUD:
    case ICON_RAIN:
    case ICON_SNOW:
    case ICON_THUNDER:
      graphics_context_set_fill_color(ctx, cloud);
      graphics_fill_circle(ctx, GPoint(c.x - 4, c.y + 1), r - 5);
      graphics_fill_circle(ctx, GPoint(c.x + 2, c.y - 1), r - 4);
      graphics_fill_rect(ctx, GRect(c.x - 7, c.y + 1, 16, r - 3), 2, GCornersBottom);
      if (s_weather_icon == ICON_RAIN || s_weather_icon == ICON_THUNDER) {
        graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorVividCerulean, GColorWhite));
        for (int i = -1; i <= 1; i++) {
          graphics_draw_line(ctx, GPoint(c.x + i * 5, c.y + r - 4), GPoint(c.x + i * 5 - 2, c.y + r));
        }
      } else if (s_weather_icon == ICON_SNOW) {
        graphics_context_set_fill_color(ctx, GColorWhite);
        for (int i = -1; i <= 1; i++) {
          graphics_fill_circle(ctx, GPoint(c.x + i * 5, c.y + r - 2), 1);
        }
      }
      break;
    default:
      break;
  }
}

static void prv_heart_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  GPoint c = GPoint(b.size.w / 2, b.size.h / 2 - 1);
  GColor red = PBL_IF_COLOR_ELSE(GColorRed, GColorWhite);

  // Heart: two circles + filled triangle
  graphics_context_set_fill_color(ctx, red);
  graphics_fill_circle(ctx, GPoint(c.x - 4, c.y - 3), 4);
  graphics_fill_circle(ctx, GPoint(c.x + 4, c.y - 3), 4);
  GPoint tri[3] = {
    {(int16_t)(c.x - 8), (int16_t)(c.y - 1)},
    {(int16_t)(c.x + 8), (int16_t)(c.y - 1)},
    {(int16_t)c.x,       (int16_t)(c.y + 8)},
  };
  GPathInfo info = {.num_points = 3, .points = tri};
  GPath *path = gpath_create(&info);
  gpath_draw_filled(ctx, path);
  gpath_destroy(path);

  // Double pulse arcs: (( heart ))
  // Outer arcs — always visible (thick)
  // Inner arcs — blink on/off every second (thin)
  const int r_outer = b.size.h / 2;
  const int r_inner = r_outer * 3 / 4;
  GRect outer_rect = GRect(c.x - r_outer, c.y - r_outer, r_outer * 2, r_outer * 2);
  GRect inner_rect = GRect(c.x - r_inner, c.y - r_inner, r_inner * 2, r_inner * 2);

  graphics_context_set_stroke_color(ctx, red);
  graphics_context_set_stroke_width(ctx, 2);
  // Outer )  arc (right side)
  graphics_draw_arc(ctx, outer_rect, GOvalScaleModeFitCircle,
                    DEG_TO_TRIGANGLE(45), DEG_TO_TRIGANGLE(135));
  // Outer (  arc (left side)
  graphics_draw_arc(ctx, outer_rect, GOvalScaleModeFitCircle,
                    DEG_TO_TRIGANGLE(225), DEG_TO_TRIGANGLE(315));

  if (s_blink) {
    graphics_context_set_stroke_width(ctx, 1);
    // Inner ) arc (right, blinks)
    graphics_draw_arc(ctx, inner_rect, GOvalScaleModeFitCircle,
                      DEG_TO_TRIGANGLE(45), DEG_TO_TRIGANGLE(135));
    // Inner ( arc (left, blinks)
    graphics_draw_arc(ctx, inner_rect, GOvalScaleModeFitCircle,
                      DEG_TO_TRIGANGLE(225), DEG_TO_TRIGANGLE(315));
  }
}

static void prv_chart_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  GFont small = s_font_label_14;
  const int axis_h = 16;
  int chart_h = b.size.h - axis_h;

  // bars, oldest on the left
  for (int i = 0; i < HISTORY_LEN; i++) {
    int hr = s_history[(s_head + i) % HISTORY_LEN];
    if (hr <= 0) continue;
    int hgt = (hr - CHART_HR_MIN) * chart_h / (CHART_HR_MAX - CHART_HR_MIN);
    if (hgt < 2) hgt = 2;
    if (hgt > chart_h) hgt = chart_h;
    int x = i * b.size.w / HISTORY_LEN;
    int w = (i + 1) * b.size.w / HISTORY_LEN - x - 1;
    if (w < 1) w = 1;
    graphics_context_set_fill_color(ctx, prv_zone_color(hr));
    graphics_fill_rect(ctx, GRect(x, chart_h - hgt, w, hgt), 0, GCornerNone);
  }

  // baseline + time axis labels
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_draw_line(ctx, GPoint(0, chart_h), GPoint(b.size.w, chart_h));
  graphics_context_set_text_color(ctx, GColorWhite);
  GRect line = GRect(0, chart_h - 2, b.size.w, axis_h);
  graphics_draw_text(ctx, "60m ago", small, line,
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_draw_text(ctx, "30m", small, line,
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, "Now", small, line,
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
}

static void prv_legend_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  static const char *names[5] = {"Z1", "Z2", "Z3", "Z4", "Z5"};
  // representative HR for each zone picks the matching color
  const int rep_hr[5] = {0, ZONE2_MIN, ZONE3_MIN, ZONE4_MIN, ZONE5_MIN};
  GFont small = s_font_label_14;

  for (int i = 0; i < 5; i++) {
    int x = i * b.size.w / 5;
    int w = (i + 1) * b.size.w / 5 - x - 2;
    GRect box = GRect(x, 0, w, b.size.h - 1);
    graphics_context_set_fill_color(ctx, prv_zone_color(rep_hr[i]));
    graphics_fill_rect(ctx, box, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, names[i], small,
                       GRect(box.origin.x, box.origin.y - 3, box.size.w, box.size.h),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
}

// --- events -------------------------------------------------------------------

static void prv_tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  if (units_changed & SECOND_UNIT) {
    s_blink = !s_blink;
    if (s_heart_layer) layer_mark_dirty(s_heart_layer);
  }
  if (units_changed & MINUTE_UNIT) {
    prv_update_time();
    s_current_hr = prv_read_current_hr();
    prv_update_hr_text();
    prv_record_sample();
  }
}

#if defined(PBL_HEALTH)
static void prv_health_handler(HealthEventType event, void *context) {
  // React to every health event: HealthEventHeartRateUpdate is only
  // delivered on newer firmware; movement/significant events also carry
  // updated HR data, so we always re-read to be safe.
  (void)event;
  s_current_hr = prv_read_current_hr();
  prv_update_hr_text();
}
#endif

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *temp = dict_find(iter, MESSAGE_KEY_TEMPERATURE);
  Tuple *cond = dict_find(iter, MESSAGE_KEY_CONDITIONS);
  Tuple *icon = dict_find(iter, MESSAGE_KEY_ICON);
  Tuple *max_hr = dict_find(iter, MESSAGE_KEY_MAX_HR);
  Tuple *tfmt = dict_find(iter, MESSAGE_KEY_TIME_FORMAT);

  // Settings from the config screen
  if (max_hr || tfmt) {
    if (max_hr) {
      int v = (int)max_hr->value->int32;
      if (v >= 100 && v <= 230) s_max_hr = v;
    }
    if (tfmt) {
      int v = (int)tfmt->value->int32;
      if (v >= 0 && v <= TIME_FORMAT_24H) s_time_format = v;
    }
    prv_save_settings();
    prv_update_time();
    prv_update_hr_text();
    layer_mark_dirty(s_chart_layer);
    layer_mark_dirty(s_legend_layer);
  }

  if (temp) {
    snprintf(s_temp_buf, sizeof(s_temp_buf), "%d°C", (int)temp->value->int32);
    text_layer_set_text(s_temp_layer, s_temp_buf);
  }
  if (cond) {
    snprintf(s_cond_buf, sizeof(s_cond_buf), "%s", cond->value->cstring);
    text_layer_set_text(s_cond_layer, s_cond_buf);
  }
  if (icon) {
    s_weather_icon = (int)icon->value->int32;
  }
  s_weather_valid = true;
  layer_mark_dirty(s_weather_icon_layer);
}

// --- window -------------------------------------------------------------------

static TextLayer *prv_make_text(Layer *parent, GRect frame, GFont font,
                                GTextAlignment align, const char *text) {
  TextLayer *tl = text_layer_create(frame);
  text_layer_set_background_color(tl, GColorClear);
  text_layer_set_text_color(tl, GColorWhite);
  text_layer_set_font(tl, font);
  text_layer_set_text_alignment(tl, align);
  if (text) text_layer_set_text(tl, text);
  layer_add_child(parent, text_layer_get_layer(tl));
  return tl;
}

static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  const int w = bounds.size.w;
  const int h = bounds.size.h;
  const bool big = h >= 200;  // emery (200x228) vs diorite (144x168)

  // Section heights — give the HR row more room so the number can be larger
  // emery: weather=29 time=61 hr=57 label=14 chart=53 legend=14  total=228
  // diorite: weather=21 time=45 hr=42 label=14 chart=32 legend=14  total=168
  const int weather_h = h * 13 / 100;
  const int time_h    = h * 27 / 100;
  const int hr_h      = h * 25 / 100;
  const int label_h   = 14;
  const int legend_h  = 14;
  const int chart_h   = h - weather_h - time_h - hr_h - label_h - legend_h;

  const int right_w   = w * 30 / 100;   // column for AM/PM + date

  // Load Orbitron custom fonts. Use larger sizes on emery, smaller on the
  // narrower diorite, so "HH:MM" and a 3-digit HR both fit their layers.
  if (big) {
    s_font_time = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_ORBITRON_40));
    s_font_hr   = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_ORBITRON_36));
  } else {
    s_font_time = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_ORBITRON_28));
    s_font_hr   = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_ORBITRON_24));
  }
  // Saira SemiCondensed for all labels.
  // On diorite (144px wide) use 14pt for mid-size labels so text doesn't clip.
  s_font_label_14 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_SAIRA_14));
  s_font_label_18 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_SAIRA_18));
  s_font_label_24 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_SAIRA_24));
  GFont label_sm  = s_font_label_14;
  GFont label_mid = big ? s_font_label_18 : s_font_label_14;  // 18 emery / 14 diorite
  const int label_mid_h = big ? 20 : 16;
  GFont bpm_font = big ? s_font_label_24 : s_font_label_18;
  const int bpm_w = big ? 46 : 36;

  int y = 0;
  s_bg_layer = layer_create(bounds);
  layer_set_update_proc(s_bg_layer, prv_bg_update_proc);
  layer_add_child(root, s_bg_layer);

  // ── weather row ───────────────────────────────────────────────────────────
  const int icon_sz = weather_h - 2;
  s_weather_icon_layer = layer_create(GRect(2, y + 1, icon_sz, icon_sz));
  layer_set_update_proc(s_weather_icon_layer, prv_weather_icon_update_proc);
  layer_add_child(root, s_weather_icon_layer);
  const int wty = y + (weather_h - label_mid_h) / 2;
  s_temp_layer = prv_make_text(root, GRect(icon_sz + 4, wty, w * 37 / 100, label_mid_h + 2),
                               label_mid, GTextAlignmentLeft, "--°C");
  s_cond_layer = prv_make_text(root, GRect(w / 2, wty, w / 2 - 2, label_mid_h + 2),
                               label_mid, GTextAlignmentRight, "");
  y += weather_h;
  s_sep_y[0] = y;

  // ── time row — Orbitron digits ────────────────────────────────────────────
  // Widen the time layer past the right column's (empty) left padding so the
  // digits have enough room; the date is right-aligned and short.
  s_time_layer = prv_make_text(root, GRect(2, y + 4, w - right_w + 8, time_h),
                               s_font_time, GTextAlignmentLeft, "--:--");
  s_ampm_layer = prv_make_text(root, GRect(w - right_w + 2, y + 4, right_w - 4, label_mid_h),
                               label_mid, GTextAlignmentRight, "");
  s_date_layer = prv_make_text(root, GRect(w - right_w + 2, y + 4 + label_mid_h + 2,
                               right_w - 4, label_mid_h), label_mid, GTextAlignmentRight, "");
  y += time_h;
  s_sep_y[1] = y;

  // ── heart rate row ────────────────────────────────────────────────────────
  s_hr_label_layer = prv_make_text(root, GRect(4, y + 2, w / 2, 14),
                                   label_sm, GTextAlignmentLeft, "HEART RATE");
  const int heart_h = hr_h - 16;
  const int heart_w = heart_h + 8;
  const int heart_x = 6;  // aligned under the "HEART RATE" label
  s_heart_layer = layer_create(GRect(heart_x, y + 16, heart_w, heart_h));
  layer_set_update_proc(s_heart_layer, prv_heart_update_proc);
  layer_add_child(root, s_heart_layer);

  // "bpm" is pinned to the right edge (right-aligned). The HR number is
  // right-aligned ending just left of it, with room for 3 digits.
  const int hr_val_left = heart_x + heart_w + 2;
  s_hr_value_layer = prv_make_text(root,
    GRect(hr_val_left, y + 8, (w - bpm_w - 6) - hr_val_left, hr_h - 8),
    s_font_hr, GTextAlignmentRight, "--");
  const int bpm_top = y + 8 + (big ? (36 - 24) : (24 - 18));
  s_hr_unit_layer = prv_make_text(root, GRect(w - bpm_w - 2, bpm_top, bpm_w, big ? 26 : 22),
                                  bpm_font, GTextAlignmentRight, "bpm");
  y += hr_h;
  s_sep_y[2] = y;

  // ── 1-MIN HR ZONES label ─────────────────────────────────────────────────
  s_zones_label_layer = prv_make_text(root, GRect(0, y + 1, w, label_h),
                                      label_sm, GTextAlignmentCenter, "1-MIN HR ZONES");
  y += label_h;

  // ── chart + legend ────────────────────────────────────────────────────────
  s_chart_layer = layer_create(GRect(2, y, w - 4, chart_h));
  layer_set_update_proc(s_chart_layer, prv_chart_update_proc);
  layer_add_child(root, s_chart_layer);
  y += chart_h;

  s_legend_layer = layer_create(GRect(2, y, w - 4, legend_h));
  layer_set_update_proc(s_legend_layer, prv_legend_update_proc);
  layer_add_child(root, s_legend_layer);

  prv_update_time();
  s_current_hr = prv_read_current_hr();
  prv_update_hr_text();
}

static void prv_window_unload(Window *window) {
  fonts_unload_custom_font(s_font_time);
  fonts_unload_custom_font(s_font_hr);
  fonts_unload_custom_font(s_font_label_14);
  fonts_unload_custom_font(s_font_label_18);
  fonts_unload_custom_font(s_font_label_24);
  layer_destroy(s_bg_layer);
  layer_destroy(s_weather_icon_layer);
  text_layer_destroy(s_temp_layer);
  text_layer_destroy(s_cond_layer);
  text_layer_destroy(s_time_layer);
  text_layer_destroy(s_ampm_layer);
  text_layer_destroy(s_date_layer);
  text_layer_destroy(s_hr_label_layer);
  layer_destroy(s_heart_layer);
  text_layer_destroy(s_hr_value_layer);
  text_layer_destroy(s_hr_unit_layer);
  text_layer_destroy(s_zones_label_layer);
  layer_destroy(s_chart_layer);
  layer_destroy(s_legend_layer);
}

static void prv_init(void) {
  prv_load_settings();
  prv_load_history();

  // Register health and tick services BEFORE pushing the window so that
  // the initial HR read in window_load already has a sensor request in flight.
  tick_timer_service_subscribe(MINUTE_UNIT | SECOND_UNIT, prv_tick_handler);

#if defined(PBL_HEALTH)
  health_service_events_subscribe(prv_health_handler, NULL);
  health_service_set_heart_rate_sample_period(HR_SAMPLE_PERIOD_SEC);
#endif

  s_window = window_create();
  window_set_background_color(s_window, GColorBlack);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, true);

  app_message_register_inbox_received(prv_inbox_received);
  app_message_open(128, 32);
}

static void prv_deinit(void) {
  prv_save_history();
#if defined(PBL_HEALTH)
  health_service_set_heart_rate_sample_period(0);
  health_service_events_unsubscribe();
#endif
  tick_timer_service_unsubscribe();
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}

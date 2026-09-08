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
// ZenSand - a kinetic sand-art watchface
//
// A steel ball rolls across a bed of sand, ploughing a groove behind it. The
// path is a hypotrochoid (spirograph), so the accumulated grooves build up a
// mandala over the course of each minute. On the minute the sand is smoothed
// flat and the ball starts a new pattern.
//
// The grooves are accumulated in an off-screen GBitmap so the trail persists
// without having to re-draw thousands of points every frame: each frame only
// plots the short new arc, then blits the canvas.
// ---------------------------------------------------------------------------

#define FRAME_MS      50      // ~20fps
#define STEP_UNITS    128     // angular step per plotted point (TRIG units)
#define STEP_GUARD    8000    // max points plotted in one frame (catch-up)

// --- pattern table ----------------------------------------------------------
// A hypotrochoid traced by a circle of radius r rolling inside radius R, with
// the pen offset d from the rolling circle's centre:
//     x = (R-r)·cos(t) + d·cos(((R-r)/r)·t)
//     y = (R-r)·sin(t) − d·sin(((R-r)/r)·t)
// Writing r/R as the reduced fraction p/q gives (R-r)/r = (q-p)/p, so the
// curve closes exactly after p revolutions and shows (q-p) petals. Picking p
// and q therefore lets us dial in the density (p) and the petal count (q-p)
// directly. `off` is the pen offset as a percentage, before normalisation.
typedef struct {
  uint8_t p;    // revolutions before the curve closes
  uint8_t q;    // q-p petals
  uint8_t off;  // pen offset, % (relative, re-normalised to fill the disc)
} Pattern;

static const Pattern PATTERNS[] = {
  {5, 12, 42},  // 5 loops,  7 petals
  {3,  8, 50},  // 3 loops,  5 petals
  {7, 16, 40},  // 7 loops,  9 petals
  {5, 14, 46},  // 5 loops,  9 petals
  {7, 12, 38},  // 7 loops,  5 petals
  {4,  9, 48},  // 4 loops,  5 petals
  {5,  9, 44},  // 5 loops,  4 petals
  {7, 18, 40},  // 7 loops, 11 petals
  {3, 10, 52},  // 3 loops,  7 petals
  {8, 15, 42},  // 8 loops,  7 petals
  {5, 16, 50},  // 5 loops, 11 petals
  {7, 10, 36},  // 7 loops,  3 petals
};
#define PATTERN_COUNT ((int)(sizeof(PATTERNS) / sizeof(PATTERNS[0])))

// --- state ------------------------------------------------------------------

static Window *s_window;
static Layer *s_sand_layer;
static AppTimer *s_timer;

static GBitmap *s_canvas;      // accumulated grooves (sand bed)
static int s_canvas_w, s_canvas_h;
static GPoint s_canvas_origin;  // where the canvas sits on screen

static GColor s_c_sand, s_c_groove, s_c_text;

static int s_cx, s_cy, s_bigR;   // mandala centre / radius, screen coords
static int s_ball_r;
static GRect s_plate;            // backing plate under the clock
static GFont s_font_time, s_font_date;

// current pattern
static int s_arm, s_off;         // pixel radii, normalised so arm+off == bigR
static int s_pat_p, s_pat_qmp;   // p and (q-p)
static int32_t s_t_max;          // total sweep, TRIG units
static int32_t s_t_drawn;        // how far the groove has been ploughed
static int s_pattern_min = -1;   // minute the current pattern belongs to

static GPoint s_pen;             // ball position
static bool s_pen_valid = false;

static char s_time_buf[8];
static char s_date_buf[16];

// --- sand canvas ------------------------------------------------------------

static void prv_canvas_clear(void) {
  uint8_t *data = gbitmap_get_data(s_canvas);
  uint16_t row = gbitmap_get_bytes_per_row(s_canvas);
#if defined(PBL_COLOR)
  memset(data, s_c_sand.argb, (size_t)row * s_canvas_h);
#else
  memset(data, 0xFF, (size_t)row * s_canvas_h);  // 1 == white
#endif
}

// Plot one groove pixel, in canvas-local coordinates.
static void prv_canvas_set(int x, int y) {
  if (x < 0 || y < 0 || x >= s_canvas_w || y >= s_canvas_h) return;
  uint8_t *data = gbitmap_get_data(s_canvas);
  uint16_t row = gbitmap_get_bytes_per_row(s_canvas);
#if defined(PBL_COLOR)
  data[y * row + x] = s_c_groove.argb;
#else
  data[y * row + (x >> 3)] &= ~(1 << (x & 7));  // 0 == black
#endif
}

// The groove is 2px wide on emery, 1px on the much smaller diorite screen.
static void prv_plot(int x, int y) {
  prv_canvas_set(x, y);
#if defined(PBL_COLOR)
  prv_canvas_set(x + 1, y);
#endif
}

// Bresenham, so consecutive samples never leave gaps in the groove.
static void prv_plot_line(GPoint a, GPoint b) {
  int dx = abs(b.x - a.x), sx = a.x < b.x ? 1 : -1;
  int dy = -abs(b.y - a.y), sy = a.y < b.y ? 1 : -1;
  int err = dx + dy;
  int x = a.x, y = a.y;
  for (;;) {
    prv_plot(x, y);
    if (x == b.x && y == b.y) break;
    int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

// --- pattern ----------------------------------------------------------------

// Position of the ball at sweep angle t, in canvas-local coordinates.
static GPoint prv_point_at(int32_t t) {
  int32_t kt = (t * s_pat_qmp) / s_pat_p;
  int cx = s_bigR + 3, cy = s_bigR + 3;  // centre within the canvas
  return GPoint(
    (int16_t)(cx + (s_arm * cos_lookup(t) + s_off * cos_lookup(kt)) / TRIG_MAX_RATIO),
    (int16_t)(cy + (s_arm * sin_lookup(t) - s_off * sin_lookup(kt)) / TRIG_MAX_RATIO));
}

static void prv_start_pattern(int minute) {
  const Pattern *pt = &PATTERNS[minute % PATTERN_COUNT];
  s_pat_p   = pt->p;
  s_pat_qmp = pt->q - pt->p;

  // arm/off are (q-p)/q and off/100 of the radius. Re-normalise so that
  // arm + off == bigR: every pattern then fills the sand bed exactly.
  int num_arm = s_pat_qmp * 100;
  int num_off = pt->off * pt->q;
  int sum = num_arm + num_off;
  s_arm = s_bigR * num_arm / sum;
  s_off = s_bigR * num_off / sum;

  s_t_max = (int32_t)TRIG_MAX_ANGLE * pt->p;
  s_t_drawn = 0;
  s_pen_valid = false;
  s_pattern_min = minute;
  prv_canvas_clear();
}

// Plough the groove forward to wherever the ball should be right now.
static void prv_advance(void) {
  time_t sec;
  uint16_t ms;
  time_ms(&sec, &ms);
  struct tm *t = localtime(&sec);

  if (t->tm_min != s_pattern_min) prv_start_pattern(t->tm_min);

  // The ball paces itself so the pattern completes exactly on the minute.
  int32_t into_min = (int32_t)t->tm_sec * 1000 + ms;
  int32_t target = (int32_t)(((int64_t)s_t_max * into_min) / 60000);

  int guard = 0;
  while (s_t_drawn < target && guard++ < STEP_GUARD) {
    s_t_drawn += STEP_UNITS;
    if (s_t_drawn > target) s_t_drawn = target;
    GPoint p = prv_point_at(s_t_drawn);
    if (s_pen_valid) prv_plot_line(s_pen, p);
    else prv_plot(p.x, p.y);
    s_pen = p;
    s_pen_valid = true;
  }
  layer_mark_dirty(s_sand_layer);
}

// --- drawing ----------------------------------------------------------------

static void prv_sand_update_proc(Layer *layer, GContext *ctx) {
  // The sand bed, with every groove ploughed so far
  graphics_draw_bitmap_in_rect(ctx, s_canvas,
    GRect(s_canvas_origin.x, s_canvas_origin.y, s_canvas_w, s_canvas_h));

  // Rim of the table
  graphics_context_set_stroke_color(ctx, s_c_groove);
  graphics_draw_circle(ctx, GPoint(s_cx, s_cy), s_bigR + 2);

  // The ball, on the screen only — it must not leave a solid trail
  if (s_pen_valid) {
    GPoint b = GPoint(s_pen.x + s_canvas_origin.x, s_pen.y + s_canvas_origin.y);
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorLightGray, GColorBlack));
    graphics_fill_circle(ctx, b, s_ball_r);
    graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
    graphics_draw_circle(ctx, b, s_ball_r);
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_circle(ctx, GPoint(b.x - s_ball_r / 3, b.y - s_ball_r / 3), s_ball_r / 3);
  }

  // Clock, on a plate of smoothed sand so it stays readable over the grooves
  graphics_context_set_fill_color(ctx, s_c_sand);
  graphics_fill_rect(ctx, s_plate, 6, GCornersAll);
  graphics_context_set_stroke_color(ctx, s_c_groove);
  graphics_draw_round_rect(ctx, s_plate, 6);

  const bool big = s_bigR > 60;
  graphics_context_set_text_color(ctx, s_c_text);
  graphics_draw_text(ctx, s_time_buf, s_font_time,
    GRect(s_plate.origin.x, s_plate.origin.y + (big ? -2 : -1),
          s_plate.size.w, big ? 48 : 38),
    GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, s_date_buf, s_font_date,
    GRect(s_plate.origin.x, s_plate.origin.y + (big ? 42 : 31),
          s_plate.size.w, big ? 20 : 16),
    GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

// --- time -------------------------------------------------------------------

static void prv_update_time(void) {
  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  strftime(s_time_buf, sizeof(s_time_buf),
           clock_is_24h_style() ? "%H:%M" : "%I:%M", t);
  strftime(s_date_buf, sizeof(s_date_buf), "%a %d", t);
  for (char *p = s_date_buf; *p; p++) {
    if (*p >= 'a' && *p <= 'z') *p -= 'a' - 'A';
  }
}

static void prv_tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  prv_update_time();
  layer_mark_dirty(s_sand_layer);
}

static void prv_timer_cb(void *data) {
  s_timer = NULL;
  prv_advance();
  s_timer = app_timer_register(FRAME_MS, prv_timer_cb, NULL);
}

// --- window -----------------------------------------------------------------

static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  const int w = bounds.size.w;
  const int h = bounds.size.h;
  const bool big = h >= 200;  // emery (200x228) vs diorite (144x168)

  // Clock plate along the bottom, sand bed centred in what is left above it
  const int plate_h = big ? 62 : 46;
  const int plate_y = h - plate_h - 4;
  const int plate_w = big ? 136 : 104;

  s_cx = w / 2;
  s_cy = (plate_y - 4) / 2 + 2;
  s_bigR = (w / 2) - 4;
  if (s_bigR > s_cy - 4) s_bigR = s_cy - 4;
  s_ball_r = big ? 5 : 4;
  s_plate = GRect(s_cx - plate_w / 2, plate_y, plate_w, plate_h);

  s_font_time = fonts_get_system_font(big ? FONT_KEY_BITHAM_42_LIGHT
                                          : FONT_KEY_BITHAM_34_MEDIUM_NUMBERS);
  s_font_date = fonts_get_system_font(big ? FONT_KEY_GOTHIC_18 : FONT_KEY_GOTHIC_14);

  // Only the sand bed needs a canvas, not the whole screen
  s_canvas_w = s_canvas_h = 2 * s_bigR + 6;
  s_canvas_origin = GPoint(s_cx - s_bigR - 3, s_cy - s_bigR - 3);
  s_canvas = gbitmap_create_blank(GSize(s_canvas_w, s_canvas_h),
                                  PBL_IF_COLOR_ELSE(GBitmapFormat8Bit, GBitmapFormat1Bit));

  s_sand_layer = layer_create(bounds);
  layer_set_update_proc(s_sand_layer, prv_sand_update_proc);
  layer_add_child(root, s_sand_layer);

  prv_update_time();
  // Draw the pattern up to the current point in the minute, so opening the
  // face mid-minute shows the sand as it should already look.
  prv_advance();
  s_timer = app_timer_register(FRAME_MS, prv_timer_cb, NULL);
}

static void prv_window_unload(Window *window) {
  if (s_timer) {
    app_timer_cancel(s_timer);
    s_timer = NULL;
  }
  layer_destroy(s_sand_layer);
  gbitmap_destroy(s_canvas);
}

static void prv_init(void) {
  s_c_sand   = PBL_IF_COLOR_ELSE(GColorPastelYellow, GColorWhite);
  s_c_groove = PBL_IF_COLOR_ELSE(GColorWindsorTan, GColorBlack);
  s_c_text   = PBL_IF_COLOR_ELSE(GColorWindsorTan, GColorBlack);

  s_window = window_create();
  window_set_background_color(s_window, s_c_sand);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, true);

  tick_timer_service_subscribe(MINUTE_UNIT, prv_tick_handler);
}

static void prv_deinit(void) {
  tick_timer_service_unsubscribe();
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}

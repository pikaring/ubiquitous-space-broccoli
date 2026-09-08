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
// The sand bed is the whole watch face: a disc as wide as the display, with a
// graduated bezel around it. Time is analogue — hour and minute hands sweep
// over the sand — so the only digital element is a small date.
//
// The grooves are accumulated in an off-screen GBitmap so the trail persists
// without having to re-draw thousands of points every frame: each frame only
// plots the short new arc, then blits the canvas.
// ---------------------------------------------------------------------------

#define FRAME_MS      50      // ~20fps
#define STEP_UNITS    128     // angular step per plotted point (TRIG units)
#define STEP_GUARD    8000    // max points plotted in one frame (catch-up)
#define SUBPX         16      // sub-pixel units used when measuring path length

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

static GColor s_c_sand, s_c_groove, s_c_hand;

// Face geometry. The sand bed is a disc as wide as the display; the bezel is
// the ring between the sand and the edge, where the hour marks live.
static int s_cx, s_cy;
static int s_r_face;      // outer edge of the bezel
static int s_r_sand;      // the sand bed the ball ploughs
static int s_ball_r, s_hub_r, s_tick_len, s_groove_w;
static int s_hour_w, s_min_w;
static GFont s_font_date;
static GRect s_date_box;

// current pattern
static int s_arm, s_off;         // pixel radii, normalised so arm+off == r_sand
static int s_pat_p, s_pat_qmp;   // p and (q-p)
static int32_t s_t_max;          // total sweep, TRIG units
static int32_t s_t_drawn;        // how far the groove has been ploughed
static int32_t s_sub_x, s_sub_y; // ball position in 1/SUBPX px, pattern-relative
static uint32_t s_path_len;      // length of the whole path, 1/SUBPX px
static uint32_t s_len_drawn;     // length rolled so far, 1/SUBPX px
static int s_pattern_min = -1;   // minute the current pattern belongs to

static GPoint s_pen;             // ball position, canvas-local
static bool s_pen_valid = false;

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

// The groove widens with the display, so it stays visible at every size.
static void prv_plot(int x, int y) {
  for (int i = 0; i < s_groove_w; i++) prv_canvas_set(x + i, y);
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

// Position of the ball at sweep angle t, in 1/SUBPX px from the pattern centre.
// Sub-pixel units matter here: consecutive samples are about a pixel apart, so
// measuring them at whole-pixel resolution would quantise the path length away.
static void prv_point_sub(int32_t t, int32_t *x, int32_t *y) {
  int32_t kt = (t * s_pat_qmp) / s_pat_p;
  *x = (s_arm * cos_lookup(t) + s_off * cos_lookup(kt)) / (TRIG_MAX_RATIO / SUBPX);
  *y = (s_arm * sin_lookup(t) - s_off * sin_lookup(kt)) / (TRIG_MAX_RATIO / SUBPX);
}

static GPoint prv_canvas_point(int32_t x, int32_t y) {
  int32_t c = (int32_t)(s_r_sand + 3) * SUBPX;  // centre within the canvas
  return GPoint((int16_t)((c + x) / SUBPX), (int16_t)((c + y) / SUBPX));
}

// |(dx,dy)| to within about 4%. The same approximation measures the whole path
// and the part already rolled, so its error cancels out of the pacing.
static uint32_t prv_seg_len(int32_t dx, int32_t dy) {
  if (dx < 0) dx = -dx;
  if (dy < 0) dy = -dy;
  return (uint32_t)(dx > dy ? dx + dy * 3 / 8 : dy + dx * 3 / 8);
}

static void prv_start_pattern(int minute) {
  const Pattern *pt = &PATTERNS[minute % PATTERN_COUNT];
  s_pat_p   = pt->p;
  s_pat_qmp = pt->q - pt->p;

  // arm/off are (q-p)/q and off/100 of the radius. Re-normalise so that
  // arm + off == r_sand: every pattern then fills the sand bed exactly.
  int num_arm = s_pat_qmp * 100;
  int num_off = pt->off * pt->q;
  int sum = num_arm + num_off;
  s_arm = s_r_sand * num_arm / sum;
  s_off = s_r_sand * num_off / sum;

  s_t_max = (int32_t)TRIG_MAX_ANGLE * pt->p;

  // Measure the path so the ball can be driven by distance rolled rather than
  // by sweep angle. A hypotrochoid's parametric speed swings by more than a
  // hundred to one — |dp/dt|² = arm² + (off·k)² − 2·arm·off·k·cos((k+1)t) — so
  // advancing t evenly would stall the ball at every petal tip and fling it
  // across the middle. Walking the curve once here, with exactly the step
  // sequence the groove is drawn with, gives a total to pace against.
  int32_t px, py;
  prv_point_sub(0, &px, &py);
  s_path_len = 0;
  for (int32_t t = STEP_UNITS; t <= s_t_max; t += STEP_UNITS) {
    int32_t x, y;
    prv_point_sub(t, &x, &y);
    s_path_len += prv_seg_len(x - px, y - py);
    px = x;
    py = y;
  }

  s_t_drawn = 0;
  s_len_drawn = 0;
  prv_point_sub(0, &s_sub_x, &s_sub_y);
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

  // Distance covered rises linearly with the time into the minute, so the ball
  // rolls at a steady speed and still finishes the pattern on the minute.
  int32_t into_min = (int32_t)t->tm_sec * 1000 + ms;
  uint32_t target = (uint32_t)(((uint64_t)s_path_len * into_min) / 60000);

  int guard = 0;
  while (s_len_drawn < target && s_t_drawn < s_t_max && guard++ < STEP_GUARD) {
    s_t_drawn += STEP_UNITS;
    int32_t x, y;
    prv_point_sub(s_t_drawn, &x, &y);
    s_len_drawn += prv_seg_len(x - s_sub_x, y - s_sub_y);
    s_sub_x = x;
    s_sub_y = y;
    GPoint p = prv_canvas_point(x, y);
    if (s_pen_valid) prv_plot_line(s_pen, p);
    else prv_plot(p.x, p.y);
    s_pen = p;
    s_pen_valid = true;
  }
  layer_mark_dirty(s_sand_layer);
}

// --- drawing ----------------------------------------------------------------

static GPoint prv_polar(int32_t angle, int radius) {
  return GPoint(
    (int16_t)(s_cx + (int32_t)sin_lookup(angle) * radius / TRIG_MAX_RATIO),
    (int16_t)(s_cy - (int32_t)cos_lookup(angle) * radius / TRIG_MAX_RATIO));
}

// Hands carry a halo of smoothed sand so they stay legible over the grooves.
static void prv_draw_hand(GContext *ctx, int32_t angle, int len, int width) {
  GPoint c = GPoint(s_cx, s_cy);
  GPoint tip = prv_polar(angle, len);
  graphics_context_set_stroke_color(ctx, s_c_sand);
  graphics_context_set_stroke_width(ctx, width + 4);
  graphics_draw_line(ctx, c, tip);
  graphics_context_set_stroke_color(ctx, s_c_hand);
  graphics_context_set_stroke_width(ctx, width);
  graphics_draw_line(ctx, c, tip);
}

static void prv_sand_update_proc(Layer *layer, GContext *ctx) {
  time_t now = time(NULL);
  struct tm *t = localtime(&now);

  // The sand bed, with every groove ploughed so far
  graphics_draw_bitmap_in_rect(ctx, s_canvas,
    GRect(s_canvas_origin.x, s_canvas_origin.y, s_canvas_w, s_canvas_h));

  // Bezel: rim of the table, graduated at the twelve hours
  graphics_context_set_stroke_color(ctx, s_c_groove);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_circle(ctx, GPoint(s_cx, s_cy), s_r_face);
  for (int i = 0; i < 12; i++) {
    int32_t a = TRIG_MAX_ANGLE * i / 12;
    bool quarter = (i % 3 == 0);
    graphics_context_set_stroke_width(ctx, quarter ? 3 : 1);
    graphics_draw_line(ctx, prv_polar(a, s_r_face - 1),
                            prv_polar(a, s_r_face - 1 - (quarter ? s_tick_len
                                                                 : s_tick_len * 3 / 5)));
  }

  // Date — the only digital element, on a patch of smoothed sand
  graphics_context_set_fill_color(ctx, s_c_sand);
  graphics_fill_rect(ctx, s_date_box, 4, GCornersAll);
  graphics_context_set_text_color(ctx, s_c_groove);
  graphics_draw_text(ctx, s_date_buf, s_font_date, s_date_box,
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  // The ball, on the screen only — it must not leave a solid trail
  if (s_pen_valid) {
    GPoint b = GPoint(s_pen.x + s_canvas_origin.x, s_pen.y + s_canvas_origin.y);
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorLightGray, GColorBlack));
    graphics_fill_circle(ctx, b, s_ball_r);
    graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
    graphics_context_set_stroke_width(ctx, 1);
    graphics_draw_circle(ctx, b, s_ball_r);
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_circle(ctx, GPoint(b.x - s_ball_r / 3, b.y - s_ball_r / 3), s_ball_r / 3);
  }

  // Hands. The hour hand creeps forward with the minutes rather than jumping.
  int32_t hour_a = TRIG_MAX_ANGLE * ((t->tm_hour % 12) * 60 + t->tm_min) / 720;
  int32_t min_a  = TRIG_MAX_ANGLE * t->tm_min / 60;
  prv_draw_hand(ctx, hour_a, s_r_sand * 60 / 100, s_hour_w);
  prv_draw_hand(ctx, min_a,  s_r_sand * 92 / 100, s_min_w);

  // Hub, capping both hands
  GPoint c = GPoint(s_cx, s_cy);
  graphics_context_set_fill_color(ctx, s_c_sand);
  graphics_fill_circle(ctx, c, s_hub_r);
  graphics_context_set_stroke_color(ctx, s_c_hand);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_circle(ctx, c, s_hub_r);
  graphics_context_set_fill_color(ctx, s_c_hand);
  graphics_fill_circle(ctx, c, s_hub_r / 2);
}

// --- time -------------------------------------------------------------------

static void prv_update_date(void) {
  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  strftime(s_date_buf, sizeof(s_date_buf), "%a %d", t);
  for (char *p = s_date_buf; *p; p++) {
    if (*p >= 'a' && *p <= 'z') *p -= 'a' - 'A';
  }
}

static void prv_tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  prv_update_date();
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

  // The sand bed uses the full width of the display, whatever its shape: on a
  // round face that is the whole screen, on a rectangular one a disc as wide
  // as the screen, centred in it.
  s_cx = w / 2;
  s_cy = h / 2;
  s_r_face = w / 2 - 1;

  int bezel;
  if (w >= 240) {         // gabbro (260x260 round)
    bezel = 12; s_ball_r = 7; s_hub_r = 8; s_tick_len = 10;
    s_hour_w = 7; s_min_w = 5; s_groove_w = 3;
  } else if (w >= 180) {  // emery (200x228), chalk (180x180 round)
    bezel = 9;  s_ball_r = 5; s_hub_r = 6; s_tick_len = 8;
    s_hour_w = 5; s_min_w = 3; s_groove_w = 2;
  } else {                // diorite / flint (144x168)
    bezel = 6;  s_ball_r = 4; s_hub_r = 5; s_tick_len = 6;
    s_hour_w = 5; s_min_w = 3; s_groove_w = PBL_IF_COLOR_ELSE(2, 1);
  }
  s_r_sand = s_r_face - bezel;

  // Cinzel: Roman inscriptional capitals, letters cut into stone next to
  // grooves cut into sand. It is a wide face — the longest date, "MON 28",
  // measures 59px at 14 and 75px at 18 — and the patch has to stay inside the
  // sand disc on the small screens, so it also sits a little above where two
  // thirds of the radius would put it.
  const bool big = (w >= 240);
  s_font_date = fonts_load_custom_font(resource_get_handle(
      big ? RESOURCE_ID_FONT_CINZEL_18 : RESOURCE_ID_FONT_CINZEL_14));
  const int dw = big ? 84 : 66;
  const int dh = big ? 22 : 18;
  s_date_box = GRect(s_cx - dw / 2, s_cy + s_r_sand * 55 / 100, dw, dh);

  // Only the sand bed needs a canvas, not the whole screen
  s_canvas_w = s_canvas_h = 2 * s_r_sand + 6;
  s_canvas_origin = GPoint(s_cx - s_r_sand - 3, s_cy - s_r_sand - 3);
  s_canvas = gbitmap_create_blank(GSize(s_canvas_w, s_canvas_h),
                                  PBL_IF_COLOR_ELSE(GBitmapFormat8Bit, GBitmapFormat1Bit));

  s_sand_layer = layer_create(bounds);
  layer_set_update_proc(s_sand_layer, prv_sand_update_proc);
  layer_add_child(root, s_sand_layer);

  prv_update_date();
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
  fonts_unload_custom_font(s_font_date);
}

static void prv_init(void) {
  s_c_sand   = PBL_IF_COLOR_ELSE(GColorPastelYellow, GColorWhite);
  s_c_groove = PBL_IF_COLOR_ELSE(GColorWindsorTan, GColorBlack);
  s_c_hand   = GColorBlack;

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

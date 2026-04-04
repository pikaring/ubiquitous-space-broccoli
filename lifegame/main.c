#include <pebble.h>

#define CELL_SIZE 4
#define KEY_WEATHER 0

static Window *s_main_window;
static Layer *s_canvas_layer;
static AppTimer *s_timer;

static bool **s_grid = NULL;
static int s_cols, s_rows;
static bool s_needs_reseed = true;

static char s_date_buf[20], s_time_buf[10];
static char s_weather_buf[32] = "LOADING..."; 

static GFont s_font_time_custom;

// --- 通信ハンドラ ---
static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  Tuple *weather_tuple = dict_find(iterator, KEY_WEATHER);
  if (weather_tuple) {
    snprintf(s_weather_buf, sizeof(s_weather_buf), "%s", weather_tuple->value->cstring);
    s_needs_reseed = true; // 新しい天気が来たらスキャンし直す
    layer_mark_dirty(s_canvas_layer);
  }
}

// --- フォント管理 ---
static void load_fonts() {
#if defined(PBL_PLATFORM_GABBRO) || defined(PBL_PLATFORM_EMERY)
  s_font_time_custom = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_60));
#else
  s_font_time_custom = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_45));
#endif
}

static void unload_fonts() {
  fonts_unload_custom_font(s_font_time_custom);
}

static GFont get_system_font_small() {
#if defined(PBL_PLATFORM_GABBRO) || defined(PBL_PLATFORM_EMERY)
  return fonts_get_system_font(FONT_KEY_BITHAM_30_BLACK);
#else
  return fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
#endif
}

// --- ライフゲームロジック ---
static void allocate_grid(int cols, int rows) {
  s_grid = malloc(cols * sizeof(bool *));
  for (int i = 0; i < cols; i++) {
    s_grid[i] = malloc(rows * sizeof(bool));
    memset(s_grid[i], 0, rows * sizeof(bool));
  }
}

static void update_life() {
  if (!s_grid) return;
  static bool next_gen[70][70];
  for (int x = 0; x < s_cols; x++) {
    for (int y = 0; y < s_rows; y++) {
      int neighbors = 0;
      for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) {
          if (i == 0 && j == 0) continue;
          int nx = (x + i + s_cols) % s_cols;
          int ny = (y + j + s_rows) % s_rows;
          if (s_grid[nx][ny]) neighbors++;
        }
      }
      if (s_grid[x][y]) next_gen[x][y] = (neighbors == 2 || neighbors == 3);
      else next_gen[x][y] = (neighbors == 3);
    }
  }
  for (int x = 0; x < s_cols; x++) {
    for (int y = 0; y < s_rows; y++) s_grid[x][y] = next_gen[x][y];
  }
}

// --- スキャン & 描画 ---
static void capture_text_to_grid(GContext *ctx) {
  GRect bounds = layer_get_bounds(s_canvas_layer);
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  graphics_context_set_text_color(ctx, GColorWhite);

  GFont font_sub = get_system_font_small();

  // 1. スキャン用に一度テキストを描画
  graphics_draw_text(ctx, s_date_buf, font_sub, GRect(0, 5, bounds.size.w, 35), GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, s_time_buf, s_font_time_custom, GRect(0, bounds.size.h/2 - 35, bounds.size.w, 75), GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, s_weather_buf, font_sub, GRect(0, bounds.size.h - 40, bounds.size.w, 35), GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);

  // 2. フレームバッファからグリッドへ転記
  GBitmap *fb = graphics_capture_frame_buffer(ctx);
  for (int y = 0; y < s_rows; y++) {
    GBitmapDataRowInfo info = gbitmap_get_data_row_info(fb, y * CELL_SIZE + CELL_SIZE/2);
    for (int x = 0; x < s_cols; x++) {
#if defined(PBL_COLOR)
      GColor c = (GColor){ .argb = info.data[x * CELL_SIZE + CELL_SIZE/2] };
      s_grid[x][y] = gcolor_equal(c, GColorWhite);
#else
      s_grid[x][y] = (info.data[(x * CELL_SIZE + CELL_SIZE/2) / 8] & (1 << ((x * CELL_SIZE + CELL_SIZE/2) % 8)));
#endif
    }
  }
  graphics_release_frame_buffer(ctx, fb);
}

static void canvas_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  if (s_needs_reseed) {
    capture_text_to_grid(ctx);
    s_needs_reseed = false;
  }

  // 背景クリア
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  // ライフゲーム描画（緑）
  graphics_context_set_fill_color(ctx, GColorIslamicGreen);
  for (int x = 0; x < s_cols; x++) {
    for (int y = 0; y < s_rows; y++) {
      if (s_grid[x][y]) {
        graphics_fill_rect(ctx, GRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE - 1, CELL_SIZE - 1), 0, GCornerNone);
      }
    }
  }

  // 最前面テキスト描画（白）
  graphics_context_set_text_color(ctx, GColorWhite);
  GFont font_sub = get_system_font_small();
  graphics_draw_text(ctx, s_date_buf, font_sub, GRect(0, 5, bounds.size.w, 35), GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, s_time_buf, s_font_time_custom, GRect(0, bounds.size.h/2 - 35, bounds.size.w, 75), GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, s_weather_buf, font_sub, GRect(0, bounds.size.h - 40, bounds.size.w, 35), GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
}

// --- システムイベント ---
static void timer_callback(void *data) {
  update_life();
  layer_mark_dirty(s_canvas_layer);
  s_timer = app_timer_register(500, timer_callback, NULL);
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  strftime(s_date_buf, sizeof(s_date_buf), "%a, %b %d", tick_time);
  strftime(s_time_buf, sizeof(s_time_buf), "%H:%M", tick_time);
  s_needs_reseed = true;
  layer_mark_dirty(s_canvas_layer);
}

static void main_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  
  s_cols = bounds.size.w / CELL_SIZE;
  s_rows = bounds.size.h / CELL_SIZE;
  if (s_cols > 70) s_cols = 70;
  if (s_rows > 70) s_rows = 70;
  
  allocate_grid(s_cols, s_rows);
  load_fonts();

  s_canvas_layer = layer_create(bounds);
  layer_set_update_proc(s_canvas_layer, canvas_update_proc);
  layer_add_child(window_layer, s_canvas_layer);
}

static void main_window_unload(Window *window) {
  layer_destroy(s_canvas_layer);
  unload_fonts();
  if (s_grid) {
    for (int i = 0; i < s_cols; i++) free(s_grid[i]);
    free(s_grid);
  }
}

static void init() {
  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload,
  });
  window_stack_push(s_main_window, true);

  app_message_register_inbox_received(inbox_received_callback);
  app_message_open(128, 128);

  time_t temp = time(NULL);
  struct tm *t = localtime(&temp);
  strftime(s_date_buf, sizeof(s_date_buf), "%a, %b %d", t);
  strftime(s_time_buf, sizeof(s_time_buf), "%H:%M", t);

  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
  s_timer = app_timer_register(500, timer_callback, NULL);
}

static void deinit() {
  if (s_timer) app_timer_cancel(s_timer);
  tick_timer_service_unsubscribe();
  window_destroy(s_main_window);
}

int main() {
  init();
  app_event_loop();
  deinit();
}

#include <pebble.h>

static Window *s_main_window;
static Layer *s_canvas_layer;
static TextLayer *s_time_layer;

static GBitmapSequence *s_sequence = NULL;
static GBitmap *s_bitmap = NULL;

// アニメーション更新のタイマーハンドラ
static void timer_handler(void *context) {
  uint32_t next_delay;

  // 次のフレームへ進める
  if (gbitmap_sequence_update_bitmap_next_frame(s_sequence, s_bitmap, &next_delay)) {
    layer_mark_dirty(s_canvas_layer);
    app_timer_register(next_delay, timer_handler, NULL);
  } else {
    // ループ再生する場合
    gbitmap_sequence_restart(s_sequence);
    app_timer_register(1, timer_handler, NULL);
  }
}

// 描画処理
static void canvas_update_proc(Layer *layer, GContext *ctx) {
  if (s_bitmap) {
    // 144x144のサイズで描画
    graphics_draw_bitmap_in_rect(ctx, s_bitmap, grect_init(0, 0, 144, 144));
  }
}

// 時刻更新処理
static void update_time() {
  time_t temp = time(NULL);
  struct tm *tick_time = localtime(&temp);

  static char s_buffer[8];
  strftime(s_buffer, sizeof(s_buffer), clock_is_24h_style() ? "%H:%M" : "%I:%M", tick_time);
  text_layer_set_text(s_time_layer, s_buffer);
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  update_time();
}

static void main_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  // 1. APNG表示用レイヤー (上部 144x144)
  s_canvas_layer = layer_create(grect_init(0, 0, 144, 144));
  layer_set_update_proc(s_canvas_layer, canvas_update_proc);
  layer_add_child(window_layer, s_canvas_layer);

  // 2. 時計表示用レイヤー (下部 24px)
  s_time_layer = text_layer_create(grect_init(0, 144, 144, 24));
  text_layer_set_background_color(s_time_layer, GColorBlack);
  text_layer_set_text_color(s_time_layer, GColorWhite);
  text_layer_set_font(s_time_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_time_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_time_layer));

  // APNGの読み込み
  s_sequence = gbitmap_sequence_create_with_resource(RESOURCE_ID_ANIMATION_DATA);
  s_bitmap = gbitmap_create_blank(gbitmap_sequence_get_bitmap_size(s_sequence), GBitmapFormat8Bit);

  // 最初のアニメーションタイマーを開始
  app_timer_register(1, timer_handler, NULL);
  
  update_time();
}

static void main_window_unload(Window *window) {
  layer_destroy(s_canvas_layer);
  text_layer_destroy(s_time_layer);
  gbitmap_sequence_destroy(s_sequence);
  gbitmap_destroy(s_bitmap);
}

static void init() {
  s_main_window = window_create();
  window_set_background_color(s_main_window, GColorBlack);
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload
  });
  window_stack_push(s_main_window, true);
  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
}

static void deinit() {
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
#include <pebble.h>

// --- 設定エリア: カラーとフォント ---

#ifdef PBL_COLOR
  // カラー端末用の色設定 (例: 上下は濃い青、中段は白)
  #define COLOR_BG_OUTER  GColorOxfordBlue
  #define COLOR_TEXT_OUTER GColorWhite
  #define COLOR_BG_INNER  GColorWhite
  #define COLOR_TEXT_INNER GColorBlack
#else
  // 白黒端末用の色設定
  #define COLOR_BG_OUTER  GColorBlack
  #define COLOR_TEXT_OUTER GColorWhite
  #define COLOR_BG_INNER  GColorWhite
  #define COLOR_TEXT_INNER GColorBlack
#endif

// フォント設定
#define FONT_TITLE FONT_KEY_GOTHIC_24_BOLD
#define FONT_NEWS  FONT_KEY_GOTHIC_24
#define FONT_TIME  FONT_KEY_GOTHIC_24_BOLD
#define FONT_DATE  FONT_KEY_GOTHIC_24

// レイアウト定数
#define TOP_HEIGHT 30
#define BOTTOM_HEIGHT 30
#define SCROLL_INTERVAL_MS 3000 // スクロール待機時間 (3秒)
#define SCROLL_STEP_Y 24

static Window *s_main_window;

// レイヤー
static Layer *s_top_bg_layer;
static TextLayer *s_title_layer;

static Layer *s_middle_bg_layer;
static TextLayer *s_news_layer;

static Layer *s_bottom_bg_layer;
static TextLayer *s_time_layer;
static TextLayer *s_date_layer;

// アニメーション・タイマー関連
static PropertyAnimation *s_prop_animation;
static AppTimer *s_scroll_timer;
static int s_news_text_height = 0;

// データバッファ
static char s_title_buffer[256];
static char s_news_buffer[2048]; 

// 前方宣言
static void schedule_news_scroll();
static void animate_title();

// --- JSへのデータ要求 ---
static void request_news() {
  DictionaryIterator *iter;
  app_message_outbox_begin(&iter);
  // ダミーデータを送ってJS側の appmessage イベントを発火させる
  dict_write_uint8(iter, 0, 0); 
  app_message_outbox_send();
}

// --- ニューススクロール処理 (中段) ---
static void scroll_timer_callback(void *data) {
  s_scroll_timer = NULL;

  if (!s_news_layer) return;

  GRect current_frame = layer_get_frame(text_layer_get_layer(s_news_layer));
  
  // 次の位置を計算
  int next_y = current_frame.origin.y - SCROLL_STEP_Y;
  
  // 文末（＋余白）まで行ったら最初に戻す
  if (next_y < -(s_news_text_height - 50)) {
    next_y = 0;
  }

  // アニメーション設定 (0.5秒かけて移動)
  GRect next_frame = GRect(current_frame.origin.x, next_y, current_frame.size.w, current_frame.size.h);
  PropertyAnimation *anim = property_animation_create_layer_frame(text_layer_get_layer(s_news_layer), &current_frame, &next_frame);
  
  animation_set_duration((Animation*) anim, 500);
  animation_set_curve((Animation*) anim, AnimationCurveEaseInOut);
  animation_schedule((Animation*) anim);

  // 次回のスクロールを予約 (ここでまた3秒待つことになります)
  schedule_news_scroll();
}

static void schedule_news_scroll() {
  if(s_scroll_timer) {
    app_timer_cancel(s_scroll_timer);
    s_scroll_timer = NULL;
  }
  // 3秒後に scroll_timer_callback を実行
  s_scroll_timer = app_timer_register(SCROLL_INTERVAL_MS, scroll_timer_callback, NULL);
}
// 【新設】アニメーション終了時に呼ばれるコールバック
static void title_animation_stopped(Animation *anim, bool finished, void *context) {
  // システムがメモリを解放済みなので、ポインタをNULLにして「もう空だよ」とマークする
  // これを忘れると、次の animate_title で「死んだメモリ」を操作してバグる
  s_prop_animation = NULL; 
  
  // ループさせるために再実行
  animate_title();
}

// 【修正】タイトルアニメーション関数
static void animate_title() {
  if (!s_title_layer) return;

  // もし「現在進行中」のアニメーションがあれば、強制停止して破棄する
  // (新しいニュースが来た時などのため)
  if (s_prop_animation) {
    animation_unschedule((Animation*)s_prop_animation);
    s_prop_animation = NULL;
  }

  Layer *layer = text_layer_get_layer(s_title_layer);
  GRect frame = layer_get_frame(layer);
  
  // 画面右端(144)からスタートし、文字の長さ分(-frame.size.w)まで左へ動く
  GRect start_frame = GRect(144, 0, frame.size.w, frame.size.h);
  GRect end_frame = GRect(-frame.size.w, 0, frame.size.w, frame.size.h);

  s_prop_animation = property_animation_create_layer_frame(layer, &start_frame, &end_frame);
  
  // 速度調整 (文字数が多いほど時間をかける)
  int duration = frame.size.w * 30; // 少しゆっくりに調整 (25->30)
  if (duration < 3000) duration = 3000;

  animation_set_duration((Animation*)s_prop_animation, duration);
  animation_set_curve((Animation*)s_prop_animation, AnimationCurveLinear);
  
  // ハンドラーの設定 (ここでさっき作った関数を指定)
  animation_set_handlers((Animation*)s_prop_animation, (AnimationHandlers) {
    .stopped = title_animation_stopped
  }, NULL);

  animation_schedule((Animation*)s_prop_animation);
}

// --- データ受信処理 ---
static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "Message received!");

  Tuple *title_tuple = dict_find(iterator, MESSAGE_KEY_KEY_TITLE);
  if(title_tuple) {
    snprintf(s_title_buffer, sizeof(s_title_buffer), "%s", title_tuple->value->cstring);
    
    GSize text_size = graphics_text_layout_get_content_size(
      s_title_buffer,
      fonts_get_system_font(FONT_TITLE), 
      GRect(0, 0, 1000, 30),
      GTextOverflowModeWordWrap,
      GTextAlignmentLeft
    );

    layer_set_frame(text_layer_get_layer(s_title_layer), GRect(144, 0, text_size.w + 20, 30));
    text_layer_set_text(s_title_layer, s_title_buffer);
    animate_title();
  }

  Tuple *news_tuple = dict_find(iterator, MESSAGE_KEY_KEY_NEWS);
  if(news_tuple) {
    // 既存のスクロールタイマーをリセット
    if(s_scroll_timer) {
      app_timer_cancel(s_scroll_timer);
      s_scroll_timer = NULL;
    }

    snprintf(s_news_buffer, sizeof(s_news_buffer), "%s", news_tuple->value->cstring);
    text_layer_set_text(s_news_layer, s_news_buffer);
    
    GSize content_size = graphics_text_layout_get_content_size(
      s_news_buffer,
      fonts_get_system_font(FONT_NEWS),
      GRect(0, 0, 144, 2000),
      GTextOverflowModeWordWrap,
      GTextAlignmentLeft
    );
    s_news_text_height = content_size.h;

    // 位置を初期位置(Y=0)に戻す
    layer_set_frame(text_layer_get_layer(s_news_layer), GRect(0, 0, 144, s_news_text_height + 50));
    
    // 3秒後にスクロール開始
    schedule_news_scroll();
  }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped! Reason: %d", (int)reason);
}

// --- 時計更新 ---
static void update_time() {
  time_t temp = time(NULL);
  struct tm *tick_time = localtime(&temp);

  static char s_time_buffer[8];
  static char s_date_buffer[32];
  
  strftime(s_time_buffer, sizeof(s_time_buffer), clock_is_24h_style() ? "%H:%M" : "%I:%M", tick_time);
  text_layer_set_text(s_time_layer, s_time_buffer);
  
  strftime(s_date_buffer, sizeof(s_date_buffer), "%a %d %b", tick_time);
  text_layer_set_text(s_date_layer, s_date_buffer);
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  update_time();
  
  // 毎分更新のタイミングでニュースを取得
  if(units_changed & MINUTE_UNIT) {
    request_news();
  }
}

// --- 初期化 ---
static void main_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  // 1. 上段
  s_top_bg_layer = layer_create(GRect(0, 0, bounds.size.w, TOP_HEIGHT));
  layer_add_child(window_layer, s_top_bg_layer);
  
  TextLayer *top_bg = text_layer_create(GRect(0, 0, bounds.size.w, TOP_HEIGHT));
  text_layer_set_background_color(top_bg, COLOR_BG_OUTER); // 色変更
  layer_add_child(s_top_bg_layer, text_layer_get_layer(top_bg));

  s_title_layer = text_layer_create(GRect(144, 0, 144, TOP_HEIGHT)); 
  text_layer_set_background_color(s_title_layer, GColorClear);
  text_layer_set_text_color(s_title_layer, COLOR_TEXT_OUTER); // 色変更
  text_layer_set_font(s_title_layer, fonts_get_system_font(FONT_TITLE));
  text_layer_set_text_alignment(s_title_layer, GTextAlignmentLeft);
  text_layer_set_text(s_title_layer, "Loading...");
  layer_add_child(s_top_bg_layer, text_layer_get_layer(s_title_layer));

  // 2. 下段
  int bottom_y = bounds.size.h - BOTTOM_HEIGHT;
  s_bottom_bg_layer = layer_create(GRect(0, bottom_y, bounds.size.w, BOTTOM_HEIGHT));
  layer_add_child(window_layer, s_bottom_bg_layer);

  TextLayer *bottom_bg = text_layer_create(GRect(0, 0, bounds.size.w, BOTTOM_HEIGHT));
  text_layer_set_background_color(bottom_bg, COLOR_BG_OUTER); // 色変更
  layer_add_child(s_bottom_bg_layer, text_layer_get_layer(bottom_bg));

  s_time_layer = text_layer_create(GRect(0, 0, 64, BOTTOM_HEIGHT));
  text_layer_set_background_color(s_time_layer, GColorClear);
  text_layer_set_text_color(s_time_layer, COLOR_TEXT_OUTER); // 色変更
  text_layer_set_font(s_time_layer, fonts_get_system_font(FONT_TIME));
  text_layer_set_text_alignment(s_time_layer, GTextAlignmentCenter);
  layer_add_child(s_bottom_bg_layer, text_layer_get_layer(s_time_layer));

  s_date_layer = text_layer_create(GRect(64, 0, 80, BOTTOM_HEIGHT));
  text_layer_set_background_color(s_date_layer, GColorClear);
  text_layer_set_text_color(s_date_layer, COLOR_TEXT_OUTER); // 色変更
  text_layer_set_font(s_date_layer, fonts_get_system_font(FONT_DATE));
  text_layer_set_text_alignment(s_date_layer, GTextAlignmentCenter);
  layer_add_child(s_bottom_bg_layer, text_layer_get_layer(s_date_layer));

  // 3. 中段
  int middle_height = bounds.size.h - TOP_HEIGHT - BOTTOM_HEIGHT;
  s_middle_bg_layer = layer_create(GRect(0, TOP_HEIGHT, bounds.size.w, middle_height));
  layer_set_clips(s_middle_bg_layer, true);
  layer_add_child(window_layer, s_middle_bg_layer);
  
  TextLayer *mid_bg = text_layer_create(GRect(0, 0, bounds.size.w, middle_height));
  text_layer_set_background_color(mid_bg, COLOR_BG_INNER); // 色変更
  layer_add_child(s_middle_bg_layer, text_layer_get_layer(mid_bg));

  s_news_layer = text_layer_create(GRect(0, 0, bounds.size.w, 1000));
  text_layer_set_background_color(s_news_layer, GColorClear);
  text_layer_set_text_color(s_news_layer, COLOR_TEXT_INNER); // 色変更
  text_layer_set_font(s_news_layer, fonts_get_system_font(FONT_NEWS));
  text_layer_set_text_alignment(s_news_layer, GTextAlignmentLeft);
  text_layer_set_overflow_mode(s_news_layer, GTextOverflowModeWordWrap);
  text_layer_set_text(s_news_layer, "Waiting for news...");
  layer_add_child(s_middle_bg_layer, text_layer_get_layer(s_news_layer));
}

static void main_window_unload(Window *window) {
  text_layer_destroy(s_title_layer);
  text_layer_destroy(s_news_layer);
  text_layer_destroy(s_time_layer);
  text_layer_destroy(s_date_layer);
  layer_destroy(s_top_bg_layer);
  layer_destroy(s_middle_bg_layer);
  layer_destroy(s_bottom_bg_layer);
}

static void init() {
  s_main_window = window_create();
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload
  });
  window_stack_push(s_main_window, true);

  update_time();
  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  
  app_message_open(2048, 256);
}

static void deinit() {
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
#include <pebble.h>
#include <stdlib.h> // rand()

// 画面サイズと定数
#define SCREEN_W 144
#define SCREEN_H 168
#define PADDLE_W 4
#define PADDLE_H 24
#define BALL_R 3
#define GAME_TOP_OFFSET 40   // 時計表示の下からゲーム開始
#define GAME_BOTTOM_OFFSET 140 // 日付表示の上まで
#define GAME_H (GAME_BOTTOM_OFFSET - GAME_TOP_OFFSET)

// UI要素
static Window *s_window;
static TextLayer *s_time_layer_h; // 左（時）
static TextLayer *s_time_layer_m; // 右（分）
static TextLayer *s_date_layer;   // 下（日付）
static Layer *s_game_layer;       // 中央（Pong描画）

// ゲームの状態変数
static AppTimer *s_game_timer;
static int s_ball_x, s_ball_y;
static int s_ball_dx, s_ball_dy;
static int s_paddle_l_y, s_paddle_r_y;
static bool s_miss_mode = false; // 負ける準備モード
static bool s_waiting_next_min = false; // ゴール後、次の分を待っている状態
static bool s_blink_state = true; // 点滅用

// 時間バッファ
static char s_buffer_h[3];
static char s_buffer_m[3];
static char s_buffer_date[16];

// -------------- ゲームロジック --------------

// パドルの位置を更新 (AI)
// is_left: 左パドルならtrue
// target_y: 目標とするY座標（ボールのY）
static int update_paddle_ai(int current_y, int target_y, bool is_active) {
    int speed = 3;
    
    if (is_active) {
        // ボールに向かって移動
        if (current_y + PADDLE_H / 2 < target_y - 2) {
            current_y += speed;
        } else if (current_y + PADDLE_H / 2 > target_y + 2) {
            current_y -= speed;
        }
    } else {
        // ボールが来ていない時や待機中はランダムにふらふらさせる
        if (rand() % 10 < 5) { // たまに動く
            current_y += (rand() % 3) - 1; 
        }
    }

    // 画面外に出ないように制限
    if (current_y < 0) current_y = 0;
    if (current_y > GAME_H - PADDLE_H) current_y = GAME_H - PADDLE_H;

    return current_y;
}

static void game_step() {
    if (s_waiting_next_min) {
        // ゴール後は何もしない（点滅処理はTickHandlerで行う）
        return;
    }

    // --- ボールの移動 ---
    s_ball_x += s_ball_dx;
    s_ball_y += s_ball_dy;

    // 上下の壁で跳ね返る
    if (s_ball_y <= 0 || s_ball_y >= GAME_H) {
        s_ball_dy = -s_ball_dy;
    }

    // --- パドルとの当たり判定 ---
    // 左パドル (常に鉄壁)
    if (s_ball_x <= PADDLE_W && s_ball_y >= s_paddle_l_y && s_ball_y <= s_paddle_l_y + PADDLE_H) {
        s_ball_dx = abs(s_ball_dx); // 必ず右へ跳ね返す
    }

    // 右パドル (分が変わる直前はスルーする)
    if (!s_miss_mode) {
        // 通常モード：跳ね返す
        if (s_ball_x >= SCREEN_W - PADDLE_W - BALL_R && s_ball_y >= s_paddle_r_y && s_ball_y <= s_paddle_r_y + PADDLE_H) {
            s_ball_dx = -abs(s_ball_dx); // 左へ跳ね返す
        }
    }

    // --- ゴール判定 (右に抜けた場合) ---
    if (s_ball_x > SCREEN_W + 5) {
        s_waiting_next_min = true; // 次の分まで待機
        s_ball_dx = 0;
        s_ball_dy = 0;
    }
    
    // --- AI制御 ---
    // 左パドルはボールが左に来ているとき(dx < 0)本気出す
    s_paddle_l_y = update_paddle_ai(s_paddle_l_y, s_ball_y, (s_ball_dx < 0));

    // 右パドルはボールが右に来ているとき(dx > 0)本気出す
    // ただし、miss_modeの場合は動かない（ボールを見送る）
    bool right_active = (s_ball_dx > 0) && !s_miss_mode;
    s_paddle_r_y = update_paddle_ai(s_paddle_r_y, s_ball_y, right_active);

    // 再描画要求
    layer_mark_dirty(s_game_layer);
}

// タイマーコールバック
static void timer_callback(void *data) {
    game_step();
    // 30msごとに更新 (約33fps)
    s_game_timer = app_timer_register(30, timer_callback, NULL);
}

// -------------- 描画処理 --------------

static void game_layer_update_proc(Layer *layer, GContext *ctx) {
    // 背景（黒である必要はないが、クリアに見せるため）
    // windowの背景が黒なら不要だが明示的に描く
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, layer_get_bounds(layer), 0, GCornerNone);

    graphics_context_set_fill_color(ctx, GColorWhite);

    // 左パドル
    graphics_fill_rect(ctx, GRect(0, s_paddle_l_y, PADDLE_W, PADDLE_H), 2, GCornersAll);

    // 右パドル
    graphics_fill_rect(ctx, GRect(SCREEN_W - PADDLE_W, s_paddle_r_y, PADDLE_W, PADDLE_H), 2, GCornersAll);

    // センターライン（点線）
    for(int i = 0; i < GAME_H; i += 10) {
        graphics_fill_rect(ctx, GRect(SCREEN_W / 2 - 1, i, 2, 4), 0, GCornerNone);
    }

    // ボール（待機中は描画しない）
    if (!s_waiting_next_min) {
        graphics_fill_circle(ctx, GPoint(s_ball_x, s_ball_y), BALL_R);
    }
}

// -------------- 時計・日付処理 --------------

static void update_time_display(struct tm *tick_time) {
    // 時
    strftime(s_buffer_h, sizeof(s_buffer_h), clock_is_24h_style() ? "%H" : "%I", tick_time);
    text_layer_set_text(s_time_layer_h, s_buffer_h);

    // 分
    strftime(s_buffer_m, sizeof(s_buffer_m), "%M", tick_time);
    text_layer_set_text(s_time_layer_m, s_buffer_m);

    // 日付
    strftime(s_buffer_date, sizeof(s_buffer_date), "%a %d %b", tick_time);
    text_layer_set_text(s_date_layer, s_buffer_date);
}

// ボールのリセット（新しい分が始まった時）
static void reset_ball() {
    s_ball_x = SCREEN_W / 2;
    s_ball_y = GAME_H / 2;
    
    // ランダムな方向に発射
    s_ball_dx = (rand() % 2 == 0) ? 2 : -2;
    s_ball_dy = (rand() % 2 == 0) ? 2 : -2;
    
    s_miss_mode = false;
    s_waiting_next_min = false;
    
    // 色を確実に通常状態（黒背景・白文字）に戻す
    text_layer_set_background_color(s_time_layer_m, GColorBlack);
    text_layer_set_text_color(s_time_layer_m, GColorWhite);
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
    // 毎分更新時に表示を更新
    if (units_changed & MINUTE_UNIT) {
        update_time_display(tick_time);
        reset_ball(); // 新しいスコア(時間)になったのでゲーム再開
    }

    int seconds = tick_time->tm_sec;

    // 55秒を過ぎたら「負けモード」へ移行
    if (seconds >= 55 && !s_waiting_next_min) {
        s_miss_mode = true;
    }

    // ゴール後の点滅演出 (1秒毎に色を反転)
    if (s_waiting_next_min) {
        s_blink_state = !s_blink_state;
        if (s_blink_state) {
            // 反転状態（白背景・黒文字）で目立たせる
            text_layer_set_background_color(s_time_layer_m, GColorWhite);
            text_layer_set_text_color(s_time_layer_m, GColorBlack);
        } else {
            // 通常状態（黒背景・白文字）に戻す
            text_layer_set_background_color(s_time_layer_m, GColorBlack);
            text_layer_set_text_color(s_time_layer_m, GColorWhite);
        }
    }
}

// -------------- 初期化・終了 --------------

static void main_window_load(Window *window) {
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);

    // フォント取得
    GFont font_score = fonts_get_system_font(FONT_KEY_LECO_36_BOLD_NUMBERS); // 大きめのフォント
    GFont font_date = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);

    // --- 時 (左上) ---
    s_time_layer_h = text_layer_create(GRect(0, -5, SCREEN_W / 2 - 10, 50));
    text_layer_set_background_color(s_time_layer_h, GColorBlack);
    text_layer_set_text_color(s_time_layer_h, GColorWhite);
    text_layer_set_font(s_time_layer_h, font_score);
    text_layer_set_text_alignment(s_time_layer_h, GTextAlignmentRight);
    layer_add_child(window_layer, text_layer_get_layer(s_time_layer_h));

    // --- 分 (右上) ---
    s_time_layer_m = text_layer_create(GRect(SCREEN_W / 2 + 10, -5, SCREEN_W / 2 - 10, 50));
    text_layer_set_background_color(s_time_layer_m, GColorBlack);
    text_layer_set_text_color(s_time_layer_m, GColorWhite);
    text_layer_set_font(s_time_layer_m, font_score);
    text_layer_set_text_alignment(s_time_layer_m, GTextAlignmentLeft);
    layer_add_child(window_layer, text_layer_get_layer(s_time_layer_m));

    // --- ゲームレイヤー (中央) ---
    s_game_layer = layer_create(GRect(0, GAME_TOP_OFFSET, SCREEN_W, GAME_H));
    layer_set_update_proc(s_game_layer, game_layer_update_proc);
    layer_add_child(window_layer, s_game_layer);

    // --- 日付 (下部) ---
    s_date_layer = text_layer_create(GRect(0, GAME_BOTTOM_OFFSET, SCREEN_W, 30));
    text_layer_set_background_color(s_date_layer, GColorBlack);
    text_layer_set_text_color(s_date_layer, GColorWhite);
    text_layer_set_font(s_date_layer, font_date);
    text_layer_set_text_alignment(s_date_layer, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(s_date_layer));
}

static void main_window_unload(Window *window) {
    text_layer_destroy(s_time_layer_h);
    text_layer_destroy(s_time_layer_m);
    text_layer_destroy(s_date_layer);
    layer_destroy(s_game_layer);
}

static void init() {
    srand(time(NULL));

    s_window = window_create();
    window_set_background_color(s_window, GColorBlack);
    window_set_window_handlers(s_window, (WindowHandlers) {
        .load = main_window_load,
        .unload = main_window_unload,
    });
    window_stack_push(s_window, true);

    // 初期時間設定
    time_t temp = time(NULL);
    struct tm *tick_time = localtime(&temp);
    update_time_display(tick_time);

    // 初期位置設定
    reset_ball();
    s_paddle_l_y = GAME_H / 2 - PADDLE_H / 2;
    s_paddle_r_y = GAME_H / 2 - PADDLE_H / 2;

    // イベント登録
    tick_timer_service_subscribe(SECOND_UNIT, tick_handler);
    s_game_timer = app_timer_register(30, timer_callback, NULL);
}

static void deinit() {
    window_destroy(s_window);
}

int main(void) {
    init();
    app_event_loop();
    deinit();
}
#include <pebble.h>

#define BOARD_SIZE 8
#define CELL_SIZE 18

typedef enum { EMPTY, BLACK, WHITE } Player;
typedef enum { STATE_THINKING, STATE_PLACED, STATE_FLIPPING, STATE_GAMEOVER } GameState;

// 裏返し予約用の構造体
typedef struct {
    int x;
    int y;
} FlipQueue;

static Window *s_main_window;
static Layer *s_board_layer;
static TextLayer *s_score_layer;
static TextLayer *s_time_layer;

static Player s_board[BOARD_SIZE][BOARD_SIZE];
static Player s_current_player = BLACK;
static GameState s_state = STATE_THINKING;

static FlipQueue s_flip_queue[64];
static int s_flip_count = 0;
static int s_flip_index = 0;
static int s_last_x, s_last_y;

static char s_score_text[32];
static char s_time_text[32];

// --- ゲームロジック ---

static void reset_game() {
    for (int y = 0; y < BOARD_SIZE; y++)
        for (int x = 0; x < BOARD_SIZE; x++) s_board[y][x] = EMPTY;
    
    s_board[3][3] = WHITE; s_board[4][4] = WHITE;
    s_board[3][4] = BLACK; s_board[4][3] = BLACK;
    s_current_player = BLACK;
    s_state = STATE_THINKING;
    snprintf(s_score_text, sizeof(s_score_text), "Reversi");
    text_layer_set_text(s_score_layer, s_score_text);
}

static bool is_on_board(int x, int y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

static int count_flips_in_dir(int x, int y, int dx, int dy, Player player) {
    int count = 0;
    int nx = x + dx, ny = y + dy;
    Player opponent = (player == BLACK) ? WHITE : BLACK;
    while (is_on_board(nx, ny) && s_board[ny][nx] == opponent) {
        nx += dx; ny += dy; count++;
    }
    return (is_on_board(nx, ny) && s_board[ny][nx] == player) ? count : 0;
}

static bool can_move(int x, int y, Player player) {
    if (s_board[y][x] != EMPTY) return false;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            if (count_flips_in_dir(x, y, dx, dy, player) > 0) return true;
        }
    }
    return false;
}

static void prepare_flips(int x, int y, Player player) {
    s_flip_count = 0;
    s_flip_index = 0;
    s_last_x = x;
    s_last_y = y;
    s_board[y][x] = player; // 着手

    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            int num = count_flips_in_dir(x, y, dx, dy, player);
            for (int i = 1; i <= num; i++) {
                s_flip_queue[s_flip_count].x = x + (dx * i);
                s_flip_queue[s_flip_count].y = y + (dy * i);
                s_flip_count++;
            }
        }
    }
}

// --- 描画処理 ---

static void board_update_proc(Layer *layer, GContext *ctx) {
    graphics_context_set_fill_color(ctx, GColorIslamicGreen);
    graphics_fill_rect(ctx, layer_get_bounds(layer), 0, GCornerNone);
    
    graphics_context_set_stroke_color(ctx, GColorBlack);
    for (int i = 0; i <= BOARD_SIZE; i++) {
        graphics_draw_line(ctx, GPoint(i * CELL_SIZE, 0), GPoint(i * CELL_SIZE, 144));
        graphics_draw_line(ctx, GPoint(0, i * CELL_SIZE), GPoint(144, i * CELL_SIZE));
    }

    for (int y = 0; y < BOARD_SIZE; y++) {
        for (int x = 0; x < BOARD_SIZE; x++) {
            if (s_board[y][x] != EMPTY) {
                graphics_context_set_fill_color(ctx, (s_board[y][x] == BLACK) ? GColorBlack : GColorWhite);
                graphics_fill_circle(ctx, GPoint(x * CELL_SIZE + 9, y * CELL_SIZE + 9), 7);
                
                // 着手したマスを強調（Strokeだけ赤）
                if (s_state != STATE_THINKING && x == s_last_x && y == s_last_y) {
                    graphics_context_set_stroke_width(ctx, 2);
                    graphics_context_set_stroke_color(ctx, GColorRed);
                } else {
                    graphics_context_set_stroke_width(ctx, 1);
                    graphics_context_set_stroke_color(ctx, (s_board[y][x] == BLACK) ? GColorBlack : GColorWhite);
                }
                graphics_draw_circle(ctx, GPoint(x * CELL_SIZE + 9, y * CELL_SIZE + 9), 7);
            }
        }
    }
}

// --- メインループ ---

static void handle_tick(struct tm *tick_time, TimeUnits units_changed) {
    // 時計更新
    strftime(s_time_text, sizeof(s_time_text), "%H:%M", tick_time);
    text_layer_set_text(s_time_layer, s_time_text);

    if (s_state == STATE_GAMEOVER) {
        reset_game();
        return;
    }

    if (s_state == STATE_THINKING) {
        int moves[64][2], count = 0;
        for (int y = 0; y < BOARD_SIZE; y++)
            for (int x = 0; x < BOARD_SIZE; x++)
                if (can_move(x, y, s_current_player)) {
                    moves[count][0] = x; moves[count][1] = y; count++;
                }

        if (count > 0) {
            int r = rand() % count;
            prepare_flips(moves[r][0], moves[r][1], s_current_player);
            s_state = STATE_PLACED;
        } else {
            // パス
            s_current_player = (s_current_player == BLACK) ? WHITE : BLACK;
            // 相手も打てないなら終局
            bool opponent_can_move = false;
            for (int y = 0; y < BOARD_SIZE; y++)
                for (int x = 0; x < BOARD_SIZE; x++)
                    if (can_move(x, y, s_current_player)) opponent_can_move = true;
            if (!opponent_can_move) s_state = STATE_GAMEOVER;
        }
    } else if (s_state == STATE_PLACED || s_state == STATE_FLIPPING) {
        if (s_flip_index < s_flip_count) {
            s_board[s_flip_queue[s_flip_index].y][s_flip_queue[s_flip_index].x] = s_current_player;
            s_flip_index++;
            s_state = STATE_FLIPPING;
        } else {
            s_current_player = (s_current_player == BLACK) ? WHITE : BLACK;
            s_state = STATE_THINKING;
            
            // スコア集計
            int b = 0, w = 0, empty = 0;
            for (int y = 0; y < BOARD_SIZE; y++)
                for (int x = 0; x < BOARD_SIZE; x++) {
                    if (s_board[y][x] == BLACK) b++;
                    else if (s_board[y][x] == WHITE) w++;
                    else empty++;
                }
            snprintf(s_score_text, sizeof(s_score_text), "B:%d W:%d", b, w);
            text_layer_set_text(s_score_layer, s_score_text);
            if (empty == 0) s_state = STATE_GAMEOVER;
        }
    }
    layer_mark_dirty(s_board_layer);
}

// --- ボイラープレート ---

static void main_window_load(Window *window) {
    Layer *window_layer = window_get_root_layer(window);
    s_board_layer = layer_create(GRect(0, 0, 144, 144));
    layer_set_update_proc(s_board_layer, board_update_proc);
    layer_add_child(window_layer, s_board_layer);

    s_score_layer = text_layer_create(GRect(72, 144, 72, 24));
    text_layer_set_background_color(s_score_layer, GColorClear);
    text_layer_set_text_color(s_score_layer, GColorWhite);
    text_layer_set_text_alignment(s_score_layer, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(s_score_layer));
    text_layer_set_font(s_score_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24));

    s_time_layer = text_layer_create(GRect(0, 144, 72, 24));
    text_layer_set_background_color(s_time_layer, GColorBlack);
    text_layer_set_text_color(s_time_layer, GColorWhite);
    text_layer_set_text_alignment(s_time_layer, GTextAlignmentCenter);
    text_layer_set_font(s_time_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
    layer_add_child(window_layer, text_layer_get_layer(s_time_layer));

    reset_game();
}

static void main_window_unload(Window *window) {
    layer_destroy(s_board_layer);
    text_layer_destroy(s_score_layer);
    text_layer_destroy(s_time_layer);
}

static void init() {
    s_main_window = window_create();
    window_set_background_color(s_main_window, GColorBlack);
    window_set_window_handlers(s_main_window, (WindowHandlers) {
        .load = main_window_load, .unload = main_window_unload,
    });
    window_stack_push(s_main_window, true);
    tick_timer_service_subscribe(SECOND_UNIT, handle_tick);
}

static void deinit() {
    tick_timer_service_unsubscribe();
    window_destroy(s_main_window);
}

int main(void) {
    init();
    app_event_loop();
    deinit();
}
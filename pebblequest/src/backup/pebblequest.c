#include <pebble.h>
#include "battle_logic.h"

static Window *s_main_window;
static Layer *s_canvas_layer;
static AppTimer *s_state_timer = NULL;
static AppTimer *s_anim_timer = NULL;

// ゲーム状態
BattleState s_state = STATE_ENEMY_SELECT;
Monster current_enemy;
Card player_cards[3] = {{GU, 6, false}, {CHOKI, 4, false}, {PA, 5, false}};
int player_hp = 20;
int turn_count = 0;
int s_enemy_idx, s_player_idx;
int s_anim_frame = 0;
char status_text[32] = "READY...";

// プロトタイプ宣言
void change_state(BattleState next_state);
void start_next_monster();

// --- 状態管理タイマーコールバック ---
static void state_timer_handler(void *data) {
    switch (s_state) {
        case STATE_ENEMY_SELECT:
            // 敵がカードを決定 -> プレイヤーの選択待ちへ
            s_enemy_idx = rand() % 3;
            while(current_enemy.cards[s_enemy_idx].is_used) s_enemy_idx = (s_enemy_idx + 1) % 3;
            change_state(STATE_PLAYER_SELECT);
            break;
        case STATE_RESULT:
            // 結果表示終了 -> 次のターン or 勝利判定
            if (current_enemy.hp <= 0) {
                change_state(STATE_WIN);
            } else {
                if (turn_count >= 3) {
                    for(int i=0; i<3; i++) { 
                        player_cards[i].is_used = false; 
                        current_enemy.cards[i].is_used = false; 
                    }
                    turn_count = 0;
                }
                change_state(STATE_ENEMY_SELECT);
            }
            break;
        case STATE_WIN:
            start_next_monster();
            break;
        default: break;
    }
}

void change_state(BattleState next_state) {
    s_state = next_state;
    if (s_state_timer) { app_timer_cancel(s_state_timer); s_state_timer = NULL; }

    switch (s_state) {
        case STATE_ENEMY_SELECT:
            snprintf(status_text, sizeof(status_text), "ENEMY THINKING...");
            s_state_timer = app_timer_register(1200, state_timer_handler, NULL);
            break;
        case STATE_PLAYER_SELECT:
            snprintf(status_text, sizeof(status_text), "YOUR TURN!");
            break;
        case STATE_RESULT:
            s_state_timer = app_timer_register(2000, state_timer_handler, NULL);
            break;
        case STATE_WIN:
            snprintf(status_text, sizeof(status_text), "YOU WIN!");
            s_state_timer = app_timer_register(3000, state_timer_handler, NULL);
            break;
        default: break;
    }
    layer_mark_dirty(s_canvas_layer);
}

// --- 描画関数 ---

void draw_card(GContext *ctx, GRect rect, Card *card, bool highlighted) {
    if (card->is_used && s_state != STATE_BATTLE_ANIM) return;
    
    // カードの地塗り
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, rect, 4, GCornersAll);
    
    // 枠線
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_context_set_stroke_width(ctx, highlighted ? 3 : 1);
    graphics_draw_round_rect(ctx, rect, 4);

    // 記号（カード内なので黒）
    GPoint center = GPoint(rect.origin.x + rect.size.w/2, rect.origin.y + 12);
    graphics_context_set_stroke_width(ctx, highlighted ? 3 : 1);
    switch (card->hand) {
        case GU:    graphics_draw_rect(ctx, GRect(center.x-5, center.y-5, 10, 10)); break;
        case CHOKI:
            graphics_draw_line(ctx, GPoint(center.x, center.y-7), GPoint(center.x+7, center.y));
            graphics_draw_line(ctx, GPoint(center.x+7, center.y), GPoint(center.x, center.y+7));
            graphics_draw_line(ctx, GPoint(center.x, center.y+7), GPoint(center.x-7, center.y));
            graphics_draw_line(ctx, GPoint(center.x-7, center.y), GPoint(center.x, center.y-7));
            break;
        case PA:    graphics_draw_circle(ctx, center, 6); break;
    }

    // 数字（カード内なので黒）
    graphics_context_set_text_color(ctx, GColorBlack);
    static char s_val[4];
    snprintf(s_val, sizeof(s_val), "%d", card->value);
    graphics_draw_text(ctx, s_val, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(rect.origin.x, rect.origin.y + 18, rect.size.w, 16),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
}

static void update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    int offset = (s_anim_frame < 0) ? s_anim_frame : 0;

    // テキスト色を白にセット（背景用）
    graphics_context_set_text_color(ctx, GColorWhite);

    // 敵情報
    static char enemy_info[32];
    snprintf(enemy_info, sizeof(enemy_info), "%s HP:%d", current_enemy.name, current_enemy.hp);
    graphics_draw_text(ctx, enemy_info, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(offset, 5, 144, 20), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    // 敵カード
    for(int i=0; i<3; i++) {
        bool high = (s_state != STATE_ENEMY_SELECT && s_state != STATE_WIN && i == s_enemy_idx);
        draw_card(ctx, GRect(15 + i*45 + offset, 30, 30, 40), &current_enemy.cards[i], high);
    }

    // メッセージ
    graphics_context_set_text_color(ctx, GColorWhite);
    if (s_state != STATE_BATTLE_ANIM) {
        graphics_draw_text(ctx, status_text, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                           GRect(0, 75, 144, 20), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    }

    // 中央バトル演出
    if (s_state == STATE_BATTLE_ANIM && (s_anim_frame / 2) % 2 == 0) {
        draw_card(ctx, GRect(40, 75, 30, 40), &current_enemy.cards[s_enemy_idx], true);
        draw_card(ctx, GRect(75, 75, 30, 40), &player_cards[s_player_idx], false);
    }

    // 下段：プレイヤーカード
    for(int i=0; i<3; i++) {
        draw_card(ctx, GRect(15 + i*45, 105, 30, 40), &player_cards[i], false);
    }

    // 最下段：時計 ＋ プレイヤーHP
    graphics_context_set_text_color(ctx, GColorWhite);
    static char bottom_info[32];
    time_t now = time(NULL);
    struct tm *t = localtime(&now);
    snprintf(bottom_info, sizeof(bottom_info), "%02d:%02d  HP:%d", t->tm_hour, t->tm_min, player_hp);
    graphics_draw_text(ctx, bottom_info, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(0, 145, 144, 20), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

// --- ロジック ---

static void anim_timer_callback(void *data) {
    if (s_anim_frame < 0) s_anim_frame += 8; 
    else if (s_state == STATE_BATTLE_ANIM) {
        s_anim_frame++;
        if (s_anim_frame > 16) {
            change_state(STATE_RESULT);
            s_anim_frame = 0;
        }
    }
    layer_mark_dirty(s_canvas_layer);
    s_anim_timer = app_timer_register(30, anim_timer_callback, NULL);
}

void process_battle() {
    Card *p = &player_cards[s_player_idx];
    Card *e = &current_enemy.cards[s_enemy_idx];
    int res = (p->hand - e->hand + 3) % 3;
    if (res == 2) { 
        current_enemy.hp -= p->value; 
        snprintf(status_text, sizeof(status_text), "WIN: %d DMG", p->value); 
    } else if (res == 1) { 
        player_hp -= e->value; 
        snprintf(status_text, sizeof(status_text), "LOSE: %d DMG", e->value); 
    } else {
        int diff = p->value - e->value;
        if (diff >= 0) { 
            current_enemy.hp -= diff; 
            snprintf(status_text, sizeof(status_text), "DRAW: +%d", diff); 
        } else { 
            player_hp -= (-diff); 
            snprintf(status_text, sizeof(status_text), "DRAW: -%d", -diff); 
        }
    }
    p->is_used = true;
    e->is_used = true;
    turn_count++;
}

void start_next_monster() {
    extern Monster get_random_monster();
    current_enemy = get_random_monster();
    for(int i=0; i<3; i++) {
        player_cards[i].is_used = false;
        current_enemy.cards[i].is_used = false;
    }
    turn_count = 0;
    s_anim_frame = -144;
    change_state(STATE_ENEMY_SELECT);
}

void handle_click(int idx) {
    if (s_state == STATE_PLAYER_SELECT) {
        if (player_cards[idx].is_used) return;
        s_player_idx = idx;
        process_battle();
        s_anim_frame = 0;
        change_state(STATE_BATTLE_ANIM);
    }
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) { handle_click(0); }
static void select_click_handler(ClickRecognizerRef recognizer, void *context) { handle_click(1); }
static void down_click_handler(ClickRecognizerRef recognizer, void *context) { handle_click(2); }

static void click_config_provider(void *context) {
    window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
    window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
    window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
}

static void window_load(Window *window) {
    Layer *window_layer = window_get_root_layer(window);
    s_canvas_layer = layer_create(layer_get_bounds(window_layer));
    layer_set_update_proc(s_canvas_layer, update_proc);
    layer_add_child(window_layer, s_canvas_layer);
    start_next_monster();
    s_anim_timer = app_timer_register(30, anim_timer_callback, NULL);
}

static void window_unload(Window *window) { layer_destroy(s_canvas_layer); }

int main(void) {
    s_main_window = window_create();
    window_set_click_config_provider(s_main_window, click_config_provider);
    window_set_window_handlers(s_main_window, (WindowHandlers) { .load = window_load, .unload = window_unload });
    window_stack_push(s_main_window, true);
    app_event_loop();
    window_destroy(s_main_window);
}
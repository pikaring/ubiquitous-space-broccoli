#include <pebble.h>
#include "dungeon_create.h"
#include "battle_logic.h"

#define CX 72
#define CY 84

static Window *s_main_window;
static Layer *s_canvas_layer;
static uint8_t s_map[DUNGEON_H][DUNGEON_W];
static GameState s_state = STATE_EXPLORE;
static AppTimer *s_timer = NULL;

// プレイヤー・バトル情報
Player s_player = {1, 1, 1, 20, 1}; 
Card player_cards[3] = {{GU, 6, false}, {CHOKI, 4, false}, {PA, 5, false}};
Monster current_enemy;
int s_step_count = 0;
int s_enemy_idx, s_player_idx;
int s_anim_frame = 0;
int s_turn_count = 0;
char status_text[32];

// 方向・パース
int dx[] = {0, 1, 0, -1}, dy[] = {-1, 0, 1, 0};
const char* DIR_NAMES[] = {"N", "E", "S", "W"};
int get_w(int d) { switch(d) { case 0: return 140; case 1: return 60; case 2: return 24; case 3: return 10; default: return 4; } }

// --- 状態管理・ロジック ---
void change_state(GameState next_state);
extern Monster get_random_monster();

void process_battle() {
    Card *p = &player_cards[s_player_idx];
    Card *e = &current_enemy.cards[s_enemy_idx];
    int res = (p->hand - e->hand + 3) % 3;
    if (res == 2) { current_enemy.hp -= p->value; snprintf(status_text, sizeof(status_text), "WIN: %d DMG", p->value); }
    else if (res == 1) { s_player.hp -= e->value; snprintf(status_text, sizeof(status_text), "LOSE: %d DMG", e->value); }
    else {
        int diff = p->value - e->value;
        if (diff >= 0) { current_enemy.hp -= diff; snprintf(status_text, sizeof(status_text), "DRAW: +%d", diff); }
        else { s_player.hp -= (-diff); snprintf(status_text, sizeof(status_text), "DRAW: -%d", -diff); }
    }
    p->is_used = e->is_used = true;
    s_turn_count++;
}

static void state_timer_handler(void *data) {
    switch (s_state) {
        case STATE_ENCOUNTER: change_state(STATE_BATTLE_START); break;
        case STATE_ENEMY_SELECT:
            s_enemy_idx = rand() % 3;
            while(current_enemy.cards[s_enemy_idx].is_used) s_enemy_idx = (s_enemy_idx + 1) % 3;
            change_state(STATE_PLAYER_SELECT);
            break;
        case STATE_RESULT:
            if (current_enemy.hp <= 0) change_state(STATE_WIN);
            else {
                if (s_turn_count >= 3) {
                    for(int i=0; i<3; i++) player_cards[i].is_used = current_enemy.cards[i].is_used = false;
                    s_turn_count = 0;
                }
                change_state(STATE_ENEMY_SELECT);
            }
            break;
        case STATE_WIN: change_state(STATE_EXPLORE); break;
        default: break;
    }
}

void change_state(GameState next_state) {
    s_state = next_state;
    if (s_timer) { app_timer_cancel(s_timer); s_timer = NULL; }
    
    switch (s_state) {
        case STATE_ENCOUNTER:
            // エンカウントした瞬間に敵を先行決定 (スプライト表示用)
            current_enemy = get_random_monster(); 
            s_timer = app_timer_register(3000, state_timer_handler, NULL); 
            break;
        case STATE_BATTLE_START:
            // ここでの get_random_monster() は削除 (ENCOUNTER時に決定済み)
            for(int i=0; i<3; i++) player_cards[i].is_used = false;
            s_turn_count = 0;
            change_state(STATE_ENEMY_SELECT);
            break;
        case STATE_ENEMY_SELECT: snprintf(status_text, sizeof(status_text), "ENEMY THINKING..."); s_timer = app_timer_register(1200, state_timer_handler, NULL); break;
        case STATE_RESULT: s_timer = app_timer_register(2000, state_timer_handler, NULL); break;
        case STATE_WIN: snprintf(status_text, sizeof(status_text), "YOU WIN!"); s_timer = app_timer_register(2000, state_timer_handler, NULL); break;
        default: break;
    }
    layer_mark_dirty(s_canvas_layer);
}

// --- 描画関数 ---

void draw_card(GContext *ctx, GRect rect, Card *card, bool high) {
    if (card->is_used && s_state != STATE_BATTLE_ANIM) return;
    
    // カード枠
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, rect, 4, GCornersAll);
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_context_set_stroke_width(ctx, high ? 3 : 1); // 強調
    graphics_draw_round_rect(ctx, rect, 4);

    // 記号 (強調設定を維持)
    GPoint center = GPoint(rect.origin.x + rect.size.w/2, rect.origin.y + 12);
    if (card->hand == GU) graphics_draw_rect(ctx, GRect(center.x-5, center.y-5, 10, 10));
    else if (card->hand == CHOKI) {
        graphics_draw_line(ctx, GPoint(center.x, center.y-7), GPoint(center.x+7, center.y));
        graphics_draw_line(ctx, GPoint(center.x+7, center.y), GPoint(center.x, center.y+7));
        graphics_draw_line(ctx, GPoint(center.x, center.y+7), GPoint(center.x-7, center.y));
        graphics_draw_line(ctx, GPoint(center.x-7, center.y), GPoint(center.x, center.y-7));
    } else graphics_draw_circle(ctx, center, 6);

    // 数字
    graphics_context_set_text_color(ctx, GColorBlack);
    static char s_val[4]; snprintf(s_val, sizeof(s_val), "%d", card->value);
    graphics_draw_text(ctx, s_val, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), GRect(rect.origin.x, rect.origin.y + 18, rect.size.w, 16), 0, GTextAlignmentCenter, NULL);
}

    // モンスターのスプライトを描画する関数 (8x8ビットを拡大描画)
void draw_monster_sprite(GContext *ctx, uint64_t sprite, int x_center, int y_center, int scale) {
    if (sprite == 0) return;
    graphics_context_set_fill_color(ctx, GColorWhite);
    
    int start_x = x_center - (8 * scale) / 2;
    int start_y = y_center - (8 * scale) / 2;

    for (int y = 0; y < 8; y++) {
        for (int x = 0; x < 8; x++) {
            // ビットをチェック (左上 0番目のビットから順に)
            // 63 - (y*8 + x) 番目のビットを抽出
            if ((sprite >> (63 - (y * 8 + x))) & 1) {
                graphics_fill_rect(ctx, GRect(start_x + x * scale, start_y + y * scale, scale, scale), 0, GCornerNone);
            }
        }
    }
}


static void update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    if (s_state == STATE_EXPLORE || s_state == STATE_ENCOUNTER) {
        // --- 探索モード描画 ---
        for (int d = 3; d >= 0; d--) {
            int px = s_player.x + dx[s_player.dir] * d, py = s_player.y + dy[s_player.dir] * d;
            if (px < 0 || px >= DUNGEON_W || py < 0 || py >= DUNGEON_H) continue;
            int w = get_w(d), h = (int)(w * 0.8), nw = get_w(d+1), nh = (int)(nw * 0.8);
            int x_l = CX-w, x_r = CX+w, y_t = CY-h, y_b = CY+h, nx_l = CX-nw, nx_r = CX+nw, ny_t = CY-nh, ny_b = CY+nh;
            graphics_context_set_stroke_color(ctx, GColorWhite);
            graphics_context_set_stroke_width(ctx, 1);
            if (s_map[py][px] == CELL_WALL) {
                if (d == 0) continue;
                graphics_fill_rect(ctx, GRect(x_l, y_t, x_r-x_l, y_b-y_t), 0, GCornerNone);
                graphics_draw_rect(ctx, GRect(x_l, y_t, x_r-x_l, y_b-y_t));
                continue;
            }
            int l_dir = (s_player.dir+3)%4, r_dir = (s_player.dir+1)%4;
            if (s_map[py+dy[l_dir]][px+dx[l_dir]] == CELL_WALL) {
                graphics_draw_line(ctx, GPoint(x_l, y_t), GPoint(nx_l, ny_t)); graphics_draw_line(ctx, GPoint(x_l, y_b), GPoint(nx_l, ny_b));
                graphics_draw_line(ctx, GPoint(x_l, y_t), GPoint(x_l, y_b)); graphics_draw_line(ctx, GPoint(nx_l, ny_t), GPoint(nx_l, ny_b));
            } else if (s_map[py+dy[s_player.dir]+dy[l_dir]][px+dx[s_player.dir]+dx[l_dir]] == CELL_WALL) {
                graphics_draw_line(ctx, GPoint(nx_l, ny_t), GPoint(nx_l, ny_b)); graphics_draw_line(ctx, GPoint(x_l, ny_t), GPoint(nx_l, ny_t)); graphics_draw_line(ctx, GPoint(x_l, ny_b), GPoint(nx_l, ny_b));
            }
            if (s_map[py+dy[r_dir]][px+dx[r_dir]] == CELL_WALL) {
                graphics_draw_line(ctx, GPoint(x_r, y_t), GPoint(nx_r, ny_t)); graphics_draw_line(ctx, GPoint(x_r, y_b), GPoint(nx_r, ny_b));
                graphics_draw_line(ctx, GPoint(x_r, y_t), GPoint(x_r, y_b)); graphics_draw_line(ctx, GPoint(nx_r, ny_t), GPoint(nx_r, ny_b));
            } else if (s_map[py+dy[s_player.dir]+dy[r_dir]][px+dx[s_player.dir]+dx[r_dir]] == CELL_WALL) {
                graphics_draw_line(ctx, GPoint(nx_r, ny_t), GPoint(nx_r, ny_b)); graphics_draw_line(ctx, GPoint(x_r, ny_t), GPoint(nx_r, ny_t)); graphics_draw_line(ctx, GPoint(x_r, ny_b), GPoint(nx_r, ny_b));
            }
        }
        if (s_state == STATE_ENCOUNTER) {
            s_step_count =0;
            // 背景に黒いボックスを表示
            graphics_context_set_fill_color(ctx, GColorBlack);
            graphics_fill_rect(ctx, GRect(10, 40, 124, 80), 4, GCornersAll);
            graphics_context_set_stroke_color(ctx, GColorWhite);
            graphics_draw_round_rect(ctx, GRect(10, 40, 124, 80), 4);

            // モンスターのスプライトを描画 (中心にスケール6で描画 = 48x48px)
            extern uint64_t get_monster_sprite(const char *name);
            // current_enemyはBATTLE_STARTで決まるので、ここでは一時的に生成または名前から取得
            // (change_state(STATE_ENCOUNTER)時にモンスターを先行決定しておくとスムーズです)
            uint64_t sprite = get_monster_sprite(current_enemy.name);
            draw_monster_sprite(ctx, sprite, 72, 70, 6);

            graphics_context_set_text_color(ctx, GColorWhite);
            graphics_draw_text(ctx, "ENCOUNTER!", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), 
                               GRect(0, 95, 144, 20), 0, GTextAlignmentCenter, NULL);
        }
    }else {
        // --- バトルモード描画 ---
        // 1. 敵のカード描画
        for(int i=0; i<3; i++) {
            bool is_high = (s_state != STATE_ENEMY_SELECT && i == s_enemy_idx);
            draw_card(ctx, GRect(15+i*45, 30, 30, 40), &current_enemy.cards[i], is_high);
        }

        // ★重要：メッセージ描画の直前で「白」を再設定
        graphics_context_set_text_color(ctx, GColorWhite);

        // アニメーション中でなければ、またはアニメーション後半ならテキストを表示
        if (s_state != STATE_BATTLE_ANIM) {
            graphics_draw_text(ctx, status_text, fonts_get_system_font(FONT_KEY_GOTHIC_18), 
                               GRect(0, 75, 144, 20), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
        }

        // 2. 中央の演出（カードのぶつかり合い）
        if (s_state == STATE_BATTLE_ANIM && (s_anim_frame/2)%2==0) {
            draw_card(ctx, GRect(40, 75, 30, 40), &current_enemy.cards[s_enemy_idx], true);
            draw_card(ctx, GRect(75, 75, 30, 40), &player_cards[s_player_idx], false);
        }

        // 3. プレイヤーのカード描画
        for(int i=0; i<3; i++) {
            draw_card(ctx, GRect(15+i*45, 105, 30, 40), &player_cards[i], false);
        }
    }


    // --- UI帯 (上部・下部) ---
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(0, 0, 144, 25), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(0, 143, 144, 25), 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorWhite);

    if (s_state == STATE_EXPLORE || s_state == STATE_ENCOUNTER) {
        // 探索中の上部：座標
        static char top_info[32]; snprintf(top_info, sizeof(top_info), "B1F %s (%02d,%02d)", DIR_NAMES[s_player.dir], s_player.x, s_player.y);
        graphics_draw_text(ctx, top_info, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(0, 2, 144, 22), 0, GTextAlignmentCenter, NULL);
    } else {
        // バトル中の上部：モンスター名とHP
        static char enemy_info[32]; snprintf(enemy_info, sizeof(enemy_info), "%s HP:%d", current_enemy.name, current_enemy.hp);
        graphics_draw_text(ctx, enemy_info, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(0, 2, 144, 22), 0, GTextAlignmentCenter, NULL);
    }

    // 共通下部：時計・プレイヤーHP
    static char bottom_info[32]; time_t now = time(NULL); struct tm *t = localtime(&now);
    snprintf(bottom_info, sizeof(bottom_info), "%02d:%02d HP:%d ST:%d", t->tm_hour, t->tm_min, s_player.hp, s_step_count);
    graphics_draw_text(ctx, bottom_info, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(0, 145, 144, 20), 0, GTextAlignmentCenter, NULL);
}

// --- タイマー・アニメーション・イベント ---

static void anim_timer_callback(void *data) {
    if (s_state == STATE_BATTLE_ANIM) {
        s_anim_frame++; if (s_anim_frame > 16) { change_state(STATE_RESULT); s_anim_frame = 0; }
    }
    layer_mark_dirty(s_canvas_layer);
    app_timer_register(30, anim_timer_callback, NULL);
}

static void handle_click(int idx) {
    if (s_state == STATE_EXPLORE) {
        if (idx == 1) { 
            int nx = s_player.x + dx[s_player.dir], ny = s_player.y + dy[s_player.dir];
            if (s_map[ny][nx] == CELL_PATH) { s_player.x = nx; s_player.y = ny; s_step_count++; if (s_step_count >= 10) change_state(STATE_ENCOUNTER); }
        } else { s_player.dir = (s_player.dir + (idx==0?1:-1) + 4) % 4; }
    } else if (s_state == STATE_PLAYER_SELECT) {
        if (!player_cards[idx].is_used) { s_player_idx = idx; process_battle(); s_anim_frame = 0; change_state(STATE_BATTLE_ANIM); }
    }
    layer_mark_dirty(s_canvas_layer);
}

// ... ボタン・ライフサイクル関数は前回と同様 ...
static void up_click_handler(ClickRecognizerRef r, void *c) { handle_click(0); }
static void select_click_handler(ClickRecognizerRef r, void *c) { handle_click(1); }
static void down_click_handler(ClickRecognizerRef r, void *c) { handle_click(2); }

static void click_config_provider(void *c) {
    window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
    window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
    window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
}

static void window_load(Window *window) {
    s_canvas_layer = layer_create(layer_get_bounds(window_get_root_layer(window)));
    layer_set_update_proc(s_canvas_layer, update_proc);
    layer_add_child(window_get_root_layer(window), s_canvas_layer);
    srand(time(NULL)); 
    dungeon_create(s_map);
    app_timer_register(30, anim_timer_callback, NULL);
}

int main(void) {
    s_main_window = window_create();
    window_set_click_config_provider(s_main_window, click_config_provider);
    window_set_window_handlers(s_main_window, (WindowHandlers) { .load = window_load, .unload = (WindowHandler)layer_destroy });
    window_stack_push(s_main_window, true);
    app_event_loop();
    window_destroy(s_main_window);
}
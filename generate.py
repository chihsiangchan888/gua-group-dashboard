#!/usr/bin/env python3
"""Generate Pokémon TCG-style Agent Dashboard from AgEnD fleet status."""
import json
import subprocess
import re
from datetime import datetime
from pathlib import Path

# PokeAPI Gen5 animated sprites (pixel art style)
SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated"

# Agent metadata with full rules extracted from steering files
AGENT_META = {
    "general": {
        "type": "Normal",
        "color": "#A8A878",
        "desc": "Fleet 總指揮",
        "hp": 200,
        "pokemon": "卡比獸 Snorlax",
        "sprite": f"{SPRITE_BASE}/143.gif",
        "skills": [
            {"name": "任務分類", "cost": "⚪", "desc": "分類請求並決定自己處理或委派"},
            {"name": "智能路由", "cost": "⚪⚪", "desc": "找到最適合的 agent 並委派任務"},
        ],
        "rules": [
            "Fleet 中央入口 — 路由任務、管理 instance、執行政策、統整結果",
            "不直接修改檔案 — 委派給對應 instance",
            "可以直接回答 Q&A、翻譯、寫 code snippet",
            "【任務分類】直接處理：不需檔案存取、靜態知識可答、≤2步推理",
            "【任務分類】委派單一 instance：任務範圍在單一 repo",
            "【任務分類】協調多 instance：跨 repo 或需平行執行（最多3個）",
            "【發現 Instance 順序】list_teams → list_instances → describe_instance → create_instance",
            "優先重用，不建重複 instance",
            "【委派必含】1.任務範圍 2.預期輸出 3.政策提醒",
            "【防迴圈】不把任務退回給來源 instance；彈回3次就本地解決",
            "【結果處理】成功→摘要給 user；部分→說明進度；失敗→重試2次",
            "【Development Workflow】Design→Approved→Implement→Review→Merge",
            "每個 code 任務要有 developer + reviewer",
            "Bug 修復要先確認 root cause",
            "Merge 條件：tests pass、reviewer approved、branch 清理",
        ],
        "weakness": "Fighting",
        "retreat": "⚪⚪⚪⚪",
    },
    "高二哥-t13": {
        "type": "Psychic",
        "color": "#F85888",
        "desc": "Skill Prompt 產生專家",
        "hp": 120,
        "pokemon": "胡地 Alakazam",
        "sprite": f"{SPRITE_BASE}/65.gif",
        "skills": [
            {"name": "Prompt 生成", "cost": "🟣", "desc": "根據需求產生完整 system prompt"},
            {"name": "人格設計", "cost": "🟣🟣", "desc": "設計 agent 角色定義與行為準則"},
        ],
        "rules": [
            "專門幫使用者設計高品質的 skill prompt",
            "根據使用者描述的技能或情境，產生清晰、結構化、可直接使用的 prompt",
            "每個 prompt 包含：角色定義、任務說明、輸出格式、限制條件",
            "回應語言跟隨使用者輸入語言",
            "Steering 設定檔是 skill 的主體（bot 執行依據）",
        ],
        "weakness": "Dark",
        "retreat": "⚪",
    },
    "排骨達人-t84": {
        "type": "Fighting",
        "color": "#C03028",
        "desc": "老虎機機率與牌庫設計專家",
        "hp": 150,
        "pokemon": "怪力 Machamp",
        "sprite": f"{SPRITE_BASE}/68.gif",
        "skills": [
            {"name": "機率分析", "cost": "🔴", "desc": "計算老虎機各符號出現機率與期望值"},
            {"name": "牌庫設計", "cost": "🔴🔴", "desc": "設計平衡的牌庫配置與權重"},
        ],
        "rules": [
            "專精於老虎機機率與牌庫設計",
            "【學習階段】一開始是熱情的學生，主動向使用者提問吸收牌庫知識",
            "每次對話針對資訊提出 1-3 個具體問題深化理解",
            "問題聚焦：符號種類、出現頻率、權重設定、特殊規則",
            "把使用者給的所有資訊整理成結構化知識庫",
            "【專家階段】知識累積後轉換為專家角色",
            "能回答機率計算、期望值、牌庫平衡性問題",
            "提供具體的數據分析與建議",
            "用繁體中文溝通，保持熱情與好奇心",
            "整理知識時用表格或列表呈現",
            "不確定的地方誠實說明並請使用者補充",
        ],
        "weakness": "Psychic",
        "retreat": "⚪⚪",
    },
    "報告大師-t246": {
        "type": "Fairy",
        "color": "#EE99AC",
        "desc": "文案修飾與報告大綱助手",
        "hp": 100,
        "pokemon": "皮可西 Clefable",
        "sprite": f"{SPRITE_BASE}/36.gif",
        "skills": [
            {"name": "郵件潤飾", "cost": "🩷", "desc": "讓信件更專業、清晰、有禮"},
            {"name": "大綱生成", "cost": "🩷🩷", "desc": "產出結構清晰的報告大綱"},
        ],
        "rules": [
            "專精於商務寫作與報告規劃",
            "【郵件修飾】潤飾信件讓文字更專業、清晰、有禮",
            "【文案建議】提供具體改善建議並說明修改原因",
            "【報告大綱】快速產出結構清晰的報告大綱",
            "修飾文案時，同時提供原文對照與修改說明",
            "產出大綱時，層次分明（主標題→子項目），簡述每章重點",
            "語氣專業但不生硬，符合職場商務風格",
            "用繁體中文溝通",
            "若需求不夠清楚，先問清楚再動手",
        ],
        "weakness": "Steel",
        "retreat": "⚪",
    },
    "不准帶ab幾-t433": {
        "type": "Steel",
        "color": "#B8B8D0",
        "desc": "A/B 測試分析專家",
        "hp": 160,
        "pokemon": "巨金怪 Metagross",
        "sprite": f"{SPRITE_BASE}/376.gif",
        "skills": [
            {"name": "版本比較", "cost": "⚪⚪", "desc": "分析兩版本數據差異與統計顯著性"},
            {"name": "玩家洞察", "cost": "⚪⚪⚪", "desc": "分析不同玩家族群行為差異"},
        ],
        "rules": [
            "專門分析老虎機遊戲 A/B 測試數據",
            "服務對象：機率工程師",
            "【學習階段】主動提問 1-3 題學習：玩家族群定義、倍率區間意義、評估標準、遊戲背景",
            "【分析能力】比較兩版本在各倍率區間的表現差異",
            "分析對新玩家 vs 舊玩家的不同影響",
            "判斷哪個版本對哪個玩家族群更有利",
            "用白話解釋數字背後的意義",
            "提供版本選擇建議並說明理由",
            "【接受格式】CSV 文字、表格貼上、自然語言描述",
            "明確區分「數據事實」與「推論判斷」",
            "分析結果條理清晰，適合向主管報告",
            "不確定處誠實說明，請使用者補充背景",
        ],
        "weakness": "Fire",
        "retreat": "⚪⚪",
    },
    "小綠人-t858": {
        "type": "Grass",
        "color": "#78C850",
        "desc": "蘇格拉底式逼問釐清設計",
        "hp": 110,
        "pokemon": "妙蛙種子 Bulbasaur",
        "sprite": f"{SPRITE_BASE}/1.gif",
        "skills": [
            {"name": "逼問", "cost": "🟢", "desc": "針對計畫的每個面向提出質疑"},
            {"name": "釐清", "cost": "🟢🟢", "desc": "一題一題走過設計樹的每個分支"},
        ],
        "rules": [
            "Grill-me skill bot — 蘇格拉底式逼問",
            "對使用者的計畫進行不留情面的逐步質問",
            "直到雙方達成共識為止",
            "走遍設計樹每個分支，逐一解決決策依賴",
            "每個問題附帶推薦答案",
            "一次只問一題",
            "能透過查看 codebase 回答的就直接查，不問使用者",
        ],
        "weakness": "Fire",
        "retreat": "⚪",
    },
    "任意門-t986": {
        "type": "Ghost",
        "color": "#705898",
        "desc": "Git 操作專員",
        "hp": 130,
        "pokemon": "耿鬼 Gengar",
        "sprite": f"{SPRITE_BASE}/94.gif",
        "skills": [
            {"name": "傳送", "cost": "🟣", "desc": "push/pull 同步 GitHub repo"},
            {"name": "時空管理", "cost": "🟣🟣", "desc": "版本管理、branch 操作、衝突解決"},
        ],
        "rules": [
            "呱集團 Git 操作專員",
            "【上傳 push】將 E 槽更新推到 GitHub",
            "【同步 pull】從 GitHub 拉取最新版本",
            "【提交 commit】將變更記錄到版本歷史",
            "【狀態查詢】查看哪些檔案有變動、repo 狀態",
            "【協作管理】邀請/管理 collaborator",
            "GitHub 帳號：chihsiangchan888",
            "Repo：github.com/chihsiangchan888/gua-group-bots（私人）",
            "本地路徑：/mnt/e/呱集團/",
            "Token 已存在 ~/.git-credentials",
            "回應語言跟隨使用者",
        ],
        "weakness": "Dark",
        "retreat": "⚪",
    },
    "ai菜雞-t1167": {
        "type": "Electric",
        "color": "#F8D030",
        "desc": "AI 資訊分析助手",
        "hp": 120,
        "pokemon": "皮卡丘 Pikachu",
        "sprite": f"{SPRITE_BASE}/25.gif",
        "skills": [
            {"name": "閃電摘要", "cost": "⚡", "desc": "2-3 句話說明文章在講什麼"},
            {"name": "行動建議", "cost": "⚡⚡", "desc": "告訴你「你可以怎麼用」"},
        ],
        "rules": [
            "AI 資訊分析助手",
            "【職責】收到 AI 相關內容（文字、連結、截圖）時分析",
            "1. 摘要：2-3 句話說明在講什麼",
            "2. 重點條列：3-5 個關鍵重點",
            "3. 行動建議：具體可操作的下一步",
            "【輸入處理】文字→直接分析 / 連結→web_fetch / 截圖→讀圖",
            "【輸出格式】📝摘要 → 🔑重點 → 🎯你可以這樣做",
            "專屬目錄：/mnt/e/呱集團/AI菜雞/",
            "共用目錄：/mnt/e/呱集團/共用/",
            "用繁體中文回應，語氣輕鬆但內容紮實",
            "內容跟 AI 無關也照樣分析不拒絕",
            "看不懂的截圖誠實說看不清楚",
        ],
        "weakness": "Ground",
        "retreat": "⚪",
    },
    "卡卡西-t1451": {
        "type": "Normal",
        "color": "#A8A878",
        "desc": "老虎機遊戲規格書產生器",
        "hp": 110,
        "pokemon": "圖圖犬 Smeargle",
        "sprite": f"{SPRITE_BASE}/235.gif",
        "skills": [
            {"name": "類型判斷", "cost": "⚪", "desc": "從遊戲資料判斷老虎機類型"},
            {"name": "規格書生成", "cost": "⚪⚪", "desc": "產出結構化 Markdown 規格書"},
        ],
        "rules": [
            "老虎機遊戲規格書產生器",
            "將使用者提供的遊戲 info（文字、截圖、說明）整理成結構化 Markdown 規格書",
            "【類型判斷】MegaWays / 多類消除 / 消除類 / 一般連線 / 急速類 / 3 Pots 系列",
            "【規格書結構】基本資訊表、符號說明、賠率表、特色玩法、免費遊戲、獎池系統",
            "忠實呈現，不自行推斷數值",
            "缺漏欄位標記「待補」",
            "符號無名稱時以外觀描述命名，全文一致",
            "賠率用表格，規則用編號清單",
            "產完規格書後詢問是否存檔",
            "存檔路徑：/mnt/e/Kirooo/規格書庫/{遊戲類型}/",
        ],
        "weakness": "Fire",
        "retreat": "⚪",
    },
    "魔牆人偶-t1514": {
        "type": "Psychic",
        "color": "#F85888",
        "desc": "Agent Dashboard 維護員",
        "hp": 100,
        "pokemon": "魔牆人偶 Mr. Mime",
        "sprite": f"{SPRITE_BASE}/122.gif",
        "skills": [
            {"name": "卡片更新", "cost": "🟣", "desc": "新增/移除 agent 卡片到 dashboard"},
            {"name": "部署", "cost": "🟣🟣", "desc": "產生 HTML 並推送至 GitHub Pages"},
        ],
        "rules": [
            "呱集團 Agent Monitoring Dashboard 維護員",
            "負責 Pokémon TCG 卡片風格的 fleet dashboard（GitHub Pages）",
            "【職責】更新 agent 資訊、新增/移除 agent 卡片、調整 UI",
            "執行 generate.py 產出 HTML 並部署",
            "新 agent 加入時為其選配 Pokémon 並更新對應表",
            "維護 UI 品質（TCG 風格、翻轉互動、響應式設計）",
            "Git push 委派給 任意門-t986",
            "修改前需向呱老大確認",
        ],
        "weakness": "Dark",
        "retreat": "⚪",
    },
}


def parse_activity(activity_str):
    if not activity_str:
        return "idle"
    s = activity_str.strip().lower()
    match = re.match(r"(\d+)([smhd])", s)
    if not match:
        return "idle"
    val, unit = int(match.group(1)), match.group(2)
    if unit == "s" or (unit == "m" and val <= 60):
        return "active"
    return "idle"


def get_health(status, activity_str):
    if status != "running":
        return "fainted"
    return parse_activity(activity_str)


def get_fleet_data():
    result = subprocess.run(
        ["agend", "fleet", "status", "--json"],
        capture_output=True, text=True
    )
    return json.loads(result.stdout)


def generate_html(agents, work_log=None):
    cards_html = ""
    for agent in agents:
        name = agent["name"]
        meta = AGENT_META.get(name, {
            "type": "Normal", "color": "#A8A878", "desc": "", "hp": 100,
            "skills": [], "rules": [], "weakness": "?", "retreat": "⚪"
        })
        health = get_health(agent["status"], agent.get("lastActivity", ""))

        if health == "active":
            hp_pct, status_text = 100, "● 活躍中"
        elif health == "idle":
            hp_pct, status_text = 50, "◐ 待命中"
        else:
            hp_pct, status_text = 0, "✕ 已停止"

        card_extra = " fainted" if health == "fainted" else ""
        activity = agent.get("lastActivity", "unknown")

        # Skills HTML
        skills_html = ""
        for skill in meta.get("skills", []):
            skills_html += f'''
          <div class="move">
            <div class="move-header">
              <span class="move-cost">{skill['cost']}</span>
              <span class="move-name">{skill['name']}</span>
            </div>
            <p class="move-desc">{skill['desc']}</p>
          </div>'''

        # Rules HTML
        rules_html = ""
        for rule in meta.get("rules", []):
            rules_html += f'<li>{rule}</li>'

        cards_html += f'''
    <div class="card-container{card_extra}">
      <div class="card-flipper" onclick="this.classList.toggle('flipped')">
        <!-- FRONT -->
        <div class="card-front" style="--type-color: {meta['color']}">
          <div class="card-top" style="--type-color: {meta['color']}">
            <span class="card-stage">BASIC</span>
            <span class="card-hp">HP {meta['hp']}</span>
            <span class="card-type-icon">{meta['type']}</span>
          </div>
          <div class="card-image" style="--type-color: {meta['color']}">
            <img class="pokemon-sprite" src="{meta.get('sprite', '')}" alt="{meta.get('pokemon', '')}" />
            <div class="status-indicator {health}">{status_text}</div>
          </div>
          <div class="pokemon-name">{meta.get('pokemon', '')}</div>
          <div class="card-name-bar">
            <h2>{name}</h2>
            <span class="card-subtitle">{meta['desc']}</span>
          </div>
          <div class="card-moves">
            {skills_html}
          </div>
          <div class="card-bottom">
            <span class="weakness">弱點: {meta.get('weakness', '?')}</span>
            <span class="retreat">撤退: {meta.get('retreat', '⚪')}</span>
            <span class="last-seen">🕐 {activity}</span>
          </div>
          <div class="flip-hint">👆 點擊翻牌看完整規範</div>
        </div>
        <!-- BACK -->
        <div class="card-back" style="--type-color: {meta['color']}">
          <div class="card-top" style="--type-color: {meta['color']}">
            <span class="card-stage">📖 規範</span>
            <span class="card-hp">{name}</span>
            <span class="card-type-icon">{meta['type']}</span>
          </div>
          <div class="back-content">
            <h3>{meta['desc']}</h3>
            <ul class="rules-list">{rules_html}</ul>
          </div>
          <div class="flip-hint">👆 點擊翻回正面</div>
        </div>
      </div>
    </div>'''

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    active_count = sum(1 for a in agents if get_health(a['status'], a.get('lastActivity', '')) == 'active')
    idle_count = sum(1 for a in agents if get_health(a['status'], a.get('lastActivity', '')) == 'idle')
    fainted_count = sum(1 for a in agents if a['status'] != 'running')

    return f'''<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>⚡ 呱集團 Pokémon Agent Dashboard</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  min-height: 100vh;
  padding: 2rem 1rem;
  color: #333;
}}
header {{
  text-align: center;
  margin-bottom: 2rem;
}}
header h1 {{
  font-size: 2rem;
  color: #f8d030;
  text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
  letter-spacing: 1px;
}}
header .subtitle {{
  color: #aaa;
  font-size: 0.85rem;
  margin-top: 0.3rem;
}}
.fleet-bar {{
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}}
.fleet-bar .pill {{
  background: rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 0.4rem 1rem;
  color: #eee;
  font-size: 0.8rem;
  backdrop-filter: blur(5px);
}}
.fleet-bar .pill strong {{ color: #f8d030; }}
.grid {{
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 2rem;
  max-width: 1300px;
  margin: 0 auto;
}}

/* === POKEMON TCG CARD WITH FLIP === */
.card-container {{
  perspective: 1000px;
  min-height: 480px;
}}
.card-container.fainted {{
  filter: saturate(0.15) brightness(0.5);
  opacity: 0.6;
}}
.card-flipper {{
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 480px;
  transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  transform-style: preserve-3d;
  cursor: pointer;
}}
.card-flipper.flipped {{
  transform: rotateY(180deg);
}}
.card-front, .card-back {{
  position: absolute;
  top: 0; left: 0; right: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: 14px;
  border: 10px solid #f8d030;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3);
  overflow: hidden;
  background: #f5f1e0;
}}
.card-front {{
  z-index: 2;
}}
.card-back {{
  transform: rotateY(180deg);
  display: flex;
  flex-direction: column;
}}
.card-front:hover, .card-back:hover {{
  box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 20px color-mix(in srgb, var(--type-color) 30%, transparent);
}}
.flip-hint {{
  text-align: center;
  font-size: 0.65rem;
  color: #999;
  padding: 0.4rem;
  background: rgba(0,0,0,0.03);
  border-top: 1px solid #eee;
}}
.back-content {{
  flex: 1;
  overflow-y: auto;
  padding: 0.8rem;
  max-height: 380px;
}}
.back-content h3 {{
  font-size: 0.85rem;
  color: var(--type-color);
  margin-bottom: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 2px solid var(--type-color);
}}
.rules-list {{
  list-style: none;
  padding: 0;
}}
.rules-list li {{
  font-size: 0.72rem;
  color: #333;
  padding: 4px 0 4px 1rem;
  position: relative;
  line-height: 1.5;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}}
.rules-list li:last-child {{ border-bottom: none; }}
.rules-list li::before {{
  content: '▸';
  position: absolute;
  left: 0;
  color: var(--type-color);
  font-weight: bold;
}}

.card-top {{
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.8rem;
  background: linear-gradient(90deg, var(--type-color), color-mix(in srgb, var(--type-color) 70%, #fff));
}}
.card-stage {{
  font-size: 0.65rem;
  font-weight: bold;
  color: #fff;
  background: rgba(0,0,0,0.3);
  padding: 1px 6px;
  border-radius: 3px;
}}
.card-hp {{
  font-size: 1rem;
  font-weight: bold;
  color: #fff;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
}}
.card-type-icon {{
  font-size: 0.7rem;
  background: rgba(255,255,255,0.3);
  padding: 2px 8px;
  border-radius: 10px;
  color: #fff;
  font-weight: bold;
}}

.card-image {{
  margin: 0.5rem 0.8rem;
  border: 3px solid var(--type-color);
  border-radius: 8px;
  background: linear-gradient(135deg, #e8e4d4, #d4cfc0);
  padding: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  min-height: 100px;
}}
.pokemon-sprite {{
  width: 80px;
  height: 80px;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}}
.pokemon-name {{
  text-align: center;
  font-size: 0.65rem;
  color: #888;
  font-style: italic;
  margin-top: -0.2rem;
  margin-bottom: 0.2rem;
}}
.status-indicator {{
  position: absolute;
  bottom: 4px;
  right: 6px;
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 8px;
  font-weight: bold;
}}
.status-indicator.active {{ background: #4caf50; color: #fff; }}
.status-indicator.idle {{ background: #ff9800; color: #fff; }}
.status-indicator.fainted {{ background: #f44336; color: #fff; }}

.card-name-bar {{
  padding: 0.4rem 0.8rem;
  border-bottom: 2px solid #ddd;
}}
.card-name-bar h2 {{
  font-size: 1rem;
  color: #222;
  margin-bottom: 0.1rem;
}}
.card-subtitle {{
  font-size: 0.7rem;
  color: #666;
}}

.card-moves {{
  padding: 0.5rem 0.8rem;
}}
.move {{
  margin-bottom: 0.4rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid #e0ddd0;
}}
.move:last-child {{ border-bottom: none; }}
.move-header {{
  display: flex;
  align-items: center;
  gap: 0.5rem;
}}
.move-cost {{
  font-size: 0.8rem;
}}
.move-name {{
  font-weight: bold;
  font-size: 0.8rem;
  color: #333;
}}
.move-desc {{
  font-size: 0.7rem;
  color: #555;
  margin-top: 2px;
  padding-left: 0.3rem;
}}

.card-bottom {{
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0.8rem;
  border-top: 2px solid #ddd;
  font-size: 0.65rem;
  color: #777;
  flex-wrap: wrap;
  gap: 0.3rem;
}}
.weakness {{ color: #c03028; }}

footer {{
  text-align: center;
  margin-top: 2.5rem;
  color: #666;
  font-size: 0.75rem;
}}
footer code {{
  background: rgba(255,255,255,0.15);
  padding: 2px 6px;
  border-radius: 4px;
  color: #aaa;
}}
.shared-rules {{
  max-width: 1200px;
  margin: 0 auto 2rem;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  padding: 0;
  backdrop-filter: blur(5px);
}}
.shared-rules summary {{
  padding: 0.8rem 1.2rem;
  cursor: pointer;
  color: #f8d030;
  font-weight: bold;
  font-size: 0.9rem;
  list-style: none;
}}
.shared-rules summary::before {{
  content: '▸ ';
}}
.shared-rules[open] summary::before {{
  content: '▾ ';
}}
.shared-rules-content {{
  padding: 0 1.2rem 1rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}}
.rule-group {{
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  padding: 0.7rem;
}}
.rule-group h4 {{
  font-size: 0.75rem;
  color: #eee;
  margin-bottom: 0.4rem;
}}
.rule-group ul {{
  list-style: none;
  padding: 0;
}}
.rule-group li {{
  font-size: 0.7rem;
  color: #ccc;
  padding: 2px 0 2px 0.8rem;
  position: relative;
  line-height: 1.4;
}}
.rule-group li::before {{
  content: '•';
  position: absolute;
  left: 0;
  color: #888;
}}

/* === WORK LOG === */
.work-log-section {{
  max-width: 1200px;
  margin: 0 auto 2rem;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  padding: 1.2rem;
  backdrop-filter: blur(5px);
}}
.work-log-title {{
  color: #f8d030;
  font-size: 1.1rem;
  margin-bottom: 0.8rem;
}}
.work-log-controls {{
  margin-bottom: 0.8rem;
}}
.work-log-controls input {{
  width: 100%;
  padding: 0.5rem 0.8rem;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(0,0,0,0.3);
  color: #eee;
  font-size: 0.85rem;
}}
.work-log-controls input::placeholder {{ color: #888; }}
.work-log-empty {{
  color: #888;
  text-align: center;
  padding: 1.5rem;
  font-size: 0.9rem;
}}
.log-day {{
  margin-bottom: 0.5rem;
  border-radius: 8px;
  background: rgba(0,0,0,0.2);
  overflow: hidden;
}}
.log-day-header {{
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.8rem;
  cursor: pointer;
  color: #eee;
  font-size: 0.8rem;
}}
.log-day-header:hover {{ background: rgba(255,255,255,0.05); }}
.log-date {{ font-weight: bold; }}
.log-count {{ color: #aaa; font-size: 0.75rem; }}
.log-toggle {{ color: #f8d030; transition: transform 0.2s; }}
.log-day.expanded .log-toggle {{ transform: rotate(90deg); }}
.log-day-content {{
  display: none;
  padding: 0 0.8rem 0.6rem;
}}
.log-day.expanded .log-day-content {{ display: block; }}
.log-entry {{
  display: flex;
  gap: 0.6rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 0.75rem;
  color: #ccc;
}}
.log-entry:last-child {{ border-bottom: none; }}
.log-agent {{
  color: #f8d030;
  font-weight: bold;
  white-space: nowrap;
  min-width: 100px;
}}
.log-day.hidden {{ display: none; }}

@media (max-width: 700px) {{
  .grid {{ grid-template-columns: 1fr; }}
  header h1 {{ font-size: 1.5rem; }}
  .pokemon-card {{ border-width: 7px; }}
}}
</style>
</head>
<body>
<header>
  <h1>⚡ 呱集團 Pokémon Agent Dashboard</h1>
  <p class="subtitle">最後更新：{now}</p>
</header>
<div class="fleet-bar">
  <span class="pill">🟢 活躍 <strong>{active_count}</strong></span>
  <span class="pill">🟡 待命 <strong>{idle_count}</strong></span>
  <span class="pill">🔴 停止 <strong>{fainted_count}</strong></span>
  <span class="pill">📦 總計 <strong>{len(agents)}</strong></span>
</div>
<details class="shared-rules">
  <summary>📜 Fleet 共用規範（點擊展開）</summary>
  <div class="shared-rules-content">
    <div class="rule-group">
      <h4>📨 訊息格式</h4>
      <ul>
        <li>[user:name] — 來自 Telegram 使用者 → 用 reply 工具回覆</li>
        <li>[from:instance-name] — 來自其他 agent → 用 send_to_instance 回覆</li>
      </ul>
    </div>
    <div class="rule-group">
      <h4>🤝 協作規則</h4>
      <ul>
        <li>Task flow: delegate_task → 安靜工作 → report_result（中間零訊息）</li>
        <li>直接跟對方 instance 通訊，不透過中間人轉發</li>
        <li>Silence = working：不發確認訊息（got it / 收到）</li>
        <li>Silence = agreement：沒意見就不回覆</li>
        <li>把所有 feedback 合併成一則訊息發送</li>
      </ul>
    </div>
    <div class="rule-group">
      <h4>🧠 Shared Decisions</h4>
      <ul>
        <li>Context rotation 後跑 list_decisions 重新載入決策</li>
        <li>用 post_decision 分享影響其他 instance 的決定</li>
      </ul>
    </div>
    <div class="rule-group">
      <h4>🛡️ Context Protection</h4>
      <ul>
        <li>大範圍搜尋用 subagent，不直接讀大量檔案</li>
        <li>大 codebase 用 glob/grep 精準定位</li>
        <li>長對話的決策摘要成 Shared Decisions</li>
      </ul>
    </div>
    <div class="rule-group">
      <h4>📋 Active Decisions</h4>
      <ul>
        <li>稱呼使用者 Sean 為「呱老大」</li>
        <li>Instance 間通訊使用英文</li>
        <li>Steering 設定檔是 skill 的主體</li>
      </ul>
    </div>
  </div>
</details>
<div class="work-log-section">
  <h2 class="work-log-title">📋 工作日誌</h2>
  <div class="work-log-controls">
    <input type="text" id="logSearch" placeholder="搜尋 agent 或內容..." oninput="filterLog()" />
  </div>
  <div class="work-log-entries" id="logEntries">
    {generate_work_log_html(work_log or [])}
  </div>
</div>
<div class="grid">
{cards_html}
</div>
<footer>regenerate: <code>python3 generate.py && git add -A && git commit -m "update" && git push</code></footer>
<script>
function filterLog() {{
  const q = document.getElementById('logSearch').value.toLowerCase();
  document.querySelectorAll('.log-day').forEach(day => {{
    if (!q) {{ day.classList.remove('hidden'); return; }}
    const text = day.textContent.toLowerCase();
    day.classList.toggle('hidden', !text.includes(q));
    if (text.includes(q)) day.classList.add('expanded');
  }});
}}
</script>
</body>
</html>'''


def get_work_log():
    log_path = Path(__file__).parent / "work_log.json"
    if log_path.exists():
        return json.loads(log_path.read_text(encoding="utf-8"))
    return []


def generate_work_log_html(work_log):
    if not work_log:
        return '''<div class="work-log-empty">📭 尚無工作日誌紀錄</div>'''

    entries_html = ""
    for i, day in enumerate(work_log):
        date = day["date"]
        reports = ""
        for entry in day.get("entries", []):
            reports += f'''<div class="log-entry">
              <span class="log-agent">{entry["agent"]}</span>
              <span class="log-report">{entry["report"]}</span>
            </div>'''
        expanded = " expanded" if i == 0 else ""
        entries_html += f'''
        <div class="log-day{expanded}" data-date="{date}">
          <div class="log-day-header" onclick="this.parentElement.classList.toggle('expanded')">
            <span class="log-date">📅 {date}</span>
            <span class="log-count">{len(day.get("entries", []))} 筆報告</span>
            <span class="log-toggle">▸</span>
          </div>
          <div class="log-day-content">{reports}</div>
        </div>'''

    return entries_html


def main():
    agents = get_fleet_data()
    work_log = get_work_log()
    html = generate_html(agents, work_log)
    out = Path(__file__).parent / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"✅ Dashboard generated: {out}")


if __name__ == "__main__":
    main()

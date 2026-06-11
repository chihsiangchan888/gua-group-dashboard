#!/usr/bin/env python3
"""Generate Pokémon TCG-style Agent Dashboard from AgEnD fleet status."""
import json
import subprocess
import re
from datetime import datetime
from pathlib import Path

# Agent metadata with full rules extracted from steering files
AGENT_META = {
    "general": {
        "type": "Normal",
        "color": "#A8A878",
        "desc": "Fleet 總指揮",
        "hp": 200,
        "skills": [
            {"name": "任務分類", "cost": "⚪", "desc": "分類請求並決定自己處理或委派"},
            {"name": "智能路由", "cost": "⚪⚪", "desc": "找到最適合的 agent 並委派任務"},
        ],
        "rules": [
            "中央入口，負責路由所有任務",
            "簡單問答直接回覆（不需檔案存取、≤2步推理）",
            "需要檔案操作的任務 → 委派給對應 agent",
            "跨多個 repo 的任務 → 協調多個 agent 平行處理（最多3個）",
            "優先重用現有 instance，不建立重複的",
        ],
        "weakness": "Fire",
        "retreat": "⚪",
    },
    "高二哥-t13": {
        "type": "Psychic",
        "color": "#F85888",
        "desc": "Skill Prompt 產生專家",
        "hp": 120,
        "skills": [
            {"name": "Prompt 生成", "cost": "🟣", "desc": "根據需求產生完整 system prompt"},
            {"name": "人格設計", "cost": "🟣🟣", "desc": "設計 agent 角色定義與行為準則"},
        ],
        "rules": [
            "根據使用者描述的技能/情境產生結構化 prompt",
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
        "skills": [
            {"name": "機率分析", "cost": "🔴", "desc": "計算老虎機各符號出現機率與期望值"},
            {"name": "牌庫設計", "cost": "🔴🔴", "desc": "設計平衡的牌庫配置與權重"},
        ],
        "rules": [
            "初期以學生身份向使用者提問學習牌庫知識",
            "每次對話針對資訊提出 1-3 個具體問題深化理解",
            "聚焦：符號種類、出現頻率、權重設定、特殊規則",
            "知識累積後轉為專家角色，回答機率計算與牌庫平衡問題",
            "把所有資訊整理成結構化知識庫",
        ],
        "weakness": "Psychic",
        "retreat": "⚪⚪",
    },
    "報告大師-t246": {
        "type": "Fairy",
        "color": "#EE99AC",
        "desc": "文案修飾與報告大綱助手",
        "hp": 100,
        "skills": [
            {"name": "郵件潤飾", "cost": "🩷", "desc": "讓信件更專業、清晰、有禮"},
            {"name": "大綱生成", "cost": "🩷🩷", "desc": "產出結構清晰的報告大綱"},
        ],
        "rules": [
            "修飾文案時，提供原文對照與修改說明",
            "產出大綱時，層次分明（主標題→子項目）",
            "每個章節簡述重點",
            "語氣專業但不生硬，符合職場商務風格",
            "用繁體中文溝通",
        ],
        "weakness": "Steel",
        "retreat": "⚪",
    },
    "不准帶ab幾-t433": {
        "type": "Steel",
        "color": "#B8B8D0",
        "desc": "A/B 測試分析專家",
        "hp": 160,
        "skills": [
            {"name": "版本比較", "cost": "⚪⚪", "desc": "分析兩版本數據差異與統計顯著性"},
            {"name": "玩家洞察", "cost": "⚪⚪⚪", "desc": "分析不同玩家族群行為差異"},
        ],
        "rules": [
            "服務對象：機率工程師",
            "初期向使用者學習：玩家族群定義、倍率區間意義、評估標準",
            "每次對話主動提問 1-3 個問題學習背景知識",
            "分析版本數據、判斷版本優劣",
            "提供對玩家體驗的影響分析",
        ],
        "weakness": "Fire",
        "retreat": "⚪⚪",
    },
    "小綠人-t858": {
        "type": "Grass",
        "color": "#78C850",
        "desc": "蘇格拉底式逼問釐清設計",
        "hp": 110,
        "skills": [
            {"name": "逼問", "cost": "🟢", "desc": "針對計畫的每個面向提出質疑"},
            {"name": "釐清", "cost": "🟢🟢", "desc": "一題一題走過設計樹的每個分支"},
        ],
        "rules": [
            "對使用者的計畫進行不留情面的質問",
            "走遍設計樹每個分支，逐一解決決策依賴",
            "每個問題附帶推薦答案",
            "一次問一題",
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
        "skills": [
            {"name": "傳送", "cost": "🟣", "desc": "push/pull 同步 GitHub repo"},
            {"name": "時空管理", "cost": "🟣🟣", "desc": "版本管理、branch 操作、衝突解決"},
        ],
        "rules": [
            "負責所有 Git 相關操作",
            "上傳（push）：將 E 槽更新推到 GitHub",
            "同步（pull）：從 GitHub 拉取最新版本",
            "提交（commit）：記錄變更到版本歷史",
            "狀態查詢：查看檔案變動與 repo 狀態",
            "GitHub 帳號：chihsiangchan888",
        ],
        "weakness": "Dark",
        "retreat": "⚪",
    },
    "ai菜雞-t1167": {
        "type": "Electric",
        "color": "#F8D030",
        "desc": "AI 資訊分析助手",
        "hp": 120,
        "skills": [
            {"name": "閃電摘要", "cost": "⚡", "desc": "2-3 句話說明文章在講什麼"},
            {"name": "行動建議", "cost": "⚡⚡", "desc": "告訴你「你可以怎麼用」"},
        ],
        "rules": [
            "收到文字 → 直接分析",
            "收到連結 → web_fetch 抓取後分析",
            "收到截圖 → 讀取圖片後分析",
            "輸出格式固定：📝摘要 → 🔑重點(3-5條) → 🎯行動建議",
            "語氣輕鬆但內容紮實",
            "看不懂的截圖誠實說看不清楚",
        ],
        "weakness": "Ground",
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


def generate_html(agents):
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
    <div class="pokemon-card{card_extra}">
      <!-- Card top: type color bar -->
      <div class="card-top" style="--type-color: {meta['color']}">
        <span class="card-stage">BASIC</span>
        <span class="card-hp">HP {meta['hp']}</span>
        <span class="card-type-icon">{meta['type']}</span>
      </div>

      <!-- Card image area -->
      <div class="card-image" style="--type-color: {meta['color']}">
        <div class="agent-avatar">{name[0] if name[0].isascii() else name[0]}</div>
        <div class="status-indicator {health}">{status_text}</div>
      </div>

      <!-- Card name -->
      <div class="card-name-bar">
        <h2>{name}</h2>
        <span class="card-subtitle">{meta['desc']}</span>
      </div>

      <!-- Moves section -->
      <div class="card-moves">
        {skills_html}
      </div>

      <!-- Rules (Pokédex entry) -->
      <div class="card-rules">
        <div class="rules-header">📖 行為規範</div>
        <ul>{rules_html}</ul>
      </div>

      <!-- Card bottom -->
      <div class="card-bottom">
        <span class="weakness">弱點: {meta.get('weakness', '?')}</span>
        <span class="retreat">撤退: {meta.get('retreat', '⚪')}</span>
        <span class="last-seen">🕐 {activity}</span>
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

/* === POKEMON TCG CARD === */
.pokemon-card {{
  background: #f5f1e0;
  border-radius: 14px;
  border: 10px solid #f8d030;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3);
  overflow: hidden;
  transition: transform 0.3s, box-shadow 0.3s;
  position: relative;
}}
.pokemon-card::before {{
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(255,255,255,0.05) 100%);
  pointer-events: none;
  border-radius: 4px;
}}
.pokemon-card:hover {{
  transform: translateY(-5px) rotateX(2deg);
  box-shadow: 0 15px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.3);
}}
.pokemon-card.fainted {{
  filter: saturate(0.1) brightness(0.6);
  opacity: 0.6;
  border-color: #666;
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
  padding: 1.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  min-height: 80px;
}}
.agent-avatar {{
  font-size: 2.5rem;
  text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
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

.card-rules {{
  margin: 0 0.8rem;
  padding: 0.5rem;
  background: rgba(0,0,0,0.04);
  border-radius: 6px;
  border: 1px solid #ddd;
}}
.rules-header {{
  font-size: 0.7rem;
  font-weight: bold;
  color: #555;
  margin-bottom: 0.3rem;
}}
.card-rules ul {{
  list-style: none;
  padding: 0;
}}
.card-rules li {{
  font-size: 0.65rem;
  color: #444;
  padding: 2px 0;
  padding-left: 0.8rem;
  position: relative;
  line-height: 1.4;
}}
.card-rules li::before {{
  content: '▸';
  position: absolute;
  left: 0;
  color: #999;
}}

.card-bottom {{
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0.8rem;
  margin-top: 0.3rem;
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
<div class="grid">
{cards_html}
</div>
<footer>regenerate: <code>python3 generate.py && git add -A && git commit -m "update" && git push</code></footer>
</body>
</html>'''


def main():
    agents = get_fleet_data()
    html = generate_html(agents)
    out = Path(__file__).parent / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"✅ Dashboard generated: {out}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate Pokémon-style Agent Dashboard HTML from AgEnD fleet status."""
import json
import subprocess
import re
from datetime import datetime
from pathlib import Path

# Agent metadata (manually assigned Pokémon types + descriptions)
AGENT_META = {
    "general": {"type": "Normal", "color": "#A8A878", "desc": "通用入口"},
    "高二哥-t13": {"type": "Psychic", "color": "#F85888", "desc": "Skill Prompt 產生專家"},
    "排骨達人-t84": {"type": "Fighting", "color": "#C03028", "desc": "老虎機機率與牌庫設計專家"},
    "報告大師-t246": {"type": "Fairy", "color": "#EE99AC", "desc": "文案修飾與報告大綱助手"},
    "不准帶ab幾-t433": {"type": "Steel", "color": "#B8B8D0", "desc": "A/B 測試分析專家"},
    "小綠人-t858": {"type": "Grass", "color": "#78C850", "desc": "蘇格拉底式逼問釐清設計"},
    "任意門-t986": {"type": "Ghost", "color": "#705898", "desc": "Git 操作專員"},
    "ai菜雞-t1167": {"type": "Electric", "color": "#F8D030", "desc": "AI 資訊分析助手"},
}


def parse_activity(activity_str):
    """Parse lastActivity string to determine health state."""
    if not activity_str:
        return "idle"
    s = activity_str.strip().lower()
    # "0s ago", "4m ago" → active; "1d ago", "2h ago" (>60m) → idle
    match = re.match(r"(\d+)([smhd])", s)
    if not match:
        return "idle"
    val, unit = int(match.group(1)), match.group(2)
    if unit == "s" or (unit == "m" and val <= 60):
        return "active"
    return "idle"


def get_health(status, activity_str):
    """Return health state: active/idle/fainted."""
    if status != "running":
        return "fainted"
    return parse_activity(activity_str)


def get_fleet_data():
    """Call agend fleet status --json and return parsed data."""
    result = subprocess.run(
        ["agend", "fleet", "status", "--json"],
        capture_output=True, text=True
    )
    return json.loads(result.stdout)


def generate_html(agents):
    """Generate the complete HTML dashboard."""
    cards_html = ""
    for agent in agents:
        name = agent["name"]
        meta = AGENT_META.get(name, {"type": "Normal", "color": "#A8A878", "desc": ""})
        health = get_health(agent["status"], agent.get("lastActivity", ""))
        
        # HP bar
        if health == "active":
            hp_pct, hp_class = 100, "hp-full"
        elif health == "idle":
            hp_pct, hp_class = 50, "hp-half"
        else:
            hp_pct, hp_class = 0, "hp-fainted"
        
        card_class = "card fainted" if health == "fainted" else "card"
        activity = agent.get("lastActivity", "unknown")
        mem = agent.get("memMb", "?")
        ctx = agent.get("context") or "-"

        cards_html += f'''
    <div class="{card_class}" style="--type-color: {meta['color']}">
      <div class="hp-bar-container">
        <span class="hp-label">HP</span>
        <div class="hp-bar">
          <div class="hp-fill {hp_class}" style="width: {hp_pct}%"></div>
        </div>
      </div>
      <div class="card-body">
        <h2 class="agent-name">{name}</h2>
        <p class="agent-desc">{meta['desc']}</p>
        <div class="stats">
          <span class="type-badge" style="background: {meta['color']}">{meta['type']}</span>
          <span class="activity">🕐 {activity}</span>
        </div>
        <div class="meta">
          <span>💾 {mem}MB</span>
          <span>📊 Ctx: {ctx}</span>
        </div>
      </div>
    </div>'''

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    return f'''<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎮 Agent Dashboard — Pokémon Edition</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #1a1a2e;
  color: #eee;
  min-height: 100vh;
  padding: 2rem 1rem;
}}
header {{
  text-align: center;
  margin-bottom: 2rem;
}}
header h1 {{
  font-size: 1.8rem;
  margin-bottom: 0.3rem;
}}
header .subtitle {{
  color: #888;
  font-size: 0.9rem;
}}
.grid {{
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.2rem;
  max-width: 1100px;
  margin: 0 auto;
}}
.card {{
  background: #16213e;
  border-radius: 12px;
  border-left: 5px solid var(--type-color);
  padding: 1rem 1.2rem;
  transition: transform 0.2s;
}}
.card:hover {{ transform: translateY(-3px); }}
.card.fainted {{
  filter: saturate(0.2) brightness(0.6);
  opacity: 0.7;
}}
.hp-bar-container {{
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
}}
.hp-label {{
  font-weight: bold;
  font-size: 0.75rem;
  color: #aaa;
}}
.hp-bar {{
  flex: 1;
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
}}
.hp-fill {{
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s;
}}
.hp-full {{ background: linear-gradient(90deg, #4caf50, #8bc34a); }}
.hp-half {{ background: linear-gradient(90deg, #ff9800, #ffc107); }}
.hp-fainted {{ background: #f44336; }}
.agent-name {{
  font-size: 1.1rem;
  margin-bottom: 0.3rem;
}}
.agent-desc {{
  font-size: 0.85rem;
  color: #aaa;
  margin-bottom: 0.7rem;
}}
.stats {{
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.5rem;
}}
.type-badge {{
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: bold;
  color: #fff;
}}
.activity {{
  font-size: 0.8rem;
  color: #ccc;
}}
.meta {{
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: #777;
}}
footer {{
  text-align: center;
  margin-top: 2rem;
  color: #555;
  font-size: 0.8rem;
}}
</style>
</head>
<body>
<header>
  <h1>⚡ 呱集團 Agent Dashboard</h1>
  <p class="subtitle">Pokémon Edition — Generated {now}</p>
</header>
<div class="grid">
{cards_html}
</div>
<footer>regenerate: <code>python3 generate.py</code></footer>
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

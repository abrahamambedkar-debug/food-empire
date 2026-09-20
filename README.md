# 🍔 Food Empire

A 2D top-down restaurant management game built with **Phaser.js 3.6**.

**[🎮 Play Now](https://01a0be46-e56c-761a-b275-92fd91d47454.arena.site/)** | **[📖 Docs](#)** | **[🐛 Report Bug](https://github.com/abrahamambedkar-debug/food-empire/issues)**

---

## 📖 About

Food Empire is a fast-paced restaurant simulation where you play as a chef running a busy diner. Cook 6 different dishes, serve hungry customers before they storm out, hire NPC workers to help, battle rival chefs in arena mode, and upgrade your restaurant to become the ultimate food empire.

Built entirely with **vanilla JavaScript** and **Phaser.js** — no frameworks, no build tools, no external assets. Every visual is drawn with code.

---

## 🎮 Features

### Core Gameplay
- **6 Food Stations** — Biryani, Taco, Noodles, Sandwich, Burger, Coffee
- **Cooking System** — 3-second progress bar with real-time feedback
- **Customer System** — Customers spawn, order, wait, and pay
- **Serving** — Match dishes to orders for money + reputation
- **Money & Reputation** — Earn cash, keep your rep alive
- **Game Over** — Reputation hits zero = diner closes

### Advanced Features
- **NPC Worker** (Press H) — Hire a chef who auto-cooks and serves
- **Arena Battle** (Press B) — 1v1 vs Rival AI with judge scoring
- **Upgrade Menu** (Press U) — Speed, Fast Cooking, Patience, Extra Table
- **Save/Load** — Auto-save every 30 seconds to localStorage
- **Sound Effects** — WebAudio synthesized (no audio files)
- **Particle Effects** — Steam, sparkles, floating text

### Platform Support
- **Desktop** — WASD + Arrow keys, E to interact
- **Mobile** — Virtual joystick + Action button
- **Responsive** — Phaser Scale.FIT for any screen

---

## 🕹️ How to Play

| Key | Action |
|-----|--------|
| **WASD / Arrows** | Move chef |
| **E / Space** | Interact (cook, pick up, serve, toss) |
| **H** | Hire NPC worker ($2000) |
| **B** | Enter Arena Battle |
| **U** | Open Upgrade Menu |
| **R** | Restart (on game over) |

### Gameplay Loop
1. **Cook** — Stand at the green grill, press E (3s bar)
2. **Pick Up** — Press E again when READY
3. **Serve** — Carry dish to a waiting customer, press E
4. **Earn** — Money + reputation for correct serves
5. **Upgrade** — Spend money on speed, cooking, patience
6. **Battle** — Press B to fight rival chefs in arena
7. **Hire** — Press H to get an NPC helper

---

## 🍽️ Food Menu

| Dish | Emoji | Price | Cook Time |
|------|-------|-------|-----------|
| Burger | 🍔 | $10 | 1.5s |
| Pizza | 🍕 | $14 | 2.5s |
| Fries | 🍟 | $8 | 1.0s |
| Taco | 🌮 | $12 | 1.2s |
| Sushi | 🍣 | $18 | 3.0s |
| Soda | 🥤 | $6 | 0.5s |

---

## 🚀 Upgrades

| Upgrade | Cost | Effect |
|---------|------|--------|
| Speed Boost | $500 | +30% movement |
| Fast Cooking | $800 | 1.5s cook time |
| More Patience | $600 | 45s wait time |
| Extra Table | $1000 | 5th table |

---

## 🛠️ Tech Stack

- **Phaser.js 3.6** — Game engine (CDN)
- **Vanilla JavaScript** — No frameworks
- **HTML5 Canvas** — Rendering
- **WebAudio API** — Sound synthesis
- **localStorage** — Save system
- **No external assets** — Every visual is drawn with code

---

## 📦 Installation

### Option 1: Play Online
**[🎮 Play Now](https://01a0be46-e56c-761a-b275-92fd91d47454.arena.site/)**

### Option 2: Local Development
```bash
git clone https://github.com/abrahamambedkar-debug/food-empire.git
cd food-empire
# Open index.html in browser
# OR use a local server:
python -m http.server 8000

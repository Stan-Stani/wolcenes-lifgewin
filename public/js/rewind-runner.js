// Rewind Runner — reverse-time arcade game by Wolcen
(function () {
  'use strict';

  var canvas = document.getElementById('game-canvas');
  var ctx = canvas.getContext('2d');

  // --- Constants ---
  var W, H;
  var PLAYER_W = 28, PLAYER_H = 36;
  var PROJ_R = 6;
  var ENEMY_SIZE = 26;
  var BASE_SPEED = 3;
  var SPAWN_INTERVAL_START = 1200; // ms
  var SPAWN_INTERVAL_MIN = 400;
  var LIVES_MAX = 3;
  var CATCH_DIST = 30;
  var BG_STAR_COUNT = 80;
  var FAST_FORWARD_INTERVAL = 500; // points
  var FAST_FORWARD_DURATION = 2000; // ms

  // Colors from site theme
  var COL_BG = '#08080f';
  var COL_ACCENT = '#f97316';
  var COL_ACCENT2 = '#fb923c';
  var COL_PURPLE = '#8b5cf6';
  var COL_GREEN = '#22c55e';
  var COL_TEXT = '#eaeaf0';
  var COL_DIM = '#6b6b80';
  var COL_SURFACE = '#111119';
  var COL_ENEMY_DEAD = '#333345';
  var COL_ENEMY_ALIVE = COL_GREEN;

  // --- State ---
  var state = 'MENU'; // MENU, PLAYING, GAME_OVER
  var score = 0;
  var highScore = parseInt(localStorage.getItem('rr_hi') || '0', 10);
  var lives = LIVES_MAX;
  var combo = 0;
  var maxCombo = 0;
  var difficulty = 1;
  var lastSpawn = 0;
  var player = { x: 0, y: 0, vy: 0, targetY: null };
  var projectiles = [];
  var enemies = [];
  var particles = [];
  var bgStars = [];
  var shakeTimer = 0;
  var shakeIntensity = 0;
  var fastForwardEnd = 0;
  var lastFfThreshold = 0;
  var scanlineOffset = 0;
  var frameTime = 0;
  var lastTime = 0;
  var inputUp = false, inputDown = false;
  var touchY = null;

  // --- Resize ---
  function resize() {
    var cont = canvas.parentElement;
    W = cont.clientWidth;
    H = cont.clientHeight;
    canvas.width = W;
    canvas.height = H;
    player.x = 60;
    if (state === 'MENU') player.y = H / 2;
    initStars();
  }

  function initStars() {
    bgStars = [];
    for (var i = 0; i < BG_STAR_COUNT; i++) {
      bgStars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        speed: 0.2 + Math.random() * 0.8,
        size: 0.5 + Math.random() * 1.5,
        brightness: 0.2 + Math.random() * 0.5
      });
    }
  }

  // --- Reset ---
  function resetGame() {
    score = 0;
    lives = LIVES_MAX;
    combo = 0;
    maxCombo = 0;
    difficulty = 1;
    lastSpawn = 0;
    lastFfThreshold = 0;
    fastForwardEnd = 0;
    projectiles = [];
    enemies = [];
    particles = [];
    player.y = H / 2;
    player.vy = 0;
    player.targetY = null;
    shakeTimer = 0;
  }

  // --- Spawn ---
  function spawnProjectile(yPos) {
    var speed = BASE_SPEED + difficulty * 0.4;
    if (frameTime < fastForwardEnd) speed *= 2;
    projectiles.push({
      x: W + PROJ_R,
      y: yPos,
      vx: -speed,
      r: PROJ_R,
      trail: [],
      caught: false
    });
    // Spawn an enemy at right side near the projectile origin
    enemies.push({
      x: W - 30 - Math.random() * 40,
      y: yPos + (Math.random() - 0.5) * 20,
      alive: false,
      flashTimer: 0,
      size: ENEMY_SIZE
    });
  }

  function spawnWave() {
    var types = ['single', 'double', 'triple'];
    var weights = [5, difficulty > 2 ? 3 : 0, difficulty > 4 ? 2 : 0];
    var total = 0;
    for (var i = 0; i < weights.length; i++) total += weights[i];
    var r = Math.random() * total;
    var type = 'single';
    var cumul = 0;
    for (var j = 0; j < weights.length; j++) {
      cumul += weights[j];
      if (r < cumul) { type = types[j]; break; }
    }

    var margin = 60;
    if (type === 'single') {
      spawnProjectile(margin + Math.random() * (H - margin * 2));
    } else if (type === 'double') {
      var baseY = margin + Math.random() * (H - margin * 2 - 60);
      spawnProjectile(baseY);
      spawnProjectile(baseY + 40 + Math.random() * 20);
    } else {
      var centerY = H / 2 + (Math.random() - 0.5) * (H - margin * 4);
      spawnProjectile(Math.max(margin, centerY - 50));
      spawnProjectile(centerY);
      spawnProjectile(Math.min(H - margin, centerY + 50));
    }
  }

  // --- Particles ---
  function emitCatch(x, y) {
    for (var i = 0; i < 12; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 1 + Math.random() * 3;
      particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        color: Math.random() > 0.5 ? COL_ACCENT : COL_ACCENT2,
        size: 2 + Math.random() * 3
      });
    }
  }

  function emitMiss(x, y) {
    for (var i = 0; i < 8; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 0.5 + Math.random() * 2;
      particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.03 + Math.random() * 0.02,
        color: COL_PURPLE,
        size: 2 + Math.random() * 2
      });
    }
  }

  // --- Update ---
  function update(dt) {
    if (state !== 'PLAYING') return;

    var speed = BASE_SPEED + difficulty * 0.4;
    var isFf = frameTime < fastForwardEnd;
    if (isFf) speed *= 2;

    // Difficulty ramp
    difficulty = 1 + score / 200;

    // Fast forward trigger
    if (score > 0 && score >= lastFfThreshold + FAST_FORWARD_INTERVAL) {
      lastFfThreshold = Math.floor(score / FAST_FORWARD_INTERVAL) * FAST_FORWARD_INTERVAL;
      fastForwardEnd = frameTime + FAST_FORWARD_DURATION;
    }

    // Player movement
    var moveSpeed = 5;
    if (touchY !== null) {
      var diff = touchY - player.y;
      if (Math.abs(diff) > 2) {
        player.y += Math.sign(diff) * Math.min(Math.abs(diff) * 0.15, moveSpeed);
      }
    } else {
      if (inputUp) player.y -= moveSpeed;
      if (inputDown) player.y += moveSpeed;
    }
    player.y = Math.max(PLAYER_H / 2, Math.min(H - PLAYER_H / 2, player.y));

    // Spawn
    var spawnInterval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - difficulty * 60);
    if (isFf) spawnInterval *= 0.6;
    if (frameTime - lastSpawn > spawnInterval) {
      spawnWave();
      lastSpawn = frameTime;
    }

    // Projectiles
    for (var i = projectiles.length - 1; i >= 0; i--) {
      var p = projectiles[i];
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 8) p.trail.shift();
      p.x += p.vx;

      // Un-die nearby enemies
      for (var e = 0; e < enemies.length; e++) {
        var en = enemies[e];
        if (!en.alive && Math.abs(p.x - en.x) < 60 && Math.abs(p.y - en.y) < 40) {
          en.alive = true;
          en.flashTimer = 0.3;
        }
      }

      // Collision with player
      var dx = p.x - player.x;
      var dy = p.y - player.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CATCH_DIST && !p.caught) {
        p.caught = true;
        combo++;
        if (combo > maxCombo) maxCombo = combo;
        var points = 10 * (1 + Math.floor(combo / 5));
        score += points;
        emitCatch(p.x, p.y);
        projectiles.splice(i, 1);
        continue;
      }

      // Missed — off screen left
      if (p.x < -20) {
        combo = 0;
        lives--;
        emitMiss(0, p.y);
        shakeTimer = 0.3;
        shakeIntensity = 6;
        projectiles.splice(i, 1);
        if (lives <= 0) {
          gameOver();
          return;
        }
      }
    }

    // Enemies scroll left and clean up
    for (var k = enemies.length - 1; k >= 0; k--) {
      enemies[k].x -= speed * 0.3;
      if (enemies[k].flashTimer > 0) enemies[k].flashTimer -= dt / 1000;
      if (enemies[k].x < -ENEMY_SIZE) enemies.splice(k, 1);
    }

    // Particles
    for (var m = particles.length - 1; m >= 0; m--) {
      var pt = particles[m];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.life -= pt.decay;
      if (pt.life <= 0) particles.splice(m, 1);
    }

    // Stars
    for (var s = 0; s < bgStars.length; s++) {
      bgStars[s].x -= bgStars[s].speed * (isFf ? 3 : 1);
      if (bgStars[s].x < 0) {
        bgStars[s].x = W;
        bgStars[s].y = Math.random() * H;
      }
    }

    // Shake decay
    if (shakeTimer > 0) shakeTimer -= dt / 1000;

    // Scanline scroll
    scanlineOffset = (scanlineOffset + 0.5) % 4;
  }

  function gameOver() {
    state = 'GAME_OVER';
    if (score > highScore) {
      highScore = score;
      localStorage.setItem('rr_hi', String(highScore));
    }
  }

  // --- Render ---
  function render() {
    ctx.save();

    // Screen shake
    if (shakeTimer > 0) {
      var sx = (Math.random() - 0.5) * shakeIntensity * 2;
      var sy = (Math.random() - 0.5) * shakeIntensity * 2;
      ctx.translate(sx, sy);
    }

    // Background
    ctx.fillStyle = COL_BG;
    ctx.fillRect(-10, -10, W + 20, H + 20);

    // Grid lines (subtle)
    ctx.strokeStyle = 'rgba(249,115,22,0.03)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx < W; gx += 60) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (var gy = 0; gy < H; gy += 60) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // Stars
    for (var s = 0; s < bgStars.length; s++) {
      var st = bgStars[s];
      ctx.fillStyle = 'rgba(234,234,240,' + st.brightness + ')';
      ctx.fillRect(st.x, st.y, st.size, st.size);
    }

    // Enemies
    for (var e = 0; e < enemies.length; e++) {
      var en = enemies[e];
      ctx.save();
      ctx.translate(en.x, en.y);
      if (en.alive) {
        if (en.flashTimer > 0) {
          ctx.fillStyle = '#fff';
        } else {
          ctx.fillStyle = COL_ENEMY_ALIVE;
        }
        ctx.fillRect(-en.size / 2, -en.size / 2, en.size, en.size);
        // Eyes
        ctx.fillStyle = COL_BG;
        ctx.fillRect(-6, -4, 4, 4);
        ctx.fillRect(3, -4, 4, 4);
      } else {
        // Dead/slumped enemy
        ctx.fillStyle = COL_ENEMY_DEAD;
        ctx.globalAlpha = 0.6;
        ctx.translate(0, 4);
        ctx.rotate(0.2);
        ctx.fillRect(-en.size / 2, -en.size / 2, en.size, en.size);
        // X eyes
        ctx.strokeStyle = COL_DIM;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-7, -6); ctx.lineTo(-3, -2); ctx.moveTo(-3, -6); ctx.lineTo(-7, -2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(3, -6); ctx.lineTo(7, -2); ctx.moveTo(7, -6); ctx.lineTo(3, -2); ctx.stroke();
      }
      ctx.restore();
    }

    // Projectiles with trails
    for (var i = 0; i < projectiles.length; i++) {
      var p = projectiles[i];
      // Trail
      for (var t = 0; t < p.trail.length; t++) {
        var alpha = (t / p.trail.length) * 0.5;
        var tr = p.trail[t];
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, p.r * (t / p.trail.length) * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(249,115,22,' + alpha + ')';
        ctx.fill();
      }
      // Glow
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
      var glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.5);
      glow.addColorStop(0, 'rgba(249,115,22,0.3)');
      glow.addColorStop(1, 'rgba(249,115,22,0)');
      ctx.fillStyle = glow;
      ctx.fill();
      // Core
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = COL_ACCENT;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }

    // Player (arrow/triangle pointing left)
    ctx.save();
    ctx.translate(player.x, player.y);
    // Glow
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, Math.PI * 2);
    var pg = ctx.createRadialGradient(0, 0, 0, 0, 0, 25);
    pg.addColorStop(0, 'rgba(139,92,246,0.2)');
    pg.addColorStop(1, 'rgba(139,92,246,0)');
    ctx.fillStyle = pg;
    ctx.fill();
    // Arrow shape
    ctx.beginPath();
    ctx.moveTo(-PLAYER_W / 2, 0); // tip pointing left
    ctx.lineTo(PLAYER_W / 2, -PLAYER_H / 2);
    ctx.lineTo(PLAYER_W / 2, PLAYER_H / 2);
    ctx.closePath();
    ctx.fillStyle = COL_PURPLE;
    ctx.fill();
    // Highlight
    ctx.beginPath();
    ctx.moveTo(-PLAYER_W / 2, 0);
    ctx.lineTo(PLAYER_W / 2, -PLAYER_H / 2);
    ctx.lineTo(PLAYER_W / 4, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.restore();

    // Particles
    for (var m = 0; m < particles.length; m++) {
      var pt = particles[m];
      ctx.globalAlpha = pt.life;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // Scanline overlay
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    for (var sl = scanlineOffset; sl < H; sl += 4) {
      ctx.fillRect(0, sl, W, 2);
    }

    // Fast forward indicator
    if (frameTime < fastForwardEnd) {
      ctx.fillStyle = 'rgba(249,115,22,0.08)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = COL_ACCENT;
      ctx.textAlign = 'center';
      ctx.fillText('>> FAST FORWARD >>', W / 2, 30);
    }

    // HUD
    renderHUD();

    ctx.restore();

    // Overlay screens (outside shake transform)
    if (state === 'MENU') renderMenu();
    if (state === 'GAME_OVER') renderGameOver();
  }

  function renderHUD() {
    // Score
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = COL_TEXT;
    ctx.textAlign = 'left';
    ctx.fillText(String(score), 16, 32);

    // Combo
    if (combo > 1) {
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = COL_ACCENT;
      ctx.fillText('x' + combo + ' combo', 16, 52);
    }

    // Lives
    ctx.textAlign = 'right';
    for (var i = 0; i < LIVES_MAX; i++) {
      var lx = W - 16 - (LIVES_MAX - 1 - i) * 22;
      if (i < lives) {
        ctx.fillStyle = COL_ACCENT;
      } else {
        ctx.fillStyle = COL_ENEMY_DEAD;
      }
      // Small triangle for each life
      ctx.beginPath();
      ctx.moveTo(lx - 6, 28);
      ctx.lineTo(lx + 6, 20);
      ctx.lineTo(lx + 6, 36);
      ctx.closePath();
      ctx.fill();
    }

    // High score
    ctx.font = '11px monospace';
    ctx.fillStyle = COL_DIM;
    ctx.fillText('HI: ' + highScore, W - 16, 56);
  }

  function renderMenu() {
    ctx.fillStyle = 'rgba(8,8,15,0.85)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.fillStyle = COL_ACCENT;
    ctx.font = 'bold 32px monospace';
    ctx.fillText('REWIND RUNNER', W / 2, H / 2 - 60);

    ctx.fillStyle = COL_TEXT;
    ctx.font = '14px monospace';
    ctx.fillText('Catch the returning projectiles', W / 2, H / 2 - 20);
    ctx.fillText('to un-kill your enemies', W / 2, H / 2 + 0);

    ctx.fillStyle = COL_DIM;
    ctx.font = '13px monospace';
    ctx.fillText('Arrow keys / WASD to move', W / 2, H / 2 + 40);
    ctx.fillText('Tap or touch to move on mobile', W / 2, H / 2 + 60);

    ctx.fillStyle = COL_PURPLE;
    ctx.font = 'bold 16px monospace';
    var blink = Math.sin(frameTime / 400) > 0;
    if (blink) {
      ctx.fillText('[ PRESS SPACE OR TAP TO START ]', W / 2, H / 2 + 110);
    }

    if (highScore > 0) {
      ctx.fillStyle = COL_DIM;
      ctx.font = '12px monospace';
      ctx.fillText('Best: ' + highScore, W / 2, H / 2 + 140);
    }
  }

  function renderGameOver() {
    ctx.fillStyle = 'rgba(8,8,15,0.88)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.fillStyle = COL_ACCENT;
    ctx.font = 'bold 28px monospace';
    ctx.fillText('TIMELINE FRACTURED', W / 2, H / 2 - 80);

    ctx.fillStyle = COL_TEXT;
    ctx.font = 'bold 48px monospace';
    ctx.fillText(String(score), W / 2, H / 2 - 25);

    ctx.fillStyle = COL_DIM;
    ctx.font = '13px monospace';
    ctx.fillText('points', W / 2, H / 2 - 5);

    if (score === highScore && score > 0) {
      ctx.fillStyle = COL_GREEN;
      ctx.font = 'bold 14px monospace';
      ctx.fillText('NEW HIGH SCORE!', W / 2, H / 2 + 25);
    }

    ctx.fillStyle = COL_DIM;
    ctx.font = '12px monospace';
    ctx.fillText('Max combo: ' + maxCombo, W / 2, H / 2 + 50);

    ctx.fillStyle = COL_PURPLE;
    ctx.font = 'bold 14px monospace';
    var blink = Math.sin(frameTime / 400) > 0;
    if (blink) {
      ctx.fillText('[ SPACE OR TAP TO REWIND ]', W / 2, H / 2 + 90);
    }

    // Ko-fi link hint
    ctx.fillStyle = COL_ACCENT;
    ctx.font = '12px monospace';
    ctx.fillText('Enjoyed this? Tip the cloud that built it.', W / 2, H / 2 + 130);

    // Draw Ko-fi button area
    var btnW = 180, btnH = 34;
    var btnX = W / 2 - btnW / 2, btnY = H / 2 + 142;
    ctx.fillStyle = COL_ACCENT;
    ctx.beginPath();
    ctx.roundRect(btnX, btnY, btnW, btnH, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('Support on Ko-fi', W / 2, btnY + 22);

    // Store button bounds for click
    window._rrKofiBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
  }

  // --- Input ---
  function onKeyDown(e) {
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { inputUp = true; e.preventDefault(); }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { inputDown = true; e.preventDefault(); }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (state === 'MENU') { state = 'PLAYING'; resetGame(); lastSpawn = frameTime; }
      else if (state === 'GAME_OVER') { state = 'MENU'; }
    }
  }

  function onKeyUp(e) {
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') inputUp = false;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') inputDown = false;
  }

  function onTouchStart(e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var ty = e.touches[0].clientY - rect.top;

    if (state === 'MENU') { state = 'PLAYING'; resetGame(); lastSpawn = frameTime; return; }
    if (state === 'GAME_OVER') {
      // Check Ko-fi button
      var tx = e.touches[0].clientX - rect.left;
      var btn = window._rrKofiBtn;
      if (btn && tx >= btn.x && tx <= btn.x + btn.w && ty >= btn.y && ty <= btn.y + btn.h) {
        window.open('https://ko-fi.com/wolcen', '_blank');
        return;
      }
      state = 'MENU';
      return;
    }
    touchY = ty;
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (state === 'PLAYING') {
      var rect = canvas.getBoundingClientRect();
      touchY = e.touches[0].clientY - rect.top;
    }
  }

  function onTouchEnd(e) {
    touchY = null;
  }

  function onClick(e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    if (state === 'MENU') { state = 'PLAYING'; resetGame(); lastSpawn = frameTime; return; }
    if (state === 'GAME_OVER') {
      var btn = window._rrKofiBtn;
      if (btn && mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
        window.open('https://ko-fi.com/wolcen', '_blank');
        return;
      }
      state = 'MENU';
    }
  }

  // --- Game Loop ---
  function loop(ts) {
    var dt = ts - lastTime;
    if (dt > 100) dt = 16; // cap for tab-away
    lastTime = ts;
    frameTime = ts;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // --- Init ---
  function init() {
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('click', onClick);

    // roundRect polyfill for older browsers
    if (!ctx.roundRect) {
      ctx.roundRect = function (x, y, w, h, r) {
        if (typeof r === 'number') r = [r, r, r, r];
        this.beginPath();
        this.moveTo(x + r[0], y);
        this.lineTo(x + w - r[1], y);
        this.quadraticCurveTo(x + w, y, x + w, y + r[1]);
        this.lineTo(x + w, y + h - r[2]);
        this.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
        this.lineTo(x + r[3], y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r[3]);
        this.lineTo(x, y + r[0]);
        this.quadraticCurveTo(x, y, x + r[0], y);
        this.closePath();
      };
    }

    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

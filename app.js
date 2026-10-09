'use strict';
/* 律·动 浏览器演示：真实编排引擎 + 合成音频预览 + 趋势图（步频为演示数据，页面已标注）。 */
(function () {
  var pc = window.pulsecraft;
  if (!pc) { document.getElementById('demo').innerHTML = '<p class="err">演示引擎加载失败，请刷新。</p>'; return; }
  var manifest = pc.manifest, references = manifest.references, analyses = manifest.analyses;
  var energyZh = { low: '轻', medium: '中', high: '强', unknown: '未知' };
  var moodZh = { calm: '平静', melancholic: '惆怅', 'fired-up': '开朗', tender: '温柔', unknown: '不确定' };
  var state = { minutes: 30, mood: '', preference: 'original', arrangement: null, scheduler: null, playing: false, elapsed: 0, track: 0, nextAt: 0, tone: null, ac: null, trend: null, trendTimer: null, lastSampleAt: 0, trendStarted: false };

  function el(id) { return document.getElementById(id); }
  function plan(minutes) {
    return { schemaVersion: '0.2.0', id: 'demo-plan', version: 1, activity: 'running', source: 'user-confirmed', userConfirmed: true,
      phases: [{ id: 'main', label: 'steady', durationSeconds: minutes * 60, targetSource: 'user-confirmed', musicEnergyPreference: 'medium' }] };
  }
  function preference(choice) {
    return { schemaVersion: '0.2.0', version: 1, slowDownChoice: choice, userConfirmed: true, updatedAt: new Date().toISOString() };
  }
  function build() {
    var emotion = {};
    var byMusicId = pc.emotion.byMusicId || {};
    Object.keys(byMusicId).forEach(function (id) { emotion[id] = byMusicId[id]; });
    var intensity = pc.intensity.byMusicId || {};
    var arrangement = pc.arranger.createArrangement(plan(state.minutes), references, analyses, preference(state.preference), {
      purpose: 'private-test', nowMilliseconds: Date.now(), mood: state.mood || undefined, emotion: emotion
    });
    state.arrangement = arrangement;
    state.scheduler = pc.arranger.createScheduler(arrangement, { plan: plan(state.minutes), references: references, analyses: analyses,
      intensity: intensity, emotion: emotion, mood: state.mood || undefined, preference: preference(state.preference), purpose: 'private-test' });
    renderTimeline();
    renderPlayhead();
  }
  function renderTimeline() {
    var rows = pc.view.rows(state.arrangement, references, analyses);
    var html = '';
    rows.forEach(function (row) {
      html += '<div class="track" id="track-' + row.index + '"><span class="track-idx">' + (row.index + 1) + '</span>' +
        '<span class="track-title">' + row.title + '</span>' +
        '<span class="chip chip-' + row.energy + '">' + (energyZh[row.energy] || row.energy) + '</span>' +
        '<span class="track-dur">' + Math.round(row.durationSeconds) + 's</span></div>';
    });
    el('timeline').innerHTML = html;
    el('summary').textContent = '共 ' + rows.length + ' 次曲目 · 约 ' + Math.round(state.arrangement.durationSeconds / 60) + ' 分钟 · ' +
      (state.mood ? '心情：' + (moodZh[state.mood] || state.mood) : '随心播放');
  }
  function renderPlayhead() {
    var tracks = state.arrangement.tracks, at = state.elapsed, current = -1;
    tracks.forEach(function (t, i) { var end = t.timelineStartSeconds + t.audioEndSeconds - t.audioStartSeconds; if (t.timelineStartSeconds <= at && at < end) current = i; });
    var next = current >= 0 ? tracks[current + 1] : null;
    for (var i = 0; i < tracks.length; i++) {
      var node = el('track-' + i);
      if (node) node.className = 'track' + (i === current ? ' active' : '');
    }
    el('playhead').innerHTML = current >= 0
      ? '正在播：<b>' + tracks[current].musicId.slice(0, 4) + '…（' + format(at) + '）</b>' + (next ? ' · 下一首预告：' + next.musicId.slice(0, 4) + '…' : ' · 即将结束')
      : '点击「播放演示」开始';
  }
  function format(seconds) { var m = Math.floor(seconds / 60), s = Math.floor(seconds % 60); return m + ':' + ('0' + s).slice(-2); }

  /* —— 合成音频（演示音色，非真实歌曲；节奏按该曲 BPM 打点） —— */
  function bpmOf(track) {
    var analysis = analyses.find(function (a) { return a.musicId === track.musicId; });
    var tempo = analysis && Array.isArray(analysis.localTempo) && analysis.localTempo.length ? analysis.localTempo[0] : null;
    return tempo && Number.isFinite(tempo.bpm) && tempo.bpm > 0 ? Math.min(200, tempo.bpm) : 120;
  }
  function ensureAudio() {
    if (state.ac) return;
    state.ac = new (window.AudioContext || window.webkitAudioContext)();
    state.master = state.ac.createGain(); state.master.gain.value = 0.5; state.master.connect(state.ac.destination);
  }
  function scheduleTrack(track, when) {
    var bpm = bpmOf(track), beat = 60 / bpm, duration = Math.max(2, track.audioEndSeconds - track.audioStartSeconds);
    var osc = state.ac.createOscillator(), gain = state.ac.createGain();
    osc.type = 'sine'; osc.frequency.value = 220;
    var lfo = state.ac.createOscillator(), lfoGain = state.ac.createGain();
    lfo.frequency.value = 0.5; lfoGain.gain.value = 0.1; lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.25, when + 2); // 2 秒渐变入场（与小程序一致）
    gain.gain.setValueAtTime(0.25, when + Math.max(0, duration - 2));
    gain.gain.linearRampToValueAtTime(0, when + duration);
    osc.connect(gain); gain.connect(state.master);
    osc.start(when); lfo.start(when); osc.stop(when + duration + 0.05); lfo.stop(when + duration + 0.05);
    // 节拍点：按该曲 BPM 轻敲
    for (var t = when + 2; t < when + duration - 0.5; t += beat) {
      var click = state.ac.createOscillator(), cg = state.ac.createGain();
      click.frequency.value = 660; cg.gain.setValueAtTime(0.06, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      click.connect(cg); cg.connect(state.master); click.start(t); click.stop(t + 0.1);
    }
  }
  function advance() {
    if (!state.playing || !state.arrangement) return;
    var tracks = state.arrangement.tracks;
    var end = tracks[state.track].timelineStartSeconds + tracks[state.track].audioEndSeconds - tracks[state.track].audioStartSeconds;
    if (state.elapsed >= end - 2 && state.track + 1 < tracks.length) {
      state.track++;
      if (state.ac) scheduleTrack(tracks[state.track], state.ac.currentTime + 2);
      state.elapsed = tracks[state.track].timelineStartSeconds + 0.05;
    } else if (state.elapsed >= end && state.track + 1 >= tracks.length) {
      stopPlayback(); return;
    }
  }
  function startPlayback() {
    if (state.playing) return;
    ensureAudio();
    state.playing = true; state.elapsed = 0; state.track = 0;
    if (state.ac.state === 'suspended') state.ac.resume();
    scheduleTrack(state.arrangement.tracks[0], state.ac.currentTime + 0.1);
    el('play').textContent = '暂停演示';
    startTrend();
    state.clock = setInterval(function () {
      state.elapsed += 0.5; advance(); renderPlayhead(); observeTrend();
    }, 500);
  }
  function stopPlayback() {
    state.playing = false;
    if (state.clock) clearInterval(state.clock); state.clock = null;
    if (state.ac) { try { state.master.gain.setValueAtTime(0, state.ac.currentTime); } catch (ignored) {} }
    el('play').textContent = '播放演示';
  }
  function adjust(choice) {
    if (!state.scheduler || !state.playing) return;
    var previous = state.scheduler.getArrangement();
    var result = state.scheduler.request({ choice: choice }, state.elapsed, { nowMilliseconds: Date.now() });
    if (result.status === 'updated') {
      state.arrangement = result.arrangement;
      state.track = 0; state.elapsed = 0;
      renderTimeline(); renderPlayhead();
      el('notice').textContent = result.reason === 'SEGMENT_SWITCHED' ? '已在段落间切换。' : '已调整接下来的歌曲。';
    } else {
      el('notice').textContent = result.reason === 'NO_FUTURE_TRACK' ? '后面没有可换的歌曲，保持当前播放。' : '这次先保持原播放。';
    }
  }

  /* —— 趋势图（步频为演示数据；音乐节奏为该曲真实 localTempo） —— */
  function startTrend() {
    if (state.trendStarted) return;
    state.trendStarted = true;
    state.trend = pc.trendView.createTrendStore({ maxPoints: 600 });
    state.canvas = el('trend'); state.ctx = state.canvas.getContext('2d');
    resizeTrend();
    window.addEventListener('resize', resizeTrend);
  }
  function resizeTrend() {
    var wrap = el('trendWrap'), ratio = window.devicePixelRatio || 1;
    var width = wrap.clientWidth || 320;
    // 图表布局高度随宽度等比（638 基准），否则宽屏下 band<=0 会静默不画（空白）。
    var height = Math.max(280, Math.round(264 * width / 638) + 20);
    if (!state.ctx) state.ctx = state.canvas.getContext('2d');
    state.canvas.width = width * ratio; state.canvas.height = height * ratio;
    state.canvas.style.width = width + 'px'; state.canvas.style.height = height + 'px';
    state.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    state.size = { width: width, height: height };
    if (state.model) drawTrend();
  }
  function observeTrend() {
    if (!state.trend) return;
    var tracks = state.arrangement.tracks;
    var current = tracks[state.track];
    var sampleValue = Math.round(158 + 10 * Math.sin(state.elapsed / 6) + (Math.random() - 0.5) * 4); // 演示步频
    state.lastSampleAt = Date.now();
    var sample = { schemaVersion: '0.2.0', metric: 'cadence', value: sampleValue, unit: 'steps/min', source: 'accelerometer',
      timestampMilliseconds: state.lastSampleAt, window: { startMilliseconds: state.lastSampleAt - 10000, endMilliseconds: state.lastSampleAt, coverageMilliseconds: 10000 },
      quality: 'valid', qualityReason: '演示模拟数据', isDemo: false };
    var snapshot = { status: state.playing ? 'playing' : 'paused', playing: state.playing, elapsedSeconds: state.elapsed,
      arrangementElapsedSeconds: state.elapsed, durationSeconds: state.arrangement.durationSeconds, currentMusicId: current ? current.musicId : null,
      nextMusicId: tracks[state.track + 1] ? tracks[state.track + 1].musicId : null, nextTransitionSeconds: null, events: [], backgroundHandoff: false };
    state.model = state.trend.observe({ snapshot: snapshot, draft: { arrangement: state.arrangement, analyses: analyses, references: references }, cadenceSample: sample, nowMilliseconds: Date.now() });
    drawTrend();
    el('trendCursor').textContent = state.model.cadenceLabel + ' 步/分 · ' + state.model.bpmLabel + ' BPM · ' + state.model.elapsedLabel;
  }
  function drawTrend() {
    if (!state.ctx || !state.model || !state.size) return;
    pc.trendChart.drawChart(state.ctx, state.model, state.size.width, state.size.height, null);
  }

  /* —— 控件接线 —— */
  el('minutes').addEventListener('change', function (e) { state.minutes = Number(e.target.value); });
  Array.prototype.forEach.call(document.querySelectorAll('.mood-chip'), function (btn) {
    btn.addEventListener('click', function () {
      var value = btn.getAttribute('data-mood');
      state.mood = state.mood === value && value ? '' : value;
      Array.prototype.forEach.call(document.querySelectorAll('.mood-chip'), function (b) { b.classList.toggle('on', b.getAttribute('data-mood') === state.mood); });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.pref-chip'), function (btn) {
    btn.addEventListener('click', function () {
      state.preference = btn.getAttribute('data-pref');
      Array.prototype.forEach.call(document.querySelectorAll('.pref-chip'), function (b) { b.classList.toggle('on', b.getAttribute('data-pref') === state.preference); });
    });
  });
  el('build').addEventListener('click', function () { stopPlayback(); build(); el('notice').textContent = '编排已生成（真实编排引擎，十首演示曲库）。'; });
  el('play').addEventListener('click', function () { if (state.playing) { stopPlayback(); return; } if (!state.arrangement) build(); startPlayback(); });
  el('ease').addEventListener('click', function () { adjust('ease'); });
  el('energize').addEventListener('click', function () { adjust('energize'); });
  el('hold').addEventListener('click', function () { adjust('hold'); });
  el('reset').addEventListener('click', function () { stopPlayback(); state.elapsed = 0; state.track = 0; build(); el('notice').textContent = '已按当前设置重新编排。'; });
  build();
})();

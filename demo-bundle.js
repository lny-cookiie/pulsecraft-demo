// 由 artifacts/local/build-h5-demo.js 机械生成：miniprogram 纯逻辑模块的浏览器包。
// 演示站专用：不含微信 API、不含音频文件；行为与小程序运行时的确定性逻辑一致。
(function(){
'use strict';
var registry={};
function dirname(p){var parts=p.split("/");parts.pop();return parts.join("/");}
function normalize(fromDir,request){var parts=(fromDir?fromDir.split("/"):[]).concat(request.split("/"));var out=[];for(var i=0;i<parts.length;i++){var part=parts[i];if(part==="."||part==="")continue;if(part==="..")out.pop();else out.push(part);}return out.join("/");}
function makeRequire(fromDir){return function(request){if(!/^\./.test(request))throw new Error("non-relative require: "+request);var id=normalize(fromDir,request);if(!Object.prototype.hasOwnProperty.call(registry,id)&&Object.prototype.hasOwnProperty.call(registry,id+".js"))id=id+".js";if(!Object.prototype.hasOwnProperty.call(registry,id))throw new Error("missing module: "+id);var entry=registry[id];if(entry.loaded)return entry.exports;entry.loaded=true;entry.fn(entry,entry.exports,makeRequire(dirname(id)));return entry.exports;};}
registry["miniprogram/domain/arranger.js"]={loaded:false,exports:{},fn:function(module,exports,require){
'use strict';
var contracts=require('./contracts');
var rules=require('../config/rules');
var hash=require('./hash');
function copy(v) { return JSON.parse(JSON.stringify(v)); }
function seal(value) {
  var identity=copy(value);delete identity.id;
  value.id='arrangement-'+hash.sha256Text(JSON.stringify(identity));
  contracts.assertValid('Arrangement',value);return value;
}
function level(label) { return {low:0,medium:1,high:2}[label]; }
var DECODE_METHOD='wx.createWebAudioContext.decodeAudioData';
function isCandidate(analysis) {
  if (!analysis) return false;
  return typeof analysis.analysisVersion==='string' && /^small0-candidate-/.test(analysis.analysisVersion) && Array.isArray(analysis.windows) && analysis.windows.length===2 &&
    analysis.windows.every(function(w) { return w.checkedByListening===false && w.provenance==='trained-model'; });
}
function candidateClip(analysis) {
  var entry=analysis.windows.find(function(w) { return w.kind==='entry'; }), exit=analysis.windows.find(function(w) { return w.kind==='exit'; });
  var mapped=analysis.timebase && analysis.timebase.decodeMethod===DECODE_METHOD;
  if (mapped) {
    if (!entry||!exit) return null;
    return {entry:entry,exit:exit,extended:false,duration:exit.anchorSeconds-entry.anchorSeconds};
  }
  return {entry:{id:'candidate-natural-start',anchorSeconds:0},exit:{id:'natural-end',anchorSeconds:analysis.timebase.durationSeconds},extended:false,duration:analysis.timebase.durationSeconds};
}
var SEGMENT_SWITCH_LEAD_SECONDS=8;
var EMOTION_MATCH_BONUS=12;
// 用户心情词 → 内部标签的集合映射（albert 2026-10-09 定稿）：温柔同时计入平静与惆怅；
// 开朗对应兴奋档；随心（无心情）不加分，全部自然播放。未列出的标签不参与加分。
var MOOD_LABELS={'calm':{calm:true,tender:true},'melancholic':{melancholic:true,tender:true},'fired-up':{'fired-up':true}};
function emotionBonus(candidate, options) {
  var mood=options&&options.mood;
  var map=options&&options.emotion;
  if (!mood || !map) return 0;
  var allowed=MOOD_LABELS[mood];
  return allowed && allowed[map[candidate.reference.id]]?EMOTION_MATCH_BONUS:0;
}
function eligibleSegmentBoundaries(analysis, fromAnalysisSeconds, upperAnalysisSeconds) {
  if (!Array.isArray(analysis.segments)) return [];
  return analysis.segments.map(function(s) { return s.startSeconds; }).filter(function(v) {
    return Number.isFinite(v) && v>=fromAnalysisSeconds && v<=upperAnalysisSeconds;
  }).sort(function(a,b) { return a-b; });
}
// 段级强度辅助：entry 为归一化后的强度条目（services/intensity.js），按 startSeconds 对齐。
function intensityByStart(intensityEntry, analysis) {
  if (!intensityEntry || !Array.isArray(intensityEntry.segments) || !Array.isArray(analysis.segments) || !analysis.segments.length) return null;
  var map={};
  intensityEntry.segments.forEach(function(s) { map[s.startSeconds]=s; });
  for (var i=0;i<analysis.segments.length;i++) {
    var entry=map[analysis.segments[i].startSeconds];
    if (!entry || !Number.isFinite(entry.intensityMean)) return null; // 覆盖不完整 → 按无强度处理
  }
  return map;
}
// 切段语义：b 之后的段不再播放。在最近两个合格边界里（bounds 已升序）：
// 更有劲(up) → 选「下一段（被跳过段）强度较低」的边界，跳过接下来的平静段、让带劲部分先播完；
// 轻一点(down) → 选「下一段强度较高」的边界，跳过接下来的高潮段；无方向或无强度 → 现状最早边界。
// 返回 {boundary, intensityUsed}；tie-break 取更早边界。
function segmentBoundaryPreference(bounds, analysis, direction, intensityEntry) {
  if (!direction) return { boundary: bounds[0], intensityUsed: false };
  var byStart=intensityByStart(intensityEntry, analysis);
  if (!byStart) return { boundary: bounds[0], intensityUsed: false };
  var candidates=bounds.slice(0,2).map(function(boundary) {
    var entry=byStart[boundary];
    return Number.isFinite(entry.intensityMean)?{boundary:boundary,v:entry.intensityMean}:null;
  }).filter(Boolean);
  // 单个合格边界无从比较，不算强度生效（如实区分 reason 文案）。
  if (candidates.length<2) return { boundary: bounds[0], intensityUsed: false };
  return { boundary: candidates.slice().sort(function(a,b) {
    return (direction==='down' ? b.v-a.v : a.v-b.v) || a.boundary-b.boundary;
  })[0].boundary, intensityUsed: true };
}
function asArray(v) { return !v ? [] : Array.isArray(v) ? v : [v]; }
function feedbacks(options) {
  var now=options.nowMilliseconds===undefined?Date.now():options.nowMilliseconds;
  return asArray(options.feedback).filter(function(f) { return contracts.validate('UserFeedback',f).ok && f.atMilliseconds<=now+1000; }).sort(function(a,b) { return a.atMilliseconds-b.atMilliseconds || a.id.localeCompare(b.id); });
}
function signalContext(options) {
  if (!options.bodyContext) return null;
  if (!contracts.validate('BodyContext',options.bodyContext).ok) return null;
  var context={schemaVersion:'0.2.0',events:options.bodyContext.events};
  ['cadence','heartRate'].forEach(function(key) {
    var sample=options.bodyContext[key];
    if (sample&&contracts.validate('TelemetrySample',sample,{requireFresh:true,nowMilliseconds:options.nowMilliseconds}).ok) context[key]=sample;
  });
  return context.cadence||context.heartRate?context:null;
}
function hasDecline(context,now) {
  return Boolean(context&&context.cadence&&context.cadence.quality==='valid'&&context.events.some(function(e){
    return e.type==='cadence-decline'&&e.ruleVersion===rules.version&&e.source===context.cadence.source&&e.isDemo===context.cadence.isDemo&&now-e.timestampMilliseconds>=0&&now-e.timestampMilliseconds<=rules.signalStaleMilliseconds&&e.changeSpm<=-rules.declineSpm;
  }));
}
function selection(phase, preference, options) {
  var context=signalContext(options), list=feedbacks(options);
  var command=list.filter(function(f) { return f.kind==='music-command' && f.value!=='pause'; }).pop();
  var choice=options.sessionChoice || (command && command.value);
  var reason=choice ? 'explicit-choice' : 'confirmed-plan';
  var selfReport=list.some(function(f) { return f.kind==='self-report'; });
  var now=options.nowMilliseconds===undefined?Date.now():options.nowMilliseconds;
  var decline=hasDecline(context,now);
  if (!choice && (selfReport || decline)) {
    choice=preference.userConfirmed?preference.slowDownChoice:'original';
    reason=selfReport?'user-report':'cadence-decline';
  }
  var base=level(phase.musicEnergyPreference);
  if (base===undefined) base=1;
  var target=choice==='energize'?Math.min(2,base+1):choice==='ease'?Math.max(0,base-1):base;
  return {target:target,choice:choice||'original',reason:reason,context:context};
}
function segment(analysis, desiredSeconds) {
  var entry=analysis.windows.filter(function(w) {
    return w.kind==='entry'&&w.checkedByListening&&w.anchorSeconds+rules.fadeSeconds<=w.endSeconds;
  }).sort(function(a,b) { return a.anchorSeconds-b.anchorSeconds || a.id.localeCompare(b.id); })[0];
  if (!entry) return null;
  var min=entry.anchorSeconds+rules.minTrackSeconds;
  var exits=analysis.windows.filter(function(w) {
    return w.kind==='exit'&&w.checkedByListening&&w.anchorSeconds>=min&&w.anchorSeconds-rules.fadeSeconds>=w.startSeconds;
  }).sort(function(a,b) { return a.anchorSeconds-b.anchorSeconds || a.id.localeCompare(b.id); });
  if (!exits.length) return null;
  var nearby=exits.filter(function(w) { return w.anchorSeconds<=min+rules.windowSearchSeconds; });
  var target=entry.anchorSeconds+Math.max(rules.minTrackSeconds,desiredSeconds||rules.minTrackSeconds);
  var exit=(nearby.length?nearby:exits).slice().sort(function(a,b) {
    return Math.abs(a.anchorSeconds-target)-Math.abs(b.anchorSeconds-target) || a.anchorSeconds-b.anchorSeconds || a.id.localeCompare(b.id);
  })[0];
  return {entry:entry,exit:exit,extended:!nearby.length,duration:exit.anchorSeconds-entry.anchorSeconds};
}
function phaseAt(plan,seconds) {
  var start=0;
  for (var i=0;i<plan.phases.length;i++) {
    if (seconds<start+plan.phases[i].durationSeconds) return plan.phases[i];
    start+=plan.phases[i].durationSeconds;
  }
  return plan.phases[plan.phases.length-1];
}
function candidates(references,analyses,options) {
  var accepted=[],rejected=[];
  references.forEach(function(reference) {
    var analysis=analyses.find(function(a) { return a.musicId===reference.id && a.audioSha256===reference.audio.sha256; });
    if (isCandidate(analysis)) {
      var refV=contracts.validate('MusicReference',reference), anaV=contracts.validate('MusicAnalysis',analysis);
      if (!refV.ok||!anaV.ok) { rejected.push((reference.title||reference.id||'曲目')+'：候选数据不完整。'); return; }
      if (analysis.tool.licenseStatus!=='approved-for-current-purpose') { rejected.push(reference.title+'：候选分析许可未通过。'); return; }
      var candClip=candidateClip(analysis);
      if (!candClip) { rejected.push(reference.title+'：候选窗口缺失。'); return; }
      accepted.push({reference:reference,analysis:analysis,candidate:true});
      return;
    }
    var validation=analysis?contracts.validateMusicAnalysis(reference,analysis,options):{ok:false,errors:[{message:'尚无匹配音频版本的分析。'}]};
    if (!validation.ok) { rejected.push((reference.title||reference.id||'曲目')+'：'+validation.errors[0].message); return; }
    var clip=segment(analysis, rules.minTrackSeconds);
    if (!clip) { rejected.push(reference.title+'：缺少至少45秒片段及完整渐变窗口。'); return; }
    accepted.push({reference:reference,analysis:analysis});
  });
  return {accepted:accepted,rejected:rejected};
}
function rank(pool,phase,preference,options,counts,previousId,avoidId) {
  if (pool.length > 1) {
    var excluded = [];
    if (previousId !== undefined) excluded.push(previousId);
    if (avoidId !== undefined) excluded.push(avoidId);
    if (excluded.length) {
      var kept = pool.filter(function (candidate) { return excluded.indexOf(candidate.reference.id) < 0; });
      if (kept.length) pool = kept;
    }
  }
  var intent=selection(phase,preference,options);
  var cadence=intent.context&&intent.context.cadence;
  return pool.map(function(candidate) {
    var energy=level(candidate.analysis.energy.label);
    var score=energy===undefined?-20:100-Math.abs(energy-intent.target)*35;
    // 情绪次级排序：仅同能量档内生效（不跨档），排在能量档与实时步频之后、BPM 与罚分之前。
    if (energy!==undefined && energy===intent.target) score+=emotionBonus(candidate,options);
    var interpretation='none';
    var bpmTiebreak=0;
    if (energy!==undefined && energy===intent.target && (intent.choice==='ease'||intent.choice==='energize')) {
      var tempos=(candidate.analysis.localTempo||[]).filter(function(t) { return t.ambiguity==='none'&&Number.isFinite(t.bpm)&&t.bpm>0; });
      if (tempos.length) {
        var bpm=tempos.map(function(t) { return t.bpm; }).sort(function(a,b) { return a-b; })[Math.floor(tempos.length/2)];
        bpmTiebreak=(intent.choice==='ease'?-1:1)*bpm/25;
      }
    }
    score+=bpmTiebreak;
    if (cadence&&cadence.quality==='valid') {
      var tempos=candidate.analysis.localTempo.filter(function(t) { return t.ambiguity==='none'; });
      var choices=[];
      tempos.forEach(function(t) {
        [[t.bpm,'native'],[t.bpm/2,'half-time'],[t.bpm*2,'double-time']].forEach(function(match) { choices.push({distance:Math.abs(cadence.value-match[0]),name:match[1]}); });
      });
      choices.sort(function(a,b) { return a.distance-b.distance || a.name.localeCompare(b.name); });
      if (choices.length) { score+=Math.max(0,25-choices[0].distance/2);interpretation=choices[0].name; }
    }
    score-=(counts[candidate.reference.id]||0)*15;
    if (previousId===candidate.reference.id) score-=40;
    if (avoidId!==undefined && avoidId===candidate.reference.id) score-=40;
    var risk=candidate.analysis.windows.filter(function(w) { return w.checkedByListening; }).some(function(w) { return w.vocalOverlapRisk==='high'; });
    if (risk) score-=15;
    return {candidate:candidate,score:score,interpretation:interpretation,intent:intent,bpmTiebreak:bpmTiebreak};
  }).sort(function(a,b) { return b.score-a.score || a.candidate.reference.id.localeCompare(b.candidate.reference.id); });
}
function isDemo(plan,options) {
  return plan.source==='illustrative' || asArray(options.feedback).some(function(f) {return f.isDemo;}) || Boolean(options.bodyContext && ['cadence','heartRate'].some(function(k) {return options.bodyContext[k]&&(options.bodyContext[k].isDemo||options.bodyContext[k].source==='mock');}));
}
function bpmNote(chosen) {
  return chosen.bpmTiebreak?'；同类听感里按节奏更'+(chosen.intent.choice==='ease'?'舒缓（BPM规则）。':'带劲（BPM规则）。'):'';
}
function createArrangement(plan,references,analyses,preference,options) {
  options=options||{};
  contracts.assertValid('TrainingPlan',plan);
  contracts.assertValid('MusicPreference',preference);
  if (!Array.isArray(references)||!Array.isArray(analyses)) throw contracts.error('CONTRACT_INVALID','歌曲与分析需要列表。');
  references.forEach(function(r) { contracts.assertValid('MusicReference',r); });
  analyses.forEach(function(a) { contracts.assertValid('MusicAnalysis',a); });
  if (new Set(references.map(function(r){return r.id;})).size!==references.length || new Set(analyses.map(function(a){return a.musicId;})).size!==analyses.length) throw contracts.error('CONTRACT_INVALID','曲目或分析编号重复，请明确当前版本。');
  var pool=candidates(references,analyses,options);
  var result={schemaVersion:'0.2.0',id:'arrangement-'+plan.id+'-v'+plan.version,planId:plan.id,planVersion:plan.version,preferenceVersion:preference.version,status:'not-run',ruleVersion:rules.version,purpose:options.purpose||'private-test',isDemo:isDemo(plan,options),durationSeconds:0,tracks:[],transitions:[],gaps:[],explanations:pool.rejected};
  if (!pool.accepted.length) {
    result.gaps.push('没有用途、音频版本和听核窗口都合格的歌曲。');
    return seal(result);
  }
  var targetDuration=plan.phases.reduce(function(sum,p) {return sum+p.durationSeconds;},0);
  var timeline=0,counts={},previousId=null;
  while (timeline<targetDuration && result.tracks.length<500) {
    var phase=phaseAt(plan,timeline);
    var chosen=rank(pool.accepted,phase,preference,options,counts,previousId)[0];
    var remaining=targetDuration-timeline;
    var clip=chosen.candidate.candidate?candidateClip(chosen.candidate.analysis):segment(chosen.candidate.analysis,Math.min(rules.minTrackSeconds+rules.windowSearchSeconds,remaining));
    var reference=chosen.candidate.reference,analysis=chosen.candidate.analysis;
    var mappedCandidate=chosen.candidate.candidate&&analysis.timebase.decodeMethod===DECODE_METHOD;
    var track={musicId:reference.id,audioSha256:reference.audio.sha256,analysisVersion:analysis.analysisVersion,phaseId:phase.id,timelineStartSeconds:timeline,audioStartSeconds:clip.entry.anchorSeconds,audioEndSeconds:clip.exit.anchorSeconds,cadenceInterpretation:chosen.interpretation,entryWindowId:clip.entry.id,exitWindowId:clip.exit.id,reason:(chosen.candidate.candidate?(mappedCandidate?'模型候选：节拍与接歌位置为模型提议，未经听核。':'模型候选：微信时间待校准，按自然开头与结尾播放。'):(chosen.intent.reason==='confirmed-plan'?'按确认阶段与可用窗口选择。':chosen.intent.reason==='explicit-choice'?'按当前会话明确音乐选择，调整后续候选。':'按已确认音乐偏好调整一档，不判断运动状态。'))+bpmNote(chosen)};
    if (clip.extended) result.explanations.push(reference.title+'：45秒后60秒内无窗口，保留到较晚的听核窗口。');
    var index=result.tracks.length;
    result.tracks.push(track);
    if (index) {
      var from=result.tracks[index-1];
      var fromCandidate=analyses.find(function(a) { return a.musicId===from.musicId&&a.analysisVersion===from.analysisVersion; });
      fromCandidate=fromCandidate&&isCandidate(fromCandidate);
      var toCandidate=chosen.candidate.candidate;
      result.transitions.push({fromIndex:index-1,toIndex:index,fromMusicId:from.musicId,toMusicId:track.musicId,startSeconds:timeline,durationSeconds:rules.fadeSeconds,method:'short-fade',verified:!(fromCandidate||toCandidate),notes:(fromCandidate||toCandidate)?'候选边界未经听核，渐变不保证人声或唱句。':'双方人工听核窗口内2秒渐变；不变速，不保证长节拍混合。'});
    }
    counts[reference.id]=(counts[reference.id]||0)+1;previousId=reference.id;
    result.durationSeconds=timeline+clip.duration;
    if (result.durationSeconds>=targetDuration) break;
    timeline=result.durationSeconds-rules.fadeSeconds;
  }
  result.status='planned';
  if (result.durationSeconds<targetDuration) result.gaps.push('已达到曲目数限制，无法覆盖全部确认时长。');
  if (result.durationSeconds>targetDuration+0.1) result.explanations.push('为保留听核段落结束位置，音乐时间线比确认时长多'+Math.ceil(result.durationSeconds-targetDuration)+'秒。');
  if (options.bodyContext&&(!signalContext(options)||(options.bodyContext.cadence&&!signalContext(options).cadence))) result.explanations.push('实时步频无效或过期，继续确认过的音乐计划。');
  return seal(result);
}
function createScheduler(initial,settings) {
  contracts.assertValid('Arrangement',initial);
  settings=settings||{};
  var current=copy(initial),pending=null,lastApplied=-Infinity,sessionChoice=null;
  function output(status,reason) {return {status:status,reason:reason,arrangement:copy(current)};}
  function context(overrides) {return Object.assign({},settings,overrides||{},sessionChoice?{sessionChoice:sessionChoice}:{ });}
  function request(input,audioSeconds,overrides) {
    var now=overrides&&overrides.nowMilliseconds!==undefined?overrides.nowMilliseconds:Date.now();
    var feedback=input&&input.schemaVersion?input:null;
    if (feedback) contracts.assertValid('UserFeedback',feedback);
    else if (input&&input.choice) feedback={schemaVersion:'0.2.0',id:'session-choice-'+now,kind:'music-command',value:input.choice,source:input.source||'tap',atMilliseconds:input.atMilliseconds===undefined?now:input.atMilliseconds,isDemo:input.isDemo===true};
    if (!feedback) throw contracts.error('INVALID_REQUEST','需要明确音乐指令或自报。');
    contracts.assertValid('UserFeedback',feedback);
    if (feedback.value==='pause') return output('ignored','PAUSE_DIRECTLY');
    if (feedback.kind==='music-command') sessionChoice=feedback.value;
    pending={feedback:feedback,automatic:feedback.kind==='self-report',overrides:overrides||{}};
    return tick(audioSeconds,overrides);
  }
  function requestAutomatic(bodyContext,audioSeconds,overrides) {
    if (sessionChoice) return output('ignored','EXPLICIT_CHOICE_PRIORITY');
    var ctx=Object.assign({},overrides||{},{bodyContext:bodyContext});
    var signal=signalContext(ctx),now=ctx.nowMilliseconds===undefined?Date.now():ctx.nowMilliseconds;
    if (!signal||!signal.cadence||signal.cadence.quality!=='valid') {pending=null;return output('ignored','SIGNAL_INVALID');}
    if (!hasDecline(signal,now)) return output('ignored','NO_DECLINE');
    if (!settings.preference.userConfirmed||settings.preference.slowDownChoice==='original') return output('ignored','ORIGINAL_PREFERENCE');
    pending={feedback:null,automatic:true,bodyContext:bodyContext,overrides:ctx};
    return tick(audioSeconds,ctx);
  }
  function tick(audioSeconds,overrides) {
    if (!Number.isFinite(audioSeconds)||audioSeconds<0) throw contracts.error('INVALID_AUDIO_TIME','音频时间不正确。');
    if (!pending) return output('ignored','NO_PENDING_REQUEST');
    var ctx=context(Object.assign({},pending.overrides,overrides||{}));
    if (pending.bodyContext && !(overrides&&overrides.bodyContext)) ctx.bodyContext=pending.bodyContext;
    if (pending.feedback) ctx.feedback=[pending.feedback];
    if (pending.automatic&&pending.bodyContext&&!hasDecline(signalContext(ctx),ctx.nowMilliseconds===undefined?Date.now():ctx.nowMilliseconds)) {pending=null;return output('ignored','SIGNAL_INVALID');}
    var transition=current.transitions.find(function(t){return audioSeconds<t.startSeconds+t.durationSeconds;});
    if (!transition) {pending=null;return output('ignored','NO_FUTURE_TRACK');}
    if (audioSeconds>=transition.startSeconds-rules.freezeSeconds) return output('queued','TRANSITION_FROZEN');
    if (audioSeconds-lastApplied<rules.replanIntervalSeconds) return output('queued','REPLAN_INTERVAL');
    if (sessionChoice==='hold') {
      var playingIndex=transition.fromIndex;
      var active=current.tracks[playingIndex];
      var activeReference=(settings.references||[]).find(function(r){return r.id===active.musicId&&r.audio.sha256===active.audioSha256;});
      var activeAnalysis=(settings.analyses||[]).find(function(a){return a.musicId===active.musicId&&a.analysisVersion===active.analysisVersion;});
      if (!activeReference||!activeAnalysis||!contracts.validateMusicAnalysis(activeReference,activeAnalysis,ctx).ok) {pending=null;return output('ignored','CURRENT_TRACK_INVALID');}
      var held=copy(current);
      held.tracks=held.tracks.slice(0,playingIndex+1);
      held.tracks[playingIndex].audioEndSeconds=activeReference.audio.durationSeconds;
      held.tracks[playingIndex].exitWindowId='natural-end';
      held.tracks[playingIndex].reason='用户明确选择别换歌，当前原曲继续到自然结束。';
      held.transitions=held.transitions.slice(0,playingIndex);
      held.durationSeconds=active.timelineStartSeconds+activeReference.audio.durationSeconds-active.audioStartSeconds;
      held.explanations.push('本会话按明确选择保留当前歌曲到原曲自然结尾，后续曲目已取消。');
      seal(held);
      current=held;pending=null;lastApplied=audioSeconds;
      var holdResult=output('updated','HOLD_CURRENT_TO_NATURAL_END');
      holdResult.playerOptions={holdCurrent:true};
      return holdResult;
    }
    var segCut=segmentCutRevised(current,transition.fromIndex,audioSeconds,ctx);
    if (segCut) { current=segCut; pending=null; lastApplied=audioSeconds;
      var segOut=output('updated','SEGMENT_SWITCHED'); segOut.playerOptions={segmentSwitch:true}; return segOut; }
    var pool=candidates(settings.references||[],settings.analyses||[],ctx);
    if (!pool.accepted.length) {pending=null;return output('ignored','NO_VALID_CANDIDATE');}
    var nextIndex=transition.toIndex;
    var revised=replaceNext(copy(current),nextIndex,ctx,pool);
    if (!revised) {pending=null;return output('ignored','NO_CHECKED_WINDOW');}
    revised=finishRevised(revised,nextIndex,ctx);
    if (!revised) {pending=null;return output('ignored','WINDOW_CANNOT_COVER_PLAN');}
    current=revised;lastApplied=audioSeconds;pending=null;
    return output('updated','NEXT_TRACK_UPDATED');
  }
  function segmentCutRevised(current,playingIndex,audioSeconds,ctx) {
    var active=current.tracks[playingIndex];
    if (!active||playingIndex>=current.tracks.length-1) return null;
    var analysis=(settings.analyses||[]).find(function(a){return a.musicId===active.musicId&&a.analysisVersion===active.analysisVersion;});
    if (!analysis||!Array.isArray(analysis.segments)||!analysis.segments.length) return null;
    if (!analysis.timebase) return null;
    if (analysis.timebase.decodeMethod!==DECODE_METHOD && !isCandidate(analysis)) return null;
    var positionInTrack=Math.max(0,audioSeconds-active.timelineStartSeconds);
    var fromAnalysis=active.audioStartSeconds+positionInTrack+SEGMENT_SWITCH_LEAD_SECONDS;
    var upperAnalysis=active.audioEndSeconds-rules.fadeSeconds;
    var bounds=eligibleSegmentBoundaries(analysis,fromAnalysis,upperAnalysis);
    if (!bounds.length) return null;
    var phase=settings.plan?phaseAt(settings.plan,active.timelineStartSeconds):{musicEnergyPreference:'medium'};
    var intent=selection(phase,settings.preference,ctx);
    var direction=intent.choice==='energize'?'up':intent.choice==='ease'?'down':null;
    var intensityEntry=settings.intensity?settings.intensity[active.musicId]:null;
    var picked=segmentBoundaryPreference(bounds,analysis,direction,intensityEntry);
    var b=picked.boundary;
    var intensityUsed=picked.intensityUsed;
    var revised=copy(current);
    var shift=b-active.audioEndSeconds;
    revised.tracks[playingIndex].audioEndSeconds=b;
    revised.tracks[playingIndex].reason=intensityUsed?'按当前会话请求在强度合适的段边界切换；段边界来自模型段结构，未经听核。':'按当前会话请求在下一个段边界切换；段边界来自模型段结构，未经听核。';
    for (var i=playingIndex+1;i<revised.tracks.length;i++) revised.tracks[i].timelineStartSeconds+=shift;
    var replaced=replaceNext(revised,playingIndex+1,ctx,null);
    if (!replaced) return null;
    return finishRevised(replaced,playingIndex+1,ctx);
  }
  function replaceNext(revised,nextIndex,ctx,pool) {
    pool=pool||candidates(settings.references||[],settings.analyses||[],ctx);
    if (!pool.accepted.length) return null;
    var next=revised.tracks[nextIndex];
    var phase=settings.plan?phaseAt(settings.plan,next.timelineStartSeconds):{musicEnergyPreference:'medium'};
    var counts={};
    revised.tracks.slice(0,nextIndex).forEach(function(t){counts[t.musicId]=(counts[t.musicId]||0)+1;});
    var chosen=rank(pool.accepted,phase,settings.preference,ctx,counts,revised.tracks[nextIndex-1].musicId,nextIndex+1<revised.tracks.length?revised.tracks[nextIndex+1].musicId:undefined)[0];
    var clip=chosen.candidate.candidate?candidateClip(chosen.candidate.analysis):segment(chosen.candidate.analysis,next.audioEndSeconds-next.audioStartSeconds);
    if (!clip) return null;
    var beforeDuration=next.audioEndSeconds-next.audioStartSeconds;
    var replacement=Object.assign({},next,{musicId:chosen.candidate.reference.id,audioSha256:chosen.candidate.reference.audio.sha256,analysisVersion:chosen.candidate.analysis.analysisVersion,audioStartSeconds:clip.entry.anchorSeconds,audioEndSeconds:clip.exit.anchorSeconds,entryWindowId:clip.entry.id,exitWindowId:clip.exit.id,cadenceInterpretation:chosen.interpretation,reason:'当前会话请求，仅调整尚未开始曲目。'+bpmNote(chosen)});
    revised.tracks[nextIndex]=replacement;
    var delta=clip.duration-beforeDuration;
    for (var i=nextIndex+1;i<revised.tracks.length;i++) revised.tracks[i].timelineStartSeconds+=delta;
    revised.transitions.forEach(function(t,i) {
      t.fromMusicId=revised.tracks[i].musicId;t.toMusicId=revised.tracks[i+1].musicId;t.startSeconds=revised.tracks[i+1].timelineStartSeconds;
      // 端点变化后重算诚实标注：任一侧为候选即未核验（审计 AE-02：此前只改端点不改 verified/notes）。
      var fromAnalysis=(settings.analyses||[]).find(function(a){return a.musicId===revised.tracks[i].musicId&&a.analysisVersion===revised.tracks[i].analysisVersion;});
      var toAnalysis=(settings.analyses||[]).find(function(a){return a.musicId===revised.tracks[i+1].musicId&&a.analysisVersion===revised.tracks[i+1].analysisVersion;});
      var fromCandidate=fromAnalysis&&isCandidate(fromAnalysis),toCandidate=toAnalysis&&isCandidate(toAnalysis);
      t.verified=!(fromCandidate||toCandidate);
      t.notes=(fromCandidate||toCandidate)?'候选边界未经听核，渐变不保证人声或唱句。':'双方人工听核窗口内2秒渐变；不变速，不保证长节拍混合。';
    });
    revised.durationSeconds+=delta;
    return revised;
  }
  function finishRevised(revised,trimFrom,ctx) {
    if (settings.plan) {
      var targetDuration=settings.plan.phases.reduce(function(sum,p){return sum+p.durationSeconds;},0);
      if (revised.durationSeconds<targetDuration-0.01) return null;
      var finalIndex=revised.tracks.findIndex(function(t){return t.timelineStartSeconds+t.audioEndSeconds-t.audioStartSeconds>=targetDuration;});
      if (finalIndex>=0) {revised.tracks=revised.tracks.slice(0,finalIndex+1);revised.transitions=revised.transitions.slice(0,finalIndex);}
      revised.tracks.forEach(function(t,i){if(i>=trimFrom)t.phaseId=phaseAt(settings.plan,t.timelineStartSeconds).id;});
      var last=revised.tracks[revised.tracks.length-1];
      revised.durationSeconds=last.timelineStartSeconds+last.audioEndSeconds-last.audioStartSeconds;
      if (revised.durationSeconds>targetDuration+0.1) revised.explanations.push('调整后仍保留末曲听核段落结尾，音乐比确认时长多'+Math.ceil(revised.durationSeconds-targetDuration)+'秒。');
    }
    revised.isDemo=revised.isDemo||Boolean(pending.feedback&&pending.feedback.isDemo)||isDemo(settings.plan||{source:'user-confirmed'},ctx);
    seal(revised);
    return revised;
  }
  return {request:request,requestAutomatic:requestAutomatic,tick:tick,getArrangement:function(){return copy(current);},restoreArrangement:function(value){contracts.assertValid('Arrangement',value);current=copy(value);pending=null;lastApplied=-Infinity;},cancel:function(){pending=null;}};
}
function getArrangementStatus() {return {connected:true,status:'ready',ruleVersion:rules.version,modelInference:false};}
module.exports={createArrangement:createArrangement,createScheduler:createScheduler,getArrangementStatus:getArrangementStatus,isCandidate:isCandidate};

}};
registry["miniprogram/domain/contracts.js"]={loaded:false,exports:{},fn:function(module,exports,require){
'use strict';
var schema = require('./pulsecraft.schema');
var SCHEMA_VERSION = '0.2.0';
function error(code, message, details) {
  var value = new Error(message);
  value.code = code;
  if (details) value.details = details;
  return value;
}
function validate(type, value, options) {
  options = options || {};
  var errors = [];
  function fail(path, code, message) {
    if (errors.length < 50) errors.push({ path: path, code: code, message: message });
  }
  function walk(rule, item, path, parents) {
    if (errors.length >= 50) return;
    if (rule.$ref) return walk(schema.definitions[rule.$ref.split('/').pop()], item, path, parents);
    if (Object.prototype.hasOwnProperty.call(rule, 'const') && item !== rule.const) fail(path, 'CONST', '固定值不匹配。');
    if (rule.enum && rule.enum.indexOf(item) < 0) fail(path, 'ENUM', '不支持此值。');
    var actual = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
    var types = rule.type ? (Array.isArray(rule.type) ? rule.type : [rule.type]) : [];
    if (types.length && !types.some(function (t) { return t === actual || (t === 'integer' && actual === 'number' && Number.isInteger(item)); })) {
      fail(path, 'TYPE', '类型不正确。'); return;
    }
    if (actual === 'number') {
      if (!Number.isFinite(item)) fail(path, 'FINITE', '数值必须有限。');
      if (rule.minimum !== undefined && item < rule.minimum) fail(path, 'RANGE', '数值过小。');
      if (rule.maximum !== undefined && item > rule.maximum) fail(path, 'RANGE', '数值过大。');
      if (rule.exclusiveMinimum !== undefined && item <= rule.exclusiveMinimum) fail(path, 'RANGE', '数值必须大于下限。');
    }
    if (actual === 'string') {
      if (rule.minLength !== undefined && item.length < rule.minLength) fail(path, 'LENGTH', '文本过短。');
      if (rule.maxLength !== undefined && item.length > rule.maxLength) fail(path, 'LENGTH', '文本过长。');
      if (rule.pattern && !(new RegExp(rule.pattern)).test(item)) fail(path, 'PATTERN', '格式不正确。');
      if (rule.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(item) || !Number.isFinite(Date.parse(item)))) fail(path, 'DATE', '需要带时区的有效日期。');
    }
    if (actual !== 'array' && actual !== 'object') return;
    if (parents.indexOf(item) >= 0) { fail(path, 'CYCLE', '数据不得循环引用。'); return; }
    var nextParents = parents.concat([item]);
    if (actual === 'array') {
      if (rule.minItems !== undefined && item.length < rule.minItems) fail(path, 'LENGTH', '列表过短。');
      if (rule.maxItems !== undefined && item.length > rule.maxItems) { fail(path, 'LENGTH', '列表过长。'); return; }
      if (rule.items) item.forEach(function (entry, index) { walk(rule.items, entry, path + '[' + index + ']', nextParents); });
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) { fail(path, 'OBJECT', '只接受普通数据对象。'); return; }
      (rule.required || []).forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(item, key)) fail(path + '.' + key, 'REQUIRED', '缺少字段。'); });
      Object.keys(item).forEach(function (key) {
        if (rule.properties && Object.prototype.hasOwnProperty.call(rule.properties, key)) walk(rule.properties[key], item[key], path + '.' + key, nextParents);
        else if (rule.additionalProperties === false) fail(path + '.' + key, 'UNKNOWN_FIELD', '包含不允许的字段。');
      });
    }
  }
  if (!Object.prototype.hasOwnProperty.call(schema.definitions, type)) fail('$', 'UNKNOWN_CONTRACT', '契约类型不存在。');
  else walk(schema.definitions[type], value, '$', []);
  if (!errors.length) semantic(type, value, options, fail);
  return { ok: errors.length === 0, errors: errors };
}
function semantic(type, v, options, fail) {
  var now = options.nowMilliseconds === undefined ? Date.now() : options.nowMilliseconds;
  function bad(path, code, message) { fail(path, code, message); }
  function interval(start, end, limit, path) {
    if (end <= start || start < 0 || end > limit) bad(path, 'INVALID_WINDOW', '时间窗口为空或越界。');
  }
  if (type === 'MusicReference') {
    if (v.audio.availability === 'local-file') ['sha256','durationSeconds','offsetSeconds','decodeMethod'].forEach(function(k) {
      if (v.audio[k] === undefined) bad('$.audio.' + k, 'REQUIRED', '可用音频需要指纹和完整时间基准。');
    });
    if (v.audio.availability==='local-file' && v.audio.durationSeconds+v.audio.offsetSeconds<=0) bad('$.audio','TIMEBASE_RANGE','映射后的解码时长必须大于0。');
    Object.keys(v.rights).forEach(function (k) {
      var grant = v.rights[k];
      if (grant.status === 'approved-for-current-purpose' && (grant.scope === 'none' || !grant.confirmedAt || !grant.evidence.trim())) bad('$.rights.' + k, 'RIGHTS_EVIDENCE', '获准用途需要范围、确认时间和依据。');
    });
  }
  if (type === 'MusicAnalysis') {
    var duration = v.timebase.durationSeconds;
    if (duration+v.timebase.offsetSeconds<=0) bad('$.timebase','TIMEBASE_RANGE','映射后的解码时长必须大于0。');
    [v.beatsSeconds, v.downbeatsSeconds].forEach(function (points, list) {
      points.forEach(function (t, i) {
        if (t >= duration || (i && t <= points[i-1])) bad(list ? '$.downbeatsSeconds' : '$.beatsSeconds', 'INVALID_BEATS', '节拍需要严格递增并在音频内。');
      });
    });
    v.downbeatsSeconds.forEach(function (t) {
      if (!v.beatsSeconds.some(function (beat) { return Math.abs(beat-t) <= 0.07; })) bad('$.downbeatsSeconds', 'DOWNBEAT_NOT_BEAT', '小节首拍必须对应一个节拍。');
    });
    ['localTempo','segments','windows'].forEach(function (key) {
      v[key].forEach(function (entry, i) {
        interval(entry.startSeconds, entry.endSeconds, duration, '$.' + key + '[' + i + ']');
        if (key === 'windows') {
          if (entry.anchorSeconds+v.timebase.offsetSeconds<0) bad('$.windows['+i+']','TIMEBASE_RANGE','窗口时点映射到解码音频后不可为负。');
          if (entry.anchorSeconds < entry.startSeconds || entry.anchorSeconds > entry.endSeconds) bad('$.windows['+i+']', 'ANCHOR_OUTSIDE_WINDOW', '接歌时点不在窗口内。');
          if (entry.checkedByListening && !entry.checkedAt) bad('$.windows['+i+']', 'LISTENING_EVIDENCE', '听核窗口必须记录核验时间。');
        }
      });
    });
    if (new Set(v.windows.map(function (w) { return w.id; })).size !== v.windows.length) bad('$.windows', 'DUPLICATE_ID', '窗口编号重复。');
    if (v.quality.status === 'manually-checked' && !v.quality.checkedAt) bad('$.quality', 'QUALITY_EVIDENCE', '质量通过需要核验时间。');
    if ((v.method === 'trained-model' || v.method === 'hybrid') && v.tool.modelVersion === 'not-applicable') bad('$.tool.modelVersion','MODEL_VERSION','模型结果必须有真实模型版本。');
  }
  if (type === 'TrainingPlan') {
    if (v.source === 'user-confirmed' && (!v.userConfirmed || v.phases.some(function (p) { return p.targetSource !== 'user-confirmed'; }))) bad('$','PLAN_CONFIRMATION','用户计划和阶段需要一致确认。');
    if (new Set(v.phases.map(function(p) { return p.id; })).size !== v.phases.length) bad('$.phases','DUPLICATE_ID','阶段编号重复。');
    if (v.phases.reduce(function (sum,p) { return sum+p.durationSeconds; },0) > 21600) bad('$.phases','PLAN_DURATION','总时长超过6小时。');
  }
  if (type === 'MusicPreference' && !v.userConfirmed && v.slowDownChoice !== 'original') bad('$','UNCONFIRMED_PREFERENCE','未确认时只能按原编排。');
  if (type === 'UserFeedback' && ((v.kind === 'self-report') !== (v.value === 'tired'))) bad('$','FEEDBACK_KIND','自报和明确音乐指令须分别记录。');
  if (type === 'TelemetrySample') {
    if (v.unit !== (v.metric === 'cadence' ? 'steps/min' : 'beats/min')) bad('$.unit','UNIT_MISMATCH','指标和单位不匹配。');
    if (v.metric === 'heart-rate' && v.source === 'accelerometer') bad('$.source','SOURCE_MISMATCH','加速度不能提供心率。');
    if (v.source === 'mock' && !v.isDemo) bad('$.isDemo','MOCK_AS_REAL','模拟来源必须标记演示。');
    if (v.source !== 'mock' && v.isDemo && !options.allowDemoRealSource) bad('$.isDemo','SOURCE_MISMATCH','来源与演示标记不匹配。');
    if (v.window.endMilliseconds < v.window.startMilliseconds || v.window.coverageMilliseconds > v.window.endMilliseconds-v.window.startMilliseconds || v.timestampMilliseconds < v.window.endMilliseconds) bad('$.window','INVALID_WINDOW','采样覆盖或时间不正确。');
    if (v.quality === 'valid') {
      var min = v.metric === 'cadence' ? 40 : 1, max = v.metric === 'cadence' ? 300 : 300;
      if (v.value === null || v.value < min || v.value > max) bad('$.value','INVALID_SAMPLE','有效样本需要合理数值。');
      if (v.metric === 'cadence' && (v.window.endMilliseconds-v.window.startMilliseconds < 10000 || v.window.coverageMilliseconds < 8000)) bad('$.window','INSUFFICIENT_COVERAGE','步频需要10秒窗口及至少8秒有效覆盖。');
      if (options.requireFresh && (now-v.timestampMilliseconds > 5000 || v.timestampMilliseconds > now+1000)) bad('$.timestampMilliseconds','STALE_SIGNAL','信号过期或来自未来。');
    } else if (v.value !== null) bad('$.value','UNUSABLE_VALUE','不可用信号不得提供可用于决策的数值。');
  }
  if (type === 'BodyContext') {
    ['cadence','heartRate'].forEach(function (key) {
      if (!v[key]) return;
      if (v[key].metric !== (key === 'cadence' ? 'cadence' : 'heart-rate')) bad('$.'+key,'METRIC_MISMATCH','组合指标不正确。');
      var result = validate('TelemetrySample',v[key],options);
      result.errors.forEach(function (e) { bad('$.'+key+e.path.slice(1),e.code,e.message); });
    });
    v.events.forEach(function(e) {
      if ((e.source === 'mock') !== e.isDemo) bad('$.events','MOCK_AS_REAL','事件来源与演示标记不一致。');
    });
  }
  if (type === 'Arrangement') {
    if (v.ruleVersion !== 'pulsecraft-rules-0.2.0') bad('$.ruleVersion','RULE_VERSION','规则版本不匹配。');
    if (v.status !== 'planned' && (v.tracks.length || v.transitions.length || v.durationSeconds)) bad('$','UNRUN_TIMELINE','未编排或拒绝的结果不能带播放时间线。');
    if (v.status === 'planned' && !v.tracks.length) bad('$.tracks','EMPTY_TIMELINE','可播放编排需要曲目。');
    v.tracks.forEach(function(t,i) {
      if (t.audioEndSeconds <= t.audioStartSeconds) bad('$.tracks['+i+']','INVALID_WINDOW','音频片段时长不正确。');
      if (i && t.timelineStartSeconds <= v.tracks[i-1].timelineStartSeconds) bad('$.tracks','TIMELINE_ORDER','曲目时间必须递增。');
    });
    if (v.tracks.length) {
      var last = v.tracks[v.tracks.length-1];
      if (v.tracks[0].timelineStartSeconds !== 0 || Math.abs(last.timelineStartSeconds+last.audioEndSeconds-last.audioStartSeconds-v.durationSeconds)>0.01) bad('$','TIMELINE_DURATION','时间线起点或总时长不一致。');
      if (v.transitions.length !== v.tracks.length-1) bad('$.transitions','TRANSITION_COUNT','每对相邻曲目需要一次过渡。');
    }
    v.transitions.forEach(function(t,i) {
      var from = v.tracks[t.fromIndex], to = v.tracks[t.toIndex];
      if (!from || !to || t.fromIndex !== i || t.toIndex !== i+1 || from.musicId !== t.fromMusicId || to.musicId !== t.toMusicId) { bad('$.transitions['+i+']','INVALID_TRANSITION','过渡与相邻曲目不一致。'); return; }
      if (!t.verified && !/候选|未核验|未经听核/.test(t.notes)) bad('$.transitions['+i+']','UNVERIFIED_TRANSITION','未核验过渡必须如实说明原因。');
      var fromEnd=from.timelineStartSeconds+from.audioEndSeconds-from.audioStartSeconds;
      if (Math.abs(t.startSeconds-to.timelineStartSeconds)>0.01 || Math.abs(t.startSeconds+t.durationSeconds-fromEnd)>0.01) bad('$.transitions['+i+']','TRANSITION_TIME','过渡时间与曲目片段不一致。');
    });
  }
  if (type === 'SessionMusicRecord') {
    if (Date.parse(v.endedAt)<Date.parse(v.startedAt)) bad('$','RECORD_TIME','结束时间早于开始。');
    if (v.mode === 'demo' && (v.profileUpdateAllowed || v.cloudUploadConsent)) bad('$','DEMO_UPLOAD','演示不能进入真实统计或上传。');
    if (v.mode === 'real' && (v.musicFeedback.some(function(f) { return f.isDemo; }) || v.signalSources.some(function(s) { return s.isDemo || s.source==='mock'; }))) bad('$','MOCK_AS_REAL','含模拟输入的会话必须是演示。');
    if (!v.playedEvents.some(function(e) { return e.type === 'started'; })) bad('$.playedEvents','NO_PLAYBACK','不能保存未开始播放的会话。');
    v.playedEvents.forEach(function(e,i) { if (i && e.atAudioSeconds<v.playedEvents[i-1].atAudioSeconds) bad('$.playedEvents','EVENT_TIME','音频事件时间不得倒退。'); });
  }
}
function assertValid(type, value, options) {
  var result = validate(type,value,options);
  if (!result.ok) throw error('CONTRACT_INVALID', '数据不符合 '+type+' 契约。',result.errors);
  return value;
}
function validateMusicAnalysis(reference, analysis, options) {
  options = options || {};
  var result = validate('MusicReference',reference,options);
  var second = validate('MusicAnalysis',analysis,options);
  var errors = result.errors.concat(second.errors);
  if (errors.length) return {ok:false,errors:errors};
  function bad(code,message) { errors.push({path:'$',code:code,message:message}); }
  var purpose = options.purpose || 'private-test';
  var now = options.nowMilliseconds === undefined ? Date.now() : options.nowMilliseconds;
  ['playback','analysis','mixing'].concat(purpose==='public-demo'?['demonstration']:[]).forEach(function(k) {
    var grant=reference.rights[k];
    if (grant.status!=='approved-for-current-purpose' || grant.scope!==purpose || (grant.expiresAt && Date.parse(grant.expiresAt)<=now)) bad('RIGHTS_NOT_APPROVED','音频用途未获准或已过期。');
  });
  if (reference.audio.availability!=='local-file') bad('AUDIO_UNAVAILABLE','音频文件不可用。');
  if (reference.id!==analysis.musicId || reference.audio.sha256!==analysis.audioSha256) bad('AUDIO_VERSION_MISMATCH','分析与播放音频指纹不一致。');
  if (Math.abs(reference.audio.durationSeconds-analysis.timebase.durationSeconds)>0.1 || Math.abs(reference.audio.offsetSeconds-analysis.timebase.offsetSeconds)>0.05 || reference.audio.decodeMethod!==analysis.timebase.decodeMethod) bad('TIMEBASE_MISMATCH','分析与播放解码时间基准不一致。');
  if (analysis.tool.licenseStatus!=='approved-for-current-purpose' || analysis.quality.status!=='manually-checked') bad('ANALYSIS_NOT_APPROVED','工具许可或分析质量未通过。');
  if (!analysis.windows.some(function(w){return w.kind==='entry'&&w.checkedByListening;}) || !analysis.windows.some(function(w){return w.kind==='exit'&&w.checkedByListening;})) bad('WINDOWS_NOT_CHECKED','缺少经过听核的入歌和出歌窗口。');
  return {ok:errors.length===0,errors:errors};
}
module.exports={SCHEMA_VERSION:SCHEMA_VERSION,validate:validate,assertValid:assertValid,validateMusicAnalysis:validateMusicAnalysis,error:error};

}};
registry["miniprogram/domain/pulsecraft.schema.js"]={loaded:false,exports:{},fn:function(module,exports,require){
'use strict';
// 由唯一 specs/contracts/pulsecraft.schema.json 生成；主Agent维护并检查一致性。
module.exports = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://pulsecraft.local/contracts/0.2.0",
  "title": "PulseCraft 0.2.0 canonical contracts",
  "schemaVersion": "0.2.0",
  "description": "唯一契约；跨字段与指纹、时间、权利校验由 contracts.js 执行。",
  "definitions": {
    "Identifier": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$"
    },
    "LicenseGrant": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "scope",
        "evidence"
      ],
      "properties": {
        "status": {
          "enum": [
            "unverified",
            "approved-for-current-purpose",
            "blocked"
          ]
        },
        "scope": {
          "enum": [
            "none",
            "private-test",
            "internal-prototype",
            "public-demo",
            "distribution"
          ]
        },
        "evidence": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "confirmedAt": {
          "type": "string",
          "format": "date-time"
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "MusicReference": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "id",
        "title",
        "artist",
        "version",
        "source",
        "rights",
        "audio"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "id": {
          "$ref": "#/definitions/Identifier"
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "artist": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "source": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "rights": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "playback",
            "analysis",
            "mixing",
            "distribution",
            "demonstration"
          ],
          "properties": {
            "playback": {
              "$ref": "#/definitions/LicenseGrant"
            },
            "analysis": {
              "$ref": "#/definitions/LicenseGrant"
            },
            "mixing": {
              "$ref": "#/definitions/LicenseGrant"
            },
            "distribution": {
              "$ref": "#/definitions/LicenseGrant"
            },
            "demonstration": {
              "$ref": "#/definitions/LicenseGrant"
            }
          }
        },
        "audio": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "availability"
          ],
          "properties": {
            "availability": {
              "enum": [
                "unavailable",
                "local-file"
              ]
            },
            "sha256": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "path": {
              "type": "string",
              "minLength": 1,
              "maxLength": 2000
            },
            "durationSeconds": {
              "type": "number",
              "exclusiveMinimum": 0,
              "maximum": 21600
            },
            "offsetSeconds": {
              "type": "number",
              "minimum": -30,
              "maximum": 30
            },
            "decodeMethod": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            }
          }
        }
      }
    },
    "Timebase": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "unit",
        "durationSeconds",
        "decodeMethod",
        "offsetSeconds"
      ],
      "properties": {
        "unit": {
          "const": "seconds"
        },
        "durationSeconds": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 21600
        },
        "decodeMethod": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "offsetSeconds": {
          "type": "number",
          "minimum": -30,
          "maximum": 30
        }
      }
    },
    "LocalTempo": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "startSeconds",
        "endSeconds",
        "bpm",
        "ambiguity"
      ],
      "properties": {
        "startSeconds": {
          "type": "number",
          "minimum": 0
        },
        "endSeconds": {
          "type": "number",
          "minimum": 0
        },
        "bpm": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 400
        },
        "ambiguity": {
          "enum": [
            "none",
            "half-double",
            "unknown"
          ]
        }
      }
    },
    "AnalysisWindow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "kind",
        "startSeconds",
        "endSeconds",
        "anchorSeconds",
        "checkedByListening",
        "vocalOverlapRisk",
        "provenance"
      ],
      "properties": {
        "id": {
          "$ref": "#/definitions/Identifier"
        },
        "kind": {
          "enum": [
            "entry",
            "exit"
          ]
        },
        "startSeconds": {
          "type": "number",
          "minimum": 0
        },
        "endSeconds": {
          "type": "number",
          "minimum": 0
        },
        "anchorSeconds": {
          "type": "number",
          "minimum": 0
        },
        "checkedByListening": {
          "type": "boolean"
        },
        "checkedAt": {
          "type": "string",
          "format": "date-time"
        },
        "vocalOverlapRisk": {
          "enum": [
            "low",
            "medium",
            "high",
            "unknown"
          ]
        },
        "provenance": {
          "enum": [
            "manual-reference",
            "signal-processing",
            "trained-model",
            "human-correction"
          ]
        }
      }
    },
    "AnalysisSegment": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "startSeconds",
        "endSeconds",
        "label",
        "provenance"
      ],
      "properties": {
        "startSeconds": {
          "type": "number",
          "minimum": 0
        },
        "endSeconds": {
          "type": "number",
          "minimum": 0
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "provenance": {
          "enum": [
            "candidate",
            "listening-checked"
          ]
        }
      }
    },
    "MusicAnalysis": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "musicId",
        "audioSha256",
        "analysisVersion",
        "timebase",
        "method",
        "tool",
        "beatsSeconds",
        "downbeatsSeconds",
        "localTempo",
        "segments",
        "windows",
        "energy",
        "loudness",
        "quality",
        "corrections"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "musicId": {
          "$ref": "#/definitions/Identifier"
        },
        "audioSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "analysisVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "timebase": {
          "$ref": "#/definitions/Timebase"
        },
        "method": {
          "enum": [
            "manual-reference",
            "signal-processing",
            "trained-model",
            "hybrid"
          ]
        },
        "tool": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "name",
            "version",
            "modelVersion",
            "parameterVersion",
            "licenseStatus"
          ],
          "properties": {
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            },
            "version": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            },
            "modelVersion": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            },
            "parameterVersion": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            },
            "licenseStatus": {
              "enum": [
                "unverified",
                "approved-for-current-purpose",
                "blocked"
              ]
            }
          }
        },
        "beatsSeconds": {
          "type": "array",
          "items": {
            "type": "number",
            "minimum": 0
          },
          "minItems": 0,
          "maxItems": 50000
        },
        "downbeatsSeconds": {
          "type": "array",
          "items": {
            "type": "number",
            "minimum": 0
          },
          "minItems": 0,
          "maxItems": 50000
        },
        "localTempo": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/LocalTempo"
          },
          "minItems": 0,
          "maxItems": 1000
        },
        "segments": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/AnalysisSegment"
          },
          "minItems": 0,
          "maxItems": 1000
        },
        "windows": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/AnalysisWindow"
          },
          "minItems": 0,
          "maxItems": 1000
        },
        "energy": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "label",
            "method",
            "definitionVersion"
          ],
          "properties": {
            "label": {
              "enum": [
                "low",
                "medium",
                "high",
                "unknown"
              ]
            },
            "method": {
              "enum": [
                "manual-relative",
                "model-estimate",
                "unavailable"
              ]
            },
            "definitionVersion": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            }
          }
        },
        "loudness": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "relativeLufs",
            "headroomDb",
            "provenance"
          ],
          "properties": {
            "relativeLufs": {
              "type": [
                "number",
                "null"
              ],
              "minimum": -80,
              "maximum": 10
            },
            "headroomDb": {
              "type": "number",
              "minimum": 0,
              "maximum": 100
            },
            "provenance": {
              "enum": [
                "measured",
                "unavailable"
              ]
            }
          }
        },
        "quality": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "status",
            "notes"
          ],
          "properties": {
            "status": {
              "enum": [
                "unverified",
                "manually-checked",
                "rejected"
              ]
            },
            "notes": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "minItems": 0,
              "maxItems": 50
            },
            "checkedAt": {
              "type": "string",
              "format": "date-time"
            }
          }
        },
        "corrections": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "field",
              "reason",
              "source",
              "at"
            ],
            "properties": {
              "field": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "source": {
                "const": "human-correction"
              },
              "at": {
                "type": "string",
                "format": "date-time"
              }
            }
          },
          "minItems": 0,
          "maxItems": 1000
        }
      }
    },
    "TrainingPhase": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "label",
        "durationSeconds",
        "targetSource",
        "musicEnergyPreference"
      ],
      "properties": {
        "id": {
          "$ref": "#/definitions/Identifier"
        },
        "label": {
          "enum": [
            "warmup",
            "steady",
            "work",
            "rest",
            "cooldown",
            "custom"
          ]
        },
        "durationSeconds": {
          "type": "integer",
          "minimum": 1,
          "maximum": 21600
        },
        "targetSource": {
          "enum": [
            "user-confirmed",
            "illustrative"
          ]
        },
        "musicEnergyPreference": {
          "enum": [
            "low",
            "medium",
            "high",
            "no-preference"
          ]
        },
        "cadenceTargetSpm": {
          "type": "number",
          "minimum": 40,
          "maximum": 300
        }
      }
    },
    "TrainingPlan": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "id",
        "version",
        "activity",
        "source",
        "userConfirmed",
        "phases"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "id": {
          "$ref": "#/definitions/Identifier"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "activity": {
          "const": "running"
        },
        "source": {
          "enum": [
            "user-confirmed",
            "illustrative"
          ]
        },
        "userConfirmed": {
          "type": "boolean"
        },
        "phases": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/TrainingPhase"
          },
          "minItems": 1,
          "maxItems": 100
        }
      }
    },
    "MusicPreference": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "version",
        "slowDownChoice",
        "userConfirmed",
        "updatedAt"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "slowDownChoice": {
          "enum": [
            "energize",
            "ease",
            "original"
          ]
        },
        "userConfirmed": {
          "type": "boolean"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "OnboardingState": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "status",
        "updatedAt"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "status": {
          "enum": [
            "unseen",
            "saved",
            "skipped",
            "closed"
          ]
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "UserFeedback": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "id",
        "kind",
        "value",
        "source",
        "atMilliseconds",
        "isDemo"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "id": {
          "$ref": "#/definitions/Identifier"
        },
        "kind": {
          "enum": [
            "self-report",
            "music-command"
          ]
        },
        "value": {
          "enum": [
            "tired",
            "energize",
            "ease",
            "hold",
            "pause",
            "original"
          ]
        },
        "source": {
          "enum": [
            "tap",
            "voice"
          ]
        },
        "atMilliseconds": {
          "type": "number",
          "minimum": 0
        },
        "isDemo": {
          "type": "boolean"
        }
      }
    },
    "TelemetrySample": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "metric",
        "value",
        "unit",
        "source",
        "timestampMilliseconds",
        "window",
        "quality",
        "qualityReason",
        "isDemo"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "metric": {
          "enum": [
            "cadence",
            "heart-rate"
          ]
        },
        "value": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0,
          "maximum": 400
        },
        "unit": {
          "enum": [
            "steps/min",
            "beats/min"
          ]
        },
        "source": {
          "enum": [
            "accelerometer",
            "manual",
            "mock",
            "ble"
          ]
        },
        "timestampMilliseconds": {
          "type": "number",
          "minimum": 0
        },
        "window": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "startMilliseconds",
            "endMilliseconds",
            "coverageMilliseconds"
          ],
          "properties": {
            "startMilliseconds": {
              "type": "number",
              "minimum": 0
            },
            "endMilliseconds": {
              "type": "number",
              "minimum": 0
            },
            "coverageMilliseconds": {
              "type": "number",
              "minimum": 0
            }
          }
        },
        "quality": {
          "enum": [
            "valid",
            "unverified",
            "stale",
            "invalid",
            "ambiguous"
          ]
        },
        "qualityReason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "isDemo": {
          "type": "boolean"
        }
      }
    },
    "CadenceEvent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "timestampMilliseconds",
        "baselineSpm",
        "changeSpm",
        "ruleVersion",
        "source",
        "isDemo"
      ],
      "properties": {
        "type": {
          "enum": [
            "cadence-decline",
            "recovered"
          ]
        },
        "timestampMilliseconds": {
          "type": "number",
          "minimum": 0
        },
        "baselineSpm": {
          "type": "number",
          "minimum": 40,
          "maximum": 300
        },
        "changeSpm": {
          "type": "number",
          "minimum": -300,
          "maximum": 300
        },
        "ruleVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "source": {
          "enum": [
            "accelerometer",
            "mock",
            "manual"
          ]
        },
        "isDemo": {
          "type": "boolean"
        }
      }
    },
    "BodyContext": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "events"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "cadence": {
          "$ref": "#/definitions/TelemetrySample"
        },
        "heartRate": {
          "$ref": "#/definitions/TelemetrySample"
        },
        "events": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/CadenceEvent"
          },
          "minItems": 0,
          "maxItems": 100
        }
      }
    },
    "ArrangementTrack": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "musicId",
        "audioSha256",
        "analysisVersion",
        "phaseId",
        "timelineStartSeconds",
        "audioStartSeconds",
        "audioEndSeconds",
        "cadenceInterpretation",
        "entryWindowId",
        "exitWindowId",
        "reason"
      ],
      "properties": {
        "musicId": {
          "$ref": "#/definitions/Identifier"
        },
        "audioSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "analysisVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "phaseId": {
          "$ref": "#/definitions/Identifier"
        },
        "timelineStartSeconds": {
          "type": "number",
          "minimum": 0
        },
        "audioStartSeconds": {
          "type": "number",
          "minimum": 0
        },
        "audioEndSeconds": {
          "type": "number",
          "minimum": 0
        },
        "cadenceInterpretation": {
          "enum": [
            "native",
            "half-time",
            "double-time",
            "none"
          ]
        },
        "entryWindowId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "exitWindowId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        }
      }
    },
    "Transition": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "fromIndex",
        "toIndex",
        "fromMusicId",
        "toMusicId",
        "startSeconds",
        "durationSeconds",
        "method",
        "verified",
        "notes"
      ],
      "properties": {
        "fromIndex": {
          "type": "integer",
          "minimum": 0
        },
        "toIndex": {
          "type": "integer",
          "minimum": 0
        },
        "fromMusicId": {
          "$ref": "#/definitions/Identifier"
        },
        "toMusicId": {
          "$ref": "#/definitions/Identifier"
        },
        "startSeconds": {
          "type": "number",
          "minimum": 0
        },
        "durationSeconds": {
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "method": {
          "const": "short-fade"
        },
        "verified": {
          "type": "boolean"
        },
        "notes": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        }
      }
    },
    "Arrangement": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "id",
        "planId",
        "planVersion",
        "preferenceVersion",
        "status",
        "ruleVersion",
        "purpose",
        "isDemo",
        "durationSeconds",
        "tracks",
        "transitions",
        "gaps",
        "explanations"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "id": {
          "$ref": "#/definitions/Identifier"
        },
        "planId": {
          "$ref": "#/definitions/Identifier"
        },
        "planVersion": {
          "type": "integer",
          "minimum": 1
        },
        "preferenceVersion": {
          "type": "integer",
          "minimum": 1
        },
        "status": {
          "enum": [
            "not-run",
            "planned",
            "rejected"
          ]
        },
        "ruleVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "purpose": {
          "enum": [
            "private-test",
            "internal-prototype",
            "public-demo"
          ]
        },
        "isDemo": {
          "type": "boolean"
        },
        "durationSeconds": {
          "type": "number",
          "minimum": 0
        },
        "tracks": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/ArrangementTrack"
          },
          "minItems": 0,
          "maxItems": 500
        },
        "transitions": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/Transition"
          },
          "minItems": 0,
          "maxItems": 500
        },
        "gaps": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000
          },
          "minItems": 0,
          "maxItems": 500
        },
        "explanations": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000
          },
          "minItems": 0,
          "maxItems": 500
        }
      }
    },
    "PlaybackEvent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "atAudioSeconds",
        "source"
      ],
      "properties": {
        "type": {
          "enum": [
            "started",
            "paused",
            "resumed",
            "stopped",
            "ended",
            "track-started",
            "transition-started",
            "error"
          ]
        },
        "atAudioSeconds": {
          "type": "number",
          "minimum": 0
        },
        "musicId": {
          "$ref": "#/definitions/Identifier"
        },
        "source": {
          "const": "audio-clock"
        }
      }
    },
    "SessionMusicRecord": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "id",
        "mode",
        "planId",
        "planVersion",
        "arrangementId",
        "savedByUser",
        "cloudUploadConsent",
        "healthDataConsent",
        "profileUpdateAllowed",
        "startedAt",
        "endedAt",
        "playedEvents",
        "musicFeedback",
        "telemetry",
        "signalSources"
      ],
      "properties": {
        "schemaVersion": {
          "const": "0.2.0"
        },
        "id": {
          "$ref": "#/definitions/Identifier"
        },
        "mode": {
          "enum": [
            "real",
            "demo"
          ]
        },
        "planId": {
          "$ref": "#/definitions/Identifier"
        },
        "planVersion": {
          "type": "integer",
          "minimum": 1
        },
        "arrangementId": {
          "$ref": "#/definitions/Identifier"
        },
        "savedByUser": {
          "const": true
        },
        "cloudUploadConsent": {
          "type": "boolean"
        },
        "healthDataConsent": {
          "const": false
        },
        "profileUpdateAllowed": {
          "type": "boolean"
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "endedAt": {
          "type": "string",
          "format": "date-time"
        },
        "playedEvents": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/PlaybackEvent"
          },
          "minItems": 1,
          "maxItems": 5000
        },
        "musicFeedback": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/UserFeedback"
          },
          "minItems": 0,
          "maxItems": 1000
        },
        "telemetry": {
          "type": "array",
          "maxItems": 0,
          "items": {
            "$ref": "#/definitions/TelemetrySample"
          }
        },
        "signalSources": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "metric",
              "source",
              "isDemo"
            ],
            "properties": {
              "metric": {
                "enum": [
                  "cadence",
                  "heart-rate"
                ]
              },
              "source": {
                "enum": [
                  "accelerometer",
                  "manual",
                  "mock",
                  "ble"
                ]
              },
              "isDemo": {
                "type": "boolean"
              }
            }
          },
          "minItems": 0,
          "maxItems": 10
        }
      }
    }
  }
};

}};
registry["miniprogram/config/rules.js"]={loaded:false,exports:{},fn:function(module,exports,require){
'use strict';

module.exports = Object.freeze({
  version: 'pulsecraft-rules-0.2.0',
  minTrackSeconds: 45,
  windowSearchSeconds: 60,
  fadeSeconds: 2,
  freezeSeconds: 10,
  replanIntervalSeconds: 30,
  cadenceWindowMilliseconds: 10000,
  cadenceMinCoverageMilliseconds: 8000,
  signalStaleMilliseconds: 5000,
  baselineSeconds: 10,
  baselineSpreadSpm: 5,
  declineSpm: 5,
  declineHoldSeconds: 10,
  recoverBandSpm: 2,
  recoverHoldSeconds: 10,
  asrMaxSeconds: 8,
  asrMaxRequestsPerSession: 10
});

}};
registry["miniprogram/domain/hash.js"]={loaded:false,exports:{},fn:function(module,exports,require){
'use strict';
function failure(code,message) { var e=new Error(message); e.code=code; e.userSafe=true; return e; }
function toBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw failure('FILE_INVALID', '需要二进制音频数据。');
}
function sha256(input) {
  var bytes = toBytes(input), count = bytes.length;
  var size = Math.ceil((count + 9) / 64) * 64;
  var tail = new Uint8Array(128), words = new Int32Array(64);
  var constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  function rotate(x, n) { return (x >>> n) | (x << (32 - n)); }
  var full = count - count % 64;
  tail.set(bytes.subarray(full)); tail[count-full] = 128;
  var tailSize = size-full, bitLength = count * 8;
  var view = new DataView(tail.buffer);
  view.setUint32(tailSize-8, Math.floor(bitLength/4294967296)); view.setUint32(tailSize-4, bitLength >>> 0);
  for (var base = 0; base < size; base += 64) {
    var block = base < full ? bytes.subarray(base,base+64) : tail.subarray(base-full,base-full+64);
    for (var i = 0; i < 16; i++) words[i] = (block[i*4]<<24)|(block[i*4+1]<<16)|(block[i*4+2]<<8)|block[i*4+3];
    for (i = 16; i < 64; i++) {
      var x = words[i-15], y = words[i-2];
      words[i] = (words[i-16] + (rotate(x,7)^rotate(x,18)^(x>>>3)) + words[i-7] + (rotate(y,17)^rotate(y,19)^(y>>>10))) | 0;
    }
    var a=hash[0],b=hash[1],c=hash[2],d=hash[3],e=hash[4],f=hash[5],g=hash[6],h=hash[7];
    for (i=0;i<64;i++) {
      var t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i])|0;
      var t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;
      h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }
    hash=[(hash[0]+a)|0,(hash[1]+b)|0,(hash[2]+c)|0,(hash[3]+d)|0,(hash[4]+e)|0,(hash[5]+f)|0,(hash[6]+g)|0,(hash[7]+h)|0];
  }
  return hash.map(function (n) { return ('00000000'+(n>>>0).toString(16)).slice(-8); }).join('');
}
function sha256Text(value) {
  var encoded=encodeURIComponent(value), bytes=[];
  for (var i=0;i<encoded.length;i++) {
    if (encoded[i]==='%') { bytes.push(parseInt(encoded.slice(i+1,i+3),16)); i+=2; }
    else bytes.push(encoded.charCodeAt(i));
  }
  return sha256(new Uint8Array(bytes));
}
module.exports={sha256:sha256,sha256Text:sha256Text,toBytes:toBytes};

}};
registry["miniprogram/config/runtime.js"]={loaded:false,exports:{},fn:function(module,exports,require){
module.exports = Object.freeze({
  productName: 'PulseCraft',
  schemaVersion: '0.2.0',
  buildStage: 'foreground-prototype-pending-device',
  cloudEnvId: '',
  storageKey: 'pulsecraft_local_v2',
  purpose: 'private-test',
  // 2026-10-09 albert 决定直接点亮（提交优先）：趋势曲线随播放自动开录；真实设备证据（G2 三轮）后补，不标"通过"。
  playbackGatePassed: true,
  sensorDeviceVerified: true,
  asrConfigured: false,
  healthUploadEnabled: false,
  sessionBackgroundAudio: true
});

}};
registry["miniprogram/services/arrangement-view.js"]={loaded:false,exports:{},fn:function(module,exports,require){
'use strict';
// 编排展示层（页面侧，只读）：把 Arrangement + 目录数据转成用户能看懂的展示行。
// 不改共享契约；候选与模型段边界一律保留"未经听核"诚实标注。
var ENERGY = { low: { label: '轻', level: 0 }, medium: { label: '中', level: 1 }, high: { label: '强', level: 2 }, unknown: { label: '未知', level: null } };
function time(seconds) { return Math.floor(seconds / 60) + ':' + ('0' + Math.floor(seconds % 60)).slice(-2); }
function isCandidate(analysis) {
  return Boolean(analysis) && typeof analysis.analysisVersion === 'string' && /^small0-candidate-/.test(analysis.analysisVersion);
}
function energyOf(analysis) {
  var label = analysis && analysis.energy && analysis.energy.label;
  return ENERGY[label] ? label : 'unknown';
}
function badgeFor(analysis) {
  if (!analysis) return '无可用分析';
  if (analysis.method === 'manual-reference') return '人工参考 · 已听核';
  if (isCandidate(analysis)) return '模型候选 · 未经听核';
  return '已导入分析';
}
function repeatCount(tracks, index) {
  var id = tracks[index].musicId, count = 0;
  for (var i = 0; i <= index; i++) if (tracks[i].musicId === id) count++;
  return count;
}
function rows(arrangement, references, analyses) {
  if (!arrangement || !Array.isArray(arrangement.tracks)) return [];
  references = references || []; analyses = analyses || [];
  var result = [];
  arrangement.tracks.forEach(function (track, index) {
    var ref = references.find(function (r) { return r.id === track.musicId && r.audio.sha256 === track.audioSha256; });
    var analysis = analyses.find(function (a) { return a.musicId === track.musicId && a.analysisVersion === track.analysisVersion; });
    var duration = Math.max(0, track.audioEndSeconds - track.audioStartSeconds);
    var marks = [];
    (analysis && analysis.segments || []).forEach(function (s) {
      if (Number.isFinite(s.startSeconds) && s.startSeconds > track.audioStartSeconds + 0.01 && s.startSeconds < track.audioEndSeconds - 0.01) {
        marks.push({ at: time(s.startSeconds - track.audioStartSeconds), pct: duration ? Math.round((s.startSeconds - track.audioStartSeconds) / duration * 100) : 0, verified: false });
      }
    });
    if (analysis && !isCandidate(analysis) && Array.isArray(analysis.windows)) {
      analysis.windows.forEach(function (w) {
        if (w.checkedByListening && Number.isFinite(w.anchorSeconds) && w.anchorSeconds > track.audioStartSeconds + 0.01 && w.anchorSeconds < track.audioEndSeconds - 0.01) {
          marks.push({ at: time(w.anchorSeconds - track.audioStartSeconds), pct: duration ? Math.round((w.anchorSeconds - track.audioStartSeconds) / duration * 100) : 0, verified: true });
        }
      });
    }
    marks.sort(function (a, b) { return a.pct - b.pct; });
    result.push({
      index: index, musicId: track.musicId, title: ref ? ref.title : '未知曲目',
      energyLabel: ENERGY[energyOf(analysis)].label, energy: energyOf(analysis),
      badge: badgeFor(analysis), candidate: isCandidate(analysis),
      repeat: repeatCount(arrangement.tracks, index),
      start: time(track.timelineStartSeconds), duration: time(duration), durationSeconds: duration, timelineStart: track.timelineStartSeconds,
      reason: track.reason || '', bpmRule: /BPM规则/.test(track.reason || ''),
      marks: marks,
      transition: index < (arrangement.transitions || []).length,
      transitionNote: (arrangement.transitions || [])[index] ? arrangement.transitions[index].notes : ''
    });
  });
  return result;
}
function rulesText() {
  return '· 按你选的偏好方向定档：更有劲＝往强一档，轻一点＝往轻一档，保持原样＝按运动阶段原档。\n'
    + '· 同档歌曲里，按节奏方向选：更有劲＝优先更快的BPM，轻一点＝优先更舒缓的BPM。\n'
    + '· 同一首歌不会连着播两次；若重复出现，会标出"第N次"。\n'
    + '· 播放中调整时，优先在当前歌曲最近合适的段落边界换歌；边界来自模型段结构的会标注"未经听核"。';
}
module.exports = { rows: rows, rulesText: rulesText, time: time, energyOf: energyOf, badgeFor: badgeFor, ENERGY: ENERGY };

}};
registry["miniprogram/services/trend-view.js"]={loaded:false,exports:{},fn:function(module,exports,require){
'use strict';
var contracts = require('../domain/contracts');
var rules = require('../config/rules');

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function label(value) { return finite(value) ? String(Math.round(value)) : '—'; }
function timeLabel(seconds) { return Math.floor(seconds / 60) + ':' + ('0' + Math.floor(seconds % 60)).slice(-2); }

// Uses the current audio window, including repeated songs and overlap transitions.
// BPM is the existing analysis at that audio position, not a live microphone measurement.
function playingTempo(snapshot, draft) {
  if (!snapshot || !draft || !draft.arrangement || !snapshot.currentMusicId) return null;
  // The public background snapshot omits trackIndex/fileSeconds and clamps the
  // arrangement clock. That cannot establish an exact audio position at a tail.
  if (snapshot.backgroundHandoff) return null;
  var at = finite(snapshot.arrangementElapsedSeconds) ? snapshot.arrangementElapsedSeconds : snapshot.elapsedSeconds;
  if (!finite(at)) return null;
  var track = null;
  draft.arrangement.tracks.forEach(function (candidate) {
    var end = candidate.timelineStartSeconds + candidate.audioEndSeconds - candidate.audioStartSeconds;
    if (candidate.musicId === snapshot.currentMusicId && candidate.timelineStartSeconds <= at && at < end) track = candidate;
  });
  if (!track) return null;
  var analysis = (draft.analyses || []).find(function (candidate) {
    return candidate.musicId === track.musicId && candidate.audioSha256 === track.audioSha256 && candidate.analysisVersion === track.analysisVersion;
  });
  if (!analysis) return null;
  var audioPosition = track.audioStartSeconds + at - track.timelineStartSeconds;
  var tempo = (analysis.localTempo || []).find(function (segment) { return segment.startSeconds <= audioPosition && audioPosition < segment.endSeconds; });
  return tempo && finite(tempo.bpm) && tempo.bpm > 0 && tempo.bpm <= 400 ? tempo.bpm : null;
}

function realCadence(sample, now) {
  if (!sample) return null;
  try { contracts.assertValid('TelemetrySample', sample); } catch (ignored) { return null; }
  if (sample.metric !== 'cadence' || sample.unit !== 'steps/min' || sample.source !== 'accelerometer' || sample.isDemo !== false || sample.quality !== 'valid') return null;
  if (sample.timestampMilliseconds > now || now - sample.timestampMilliseconds > rules.signalStaleMilliseconds) return null;
  return finite(sample.value) && sample.value > 0 ? sample.value : null;
}

function createTrendStore(options) {
  options = options || {};
  var maxPoints = Math.max(32, Math.min(1200, Math.floor(options.maxPoints || 600)));
  var music = [], cadence = [], lastElapsed = null, displayElapsed = 0, bpm = null, spm = null, duration = 0;
  var musicInterval = 1, cadenceInterval = 1, latestSampleTime = -1;
  function bounded(series) {
    if (series.length <= maxPoints) return;
    var reduced = [series[0]];
    // Keep the full time span; a bucket containing missing data remains a gap.
    for (var i = 1; i < series.length - 1; i += 2) {
      var first = series[i], second = series[Math.min(i + 1, series.length - 2)];
      reduced.push({ t: second.t, value: first.value === null || second.value === null ? null : second.value });
    }
    reduced.push(series[series.length - 1]);
    series.splice.apply(series, [0, series.length].concat(reduced));
    if (series === music) musicInterval = Math.min(60, musicInterval * 2);
    else cadenceInterval = Math.min(60, cadenceInterval * 2);
  }
  function add(series, t, value, force) {
    var previous = series[series.length - 1];
    if (previous && previous.t === t && previous.value === value) return;
    if (previous && t < previous.t) return;
    var gapChanged = previous && (previous.value === null) !== (value === null);
    var interval = series === music ? musicInterval : cadenceInterval;
    if (previous && !force && !gapChanged && t - previous.t < interval) return;
    series.push({ t: t, value: value }); bounded(series);
  }
  function model() {
    var elapsed = displayElapsed;
    return { elapsedSeconds: elapsed, durationSeconds: duration, plotEndSeconds: Math.max(60, duration, elapsed),
      bpm: bpm, cadence: spm, bpmLabel: label(bpm), cadenceLabel: label(spm), elapsedLabel: timeLabel(elapsed),
      musicSeries: music.map(function (point) { return { t: point.t, value: point.value }; }),
      cadenceSeries: cadence.map(function (point) { return { t: point.t, value: point.value }; }) };
  }
  return {
    observe: function (input) {
      input = input || {};
      var snapshot = input.snapshot || {}, now = finite(input.nowMilliseconds) ? input.nowMilliseconds : Date.now();
      var at = finite(snapshot.elapsedSeconds) ? Math.max(0, snapshot.elapsedSeconds) : 0;
      duration = finite(snapshot.durationSeconds) ? Math.max(0, snapshot.durationSeconds) : duration;
      if (['playing', 'paused', 'ended', 'stopped', 'error'].indexOf(snapshot.status) >= 0) displayElapsed = Math.max(displayElapsed, at);
      // Never manufacture elapsed time from a UI timer. A paused player leaves history still.
      var active = snapshot.status === 'playing' && snapshot.playing === true;
      if (!active) { spm = null; if (snapshot.status !== 'paused') bpm = null; return model(); }
      if (lastElapsed !== null && at < lastElapsed) return model();
      var sample = input.cadenceSample;
      var sampleTime = sample && sample.timestampMilliseconds;
      spm = realCadence(sample, now);
      if (spm !== null && sampleTime < latestSampleTime) spm = null;
      if (spm !== null) latestSampleTime = sampleTime;
      bpm = playingTempo(snapshot, input.draft);
      // Returning from a background interval adds only the actual new observation.
      // A gap prevents a line from implying uninterrupted sensor or music measurements.
      if (lastElapsed !== null && at - lastElapsed > 5) {
        add(music, lastElapsed + 0.001, null, true); add(cadence, lastElapsed + 0.001, null, true);
      }
      add(music, at, bpm, false); add(cadence, at, spm, false); lastElapsed = at;
      return model();
    },
    getView: model,
    reset: function () { music = []; cadence = []; lastElapsed = null; displayElapsed = 0; bpm = null; spm = null; duration = 0; musicInterval = 1; cadenceInterval = 1; latestSampleTime = -1; return model(); },
    dispose: function () { music = []; cadence = []; lastElapsed = null; displayElapsed = 0; bpm = null; spm = null; duration = 0; musicInterval = 1; cadenceInterval = 1; latestSampleTime = -1; }
  };
}

function valueAt(series, seconds) {
  if (!series || !series.length || seconds < series[0].t || seconds > series[series.length - 1].t) return null;
  var value = null;
  for (var i = 0; i < series.length && series[i].t <= seconds; i++) value = series[i].value;
  return value;
}
function inspectAt(model, seconds) {
  var at = Math.max(0, Math.min(model.elapsedSeconds, seconds));
  var bpm = valueAt(model.musicSeries, at), cadence = valueAt(model.cadenceSeries, at);
  return { seconds: at, timeLabel: timeLabel(at), bpm: bpm, cadence: cadence, bpmLabel: label(bpm), cadenceLabel: label(cadence) };
}
module.exports = { createTrendStore: createTrendStore, playingTempo: playingTempo, inspectAt: inspectAt };

}};
registry["miniprogram/services/trend-chart.js"]={loaded:false,exports:{},fn:function(module,exports,require){
'use strict';
var view = require('./trend-view');
function layout(width, height) {
  var scale = width / 638;
  return { scale: scale, left: 56 * scale, right: width - 14 * scale, top: 100 * scale, bottom: height - 44 * scale, gap: 120 * scale };
}
function cursorAtX(x, width, model) {
  var area = layout(width, 200);
  return Math.max(0, Math.min(model.elapsedSeconds, (x - area.left) / (area.right - area.left) * model.plotEndSeconds));
}
function drawChart(ctx, model, width, height, cursorSeconds) {
  if (!ctx || !model || width < 80 || height < 100) return;
  var area = layout(width, height), band = (area.bottom - area.top - area.gap) / 2;
  if (band <= 0) return;
  var detail = typeof cursorSeconds === 'number' && Number.isFinite(cursorSeconds) ? view.inspectAt(model, cursorSeconds) : model;
  var axisFont = Math.max(11, 20 * area.scale), headerFont = 36 * area.scale, valueFont = 56 * area.scale, unitFont = 24 * area.scale;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  ctx.font = axisFont + 'px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  var scales = [];
  function plot(series, title, current, unit, color, fill, top, defaultMin, defaultMax) {
    var values = series.filter(function (point) { return point.value !== null; }).map(function (point) { return point.value; });
    var min = values.length ? Math.floor((Math.min.apply(Math, values) - 10) / 10) * 10 : defaultMin;
    var max = values.length ? Math.ceil((Math.max.apply(Math, values) + 10) / 10) * 10 : defaultMax;
    min = Math.max(0, min); max = Math.max(min + 20, max);
    scales.push({ top: top, min: min, max: max, color: color, series: series });
    var headerY = top - 54 * area.scale;
    ctx.font = '600 ' + headerFont + 'px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = color;
    ctx.fillText(title, area.left, headerY);
    ctx.font = unitFont + 'px sans-serif';
    var unitWidth = typeof ctx.measureText === 'function' ? ctx.measureText(unit).width : unit.length * unitFont;
    ctx.textAlign = 'right'; ctx.fillStyle = '#939b96'; ctx.fillText(unit, area.right, headerY + 4 * area.scale);
    ctx.font = '600 ' + valueFont + 'px sans-serif'; ctx.fillStyle = color;
    ctx.fillText(current, area.right - unitWidth - 12 * area.scale, headerY);
    ctx.font = axisFont + 'px sans-serif'; ctx.textAlign = 'right';
    for (var i = 0; i < 3; i++) {
      var y = top + band * i / 2;
      ctx.beginPath(); ctx.strokeStyle = '#e9eeeb'; ctx.lineWidth = 1; ctx.moveTo(area.left, y); ctx.lineTo(area.right, y); ctx.stroke();
      ctx.fillStyle = '#939b96'; ctx.fillText(String(Math.round(max - (max - min) * i / 2)), area.left - 12 * area.scale, y);
    }
    var segment = [];
    function fillSegment() {
      if (segment.length > 1) {
        ctx.beginPath(); ctx.fillStyle = fill;
        ctx.moveTo(segment[0].x, top + band);
        segment.forEach(function (point) { ctx.lineTo(point.x, point.y); });
        ctx.lineTo(segment[segment.length - 1].x, top + band); ctx.closePath(); ctx.fill();
      }
      segment = [];
    }
    series.forEach(function (point) {
      if (point.value === null) { fillSegment(); return; }
      segment.push({ x: area.left + point.t / model.plotEndSeconds * (area.right - area.left), y: top + (max - point.value) / (max - min) * band });
    }); fillSegment();
    var connected = false;
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
    series.forEach(function (point) {
      if (point.value === null) { connected = false; return; }
      var x = area.left + point.t / model.plotEndSeconds * (area.right - area.left);
      var y = top + (max - point.value) / (max - min) * band;
      if (connected) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      connected = true;
    }); ctx.stroke();
    // A single received point is still visible; there is no invented connecting curve.
    series.forEach(function (point, index) {
      if (point.value === null || (index > 0 && series[index - 1].value !== null) || (series[index + 1] && series[index + 1].value !== null)) return;
      ctx.beginPath(); ctx.fillStyle = color; ctx.arc(area.left + point.t / model.plotEndSeconds * (area.right - area.left), top + (max - point.value) / (max - min) * band, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    if (!values.length) { ctx.fillStyle = '#939b96'; ctx.textAlign = 'left'; ctx.fillText('暂无数据', area.left + 8, top + band / 2); }
  }
  plot(model.cadenceSeries, '步频', detail.cadenceLabel, '步/分', '#12583f', 'rgba(18,88,63,0.08)', area.top, 100, 200);
  plot(model.musicSeries, '音乐节奏', detail.bpmLabel, 'BPM', '#626975', 'rgba(98,105,117,0.08)', area.top + band + area.gap, 60, 160);
  ctx.font = axisFont + 'px sans-serif';
  for (var tick = 0; tick < 3; tick++) {
    var seconds = model.plotEndSeconds * tick / 2;
    ctx.textAlign = tick === 0 ? 'left' : tick === 2 ? 'right' : 'center';
    ctx.fillStyle = '#939b96'; ctx.fillText(('0' + Math.floor(seconds / 60)).slice(-2) + ':' + ('0' + Math.floor(seconds % 60)).slice(-2), area.left + (area.right - area.left) * tick / 2, height - 18 * area.scale);
  }
  if (typeof cursorSeconds === 'number' && Number.isFinite(cursorSeconds)) {
    var cursorX = area.left + detail.seconds / model.plotEndSeconds * (area.right - area.left);
    ctx.beginPath(); ctx.strokeStyle = '#99b2a5'; ctx.lineWidth = 1;
    if (ctx.setLineDash) ctx.setLineDash([3, 3]); ctx.moveTo(cursorX, area.top); ctx.lineTo(cursorX, area.bottom); ctx.stroke(); if (ctx.setLineDash) ctx.setLineDash([]);
    scales.forEach(function (scale) {
      var value = scale.series === model.musicSeries ? detail.bpm : detail.cadence;
      if (value === null) return;
      ctx.beginPath(); ctx.fillStyle = scale.color; ctx.arc(cursorX, scale.top + (scale.max - value) / (scale.max - scale.min) * band, 3, 0, Math.PI * 2); ctx.fill();
    });
  }
}
module.exports = { drawChart: drawChart, cursorAtX: cursorAtX };

}};
registry["miniprogram/catalog/ten-song-private-test.manifest.js"]={loaded:false,exports:{},fn:function(module,exports,require){
// 十首私人测试内嵌清单（设备侧，miniprogram 运行时使用）
// 2026-10-07 由 Claude 从 main 的两份交接 JSON 机械生成：
//   analysis/catalog.listening-private-test.json（2首已听核 manual-reference，微信时间基准）
//   analysis/catalog.model-candidate.json（8首 small0-candidate：FFmpeg 坐标、窗口与段边界均未经听核）
// 诚实边界：8首候选 decodeMethod 为 ffmpeg，运行时按自然开头/结尾播放并钳制到实际解码时长；
// 2026-10-07 用户授权跑通链路：8首候选的 energy 为豆包v4模型候选标签（未经人评校准、存在已知偏高偏差），
// 仅用于开发链路，不代表听核结论；未经听核的内容一律在界面标注”模型候选 · 未经听核”。
// Codex 后续 handoff 产物可覆盖本文件。
'use strict';
module.exports = {
  "schemaVersion": "0.2.0",
  "references": [
    {
      "schemaVersion": "0.2.0",
      "id": "song-261c943afe3c29ccd81f",
      "title": "红豆",
      "artist": "王菲",
      "version": "sha256:261c943afe3c29ccd81f3073721b121df60f6ab877a530b14e612989a7e124c7",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "261c943afe3c29ccd81f3073721b121df60f6ab877a530b14e612989a7e124c7",
        "durationSeconds": 256.02666666666664,
        "offsetSeconds": 0,
        "decodeMethod": "wx.createWebAudioContext.decodeAudioData"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-fe069a3eee056056e49f",
      "title": "Enemy",
      "artist": "Imagine Dragons.JID",
      "version": "sha256:fe069a3eee056056e49f1f45976fd1c2ab6b7989793ee0b3e2371a31382d4762",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "fe069a3eee056056e49f1f45976fd1c2ab6b7989793ee0b3e2371a31382d4762",
        "durationSeconds": 173.38124716553287,
        "offsetSeconds": 0,
        "decodeMethod": "wx.createWebAudioContext.decodeAudioData"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-115662b177d4892cfd89",
      "title": "我是如此相信",
      "artist": "周杰伦",
      "version": "sha256:115662b177d4892cfd89f547b5ad575e4b511d8bb6a503ca99eccdb2b5dabc61",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "115662b177d4892cfd89f547b5ad575e4b511d8bb6a503ca99eccdb2b5dabc61",
        "durationSeconds": 266.3827664399093,
        "offsetSeconds": 0,
        "decodeMethod": "ffmpeg-f32le-mono-22050"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-8b8251a7f78e32735593",
      "title": "Payphone",
      "artist": "Maroon 5",
      "version": "sha256:8b8251a7f78e32735593ab738031bc45e1ec4a3c2f80f1418ece5e60c41d6038",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "8b8251a7f78e32735593ab738031bc45e1ec4a3c2f80f1418ece5e60c41d6038",
        "durationSeconds": 231.46666666666667,
        "offsetSeconds": 0,
        "decodeMethod": "ffmpeg-f32le-mono-22050"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-94d23acb31a5ea7430d3",
      "title": "The Way You Make Me Feel",
      "artist": "Michael Jackson",
      "version": "sha256:94d23acb31a5ea7430d30fb7ce01db57037c1db7ee6d756965bedc547e0035d0",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "94d23acb31a5ea7430d30fb7ce01db57037c1db7ee6d756965bedc547e0035d0",
        "durationSeconds": 298.1219954648526,
        "offsetSeconds": 0,
        "decodeMethod": "ffmpeg-f32le-mono-22050"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-9d9e4b6a0ea2681ae8ae",
      "title": "记得",
      "artist": "林俊杰",
      "version": "sha256:9d9e4b6a0ea2681ae8aeeee1ffa7a118581949c03e5f28e9b8716adb7de51746",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "9d9e4b6a0ea2681ae8aeeee1ffa7a118581949c03e5f28e9b8716adb7de51746",
        "durationSeconds": 287.84,
        "offsetSeconds": 0,
        "decodeMethod": "ffmpeg-f32le-mono-22050"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-a5fa64a7bd567b2b3385",
      "title": "蝴蝶",
      "artist": "陶喆",
      "version": "sha256:a5fa64a7bd567b2b3385bf93d922b556fcc8ce5c5bb3fa15650e91657196aa61",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "a5fa64a7bd567b2b3385bf93d922b556fcc8ce5c5bb3fa15650e91657196aa61",
        "durationSeconds": 283.2,
        "offsetSeconds": 0,
        "decodeMethod": "ffmpeg-f32le-mono-22050"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-b3e113acf45c94436a9d",
      "title": "路...",
      "artist": "陈奕迅",
      "version": "sha256:b3e113acf45c94436a9d1d6599aea25826d6ae53ac7ee8dbedf51de8eaed8198",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "b3e113acf45c94436a9d1d6599aea25826d6ae53ac7ee8dbedf51de8eaed8198",
        "durationSeconds": 278.3066666666667,
        "offsetSeconds": 0,
        "decodeMethod": "ffmpeg-f32le-mono-22050"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-e684868f49202ef811b6",
      "title": "Dancing With Your Ghost",
      "artist": "Sasha Alex Sloan",
      "version": "sha256:e684868f49202ef811b6a32d2c51f470fa516b67c35fc22cffb7d98fe34c393f",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "e684868f49202ef811b6a32d2c51f470fa516b67c35fc22cffb7d98fe34c393f",
        "durationSeconds": 197.7324716553288,
        "offsetSeconds": 0,
        "decodeMethod": "ffmpeg-f32le-mono-22050"
      }
    },
    {
      "schemaVersion": "0.2.0",
      "id": "song-ee87db9502fc2eb535d1",
      "title": "如约而至",
      "artist": "许嵩",
      "version": "sha256:ee87db9502fc2eb535d1072806eb0400c51839b4845323df439ec1adebdd6ce3",
      "source": "用户本人的红心歌单（用户在对话中说明，来源平台未登记）",
      "rights": {
        "playback": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "analysis": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "mixing": {
          "status": "approved-for-current-purpose",
          "scope": "private-test",
          "evidence": "用户2026-10-05在对话中确认（台账记录于该时刻，确认发生在此前不久）：这10首作为其红心歌单，可用于本次产品私人测试（播放、分析、接歌混音）。",
          "confirmedAt": "2026-10-05T09:46:54.000Z"
        },
        "distribution": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        },
        "demonstration": {
          "status": "unverified",
          "scope": "none",
          "evidence": "来源与此用途尚未确认；文件存在不能证明许可。"
        }
      },
      "audio": {
        "availability": "unavailable",
        "sha256": "ee87db9502fc2eb535d1072806eb0400c51839b4845323df439ec1adebdd6ce3",
        "durationSeconds": 255.70861678004536,
        "offsetSeconds": 0,
        "decodeMethod": "ffmpeg-f32le-mono-22050"
      }
    }
  ],
  "analyses": [
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-261c943afe3c29ccd81f",
      "audioSha256": "261c943afe3c29ccd81f3073721b121df60f6ab877a530b14e612989a7e124c7",
      "analysisVersion": "manual-windows-listening-e5a98b153020-model-segments-small0-candidate-eec6fb4c929d",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 256.02666666666664,
        "decodeMethod": "wx.createWebAudioContext.decodeAudioData",
        "offsetSeconds": 0
      },
      "method": "manual-reference",
      "tool": {
        "name": "人工接歌时间参考",
        "version": "1",
        "modelVersion": "not-applicable",
        "parameterVersion": "manual-reference-initial-playback-0.2.0",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [],
      "downbeatsSeconds": [],
      "localTempo": [],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 16,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 16,
          "endSeconds": 38,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 38,
          "endSeconds": 58,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 58,
          "endSeconds": 91,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 91,
          "endSeconds": 117,
          "label": "candidate-5",
          "provenance": "candidate"
        },
        {
          "startSeconds": 117,
          "endSeconds": 227,
          "label": "candidate-6",
          "provenance": "candidate"
        },
        {
          "startSeconds": 227,
          "endSeconds": 256.02666666666664,
          "label": "candidate-7",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "initial-entry",
          "kind": "entry",
          "startSeconds": 8.6,
          "endSeconds": 10.6,
          "anchorSeconds": 8.6,
          "checkedByListening": true,
          "checkedAt": "2026-10-05T14:51:25Z",
          "vocalOverlapRisk": "low",
          "provenance": "manual-reference"
        },
        {
          "id": "initial-exit",
          "kind": "exit",
          "startSeconds": 245.08,
          "endSeconds": 247.08,
          "anchorSeconds": 247.08,
          "checkedByListening": true,
          "checkedAt": "2026-10-05T14:51:25Z",
          "vocalOverlapRisk": "low",
          "provenance": "manual-reference"
        }
      ],
      "energy": {
        "label": "low",
        "method": "manual-relative",
        "definitionVersion": "manual-relative-v1"
      },
      "loudness": {
        "relativeLufs": -13.86,
        "headroomDb": 0,
        "provenance": "measured"
      },
      "quality": {
        "status": "manually-checked",
        "checkedAt": "2026-10-05T14:51:25Z",
        "notes": [
          "仅接歌窗口与听感已获用户确认；无人工完整节拍，也不声称模型精度通过。",
          "音乐能量来自用户实际听感；响度为FFmpeg物理测量，两者分别记录。",
          "模型段结构（未经听核）仅用于段级切换；接歌窗口保持人工听核。"
        ]
      },
      "corrections": [
        {
          "field": "segments",
          "reason": "接入模型段结构（small0-candidate-eec6fb4c929d，未经听核）用于段级切换；接歌窗口仍为人工听核。",
          "source": "human-correction",
          "at": "2026-10-08T16:38:07.202Z"
        }
      ]
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-fe069a3eee056056e49f",
      "audioSha256": "fe069a3eee056056e49f1f45976fd1c2ab6b7989793ee0b3e2371a31382d4762",
      "analysisVersion": "manual-windows-listening-148899153e79-model-segments-small0-candidate-accdc60a34c3",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 173.38124716553287,
        "decodeMethod": "wx.createWebAudioContext.decodeAudioData",
        "offsetSeconds": 0
      },
      "method": "manual-reference",
      "tool": {
        "name": "人工接歌时间参考",
        "version": "1",
        "modelVersion": "not-applicable",
        "parameterVersion": "manual-reference-initial-playback-0.2.0",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [],
      "downbeatsSeconds": [],
      "localTempo": [],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 16,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 16,
          "endSeconds": 31,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 31,
          "endSeconds": 82,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 82,
          "endSeconds": 119,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 119,
          "endSeconds": 173.38124716553287,
          "label": "candidate-5",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "initial-entry",
          "kind": "entry",
          "startSeconds": 4.06,
          "endSeconds": 6.06,
          "anchorSeconds": 4.06,
          "checkedByListening": true,
          "checkedAt": "2026-10-05T14:51:25Z",
          "vocalOverlapRisk": "low",
          "provenance": "manual-reference"
        },
        {
          "id": "initial-exit",
          "kind": "exit",
          "startSeconds": 169.36,
          "endSeconds": 171.36,
          "anchorSeconds": 171.36,
          "checkedByListening": true,
          "checkedAt": "2026-10-05T14:51:25Z",
          "vocalOverlapRisk": "low",
          "provenance": "manual-reference"
        }
      ],
      "energy": {
        "label": "high",
        "method": "manual-relative",
        "definitionVersion": "manual-relative-v1"
      },
      "loudness": {
        "relativeLufs": -8.17,
        "headroomDb": 0,
        "provenance": "measured"
      },
      "quality": {
        "status": "manually-checked",
        "checkedAt": "2026-10-05T14:51:25Z",
        "notes": [
          "仅接歌窗口与听感已获用户确认；无人工完整节拍，也不声称模型精度通过。",
          "音乐能量来自用户实际听感；响度为FFmpeg物理测量，两者分别记录。",
          "模型段结构（未经听核）仅用于段级切换；接歌窗口保持人工听核。"
        ]
      },
      "corrections": [
        {
          "field": "segments",
          "reason": "接入模型段结构（small0-candidate-accdc60a34c3，未经听核）用于段级切换；接歌窗口仍为人工听核。",
          "source": "human-correction",
          "at": "2026-10-08T16:38:07.202Z"
        }
      ]
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-115662b177d4892cfd89",
      "audioSha256": "115662b177d4892cfd89f547b5ad575e4b511d8bb6a503ca99eccdb2b5dabc61",
      "analysisVersion": "small0-candidate-f2df901a5a49",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 266.3827664399093,
        "decodeMethod": "ffmpeg-f32le-mono-22050",
        "offsetSeconds": 0
      },
      "method": "trained-model",
      "tool": {
        "name": "Beat This!",
        "version": "1.1.0@ad7974846029835307ba19a3d5cefbf40b243041",
        "modelVersion": "small0@sha256:6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
        "parameterVersion": "pulsecraft-source-candidate-0.2.0-cpu-minimal-50fps",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [
        6.18,
        7.04,
        7.86,
        8.7,
        9.6,
        10.46,
        11.34,
        12.2,
        13.08,
        13.92,
        14.78,
        15.68,
        16.54,
        17.4,
        18.28,
        19.16,
        20.02,
        20.9,
        21.78,
        22.64,
        23.52,
        24.38,
        25.26,
        26.14,
        27,
        27.88,
        28.74,
        29.6,
        30.04,
        30.5,
        30.92,
        31.36,
        31.78,
        32.22,
        32.66,
        33.12,
        33.54,
        33.96,
        34.84,
        35.24,
        35.64,
        36.08,
        36.54,
        36.98,
        37.4,
        37.84,
        38.28,
        38.7,
        39.16,
        39.58,
        40.02,
        40.46,
        40.88,
        41.32,
        41.76,
        42.18,
        42.62,
        43.04,
        43.5,
        43.92,
        44.38,
        44.8,
        45.24,
        45.66,
        46.1,
        46.54,
        46.98,
        47.4,
        47.84,
        48.28,
        48.72,
        49.16,
        49.58,
        50.02,
        50.46,
        50.9,
        51.32,
        51.76,
        52.2,
        52.62,
        53.06,
        53.48,
        53.92,
        54.36,
        54.8,
        55.24,
        55.66,
        56.1,
        56.52,
        56.96,
        57.42,
        57.84,
        58.28,
        58.72,
        59.14,
        60,
        60.88,
        61.74,
        62.62,
        63.5,
        64.36,
        65.24,
        66.1,
        66.98,
        67.84,
        68.72,
        69.58,
        70.44,
        71.32,
        72.62,
        73.06,
        73.92,
        74.36,
        74.8,
        76.1,
        76.54,
        76.98,
        77.4,
        78.26,
        79.14,
        79.56,
        80,
        80.88,
        81.74,
        82.62,
        83.48,
        84.36,
        85.24,
        86.1,
        86.98,
        87.84,
        88.7,
        89.6,
        90.02,
        90.46,
        90.9,
        91.34,
        92.2,
        92.62,
        93.06,
        93.5,
        93.92,
        94.78,
        95.68,
        96.54,
        97.42,
        98.26,
        99.16,
        100.02,
        100.88,
        101.74,
        102.62,
        103.48,
        104.36,
        105.22,
        106.12,
        106.96,
        107.84,
        108.7,
        109.58,
        110.44,
        111.32,
        112.18,
        113.06,
        113.92,
        114.8,
        115.66,
        116.54,
        117.4,
        118.28,
        119.14,
        119.58,
        120,
        120.46,
        120.88,
        121.32,
        121.76,
        122.2,
        122.62,
        123.06,
        123.5,
        123.94,
        124.36,
        125.24,
        126.1,
        126.54,
        126.98,
        127.4,
        127.84,
        128.72,
        129.58,
        130.02,
        130.46,
        130.9,
        131.32,
        131.76,
        132.18,
        132.62,
        133.04,
        133.48,
        133.92,
        134.36,
        134.8,
        135.24,
        135.68,
        136.1,
        136.54,
        137.4,
        137.84,
        138.28,
        138.72,
        139.14,
        139.58,
        140.02,
        140.44,
        140.9,
        141.32,
        141.76,
        142.62,
        143.06,
        143.48,
        144.36,
        144.8,
        145.24,
        145.68,
        146.1,
        146.54,
        146.96,
        147.4,
        147.84,
        148.72,
        149.6,
        150.46,
        151.32,
        152.2,
        153.06,
        153.94,
        154.8,
        155.66,
        156.54,
        157.4,
        158.28,
        159.14,
        160.02,
        160.88,
        161.76,
        162.62,
        163.5,
        164.36,
        165.24,
        166.1,
        166.98,
        167.84,
        168.7,
        169.56,
        170.44,
        171.32,
        172.18,
        173.06,
        173.94,
        174.78,
        175.66,
        176.52,
        177.4,
        178.26,
        179.14,
        180.02,
        180.88,
        181.74,
        182.62,
        183.48,
        184.36,
        185.24,
        186.1,
        186.96,
        187.86,
        188.28,
        188.7,
        189.58,
        190.02,
        190.44,
        191.32,
        192.18,
        193.06,
        193.92,
        194.8,
        195.66,
        196.54,
        197.4,
        198.28,
        199.14,
        200.02,
        200.88,
        201.32,
        201.74,
        202.62,
        203.5,
        204.36,
        205.24,
        206.1,
        206.98,
        207.84,
        208.7,
        209.58,
        210.46,
        211.32,
        212.18,
        213.06,
        213.92,
        214.78,
        215.66,
        216.54,
        217.38,
        218.26,
        219.14,
        220,
        220.88,
        221.76,
        222.62,
        223.48,
        224.36,
        225.22,
        226.08,
        226.96,
        227.84,
        228.7,
        229.56,
        230.44,
        231.32,
        232.18,
        233.06,
        233.92,
        234.8,
        235.66,
        236.54,
        237.4,
        238.28,
        239.14,
        240,
        240.88,
        241.76,
        242.62,
        243.5,
        244.36,
        245.24,
        246.1,
        246.98,
        247.84,
        248.72,
        249.58,
        250.46,
        251.32,
        252.2,
        253.06,
        253.92,
        254.8,
        255.68,
        256.54,
        257.42,
        258.3
      ],
      "downbeatsSeconds": [
        6.18,
        7.04,
        8.7,
        10.46,
        12.2,
        13.92,
        15.68,
        17.4,
        19.16,
        20.9,
        22.64,
        26.14,
        27.88,
        29.6,
        33.12,
        34.84,
        36.54,
        38.28,
        40.02,
        41.76,
        43.5,
        45.24,
        46.98,
        48.72,
        50.46,
        52.2,
        53.92,
        55.66,
        57.42,
        59.14,
        60.88,
        64.36,
        66.1,
        67.84,
        71.32,
        74.8,
        78.26,
        81.74,
        85.24,
        88.7,
        92.2,
        95.68,
        99.16,
        102.62,
        106.12,
        109.58,
        113.06,
        116.54,
        120,
        123.5,
        126.98,
        130.46,
        133.92,
        137.4,
        140.9,
        144.36,
        147.84,
        151.32,
        154.8,
        158.28,
        161.76,
        165.24,
        168.7,
        172.18,
        175.66,
        179.14,
        182.62,
        186.1,
        189.58,
        193.06,
        196.54,
        200.02,
        203.5,
        206.98,
        210.46,
        213.92,
        215.66,
        219.14,
        220.88,
        222.62,
        224.36,
        227.84,
        231.32,
        234.8,
        238.28,
        241.76,
        245.24,
        248.72,
        252.2,
        255.68,
        257.42
      ],
      "localTempo": [
        {
          "startSeconds": 6.18,
          "endSeconds": 13.08,
          "bpm": 69.76744186046506,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 13.08,
          "endSeconds": 20.02,
          "bpm": 69.76744186046517,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 20.02,
          "endSeconds": 27,
          "bpm": 68.18181818181826,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 27,
          "endSeconds": 31.78,
          "bpm": 133.33333333333354,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 31.78,
          "endSeconds": 35.64,
          "bpm": 139.53488372093034,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 35.64,
          "endSeconds": 39.16,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 39.16,
          "endSeconds": 42.62,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 42.62,
          "endSeconds": 46.1,
          "bpm": 139.53488372092917,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 46.1,
          "endSeconds": 49.58,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 49.58,
          "endSeconds": 53.06,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 53.06,
          "endSeconds": 56.52,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 56.52,
          "endSeconds": 60.88,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 60.88,
          "endSeconds": 67.84,
          "bpm": 68.96551724137952,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 67.84,
          "endSeconds": 74.36,
          "bpm": 69.76744186046517,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 74.36,
          "endSeconds": 79.56,
          "bpm": 136.36363636363487,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 79.56,
          "endSeconds": 86.1,
          "bpm": 68.96551724137952,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 86.1,
          "endSeconds": 91.34,
          "bpm": 92.3076923076915,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 91.34,
          "endSeconds": 96.54,
          "bpm": 92.3076923076925,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 96.54,
          "endSeconds": 103.48,
          "bpm": 69.76744186046517,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 103.48,
          "endSeconds": 110.44,
          "bpm": 68.96551724137952,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 110.44,
          "endSeconds": 117.4,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 117.4,
          "endSeconds": 121.76,
          "bpm": 136.36363636363487,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 121.76,
          "endSeconds": 126.1,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 126.1,
          "endSeconds": 130.46,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 130.46,
          "endSeconds": 133.92,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 133.92,
          "endSeconds": 137.84,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 137.84,
          "endSeconds": 141.32,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 141.32,
          "endSeconds": 145.68,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 145.68,
          "endSeconds": 150.46,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 150.46,
          "endSeconds": 157.4,
          "bpm": 69.767441860464,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 157.4,
          "endSeconds": 164.36,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 164.36,
          "endSeconds": 171.32,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 171.32,
          "endSeconds": 178.26,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 178.26,
          "endSeconds": 185.24,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 185.24,
          "endSeconds": 190.44,
          "bpm": 92.30769230769351,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 190.44,
          "endSeconds": 197.4,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 197.4,
          "endSeconds": 203.5,
          "bpm": 68.96551724138007,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 203.5,
          "endSeconds": 210.46,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 210.46,
          "endSeconds": 217.38,
          "bpm": 69.767441860464,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 217.38,
          "endSeconds": 224.36,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 224.36,
          "endSeconds": 231.32,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 231.32,
          "endSeconds": 238.28,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 238.28,
          "endSeconds": 245.24,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 245.24,
          "endSeconds": 252.2,
          "bpm": 68.96551724137895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 252.2,
          "endSeconds": 258.3,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        }
      ],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 22,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 22,
          "endSeconds": 40,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 40,
          "endSeconds": 55,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 55,
          "endSeconds": 90,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 90,
          "endSeconds": 120,
          "label": "candidate-5",
          "provenance": "candidate"
        },
        {
          "startSeconds": 120,
          "endSeconds": 141,
          "label": "candidate-6",
          "provenance": "candidate"
        },
        {
          "startSeconds": 141,
          "endSeconds": 266.3827664399093,
          "label": "candidate-7",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "model-entry-candidate",
          "kind": "entry",
          "startSeconds": 6.18,
          "endSeconds": 8.18,
          "anchorSeconds": 6.18,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        },
        {
          "id": "model-exit-candidate",
          "kind": "exit",
          "startSeconds": 255.42000000000002,
          "endSeconds": 257.42,
          "anchorSeconds": 257.42,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        }
      ],
      "energy": {
        "label": "unknown",
        "method": "model-estimate",
        "definitionVersion": "doubao-v4-candidate-20261007"
      },
      "loudness": {
        "relativeLufs": -10.61,
        "headroomDb": 0,
        "provenance": "measured"
      },
      "quality": {
        "status": "unverified",
        "notes": [
          "真实模型候选；没有把整首或十首精度登记为通过。",
          "时间单位是FFmpeg解码秒；offsetSeconds=0仅表示此坐标原点，手机播放偏移仍未知。",
          "接歌位置仅按模型首拍提议，未判断人声或唱句；音乐听感未知。"
        ]
      },
      "corrections": []
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-8b8251a7f78e32735593",
      "audioSha256": "8b8251a7f78e32735593ab738031bc45e1ec4a3c2f80f1418ece5e60c41d6038",
      "analysisVersion": "small0-candidate-69f426ba9db7",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 231.46666666666667,
        "decodeMethod": "ffmpeg-f32le-mono-22050",
        "offsetSeconds": 0
      },
      "method": "trained-model",
      "tool": {
        "name": "Beat This!",
        "version": "1.1.0@ad7974846029835307ba19a3d5cefbf40b243041",
        "modelVersion": "small0@sha256:6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
        "parameterVersion": "pulsecraft-source-candidate-0.2.0-cpu-minimal-50fps",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [
        0.34,
        0.9,
        1.46,
        2,
        2.54,
        3.08,
        3.64,
        4.18,
        4.72,
        5.26,
        5.82,
        6.36,
        6.9,
        7.44,
        8,
        8.54,
        9.1,
        9.64,
        10.18,
        10.72,
        11.28,
        11.82,
        12.36,
        12.9,
        13.46,
        14,
        14.54,
        15.08,
        15.62,
        16.18,
        16.72,
        17.28,
        17.82,
        18.36,
        18.9,
        19.46,
        20,
        20.54,
        21.08,
        21.64,
        22.18,
        22.72,
        23.28,
        23.82,
        24.36,
        24.9,
        25.46,
        26,
        26.54,
        27.08,
        27.64,
        28.18,
        28.72,
        29.28,
        29.82,
        30.36,
        30.9,
        31.44,
        32,
        32.54,
        33.08,
        33.64,
        34.18,
        34.72,
        35.28,
        35.82,
        36.36,
        36.9,
        37.46,
        38,
        38.54,
        39.08,
        39.64,
        40.18,
        40.74,
        41.26,
        41.82,
        42.36,
        42.92,
        43.44,
        44,
        44.54,
        45.08,
        45.64,
        46.18,
        46.72,
        47.28,
        47.82,
        48.36,
        48.9,
        49.46,
        50,
        50.54,
        51.08,
        51.64,
        52.18,
        52.72,
        53.26,
        53.82,
        54.36,
        54.9,
        55.44,
        56,
        56.54,
        57.08,
        57.62,
        58.18,
        58.72,
        59.26,
        59.8,
        60.36,
        60.9,
        61.46,
        62,
        62.56,
        63.08,
        63.64,
        64.18,
        64.72,
        65.26,
        65.82,
        66.36,
        66.9,
        67.46,
        68,
        68.54,
        69.08,
        69.64,
        70.18,
        70.72,
        71.28,
        71.82,
        72.36,
        72.9,
        73.46,
        74,
        74.54,
        75.08,
        75.62,
        76.18,
        76.72,
        77.26,
        77.82,
        78.36,
        78.9,
        79.44,
        80,
        80.54,
        81.08,
        81.62,
        82.18,
        82.72,
        83.28,
        83.8,
        84.36,
        84.9,
        85.46,
        86,
        86.54,
        87.08,
        87.64,
        88.18,
        88.72,
        89.26,
        89.82,
        90.36,
        90.9,
        91.44,
        92,
        92.54,
        93.08,
        93.62,
        94.18,
        94.72,
        95.26,
        95.82,
        96.36,
        96.9,
        97.46,
        98,
        98.54,
        99.1,
        99.64,
        100.18,
        100.72,
        101.26,
        101.82,
        102.36,
        102.9,
        103.46,
        104,
        104.54,
        105.08,
        105.64,
        106.18,
        106.72,
        107.28,
        107.82,
        108.36,
        108.9,
        109.46,
        110,
        110.56,
        111.08,
        111.64,
        112.18,
        112.72,
        113.26,
        113.82,
        114.36,
        114.9,
        115.46,
        116,
        116.54,
        117.1,
        117.64,
        118.18,
        118.72,
        119.28,
        119.82,
        120.36,
        120.9,
        121.44,
        122,
        122.54,
        123.08,
        123.64,
        124.18,
        124.72,
        125.26,
        125.82,
        126.36,
        126.9,
        127.44,
        128,
        128.54,
        129.08,
        129.62,
        130.18,
        130.72,
        131.26,
        131.82,
        132.36,
        132.9,
        133.46,
        134,
        134.54,
        135.08,
        135.64,
        136.18,
        136.72,
        137.28,
        137.82,
        138.36,
        138.9,
        139.46,
        140,
        140.54,
        141.08,
        141.64,
        142.18,
        142.72,
        143.28,
        143.82,
        144.36,
        144.9,
        145.44,
        146,
        146.54,
        147.08,
        147.62,
        148.18,
        148.72,
        149.26,
        149.82,
        150.36,
        150.92,
        151.44,
        152,
        152.54,
        153.1,
        153.64,
        154.18,
        154.74,
        155.28,
        155.82,
        156.36,
        156.9,
        157.46,
        158,
        158.54,
        159.1,
        159.64,
        160.2,
        160.72,
        161.28,
        161.82,
        162.38,
        162.9,
        163.44,
        163.98,
        164.54,
        165.08,
        165.62,
        166.18,
        166.74,
        167.26,
        167.82,
        168.36,
        168.92,
        169.44,
        169.98,
        170.54,
        171.1,
        171.62,
        172.18,
        172.72,
        173.28,
        173.82,
        174.36,
        174.9,
        175.46,
        176,
        176.54,
        177.1,
        177.64,
        178.18,
        178.74,
        179.28,
        179.84,
        180.36,
        180.9,
        181.46,
        182,
        182.54,
        183.1,
        183.66,
        184.2,
        184.72,
        185.28,
        185.82,
        186.36,
        186.9,
        187.46,
        188,
        188.54,
        189.1,
        189.62,
        190.18,
        190.72,
        191.26,
        191.8,
        192.36,
        192.92,
        193.46,
        194,
        194.54,
        195.08,
        195.64,
        196.18,
        196.72,
        197.28,
        197.82,
        198.36,
        198.92,
        199.46,
        200,
        200.54,
        201.1,
        201.64,
        202.18,
        202.72,
        203.28,
        203.82,
        204.36,
        204.9,
        205.46,
        206,
        206.56,
        207.1,
        207.64,
        208.18,
        208.72,
        209.28,
        209.82,
        210.36,
        210.9,
        211.46,
        212,
        212.54,
        213.08,
        213.64,
        214.18,
        214.72,
        215.26,
        215.82,
        216.36,
        216.9,
        217.44,
        218,
        218.54,
        219.08,
        219.64,
        220.18,
        220.72,
        221.26,
        221.82,
        222.36,
        222.9,
        223.44,
        224,
        224.54,
        225.1,
        225.62,
        226.18,
        226.72,
        227.28,
        227.82,
        228.36,
        228.9,
        229.46
      ],
      "downbeatsSeconds": [
        1.46,
        3.64,
        5.82,
        8,
        10.18,
        11.28,
        12.36,
        14.54,
        15.62,
        16.72,
        18.9,
        20,
        21.08,
        21.64,
        22.18,
        23.28,
        24.36,
        25.46,
        26,
        26.54,
        27.64,
        28.18,
        28.72,
        29.28,
        30.9,
        33.08,
        35.28,
        36.36,
        37.46,
        39.64,
        41.82,
        44,
        46.18,
        48.36,
        50.54,
        52.72,
        53.82,
        54.9,
        56,
        57.08,
        58.18,
        61.46,
        63.64,
        65.82,
        68,
        70.18,
        72.36,
        74.54,
        76.72,
        78.9,
        81.08,
        83.28,
        85.46,
        87.64,
        88.72,
        89.82,
        90.36,
        92,
        94.18,
        96.36,
        97.46,
        98.54,
        100.72,
        102.9,
        105.08,
        106.18,
        107.28,
        109.46,
        111.64,
        113.82,
        116,
        117.1,
        118.18,
        120.36,
        122.54,
        123.08,
        124.72,
        126.9,
        129.08,
        131.26,
        133.46,
        135.64,
        137.82,
        140,
        142.18,
        143.28,
        144.36,
        146.54,
        147.62,
        148.72,
        150.92,
        153.1,
        154.18,
        155.28,
        156.36,
        157.46,
        158.54,
        160.72,
        162.9,
        165.08,
        167.26,
        169.44,
        171.62,
        173.82,
        176,
        178.18,
        180.36,
        182.54,
        184.72,
        186.9,
        189.1,
        190.18,
        191.26,
        192.36,
        193.46,
        194.54,
        195.64,
        196.72,
        198.92,
        201.1,
        202.18,
        203.28,
        204.36,
        205.46,
        206.56,
        207.64,
        208.18,
        209.82,
        210.9,
        212,
        214.18,
        216.36,
        218.54,
        220.72,
        222.9,
        224,
        225.1,
        226.18,
        227.28,
        227.82,
        228.36,
        229.46
      ],
      "localTempo": [
        {
          "startSeconds": 0.34,
          "endSeconds": 4.72,
          "bpm": 111.1111111111111,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 4.72,
          "endSeconds": 9.1,
          "bpm": 111.1111111111111,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 9.1,
          "endSeconds": 13.46,
          "bpm": 111.11111111111092,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 13.46,
          "endSeconds": 17.82,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 17.82,
          "endSeconds": 22.18,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 22.18,
          "endSeconds": 26.54,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 26.54,
          "endSeconds": 30.9,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 30.9,
          "endSeconds": 35.28,
          "bpm": 111.11111111111092,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 35.28,
          "endSeconds": 39.64,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 39.64,
          "endSeconds": 44,
          "bpm": 109.09090909090895,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 44,
          "endSeconds": 48.36,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 48.36,
          "endSeconds": 52.72,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 52.72,
          "endSeconds": 57.08,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 57.08,
          "endSeconds": 61.46,
          "bpm": 111.11111111111128,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 61.46,
          "endSeconds": 65.82,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 65.82,
          "endSeconds": 70.18,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 70.18,
          "endSeconds": 74.54,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 74.54,
          "endSeconds": 78.9,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 78.9,
          "endSeconds": 83.28,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 83.28,
          "endSeconds": 87.64,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 87.64,
          "endSeconds": 92,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 92,
          "endSeconds": 96.36,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 96.36,
          "endSeconds": 100.72,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 100.72,
          "endSeconds": 105.08,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 105.08,
          "endSeconds": 109.46,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 109.46,
          "endSeconds": 113.82,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 113.82,
          "endSeconds": 118.18,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 118.18,
          "endSeconds": 122.54,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 122.54,
          "endSeconds": 126.9,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 126.9,
          "endSeconds": 131.26,
          "bpm": 111.11111111111275,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 131.26,
          "endSeconds": 135.64,
          "bpm": 111.1111111111069,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 135.64,
          "endSeconds": 140,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 140,
          "endSeconds": 144.36,
          "bpm": 111.1111111111069,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 144.36,
          "endSeconds": 148.72,
          "bpm": 111.11111111111275,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 148.72,
          "endSeconds": 153.1,
          "bpm": 109.09090909090965,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 153.1,
          "endSeconds": 157.46,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 157.46,
          "endSeconds": 161.82,
          "bpm": 111.11111111111275,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 161.82,
          "endSeconds": 166.18,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 166.18,
          "endSeconds": 170.54,
          "bpm": 109.09090909090965,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 170.54,
          "endSeconds": 174.9,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 174.9,
          "endSeconds": 179.28,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 179.28,
          "endSeconds": 183.66,
          "bpm": 109.09090909090965,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 183.66,
          "endSeconds": 188,
          "bpm": 111.11111111111275,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 188,
          "endSeconds": 192.36,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 192.36,
          "endSeconds": 196.72,
          "bpm": 111.1111111111069,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 196.72,
          "endSeconds": 201.1,
          "bpm": 111.1111111111069,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 201.1,
          "endSeconds": 205.46,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 205.46,
          "endSeconds": 209.82,
          "bpm": 111.11111111111275,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 209.82,
          "endSeconds": 214.18,
          "bpm": 111.1111111111069,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 214.18,
          "endSeconds": 218.54,
          "bpm": 111.11111111111275,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 218.54,
          "endSeconds": 222.9,
          "bpm": 111.1111111111069,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 222.9,
          "endSeconds": 227.28,
          "bpm": 109.09090909090965,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 227.28,
          "endSeconds": 229.46,
          "bpm": 111.11111111110982,
          "ambiguity": "unknown"
        }
      ],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 17,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 17,
          "endSeconds": 89,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 89,
          "endSeconds": 167,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 167,
          "endSeconds": 184,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 184,
          "endSeconds": 231.46666666666667,
          "label": "candidate-5",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "model-entry-candidate",
          "kind": "entry",
          "startSeconds": 5.82,
          "endSeconds": 7.82,
          "anchorSeconds": 5.82,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        },
        {
          "id": "model-exit-candidate",
          "kind": "exit",
          "startSeconds": 227.46,
          "endSeconds": 229.46,
          "anchorSeconds": 229.46,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        }
      ],
      "energy": {
        "label": "high",
        "method": "model-estimate",
        "definitionVersion": "doubao-v4-candidate-20261007"
      },
      "loudness": {
        "relativeLufs": -8.77,
        "headroomDb": 0,
        "provenance": "measured"
      },
      "quality": {
        "status": "unverified",
        "notes": [
          "真实模型候选；没有把整首或十首精度登记为通过。",
          "时间单位是FFmpeg解码秒；offsetSeconds=0仅表示此坐标原点，手机播放偏移仍未知。",
          "接歌位置仅按模型首拍提议，未判断人声或唱句；音乐听感未知。"
        ]
      },
      "corrections": []
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-94d23acb31a5ea7430d3",
      "audioSha256": "94d23acb31a5ea7430d30fb7ce01db57037c1db7ee6d756965bedc547e0035d0",
      "analysisVersion": "small0-candidate-2b932a43938a",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 298.1219954648526,
        "decodeMethod": "ffmpeg-f32le-mono-22050",
        "offsetSeconds": 0
      },
      "method": "trained-model",
      "tool": {
        "name": "Beat This!",
        "version": "1.1.0@ad7974846029835307ba19a3d5cefbf40b243041",
        "modelVersion": "small0@sha256:6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
        "parameterVersion": "pulsecraft-source-candidate-0.2.0-cpu-minimal-50fps",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [
        0.32,
        0.42,
        0.8,
        1.14,
        1.5,
        1.84,
        2.18,
        2.54,
        2.88,
        3.24,
        3.58,
        3.92,
        4.28,
        4.64,
        4.98,
        5.34,
        5.7,
        6.04,
        6.22,
        6.38,
        6.56,
        6.74,
        6.9,
        7.06,
        7.42,
        7.62,
        7.78,
        8.12,
        8.46,
        8.82,
        9.16,
        9.52,
        9.86,
        10.22,
        10.58,
        10.92,
        11.28,
        11.62,
        11.96,
        12.32,
        12.66,
        13.02,
        13.36,
        13.72,
        14.08,
        14.42,
        14.78,
        14.94,
        15.28,
        15.64,
        15.98,
        16.34,
        16.68,
        17.04,
        17.38,
        17.72,
        18.06,
        18.6,
        18.96,
        19.32,
        19.66,
        20,
        20.36,
        20.7,
        21.06,
        21.4,
        21.74,
        22.1,
        22.46,
        22.8,
        23.14,
        23.48,
        23.84,
        24.2,
        24.54,
        24.9,
        25.24,
        25.58,
        25.94,
        26.3,
        26.64,
        26.98,
        27.34,
        27.7,
        28.04,
        28.4,
        28.74,
        29.08,
        29.44,
        30.14,
        30.66,
        31.18,
        31.72,
        32.24,
        32.76,
        33.28,
        33.8,
        34.32,
        34.86,
        35.38,
        35.9,
        36.42,
        36.94,
        37.46,
        38,
        38.52,
        39.06,
        39.58,
        40.1,
        40.62,
        41.14,
        41.66,
        42.2,
        42.72,
        43.24,
        43.76,
        44.3,
        44.8,
        45.34,
        45.86,
        46.38,
        46.9,
        47.44,
        47.96,
        48.48,
        49,
        49.54,
        50.06,
        50.58,
        51.1,
        51.62,
        52.14,
        52.68,
        53.2,
        53.72,
        54.24,
        54.78,
        55.3,
        55.82,
        56.34,
        56.86,
        57.4,
        57.92,
        58.44,
        58.98,
        59.48,
        60,
        60.54,
        61.06,
        61.58,
        62.1,
        62.62,
        63.16,
        63.68,
        64.2,
        64.74,
        65.26,
        65.78,
        66.3,
        66.82,
        67.34,
        67.88,
        68.4,
        68.94,
        69.44,
        69.98,
        70.5,
        71.02,
        71.54,
        72.06,
        72.6,
        73.12,
        73.64,
        74.16,
        74.68,
        75.22,
        75.74,
        76.26,
        76.78,
        77.3,
        77.84,
        78.36,
        78.88,
        79.4,
        79.92,
        80.46,
        80.98,
        81.5,
        82.02,
        82.54,
        83.08,
        83.6,
        84.12,
        84.64,
        85.18,
        85.7,
        86.24,
        86.72,
        87.3,
        87.78,
        88.32,
        88.84,
        89.36,
        89.88,
        90.42,
        90.94,
        91.46,
        91.98,
        92.5,
        93.04,
        93.56,
        94.08,
        94.6,
        95.12,
        95.66,
        96.16,
        96.7,
        97.22,
        97.74,
        98.26,
        98.8,
        99.32,
        99.84,
        100.36,
        100.9,
        101.42,
        101.94,
        102.46,
        102.98,
        103.5,
        104.04,
        104.56,
        105.08,
        105.6,
        106.14,
        106.66,
        107.18,
        107.7,
        108.22,
        108.76,
        109.28,
        109.8,
        110.34,
        110.84,
        111.38,
        111.9,
        112.42,
        112.94,
        113.46,
        114,
        114.52,
        115.04,
        115.58,
        116.1,
        116.62,
        117.14,
        117.66,
        118.18,
        118.72,
        119.2,
        119.76,
        120.26,
        120.8,
        121.34,
        121.84,
        122.38,
        122.9,
        123.42,
        123.96,
        124.48,
        125,
        125.52,
        126.04,
        126.58,
        127.1,
        127.62,
        128.16,
        128.68,
        129.2,
        129.72,
        130.24,
        130.76,
        131.28,
        131.82,
        132.34,
        132.86,
        133.4,
        133.92,
        134.44,
        134.96,
        135.48,
        136.02,
        136.56,
        137.06,
        137.58,
        138.1,
        138.62,
        139.14,
        139.68,
        140.2,
        140.74,
        141.24,
        141.78,
        142.3,
        142.82,
        143.34,
        143.86,
        144.4,
        144.92,
        145.44,
        145.98,
        146.5,
        147.02,
        147.54,
        148.06,
        148.58,
        149.1,
        149.64,
        150.16,
        150.68,
        151.2,
        151.72,
        152.26,
        152.78,
        153.3,
        153.82,
        154.34,
        154.86,
        155.4,
        155.92,
        156.44,
        156.98,
        157.5,
        158.02,
        158.54,
        159.08,
        159.6,
        160.12,
        160.64,
        161.16,
        161.68,
        162.2,
        162.72,
        163.24,
        163.78,
        164.3,
        164.82,
        165.36,
        165.88,
        166.4,
        166.92,
        167.44,
        167.98,
        168.5,
        169.02,
        169.54,
        170.06,
        170.58,
        171.12,
        171.64,
        172.16,
        172.7,
        173.22,
        173.74,
        174.28,
        174.78,
        175.32,
        175.84,
        176.36,
        176.88,
        177.42,
        177.94,
        178.48,
        179,
        179.52,
        180.04,
        180.56,
        181.08,
        181.62,
        182.14,
        182.66,
        183.18,
        183.72,
        184.24,
        184.76,
        185.28,
        185.82,
        186.32,
        186.86,
        187.38,
        187.9,
        188.42,
        188.94,
        189.46,
        190,
        190.52,
        191.04,
        191.56,
        192.1,
        192.62,
        193.14,
        193.66,
        194.2,
        194.72,
        195.24,
        195.76,
        196.3,
        196.8,
        197.34,
        197.86,
        198.38,
        198.9,
        199.44,
        199.96,
        200.48,
        201,
        201.52,
        202.04,
        202.58,
        203.1,
        203.62,
        204.12,
        204.66,
        205.18,
        205.72,
        206.24,
        206.76,
        207.28,
        207.82,
        208.34,
        208.68,
        208.88,
        209.38,
        209.9,
        210.42,
        210.96,
        211.48,
        212,
        212.52,
        213.06,
        213.56,
        214.1,
        214.62,
        215.16,
        215.66,
        216.2,
        216.72,
        217.24,
        217.76,
        218.3,
        218.82,
        219.32,
        219.86,
        220.56,
        220.9,
        221.26,
        221.58,
        221.94,
        222.48,
        223,
        223.54,
        224.06,
        224.58,
        225.1,
        225.62,
        226.16,
        226.66,
        227.2,
        227.72,
        228.24,
        228.94,
        229.3,
        229.86,
        230.34,
        230.86,
        231.4,
        231.92,
        232.44,
        232.96,
        233.5,
        234.02,
        234.54,
        235.06,
        235.58,
        236.12,
        236.62,
        237.3,
        237.66,
        238.02,
        238.38,
        238.72,
        239.08,
        239.42,
        239.78,
        240.14,
        240.44,
        240.82,
        241.18,
        241.52,
        241.88,
        242.22,
        242.58,
        242.92,
        243.28,
        243.62,
        243.96,
        244.32,
        244.66,
        245.02,
        245.36,
        245.72,
        246.06,
        246.42,
        246.74,
        247.1,
        247.46,
        247.8,
        248.16,
        248.66,
        248.86,
        249.22,
        249.58,
        249.7,
        250.26,
        250.62,
        250.76,
        251.32,
        251.82,
        252.36,
        252.72,
        252.86,
        253.42,
        253.76,
        253.96,
        254.12,
        254.44,
        254.8,
        255.12,
        255.48,
        255.86,
        256.18,
        256.54,
        257.06,
        257.6,
        258.12,
        258.64,
        259.16,
        259.7,
        260.2,
        260.74,
        261.3,
        261.8,
        262.16,
        262.3,
        262.84,
        263.2,
        263.34,
        263.9,
        264.4,
        264.94,
        265.46,
        265.98,
        266.5,
        267.06,
        267.58,
        268.06,
        268.6,
        269.14,
        269.66,
        270.18,
        270.72,
        271.2,
        271.72,
        272.26,
        272.8,
        273.32,
        273.84,
        274.38,
        274.9,
        275.42,
        275.94,
        276.46,
        276.98,
        277.52,
        278.06,
        278.56,
        279.1,
        279.62,
        280.14,
        280.66,
        281.18,
        281.72,
        282.24,
        282.76,
        283.28,
        283.8,
        284.34,
        284.86,
        285.38,
        285.9,
        286.42,
        286.96,
        287.46,
        287.94,
        288.52,
        289.04,
        289.58,
        290.1,
        290.62,
        291.14,
        291.66,
        292.22,
        292.72,
        293.24,
        293.76,
        294.3,
        294.82,
        295.36
      ],
      "downbeatsSeconds": [
        0.32,
        0.42,
        0.8,
        1.14,
        1.84,
        2.18,
        3.24,
        4.64,
        4.98,
        5.34,
        6.04,
        6.38,
        7.42,
        8.46,
        9.16,
        10.22,
        10.58,
        11.28,
        11.62,
        13.36,
        14.42,
        15.98,
        17.04,
        17.38,
        18.6,
        18.96,
        20,
        22.1,
        22.8,
        24.2,
        26.98,
        28.04,
        28.4,
        30.66,
        32.76,
        34.86,
        36.94,
        39.06,
        41.14,
        43.24,
        45.34,
        47.44,
        49.54,
        51.62,
        53.72,
        55.82,
        57.92,
        60,
        62.1,
        64.2,
        66.3,
        68.4,
        70.5,
        72.6,
        74.68,
        76.78,
        78.88,
        80.98,
        83.08,
        85.18,
        86.24,
        87.3,
        88.32,
        89.36,
        91.46,
        93.56,
        95.66,
        97.74,
        99.84,
        101.94,
        104.04,
        106.14,
        108.22,
        110.34,
        112.42,
        114.52,
        116.62,
        118.72,
        120.8,
        122.9,
        125,
        127.1,
        129.2,
        131.28,
        133.4,
        135.48,
        137.58,
        139.68,
        141.78,
        143.86,
        145.98,
        148.06,
        150.16,
        152.26,
        154.34,
        156.44,
        158.54,
        160.64,
        162.72,
        164.82,
        166.92,
        169.02,
        171.12,
        173.22,
        175.32,
        177.42,
        179.52,
        181.62,
        183.72,
        185.82,
        187.9,
        190,
        192.1,
        194.2,
        196.3,
        198.38,
        200.48,
        202.58,
        204.66,
        206.76,
        208.68,
        208.88,
        210.96,
        213.06,
        215.16,
        217.24,
        219.32,
        221.26,
        223.54,
        225.62,
        227.72,
        229.86,
        231.92,
        234.02,
        236.12,
        237.3,
        238.38,
        239.08,
        239.78,
        240.14,
        241.18,
        241.52,
        241.88,
        242.22,
        243.28,
        244.66,
        246.06,
        246.42,
        247.46,
        248.66,
        248.86,
        250.62,
        250.76,
        252.86,
        254.8,
        257.06,
        259.16,
        261.3,
        263.34,
        265.46,
        267.58,
        268.6,
        269.66,
        271.72,
        273.84,
        275.94,
        278.06,
        280.14,
        282.24,
        284.34,
        286.42,
        287.46,
        288.52,
        289.58,
        290.62,
        291.66,
        292.72,
        293.76,
        294.82
      ],
      "localTempo": [
        {
          "startSeconds": 0.32,
          "endSeconds": 2.88,
          "bpm": 176.4705882352941,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 2.88,
          "endSeconds": 5.7,
          "bpm": 166.66666666666694,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 5.7,
          "endSeconds": 7.42,
          "bpm": 333.3333333333339,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 7.42,
          "endSeconds": 9.86,
          "bpm": 176.4705882352942,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 9.86,
          "endSeconds": 12.66,
          "bpm": 171.42857142857116,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 12.66,
          "endSeconds": 15.28,
          "bpm": 171.42857142857162,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 15.28,
          "endSeconds": 18.06,
          "bpm": 176.4705882352942,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 18.06,
          "endSeconds": 21.06,
          "bpm": 166.66666666666694,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 21.06,
          "endSeconds": 23.84,
          "bpm": 176.4705882352942,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 23.84,
          "endSeconds": 26.64,
          "bpm": 171.42857142857162,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 26.64,
          "endSeconds": 29.44,
          "bpm": 171.42857142857162,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 29.44,
          "endSeconds": 33.8,
          "bpm": 115.38461538461509,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 33.8,
          "endSeconds": 38,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 38,
          "endSeconds": 42.2,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 42.2,
          "endSeconds": 46.38,
          "bpm": 115.38461538461549,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 46.38,
          "endSeconds": 50.58,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 50.58,
          "endSeconds": 54.78,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 54.78,
          "endSeconds": 58.98,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 58.98,
          "endSeconds": 63.16,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 63.16,
          "endSeconds": 67.34,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 67.34,
          "endSeconds": 71.54,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 71.54,
          "endSeconds": 75.74,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 75.74,
          "endSeconds": 79.92,
          "bpm": 115.38461538461627,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 79.92,
          "endSeconds": 84.12,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 84.12,
          "endSeconds": 88.32,
          "bpm": 113.2075471698126,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 88.32,
          "endSeconds": 92.5,
          "bpm": 115.38461538461627,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 92.5,
          "endSeconds": 96.7,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 96.7,
          "endSeconds": 100.9,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 100.9,
          "endSeconds": 105.08,
          "bpm": 115.38461538461627,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 105.08,
          "endSeconds": 109.28,
          "bpm": 115.38461538461627,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 109.28,
          "endSeconds": 113.46,
          "bpm": 115.38461538461627,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 113.46,
          "endSeconds": 117.66,
          "bpm": 115.38461538461469,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 117.66,
          "endSeconds": 121.84,
          "bpm": 113.20754716981108,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 121.84,
          "endSeconds": 126.04,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 126.04,
          "endSeconds": 130.24,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 130.24,
          "endSeconds": 134.44,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 134.44,
          "endSeconds": 138.62,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 138.62,
          "endSeconds": 142.82,
          "bpm": 115.38461538461627,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 142.82,
          "endSeconds": 147.02,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 147.02,
          "endSeconds": 151.2,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 151.2,
          "endSeconds": 155.4,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 155.4,
          "endSeconds": 159.6,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 159.6,
          "endSeconds": 163.78,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 163.78,
          "endSeconds": 167.98,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 167.98,
          "endSeconds": 172.16,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 172.16,
          "endSeconds": 176.36,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 176.36,
          "endSeconds": 180.56,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 180.56,
          "endSeconds": 184.76,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 184.76,
          "endSeconds": 188.94,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 188.94,
          "endSeconds": 193.14,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 193.14,
          "endSeconds": 197.34,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 197.34,
          "endSeconds": 201.52,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 201.52,
          "endSeconds": 205.72,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 205.72,
          "endSeconds": 209.38,
          "bpm": 115.38461538461627,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 209.38,
          "endSeconds": 213.56,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 213.56,
          "endSeconds": 217.76,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 217.76,
          "endSeconds": 221.58,
          "bpm": 117.64705882353151,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 221.58,
          "endSeconds": 225.62,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 225.62,
          "endSeconds": 229.86,
          "bpm": 113.20754716981108,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 229.86,
          "endSeconds": 234.02,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 234.02,
          "endSeconds": 238.02,
          "bpm": 115.38461538461627,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 238.02,
          "endSeconds": 240.82,
          "bpm": 166.6666666666735,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 240.82,
          "endSeconds": 243.62,
          "bpm": 171.4285714285742,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 243.62,
          "endSeconds": 246.42,
          "bpm": 171.4285714285742,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 246.42,
          "endSeconds": 249.22,
          "bpm": 166.6666666666735,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 249.22,
          "endSeconds": 252.36,
          "bpm": 139.534883720928,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 252.36,
          "endSeconds": 254.8,
          "bpm": 181.81818181818275,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 254.8,
          "endSeconds": 258.12,
          "bpm": 162.16216216215395,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 258.12,
          "endSeconds": 262.16,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 262.16,
          "endSeconds": 265.46,
          "bpm": 117.64705882353151,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 265.46,
          "endSeconds": 269.66,
          "bpm": 115.3846153846068,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 269.66,
          "endSeconds": 273.84,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 273.84,
          "endSeconds": 278.06,
          "bpm": 115.3846153846068,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 278.06,
          "endSeconds": 282.24,
          "bpm": 115.38461538461942,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 282.24,
          "endSeconds": 286.42,
          "bpm": 115.38461538461311,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 286.42,
          "endSeconds": 290.62,
          "bpm": 115.3846153846068,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 290.62,
          "endSeconds": 294.82,
          "bpm": 115.38461538461942,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 294.82,
          "endSeconds": 295.36,
          "bpm": 111.1111111111069,
          "ambiguity": "unknown"
        }
      ],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 32,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 32,
          "endSeconds": 71,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 71,
          "endSeconds": 90,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 90,
          "endSeconds": 115,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 115,
          "endSeconds": 136,
          "label": "candidate-5",
          "provenance": "candidate"
        },
        {
          "startSeconds": 136,
          "endSeconds": 158,
          "label": "candidate-6",
          "provenance": "candidate"
        },
        {
          "startSeconds": 158,
          "endSeconds": 176,
          "label": "candidate-7",
          "provenance": "candidate"
        },
        {
          "startSeconds": 176,
          "endSeconds": 200,
          "label": "candidate-8",
          "provenance": "candidate"
        },
        {
          "startSeconds": 200,
          "endSeconds": 247,
          "label": "candidate-9",
          "provenance": "candidate"
        },
        {
          "startSeconds": 247,
          "endSeconds": 267,
          "label": "candidate-10",
          "provenance": "candidate"
        },
        {
          "startSeconds": 267,
          "endSeconds": 287,
          "label": "candidate-11",
          "provenance": "candidate"
        },
        {
          "startSeconds": 287,
          "endSeconds": 298.1219954648526,
          "label": "candidate-12",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "model-entry-candidate",
          "kind": "entry",
          "startSeconds": 5.34,
          "endSeconds": 7.34,
          "anchorSeconds": 5.34,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        },
        {
          "id": "model-exit-candidate",
          "kind": "exit",
          "startSeconds": 292.82,
          "endSeconds": 294.82,
          "anchorSeconds": 294.82,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        }
      ],
      "energy": {
        "label": "high",
        "method": "model-estimate",
        "definitionVersion": "doubao-v4-candidate-20261007"
      },
      "loudness": {
        "relativeLufs": -8.87,
        "headroomDb": 0,
        "provenance": "measured"
      },
      "quality": {
        "status": "unverified",
        "notes": [
          "真实模型候选；没有把整首或十首精度登记为通过。",
          "时间单位是FFmpeg解码秒；offsetSeconds=0仅表示此坐标原点，手机播放偏移仍未知。",
          "接歌位置仅按模型首拍提议，未判断人声或唱句；音乐听感未知。"
        ]
      },
      "corrections": []
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-9d9e4b6a0ea2681ae8ae",
      "audioSha256": "9d9e4b6a0ea2681ae8aeeee1ffa7a118581949c03e5f28e9b8716adb7de51746",
      "analysisVersion": "small0-candidate-639e070d4d82",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 287.84,
        "decodeMethod": "ffmpeg-f32le-mono-22050",
        "offsetSeconds": 0
      },
      "method": "trained-model",
      "tool": {
        "name": "Beat This!",
        "version": "1.1.0@ad7974846029835307ba19a3d5cefbf40b243041",
        "modelVersion": "small0@sha256:6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
        "parameterVersion": "pulsecraft-source-candidate-0.2.0-cpu-minimal-50fps",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [
        0.3,
        1.3,
        2.32,
        3.36,
        4.38,
        5.36,
        6.38,
        7.42,
        8.44,
        9.44,
        10.46,
        11.48,
        12.5,
        13.56,
        14.06,
        14.58,
        15.58,
        16.46,
        17.48,
        18.48,
        19.5,
        20.5,
        21.52,
        22.54,
        23.56,
        24.56,
        25.58,
        26.6,
        27.62,
        28.62,
        29.66,
        30.18,
        30.7,
        31.18,
        31.72,
        32.22,
        32.76,
        33.26,
        33.78,
        34.32,
        34.82,
        35.34,
        35.84,
        36.34,
        36.86,
        37.36,
        37.86,
        38.38,
        38.9,
        39.42,
        39.9,
        40.42,
        40.92,
        41.44,
        41.94,
        42.44,
        42.96,
        43.46,
        43.96,
        44.46,
        44.98,
        45.5,
        46,
        46.5,
        47,
        47.5,
        48.02,
        49.36,
        49.84,
        50.34,
        50.86,
        51.36,
        51.84,
        52.34,
        52.84,
        53.34,
        53.84,
        54.34,
        54.86,
        55.34,
        55.84,
        56.32,
        56.82,
        57.32,
        57.84,
        58.34,
        58.82,
        59.3,
        59.76,
        60.26,
        60.78,
        61.28,
        61.78,
        62.28,
        62.78,
        63.28,
        63.78,
        64.28,
        64.76,
        65.24,
        65.74,
        66.24,
        66.76,
        67.26,
        67.76,
        68.24,
        68.74,
        69.24,
        69.72,
        70.22,
        70.72,
        71.2,
        71.7,
        72.18,
        72.68,
        73.18,
        73.68,
        74.18,
        74.68,
        75.16,
        75.66,
        76.16,
        76.66,
        77.16,
        77.64,
        78.16,
        78.66,
        79.14,
        79.64,
        80.18,
        80.64,
        81.14,
        81.62,
        82.12,
        82.62,
        83.12,
        83.6,
        84.1,
        84.6,
        85.08,
        85.58,
        86.1,
        86.58,
        87.08,
        87.6,
        88.08,
        88.58,
        89.06,
        90.04,
        90.52,
        91.02,
        91.52,
        92.02,
        92.52,
        93.04,
        93.54,
        94.02,
        94.52,
        95,
        95.5,
        96,
        96.5,
        97,
        97.5,
        97.96,
        98.46,
        98.94,
        99.44,
        99.94,
        100.46,
        100.94,
        101.44,
        101.96,
        102.46,
        102.96,
        103.42,
        103.92,
        104.42,
        104.9,
        105.4,
        105.9,
        106.4,
        106.9,
        107.38,
        107.88,
        108.38,
        108.86,
        109.36,
        109.88,
        110.36,
        110.86,
        111.38,
        111.86,
        112.36,
        112.86,
        113.36,
        113.84,
        114.34,
        114.82,
        115.32,
        115.84,
        116.34,
        116.82,
        117.34,
        117.82,
        118.82,
        119.3,
        119.78,
        120.3,
        120.78,
        121.26,
        121.76,
        122.26,
        122.76,
        123.24,
        123.74,
        124.26,
        124.74,
        125.24,
        125.74,
        126.24,
        126.72,
        127.22,
        127.7,
        128.2,
        128.7,
        129.22,
        129.7,
        130.18,
        130.7,
        131.18,
        131.68,
        132.2,
        132.7,
        133.2,
        133.7,
        134.18,
        134.68,
        135.18,
        135.68,
        136.18,
        136.66,
        137.16,
        137.66,
        138.14,
        138.62,
        139.12,
        139.62,
        140.14,
        140.64,
        141.12,
        141.62,
        142.1,
        142.58,
        143.08,
        143.58,
        144.1,
        144.58,
        145.06,
        145.58,
        146.08,
        146.58,
        147.08,
        147.6,
        148.04,
        148.6,
        149.04,
        149.56,
        150.04,
        150.54,
        151.06,
        151.54,
        152.04,
        152.52,
        153.02,
        153.52,
        154,
        154.5,
        154.98,
        155.5,
        156,
        156.5,
        156.98,
        157.48,
        157.98,
        158.48,
        158.98,
        159.48,
        159.98,
        160.46,
        160.96,
        161.46,
        161.94,
        162.44,
        162.94,
        163.44,
        163.94,
        164.44,
        164.94,
        165.42,
        165.92,
        166.42,
        166.92,
        167.4,
        167.9,
        168.42,
        168.9,
        169.4,
        169.9,
        170.38,
        170.88,
        171.36,
        171.86,
        172.36,
        172.86,
        173.36,
        173.84,
        174.34,
        174.84,
        175.34,
        175.84,
        176.32,
        176.82,
        177.32,
        177.82,
        178.32,
        178.8,
        179.32,
        179.8,
        180.3,
        180.8,
        181.3,
        181.78,
        182.28,
        182.76,
        183.28,
        183.76,
        184.26,
        184.76,
        185.26,
        185.74,
        186.26,
        186.74,
        187.24,
        187.74,
        188.24,
        188.74,
        189.22,
        189.72,
        190.22,
        190.72,
        191.2,
        191.7,
        192.2,
        192.7,
        193.18,
        193.68,
        194.18,
        194.68,
        195.18,
        195.68,
        196.16,
        196.66,
        197.16,
        197.64,
        198.14,
        198.64,
        199.14,
        199.62,
        200.14,
        200.64,
        201.12,
        201.62,
        202.12,
        202.62,
        203.1,
        203.6,
        204.1,
        204.58,
        205.08,
        205.58,
        206.08,
        206.58,
        207.06,
        207.56,
        208.06,
        208.56,
        209.06,
        210.06,
        211.04,
        212.02,
        212.54,
        213.02,
        214.02,
        215,
        216,
        217,
        217.98,
        218.98,
        219.96,
        220.96,
        221.94,
        222.92,
        223.9,
        224.92,
        225.92,
        226.92,
        227.9,
        228.88,
        229.9,
        230.86,
        231.86,
        232.84,
        233.84,
        234.84,
        235.82,
        236.82,
        237.82,
        238.3,
        238.8,
        239.3,
        239.8,
        240.3,
        240.8,
        241.3,
        241.78,
        242.28,
        242.78,
        243.26,
        243.76,
        244.26,
        244.76,
        245.26,
        245.76,
        246.26,
        246.74,
        247.24,
        247.74,
        248.22,
        248.72,
        249.22,
        249.72,
        250.22,
        250.72,
        251.2,
        251.7,
        252.2,
        252.68,
        253.18,
        253.68,
        254.18,
        254.68,
        255.18,
        255.66,
        256.16,
        256.66,
        257.16,
        257.64,
        258.14,
        258.64,
        259.14,
        259.64,
        260.14,
        260.64,
        261.16,
        261.64,
        262.16,
        262.66,
        263.18,
        263.66,
        264.18,
        264.74,
        265.24,
        265.72,
        266.7,
        267.22,
        267.82,
        268.82,
        269.86,
        270.92,
        271.98,
        272.98,
        273.98,
        275.02,
        276.04,
        276.18,
        276.98,
        277.96,
        279.58
      ],
      "downbeatsSeconds": [
        0.3,
        2.32,
        4.38,
        6.38,
        8.44,
        10.46,
        12.5,
        14.58,
        17.48,
        21.52,
        25.58,
        29.66,
        31.72,
        33.78,
        35.84,
        37.86,
        39.9,
        41.94,
        43.96,
        46,
        48.02,
        50.34,
        52.34,
        54.34,
        56.32,
        58.34,
        60.26,
        62.28,
        64.28,
        66.24,
        68.24,
        70.22,
        72.18,
        74.18,
        76.16,
        78.16,
        80.18,
        82.12,
        84.1,
        86.1,
        88.08,
        90.04,
        92.02,
        94.02,
        96,
        97.96,
        99.94,
        101.96,
        103.92,
        105.9,
        107.88,
        109.88,
        111.86,
        113.84,
        115.84,
        117.82,
        119.78,
        121.76,
        123.74,
        125.74,
        127.7,
        129.7,
        131.68,
        133.7,
        135.68,
        137.66,
        139.62,
        141.62,
        143.58,
        145.58,
        147.6,
        149.56,
        151.54,
        153.52,
        155.5,
        157.48,
        159.48,
        161.46,
        163.44,
        165.42,
        167.4,
        169.4,
        171.36,
        173.36,
        175.34,
        177.32,
        179.32,
        181.3,
        183.28,
        185.26,
        187.24,
        189.22,
        191.2,
        193.18,
        195.18,
        197.16,
        199.14,
        201.12,
        203.1,
        205.08,
        207.06,
        209.06,
        211.04,
        213.02,
        215,
        217,
        218.98,
        220.96,
        224.92,
        226.92,
        228.88,
        230.86,
        232.84,
        234.84,
        236.82,
        238.8,
        240.8,
        242.78,
        244.76,
        246.74,
        248.72,
        250.72,
        252.68,
        254.68,
        256.66,
        258.64,
        260.64,
        262.66,
        264.74,
        266.7,
        269.86,
        273.98,
        276.18,
        277.96,
        279.58
      ],
      "localTempo": [
        {
          "startSeconds": 0.3,
          "endSeconds": 8.44,
          "bpm": 58.82352941176473,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 8.44,
          "endSeconds": 15.58,
          "bpm": 59.405940594059416,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 15.58,
          "endSeconds": 23.56,
          "bpm": 58.82352941176473,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 23.56,
          "endSeconds": 30.7,
          "bpm": 59.405940594059416,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 30.7,
          "endSeconds": 34.82,
          "bpm": 117.64705882352905,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 34.82,
          "endSeconds": 38.9,
          "bpm": 117.64705882352987,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 38.9,
          "endSeconds": 42.96,
          "bpm": 117.64705882352987,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 42.96,
          "endSeconds": 47,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 47,
          "endSeconds": 51.84,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 51.84,
          "endSeconds": 55.84,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 55.84,
          "endSeconds": 59.76,
          "bpm": 122.44897959183713,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 59.76,
          "endSeconds": 63.78,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 63.78,
          "endSeconds": 67.76,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 67.76,
          "endSeconds": 71.7,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 71.7,
          "endSeconds": 75.66,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 75.66,
          "endSeconds": 79.64,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 79.64,
          "endSeconds": 83.6,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 83.6,
          "endSeconds": 87.6,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 87.6,
          "endSeconds": 92.02,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 92.02,
          "endSeconds": 96,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 96,
          "endSeconds": 99.94,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 99.94,
          "endSeconds": 103.92,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 103.92,
          "endSeconds": 107.88,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 107.88,
          "endSeconds": 111.86,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 111.86,
          "endSeconds": 115.84,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 115.84,
          "endSeconds": 120.3,
          "bpm": 122.44897959183623,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 120.3,
          "endSeconds": 124.26,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 124.26,
          "endSeconds": 128.2,
          "bpm": 120.0000000000017,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 128.2,
          "endSeconds": 132.2,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 132.2,
          "endSeconds": 136.18,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 136.18,
          "endSeconds": 140.14,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 140.14,
          "endSeconds": 144.1,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 144.1,
          "endSeconds": 148.04,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 148.04,
          "endSeconds": 152.04,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 152.04,
          "endSeconds": 156,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 156,
          "endSeconds": 159.98,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 159.98,
          "endSeconds": 163.94,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 163.94,
          "endSeconds": 167.9,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 167.9,
          "endSeconds": 171.86,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 171.86,
          "endSeconds": 175.84,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 175.84,
          "endSeconds": 179.8,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 179.8,
          "endSeconds": 183.76,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 183.76,
          "endSeconds": 187.74,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 187.74,
          "endSeconds": 191.7,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 191.7,
          "endSeconds": 195.68,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 195.68,
          "endSeconds": 199.62,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 199.62,
          "endSeconds": 203.6,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 203.6,
          "endSeconds": 207.56,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 207.56,
          "endSeconds": 213.02,
          "bpm": 117.64705882353151,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 213.02,
          "endSeconds": 220.96,
          "bpm": 60,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 220.96,
          "endSeconds": 228.88,
          "bpm": 61.22448979591723,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 228.88,
          "endSeconds": 236.82,
          "bpm": 60,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 236.82,
          "endSeconds": 241.3,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 241.3,
          "endSeconds": 245.26,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 245.26,
          "endSeconds": 249.22,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 249.22,
          "endSeconds": 253.18,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 253.18,
          "endSeconds": 257.16,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 257.16,
          "endSeconds": 261.16,
          "bpm": 120,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 261.16,
          "endSeconds": 265.24,
          "bpm": 117.64705882353151,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 265.24,
          "endSeconds": 271.98,
          "bpm": 60.60606060606179,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 271.98,
          "endSeconds": 279.58,
          "bpm": 60,
          "ambiguity": "unknown"
        }
      ],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 17,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 17,
          "endSeconds": 50,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 50,
          "endSeconds": 75,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 75,
          "endSeconds": 101,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 101,
          "endSeconds": 126,
          "label": "candidate-5",
          "provenance": "candidate"
        },
        {
          "startSeconds": 126,
          "endSeconds": 157,
          "label": "candidate-6",
          "provenance": "candidate"
        },
        {
          "startSeconds": 157,
          "endSeconds": 174,
          "label": "candidate-7",
          "provenance": "candidate"
        },
        {
          "startSeconds": 174,
          "endSeconds": 229,
          "label": "candidate-8",
          "provenance": "candidate"
        },
        {
          "startSeconds": 229,
          "endSeconds": 257,
          "label": "candidate-9",
          "provenance": "candidate"
        },
        {
          "startSeconds": 257,
          "endSeconds": 287.84,
          "label": "candidate-10",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "model-entry-candidate",
          "kind": "entry",
          "startSeconds": 6.38,
          "endSeconds": 8.379999999999999,
          "anchorSeconds": 6.38,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        },
        {
          "id": "model-exit-candidate",
          "kind": "exit",
          "startSeconds": 277.58,
          "endSeconds": 279.58,
          "anchorSeconds": 279.58,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        }
      ],
      "energy": {
        "label": "low",
        "method": "model-estimate",
        "definitionVersion": "doubao-v4-candidate-20261007"
      },
      "loudness": {
        "relativeLufs": -11.16,
        "headroomDb": 0.52,
        "provenance": "measured"
      },
      "quality": {
        "status": "unverified",
        "notes": [
          "真实模型候选；没有把整首或十首精度登记为通过。",
          "时间单位是FFmpeg解码秒；offsetSeconds=0仅表示此坐标原点，手机播放偏移仍未知。",
          "接歌位置仅按模型首拍提议，未判断人声或唱句；音乐听感未知。"
        ]
      },
      "corrections": []
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-a5fa64a7bd567b2b3385",
      "audioSha256": "a5fa64a7bd567b2b3385bf93d922b556fcc8ce5c5bb3fa15650e91657196aa61",
      "analysisVersion": "small0-candidate-a3eb5b5c2ab8",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 283.2,
        "decodeMethod": "ffmpeg-f32le-mono-22050",
        "offsetSeconds": 0
      },
      "method": "trained-model",
      "tool": {
        "name": "Beat This!",
        "version": "1.1.0@ad7974846029835307ba19a3d5cefbf40b243041",
        "modelVersion": "small0@sha256:6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
        "parameterVersion": "pulsecraft-source-candidate-0.2.0-cpu-minimal-50fps",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [
        0.38,
        1.22,
        2.02,
        2.86,
        3.68,
        4.5,
        5.32,
        6.14,
        6.98,
        7.8,
        8.62,
        9.46,
        10.28,
        11.1,
        11.92,
        12.74,
        13.58,
        14.4,
        15.22,
        16.06,
        16.88,
        17.7,
        18.52,
        19.34,
        20.18,
        21,
        21.84,
        22.64,
        23.48,
        24.3,
        25.12,
        25.94,
        26.78,
        27.62,
        28.42,
        29.26,
        30.08,
        30.9,
        31.72,
        32.56,
        33.38,
        34.2,
        35.02,
        35.86,
        36.68,
        37.5,
        38.32,
        39.16,
        39.96,
        40.78,
        41.6,
        42.44,
        43.24,
        44.08,
        44.9,
        45.72,
        46.54,
        47.36,
        48.18,
        49.02,
        49.82,
        50.66,
        51.48,
        52.3,
        53.12,
        53.94,
        54.76,
        55.58,
        56.4,
        57.22,
        58.04,
        58.86,
        59.7,
        60.52,
        61.34,
        62.16,
        62.98,
        63.8,
        64.62,
        65.44,
        66.26,
        67.06,
        67.9,
        68.74,
        69.54,
        70.36,
        71.18,
        72,
        72.82,
        73.64,
        74.46,
        75.28,
        76.1,
        76.92,
        77.74,
        78.56,
        79.38,
        80.2,
        81.02,
        81.84,
        82.64,
        83.48,
        84.3,
        85.1,
        85.92,
        86.76,
        87.58,
        88.4,
        89.2,
        90.02,
        90.84,
        91.66,
        92.5,
        93.3,
        94.1,
        94.94,
        95.74,
        96.58,
        97.38,
        98.22,
        99.04,
        99.86,
        100.66,
        101.5,
        102.3,
        103.12,
        103.94,
        104.76,
        105.58,
        106.42,
        107.22,
        108.04,
        108.86,
        109.68,
        110.5,
        111.32,
        112.14,
        112.96,
        113.78,
        114.6,
        115.42,
        116.24,
        117.06,
        117.9,
        118.7,
        119.52,
        120.32,
        121.16,
        121.96,
        122.78,
        123.58,
        124.4,
        125.22,
        126.04,
        126.84,
        127.68,
        128.48,
        129.3,
        130.12,
        130.94,
        131.76,
        132.56,
        133.38,
        134.2,
        135,
        135.84,
        136.66,
        137.48,
        138.28,
        139.1,
        139.92,
        140.74,
        141.54,
        142.36,
        143.18,
        144,
        144.8,
        145.64,
        146.44,
        147.26,
        148.08,
        148.9,
        149.7,
        150.54,
        151.34,
        152.16,
        152.98,
        153.8,
        154.6,
        155.42,
        156.24,
        157.06,
        157.88,
        158.7,
        159.5,
        160.32,
        161.14,
        161.96,
        162.76,
        163.6,
        164.4,
        165.22,
        166.04,
        166.86,
        167.66,
        168.5,
        169.3,
        170.12,
        170.92,
        171.74,
        172.56,
        173.38,
        174.18,
        175,
        175.8,
        176.6,
        177.42,
        178.24,
        179.06,
        179.86,
        180.66,
        181.5,
        182.3,
        183.1,
        183.92,
        184.72,
        185.54,
        186.36,
        187.16,
        187.98,
        188.78,
        189.6,
        190.4,
        191.24,
        192.04,
        192.84,
        193.66,
        194.48,
        195.28,
        196.1,
        196.9,
        197.72,
        198.52,
        199.32,
        200.14,
        200.96,
        201.76,
        202.58,
        203.38,
        204.2,
        205,
        205.82,
        206.62,
        207.44,
        208.24,
        209.06,
        209.86,
        210.68,
        211.48,
        212.3,
        213.1,
        213.94,
        214.74,
        215.56,
        216.36,
        217.18,
        218,
        218.78,
        219.6,
        220.42,
        221.22,
        222.04,
        222.84,
        223.66,
        224.46,
        225.26,
        226.08,
        226.88,
        227.7,
        228.52,
        229.34,
        230.14,
        230.94,
        231.76,
        232.56,
        233.38,
        234.18,
        235,
        235.8,
        236.62,
        237.42,
        238.24,
        239.04,
        239.86,
        240.68,
        241.48,
        242.3,
        243.1,
        243.92,
        244.74,
        245.54,
        246.36,
        247.18,
        248,
        248.8,
        249.6,
        250.42,
        251.2,
        252,
        252.8,
        253.6,
        254.4,
        255.22,
        256,
        256.82,
        257.6,
        258.42,
        259.22,
        260,
        260.8,
        261.6,
        262.4,
        263.2,
        264,
        264.82,
        265.6,
        266.4,
        267.2,
        268.02,
        268.82,
        269.24,
        269.62,
        270.06,
        270.2,
        271,
        271.84,
        272.7
      ],
      "downbeatsSeconds": [
        0.38,
        2.02,
        3.68,
        6.98,
        10.28,
        13.58,
        16.88,
        20.18,
        23.48,
        26.78,
        30.08,
        33.38,
        36.68,
        39.96,
        43.24,
        46.54,
        49.82,
        53.12,
        56.4,
        59.7,
        62.98,
        66.26,
        69.54,
        72.82,
        76.1,
        79.38,
        82.64,
        85.92,
        89.2,
        92.5,
        95.74,
        99.04,
        102.3,
        105.58,
        108.86,
        112.14,
        115.42,
        118.7,
        121.96,
        125.22,
        128.48,
        131.76,
        135,
        138.28,
        141.54,
        144.8,
        148.08,
        151.34,
        154.6,
        157.88,
        161.14,
        164.4,
        167.66,
        170.92,
        174.18,
        177.42,
        180.66,
        183.92,
        187.16,
        190.4,
        193.66,
        196.9,
        200.14,
        203.38,
        206.62,
        209.86,
        213.1,
        216.36,
        219.6,
        222.84,
        226.08,
        229.34,
        232.56,
        235.8,
        237.42,
        239.04,
        242.3,
        245.54,
        248.8,
        252,
        255.22,
        258.42,
        261.6,
        264.82,
        268.02,
        269.24,
        269.62,
        271,
        271.84
      ],
      "localTempo": [
        {
          "startSeconds": 0.38,
          "endSeconds": 6.98,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 6.98,
          "endSeconds": 13.58,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 13.58,
          "endSeconds": 20.18,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 20.18,
          "endSeconds": 26.78,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 26.78,
          "endSeconds": 33.38,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 33.38,
          "endSeconds": 39.96,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 39.96,
          "endSeconds": 46.54,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 46.54,
          "endSeconds": 53.12,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 53.12,
          "endSeconds": 59.7,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 59.7,
          "endSeconds": 66.26,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 66.26,
          "endSeconds": 72.82,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 72.82,
          "endSeconds": 79.38,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 79.38,
          "endSeconds": 85.92,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 85.92,
          "endSeconds": 92.5,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 92.5,
          "endSeconds": 99.04,
          "bpm": 74.07407407407386,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 99.04,
          "endSeconds": 105.58,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 105.58,
          "endSeconds": 112.14,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 112.14,
          "endSeconds": 118.7,
          "bpm": 73.17073170731705,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 118.7,
          "endSeconds": 125.22,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 125.22,
          "endSeconds": 131.76,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 131.76,
          "endSeconds": 138.28,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 138.28,
          "endSeconds": 144.8,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 144.8,
          "endSeconds": 151.34,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 151.34,
          "endSeconds": 157.88,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 157.88,
          "endSeconds": 164.4,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 164.4,
          "endSeconds": 170.92,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 170.92,
          "endSeconds": 177.42,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 177.42,
          "endSeconds": 183.92,
          "bpm": 74.07407407407386,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 183.92,
          "endSeconds": 190.4,
          "bpm": 74.07407407407386,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 190.4,
          "endSeconds": 196.9,
          "bpm": 74.07407407407386,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 196.9,
          "endSeconds": 203.38,
          "bpm": 74.07407407407386,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 203.38,
          "endSeconds": 209.86,
          "bpm": 74.07407407407386,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 209.86,
          "endSeconds": 216.36,
          "bpm": 74.07407407407386,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 216.36,
          "endSeconds": 222.84,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 222.84,
          "endSeconds": 229.34,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 229.34,
          "endSeconds": 235.8,
          "bpm": 74.99999999999893,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 235.8,
          "endSeconds": 242.3,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 242.3,
          "endSeconds": 248.8,
          "bpm": 73.17073170731769,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 248.8,
          "endSeconds": 255.22,
          "bpm": 74.99999999999893,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 255.22,
          "endSeconds": 261.6,
          "bpm": 74.99999999999893,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 261.6,
          "endSeconds": 268.02,
          "bpm": 74.99999999999893,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 268.02,
          "endSeconds": 272.7,
          "bpm": 96.77419354838639,
          "ambiguity": "unknown"
        }
      ],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 21,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 21,
          "endSeconds": 38,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 38,
          "endSeconds": 63,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 63,
          "endSeconds": 78,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 78,
          "endSeconds": 102,
          "label": "candidate-5",
          "provenance": "candidate"
        },
        {
          "startSeconds": 102,
          "endSeconds": 117,
          "label": "candidate-6",
          "provenance": "candidate"
        },
        {
          "startSeconds": 117,
          "endSeconds": 161,
          "label": "candidate-7",
          "provenance": "candidate"
        },
        {
          "startSeconds": 161,
          "endSeconds": 177,
          "label": "candidate-8",
          "provenance": "candidate"
        },
        {
          "startSeconds": 177,
          "endSeconds": 259,
          "label": "candidate-9",
          "provenance": "candidate"
        },
        {
          "startSeconds": 259,
          "endSeconds": 283.2,
          "label": "candidate-10",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "model-entry-candidate",
          "kind": "entry",
          "startSeconds": 6.98,
          "endSeconds": 8.98,
          "anchorSeconds": 6.98,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        },
        {
          "id": "model-exit-candidate",
          "kind": "exit",
          "startSeconds": 269.84,
          "endSeconds": 271.84,
          "anchorSeconds": 271.84,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        }
      ],
      "energy": {
        "label": "high",
        "method": "model-estimate",
        "definitionVersion": "doubao-v4-candidate-20261007"
      },
      "loudness": {
        "relativeLufs": -8.06,
        "headroomDb": 0,
        "provenance": "measured"
      },
      "quality": {
        "status": "unverified",
        "notes": [
          "真实模型候选；没有把整首或十首精度登记为通过。",
          "时间单位是FFmpeg解码秒；offsetSeconds=0仅表示此坐标原点，手机播放偏移仍未知。",
          "接歌位置仅按模型首拍提议，未判断人声或唱句；音乐听感未知。"
        ]
      },
      "corrections": []
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-b3e113acf45c94436a9d",
      "audioSha256": "b3e113acf45c94436a9d1d6599aea25826d6ae53ac7ee8dbedf51de8eaed8198",
      "analysisVersion": "small0-candidate-e7b158749e86",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 278.3066666666667,
        "decodeMethod": "ffmpeg-f32le-mono-22050",
        "offsetSeconds": 0
      },
      "method": "trained-model",
      "tool": {
        "name": "Beat This!",
        "version": "1.1.0@ad7974846029835307ba19a3d5cefbf40b243041",
        "modelVersion": "small0@sha256:6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
        "parameterVersion": "pulsecraft-source-candidate-0.2.0-cpu-minimal-50fps",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [
        0.34,
        0.8,
        1.24,
        1.68,
        2.12,
        2.56,
        3.02,
        3.44,
        3.88,
        4.34,
        4.76,
        5.22,
        5.66,
        6.1,
        6.54,
        6.98,
        7.42,
        7.86,
        8.3,
        8.74,
        9.18,
        9.64,
        10.08,
        10.52,
        10.94,
        11.4,
        11.84,
        12.28,
        12.72,
        13.16,
        13.6,
        14.04,
        14.48,
        14.92,
        15.36,
        15.8,
        16.24,
        16.68,
        17.12,
        17.56,
        18,
        18.44,
        18.9,
        19.32,
        19.76,
        20.2,
        20.66,
        21.1,
        21.54,
        21.98,
        22.42,
        22.86,
        23.3,
        23.74,
        24.18,
        24.62,
        25.06,
        25.5,
        25.96,
        26.38,
        26.82,
        27.28,
        27.72,
        28.14,
        28.58,
        29.04,
        29.48,
        29.92,
        30.36,
        30.8,
        31.26,
        31.7,
        32.12,
        32.56,
        33.02,
        33.46,
        33.9,
        34.34,
        34.78,
        35.22,
        35.66,
        36.1,
        36.54,
        37,
        37.42,
        37.88,
        38.3,
        38.76,
        39.2,
        39.64,
        40.06,
        40.52,
        40.94,
        41.4,
        41.84,
        42.28,
        42.72,
        43.18,
        43.6,
        44.04,
        44.48,
        44.92,
        45.36,
        45.8,
        46.26,
        46.7,
        47.14,
        47.58,
        48.02,
        48.46,
        48.9,
        49.34,
        49.78,
        50.22,
        50.66,
        51.1,
        51.54,
        51.98,
        52.42,
        52.88,
        53.3,
        53.76,
        54.2,
        54.64,
        55.08,
        55.52,
        55.96,
        56.4,
        56.82,
        57.26,
        57.72,
        58.16,
        58.6,
        59.04,
        59.48,
        60.36,
        60.8,
        61.24,
        61.7,
        62.12,
        62.56,
        63,
        63.44,
        63.88,
        64.34,
        64.78,
        65.22,
        65.66,
        66.12,
        66.54,
        66.98,
        67.42,
        67.88,
        68.3,
        68.76,
        69.2,
        69.64,
        70.08,
        70.52,
        70.96,
        71.4,
        71.84,
        72.28,
        72.72,
        73.16,
        73.6,
        74.04,
        74.48,
        74.92,
        75.36,
        75.8,
        76.24,
        76.68,
        77.14,
        77.58,
        78.02,
        78.46,
        78.9,
        79.34,
        79.78,
        80.2,
        80.64,
        81.1,
        81.54,
        81.98,
        82.44,
        82.86,
        83.3,
        83.76,
        84.18,
        84.64,
        85.08,
        85.52,
        85.96,
        86.4,
        86.84,
        87.28,
        87.72,
        88.16,
        88.6,
        89.04,
        89.48,
        90.38,
        91.26,
        92.14,
        93.02,
        93.88,
        94.78,
        95.66,
        96.56,
        97.42,
        98.32,
        99.18,
        100.08,
        100.96,
        101.84,
        102.72,
        103.62,
        104.48,
        105.38,
        106.26,
        107.14,
        108.02,
        108.9,
        109.78,
        110.66,
        111.54,
        112.42,
        113.3,
        114.18,
        115.08,
        115.96,
        116.84,
        117.72,
        118.6,
        119.48,
        120.36,
        121.24,
        122.14,
        123.02,
        123.9,
        124.78,
        125.66,
        126.54,
        127.42,
        128.3,
        129.18,
        130.08,
        130.96,
        131.84,
        132.72,
        133.6,
        134.48,
        135.36,
        136.24,
        137.14,
        138.02,
        138.9,
        139.78,
        140.68,
        141.54,
        142.42,
        143.32,
        144.2,
        145.08,
        145.96,
        146.84,
        147.72,
        148.6,
        149.48,
        150.36,
        151.26,
        152.14,
        153.02,
        153.9,
        154.78,
        155.66,
        156.54,
        157.42,
        158.3,
        159.2,
        160.08,
        160.96,
        161.84,
        162.72,
        163.6,
        164.48,
        165.36,
        166.26,
        167.12,
        168.02,
        168.9,
        169.76,
        170.64,
        171.52,
        172.42,
        173.3,
        174.18,
        175.06,
        175.96,
        176.84,
        177.72,
        178.58,
        179.48,
        180.36,
        181.26,
        182.14,
        183.02,
        183.9,
        184.78,
        185.66,
        186.54,
        187.42,
        188.3,
        189.18,
        190.06,
        190.96,
        191.84,
        192.72,
        193.6,
        194.48,
        195.36,
        196.24,
        197.14,
        198,
        198.9,
        199.78,
        200.66,
        201.54,
        202.42,
        203.3,
        204.2,
        205.06,
        205.96,
        206.84,
        207.72,
        208.6,
        209.48,
        210.38,
        211.26,
        212.12,
        213.02,
        213.9,
        214.78,
        215.66,
        216.54,
        217.44,
        218.3,
        219.18,
        220.08,
        220.96,
        221.84,
        222.72,
        223.6,
        224.48,
        225.36,
        226.26,
        227.14,
        228.02,
        228.9,
        229.78,
        230.66,
        231.54,
        232.42,
        233.3,
        234.2,
        235.08,
        235.96,
        236.84,
        237.72,
        238.16,
        238.6,
        239.06,
        239.48,
        239.92,
        240.36,
        240.8,
        241.24,
        241.68,
        242.14,
        242.58,
        243,
        243.44,
        243.9,
        244.34,
        244.78,
        245.2,
        245.66,
        246.1,
        246.54,
        247,
        247.42,
        247.88,
        248.32,
        248.76,
        249.18,
        249.64,
        250.08,
        250.5,
        250.96,
        251.4,
        251.82,
        252.28,
        252.72,
        253.14,
        253.6,
        254.04,
        254.48,
        254.92,
        255.36,
        255.8,
        256.24,
        256.68,
        257.12,
        257.56,
        258,
        258.44,
        258.9,
        259.32,
        259.76,
        260.22,
        260.66,
        261.1,
        261.54,
        261.98,
        262.42,
        262.86,
        263.3,
        263.74,
        264.18,
        264.64,
        265.06,
        265.52,
        265.96,
        266.38,
        266.82,
        267.28,
        267.7,
        268.64
      ],
      "downbeatsSeconds": [
        1.24,
        3.02,
        4.76,
        6.54,
        8.3,
        10.08,
        11.84,
        13.6,
        15.36,
        17.12,
        18.9,
        20.66,
        22.42,
        24.18,
        25.96,
        27.72,
        29.48,
        31.26,
        33.02,
        34.78,
        36.54,
        38.3,
        40.06,
        41.84,
        43.6,
        45.36,
        47.14,
        48.9,
        50.66,
        52.42,
        54.2,
        55.96,
        57.72,
        59.48,
        61.24,
        63,
        64.78,
        66.54,
        68.3,
        70.08,
        71.84,
        73.6,
        75.36,
        77.14,
        78.9,
        80.64,
        82.44,
        84.18,
        85.96,
        87.72,
        91.26,
        94.78,
        98.32,
        101.84,
        105.38,
        108.9,
        112.42,
        115.96,
        117.72,
        119.48,
        121.24,
        123.02,
        124.78,
        126.54,
        130.08,
        133.6,
        137.14,
        138.9,
        142.42,
        145.96,
        149.48,
        153.02,
        156.54,
        160.08,
        163.6,
        167.12,
        170.64,
        174.18,
        177.72,
        181.26,
        184.78,
        188.3,
        191.84,
        195.36,
        198.9,
        202.42,
        205.96,
        209.48,
        213.02,
        216.54,
        220.08,
        223.6,
        227.14,
        230.66,
        234.2,
        237.72,
        239.48,
        241.24,
        243,
        244.78,
        246.54,
        248.32,
        250.08,
        251.82,
        253.6,
        255.36,
        257.12,
        258.9,
        260.66,
        262.42,
        264.18,
        265.96,
        267.7,
        268.64
      ],
      "localTempo": [
        {
          "startSeconds": 0.34,
          "endSeconds": 3.88,
          "bpm": 136.36363636363637,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 3.88,
          "endSeconds": 7.42,
          "bpm": 136.36363636363623,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 7.42,
          "endSeconds": 10.94,
          "bpm": 136.36363636363652,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 10.94,
          "endSeconds": 14.48,
          "bpm": 136.36363636363652,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 14.48,
          "endSeconds": 18,
          "bpm": 136.36363636363623,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 18,
          "endSeconds": 21.54,
          "bpm": 136.36363636363598,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 21.54,
          "endSeconds": 25.06,
          "bpm": 136.36363636363598,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 25.06,
          "endSeconds": 28.58,
          "bpm": 136.36363636363652,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 28.58,
          "endSeconds": 32.12,
          "bpm": 136.36363636363598,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 32.12,
          "endSeconds": 35.66,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 35.66,
          "endSeconds": 39.2,
          "bpm": 136.36363636363487,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 39.2,
          "endSeconds": 42.72,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 42.72,
          "endSeconds": 46.26,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 46.26,
          "endSeconds": 49.78,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 49.78,
          "endSeconds": 53.3,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 53.3,
          "endSeconds": 56.82,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 56.82,
          "endSeconds": 60.8,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 60.8,
          "endSeconds": 64.34,
          "bpm": 136.36363636363487,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 64.34,
          "endSeconds": 67.88,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 67.88,
          "endSeconds": 71.4,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 71.4,
          "endSeconds": 74.92,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 74.92,
          "endSeconds": 78.46,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 78.46,
          "endSeconds": 81.98,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 81.98,
          "endSeconds": 85.52,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 85.52,
          "endSeconds": 89.04,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 89.04,
          "endSeconds": 95.66,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 95.66,
          "endSeconds": 102.72,
          "bpm": 68.18181818181799,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 102.72,
          "endSeconds": 109.78,
          "bpm": 68.18181818181799,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 109.78,
          "endSeconds": 116.84,
          "bpm": 68.18181818181799,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 116.84,
          "endSeconds": 123.9,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 123.9,
          "endSeconds": 130.96,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 130.96,
          "endSeconds": 138.02,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 138.02,
          "endSeconds": 145.08,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 145.08,
          "endSeconds": 152.14,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 152.14,
          "endSeconds": 159.2,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 159.2,
          "endSeconds": 166.26,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 166.26,
          "endSeconds": 173.3,
          "bpm": 68.18181818181743,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 173.3,
          "endSeconds": 180.36,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 180.36,
          "endSeconds": 187.42,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 187.42,
          "endSeconds": 194.48,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 194.48,
          "endSeconds": 201.54,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 201.54,
          "endSeconds": 208.6,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 208.6,
          "endSeconds": 215.66,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 215.66,
          "endSeconds": 222.72,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 222.72,
          "endSeconds": 229.78,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 229.78,
          "endSeconds": 236.84,
          "bpm": 68.18181818181853,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 236.84,
          "endSeconds": 240.8,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 240.8,
          "endSeconds": 244.34,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 244.34,
          "endSeconds": 247.88,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 247.88,
          "endSeconds": 251.4,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 251.4,
          "endSeconds": 254.92,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 254.92,
          "endSeconds": 258.44,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 258.44,
          "endSeconds": 261.98,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 261.98,
          "endSeconds": 265.52,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 265.52,
          "endSeconds": 268.64,
          "bpm": 136.36363636363706,
          "ambiguity": "unknown"
        }
      ],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 30,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 30,
          "endSeconds": 63,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 63,
          "endSeconds": 99,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 99,
          "endSeconds": 128,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 128,
          "endSeconds": 152,
          "label": "candidate-5",
          "provenance": "candidate"
        },
        {
          "startSeconds": 152,
          "endSeconds": 199,
          "label": "candidate-6",
          "provenance": "candidate"
        },
        {
          "startSeconds": 199,
          "endSeconds": 218,
          "label": "candidate-7",
          "provenance": "candidate"
        },
        {
          "startSeconds": 218,
          "endSeconds": 243,
          "label": "candidate-8",
          "provenance": "candidate"
        },
        {
          "startSeconds": 243,
          "endSeconds": 259,
          "label": "candidate-9",
          "provenance": "candidate"
        },
        {
          "startSeconds": 259,
          "endSeconds": 278.3066666666667,
          "label": "candidate-10",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "model-entry-candidate",
          "kind": "entry",
          "startSeconds": 6.54,
          "endSeconds": 8.54,
          "anchorSeconds": 6.54,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        },
        {
          "id": "model-exit-candidate",
          "kind": "exit",
          "startSeconds": 266.64,
          "endSeconds": 268.64,
          "anchorSeconds": 268.64,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        }
      ],
      "energy": {
        "label": "high",
        "method": "model-estimate",
        "definitionVersion": "doubao-v4-candidate-20261007"
      },
      "loudness": {
        "relativeLufs": -8.47,
        "headroomDb": 0,
        "provenance": "measured"
      },
      "quality": {
        "status": "unverified",
        "notes": [
          "真实模型候选；没有把整首或十首精度登记为通过。",
          "时间单位是FFmpeg解码秒；offsetSeconds=0仅表示此坐标原点，手机播放偏移仍未知。",
          "接歌位置仅按模型首拍提议，未判断人声或唱句；音乐听感未知。"
        ]
      },
      "corrections": []
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-e684868f49202ef811b6",
      "audioSha256": "e684868f49202ef811b6a32d2c51f470fa516b67c35fc22cffb7d98fe34c393f",
      "analysisVersion": "small0-candidate-b9339eb87b49",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 197.7324716553288,
        "decodeMethod": "ffmpeg-f32le-mono-22050",
        "offsetSeconds": 0
      },
      "method": "trained-model",
      "tool": {
        "name": "Beat This!",
        "version": "1.1.0@ad7974846029835307ba19a3d5cefbf40b243041",
        "modelVersion": "small0@sha256:6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
        "parameterVersion": "pulsecraft-source-candidate-0.2.0-cpu-minimal-50fps",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [
        0.12,
        0.9,
        1.68,
        2.46,
        3.26,
        4.06,
        4.88,
        5.7,
        6.52,
        7.3,
        8.08,
        8.88,
        9.66,
        10.48,
        11.3,
        12.1,
        12.88,
        13.7,
        14.5,
        15.3,
        16.08,
        16.9,
        17.7,
        18.5,
        19.3,
        20.1,
        20.9,
        21.7,
        22.5,
        23.28,
        24.1,
        24.9,
        25.68,
        26.46,
        27.28,
        28.06,
        28.86,
        29.66,
        30.5,
        31.32,
        32.12,
        32.92,
        33.7,
        34.48,
        35.28,
        36.1,
        36.9,
        37.7,
        38.5,
        39.3,
        40.1,
        40.9,
        41.7,
        42.52,
        43.3,
        44.08,
        44.88,
        45.68,
        46.5,
        47.3,
        48.1,
        48.9,
        49.7,
        50.48,
        51.28,
        52.1,
        52.9,
        53.7,
        54.5,
        55.28,
        56.08,
        56.88,
        57.7,
        58.48,
        59.3,
        60.1,
        60.9,
        61.7,
        62.5,
        63.28,
        64.1,
        64.88,
        65.7,
        66.48,
        67.3,
        68.08,
        68.9,
        69.7,
        70.5,
        71.28,
        72.1,
        72.88,
        73.7,
        74.5,
        75.3,
        76.08,
        76.9,
        77.7,
        78.5,
        79.28,
        80.1,
        80.88,
        81.7,
        82.5,
        83.28,
        84.1,
        84.9,
        85.7,
        86.5,
        87.3,
        88.1,
        88.88,
        89.7,
        90.5,
        91.3,
        92.1,
        92.9,
        93.7,
        94.5,
        95.3,
        96.1,
        96.9,
        97.7,
        98.5,
        99.3,
        100.1,
        100.9,
        101.7,
        102.5,
        103.28,
        104.1,
        104.9,
        105.7,
        106.5,
        107.3,
        108.08,
        108.9,
        109.7,
        110.5,
        111.3,
        112.1,
        112.9,
        113.7,
        114.48,
        115.3,
        116.08,
        116.9,
        117.68,
        118.5,
        119.3,
        120.1,
        120.88,
        121.7,
        122.48,
        123.3,
        124.1,
        124.9,
        125.68,
        126.5,
        127.28,
        128.1,
        128.88,
        129.7,
        130.48,
        131.3,
        132.08,
        132.9,
        133.68,
        134.5,
        135.28,
        136.1,
        136.88,
        137.7,
        138.48,
        139.3,
        140.08,
        140.9,
        141.68,
        142.5,
        143.3,
        144.1,
        144.88,
        145.68,
        146.5,
        147.3,
        148.1,
        148.9,
        149.7,
        150.5,
        151.28,
        152.08,
        152.88,
        153.68,
        154.48,
        155.28,
        156.1,
        156.9,
        157.7,
        158.52,
        159.32,
        160.12,
        160.9,
        161.7,
        162.48,
        163.3,
        164.08,
        164.88,
        165.66,
        166.5,
        167.28,
        168.1,
        168.88,
        169.7,
        170.48,
        171.28,
        172.08,
        172.9,
        173.68,
        174.5,
        175.28,
        176.1,
        176.88,
        177.7,
        178.48,
        179.3,
        180.08,
        180.9,
        181.68,
        182.5,
        183.28,
        184.1,
        184.88,
        185.7,
        186.5,
        187.3,
        188.12,
        188.92,
        189.7
      ],
      "downbeatsSeconds": [
        0.12,
        3.26,
        6.52,
        9.66,
        12.88,
        16.08,
        19.3,
        22.5,
        25.68,
        28.86,
        32.12,
        34.48,
        35.28,
        38.5,
        41.7,
        44.88,
        48.1,
        51.28,
        54.5,
        57.7,
        60.9,
        64.1,
        67.3,
        70.5,
        73.7,
        76.9,
        80.1,
        83.28,
        86.5,
        89.7,
        92.9,
        96.1,
        99.3,
        102.5,
        105.7,
        108.9,
        112.1,
        115.3,
        118.5,
        121.7,
        124.9,
        128.1,
        131.3,
        134.5,
        137.7,
        140.9,
        144.1,
        147.3,
        150.5,
        153.68,
        156.9,
        160.12,
        163.3,
        166.5,
        169.7,
        172.9,
        176.1,
        179.3,
        182.5,
        185.7,
        188.92
      ],
      "localTempo": [
        {
          "startSeconds": 0.12,
          "endSeconds": 6.52,
          "bpm": 75.00000000000001,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 6.52,
          "endSeconds": 12.88,
          "bpm": 75.94936708860759,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 12.88,
          "endSeconds": 19.3,
          "bpm": 74.99999999999993,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 19.3,
          "endSeconds": 25.68,
          "bpm": 75.0000000000001,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 25.68,
          "endSeconds": 32.12,
          "bpm": 74.99999999999993,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 32.12,
          "endSeconds": 38.5,
          "bpm": 74.99999999999993,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 38.5,
          "endSeconds": 44.88,
          "bpm": 74.99999999999993,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 44.88,
          "endSeconds": 51.28,
          "bpm": 74.99999999999993,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 51.28,
          "endSeconds": 57.7,
          "bpm": 74.99999999999993,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 57.7,
          "endSeconds": 64.1,
          "bpm": 74.99999999999993,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 64.1,
          "endSeconds": 70.5,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 70.5,
          "endSeconds": 76.9,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 76.9,
          "endSeconds": 83.28,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 83.28,
          "endSeconds": 89.7,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 89.7,
          "endSeconds": 96.1,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 96.1,
          "endSeconds": 102.5,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 102.5,
          "endSeconds": 108.9,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 108.9,
          "endSeconds": 115.3,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 115.3,
          "endSeconds": 121.7,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 121.7,
          "endSeconds": 128.1,
          "bpm": 74.9999999999996,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 128.1,
          "endSeconds": 134.5,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 134.5,
          "endSeconds": 140.9,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 140.9,
          "endSeconds": 147.3,
          "bpm": 74.99999999999893,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 147.3,
          "endSeconds": 153.68,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 153.68,
          "endSeconds": 160.12,
          "bpm": 74.99999999999893,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 160.12,
          "endSeconds": 166.5,
          "bpm": 75.94936708860835,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 166.5,
          "endSeconds": 172.9,
          "bpm": 74.99999999999893,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 172.9,
          "endSeconds": 179.3,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 179.3,
          "endSeconds": 185.7,
          "bpm": 75.00000000000027,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 185.7,
          "endSeconds": 189.7,
          "bpm": 74.99999999999893,
          "ambiguity": "unknown"
        }
      ],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 27,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 27,
          "endSeconds": 50,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 50,
          "endSeconds": 95,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 95,
          "endSeconds": 147,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 147,
          "endSeconds": 165,
          "label": "candidate-5",
          "provenance": "candidate"
        },
        {
          "startSeconds": 165,
          "endSeconds": 188,
          "label": "candidate-6",
          "provenance": "candidate"
        },
        {
          "startSeconds": 188,
          "endSeconds": 197.7324716553288,
          "label": "candidate-7",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "model-entry-candidate",
          "kind": "entry",
          "startSeconds": 6.52,
          "endSeconds": 8.52,
          "anchorSeconds": 6.52,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        },
        {
          "id": "model-exit-candidate",
          "kind": "exit",
          "startSeconds": 186.92,
          "endSeconds": 188.92,
          "anchorSeconds": 188.92,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        }
      ],
      "energy": {
        "label": "low",
        "method": "model-estimate",
        "definitionVersion": "doubao-v4-candidate-20261007"
      },
      "loudness": {
        "relativeLufs": -9.1,
        "headroomDb": 0,
        "provenance": "measured"
      },
      "quality": {
        "status": "unverified",
        "notes": [
          "真实模型候选；没有把整首或十首精度登记为通过。",
          "时间单位是FFmpeg解码秒；offsetSeconds=0仅表示此坐标原点，手机播放偏移仍未知。",
          "接歌位置仅按模型首拍提议，未判断人声或唱句；音乐听感未知。"
        ]
      },
      "corrections": []
    },
    {
      "schemaVersion": "0.2.0",
      "musicId": "song-ee87db9502fc2eb535d1",
      "audioSha256": "ee87db9502fc2eb535d1072806eb0400c51839b4845323df439ec1adebdd6ce3",
      "analysisVersion": "small0-candidate-55348c4974a3",
      "timebase": {
        "unit": "seconds",
        "durationSeconds": 255.70861678004536,
        "decodeMethod": "ffmpeg-f32le-mono-22050",
        "offsetSeconds": 0
      },
      "method": "trained-model",
      "tool": {
        "name": "Beat This!",
        "version": "1.1.0@ad7974846029835307ba19a3d5cefbf40b243041",
        "modelVersion": "small0@sha256:6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b",
        "parameterVersion": "pulsecraft-source-candidate-0.2.0-cpu-minimal-50fps",
        "licenseStatus": "approved-for-current-purpose"
      },
      "beatsSeconds": [
        3.1,
        3.86,
        4.64,
        5.38,
        6.14,
        6.9,
        7.7,
        8.48,
        9.24,
        10,
        10.78,
        11.54,
        12.32,
        13.08,
        13.86,
        14.62,
        15.4,
        16.16,
        16.94,
        17.7,
        18.48,
        19.24,
        20,
        20.78,
        21.54,
        22.3,
        23.08,
        23.86,
        24.64,
        25.4,
        26.18,
        26.94,
        27.7,
        28.48,
        29.24,
        30,
        30.78,
        31.56,
        32.32,
        33.08,
        33.86,
        34.62,
        35.4,
        36.16,
        36.94,
        37.7,
        38.48,
        39.24,
        40.02,
        40.78,
        41.56,
        42.32,
        43.08,
        43.86,
        44.62,
        45.4,
        46.18,
        46.94,
        47.7,
        48.48,
        49.24,
        50,
        50.78,
        51.54,
        52.32,
        53.08,
        53.86,
        54.62,
        55.4,
        56.16,
        56.94,
        57.7,
        58.48,
        59.24,
        60,
        60.78,
        61.56,
        62.32,
        63.1,
        63.86,
        64.64,
        65.4,
        66.16,
        66.94,
        67.7,
        68.48,
        69.24,
        70.02,
        70.78,
        71.54,
        72.32,
        73.08,
        73.86,
        74.62,
        75.4,
        76.16,
        76.94,
        77.7,
        78.48,
        79.26,
        80.02,
        80.78,
        81.56,
        82.32,
        83.1,
        83.86,
        84.64,
        85.4,
        86.16,
        86.92,
        87.7,
        88.48,
        89.24,
        90.02,
        90.78,
        91.56,
        92.32,
        93.08,
        93.86,
        94.62,
        95.4,
        96.16,
        96.94,
        97.7,
        98.48,
        99.24,
        100.02,
        100.78,
        101.56,
        102.32,
        103.1,
        103.86,
        104.62,
        105.4,
        106.18,
        106.94,
        107.72,
        108.48,
        109.26,
        110.02,
        110.78,
        111.54,
        112.32,
        113.1,
        113.86,
        114.62,
        115.4,
        116.16,
        116.94,
        117.7,
        118.48,
        119.24,
        120.02,
        120.78,
        121.56,
        122.32,
        123.1,
        123.86,
        124.64,
        125.4,
        126.16,
        126.94,
        127.72,
        128.46,
        129.24,
        130,
        130.78,
        131.54,
        132.32,
        133.08,
        133.86,
        134.62,
        135.4,
        136.16,
        136.94,
        137.7,
        138.48,
        139.24,
        140.02,
        140.78,
        141.56,
        142.32,
        143.1,
        143.86,
        144.64,
        145.4,
        146.18,
        146.94,
        147.72,
        148.48,
        149.24,
        150.02,
        150.78,
        151.54,
        152.32,
        153.1,
        153.86,
        154.64,
        155.4,
        156.18,
        156.94,
        157.72,
        158.48,
        159.24,
        160.02,
        160.78,
        161.56,
        162.32,
        163.1,
        163.86,
        164.64,
        165.4,
        166.16,
        166.92,
        167.72,
        168.48,
        169.26,
        170.02,
        170.78,
        171.56,
        172.32,
        173.08,
        173.86,
        174.62,
        175.4,
        176.16,
        176.92,
        177.7,
        178.48,
        179.24,
        180.02,
        180.78,
        181.56,
        182.32,
        183.1,
        183.86,
        184.62,
        185.4,
        186.16,
        186.94,
        187.7,
        188.48,
        189.24,
        190.02,
        190.78,
        191.54,
        192.32,
        193.1,
        193.86,
        194.64,
        195.4,
        196.18,
        196.94,
        197.7,
        198.48,
        199.24,
        200.02,
        200.78,
        201.56,
        202.32,
        203.1,
        203.86,
        204.64,
        205.4,
        206.18,
        206.94,
        207.7,
        208.48,
        209.26,
        210.02,
        210.8,
        211.56,
        212.32,
        213.1,
        213.86,
        214.62,
        215.38,
        216.16,
        216.94,
        217.7,
        218.48,
        219.24,
        220.02,
        220.78,
        221.54,
        222.32,
        223.1,
        223.86,
        224.64,
        225.4,
        226.16,
        226.94,
        227.7,
        228.48,
        229.26,
        230.02,
        230.78,
        231.56,
        232.32,
        233.08,
        233.86,
        234.62,
        235.4,
        236.18,
        236.92,
        237.7,
        238.48,
        239.24,
        240.02,
        240.78,
        241.54,
        242.32,
        243.08,
        243.86,
        244.64,
        245.4,
        246.16,
        246.92,
        247.7,
        248.46,
        249.24,
        250
      ],
      "downbeatsSeconds": [
        3.1,
        4.64,
        7.7,
        10.78,
        13.86,
        16.94,
        20,
        23.08,
        26.18,
        29.24,
        32.32,
        35.4,
        38.48,
        41.56,
        44.62,
        47.7,
        50.78,
        53.86,
        56.94,
        60,
        63.1,
        66.16,
        69.24,
        72.32,
        75.4,
        78.48,
        81.56,
        84.64,
        87.7,
        90.78,
        93.86,
        96.94,
        100.02,
        103.1,
        106.18,
        109.26,
        112.32,
        115.4,
        118.48,
        121.56,
        124.64,
        127.72,
        130.78,
        133.86,
        136.94,
        140.02,
        143.1,
        146.18,
        149.24,
        152.32,
        155.4,
        158.48,
        161.56,
        164.64,
        167.72,
        170.78,
        173.86,
        176.92,
        180.02,
        183.1,
        186.16,
        189.24,
        192.32,
        195.4,
        198.48,
        201.56,
        204.64,
        207.7,
        210.8,
        213.86,
        216.94,
        220.02,
        223.1,
        226.16,
        229.26,
        232.32,
        235.4,
        238.48,
        241.54,
        244.64,
        247.7,
        250
      ],
      "localTempo": [
        {
          "startSeconds": 3.1,
          "endSeconds": 9.24,
          "bpm": 78.9473684210526,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 9.24,
          "endSeconds": 15.4,
          "bpm": 77.92207792207796,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 15.4,
          "endSeconds": 21.54,
          "bpm": 78.94736842105256,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 21.54,
          "endSeconds": 27.7,
          "bpm": 77.92207792207796,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 27.7,
          "endSeconds": 33.86,
          "bpm": 77.92207792207796,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 33.86,
          "endSeconds": 40.02,
          "bpm": 77.92207792207796,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 40.02,
          "endSeconds": 46.18,
          "bpm": 77.92207792207796,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 46.18,
          "endSeconds": 52.32,
          "bpm": 78.9473684210521,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 52.32,
          "endSeconds": 58.48,
          "bpm": 77.92207792207796,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 58.48,
          "endSeconds": 64.64,
          "bpm": 77.9220779220776,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 64.64,
          "endSeconds": 70.78,
          "bpm": 78.9473684210521,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 70.78,
          "endSeconds": 76.94,
          "bpm": 77.92207792207833,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 76.94,
          "endSeconds": 83.1,
          "bpm": 77.9220779220776,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 83.1,
          "endSeconds": 89.24,
          "bpm": 78.9473684210521,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 89.24,
          "endSeconds": 95.4,
          "bpm": 77.9220779220776,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 95.4,
          "endSeconds": 101.56,
          "bpm": 77.9220779220776,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 101.56,
          "endSeconds": 107.72,
          "bpm": 77.9220779220776,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 107.72,
          "endSeconds": 113.86,
          "bpm": 78.9473684210521,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 113.86,
          "endSeconds": 120.02,
          "bpm": 77.9220779220776,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 120.02,
          "endSeconds": 126.16,
          "bpm": 78.9473684210521,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 126.16,
          "endSeconds": 132.32,
          "bpm": 76.9230769230768,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 132.32,
          "endSeconds": 138.48,
          "bpm": 77.92207792207688,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 138.48,
          "endSeconds": 144.64,
          "bpm": 77.92207792207833,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 144.64,
          "endSeconds": 150.78,
          "bpm": 78.94736842105063,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 150.78,
          "endSeconds": 156.94,
          "bpm": 77.92207792207833,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 156.94,
          "endSeconds": 163.1,
          "bpm": 77.92207792207688,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 163.1,
          "endSeconds": 169.26,
          "bpm": 78.94736842105063,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 169.26,
          "endSeconds": 175.4,
          "bpm": 78.94736842105063,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 175.4,
          "endSeconds": 181.56,
          "bpm": 77.92207792207688,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 181.56,
          "endSeconds": 187.7,
          "bpm": 78.9473684210521,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 187.7,
          "endSeconds": 193.86,
          "bpm": 77.92207792207688,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 193.86,
          "endSeconds": 200.02,
          "bpm": 77.92207792207833,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 200.02,
          "endSeconds": 206.18,
          "bpm": 77.92207792207833,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 206.18,
          "endSeconds": 212.32,
          "bpm": 78.9473684210521,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 212.32,
          "endSeconds": 218.48,
          "bpm": 77.92207792207688,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 218.48,
          "endSeconds": 224.64,
          "bpm": 77.92207792207833,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 224.64,
          "endSeconds": 230.78,
          "bpm": 78.94736842105063,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 230.78,
          "endSeconds": 236.92,
          "bpm": 77.92207792207688,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 236.92,
          "endSeconds": 243.08,
          "bpm": 77.92207792207688,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 243.08,
          "endSeconds": 249.24,
          "bpm": 77.92207792207833,
          "ambiguity": "unknown"
        },
        {
          "startSeconds": 249.24,
          "endSeconds": 250,
          "bpm": 78.94736842105358,
          "ambiguity": "unknown"
        }
      ],
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 23,
          "label": "candidate-1",
          "provenance": "candidate"
        },
        {
          "startSeconds": 23,
          "endSeconds": 51,
          "label": "candidate-2",
          "provenance": "candidate"
        },
        {
          "startSeconds": 51,
          "endSeconds": 88,
          "label": "candidate-3",
          "provenance": "candidate"
        },
        {
          "startSeconds": 88,
          "endSeconds": 123,
          "label": "candidate-4",
          "provenance": "candidate"
        },
        {
          "startSeconds": 123,
          "endSeconds": 175,
          "label": "candidate-5",
          "provenance": "candidate"
        },
        {
          "startSeconds": 175,
          "endSeconds": 212,
          "label": "candidate-6",
          "provenance": "candidate"
        },
        {
          "startSeconds": 212,
          "endSeconds": 255.70861678004536,
          "label": "candidate-7",
          "provenance": "candidate"
        }
      ],
      "windows": [
        {
          "id": "model-entry-candidate",
          "kind": "entry",
          "startSeconds": 7.7,
          "endSeconds": 9.7,
          "anchorSeconds": 7.7,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        },
        {
          "id": "model-exit-candidate",
          "kind": "exit",
          "startSeconds": 248,
          "endSeconds": 250,
          "anchorSeconds": 250,
          "checkedByListening": false,
          "vocalOverlapRisk": "unknown",
          "provenance": "trained-model"
        }
      ],
      "energy": {
        "label": "medium",
        "method": "model-estimate",
        "definitionVersion": "doubao-v4-candidate-20261007"
      },
      "loudness": {
        "relativeLufs": -10.91,
        "headroomDb": 0.29,
        "provenance": "measured"
      },
      "quality": {
        "status": "unverified",
        "notes": [
          "真实模型候选；没有把整首或十首精度登记为通过。",
          "时间单位是FFmpeg解码秒；offsetSeconds=0仅表示此坐标原点，手机播放偏移仍未知。",
          "接歌位置仅按模型首拍提议，未判断人声或唱句；音乐听感未知。"
        ]
      },
      "corrections": []
    }
  ]
};

}};
registry["miniprogram/catalog/ten-song-private-test.intensity.js"]={loaded:false,exports:{},fn:function(module,exports,require){
// 段级强度内嵌模块（设备侧，miniprogram 运行时使用）
// 由 artifacts/local/gen-ten-song-manifest.js 从 analysis/catalog.intensity.json 机械生成（缺文件时为空模块）。
// 数据为确定性 DSP 提取的曲内相对量，仅作编排内部信号：不进用户界面、不改能量标签、不参与任何契约校验。
// 键 = musicId；每段 {startSeconds,endSeconds,intensityMean,intensityPeak,meanRmsDb} 与清单 analyses 段结构逐位对齐。
'use strict';
module.exports = {
  "schemaVersion": "1.0.0",
  "byMusicId": {
    "song-115662b177d4892cfd89": {
      "audioSha256": "115662b177d4892cfd89f547b5ad575e4b511d8bb6a503ca99eccdb2b5dabc61",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 22,
          "intensityMean": 0.15,
          "intensityPeak": 0.55,
          "meanRmsDb": -29.09
        },
        {
          "startSeconds": 22,
          "endSeconds": 40,
          "intensityMean": 0.38,
          "intensityPeak": 0.64,
          "meanRmsDb": -15.63
        },
        {
          "startSeconds": 40,
          "endSeconds": 55,
          "intensityMean": 0.15,
          "intensityPeak": 0.31,
          "meanRmsDb": -19.43
        },
        {
          "startSeconds": 55,
          "endSeconds": 90,
          "intensityMean": 0.52,
          "intensityPeak": 0.78,
          "meanRmsDb": -14.18
        },
        {
          "startSeconds": 90,
          "endSeconds": 120,
          "intensityMean": 0.87,
          "intensityPeak": 1,
          "meanRmsDb": -7.38
        },
        {
          "startSeconds": 120,
          "endSeconds": 141,
          "intensityMean": 0.58,
          "intensityPeak": 0.91,
          "meanRmsDb": -11.48
        },
        {
          "startSeconds": 141,
          "endSeconds": 266.3827664399093,
          "intensityMean": 0.73,
          "intensityPeak": 1,
          "meanRmsDb": -10.73
        }
      ]
    },
    "song-261c943afe3c29ccd81f": {
      "audioSha256": "261c943afe3c29ccd81f3073721b121df60f6ab877a530b14e612989a7e124c7",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 16,
          "intensityMean": 0.26,
          "intensityPeak": 0.67,
          "meanRmsDb": -29.93
        },
        {
          "startSeconds": 16,
          "endSeconds": 38,
          "intensityMean": 0.34,
          "intensityPeak": 0.66,
          "meanRmsDb": -25.36
        },
        {
          "startSeconds": 38,
          "endSeconds": 58,
          "intensityMean": 0.6,
          "intensityPeak": 0.81,
          "meanRmsDb": -17.1
        },
        {
          "startSeconds": 58,
          "endSeconds": 91,
          "intensityMean": 0.68,
          "intensityPeak": 0.93,
          "meanRmsDb": -15.65
        },
        {
          "startSeconds": 91,
          "endSeconds": 117,
          "intensityMean": 0.61,
          "intensityPeak": 0.93,
          "meanRmsDb": -16.74
        },
        {
          "startSeconds": 117,
          "endSeconds": 227,
          "intensityMean": 0.86,
          "intensityPeak": 1,
          "meanRmsDb": -13.24
        },
        {
          "startSeconds": 227,
          "endSeconds": 256.02666666666664,
          "intensityMean": 0.32,
          "intensityPeak": 0.83,
          "meanRmsDb": -30.09
        }
      ]
    },
    "song-8b8251a7f78e32735593": {
      "audioSha256": "8b8251a7f78e32735593ab738031bc45e1ec4a3c2f80f1418ece5e60c41d6038",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 17,
          "intensityMean": 0.05,
          "intensityPeak": 0.17,
          "meanRmsDb": -18.07
        },
        {
          "startSeconds": 17,
          "endSeconds": 89,
          "intensityMean": 0.53,
          "intensityPeak": 1,
          "meanRmsDb": -11.01
        },
        {
          "startSeconds": 89,
          "endSeconds": 167,
          "intensityMean": 0.6,
          "intensityPeak": 1,
          "meanRmsDb": -9.66
        },
        {
          "startSeconds": 167,
          "endSeconds": 184,
          "intensityMean": 0.4,
          "intensityPeak": 0.68,
          "meanRmsDb": -11.53
        },
        {
          "startSeconds": 184,
          "endSeconds": 231.46666666666667,
          "intensityMean": 0.75,
          "intensityPeak": 1,
          "meanRmsDb": -11.63
        }
      ]
    },
    "song-94d23acb31a5ea7430d3": {
      "audioSha256": "94d23acb31a5ea7430d30fb7ce01db57037c1db7ee6d756965bedc547e0035d0",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 32,
          "intensityMean": 0.68,
          "intensityPeak": 0.97,
          "meanRmsDb": -10.46
        },
        {
          "startSeconds": 32,
          "endSeconds": 71,
          "intensityMean": 0.79,
          "intensityPeak": 1,
          "meanRmsDb": -9.63
        },
        {
          "startSeconds": 71,
          "endSeconds": 90,
          "intensityMean": 0.77,
          "intensityPeak": 1,
          "meanRmsDb": -10.56
        },
        {
          "startSeconds": 90,
          "endSeconds": 115,
          "intensityMean": 0.72,
          "intensityPeak": 0.97,
          "meanRmsDb": -10.41
        },
        {
          "startSeconds": 115,
          "endSeconds": 136,
          "intensityMean": 0.76,
          "intensityPeak": 1,
          "meanRmsDb": -10.33
        },
        {
          "startSeconds": 136,
          "endSeconds": 158,
          "intensityMean": 0.74,
          "intensityPeak": 0.97,
          "meanRmsDb": -10.23
        },
        {
          "startSeconds": 158,
          "endSeconds": 176,
          "intensityMean": 0.82,
          "intensityPeak": 1,
          "meanRmsDb": -10.01
        },
        {
          "startSeconds": 176,
          "endSeconds": 200,
          "intensityMean": 0.8,
          "intensityPeak": 1,
          "meanRmsDb": -9.94
        },
        {
          "startSeconds": 200,
          "endSeconds": 247,
          "intensityMean": 0.77,
          "intensityPeak": 1,
          "meanRmsDb": -9.87
        },
        {
          "startSeconds": 247,
          "endSeconds": 267,
          "intensityMean": 0.67,
          "intensityPeak": 1,
          "meanRmsDb": -11.05
        },
        {
          "startSeconds": 267,
          "endSeconds": 287,
          "intensityMean": 0.47,
          "intensityPeak": 1,
          "meanRmsDb": -15.17
        },
        {
          "startSeconds": 287,
          "endSeconds": 298.1219954648526,
          "intensityMean": 0.01,
          "intensityPeak": 0.16,
          "meanRmsDb": -49.22
        }
      ]
    },
    "song-9d9e4b6a0ea2681ae8ae": {
      "audioSha256": "9d9e4b6a0ea2681ae8aeeee1ffa7a118581949c03e5f28e9b8716adb7de51746",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 17,
          "intensityMean": 0.4,
          "intensityPeak": 0.7,
          "meanRmsDb": -18.06
        },
        {
          "startSeconds": 17,
          "endSeconds": 50,
          "intensityMean": 0.57,
          "intensityPeak": 1,
          "meanRmsDb": -14.99
        },
        {
          "startSeconds": 50,
          "endSeconds": 75,
          "intensityMean": 0.55,
          "intensityPeak": 0.93,
          "meanRmsDb": -15.25
        },
        {
          "startSeconds": 75,
          "endSeconds": 101,
          "intensityMean": 0.48,
          "intensityPeak": 0.89,
          "meanRmsDb": -17.53
        },
        {
          "startSeconds": 101,
          "endSeconds": 126,
          "intensityMean": 0.72,
          "intensityPeak": 0.98,
          "meanRmsDb": -13.22
        },
        {
          "startSeconds": 126,
          "endSeconds": 157,
          "intensityMean": 0.61,
          "intensityPeak": 0.97,
          "meanRmsDb": -13.52
        },
        {
          "startSeconds": 157,
          "endSeconds": 174,
          "intensityMean": 0.63,
          "intensityPeak": 0.88,
          "meanRmsDb": -13.26
        },
        {
          "startSeconds": 174,
          "endSeconds": 229,
          "intensityMean": 0.8,
          "intensityPeak": 1,
          "meanRmsDb": -10.95
        },
        {
          "startSeconds": 229,
          "endSeconds": 257,
          "intensityMean": 0.8,
          "intensityPeak": 1,
          "meanRmsDb": -10.34
        },
        {
          "startSeconds": 257,
          "endSeconds": 287.84,
          "intensityMean": 0.29,
          "intensityPeak": 0.91,
          "meanRmsDb": -23.97
        }
      ]
    },
    "song-a5fa64a7bd567b2b3385": {
      "audioSha256": "a5fa64a7bd567b2b3385bf93d922b556fcc8ce5c5bb3fa15650e91657196aa61",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 21,
          "intensityMean": 0.31,
          "intensityPeak": 0.79,
          "meanRmsDb": -17.1
        },
        {
          "startSeconds": 21,
          "endSeconds": 38,
          "intensityMean": 0.39,
          "intensityPeak": 0.85,
          "meanRmsDb": -14.04
        },
        {
          "startSeconds": 38,
          "endSeconds": 63,
          "intensityMean": 0.63,
          "intensityPeak": 0.92,
          "meanRmsDb": -10.65
        },
        {
          "startSeconds": 63,
          "endSeconds": 78,
          "intensityMean": 0.67,
          "intensityPeak": 0.93,
          "meanRmsDb": -11.16
        },
        {
          "startSeconds": 78,
          "endSeconds": 102,
          "intensityMean": 0.69,
          "intensityPeak": 0.91,
          "meanRmsDb": -10.83
        },
        {
          "startSeconds": 102,
          "endSeconds": 117,
          "intensityMean": 0.82,
          "intensityPeak": 0.96,
          "meanRmsDb": -8.76
        },
        {
          "startSeconds": 117,
          "endSeconds": 161,
          "intensityMean": 0.86,
          "intensityPeak": 1,
          "meanRmsDb": -8.32
        },
        {
          "startSeconds": 161,
          "endSeconds": 177,
          "intensityMean": 0.81,
          "intensityPeak": 1,
          "meanRmsDb": -7.76
        },
        {
          "startSeconds": 177,
          "endSeconds": 259,
          "intensityMean": 0.79,
          "intensityPeak": 1,
          "meanRmsDb": -8.42
        },
        {
          "startSeconds": 259,
          "endSeconds": 283.2,
          "intensityMean": 0.11,
          "intensityPeak": 0.39,
          "meanRmsDb": -35.01
        }
      ]
    },
    "song-b3e113acf45c94436a9d": {
      "audioSha256": "b3e113acf45c94436a9d1d6599aea25826d6ae53ac7ee8dbedf51de8eaed8198",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 30,
          "intensityMean": 0.37,
          "intensityPeak": 0.65,
          "meanRmsDb": -15.09
        },
        {
          "startSeconds": 30,
          "endSeconds": 63,
          "intensityMean": 0.61,
          "intensityPeak": 0.98,
          "meanRmsDb": -10.82
        },
        {
          "startSeconds": 63,
          "endSeconds": 99,
          "intensityMean": 0.49,
          "intensityPeak": 0.78,
          "meanRmsDb": -12.57
        },
        {
          "startSeconds": 99,
          "endSeconds": 128,
          "intensityMean": 0.73,
          "intensityPeak": 0.99,
          "meanRmsDb": -8.7
        },
        {
          "startSeconds": 128,
          "endSeconds": 152,
          "intensityMean": 0.79,
          "intensityPeak": 1,
          "meanRmsDb": -8.97
        },
        {
          "startSeconds": 152,
          "endSeconds": 199,
          "intensityMean": 0.84,
          "intensityPeak": 1,
          "meanRmsDb": -7.8
        },
        {
          "startSeconds": 199,
          "endSeconds": 218,
          "intensityMean": 0.86,
          "intensityPeak": 1,
          "meanRmsDb": -7.66
        },
        {
          "startSeconds": 218,
          "endSeconds": 243,
          "intensityMean": 0.83,
          "intensityPeak": 1,
          "meanRmsDb": -7.73
        },
        {
          "startSeconds": 243,
          "endSeconds": 259,
          "intensityMean": 0.57,
          "intensityPeak": 0.88,
          "meanRmsDb": -10.97
        },
        {
          "startSeconds": 259,
          "endSeconds": 278.3066666666667,
          "intensityMean": 0.18,
          "intensityPeak": 0.86,
          "meanRmsDb": -35.03
        }
      ]
    },
    "song-e684868f49202ef811b6": {
      "audioSha256": "e684868f49202ef811b6a32d2c51f470fa516b67c35fc22cffb7d98fe34c393f",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 27,
          "intensityMean": 0.4,
          "intensityPeak": 0.88,
          "meanRmsDb": -17.72
        },
        {
          "startSeconds": 27,
          "endSeconds": 50,
          "intensityMean": 0.47,
          "intensityPeak": 1,
          "meanRmsDb": -15.98
        },
        {
          "startSeconds": 50,
          "endSeconds": 95,
          "intensityMean": 0.82,
          "intensityPeak": 1,
          "meanRmsDb": -8.42
        },
        {
          "startSeconds": 95,
          "endSeconds": 147,
          "intensityMean": 0.79,
          "intensityPeak": 1,
          "meanRmsDb": -9.61
        },
        {
          "startSeconds": 147,
          "endSeconds": 165,
          "intensityMean": 0.57,
          "intensityPeak": 0.83,
          "meanRmsDb": -14.16
        },
        {
          "startSeconds": 165,
          "endSeconds": 188,
          "intensityMean": 0.85,
          "intensityPeak": 1,
          "meanRmsDb": -8.22
        },
        {
          "startSeconds": 188,
          "endSeconds": 197.7324716553288,
          "intensityMean": 0.06,
          "intensityPeak": 0.34,
          "meanRmsDb": -51.93
        }
      ]
    },
    "song-ee87db9502fc2eb535d1": {
      "audioSha256": "ee87db9502fc2eb535d1072806eb0400c51839b4845323df439ec1adebdd6ce3",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 23,
          "intensityMean": 0.22,
          "intensityPeak": 0.73,
          "meanRmsDb": -24.18
        },
        {
          "startSeconds": 23,
          "endSeconds": 51,
          "intensityMean": 0.46,
          "intensityPeak": 0.83,
          "meanRmsDb": -14.37
        },
        {
          "startSeconds": 51,
          "endSeconds": 88,
          "intensityMean": 0.66,
          "intensityPeak": 1,
          "meanRmsDb": -12.37
        },
        {
          "startSeconds": 88,
          "endSeconds": 123,
          "intensityMean": 0.8,
          "intensityPeak": 1,
          "meanRmsDb": -10.95
        },
        {
          "startSeconds": 123,
          "endSeconds": 175,
          "intensityMean": 0.66,
          "intensityPeak": 1,
          "meanRmsDb": -11.81
        },
        {
          "startSeconds": 175,
          "endSeconds": 212,
          "intensityMean": 0.76,
          "intensityPeak": 1,
          "meanRmsDb": -11.52
        },
        {
          "startSeconds": 212,
          "endSeconds": 255.70861678004536,
          "intensityMean": 0.68,
          "intensityPeak": 1,
          "meanRmsDb": -13.67
        }
      ]
    },
    "song-fe069a3eee056056e49f": {
      "audioSha256": "fe069a3eee056056e49f1f45976fd1c2ab6b7989793ee0b3e2371a31382d4762",
      "segments": [
        {
          "startSeconds": 0,
          "endSeconds": 16,
          "intensityMean": 0.31,
          "intensityPeak": 0.6,
          "meanRmsDb": -14.05
        },
        {
          "startSeconds": 16,
          "endSeconds": 31,
          "intensityMean": 0.63,
          "intensityPeak": 0.95,
          "meanRmsDb": -10.48
        },
        {
          "startSeconds": 31,
          "endSeconds": 82,
          "intensityMean": 0.75,
          "intensityPeak": 1,
          "meanRmsDb": -10.75
        },
        {
          "startSeconds": 82,
          "endSeconds": 119,
          "intensityMean": 0.76,
          "intensityPeak": 1,
          "meanRmsDb": -10.75
        },
        {
          "startSeconds": 119,
          "endSeconds": 173.38124716553287,
          "intensityMean": 0.71,
          "intensityPeak": 1,
          "meanRmsDb": -16.33
        }
      ]
    }
  }
};

}};
registry["miniprogram/catalog/ten-song-private-test.emotion.js"]={loaded:false,exports:{},fn:function(module,exports,require){
// 情绪标签内嵌模块（设备侧，miniprogram 运行时使用）
// 由 artifacts/local/gen-ten-song-manifest.js 从 analysis/catalog.emotion.json 机械生成（缺文件时为空模块）。
// 模型候选未听核：仅作同能量档内的次级排序信号，不进用户界面、不称识别。键=musicId，值=标签枚举。
'use strict';
module.exports = {
  "schemaVersion": "1.0.0",
  "byMusicId": {
    "song-9d9e4b6a0ea2681ae8ae": "melancholic",
    "song-8b8251a7f78e32735593": "melancholic",
    "song-a5fa64a7bd567b2b3385": "tender",
    "song-94d23acb31a5ea7430d3": "fired-up",
    "song-b3e113acf45c94436a9d": "fired-up",
    "song-ee87db9502fc2eb535d1": "melancholic",
    "song-e684868f49202ef811b6": "melancholic",
    "song-115662b177d4892cfd89": "melancholic"
  }
};

}};
var rootRequire=makeRequire("");window.pulsecraft={};
window.pulsecraft["arranger"]=rootRequire("./miniprogram/domain/arranger.js");
window.pulsecraft["contracts"]=rootRequire("./miniprogram/domain/contracts.js");
window.pulsecraft["hash"]=rootRequire("./miniprogram/domain/hash.js");
window.pulsecraft["rules"]=rootRequire("./miniprogram/config/rules.js");
window.pulsecraft["runtime"]=rootRequire("./miniprogram/config/runtime.js");
window.pulsecraft["view"]=rootRequire("./miniprogram/services/arrangement-view.js");
window.pulsecraft["trendView"]=rootRequire("./miniprogram/services/trend-view.js");
window.pulsecraft["trendChart"]=rootRequire("./miniprogram/services/trend-chart.js");
window.pulsecraft["manifest"]=rootRequire("./miniprogram/catalog/ten-song-private-test.manifest.js");
window.pulsecraft["intensity"]=rootRequire("./miniprogram/catalog/ten-song-private-test.intensity.js");
window.pulsecraft["emotion"]=rootRequire("./miniprogram/catalog/ten-song-private-test.emotion.js");
})();
